/**
 * ERP → pedidos ML / Faire / eBay → ventas_catalogo
 */
(function initMarketplaceOrdersIntegration(global) {
  function getSupabaseUrl() {
    return global.AppRepository?.SUPABASE_URL || 'https://niilaxdeetuzutycvdkz.supabase.co';
  }

  function endpointOrDefault() {
    const custom = String(global.MARKETPLACE_ORDERS_ENDPOINT || '').trim();
    if (custom) return custom;
    return `${getSupabaseUrl()}/functions/v1/marketplace-orders-sync`;
  }

  async function getAccessToken() {
    const client = global.supabaseClient || global.AppRepository?.supabaseClient;
    if (global.AuthSession?.getValidAccessToken && client) {
      return (await global.AuthSession.getValidAccessToken(client)) || '';
    }
    if (!client?.auth?.getSession) return '';
    let { data } = await client.auth.getSession();
    if (!data?.session?.access_token && client.auth.refreshSession) {
      try {
        await client.auth.refreshSession();
        ({ data } = await client.auth.getSession());
      } catch (_) { /* noop */ }
    }
    return data?.session?.access_token || '';
  }

  async function callSync(body) {
    const url = endpointOrDefault();
    const token = await getAccessToken();
    if (!token) return { ok: false, skipped: true, reason: 'sin sesión Supabase' };
    const anon = global.AppRepository?.SUPABASE_ANON_KEY;
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    if (anon) headers.apikey = anon;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!res.ok || (data && data.ok === false)) {
      const msg = (data && (data.error || data.message)) || text || String(res.status);
      return { ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    return { ok: true, data: data || { ok: true } };
  }

  global.requestMarketplaceOrdersSync = function requestMarketplaceOrdersSync(limit) {
    return callSync({ action: 'sync_all', limit: limit || 30 });
  };
  global.getMarketplaceOrdersEndpoint = endpointOrDefault;
})(window);
