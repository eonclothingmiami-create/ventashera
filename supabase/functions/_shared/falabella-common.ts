/**
 * Utilidades compartidas Falabella (Edge Functions). Sin secretos en logs.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jsonForDb(value: unknown): unknown {
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

export function extractFeedDetail(parsed: Record<string, unknown> | null): Record<string, unknown> | null {
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

export function feedErrorsToString(fd: Record<string, unknown>): string {
  const fe = fd.FeedErrors ?? fd.feedErrors;
  if (fe == null || fe === '') return '';
  if (typeof fe === 'string') return fe.slice(0, 2000);
  try {
    return JSON.stringify(fe).slice(0, 2000);
  } catch {
    return '';
  }
}

function isNonTerminalFeedStatus(st: string): boolean {
  const u = st.toLowerCase();
  return u === 'queued' || u === 'processing' || u === 'pending' || u === 'in progress' || u === 'in_progress';
}

export type FeedPollAuditEntry = {
  attempt: number;
  delayMs: number;
  feedStatus: string | null;
  httpOk: boolean;
  at: string;
};

export async function fetchFeedStatusJson(opts: {
  apiBase: string;
  apiKey: string;
  userId: string;
  sellerIdForUa: string;
  buCode: string;
  feedId: string;
  sign: (apiKey: string, baseParams: Record<string, string>) => Promise<Record<string, string>>;
  buildQs: (params: Record<string, string>) => string;
  utcTimestampIso8601: () => string;
}): Promise<{ ok: boolean; parsed: Record<string, unknown> | null; text: string }> {
  const { apiBase, apiKey, userId, sellerIdForUa, buCode, feedId, sign, buildQs, utcTimestampIso8601 } = opts;
  const baseParams: Record<string, string> = {
    Action: 'FeedStatus',
    FeedID: feedId,
    Format: 'JSON',
    Timestamp: utcTimestampIso8601(),
    UserID: userId,
    Version: '1.0',
  };
  const signed = await sign(apiKey, baseParams);
  const qs = buildQs(signed);
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

/**
 * Polling con backoff exponencial para Queued/Processing.
 * Tras agotar intentos, devuelve último parseo aunque siga en cola (el caller marca feed_timeout / error).
 */
export async function pollFeedUntilDoneWithBackoff(opts: {
  apiBase: string;
  apiKey: string;
  userId: string;
  sellerIdForUa: string;
  buCode: string;
  feedId: string;
  sign: (apiKey: string, baseParams: Record<string, string>) => Promise<Record<string, string>>;
  buildQs: (params: Record<string, string>) => string;
  utcTimestampIso8601: () => string;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}): Promise<{
  feedDetail: Record<string, unknown> | null;
  lastParsed: Record<string, unknown> | null;
  audit: FeedPollAuditEntry[];
  exhaustedWhileNonTerminal: boolean;
  lastNonTerminalStatus: string | null;
}> {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    backoffFactor,
    ...fetchOpts
  } = opts;
  let lastParsed: Record<string, unknown> | null = null;
  let lastNonTerminalStatus: string | null = null;
  const audit: FeedPollAuditEntry[] = [];
  let delay = Math.max(500, baseDelayMs);
  let exhaustedWhileNonTerminal = false;

  for (let i = 0; i < maxAttempts; i++) {
    const r = await fetchFeedStatusJson(fetchOpts);
    lastParsed = r.parsed;
    const fd = r.parsed ? extractFeedDetail(r.parsed) : null;
    const st = fd ? String(fd.Status ?? fd.status ?? '').trim() : '';
    audit.push({
      attempt: i + 1,
      delayMs: i === 0 ? 0 : delay,
      feedStatus: st || null,
      httpOk: r.ok,
      at: new Date().toISOString(),
    });

    if (!r.ok || !r.parsed) {
      if (i < maxAttempts - 1) {
        await sleep(delay);
        delay = Math.min(maxDelayMs, Math.round(delay * backoffFactor));
      }
      continue;
    }
    if (r.parsed.ErrorResponse) {
      return { feedDetail: null, lastParsed: r.parsed, audit, exhaustedWhileNonTerminal: false, lastNonTerminalStatus };
    }
    if (fd) {
      if (st === 'Finished' || st === 'Error' || st === 'Canceled') {
        return { feedDetail: fd, lastParsed: r.parsed, audit, exhaustedWhileNonTerminal: false, lastNonTerminalStatus };
      }
      if (isNonTerminalFeedStatus(st)) {
        lastNonTerminalStatus = st;
      }
    }
    if (i < maxAttempts - 1) {
      await sleep(delay);
      delay = Math.min(maxDelayMs, Math.round(delay * backoffFactor));
    }
  }
  const fd = lastParsed ? extractFeedDetail(lastParsed) : null;
  const finalSt = fd ? String(fd.Status ?? fd.status ?? '').trim() : '';
  if (finalSt && isNonTerminalFeedStatus(finalSt)) {
    exhaustedWhileNonTerminal = true;
    lastNonTerminalStatus = finalSt;
  }
  return { feedDetail: fd, lastParsed, audit, exhaustedWhileNonTerminal, lastNonTerminalStatus };
}

export type FeedInterpretation = {
  syncStatusOut: 'synced' | 'pending' | 'error' | 'feed_timeout' | 'error_validacion';
  feedStatusOut: string | null;
  lastErrOut: string | null;
  feedDetailJson: unknown;
  feedDetailForResponse: Record<string, unknown> | null;
};

export function interpretFeedPollResult(
  poll: {
    feedDetail: Record<string, unknown> | null;
    lastParsed: Record<string, unknown> | null;
    exhaustedWhileNonTerminal?: boolean;
    lastNonTerminalStatus?: string | null;
  },
  opts?: { requestId?: string; maxAttempts?: number },
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

  let syncStatusOut: FeedInterpretation['syncStatusOut'] = 'pending';
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
    } else if (poll.exhaustedWhileNonTerminal && isNonTerminalFeedStatus(st)) {
      syncStatusOut = 'feed_timeout';
      const rid = opts?.requestId ? ` RequestId: ${opts.requestId}.` : '';
      const att = opts?.maxAttempts != null ? ` Tras ${opts.maxAttempts} consultas con backoff.` : '';
      lastErrOut =
        `El feed sigue en "${st}" en Seller Center.${att}${rid} Revisa el estado del feed en Seller Center o reintenta la sincronización. ` +
        `Si el producto fue rechazado por marca o atributos, revisa GetCategoryAttributes y que la marca exista en GetBrands (o usa GENÉRICO).`;
    } else {
      syncStatusOut = 'pending';
      lastErrOut = errs ? errs.slice(0, 2000) : null;
    }
  } else {
    if (poll.exhaustedWhileNonTerminal) {
      syncStatusOut = 'feed_timeout';
      const st = poll.lastNonTerminalStatus || 'desconocido';
      const rid = opts?.requestId ? ` RequestId: ${opts.requestId}.` : '';
      lastErrOut =
        `No se obtuvo FeedDetail definitivo; último estado observado: "${st}".${rid} Reintenta o revisa Seller Center.`;
    } else {
      syncStatusOut = 'pending';
      lastErrOut = null;
    }
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

/** Normaliza texto para comparar marcas (sin acentos, colapsa espacios). */
export function normalizeBrandKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export type BrandRow = { name: string; globalId: string };

function flattenBrandNodes(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const inner = o.Brand ?? o.brands ?? o.Items ?? o.items;
    if (Array.isArray(inner)) return inner;
    if (inner && typeof inner === 'object') return [inner];
  }
  return [raw];
}

export function parseBrandsFromGetBrandsResponse(parsed: Record<string, unknown> | null): BrandRow[] {
  if (!parsed) return [];
  const sr = parsed.SuccessResponse as Record<string, unknown> | undefined;
  const body = sr?.Body;
  const out: BrandRow[] = [];
  const pushFromList = (list: unknown[]) => {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const name = String(o.Name ?? o.name ?? '').trim();
      const globalId = String(o.GlobalIdentifier ?? o.globalIdentifier ?? o.GlobalId ?? '').trim();
      if (name || globalId) out.push({ name, globalId });
    }
  };
  if (Array.isArray(body)) {
    pushFromList(body);
    return out;
  }
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const raw = b.Brands ?? b.brands ?? b.Brand ?? b.brand;
    pushFromList(flattenBrandNodes(raw));
  }
  return out;
}

export function findBrandInCatalog(brandRequested: string, brands: BrandRow[]): BrandRow | null {
  const target = normalizeBrandKey(brandRequested);
  if (!target) return null;
  for (const b of brands) {
    if (normalizeBrandKey(b.name) === target) return b;
    if (b.globalId && normalizeBrandKey(b.globalId) === target) return b;
    if (b.globalId && target === normalizeBrandKey(b.globalId.replace(/_/g, ' '))) return b;
  }
  return null;
}

export function brandMatchesFalabellaList(brandRequested: string, brands: BrandRow[]): boolean {
  return findBrandInCatalog(brandRequested, brands) != null;
}

/** Preferencias para fallback cuando la marca pedida no está en GetBrands. */
const GENERIC_BRAND_KEYS = [
  'generico',
  'sin marca',
  'generic',
  'unbranded',
  'no brand',
  'otros',
  'other',
];

/**
 * Devuelve una marca del catálogo GetBrands usable como fallback (p. ej. "Genérico").
 * Nunca inventa el string "GENERICO": ProductCreate exige el Name exacto del Seller Center.
 */
export function pickFallbackBrandFromCatalog(brands: BrandRow[]): BrandRow | null {
  if (!brands.length) return null;
  for (const key of GENERIC_BRAND_KEYS) {
    const hit = findBrandInCatalog(key, brands);
    if (hit) return hit;
  }
  for (const b of brands) {
    const n = normalizeBrandKey(b.name);
    if (n.includes('generico') || n.includes('sin marca')) return b;
  }
  return null;
}

/** Nombre canónico a enviar en ProductCreate (Name del catálogo si existe). */
export function resolveBrandNameForFeed(brandRequested: string, brands: BrandRow[]): string | null {
  const hit = findBrandInCatalog(brandRequested, brands);
  if (!hit) return null;
  return (hit.name || hit.globalId || '').trim() || null;
}

export type PrevalidateProductCreateInput = {
  brand: string;
  name: string;
  description: string;
  sellerSku: string;
  parentSku: string;
  color: string;
  talla: string;
  conditionType: string;
  packageHeight: number;
  packageWidth: number;
  packageLength: number;
  packageWeight: number;
  taxPercentageStr: string;
  buCode: string;
};

/** Validación estricta antes de enviar ProductCreate. Devuelve mensajes en español para UI/BD. */
export function prevalidateProductCreateFields(v: PrevalidateProductCreateInput): string[] {
  const errs: string[] = [];
  if (!String(v.brand || '').trim()) errs.push('Marca (brand) obligatoria.');
  const nm = String(v.name || '').trim();
  if (!nm || nm.length < 2) errs.push('Nombre (name) obligatorio (mín. 2 caracteres).');
  const desc = String(v.description || '').trim();
  if (desc.length < 10) errs.push('Descripción obligatoria (mín. 10 caracteres, no solo el nombre).');
  const sku = String(v.sellerSku || '').trim();
  if (!sku) errs.push('Seller SKU obligatorio (código ref del producto).');
  if (!String(v.color || '').trim()) errs.push('Variación: Color obligatorio.');
  if (!String(v.talla || '').trim()) errs.push('Variación: Talla obligatoria.');
  if (!String(v.parentSku || '').trim()) errs.push('Parent SKU obligatorio.');
  if (!String(v.conditionType || '').trim()) errs.push('condition_type (ProductData) obligatorio.');
  if (!Number.isFinite(v.packageHeight) || v.packageHeight <= 0) errs.push('package_height (cm) debe ser > 0.');
  if (!Number.isFinite(v.packageWidth) || v.packageWidth <= 0) errs.push('package_width (cm) debe ser > 0.');
  if (!Number.isFinite(v.packageLength) || v.packageLength <= 0) errs.push('package_length (cm) debe ser > 0.');
  if (!Number.isFinite(v.packageWeight) || v.packageWeight <= 0) errs.push('package_weight (kg) debe ser > 0.');
  const bu = String(v.buCode || '').trim().toUpperCase();
  if (bu === 'FACO' && !String(v.taxPercentageStr || '').trim()) {
    errs.push('tax_percentage obligatorio para Colombia (FACO). Configura FALABELLA_TAX_PERCENTAGE o ProductData.');
  }
  return errs;
}

export function buildValidationErrorMessage(errors: string[]): string {
  return `[error_validacion] ${errors.join(' | ')}`.slice(0, 2000);
}

export async function fetchGetBrandsJson(opts: {
  apiBase: string;
  apiKey: string;
  userId: string;
  sellerIdForUa: string;
  buCode: string;
  sign: (apiKey: string, baseParams: Record<string, string>) => Promise<Record<string, string>>;
  buildQs: (params: Record<string, string>) => string;
  utcTimestampIso8601: () => string;
}): Promise<{ ok: boolean; parsed: Record<string, unknown> | null; text: string }> {
  const { apiBase, apiKey, userId, sellerIdForUa, buCode, sign, buildQs, utcTimestampIso8601 } = opts;
  const baseParams: Record<string, string> = {
    Action: 'GetBrands',
    Format: 'JSON',
    Timestamp: utcTimestampIso8601(),
    UserID: userId,
    Version: '1.0',
  };
  const signed = await sign(apiKey, baseParams);
  const qs = buildQs(signed);
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
