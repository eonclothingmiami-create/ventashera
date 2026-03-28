/**
 * Falabella Seller Center — GetCategoryAttributes (solo lectura; sin feed).
 * Docs: https://developers.falabella.com/reference/getcategoryattributes
 *
 * Mismos secrets que falabella-sync-product: FALABELLA_USER_ID, FALABELLA_API_KEY,
 * FALABELLA_CATEGORY_MAP_JSON, FALABELLA_PRIMARY_CATEGORY_ID, FALABELLA_API_BASE,
 * FALABELLA_SELLER_ID, FALABELLA_BUSINESS_UNIT_CODE.
 *
 * Body JSON:
 *   { "primaryCategoryId": "12345" } — consulta directa
 *   { "productId": "<uuid>" } — resuelve categoría como en falabella-sync-product
 *   { "productId": "...", "primaryCategoryId": "..." } — prioriza primaryCategoryId
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

type ProductRow = {
  id: string;
  categoria?: string | null;
  seccion?: string | null;
  cat?: string | null;
  falabella_primary_category_id?: string | null;
};

function normalizeMapKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function resolvePrimaryCategoryId(
  product: ProductRow,
  bodyCategory: string,
  mapJson: string,
  fallbackSecret: string,
): string {
  const fromBody = String(bodyCategory || '').trim();
  if (fromBody) return fromBody;

  const fromSynced = String(product.falabella_primary_category_id || '').trim();
  if (fromSynced) return fromSynced;

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

function normalizeAttributeList(parsed: Record<string, unknown> | null): unknown[] {
  if (!parsed) return [];
  const sr = parsed.SuccessResponse as Record<string, unknown> | undefined;
  const body = sr?.Body as Record<string, unknown> | undefined;
  const attr = body?.Attribute;
  if (attr == null) return [];
  if (Array.isArray(attr)) return attr;
  return [attr];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'Use POST' }, 405);

    let body: { productId?: string; primaryCategoryId?: string };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'JSON inválido' }, 400);
    }

    const productId = String(body.productId || '').trim();
    const bodyCat = String(body.primaryCategoryId || '').trim();

    const userId = String(Deno.env.get('FALABELLA_USER_ID') || '').trim();
    const apiKey = String(Deno.env.get('FALABELLA_API_KEY') || '').trim();
    const mapJson = String(Deno.env.get('FALABELLA_CATEGORY_MAP_JSON') || '');
    const categoryFromSecret = String(Deno.env.get('FALABELLA_PRIMARY_CATEGORY_ID') || '').trim();

    if (!userId || !apiKey) {
      return json({
        ok: true,
        dryRun: true,
        message:
          'Falabella: configura FALABELLA_USER_ID y FALABELLA_API_KEY en secrets de la función.',
      });
    }

    let primaryCategoryId = bodyCat;

    if (!primaryCategoryId && productId) {
      const product = await fetchProduct(productId);
      if (!product) return json({ ok: false, error: 'Producto no encontrado en products' }, 404);
      primaryCategoryId = resolvePrimaryCategoryId(product, '', mapJson, categoryFromSecret);
    }

    if (!primaryCategoryId || !/^\d+$/.test(primaryCategoryId)) {
      return json(
        {
          ok: false,
          error:
            'Sin PrimaryCategory. Envía primaryCategoryId en el body o productId con FALABELLA_CATEGORY_MAP_JSON / FALABELLA_PRIMARY_CATEGORY_ID.',
        },
        400,
      );
    }

    const apiBase = (Deno.env.get('FALABELLA_API_BASE') || 'https://sellercenter-api.falabella.com').replace(
      /\/?$/,
      '',
    );
    const sellerIdForUa = String(Deno.env.get('FALABELLA_SELLER_ID') || '').trim() ||
      userId.split('@')[0] ||
      'seller';
    const buCode = String(Deno.env.get('FALABELLA_BUSINESS_UNIT_CODE') || 'FACO').trim();

    const baseParams: Record<string, string> = {
      Action: 'GetCategoryAttributes',
      Format: 'JSON',
      Timestamp: utcTimestampIso8601(),
      UserID: userId,
      Version: '1.0',
      PrimaryCategory: primaryCategoryId,
    };

    const signed = await signFalabellaQuery(apiKey, baseParams);
    const qs = buildQueryString(signed);
    const url = `${apiBase}/?${qs}`;
    const userAgent = `${sellerIdForUa}/Deno/1.0/PROPIA/${buCode}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
    });

    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      return json(
        {
          ok: false,
          error: text.slice(0, 4000) || `HTTP ${res.status}`,
          primaryCategoryId,
          falabella: parsed,
        },
        502,
      );
    }

    const errResp = parsed?.ErrorResponse as Record<string, unknown> | undefined;
    if (errResp) {
      const head = errResp.Head as Record<string, unknown> | undefined;
      const em = head?.ErrorMessage;
      const errMsg = typeof em === 'string' ? em : 'ErrorResponse de Falabella';
      return json({ ok: false, error: errMsg, primaryCategoryId, falabella: parsed }, 502);
    }

    const list = normalizeAttributeList(parsed);
    const mandatoryOnly = list.filter((a) => {
      const o = a as Record<string, unknown>;
      return String(o?.isMandatory ?? o?.IsMandatory ?? '') === '1';
    });

    return json({
      ok: true,
      primaryCategoryId,
      productId: productId || undefined,
      attributeCount: list.length,
      mandatoryCount: mandatoryOnly.length,
      /** Solo obligatorios (FeedName + Label) para revisión rápida */
      mandatorySummary: mandatoryOnly.map((a) => {
        const o = a as Record<string, unknown>;
        return {
          FeedName: o.FeedName ?? o.feedName,
          Label: o.Label ?? o.label,
          Name: o.Name ?? o.name,
        };
      }),
      attributes: list,
      falabella: parsed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[falabella-get-category-attributes]', msg);
    return json({ ok: false, error: msg }, 500);
  }
});
