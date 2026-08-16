/**
 * Sirve imágenes de producto como JPEG para TikTok Catalog.
 * TikTok exige image_link .jpg/.png ≥500px (el catálogo está en .webp).
 * Ignora covers en video (.mp4) y usa la primera imagen real.
 *
 * URL: .../functions/v1/tiktok-catalog-img/{token}/{product_id}.jpg
 * Cache: Catalog-media/tiktok-jpg/{id}.jpg
 *
 * Deploy: supabase functions deploy tiktok-catalog-img --no-verify-jwt
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

const CACHE_BUCKET = "Catalog-media";
const CACHE_PREFIX = "tiktok-jpg";

function parsePath(pathname: string): { token: string; productId: string } {
  const m = pathname.match(
    /tiktok-catalog-img\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpe?g$/i,
  );
  if (!m) return { token: "", productId: "" };
  try {
    return {
      token: decodeURIComponent(m[1]),
      productId: m[2].toLowerCase(),
    };
  } catch {
    return { token: m[1], productId: m[2].toLowerCase() };
  }
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(url || ""));
}

function isImageUrl(url: string): boolean {
  const u = String(url || "");
  if (!u || isVideoUrl(u)) return false;
  return /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(u) ||
    /\/storage\/v1\/object\/public\//i.test(u);
}

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

/** JPEG ≥800px (TikTok pide ≥500). */
function jpegViaWeserv(src: string): string {
  const encoded = encodeMediaUrl(src);
  const hostFree = encoded.replace(/^https?:\/\//i, "");
  const u = new URL("https://images.weserv.nl/");
  u.searchParams.set("url", hostFree);
  u.searchParams.set("output", "jpg");
  u.searchParams.set("q", "85");
  u.searchParams.set("w", "800");
  u.searchParams.set("h", "800");
  u.searchParams.set("fit", "cover");
  u.searchParams.set("a", "center");
  return u.toString();
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(encodeMediaUrl(url), {
      headers: { Accept: "image/*,*/*" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > 12_000_000) return null;
    return buf;
  } catch {
    return null;
  }
}

function cacheObjectPath(pid: string): string {
  return `${CACHE_PREFIX}/${pid}.jpg`;
}

function publicCacheUrl(supabaseUrl: string, pid: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${CACHE_BUCKET}/${cacheObjectPath(pid)}`;
}

function pickImageSrc(
  rows: Array<{ url: string; is_cover?: boolean }>,
): string {
  const images = rows.filter((r) => isImageUrl(r.url));
  if (!images.length) return "";
  images.sort(
    (a, b) => ((b.is_cover ? 1 : 0) - (a.is_cover ? 1 : 0)),
  );
  return encodeMediaUrl(images[0].url);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  const url = new URL(req.url);
  const feedSecret = (Deno.env.get("TIKTOK_FEED_SECRET") ?? "").trim();
  const { token, productId } = parsePath(url.pathname);
  const tokenParam = (url.searchParams.get("token") ?? "").trim() || token;
  const pid =
    productId ||
    (url.pathname.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpe?g$/i,
    )?.[1] ?? "").toLowerCase();

  if (!feedSecret || tokenParam !== feedSecret || !pid) {
    return new Response("Unauthorized", { status: 401, headers: cors });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response("Server misconfigured", { status: 500, headers: cors });
  }

  const sb = createClient(supabaseUrl, serviceKey);
  const cachedPublic = publicCacheUrl(supabaseUrl, pid);

  const cachedBytes = await fetchBytes(cachedPublic);
  if (cachedBytes && isJpeg(cachedBytes)) {
    const outHeaders = {
      ...cors,
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=604800",
      "Content-Length": String(cachedBytes.length),
      "Content-Disposition": `inline; filename="${pid}.jpg"`,
    };
    if (req.method === "HEAD") {
      return new Response(null, { status: 200, headers: outHeaders });
    }
    return new Response(cachedBytes, { status: 200, headers: outHeaders });
  }

  const { data: mediaRows, error } = await sb
    .from("product_media")
    .select("url,is_cover")
    .eq("product_id", pid);

  if (error) {
    return new Response(error.message, { status: 500, headers: cors });
  }

  const src = pickImageSrc(
    (mediaRows || []) as Array<{ url: string; is_cover?: boolean }>,
  );
  if (!src) {
    return new Response("No image", { status: 404, headers: cors });
  }

  let bytes = await fetchBytes(jpegViaWeserv(src));
  if (!bytes || !isJpeg(bytes)) {
    const raw = await fetchBytes(src);
    if (raw && isJpeg(raw)) bytes = raw;
    else if (raw) bytes = await fetchBytes(jpegViaWeserv(src));
  }
  if (!bytes || !isJpeg(bytes)) {
    return new Response("Convert failed", { status: 422, headers: cors });
  }

  void sb.storage
    .from(CACHE_BUCKET)
    .upload(cacheObjectPath(pid), bytes, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "604800",
    })
    .then(() => {})
    .catch(() => {});

  const outHeaders = {
    ...cors,
    "Content-Type": "image/jpeg",
    "Cache-Control": "public, max-age=86400",
    "Content-Length": String(bytes.length),
    "Content-Disposition": `inline; filename="${pid}.jpg"`,
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers: outHeaders });
  }
  return new Response(bytes, { status: 200, headers: outHeaders });
});
