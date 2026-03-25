/**
 * Pinterest — catálogo comercial (Marketing API v5, batch items).
 * El token Pinterest solo vive en secrets de la Edge Function.
 *
 * Importante: el gateway de Edge Functions a veces rechaza (401) el JWT de **sesión**
 * del usuario cuando el proyecto usa JWT firmados con claves nuevas (ES256), aunque
 * "Verify JWT with legacy secret" esté OFF. Por eso aquí forzamos siempre el **anon key**
 * en Authorization + apikey (igual que un fetch público al proyecto).
 *
 * Endpoint: `PINTEREST_CATALOG_SYNC_ENDPOINT` o SUPABASE_URL + /functions/v1/pinterest-catalog-sync
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

const _FALLBACK_SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paWxheGRlZXR1enV0eWN2ZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjc0NjIsImV4cCI6MjA4ODk0MzQ2Mn0.GI8E7vRzxi5NumN_f4T432Lx4BcmgGLZo81BR9h3h8c';

function getAnonKey() {
  return (
    (window.AppRepository && window.AppRepository.SUPABASE_ANON_KEY) || _FALLBACK_SUPABASE_ANON
  );
}

/** Siempre anon: evita 401 en gateway con JWT de sesión (claves nuevas vs legacy). */
function anonOnlyHeaders() {
  const anon = getAnonKey();
  return {
    'Content-Type': 'application/json',
    apikey: anon,
    Authorization: 'Bearer ' + anon,
  };
}

function throwIfOkFalse(data) {
  if (data && data.ok === false) {
    const detail =
      data.error && String(data.error).trim()
        ? String(data.error)
        : 'Pinterest rechazó o no pudo procesar la solicitud';
    throw new Error(detail);
  }
}

/**
 * @param {string} productId - UUID en `products`
 * @returns {Promise<object>}
 */
window.requestPinterestCatalogSync = async function requestPinterestCatalogSync(productId) {
  const url = (window.PINTEREST_CATALOG_SYNC_ENDPOINT || '').trim();
  if (!url || !productId) {
    return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  }

  const headers = anonOnlyHeaders();
  const body = JSON.stringify({ productId });

  const client = window.AppRepository && window.AppRepository.supabaseClient;
  if (client && typeof client.functions?.invoke === 'function') {
    const { data: invData, error: invErr } = await client.functions.invoke(
      'pinterest-catalog-sync',
      {
        body: { productId },
        headers,
      },
    );
    if (!invErr) {
      throwIfOkFalse(invData);
      return invData || { ok: true };
    }
    const msg = invErr.message || String(invErr);
    if (!/401|unauthorized|jwt|invalid/i.test(msg)) {
      throw new Error(msg || 'Error al invocar pinterest-catalog-sync');
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  if (!res.ok) {
    const raw =
      (data && (data.msg || data.error || data.message)) || text || String(res.status);
    let out = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (res.status === 401) {
      out +=
        ' — Si el cuerpo dice Invalid JWT: copia de nuevo la anon key (Settings → API) en repository.js, o revisa rotación de JWT del proyecto.';
    }
    throw new Error(out);
  }

  throwIfOkFalse(data);
  return data || { ok: true };
};
