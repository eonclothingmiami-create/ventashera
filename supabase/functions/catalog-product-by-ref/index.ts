/**
 * GET ?ref=HERA-13003 — producto público por ref (o alias legacy).
 * También: path /catalog-product-by-ref/HERA-13003 si el gateway lo pasa.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { publicProductPayload, type ProductRow } from "../_shared/catalog_product_public.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function refFromUrl(url: URL): string {
  const q = String(url.searchParams.get("ref") || "").trim();
  if (q) return q;
  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (last && last !== "catalog-product-by-ref") return last;
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const rawRef = refFromUrl(new URL(req.url));
  if (!rawRef) {
    return json({ error: "missing_ref" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: resolved, error: resolveErr } = await sb.rpc("resolve_product_ref", {
    p_legacy: rawRef,
  });
  if (resolveErr) {
    console.error("resolve_product_ref", resolveErr);
    return json({ error: "resolve_failed" }, 500);
  }

  const ref = String(resolved || rawRef).trim().toUpperCase();
  const select =
    "id,ref,name,description,price,stock,seccion,categoria,updated_at,product_media(url,is_cover)";

  const { data, error } = await sb
    .from("products")
    .select(select)
    .eq("ref", ref)
    .eq("active", true)
    .eq("visible", true)
    .maybeSingle();

  if (error) {
    console.error("products", error);
    return json({ error: "db_error" }, 500);
  }
  if (!data) {
    return json({ error: "not_found", ref }, 404);
  }

  return json(publicProductPayload(data as ProductRow));
});
