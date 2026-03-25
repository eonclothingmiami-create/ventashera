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
/** Misma anon key que repository.js (fallback si el script cargó fuera de orden). */
const _FALLBACK_SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paWxheGRlZXR1enV0eWN2ZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjc0NjIsImV4cCI6MjA4ODk0MzQ2Mn0.GI8E7vRzxi5NumN_f4T432Lx4BcmgGLZo81BR9h3h8c';

async function buildEdgeHeadersAnonOnly() {
  const anon =
    (window.AppRepository && window.AppRepository.SUPABASE_ANON_KEY) || _FALLBACK_SUPABASE_ANON;
  return {
    'Content-Type': 'application/json',
    apikey: anon,
    Authorization: 'Bearer ' + anon,
  };
}

window.requestPinterestCatalogSync = async function requestPinterestCatalogSync(
  productId,
) {
  const url = (window.PINTEREST_CATALOG_SYNC_ENDPOINT || '').trim();
  if (!url || !productId) {
    return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  }
  const body = JSON.stringify({ productId });
  let headers =
    typeof window.AppRepository?.getSupabaseEdgeHeaders === 'function'
      ? await window.AppRepository.getSupabaseEdgeHeaders()
      : await buildEdgeHeadersAnonOnly();

  let res = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });
  /** Gateway 401: a veces el JWT de sesión falla; reintento solo con anon (rol public). */
  if (res.status === 401 && typeof window.AppRepository?.getSupabaseEdgeHeaders === 'function') {
    const anonHeaders = await buildEdgeHeadersAnonOnly();
    res = await fetch(url, {
      method: 'POST',
      headers: anonHeaders,
      body,
    });
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const raw =
      (data && (data.error || data.message)) || text || String(res.status);
    let msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (res.status === 401) {
      msg +=
        ' — Si el 401 continúa: despliega la función con JWT desactivado en gateway: `supabase functions deploy pinterest-catalog-sync --no-verify-jwt` (o en supabase/config.toml: [functions.pinterest-catalog-sync] verify_jwt = false).';
    }
    throw new Error(msg);
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
