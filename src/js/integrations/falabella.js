/**
 * Falabella Seller Center — ProductCreate vía Edge Function `falabella-sync-product`.
 * Documentación: https://developers.falabella.com/v600/reference/getting-started
 *
 * Credenciales (UserID, ApiKey, categoría, marca, operator) van en secrets de Supabase, no en el navegador.
 * Categoría por producto: secret `FALABELLA_CATEGORY_MAP_JSON` (nombre ERP → CategoryId) o `FALABELLA_PRIMARY_CATEGORY_ID`.
 * La función guarda estado en columnas `falabella_*` de `products` (tras migración SQL).
 * El alta es asíncrona (feed); revisa el estado en Seller Center.
 * Ejemplo de XML mínimo (moda/FACO): ver comentario junto a `xmlBody` en
 * `supabase/functions/falabella-sync-product/index.ts`.
 *
 * Estados en `products.falabella_sync_status`: pending | synced | error | error_validacion | feed_timeout
 * (error_validacion = falló validación local o marca no registrada en GetBrands; feed_timeout = feed siguió Queued/Processing tras polling con backoff).
 */
(function initFalabellaEndpoint() {
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  const root = base ? String(base).replace(/\/$/, '') + '/functions/v1/' : '';
  const customSync = String(window.FALABELLA_SYNC_ENDPOINT || '').trim();
  if (!customSync && root) {
    window.FALABELLA_SYNC_ENDPOINT = root + 'falabella-sync-product';
  }
  if (!window.FALABELLA_CATEGORY_ATTRS_ENDPOINT) {
    if (customSync) {
      window.FALABELLA_CATEGORY_ATTRS_ENDPOINT = customSync.replace(
        /falabella-sync-product\/?$/,
        'falabella-get-category-attributes',
      );
    } else if (root) {
      window.FALABELLA_CATEGORY_ATTRS_ENDPOINT = root + 'falabella-get-category-attributes';
    }
  }
  if (!window.FALABELLA_PRODUCT_UPDATE_ENDPOINT) {
    if (customSync) {
      window.FALABELLA_PRODUCT_UPDATE_ENDPOINT = customSync.replace(
        /falabella-sync-product\/?$/,
        'falabella-product-update',
      );
    } else if (root) {
      window.FALABELLA_PRODUCT_UPDATE_ENDPOINT = root + 'falabella-product-update';
    }
  }
  if (!window.FALABELLA_PREFLIGHT_ENDPOINT) {
    if (customSync) {
      window.FALABELLA_PREFLIGHT_ENDPOINT = customSync.replace(
        /falabella-sync-product\/?$/,
        'falabella-preflight',
      );
    } else if (root) {
      window.FALABELLA_PREFLIGHT_ENDPOINT = root + 'falabella-preflight';
    }
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
    const st = data && data.syncStatus != null ? String(data.syncStatus) : '';
    if (
      data &&
      (st === 'error_validacion' || st === 'error') &&
      (data.validationErrors != null || data.error != null)
    ) {
      return {
        ok: false,
        syncStatus: st,
        error: data.error,
        message: data.error,
        validationErrors: data.validationErrors,
        sellerSku: data.sellerSku,
        dryRun: data.dryRun,
      };
    }
    const msg = (data && (data.error || data.message)) || text || String(res.status);
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  if (data && data.ok === false) {
    throw new Error(data.error && String(data.error).trim() ? String(data.error) : 'Falabella rechazó la solicitud');
  }
  /** `ok: true` puede ir con `syncStatus: 'error'` si el feed falló tras ProductCreate; revisa `lastError` / `feedStatus`. */
  return data || { ok: true };
};

/**
 * GetCategoryAttributes — atributos obligatorios/opciones por categoría (misma auth que sync).
 * @param {object} payload - { productId } y/o { primaryCategoryId }
 * @returns {Promise<object>}
 */
window.requestFalabellaCategoryAttributes = async function requestFalabellaCategoryAttributes(payload) {
  const url = String(window.FALABELLA_CATEGORY_ATTRS_ENDPOINT || '').trim();
  if (!url) return { skipped: true, reason: 'sin endpoint' };
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = `Bearer ${anon}`;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
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
  return data || { ok: true };
};

/**
 * Preflight — obligatorios + GetBrands + GetCategoryAttributes + GetMappedAttributeOptions (sin feed).
 * @param {object} payload — { productId?, brand, primaryCategoryId, color, talla, … campos del draft }
 */
window.requestFalabellaPreflight = async function requestFalabellaPreflight(payload) {
  const url = String(window.FALABELLA_PREFLIGHT_ENDPOINT || '').trim();
  if (!url) return { skipped: true, reason: 'sin endpoint' };
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = `Bearer ${anon}`;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
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
  return data || { ok: false, error: 'sin cuerpo' };
};

/**
 * ProductUpdate — precio, stock y estado (active/inactive) en Falabella (feed asíncrono).
 * @param {string} productId
 * @param {object} [extra] - { price?, stock?, status?: 'active'|'inactive', pollFeed?: boolean }
 */
window.requestFalabellaProductUpdate = async function requestFalabellaProductUpdate(productId, extra) {
  const url = String(window.FALABELLA_PRODUCT_UPDATE_ENDPOINT || '').trim();
  if (!url || !productId) return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  const headers = { 'Content-Type': 'application/json' };
  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = `Bearer ${anon}`;
  }
  const payload = { productId, ...(extra && typeof extra === 'object' ? extra : {}) };
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
  return data || { ok: true };
};
