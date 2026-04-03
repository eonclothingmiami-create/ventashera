// ERP → Catálogo mayoristas: sync + push, with idempotency (event_id).
(function initMayoristasCatalogIntegration(global) {
  function getSupabaseUrl() {
    return global.AppRepository?.SUPABASE_URL || 'https://niilaxdeetuzutycvdkz.supabase.co';
  }

  function endpointOrDefault(key, fnName) {
    const v = (global[key] || '').trim();
    if (v) return v;
    return `${getSupabaseUrl()}/functions/v1/${fnName}`;
  }

  function normImages(images) {
    if (!Array.isArray(images)) return [];
    const out = [];
    for (const x of images) {
      const s = String(x || '').trim();
      if (!s) continue;
      if (!out.includes(s)) out.push(s);
      if (out.length >= 15) break;
    }
    return out;
  }

  function b64url(bytes) {
    const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function sha256Base64UrlShort(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    const bytes = new Uint8Array(buf);
    return b64url(bytes).slice(0, 22); // short but collision-resistant enough for event ids
  }

  // "version_hash" basado SOLO en campos relevantes para notificar.
  async function buildEventId(product) {
    const pid = String(product?.id || '').trim();
    const relevant = {
      price: Number(product?.price ?? 0),
      stock: Number(product?.stock ?? 0),
      visible: !!product?.visible,
      active: product?.active !== false,
    };
    const versionHash = await sha256Base64UrlShort(JSON.stringify(relevant));
    return `catalog-publish-${pid}-${versionHash}`;
  }

  function pickProductPayload(product) {
    return {
      id: product.id,
      ref: product.ref,
      name: product.name,
      description: product.description || null,
      price: product.price,
      stock: product.stock,
      seccion: product.seccion || null,
      categoria: product.categoria || null,
      visible: !!product.visible,
      active: product.active !== false,
      updated_at: product.updated_at || new Date().toISOString(),
    };
  }

  async function getAccessToken() {
    if (!global.supabaseClient?.auth?.getSession) return '';
    const { data } = await global.supabaseClient.auth.getSession();
    return data?.session?.access_token || '';
  }

  /**
   * Publishes to mayoristas catalog (sync) and, if created/updated with relevant change, triggers FCM broadcast.
   * Returns { ok, sync, push? }.
   */
  global.mayoristasPublishCatalogProduct = async function ({
    product,
    images,
    notifyTitle,
    notifyBody,
    notifyLink,
    notifyImage,
  }) {
    const pushEnabled = global.CATALOG_PUSH_ENABLED !== false;
    const syncEndpoint = endpointOrDefault('MAYORISTAS_CATALOG_SYNC_ENDPOINT', 'catalog-sync-product');
    const pushEndpoint = endpointOrDefault('MAYORISTAS_CATALOG_PUSH_ENDPOINT', 'catalog-fcm-broadcast');

    const p = pickProductPayload(product);
    const img = normImages(images);
    const eventId = await buildEventId(p);
    const access = await getAccessToken();
    if (!access) return { ok: false, error: 'missing_session' };

    console.log(JSON.stringify({ event: 'sync_start', ts: new Date().toISOString(), event_id: eventId, product_id: p.id }));
    const syncResp = await fetch(syncEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
      body: JSON.stringify({ event_id: eventId, product: p, images: img }),
    });
    const syncJson = await syncResp.json().catch(() => ({}));
    if (!syncResp.ok || !syncJson?.ok) {
      console.log(JSON.stringify({ event: 'sync_fail', ts: new Date().toISOString(), event_id: eventId, product_id: p.id, error: syncJson?.error || 'sync_failed' }));
      return { ok: false, error: syncJson?.error || 'sync_failed', sync: syncJson };
    }

    const action = syncJson.action;
    const changedRelevant = !!syncJson.changedRelevant;
    const shouldNotify = pushEnabled && (action === 'created' || action === 'updated') && changedRelevant;

    if (!shouldNotify) {
      return { ok: true, sync: syncJson, push: { skipped: true, reason: pushEnabled ? 'noop_or_irrelevant' : 'disabled' } };
    }

    console.log(JSON.stringify({ event: 'notify_start', ts: new Date().toISOString(), event_id: eventId, product_id: p.id }));
    const pushResp = await fetch(pushEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
      body: JSON.stringify({
        event_id: eventId,
        product_id: p.id,
        ref: p.ref || null,
        name: p.name || null,
        price: p.price ?? null,
        stock: p.stock ?? null,
        visible: !!p.visible,
        image: notifyImage || (img[0] || ''),
        section: p.seccion || null,
        category: p.categoria || null,
        happened_at: new Date().toISOString(),
        title: notifyTitle || 'Nueva Colección 🌊',
        body: notifyBody || `"${p.name || p.ref || 'Producto'}" ya está disponible en el catálogo.`,
        link: notifyLink || (location.origin + location.pathname),
      }),
    });
    const pushJson = await pushResp.json().catch(() => ({}));
    if (!pushResp.ok || !pushJson?.ok) {
      console.log(JSON.stringify({ event: 'notify_fail', ts: new Date().toISOString(), event_id: eventId, product_id: p.id, error: pushJson?.error || 'push_failed' }));
      return { ok: false, error: pushJson?.error || 'push_failed', sync: syncJson, push: pushJson };
    }

    console.log(JSON.stringify({ event: pushJson?.dedup ? 'notify_dedup' : 'notify_sent', ts: new Date().toISOString(), event_id: eventId, product_id: p.id, sent: pushJson?.sent || 0, invalid: pushJson?.invalid || 0 }));
    return { ok: true, sync: syncJson, push: pushJson };
  };
})(window);

