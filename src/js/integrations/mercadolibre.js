/**
 * Mercado Libre — integración mínima (MVP).
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
 * ML_BRAND_VALUE_ID, ML_DEFAULT_SIZE; opcional ML_LISTING_TYPE_ID. Deploy: `mercadolibre-sync-product`.
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
  if (Array.isArray(ml.cause)) {
    const serious = ml.cause.find(function (c) {
      if (!c || typeof c !== 'object' || !c.message) return false;
      const m = String(c.message);
      return !/ignored because it is not modifiable/i.test(m);
    });
    const pick = serious || ml.cause[0];
    if (pick && typeof pick === 'object' && pick.message) return String(pick.message);
  }
  if (ml.message) return String(ml.message);
  if (ml.error) return typeof ml.error === 'string' ? ml.error : JSON.stringify(ml.error);
  return JSON.stringify(ml);
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
    const detail = formatMlApiError(data.mercadolibre) || data.error || 'Mercado Libre rechazó la publicación';
    throw new Error(detail);
  }
  return data || { ok: true };
};
