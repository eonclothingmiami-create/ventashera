/**
 * Edge Function: ebay-oauth-exchange
 *
 * OAuth 2.0 Authorization Code Grant. Persistencia vía _shared/ebay_oauth.ts
 * (nunca refresh_token = "N/A"; status reauth_required; environment explícito).
 *
 * GET  ?action=authorize  → 302 a auth.ebay.com / auth.sandbox.ebay.com
 * GET  ?action=authorize-url → JSON con URL
 * GET  ?action=refresh    → refresh bajo demanda (usa lock + N/A-safe)
 * GET  ?action=status     → estado del token store (sin secretos)
 * GET  ?code=...          → authorization_code → persistEbayTokens
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  EBAY_OAUTH_SCOPES,
  ebayAuthorizeUrl,
  ebayApiHost,
  ebayEnvironment,
  ebayReauthPath,
  ensureEbayAccessToken,
  persistEbayTokens,
} from "../_shared/ebay_oauth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPECTED_STATE = "hera-ebay-prod";
const DEFAULT_RUNAME = "Hera_Swimwear-HeraSwim-HeraSw-bndiaam";

function env(name: string, fallback = ""): string {
  return (Deno.env.get(name) ?? fallback).trim();
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
  });
}

function ruName(): string {
  return env("EBAY_RUNAME", DEFAULT_RUNAME);
}

function looksLikeAuthnAuth(params: URLSearchParams, body: Record<string, unknown>): boolean {
  return !!(
    params.get("ebaytkn") != null ||
    params.get("tknexp") ||
    body.ebaytkn != null ||
    body.tknexp
  );
}

async function exchangeCode(code: string): Promise<{
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}> {
  const clientId = env("EBAY_CLIENT_ID");
  const clientSecret = env("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      status: 500,
      data: {
        error: "Faltan EBAY_CLIENT_ID / EBAY_CLIENT_SECRET en secrets de la Edge Function.",
      },
    };
  }
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${ebayApiHost()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: ruName(),
    }).toString(),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    data = { error: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  if (looksLikeAuthnAuth(url.searchParams, body)) {
    return json({
      ok: false,
      error:
        "Esto es Auth’n’Auth (ebaytkn/tknexp). No sirve para Inventory API. Usa action=authorize (OAuth 2.0).",
    }, 400);
  }

  const action = String(url.searchParams.get("action") || body.action || "").trim();
  const clientId = env("EBAY_CLIENT_ID");

  if (action === "authorize") {
    const id = clientId || String(url.searchParams.get("client_id") || "").trim();
    if (!id) {
      return json({
        ok: false,
        error: "Configura EBAY_CLIENT_ID o pasa client_id= (App ID).",
        ruName: ruName(),
        scopes: EBAY_OAUTH_SCOPES,
        environment: ebayEnvironment(),
        state: EXPECTED_STATE,
      }, 500);
    }
    return new Response(null, {
      status: 302,
      headers: { ...cors, Location: ebayAuthorizeUrl(id) },
    });
  }

  if (action === "authorize-url") {
    if (!clientId) {
      return json({
        ok: false,
        error: "Falta EBAY_CLIENT_ID",
        ruName: ruName(),
        scopes: EBAY_OAUTH_SCOPES,
        environment: ebayEnvironment(),
        state: EXPECTED_STATE,
      }, 500);
    }
    return json({
      ok: true,
      authorizeUrl: ebayAuthorizeUrl(clientId),
      ruName: ruName(),
      environment: ebayEnvironment(),
      state: EXPECTED_STATE,
    });
  }

  if (action === "status") {
    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: row, error } = await sb
      .from("ebay_oauth_tokens")
      .select(
        "expires_at, access_token_expires_at, refresh_token_expires_at, status, reauth_required, last_refresh_at, last_refresh_error, environment, scopes, updated_at",
      )
      .eq("id", "default")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!row) {
      return json({
        ok: false,
        needs_reauth: true,
        event: "EBAY_OAUTH_NO_TOKEN_ROW",
        authorize_url: ebayReauthPath(),
      }, 404);
    }
    return json({
      ok: !row.reauth_required && row.status !== "reauth_required",
      needs_reauth: Boolean(row.reauth_required) || row.status === "reauth_required",
      authorize_url: ebayReauthPath(),
      token: row,
    });
  }

  if (action === "refresh" || action === "keepalive") {
    // keepalive/refresh sin force=1: solo renueva si el access está por vencer.
    // force=1: refresh inmediato (p.ej. tras 401). Nunca es un loop agresivo cada minuto.
    const supabaseUrl = env("SUPABASE_URL");
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const force =
      String(url.searchParams.get("force") || "") === "1" ||
      body.force === true ||
      body.force === "1";
    const result = await ensureEbayAccessToken(sb, { forceRefresh: force });
    if (!result.ok) {
      return json({
        ok: false,
        needs_reauth: result.needsReauth,
        reauth_required: result.needsReauth,
        event: result.event,
        error: result.error,
        authorize_url: ebayReauthPath(),
      }, result.needsReauth ? 401 : 400);
    }
    return json({
      ok: true,
      refreshed: result.refreshed,
      event: result.refreshed ? "EBAY_OAUTH_REFRESH_SUCCESS" : "EBAY_OAUTH_TOKEN_VALID",
    });
  }

  const rawCode = String(url.searchParams.get("code") || body.code || "").trim();
  const state = String(url.searchParams.get("state") || body.state || "").trim();
  if (!rawCode) {
    if (
      req.method === "GET" &&
      (url.searchParams.get("format") === "html" ||
        (req.headers.get("accept") || "").includes("text/html"))
    ) {
      const href = clientId ? ebayAuthorizeUrl(clientId) : "";
      return html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>eBay OAuth</title></head>
<body style="font-family:sans-serif;max-width:40rem;margin:2rem auto;line-height:1.45">
<h1>eBay OAuth 2.0</h1>
<p>No uses Auth’n’Auth ni el botón del portal que termina en <code>ebaytkn</code>.</p>
${
        href
          ? `<p><a href="${href}">Autorizar Hera Swimwear en eBay</a></p>`
          : "<p>Configura <code>EBAY_CLIENT_ID</code> y <code>EBAY_CLIENT_SECRET</code>.</p>"
      }
</body></html>`);
    }
    return json({
      ok: false,
      error: "Pasa code= (OAuth moderno) o action=authorize",
      ruName: ruName(),
      environment: ebayEnvironment(),
      state: EXPECTED_STATE,
    }, 400);
  }

  if (state && state !== EXPECTED_STATE) {
    return json({ ok: false, error: `state inesperado: ${state}` }, 400);
  }

  let code = rawCode;
  try {
    code = decodeURIComponent(rawCode.replace(/\+/g, "%20"));
  } catch {
    code = rawCode;
  }
  const exchanged = await exchangeCode(code);
  if (!exchanged.ok) {
    const msg = String(
      exchanged.data.error_description || exchanged.data.error || "eBay rechazó authorization_code",
    );
    return json({
      ok: false,
      error: msg,
      ebay: exchanged.data,
      event: "EBAY_OAUTH_CODE_EXCHANGE_FAILED",
    }, exchanged.status >= 400 ? exchanged.status : 400);
  }

  const access = String(exchanged.data.access_token || "").trim();
  const refresh = String(exchanged.data.refresh_token || "").trim();
  const expiresIn = Number(exchanged.data.expires_in) || 7200;
  const refreshExpiresIn = exchanged.data.refresh_token_expires_in != null
    ? Number(exchanged.data.refresh_token_expires_in)
    : undefined;

  if (!refresh || refresh.toUpperCase() === "N/A") {
    return json({
      ok: false,
      error:
        "eBay no devolvió refresh_token usable. Revisa scopes sell.inventory / sell.account / sell.fulfillment en el consentimiento.",
      event: "EBAY_OAUTH_MISSING_REFRESH",
    }, 400);
  }
  if (!access) {
    return json({ ok: false, error: "eBay no devolvió access_token", event: "EBAY_OAUTH_MISSING_ACCESS" }, 400);
  }

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    await persistEbayTokens(sb, {
      accessToken: access,
      refreshToken: refresh,
      expiresIn,
      refreshExpiresIn,
      scopes: EBAY_OAUTH_SCOPES,
      clearReauth: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg, event: "EBAY_OAUTH_PERSIST_FAILED" }, 500);
  }

  const expiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString();
  const wantsHtml = (req.headers.get("accept") || "").includes("text/html") && req.method === "GET";
  if (wantsHtml) {
    return html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>eBay conectado</title></head>
<body style="font-family:sans-serif;max-width:40rem;margin:2rem auto">
<h1>eBay autorizado</h1>
<p>Access + refresh token guardados. Ya puedes publicar desde el ERP.</p>
</body></html>`);
  }

  return json({
    ok: true,
    stored: true,
    event: "EBAY_OAUTH_CODE_EXCHANGE_SUCCESS",
    token_type: exchanged.data.token_type || "User Access Token",
    expires_at: expiresAt,
    refresh_token_expires_in: refreshExpiresIn ?? null,
    environment: ebayEnvironment(),
    has_refresh_token: true,
    refresh_token_suffix: refresh.slice(-6),
  });
});
