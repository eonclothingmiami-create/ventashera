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
 * Moda / mínimo Falabella (Color, ColorBasico, Talla en el XML del producto):
 *   FALABELLA_DEFAULT_COLOR — si el producto no tiene color en BD
 *   FALABELLA_DEFAULT_COLOR_BASICO — si vacío, se usa Color
 *   FALABELLA_DEFAULT_TALLA — si el producto no tiene talla en BD
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
 *   productDataOptional?: Record<string, string>
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
 * Las imágenes suelen publicarse en un paso aparte (Image API); no incluido aquí.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

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
  falabella_product_data_json?: Record<string, unknown> | null;
};

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
    };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'JSON inválido' }, 400);
    }

    const productId = String(body.productId || '').trim();
    if (!productId) return json({ ok: false, error: 'productId requerido' }, 400);

    const product = await fetchProduct(productId);
    if (!product) return json({ ok: false, error: 'Producto no encontrado en products' }, 404);

    const mapJson = String(Deno.env.get('FALABELLA_CATEGORY_MAP_JSON') || '');
    const categoryFromSecret = String(Deno.env.get('FALABELLA_PRIMARY_CATEGORY_ID') || '').trim();
    const categoryId = resolvePrimaryCategoryId(
      product,
      String(body.primaryCategoryId || ''),
      mapJson,
      categoryFromSecret,
    );

    const userId = String(Deno.env.get('FALABELLA_USER_ID') || '').trim();
    const apiKey = String(Deno.env.get('FALABELLA_API_KEY') || '').trim();
    const operatorCode = String(Deno.env.get('FALABELLA_OPERATOR_CODE') || '').trim();
    const brandDefault = String(Deno.env.get('FALABELLA_BRAND') || '').trim();
    const brand = String(body.brand || brandDefault || '').trim();

    if (!userId || !apiKey || !operatorCode || !brand) {
      return json({
        ok: true,
        dryRun: true,
        message:
          'Falabella: configura FALABELLA_USER_ID, FALABELLA_API_KEY, FALABELLA_OPERATOR_CODE y FALABELLA_BRAND en secrets de la función.',
        primaryCategoryResolved: categoryId || null,
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

    const [dbColor, dbTalla] = await Promise.all([
      fetchFirstColorLabel(productId),
      fetchFirstSizeLabel(productId),
    ]);

    const defColor = String(Deno.env.get('FALABELLA_DEFAULT_COLOR') || '').trim();
    const defColorBasico = String(Deno.env.get('FALABELLA_DEFAULT_COLOR_BASICO') || '').trim();
    const defTalla = String(Deno.env.get('FALABELLA_DEFAULT_TALLA') || '').trim();

    let color = String(body.color || dbColor || defColor || '').trim();
    let colorBasico = String(body.colorBasico || defColorBasico || color || '').trim();
    let talla = String(body.talla || dbTalla || defTalla || '').trim();

    if (!color || !talla) {
      const msg =
        'Falabella: faltan Color y/o Talla. Asigna colores/tallas (product_colors / product_sizes), body o FALABELLA_DEFAULT_* en secrets.';
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
    if (description.length < 6) {
      description = `${name} — catálogo VentasHera`;
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
    const requestId = head?.RequestId;

    await patchProductRow(productId, {
      falabella_sync_status: 'synced',
      falabella_seller_sku: sku,
      falabella_feed_request_id: typeof requestId === 'string' ? requestId : null,
      falabella_last_error: null,
      falabella_primary_category_id: categoryId,
      falabella_last_sync_at: new Date().toISOString(),
    });

    return json({
      ok: true,
      sellerSku: sku,
      parentSku,
      color,
      colorBasico,
      talla,
      primaryCategoryId: categoryId,
      requestId: typeof requestId === 'string' ? requestId : undefined,
      message:
        'Feed ProductCreate enviado. Revisa el estado del feed en Seller Center (proceso asíncrono).',
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
