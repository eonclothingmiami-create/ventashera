import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type OrderAuthMode = "client" | "user" | "privileged";

function bearerToken(req: Request): string {
  const auth = (req.headers.get("authorization") || "").trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function configuredSecretOk(req: Request): boolean {
  const secret = (Deno.env.get("CATALOG_ORDER_SECRET") || "").trim();
  const supplied = (req.headers.get("x-catalog-order-secret") || "").trim();
  return Boolean(secret && supplied && supplied === secret);
}

function projectRef(): string {
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const m = url.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return (m?.[1] || "").toLowerCase();
}

/** Decodifica payload JWT sin verificar firma (la gateway ya validó si verify_jwt=true). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(pad);
    const payload = JSON.parse(json);
    return payload && typeof payload === "object"
      ? payload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Acepta:
 * - JWT legacy anon/authenticated del mismo proyecto
 * - publishable key nueva (sb_publishable_…)
 * - igualdad exacta con SUPABASE_ANON_KEY (legacy o publishable)
 */
function clientApiKeyOk(token: string): boolean {
  if (!token) return false;
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
  if (anonKey && token === anonKey) return true;

  // Nueva API key publishable (no es JWT)
  if (token.startsWith("sb_publishable_")) return true;

  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const role = String(payload.role || "").toLowerCase();
  if (role !== "anon" && role !== "authenticated") return false;
  const ref = String(payload.ref || "").toLowerCase();
  const expected = projectRef();
  if (expected && ref && ref !== expected) return false;
  return true;
}

async function verifiedUserToken(token: string): Promise<boolean> {
  if (!token) return false;
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !serviceKey) return false;

  try {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.getUser(token);
    return !error && Boolean(data.user?.id);
  } catch {
    return false;
  }
}

async function catalogOrderAuthOk(
  req: Request,
  mode: OrderAuthMode,
): Promise<boolean> {
  if (configuredSecretOk(req)) return true;

  const bearer = bearerToken(req);
  const apikey = (req.headers.get("apikey") || "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

  if (serviceKey && (bearer === serviceKey || apikey === serviceKey)) return true;

  if (mode === "client") {
    if (clientApiKeyOk(bearer) || clientApiKeyOk(apikey)) return true;
  }

  if (mode !== "privileged" && await verifiedUserToken(bearer)) return true;

  return false;
}

export function catalogOrderClientAuthOk(req: Request): Promise<boolean> {
  return catalogOrderAuthOk(req, "client");
}

export function catalogOrderUserAuthOk(req: Request): Promise<boolean> {
  return catalogOrderAuthOk(req, "user");
}

export function catalogOrderPrivilegedAuthOk(req: Request): Promise<boolean> {
  return catalogOrderAuthOk(req, "privileged");
}

/** Alias usado por algunas funciones antiguas. */
export function catalogOrderAuthOkExport(req: Request): Promise<boolean> {
  return catalogOrderClientAuthOk(req);
}

export { catalogOrderAuthOk };
