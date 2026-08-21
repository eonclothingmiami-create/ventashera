/**
 * Importa pedidos ML / Faire / eBay → ventas_catalogo.
 * POST { action: "sync_all" | "sync_faire" | "sync_mercadolibre" | "sync_ebay", limit?: number }
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getTrmSnapshot } from "../_shared/cop_usd_fx.ts";
import {
  lookupProductBySku,
  mapEbayOrderStatus,
  mapFaireState,
  mapMlOrderStatus,
  usdToCop,
  upsertMarketplaceSale,
} from "../_shared/marketplace_orders.ts";
import {
  ebayApiHost,
  ebayReauthPath,
  ensureEbayAccessToken,
  isEbayInvalidAccessTokenError,
} from "../_shared/ebay_oauth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

async function enrichItem(
  sb: SupabaseClient,
  sku: string,
  name: string,
  qty: number,
  unitPrice: number,
  extra: Record<string, unknown> = {},
) {
  const hit = await lookupProductBySku(sb, sku);
  const extraPid = typeof extra.productId === "string" ? extra.productId.trim() : "";
  const rest = { ...extra };
  delete rest.productId;
  return {
    productId: extraPid || hit?.id || null,
    ref: hit?.ref || sku,
    name: name || sku,
    qty,
    price: unitPrice,
    ...rest,
  };
}

function faireHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-FAIRE-ACCESS-TOKEN": token,
  };
  const appId = env("FAIRE_APPLICATION_ID");
  const appSecret = env("FAIRE_APPLICATION_SECRET");
  if (appId && appSecret) {
    headers["X-FAIRE-APP-CREDENTIALS"] = btoa(`${appId}:${appSecret}`);
    headers["X-FAIRE-OAUTH-ACCESS-TOKEN"] = token;
    delete headers["X-FAIRE-ACCESS-TOKEN"];
  }
  return headers;
}

async function syncFaire(sb: SupabaseClient, limit: number) {
  const token = env("FAIRE_ACCESS_TOKEN");
  if (!token) return { ok: false, error: "missing_FAIRE_ACCESS_TOKEN", synced: 0 };

  const res = await fetch(`https://www.faire.com/external-api/v2/orders?limit=${limit}&page=1`, {
    headers: faireHeaders(token),
  });
  const data = await res.json().catch(() => ({})) as { orders?: Array<Record<string, unknown>> };
  if (!res.ok) return { ok: false, error: "faire_http", status: res.status, detail: data, synced: 0 };

  const trm = await getTrmSnapshot(4000);
  const orders = data.orders || [];
  const results: Array<Record<string, unknown>> = [];

  for (const order of orders) {
    const orderId = String(order.id || "").trim();
    if (!orderId) continue;
    const retailer = (order.retailer || {}) as Record<string, unknown>;
    const addr = (order.address || order.ship_after_address || {}) as Record<string, unknown>;
    const rawItems = Array.isArray(order.items) ? order.items as Array<Record<string, unknown>> : [];
    const items = [];
    let usdTotal = 0;
    for (const it of rawItems) {
      const qty = Math.max(1, Number(it.quantity || it.inclusive_quantity || 1) || 1);
      const priceObj = (it.price || it.wholesale_price || {}) as Record<string, unknown>;
      const cents = Number(
        priceObj.amount_minor ?? it.wholesale_price_cents ?? it.price_cents ?? 0,
      ) || 0;
      const unitUsd = cents / 100;
      usdTotal += unitUsd * qty;
      const sku = String(it.sku || it.variant_sku || "").trim();
      items.push(await enrichItem(sb, sku, String(it.product_name || it.name || sku), qty, usdToCop(unitUsd, trm.copPerUsd), {
        color: it.color || "",
        size: it.size || "",
      }));
    }
    const payout = (order.payout_costs || order.price || {}) as Record<string, unknown>;
    const totalCents = Number(
      (payout as { total_cents?: number }).total_cents
      ?? (order as { retailer_total_cents?: number }).retailer_total_cents
      ?? 0,
    );
    if (totalCents > 0) usdTotal = totalCents / 100;

    const state = String(order.state || "");
    const sale = await upsertMarketplaceSale(sb, {
      origen: "faire",
      externalId: orderId,
      reference: `FAIRE-${orderId}`,
      estadoPago: mapFaireState(state),
      canalPago: "faire",
      clienteNombre: String(retailer.name || retailer.display_name || "Retailer Faire"),
      clienteEmail: String(retailer.email || ""),
      clienteTelefono: String(addr.phone_number || retailer.phone || ""),
      envioCiudad: String(addr.city || ""),
      envioDepartamento: String(addr.state || addr.province || ""),
      envioDireccion: [addr.address1, addr.address2, addr.postal_code].filter(Boolean).join(", "),
      items,
      amountCop: usdToCop(usdTotal, trm.copPerUsd),
      totales: {
        total: usdToCop(usdTotal, trm.copPerUsd),
        total_usd: Math.round(usdTotal * 100) / 100,
        currency: "USD",
        trm: trm.copPerUsd,
      },
      paymentStatusRaw: state,
      trackingMeta: { source: "marketplace-orders-sync", faire_order_id: orderId, faire_state: state },
    });

    await sb.from("faire_orders").upsert({
      faire_order_id: orderId,
      state,
      retailer_name: String(retailer.name || "") || null,
      payload: order,
      updated_at: new Date().toISOString(),
    }, { onConflict: "faire_order_id" });

    results.push(sale);
  }

  return { ok: true, synced: results.length, fetched: orders.length, results };
}

async function mlToken(sb: SupabaseClient): Promise<string> {
  const envAccess = env("ML_ACCESS_TOKEN");
  const { data } = await sb.from("ml_oauth_tokens").select("access_token, refresh_token, expires_at").eq("id", "default").maybeSingle();
  const exp = data?.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (data?.access_token && exp > Date.now() + 60_000) return String(data.access_token);
  const refresh = String(data?.refresh_token || env("ML_REFRESH_TOKEN") || "").trim();
  const clientId = env("ML_CLIENT_ID");
  const clientSecret = env("ML_CLIENT_SECRET");
  if (refresh && clientId && clientSecret) {
    const res = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
      }),
    });
    const j = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (j.access_token) {
      await sb.from("ml_oauth_tokens").upsert({
        id: "default",
        access_token: j.access_token,
        refresh_token: j.refresh_token || refresh,
        expires_at: new Date(Date.now() + Math.max(60, Number(j.expires_in) || 21600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });
      return j.access_token;
    }
  }
  return String(data?.access_token || envAccess || "");
}

async function syncMercadoLibre(sb: SupabaseClient, limit: number) {
  const token = await mlToken(sb);
  if (!token) return { ok: false, error: "missing_ml_token", synced: 0 };

  const meRes = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const me = await meRes.json() as { id?: number };
  if (!meRes.ok || !me.id) return { ok: false, error: "ml_users_me_failed", detail: me, synced: 0 };

  const searchUrls = [
    `https://api.mercadolibre.com/orders/search?sort=date_desc&limit=${Math.min(limit, 50)}`,
    `https://api.mercadolibre.com/orders/search?seller=${me.id}&order.status=paid&sort=date_desc&limit=${Math.min(limit, 50)}`,
    `https://api.mercadolibre.com/orders/search?seller=${me.id}&sort=date_desc&limit=${Math.min(limit, 50)}`,
  ];
  let search: { results?: Array<Record<string, unknown>>; code?: string; message?: string } = {};
  let searchRes: Response | null = null;
  for (const url of searchUrls) {
    searchRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    search = await searchRes.json() as typeof search;
    if (searchRes.ok) break;
  }
  if (!searchRes?.ok) {
    return {
      ok: false,
      error: "ml_orders_search_failed",
      detail: search,
      hint: "En Developers de Mercado Libre activa el caso de uso de consultar órdenes/ventas y vuelve a autorizar la app (scope read).",
      synced: 0,
    };
  }

  const results: Array<Record<string, unknown>> = [];
  for (const order of search.results || []) {
    const orderId = String(order.id || "").trim();
    if (!orderId) continue;
    const buyer = (order.buyer || {}) as Record<string, unknown>;
    const shipping = (order.shipping || {}) as Record<string, unknown>;
    const receiver = (shipping.receiver_address || {}) as Record<string, unknown>;
    const buyerPhone = (buyer.phone && typeof buyer.phone === "object")
      ? buyer.phone as Record<string, unknown>
      : {};
    const rawItems = Array.isArray(order.order_items) ? order.order_items as Array<Record<string, unknown>> : [];
    const items = [];
    for (const it of rawItems) {
      const item = (it.item || {}) as Record<string, unknown>;
      const qty = Math.max(1, Number(it.quantity) || 1);
      const unit = Number(it.unit_price || it.full_unit_price || 0) || 0;
      const sku = String(item.seller_sku || item.seller_custom_field || "").trim();
      const mlItemId = String(item.id || "").trim();
      let productId: string | null = null;
      let ref = sku;
      if (mlItemId) {
        const { data: byMl } = await sb.from("products").select("id, ref").eq("mercadolibre_item_id", mlItemId).maybeSingle();
        if (byMl?.id) {
          productId = String(byMl.id);
          ref = String(byMl.ref || sku);
        }
      }
      const enriched = await enrichItem(sb, sku || ref, String(item.title || sku), qty, unit, { productId });
      items.push(enriched);
    }
    const total = Number(order.total_amount) || items.reduce((a, it) => a + Number(it.price) * Number(it.qty), 0);
    const status = String(order.status || "");
    const sale = await upsertMarketplaceSale(sb, {
      origen: "mercadolibre",
      externalId: orderId,
      reference: `ML-${orderId}`,
      estadoPago: mapMlOrderStatus(status),
      canalPago: "mercadolibre",
      clienteNombre: String(buyer.nickname || buyer.first_name || "Comprador ML"),
      clienteEmail: String(buyer.email || ""),
      clienteTelefono: String(buyerPhone.number || receiver.receiver_phone || ""),
      envioCiudad: String(asRec(receiver.city).name || ""),
      envioDepartamento: String(asRec(receiver.state).name || ""),
      envioDireccion: String(receiver.address_line || ""),
      items,
      amountCop: total,
      totales: { total, currency: "COP" },
      paymentStatusRaw: status,
      trackingMeta: { source: "marketplace-orders-sync", ml_order_id: orderId, ml_status: status },
    });
    results.push(sale);
  }
  return { ok: true, synced: results.length, fetched: (search.results || []).length, results };
}

async function syncEbay(sb: SupabaseClient, limit: number) {
  const auth = await ensureEbayAccessToken(sb);
  if (!auth.ok) {
    return {
      ok: false,
      error: auth.needsReauth ? "ebay_reauth_required" : "missing_ebay_token",
      needs_reauth: auth.needsReauth,
      event: auth.event,
      detail: auth.error,
      hint: `Reautoriza eBay: ${ebayReauthPath()}`,
      synced: 0,
    };
  }

  let token = auth.accessToken;
  const ordersUrl =
    `${ebayApiHost()}/sell/fulfillment/v1/order?limit=${Math.min(limit, 50)}`;

  async function fetchOrders(bearer: string) {
    const res = await fetch(ordersUrl, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
    });
    const data = await res.json().catch(() => ({})) as {
      orders?: Array<Record<string, unknown>>;
      errors?: unknown;
    };
    return { res, data };
  }

  let { res, data } = await fetchOrders(token);
  if (isEbayInvalidAccessTokenError(res.status, data)) {
    const refreshed = await ensureEbayAccessToken(sb, { forceRefresh: true });
    if (refreshed.ok) {
      token = refreshed.accessToken;
      ({ res, data } = await fetchOrders(token));
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      error: "ebay_orders_failed",
      status: res.status,
      hint: `Reautoriza eBay con scope sell.fulfillment: ${ebayReauthPath()}`,
      detail: data,
      synced: 0,
    };
  }

  const trm = await getTrmSnapshot(4000);
  const results: Array<Record<string, unknown>> = [];
  for (const order of data.orders || []) {
    const orderId = String(order.orderId || "").trim();
    if (!orderId) continue;
    const pricing = (order.pricingSummary || {}) as Record<string, unknown>;
    const totalObj = (pricing.total || {}) as Record<string, unknown>;
    const usd = Number(totalObj.value) || 0;
    const currency = String(totalObj.currency || "USD");
    const buyer = (order.buyer || {}) as Record<string, unknown>;
    const instr = Array.isArray(order.fulfillmentStartInstructions)
      ? order.fulfillmentStartInstructions[0] as Record<string, unknown>
      : {};
    const shipTo = ((instr.shippingStep as Record<string, unknown> | undefined)?.shipTo || {}) as Record<string, unknown>;
    const addr = (shipTo.contactAddress || {}) as Record<string, unknown>;
    const phone = (shipTo.primaryPhone || {}) as Record<string, unknown>;
    const rawItems = Array.isArray(order.lineItems) ? order.lineItems as Array<Record<string, unknown>> : [];
    const items = [];
    for (const it of rawItems) {
      const qty = Math.max(1, Number(it.quantity) || 1);
      const cost = (it.lineItemCost || it.total || {}) as Record<string, unknown>;
      const lineUsd = Number(cost.value) || 0;
      const unitUsd = lineUsd / qty;
      const sku = String(it.sku || "").trim();
      items.push(await enrichItem(
        sb,
        sku,
        String(it.title || sku),
        qty,
        currency === "USD" ? usdToCop(unitUsd, trm.copPerUsd) : unitUsd,
      ));
    }
    const amountCop = currency === "USD" ? usdToCop(usd, trm.copPerUsd) : usd;
    const sale = await upsertMarketplaceSale(sb, {
      origen: "ebay",
      externalId: orderId,
      reference: `EBAY-${orderId}`,
      estadoPago: mapEbayOrderStatus(
        String(order.orderPaymentStatus || ""),
        String(order.cancelStatus || ""),
        String(order.orderFulfillmentStatus || ""),
      ),
      canalPago: "ebay",
      clienteNombre: String(shipTo.fullName || buyer.username || "Comprador eBay"),
      clienteEmail: "",
      clienteTelefono: String(phone.phoneNumber || ""),
      envioCiudad: String(addr.city || ""),
      envioDepartamento: String(addr.stateOrProvince || ""),
      envioDireccion: [addr.addressLine1, addr.addressLine2, addr.postalCode].filter(Boolean).join(", "),
      items,
      amountCop,
      totales: { total: amountCop, total_usd: usd, currency, trm: trm.copPerUsd },
      paymentStatusRaw: String(order.orderPaymentStatus || order.orderFulfillmentStatus || ""),
      trackingMeta: { source: "marketplace-orders-sync", ebay_order_id: orderId },
    });
    results.push(sale);
  }
  return { ok: true, synced: results.length, fetched: (data.orders || []).length, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = String(body.action || "sync_all").trim();
  const limit = Math.min(50, Math.max(1, Number(body.limit) || 30));

  try {
    if (action === "sync_faire") return json({ ok: true, faire: await syncFaire(sb, limit) });
    if (action === "sync_mercadolibre") return json({ ok: true, mercadolibre: await syncMercadoLibre(sb, limit) });
    if (action === "sync_ebay") return json({ ok: true, ebay: await syncEbay(sb, limit) });
    if (action !== "sync_all") return json({ ok: false, error: "unknown_action" }, 400);

    const faire = await syncFaire(sb, limit);
    const mercadolibre = await syncMercadoLibre(sb, limit);
    const ebay = await syncEbay(sb, limit);
    const synced = Number(faire.synced || 0) + Number(mercadolibre.synced || 0) + Number(ebay.synced || 0);
    return json({
      ok: true,
      synced,
      faire,
      mercadolibre,
      ebay,
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
