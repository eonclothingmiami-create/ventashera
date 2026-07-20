/**
 * Catalog API v1 — proyección pública estable (AI-ready).
 * IDs canónicos = products.ref (HERA-*).
 * Incluye capa de conocimiento comercial (relations + knowledge links).
 */

export type ProductMediaRow = { url: string | null; is_cover: boolean | null };

export type ProductJoinRow = {
  id: string;
  ref: string | null;
  name: string | null;
  description: string | null;
  price: number | null;
  stock: number | null;
  seccion: string | null;
  categoria: string | null;
  updated_at: string | null;
  product_media?: ProductMediaRow[] | null;
  product_attributes?: {
    product_type?: string | null;
    style?: string[] | null;
    occasions?: string[] | null;
    fit_goals?: string[] | null;
    silhouette?: string | null;
    coverage?: string | null;
    materials?: string[] | null;
    season?: string[] | null;
    collection_slugs?: string[] | null;
    attrs?: Record<string, unknown> | null;
  } | null;
};

const CATALOG_ORIGIN = "https://heraswimsuit.com/catalogo";
const BRAND = "Hera Swimwear";
const VIDEO_RE = /\.(mp4|webm|mov|m4v|avi)(\?|#|$)/i;

export function productLink(ref: string): string {
  return `${CATALOG_ORIGIN}/?p=${encodeURIComponent(ref)}`;
}

export function isVideoUrl(url: string): boolean {
  return VIDEO_RE.test(url);
}

export function mediaBundle(media: ProductMediaRow[] | null | undefined) {
  const rows = Array.isArray(media) ? media.filter((m) => m?.url) : [];
  const cover = rows.find((m) => m.is_cover) || rows[0];
  const ordered = cover ? [cover, ...rows.filter((m) => m !== cover)] : rows;
  const urls = [...new Set(ordered.map((m) => String(m.url).trim()).filter(Boolean))];
  const images = urls.filter((u) => !isVideoUrl(u));
  const videos = urls.filter((u) => isVideoUrl(u));
  const hero = images[0] || videos[0] || null;
  return { hero, images, videos };
}

/** @deprecated use mediaBundle */
export function mediaUrls(media: ProductMediaRow[] | null | undefined) {
  const b = mediaBundle(media);
  return { image: b.hero || "", images: [...b.images, ...b.videos] };
}

export function availabilityCode(stock: number): "in_stock" | "out_of_stock" {
  return stock > 0 ? "in_stock" : "out_of_stock";
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}

/** Proyección Product resource (OpenAPI Catalog API v1). */
export function catalogProductV1(row: ProductJoinRow) {
  const ref = String(row.ref || "").trim();
  const stock = Math.max(0, Math.round(Number(row.stock) || 0));
  const price = Math.round(Number(row.price) || 0);
  const media = mediaBundle(row.product_media);
  const a = row.product_attributes || {};

  return {
    id: ref,
    ref,
    brand: BRAND,
    name: String(row.name || ref).trim(),
    description: String(row.description || "").trim(),
    taxonomy: {
      seccion: String(row.seccion || "").trim() || null,
      categoria: String(row.categoria || "").trim() || null,
      path: [row.seccion, row.categoria].filter(Boolean).join(" > ") || null,
    },
    product_type: a.product_type || null,
    style: arr(a.style),
    occasions: arr(a.occasions),
    fit_goals: arr(a.fit_goals),
    silhouette: a.silhouette || null,
    coverage: a.coverage || null,
    materials: arr(a.materials),
    season: arr(a.season),
    collections: arr(a.collection_slugs),
    offer: {
      price,
      currency: "COP",
      channel: "catalog",
    },
    availability: {
      status: availabilityCode(stock),
      quantity: stock,
    },
    media: {
      hero: media.hero,
      images: media.images,
      videos: media.videos,
    },
    links: {
      catalog: productLink(ref),
      api: `https://heraswimsuit.com/api/v1/products/${encodeURIComponent(ref)}`,
      knowledge: `https://heraswimsuit.com/api/v1/products/${encodeURIComponent(ref)}/knowledge`,
    },
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

export const PRODUCT_SELECT_V1 =
  "id,ref,name,description,price,stock,seccion,categoria,updated_at,product_media(url,is_cover),product_attributes(product_type,style,occasions,fit_goals,silhouette,coverage,materials,season,collection_slugs,attrs)";

export const CAPABILITIES_V1 = {
  api_version: "v1",
  brand: BRAND,
  currency: "COP",
  locale_default: "es-CO",
  id_scheme: "HERA-*",
  knowledge: {
    status: "active",
    model: "knowledge_graph",
    resources: [
      "knowledge_nodes + knowledge_edges (source of truth)",
      "GET /products/{ref}/knowledge = structured graph view",
      "relations, collections, media, social, guides, editorial, recommendations",
    ],
    note: "Phase 2 = curation of the graph. Phase 3 = embeddings of full knowledge docs. Phase 4 = MCP.",
  },
  semantic_search: {
    status: "planned",
    note: "Keyword + faceted search available now; vector search activates when embedding_jobs are processed.",
  },
  filters: [
    "q",
    "in_stock",
    "max_price",
    "min_price",
    "product_type",
    "style",
    "occasion",
    "fit_goal",
    "collection",
    "seccion",
    "categoria",
  ],
  endpoints: [
    "GET /v1/capabilities",
    "GET /v1/resolve?id=",
    "GET /v1/products",
    "GET /v1/products/{ref}",
    "GET /v1/products/{ref}/related",
    "GET /v1/products/{ref}/knowledge",
    "POST /v1/search",
    "GET /v1/collections",
    "GET /v1/collections/{slug}",
  ],
  openapi: "https://heraswimsuit.com/api/v1/openapi.json",
};
