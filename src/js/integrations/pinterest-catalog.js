/**
 * Pinterest — catálogo (API v5 batch + opción fullSync / lote).
 * Token Pinterest solo en secrets de la Edge Function.
 *
 * Gateway Edge Functions: a veces 401 con JWT de sesión → forzamos anon en headers;
 * además se intenta supabase.functions.invoke y se cae a fetch.
 *
 * Endpoint: PINTEREST_CATALOG_SYNC_ENDPOINT o SUPABASE_URL + /functions/v1/pinterest-catalog-sync
 * Alias: PINTEREST_SYNC_ENDPOINT (compat ventashera-main)
 */
(function initPinterestCatalogEndpoint() {
  const customSync = String(window.PINTEREST_SYNC_ENDPOINT || '').trim();
  const customCat = String(window.PINTEREST_CATALOG_SYNC_ENDPOINT || '').trim();
  if (!customCat && customSync) {
    window.PINTEREST_CATALOG_SYNC_ENDPOINT = customSync;
  }
  const custom = String(window.PINTEREST_CATALOG_SYNC_ENDPOINT || '').trim();
  if (!custom) {
    const base = window.AppRepository && window.AppRepository.SUPABASE_URL;
    if (base) {
      window.PINTEREST_CATALOG_SYNC_ENDPOINT =
        String(base).replace(/\/$/, '') + '/functions/v1/pinterest-catalog-sync';
    }
  }
  if (window.PINTEREST_CATALOG_SYNC_ENDPOINT && !window.PINTEREST_SYNC_ENDPOINT) {
    window.PINTEREST_SYNC_ENDPOINT = window.PINTEREST_CATALOG_SYNC_ENDPOINT;
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

function formatHttpError(res, data, text) {
  let msg = (data && (data.msg || data.error || data.message)) || text || String(res.status);
  const pin = data && data.pinterest;
  if (pin && typeof pin === 'object' && pin.message != null) {
    msg = `${msg} — ${String(pin.message)}`;
  } else if (res.status === 401) {
    msg +=
      ' — Pinterest 401: token OAuth inválido/expirado o sin catalogs:write. ' +
      'Actualiza PINTEREST_ACCESS_TOKEN en Supabase. ' +
      'Si el cuerpo dice Invalid JWT: revisa anon key en repository.js.';
  }
  return typeof msg === 'string' ? msg : JSON.stringify(msg);
}

/**
 * @param {string} [productId] - UUID (omitir si extra.fullSync)
 * @param {{ method?: 'UPDATE'|'DELETE', fullSync?: boolean }} [extra]
 */
window.requestPinterestCatalogSync = async function requestPinterestCatalogSync(
  productId,
  extra,
) {
  const url = (
    window.PINTEREST_CATALOG_SYNC_ENDPOINT ||
    window.PINTEREST_SYNC_ENDPOINT ||
    ''
  ).trim();
  const fullSync = extra && extra.fullSync === true;
  if (!url || (!fullSync && !productId)) {
    return { skipped: true, reason: !url ? 'sin endpoint' : 'sin productId' };
  }

  const payload = {};
  if (fullSync) payload.fullSync = true;
  else payload.productId = productId;
  if (extra && typeof extra === 'object' && extra.method) {
    payload.method = extra.method;
  }

  const headers = anonOnlyHeaders();
  const client = window.AppRepository && window.AppRepository.supabaseClient;

  if (client && typeof client.functions?.invoke === 'function') {
    const { data: invData, error: invErr } = await client.functions.invoke(
      'pinterest-catalog-sync',
      {
        body: payload,
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
    throw new Error(formatHttpError(res, data, text));
  }
  throwIfOkFalse(data);
  return data || { ok: true };
};
