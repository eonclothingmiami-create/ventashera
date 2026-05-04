/**
 * Meta Commerce Manager — catálogo Facebook Shops / Instagram Shopping (vía Marketing API).
 * Aislada de ML y demás canales (mismos secrets/endpoints no compartidos). Ver docs/INTEGRACIONES_CANALES.md.
 *
 * Misma idea que Mercado Libre: el ERP llama a una Edge Function en Supabase; el token Meta
 * vive solo en secrets del servidor, no en el navegador.
 *
 * Endpoint: `window.META_COMMERCE_SYNC_ENDPOINT` o, si está vacío,
 * `AppRepository.SUPABASE_URL` + `/functions/v1/meta-commerce-sync`.
 *
 * Secrets: META_ACCESS_TOKEN, META_CATALOG_ID (ver comentario en la Edge Function).
 * Deploy: `meta-commerce-sync`.
 */
(function initMetaCommerceEndpoint() {
  const custom = String(window.META_COMMERCE_SYNC_ENDPOINT || '').trim();
  if (custom) return;
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  if (base) {
    window.META_COMMERCE_SYNC_ENDPOINT = String(base).replace(/\/$/, '') + '/functions/v1/meta-commerce-sync';
  }
})();

window.MetaCommerceConfig = {
  CURRENCY: 'COP',
};

/**
 * Sincroniza un producto del ERP con el catálogo de Meta (Commerce Manager).
 * @param {string} productId - id UUID en `products`
 * @param {{ method?: 'UPDATE'|'DELETE' }} [extra]
 * @returns {Promise<object>}
 */
window.requestMetaCommerceSync = async function requestMetaCommerceSync(productId, extra) {
  const url = (window.META_COMMERCE_SYNC_ENDPOINT || '').trim();
  if (!url || !productId) return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = `Bearer ${anon}`;
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
    const detail = data.error && String(data.error).trim()
      ? String(data.error)
      : 'Meta rechazó la solicitud (revisa permisos y catálogo)';
    throw new Error(detail);
  }
  return data || { ok: true };
};
