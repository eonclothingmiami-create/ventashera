import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mapGatewayStatus, type EstadoPago } from "./ventas_catalogo_map.ts";
import {
  fetchWompiTransactionById,
  fetchWompiTransactionByReference,
} from "./wompi_client.ts";
import {
  fetchAddiApplicationById,
  fetchAddiApplicationByOrderReference,
} from "./addi_client.ts";
import { sendTikTokPurchaseForOrder } from "./tiktok_events_api.ts";
import { sendPinterestCheckoutForOrder } from "./pinterest_events_api.ts";

export type CatalogOrderRow = Record<string, unknown>;

const ADS_PURCHASE_SOURCES = new Set(["wompi_return", "addi_return", "addi_webhook", "wompi_webhook"]);

export async function patchCatalogOrder(
  sb: SupabaseClient,
  row: CatalogOrderRow,
  nuevoEstado: EstadoPago,
  opts: {
    proveedorRef?: string;
    paymentRaw?: string;
    source?: string;
    extraMeta?: Record<string, unknown>;
    clientIp?: string;
    userAgent?: string;
  },
): Promise<Record<string, unknown>> {
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
    .eq("id", String(row.id))
    .select("id, reference, estado_pago, pagado_at, payment_status_raw, proveedor_ref, canal_pago")
    .single();

  if (updErr) throw new Error(updErr.message);

  if (
    nuevoEstado === "pago_exitoso" &&
    row.estado_pago !== "pago_exitoso" &&
    ADS_PURCHASE_SOURCES.has(String(opts.source || ""))
  ) {
    const orderPayload = {
      reference: row.reference,
      amount_cop: row.amount_cop,
      totales: row.totales as { total?: number },
      items: row.items as Record<string, unknown>[],
      cliente_email: row.cliente_email,
      cliente_telefono: row.cliente_telefono,
      tracking_meta: prevMeta,
    };
    const metaExtra: Record<string, unknown> = {
      ...(patch.tracking_meta as Record<string, unknown>),
    };
    let metaChanged = false;

    try {
      const tt = await sendTikTokPurchaseForOrder(orderPayload);
      if (tt.ok) {
        metaExtra.tiktok_purchase_sent_at = new Date().toISOString();
        metaExtra.tiktok_events_api = true;
        metaChanged = true;
      }
    } catch (e) {
      console.warn("[catalog-order-status] TikTok Events API error", e);
    }

    try {
      const pin = await sendPinterestCheckoutForOrder(orderPayload, {
        clientIp: opts.clientIp,
        userAgent: opts.userAgent,
      });
      if (pin.ok) {
        metaExtra.pinterest_checkout_sent_at = new Date().toISOString();
        metaExtra.pinterest_events_api = true;
        metaChanged = true;
      }
    } catch (e) {
      console.warn("[catalog-order-status] Pinterest CAPI error", e);
    }

    if (metaChanged) {
      await sb.from("ventas_catalogo").update({ tracking_meta: metaExtra }).eq(
        "id",
        row.id,
      );
    }
  }

  return { order: updated };
}

function canalNorm(row: CatalogOrderRow): string {
  return String(row.canal_pago || "").trim().toLowerCase();
}

export async function reconcileCatalogOrderRow(
  sb: SupabaseClient,
  row: CatalogOrderRow,
  opts?: { clientIp?: string; userAgent?: string; source?: string },
): Promise<Record<string, unknown>> {
  const canal = canalNorm(row);
  const reference = String(row.reference || "").trim();
  const proveedorRef = String(row.proveedor_ref || "").trim();
  const source = opts?.source || "reconcile_pending";

  if (canal === "wompi" || canal.includes("wompi")) {
    let tx = proveedorRef ? await fetchWompiTransactionById(proveedorRef).catch(() => null) : null;
    if (!tx && reference) {
      tx = await fetchWompiTransactionByReference(reference).catch(() => null);
    }
    if (!tx) {
      return { ok: false, skipped: true, reason: "wompi_not_found", reference };
    }
    const nuevoEstado = mapGatewayStatus(tx.status);
    if (!nuevoEstado) {
      return { ok: false, error: `Unknown Wompi status: ${tx.status}`, wompi_status: tx.status };
    }
    const result = await patchCatalogOrder(sb, row, nuevoEstado, {
      proveedorRef: tx.id,
      paymentRaw: tx.status,
      source: "wompi_return",
      extraMeta: { wompi_reconciled_at: new Date().toISOString(), reconcile_source: source },
      clientIp: opts?.clientIp,
      userAgent: opts?.userAgent,
    });
    return { ok: true, gateway: "wompi", wompi: tx, ...result };
  }

  if (canal === "addi" || canal.includes("addi")) {
    const tm = row.tracking_meta && typeof row.tracking_meta === "object"
      ? row.tracking_meta as Record<string, unknown>
      : {};
    const appId = proveedorRef ||
      String(tm.addi_application_id || tm.applicationId || "").trim();

    let app = appId
      ? await fetchAddiApplicationById(appId).catch(() => null)
      : null;
    if (!app && reference) {
      app = await fetchAddiApplicationByOrderReference(reference).catch(() => null);
    }
    if (!app) {
      return { ok: false, skipped: true, reason: "addi_not_found_or_not_configured", reference };
    }

    const nuevoEstado = mapGatewayStatus(app.status);
    if (!nuevoEstado) {
      return { ok: false, error: `Unknown Addi status: ${app.status}`, addi_status: app.status };
    }
    const result = await patchCatalogOrder(sb, row, nuevoEstado, {
      proveedorRef: app.id || appId || proveedorRef,
      paymentRaw: app.status,
      source: "addi_return",
      extraMeta: {
        addi_reconciled_at: new Date().toISOString(),
        addi_application_id: app.id || appId,
        reconcile_source: source,
      },
      clientIp: opts?.clientIp,
      userAgent: opts?.userAgent,
    });
    return { ok: true, gateway: "addi", addi: app, ...result };
  }

  return { ok: false, skipped: true, reason: "unsupported_canal", canal };
}

export async function reconcilePendingCatalogPayments(
  sb: SupabaseClient,
  opts?: { limit?: number; days?: number; clientIp?: string; userAgent?: string },
): Promise<Record<string, unknown>> {
  const limit = Math.min(Math.max(Number(opts?.limit) || 30, 1), 80);
  const days = Math.min(Math.max(Number(opts?.days) || 30, 1), 90);

  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data: rows, error } = await sb.from("ventas_catalogo")
    .select("*")
    .eq("origen_canal", "catalogo_web")
    .eq("estado_pago", "pendiente")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit * 3);

  if (error) throw new Error(error.message);

  const pending = (rows || []).filter((r) => {
    const c = String(r.canal_pago || "").toLowerCase();
    return c === "wompi" || c.includes("wompi") || c === "addi" || c.includes("addi");
  }).slice(0, limit);

  const results: Array<Record<string, unknown>> = [];
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of pending) {
    try {
      const res = await reconcileCatalogOrderRow(sb, row as CatalogOrderRow, {
        source: "reconcile_pending",
        clientIp: opts?.clientIp,
        userAgent: opts?.userAgent,
      });
      results.push({
        reference: row.reference,
        canal: row.canal_pago,
        ...res,
      });
      if (res.skipped) skipped += 1;
      else if (res.ok && !res.skipped) updated += 1;
      else errors += 1;
    } catch (e) {
      errors += 1;
      results.push({
        reference: row.reference,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    ok: true,
    scanned: pending.length,
    updated,
    skipped,
    errors,
    results,
  };
}

export function resolveEstadoFromBody(body: Record<string, unknown>): EstadoPago | null {
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
    body.payment_status_raw ??
      body.status ??
      body.transaction_status ??
      body.addi_status ??
      body.application_status ??
      "",
  ).trim();
  return mapGatewayStatus(raw);
}

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}
