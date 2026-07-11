/**
 * ERP ↔ WooCommerce pedidos → ventas_catalogo
 */
(function initWooCommerceOrdersIntegration(global) {
  function getSupabaseUrl() {
    return global.AppRepository?.SUPABASE_URL || 'https://niilaxdeetuzutycvdkz.supabase.co';
  }

  function endpointOrDefault() {
    const custom = String(global.WOOCOMMERCE_ORDER_ENDPOINT || '').trim();
    if (custom) return custom;
    return `${getSupabaseUrl()}/functions/v1/woocommerce-order-webhook`;
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
      } catch (_) {
        /* noop */
      }
    }
    return data?.session?.access_token || '';
  }

  async function callWooOrders(body) {
    const url = endpointOrDefault();
    const token = await getAccessToken();
    if (!token) {
      return { ok: false, skipped: true, reason: 'sin sesión Supabase (login requerido)' };
    }
    const anon = global.AppRepository?.SUPABASE_ANON_KEY;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (anon) headers.apikey = anon;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
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
      return { ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg), data };
    }
    if (data && data.ok === false) {
      return { ok: false, error: data.error || 'WooCommerce orders sync failed', data };
    }
    return { ok: true, data: data || { ok: true } };
  }

  /** Sincroniza últimos N pedidos WooCommerce → ventas_catalogo */
  global.requestWooCommerceSyncRecentOrders = async function requestWooCommerceSyncRecentOrders(limit = 20) {
    return callWooOrders({ action: 'sync_recent', limit });
  };

  /** Sincroniza un pedido WooCommerce por ID */
  global.requestWooCommerceSyncOrder = async function requestWooCommerceSyncOrder(orderId) {
    if (!orderId) return { ok: false, skipped: true, reason: 'sin order_id' };
    return callWooOrders({ action: 'sync', order_id: Number(orderId) });
  };

  global.getWooCommerceOrderEndpoint = endpointOrDefault;
})(window);
