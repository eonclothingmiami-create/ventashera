/**
 * Edge Function: ebay-sync-product (V2 strategy)
 *
 * Canal eBay aislado del ERP/catálogo. Acciones:
 *   publish        — publica/actualiza solo lotes mayoristas
 *   deactivate     — retira retail viejo y/o lote mayorista
 *   monthly_sync   — mantenimiento batch de inventario mayorista
 *   republish_all  — migración / resincronización masiva de inventario eBay
 *   account_setup  — diagnóstico políticas
 *
 * Tablas eBay-only: ebay_publish_config, ebay_derived_listings
 * Estrategia: eBay mayorista only. Nunca publica unidad individual.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  getTrmSnapshot,
  shippingUnitCop,
} from "../_shared/cop_usd_fx.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-ebay-cron-secret",
};

const TOKEN_BUFFER_MS = 5 * 60 * 1000;
const INVENTORY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account";

type Body = {
  productId?: string;
  action?: "publish" | "deactivate" | "account_setup" | "monthly_sync" | "republish_all";
  listingKind?: "retail" | "lot";
  cronSecret?: string;
  offset?: number;
};

type TokenRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
};

type ProductRow = {
  id: string;
  ref: string | null;
  name: string | null;
  description: string | null;
  price: number | null;
  stock: number | null;
  active: boolean | null;
  ebay_listing_id: string | null;
  ebay_offer_id: string | null;
  ebay_sku: string | null;
};

type PublishConfig = {
  monthly_top_n: number;
  lot_top_n: number;
  lot_size: number;
  wholesale_discount_pct: number;
  best_offer_enabled: boolean;
  auto_sync_enabled: boolean;
  cron_secret: string;
  retail_markup_cop: number;
  shipping_cop_per_kg_us: number;
  units_per_kg: number;
  trm_fallback: number;
};

type TopProduct = {
  product_id: string;
  product_ref: string | null;
  view_count: number;
  stock: number;
  rank: number;
};

type DerivedRow = {
  id: string;
  product_id: string;
  lot_size: number;
  sku: string;
  ebay_offer_id: string | null;
  ebay_listing_id: string | null;
};

type ListingKind = "retail" | "lot";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function env(name: string, fallback = ""): string {
  return (Deno.env.get(name) ?? fallback).trim();
}

function apiBase(): string {
  return env("EBAY_API_BASE", "https://api.ebay.com").replace(/\/$/, "");
}

function marketplaceId(): string {
  return env("EBAY_MARKETPLACE_ID", "EBAY_US");
}

function skuFromProduct(p: ProductRow): string {
  const ref = (p.ref || "").trim().replace(/[^A-Za-z0-9._-]/g, "-");
  if (ref && ref.length <= 50) return ref;
  return ("HERA-" + p.id.replace(/-/g, "")).slice(0, 50);
}

function lotSku(baseSku: string, lotSize: number): string {
  const suffix = `-LOT${lotSize}`;
  const maxBase = 50 - suffix.length;
  return (baseSku.slice(0, maxBase) + suffix).slice(0, 50);
}

function computeListingPriceCop(
  unitCop: number,
  listingKind: ListingKind,
  config: PublishConfig,
): number {
  const shipUnit = shippingUnitCop(config.shipping_cop_per_kg_us, config.units_per_kg);
  if (listingKind === "lot") {
    const discount = 1 - config.wholesale_discount_pct / 100;
    const lotSize = config.lot_size;
    return unitCop * lotSize * discount + config.shipping_cop_per_kg_us;
  }
  const publicCop = unitCop + config.retail_markup_cop;
  return publicCop + shipUnit;
}

async function priceUsdForListing(
  unitCop: number,
  listingKind: ListingKind,
  config: PublishConfig,
): Promise<{ priceUsd: string; trm: number; trmSource: string; totalCop: number }> {
  const trmSnap = await getTrmSnapshot(config.trm_fallback);
  const totalCop = computeListingPriceCop(unitCop, listingKind, config);
  const globalMarkup = Number(env("EBAY_PRICE_USD_MARKUP", "1")) || 1;
  const usd = (totalCop / trmSnap.copPerUsd) * globalMarkup;
  return {
    priceUsd: Math.max(0.99, Math.round(usd * 100) / 100).toFixed(2),
    trm: trmSnap.copPerUsd,
    trmSource: trmSnap.source,
    totalCop,
  };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function ebayJson(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Language": "en-US",
    "Accept-Language": "en-US",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(apiBase() + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, text };
}

function ebayErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.errors) && o.errors[0] && typeof o.errors[0] === "object") {
      const e = o.errors[0] as { message?: string; longMessage?: string };
      return String(e.longMessage || e.message || fallback).slice(0, 800);
    }
    if (typeof o.message === "string") return o.message.slice(0, 800);
  }
  return fallback.slice(0, 800);
}

async function exchangeRefresh(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number } | null> {
  const basic = btoa(`${clientId}:${clientSecret}`);
  const oauthHost = apiBase().includes("sandbox")
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: INVENTORY_SCOPE,
  });
  const res = await fetch(`${oauthHost}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

async function getValidAccessToken(sb: SupabaseClient): Promise<string> {
  const clientId = env("EBAY_CLIENT_ID");
  const clientSecret = env("EBAY_CLIENT_SECRET");
  const envAccess = env("EBAY_ACCESS_TOKEN");
  const envRefresh = env("EBAY_REFRESH_TOKEN");

  let row: TokenRow | null = null;
  try {
    const { data, error } = await sb.from("ebay_oauth_tokens").select("*").eq("id", "default")
      .maybeSingle();
    if (!error && data) row = data as TokenRow;
  } catch {
    /* tabla ausente */
  }

  let access = (row?.access_token || envAccess).trim();
  let refresh = (row?.refresh_token || envRefresh).trim();
  const expMs = row?.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (access && expMs > Date.now() + TOKEN_BUFFER_MS) return access;

  if (refresh && clientId && clientSecret) {
    const exchanged = await exchangeRefresh(refresh, clientId, clientSecret);
    if (exchanged?.access_token) {
      access = exchanged.access_token;
      if (exchanged.refresh_token) refresh = exchanged.refresh_token;
      const expiresAt = new Date(
        Date.now() + Math.max(60, Number(exchanged.expires_in) || 7200) * 1000,
      ).toISOString();
      try {
        await sb.from("ebay_oauth_tokens").upsert({
          id: "default",
          access_token: access,
          refresh_token: refresh,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        });
      } catch {
        /* noop */
      }
      return access;
    }
  }
  return access;
}

async function getApplicationToken(): Promise<string> {
  const clientId = env("EBAY_CLIENT_ID");
  const clientSecret = env("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) return "";
  const basic = btoa(`${clientId}:${clientSecret}`);
  const oauthHost = apiBase().includes("sandbox")
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
  const res = await fetch(`${oauthHost}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }).toString(),
  });
  if (!res.ok) return "";
  const data = await res.json() as { access_token?: string };
  return String(data.access_token || "").trim();
}

async function defaultCategoryTreeId(taxToken: string): Promise<string> {
  const treeRes = await ebayJson(
    taxToken,
    "GET",
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(marketplaceId())}`,
  );
  return treeRes.data && typeof treeRes.data === "object"
    ? String((treeRes.data as { categoryTreeId?: string }).categoryTreeId || "")
    : "";
}

async function suggestCategoryId(userToken: string, title: string): Promise<{ categoryId: string; treeId: string }> {
  const fromEnv = env("EBAY_DEFAULT_CATEGORY_ID");
  const taxToken = (await getApplicationToken()) || userToken;
  const treeId = await defaultCategoryTreeId(taxToken);
  if (fromEnv) return { categoryId: fromEnv, treeId };
  if (!treeId) return { categoryId: "", treeId: "" };
  const q = encodeURIComponent(title.slice(0, 200));
  const sug = await ebayJson(
    taxToken,
    "GET",
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${q}`,
  );
  const hits =
    sug.data && typeof sug.data === "object"
      ? (sug.data as { categorySuggestions?: Array<{ category?: { categoryId?: string } }> })
        .categorySuggestions
      : [];
  return { categoryId: hits?.[0]?.category?.categoryId || "", treeId };
}

function pickFromValues(values: string[], preferred: string[]): string {
  for (const p of preferred) {
    const hit = values.find((v) => v.toLowerCase() === p.toLowerCase());
    if (hit) return hit;
  }
  return "";
}

function defaultAspectFallback(aspectName: string, title: string, values: string[]): string {
  const n = aspectName.toLowerCase();
  if (n.includes("size type")) {
    return pickFromValues(values, ["Regular", "One Size", "Standard", "Plus"]) || "Regular";
  }
  if (n === "type" || n.includes("product type")) {
    if (/bikini|two.?piece|2.?piece|tri.?angle/i.test(title)) {
      return pickFromValues(values, ["Bikini", "Bikini Set", "Two-Piece Swimsuit", "Swimsuit"]) || "Bikini";
    }
    if (/one.?piece|entero|monokini/i.test(title)) {
      return pickFromValues(values, ["One-Piece", "One Piece Swimsuit", "Swimsuit"]) || "One-Piece";
    }
    if (/cover|salida|pareo|kaftan/i.test(title)) {
      return pickFromValues(values, ["Cover-Up", "Swim Cover-Up", "Cover Up"]) || "Cover-Up";
    }
    return pickFromValues(values, ["Swimsuit", "Bikini", "Swimwear", "Bathing Suit"]) || "";
  }
  if (n.includes("fragrance")) {
    return pickFromValues(values, ["Unscented", "Does Not Apply", "No Fragrance"]) || "Unscented";
  }
  if (n.includes("department")) {
    return pickFromValues(values, ["Women", "Unisex Adult", "Women's"]) || "Women";
  }
  return "";
}

function pickAspectValue(title: string, values: string[], fallback: string): string {
  const t = title.toLowerCase();
  const hit = values.find((v) => v && t.includes(v.toLowerCase()));
  if (hit) return hit;
  const aliases: Array<[RegExp, string[]]> = [
    [/bikini|two[\s-]?piece|2[\s-]?piece/i, ["Bikini", "Two-Piece", "2-Piece"]],
    [/one[\s-]?piece|entero|monokini/i, ["One-Piece", "One Piece"]],
    [/short|pantaloneta/i, ["Shorts", "Board Shorts"]],
    [/sudadera|hoodie/i, ["Hoodie", "Sweatshirt"]],
    [/cover[\s-]?up|salida/i, ["Cover-Up", "Cover Up"]],
  ];
  for (const [re, names] of aliases) {
    if (!re.test(title)) continue;
    const m = names.find((n) => values.some((v) => v.toLowerCase() === n.toLowerCase()));
    if (m) {
      const exact = values.find((v) => v.toLowerCase() === m.toLowerCase());
      if (exact) return exact;
    }
  }
  return fallback || values[0] || "Does Not Apply";
}

async function requiredAspects(
  taxToken: string,
  treeId: string,
  categoryId: string,
  title: string,
  sizeLabel: string,
  colorLabel: string,
): Promise<Record<string, string[]>> {
  const aspects: Record<string, string[]> = {
    Brand: [env("EBAY_BRAND", "Hera")],
    Size: [String(sizeLabel).slice(0, 65)],
    Color: [String(colorLabel).slice(0, 65)],
  };
  if (!treeId || !categoryId) return aspects;
  const res = await ebayJson(
    taxToken,
    "GET",
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
  );
  const list =
    res.data && typeof res.data === "object"
      ? (res.data as {
        aspects?: Array<{
          localizedAspectName?: string;
          aspectConstraint?: { aspectRequired?: boolean };
          aspectValues?: Array<{ localizedValue?: string }>;
        }>;
      }).aspects || []
      : [];
  for (const a of list) {
    const name = String(a.localizedAspectName || "").trim();
    if (!name || !a.aspectConstraint?.aspectRequired || aspects[name]) continue;
    const values = (a.aspectValues || [])
      .map((v) => String(v.localizedValue || "").trim())
      .filter(Boolean);
    const secret = env("EBAY_ASPECT_" + name.toUpperCase().replace(/[^A-Z0-9]+/g, "_"));
    let picked = pickAspectValue(title, values, secret);
    if (!picked || picked === "Does Not Apply") {
      picked = defaultAspectFallback(name, title, values) || picked;
    }
    aspects[name] = [picked || values[0] || "Does Not Apply"];
  }
  return aspects;
}

function normName(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function pickPolicy(
  items: Array<{ name?: string; paymentPolicyId?: string; returnPolicyId?: string; fulfillmentPolicyId?: string }>,
  wanted: string,
  idKey: "paymentPolicyId" | "returnPolicyId" | "fulfillmentPolicyId",
): { name: string; id: string } | null {
  const want = normName(wanted);
  const hit = items.find((p) => normName(String(p.name || "")) === want)
    || items.find((p) => normName(String(p.name || "")).includes(want));
  const id = hit ? String(hit[idKey] || "").trim() : "";
  if (!hit || !id) return null;
  return { name: String(hit.name || wanted), id };
}

async function runAccountSetup(token: string): Promise<Record<string, unknown>> {
  const mp = encodeURIComponent(marketplaceId());
  const [payRes, retRes, fulRes, locRes, privRes, programRes] = await Promise.all([
    ebayJson(token, "GET", `/sell/account/v1/payment_policy?marketplace_id=${mp}`),
    ebayJson(token, "GET", `/sell/account/v1/return_policy?marketplace_id=${mp}`),
    ebayJson(token, "GET", `/sell/account/v1/fulfillment_policy?marketplace_id=${mp}`),
    ebayJson(token, "GET", "/sell/inventory/v1/location?limit=100"),
    ebayJson(token, "GET", "/sell/account/v1/privilege"),
    ebayJson(token, "GET", "/sell/account/v1/payments_program/EBAY_US/EBAY_PAYMENTS"),
  ]);

  const paymentPolicies =
    payRes.data && typeof payRes.data === "object"
      ? (payRes.data as { paymentPolicies?: Array<{ name?: string; paymentPolicyId?: string }> }).paymentPolicies || []
      : [];
  const returnPolicies =
    retRes.data && typeof retRes.data === "object"
      ? (retRes.data as { returnPolicies?: Array<{ name?: string; returnPolicyId?: string }> }).returnPolicies || []
      : [];
  const fulfillmentPolicies =
    fulRes.data && typeof fulRes.data === "object"
      ? (fulRes.data as { fulfillmentPolicies?: Array<{ name?: string; fulfillmentPolicyId?: string }> }).fulfillmentPolicies || []
      : [];
  const locations =
    locRes.data && typeof locRes.data === "object"
      ? (locRes.data as { locations?: Array<{ merchantLocationKey?: string; merchantLocationStatus?: string; name?: string }> }).locations || []
      : [];

  const payment = pickPolicy(paymentPolicies, "Hera Payment US", "paymentPolicyId");
  const ret = pickPolicy(returnPolicies, "Hera Returns US", "returnPolicyId");
  const fulfillment = pickPolicy(fulfillmentPolicies, "Hera Shipping CO to US", "fulfillmentPolicyId");

  const missing: string[] = [];
  if (!payRes.ok) missing.push("payment_policy: " + ebayErrorMessage(payRes.data, String(payRes.status)));
  if (!retRes.ok) missing.push("return_policy: " + ebayErrorMessage(retRes.data, String(retRes.status)));
  if (!fulRes.ok) missing.push("fulfillment_policy: " + ebayErrorMessage(fulRes.data, String(fulRes.status)));
  if (!payment) missing.push('No se encontró payment policy "Hera Payment US"');
  if (!ret) missing.push('No se encontró return policy "Hera Returns US"');
  if (!fulfillment) missing.push('No se encontró fulfillment policy "Hera Shipping CO to US"');

  const wantedKey = env("EBAY_MERCHANT_LOCATION_KEY", "hera-medellin-co") || "hera-medellin-co";
  const enabled = locations.filter((l) =>
    String(l.merchantLocationStatus || "ENABLED").toUpperCase() !== "DISABLED" &&
    String(l.merchantLocationKey || "").trim()
  );
  let locationKey = enabled.find((l) => l.merchantLocationKey === wantedKey)?.merchantLocationKey
    || enabled[0]?.merchantLocationKey
    || "";
  let locationCreated = false;

  if (!locationKey) {
    const created = await ebayJson(token, "POST", `/sell/inventory/v1/location/${encodeURIComponent(wantedKey)}`, {
      location: {
        address: {
          city: "Medellin",
          stateOrProvince: "Antioquia",
          postalCode: "050021",
          country: "CO",
        },
      },
      locationTypes: ["WAREHOUSE"],
      name: "Hera Medellin CO",
      merchantLocationStatus: "ENABLED",
    });
    if (!created.ok && created.status !== 204 && created.status !== 409) {
      missing.push("location: " + ebayErrorMessage(created.data, "No se pudo crear hera-medellin-co"));
    } else {
      locationKey = wantedKey;
      locationCreated = created.status === 204 || created.ok;
    }
  }

  return {
    ok: missing.length === 0 && !!locationKey,
    marketplaceId: marketplaceId(),
    paymentPolicyId: payment?.id || null,
    paymentPolicyName: payment?.name || null,
    returnPolicyId: ret?.id || null,
    returnPolicyName: ret?.name || null,
    fulfillmentPolicyId: fulfillment?.id || null,
    fulfillmentPolicyName: fulfillment?.name || null,
    merchantLocationKey: locationKey || null,
    locationCreated,
    sellerPrivilege: privRes.ok ? privRes.data : { error: ebayErrorMessage(privRes.data, String(privRes.status)) },
    paymentsProgram: programRes.ok ? programRes.data : { error: ebayErrorMessage(programRes.data, String(programRes.status)) },
    locationsFound: enabled.map((l) => ({
      key: l.merchantLocationKey,
      name: l.name,
      status: l.merchantLocationStatus,
    })),
    errors: missing.length ? missing : undefined,
  };
}

function encodeMediaUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.pathname = u.pathname
      .split("/")
      .map((seg) => {
        if (!seg) return seg;
        try {
          return encodeURIComponent(decodeURIComponent(seg));
        } catch {
          return encodeURIComponent(seg);
        }
      })
      .join("/");
    return u.toString();
  } catch {
    return raw;
  }
}

function isEbayNativeImage(url: string): boolean {
  return /\.(jpe?g|png|gif|tiff|bmp)(\?|#|$)/i.test(url);
}

function jpegViaWeserv(src: string): string {
  const encoded = encodeMediaUrl(src);
  const hostFree = encoded.replace(/^https?:\/\//i, "");
  const u = new URL("https://images.weserv.nl/");
  u.searchParams.set("url", hostFree);
  u.searchParams.set("output", "jpg");
  u.searchParams.set("q", "85");
  u.searchParams.set("w", "1600");
  return u.toString();
}

function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

async function toEbayJpegUrls(
  sb: SupabaseClient,
  productId: string,
  rawUrls: string[],
): Promise<string[]> {
  const supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
  const out: string[] = [];
  let n = 0;
  for (const raw of rawUrls.slice(0, 8)) {
    n += 1;
    if (isEbayNativeImage(raw)) {
      out.push(encodeMediaUrl(raw));
      continue;
    }
    const path = `ebay-jpg/${productId}/${String(n).padStart(2, "0")}.jpg`;
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/Catalog-media/${path}`;
    try {
      const head = await fetch(publicUrl, { method: "HEAD" });
      if (head.ok) {
        out.push(publicUrl);
        continue;
      }
    } catch {
      /* convert */
    }
    let bytes: Uint8Array | null = null;
    try {
      const conv = await fetch(jpegViaWeserv(raw), {
        headers: { Accept: "image/jpeg,image/*,*/*" },
      });
      if (conv.ok) {
        const buf = new Uint8Array(await conv.arrayBuffer());
        if (isJpegBytes(buf) && buf.length < 10_000_000) bytes = buf;
      }
    } catch {
      bytes = null;
    }
    if (!bytes) continue;
    const up = await sb.storage.from("Catalog-media").upload(path, bytes, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "604800",
    });
    if (up.error) continue;
    out.push(publicUrl);
  }
  return out;
}

async function loadPublishConfig(sb: SupabaseClient): Promise<PublishConfig> {
  const { data } = await sb.from("ebay_publish_config").select("*").eq("id", "default").maybeSingle();
  const row = data as Record<string, unknown> | null;
  return {
    monthly_top_n: Number(row?.monthly_top_n) || 90,
    lot_top_n: Number(row?.lot_top_n) || 40,
    lot_size: Number(row?.lot_size) || 12,
    wholesale_discount_pct: Number(row?.wholesale_discount_pct) || 15,
    best_offer_enabled: row?.best_offer_enabled !== false,
    auto_sync_enabled: row?.auto_sync_enabled !== false,
    cron_secret: String(row?.cron_secret || ""),
    retail_markup_cop: Number(row?.retail_markup_cop) ?? 15000,
    shipping_cop_per_kg_us: Number(row?.shipping_cop_per_kg_us) || 250000,
    units_per_kg: Number(row?.units_per_kg) || 12,
    trm_fallback: Number(row?.trm_fallback) || Number(env("EBAY_COP_PER_USD", "4000")) || 4000,
  };
}

async function getTopViewed(sb: SupabaseClient, limit: number): Promise<TopProduct[]> {
  const { data, error } = await sb.rpc("ebay_top_viewed_products", { p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return (data as TopProduct[]).map((r) => ({
    product_id: String(r.product_id),
    product_ref: r.product_ref,
    view_count: Number(r.view_count) || 0,
    stock: Number(r.stock) || 0,
    rank: Number(r.rank) || 0,
  }));
}

async function isInRetailTop(sb: SupabaseClient, productId: string, topN: number): Promise<boolean> {
  const top = await getTopViewed(sb, topN);
  return top.some((t) => t.product_id === productId);
}

async function persistRetail(
  sb: SupabaseClient,
  productId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.from("products").update({
    ...patch,
    ebay_last_sync_at: new Date().toISOString(),
  }).eq("id", productId);
  if (error) console.warn("[ebay-sync] persistRetail:", error.message);
}

async function persistDerived(
  sb: SupabaseClient,
  derivedId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.from("ebay_derived_listings").update({
    ...patch,
    updated_at: new Date().toISOString(),
    ebay_last_sync_at: new Date().toISOString(),
  }).eq("id", derivedId);
  if (error) console.warn("[ebay-sync] persistDerived:", error.message);
}

async function ensureDerivedRow(
  sb: SupabaseClient,
  productId: string,
  baseSku: string,
  lotSize: number,
): Promise<DerivedRow | null> {
  const sku = lotSku(baseSku, lotSize);
  const { data: existing } = await sb
    .from("ebay_derived_listings")
    .select("id, product_id, lot_size, sku, ebay_offer_id, ebay_listing_id")
    .eq("product_id", productId)
    .eq("listing_kind", "lot")
    .eq("lot_size", lotSize)
    .maybeSingle();

  if (existing) return existing as DerivedRow;

  const { data: inserted, error } = await sb
    .from("ebay_derived_listings")
    .insert({
      product_id: productId,
      listing_kind: "lot",
      lot_size: lotSize,
      sku,
    })
    .select("id, product_id, lot_size, sku, ebay_offer_id, ebay_listing_id")
    .single();

  if (error || !inserted) return null;
  return inserted as DerivedRow;
}

async function loadProductMedia(
  sb: SupabaseClient,
  productId: string,
): Promise<{ images: string[]; sizeLabel: string; colorLabel: string }> {
  const [{ data: mediaRows }, { data: sizeRows }, { data: colorRows }] = await Promise.all([
    sb.from("product_media").select("url, is_cover").eq("product_id", productId),
    sb.from("product_sizes").select("sizes(label)").eq("product_id", productId),
    sb.from("product_colors").select("colors(label)").eq("product_id", productId),
  ]);

  const images = (mediaRows || [])
    .sort((a: { is_cover?: boolean }, b: { is_cover?: boolean }) => (b.is_cover ? 1 : 0) - (a.is_cover ? 1 : 0))
    .map((m: { url?: string }) => String(m.url || "").trim())
    .filter((u: string) => /^https:\/\//i.test(u))
    .slice(0, 12);

  const sizeLabel =
    (sizeRows || [])
      .map((r: { sizes?: { label?: string } | { label?: string }[] }) => {
        const s = r.sizes;
        if (Array.isArray(s)) return s[0]?.label;
        return s?.label;
      })
      .find((x: string | undefined) => x && String(x).trim()) || env("EBAY_DEFAULT_SIZE", "M");

  const colorLabel =
    (colorRows || [])
      .map((r: { colors?: { label?: string } | { label?: string }[] }) => {
        const c = r.colors;
        if (Array.isArray(c)) return c[0]?.label;
        return c?.label;
      })
      .find((x: string | undefined) => x && String(x).trim()) || env("EBAY_DEFAULT_COLOR", "Black");

  return { images, sizeLabel: String(sizeLabel), colorLabel: String(colorLabel) };
}

function buildLotCopy(
  baseTitle: string,
  baseDescription: string,
  lotSize: number,
  priceUsd: string,
): { title: string; description: string } {
  const prefix = `Wholesale Lot of ${lotSize} - `;
  const title = (prefix + baseTitle).slice(0, 80);
  const unitUsd = (Number(priceUsd) / lotSize).toFixed(2);
  const lotNote =
    `You are purchasing ONE wholesale lot of ${lotSize} identical units. ` +
    `Lot price: $${priceUsd} USD ($${unitUsd} per unit). Ships from Colombia. `;
  const description = (lotNote + baseDescription).slice(0, 4000);
  return { title, description };
}

type PublishResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  sku?: string;
  offerId?: string | null;
  listingId?: string | null;
  listingKind?: ListingKind;
  priceUsd?: string;
  trm?: number;
  trmSource?: string;
  categoryId?: string;
};

async function publishListing(
  sb: SupabaseClient,
  token: string,
  productId: string,
  listingKind: ListingKind,
  config: PublishConfig,
): Promise<PublishResult> {
  if (listingKind !== "lot") {
    return {
      ok: true,
      skipped: true,
      reason: "retail individual deshabilitado; eBay opera solo por lotes",
      listingKind,
    };
  }
  const fulfillment = env("EBAY_FULFILLMENT_POLICY_ID");
  const payment = env("EBAY_PAYMENT_POLICY_ID");
  const ret = env("EBAY_RETURN_POLICY_ID");
  const location = env("EBAY_MERCHANT_LOCATION_KEY");
  if (!fulfillment || !payment || !ret || !location) {
    return { ok: false, error: "Faltan políticas eBay US en secrets" };
  }

  const { data: product, error: pErr } = await sb
    .from("products")
    .select("id, ref, name, description, price, stock, active, ebay_listing_id, ebay_offer_id, ebay_sku")
    .eq("id", productId)
    .maybeSingle();
  if (pErr || !product) return { ok: false, error: pErr?.message || "Producto no encontrado" };
  const p = product as ProductRow;

  if (!p.active || Number(p.stock) <= 0) {
    return { ok: true, skipped: true, reason: "producto inactivo o sin stock" };
  }

  const baseSku = (p.ebay_sku && String(p.ebay_sku).trim()) || skuFromProduct(p);
  const baseTitle = String(p.name || "Product");
  const baseDescription = stripHtml(String(p.description || p.name || "Product"));

  let sku = baseSku;
  let qty = 1;
  let offerId = "";
  let listingId = "";
  let derivedId: string | null = null;
  let title = baseTitle.slice(0, 80);
  let description = baseDescription;
  const unitCop = Number(p.price) || 0;
  const priced = await priceUsdForListing(unitCop, listingKind, config);
  let priceUsd = priced.priceUsd;

  const lotSize = config.lot_size;
  if (Number(p.stock) < lotSize) {
    return { ok: true, skipped: true, reason: `stock ${p.stock} < lote ${lotSize}` };
  }
  qty = Math.max(1, Math.floor(Number(p.stock) / lotSize));
  const derived = await ensureDerivedRow(sb, productId, baseSku, lotSize);
  if (!derived) return { ok: false, error: "No se pudo crear fila derivada eBay" };
  derivedId = derived.id;
  sku = derived.sku;
  offerId = String(derived.ebay_offer_id || "").trim();
  listingId = String(derived.ebay_listing_id || "").trim();
  const lotCopy = buildLotCopy(baseTitle, baseDescription, lotSize, priceUsd);
  title = lotCopy.title;
  description = lotCopy.description;

  const suggested = await suggestCategoryId(token, title);
  const categoryId = suggested.categoryId;
  if (!categoryId) {
    return { ok: false, error: "Sin categoría eBay (EBAY_DEFAULT_CATEGORY_ID o Taxonomy)" };
  }

  const { images, sizeLabel, colorLabel } = await loadProductMedia(sb, productId);
  const taxToken = (await getApplicationToken()) || token;
  const aspects = await requiredAspects(
    taxToken,
    suggested.treeId,
    categoryId,
    title,
    sizeLabel,
    colorLabel,
  );

  const ebayImages = await toEbayJpegUrls(sb, productId, images);
  const inventoryItem = {
    availability: { shipToLocationAvailability: { quantity: qty } },
    condition: "NEW" as const,
    product: {
      title,
      description: description.slice(0, 4000) || title,
      aspects,
      ...(ebayImages.length ? { imageUrls: ebayImages } : {}),
    },
  };

  const putItem = await ebayJson(
    token,
    "PUT",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    inventoryItem,
  );
  if (!putItem.ok) {
    const msg = ebayErrorMessage(putItem.data, "eBay rechazó inventory_item");
    if (derivedId) {
      await persistDerived(sb, derivedId, { ebay_sync_status: "error", ebay_last_error: msg });
    } else {
      await persistRetail(sb, productId, { ebay_sku: sku, ebay_sync_status: "error", ebay_last_error: msg });
    }
    return { ok: false, error: msg, sku, listingKind };
  }

  if (!offerId) {
    const listed = await ebayJson(token, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
    const offers =
      listed.data && typeof listed.data === "object"
        ? (listed.data as { offers?: Array<{ offerId?: string; listing?: { listingId?: string } }> }).offers
        : [];
    offerId = offers?.[0]?.offerId || "";
    if (!listingId) listingId = offers?.[0]?.listing?.listingId || "";
  }

  const listingPolicies: Record<string, unknown> = {
    fulfillmentPolicyId: fulfillment,
    paymentPolicyId: payment,
    returnPolicyId: ret,
  };
  if (config.best_offer_enabled) {
    listingPolicies.bestOfferTerms = { bestOfferEnabled: true };
  }

  const offerPayload = {
    sku,
    marketplaceId: marketplaceId(),
    format: "FIXED_PRICE",
    listingDuration: "GTC",
    availableQuantity: qty,
    categoryId,
    listingDescription: description.slice(0, 4000) || title,
    listingPolicies,
    pricingSummary: { price: { value: priceUsd, currency: "USD" } },
    merchantLocationKey: location,
  };

  if (offerId) {
    const upd = await ebayJson(
      token,
      "PUT",
      `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
      offerPayload,
    );
    if (!upd.ok) {
      const msg = ebayErrorMessage(upd.data, "eBay rechazó updateOffer");
      if (derivedId) {
        await persistDerived(sb, derivedId, { ebay_offer_id: offerId, ebay_sync_status: "error", ebay_last_error: msg });
      } else {
        await persistRetail(sb, productId, { ebay_sku: sku, ebay_offer_id: offerId, ebay_sync_status: "error", ebay_last_error: msg });
      }
      return { ok: false, error: msg, sku, offerId, listingKind };
    }
  } else {
    const created = await ebayJson(token, "POST", "/sell/inventory/v1/offer", offerPayload);
    if (!created.ok) {
      const msg = ebayErrorMessage(created.data, "eBay rechazó createOffer");
      if (derivedId) {
        await persistDerived(sb, derivedId, { ebay_sync_status: "error", ebay_last_error: msg });
      } else {
        await persistRetail(sb, productId, { ebay_sku: sku, ebay_sync_status: "error", ebay_last_error: msg });
      }
      return { ok: false, error: msg, sku, listingKind };
    }
    offerId = String(
      (created.data && typeof created.data === "object"
        ? (created.data as { offerId?: string }).offerId
        : "") || "",
    );
  }

  if (offerId && !listingId) {
    const pub = await ebayJson(
      token,
      "POST",
      `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    );
    if (!pub.ok) {
      const msg = ebayErrorMessage(pub.data, "eBay rechazó publishOffer");
      if (derivedId) {
        await persistDerived(sb, derivedId, {
          ebay_offer_id: offerId,
          ebay_sync_status: "error",
          ebay_last_error: msg,
        });
      } else {
        await persistRetail(sb, productId, {
          ebay_sku: sku,
          ebay_offer_id: offerId,
          ebay_sync_status: "error",
          ebay_last_error: msg,
        });
      }
      return { ok: false, error: msg, sku, offerId, listingKind };
    }
    listingId = String(
      (pub.data && typeof pub.data === "object"
        ? (pub.data as { listingId?: string }).listingId
        : "") || "",
    );
  }

  if (derivedId) {
    await persistDerived(sb, derivedId, {
      sku,
      ebay_offer_id: offerId || null,
      ebay_listing_id: listingId || null,
      ebay_sync_status: listingId ? "published" : "offer",
      ebay_last_error: null,
    });
  }
  await persistRetail(sb, productId, {
    ebay_sku: baseSku,
    ebay_offer_id: null,
    ebay_listing_id: null,
    ebay_sync_status: listingId ? "lot_only" : "lot_offer",
    ebay_last_error: null,
  });

  return {
    ok: true,
    sku,
    offerId: offerId || null,
    listingId: listingId || null,
    listingKind,
    priceUsd,
    trm: priced.trm,
    trmSource: priced.trmSource,
    categoryId,
  };
}

async function deactivateListing(
  sb: SupabaseClient,
  token: string,
  productId: string,
  listingKind: ListingKind,
  lotSize: number,
): Promise<PublishResult> {
  const { data: product } = await sb
    .from("products")
    .select("id, ref, ebay_offer_id, ebay_sku, ebay_listing_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return { ok: false, error: "Producto no encontrado" };
  const p = product as ProductRow;

  let sku = (p.ebay_sku && String(p.ebay_sku).trim()) || skuFromProduct(p);
  let offerId = (p.ebay_offer_id || "").trim();
  let derivedId: string | null = null;

  if (listingKind === "lot") {
    const { data: derived } = await sb
      .from("ebay_derived_listings")
      .select("id, sku, ebay_offer_id")
      .eq("product_id", productId)
      .eq("listing_kind", "lot")
      .eq("lot_size", lotSize)
      .maybeSingle();
    if (!derived) return { ok: true, skipped: true, reason: "sin lote derivado" };
    derivedId = derived.id;
    sku = String(derived.sku);
    offerId = String(derived.ebay_offer_id || "").trim();
  }

  if (!offerId) {
    const listed = await ebayJson(token, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
    const offers =
      listed.data && typeof listed.data === "object"
        ? (listed.data as { offers?: Array<{ offerId?: string }> }).offers
        : [];
    offerId = offers?.[0]?.offerId || "";
  }

  if (!offerId) {
    return { ok: true, skipped: true, reason: "sin offerId para retirar", listingKind };
  }

  const withdrawn = await ebayJson(token, "POST", `/sell/inventory/v1/offer/${offerId}/withdraw`);
  if (!withdrawn.ok && withdrawn.status !== 404) {
    const msg = ebayErrorMessage(withdrawn.data, "eBay rechazó withdrawOffer");
    if (listingKind === "lot" && derivedId) {
      await persistDerived(sb, derivedId, { ebay_sync_status: "error", ebay_last_error: msg });
    } else {
      await persistRetail(sb, productId, { ebay_sync_status: "error", ebay_last_error: msg });
    }
    return { ok: false, error: msg, sku, listingKind };
  }

  if (listingKind === "lot" && derivedId) {
    await persistDerived(sb, derivedId, {
      ebay_sync_status: "withdrawn",
      ebay_last_error: null,
      ebay_listing_id: null,
      ebay_offer_id: null,
    });
  } else {
    await persistRetail(sb, productId, {
      ebay_sync_status: "withdrawn",
      ebay_last_error: null,
      ebay_listing_id: null,
      ebay_offer_id: null,
    });
  }

  return { ok: true, sku, offerId, listingKind };
}

async function deactivateAllListings(
  sb: SupabaseClient,
  token: string,
  productId: string,
  lotSize: number,
): Promise<Record<string, unknown>> {
  const retail = await deactivateListing(sb, token, productId, "retail", lotSize);
  const lot = await deactivateListing(sb, token, productId, "lot", lotSize);
  return {
    ok: !!(retail.ok && lot.ok),
    retail,
    lot,
    skipped: !!(retail.skipped && lot.skipped),
  };
}

async function loadWholesaleSyncPlan(
  sb: SupabaseClient,
  lotSize: number,
): Promise<{ eligibleIds: string[]; withdrawRetailIds: string[]; withdrawLotIds: string[] }> {
  const { data: eligible } = await sb
    .from("products")
    .select("id")
    .eq("active", true)
    .gte("stock", lotSize);
  const eligibleIds = (eligible || []).map((r: { id: string }) => String(r.id));
  const eligibleSet = new Set(eligibleIds);

  const { data: activeRetail } = await sb
    .from("products")
    .select("id, ebay_listing_id, ebay_offer_id");
  const withdrawRetailIds = (activeRetail || [])
    .filter((r: { ebay_listing_id?: string | null; ebay_offer_id?: string | null }) =>
      !!String(r.ebay_listing_id || "").trim() || !!String(r.ebay_offer_id || "").trim()
    )
    .map((r: { id: string }) => String(r.id));
  const { data: activeLots } = await sb
    .from("ebay_derived_listings")
    .select("product_id")
    .not("ebay_listing_id", "is", null)
    .neq("ebay_listing_id", "");

  return {
    eligibleIds,
    withdrawRetailIds,
    withdrawLotIds: (activeLots || [])
      .map((r: { product_id: string }) => String(r.product_id))
      .filter((id) => !eligibleSet.has(id)),
  };
}

async function runMonthlySync(
  sb: SupabaseClient,
  token: string,
  config: PublishConfig,
): Promise<Record<string, unknown>> {
  const batchSize = Math.max(5, Math.min(40, Number(env("EBAY_SYNC_BATCH_SIZE", "20")) || 20));
  const syncKey = new Date().toISOString().slice(0, 10);

  type SyncState = {
    syncKey: string;
    phase: "withdraw_retail" | "withdraw_lot" | "publish_lot" | "done";
    lotIds: string[];
    withdrawRetailIds: string[];
    withdrawLotIds: string[];
    lotIdx: number;
    withdrawRetailIdx: number;
    withdrawLotIdx: number;
    summary: Record<string, unknown>;
  };

  const emptySummary = () => ({
    lotSize: config.lot_size,
    syncKey,
    eligibleProducts: 0,
    retailWithdrawn: 0,
    lotPublished: 0,
    lotWithdrawn: 0,
    lotErrors: [] as string[],
    skippedLot: [] as string[],
    batches: 0,
  });

  const { data: cfgRow } = await sb.from("ebay_publish_config").select("sync_state").eq("id", "default")
    .maybeSingle();
  let state = (cfgRow?.sync_state || null) as SyncState | null;

  if (state?.syncKey === syncKey && state.phase === "done") {
    return {
      ...(state.summary || emptySummary()),
      phase: "done",
      done: true,
      skipped: true,
      reason: "Sync mayorista del día ya completado",
    };
  }

  if (!state || state.syncKey !== syncKey) {
    const plan = await loadWholesaleSyncPlan(sb, config.lot_size);
    state = {
      syncKey,
      phase: "withdraw_retail",
      lotIds: plan.eligibleIds,
      withdrawRetailIds: plan.withdrawRetailIds,
      withdrawLotIds: plan.withdrawLotIds,
      lotIdx: 0,
      withdrawRetailIdx: 0,
      withdrawLotIdx: 0,
      summary: { ...emptySummary(), eligibleProducts: plan.eligibleIds.length },
    };
  }

  const summary = state.summary as ReturnType<typeof emptySummary> & Record<string, unknown>;
  let processed = 0;

  while (processed < batchSize && state.phase !== "done") {
    if (state.phase === "withdraw_retail") {
      const id = state.withdrawRetailIds[state.withdrawRetailIdx];
      if (!id) {
        state.phase = "withdraw_lot";
        continue;
      }
      const res = await deactivateListing(sb, token, id, "retail", config.lot_size);
      if (res.ok && !res.skipped) summary.retailWithdrawn += 1;
      state.withdrawRetailIdx += 1;
      processed += 1;
      continue;
    }

    if (state.phase === "withdraw_lot") {
      const id = state.withdrawLotIds[state.withdrawLotIdx];
      if (!id) {
        state.phase = "publish_lot";
        continue;
      }
      const res = await deactivateListing(sb, token, id, "lot", config.lot_size);
      if (res.ok && !res.skipped) summary.lotWithdrawn += 1;
      state.withdrawLotIdx += 1;
      processed += 1;
      continue;
    }

    if (state.phase === "publish_lot") {
      const id = state.lotIds[state.lotIdx];
      if (!id) {
        state.phase = "done";
        continue;
      }
      const res = await publishListing(sb, token, id, "lot", config);
      if (res.ok && !res.skipped) summary.lotPublished += 1;
      else if (res.skipped) summary.skippedLot.push(`${id}: ${res.reason}`);
      else if (res.error) summary.lotErrors.push(`${id}: ${res.error}`);
      state.lotIdx += 1;
      processed += 1;
    }
  }

  summary.batches = Number(summary.batches || 0) + 1;
  state.summary = summary;

  const done = state.phase === "done";
  await sb.from("ebay_publish_config").update({
    sync_state: state,
    last_monthly_run_summary: summary,
    ...(done
      ? {
        last_monthly_run_at: new Date().toISOString(),
        sync_state: { ...state, phase: "done" },
      }
      : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", "default");

  return {
    ...summary,
    phase: state.phase,
    done,
    processedThisBatch: processed,
    progress: {
      withdrawRetail: `${state.withdrawRetailIdx}/${state.withdrawRetailIds.length}`,
      withdrawLot: `${state.withdrawLotIdx}/${state.withdrawLotIds.length}`,
      publishLot: `${state.lotIdx}/${state.lotIds.length}`,
    },
  };
}

async function runRepublishAll(
  sb: SupabaseClient,
  token: string,
  config: PublishConfig,
  offset = 0,
): Promise<Record<string, unknown>> {
  const batchSize = Math.max(5, Math.min(40, Number(env("EBAY_SYNC_BATCH_SIZE", "20")) || 20));
  const plan = await loadWholesaleSyncPlan(sb, config.lot_size);

  const jobs: Array<{ type: "withdraw_retail" | "withdraw_lot" | "publish_lot"; productId: string }> = [
    ...plan.withdrawRetailIds.map((productId) => ({ type: "withdraw_retail" as const, productId })),
    ...plan.withdrawLotIds.map((productId) => ({ type: "withdraw_lot" as const, productId })),
    ...plan.eligibleIds.map((productId) => ({ type: "publish_lot" as const, productId })),
  ];

  const slice = jobs.slice(offset, offset + batchSize);
  const results: Array<Record<string, unknown>> = [];
  let published = 0;
  let withdrawnRetail = 0;
  let withdrawnLot = 0;
  let skipped = 0;
  let errors = 0;

  for (const job of slice) {
    const res = job.type === "withdraw_retail"
      ? await deactivateListing(sb, token, job.productId, "retail", config.lot_size)
      : job.type === "withdraw_lot"
      ? await deactivateListing(sb, token, job.productId, "lot", config.lot_size)
      : await publishListing(sb, token, job.productId, "lot", config);
    if (res.ok && !res.skipped) {
      if (job.type === "publish_lot") published += 1;
    } else if (res.skipped) {
      skipped += 1;
    } else {
      errors += 1;
    }
    if (res.ok && !res.skipped && job.type === "withdraw_retail") {
      withdrawnRetail += 1;
    }
    if (res.ok && !res.skipped && job.type === "withdraw_lot") {
      withdrawnLot += 1;
    }
    results.push({ productId: job.productId, jobType: job.type, ...res });
  }

  const nextOffset = offset + slice.length;
  return {
    ok: true,
    action: "republish_all",
    total: jobs.length,
    offset,
    processed: slice.length,
    nextOffset,
    done: nextOffset >= jobs.length,
    eligibleProducts: plan.eligibleIds.length,
    published,
    withdrawnRetail,
    withdrawnLot,
    skipped,
    errors,
    results,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }

  const productId = String(body.productId || "").trim();
  const action = body.action === "deactivate"
    ? "deactivate"
    : body.action === "account_setup"
    ? "account_setup"
    : body.action === "monthly_sync"
    ? "monthly_sync"
    : body.action === "republish_all"
    ? "republish_all"
    : "publish";
  const listingKind: ListingKind = body.listingKind === "retail" ? "retail" : "lot";

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const config = await loadPublishConfig(sb);

  if (action === "account_setup") {
    const token = await getValidAccessToken(sb);
    if (!token) {
      return json({ ok: false, error: "Sin access token. Completa OAuth (refresh token en ebay_oauth_tokens)." }, 401);
    }
    const setup = await runAccountSetup(token);
    return json(setup, setup.ok ? 200 : 400);
  }

  if (action === "monthly_sync") {
    const headerSecret = req.headers.get("x-ebay-cron-secret") || "";
    const bodySecret = String(body.cronSecret || "").trim();
    const secret = bodySecret || headerSecret;
    if (!config.cron_secret || secret !== config.cron_secret) {
      return json({ ok: false, error: "cronSecret inválido" }, 403);
    }
    if (!config.auto_sync_enabled) {
      return json({ ok: true, skipped: true, reason: "auto_sync_enabled=false" });
    }

    const token = await getValidAccessToken(sb);
    const fulfillment = env("EBAY_FULFILLMENT_POLICY_ID");
    const payment = env("EBAY_PAYMENT_POLICY_ID");
    const ret = env("EBAY_RETURN_POLICY_ID");
    const location = env("EBAY_MERCHANT_LOCATION_KEY");
    if (!token || !fulfillment || !payment || !ret || !location) {
      return json({
        ok: true,
        dryRun: true,
        message: "Faltan token OAuth o políticas eBay para monthly_sync",
      });
    }

    const summary = await runMonthlySync(sb, token, config);
    return json({
      ok: true,
      action: "monthly_sync",
      batched: true,
      ...summary,
      config: {
        monthly_top_n: config.monthly_top_n,
        lot_top_n: config.lot_top_n,
        lot_size: config.lot_size,
        best_offer_enabled: config.best_offer_enabled,
      },
    });
  }

  if (action === "republish_all") {
    const headerSecret = req.headers.get("x-ebay-cron-secret") || "";
    const bodySecret = String(body.cronSecret || "").trim();
    const secret = bodySecret || headerSecret;
    if (!config.cron_secret || secret !== config.cron_secret) {
      return json({ ok: false, error: "cronSecret inválido" }, 403);
    }

    const token = await getValidAccessToken(sb);
    const fulfillment = env("EBAY_FULFILLMENT_POLICY_ID");
    const payment = env("EBAY_PAYMENT_POLICY_ID");
    const ret = env("EBAY_RETURN_POLICY_ID");
    const location = env("EBAY_MERCHANT_LOCATION_KEY");
    if (!token || !fulfillment || !payment || !ret || !location) {
      return json({
        ok: false,
        error: "Faltan token OAuth o políticas eBay para republish_all",
      }, 400);
    }

    const offset = Math.max(0, Number(body.offset || 0) || 0);
    const summary = await runRepublishAll(sb, token, config, offset);
    return json(summary);
  }

  if (!productId) return json({ ok: false, error: "productId requerido" }, 400);

  const token = await getValidAccessToken(sb);
  const fulfillment = env("EBAY_FULFILLMENT_POLICY_ID");
  const payment = env("EBAY_PAYMENT_POLICY_ID");
  const ret = env("EBAY_RETURN_POLICY_ID");
  const location = env("EBAY_MERCHANT_LOCATION_KEY");
  const missingPolicies = !fulfillment || !payment || !ret || !location;

  if (!token || missingPolicies) {
    const skuHint = productId ? productId.slice(0, 8) : "";
    return json({
      ok: true,
      dryRun: true,
      productId,
      sku: skuHint,
      marketplaceId: marketplaceId(),
      message: !token
        ? "Configura EBAY_CLIENT_ID, EBAY_CLIENT_SECRET y EBAY_REFRESH_TOKEN (OAuth Authorization Code; scope sell.inventory)."
        : "Faltan políticas eBay US: EBAY_FULFILLMENT_POLICY_ID, EBAY_PAYMENT_POLICY_ID, EBAY_RETURN_POLICY_ID, EBAY_MERCHANT_LOCATION_KEY.",
    });
  }

  if (action === "deactivate") {
    if (!body.listingKind) {
      const both = await deactivateAllListings(sb, token, productId, config.lot_size);
      if (!both.ok) return json({ ok: false, ...both }, 400);
      return json({ ok: true, action: "deactivate", ...both });
    }
    const res = await deactivateListing(sb, token, productId, listingKind, config.lot_size);
    if (!res.ok) return json({ ok: false, error: res.error, ...res }, 400);
    return json({ ok: true, action: "deactivate", ...res });
  }

  const res = await publishListing(sb, token, productId, listingKind, config);
  if (!res.ok) return json({ ok: false, error: res.error, ...res }, 400);
  if (res.skipped) return json({ ok: true, skipped: true, ...res });

  return json({
    ok: true,
    dryRun: false,
    productId,
    ...res,
    marketplaceId: marketplaceId(),
    bestOfferEnabled: config.best_offer_enabled,
  });
});
