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
 * Scopes mínimos:
 *   https://api.ebay.com/oauth/api_scope/sell.inventory
 *   https://api.ebay.com/oauth/api_scope/sell.account
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

type Body = { productId?: string; action?: "publish" | "deactivate" };

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

async function suggestCategoryId(token: string, title: string): Promise<string> {
  const fromEnv = env("EBAY_DEFAULT_CATEGORY_ID");
  if (fromEnv) return fromEnv;
  const treeRes = await ebayJson(
    token,
    "GET",
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(marketplaceId())}`,
  );
  const treeId =
    treeRes.data && typeof treeRes.data === "object"
      ? String((treeRes.data as { categoryTreeId?: string }).categoryTreeId || "")
      : "";
  if (!treeId) return "";
  const q = encodeURIComponent(title.slice(0, 200));
  const sug = await ebayJson(
    token,
    "GET",
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${q}`,
  );
  const hits =
    sug.data && typeof sug.data === "object"
      ? (sug.data as { categorySuggestions?: Array<{ category?: { categoryId?: string } }> })
        .categorySuggestions
      : [];
  return hits?.[0]?.category?.categoryId || "";
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
  if (!productId) return json({ ok: false, error: "productId requerido" }, 400);
  const action = body.action === "deactivate" ? "deactivate" : "publish";

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

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
  const categoryId = await suggestCategoryId(token, title);
  if (!categoryId) {
    return json({
      ok: true,
      dryRun: true,
      message: "Sin categoría: define EBAY_DEFAULT_CATEGORY_ID o permite Taxonomy (get_category_suggestions).",
    });
  }

  const inventoryItem = {
    availability: { shipToLocationAvailability: { quantity: qty } },
    condition: "NEW",
    product: {
      title,
      description: description.slice(0, 4000) || title,
      aspects: {
        Brand: [env("EBAY_BRAND", "EON")],
        Size: [String(sizeLabel).slice(0, 65)],
        Color: [String(colorLabel).slice(0, 65)],
      },
      ...(images.length ? { imageUrls: images } : {}),
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
