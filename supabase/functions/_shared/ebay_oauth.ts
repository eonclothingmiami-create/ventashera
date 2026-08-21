/**
 * eBay OAuth Token Store — ciclo completo (Production).
 *
 * - Access token ~2h; refresh token larga duración (~18 meses).
 * - Refresh bajo demanda ante 401 / Invalid.
 * - Refresh preventivo solo si access está a < buffer de vencer.
 * - Mutex DB (refresh_lock_until) contra refreshes concurrentes.
 * - Nunca persistir refresh_token = "N/A".
 * - invalid_grant → status reauth_required (no reintentar en loop).
 * - Sin scope en el body del refresh (usa scopes del consent original).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const EBAY_ACCOUNT_ID = "default";

export const EBAY_OAUTH_SCOPES =
  "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment";

const TOKEN_ROW_ID = "default";
const ACCESS_BUFFER_MS = 5 * 60 * 1000;
const LOCK_TTL_MS = 25_000;
const LOCK_WAIT_MS = 28_000;
const LOCK_POLL_MS = 400;

export type EbayEnvironment = "production" | "sandbox";

export type EbayOAuthStatus = "active" | "reauth_required" | "refresh_failed";

export type EbayTokenRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  access_token_expires_at?: string | null;
  refresh_token_expires_at?: string | null;
  scopes?: string | null;
  environment?: string | null;
  ebay_user_id?: string | null;
  status?: string | null;
  last_refresh_at?: string | null;
  last_refresh_error?: string | null;
  reauth_required?: boolean | null;
  refresh_lock_until?: string | null;
  updated_at?: string | null;
};

export type EbayAuthResult =
  | { ok: true; accessToken: string; refreshed: boolean }
  | {
    ok: false;
    needsReauth: boolean;
    error: string;
    event: string;
    httpStatus?: number;
  };

function env(name: string, fallback = ""): string {
  return (Deno.env.get(name) ?? fallback).trim();
}

export function ebayEnvironment(): EbayEnvironment {
  const raw = (env("EBAY_ENVIRONMENT") || env("EBAY_ENV") || "production").toLowerCase();
  return raw === "sandbox" ? "sandbox" : "production";
}

export function ebayApiHost(): string {
  return ebayEnvironment() === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

export function ebayAuthHost(): string {
  return ebayEnvironment() === "sandbox"
    ? "https://auth.sandbox.ebay.com"
    : "https://auth.ebay.com";
}

export function ebayAuthorizeUrl(clientId?: string): string {
  const id = (clientId || env("EBAY_CLIENT_ID")).trim();
  const ru = env("EBAY_RUNAME", "Hera_Swimwear-HeraSwim-HeraSw-bndiaam");
  const u = new URL(`${ebayAuthHost()}/oauth2/authorize`);
  u.searchParams.set("client_id", id);
  u.searchParams.set("redirect_uri", ru);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", EBAY_OAUTH_SCOPES);
  u.searchParams.set("state", "hera-ebay-prod");
  return u.toString();
}

export function ebayReauthPath(): string {
  return "/functions/v1/ebay-oauth-exchange?action=authorize";
}

function logOauth(
  event: string,
  extra: Record<string, unknown> = {},
): void {
  console.info(JSON.stringify({
    event,
    account_id: EBAY_ACCOUNT_ID,
    environment: ebayEnvironment(),
    timestamp: new Date().toISOString(),
    ...extra,
  }));
}

function accessExpiresAt(row: EbayTokenRow | null): number {
  if (!row) return 0;
  const iso = row.access_token_expires_at || row.expires_at;
  return iso ? new Date(iso).getTime() : 0;
}

function isUsableRefreshToken(value: unknown): value is string {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (s.toUpperCase() === "N/A") return false;
  return true;
}

function classifyRefreshFailure(
  httpStatus: number,
  errorCode: string,
  description: string,
): { needsReauth: boolean; event: string } {
  const code = errorCode.toLowerCase();
  const desc = description.toLowerCase();
  const reauthHints = [
    "invalid_grant",
    "invalid_token",
    "unauthorized_client",
    "consent",
    "revoked",
    "expired",
  ];
  const needsReauth = reauthHints.some((h) => code.includes(h) || desc.includes(h)) ||
    httpStatus === 400 ||
    httpStatus === 401;
  return {
    needsReauth,
    event: needsReauth ? "EBAY_OAUTH_REAUTH_REQUIRED" : "EBAY_OAUTH_REFRESH_FAILED",
  };
}

async function loadTokenRow(sb: SupabaseClient): Promise<EbayTokenRow | null> {
  const { data, error } = await sb
    .from("ebay_oauth_tokens")
    .select("*")
    .eq("id", TOKEN_ROW_ID)
    .maybeSingle();
  if (error) {
    logOauth("EBAY_OAUTH_LOAD_FAILED", { error: error.message.slice(0, 200) });
    return null;
  }
  return data as EbayTokenRow | null;
}

async function markReauthRequired(
  sb: SupabaseClient,
  errorMsg: string,
): Promise<void> {
  await sb.from("ebay_oauth_tokens").upsert({
    id: TOKEN_ROW_ID,
    status: "reauth_required",
    reauth_required: true,
    last_refresh_error: errorMsg.slice(0, 500),
    refresh_lock_until: null,
    updated_at: new Date().toISOString(),
  });
}

async function tryAcquireRefreshLock(sb: SupabaseClient): Promise<boolean> {
  const until = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("ebay_oauth_tokens")
    .update({ refresh_lock_until: until, updated_at: nowIso })
    .eq("id", TOKEN_ROW_ID)
    .or(`refresh_lock_until.is.null,refresh_lock_until.lt.${nowIso}`)
    .select("id")
    .maybeSingle();
  if (error) {
    // Fallback: si la columna no existe aún, permitir refresh (migración pendiente).
    if (/refresh_lock_until|column/i.test(error.message)) return true;
    logOauth("EBAY_OAUTH_LOCK_ERROR", { error: error.message.slice(0, 200) });
    return false;
  }
  return Boolean(data?.id);
}

async function releaseRefreshLock(sb: SupabaseClient): Promise<void> {
  await sb.from("ebay_oauth_tokens").update({
    refresh_lock_until: null,
    updated_at: new Date().toISOString(),
  }).eq("id", TOKEN_ROW_ID);
}

async function waitForPeerRefresh(sb: SupabaseClient): Promise<string | null> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    const row = await loadTokenRow(sb);
    const exp = accessExpiresAt(row);
    const access = String(row?.access_token || "").trim();
    if (access && exp > Date.now() + ACCESS_BUFFER_MS) return access;
    if (row?.reauth_required || row?.status === "reauth_required") return null;
  }
  return null;
}

async function postRefreshToken(
  refreshToken: string,
): Promise<{
  ok: boolean;
  status: number;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
  error?: string;
  errorDescription?: string;
}> {
  const clientId = env("EBAY_CLIENT_ID");
  const clientSecret = env("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      status: 500,
      error: "missing_client_credentials",
      errorDescription: "Faltan EBAY_CLIENT_ID / EBAY_CLIENT_SECRET",
    };
  }

  const basic = btoa(`${clientId}:${clientSecret}`);
  // Sin scope: eBay usa los del consentimiento original (evita romper el refresh).
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(`${ebayApiHost()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: String(data.error || "refresh_failed"),
      errorDescription: String(data.error_description || text || "").slice(0, 400),
    };
  }

  const accessToken = String(data.access_token || "").trim();
  if (!accessToken) {
    return {
      ok: false,
      status: res.status,
      error: "missing_access_token",
      errorDescription: "eBay no devolvió access_token",
    };
  }

  return {
    ok: true,
    status: res.status,
    accessToken,
    refreshToken: isUsableRefreshToken(data.refresh_token)
      ? String(data.refresh_token).trim()
      : undefined,
    expiresIn: Number(data.expires_in) || 7200,
    refreshExpiresIn: data.refresh_token_expires_in != null
      ? Number(data.refresh_token_expires_in)
      : undefined,
  };
}

/**
 * Persiste tokens tras authorization_code o refresh exitoso.
 * Nunca escribe refresh_token = "N/A".
 */
export async function persistEbayTokens(
  sb: SupabaseClient,
  input: {
    accessToken: string;
    refreshToken?: string | null;
    expiresIn?: number;
    refreshExpiresIn?: number;
    scopes?: string;
    clearReauth?: boolean;
  },
): Promise<void> {
  const now = Date.now();
  const accessExpires = new Date(
    now + Math.max(60, Number(input.expiresIn) || 7200) * 1000,
  ).toISOString();

  const patch: Record<string, unknown> = {
    id: TOKEN_ROW_ID,
    access_token: input.accessToken,
    expires_at: accessExpires,
    access_token_expires_at: accessExpires,
    environment: ebayEnvironment(),
    scopes: input.scopes || EBAY_OAUTH_SCOPES,
    last_refresh_at: new Date().toISOString(),
    last_refresh_error: null,
    refresh_lock_until: null,
    updated_at: new Date().toISOString(),
  };

  if (input.clearReauth !== false) {
    patch.status = "active";
    patch.reauth_required = false;
  }

  if (isUsableRefreshToken(input.refreshToken)) {
    patch.refresh_token = String(input.refreshToken).trim();
  }

  if (input.refreshExpiresIn != null && Number(input.refreshExpiresIn) > 0) {
    patch.refresh_token_expires_at = new Date(
      now + Number(input.refreshExpiresIn) * 1000,
    ).toISOString();
  }

  const { error } = await sb.from("ebay_oauth_tokens").upsert(patch);
  if (error) throw new Error(`No se pudo guardar tokens eBay: ${error.message}`);
}

/**
 * Obtiene un access token usable.
 * forceRefresh=true: ignora AT en caché (p.ej. tras 401).
 */
export async function ensureEbayAccessToken(
  sb: SupabaseClient,
  opts: { forceRefresh?: boolean } = {},
): Promise<EbayAuthResult> {
  const row = await loadTokenRow(sb);

  if (row?.reauth_required || row?.status === "reauth_required") {
    logOauth("EBAY_OAUTH_REAUTH_REQUIRED", {
      last_refresh_error: String(row.last_refresh_error || "").slice(0, 200),
    });
    return {
      ok: false,
      needsReauth: true,
      error: String(row.last_refresh_error || "eBay requiere reautorización").slice(0, 400),
      event: "EBAY_OAUTH_REAUTH_REQUIRED",
    };
  }

  const access = String(row?.access_token || env("EBAY_ACCESS_TOKEN") || "").trim();
  const exp = accessExpiresAt(row);
  if (
    !opts.forceRefresh &&
    access &&
    exp > Date.now() + ACCESS_BUFFER_MS
  ) {
    return { ok: true, accessToken: access, refreshed: false };
  }

  const refresh = String(row?.refresh_token || env("EBAY_REFRESH_TOKEN") || "").trim();
  if (!isUsableRefreshToken(refresh)) {
    logOauth("EBAY_OAUTH_REAUTH_REQUIRED", { reason: "missing_refresh_token" });
    await markReauthRequired(sb, "Sin refresh_token. Completa OAuth.");
    return {
      ok: false,
      needsReauth: true,
      error: `Sin refresh_token. Reautoriza: ${ebayReauthPath()}`,
      event: "EBAY_OAUTH_REAUTH_REQUIRED",
    };
  }

  const locked = await tryAcquireRefreshLock(sb);
  if (!locked) {
    logOauth("EBAY_OAUTH_REFRESH_WAIT_LOCK");
    const peer = await waitForPeerRefresh(sb);
    if (peer) return { ok: true, accessToken: peer, refreshed: true };
    const again = await loadTokenRow(sb);
    if (again?.reauth_required) {
      return {
        ok: false,
        needsReauth: true,
        error: String(again.last_refresh_error || "Reautorización requerida"),
        event: "EBAY_OAUTH_REAUTH_REQUIRED",
      };
    }
    // Reintentar adquirir lock una vez
    const locked2 = await tryAcquireRefreshLock(sb);
    if (!locked2) {
      return {
        ok: false,
        needsReauth: false,
        error: "Otro proceso está renovando el token eBay; reintenta en unos segundos",
        event: "EBAY_OAUTH_REFRESH_LOCK_BUSY",
      };
    }
  }

  logOauth("EBAY_OAUTH_REFRESH_STARTED", { force: !!opts.forceRefresh });
  try {
    const exchanged = await postRefreshToken(refresh);
    if (!exchanged.ok || !exchanged.accessToken) {
      const classified = classifyRefreshFailure(
        exchanged.status,
        exchanged.error || "",
        exchanged.errorDescription || "",
      );
      const msg = `${exchanged.error || "refresh_failed"}: ${exchanged.errorDescription || ""}`
        .trim()
        .slice(0, 400);
      logOauth(classified.event, {
        http_status: exchanged.status,
        error: exchanged.error,
        error_description: String(exchanged.errorDescription || "").slice(0, 200),
      });
      if (classified.needsReauth) {
        await markReauthRequired(sb, msg);
      } else {
        await sb.from("ebay_oauth_tokens").update({
          status: "refresh_failed",
          last_refresh_error: msg,
          refresh_lock_until: null,
          updated_at: new Date().toISOString(),
        }).eq("id", TOKEN_ROW_ID);
      }
      return {
        ok: false,
        needsReauth: classified.needsReauth,
        error: classified.needsReauth
          ? `${msg}. Reautoriza: ${ebayReauthPath()}`
          : msg,
        event: classified.event,
        httpStatus: exchanged.status,
      };
    }

    await persistEbayTokens(sb, {
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken, // undefined si N/A → se conserva el anterior
      expiresIn: exchanged.expiresIn,
      refreshExpiresIn: exchanged.refreshExpiresIn,
      clearReauth: true,
    });

    logOauth("EBAY_OAUTH_REFRESH_SUCCESS", {
      access_expires_in: exchanged.expiresIn,
      refresh_rotated: Boolean(exchanged.refreshToken),
    });

    return { ok: true, accessToken: exchanged.accessToken, refreshed: true };
  } finally {
    await releaseRefreshLock(sb).catch(() => {});
  }
}

/** True si la respuesta eBay indica access token inválido/expirado (candidato a refresh+retry). */
export function isEbayInvalidAccessTokenError(
  status: number,
  body: unknown,
): boolean {
  if (status !== 401) return false;
  const text = typeof body === "string"
    ? body
    : JSON.stringify(body ?? "");
  return /invalid.?access.?token|access token|unauthorized|authentication/i.test(text);
}

/**
 * fetch a eBay API con Bearer; ante 401 Invalid access token → refresh + 1 retry.
 */
export async function ebayAuthorizedFetch(
  sb: SupabaseClient,
  path: string,
  init: RequestInit = {},
): Promise<{ res: Response; text: string; retried: boolean }> {
  const auth = await ensureEbayAccessToken(sb);
  if (!auth.ok) {
    throw new Error(auth.error);
  }

  const url = path.startsWith("http") ? path : `${ebayApiHost()}${path}`;
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${auth.accessToken}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let res = await fetch(url, { ...init, headers });
  let text = await res.text();
  let retried = false;

  if (isEbayInvalidAccessTokenError(res.status, text)) {
    logOauth("EBAY_OAUTH_401_RETRY", { path: path.slice(0, 120) });
    const refreshed = await ensureEbayAccessToken(sb, { forceRefresh: true });
    if (!refreshed.ok) throw new Error(refreshed.error);
    headers.set("Authorization", `Bearer ${refreshed.accessToken}`);
    res = await fetch(url, { ...init, headers });
    text = await res.text();
    retried = true;
  }

  return { res, text, retried };
}

export async function ebayAuthorizedJson(
  sb: SupabaseClient,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; retried: boolean }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const { res, text, retried } = await ebayAuthorizedFetch(sb, path, init);
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
  }
  return { ok: res.ok, status: res.status, data, retried };
}
