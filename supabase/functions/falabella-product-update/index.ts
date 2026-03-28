/**
 * Falabella Seller Center — ProductUpdate (precio, stock, estado por BusinessUnit).
 * Docs: https://developers.falabella.com/v600.0.0/reference/productupdate
 * Tras la llamada se hace polling de FeedStatus (mismo patrón que ProductCreate).
 *
 * Secrets: mismos que falabella-sync-product (FALABELLA_USER_ID, FALABELLA_API_KEY,
 * FALABELLA_OPERATOR_CODE, FALABELLA_API_BASE, FALABELLA_SELLER_ID, FALABELLA_BUSINESS_UNIT_CODE).
 *
 * Body JSON:
 *   productId: string (requerido)
 *   price?: number — si no viene, usa products.price
 *   stock?: number — si no viene, usa products.stock
 *   status?: "active" | "inactive" — default active
 *   pollFeed?: boolean — default true (consulta FeedStatus hasta Finished/Error)
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonForDb(value: unknown): unknown {
  try {
    const s = JSON.stringify(value);
    if (s.length > 80000) {
      return { _truncated: true, length: s.length, textPreview: s.slice(0, 8000) };
    }
    return JSON.parse(s) as unknown;
  } catch {
    return { _error: 'non-serializable' };
  }
}

function extractFeedDetail(parsed: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!parsed) return null;
  const sr = parsed.SuccessResponse as Record<string, unknown> | undefined;
  const body = sr?.Body as Record<string, unknown> | undefined;
  if (body?.FeedDetail && typeof body.FeedDetail === 'object') {
    return body.FeedDetail as Record<string, unknown>;
  }
  return findFeedDetailDeep(parsed);
}

function findFeedDetailDeep(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if ('Status' in o && ('Feed' in o || 'ProcessedRecords' in o || 'TotalRecords' in o)) {
    return o;
  }
  for (const v of Object.values(o)) {
    const r = findFeedDetailDeep(v);
    if (r) return r;
  }
  return null;
}

function feedErrorsToString(fd: Record<string, unknown>): string {
  const fe = fd.FeedErrors ?? fd.feedErrors;
  if (fe == null || fe === '') return '';
  if (typeof fe === 'string') return fe.slice(0, 2000);
  try {
    return JSON.stringify(fe).slice(0, 2000);
  } catch {
    return '';
  }
}

async function fetchFeedStatusJson(opts: {
  apiBase: string;
  apiKey: string;
  userId: string;
  sellerIdForUa: string;
  buCode: string;
  feedId: string;
}): Promise<{ ok: boolean; parsed: Record<string, unknown> | null; text: string }> {
  const { apiBase, apiKey, userId, sellerIdForUa, buCode, feedId } = opts;
  const baseParams: Record<string, string> = {
    Action: 'FeedStatus',
    FeedID: feedId,
    Format: 'JSON',
    Timestamp: utcTimestampIso8601(),
    UserID: userId,
    Version: '1.0',
  };
  const signed = await signFalabellaQuery(apiKey, baseParams);
  const qs = buildQueryString(signed);
  const url = `${apiBase.replace(/\/$/, '')}/?${qs}`;
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
  return { ok: res.ok, parsed, text };
}

async function pollFeedUntilDone(
  opts: {
    apiBase: string;
    apiKey: string;
    userId: string;
    sellerIdForUa: string;
    buCode: string;
    feedId: string;
  },
  maxAttempts: number,
  delayMs: number,
): Promise<{
  feedDetail: Record<string, unknown> | null;
  lastParsed: Record<string, unknown> | null;
}> {
  let lastParsed: Record<string, unknown> | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    const r = await fetchFeedStatusJson(opts);
    lastParsed = r.parsed;
    if (!r.ok || !r.parsed) {
      if (i < maxAttempts - 1) await sleep(delayMs);
      continue;
    }
    if (r.parsed.ErrorResponse) {
      return { feedDetail: null, lastParsed: r.parsed };
    }
    const fd = extractFeedDetail(r.parsed);
    if (fd) {
      const status = String(fd.Status ?? fd.status ?? '').trim();
      if (status === 'Finished' || status === 'Error' || status === 'Canceled') {
        return { feedDetail: fd, lastParsed: r.parsed };
      }
    }
    if (i < maxAttempts - 1) await sleep(delayMs);
  }
  const fd = lastParsed ? extractFeedDetail(lastParsed) : null;
  return { feedDetail: fd, lastParsed };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type FeedInterpretation = {
  syncStatusOut: 'synced' | 'pending' | 'error';
  feedStatusOut: string | null;
  lastErrOut: string | null;
  feedDetailJson: unknown;
  feedDetailForResponse: Record<string, unknown> | null;
};

function interpretFeedPollResult(
  poll: Awaited<ReturnType<typeof pollFeedUntilDone>>,
):
  | { feedStatusError: true; lastErrOut: string; feedDetailJson: unknown }
  | ({ feedStatusError: false } & FeedInterpretation) {
  const feedDetailForResponse = poll.feedDetail;
  const detailForDb = poll.feedDetail ?? extractFeedDetail(poll.lastParsed);
  const feedDetailJson = jsonForDb(detailForDb ?? poll.lastParsed);

  const fsErr = poll.lastParsed?.ErrorResponse as Record<string, unknown> | undefined;
  if (fsErr) {
    const h = fsErr.Head as Record<string, unknown> | undefined;
    const em = h?.ErrorMessage;
    const lastErrOut = typeof em === 'string' ? em.slice(0, 2000) : 'FeedStatus ErrorResponse';
    return { feedStatusError: true, lastErrOut, feedDetailJson };
  }

  let syncStatusOut: 'synced' | 'pending' | 'error' = 'pending';
  let feedStatusOut: string | null = null;
  let lastErrOut: string | null = null;

  if (poll.feedDetail) {
    const st = String(poll.feedDetail.Status ?? poll.feedDetail.status ?? '').trim();
    feedStatusOut = st || null;
    const failed = Number(poll.feedDetail.FailedRecords ?? poll.feedDetail.failedRecords ?? 0) || 0;
    const errs = feedErrorsToString(poll.feedDetail);
    if (st === 'Error' || st === 'Canceled') {
      syncStatusOut = 'error';
      lastErrOut = errs || `Feed ${st}`;
    } else if (st === 'Finished') {
      if (failed > 0 || (errs && errs.length > 0)) {
        syncStatusOut = 'error';
        lastErrOut = errs || `Feed Finished con ${failed} registro(s) fallidos`;
      } else {
        syncStatusOut = 'synced';
      }
    } else {
      syncStatusOut = 'pending';
      lastErrOut = errs ? errs.slice(0, 2000) : null;
    }
  } else {
    syncStatusOut = 'pending';
    lastErrOut = null;
  }

  return {
    feedStatusError: false,
    syncStatusOut,
    feedStatusOut,
    lastErrOut,
    feedDetailJson,
    feedDetailForResponse,
  };
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

function parseRequestIdFromHead(parsed: Record<string, unknown> | null): string {
  if (!parsed) return '';
  const success = parsed.SuccessResponse as Record<string, unknown> | undefined;
  const head = success?.Head as Record<string, unknown> | undefined;
  const raw = head?.RequestId;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

type ProductRow = {
  id: string;
  ref?: string | null;
  price?: number | string | null;
  stock?: number | string | null;
  falabella_seller_sku?: string | null;
};

async function patchProductRow(productId: string, fields: Record<string, unknown>): Promise<void> {
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
    console.warn('[falabella-product-update] PATCH products', r.status, t);
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

function sellerSkuFromProduct(p: ProductRow): string {
  const fromCol = String(p.falabella_seller_sku || '').trim();
  if (fromCol) return fromCol;
  return String(p.ref || p.id).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 200);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'Use POST' }, 405);

    let body: {
      productId?: string;
      price?: number;
      stock?: number;
      status?: string;
      pollFeed?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'JSON inválido' }, 400);
    }

    const productId = String(body.productId || '').trim();
    if (!productId) return json({ ok: false, error: 'productId requerido' }, 400);

    const userId = String(Deno.env.get('FALABELLA_USER_ID') || '').trim();
    const apiKey = String(Deno.env.get('FALABELLA_API_KEY') || '').trim();
    const operatorCode = String(Deno.env.get('FALABELLA_OPERATOR_CODE') || 'faco').trim().toLowerCase();

    if (!userId || !apiKey) {
      return json({
        ok: true,
        dryRun: true,
        message:
          'Falabella: configura FALABELLA_USER_ID y FALABELLA_API_KEY en secrets de la función.',
      });
    }

    const product = await fetchProduct(productId);
    if (!product) return json({ ok: false, error: 'Producto no encontrado en products' }, 404);

    const sku = sellerSkuFromProduct(product);
    if (!sku) return json({ ok: false, error: 'Sin SellerSku (ref o falabella_seller_sku)' }, 400);

    const priceRaw = body.price != null ? Number(body.price) : Number(product.price ?? 0);
    const price = Math.max(0, Math.round(Number.isFinite(priceRaw) ? priceRaw : 0));

    const stockRaw = body.stock != null ? Number(body.stock) : Number(product.stock ?? 0);
    const stock = Math.max(0, Math.floor(Number.isFinite(stockRaw) ? stockRaw : 0));

    const statusStr = String(body.status || 'active').toLowerCase();
    const listingStatus = statusStr === 'inactive' ? 'inactive' : 'active';

    const apiBase = (Deno.env.get('FALABELLA_API_BASE') || 'https://sellercenter-api.falabella.com').replace(
      /\/?$/,
      '',
    );
    const sellerIdForUa = String(Deno.env.get('FALABELLA_SELLER_ID') || '').trim() ||
      userId.split('@')[0] ||
      'seller';
    const buCode = String(Deno.env.get('FALABELLA_BUSINESS_UNIT_CODE') || 'FACO').trim();

    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    <SellerSku>${escapeXml(sku)}</SellerSku>
    <BusinessUnits>
      <BusinessUnit>
        <OperatorCode>${escapeXml(operatorCode)}</OperatorCode>
        <Price>${price}</Price>
        <Stock>${stock}</Stock>
        <Status>${escapeXml(listingStatus)}</Status>
      </BusinessUnit>
    </BusinessUnits>
  </Product>
</Request>`;

    const baseParams: Record<string, string> = {
      Action: 'ProductUpdate',
      Format: 'JSON',
      Timestamp: utcTimestampIso8601(),
      UserID: userId,
      Version: '1.0',
    };

    const signed = await signFalabellaQuery(apiKey, baseParams);
    const qs = buildQueryString(signed);
    const url = `${apiBase}/?${qs}`;
    const userAgent = `${sellerIdForUa}/Deno/1.0/PROPIA/${buCode}`;

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
        falabella_last_error: `ProductUpdate: ${errText.slice(0, 2000)}`,
        falabella_last_sync_at: new Date().toISOString(),
      });
      return json({ ok: false, error: errText, falabella: parsed }, 502);
    }

    const errResp = parsed?.ErrorResponse as Record<string, unknown> | undefined;
    if (errResp) {
      const head = errResp.Head as Record<string, unknown> | undefined;
      const em = head?.ErrorMessage;
      const errMsg = typeof em === 'string' ? em : 'ErrorResponse de Falabella';
      await patchProductRow(productId, {
        falabella_sync_status: 'error',
        falabella_last_error: String(errMsg).slice(0, 2000),
        falabella_last_sync_at: new Date().toISOString(),
      });
      return json({ ok: false, error: errMsg, falabella: parsed }, 502);
    }

    const requestId = parseRequestIdFromHead(parsed);
    const updateJson = jsonForDb(parsed);

    await patchProductRow(productId, {
      falabella_sync_status: 'pending',
      falabella_last_response_json: updateJson,
      falabella_feed_request_id: requestId || null,
      falabella_last_error: null,
      falabella_last_sync_at: new Date().toISOString(),
      falabella_feed_detail_json: null,
      falabella_feed_status: null,
    });

    const pollFeed = body.pollFeed !== false;
    let syncStatusOut: 'synced' | 'pending' | 'error' = 'pending';
    let feedStatusOut: string | null = null;
    let lastErrOut: string | null = null;
    let feedDetailForResponse: Record<string, unknown> | null = null;

    if (pollFeed && requestId) {
      const maxPoll = Math.min(30, Math.max(1, parseInt(Deno.env.get('FALABELLA_FEED_POLL_ATTEMPTS') || '10', 10) || 10));
      const delayMs = Math.min(15000, Math.max(500, parseInt(Deno.env.get('FALABELLA_FEED_POLL_MS') || '2500', 10) || 2500));
      const poll = await pollFeedUntilDone(
        { apiBase, apiKey, userId, sellerIdForUa, buCode, feedId: requestId },
        maxPoll,
        delayMs,
      );
      const interpreted = interpretFeedPollResult(poll);

      if (interpreted.feedStatusError) {
        syncStatusOut = 'error';
        lastErrOut = interpreted.lastErrOut;
        feedStatusOut = null;
        await patchProductRow(productId, {
          falabella_sync_status: syncStatusOut,
          falabella_feed_status: feedStatusOut,
          falabella_feed_detail_json: interpreted.feedDetailJson,
          falabella_last_error: lastErrOut,
          falabella_last_sync_at: new Date().toISOString(),
        });
        return json({
          ok: true,
          syncStatus: syncStatusOut,
          feedStatus: feedStatusOut,
          lastError: lastErrOut,
          sellerSku: sku,
          price,
          stock,
          status: listingStatus,
          requestId,
          message: lastErrOut || 'Error en FeedStatus',
          falabella: parsed,
        });
      }

      syncStatusOut = interpreted.syncStatusOut;
      feedStatusOut = interpreted.feedStatusOut;
      lastErrOut = interpreted.lastErrOut;
      feedDetailForResponse = interpreted.feedDetailForResponse;

      await patchProductRow(productId, {
        falabella_sync_status: syncStatusOut,
        falabella_feed_status: feedStatusOut,
        falabella_feed_detail_json: interpreted.feedDetailJson,
        falabella_last_error: lastErrOut,
        falabella_last_sync_at: new Date().toISOString(),
      });
    } else if (!requestId) {
      lastErrOut = 'ProductUpdate sin RequestId; no se consultó FeedStatus.';
      await patchProductRow(productId, {
        falabella_sync_status: 'pending',
        falabella_last_error: lastErrOut,
        falabella_last_sync_at: new Date().toISOString(),
      });
    }

    const msgDone =
      syncStatusOut === 'synced'
        ? 'Precio/stock actualizados (feed Finished).'
        : syncStatusOut === 'error'
          ? (lastErrOut || 'Error en feed.')
          : `Actualización en cola o procesando (${feedStatusOut || '…'}).`;

    return json({
      ok: true,
      syncStatus: syncStatusOut,
      feedStatus: feedStatusOut,
      feedDetail: feedDetailForResponse,
      lastError: lastErrOut,
      sellerSku: sku,
      price,
      stock,
      status: listingStatus,
      requestId: requestId || undefined,
      message: msgDone,
      falabella: parsed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[falabella-product-update]', msg);
    return json({ ok: false, error: msg }, 500);
  }
});
