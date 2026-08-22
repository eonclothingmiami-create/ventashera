/**
 * Crea checkout Sistecredito para el catálogo.
 *
 * POST {
 *   reference, amount_cop | totals.total,
 *   redirectUrl | redirectionUrl,
 *   customer, items, totals?
 * }
 *
 * Requiere pedido previo en ventas_catalogo (catalog-order-create).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { catalogOrderClientAuthOk } from "../_shared/catalog_order_auth.ts";
import { normalizeCustomer, normalizeItems } from "../_shared/ventas_catalogo_map.ts";
import {
  createSistecreditoTransaction,
  defaultSistecreditoConfirmationUrl,
  sistecreditoConfigured,
  sistecreditoOrigen,
  waitForSistecreditoRedirect,
} from "../_shared/sistecredito_client.ts";

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
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "Cliente", lastName: "Hera" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
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
  if (!sistecreditoConfigured()) {
    return json({
      ok: false,
      error:
        "SISTECREDITO_SUBSCRIPTION_KEY / STORE_ID / VENDOR_ID not configured",
    }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const reference = String(body.reference || "").trim();
  if (!reference) return json({ ok: false, error: "reference required" }, 400);

  const redirectUrl = String(
    body.redirectUrl ?? body.redirectionUrl ?? body.redirection_url ??
      body.return_url ?? "",
  ).trim();
  if (!redirectUrl) {
    return json({ ok: false, error: "redirectUrl required" }, 400);
  }

  const confirmationUrl = String(
    body.callbackUrl ?? body.urlConfirmation ??
      defaultSistecreditoConfirmationUrl(),
  ).trim();
  if (!confirmationUrl) {
    return json({
      ok: false,
      error: "urlConfirmation required (set SISTECREDITO_CONFIRMATION_URL)",
    }, 400);
  }

  const totals = (body.totals || body.totales || {}) as Record<string, unknown>;
  const amountCop = Math.round(
    Number(body.amount_cop ?? body.amountCop ?? totals.total ?? 0) || 0,
  );
  if (amountCop <= 0) {
    return json({ ok: false, error: "amount_cop must be > 0" }, 400);
  }

  const customer = normalizeCustomer(
    (body.customer as Record<string, unknown>) || {},
  );
  const docNumber = String(customer.cliente_documento || "").replace(/\D/g, "");
  if (!docNumber) {
    return json({ ok: false, error: "customer document required" }, 400);
  }

  const items = normalizeItems(body.items);
  const { firstName, lastName } = splitName(customer.cliente_nombre || "Cliente");

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  const { data: row, error: fetchErr } = await sb.from("ventas_catalogo")
    .select("id, reference, estado_pago, amount_cop, tracking_meta")
    .eq("reference", reference)
    .maybeSingle();

  if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
  if (!row) {
    return json({
      ok: false,
      error: "Order not found — call catalog-order-create first",
      reference,
    }, 404);
  }

  const description = items.length
    ? `Hera · ${items.slice(0, 3).map((i) => i.ref || i.name).join(", ")}`
    : `Pedido catálogo ${reference}`;

  try {
    const { data: created } = await createSistecreditoTransaction({
      invoice: reference,
      description: description.slice(0, 180),
      value: amountCop,
      urlResponse: redirectUrl,
      urlConfirmation: confirmationUrl,
      methodConfirmation: "POST",
      docType: String(customer.cliente_documento_tipo || "CC").toUpperCase() ||
        "CC",
      document: docNumber,
      name: firstName,
      lastName,
      email: customer.cliente_email || undefined,
      phone: customer.cliente_telefono || undefined,
      city: customer.envio_ciudad || undefined,
      address: customer.envio_direccion || undefined,
      extraData: {
        catalog_reference: reference,
        origen: sistecreditoOrigen(),
      },
    });

    const txId = String(created._id || "").trim();
    if (!txId) {
      return json({
        ok: false,
        error: "Sistecredito create sin _id",
        data: created,
      }, 502);
    }

    const waited = await waitForSistecreditoRedirect(txId);
    const now = new Date().toISOString();
    const prevMeta = row.tracking_meta && typeof row.tracking_meta === "object"
      ? row.tracking_meta as Record<string, unknown>
      : {};

    await sb.from("ventas_catalogo")
      .update({
        canal_pago: "sistecredito",
        proveedor_ref: txId,
        payment_status_raw: waited.status || "Pending",
        payment_updated_at: now,
        updated_at: now,
        tracking_meta: {
          ...prevMeta,
          sistecredito_checkout_started_at: now,
          sistecredito_transaction_id: txId,
          sistecredito_origen: sistecreditoOrigen(),
        },
      })
      .eq("id", row.id);

    return json({
      ok: true,
      reference,
      checkoutUrl: waited.redirectUrl,
      transactionId: txId,
      status: waited.status,
      origen: sistecreditoOrigen(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sistecredito-create-checkout]", msg);
    return json({ ok: false, error: msg }, 502);
  }
});
