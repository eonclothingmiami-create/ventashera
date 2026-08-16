/**
 * Edge Function: feed CSV para TikTok Catalog (fuente de datos programada).
 *
 * URL recomendada (termina en .csv):
 *   https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/tiktok-product-feed/TU_SECRETO/hera.csv
 *   https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/tiktok-product-feed/TU_SECRETO/eon.csv
 *
 * Compat (query):
 *   .../tiktok-product-feed?token=TU_SECRETO&site=hera
 *
 * sku_id = products.ref (mismo valor que content_id del pixel TikTok).
 *
 * Deploy: supabase functions deploy tiktok-product-feed --no-verify-jwt
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

const DEFAULT_HERA = "https://heraswimsuit.com/catalogo/";
const DEFAULT_EON = "https://eonclothingonline.com/mayoristas/";
const DEFAULT_CATEGORY = "Apparel & Accessories > Clothing > Swimwear";

function csvCell(value: string): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatPriceCOP(n: number): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return `${v} COP`;
}

function availabilityFromProduct(visible: boolean, stock: number): string {
  if (!visible || stock <= 0) return "out of stock";
  return "in stock";
}

function buildProductLink(baseRaw: string, ref: string): string {
  const raw = baseRaw.trim();
  const r = ref.trim();
  if (!raw || !r) return "";
  try {
    const u = new URL(raw.endsWith("/") || raw.includes("?") ? raw : `${raw}/`);
    u.searchParams.delete("ref");
    u.searchParams.set("p", r);
    return u.toString();
  } catch {
    const sep = raw.includes("?") ? "&" : "?";
    return `${raw}${sep}p=${encodeURIComponent(r)}`;
  }
}

function resolveBaseUrl(site: string): string {
  const hera =
    (Deno.env.get("TIKTOK_PRODUCT_BASE_URL") ?? "").trim() || DEFAULT_HERA;
  const eon =
    (Deno.env.get("TIKTOK_EON_BASE_URL") ?? "").trim() || DEFAULT_EON;
  if (site === "eon" || site === "mayoristas") return eon;
  return hera;
}

function buildTikTokImageLink(
  functionsBase: string,
  productId: string,
  token: string,
  cachedIds?: Set<string>,
  supabaseUrl?: string,
): string {
  const id = productId.trim();
  if (!id) return "";
  // Preferir JPEG cacheado en Storage (CDN estable; evita bloqueos al crawler).
  if (cachedIds?.has(id) && supabaseUrl) {
    return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/Catalog-media/tiktok-jpg/${id}.jpg`;
  }
  const base = functionsBase.replace(/\/$/, "");
  const t = token.trim();
  if (!base || !t) return "";
  return `${base}/tiktok-catalog-img/${encodeURIComponent(t)}/${id}.jpg`;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(url || ""));
}

function isImageUrl(url: string): boolean {
  const u = String(url || "");
  if (!u || isVideoUrl(u)) return false;
  return /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(u) || /\/storage\/v1\/object\/public\//i.test(u);
}

function isAlreadyTikTokImageUrl(url: string): boolean {
  return /\.(jpe?g|png)(\?|#|$)/i.test(url.trim());
}

/** URL con espacios/parens → forma fetchable. */
function encodeMediaUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.pathname = u.pathname
      .split("/")
      .map((seg) => {
        if (!seg) return seg;
        try {
          return encodeURIComponent(decodeURIComponent(seg));
        } catch {
          return encodeURIComponent(seg);
        }
      })
      .join("/");
    return u.toString();
  } catch {
    return raw;
  }
}

/** token + site desde path (.../TOKEN/hera.csv) o query (?token=&site=). */
function parseAuthAndSite(url: URL): { token: string; site: string } {
  const path = url.pathname;
  // .../tiktok-product-feed/<token>/<site>.csv
  const m = path.match(
    /tiktok-product-feed\/([^/]+)\/(hera|eon|mayoristas)\.csv$/i,
  );
  if (m) {
    let token = m[1];
    try {
      token = decodeURIComponent(token);
    } catch {
      /* keep raw */
    }
    return { token: token.trim(), site: m[2].toLowerCase() };
  }
  // .../tiktok-product-feed/<token>.csv  → hera
  const m2 = path.match(/tiktok-product-feed\/([^/]+)\.csv$/i);
  if (m2) {
    let token = m2[1];
    try {
      token = decodeURIComponent(token);
    } catch {
      /* keep */
    }
    const site = (url.searchParams.get("site") ?? "hera").trim().toLowerCase();
    return { token: token.trim(), site };
  }
  return {
    token: (url.searchParams.get("token") ?? "").trim(),
    site: (url.searchParams.get("site") ?? "hera").trim().toLowerCase(),
  };
}

function cleanText(s: string, max: number): string {
  return s
    .replace(/[\u201C\u201D]/g, "'")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

/** TikTok avisa si el title va todo en MAYÚSCULAS. */
function titleForTikTok(raw: string): string {
  const s = cleanText(raw, 500);
  if (!s) return s;
  const letters = s.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  if (letters.length >= 2 && letters === letters.toUpperCase()) {
    return s
      .toLocaleLowerCase("es")
      .replace(/(^|[\s\-_/])(\S)/g, (_, p, c) => p + String(c).toLocaleUpperCase("es"));
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Use GET or HEAD" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const { token: tokenParam, site } = parseAuthAndSite(url);
  const feedSecret = (Deno.env.get("TIKTOK_FEED_SECRET") ?? "").trim();
  if (!feedSecret) {
    return new Response(
      JSON.stringify({ error: "TIKTOK_FEED_SECRET no configurado" }),
      { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
  if (!tokenParam || tokenParam !== feedSecret) {
    return new Response(JSON.stringify({ error: "token inválido" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const baseUrl = resolveBaseUrl(site);
  const brand =
    (
      Deno.env.get("TIKTOK_FEED_BRAND") ??
      (site === "eon" || site === "mayoristas"
        ? "EON Clothing"
        : "Hera Swimwear")
    ).trim() || "Hera Swimwear";
  const category =
    (Deno.env.get("TIKTOK_FEED_CATEGORY") ?? "").trim() || DEFAULT_CATEGORY;

  const maxRows = Math.min(
    100000,
    Math.max(
      1,
      parseInt(Deno.env.get("TIKTOK_FEED_MAX_ROWS") ?? "20000", 10) || 20000,
    ),
  );

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Faltan variables de Supabase" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const sb = createClient(supabaseUrl, serviceKey);
  const { data: rows, error } = await sb
    .from("products")
    .select("id,ref,name,description,price,stock,visible,active")
    .eq("active", true)
    .eq("visible", true)
    .not("ref", "is", null)
    .neq("ref", "")
    .order("created_at", { ascending: false })
    .limit(maxRows);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const list = (rows || []).filter((p) => String(p.ref || "").trim());
  const mediaByProduct = new Map<string, string>();
  const functionsBase = `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;

  // JPEGs ya cacheados por tiktok-catalog-img → URLs públicas estables.
  const cachedIds = new Set<string>();
  {
    const { data: cachedFiles } = await sb.storage
      .from("Catalog-media")
      .list("tiktok-jpg", { limit: 1000 });
    for (const f of cachedFiles || []) {
      const name = String((f as { name?: string }).name || "");
      const m = name.match(
        /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpe?g$/i,
      );
      if (m) cachedIds.add(m[1].toLowerCase());
    }
  }

  if (list.length) {
    const ids = list.map((p: { id: string }) => p.id);
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data: mediaRows, error: mErr } = await sb
        .from("product_media")
        .select("product_id,url,is_cover")
        .in("product_id", chunk);

      if (mErr) {
        return new Response(JSON.stringify({ error: mErr.message }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const byPid = new Map<string, Array<{ url: string; is_cover: boolean }>>();
      for (const m of mediaRows || []) {
        const pid = (m as { product_id: string }).product_id;
        const murl = (m as { url: string; is_cover?: boolean }).url;
        if (!byPid.has(pid)) byPid.set(pid, []);
        byPid.get(pid)!.push({
          url: murl,
          is_cover: !!(m as { is_cover?: boolean }).is_cover,
        });
      }
      for (const [pid, arr] of byPid) {
        const images = arr.filter((a) => isImageUrl(a.url));
        const pool = images.length ? images : [];
        if (!pool.length) continue;
        const sorted = [...pool].sort((a, b) => {
          const cov = (b.is_cover ? 1 : 0) - (a.is_cover ? 1 : 0);
          if (cov !== 0) return cov;
          return (
            (isAlreadyTikTokImageUrl(b.url) ? 1 : 0) -
            (isAlreadyTikTokImageUrl(a.url) ? 1 : 0)
          );
        });
        const first = sorted[0]?.url;
        if (first && /^https?:\/\//i.test(first)) {
          mediaByProduct.set(pid, encodeMediaUrl(first));
        }
      }
    }
  }

  const header = [
    "sku_id",
    "item_group_id",
    "title",
    "description",
    "availability",
    "condition",
    "price",
    "link",
    "image_link",
    "brand",
    "google_product_category",
  ];

  const lines: string[] = [header.join(",")];
  let included = 0;

  for (const p of list) {
    const row = p as Record<string, unknown>;
    const ref = String(row.ref || "").trim().slice(0, 100);
    if (!ref) continue;

    const title = titleForTikTok(String(row.name || ref));
    const desc = cleanText(String(row.description || title), 5000) || title;
    const priceNum = Number(row.price) || 0;
    if (priceNum <= 0) continue;

    const stock = Math.max(0, parseInt(String(row.stock ?? 0), 10) || 0);
    const visible = row.visible !== false;
    const link = buildProductLink(baseUrl, ref);
    const productId = String(row.id || "");
    const rawImg = mediaByProduct.get(productId) || "";
    if (!rawImg || !productId || !/^https?:\/\//i.test(link)) continue;

    const img = buildTikTokImageLink(
      functionsBase,
      productId,
      feedSecret,
      cachedIds,
      supabaseUrl,
    );
    if (!img) continue;

    // Sin variantes separadas: item_group_id = sku_id (quita warning TikTok).
    const fields = [
      ref,
      ref,
      title,
      desc,
      availabilityFromProduct(visible, stock),
      "new",
      formatPriceCOP(priceNum),
      link,
      img,
      brand,
      category,
    ].map(csvCell);
    lines.push(fields.join(","));
    included += 1;
  }

  const body = lines.join("\r\n") + "\r\n";
  const headers = {
    ...cors,
    "Content-Type": "text/csv; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Content-Disposition": 'attachment; filename="tiktok-catalog.csv"',
    "Content-Length": String(new TextEncoder().encode(body).length),
    "X-TikTok-Feed-Rows": String(included),
    "X-TikTok-Feed-Site": site,
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(body, { status: 200, headers });
});
