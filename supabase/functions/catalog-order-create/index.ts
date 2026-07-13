/**
 * Registra pedido en ventas_catalogo antes de ir a pasarela (Wompi/Addi).
 * POST { reference, canal_pago, catalog_type, customer, totals, amount_cop, items, session_id? }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  normalizeCustomer,
  normalizeItems,
} from "../_shared/ventas_catalogo_map.ts";
import { catalogOrderAuthOk } from "../_shared/catalog_order_auth.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }
  if (!catalogOrderAuthOk(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const reference = String(body.reference || "").trim();
  if (!reference) {
    return json({ ok: false, error: "reference required" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  const items = normalizeItems(body.items);
  const customer = normalizeCustomer(
    (body.customer as Record<string, unknown>) || {},
  );
  const totals = (body.totales ?? body.totals ?? {}) as Record<string, unknown>;
  const amountCop =
    Number(body.amount_cop ?? body.amountCop ?? totals.total ?? 0) || 0;
  const canalPago = String(body.canal_pago ?? body.canalPago ?? "").trim() ||
    null;
  const catalogType = String(
    body.catalog_type ?? body.catalogType ?? "",
  ).trim() || null;
  const sessionId = String(body.session_id ?? body.sessionId ?? "").trim() ||
    null;

  const row = {
    reference,
    estado_pago: "pendiente",
    canal_pago: canalPago,
    catalog_type: catalogType,
    origen_canal: "catalogo_web",
    external_order_id: null,
    session_id: sessionId,
    ...customer,
    items,
    totales: totals,
    amount_cop: amountCop,
    proveedor_ref: null,
    pagado_at: null,
    pos_factura_id: null,
    tracking_meta: {
      checkout_started_at: new Date().toISOString(),
      source: "catalog-order-create",
    },
    payment_status_raw: "PENDING",
    payment_updated_at: new Date().toISOString(),
  };

  const { data: existing } = await sb.from("ventas_catalogo")
    .select("id, estado_pago")
    .eq("reference", reference)
    .maybeSingle();

  if (existing?.id) {
    return json({ ok: true, id: existing.id, existing: true, estado_pago: existing.estado_pago });
  }

  const { data, error } = await sb.from("ventas_catalogo")
    .insert(row)
    .select("id, reference, estado_pago")
    .single();

  if (error) {
    console.error("[catalog-order-create]", error);
    return json({ ok: false, error: error.message }, 500);
  }

  if (sessionId) {
    await sb.rpc("mark_catalog_cart_converted", { p_session_id: sessionId }).catch(
      () => {},
    );
  }

  return json({ ok: true, id: data.id, reference: data.reference, estado_pago: data.estado_pago });
});
