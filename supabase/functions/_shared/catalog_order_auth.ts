/**
 * Auth para edge functions de pedidos del catálogo.
 * Acepta:
 * 1) Header x-catalog-order-secret == CATALOG_ORDER_SECRET
 * 2) Bearer/apikey JWT del proyecto (role anon | authenticated | service_role)
 * 3) Exact match con SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 * 4) Si no hay CATALOG_ORDER_SECRET configurado → permite (legacy)
 */
function projectRefFromUrl(): string {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const m = url.match(/https:\/\/([^.]+)\.supabase\.co/i);
  return m?.[1] || "";
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function catalogOrderAuthOk(req: Request): boolean {
  const secret = (Deno.env.get("CATALOG_ORDER_SECRET") || "").trim();
  const hdr = (req.headers.get("x-catalog-order-secret") || "").trim();
  if (secret && hdr === secret) return true;

  const auth = (req.headers.get("authorization") || "").trim();
  const apikey = (req.headers.get("apikey") || "").trim();
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const token = bearer || apikey;

  if (token) {
    const anon = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
    const service = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    if (anon && token === anon) return true;
    if (service && token === service) return true;

    const payload = decodeJwtPayload(token);
    if (payload) {
      const role = String(payload.role || "");
      const ref = String(payload.ref || "");
      const projectRef = projectRefFromUrl();
      const roleOk =
        role === "anon" ||
        role === "authenticated" ||
        role === "service_role";
      const refOk = !projectRef || !ref || ref === projectRef;
      if (roleOk && refOk) return true;
    }
  }

  return !secret;
}
