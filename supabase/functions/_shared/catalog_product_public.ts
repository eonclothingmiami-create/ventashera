/**
 * Mapeo público de producto por ref (catálogo, API, feeds).
 */
export type ProductMediaRow = { url: string | null; is_cover: boolean | null };

export type ProductRow = {
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
};

const CATALOG_ORIGIN = "https://heraswimsuit.com/catalogo";

export function productLink(ref: string): string {
  return `${CATALOG_ORIGIN}/?p=${encodeURIComponent(ref)}`;
}

export function mediaUrls(media: ProductMediaRow[] | null | undefined) {
  const rows = Array.isArray(media) ? media.filter((m) => m?.url) : [];
  const cover = rows.find((m) => m.is_cover) || rows[0];
  const ordered = cover ? [cover, ...rows.filter((m) => m !== cover)] : rows;
  const urls = [...new Set(ordered.map((m) => String(m.url).trim()).filter(Boolean))];
  return { image: urls[0] || "", images: urls };
}

export function availabilityFor(stock: number | null | undefined): string {
  return Number(stock) > 0 ? "in stock" : "out of stock";
}

export function publicProductPayload(row: ProductRow) {
  const ref = String(row.ref || "").trim();
  const { image, images } = mediaUrls(row.product_media);
  const stock = Math.max(0, Math.round(Number(row.stock) || 0));
  const price = Math.round(Number(row.price) || 0);
  const category = [row.seccion, row.categoria].filter(Boolean).join(" > ");

  return {
    ref,
    title: String(row.name || ref).trim(),
    description: String(row.description || "").trim(),
    price,
    currency: "COP",
    stock,
    availability: availabilityFor(stock),
    image,
    images,
    category,
    link: productLink(ref),
    updated_at: row.updated_at || new Date().toISOString(),
  };
}
