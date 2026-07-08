// ERP → Catálogo mayoristas: sync + push (Smart Digest), con idempotencia (event_id).
(function initMayoristasCatalogIntegration(global) {
  const DEFAULT_CATALOG_URL = 'https://eonclothingonline.com/mayoristas/';

  function getSupabaseUrl() {
    return global.AppRepository?.SUPABASE_URL || 'https://niilaxdeetuzutycvdkz.supabase.co';
  }

  function catalogBaseUrl() {
    const v = String(global.HERA_CATALOG_BASE_URL || '').trim();
    if (v) return v.replace(/\/?$/, '/');
    return DEFAULT_CATALOG_URL;
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
    return b64url(bytes).slice(0, 22);
  }

  async function buildEventId(product, hints, images) {
    const pid = String(product?.id || '').trim();
    const img = normImages(images);
    const relevant = {
      price: Number(product?.price ?? 0),
      stock: Number(product?.stock ?? 0),
      visible: !!product?.visible,
      active: product?.active !== false,
      is_new: !!hints?.is_new,
      media_changed: !!hints?.media_changed,
      image_sig: img.length ? await sha256Base64UrlShort(img.join('|')) : '',
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

  function shouldNotifyFromHints(hints, visible) {
    if (!visible || !hints) return false;
    return !!(
      hints.is_new ||
      hints.media_changed ||
      hints.price_changed ||
      hints.stock_changed ||
      hints.visible_changed
    );
  }

  async function getAccessToken() {
    if (!global.supabaseClient?.auth?.getSession) return '';
    const { data } = await global.supabaseClient.auth.getSession();
    return data?.session?.access_token || '';
  }

  async function triggerPushDispatch(access) {
    const dispatchEndpoint = endpointOrDefault(
      'MAYORISTAS_CATALOG_DISPATCH_ENDPOINT',
      'catalog-push-dispatch',
    );
    const headers = { 'Content-Type': 'application/json' };
    if (access) headers.Authorization = `Bearer ${access}`;
    const resp = await fetch(dispatchEndpoint, { method: 'POST', headers, body: '{}' });
    const json = await resp.json().catch(() => ({}));
    return { ok: resp.ok && json?.ok !== false, status: resp.status, ...json };
  }

  async function broadcastFcmFallback(access, pushEndpoint, payload) {
    const resp = await fetch(pushEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
      body: JSON.stringify(payload),
    });
    const json = await resp.json().catch(() => ({}));
    return { ok: resp.ok && json?.ok !== false, status: resp.status, ...json };
  }

  /**
   * Publica en catálogo mayoristas y encola/envía push FCM.
   * Returns { ok, sync, push? }.
   */
  global.mayoristasPublishCatalogProduct = async function ({
    product,
    images,
    notifyHints,
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
    const hints = notifyHints || {};
    const eventId = await buildEventId(p, hints, img);
    const access = await getAccessToken();
    if (!access) return { ok: false, error: 'missing_session' };

    const link = notifyLink || catalogBaseUrl();
    const title = notifyTitle || 'Nueva Colección 🌊';
    const body = notifyBody || `"${p.name || p.ref || 'Producto'}" ya está disponible en el catálogo.`;
    const clientNotify = shouldNotifyFromHints(hints, p.visible);

    console.log(
      JSON.stringify({
        event: 'sync_start',
        ts: new Date().toISOString(),
        event_id: eventId,
        product_id: p.id,
        client_notify: clientNotify,
        notify_hints: hints,
      }),
    );

    const syncResp = await fetch(syncEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
      body: JSON.stringify({
        event_id: eventId,
        product: p,
        images: img,
        notify_hints: hints,
        notify_title: title,
        notify_body: body,
        notify_link: link,
      }),
    });
    const syncJson = await syncResp.json().catch(() => ({}));
    if (!syncResp.ok || !syncJson?.ok) {
      console.log(
        JSON.stringify({
          event: 'sync_fail',
          ts: new Date().toISOString(),
          event_id: eventId,
          product_id: p.id,
          error: syncJson?.error || 'sync_failed',
        }),
      );
      return { ok: false, error: syncJson?.error || 'sync_failed', sync: syncJson };
    }

    const serverNotify =
      !!syncJson.changedRelevant &&
      (syncJson.action === 'created' || syncJson.action === 'updated');
    const shouldNotify = pushEnabled && (clientNotify || serverNotify || !!syncJson.pushEnqueued);

    if (!shouldNotify) {
      return {
        ok: true,
        sync: syncJson,
        push: { skipped: true, reason: pushEnabled ? 'noop_or_irrelevant' : 'disabled' },
      };
    }

    if (syncJson.pushEnqueued) {
      console.log(
        JSON.stringify({
          event: 'notify_dispatch_start',
          ts: new Date().toISOString(),
          event_id: eventId,
          product_id: p.id,
        }),
      );
      const dispatchJson = await triggerPushDispatch(access);
      if (dispatchJson.ok) {
        const sent = Number(dispatchJson?.results?.[0]?.fcm?.sent ?? dispatchJson?.singles ?? 0);
        console.log(
          JSON.stringify({
            event: 'notify_sent',
            ts: new Date().toISOString(),
            event_id: eventId,
            product_id: p.id,
            mode: 'dispatch',
            sent,
          }),
        );
        return { ok: true, sync: syncJson, push: { mode: 'dispatch', ...dispatchJson } };
      }
      console.log(
        JSON.stringify({
          event: 'notify_dispatch_fail',
          ts: new Date().toISOString(),
          event_id: eventId,
          product_id: p.id,
          error: dispatchJson?.error || 'dispatch_failed',
        }),
      );
    }

    console.log(
      JSON.stringify({
        event: 'notify_broadcast_start',
        ts: new Date().toISOString(),
        event_id: eventId,
        product_id: p.id,
      }),
    );
    const pushJson = await broadcastFcmFallback(access, pushEndpoint, {
      title,
      body,
      link,
      exclude_token: '',
    });
    if (!pushJson.ok) {
      console.log(
        JSON.stringify({
          event: 'notify_fail',
          ts: new Date().toISOString(),
          event_id: eventId,
          product_id: p.id,
          error: pushJson?.error || 'push_failed',
        }),
      );
      return { ok: false, error: pushJson?.error || 'push_failed', sync: syncJson, push: pushJson };
    }

    console.log(
      JSON.stringify({
        event: 'notify_sent',
        ts: new Date().toISOString(),
        event_id: eventId,
        product_id: p.id,
        mode: 'broadcast',
        sent: pushJson?.sent || 0,
        invalid: pushJson?.failed ?? pushJson?.invalid ?? 0,
      }),
    );
    return { ok: true, sync: syncJson, push: { mode: 'broadcast', ...pushJson } };
  };
})(window);
