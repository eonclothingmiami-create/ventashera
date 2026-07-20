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
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();

  if (serviceKey && (bearer === serviceKey || apikey === serviceKey)) return true;
  if (
    mode === "client" &&
    anonKey &&
    (bearer === anonKey || apikey === anonKey)
  ) return true;
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
