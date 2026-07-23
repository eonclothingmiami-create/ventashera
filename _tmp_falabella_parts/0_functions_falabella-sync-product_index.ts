/**
 * Falabella Seller Center API — ProductCreate (feed asíncrono).
 * Docs: https://developers.falabella.com/v600/reference/productcreate
 * Firma: https://developers.falabella.com/v600/reference/signing-requests
 *
 * Secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   FALABELLA_USER_ID — email del usuario API (Seller Center)
 *   FALABELLA_API_KEY — API Key del mismo usuario
 *   FALABELLA_OPERATOR_CODE — ej. faco (Colombia), facl (Chile), fape (Perú)
 *   FALABELLA_PRIMARY_CATEGORY_ID — fallback si no hay match en el mapa
 *   FALABELLA_CATEGORY_MAP_JSON — { "Nombre categoría ERP": "CategoryId", "__default__": "123" } (match por categoria/sección)
 *   FALABELLA_BRAND — marca visible en Falabella
 * Opcionales:
 *   FALABELLA_API_BASE — default https://sellercenter-api.falabella.com
 *   FALABELLA_SELLER_ID — para cabecera User-Agent (si vacío, se usa el prefijo de UserID)
 *   FALABELLA_BUSINESS_UNIT_CODE — FACO | FACL | FAPE (User-Agent)
 *   FALABELLA_CONDITION_TYPE — default Nuevo
 *   FALABELLA_PACKAGE_HEIGHT_CM, FALABELLA_PACKAGE_WIDTH_CM, FALABELLA_PACKAGE_LENGTH_CM — default 10
 *   FALABELLA_PACKAGE_WEIGHT_KG — default 2
 *   FALABELLA_PRODUCT_DATA_EXTRA_JSON — JSON objeto { "NombreNodo": "valor", ... } mezclado como base (FeedName de GetCategoryAttributes)
 *   FALABELLA_TAX_PERCENTAGE — obligatorio en Colombia (ej. 19)
 *   FALABELLA_SYNC_IMAGES — opcional: `0` o `false` desactiva el paso Action=Image tras ProductCreate OK (por defecto activo).
 *   FALABELLA_SKIP_BRAND_CHECK — `1` o `true`: omite GetBrands antes de ProductCreate (solo emergencias; riesgo de rechazo en feed).
 *   FALABELLA_AUTO_GENERIC_BRAND — default `true`: si GetBrands vacío o marca no listada → usa GENERICO y continúa (modo checkbox ML).
 *   FALABELLA_FEED_POLL_ATTEMPTS — default 18 (máx. 50). FALABELLA_FEED_POLL_BASE_MS (default 2000), FALABELLA_FEED_POLL_MAX_MS (default 14000), FALABELLA_FEED_POLL_BACKOFF (default 1.45).
 * Auto-mapa (sin maquetador UI): `_shared/falabella-auto-map.ts` — categoría ERP→3199/3188, color básico, talla, ProductData moda.
 * Moda / mínimo Falabella (Color, ColorBasico, Talla en el XML del producto):
 *   FALABELLA_DEFAULT_COLOR — si el producto no tiene color en BD
 *   FALABELLA_DEFAULT_COLOR_BASICO — si vacío, se usa Color
 *   FALABELLA_DEFAULT_TALLA — si el producto no tiene talla en BD
 *   FALABELLA_DEFAULT_MATERIAL / FALABELLA_DEFAULT_GENERO — ProductData (default Poliéster / Mujer)
 * Paquete (plantilla “minimum” suele usar 10×10×10 cm, 2 kg):
 *   FALABELLA_PACKAGE_* — por defecto 10, 10, 10, peso 2
 *
 * Body JSON: {
 *   productId: string,
 *   primaryCategoryId?: string,
 *   brand?: string,
 *   color?: string,
 *   colorBasico?: string,
 *   talla?: string,
 *   parentSku?: string,
 *   productDataMandatory?: Record<string, string>,
 *   productDataProductSpecific?: Record<string, string>,
 *   productDataOptional?: Record<string, string>,
 *   syncImages?: boolean — default true; false omite el paso Image tras ProductCreate OK.
 *   imageUrls?: string[] — opcional; si viene, sustituye a las URLs tomadas de products.images
 * }
 *
 * Los atributos largos de ProductData (Composicion, GeneroDeVestuario, etc.) dependen de
 * GetCategoryAttributes. En la doc/API suelen agruparse como:
 *   mandatory — obligatorios de la categoría
 *   product_specific — específicos del rubro
 *   optional — opcionales / scoring
 * Pásalos en el body como tres objetos (claves = FeedName del atributo, valor = texto) y se vuelcan
 * dentro de <ProductData> tras los campos base (paquete, IVA, etc.).
 *
 * Tras un ProductCreate cuyo feed queda en Finished sin fallos, se llama a Action=Image con hasta 8 URLs
 * de `products.images` (o `imageUrls` en el body). Docs: https://developers.falabella.com/reference/image
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import {
  jsonForDb,
  pollFeedUntilDoneWithBackoff,
  interpretFeedPollResult,
  fetchGetBrandsJson,
  parseBrandsFromGetBrandsResponse,
  brandMatchesFalabellaList,
  prevalidateProductCreateFields,
  buildValidationErrorMessage,
} from '../_shared/falabella-common.ts';
import { buildFalabellaAutoMap } from '../_shared/falabella-auto-map.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** PHP rawurlencode (RFC 3986) — debe coincidir con la referencia de Falabella. */
function phpRawUrlEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function utcTimestampIso8601(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signFalabellaQuery(
  apiKey: string,
  baseParams: Record<string, string>,
): Promise<Record<string, string>> {
  const sortedKeys = Object.keys(baseParams).sort();
  const pairs = sortedKeys.map(
    (k) => `${phpRawUrlEncode(k)}=${phpRawUrlEncode(baseParams[k])}`,
  );
  const concatenated = pairs.join('&');
  const hex = await hmacSha256Hex(apiKey, concatenated);
  return { ...baseParams, Signature: phpRawUrlEncode(hex) };
}

function buildQueryString(params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  return keys.map((k) => `${phpRawUrlEncode(k)}=${phpRawUrlEncode(params[k])}`).join('&');
}

function logStructured(ev: string, data: Record<string, unknown>) {
  try {
    console.log(
      '[falabella-sync-product]',
      JSON.stringify({ ev, t: new Date().toISOString(), ...data }),
    );
  } catch {
    /* noop */
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Nombre de etiqueta XML seguro (FeedName típico: Composicion, GeneroDeVestuario, …). */
function isSafeXmlTagName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name);
}

/**
 * Orden: cada capa sobrescribe claves de la anterior (última gana).
 * Uso: defaults secret → mandatory → product_specific → optional (como en GetCategoryAttributes).
 */
function mergeProductDataLayers(...layers: (Record<string, unknown> | undefined | null)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [k, v] of Object.entries(layer)) {
      if (!isSafeXmlTagName(k)) continue;
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (s === '') continue;
      out[k] = s;
    }
  }
  return out;
}

function productDataGroupToXml(extra: Record<string, string>): string {
  const keys = Object.keys(extra).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `      <${k}>${escapeXml(extra[k])}</${k}>`).join('\n');
}

type ProductRow = {
  id: string;
  ref?: string | null;
  name?: string | null;
  price?: number | string | null;
  description?: string | null;
  stock?: number | string | null;
  categoria?: string | null;
  seccion?: string | null;
  cat?: string | null;
  barcode?: string | null;
  ean?: string | null;
  /** JSON array de URLs o string JSON (mismo formato que el ERP). */
  images?: unknown;
  /** Texto: tallas separadas por coma (columna `products.sizes` en ERP). */
  sizes?: string | null;
  /** JSON string de colores o array (columna `products.colors`). */
  colors?: string | unknown[] | null;
  falabella_product_data_json?: Record<string, unknown> | null;
};

function firstTokenFromCommaList(s: string | null | undefined): string | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = s
    .split(',')
    .map((x) => x.trim())
    .find((x) => x.length > 0);
  return t ?? null;
}

function firstColorFromProductRow(p: ProductRow): string | null {
  const c = p.colors;
  if (Array.isArray(c)) {
    const first = c.find((x) => typeof x === 'string' && x.trim());
    return first != null ? String(first).trim() : null;
  }
  if (typeof c === 'string' && c.trim()) {
    try {
      const parsed = JSON.parse(c) as unknown;
      if (Array.isArray(parsed)) {
        const first = parsed.find((x) => typeof x === 'string' && String(x).trim());
        return first != null ? String(first).trim() : null;
      }
    } catch {
      return firstTokenFromCommaList(c);
    }
  }
  return null;
}

function firstSizeFromProductRow(p: ProductRow): string | null {
  return firstTokenFromCommaList(typeof p.sizes === 'string' ? p.sizes : undefined);
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** Hasta 8 URLs http(s) para Falabella Image; primera = portada. Si `bodyImageUrls` tiene entradas, solo se usan esas (no se mezcla con `products.images`). */
function collectImageUrlsForFalabella(product: ProductRow, bodyImageUrls?: unknown): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    const t = u.trim();
    if (!t || !isHttpUrl(t)) return;
    if (out.includes(t)) return;
    out.push(t);
  };

  if (Array.isArray(bodyImageUrls) && bodyImageUrls.length > 0) {
    for (const u of bodyImageUrls) {
      if (typeof u === 'string') add(u);
      if (out.length >= 8) break;
    }
    return out;
  }

  let raw = product.images;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      raw = [];
    }
  }
  if (Array.isArray(raw)) {
    for (const u of raw) {
      if (typeof u === 'string') add(u);
      if (out.length >= 8) break;
    }
  }

  return out;
}

function buildProductImageXml(sellerSku: string, imageUrls: string[]): string {
  const imgs = imageUrls
    .slice(0, 8)
    .map((u) => `      <Image>${escapeXml(u.trim())}</Image>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <ProductImage>
    <SellerSku>${escapeXml(sellerSku)}</SellerSku>
    <Images>
${imgs}
    </Images>
  </ProductImage>
</Request>`;
}

function parseRequestIdFromHead(parsed: Record<string, unknown> | null): string {
  if (!parsed) return '';
  const success = parsed.SuccessResponse as Record<string, unknown> | undefined;
  const head = success?.Head as Record<string, unknown> | undefined;
  const raw = head?.RequestId;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

function normalizeMapKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Resuelve PrimaryCategory: body > mapa por categoria/sección > __default__ > secret.
 */
function resolvePrimaryCategoryId(
  product: ProductRow,
  bodyCategory: string,
  mapJson: string,
  fallbackSecret: string,
): string {
  const fromBody = String(bodyCategory || '').trim();
  if (fromBody) return fromBody;

  let map: Record<string, string> = {};
  if (mapJson.trim()) {
    try {
      map = JSON.parse(mapJson) as Record<string, string>;
    } catch {
      return '';
    }
  }

  const candidates = [
    product.categoria,
    product.seccion,
    product.cat,
    [product.seccion, product.categoria].filter(Boolean).join(' / '),
  ].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);

  for (const c of candidates) {
    const n = normalizeMapKey(c);
    for (const [mk, val] of Object.entries(map)) {
      if (mk === '__default__' || mk === 'default') continue;
      if (normalizeMapKey(mk) === n && String(val).trim()) return String(val).trim();
    }
  }
  for (const c of candidates) {
    const n = normalizeMapKey(c);
    for (const [mk, val] of Object.entries(map)) {
      if (mk === '__default__' || mk === 'default') continue;
      const nk = normalizeMapKey(mk);
      if ((n.includes(nk) || nk.includes(n)) && String(val).trim()) return String(val).trim();
    }
  }
  const def = map['__default__'] ?? map['default'];
  if (def != null && String(def).trim()) return String(def).trim();

  return String(fallbackSecret || '').trim();
}

async function patchProductRow(
  productId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !key) return;
  const url = `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(fields),
  });
  if (!r.ok) {
    const t = await r.text();
    console.warn('[falabella-sync-product] PATCH products', r.status, t);
  }
}

async function fetchProduct(productId: string): Promise<ProductRow | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !key) throw new Error('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados');

  const url = `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=*&limit=1`;
  const r = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase products: HTTP ${r.status} ${t}`);
  }
  const rows = (await r.json()) as ProductRow[];
  return rows[0] || null;
}

async function fetchFirstColorLabel(productId: string): Promise<string | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !key) return null;
  const url =
    `${supabaseUrl}/rest/v1/product_colors?product_id=eq.${encodeURIComponent(productId)}` +
    `&select=colors(label)&limit=1`;
  const r = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const rows = (await r.json()) as { colors?: { label?: string | null } | null }[];
  const lab = rows[0]?.colors?.label;
  return typeof lab === 'string' && lab.trim() ? lab.trim() : null;
}

async function fetchFirstSizeLabel(productId: string): Promise<string | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !key) return null;
  const url =
    `${supabaseUrl}/rest/v1/product_sizes?product_id=eq.${encodeURIComponent(productId)}` +
    `&select=sizes(label)&limit=1`;
  const r = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const rows = (await r.json()) as { sizes?: { label?: string | null } | null }[];
  const lab = rows[0]?.sizes?.label;
  return typeof lab === 'string' && lab.trim() ? lab.trim() : null;
}

function parseFalabellaJsonError(text: string): string {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const err = o?.ErrorResponse as Record<string, unknown> | undefined;
    const head = err?.Head as Record<string, unknown> | undefined;
    const msg = head?.ErrorMessage;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  } catch {
    /* noop */
  }
  return text.slice(0, 2000);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  let trackedProductId = '';
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'Use POST' }, 405);

    let body: {
      productId?: string;
      primaryCategoryId?: string;
      brand?: string;
      color?: string;
      colorBasico?: string;
      talla?: string;
      parentSku?: string;
      productDataMandatory?: Record<string, unknown>;
      productDataProductSpecific?: Record<string, unknown>;
      productDataOptional?: Record<string, unknown>;
      /** false o secret FALABELLA_SYNC_IMAGES=0 omite Action=Image tras ProductCreate OK. */
      syncImages?: boolean;
      /** Sustituye las URLs tomadas de `products.images` (hasta 8, http/https). */
      imageUrls?: string[];
    };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'JSON inválido' }, 400);
    }

    const productId = String(body.productId || '').trim();
    if (!productId) return json({ ok: false, error: 'productId requerido' }, 400);
    trackedProductId = productId;

    const product = await fetchProduct(productId);
    if (!product) return json({ ok: false, error: 'Producto no encontrado en products' }, 404);

    const mapJson = String(Deno.env.get('FALABELLA_CATEGORY_MAP_JSON') || '');
    const categoryFromSecret = String(Deno.env.get('FALABELLA_PRIMARY_CATEGORY_ID') || '').trim();
    const brandDefault = String(Deno.env.get('FALABELLA_BRAND') || '').trim();

    const userId = String(Deno.env.get('FALABELLA_USER_ID') || '').trim();
    const apiKey = String(Deno.env.get('FALABELLA_API_KEY') || '').trim();
    const operatorCode = String(Deno.env.get('FALABELLA_OPERATOR_CODE') || '').trim();

    const [dbColor, dbTalla] = await Promise.all([
      fetchFirstColorLabel(productId),
      fetchFirstSizeLabel(productId),
    ]);
    const rowColor = firstColorFromProductRow(product);
    const rowTalla = firstSizeFromProductRow(product);

    const auto = buildFalabellaAutoMap({
      product: {
        seccion: product.seccion,
        categoria: product.categoria,
        cat: product.cat,
        name: product.name,
        ref: product.ref,
      },
      body: {
        primaryCategoryId: body.primaryCategoryId,
        brand: body.brand,
        color: body.color,
        colorBasico: body.colorBasico,
        talla: body.talla,
        productDataMandatory: body.productDataMandatory,
      },
      env: {
        categoryMapJson: mapJson,
        primaryCategoryFallback: categoryFromSecret,
        brandDefault,
        defaultColor: String(Deno.env.get('FALABELLA_DEFAULT_COLOR') || '').trim(),
        defaultColorBasico: String(Deno.env.get('FALABELLA_DEFAULT_COLOR_BASICO') || '').trim(),
        defaultTalla: String(Deno.env.get('FALABELLA_DEFAULT_TALLA') || '').trim(),
        productDataExtraJson: String(Deno.env.get('FALABELLA_PRODUCT_DATA_EXTRA_JSON') || '').trim(),
        defaultMaterial: String(Deno.env.get('FALABELLA_DEFAULT_MATERIAL') || '').trim(),
        defaultGenero: String(Deno.env.get('FALABELLA_DEFAULT_GENERO') || '').trim(),
      },
      resolvedColor: dbColor || rowColor || undefined,
      resolvedTalla: dbTalla || rowTalla || undefined,
    });

    const categoryId = auto.primaryCategoryId;
    let brand = auto.brand;
    let color = auto.color;
    let colorBasico = auto.colorBasico;
    let talla = auto.talla;

    logStructured('auto_map', {
      productId,
      ...auto.mapTrace,
      primaryCategoryId: categoryId,
      brand,
      color,
      colorBasico,
      talla,
    });

    if (!userId || !apiKey || !operatorCode) {
      return json({
        ok: true,
        dryRun: true,
        message:
          'Falabella: configura FALABELLA_USER_ID, FALABELLA_API_KEY y FALABELLA_OPERATOR_CODE en secrets de la función.',
        primaryCategoryResolved: categoryId || null,
        brand: brand || null,
        autoMap: auto.mapTrace,
        productDataMandatory: auto.productDataMandatory,
      });
    }

    if (!categoryId) {
      const msg =
        'Falabella: sin PrimaryCategory. Configura FALABELLA_CATEGORY_MAP_JSON (claves = categoría/sección ERP), FALABELLA_PRIMARY_CATEGORY_ID o envía primaryCategoryId en el body.';
      await patchProductRow(productId, {
        falabella_sync_status: 'error',
        falabella_last_error: msg,
        falabella_last_sync_at: new Date().toISOString(),
      });
      return json({ ok: false, error: msg }, 400);
    }

    const apiBase = (Deno.env.get('FALABELLA_API_BASE') || 'https://sellercenter-api.falabella.com').replace(
      /\/?$/,
      '',
    );
    const sellerIdForUa = String(Deno.env.get('FALABELLA_SELLER_ID') || '').trim() ||
      userId.split('@')[0] ||
      'seller';
    const buCode = String(Deno.env.get('FALABELLA_BUSINESS_UNIT_CODE') || 'FACO').trim();
    const conditionType = String(Deno.env.get('FALABELLA_CONDITION_TYPE') || 'Nuevo').trim();
    const ph = parseInt(Deno.env.get('FALABELLA_PACKAGE_HEIGHT_CM') || '10', 10) || 10;
    const pw = parseInt(Deno.env.get('FALABELLA_PACKAGE_WIDTH_CM') || '10', 10) || 10;
    const pl = parseInt(Deno.env.get('FALABELLA_PACKAGE_LENGTH_CM') || '10', 10) || 10;
    const pkgW = parseFloat(Deno.env.get('FALABELLA_PACKAGE_WEIGHT_KG') || '2') || 2;
    const taxPct = String(Deno.env.get('FALABELLA_TAX_PERCENTAGE') || '').trim();

    if (!color || !talla) {
      const msg =
        'Falabella: faltan Color y/o Talla tras auto-mapa. Revisa products.colors/sizes o FALABELLA_DEFAULT_*.';
      await patchProductRow(productId, {
        falabella_sync_status: 'error',
        falabella_last_error: msg,
        falabella_last_sync_at: new Date().toISOString(),
      });
      return json({ ok: false, error: msg }, 400);
    }

    const sku = String(product.ref || product.id).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 200);
    const parentSku = String(body.parentSku || sku).trim().slice(0, 200);
    const name = String(product.name || 'Producto').trim() || 'Producto';
    let description = String(product.description || '').trim();
    if (description.length < 10) {
      description = `${name} — catálogo VentasHera. Producto para venta online; consulte talla y color en ficha.`;
    }
    if (description.length < 10) {
      description = `${description} Descripción ampliada para cumplir requisitos de marketplace.`;
    }
    if (description.length > 25000) description = description.slice(0, 25000);

    const price = Math.max(0, Math.round(parseFloat(String(product.price ?? 0)) || 0));
    const stock = Math.max(0, Math.floor(parseFloat(String(product.stock ?? 0)) || 0));

    const ean = String(product.barcode || product.ean || '').trim();
    const productIdXml = ean && /^\d+$/.test(ean) ? `<ProductId>${escapeXml(ean)}</ProductId>` : '';

    const taxXml =
      taxPct || buCode === 'FACO'
        ? `<TaxPercentage>${escapeXml(taxPct || '19')}</TaxPercentage>`
        : '';

    let secretExtra: Record<string, unknown> = {};
    const secretJson = String(Deno.env.get('FALABELLA_PRODUCT_DATA_EXTRA_JSON') || '').trim();
    if (secretJson) {
      try {
        const p = JSON.parse(secretJson) as unknown;
        if (p && typeof p === 'object' && !Array.isArray(p)) secretExtra = p as Record<string, unknown>;
      } catch {
        const msg = 'FALABELLA_PRODUCT_DATA_EXTRA_JSON no es JSON objeto válido';
        await patchProductRow(productId, {
          falabella_sync_status: 'error',
          falabella_last_error: msg,
          falabella_last_sync_at: new Date().toISOString(),
        });
        return json({ ok: false, error: msg }, 400);
      }
    }

    const fromDb =
      product.falabella_product_data_json && typeof product.falabella_product_data_json === 'object' &&
        !Array.isArray(product.falabella_product_data_json)
        ? (product.falabella_product_data_json as Record<string, unknown>)
        : {};

    const mergedAll = mergeProductDataLayers(
      secretExtra,
      auto.productDataMandatory,
      fromDb,
      body.productDataMandatory,
      body.productDataProductSpecific,
      body.productDataOptional,
    );
    const reservedProductData = new Set([
      'ConditionType',
      'PackageHeight',
      'PackageWidth',
      'PackageLength',
      'PackageWeight',
      'TaxPercentage',
    ]);
    const mergedExtraOnly = Object.fromEntries(
      Object.entries(mergedAll).filter(([k]) => !reservedProductData.has(k)),
    );
    const extraProductDataXml = productDataGroupToXml(mergedExtraOnly);

    /** Orden alineado al “Minimum API Call” moda: Brand, Color, ColorBasico, Description, Name, PrimaryCategory, SellerSku, Talla + BusinessUnits + ProductData. */
    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    <SellerSku>${escapeXml(sku)}</SellerSku>
    <ParentSku>${escapeXml(parentSku)}</ParentSku>
    <Name>${escapeXml(name)}</Name>
    <PrimaryCategory>${escapeXml(categoryId)}</PrimaryCategory>
    <Description>${escapeXml(description)}</Description>
    <Brand>${escapeXml(brand)}</Brand>
    <Color>${escapeXml(color)}</Color>
    <ColorBasico>${escapeXml(colorBasico)}</ColorBasico>
    <Talla>${escapeXml(talla)}</Talla>
    ${productIdXml}
    <BusinessUnits>
      <BusinessUnit>
        <OperatorCode>${escapeXml(operatorCode)}</OperatorCode>
        <Price>${price}</Price>
        <Stock>${stock}</Stock>
        <Status>active</Status>
      </BusinessUnit>
    </BusinessUnits>
    <ProductData>
      <ConditionType>${escapeXml(conditionType)}</ConditionType>
      <PackageHeight>${ph}</PackageHeight>
      <PackageWidth>${pw}</PackageWidth>
      <PackageLength>${pl}</PackageLength>
      <PackageWeight>${pkgW}</PackageWeight>
      ${taxXml}
${extraProductDataXml}
    </ProductData>
  </Product>
</Request>`;

    const effectiveTaxStr = String(taxPct || '').trim() || (buCode === 'FACO' ? '19' : '');

    const validationErrs = prevalidateProductCreateFields({
      brand,
      name,
      description,
      sellerSku: sku,
      parentSku,
      color,
      talla,
      conditionType,
      packageHeight: ph,
      packageWidth: pw,
      packageLength: pl,
      packageWeight: pkgW,
      taxPercentageStr: effectiveTaxStr,
      buCode,
    });
    if (validationErrs.length > 0) {
      const vmsg = buildValidationErrorMessage(validationErrs);
      logStructured('prevalidate_fail', { productId, sellerSku: sku, count: validationErrs.length });
      await patchProductRow(productId, {
        falabella_sync_status: 'error_validacion',
        falabella_last_error: vmsg,
        falabella_last_sync_at: new Date().toISOString(),
        falabella_sync_audit_json: jsonForDb({
          phase: 'prevalidate',
          errors: validationErrs,
          sellerSku: sku,
          at: new Date().toISOString(),
        }),
      });
      return json(
        {
          ok: false,
          error: vmsg,
          syncStatus: 'error_validacion',
          validationErrors: validationErrs,
          sellerSku: sku,
        },
        400,
      );
    }

    const skipBrandCheck =
      String(Deno.env.get('FALABELLA_SKIP_BRAND_CHECK') || '').trim().toLowerCase() === '1' ||
      ['true', 'yes', 'si'].includes(
        String(Deno.env.get('FALABELLA_SKIP_BRAND_CHECK') || '').trim().toLowerCase(),
      );

    const autoGenericBrand = !['0', 'false', 'no'].includes(
      String(Deno.env.get('FALABELLA_AUTO_GENERIC_BRAND') || 'true').trim().toLowerCase(),
    );

    if (!skipBrandCheck) {
      const gbRes = await fetchGetBrandsJson({
        apiBase,
        apiKey,
        userId,
        sellerIdForUa,
        buCode,
        sign: signFalabellaQuery,
        buildQs: buildQueryString,
        utcTimestampIso8601,
      });
      if (!gbRes.ok || !gbRes.parsed) {
        if (autoGenericBrand) {
          brand = 'GENERICO';
          logStructured('getbrands_http_fail_fallback_generico', { productId });
        } else {
          const gmsg =
            'Falabella GetBrands: no se pudo validar la marca (error de red o respuesta inválida). Reintenta.';
          logStructured('getbrands_http_fail', { productId, httpOk: gbRes.ok });
          await patchProductRow(productId, {
            falabella_sync_status: 'error_validacion',
            falabella_last_error: gmsg.slice(0, 2000),
            falabella_last_sync_at: new Date().toISOString(),
          });
          return json({ ok: false, error: gmsg, syncStatus: 'error_validacion' }, 502);
        }
      } else {
        const gbErr = gbRes.parsed.ErrorResponse as Record<string, unknown> | undefined;
        if (gbErr) {
          if (autoGenericBrand) {
            brand = 'GENERICO';
            logStructured('getbrands_api_error_fallback_generico', { productId });
          } else {
            const gh = gbErr.Head as Record<string, unknown> | undefined;
            const gem = gh?.ErrorMessage;
            const gmsg = typeof gem === 'string' ? gem : 'GetBrands ErrorResponse';
            logStructured('getbrands_api_error', { productId });
            await patchProductRow(productId, {
              falabella_sync_status: 'error',
              falabella_last_error: `GetBrands: ${String(gmsg).slice(0, 1900)}`,
              falabella_last_sync_at: new Date().toISOString(),
            });
            return json({ ok: false, error: gmsg, falabella: gbRes.parsed }, 502);
          }
        } else {
          const brandRows = parseBrandsFromGetBrandsResponse(gbRes.parsed);
          if (brandRows.length === 0) {
            if (autoGenericBrand) {
              brand = 'GENERICO';
              logStructured('getbrands_empty_fallback_generico', { productId });
            } else {
              const zmsg =
                'GetBrands no devolvió marcas (lista vacía). No se envió el feed. Revisa permisos API o el formato de respuesta.';
              await patchProductRow(productId, {
                falabella_sync_status: 'error_validacion',
                falabella_last_error: zmsg,
                falabella_last_sync_at: new Date().toISOString(),
              });
              return json({ ok: false, error: zmsg, syncStatus: 'error_validacion' }, 502);
            }
          } else if (!brandMatchesFalabellaList(brand, brandRows)) {
            logStructured('brand_not_in_catalog_fallback_generico', {
              productId,
              brandRequested: brand,
              catalogSize: brandRows.length,
              autoGenericBrand,
            });
            if (autoGenericBrand) {
              brand = 'GENERICO';
            } else {
              const bmsg =
                'Marca no registrada en Falabella; usar GENÉRICO o solicitar alta de marca en Seller Center. La marca enviada no aparece en GetBrands (nombre o GlobalIdentifier).';
              await patchProductRow(productId, {
                falabella_sync_status: 'error_validacion',
                falabella_last_error: bmsg,
                falabella_last_sync_at: new Date().toISOString(),
                falabella_sync_audit_json: jsonForDb({
                  phase: 'brand_check',
                  brandRequested: brand,
                  brandsReturned: brandRows.length,
                  at: new Date().toISOString(),
                }),
              });
              return json(
                {
                  ok: false,
                  error: bmsg,
                  syncStatus: 'error_validacion',
                  validation: 'brand_not_in_getbrands',
                  sellerSku: sku,
                },
                400,
              );
            }
          } else {
            logStructured('brand_ok', { productId, brand, catalogSize: brandRows.length });
          }
        }
      }
    }

    logStructured('productcreate_send', { productId, sellerSku: sku, categoryId, brand });

    const baseParams: Record<string, string> = {
      Action: 'ProductCreate',
      Format: 'JSON',
      Timestamp: utcTimestampIso8601(),
      UserID: userId,
      Version: '1.0',
    };

    const signed = await signFalabellaQuery(apiKey, baseParams);
    const qs = buildQueryString(signed);
    const url = `${apiBase}/?${qs}`;

    const userAgent = `${sellerIdForUa}/Deno/1.0/PROPIA/${buCode}`;

    await patchProductRow(productId, {
      falabella_sync_status: 'pending',
      falabella_last_error: null,
      falabella_primary_category_id: categoryId,
      falabella_last_sync_at: new Date().toISOString(),
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'User-Agent': userAgent,
        Accept: 'application/json',
      },
      body: xmlBody,
    });

    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const errText = parseFalabellaJsonError(text) || `HTTP ${res.status}`;
      await patchProductRow(productId, {
        falabella_sync_status: 'error',
        falabella_last_error: errText.slice(0, 2000),
        falabella_last_sync_at: new Date().toISOString(),
      });
      return json(
        {
          ok: false,
          error: errText,
          falabella: parsed,
        },
        502,
      );
    }

    const success = parsed?.SuccessResponse as Record<string, unknown> | undefined;
    const errResp = parsed?.ErrorResponse as Record<string, unknown> | undefined;
    if (errResp) {
      const head = errResp.Head as Record<string, unknown> | undefined;
      const em = head?.ErrorMessage;
      const errMsg = typeof em === 'string' ? em : 'ErrorResponse de Falabella';
      await patchProductRow(productId, {
        falabella_sync_status: 'error',
        falabella_last_error: errMsg.slice(0, 2000),
        falabella_last_sync_at: new Date().toISOString(),
      });
      return json(
        {
          ok: false,
          error: errMsg,
          falabella: parsed,
        },
        502,
      );
    }

    const head = success?.Head as Record<string, unknown> | undefined;
    const requestIdRaw = head?.RequestId;
    const requestId =
      typeof requestIdRaw === 'string' && requestIdRaw.trim() ? requestIdRaw.trim() : '';

    const productCreateJson = jsonForDb(parsed);

    await patchProductRow(productId, {
      falabella_sync_status: 'pending',
      falabella_last_response_json: productCreateJson,
      falabella_seller_sku: sku,
      falabella_feed_request_id: requestId || null,
      falabella_last_error: null,
      falabella_primary_category_id: categoryId,
      falabella_last_sync_at: new Date().toISOString(),
      falabella_feed_detail_json: null,
      falabella_feed_status: null,
    });

    let syncStatusOut: 'synced' | 'pending' | 'error' | 'feed_timeout' | 'error_validacion' = 'pending';
    let feedStatusOut: string | null = null;
    let lastErrOut: string | null = null;
    let feedDetailForResponse: Record<string, unknown> | null = null;
    let feedDetailJsonForDb: unknown = null;
    let imageRequestId: string | undefined;
    let imageSyncStatus: 'synced' | 'pending' | 'error' | 'feed_timeout' | undefined;
    let imageFeedStatus: string | null | undefined;
    let imagesSent: string[] | undefined;
    let imageSkippedReason: string | undefined;

    const maxPoll = Math.min(50, Math.max(1, parseInt(Deno.env.get('FALABELLA_FEED_POLL_ATTEMPTS') || '18', 10) || 18));
    const baseDelayMs = Math.min(20000, Math.max(800, parseInt(Deno.env.get('FALABELLA_FEED_POLL_BASE_MS') || '2000', 10) || 2000));
    const maxDelayMs = Math.min(30000, Math.max(2000, parseInt(Deno.env.get('FALABELLA_FEED_POLL_MAX_MS') || '14000', 10) || 14000));
    const backoffFactor = Math.min(2.5, Math.max(1.1, parseFloat(Deno.env.get('FALABELLA_FEED_POLL_BACKOFF') || '1.45') || 1.45));

    if (requestId) {
      const poll = await pollFeedUntilDoneWithBackoff({
        apiBase,
        apiKey,
        userId,
        sellerIdForUa,
        buCode,
        feedId: requestId,
        sign: signFalabellaQuery,
        buildQs: buildQueryString,
        utcTimestampIso8601,
        maxAttempts: maxPoll,
        baseDelayMs,
        maxDelayMs,
        backoffFactor,
      });
      const interpreted = interpretFeedPollResult(poll, { requestId, maxAttempts: maxPoll });
      logStructured('productcreate_feed_polled', {
        productId,
        requestId,
        attempts: poll.audit.length,
        exhausted: poll.exhaustedWhileNonTerminal,
        lastStatus: poll.lastNonTerminalStatus,
      });

      if (interpreted.feedStatusError) {
        syncStatusOut = 'error';
        lastErrOut = interpreted.lastErrOut;
        feedStatusOut = null;
        feedDetailJsonForDb = interpreted.feedDetailJson;
        await patchProductRow(productId, {
          falabella_sync_status: syncStatusOut,
          falabella_feed_status: feedStatusOut,
          falabella_feed_detail_json: feedDetailJsonForDb,
          falabella_last_error: lastErrOut,
          falabella_last_sync_at: new Date().toISOString(),
          falabella_sync_audit_json: jsonForDb({
            productCreate: {
              requestId,
              phase: 'feedStatus_api_error',
              pollAttempts: poll.audit.length,
              auditTrail: poll.audit.slice(0, 30),
            },
          }),
        });
        const msgErr = lastErrOut || 'Error en FeedStatus';
        return json({
          ok: true,
          syncStatus: syncStatusOut,
          feedStatus: feedStatusOut,
          feedDetail: null,
          lastError: lastErrOut,
          sellerSku: sku,
          parentSku,
          color,
          colorBasico,
          talla,
          primaryCategoryId: categoryId,
          requestId: requestId || undefined,
          message: msgErr,
          falabella: parsed,
        });
      }

      syncStatusOut = interpreted.syncStatusOut;
      feedStatusOut = interpreted.feedStatusOut;
      lastErrOut = interpreted.lastErrOut;
      feedDetailJsonForDb = interpreted.feedDetailJson;
      feedDetailForResponse = interpreted.feedDetailForResponse;

      await patchProductRow(productId, {
        falabella_sync_status: syncStatusOut,
        falabella_feed_status: feedStatusOut,
        falabella_feed_detail_json: feedDetailJsonForDb,
        falabella_last_error: lastErrOut,
        falabella_last_sync_at: new Date().toISOString(),
        falabella_sync_audit_json: jsonForDb({
          updatedAt: new Date().toISOString(),
          productCreate: {
            requestId,
            sellerSku: sku,
            pollAttempts: poll.audit.length,
            exhaustedWhileNonTerminal: poll.exhaustedWhileNonTerminal,
            lastNonTerminalStatus: poll.lastNonTerminalStatus,
            auditTrail: poll.audit.slice(0, 50),
          },
        }),
      });

      const skipSyncImages =
        body.syncImages === false ||
        String(Deno.env.get('FALABELLA_SYNC_IMAGES') || '').trim().toLowerCase() === '0' ||
        String(Deno.env.get('FALABELLA_SYNC_IMAGES') || '').trim().toLowerCase() === 'false';

      const imageUrls = collectImageUrlsForFalabella(product, body.imageUrls);

      if (syncStatusOut === 'synced' && !skipSyncImages && imageUrls.length > 0) {
        imagesSent = imageUrls;
        const imageXml = buildProductImageXml(sku, imageUrls);
        const baseParamsImage: Record<string, string> = {
          Action: 'Image',
          Format: 'JSON',
          Timestamp: utcTimestampIso8601(),
          UserID: userId,
          Version: '1.0',
        };
        const signedImg = await signFalabellaQuery(apiKey, baseParamsImage);
        const urlImg = `${apiBase}/?${buildQueryString(signedImg)}`;
        const resImg = await fetch(urlImg, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'User-Agent': userAgent,
            Accept: 'application/json',
          },
          body: imageXml,
        });
        const textImg = await resImg.text();
        let parsedImg: Record<string, unknown> | null = null;
        try {
          parsedImg = textImg ? (JSON.parse(textImg) as Record<string, unknown>) : null;
        } catch {
          parsedImg = null;
        }

        if (!resImg.ok) {
          const errText = parseFalabellaJsonError(textImg) || `HTTP ${resImg.status}`;
          syncStatusOut = 'error';
          lastErrOut = `Imágenes (API): ${errText.slice(0, 1800)}`;
          await patchProductRow(productId, {
            falabella_sync_status: syncStatusOut,
            falabella_last_error: lastErrOut,
            falabella_last_response_json: jsonForDb({
              productCreate: parsed,
              image: { httpError: errText.slice(0, 4000) },
            }),
            falabella_last_sync_at: new Date().toISOString(),
          });
        } else if (parsedImg?.ErrorResponse) {
          const errImg = parsedImg.ErrorResponse as Record<string, unknown>;
          const headI = errImg.Head as Record<string, unknown> | undefined;
          const emI = headI?.ErrorMessage;
          const errMsg = typeof emI === 'string' ? emI : 'ErrorResponse';
          syncStatusOut = 'error';
          lastErrOut = `Imágenes (API): ${String(errMsg).slice(0, 2000)}`;
          await patchProductRow(productId, {
            falabella_sync_status: syncStatusOut,
            falabella_last_error: lastErrOut,
            falabella_last_response_json: jsonForDb({ productCreate: parsed, image: parsedImg }),
            falabella_last_sync_at: new Date().toISOString(),
          });
        } else {
          const reqImg = parseRequestIdFromHead(parsedImg);
          imageRequestId = reqImg || undefined;
          await patchProductRow(productId, {
            falabella_last_response_json: jsonForDb({ productCreate: parsed, image: parsedImg }),
            falabella_last_sync_at: new Date().toISOString(),
          });

          if (!reqImg) {
            syncStatusOut = 'error';
            lastErrOut = 'Imágenes: respuesta sin RequestId';
            await patchProductRow(productId, {
              falabella_sync_status: syncStatusOut,
              falabella_last_error: lastErrOut,
              falabella_last_sync_at: new Date().toISOString(),
            });
          } else {
            const pollImg = await pollFeedUntilDoneWithBackoff({
              apiBase,
              apiKey,
              userId,
              sellerIdForUa,
              buCode,
              feedId: reqImg,
              sign: signFalabellaQuery,
              buildQs: buildQueryString,
              utcTimestampIso8601,
              maxAttempts: maxPoll,
              baseDelayMs,
              maxDelayMs,
              backoffFactor,
            });
            const interpretedImg = interpretFeedPollResult(pollImg, {
              requestId: reqImg,
              maxAttempts: maxPoll,
            });
            const mergedDetail = {
              productCreate: feedDetailJsonForDb,
              image: interpretedImg.feedDetailJson,
            };

            if (interpretedImg.feedStatusError) {
              syncStatusOut = 'error';
              lastErrOut = `Imágenes (FeedStatus): ${interpretedImg.lastErrOut}`;
              await patchProductRow(productId, {
                falabella_sync_status: syncStatusOut,
                falabella_feed_status: null,
                falabella_feed_detail_json: jsonForDb(mergedDetail),
                falabella_last_error: lastErrOut,
                falabella_last_sync_at: new Date().toISOString(),
              });
            } else {
              imageSyncStatus = interpretedImg.syncStatusOut;
              imageFeedStatus = interpretedImg.feedStatusOut;
              if (interpretedImg.syncStatusOut === 'synced') {
                syncStatusOut = 'synced';
                lastErrOut = null;
              } else if (interpretedImg.syncStatusOut === 'error') {
                syncStatusOut = 'error';
                lastErrOut = `Imágenes (feed): ${interpretedImg.lastErrOut || 'Error'}`;
              } else if (interpretedImg.syncStatusOut === 'feed_timeout') {
                syncStatusOut = 'error';
                lastErrOut = `Imágenes (feed timeout): ${interpretedImg.lastErrOut || 'Sin respuesta final'}`;
              } else {
                syncStatusOut = 'pending';
                lastErrOut = interpretedImg.lastErrOut;
              }
              feedStatusOut = interpretedImg.feedStatusOut;
              feedDetailForResponse = interpretedImg.feedDetailForResponse;
              feedDetailJsonForDb = jsonForDb(mergedDetail);
              await patchProductRow(productId, {
                falabella_sync_status: syncStatusOut,
                falabella_feed_status: feedStatusOut,
                falabella_feed_detail_json: feedDetailJsonForDb,
                falabella_last_error: lastErrOut,
                falabella_last_sync_at: new Date().toISOString(),
              });
            }
          }
        }
      } else if (syncStatusOut === 'synced') {
        if (skipSyncImages) imageSkippedReason = 'imágenes omitidas (syncImages o FALABELLA_SYNC_IMAGES)';
        else if (imageUrls.length === 0) {
          imageSkippedReason = 'sin URLs http(s) en products.images (máx. 8); opcional: body.imageUrls';
        }
      }
    } else {
      lastErrOut = 'ProductCreate sin RequestId en Head; no se consultó FeedStatus.';
      await patchProductRow(productId, {
        falabella_sync_status: 'pending',
        falabella_last_error: lastErrOut,
        falabella_last_sync_at: new Date().toISOString(),
      });
    }

    let msgDone =
      syncStatusOut === 'synced'
        ? 'Feed procesado (FeedStatus Finished, sin fallos registrados).'
        : syncStatusOut === 'error'
          ? (lastErrOut || 'Error en feed o en producto.')
          : syncStatusOut === 'feed_timeout'
            ? (lastErrOut ||
              'El feed no terminó en el tiempo de espera (Queued/Processing). Revisa Seller Center con el RequestId o reintenta.')
            : `Feed en cola o procesando (estado: ${feedStatusOut || 'desconocido'}). Revisa Seller Center o vuelve a sincronizar más tarde.`;

    if (syncStatusOut === 'synced' && imagesSent && imagesSent.length > 0) {
      msgDone = 'ProductCreate e imágenes: feeds Finished sin fallos registrados.';
    } else if (imageSkippedReason && syncStatusOut === 'synced') {
      msgDone = `${msgDone} (${imageSkippedReason})`;
    }

    return json({
      ok: true,
      syncStatus: syncStatusOut,
      feedStatus: feedStatusOut,
      feedDetail: feedDetailForResponse,
      lastError: lastErrOut,
      sellerSku: sku,
      parentSku,
      color,
      colorBasico,
      talla,
      primaryCategoryId: categoryId,
      requestId: requestId || undefined,
      imageRequestId,
      imageSyncStatus,
      imageFeedStatus,
      imagesSent,
      imageSkippedReason,
      message: msgDone,
      falabella: parsed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[falabella-sync-product]', msg);
    if (trackedProductId) {
      await patchProductRow(trackedProductId, {
        falabella_sync_status: 'error',
        falabella_last_error: msg.slice(0, 2000),
        falabella_last_sync_at: new Date().toISOString(),
      });
    }
    return json({ ok: false, error: msg }, 500);
  }
});
