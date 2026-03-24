/**
 * Pinterest Catalog (Shopping) — sincronización desde ERP → Edge Function `pinterest-catalog-sync`.
 *
 * Endpoint: `window.PINTEREST_SYNC_ENDPOINT` o `AppRepository.SUPABASE_URL` + `/functions/v1/pinterest-catalog-sync`.
 *
 * Secrets (solo servidor): PINTEREST_ACCESS_TOKEN, opcional PINTEREST_PRODUCT_BASE_URL, PINTEREST_COUNTRY, PINTEREST_LANGUAGE, etc.
 * Deploy: `supabase functions deploy pinterest-catalog-sync`
 */
(function initPinterestSyncEndpoint() {
  const custom = String(window.PINTEREST_SYNC_ENDPOINT || '').trim();
  if (custom) return;
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  if (base) {
    window.PINTEREST_SYNC_ENDPOINT = String(base).replace(/\/$/, '') + '/functions/v1/pinterest-catalog-sync';
  }
})();

/**
 * @param {string} [productId] - UUID en `products` (omitir si extra.fullSync)
 * @param {{ method?: 'UPDATE'|'DELETE', fullSync?: boolean }} [extra]
 * @returns {Promise<object>}
 */
window.requestPinterestCatalogSync = async function requestPinterestCatalogSync(productId, extra) {
  const url = (window.PINTEREST_SYNC_ENDPOINT || '').trim();
  const fullSync = extra && extra.fullSync === true;
  if (!url || (!fullSync && !productId)) {
    return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  }
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = `Bearer ${anon}`;
  }
  const payload = {};
  if (fullSync) payload.fullSync = true;
  else payload.productId = productId;
  if (extra && typeof extra === 'object') {
    if (extra.method) payload.method = extra.method;
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
    const detail = data.error && String(data.error).trim()
      ? String(data.error)
      : 'Pinterest rechazó la solicitud (token, feed/API o permisos)';
    throw new Error(detail);
  }
  return data || { ok: true };
};
