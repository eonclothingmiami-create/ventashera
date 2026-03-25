/**
 * Pinterest — catálogo comercial (Marketing API v5, batch items).
 * El token solo vive en secrets de Supabase (Edge Function).
 *
 * Endpoint: `window.PINTEREST_CATALOG_SYNC_ENDPOINT` o
 * `AppRepository.SUPABASE_URL` + `/functions/v1/pinterest-catalog-sync`.
 *
 * Secrets: PINTEREST_PRODUCT_BASE_URL y PINTEREST_ACCESS_TOKEN, o refresh OAuth:
 * PINTEREST_REFRESH_TOKEN + PINTEREST_APP_ID + PINTEREST_APP_SECRET (como api-quickstart).
 * Opcionales: PINTEREST_COUNTRY, PINTEREST_LANGUAGE, PINTEREST_BRAND, PINTEREST_AD_ACCOUNT_ID, PINTEREST_API_BASE.
 * Deploy: `npx supabase functions deploy pinterest-catalog-sync --no-verify-jwt`
 */
(function initPinterestCatalogEndpoint() {
  const custom = String(window.PINTEREST_CATALOG_SYNC_ENDPOINT || '').trim();
  if (custom) return;
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  if (base) {
    window.PINTEREST_CATALOG_SYNC_ENDPOINT =
      String(base).replace(/\/$/, '') + '/functions/v1/pinterest-catalog-sync';
  }
})();

window.PinterestCatalogConfig = {
  CURRENCY: 'COP',
};

/**
 * @param {string} productId - UUID en `products`
 * @returns {Promise<object>}
 */
window.requestPinterestCatalogSync = async function requestPinterestCatalogSync(
  productId,
) {
  const url = (window.PINTEREST_CATALOG_SYNC_ENDPOINT || '').trim();
  if (!url || !productId) {
    return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  }
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = 'Bearer ' + anon;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ productId }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) || text || String(res.status);
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  if (data && data.ok === false) {
    const detail =
      data.error && String(data.error).trim()
        ? String(data.error)
        : 'Pinterest rechazó o no pudo procesar la solicitud';
    throw new Error(detail);
  }
  return data || { ok: true };
};
