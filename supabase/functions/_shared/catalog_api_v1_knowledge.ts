/**
 * Knowledge Graph projection for Catalog API v1.
 * Source of truth = knowledge_nodes + knowledge_edges.
 * /products/{ref}/knowledge is a VIEW, not a dump of legacy tables.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PRODUCT_SELECT_V1, catalogProductV1, type ProductJoinRow } from "./catalog_api_v1.ts";

export type CatalogProduct = ReturnType<typeof catalogProductV1>;

type KgNode = {
  id: string;
  node_type: string;
  external_key: string;
  title: string;
  url: string | null;
  thumbnail_url: string | null;
  locale: string;
  meta: Record<string, unknown> | null;
  published_at: string | null;
};

type KgEdge = {
  id: number;
  relation_type: string;
  score: number;
  source: string;
  meta: Record<string, unknown> | null;
  to_node: KgNode | KgNode[] | null;
};

function nodePayload(n: KgNode | null | undefined) {
  if (!n) return null;
  const meta = (n.meta || {}) as Record<string, unknown>;
  return {
    id: n.id,
    type: n.node_type,
    key: n.external_key,
    title: n.title,
    url: n.url,
    thumbnail_url: n.thumbnail_url,
    locale: n.locale,
    published_at: n.published_at,
    ref: typeof meta.ref === "string" ? meta.ref : null,
    slug: typeof meta.slug === "string" ? meta.slug : null,
    meta,
  };
}

function edgeTarget(edge: KgEdge) {
  const raw = edge.to_node;
  const n = Array.isArray(raw) ? raw[0] : raw;
  return {
    relation: edge.relation_type,
    score: Number(edge.score),
    source: edge.source,
    node: nodePayload(n),
  };
}

export async function loadProductsByRefs(client: SupabaseClient, refs: string[]) {
  if (!refs.length) return [] as CatalogProduct[];
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_SELECT_V1)
    .in("ref", refs)
    .eq("active", true)
    .eq("visible", true);
  if (error) throw error;
  const map = new Map(
    (data || []).map((row) => {
      const p = catalogProductV1(row as ProductJoinRow);
      return [p.ref, p] as const;
    }),
  );
  return refs.map((r) => map.get(r)).filter(Boolean) as CatalogProduct[];
}

export async function loadRelations(
  client: SupabaseClient,
  ref: string,
  types?: string[],
) {
  // Legacy bridge for /related — prefer graph product→product edges
  const key = `product:${ref}`;
  const { data: node } = await client
    .from("knowledge_nodes")
    .select("id")
    .eq("node_type", "product")
    .eq("external_key", key)
    .maybeSingle();
  if (!node?.id) return [] as Array<{ to_ref: string; relation_type: string; score: number; source: string }>;

  let q = client
    .from("knowledge_edges")
    .select(
      "relation_type,score,source,to_node:knowledge_nodes!knowledge_edges_to_node_id_fkey(external_key,node_type,meta)",
    )
    .eq("from_node_id", node.id)
    .eq("active", true)
    .in("relation_type", [
      "pairs_with",
      "completes",
      "similar_to",
      "upsell",
      "same_look",
      "alternative",
      "related_to",
    ])
    .order("score", { ascending: false })
    .limit(24);
  if (types?.length) {
    const mapped = types.map((t) =>
      t === "completes_outfit" ? "completes" : t === "similar" ? "similar_to" : t
    );
    q = q.in("relation_type", mapped);
  }
  const { data, error } = await q;
  if (error) throw error;

  return (data || [])
    .map((e: Record<string, unknown>) => {
      const to = e.to_node as { external_key?: string; node_type?: string; meta?: { ref?: string } } | null;
      const toRef =
        to?.meta?.ref ||
        (to?.external_key?.startsWith("product:") ? to.external_key.slice(8) : "");
      if (!toRef) return null;
      return {
        to_ref: toRef,
        relation_type:
          e.relation_type === "completes"
            ? "completes_outfit"
            : e.relation_type === "similar_to"
            ? "similar"
            : String(e.relation_type),
        score: Number(e.score) || 0,
        source: String(e.source || "system"),
      };
    })
    .filter(Boolean) as Array<{ to_ref: string; relation_type: string; score: number; source: string }>;
}

export async function relatedFromGraphOrFallback(
  client: SupabaseClient,
  product: CatalogProduct,
  intent: string,
  searchFallback: () => Promise<CatalogProduct[]>,
) {
  const graphIntents = [
    "pairs_with",
    "completes_outfit",
    "similar",
    "upsell",
    "same_look",
    "alternative",
  ];
  if (
    graphIntents.includes(intent) ||
    intent === "kimono" ||
    intent === "cover_up"
  ) {
    const types =
      intent === "kimono" || intent === "cover_up"
        ? ["completes_outfit", "pairs_with"]
        : [intent];
    const rels = await loadRelations(client, product.ref, types);
    if (rels.length) {
      const products = await loadProductsByRefs(
        client,
        rels.map((r) => r.to_ref),
      );
      return products.map((p) => {
        const edge = rels.find((r) => r.to_ref === p.ref);
        return {
          ...p,
          relation: edge
            ? {
              type: edge.relation_type,
              score: edge.score,
              source: edge.source,
            }
            : undefined,
        };
      });
    }
  }
  return searchFallback();
}

/**
 * Structured knowledge pack — commercial knowledge graph view.
 */
export async function buildProductKnowledge(
  client: SupabaseClient,
  product: CatalogProduct,
) {
  const productKey = `product:${product.ref}`;
  const { data: root, error: rootErr } = await client
    .from("knowledge_nodes")
    .select("id,node_type,external_key,title,url,thumbnail_url,locale,meta,published_at")
    .eq("node_type", "product")
    .eq("external_key", productKey)
    .eq("active", true)
    .maybeSingle();
  if (rootErr) throw rootErr;

  let edges: KgEdge[] = [];
  if (root?.id) {
    const { data, error } = await client
      .from("knowledge_edges")
      .select(
        "id,relation_type,score,source,meta,to_node:knowledge_nodes!knowledge_edges_to_node_id_fkey(id,node_type,external_key,title,url,thumbnail_url,locale,meta,published_at)",
      )
      .eq("from_node_id", root.id)
      .eq("active", true)
      .order("score", { ascending: false })
      .limit(100);
    if (error) throw error;
    edges = (data || []) as unknown as KgEdge[];
  }

  const mapped = edges.map(edgeTarget).filter((e) => e.node);

  const byRel = (...rels: string[]) => mapped.filter((e) => rels.includes(e.relation));
  const byType = (...types: string[]) =>
    mapped.filter((e) => e.node && types.includes(e.node.type));

  const productEdgeRefs = byRel(
    "pairs_with",
    "completes",
    "similar_to",
    "upsell",
    "same_look",
    "alternative",
    "related_to",
  )
    .map((e) => e.node?.ref || (e.node?.key?.startsWith("product:") ? e.node.key.slice(8) : null))
    .filter(Boolean) as string[];

  const relatedProducts = await loadProductsByRefs(client, [...new Set(productEdgeRefs)]);
  const relatedByRef = new Map(relatedProducts.map((p) => [p.ref, p]));

  const recommendations = byRel(
    "pairs_with",
    "completes",
    "similar_to",
    "upsell",
    "same_look",
    "alternative",
    "related_to",
    "recommended_for",
  ).map((e) => {
    const ref = e.node?.ref ||
      (e.node?.key?.startsWith("product:") ? e.node.key.slice(8) : null);
    return {
      relation: e.relation,
      score: e.score,
      source: e.source,
      node: e.node,
      product: ref ? relatedByRef.get(ref) || null : null,
    };
  });

  const mediaFromProduct = {
    hero: product.media.hero,
    images: product.media.images,
    videos: product.media.videos.map((url, i) => ({
      type: "video",
      title: `${product.name} — video ${i + 1}`,
      url,
      source: "product_media",
    })),
  };

  const social = byType("instagram", "tiktok", "pinterest");
  const guides = byType("blog", "guide");
  const editorial = byType("editorial");
  const collections = byRel("belongs_to", "recommended_for").filter((e) =>
    e.node?.type === "collection"
  );
  const graphMedia = byType("video", "customer_photo", "lookbook");

  return {
    ref: product.ref,
    graph: {
      root_node_id: root?.id || null,
      root_key: productKey,
      edge_count: mapped.length,
    },
    product,
    relationships: {
      pairs_with: recommendations.filter((r) =>
        ["pairs_with", "completes", "same_look"].includes(r.relation)
      ),
      similar: recommendations.filter((r) =>
        ["similar_to", "alternative", "related_to"].includes(r.relation)
      ),
      upsell: recommendations.filter((r) => r.relation === "upsell"),
      collections,
      recommended_for: recommendations.filter((r) => r.relation === "recommended_for"),
    },
    media: {
      ...mediaFromProduct,
      external: graphMedia,
      customer_photos: byType("customer_photo"),
    },
    social: {
      instagram: social.filter((e) => e.node?.type === "instagram"),
      tiktok: social.filter((e) => e.node?.type === "tiktok"),
      pinterest: social.filter((e) => e.node?.type === "pinterest"),
      all: social,
    },
    guides: {
      blog: guides.filter((e) => e.node?.type === "blog"),
      guides: guides.filter((e) => e.node?.type === "guide"),
      all: guides,
    },
    editorial,
    recommendations,
    // Backward-compatible answers block (Phase 1 clients)
    answers: {
      pairs_with: recommendations
        .filter((r) => ["pairs_with", "completes", "same_look"].includes(r.relation) && r.product)
        .map((r) => ({
          relation_type: r.relation === "completes" ? "completes_outfit" : r.relation,
          score: r.score,
          source: r.source,
          product: r.product,
        })),
      same_collections: collections.map((c) => ({
        slug: c.node?.slug || c.node?.key?.replace(/^collection:/, ""),
        title: c.node?.title,
        description: (c.node?.meta as { description?: string } | undefined)?.description || "",
      })),
      videos: [...mediaFromProduct.videos, ...graphMedia.map((g) => g.node).filter(Boolean)],
      social: social.map((s) => s.node).filter(Boolean),
      editorial: editorial.map((e) => e.node).filter(Boolean),
      articles: guides.map((g) => g.node).filter(Boolean),
      lookbooks: byType("lookbook").map((e) => e.node).filter(Boolean),
    },
    semantic: {
      status: "planned",
      note: "Phase 3: embed the full knowledge document (product + linked nodes), not the SKU alone.",
      embedding_ready: false,
    },
    knowledge: mapped.map((e) => e.node),
  };
}
