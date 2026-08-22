/**
 * Cliente pasarela Sistecredito (credinet).
 * Docs: G-ALI-08 / G-ALI-12 — https://api.credinet.co/pay
 *
 * Secrets:
 *   SISTECREDITO_SUBSCRIPTION_KEY  → Ocp-Apim-Subscription-Key
 *   SISTECREDITO_STORE_ID          → ApplicationKey
 *   SISTECREDITO_VENDOR_ID         → ApplicationToken
 *   SISTECREDITO_ORIGEN            → Staging | Production (default Staging)
 *   SISTECREDITO_PAYMENT_METHOD_ID → default 2
 */

const API_BASE = (Deno.env.get("SISTECREDITO_API_BASE") || "https://api.credinet.co/pay")
  .replace(/\/$/, "");

export function sistecreditoConfigured(): boolean {
  return Boolean(
    (Deno.env.get("SISTECREDITO_SUBSCRIPTION_KEY") || "").trim() &&
      (Deno.env.get("SISTECREDITO_STORE_ID") || "").trim() &&
      (Deno.env.get("SISTECREDITO_VENDOR_ID") || "").trim(),
  );
}

export function sistecreditoOrigen(): "Staging" | "Production" {
  const raw = (Deno.env.get("SISTECREDITO_ORIGEN") || "Staging").trim();
  return /^prod/i.test(raw) ? "Production" : "Staging";
}

export function sistecreditoPaymentMethodId(): number {
  const n = Number(Deno.env.get("SISTECREDITO_PAYMENT_METHOD_ID") || 2);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

export function defaultSistecreditoConfirmationUrl(): string {
  const explicit = (Deno.env.get("SISTECREDITO_CONFIRMATION_URL") || "").trim();
  if (explicit) return explicit;
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  return base ? `${base}/functions/v1/sistecredito-confirmation` : "";
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    country: "co",
    SCLocation: "0,0",
    SCOrigen: sistecreditoOrigen(),
    "Ocp-Apim-Subscription-Key": (Deno.env.get("SISTECREDITO_SUBSCRIPTION_KEY") || "").trim(),
    ApplicationKey: (Deno.env.get("SISTECREDITO_STORE_ID") || "").trim(),
    ApplicationToken: (Deno.env.get("SISTECREDITO_VENDOR_ID") || "").trim(),
  };
}

export type SistecreditoCreateInput = {
  invoice: string;
  description: string;
  value: number;
  urlResponse: string;
  urlConfirmation: string;
  methodConfirmation?: "POST" | "GET";
  docType: string;
  document: string;
  name?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  address?: string;
  extraData?: Record<string, unknown>;
  sandbox?: { isActive: boolean; status?: string };
};

export type SistecreditoTx = {
  _id?: string;
  invoice?: string;
  transactionStatus?: string;
  value?: number;
  currency?: string;
  paymentMethodResponse?: {
    transactionId?: string;
    statusResponse?: string;
    codeResponse?: string;
    description?: string;
    paymentRedirectUrl?: string;
    authorizationCode?: string;
    approvalCode?: string;
    receipt?: string;
  };
  [key: string]: unknown;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function digRedirect(data: SistecreditoTx | null | undefined): string {
  if (!data) return "";
  const pmr = data.paymentMethodResponse || {};
  return String(
    pmr.paymentRedirectUrl ||
      (data as Record<string, unknown>).paymentRedirectUrl ||
      "",
  ).trim();
}

function digStatus(data: SistecreditoTx | null | undefined): string {
  if (!data) return "";
  const pmr = data.paymentMethodResponse || {};
  return String(
    pmr.statusResponse || data.transactionStatus || "",
  ).trim();
}

export function sistecreditoTxStatus(data: SistecreditoTx | null | undefined): string {
  return digStatus(data);
}

export function sistecreditoTxInvoice(data: SistecreditoTx | null | undefined): string {
  return String(data?.invoice || "").trim();
}

export async function createSistecreditoTransaction(
  input: SistecreditoCreateInput,
): Promise<{ raw: Record<string, unknown>; data: SistecreditoTx }> {
  if (!sistecreditoConfigured()) {
    throw new Error("SISTECREDITO_* secrets not configured");
  }

  const body: Record<string, unknown> = {
    invoice: input.invoice,
    description: input.description,
    paymentMethod: {
      paymentMethodId: sistecreditoPaymentMethodId(),
    },
    currency: "COP",
    value: Math.round(Number(input.value) || 0),
    urlResponse: input.urlResponse,
    urlConfirmation: input.urlConfirmation,
    methodConfirmation: input.methodConfirmation || "POST",
    client: {
      docType: input.docType || "CC",
      document: String(input.document || "").replace(/\D/g, ""),
      ...(input.name ? { name: input.name } : {}),
      ...(input.lastName ? { lastName: input.lastName } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone
        ? { phone: String(input.phone).replace(/\D/g, ""), indCountry: "57" }
        : {}),
      ...(input.city ? { city: input.city, country: "CO" } : {}),
      ...(input.address ? { address: input.address } : {}),
    },
  };

  if (input.extraData && Object.keys(input.extraData).length) {
    body.extraData = input.extraData;
  }
  if (input.sandbox) {
    body.sandbox = input.sandbox;
  }

  const res = await fetch(`${API_BASE}/create`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Sistecredito create non-JSON (${res.status}): ${text.slice(0, 400)}`);
  }

  if (!res.ok) {
    const msg = String(json.message || json.error || text).slice(0, 500);
    throw new Error(`Sistecredito create ${res.status}: ${msg}`);
  }

  const errorCode = Number(json.errorCode ?? 0);
  if (errorCode !== 0) {
    throw new Error(`Sistecredito create errorCode=${errorCode}: ${json.message || ""}`);
  }

  const data = (json.data && typeof json.data === "object"
    ? json.data
    : json) as SistecreditoTx;
  return { raw: json, data };
}

export async function getSistecreditoTransaction(
  transactionId: string,
): Promise<SistecreditoTx> {
  if (!sistecreditoConfigured()) {
    throw new Error("SISTECREDITO_* secrets not configured");
  }
  const id = String(transactionId || "").trim();
  if (!id) throw new Error("transactionId required");

  const url = `${API_BASE}/GetTransactionResponse?transactionId=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "GET", headers: authHeaders() });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Sistecredito get non-JSON (${res.status}): ${text.slice(0, 400)}`);
  }
  if (!res.ok) {
    throw new Error(`Sistecredito get ${res.status}: ${String(json.message || text).slice(0, 400)}`);
  }
  return (json.data && typeof json.data === "object"
    ? json.data
    : json) as SistecreditoTx;
}

const FAIL_STATUSES = new Set([
  "rejected",
  "cancelled",
  "canceled",
  "expired",
  "abandoned",
  "failed",
]);

/**
 * Poll hasta paymentRedirectUrl o estado terminal.
 */
export async function waitForSistecreditoRedirect(
  transactionId: string,
  opts: { maxAttempts?: number; delayMs?: number } = {},
): Promise<{ redirectUrl: string; data: SistecreditoTx; status: string }> {
  const maxAttempts = opts.maxAttempts ?? 12;
  const delayMs = opts.delayMs ?? 1500;
  let last: SistecreditoTx = {};

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await sleep(delayMs);
    last = await getSistecreditoTransaction(transactionId);
    const redirectUrl = digRedirect(last);
    const status = digStatus(last);
    if (redirectUrl) {
      return { redirectUrl, data: last, status };
    }
    if (FAIL_STATUSES.has(status.toLowerCase())) {
      const desc = String(
        last.paymentMethodResponse?.description || status || "rejected",
      );
      throw new Error(`Sistecredito no disponible: ${desc}`);
    }
  }

  throw new Error(
    "Sistecredito no devolvió URL de pago a tiempo. Intenta de nuevo.",
  );
}

export function mapSistecreditoStatus(raw: string | null | undefined): string {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "";
  if (s === "APPROVED" || s === "APROBADO") return "APPROVED";
  if (
    s === "REJECTED" ||
    s === "CANCELLED" ||
    s === "CANCELED" ||
    s === "FAILED" ||
    s === "EXPIRED" ||
    s === "ABANDONED"
  ) {
    return s === "CANCELED" ? "CANCELLED" : s;
  }
  if (s === "PENDING" || s === "PENDINGFORPAYMENTMETHOD" || s === "STARTED") {
    return "PENDING";
  }
  return s;
}
