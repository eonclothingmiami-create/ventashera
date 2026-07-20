/**
 * Pinterest Conversions API — checkout desde servidor (Wompi/Addi).
 * Dedup con browser: event_id = hera-pin-{reference}
 * Secrets: PINTEREST_ACCESS_TOKEN, PINTEREST_AD_ACCOUNT_ID
 *
 * custom_data alineado al esquema oficial:
 * currency, value, content_ids, content_name, content_category, content_brand,
 * contents[{ item_price, quantity }], num_items, order_id
 *
 * @see https://developers.pinterest.com/docs/api/v5/events-create/
 */

const AD_ACCOUNT_ID = (Deno.env.get("PINTEREST_AD_ACCOUNT_ID") || "").trim();
const ACCESS_TOKEN = (Deno.env.get("PINTEREST_ACCESS_TOKEN") || "").trim();
const BRAND = "Hera Swimwear";

type OrderItem = {
  ref?: string;
  name?: string;
  price?: number;
  qty?: number;
  seccion?: string;
  categoria?: string;
  cat?: string;
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

function orderItems(row: OrderRow): OrderItem[] {
  return Array.isArray(row.items) ? (row.items as OrderItem[]) : [];
}

/** Líneas con ref (content_id canónico HERA-*). */
function buildLineItems(row: OrderRow) {
  return orderItems(row)
    .map((it) => {
      const id = String(it.ref || "").trim();
      if (!id) return null;
      const qty = Math.max(1, Number(it.qty) || 1);
      const price = Number(it.price) || 0;
      return {
        id,
        name: String(it.name || id).trim().slice(0, 500),
        category: [it.seccion, it.categoria || it.cat]
          .filter(Boolean)
          .join(" > ")
          .slice(0, 500),
        item_price: String(price),
        quantity: qty,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    category: string;
    item_price: string;
    quantity: number;
  }>;
}

export function pinterestEventsApiConfigured(): boolean {
  return Boolean(ACCESS_TOKEN && AD_ACCOUNT_ID);
}

/**
 * Envía checkout a Pinterest CAPI (idempotente por reference en tracking_meta).
 * @param opts.test — si true, usa ?test=true (no cuenta como conversión real)
 */
export async function sendPinterestCheckoutForOrder(
  row: OrderRow,
  opts?: {
    pageUrl?: string;
    test?: boolean;
    clientIp?: string;
    userAgent?: string;
  },
): Promise<{ ok: boolean; skipped?: string; error?: string; raw?: unknown }> {
  if (!pinterestEventsApiConfigured()) {
    return { ok: false, skipped: "pinterest_not_configured" };
  }

  const reference = String(row.reference || "").trim();
  if (!reference) return { ok: false, skipped: "no_reference" };

  const meta =
    row.tracking_meta && typeof row.tracking_meta === "object"
      ? row.tracking_meta
      : {};
  if (meta.pinterest_checkout_sent_at && !opts?.test) {
    return { ok: false, skipped: "already_sent" };
  }

  const lines = buildLineItems(row);
  if (!lines.length) {
    return { ok: false, skipped: "no_items_with_ref" };
  }

  const contentIds = lines.map((l) => l.id);
  const numItems = lines.reduce((s, l) => s + l.quantity, 0);
  const valueFromLines = lines.reduce(
    (s, l) => s + (Number(l.item_price) || 0) * l.quantity,
    0,
  );
  const value = Number(row.amount_cop ?? row.totales?.total ?? 0) || valueFromLines;

  const contentName = lines.map((l) => l.name).join(", ").slice(0, 500);
  const contentCategory =
    lines.find((l) => l.category)?.category ||
    lines.map((l) => l.name).join(" | ").slice(0, 500);

  /** Esquema oficial Pinterest custom_data.contents */
  const contents = lines.map((l) => ({
    item_price: l.item_price,
    quantity: l.quantity,
  }));

  const userData: Record<string, unknown> = {};
  const email = String(row.cliente_email || "").trim();
  const phone = String(row.cliente_telefono || "").replace(/\D/g, "");
  if (email) userData.em = [await sha256Hex(email)];
  if (phone) userData.ph = [await sha256Hex(phone)];

  // external_id: ID de usuario estable hasheado (mejora match / ROAS)
  const externalSeed = email || phone || `hera-order:${reference}`;
  userData.external_id = [await sha256Hex(externalSeed)];

  const ip = String(opts?.clientIp || "").trim();
  const ua = String(opts?.userAgent || "").trim();
  if (ip) userData.client_ip_address = ip;
  if (ua) userData.client_user_agent = ua;
  // hashed_maids solo aplica a apps móviles (IDFA/GAID) — no disponible en web.

  const eventId = `hera-pin-${reference}`;
  const pageUrl = opts?.pageUrl || "https://heraswimsuit.com/catalogo/";
  const eventTime = Math.floor(Date.now() / 1000);

  const payload = {
    data: [
      {
        event_name: "checkout",
        action_source: "web",
        event_time: eventTime,
        event_id: eventId,
        event_source_url: pageUrl,
        opt_out: false,
        user_data: userData,
        custom_data: {
          currency: "COP",
          value: String(value),
          content_ids: contentIds,
          content_name: contentName,
          content_category: contentCategory,
          content_brand: BRAND,
          contents,
          num_items: numItems,
          order_id: reference,
        },
      },
    ],
  };

  const qs = opts?.test ? "?test=true" : "";
  const url =
    `https://api.pinterest.com/v5/ad_accounts/${encodeURIComponent(AD_ACCOUNT_ID)}/events${qs}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: `Pinterest checkout HTTP ${res.status}: ${JSON.stringify(data).slice(0, 400)}`,
      raw: data,
    };
  }

  return { ok: true, raw: data };
}
