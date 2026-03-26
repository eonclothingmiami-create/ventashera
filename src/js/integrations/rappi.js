/**
 * Rappi Public API — doc. aliados v1.24.5 (integración VentasHera: catálogo de productos / moda, no restaurante).
 *
 * La documentación usa “Menús” y rutas `…/restaurants-integrations-public-api` por legado de producto; para
 * retail (ropa, calzado, accesorios) ese “menú” es el catálogo publicable de la tienda: ítems `type: PRODUCT`,
 * `sku` = referencia del ERP, `children: []` salvo que gestiones variantes como toppings. No es un menú de
 * comidas: mismos endpoints (POST/GET menu, disponibilidad, órdenes), distinta semántica de negocio.
 *
 * Contexto: el ERP mapea artículos (ref, tallas, colores, stock) al catálogo Rappi (recurso “menu”
 * en la API). Los nombres “restaurants” / “menu” / “cookingTime” son del contrato Rappi; en retail
 * moda se usan PRODUCT/SKU (y subitems solo si tu modelo lo requiere).
 *
 * --- No usar dev-portal.rappi.com/api/v1 (usuario final / otro producto) ---
 *
 * --- Recursos v1.24.5 (sobre …/api/v2/restaurants-integrations-public-api) ---
 * Menús: GET/POST menu, GET menu/approved/{storeId}, GET menu/rappi/{storeId}
 * Órdenes: GET orders (?storeId), GET orders/status/sent, PUT orders/{id}/take/{cookingTime},
 *   PUT orders/{id}/reject, POST orders/{id}/ready-for-pickup, GET orders/{id}/events
 * Tiendas: GET stores-pa, PUT stores-pa/{storeId}/status?integrated=, GET store/{storeId}/menu/current
 * Disponibilidad: PUT availability/stores/items, …/items/rappi, PUT availability/stores, …/enable, …/enable/massive
 * Webhooks: GET webhook/{event?}, POST webhook, PUT …/add-stores, …/change-url, …/reset-secret,
 *   …/change-status, DELETE …/remove-stores
 * Utils API (p. ej. v1.2.0): horarios corredor/producto — otro token “utils”; rutas aparte.
 *
 * --- Autenticación (solo servidor) — dos variantes según doc Rappi ---
 * (1) Auth0 client_credentials (ejemplos doc v1.24.5):
 *   POST https://rests-integrations-dev.auth0.com/oauth/token  (dev)
 *   POST https://rests-integrations.auth0.com/oauth/token      (prod)
 *   Body JSON: client_id, client_secret, audience, grant_type: "client_credentials"
 *   Respuesta: access_token, expires_in (p. ej. 86400 s), token_type Bearer.
 *   audience en ejemplo doc: "https://int-public-api-v2/api" — confirma el valor vigente con Rappi.
 * (2) Login por dominio país (otra guía Rappi):
 *   POST {COUNTRY_DOMAIN}/restaurants/auth/v1/token/login/integrations
 *   Body: { client_id, client_secret } — sin audience en body nuevo.
 * Cabecera llamadas API integración: x-authorization: Bearer {access_token}
 *   (en ejemplos aparece “bearer” en minúscula; unifica en servidor.)
 *
 * Dominios país / dev: https://api.rappi.com.co, https://services.rappi.com, https://microservices.dev.rappi.com
 *
 * --- Rendimiento ---
 * Renovar token antes de expirar; ~45 s entre polls de órdenes; menos del 98% éxito puede afectar acceso.
 *
 * Este JS solo dispara Edge Function `hera-rappi-sync` (Supabase anon). Secrets: RAPPI_CLIENT_ID,
 * RAPPI_CLIENT_SECRET, RAPPI_DOMAIN, opc. RAPPI_AUTH0_AUDIENCE, RAPPI_STORE_ID, etc.
 */
(function initRappiEndpoint() {
  const custom = String(window.RAPPI_SYNC_ENDPOINT || '').trim();
  if (custom) return;
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  if (base) {
    window.RAPPI_SYNC_ENDPOINT = String(base).replace(/\/$/, '') + '/functions/v1/hera-rappi-sync';
  }
})();

/** URLs token Auth0 (doc v1.24.5) — solo Edge Function */
window.RappiAuth0TokenUrl = {
  DEV: 'https://rests-integrations-dev.auth0.com/oauth/token',
  PROD: 'https://rests-integrations.auth0.com/oauth/token',
};

/**
 * Rutas relativas tras {COUNTRY_DOMAIN} (auth país) o tras …/restaurants-integrations-public-api.
 * Referencia doc Rappi API v1.24.5.
 */
window.RappiApiPaths = {
  AUTH_INTEGRATIONS: '/restaurants/auth/v1/token/login/integrations',
  AUTH_UTILS: '/restaurants/auth/v1/token/login/utils',
  PUBLIC_API_PREFIX: '/api/v2/restaurants-integrations-public-api',
  MENU: '/menu',
  MENU_APPROVED: (storeId) => `/menu/approved/${encodeURIComponent(storeId)}`,
  MENU_RAPPI_LAST: (storeId) => `/menu/rappi/${encodeURIComponent(storeId)}`,
  ORDERS: '/orders',
  ORDERS_STATUS_SENT: '/orders/status/sent',
  ORDERS_TAKE: (orderId, cookingTime) =>
    `/orders/${encodeURIComponent(orderId)}/take/${encodeURIComponent(cookingTime)}`,
  ORDERS_REJECT: (orderId) => `/orders/${encodeURIComponent(orderId)}/reject`,
  ORDERS_READY_FOR_PICKUP: (orderId) => `/orders/${encodeURIComponent(orderId)}/ready-for-pickup`,
  ORDERS_EVENTS: (orderId) => `/orders/${encodeURIComponent(orderId)}/events`,
  STORES_PA: '/stores-pa',
  STORES_PA_STATUS: (storeId, integrated) =>
    `/stores-pa/${encodeURIComponent(storeId)}/status?integrated=${integrated ? 'true' : 'false'}`,
  STORE_MENU_CURRENT: (storeId) => `/store/${encodeURIComponent(storeId)}/menu/current`,
  AVAILABILITY_ITEMS_STATUS: '/availability/items/status',
  AVAILABILITY_ITEMS_RAPPI_STATUS: '/availability/items/rappi/status',
  AVAILABILITY_STORES_ITEMS: '/availability/stores/items',
  AVAILABILITY_STORES_ITEMS_RAPPI: '/availability/stores/items/rappi',
  AVAILABILITY_STORES_POST: '/availability/stores',
  AVAILABILITY_STORES_PUT: '/availability/stores',
  AVAILABILITY_STORES_ENABLE: '/availability/stores/enable',
  AVAILABILITY_STORES_ENABLE_MASSIVE: '/availability/stores/enable/massive',
  WEBHOOK: (event) => (event ? `/webhook/${encodeURIComponent(event)}` : '/webhook'),
  WEBHOOK_ADD_STORES: (event) => `/webhook/${encodeURIComponent(event)}/add-stores`,
  WEBHOOK_CHANGE_URL: (event) => `/webhook/${encodeURIComponent(event)}/change-url`,
  WEBHOOK_REMOVE_STORES: (event) => `/webhook/${encodeURIComponent(event)}/remove-stores`,
  WEBHOOK_RESET_SECRET: (event) => `/webhook/${encodeURIComponent(event)}/reset-secret`,
  WEBHOOK_CHANGE_STATUS: (event) => `/webhook/${encodeURIComponent(event)}/change-status`,
};

/**
 * @param {string} domain - Sin barra final, ej. https://api.rappi.com.co
 * @returns {string} Base URL API pública (catálogo “menu”, disponibilidad, pedidos…)
 */
window.rappiPublicApiBase = function rappiPublicApiBase(domain) {
  const d = String(domain || '').replace(/\/$/, '');
  return d + window.RappiApiPaths.PUBLIC_API_PREFIX;
};

window.RappiConfig = {
  /** Referencia documentación aliados (tabla de recursos / endpoints). */
  API_DOC_VERSION: '1.24.5',
  VERTICAL: 'fashion',
  COUNTRY_DOMAIN_CO_NEW: 'https://api.rappi.com.co',
  COUNTRY_DOMAIN_CO_LEGACY: 'https://services.rappi.com',
  /** Audience ejemplo en doc Auth0; validar con Rappi. */
  AUTH0_AUDIENCE_EXAMPLE: 'https://int-public-api-v2/api',
  CURRENCY: 'COP',
};

/**
 * Sincroniza un producto del catálogo Supabase con Rappi vía Edge Function.
 * @param {string} productId - UUID en tabla `products`
 * @param {object} [extra] - Opcional: p. ej. { storeId, action: 'menu' | 'availability' } para la función
 * @returns {Promise<object>}
 */
window.requestRappiSync = async function requestRappiSync(productId, extra) {
  if (!productId) return { skipped: true, reason: 'sin productId' };

  const payload = { productId };
  if (extra && typeof extra === 'object') Object.assign(payload, extra);
  const defaultStore = String(window.RAPPI_STORE_ID || '').trim();
  if (defaultStore && !payload.storeId) payload.storeId = defaultStore;

  const url = (window.RAPPI_SYNC_ENDPOINT || '').trim();
  if (!url) return { skipped: true, reason: 'sin endpoint' };

  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (!anon || String(anon).trim() === '') {
    throw new Error(
      'Rappi: no hay SUPABASE_ANON_KEY (revisa que cargue src/js/modules/app/repository.js antes que rappi.js).',
    );
  }

  const headers = {
    'Content-Type': 'application/json',
    apikey: anon,
    Authorization: 'Bearer ' + anon,
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const m = e && e.message ? String(e.message) : String(e);
    throw new Error(
      'Rappi: falló la llamada a la Edge Function (' + m + '). Si ves CORS o "Failed to fetch", revisa Supabase → Edge Functions.',
    );
  }
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
    let detail = data.error && String(data.error).trim()
      ? String(data.error)
      : 'Rappi rechazó o no pudo procesar la solicitud';
    if (/401|token|auth|login/i.test(detail)) {
      detail +=
        ' — Revisa RAPPI_CLIENT_ID / RAPPI_CLIENT_SECRET y RAPPI_DOMAIN en la Edge Function; el token expira ~7 días.';
    }
    throw new Error(detail);
  }
  return data || { ok: true };
};
