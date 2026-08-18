/**
 * Faire wholesale — sync vía Edge Function `faire-sync` (External API v2).
 * Aislada de POS, eBay, ML y catálogo mayoristas.
 *
 * Endpoint: `window.FAIRE_SYNC_ENDPOINT` o SUPABASE_URL + /functions/v1/faire-sync.
 * Secrets solo en servidor: FAIRE_ACCESS_TOKEN, FAIRE_DEFAULT_TAXONOMY_TYPE_ID.
 *
 * Body: { productId, action?: 'publish' | 'deactivate' | 'sync_inventory' | 'account_setup' }
 * Cron: sync_inventory, pull_orders, bulk_publish (requieren cronSecret).
 */
(function initFaireEndpoint() {
  const custom = String(window.FAIRE_SYNC_ENDPOINT || '').trim();
  if (custom) return;
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  if (base) {
    window.FAIRE_SYNC_ENDPOINT = String(base).replace(/\/$/, '') + '/functions/v1/faire-sync';
  }
})();

window.FaireConfig = {
  CURRENCY: 'USD',
  MOQ: 12,
  DOC: 'https://developers.faire.com/docs',
};

window.requestFaireSync = async function requestFaireSync(productId, extra) {
  const url = (window.FAIRE_SYNC_ENDPOINT || '').trim();
  if (!url || !productId) return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = 'Bearer ' + anon;
  }
  const payload = { productId, action: 'publish' };
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
    throw new Error(String(data.error || 'Faire rechazó la solicitud'));
  }
  return data || { ok: true };
};

/** Prueba credenciales Faire (perfil de marca). */
window.requestFaireAccountSetup = async function requestFaireAccountSetup() {
  const url = (window.FAIRE_SYNC_ENDPOINT || '').trim();
  if (!url) return { skipped: true, reason: 'sin endpoint' };
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = 'Bearer ' + anon;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'account_setup' }),
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
  return data || { ok: true };
};

/** Sync inventario / pedidos (admin o cron). */
window.requestFaireCronAction = async function requestFaireCronAction(action, cronSecret, extra) {
  const url = (window.FAIRE_SYNC_ENDPOINT || '').trim();
  if (!url) return { skipped: true, reason: 'sin endpoint' };
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = 'Bearer ' + anon;
  }
  const payload = { action: String(action || 'sync_inventory'), cronSecret: String(cronSecret || '') };
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
  return data || { ok: true };
};
