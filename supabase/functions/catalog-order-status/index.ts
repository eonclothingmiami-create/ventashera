/**
 * Actualiza estado de pago de un pedido catálogo (retorno Wompi/Addi, webhook, mantenimiento).
 * POST { reference, status|estado_pago, proveedor_ref?, payment_status_raw?, action? }
 * action=expire_stale → marca pendientes > N horas como checkout_abandonado
 * action=resolve_wompi_return → consulta Wompi por transaction_id o reference (retorno catálogo)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  mapGatewayStatus,
  type EstadoPago,
} from "../_shared/ventas_catalogo_map.ts";
import {
  fetchWompiTransactionById,
  fetchWompiTransactionByReference,
} from "../_shared/wompi_client.ts";
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

function authOk(req: Request): boolean {
  return catalogOrderAuthOk(req);
}

function erpAuthOk(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ");
}

function resolveEstado(body: Record<string, unknown>): EstadoPago | null {
  const direct = String(body.estado_pago ?? body.estadoPago ?? "").trim();
  const allowed = [
    "pendiente",
    "pago_exitoso",
    "pago_fallido",
    "checkout_abandonado",
    "expirado",
    "cancelada",
  ];
  if (allowed.includes(direct)) return direct as EstadoPago;

  const raw = String(
    body.payment_status_raw ?? body.status ?? body.transaction_status ?? "",
  ).trim();
  return mapGatewayStatus(raw);
}

async function patchOrder(
  sb: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
  nuevoEstado: EstadoPago,
  opts: {
    proveedorRef?: string;
    paymentRaw?: string;
    source?: string;
    extraMeta?: Record<string, unknown>;
  },
) {
  if (
    row.estado_pago === "pago_exitoso" &&
    nuevoEstado !== "pago_exitoso" &&
    nuevoEstado !== "cancelada"
  ) {
    return {
      skipped: true,
      reason: "already_paid",
      estado_pago: row.estado_pago,
    };
  }

  const proveedorRef = opts.proveedorRef || row.proveedor_ref;
  const paymentRaw = opts.paymentRaw || row.payment_status_raw;
  const now = new Date().toISOString();
  const prevMeta = row.tracking_meta && typeof row.tracking_meta === "object"
    ? row.tracking_meta as Record<string, unknown>
    : {};

  const patch: Record<string, unknown> = {
    estado_pago: nuevoEstado,
    proveedor_ref: proveedorRef,
    payment_status_raw: paymentRaw,
    payment_updated_at: now,
    updated_at: now,
    tracking_meta: {
      ...prevMeta,
      last_status_update: now,
      last_status_source: opts.source || "catalog-order-status",
      ...(opts.extraMeta || {}),
    },
  };

  if (nuevoEstado === "pago_exitoso") {
    patch.pagado_at = row.pagado_at || now;
  }
  if (nuevoEstado === "cancelada" || nuevoEstado === "pago_fallido") {
    patch.pagado_at = null;
  }

  const { data: updated, error: updErr } = await sb.from("ventas_catalogo")
    .update(patch)
    .eq("id", row.id)
    .select("id, reference, estado_pago, pagado_at, payment_status_raw, proveedor_ref")
    .single();

  if (updErr) throw new Error(updErr.message);
  return { order: updated };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  if (req.method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const action = String(body.action || "").trim();

    if (action === "expire_stale") {
      if (!erpAuthOk(req)) {
        return json({ ok: false, error: "Authorization required" }, 401);
      }
      const hours = Math.max(1, Number(body.hours) || 168);
      const { data, error } = await sb.rpc("expire_stale_catalog_orders", {
        p_hours: hours,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, expired: data ?? 0, hours });
    }

    if (action === "resolve_wompi_return") {
      if (!authOk(req)) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      const transactionId = String(
        body.transaction_id ?? body.transactionId ?? body.id ?? "",
      ).trim();
      let reference = String(body.reference || "").trim();

      try {
        let tx = transactionId
          ? await fetchWompiTransactionById(transactionId)
          : null;
        if (!tx && reference) {
          tx = await fetchWompiTransactionByReference(reference);
        }
        if (!tx) {
          return json({ ok: false, error: "Wompi transaction not found" }, 404);
        }

        reference = reference || tx.reference;
        if (!reference) {
          return json({ ok: false, error: "Could not resolve order reference" }, 400);
        }

        const nuevoEstado = mapGatewayStatus(tx.status);
        if (!nuevoEstado) {
          return json({
            ok: false,
            error: `Unknown Wompi status: ${tx.status}`,
            wompi_status: tx.status,
          }, 400);
        }

        const { data: row, error: fetchErr } = await sb.from("ventas_catalogo")
          .select("*")
          .eq("reference", reference)
          .maybeSingle();

        if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
        if (!row) {
          return json({ ok: false, error: "Order not found", reference }, 404);
        }

        const result = await patchOrder(sb, row, nuevoEstado, {
          proveedorRef: tx.id,
          paymentRaw: tx.status,
          source: "wompi_return",
          extraMeta: { wompi_reconciled_at: new Date().toISOString() },
        });

        return json({ ok: true, wompi: tx, ...result });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ ok: false, error: msg }, 500);
      }
    }

    if (!authOk(req)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const reference = String(body.reference || "").trim();
    if (!reference) {
      return json({ ok: false, error: "reference required" }, 400);
    }

    const nuevoEstado = resolveEstado(body);
    if (!nuevoEstado) {
      return json({ ok: false, error: "Could not resolve estado_pago" }, 400);
    }

    const { data: row, error: fetchErr } = await sb.from("ventas_catalogo")
      .select("*")
      .eq("reference", reference)
      .maybeSingle();

    if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
    if (!row) return json({ ok: false, error: "Order not found" }, 404);

    try {
      const result = await patchOrder(sb, row, nuevoEstado, {
        proveedorRef: String(
          body.proveedor_ref ?? body.proveedorRef ?? body.transaction_id ?? "",
        ).trim() || undefined,
        paymentRaw: String(
          body.payment_status_raw ?? body.status ?? "",
        ).trim() || undefined,
        source: String(body.source || "catalog-order-status"),
      });
      return json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ ok: false, error: msg }, 500);
    }
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
});
