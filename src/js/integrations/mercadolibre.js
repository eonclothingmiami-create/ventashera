/**
 * Mercado Libre — integración mínima (MVP).
 * Aislada de otros canales: no mezclar con Meta ni futuras integraciones (ver docs/INTEGRACIONES_CANALES.md).
 *
 * Convive con el resto del ecosistema sin tocar:
 * - Wompi / Addi / checkout (solo en mayoristas + sus Edge Functions).
 * - Supabase catálogo, POS, FCM: mismas credenciales de proyecto, rutas distintas.
 *
 * Endpoint: `window.MERCADOLIBRE_SYNC_ENDPOINT` o, si está vacío, se deriva de
 * `AppRepository.SUPABASE_URL` + `/functions/v1/mercadolibre-sync-product`.
 *
 * Secrets (Supabase → Edge Function): ML_ACCESS_TOKEN, ML_DEFAULT_CATEGORY_ID_MCO,
 * moda: ML_SIZE_GRID_ID, ML_SIZE_GRID_ROW_ID, ML_SIZE_GRID_ROW_MAP (JSON), ML_GENDER_VALUE_ID,
 * ML_BRAND_VALUE_ID, ML_DEFAULT_SIZE; ML_FREE_SHIPPING, ML_PRICE_MARKUP_COP;
 * ML_UPLOAD_PICTURES_TO_ML (default true: sube fotos a ML antes del ítem); opcional ML_LISTING_TYPE_ID.
 * Deploy: `mercadolibre-sync-product`.
 *
 * Incluido: MCO/COP, ERP → Edge Function → POST /items (o dryRun sin secrets).
 * Fuera de alcance: OAuth en front, webhooks de órdenes, buy box.
 */
(function initMercadoLibreEndpoint() {
  const custom = String(window.MERCADOLIBRE_SYNC_ENDPOINT || '').trim();
  if (custom) return;
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  if (base) {
    window.MERCADOLIBRE_SYNC_ENDPOINT = String(base).replace(/\/$/, '') + '/functions/v1/mercadolibre-sync-product';
  }
})();

window.MercadoLibreConfig = {
  SITE_ID: 'MCO',
  CURRENCY_ID: 'COP',
  API_BASE: 'https://api.mercadolibre.com',
};

function formatMlApiError(ml) {
  if (ml == null) return '';
  if (typeof ml === 'string') return ml;
  if (typeof ml !== 'object') return String(ml);
  if (Array.isArray(ml.cause) && ml.cause.length) {
    const parts = [];
    for (var i = 0; i < ml.cause.length; i++) {
      var c = ml.cause[i];
      if (!c) continue;
      var m = typeof c === 'string' ? c : (c.message ? String(c.message) : '');
      if (m && !/ignored because it is not modifiable/i.test(m)) parts.push(m);
    }
    if (parts.length) return parts.join(' · ');
    var first = ml.cause[0];
    if (first && typeof first === 'object' && first.message) return String(first.message);
  }
  if (ml.message) return String(ml.message);
  if (ml.error) {
    if (typeof ml.error === 'string') return ml.error;
    if (ml.error && typeof ml.error === 'object' && ml.error.message) return String(ml.error.message);
    try {
      return JSON.stringify(ml.error).slice(0, 500);
    } catch (_) {
      return '';
    }
  }
  try {
    return JSON.stringify(ml).slice(0, 800);
  } catch (_) {
    return '';
  }
}

/**
 * Llama a la Edge Function `mercadolibre-sync-product` con el id de fila en `products`.
 * Body: { productId, siteId, ...opcional (genderValueId, sizeGridId, sizeGridRowMap, …) }.
 * Respuesta: { ok, dryRun?, itemId?, permalink?, mercadolibre?, fashionMeta? }.
 */
window.requestMercadoLibreSync = async function requestMercadoLibreSync(productId, extra) {
  const url = (window.MERCADOLIBRE_SYNC_ENDPOINT || '').trim();
  if (!url || !productId) return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = `Bearer ${anon}`;
  }
  const payload = {
    productId,
    siteId: window.MercadoLibreConfig.SITE_ID,
  };
  if (extra && typeof extra === 'object') {
    Object.assign(payload, extra);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || text || String(res.status);
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  if (data && data.ok === false) {
    var mlDetail = formatMlApiError(data.mercadolibre);
    var generic = 'Mercado Libre rechazó la publicación';
    var edgeErr = data.error && String(data.error).trim();
    var detail = edgeErr || mlDetail || generic;
    throw new Error(detail);
  }
  return data || { ok: true };
};
