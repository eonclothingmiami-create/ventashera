/**
 * Catalog API v1 — contrato público AI-ready.
 *
 * Rutas (tras rewrite Hostinger /api/v1/*):
 *   GET  /capabilities
 *   GET  /openapi.json
 *   GET  /resolve?id=
 *   GET  /products
 *   GET  /products/{ref}
 *   GET  /products/{ref}/related?intent=similar|kimono|cover_up|pairs_with|completes_outfit
 *   GET  /products/{ref}/knowledge
 *   POST /search
 *   GET  /collections
 *   GET  /collections/{slug}
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  CAPABILITIES_V1,
  PRODUCT_SELECT_V1,
  catalogProductV1,
  type ProductJoinRow,
} from "../_shared/catalog_api_v1.ts";
import { OPENAPI_V1 } from "../_shared/catalog_api_v1_openapi.ts";
import {
  buildProductKnowledge,
  relatedFromGraphOrFallback,
} from "../_shared/catalog_api_v1_knowledge.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hera-channel",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
      ...extra,
    },
  });
}

function sb(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Path after /catalog-api-v1 */
function routePath(url: URL): string[] {
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "catalog-api-v1");
  const rest = idx >= 0 ? parts.slice(idx + 1) : parts;
  // Also accept ?path=/products/...
  const qPath = String(url.searchParams.get("path") || "").trim();
  if (!rest.length && qPath) {
    return qPath.replace(/^\//, "").split("/").filter(Boolean);
  }
  return rest;
}

async function resolveRef(client: SupabaseClient, raw: string): Promise<string> {
  const input = String(raw || "").trim();
  if (!input) return "";
  const { data } = await client.rpc("resolve_product_ref", { p_legacy: input });
  return String(data || input).trim().toUpperCase();
}

async function loadProduct(client: SupabaseClient, ref: string) {
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_SELECT_V1)
    .eq("ref", ref)
    .eq("active", true)
    .eq("visible", true)
    .maybeSingle();
  if (error) throw error;
  return data as ProductJoinRow | null;
}

type SearchFilters = {
  q?: string;
  in_stock?: boolean;
  max_price?: number;
  min_price?: number;
  product_type?: string;
  style?: string;
  occasion?: string;
  fit_goal?: string;
  collection?: string;
  seccion?: string;
  categoria?: string;
  limit?: number;
  cursor?: number;
};

function parseFiltersFromUrl(url: URL): SearchFilters {
  const n = (k: string) => {
    const v = url.searchParams.get(k);
    if (v == null || v === "") return undefined;
    const num = Number(v);
    return Number.isFinite(num) ? num : undefined;
  };
  const s = (k: string) => {
    const v = url.searchParams.get(k);
    return v && v.trim() ? v.trim() : undefined;
  };
  const stock = url.searchParams.get("in_stock");
  return {
    q: s("q"),
    in_stock: stock == null ? undefined : stock === "1" || stock === "true",
    max_price: n("max_price"),
    min_price: n("min_price"),
    product_type: s("product_type"),
    style: s("style"),
    occasion: s("occasion"),
    fit_goal: s("fit_goal"),
    collection: s("collection"),
    seccion: s("seccion"),
    categoria: s("categoria"),
    limit: Math.min(48, Math.max(1, n("limit") || 24)),
    cursor: Math.max(0, n("cursor") || 0),
  };
}

async function searchProducts(client: SupabaseClient, f: SearchFilters) {
  const limit = f.limit ?? 24;
  const cursor = f.cursor ?? 0;

  let query = client
    .from("products")
    .select(PRODUCT_SELECT_V1, { count: "exact" })
    .eq("active", true)
    .eq("visible", true)
    .order("updated_at", { ascending: false })
    .range(cursor, cursor + limit - 1);

  if (f.in_stock === true) query = query.gt("stock", 0);
  if (f.in_stock === false) query = query.lte("stock", 0);
  if (f.max_price != null) query = query.lte("price", f.max_price);
  if (f.min_price != null) query = query.gte("price", f.min_price);
  if (f.seccion) query = query.ilike("seccion", f.seccion);
  if (f.categoria) query = query.ilike("categoria", f.categoria);

  // Attribute filters via !inner when present
  const needsAttr = Boolean(
    f.product_type || f.style || f.occasion || f.fit_goal || f.collection,
  );

  if (needsAttr) {
    // Re-select with inner join semantics by filtering refs first
    let attrQ = client.from("product_attributes").select("ref");
    if (f.product_type) attrQ = attrQ.eq("product_type", f.product_type);
    if (f.style) attrQ = attrQ.contains("style", [f.style]);
    if (f.occasion) attrQ = attrQ.contains("occasions", [f.occasion]);
    if (f.fit_goal) attrQ = attrQ.contains("fit_goals", [f.fit_goal]);
    if (f.collection) attrQ = attrQ.contains("collection_slugs", [f.collection]);
    const { data: attrRows, error: attrErr } = await attrQ;
    if (attrErr) throw attrErr;
    const refs = (attrRows || []).map((r: { ref: string }) => r.ref);
    if (!refs.length) {
      return { items: [] as ReturnType<typeof catalogProductV1>[], total: 0, next_cursor: null as number | null };
    }
    query = query.in("ref", refs);
  }

  if (f.q) {
    const q = f.q.replace(/%/g, "").slice(0, 120);
    // Prefer search docs trigram text; fallback name/ref
    const { data: docHits } = await client
      .from("product_search_docs")
      .select("ref")
      .ilike("embedding_text", `%${q}%`)
      .limit(200);
    const docRefs = (docHits || []).map((d: { ref: string }) => d.ref);
    if (docRefs.length) {
      query = query.in("ref", docRefs);
    } else {
      query = query.or(`name.ilike.%${q}%,ref.ilike.%${q}%,description.ilike.%${q}%`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const items = (data || []).map((row) => catalogProductV1(row as ProductJoinRow));
  const total = count ?? items.length;
  const next_cursor = cursor + items.length < total ? cursor + items.length : null;
  return { items, total, next_cursor };
}

async function relatedProducts(
  client: SupabaseClient,
  product: ReturnType<typeof catalogProductV1>,
  intent: string,
) {
  return relatedFromGraphOrFallback(client, product, intent, async () => {
    const filters: SearchFilters = {
      in_stock: true,
      limit: 8,
      cursor: 0,
    };

    if (intent === "kimono" || intent === "cover_up" || intent === "completes_outfit") {
      filters.product_type = "cover_up";
    } else if (intent === "similar" || intent === "alternative") {
      if (product.product_type) filters.product_type = product.product_type;
      else if (product.taxonomy.categoria) filters.categoria = product.taxonomy.categoria;
    } else if (product.occasions[0]) {
      filters.occasion = product.occasions[0];
    }

    const { items } = await searchProducts(client, filters);
    return items.filter((p) => p.ref !== product.ref).slice(0, 8);
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const parts = routePath(url);
  const client = sb();

  try {
    // GET /capabilities
    if (req.method === "GET" && (parts[0] === "capabilities" || parts.length === 0)) {
      return json(CAPABILITIES_V1);
    }

    // GET /openapi.json
    if (req.method === "GET" && parts[0] === "openapi.json") {
      return json(OPENAPI_V1);
    }

    // GET /resolve?id=
    if (req.method === "GET" && parts[0] === "resolve") {
      const id = String(url.searchParams.get("id") || "").trim();
      if (!id) return json({ error: "missing_id" }, 400);
      const ref = await resolveRef(client, id);
      const row = await loadProduct(client, ref);
      if (!row) return json({ error: "not_found", id, ref }, 404);
      return json({ input: id, ref, product: catalogProductV1(row) });
    }

    // GET /collections
    if (req.method === "GET" && parts[0] === "collections" && !parts[1]) {
      const { data, error } = await client
        .from("catalog_collections")
        .select("slug,title,description,query,sort_order")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return json({ collections: data || [] });
    }

    // GET /collections/{slug}
    if (req.method === "GET" && parts[0] === "collections" && parts[1]) {
      const slug = parts[1];
      const { data: col, error } = await client
        .from("catalog_collections")
        .select("slug,title,description,query")
        .eq("slug", slug)
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      if (!col) return json({ error: "not_found", slug }, 404);

      const q = (col.query || {}) as Record<string, unknown>;
      const filters: SearchFilters = {
        in_stock: true,
        limit: Math.min(48, Math.max(1, Number(url.searchParams.get("limit")) || 24)),
        cursor: Math.max(0, Number(url.searchParams.get("cursor")) || 0),
        style: Array.isArray(q.style) ? String(q.style[0]) : undefined,
        occasion: Array.isArray(q.occasions) ? String(q.occasions[0]) : undefined,
        fit_goal: Array.isArray(q.fit_goals) ? String(q.fit_goals[0]) : undefined,
        collection: slug,
      };
      // Prefer collection slug match; also OR style/occasion from query via collection filter
      const result = await searchProducts(client, filters);
      return json({
        collection: col,
        ...result,
      });
    }

    // GET /products/{ref}/knowledge
    if (
      req.method === "GET" &&
      parts[0] === "products" &&
      parts[1] &&
      parts[2] === "knowledge"
    ) {
      const ref = await resolveRef(client, parts[1]);
      const row = await loadProduct(client, ref);
      if (!row) return json({ error: "not_found", ref }, 404);
      const product = catalogProductV1(row);
      const knowledge = await buildProductKnowledge(client, product);
      return json(knowledge);
    }

    // GET /products/{ref}/related
    if (
      req.method === "GET" &&
      parts[0] === "products" &&
      parts[1] &&
      parts[2] === "related"
    ) {
      const ref = await resolveRef(client, parts[1]);
      const row = await loadProduct(client, ref);
      if (!row) return json({ error: "not_found", ref }, 404);
      const product = catalogProductV1(row);
      const intent = String(url.searchParams.get("intent") || "similar").trim();
      const related = await relatedProducts(client, product, intent);
      return json({ ref, intent, items: related });
    }

    // GET /products/{ref}
    if (req.method === "GET" && parts[0] === "products" && parts[1] && !parts[2]) {
      const ref = await resolveRef(client, parts[1]);
      const row = await loadProduct(client, ref);
      if (!row) return json({ error: "not_found", ref }, 404);
      return json(catalogProductV1(row));
    }

    // GET /products
    if (req.method === "GET" && parts[0] === "products" && !parts[1]) {
      const filters = parseFiltersFromUrl(url);
      const result = await searchProducts(client, filters);
      return json(result);
    }

    // POST /search
    if (req.method === "POST" && parts[0] === "search") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const filters: SearchFilters = {
        q: body.q != null ? String(body.q) : undefined,
        in_stock: typeof body.in_stock === "boolean" ? body.in_stock : undefined,
        max_price: body.max_price != null ? Number(body.max_price) : undefined,
        min_price: body.min_price != null ? Number(body.min_price) : undefined,
        product_type: body.product_type != null ? String(body.product_type) : undefined,
        style: body.style != null ? String(body.style) : undefined,
        occasion: body.occasion != null ? String(body.occasion) : undefined,
        fit_goal: body.fit_goal != null ? String(body.fit_goal) : undefined,
        collection: body.collection != null ? String(body.collection) : undefined,
        seccion: body.seccion != null ? String(body.seccion) : undefined,
        categoria: body.categoria != null ? String(body.categoria) : undefined,
        limit: Math.min(48, Math.max(1, Number(body.limit) || 24)),
        cursor: Math.max(0, Number(body.cursor) || 0),
      };
      const result = await searchProducts(client, filters);
      return json({
        query: filters,
        mode: "keyword_faceted",
        ...result,
      });
    }

    return json({ error: "not_found", path: parts.join("/") }, 404);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[catalog-api-v1]", msg);
    return json({ error: "server_error", message: msg.slice(0, 300) }, 500);
  }
});
