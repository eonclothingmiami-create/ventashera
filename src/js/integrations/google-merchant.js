/**
 * Google Merchant Center — catálogo / Shopping (Content API v2.1 vía Edge Function).
 * El token y la cuenta de servicio viven solo en secrets de Supabase.
 *
 * Endpoint: `window.GOOGLE_MERCHANT_SYNC_ENDPOINT` o, si está vacío,
 * `AppRepository.SUPABASE_URL` + `/functions/v1/google-merchant-sync`.
 *
 * Secrets: GOOGLE_MERCHANT_ID, GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_SERVICE_ACCOUNT_JSON_B64, GOOGLE_PRODUCT_BASE_URL;
 * opcionales: GOOGLE_CONTENT_LANGUAGE, GOOGLE_TARGET_COUNTRY, GOOGLE_BRAND, etc.
 * Deploy: `npx supabase functions deploy google-merchant-sync --no-verify-jwt`
 */
(function initGoogleMerchantEndpoint() {
  const custom = String(window.GOOGLE_MERCHANT_SYNC_ENDPOINT || '').trim();
  if (custom) return;
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  if (base) {
    window.GOOGLE_MERCHANT_SYNC_ENDPOINT =
      String(base).replace(/\/$/, '') + '/functions/v1/google-merchant-sync';
  }
})();

window.GoogleMerchantConfig = {
  CURRENCY: 'COP',
};

/**
 * Sincroniza un producto con Merchant Center (upsert por offerId + país + idioma + canal).
 * @param {string} productId - UUID en `products`
 * @param {{ gtin?: string }} [extra] - Opcional: GTIN/EAN 8–14 dígitos (como insert.py de Google).
 * @returns {Promise<object>}
 */
window.requestGoogleMerchantSync = async function requestGoogleMerchantSync(
  productId,
  extra,
) {
  const url = (window.GOOGLE_MERCHANT_SYNC_ENDPOINT || '').trim();
  if (!url || !productId) {
    return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  }
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = 'Bearer ' + anon;
  }
  const payload = { productId };
  if (extra && typeof extra === 'object' && extra.gtin) {
    const g = String(extra.gtin).replace(/\D/g, '');
    if (g.length >= 8 && g.length <= 14) payload.gtin = g;
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
    const msg =
      (data && (data.error || data.message)) || text || String(res.status);
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  if (data && data.ok === false) {
    const detail =
      data.error && String(data.error).trim()
        ? String(data.error)
        : 'Google Merchant rechazó o no pudo procesar la solicitud';
    throw new Error(detail);
  }
  return data || { ok: true };
};
