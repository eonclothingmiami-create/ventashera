/** Consulta transacciones Wompi (Colombia) con la llave privada del comercio. */

export interface WompiTransaction {
  id: string;
  reference: string;
  status: string;
  amount_in_cents?: number;
}

function wompiBaseUrl(): string {
  return Deno.env.get("WOMPI_API_BASE") || "https://production.wompi.co/v1";
}

function wompiAuthHeaders(): Record<string, string> {
  const key = Deno.env.get("WOMPI_PRIVATE_KEY") || "";
  if (!key) throw new Error("WOMPI_PRIVATE_KEY not configured");
  return { Authorization: `Bearer ${key}` };
}

function normalizeTx(raw: Record<string, unknown> | null | undefined): WompiTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  const reference = String(raw.reference || "").trim();
  const status = String(raw.status || "").trim();
  if (!id && !reference) return null;
  return {
    id,
    reference,
    status,
    amount_in_cents: Number(raw.amount_in_cents) || undefined,
  };
}

export async function fetchWompiTransactionById(
  transactionId: string,
): Promise<WompiTransaction | null> {
  const id = String(transactionId || "").trim();
  if (!id) return null;
  const res = await fetch(`${wompiBaseUrl()}/transactions/${encodeURIComponent(id)}`, {
    headers: wompiAuthHeaders(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Wompi GET transaction ${id}: ${res.status} ${txt}`);
  }
  const body = await res.json();
  return normalizeTx(body?.data as Record<string, unknown>);
}

export async function fetchWompiTransactionByReference(
  reference: string,
): Promise<WompiTransaction | null> {
  const ref = String(reference || "").trim();
  if (!ref) return null;
  const url =
    `${wompiBaseUrl()}/transactions?reference=${encodeURIComponent(ref)}&page=1&page_size=5`;
  const res = await fetch(url, { headers: wompiAuthHeaders() });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Wompi list reference ${ref}: ${res.status} ${txt}`);
  }
  const body = await res.json();
  const rows = body?.data;
  if (Array.isArray(rows) && rows.length) {
    return normalizeTx(rows[0] as Record<string, unknown>);
  }
  return normalizeTx(body?.data as Record<string, unknown>);
}
