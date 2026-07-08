/**
 * ERP → WooCommerce: retirar producto de la tienda (papelera) al eliminar en ERP.
 * Usa la Edge Function `sync-product-to-woocommerce` con action=delete.
 * Gravity/Addi escucha publish → trash en WooCommerce y notifica ProductDeleted a Addi.
 */
(function initWooCommerceCatalogIntegration(global) {
  function getSupabaseUrl() {
    return global.AppRepository?.SUPABASE_URL || 'https://niilaxdeetuzutycvdkz.supabase.co';
  }

  function endpointOrDefault() {
    const custom = String(global.WOOCOMMERCE_SYNC_ENDPOINT || '').trim();
    if (custom) return custom;
    return `${getSupabaseUrl()}/functions/v1/sync-product-to-woocommerce`;
  }

  async function getAccessToken() {
    if (!global.supabaseClient?.auth?.getSession) return '';
    let { data } = await global.supabaseClient.auth.getSession();
    if (!data?.session?.access_token && global.supabaseClient.auth.refreshSession) {
      try {
        await global.supabaseClient.auth.refreshSession();
        ({ data } = await global.supabaseClient.auth.getSession());
      } catch (_) {
        /* noop */
      }
    }
    return data?.session?.access_token || '';
  }

  /**
   * Mueve a papelera el producto WooCommerce vinculado al id de fila en `products`.
   * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string, error?:string, data?:object}>}
   */
  global.requestWooCommerceDeleteProduct = async function requestWooCommerceDeleteProduct(productId) {
    if (!productId) return { ok: false, skipped: true, reason: 'sin productId' };

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
      body: JSON.stringify({ product_id: productId, action: 'delete' }),
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
      return { ok: false, error: data.error || 'WooCommerce rechazó el delete', data };
    }
    return { ok: true, data: data || { ok: true } };
  };
})(window);
