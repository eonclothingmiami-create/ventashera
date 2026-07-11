/**
 * WooCommerce → ventas_catalogo
 * - Webhook POST (order.created / order.updated) con body WooCommerce
 * - Sync manual POST { action: 'sync', order_id: 123 } o { action: 'sync_recent', limit: 20 }
 *
 * Secrets: WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET
 * Optional: WOOCOMMERCE_WEBHOOK_SECRET (header x-wc-webhook-signature HMAC-SHA256 base64)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  mapWooCommerceStatus,
  normalizeItems,
} from "../_shared/ventas_catalogo_map.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wc-webhook-signature",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type WcOrder = Record<string, unknown>;
type WcLineItem = Record<string, unknown>;

function wcBaseUrl(): string {
  return String(
    Deno.env.get("WOOCOMMERCE_URL") || Deno.env.get("WC_API_URL") || "",
  ).replace(/\/$/, "");
}

function wcAuthHeader(): string {
  const key = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY") ||
    Deno.env.get("WC_CONSUMER_KEY") || "";
  const secret = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET") ||
    Deno.env.get("WC_CONSUMER_SECRET") || "";
  const token = btoa(`${key}:${secret}`);
  return `Basic ${token}`;
}

async function fetchWcOrder(orderId: number): Promise<WcOrder | null> {
  const base = wcBaseUrl();
  if (!base) throw new Error("WOOCOMMERCE_URL not configured");
  const res = await fetch(`${base}/wp-json/wc/v3/orders/${orderId}`, {
    headers: { Authorization: wcAuthHeader(), Accept: "application/json" },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`WC API ${res.status}: ${t.slice(0, 200)}`);
  }
  return await res.json();
}

async function fetchWcRecentOrders(limit: number): Promise<WcOrder[]> {
  const base = wcBaseUrl();
  if (!base) throw new Error("WOOCOMMERCE_URL not configured");
  const res = await fetch(
    `${base}/wp-json/wc/v3/orders?per_page=${Math.min(limit, 50)}&orderby=date&order=desc`,
    { headers: { Authorization: wcAuthHeader(), Accept: "application/json" } },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`WC API list ${res.status}: ${t.slice(0, 200)}`);
  }
  return await res.json();
}

async function mapLineItems(
  sb: ReturnType<typeof createClient>,
  lineItems: WcLineItem[],
) {
  const items: Record<string, unknown>[] = [];
  for (const li of lineItems) {
    const sku = String(li.sku || "").trim();
    const wcProductId = Number(li.product_id) || 0;
    let productId: string | null = null;
    let ref = sku;

    if (wcProductId > 0) {
      const { data: byWc } = await sb.from("products")
        .select("id, ref")
        .eq("woocommerce_product_id", wcProductId)
        .maybeSingle();
      if (byWc?.id) {
        productId = byWc.id;
        ref = byWc.ref || sku;
      }
    }
    if (!productId && sku) {
      const { data: byRef } = await sb.from("products")
        .select("id, ref")
        .eq("ref", sku)
        .maybeSingle();
      if (byRef?.id) {
        productId = byRef.id;
        ref = byRef.ref || sku;
      }
    }

    items.push({
      productId,
      ref,
      name: li.name || "",
      qty: Math.max(1, Number(li.quantity) || 1),
      price: Number(li.total) / Math.max(1, Number(li.quantity) || 1) || 0,
      size: "",
      color: "",
      wc_line_item_id: li.id,
      wc_product_id: wcProductId,
    });
  }
  return normalizeItems(items);
}

async function upsertWcOrder(
  sb: ReturnType<typeof createClient>,
  order: WcOrder,
): Promise<{ id: string; reference: string; created: boolean; estado_pago: string }> {
  const wcId = Number(order.id);
  const reference = `WC-${wcId}`;
  const externalOrderId = String(wcId);
  const estadoPago = mapWooCommerceStatus(String(order.status || ""));
  const billing = (order.billing || {}) as Record<string, unknown>;
  const shipping = (order.shipping || {}) as Record<string, unknown>;
  const lineItems = Array.isArray(order.line_items)
    ? (order.line_items as WcLineItem[])
    : [];
  const items = await mapLineItems(sb, lineItems);
  const amountCop = Number(order.total) || 0;
  const now = new Date().toISOString();

  const rowBase = {
    reference,
    estado_pago: estadoPago,
    canal_pago: String(order.payment_method_title || order.payment_method || "woocommerce"),
    catalog_type: null,
    origen_canal: "woocommerce",
    external_order_id: externalOrderId,
    cliente_nombre: [billing.first_name, billing.last_name].filter(Boolean).join(" ").trim(),
    cliente_email: String(billing.email || "").trim(),
    cliente_telefono: String(billing.phone || "").trim(),
    cliente_documento_tipo: "CC",
    cliente_documento: "",
    envio_departamento: String(shipping.state || billing.state || "").trim(),
    envio_ciudad: String(shipping.city || billing.city || "").trim(),
    envio_direccion: [
      shipping.address_1 || billing.address_1,
      shipping.address_2 || billing.address_2,
    ].filter(Boolean).join(", ").trim(),
    items,
    totales: {
      subtotal: order.total - (Number(order.shipping_total) || 0),
      shipping: Number(order.shipping_total) || 0,
      discount: Number(order.discount_total) || 0,
      total: amountCop,
      currency: order.currency || "COP",
    },
    amount_cop: amountCop,
    proveedor_ref: String(order.transaction_id || order.order_key || wcId),
    payment_status_raw: String(order.status || ""),
    payment_updated_at: now,
    tracking_meta: {
      wc_order_id: wcId,
      wc_status: order.status,
      wc_date_created: order.date_created,
      wc_date_modified: order.date_modified,
      synced_at: now,
      source: "woocommerce-order-webhook",
    },
  };

  const { data: existing } = await sb.from("ventas_catalogo")
    .select("id, estado_pago, pagado_at, pos_factura_id")
    .eq("reference", reference)
    .maybeSingle();

  if (existing?.id) {
    const patch = {
      ...rowBase,
      pagado_at: estadoPago === "pago_exitoso"
        ? (existing.pagado_at || now)
        : null,
      pos_factura_id: existing.pos_factura_id,
      updated_at: now,
    };
    const { data, error } = await sb.from("ventas_catalogo")
      .update(patch)
      .eq("id", existing.id)
      .select("id, reference, estado_pago")
      .single();
    if (error) throw error;
    return { id: data.id, reference: data.reference, created: false, estado_pago: data.estado_pago };
  }

  const insertRow = {
    ...rowBase,
    pagado_at: estadoPago === "pago_exitoso" ? now : null,
    pos_factura_id: null,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await sb.from("ventas_catalogo")
    .insert(insertRow)
    .select("id, reference, estado_pago")
    .single();
  if (error) throw error;
  return { id: data.id, reference: data.reference, created: true, estado_pago: data.estado_pago };
}

async function verifyWebhookSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get("WOOCOMMERCE_WEBHOOK_SECRET") || "";
  if (!secret) return true;
  const sig = req.headers.get("x-wc-webhook-signature") || "";
  if (!sig) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return computed === sig;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  const rawBody = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = {};
  }

  const topic = req.headers.get("x-wc-webhook-topic") || "";

  if (topic.startsWith("order.") || (body.id && body.line_items)) {
    const okSig = await verifyWebhookSignature(req, rawBody);
    if (!okSig) return json({ ok: false, error: "Invalid webhook signature" }, 401);
    try {
      const result = await upsertWcOrder(sb, body as WcOrder);
      return json({ ok: true, webhook: topic || "order", ...result });
    } catch (e) {
      console.error("[woocommerce-order-webhook]", e);
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  }

  if (req.method === "POST") {
    const auth = req.headers.get("authorization") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const authed = token && (token === service || token === anon || token.length > 20);
    if (!authed) return json({ ok: false, error: "Unauthorized" }, 401);

    const action = String(body.action || "sync").trim();

    try {
      if (action === "sync_recent") {
        const limit = Math.min(Number(body.limit) || 20, 50);
        const orders = await fetchWcRecentOrders(limit);
        const results = [];
        for (const o of orders) {
          results.push(await upsertWcOrder(sb, o));
        }
        return json({ ok: true, synced: results.length, results });
      }

      const orderId = Number(body.order_id ?? body.orderId);
      if (!orderId) {
        return json({ ok: false, error: "order_id required" }, 400);
      }
      const order = await fetchWcOrder(orderId);
      if (!order) return json({ ok: false, error: "Order not found" }, 404);
      const result = await upsertWcOrder(sb, order);
      return json({ ok: true, ...result });
    } catch (e) {
      console.error("[woocommerce-order-webhook sync]", e);
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
});
