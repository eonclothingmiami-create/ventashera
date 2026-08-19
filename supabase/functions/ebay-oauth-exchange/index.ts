/**
 * Edge Function: ebay-oauth-exchange
 *
 * OAuth 2.0 Authorization Code Grant (Production). No Auth’n’Auth / ebaytkn.
 *
 * Docs: https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html
 *
 * GET  ?action=authorize  → 302 a https://auth.ebay.com/oauth2/authorize
 * GET  ?code=...          → intercambia el code y guarda refresh token
 * POST { code, state? }   → igual
 *
 * Secrets:
 *   EBAY_CLIENT_ID / EBAY_CLIENT_SECRET
 *   EBAY_RUNAME — default RuName Production Hera Swimwear
 *
 * redirect_uri del authorize y del token DEBE ser el RuName, no la URL https.
 * Callback público registrado: https://heraswimsuit.com/ebay/oauth/accepted?code=...
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPECTED_STATE = "hera-ebay-prod";
const DEFAULT_RUNAME = "Hera_Swimwear-HeraSwim-HeraSw-bndiaam";
const SCOPES =
  "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment";

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

function buildAuthorizeUrl(clientId: string): string {
  const u = new URL("https://auth.ebay.com/oauth2/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", ruName());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", EXPECTED_STATE);
  return u.toString();
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
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
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
        "Esto es Auth’n’Auth (ebaytkn/tknexp). No sirve para Inventory API. Usa la URL de auth.ebay.com/oauth2/authorize.",
    }, 400);
  }

  const action = String(url.searchParams.get("action") || body.action || "").trim();
  const clientId = env("EBAY_CLIENT_ID");

  if (action === "authorize") {
    const id = clientId || String(url.searchParams.get("client_id") || "").trim();
    if (!id) {
      return json({
        ok: false,
        error: "Configura EBAY_CLIENT_ID o pasa client_id= (App ID Production).",
        ruName: ruName(),
        scopes: SCOPES,
        state: EXPECTED_STATE,
      }, 500);
    }
    return new Response(null, {
      status: 302,
      headers: { ...cors, Location: buildAuthorizeUrl(id) },
    });
  }

  if (action === "authorize-url") {
    if (!clientId) {
      return json({
        ok: false,
        error: "Falta EBAY_CLIENT_ID",
        ruName: ruName(),
        scopes: SCOPES,
        state: EXPECTED_STATE,
      }, 500);
    }
    return json({
      ok: true,
      authorizeUrl: buildAuthorizeUrl(clientId),
      ruName: ruName(),
      state: EXPECTED_STATE,
    });
  }

  const rawCode = String(url.searchParams.get("code") || body.code || "").trim();
  const state = String(url.searchParams.get("state") || body.state || "").trim();
  if (!rawCode) {
    if (req.method === "GET" && (url.searchParams.get("format") === "html" || (req.headers.get("accept") || "").includes("text/html"))) {
      const href = clientId ? buildAuthorizeUrl(clientId) : "";
      return html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>eBay OAuth</title></head>
<body style="font-family:sans-serif;max-width:40rem;margin:2rem auto;line-height:1.45">
<h1>eBay OAuth 2.0</h1>
<p>No uses Auth’n’Auth ni el botón del portal que termina en <code>ebaytkn</code>.</p>
${href ? `<p><a href="${href}">Autorizar Hera Swimwear en eBay US</a></p>` : "<p>Configura <code>EBAY_CLIENT_ID</code> y <code>EBAY_CLIENT_SECRET</code>.</p>"}
</body></html>`);
    }
    return json({
      ok: false,
      error: "Pasa code= (OAuth moderno) o action=authorize",
      ruName: ruName(),
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
    return json({ ok: false, error: msg, ebay: exchanged.data }, exchanged.status >= 400 ? exchanged.status : 400);
  }

  const access = String(exchanged.data.access_token || "").trim();
  const refresh = String(exchanged.data.refresh_token || "").trim();
  const expiresIn = Number(exchanged.data.expires_in) || 7200;
  if (!refresh) {
    return json({
      ok: false,
      error: "eBay no devolvió refresh_token. Revisa scopes sell.inventory / sell.account / sell.fulfillment en el consentimiento.",
    }, 400);
  }

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const expiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString();
  const { error } = await sb.from("ebay_oauth_tokens").upsert({
    id: "default",
    access_token: access || null,
    refresh_token: refresh,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    return json({ ok: false, error: "No se pudo guardar el token: " + error.message }, 500);
  }

  const wantsHtml = (req.headers.get("accept") || "").includes("text/html") && req.method === "GET";
  if (wantsHtml) {
    return html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>eBay conectado</title></head>
<body style="font-family:sans-serif;max-width:40rem;margin:2rem auto">
<h1>Refresh token guardado</h1>
<p>Ya puedes volver al ERP y publicar en eBay US.</p>
</body></html>`);
  }

  return json({
    ok: true,
    stored: true,
    token_type: exchanged.data.token_type || "User Access Token",
    expires_at: expiresAt,
    has_refresh_token: true,
    refresh_token_suffix: refresh.slice(-6),
  });
});
