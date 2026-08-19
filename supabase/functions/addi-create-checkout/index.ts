/**
 * Addi checkout: config pública + creación de aplicación de crédito.
 *
 * POST action=config
 *   { requestedamount, ally_slug? }
 *
 * POST action=create (default)
 *   { reference, orderId?, amount_cop, customer, items, redirectionUrl, callbackUrl?, logoUrl? }
 *   Requiere pedido previo en ventas_catalogo (catalog-order-create).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { catalogOrderClientAuthOk } from "../_shared/catalog_order_auth.ts";
import {
  addiAllySlug,
  addiConfigured,
  createAddiOnlineApplication,
  defaultAddiCallbackUrl,
  fetchAddiAllyConfig,
  normalizePhone,
  removeAccents,
} from "../_shared/addi_client.ts";
import { normalizeCustomer, normalizeItems } from "../_shared/ventas_catalogo_map.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-catalog-order-secret",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = removeAccents(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "Cliente", lastName: "Addi" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function buildAddress(customer: Record<string, unknown>) {
  const lineOne = String(customer.envio_direccion || customer.address || customer.direccion || "").trim();
  const city = String(customer.envio_ciudad || customer.city || customer.ciudad || "").trim();
  if (!lineOne && !city) return undefined;
  return {
    lineOne: lineOne || city,
    city: city || lineOne,
    country: "CO",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }
  if (!await catalogOrderClientAuthOk(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const action = String(body.action || "create").trim().toLowerCase();

  if (action === "config") {
    const amount = Number(body.requestedamount ?? body.requestedAmount ?? body.amount_cop ?? 0) || 0;
    const slug = String(body.ally_slug ?? body.allySlug ?? addiAllySlug() ?? "").trim();
    if (!slug) {
      return json({ ok: false, error: "ADDI_ALLY_SLUG or ally_slug required" }, 400);
    }
    try {
      const config = await fetchAddiAllyConfig(amount, slug);
      if (!config) {
        return json({ ok: false, error: "Addi config unavailable" }, 502);
      }
      const inRange = amount >= config.minAmount && amount <= config.maxAmount;
      const discountPct = config.policy?.discount
        ? Math.round(config.policy.discount * 10000) / 100
        : 0;
      return json({
        ok: true,
        ally_slug: slug,
        requestedamount: amount,
        available: config.isActiveAlly && config.isActivePayNow && inRange,
        in_range: inRange,
        min_amount: config.minAmount,
        max_amount: config.maxAmount,
        visual_discount_pct: discountPct,
        disclaimer: inRange
          ? null
          : `Aplica solo para compras entre $${config.minAmount.toLocaleString("es-CO")} y $${config.maxAmount.toLocaleString("es-CO")} COP`,
        config,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ ok: false, error: msg }, 502);
    }
  }

  if (action !== "create") {
    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  }

  if (!addiConfigured()) {
    return json({ ok: false, error: "ADDI_CLIENT_ID / ADDI_CLIENT_SECRET not configured" }, 503);
  }

  const reference = String(body.reference || "").trim();
  if (!reference) {
    return json({ ok: false, error: "reference required" }, 400);
  }

  const redirectionUrl = String(
    body.redirectionUrl ?? body.redirection_url ?? body.return_url ?? "",
  ).trim();
  if (!redirectionUrl) {
    return json({ ok: false, error: "redirectionUrl required" }, 400);
  }

  const callbackUrl = String(body.callbackUrl ?? body.callback_url ?? defaultAddiCallbackUrl()).trim();
  if (!callbackUrl) {
    return json({ ok: false, error: "callbackUrl required (set ADDI_CALLBACK_URL or SUPABASE_URL)" }, 400);
  }

  const orderId = String(body.orderId ?? body.order_id ?? reference).trim();
  const amountCop = Number(body.amount_cop ?? body.amountCop ?? body.totalAmount ?? 0) || 0;
  if (amountCop <= 0) {
    return json({ ok: false, error: "amount_cop must be > 0" }, 400);
  }

  const customer = normalizeCustomer(
    (body.customer as Record<string, unknown>) || {},
  );
  const docNumber = String(customer.cliente_documento || "").replace(/\D/g, "");
  if (!docNumber) {
    return json({ ok: false, error: "customer document (CC) required" }, 400);
  }
  if (String(customer.cliente_documento_tipo || "CC").toUpperCase() !== "CC") {
    return json({ ok: false, error: "Addi only supports document type CC" }, 400);
  }

  const phone = normalizePhone(customer.cliente_telefono);
  if (phone.length < 10) {
    return json({ ok: false, error: "valid customer phone required" }, 400);
  }

  const email = String(customer.cliente_email || "").trim();
  if (!email.includes("@")) {
    return json({ ok: false, error: "valid customer email required" }, 400);
  }

  const items = normalizeItems(body.items);
  if (!items.length) {
    return json({ ok: false, error: "items required" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  const { data: row, error: fetchErr } = await sb.from("ventas_catalogo")
    .select("id, reference, estado_pago, amount_cop, tracking_meta")
    .eq("reference", reference)
    .maybeSingle();

  if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
  if (!row) {
    return json({ ok: false, error: "Order not found — call catalog-order-create first", reference }, 404);
  }

  const { firstName, lastName } = splitName(customer.cliente_nombre || "Cliente");
  const address = buildAddress(customer as Record<string, unknown>);
  const shippingAmount = Number(
    (body.totals as Record<string, unknown> | undefined)?.shipping ??
      (body.totales as Record<string, unknown> | undefined)?.envio ??
      body.shippingAmount ??
      0,
  ) || 0;

  try {
    const result = await createAddiOnlineApplication({
      orderId,
      totalAmount: amountCop,
      shippingAmount,
      totalTaxesAmount: 0,
      currency: "COP",
      items: items.map((item) => ({
        sku: String(item.ref || item.productId || "sku"),
        name: String(item.name || "Producto"),
        quantity: Number(item.qty) || 1,
        unitPrice: Number(item.price) || 0,
      })),
      client: {
        idType: "CC",
        idNumber: docNumber,
        firstName,
        lastName,
        email,
        cellphone: phone,
        cellphoneCountryCode: "+57",
        address,
      },
      shippingAddress: address,
      billingAddress: address,
      callbackUrl,
      redirectionUrl,
      logoUrl: String(body.logoUrl ?? body.logo_url ?? "").trim() || undefined,
    });

    const now = new Date().toISOString();
    const prevMeta = row.tracking_meta && typeof row.tracking_meta === "object"
      ? row.tracking_meta as Record<string, unknown>
      : {};
    await sb.from("ventas_catalogo")
      .update({
        canal_pago: "addi",
        proveedor_ref: result.applicationId || null,
        payment_status_raw: "PENDING",
        payment_updated_at: now,
        updated_at: now,
        tracking_meta: {
          ...prevMeta,
          addi_checkout_started_at: now,
          addi_order_id: orderId,
          addi_application_id: result.applicationId || null,
        },
      })
      .eq("id", row.id);

    return json({
      ok: true,
      reference,
      orderId,
      redirectUrl: result.redirectUrl,
      applicationId: result.applicationId || null,
      httpStatus: result.httpStatus,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[addi-create-checkout]", msg);
    return json({ ok: false, error: msg }, 502);
  }
});
