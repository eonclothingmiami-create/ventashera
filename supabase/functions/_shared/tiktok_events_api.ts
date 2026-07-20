/**
 * TikTok Events API — Purchase/CompletePayment desde servidor (Fase 5).
 * Pedido originado en catálogo; líneas con ref del ERP (vía ventas_catalogo.items).
 * Requiere secretos: TIKTOK_ACCESS_TOKEN, TIKTOK_PIXEL_ID (opcional).
 */

const PIXEL_ID = (Deno.env.get("TIKTOK_PIXEL_ID") || "D9EQN53C77U8SCOM34VG").trim();
const ACCESS_TOKEN = (Deno.env.get("TIKTOK_ACCESS_TOKEN") || "").trim();
const API_URL = "https://business-api.tiktok.com/open_api/v1.3/pixel/track/";

type OrderItem = {
  ref?: string;
  name?: string;
  price?: number;
  qty?: number;
};

type OrderRow = {
  reference?: string;
  amount_cop?: number;
  totales?: { total?: number };
  items?: OrderItem[];
  cliente_email?: string;
  cliente_telefono?: string;
  tracking_meta?: Record<string, unknown>;
};

async function sha256Hex(value: string): Promise<string> {
  const normalized = value.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Teléfono E.164 (+57…) antes de hashear — requisito Events API / Advanced Matching. */
function normalizePhoneE164(phone: string): string {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("3")) digits = `57${digits}`;
  if (digits.startsWith("57") && digits.length >= 12) return `+${digits}`;
  if (String(phone || "").trim().startsWith("+") && digits.length >= 10) {
    return `+${digits}`;
  }
  return digits.length >= 10 ? `+${digits}` : "";
}

function orderItems(row: OrderRow): OrderItem[] {
  const raw = row.items;
  if (!Array.isArray(raw)) return [];
  return raw as OrderItem[];
}

function buildContents(row: OrderRow) {
  const contents = orderItems(row)
    .map((it) => {
      const ref = String(it.ref || "").trim();
      if (!ref) return null;
      const price = Number(it.price) || 0;
      const qty = Math.max(1, Number(it.qty) || 1);
      return {
        content_id: ref.slice(0, 100),
        content_type: "product",
        content_name: String(it.name || ref).slice(0, 200),
        price,
        quantity: qty,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  return contents;
}

export function tiktokEventsApiConfigured(): boolean {
  return Boolean(ACCESS_TOKEN && PIXEL_ID);
}

/** Envía CompletePayment + Purchase al aprobar pedido (idempotente por reference). */
export async function sendTikTokPurchaseForOrder(
  row: OrderRow,
  opts?: { pageUrl?: string },
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  if (!tiktokEventsApiConfigured()) {
    return { ok: false, skipped: "tiktok_not_configured" };
  }

  const reference = String(row.reference || "").trim();
  if (!reference) return { ok: false, skipped: "no_reference" };

  const meta = row.tracking_meta && typeof row.tracking_meta === "object"
    ? row.tracking_meta
    : {};
  if (meta.tiktok_purchase_sent_at) {
    return { ok: false, skipped: "already_sent" };
  }

  const contents = buildContents(row);
  if (!contents.length) {
    return { ok: false, skipped: "no_items_with_ref" };
  }

  const value = Number(row.amount_cop ?? row.totales?.total ?? 0) ||
    contents.reduce((s, c) => s + (Number(c.price) || 0) * (Number(c.quantity) || 1), 0);

  const user: Record<string, string> = {};
  const email = String(row.cliente_email || "").trim().toLowerCase();
  const phoneE164 = normalizePhoneE164(String(row.cliente_telefono || ""));
  if (email && email.includes("@")) user.email = await sha256Hex(email);
  if (phoneE164) user.phone_number = await sha256Hex(phoneE164);
  if (!user.email && !user.phone_number) {
    console.warn("[tiktok_events_api] Purchase sin email/phone hashed", reference);
  }

  const eventId = `hera-${reference}`;
  const pageUrl = opts?.pageUrl || "https://heraswimsuit.com/catalogo/";

  const basePayload = {
    pixel_code: PIXEL_ID,
    event_id: eventId,
    timestamp: new Date().toISOString(),
    context: {
      user: Object.keys(user).length ? user : undefined,
      page: { url: pageUrl },
    },
    properties: {
      contents,
      content_type: "product",
      currency: "COP",
      value,
    },
  };

  for (const eventName of ["CompletePayment", "Purchase"]) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": ACCESS_TOKEN,
      },
      body: JSON.stringify({ ...basePayload, event: eventName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.code !== 0) {
      return {
        ok: false,
        error: `TikTok ${eventName} HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
      };
    }
  }

  return { ok: true };
}
