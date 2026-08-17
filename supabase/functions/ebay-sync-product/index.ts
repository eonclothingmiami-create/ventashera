/**
 * Edge Function: ebay-sync-product (V1)
 *
 * Publica / actualiza / retira un producto del ERP en eBay US usando Sell Inventory API
 * (REST actual; no Trading XML).
 *
 * Docs oficiales:
 * - Integrar app: https://developer.ebay.com/api-docs/static/gs_integrate-an-application-with-ebay.html
 * - OAuth: https://developer.ebay.com/api-docs/static/oauth-tokens.html
 * - Scopes: https://developer.ebay.com/api-docs/static/oauth-scopes.html
 * - Inventory: https://developer.ebay.com/api-docs/sell/inventory/overview.html
 * - Taxonomy: https://developer.ebay.com/api-docs/commerce/taxonomy/overview.html
 * - Account (políticas): https://developer.ebay.com/api-docs/sell/account/overview.html
 *
 * Flujo oficial V1:
 *   PUT  /sell/inventory/v1/inventory_item/{sku}
 *   POST /sell/inventory/v1/offer  (o PUT offer/{offerId} si ya existe)
 *   POST /sell/inventory/v1/offer/{offerId}/publish
 * Retiro: POST /sell/inventory/v1/offer/{offerId}/withdraw  (body.action = deactivate)
 *
 * OAuth: Authorization Code Grant + refresh token. client_credentials NO escribe inventario.
 * Auth’n’Auth (ebaytkn / tknexp) NO sirve. Consentir en:
 *   https://auth.ebay.com/oauth2/authorize
 *   redirect_uri = RuName (EBAY_RUNAME), no la URL https.
 * Intercambio code → refresh: Edge Function ebay-oauth-exchange
 * Scopes mínimos:
 *   https://api.ebay.com/oauth/api_scope/sell.inventory
 *   https://api.ebay.com/oauth/api_scope/sell.account
 *   EBAY_RUNAME — default Hera_Swimwear-HeraSwim-HeraSw-bndiaam
 *
 * Secrets (Supabase → Edge Functions) — nunca en el frontend:
 *   EBAY_CLIENT_ID / EBAY_CLIENT_SECRET — App keys del Developer Program
 *   EBAY_REFRESH_TOKEN — del consentimiento del vendedor (o fila ebay_oauth_tokens)
 *   EBAY_ACCESS_TOKEN — opcional si aún no caducó
 *   EBAY_MARKETPLACE_ID — default EBAY_US
 *   EBAY_API_BASE — default https://api.ebay.com  (sandbox: https://api.sandbox.ebay.com)
 *   EBAY_FULFILLMENT_POLICY_ID
 *   EBAY_PAYMENT_POLICY_ID
 *   EBAY_RETURN_POLICY_ID
 *   EBAY_MERCHANT_LOCATION_KEY
 *   EBAY_DEFAULT_CATEGORY_ID — categoría US (ropa); si vacío se usa Taxonomy suggestions
 *   EBAY_BRAND — default EON
 *   EBAY_DEFAULT_SIZE / EBAY_DEFAULT_COLOR — aspectos moda si el ERP no tiene talla/color
 *   EBAY_COP_PER_USD — default 4000 (precio ERP COP → USD)
 *   EBAY_PRICE_USD_MARKUP — multiplicador opcional (default 1)
 *
 * Body: { productId: uuid, action?: "publish" | "deactivate" }
 * Sin secrets/políticas → { ok: true, dryRun: true } (no llama a eBay).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOKEN_BUFFER_MS = 5 * 60 * 1000;
const INVENTORY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account";

type Body = { productId?: string; action?: "publish" | "deactivate" | "account_setup" };

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

function priceUsdFromCop(cop: number): string {
  const rate = Number(env("EBAY_COP_PER_USD", "4000")) || 4000;
  const markup = Number(env("EBAY_PRICE_USD_MARKUP", "1")) || 1;
  const usd = (cop / rate) * markup;
  return Math.max(0.99, Math.round(usd * 100) / 100).toFixed(2);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

async function getValidAccessToken(
  sb: SupabaseClient,
): Promise<string> {
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
    aspects[name] = [pickAspectValue(title, values, secret)];
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

async function runAccountSetup(
  token: string,
): Promise<Record<string, unknown>> {
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
    const publicUrl =
      `${supabaseUrl}/storage/v1/object/public/Catalog-media/${path}`;
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

async function persistEbay(
  sb: SupabaseClient,
  productId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.from("products").update({
    ...patch,
    ebay_last_sync_at: new Date().toISOString(),
  }).eq("id", productId);
  if (error) console.warn("[ebay-sync-product] persist:", error.message);
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
    : "publish";

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (action === "account_setup") {
    const token = await getValidAccessToken(sb);
    if (!token) {
      return json({ ok: false, error: "Sin access token. Completa OAuth (refresh token en ebay_oauth_tokens)." }, 401);
    }
    const setup = await runAccountSetup(token);
    return json(setup, setup.ok ? 200 : 400);
  }

  if (!productId) return json({ ok: false, error: "productId requerido" }, 400);

  const { data: product, error: pErr } = await sb
    .from("products")
    .select("id, ref, name, description, price, stock, active, ebay_listing_id, ebay_offer_id, ebay_sku")
    .eq("id", productId)
    .maybeSingle();
  if (pErr || !product) {
    return json({ ok: false, error: pErr?.message || "Producto no encontrado" }, 404);
  }
  const p = product as ProductRow;

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

  const sku = (p.ebay_sku && String(p.ebay_sku).trim()) || skuFromProduct(p);
  const fulfillment = env("EBAY_FULFILLMENT_POLICY_ID");
  const payment = env("EBAY_PAYMENT_POLICY_ID");
  const ret = env("EBAY_RETURN_POLICY_ID");
  const location = env("EBAY_MERCHANT_LOCATION_KEY");
  const token = await getValidAccessToken(sb);
  const missingPolicies = !fulfillment || !payment || !ret || !location;

  if (!token || missingPolicies) {
    return json({
      ok: true,
      dryRun: true,
      sku,
      marketplaceId: marketplaceId(),
      message: !token
        ? "Configura EBAY_CLIENT_ID, EBAY_CLIENT_SECRET y EBAY_REFRESH_TOKEN (OAuth Authorization Code; scope sell.inventory)."
        : "Faltan políticas eBay US: EBAY_FULFILLMENT_POLICY_ID, EBAY_PAYMENT_POLICY_ID, EBAY_RETURN_POLICY_ID, EBAY_MERCHANT_LOCATION_KEY.",
    });
  }

  if (action === "deactivate") {
    let offerId = (p.ebay_offer_id || "").trim();
    if (!offerId) {
      const listed = await ebayJson(token, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
      const offers =
        listed.data && typeof listed.data === "object"
          ? (listed.data as { offers?: Array<{ offerId?: string }> }).offers
          : [];
      offerId = offers?.[0]?.offerId || "";
    }
    if (!offerId) {
      return json({ ok: true, skipped: true, reason: "sin offerId para retirar" });
    }
    const withdrawn = await ebayJson(token, "POST", `/sell/inventory/v1/offer/${offerId}/withdraw`);
    if (!withdrawn.ok && withdrawn.status !== 404) {
      const msg = ebayErrorMessage(withdrawn.data, "eBay rechazó withdrawOffer");
      await persistEbay(sb, productId, { ebay_sync_status: "error", ebay_last_error: msg });
      return json({ ok: false, error: msg, ebay: withdrawn.data }, 400);
    }
    await persistEbay(sb, productId, {
      ebay_sync_status: "withdrawn",
      ebay_last_error: null,
    });
    return json({ ok: true, action: "deactivate", offerId, sku });
  }

  const title = String(p.name || "Product").slice(0, 80);
  const description = stripHtml(String(p.description || p.name || "Product"));
  const qty = Math.max(0, Math.floor(Number(p.stock) || 0));
  const priceUsd = priceUsdFromCop(Number(p.price) || 0);
  const suggested = await suggestCategoryId(token, title);
  const categoryId = suggested.categoryId;
  if (!categoryId) {
    return json({
      ok: true,
      dryRun: true,
      message: "Sin categoría: define EBAY_DEFAULT_CATEGORY_ID o permite Taxonomy (get_category_suggestions).",
    });
  }
  const taxToken = (await getApplicationToken()) || token;
  const aspects = await requiredAspects(
    taxToken,
    suggested.treeId,
    categoryId,
    title,
    String(sizeLabel),
    String(colorLabel),
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
    const msg = ebayErrorMessage(putItem.data, "eBay rechazó createOrReplaceInventoryItem");
    await persistEbay(sb, productId, { ebay_sku: sku, ebay_sync_status: "error", ebay_last_error: msg });
    return json({ ok: false, error: msg, ebay: putItem.data }, 400);
  }

  let offerId = (p.ebay_offer_id || "").trim();
  if (!offerId) {
    const listed = await ebayJson(token, "GET", `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
    const offers =
      listed.data && typeof listed.data === "object"
        ? (listed.data as { offers?: Array<{ offerId?: string; listing?: { listingId?: string } }> }).offers
        : [];
    offerId = offers?.[0]?.offerId || "";
  }

  const offerPayload = {
    sku,
    marketplaceId: marketplaceId(),
    format: "FIXED_PRICE",
    availableQuantity: qty,
    categoryId,
    listingDescription: description.slice(0, 4000) || title,
    listingPolicies: {
      fulfillmentPolicyId: fulfillment,
      paymentPolicyId: payment,
      returnPolicyId: ret,
    },
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
      await persistEbay(sb, productId, {
        ebay_sku: sku,
        ebay_offer_id: offerId,
        ebay_sync_status: "error",
        ebay_last_error: msg,
      });
      return json({ ok: false, error: msg, ebay: upd.data }, 400);
    }
  } else {
    const created = await ebayJson(token, "POST", "/sell/inventory/v1/offer", offerPayload);
    if (!created.ok) {
      const msg = ebayErrorMessage(created.data, "eBay rechazó createOffer");
      await persistEbay(sb, productId, { ebay_sku: sku, ebay_sync_status: "error", ebay_last_error: msg });
      return json({ ok: false, error: msg, ebay: created.data }, 400);
    }
    offerId = String(
      (created.data && typeof created.data === "object"
        ? (created.data as { offerId?: string }).offerId
        : "") || "",
    );
  }

  let listingId = (p.ebay_listing_id || "").trim();
  if (offerId && !listingId) {
    const pub = await ebayJson(
      token,
      "POST",
      `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    );
    if (!pub.ok) {
      const msg = ebayErrorMessage(pub.data, "eBay rechazó publishOffer");
      await persistEbay(sb, productId, {
        ebay_sku: sku,
        ebay_offer_id: offerId,
        ebay_sync_status: "error",
        ebay_last_error: msg,
      });
      return json({ ok: false, error: msg, ebay: pub.data }, 400);
    }
    listingId = String(
      (pub.data && typeof pub.data === "object"
        ? (pub.data as { listingId?: string }).listingId
        : "") || "",
    );
  }

  await persistEbay(sb, productId, {
    ebay_sku: sku,
    ebay_offer_id: offerId || null,
    ebay_listing_id: listingId || null,
    ebay_sync_status: listingId ? "published" : "offer",
    ebay_last_error: null,
  });

  return json({
    ok: true,
    dryRun: false,
    sku,
    offerId: offerId || null,
    listingId: listingId || null,
    categoryId,
    priceUsd,
    marketplaceId: marketplaceId(),
  });
});
