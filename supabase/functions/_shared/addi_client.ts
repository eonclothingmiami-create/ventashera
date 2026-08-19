/** Cliente Addi: OAuth, config pública, crear/cancelar aplicaciones en línea. */

export interface AddiApplication {
  id: string;
  orderId: string;
  status: string;
}

export interface AddiAllyConfig {
  minAmount: number;
  maxAmount: number;
  isActiveAlly: boolean;
  isActivePayNow: boolean;
  policy?: {
    discount?: number;
    productType?: string;
    policyMaxAmount?: number;
    isVisible?: boolean;
  };
  widgetConfig?: Record<string, unknown>;
  checkoutConfig?: Record<string, unknown>;
}

export interface AddiCreateApplicationInput {
  orderId: string;
  totalAmount: number;
  shippingAmount?: number;
  totalTaxesAmount?: number;
  currency?: string;
  items: Array<{
    sku?: string;
    name: string;
    quantity: number;
    unitPrice: number;
    tax?: number;
    pictureUrl?: string;
    category?: string;
    brand?: string;
  }>;
  client: {
    idType: string;
    idNumber: string;
    firstName: string;
    lastName?: string;
    email: string;
    cellphone: string;
    cellphoneCountryCode?: string;
    address?: Record<string, string>;
  };
  shippingAddress?: Record<string, string>;
  billingAddress?: Record<string, string>;
  callbackUrl: string;
  redirectionUrl: string;
  logoUrl?: string;
}

export interface AddiCreateApplicationResult {
  redirectUrl: string;
  httpStatus: number;
  applicationId?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function addiApiBase(): string {
  return (Deno.env.get("ADDI_API_BASE") ||
    Deno.env.get("ADDI_INTEGRATION_BASE_URL") ||
    "https://api.addi.com").replace(/\/$/, "");
}

function addiChannelsApiBase(): string {
  return (Deno.env.get("ADDI_CHANNELS_API_BASE") ||
    "https://channels-public-api.addi.com").replace(/\/$/, "");
}

function addiAuthUrl(): string {
  return (Deno.env.get("ADDI_AUTH_URL") || "https://auth.addi.com/oauth/token").trim();
}

function addiAllySlug(): string {
  return (Deno.env.get("ADDI_ALLY_SLUG") || "").trim();
}

function addiConfigured(): boolean {
  return Boolean(
    (Deno.env.get("ADDI_CLIENT_ID") || "").trim() &&
      (Deno.env.get("ADDI_CLIENT_SECRET") || "").trim(),
  );
}

function removeAccents(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizePhone(value: string): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function normalizeApp(raw: Record<string, unknown> | null | undefined): AddiApplication | null {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.applicationId || raw.application_id || "").trim();
  const orderId = String(raw.orderId || raw.order_id || raw.reference || "").trim();
  const status = String(raw.status || raw.applicationStatus || raw.state || "").trim();
  if (!status && !id && !orderId) return null;
  return { id, orderId, status };
}

async function requestAddiAccessToken(fresh = false): Promise<string> {
  if (!addiConfigured()) throw new Error("ADDI_CLIENT_ID / ADDI_CLIENT_SECRET not configured");

  const now = Date.now();
  if (!fresh && cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const clientId = Deno.env.get("ADDI_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("ADDI_CLIENT_SECRET")!.trim();
  const audience = (
    Deno.env.get("ADDI_AUTH_AUDIENCE") ||
    Deno.env.get("ADDI_AUDIENCE") ||
    addiApiBase()
  ).trim();

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    audience,
  });

  const res = await fetch(addiAuthUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Addi auth ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json() as { access_token?: string; expires_in?: number };
  const token = String(data.access_token || "").trim();
  if (!token) throw new Error("Addi auth: missing access_token");

  cachedToken = {
    token,
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
  };
  return token;
}

/** Token nuevo por intento de checkout (recomendación Addi). */
export async function getFreshAddiAccessToken(): Promise<string> {
  return requestAddiAccessToken(true);
}

async function addiGet(path: string): Promise<AddiApplication | null> {
  const token = await requestAddiAccessToken();
  const res = await fetch(`${addiApiBase()}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Addi GET ${path}: ${res.status} ${txt.slice(0, 300)}`);
  }
  const body = await res.json();
  if (body && typeof body === "object") {
    const wrapped = body as { data?: Record<string, unknown>; application?: Record<string, unknown> };
    return normalizeApp(wrapped.data || wrapped.application || body as Record<string, unknown>);
  }
  return null;
}

export async function fetchAddiAllyConfig(
  requestedAmount: number,
  allySlug?: string,
): Promise<AddiAllyConfig | null> {
  const slug = String(allySlug || addiAllySlug() || "").trim();
  if (!slug) return null;

  const amount = Math.max(0, Math.round(Number(requestedAmount) || 0));
  const url =
    `${addiChannelsApiBase()}/allies/${encodeURIComponent(slug)}/config?requestedamount=${amount}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Addi config ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    minAmount: Number(data.minAmount) || 0,
    maxAmount: Number(data.maxAmount) || 0,
    isActiveAlly: Boolean(data.isActiveAlly),
    isActivePayNow: Boolean(data.isActivePayNow),
    policy: data.policy as AddiAllyConfig["policy"],
    widgetConfig: data.widgetConfig as Record<string, unknown>,
    checkoutConfig: data.checkoutConfig as Record<string, unknown>,
  };
}

function buildAddiApplicationPayload(input: AddiCreateApplicationInput): Record<string, unknown> {
  const shipping = Number(input.shippingAmount ?? 0);
  const taxes = Number(input.totalTaxesAmount ?? 0);
  const address = input.client.address || input.shippingAddress || input.billingAddress;

  return {
    orderId: String(input.orderId).trim(),
    totalAmount: Number(input.totalAmount).toFixed(1),
    shippingAmount: shipping.toFixed(1),
    totalTaxesAmount: taxes.toFixed(1),
    currency: input.currency || "COP",
    items: input.items.map((item) => ({
      sku: String(item.sku || "item").slice(0, 50),
      name: removeAccents(item.name).slice(0, 50),
      quantity: String(Math.max(1, Math.round(item.quantity))),
      unitPrice: Math.round(Number(item.unitPrice) || 0),
      tax: Math.round(Number(item.tax ?? 0)),
      ...(item.pictureUrl ? { pictureUrl: item.pictureUrl } : {}),
      ...(item.category ? { category: item.category.slice(0, 50) } : {}),
      ...(item.brand ? { brand: item.brand.slice(0, 50) } : {}),
    })),
    client: {
      idType: "CC",
      idNumber: String(input.client.idNumber || "").replace(/\D/g, "").slice(0, 20),
      firstName: removeAccents(input.client.firstName).slice(0, 50),
      lastName: removeAccents(input.client.lastName || input.client.firstName).slice(0, 50),
      email: String(input.client.email || "").trim().toLowerCase().slice(0, 100),
      cellphone: normalizePhone(input.client.cellphone),
      cellphoneCountryCode: input.client.cellphoneCountryCode || "+57",
      ...(address ? { address } : {}),
    },
    ...(input.shippingAddress ? { shippingAddress: input.shippingAddress } : {}),
    ...(input.billingAddress ? { billingAddress: input.billingAddress } : {}),
    allyUrlRedirection: {
      callbackUrl: input.callbackUrl,
      redirectionUrl: input.redirectionUrl,
      ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
    },
  };
}

function extractRedirectUrl(
  res: Response,
  body: Record<string, unknown> | null,
): string | null {
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307) {
    return res.headers.get("location") || res.headers.get("Location");
  }
  if (!body) return null;
  const links = body._links as Record<string, { href?: string }> | undefined;
  return String(
    body.redirectionUrl ||
      body.applicationUrl ||
      body.redirectUrl ||
      links?.webRedirect?.href ||
      "",
  ).trim() || null;
}

export async function createAddiOnlineApplication(
  input: AddiCreateApplicationInput,
): Promise<AddiCreateApplicationResult> {
  const token = await getFreshAddiAccessToken();
  const payload = buildAddiApplicationPayload(input);

  const res = await fetch(`${addiApiBase()}/v1/online-applications`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "manual",
  });

  let body: Record<string, unknown> | null = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
  }

  const redirectUrl = extractRedirectUrl(res, body);
  if (!redirectUrl) {
    throw new Error(
      `Addi create application: missing redirect (HTTP ${res.status}) ${text.slice(0, 300)}`,
    );
  }

  const applicationId = String(
    body?.id || body?.applicationId || body?.application_id || "",
  ).trim() || undefined;

  return {
    redirectUrl,
    httpStatus: res.status,
    applicationId,
  };
}

export async function cancelAddiOnlineApplication(
  applicationId: string,
  amountCop: number,
): Promise<Record<string, unknown>> {
  const id = String(applicationId || "").trim();
  if (!id) throw new Error("applicationId required");

  const token = await getFreshAddiAccessToken();
  const res = await fetch(`${addiApiBase()}/v1/online-applications/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: Math.round(Number(amountCop) || 0) }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Addi cancel ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!text) return { ok: true };
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: true, raw: text };
  }
}

export async function fetchAddiApplicationById(
  applicationId: string,
): Promise<AddiApplication | null> {
  const id = String(applicationId || "").trim();
  if (!id || !addiConfigured()) return null;
  return addiGet(`/v1/online-applications/${encodeURIComponent(id)}`);
}

export async function fetchAddiApplicationByOrderReference(
  orderReference: string,
): Promise<AddiApplication | null> {
  const ref = String(orderReference || "").trim();
  if (!ref || !addiConfigured()) return null;

  const q = encodeURIComponent(ref);
  const paths = [
    `/v1/online-applications?orderId=${q}`,
    `/v1/online-applications?reference=${q}`,
    `/v1/online-applications/by-order/${encodeURIComponent(ref)}`,
  ];

  for (const path of paths) {
    try {
      const token = await requestAddiAccessToken();
      const res = await fetch(`${addiApiBase()}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (res.status === 404) continue;
      if (!res.ok) continue;
      const body = await res.json();
      if (Array.isArray(body)) {
        const first = body[0];
        const app = normalizeApp(first as Record<string, unknown>);
        if (app) return app;
      }
      if (body && typeof body === "object") {
        const wrapped = body as {
          data?: Record<string, unknown> | Record<string, unknown>[];
          applications?: Record<string, unknown>[];
        };
        if (Array.isArray(wrapped.data) && wrapped.data.length) {
          return normalizeApp(wrapped.data[0] as Record<string, unknown>);
        }
        if (Array.isArray(wrapped.applications) && wrapped.applications.length) {
          return normalizeApp(wrapped.applications[0] as Record<string, unknown>);
        }
        const app = normalizeApp(wrapped.data as Record<string, unknown> || body as Record<string, unknown>);
        if (app) return app;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function defaultAddiCallbackUrl(): string {
  const configured = (Deno.env.get("ADDI_CALLBACK_URL") || "").trim();
  if (configured) return configured;
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  return base ? `${base}/functions/v1/catalog-order-status` : "";
}

export { addiConfigured, addiAllySlug, removeAccents, normalizePhone };
