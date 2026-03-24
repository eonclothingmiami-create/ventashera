/**
 * Dropi — dropshipping (Colombia / región Dropi).
 * Misma arquitectura que Mercado Libre y Meta: el navegador solo envía `productId` a una
 * Edge Function; el token Dropi vive en secrets del servidor.
 *
 * Endpoint: `window.DROPI_SYNC_ENDPOINT` o, si está vacío,
 * `AppRepository.SUPABASE_URL` + `/functions/v1/hera-dropi-sync`.
 *
 * En Supabase, despliega la función `hera-dropi-sync` (Deno). Secrets típicos (ajusta nombres
 * según la documentación que te entregue Dropi en el panel): DROPI_ACCESS_TOKEN,
 * DROPI_API_BASE (p. ej. https://api.dropi.co o el host que indique tu cuenta).
 * El cuerpo esperado desde el front: { productId }.
 * El ERP llama automáticamente al guardar un artículo que quede **visible en catálogo web**
 * (misma condición que para intentar el envío; no usa el desplegable “Tipo” de Dropi para
 * WooCommerce/Pancake: eso es para plugins oficiales; VentasHera va por esta función + token API).
 * La función debe leer la fila en `products` + medios, mapear al formato que exija la API
 * Dropi (productos / variantes / pedidos) y llamar a su API con el token.
 * Llamada: fetch directo (como mercadolibre.js). No uses supabase.functions.invoke: mezcla
 * el JWT de sesión y provoca 401 con fetchWithAuth del cliente.
 *
 * API Dropi (base: https://test-api.dropi.co o https://api.dropi.co):
 *   POST /api/login · GET /api/categories · POST crear producto · GET listar / ver producto
 *   Cabeceras habituales: Content-Type: application/json, Authorization: Bearer <token>
 *
 * --- Referencia UI Dropi "Crear producto" (para mapear en la Edge Function) ---
 * · Datos / General: nombre; opción nombre distinto para guía de envío; visibilidad catálogo
 *   Público vs Privado; medidas (peso kg, largo/ancho/alto cm); precio; precio sugerido;
 *   tipo (p. ej. SIMPLE); categoría Dropi; SKU opcional; descripción HTML/texto (en UI piden
 *   mínimo ~200 caracteres).
 * · Stock: cantidad (en pantalla indican que el DC puede controlar inventario).
 * · Imágenes: la interfaz pide al menos 3 imágenes; formatos .jpg/.jpeg/.png/.gif/.webp;
 *   tamaño máximo por archivo ~10MB (validar antes de subir o al pasar URL).
 * · Garantías: varios tipos (p. ej. envíos incompletos, mal funcionamiento, producto roto,
 *   daño transporte / orden distinto); cada uno: activo, plazo numérico, unidad (DIAS),
 *   texto observaciones/descripción. Suele poder definirse por defecto en API o valores fijos.
 * Lo que el ERP ya tiene (products, product_media, precio, etc.) puede no alcanzar: conviene
 * columnas o JSON en Supabase para peso/medidas/garantías por defecto si Dropi los exige.
 */
(function initDropiEndpoint() {
  const custom = String(window.DROPI_SYNC_ENDPOINT || '').trim();
  if (custom) return;
  const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
  if (base) {
    window.DROPI_SYNC_ENDPOINT = String(base).replace(/\/$/, '') + '/functions/v1/hera-dropi-sync';
  }
})();

window.DropiConfig = {
  CURRENCY: 'COP',
};

/**
 * Pide sincronizar un producto del ERP con Dropi vía Edge Function.
 * @param {string} productId - UUID en tabla `products`
 * @param {object} [extra] - Campos opcionales para la función (p. ej. acción futura)
 * @returns {Promise<object>}
 */
window.requestDropiSync = async function requestDropiSync(productId, extra) {
  if (!productId) return { skipped: true, reason: 'sin productId' };

  const payload = { productId };
  if (extra && typeof extra === 'object') Object.assign(payload, extra);

  const url = (window.DROPI_SYNC_ENDPOINT || '').trim();
  if (!url) return { skipped: true, reason: 'sin endpoint' };

  const anon = window.AppRepository?.SUPABASE_ANON_KEY;
  if (!anon || String(anon).trim() === '') {
    throw new Error(
      'Dropi: no hay SUPABASE_ANON_KEY (revisa que cargue src/js/modules/app/repository.js antes que dropi.js).',
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
      'Dropi: falló la llamada a la Edge Function (' + m + '). Si ves CORS o "Failed to fetch", revisa en Supabase → Edge Functions → políticas / dominio.',
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
    const detail = data.error && String(data.error).trim()
      ? String(data.error)
      : 'Dropi rechazó o no pudo procesar la solicitud';
    throw new Error(detail);
  }
  return data || { ok: true };
};
