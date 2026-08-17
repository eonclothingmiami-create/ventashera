/**
 * eBay US — publicación vía Edge Function `ebay-sync-product` (Sell Inventory API).
 * Aislada de ML / Meta / Google / Pinterest / Wompi.
 *
 * Endpoint: `window.EBAY_SYNC_ENDPOINT` o SUPABASE_URL + /functions/v1/ebay-sync-product.
 * Secrets solo en el servidor (EBAY_CLIENT_ID, EBAY_REFRESH_TOKEN, políticas).
 *
 * Body: { productId, action?: 'publish' | 'deactivate' }
 * Respuesta: { ok, dryRun?, listingId?, offerId?, sku?, message? }
 */
(function initEbayEndpoint() {
  const custom = String(window.EBAY_SYNC_ENDPOINT || '').trim();
  if (custom) return;
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  if (base) {
    window.EBAY_SYNC_ENDPOINT = String(base).replace(/\/$/, '') + '/functions/v1/ebay-sync-product';
  }
})();

window.EbayConfig = {
  MARKETPLACE_ID: 'EBAY_US',
  CURRENCY: 'USD',
  DOC: 'https://developer.ebay.com/api-docs/sell/inventory/overview.html',
};

window.requestEbaySync = async function requestEbaySync(productId, extra) {
  const url = (window.EBAY_SYNC_ENDPOINT || '').trim();
  if (!url || !productId) return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = 'Bearer ' + anon;
  }
  const payload = { productId };
  if (extra && typeof extra === 'object') Object.assign(payload, extra);
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
    throw new Error(String(data.error || 'eBay rechazó la solicitud'));
  }
  return data || { ok: true };
};
