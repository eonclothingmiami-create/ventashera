/**
 * Gestión centralizada de sesión Supabase para el ERP.
 * - Obtiene access tokens válidos (refresh antes de expirar).
 * - Reintenta fetch REST en 401 tras refreshSession().
 * - Refresh proactivo para apps de larga duración sin cierre.
 */
(function initAuthSession(global) {
  /** Renovar si faltan menos de N segundos para expirar el JWT. */
  const REFRESH_MARGIN_SEC = 120;
  /** Intervalo de comprobación de expiración (app abierta días). */
  const PROACTIVE_CHECK_MS = 4 * 60 * 1000;

  let onSessionInvalid = null;
  let proactiveTimer = null;
  let invalidNotified = false;

  function decodeJwtExp(accessToken) {
    if (!accessToken || typeof accessToken !== 'string') return null;
    try {
      const part = accessToken.split('.')[1];
      if (!part) return null;
      const padLen = (4 - (part.length % 4)) % 4;
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
      const payload = JSON.parse(atob(b64));
      const exp = Number(payload.exp);
      return Number.isFinite(exp) ? exp : null;
    } catch (_) {
      return null;
    }
  }

  function isTokenExpiredOrSoon(accessToken, marginSec) {
    const exp = decodeJwtExp(accessToken);
    if (!exp) return true;
    const margin = Number.isFinite(marginSec) ? marginSec : REFRESH_MARGIN_SEC;
    return Date.now() / 1000 >= exp - margin;
  }

  function notifySessionInvalid(reason) {
    if (invalidNotified) return;
    invalidNotified = true;
    try {
      if (typeof onSessionInvalid === 'function') onSessionInvalid(reason || 'invalid');
    } catch (e) {
      console.error('[AuthSession] onSessionInvalid error:', e);
    }
  }

  function resetInvalidGate() {
    invalidNotified = false;
  }

  /**
   * Devuelve un access_token listo para REST/Edge, o null si no hay sesión renovable.
   * @param {import('@supabase/supabase-js').SupabaseClient|null} client
   * @param {{ forceRefresh?: boolean }} [opts]
   */
  async function getValidAccessToken(client, opts) {
    const forceRefresh = !!(opts && opts.forceRefresh);
    if (!client?.auth?.getSession) return null;

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      console.warn('[AuthSession] getSession:', sessionError.message || sessionError);
      return null;
    }

    const session = sessionData?.session;
    if (!session?.access_token) return null;

    if (!forceRefresh && !isTokenExpiredOrSoon(session.access_token, REFRESH_MARGIN_SEC)) {
      return session.access_token;
    }

    if (!client.auth.refreshSession) return session.access_token;

    const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
    if (refreshError) {
      console.warn('[AuthSession] refreshSession:', refreshError.message || refreshError);
      notifySessionInvalid('refresh_failed');
      return null;
    }

    const token = refreshed?.session?.access_token;
    if (!token) {
      notifySessionInvalid('refresh_failed');
      return null;
    }

    resetInvalidGate();
    return token;
  }

  /**
   * Bearer para cabeceras: JWT de usuario si hay sesión válida; si no, anon key.
   */
  async function getAuthBearer(client, anonKey, opts) {
    const token = await getValidAccessToken(client, opts);
    return token || anonKey;
  }

  function isAuthHttpStatus(status) {
    return status === 401 || status === 403;
  }

  function isAuthErrorMessage(message) {
    const s = String(message || '').toLowerCase();
    return (
      s.includes('jwt') ||
      s.includes('401') ||
      s.includes('403') ||
      s.includes('unauthorized') ||
      s.includes('invalid claim') ||
      s.includes('token expired') ||
      s.includes('session not found')
    );
  }

  /**
   * fetch() con Authorization renovada y un reintento en 401.
   */
  async function fetchWithAuth(client, anonKey, url, init, opts) {
    const extraHeaders = (init && init.headers) || {};
    const forceFirst = !!(opts && opts.forceRefresh);

    async function doFetch(forceRefresh) {
      const bearer = await getAuthBearer(client, anonKey, { forceRefresh });
      const headers = {
        apikey: anonKey,
        Authorization: 'Bearer ' + bearer,
        ...extraHeaders,
      };
      return fetch(url, { ...init, headers });
    }

    let resp = await doFetch(forceFirst);
    if (isAuthHttpStatus(resp.status)) {
      const retryResp = await doFetch(true);
      if (!isAuthHttpStatus(retryResp.status)) return retryResp;
      notifySessionInvalid('http_' + retryResp.status);
      return retryResp;
    }
    return resp;
  }

  function scheduleProactiveRefresh(client) {
    if (proactiveTimer) clearInterval(proactiveTimer);
    if (!client?.auth) return;

    proactiveTimer = setInterval(async () => {
      try {
        const { data: { session } } = await client.auth.getSession();
        if (!session?.access_token) return;
        if (isTokenExpiredOrSoon(session.access_token, 300)) {
          const token = await getValidAccessToken(client, { forceRefresh: true });
          if (!token) notifySessionInvalid('proactive_refresh_failed');
        }
      } catch (e) {
        console.warn('[AuthSession] proactive check:', e);
      }
    }, PROACTIVE_CHECK_MS);
  }

  function stopProactiveRefresh() {
    if (proactiveTimer) {
      clearInterval(proactiveTimer);
      proactiveTimer = null;
    }
  }

  global.AuthSession = {
    getValidAccessToken,
    getAuthBearer,
    fetchWithAuth,
    isAuthHttpStatus,
    isAuthErrorMessage,
    scheduleProactiveRefresh,
    stopProactiveRefresh,
    resetInvalidGate,
    setOnSessionInvalid(fn) {
      onSessionInvalid = typeof fn === 'function' ? fn : null;
    },
  };
})(window);
