/**
 * Pedidos marketplace → ventas_catalogo (sin POS / caja / facturas).
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { EstadoPago } from "./ventas_catalogo_map.ts";
import { normalizeItems } from "./ventas_catalogo_map.ts";

export type MarketplaceOrigen = "mercadolibre" | "faire" | "ebay";

export type MarketplaceSaleInput = {
  origen: MarketplaceOrigen;
  externalId: string;
  reference: string;
  estadoPago: EstadoPago;
  canalPago: string;
  clienteNombre: string;
  clienteEmail?: string;
  clienteTelefono?: string;
  envioCiudad?: string;
  envioDepartamento?: string;
  envioDireccion?: string;
  items: Array<Record<string, unknown>>;
  amountCop: number;
  totales: Record<string, unknown>;
  paymentStatusRaw: string;
  trackingMeta: Record<string, unknown>;
};

export async function lookupProductBySku(
  sb: SupabaseClient,
  skuRaw: string,
): Promise<{ id: string; ref: string } | null> {
  const sku = String(skuRaw || "").trim();
  if (!sku) return null;
  const { data: byRef } = await sb.from("products").select("id, ref").eq("ref", sku).maybeSingle();
  if (byRef?.id) return { id: String(byRef.id), ref: String(byRef.ref || sku) };

  const { data: byEbay } = await sb.from("products").select("id, ref").eq("ebay_sku", sku).maybeSingle();
  if (byEbay?.id) return { id: String(byEbay.id), ref: String(byEbay.ref || sku) };

  const base = sku.replace(/-LOT\d+$/i, "").replace(/-[A-Z0-9._-]{1,40}$/i, "");
  if (base && base !== sku) {
    const { data: byBase } = await sb.from("products").select("id, ref").eq("ref", base).maybeSingle();
    if (byBase?.id) return { id: String(byBase.id), ref: String(byBase.ref || base) };
  }
  return null;
}

export function mapFaireState(raw: string): EstadoPago {
  const s = String(raw || "").trim().toUpperCase();
  if (["CANCELED", "CANCELLED", "EXPIRED"].includes(s)) return "cancelada";
  if (["NEW", "PROCESSING", "PRE_TRANSIT", "IN_TRANSIT", "DELIVERED", "BACKORDERED", "PENDING_RETAILER_CONFIRMATION"].includes(s)) {
    return "pago_exitoso";
  }
  return "pendiente";
}

export function mapMlOrderStatus(raw: string): EstadoPago {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "paid" || s === "confirmed") return "pago_exitoso";
  if (s === "cancelled" || s === "canceled") return "cancelada";
  if (s === "payment_required" || s === "pending") return "pendiente";
  if (s === "invalid" || s === "payment_in_process") return "pendiente";
  return "pendiente";
}

export function mapEbayOrderStatus(payment: string, cancel: string, fulfillment: string): EstadoPago {
  const c = String(cancel || "").toUpperCase();
  if (c.includes("CANCEL")) return "cancelada";
  const p = String(payment || "").toUpperCase();
  if (p === "FAILED") return "pago_fallido";
  if (p === "PAID" || p === "SUCCEEDED") return "pago_exitoso";
  const f = String(fulfillment || "").toUpperCase();
  if (f === "FULFILLED" || f === "IN_PROGRESS") return "pago_exitoso";
  return "pendiente";
}

export function usdToCop(usd: number, copPerUsd: number): number {
  const n = Number(usd) || 0;
  const trm = Number(copPerUsd) || 4000;
  return Math.max(0, Math.round(n * trm));
}

export async function upsertMarketplaceSale(
  sb: SupabaseClient,
  input: MarketplaceSaleInput,
): Promise<{ id: string; reference: string; created: boolean; estado_pago: string }> {
  const now = new Date().toISOString();
  const items = normalizeItems(input.items);
  const rowBase = {
    reference: input.reference,
    estado_pago: input.estadoPago,
    canal_pago: input.canalPago,
    catalog_type: null as string | null,
    origen_canal: input.origen,
    external_order_id: input.externalId,
    cliente_nombre: input.clienteNombre,
    cliente_email: String(input.clienteEmail || "").trim(),
    cliente_telefono: String(input.clienteTelefono || "").trim(),
    cliente_documento_tipo: "CC",
    cliente_documento: "",
    envio_departamento: String(input.envioDepartamento || "").trim(),
    envio_ciudad: String(input.envioCiudad || "").trim(),
    envio_direccion: String(input.envioDireccion || "").trim(),
    items,
    totales: input.totales,
    amount_cop: Number(input.amountCop) || 0,
    proveedor_ref: input.externalId,
    payment_status_raw: input.paymentStatusRaw,
    payment_updated_at: now,
    tracking_meta: { ...input.trackingMeta, synced_at: now },
  };

  const { data: existing } = await sb
    .from("ventas_catalogo")
    .select("id, estado_pago, pagado_at, pos_factura_id")
    .eq("reference", input.reference)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await sb.from("ventas_catalogo").update({
      ...rowBase,
      pagado_at: input.estadoPago === "pago_exitoso" ? (existing.pagado_at || now) : existing.pagado_at,
      pos_factura_id: existing.pos_factura_id,
      updated_at: now,
    }).eq("id", existing.id).select("id, reference, estado_pago").single();
    if (error) throw error;
    return { id: data.id, reference: data.reference, created: false, estado_pago: data.estado_pago };
  }

  const { data, error } = await sb.from("ventas_catalogo").insert({
    ...rowBase,
    pagado_at: input.estadoPago === "pago_exitoso" ? now : null,
    pos_factura_id: null,
    created_at: now,
    updated_at: now,
  }).select("id, reference, estado_pago").single();
  if (error) throw error;
  return { id: data.id, reference: data.reference, created: true, estado_pago: data.estado_pago };
}
