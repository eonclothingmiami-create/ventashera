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

  function withPushUtm(link, campaignId) {
    const base = catalogBaseUrl();
    try {
      const u = new URL(String(link || '').trim() || base, base);
      u.searchParams.set('utm_source', 'push');
      u.searchParams.set('utm_medium', 'fcm');
      if (campaignId) u.searchParams.set('utm_campaign', String(campaignId));
      return u.toString();
    } catch (_) {
      return base;
    }
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

  function normColorCovers(colorCovers) {
    if (!Array.isArray(colorCovers)) return [];
    const out = [];
    for (const row of colorCovers) {
      const color = String(row?.color || '').trim();
      const url = String(row?.url || '').trim();
      if (!color || !url) continue;
      if (out.some((x) => x.color === color)) continue;
      out.push({ color, url });
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

  async function buildEventId(product, hints, images, colorCovers) {
    const pid = String(product?.id || '').trim();
    const img = normImages(images);
    const covers = normColorCovers(colorCovers);
    const relevant = {
      price: Number(product?.price ?? 0),
      stock: Number(product?.stock ?? 0),
      visible: !!product?.visible,
      active: product?.active !== false,
      is_new: !!hints?.is_new,
      media_changed: !!hints?.media_changed,
      color_covers_changed: !!hints?.color_covers_changed,
      image_sig: img.length ? await sha256Base64UrlShort(img.join('|')) : '',
      color_covers_sig: covers.length
        ? await sha256Base64UrlShort(covers.map((c) => `${c.color}:${c.url}`).join('|'))
        : '',
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
      hints.color_covers_changed ||
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

  /**
   * Publica en catálogo mayoristas y encola/envía push FCM.
   * Returns { ok, sync, push? }.
   */
  global.mayoristasPublishCatalogProduct = async function ({
    product,
    images,
    color_covers,
    notifyHints,
    notifyTitle,
    notifyBody,
    notifyLink,
    notifyImage,
  }) {
    const pushEnabled = global.CATALOG_PUSH_ENABLED !== false;
    const syncEndpoint = endpointOrDefault('MAYORISTAS_CATALOG_SYNC_ENDPOINT', 'catalog-sync-product');

    const p = pickProductPayload(product);
    const img = normImages(images);
    const covers = normColorCovers(color_covers);
    const hints = notifyHints || {};
    const eventId = await buildEventId(p, hints, img, covers);
    const access = await getAccessToken();
    if (!access) return { ok: false, error: 'missing_session' };

    const link = withPushUtm(notifyLink || catalogBaseUrl(), eventId);
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
        color_covers: covers,
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

    const shouldDispatch = pushEnabled && !!syncJson.pushEnqueued;

    if (!shouldDispatch) {
      return {
        ok: true,
        sync: syncJson,
        push: { skipped: true, reason: pushEnabled ? 'noop_or_irrelevant' : 'disabled' },
      };
    }

    console.log(
      JSON.stringify({
        event: 'notify_dispatch_start',
        ts: new Date().toISOString(),
        event_id: eventId,
        product_id: p.id,
        push_enqueued: !!syncJson.pushEnqueued,
      }),
    );
    const dispatchJson = await triggerPushDispatch(access);
    if (dispatchJson.ok) {
      const sent = Number(
        dispatchJson?.digests > 0 || dispatchJson?.singles > 0
          ? (dispatchJson.results || []).reduce(
              (acc, r) => acc + (Number(r?.fcm?.sent) || 0),
              0,
            ) || dispatchJson.singles || 0
          : 0,
      );
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
    return {
      ok: true,
      sync: syncJson,
      push: {
        mode: 'dispatch',
        queued: !!syncJson.pushEnqueued,
        error: dispatchJson?.error || 'dispatch_failed',
        ...dispatchJson,
      },
    };
  };
})(window);
