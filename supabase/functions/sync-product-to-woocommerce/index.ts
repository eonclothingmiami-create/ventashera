/**
 * Edge Function: sincroniza un producto del catálogo (Supabase) → WooCommerce REST API.
 * Secretos: WC_API_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET (env Supabase).
 * Auth: Authorization Bearer JWT de usuario Supabase (misma sesión que el admin del catálogo).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ProductRow = {
  id: string;
  ref: string;
  name: string | null;
  seccion: string | null;
  categoria: string | null;
  price: number | string | null;
  active: boolean | null;
};

type MediaRow = { url: string; is_cover: boolean | null };
type JoinLabel = { label: string | null };

type WooSyncResult = {
  woocommerce_product_id: number;
  created: boolean;
  lastPayload: Record<string, unknown>;
};

/**
 * WooCommerce puede tardar muchísimo descargando muchas imágenes remotas en un solo update,
 * provocando timeouts (~120s) aunque variaciones se hagan por batch. Limitamos imágenes por sync.
 */
const WC_MAX_IMAGES_PER_SYNC = 6;

function errWithPayload(msg: string, lastPayload: Record<string, unknown>) {
  const e = new Error(msg) as Error & { lastPayload: Record<string, unknown> };
  e.lastPayload = lastPayload;
  return e;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeImageUrl(u: string) {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return u.split('?')[0] || u;
  }
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm|avi)(\?|$)/i.test(url.split('?')[0] || '');
}

function isWcImageRejectedMessage(msg: string) {
  const m = String(msg || '').toLowerCase();
  return (
    m.includes('imagen no válida') ||
    m.includes('imagen no valida') ||
    m.includes('no tienes permisos para subir este tipo de archivo') ||
    m.includes("don't have permission to upload this file type") ||
    m.includes('not allowed to upload this file type')
  );
}

function wcBaseUrl() {
  const raw = (Deno.env.get('WC_API_URL') || '').trim().replace(/\/$/, '');
  if (!raw) throw new Error('WC_API_URL no configurada');
  return raw;
}

function wcAuthQuery() {
  const key = (Deno.env.get('WC_CONSUMER_KEY') || '').trim();
  const secret = (Deno.env.get('WC_CONSUMER_SECRET') || '').trim();
  if (!key || !secret) throw new Error('WC_CONSUMER_KEY / WC_CONSUMER_SECRET no configuradas');
  const q = new URLSearchParams();
  q.set('consumer_key', key);
  q.set('consumer_secret', secret);
  return q.toString();
}

async function wcFetch(pathWithLeadingSlash: string, init?: RequestInit) {
  const q = wcAuthQuery();
  const url = `${wcBaseUrl()}/wp-json/wc/v3${pathWithLeadingSlash}${
    pathWithLeadingSlash.includes('?') ? '&' : '?'
  }${q}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { res, data };
}

async function findProductBySku(sku: string) {
  const enc = encodeURIComponent(sku);
  const { res, data } = await wcFetch(`/products?sku=${enc}`);
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message?: string }).message)
        : res.statusText;
    throw new Error(`WooCommerce listar por SKU (${res.status}): ${msg}`);
  }
  const arr = Array.isArray(data) ? data : [];
  return arr[0] as { id: number; images?: { id?: number; src?: string }[] } | undefined;
}

function buildDescriptions(p: ProductRow, sizes: string[], colors: string[]) {
  const parts: string[] = [];
  parts.push(`<p><strong>Referencia:</strong> ${escapeHtml(p.ref)}</p>`);
  if (p.seccion) parts.push(`<p><strong>Sección:</strong> ${escapeHtml(p.seccion)}</p>`);
  if (p.categoria) parts.push(`<p><strong>Categoría:</strong> ${escapeHtml(p.categoria)}</p>`);
  if (sizes.length) parts.push(`<p><strong>Tallas:</strong> ${escapeHtml(sizes.join(', '))}</p>`);
  if (colors.length) parts.push(`<p><strong>Colores:</strong> ${escapeHtml(colors.join(', '))}</p>`);
  const description = parts.join('\n');
  const shortParts = [`Ref. ${p.ref}`];
  if (p.categoria) shortParts.push(p.categoria);
  if (sizes.length) shortParts.push(`Tallas: ${sizes.join(', ')}`);
  if (colors.length) shortParts.push(`Colores: ${colors.join(', ')}`);
  const short_description = `<p>${escapeHtml(shortParts.join(' · '))}</p>`;
  return { description, short_description };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

/** Comparación estable: minúsculas, sin tildes, espacios normalizados. */
function normalizeText(text: string | null | undefined): string {
  if (text == null || String(text).trim() === '') return '';
  let s = String(text).trim().toLowerCase();
  try {
    s = s.normalize('NFD').replace(/\p{M}/gu, '');
  } catch {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function dedupeCommercialNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim().slice(0, 200);
    if (!n) continue;
    const key = n.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/**
 * Catálogo interno → nombres comerciales (mayúsculas) para WooCommerce.
 * Prioridad: `categoria` → `seccion` → heurística por `name` (SKU/título libre).
 */
function buildCategoryCommercialNames(p: ProductRow): string[] {
  const by = (xs: string[]) => dedupeCommercialNames(xs);

  const cat = normalizeText(p.categoria);
  const sec = normalizeText(p.seccion);
  const nm = normalizeText(p.name);
  const secResort =
    sec === 'resort & pijamas' || sec === 'resort y pijamas' || sec === 'resort and pijamas';

  if (cat) {
    if (cat === 'enterizos') return by(['MONOKINIS', 'TRAJES DE BAÑO']);
    if (cat === 'bikinis') return by(['BIKINIS', 'TRAJES DE BAÑO']);
    if (cat === '3 piezas' || cat.startsWith('3 piezas')) return by(['TRIKINIS', 'TRAJES DE BAÑO']);
    if (cat === 'tankinis') return by(['BIKINIS', 'TRAJES DE BAÑO']);
    if (cat === 'asoleadores') return by(['BIKINIS', 'TRAJES DE BAÑO']);
    if (cat === 'salidas de bano' || cat.startsWith('salidas de bano')) return by(['TRAJES DE BAÑO']);
    if (cat === 'batas') return by(['PIJAMAS']);
    if (cat.startsWith('pijama') || cat === 'pijamas' || cat === 'sets 2 piezas') return by(['PIJAMAS']);
    if (cat === 'leggings') return by(['CASUAL']);
    if (cat === 'conjuntos') return by(['CASUAL']);
    if (cat === 'vestidos') return by(['CASUAL']);
    if (cat.includes('malla')) return by(['CASUAL']);
  }

  if (sec === 'trajes de bano') return by(['TRAJES DE BAÑO']);
  if (secResort || sec === 'pijamas') return by(['PIJAMAS']);
  if (sec === 'activewear' || sec === 'ropa deportiva') return by(['CASUAL']);
  if (sec === 'casual') return by(['CASUAL']);

  if (nm) {
    if (nm.includes('pijama')) return by(['PIJAMAS']);
    if (nm.includes('malla')) return by(['CASUAL']);
    if (nm.includes('3 piezas')) return by(['TRIKINIS', 'TRAJES DE BAÑO']);
  }

  return by(['TIENDA']);
}

/** Slug ASCII típico de Woo para buscar categoría existente. */
function wcSlugGuess(displayName: string): string {
  let s = normalizeText(displayName).replace(/ñ/g, 'n');
  s = s.replace(/\s+/g, '-');
  s = s.replace(/[^a-z0-9-]/g, '');
  return s;
}

async function fetchWcCategoryIdBySlug(slug: string): Promise<number | null> {
  if (!slug) return null;
  const { res, data } = await wcFetch(`/products/categories?slug=${encodeURIComponent(slug)}`);
  if (!res.ok || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { id?: number };
  return typeof row?.id === 'number' ? row.id : null;
}

async function fetchWcCategoryIdBySearchExactName(label: string): Promise<number | null> {
  const { res, data } = await wcFetch(
    `/products/categories?search=${encodeURIComponent(label)}&per_page=50`,
  );
  if (!res.ok || !Array.isArray(data)) return null;
  const want = normalizeText(label);
  for (const row of data as { id?: number; name?: string }[]) {
    if (typeof row?.id !== 'number') continue;
    if (normalizeText(String(row.name || '')) === want) return row.id;
  }
  return null;
}

/**
 * WooCommerce suele dejar "Sin categoría" si solo mandamos `{ name }` y no coincide con un término existente.
 * Resuelve `{ id }` por slug y por búsqueda; si no hay ID, mantiene `{ name }` para que WC pueda crear/asociar.
 */
async function resolveWcCategoryPayload(
  commercialNames: string[],
  log: (m: string, extra?: unknown) => void,
): Promise<Array<{ id: number } | { name: string }>> {
  const out: Array<{ id: number } | { name: string }> = [];
  const used = new Set<number>();

  for (const raw of commercialNames) {
    const label = raw.trim().slice(0, 200);
    if (!label) continue;

    const slug = wcSlugGuess(label);
    let id = await fetchWcCategoryIdBySlug(slug);
    if (id == null) {
      id = await fetchWcCategoryIdBySearchExactName(label);
    }

    if (id != null && !used.has(id)) {
      used.add(id);
      out.push({ id });
    } else {
      log('WooCommerce categoría sin ID resuelto; se envía name', { label, slugTried: slug });
      out.push({ name: label });
    }
  }

  if (!out.length) {
    out.push({ name: 'TIENDA' });
  }
  return out;
}

function imageFingerprint(url: string): string {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const file = pathname.split('/').filter(Boolean).pop() || pathname;
    return file.toLowerCase().replace(/\s+/g, '-');
  } catch {
    const bare = (url.split('?')[0].split('/').pop() || '').toLowerCase();
    try {
      return decodeURIComponent(bare).replace(/\s+/g, '-');
    } catch {
      return bare.replace(/\s+/g, '-');
    }
  }
}

type WcImageRef = { id?: number; src?: string; name?: string };

function indexExistingWcImages(existing: WcImageRef[]) {
  const byNormSrc = new Map<string, number>();
  const byFingerprint = new Map<string, number>();
  for (const im of existing) {
    if (!im?.id) continue;
    if (im.src) {
      byNormSrc.set(normalizeImageUrl(im.src), im.id);
      byFingerprint.set(imageFingerprint(im.src), im.id);
    }
    if (im.name) byFingerprint.set(imageFingerprint(im.name), im.id);
  }
  return { byNormSrc, byFingerprint };
}

function buildImagesPayload(
  urls: string[],
  existing?: WcImageRef[],
  storedMap: Record<string, number> = {},
): { id?: number; src?: string }[] {
  const limited = urls.slice(0, Math.max(0, WC_MAX_IMAGES_PER_SYNC));
  const { byNormSrc, byFingerprint } = indexExistingWcImages(existing || []);
  const usedIds = new Set<number>();

  return limited.map((url) => {
    const norm = normalizeImageUrl(url);
    const fp = imageFingerprint(url);
    const candidates = [
      storedMap[norm],
      storedMap[url],
      byNormSrc.get(norm),
      byFingerprint.get(fp),
    ].filter((id): id is number => !!id && id > 0);

    for (const id of candidates) {
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return { id };
      }
    }
    return { src: url };
  });
}

function imagesPayloadSignature(images: { id?: number; src?: string }[]): string {
  return images
    .map((im) => (im.id ? `id:${im.id}` : `src:${imageFingerprint(im.src || '')}`))
    .join('|');
}

function buildImageIdMapFromSync(
  catalogUrls: string[],
  wcImages: WcImageRef[],
  imagesPayload: { id?: number; src?: string }[],
): Record<string, number> {
  const map: Record<string, number> = {};
  const limited = catalogUrls.slice(0, WC_MAX_IMAGES_PER_SYNC);
  for (let i = 0; i < limited.length; i++) {
    const url = limited[i];
    const key = normalizeImageUrl(url);
    const id = imagesPayload[i]?.id || wcImages[i]?.id;
    if (id) map[key] = id;
  }
  return map;
}

async function fetchWcProductById(wcId: number) {
  const { res, data } = await wcFetch(`/products/${wcId}`);
  if (!res.ok) return null;
  return data as { id: number; sku?: string; name?: string; images?: WcImageRef[] };
}

function dedupeBy<T>(items: T[], keyFn: (x: T) => string) {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

async function resolveWcIdFromSkuOrId(input: { sku?: string; wc_id?: number }) {
  const wcId = Number(input.wc_id) || 0;
  if (wcId > 0) return wcId;
  const sku = String(input.sku || '').trim();
  if (!sku) return 0;
  const found = await findProductBySku(sku);
  return Number(found?.id || 0);
}

async function inspectWcImages(
  log: (m: string, extra?: unknown) => void,
  input: { sku?: string; wc_id?: number },
) {
  const wcId = await resolveWcIdFromSkuOrId(input);
  if (!wcId) return { ok: false, error: 'Falta sku o wc_id' };
  const p = await fetchWcProductById(wcId);
  if (!p) return { ok: false, error: 'Producto WC no encontrado' };
  const imgs = Array.isArray(p.images) ? p.images : [];
  const fps = imgs.map((im) => imageFingerprint(im?.src || ''));
  const counts: Record<string, number> = {};
  for (const fp of fps) counts[fp] = (counts[fp] || 0) + 1;
  const duplicates = Object.entries(counts)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  log('WC inspect imágenes', { wcId, total: imgs.length, duplicates: duplicates.length });
  return {
    ok: true,
    wc_id: wcId,
    total_images: imgs.length,
    duplicate_fingerprints: duplicates,
    fingerprints: fps.slice(0, 80),
  };
}

async function dedupeWcImages(
  log: (m: string, extra?: unknown) => void,
  input: { sku?: string; wc_id?: number; dry_run?: boolean },
) {
  const wcId = await resolveWcIdFromSkuOrId(input);
  if (!wcId) return { ok: false, error: 'Falta sku o wc_id' };
  const p = await fetchWcProductById(wcId);
  if (!p) return { ok: false, error: 'Producto WC no encontrado' };
  const imgs = Array.isArray(p.images) ? p.images : [];
  const unique = dedupeBy(imgs, (im) => imageFingerprint(im?.src || ''));
  const removed = Math.max(0, imgs.length - unique.length);
  log('WC dedupe imágenes (plan)', { wcId, before: imgs.length, after: unique.length, removed });
  const dryRun = input.dry_run !== false;
  if (dryRun) {
    return { ok: true, wc_id: wcId, dry_run: true, before: imgs.length, after: unique.length, removed };
  }
  const payload = {
    images: unique.map((im) => (im.id ? { id: im.id } : im.src ? { src: im.src } : {})).filter((x) => Object.keys(x).length),
  };
  const { res, data } = await wcFetch(`/products/${wcId}`, { method: 'PUT', body: JSON.stringify(payload) });
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message?: string }).message)
        : res.statusText;
    throw new Error(`WooCommerce dedupe images (${res.status}): ${msg}`);
  }
  const saved = data as { images?: WcImageRef[] };
  log('WC dedupe imágenes (aplicado)', { wcId, savedCount: Array.isArray(saved?.images) ? saved.images.length : null });
  return { ok: true, wc_id: wcId, dry_run: false, before: imgs.length, after: unique.length, removed };
}

async function dedupeWcImagesAll(
  log: (m: string, extra?: unknown) => void,
  opts: { dry_run?: boolean; limit?: number; max_scan?: number } = {},
) {
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);
  const maxScan = Math.min(Math.max(Number(opts.max_scan) || 2000, 1), 20000);
  const dryRun = opts.dry_run !== false;

  let scanned = 0;
  let page = 1;
  const perPage = 100;

  const results: {
    woocommerce_product_id: number;
    sku?: string;
    name?: string;
    ok: boolean;
    dry_run?: boolean;
    before?: number;
    after?: number;
    removed?: number;
    error?: string;
  }[] = [];

  while (scanned < maxScan && results.length < limit) {
    const batch = await listWcProductsPage(page, perPage, 'any');
    if (!batch.length) break;

    for (const item of batch) {
      scanned++;
      const wcId = Number(item.id) || 0;
      if (!wcId) continue;

      const p = await fetchWcProductById(wcId);
      const imgs = Array.isArray(p?.images) ? (p!.images as WcImageRef[]) : [];
      if (imgs.length < 2) continue;

      const unique = dedupeBy(imgs, (im) => imageFingerprint(im?.src || ''));
      const removed = imgs.length - unique.length;
      if (removed <= 0) continue;

      if (dryRun) {
        results.push({
          woocommerce_product_id: wcId,
          sku: item.sku,
          name: item.name,
          ok: true,
          dry_run: true,
          before: imgs.length,
          after: unique.length,
          removed,
        });
      } else {
        try {
          const payload = {
            images: unique
              .map((im) => (im.id ? { id: im.id } : im.src ? { src: im.src } : {}))
              .filter((x) => Object.keys(x).length),
          };
          const { res, data } = await wcFetch(`/products/${wcId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const msg =
              typeof data === 'object' && data && 'message' in data
                ? String((data as { message?: string }).message)
                : res.statusText;
            throw new Error(`PUT images (${res.status}): ${msg}`);
          }
          results.push({
            woocommerce_product_id: wcId,
            sku: item.sku,
            name: item.name,
            ok: true,
            dry_run: false,
            before: imgs.length,
            after: unique.length,
            removed,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({
            woocommerce_product_id: wcId,
            sku: item.sku,
            name: item.name,
            ok: false,
            error: msg,
          });
        }
      }

      if (results.length >= limit) break;
      if (scanned >= maxScan) break;
    }

    if (batch.length < perPage) break;
    page++;
    if (page > 250) break;
  }

  log('WC dedupe imágenes batch completado', { scanned, fixed: results.length, dryRun });
  return {
    ok: true,
    dry_run: dryRun,
    scanned,
    processed: results.length,
    results,
  };
}

function buildAttributes(sizes: string[], colors: string[], asVariation: boolean) {
  const attrs: Record<string, unknown>[] = [];
  if (sizes.length) {
    attrs.push({
      name: 'Talla',
      visible: true,
      variation: asVariation,
      options: sizes,
    });
  }
  if (colors.length) {
    attrs.push({
      name: 'Color',
      visible: true,
      variation: asVariation,
      options: colors,
    });
  }
  return attrs;
}

type WcVariationRow = { id?: number; attributes?: Array<{ name?: string; option?: string }> };

function comboKey(size: string | null, color: string | null) {
  const s = (size || '').trim();
  const c = (color || '').trim();
  return `${s}||${c}`.toLowerCase();
}

function extractComboKeyFromVariation(v: WcVariationRow): string {
  const attrs = Array.isArray(v?.attributes) ? v.attributes : [];
  const size = attrs.find((a) => normalizeText(a?.name) === 'talla')?.option || '';
  const color = attrs.find((a) => normalizeText(a?.name) === 'color')?.option || '';
  return comboKey(size, color);
}

async function listWcVariations(productId: number): Promise<WcVariationRow[]> {
  const all: WcVariationRow[] = [];
  // Woo devuelve paginado; normalmente no habrá tantas, pero soportamos hasta 2 páginas por seguridad.
  for (let page = 1; page <= 2; page++) {
    const { res, data } = await wcFetch(`/products/${productId}/variations?per_page=100&page=${page}`);
    if (!res.ok || !Array.isArray(data) || data.length === 0) break;
    all.push(...(data as WcVariationRow[]));
    if (data.length < 100) break;
  }
  return all;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type VariationImageCtx = {
  colorCoverByLabel: Map<string, string>;
  globalCoverUrl: string;
  wcImages: WcImageRef[];
  storedImageMap: Record<string, number>;
};

/** Misma etiqueta que ERP → product_colors → atributo Woo Color (talla no afecta la foto). */
function coverUrlForColor(
  color: string,
  colorCoverByLabel: Map<string, string>,
  globalCoverUrl: string,
): string {
  const raw = String(color || '').trim();
  if (!raw) return globalCoverUrl;
  if (colorCoverByLabel.has(raw)) return colorCoverByLabel.get(raw)!;
  const want = normalizeText(raw);
  for (const [label, url] of colorCoverByLabel) {
    if (normalizeText(label) === want) return url;
  }
  return globalCoverUrl;
}

async function upsertWcVariations(
  productId: number,
  sizes: string[],
  colors: string[],
  regular_price: string,
  log: (m: string, extra?: unknown) => void,
  imgCtx?: VariationImageCtx,
) {
  const sz = (sizes || []).map((x) => String(x || '').trim()).filter(Boolean);
  const cl = (colors || []).map((x) => String(x || '').trim()).filter(Boolean);

  // Si no hay combos reales, no creamos variaciones.
  const wantSizes = sz.length ? sz : [''];
  const wantColors = cl.length ? cl : [''];
  const desired: Array<{ size: string; color: string; key: string }> = [];
  for (const s of wantSizes) {
    for (const c of wantColors) {
      // si ambos están vacíos, no tiene sentido.
      if (!s && !c) continue;
      desired.push({ size: s, color: c, key: comboKey(s, c) });
    }
  }

  // Protección: no crear explosión de variaciones accidental.
  if (desired.length > 80) {
    log('Se omite creación de variaciones: demasiadas combinaciones', { productId, desired: desired.length });
    return;
  }

  const existing = await listWcVariations(productId);
  const byKey = new Map<string, WcVariationRow>();
  for (const v of existing) {
    const key = extractComboKeyFromVariation(v);
    if (key && !byKey.has(key)) byKey.set(key, v);
  }

  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: Record<string, unknown>[] = [];

  for (const d of desired) {
    const found = byKey.get(d.key);
    const attrs: Array<{ name: string; option: string }> = [];
    if (d.size) attrs.push({ name: 'Talla', option: d.size });
    if (d.color) attrs.push({ name: 'Color', option: d.color });

    const vPayload: Record<string, unknown> = {
      regular_price,
      status: 'publish',
      attributes: attrs,
    };

    if (d.color && imgCtx) {
      const url = coverUrlForColor(d.color, imgCtx.colorCoverByLabel, imgCtx.globalCoverUrl);
      if (url) {
        const [wcImg] = buildImagesPayload([url], imgCtx.wcImages, imgCtx.storedImageMap);
        if (wcImg?.id) vPayload.image = { id: wcImg.id };
        else if (wcImg?.src) vPayload.image = { src: wcImg.src };
      }
    }

    if (found?.id) toUpdate.push({ id: found.id, ...vPayload });
    else toCreate.push(vPayload);
  }

  const CHUNK = 40;
  let created = 0;
  let updated = 0;

  // Endpoint batch: reduce N requests a 1..Nchunks
  const createChunks = chunk(toCreate, CHUNK);
  const updateChunks = chunk(toUpdate, CHUNK);
  const rounds = Math.max(createChunks.length, updateChunks.length, 1);

  for (let i = 0; i < rounds; i++) {
    const createPart = createChunks[i] || [];
    const updatePart = updateChunks[i] || [];
    if (!createPart.length && !updatePart.length) continue;

    const { res, data } = await wcFetch(`/products/${productId}/variations/batch`, {
      method: 'POST',
      body: JSON.stringify({ create: createPart, update: updatePart }),
    });

    if (!res.ok) {
      log('Woo variations batch error', { status: res.status, data });
      // Si falla el batch por algo puntual, preferimos fallar para que quede auditado y no timeoutee.
      throw new Error(`Woo variations batch (${res.status}): ${JSON.stringify(data)}`);
    }

    const createdRows = (data && typeof data === 'object' && 'create' in data && Array.isArray((data as any).create))
      ? (data as any).create
      : [];
    const updatedRows = (data && typeof data === 'object' && 'update' in data && Array.isArray((data as any).update))
      ? (data as any).update
      : [];
    created += createdRows.length;
    updated += updatedRows.length;

    log('Variaciones Woo batch OK', {
      productId,
      round: i + 1,
      rounds,
      sent: { create: createPart.length, update: updatePart.length },
      got: { create: createdRows.length, update: updatedRows.length },
    });
  }

  log('Variaciones WooCommerce upsert (batch)', {
    productId,
    sizes: sz.length,
    colors: cl.length,
    desired: desired.length,
    created,
    updated,
    existing: existing.length,
  });
}

type WooDeleteResult = {
  woocommerce_product_id?: number;
  trashed: boolean;
  reason?: string;
  not_found?: boolean;
};

/**
 * Mueve el producto a papelera en WooCommerce (status: trash).
 * Gravity/Addi escucha publish → trash y envía ProductDeleted a la marketplace.
 */
async function trashWooProduct(
  wcId: number,
  log: (m: string, extra?: unknown) => void,
): Promise<WooDeleteResult> {
  const { res, data } = await wcFetch(`/products/${wcId}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'trash' }),
  });
  if (res.status === 404) {
    log('WC producto no encontrado (ya eliminado?)', { wcId });
    return { woocommerce_product_id: wcId, trashed: false, not_found: true, reason: 'wc_not_found' };
  }
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message?: string }).message)
        : res.statusText;
    throw new Error(`WooCommerce trash (${res.status}): ${msg}`);
  }
  log('WC producto movido a papelera', { wcId });
  return { woocommerce_product_id: wcId, trashed: true };
}

async function deleteOneProductFromWoo(
  admin: ReturnType<typeof createClient>,
  productId: string,
  log: (m: string, extra?: unknown) => void,
): Promise<WooDeleteResult & { product_id: string }> {
  const { data: row, error } = await admin
    .from('products')
    .select('id,ref,woocommerce_product_id')
    .eq('id', productId)
    .maybeSingle();

  if (error) throw error;
  if (!row) {
    log('Producto no existe en Supabase (skip WC delete)', { productId });
    return { product_id: productId, trashed: false, reason: 'product_not_in_db' };
  }

  const ref = String(row.ref || '').trim();
  let wcId = Number(row.woocommerce_product_id) || 0;

  if (!wcId && ref) {
    const found = await findProductBySku(ref);
    wcId = found?.id || 0;
    if (wcId) log('WC id resuelto por SKU', { productId, ref, wcId });
  }

  if (!wcId) {
    log('Sin producto WooCommerce vinculado', { productId, ref });
    return { product_id: productId, trashed: false, reason: 'no_wc_product' };
  }

  const out = await trashWooProduct(wcId, log);
  return { product_id: productId, ...out };
}

async function syncOneProduct(
  admin: ReturnType<typeof createClient>,
  productId: string,
  log: (m: string, extra?: unknown) => void,
): Promise<WooSyncResult> {
  const { data: p, error: pe } = await admin
    .from('products')
    .select('id,ref,name,seccion,categoria,price,active,woocommerce_product_id,woocommerce_last_payload')
    .eq('id', productId)
    .maybeSingle();

  if (pe) throw pe;
  if (!p) throw new Error('Producto no encontrado');
  const row = p as ProductRow;
  if (!row.ref || !String(row.ref).trim()) throw new Error('Producto sin referencia (SKU)');

  const [{ data: mediaRows, error: me }, { data: colorRows, error: ce }, { data: sizeRows, error: se }, { data: colorCoverRows, error: cce }] =
    await Promise.all([
      admin.from('product_media').select('url,is_cover').eq('product_id', productId).order('is_cover', {
        ascending: false,
      }),
      admin.from('product_colors').select('colors(label)').eq('product_id', productId),
      admin.from('product_sizes').select('sizes(label)').eq('product_id', productId),
      admin.from('product_color_media').select('url, colors(label)').eq('product_id', productId),
    ]);

  if (me) throw me;
  if (ce) throw ce;
  if (se) throw se;
  if (cce) throw cce;

  const imageUrls =
    (mediaRows as MediaRow[] | null | undefined)?.map((m) => m.url).filter((u): u is string => !!u && !isVideoUrl(u)) ||
    [];

  // Importante: no bloquear la sincronización si no hay fotos (o solo hay videos).
  // Woo puede aceptar el producto sin imágenes; luego se pueden corregir desde el catálogo.
  if (!imageUrls.length) {
    log('Producto sin imágenes válidas; se sincroniza sin fotos', { sku: row.ref });
  }

  const colors =
    (colorRows as { colors: JoinLabel | null }[] | null | undefined)
      ?.map((r) => r.colors?.label)
      .filter((x): x is string => !!x && !!String(x).trim()) || [];

  const sizes =
    (sizeRows as { sizes: JoinLabel | null }[] | null | undefined)
      ?.map((r) => r.sizes?.label)
      .filter((x): x is string => !!x && !!String(x).trim()) || [];

  const colorCoverByLabel = new Map<string, string>();
  for (const row of (colorCoverRows as { url?: string; colors?: JoinLabel | null }[] | null) || []) {
    const label = row.colors?.label;
    const url = row.url;
    if (label && url) colorCoverByLabel.set(String(label).trim(), String(url));
  }
  const globalCoverUrl =
    (mediaRows as MediaRow[] | null)?.find((m) => m.is_cover)?.url ||
    (mediaRows as MediaRow[] | null)?.[0]?.url ||
    '';
  const variationImageCtx = (wcImgs: WcImageRef[], map: Record<string, number>): VariationImageCtx => ({
    colorCoverByLabel,
    globalCoverUrl,
    wcImages: wcImgs,
    storedImageMap: map,
  });

  const sku = String(row.ref).trim();
  const priceNum = Math.round(Number(row.price) || 0);
  const regular_price = String(priceNum);

  const { description, short_description } = buildDescriptions(row, sizes, colors);
  const commercialCats = buildCategoryCommercialNames(row);
  const categories = await resolveWcCategoryPayload(commercialCats, log);
  const isVariable = sizes.length > 0 || colors.length > 0;
  const attributes = buildAttributes(sizes, colors, isVariable);

  // Prefer stored Woo ID over SKU lookup. After ERP refs became HERA-*, SKU lookup
  // missed old Woo products (SKU=name) and created duplicates.
  const storedWcId =
    Number((row as ProductRow & { woocommerce_product_id?: number }).woocommerce_product_id) || 0;
  type WcExisting = { id: number; sku?: string; name?: string; images?: WcImageRef[] };
  let existing: WcExisting | null = null;
  let resolveSource: 'wc_id' | 'sku' | 'none' = 'none';

  if (storedWcId > 0) {
    const byId = await fetchWcProductById(storedWcId);
    if (byId?.id) {
      existing = byId;
      resolveSource = 'wc_id';
    } else {
      log('woocommerce_product_id ausente en Woo; se intenta por SKU', { storedWcId, sku });
    }
  }
  if (!existing?.id) {
    const bySku = await findProductBySku(sku);
    if (bySku?.id) {
      existing = bySku as WcExisting;
      resolveSource = 'sku';
    }
  }

  const prevLastPayload =
    (row as ProductRow & { woocommerce_last_payload?: Record<string, unknown> | null })
      .woocommerce_last_payload || {};
  const storedImageMap =
    (prevLastPayload.image_id_map as Record<string, number> | undefined) || {};
  const prevImagesSig = String(prevLastPayload.images_sync_sig || '');

  let wcImages: WcImageRef[] = [];
  if (existing?.id) {
    const full = existing.images ? existing : await fetchWcProductById(existing.id);
    wcImages = full?.images || existing.images || [];
  }

  const imagesPayload = imageUrls.length ? buildImagesPayload(imageUrls, wcImages, storedImageMap) : [];
  const imagesSig = imagesPayload.length ? imagesPayloadSignature(imagesPayload) : '';
  const imagesUnchanged = !!existing?.id && imagesSig && imagesSig === prevImagesSig;
  const newUploads = imagesPayload.filter((im) => !im.id && im.src).length;
  if (newUploads > 0) {
    log('Imágenes nuevas a subir', { sku, newUploads, reused: imagesPayload.length - newUploads });
  }
  if (imageUrls.length > WC_MAX_IMAGES_PER_SYNC) {
    log('Imágenes limitadas para evitar timeout', {
      sku,
      original: imageUrls.length,
      sent: imagesPayload.length,
      maxPerSync: WC_MAX_IMAGES_PER_SYNC,
    });
  }

  const payload: Record<string, unknown> = {
    name: row.name || sku,
    sku,
    type: isVariable ? 'variable' : 'simple',
    status: 'publish',
    ...(isVariable ? {} : { regular_price }),
    description,
    short_description,
    categories,
    attributes,
  };

  if (imageUrls.length && !imagesUnchanged) {
    payload.images = imagesPayload;
  } else if (imagesUnchanged) {
    log('Imágenes sin cambios; omitidas del PUT (evita duplicados)', { sku, images: imagesPayload.length });
  } else if (!imageUrls.length) {
    payload.images = [];
  }

  const lastPayload = { ...payload, image_id_map: storedImageMap, images_sync_sig: imagesSig || prevImagesSig } as Record<
    string,
    unknown
  >;

  log('WooCommerce payload listo', {
    sku,
    update: !!existing?.id,
    resolveSource,
    existingId: existing?.id || null,
    existingSku: existing?.sku || null,
    image_count: imagesPayload.length,
    images_omitted: imagesUnchanged,
    catalog: { seccion: row.seccion, categoria: row.categoria },
    commercialCats,
    categoriesResolved: categories,
  });

  function finalizeLastPayload(
    savedImages: WcImageRef[] | undefined,
    base: Record<string, unknown>,
  ): Record<string, unknown> {
    const mergedMap = {
      ...storedImageMap,
      ...buildImageIdMapFromSync(imageUrls, savedImages || [], imagesPayload),
    };
    const sig = imagesPayload.length ? imagesPayloadSignature(imagesPayload) : prevImagesSig;
    return { ...base, image_id_map: mergedMap, images_sync_sig: sig };
  }

  if (existing?.id) {
    const { res, data } = await wcFetch(`/products/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const msg =
        typeof data === 'object' && data && 'message' in data
          ? String((data as { message?: string }).message)
          : JSON.stringify(data);
      log('WooCommerce PUT error', { status: res.status, data });
      // Si el error es por imágenes (tipo no permitido, etc.), reintentar sin imágenes.
      if (payload.images && isWcImageRejectedMessage(msg)) {
        log('Woo rechaza imágenes; reintento sin imágenes (PUT)', { sku, status: res.status, msg });
        const payloadNoImages = { ...payload, images: [] as unknown[] };
        const lastPayloadNoImages = { ...payloadNoImages } as Record<string, unknown>;
        const { res: r2, data: d2 } = await wcFetch(`/products/${existing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payloadNoImages),
        });
        if (!r2.ok) {
          const msg2 =
            typeof d2 === 'object' && d2 && 'message' in d2
              ? String((d2 as { message?: string }).message)
              : JSON.stringify(d2);
          log('WooCommerce PUT error (sin imágenes)', { status: r2.status, data: d2 });
          throw errWithPayload(`WooCommerce actualizar (${r2.status}): ${msg2}`, lastPayloadNoImages);
        }
        const saved2 = d2 as { id?: number };
        const wcId2 = Number(saved2?.id || existing.id);
        if (isVariable) {
          await upsertWcVariations(
          wcId2,
          sizes,
          colors,
          regular_price,
          log,
          variationImageCtx([], storedImageMap),
        );
        }
        return { woocommerce_product_id: wcId2, created: false, lastPayload: finalizeLastPayload(undefined, lastPayloadNoImages) };
      }

      throw errWithPayload(`WooCommerce actualizar (${res.status}): ${msg}`, lastPayload);
    }
    const saved = data as { id?: number; images?: WcImageRef[] };
    const wcId = Number(saved?.id || existing.id);
    if (isVariable) {
      await upsertWcVariations(
      wcId,
      sizes,
      colors,
      regular_price,
      log,
      variationImageCtx(saved?.images || wcImages, (finalizeLastPayload(saved?.images, lastPayload).image_id_map as Record<string, number>) || storedImageMap),
    );
    }
    return {
      woocommerce_product_id: wcId,
      created: false,
      lastPayload: finalizeLastPayload(saved.images, lastPayload),
    };
  }

  const { res, data } = await wcFetch('/products', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message?: string }).message)
        : JSON.stringify(data);
    log('WooCommerce POST error', { status: res.status, data });

    // Si el error es por imágenes (tipo no permitido, etc.), reintentar sin imágenes.
    if (payload.images && isWcImageRejectedMessage(msg)) {
      log('Woo rechaza imágenes; reintento sin imágenes (POST)', { sku, status: res.status, msg });
      const payloadNoImages = { ...payload, images: [] as unknown[] };
      const lastPayloadNoImages = { ...payloadNoImages } as Record<string, unknown>;
      const { res: r2, data: d2 } = await wcFetch('/products', {
        method: 'POST',
        body: JSON.stringify(payloadNoImages),
      });
      if (!r2.ok) {
        const msg2 =
          typeof d2 === 'object' && d2 && 'message' in d2
            ? String((d2 as { message?: string }).message)
            : JSON.stringify(d2);
        log('WooCommerce POST error (sin imágenes)', { status: r2.status, data: d2 });
        throw errWithPayload(`WooCommerce crear (${r2.status}): ${msg2}`, lastPayloadNoImages);
      }
      const created2 = d2 as { id?: number };
      if (!created2?.id) throw new Error('WooCommerce no devolvió id de producto');
      const wcId2 = Number(created2.id);
      if (isVariable) {
        await upsertWcVariations(
          wcId2,
          sizes,
          colors,
          regular_price,
          log,
          variationImageCtx([], storedImageMap),
        );
      }
      return { woocommerce_product_id: wcId2, created: true, lastPayload: lastPayloadNoImages };
    }

    // Woo puede devolver 400 "SKU already present in the lookup table" aunque el GET por SKU no haya devuelto filas
    // (caché/índice interno, productos previos, etc.). En ese caso re-intentamos resolver por SKU y actualizamos.
    if (
      res.status === 400 &&
      msg.toLowerCase().includes('sku') &&
      msg.toLowerCase().includes('already') &&
      msg.toLowerCase().includes('lookup table')
    ) {
      const retryExisting = await findProductBySku(sku);
      if (retryExisting?.id) {
        log('SKU ya existe en Woo; se hace PUT en vez de POST', { sku, id: retryExisting.id });
        const { res: res2, data: data2 } = await wcFetch(`/products/${retryExisting.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (!res2.ok) {
          const msg2 =
            typeof data2 === 'object' && data2 && 'message' in data2
              ? String((data2 as { message?: string }).message)
              : JSON.stringify(data2);
          log('WooCommerce PUT error (fallback)', { status: res2.status, data: data2 });
          throw errWithPayload(`WooCommerce actualizar (${res2.status}): ${msg2}`, lastPayload);
        }
        const saved2 = data2 as { id?: number; images?: WcImageRef[] };
        const wcId2 = Number(saved2?.id || retryExisting.id);
        if (isVariable) {
          await upsertWcVariations(
            wcId2,
            sizes,
            colors,
            regular_price,
            log,
            variationImageCtx(
              saved2?.images || wcImages,
              (finalizeLastPayload(saved2?.images, lastPayload).image_id_map as Record<string, number>) || storedImageMap,
            ),
          );
        }
        return {
          woocommerce_product_id: wcId2,
          created: false,
          lastPayload: finalizeLastPayload(saved2.images, lastPayload),
        };
      }
    }

    throw errWithPayload(`WooCommerce crear (${res.status}): ${msg}`, lastPayload);
  }
  const created = data as { id?: number; images?: WcImageRef[] };
  if (!created?.id) throw new Error('WooCommerce no devolvió id de producto');
  const wcId = Number(created.id);
  if (isVariable) {
    await upsertWcVariations(
      wcId,
      sizes,
      colors,
      regular_price,
      log,
      variationImageCtx(created?.images || wcImages, (finalizeLastPayload(created?.images, lastPayload).image_id_map as Record<string, number>) || storedImageMap),
    );
  }
  return {
    woocommerce_product_id: wcId,
    created: true,
    lastPayload: finalizeLastPayload(created.images, lastPayload),
  };
}

type WcListItem = { id: number; sku?: string; name?: string; status?: string; type?: string };

async function listWcProductsPage(page: number, perPage: number, status = 'any') {
  const st = encodeURIComponent(status);
  const { res, data } = await wcFetch(
    `/products?per_page=${perPage}&page=${page}&status=${st}&orderby=id&order=asc`,
  );
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message?: string }).message)
        : res.statusText;
    throw new Error(`WooCommerce listar productos (${res.status}): ${msg}`);
  }
  const batch = (Array.isArray(data) ? data : []) as WcListItem[];
  return batch.filter((p) => p.status !== 'trash');
}

async function loadSupabaseCatalogKeys(admin: ReturnType<typeof createClient>) {
  const refs = new Set<string>();
  const wcIds = new Set<number>();
  const pageSize = 1000;
  let from = 0;
  let productCount = 0;
  while (true) {
    const { data, error } = await admin
      .from('products')
      .select('ref,woocommerce_product_id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    productCount += rows.length;
    for (const r of rows) {
      const ref = String(r.ref || '').trim().toUpperCase();
      if (ref) refs.add(ref);
      const wid = Number(r.woocommerce_product_id);
      if (wid > 0) wcIds.add(wid);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 100000) break;
  }
  return { refs, wcIds, productCount };
}

function isWcOrphan(p: WcListItem, refs: Set<string>, wcIds: Set<number>) {
  const id = Number(p.id);
  if (wcIds.has(id)) return false;
  const sku = String(p.sku || '').trim().toUpperCase();
  if (sku && refs.has(sku)) return false;
  return true;
}

async function findWooCommerceOrphans(
  admin: ReturnType<typeof createClient>,
  log: (m: string, extra?: unknown) => void,
  opts: { maxScan?: number } = {},
) {
  const maxScan = Math.min(Math.max(opts.maxScan || 5000, 1), 20000);
  const keys = await loadSupabaseCatalogKeys(admin);
  log('Catálogo Supabase cargado', {
    refs: keys.refs.size,
    wcIds: keys.wcIds.size,
  });

  const orphans: WcListItem[] = [];
  let scanned = 0;
  let page = 1;
  const perPage = 100;

  while (scanned < maxScan) {
    const batch = await listWcProductsPage(page, perPage);
    if (!batch.length) break;
    for (const p of batch) {
      scanned++;
      if (isWcOrphan(p, keys.refs, keys.wcIds)) {
        orphans.push({
          id: Number(p.id),
          sku: p.sku,
          name: p.name,
          status: p.status,
          type: p.type,
        });
      }
      if (scanned >= maxScan) break;
    }
    if (batch.length < perPage) break;
    page++;
    if (page > 250) break;
  }

  log('Escaneo WooCommerce completado', { scanned, orphans: orphans.length });
  return { orphans, scanned, catalog: keys };
}

async function cleanupWooCommerceOrphans(
  admin: ReturnType<typeof createClient>,
  log: (m: string, extra?: unknown) => void,
  opts: { dry_run?: boolean; limit?: number; max_scan?: number } = {},
) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const dryRun = opts.dry_run !== false;
  const { orphans, scanned, catalog } = await findWooCommerceOrphans(admin, log, {
    maxScan: opts.max_scan,
  });
  const toProcess = orphans.slice(0, limit);
  const results: {
    woocommerce_product_id: number;
    sku?: string;
    name?: string;
    ok: boolean;
    trashed?: boolean;
    dry_run?: boolean;
    error?: string;
  }[] = [];

  for (const p of toProcess) {
    if (dryRun) {
      results.push({
        woocommerce_product_id: p.id,
        sku: p.sku,
        name: p.name,
        ok: true,
        dry_run: true,
      });
      continue;
    }
    try {
      const out = await trashWooProduct(p.id, log);
      results.push({
        woocommerce_product_id: p.id,
        sku: p.sku,
        name: p.name,
        ok: true,
        trashed: out.trashed,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        woocommerce_product_id: p.id,
        sku: p.sku,
        name: p.name,
        ok: false,
        error: msg,
      });
    }
  }

  return {
    dry_run: dryRun,
    scanned,
    orphans_found: orphans.length,
    processed: results.length,
    remaining_orphans: Math.max(orphans.length - toProcess.length, 0),
    catalog_refs: catalog.refs.size,
    catalog_wc_ids: catalog.wcIds.size,
    results,
  };
}

async function listWcTrashPage(page: number, perPage: number): Promise<WcListItem[]> {
  const { res, data } = await wcFetch(
    `/products?per_page=${perPage}&page=${page}&status=trash&orderby=id&order=asc`,
  );
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message?: string }).message)
        : res.statusText;
    throw new Error(`WooCommerce listar papelera (${res.status}): ${msg}`);
  }
  return (Array.isArray(data) ? data : []) as WcListItem[];
}

async function forceDeleteWcProduct(wcId: number, log: (m: string, extra?: unknown) => void) {
  const { res, data } = await wcFetch(`/products/${wcId}?force=true`, { method: 'DELETE' });
  if (res.status === 404) {
    log('WC producto ya no existe', { wcId });
    return { woocommerce_product_id: wcId, deleted: false, not_found: true };
  }
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message?: string }).message)
        : res.statusText;
    throw new Error(`WooCommerce borrar permanente (${res.status}): ${msg}`);
  }
  log('WC producto eliminado permanentemente', { wcId });
  return { woocommerce_product_id: wcId, deleted: true };
}

async function emptyWcTrash(
  log: (m: string, extra?: unknown) => void,
  opts: { dry_run?: boolean; limit?: number } = {},
) {
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 200);
  const dryRun = opts.dry_run !== false;
  const trashed: WcListItem[] = [];
  let page = 1;
  while (trashed.length < limit) {
    const batch = await listWcTrashPage(page, 100);
    if (!batch.length) break;
    for (const p of batch) {
      trashed.push(p);
      if (trashed.length >= limit) break;
    }
    if (batch.length < 100) break;
    page++;
    if (page > 20) break;
  }

  log('Productos en papelera WC', { found: trashed.length });
  const results: {
    woocommerce_product_id: number;
    sku?: string;
    name?: string;
    ok: boolean;
    deleted?: boolean;
    dry_run?: boolean;
    error?: string;
  }[] = [];

  for (const p of trashed) {
    if (dryRun) {
      results.push({
        woocommerce_product_id: p.id,
        sku: p.sku,
        name: p.name,
        ok: true,
        dry_run: true,
      });
      continue;
    }
    try {
      const out = await forceDeleteWcProduct(p.id, log);
      results.push({
        woocommerce_product_id: p.id,
        sku: p.sku,
        name: p.name,
        ok: true,
        deleted: out.deleted,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        woocommerce_product_id: p.id,
        sku: p.sku,
        name: p.name,
        ok: false,
        error: msg,
      });
    }
  }

  return {
    dry_run: dryRun,
    trashed_found: trashed.length,
    processed: results.length,
    results,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Método no permitido' }, 405);
  }

  const logs: { at: string; message: string; extra?: unknown }[] = [];
  const log = (message: string, extra?: unknown) => {
    const line = { at: new Date().toISOString(), message, extra };
    logs.push(line);
    console.log(`[sync-product-to-woocommerce] ${message}`, extra ?? '');
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return jsonResponse({ ok: false, error: 'Faltan variables SUPABASE_* en el entorno' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ ok: false, error: 'Se requiere sesión (Authorization Bearer)' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      log('Auth inválida', userErr?.message);
      return jsonResponse({ ok: false, error: 'Sesión inválida o expirada' }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as {
      product_id?: string;
      sync_all?: boolean;
      limit?: number;
      offset?: number;
      action?: 'delete' | 'sync';
      delete?: boolean;
      cleanup_orphans?: boolean;
      empty_trash?: boolean;
      wc_inspect_images?: boolean;
      wc_dedupe_images?: boolean;
      wc_dedupe_images_all?: boolean;
      wc_sku?: string;
      wc_id?: number;
      dry_run?: boolean;
      max_scan?: number;
    };

    const admin = createClient(supabaseUrl, serviceKey);

    if (body.empty_trash) {
      try {
        const out = await emptyWcTrash(log, {
          dry_run: body.dry_run !== false,
          limit: body.limit,
        });
        return jsonResponse({ ok: true, mode: 'empty_trash', ...out, logs });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('Error empty_trash', msg);
        return jsonResponse({ ok: false, mode: 'empty_trash', error: msg, logs }, 422);
      }
    }

    if (body.wc_inspect_images) {
      try {
        const out = await inspectWcImages(log, { sku: body.wc_sku, wc_id: body.wc_id });
        return jsonResponse({ mode: 'wc_inspect_images', ...out, logs }, out.ok ? 200 : 400);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('Error wc_inspect_images', msg);
        return jsonResponse({ ok: false, mode: 'wc_inspect_images', error: msg, logs }, 422);
      }
    }

    if (body.wc_dedupe_images) {
      try {
        const out = await dedupeWcImages(log, { sku: body.wc_sku, wc_id: body.wc_id, dry_run: body.dry_run });
        return jsonResponse({ mode: 'wc_dedupe_images', ...out, logs }, out.ok ? 200 : 400);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('Error wc_dedupe_images', msg);
        return jsonResponse({ ok: false, mode: 'wc_dedupe_images', error: msg, logs }, 422);
      }
    }

    if (body.wc_dedupe_images_all) {
      try {
        const out = await dedupeWcImagesAll(log, {
          dry_run: body.dry_run,
          limit: body.limit,
          max_scan: body.max_scan,
        });
        return jsonResponse({ ok: true, mode: 'wc_dedupe_images_all', ...out, logs }, 200);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('Error wc_dedupe_images_all', msg);
        return jsonResponse({ ok: false, mode: 'wc_dedupe_images_all', error: msg, logs }, 422);
      }
    }

    if (body.cleanup_orphans) {
      try {
        const out = await cleanupWooCommerceOrphans(admin, log, {
          dry_run: body.dry_run !== false,
          limit: body.limit,
          max_scan: body.max_scan,
        });
        return jsonResponse({ ok: true, mode: 'cleanup_orphans', ...out, logs });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('Error cleanup_orphans', msg);
        return jsonResponse({ ok: false, mode: 'cleanup_orphans', error: msg, logs }, 422);
      }
    }

    const isDelete = body.action === 'delete' || body.delete === true;
    if (isDelete) {
      const productId = (body.product_id || '').trim();
      if (!productId) {
        return jsonResponse({ ok: false, error: 'Falta product_id para delete' }, 400);
      }
      try {
        const out = await deleteOneProductFromWoo(admin, productId, log);
        return jsonResponse({
          ok: true,
          mode: 'delete',
          ...out,
          logs,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('Error delete single', { productId, msg });
        return jsonResponse({ ok: false, mode: 'delete', product_id: productId, error: msg, logs }, 422);
      }
    }

    if (body.sync_all) {
      /** Muchos productos por invocación superan el idle timeout del gateway (~150s). Máx. bajo = más peticiones, menos cortes. */
      const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 12);
      const offset = Math.min(Math.max(Number(body.offset) || 0, 0), 50000);
      const { data: rows, error: re } = await admin
        .from('products')
        .select('id,ref')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (re) throw re;
      const list = rows || [];
      const results: {
        product_id: string;
        ref: string;
        ok: boolean;
        woocommerce_product_id?: number;
        error?: string;
      }[] = [];

      for (const r of list) {
        const pid = String(r.id);
        const ref = String(r.ref || '');
        try {
          const out = await syncOneProduct(admin, pid, log);
          await admin
            .from('products')
            .update({
              woocommerce_product_id: out.woocommerce_product_id,
              woocommerce_synced_at: new Date().toISOString(),
              woocommerce_sync_status: 'synced',
              woocommerce_sync_error: null,
              woocommerce_last_payload: out.lastPayload,
            })
            .eq('id', pid);
          results.push({ product_id: pid, ref, ok: true, woocommerce_product_id: out.woocommerce_product_id });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const lp =
            e instanceof Error ? (e as Error & { lastPayload?: Record<string, unknown> }).lastPayload : undefined;
          log('Fallo sync_all item', { pid, ref, msg });
          await admin
            .from('products')
            .update({
              woocommerce_sync_status: 'error',
              woocommerce_sync_error: msg.slice(0, 2000),
              ...(lp ? { woocommerce_last_payload: lp } : {}),
            })
            .eq('id', pid);
          results.push({ product_id: pid, ref, ok: false, error: msg });
        }
      }

      return jsonResponse({
        ok: true,
        mode: 'sync_all',
        limit,
        offset,
        next_offset: offset + results.length,
        done: list.length < limit,
        processed: results.length,
        results,
        logs,
      });
    }

    const productId = (body.product_id || '').trim();
    if (!productId) {
      return jsonResponse({ ok: false, error: 'Falta product_id o sync_all' }, 400);
    }

    try {
      const out = await syncOneProduct(admin, productId, log);
      await admin
        .from('products')
        .update({
          woocommerce_product_id: out.woocommerce_product_id,
          woocommerce_synced_at: new Date().toISOString(),
          woocommerce_sync_status: 'synced',
          woocommerce_sync_error: null,
          woocommerce_last_payload: out.lastPayload,
        })
        .eq('id', productId);

      return jsonResponse({
        ok: true,
        product_id: productId,
        woocommerce_product_id: out.woocommerce_product_id,
        created: out.created,
        logs,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const lp =
        e instanceof Error ? (e as Error & { lastPayload?: Record<string, unknown> }).lastPayload : undefined;
      log('Error sync single', { productId, msg });
      await admin
        .from('products')
        .update({
          woocommerce_sync_status: 'error',
          woocommerce_sync_error: msg.slice(0, 2000),
          ...(lp ? { woocommerce_last_payload: lp } : {}),
        })
        .eq('id', productId);

      return jsonResponse({ ok: false, product_id: productId, error: msg, logs }, 422);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[sync-product-to-woocommerce] fatal', msg);
    return jsonResponse({ ok: false, error: msg, logs }, 500);
  }
});

