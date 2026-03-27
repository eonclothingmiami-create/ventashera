/**
 * Falabella Seller Center — ProductCreate vía Edge Function `falabella-sync-product`.
 * Documentación: https://developers.falabella.com/v600/reference/getting-started
 *
 * Credenciales (UserID, ApiKey, categoría, marca, operator) van en secrets de Supabase, no en el navegador.
 * Categoría por producto: secret `FALABELLA_CATEGORY_MAP_JSON` (nombre ERP → CategoryId) o `FALABELLA_PRIMARY_CATEGORY_ID`.
 * La función guarda estado en columnas `falabella_*` de `products` (tras migración SQL).
 * El alta es asíncrona (feed); revisa el estado en Seller Center.
 */
(function initFalabellaEndpoint() {
  const custom = String(window.FALABELLA_SYNC_ENDPOINT || '').trim();
  if (custom) return;
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  if (base) {
    window.FALABELLA_SYNC_ENDPOINT = String(base).replace(/\/$/, '') + '/functions/v1/falabella-sync-product';
  }
})();

window.FalabellaConfig = {
  /** Códigos de unidad de negocio (cabecera User-Agent / país). */
  BUSINESS_UNIT: { CO: 'FACO', CL: 'FACL', PE: 'FAPE' },
  DOC: 'https://developers.falabella.com/v600/reference/productcreate',
};

/**
 * @param {string} productId - UUID en tabla `products`
 * @param {object} [extra] - Opcional: { primaryCategoryId, brand, color, colorBasico, talla, parentSku,
 *   productDataMandatory, productDataProductSpecific, productDataOptional,
 *   syncImages (boolean), imageUrls (string[]) } — Tras ProductCreate OK, la función envía Action=Image con
 *   hasta 8 URLs desde products.images o imageUrls (ver docs Falabella Image).
 * @returns {Promise<object>}
 */
window.requestFalabellaSync = async function requestFalabellaSync(productId, extra) {
  const url = (window.FALABELLA_SYNC_ENDPOINT || '').trim();
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
    throw new Error(data.error && String(data.error).trim() ? String(data.error) : 'Falabella rechazó la solicitud');
  }
  /** `ok: true` puede ir con `syncStatus: 'error'` si el feed falló tras ProductCreate; revisa `lastError` / `feedStatus`. */
  return data || { ok: true };
};
