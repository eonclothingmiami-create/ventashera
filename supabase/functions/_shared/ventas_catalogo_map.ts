/** Mapeo de estados de pago / pasarelas → ventas_catalogo.estado_pago */

export type EstadoPago =
  | "pendiente"
  | "pago_exitoso"
  | "pago_fallido"
  | "checkout_abandonado"
  | "expirado"
  | "cancelada";

const APPROVED = new Set([
  "APPROVED",
  "APROBADO",
  "SUCCESS",
  "COMPLETED",
  "AUTHORIZED",
  "FINISHED",
  "PAID",
  // Addi (crédito)
  "FUNDED",
  "DISBURSED",
  "PRE_APPROVED",
  "PREAPPROVED",
  "ACTIVE",
  "APPROVED_BY_ADDI",
]);

const FAILED = new Set([
  "DECLINED",
  "REJECTED",
  "ERROR",
  "FAILED",
  "DENIED",
  "VOIDED",
  "CANCELLED",
  "CANCELED",
]);

const ABANDONED = new Set([
  "ABANDONED",
  "EXPIRED",
  "TIMEOUT",
  "CHECKOUT_ABANDONED",
]);

export function mapGatewayStatus(raw: string | null | undefined): EstadoPago | null {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return null;
  if (APPROVED.has(s)) return "pago_exitoso";
  if (FAILED.has(s)) return "pago_fallido";
  if (ABANDONED.has(s)) return "checkout_abandonado";
  if (s === "PENDING" || s === "PENDIENTE" || s === "IN_PROGRESS") return "pendiente";
  return null;
}

/** WooCommerce order.status → estado_pago ERP */
export function mapWooCommerceStatus(wcStatus: string | null | undefined): EstadoPago {
  const s = String(wcStatus || "").trim().toLowerCase();
  switch (s) {
    case "completed":
    case "processing":
      return "pago_exitoso";
    case "cancelled":
    case "trash":
      return "cancelada";
    case "failed":
      return "pago_fallido";
    case "checkout-draft":
      return "checkout_abandonado";
    case "pending":
    case "on-hold":
    default:
      return "pendiente";
  }
}

export function normalizeCustomer(input: Record<string, unknown> | null | undefined) {
  const c = input || {};
  return {
    cliente_nombre: String(c.name || c.nombre || "").trim(),
    cliente_email: String(c.email || "").trim(),
    cliente_telefono: String(c.phone || c.telefono || "").trim(),
    cliente_documento_tipo: String(c.documentType || c.documento_tipo || "CC").trim() || "CC",
    cliente_documento: String(c.document || c.documento || "").trim(),
    envio_departamento: String(c.department || c.departamento || "").trim(),
    envio_ciudad: String(c.city || c.ciudad || "").trim(),
    envio_direccion: String(c.address || c.direccion || "").trim(),
  };
}

export function normalizeItems(items: unknown): Record<string, unknown>[] {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const row = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
    return {
      productId: row.productId ?? row.product_id ?? null,
      ref: row.ref ?? row.sku ?? "",
      name: row.name ?? row.nombre ?? "",
      size: row.size ?? row.talla ?? "",
      color: row.color ?? "",
      price: Number(row.price ?? row.precio ?? 0) || 0,
      qty: Math.max(1, Number(row.qty ?? row.quantity ?? 1) || 1),
    };
  });
}
