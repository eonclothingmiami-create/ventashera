/**
 * ERP → Redes sociales → Contenido (push editorial a PWA).
 */
(function initSocialContentModule(global) {
  const Api = () => global.SocialContentApi;
  let _ctx = null;
  let _editingId = null;
  let _existingThumbUrl = null;
  let _existingMediaUrl = null;
  let _subscriberCount = 0;
  let _productHits = [];

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTs(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return '—';
    }
  }

  function notify(msg, ok = true) {
    if (_ctx?.notify) _ctx.notify(msg, ok);
    else alert(msg);
  }

  function readForm() {
    const mediaType = document.getElementById('sc-media-type')?.value || 'text';
    const ctaType = document.getElementById('sc-cta-type')?.value || 'none';
    const title = String(document.getElementById('sc-title')?.value || '').trim();
    const excerpt = String(document.getElementById('sc-excerpt')?.value || '').trim();
    const bodyHtml = String(document.getElementById('sc-body')?.value || '').trim();
    const externalLink = String(document.getElementById('sc-external-link')?.value || '').trim();
    const productRef = String(document.getElementById('sc-product-ref')?.value || '').trim();
    const productId = String(document.getElementById('sc-product-id')?.value || '').trim();

    return {
      title,
      excerpt,
      body_html: bodyHtml || null,
      media_type: mediaType,
      external_link: externalLink || null,
      cta_type: ctaType,
      cta_product_id: ctaType === 'product' && productId ? productId : null,
      cta_product_ref: ctaType === 'product' && productRef ? productRef : null,
    };
  }

  function validateForm(row) {
    if (!row.title) return 'El título es obligatorio (notificación).';
    if (row.media_type === 'text' && !row.excerpt && !row.body_html) {
      return 'Para solo texto, escribe un mensaje en extracto o cuerpo.';
    }
    if (row.media_type === 'image' && !document.getElementById('sc-file-image')?.files?.[0] && !_existingMediaUrl) {
      return 'Sube una imagen o edita una publicación que ya tenga imagen.';
    }
    if (row.media_type === 'video') {
      const hasThumbFile = !!document.getElementById('sc-file-thumb')?.files?.[0];
      if (!hasThumbFile && !_existingThumbUrl) return 'El video requiere miniatura (thumbnail).';
      if (!document.getElementById('sc-file-video')?.files?.[0] && !_existingMediaUrl) {
        return 'Sube un video o edita una publicación que ya tenga video.';
      }
    }
    if (row.media_type === 'link' && !row.external_link && row.cta_type === 'none') {
      return 'Tipo link: indica enlace externo o CTA catálogo/producto.';
    }
    if (row.cta_type === 'product' && !row.cta_product_id) {
      return 'Selecciona un producto para el CTA.';
    }
    if (row.cta_type === 'external' && !row.external_link) {
      return 'CTA externo requiere URL.';
    }
    return null;
  }

  async function uploadPendingFiles(postId) {
    const api = Api();
    const patch = {};

    const img = document.getElementById('sc-file-image')?.files?.[0];
    const vid = document.getElementById('sc-file-video')?.files?.[0];
    const thumb = document.getElementById('sc-file-thumb')?.files?.[0];
    const mediaType = document.getElementById('sc-media-type')?.value;

    if (mediaType === 'image' && img) {
      const webp = await api.compressToWebP(img);
      patch.media_url = await api.uploadContentFile(postId, webp, 'image');
      patch.thumb_url = patch.media_url;
    }
    if (mediaType === 'video') {
      if (vid) {
        if (vid.size > 30 * 1024 * 1024) throw new Error('Video máximo 30 MB');
        patch.media_url = await api.uploadContentFile(postId, vid, 'video');
      }
      if (thumb) {
        const webp = await api.compressToWebP(thumb);
        patch.thumb_url = await api.uploadContentFile(postId, webp, 'thumb');
      }
    }
    if (mediaType === 'text' && thumb) {
      const webp = await api.compressToWebP(thumb);
      patch.thumb_url = await api.uploadContentFile(postId, webp, 'thumb');
    }

    return patch;
  }

  async function saveDraft() {
    try {
      const row = readForm();
      const err = validateForm(row);
      if (err) {
        notify(err, false);
        return;
      }
      row.status = 'draft';
      row.push_status = 'none';
      let post = await Api().savePost(row, _editingId);
      const mediaPatch = await uploadPendingFiles(post.id);
      if (Object.keys(mediaPatch).length) {
        post = await Api().savePost({ ...mediaPatch, updated_at: new Date().toISOString() }, post.id);
      }
      _editingId = post.id;
      _existingThumbUrl = post.thumb_url || mediaPatch.thumb_url || _existingThumbUrl;
      _existingMediaUrl = post.media_url || mediaPatch.media_url || _existingMediaUrl;
      notify('Borrador guardado');
      await renderList();
      updatePreview(post);
    } catch (e) {
      notify(e?.message || 'Error al guardar', false);
    }
  }

  async function publishOnly() {
    try {
      await saveDraft();
      if (!_editingId) return;
      await Api().publishPost(_editingId, { sendPush: false });
      notify('Publicado en catálogo (sin push)');
      await renderList();
    } catch (e) {
      notify(e?.message || 'Error al publicar', false);
    }
  }

  async function publishAndPush() {
    try {
      await saveDraft();
      if (!_editingId) return;
      const n = _subscriberCount || (await Api().countPushSubscribers());
      const ok = confirm(
        `Se enviará una notificación push a aproximadamente ${n} dispositivos con la app.\n\n¿Continuar?`,
      );
      if (!ok) return;
      const res = await Api().publishPost(_editingId, { sendPush: true });
      const sent = res?.push?.sent ?? 0;
      notify(`Publicado y enviado a ${sent} dispositivos`);
      await renderList();
    } catch (e) {
      const msg = e?.message === 'daily_push_limit' ? 'Límite diario alcanzado (3 pushes/día)' : e?.message;
      notify(msg || 'Error en push', false);
    }
  }

  async function loadPost(id) {
    const post = await Api().getPost(id);
    if (!post) return;
    _editingId = post.id;
    _existingThumbUrl = post.thumb_url || null;
    _existingMediaUrl = post.media_url || null;
    document.getElementById('sc-title').value = post.title || '';
    document.getElementById('sc-excerpt').value = post.excerpt || '';
    document.getElementById('sc-body').value = post.body_html || '';
    document.getElementById('sc-media-type').value = post.media_type || 'text';
    document.getElementById('sc-cta-type').value = post.cta_type || 'none';
    document.getElementById('sc-external-link').value = post.external_link || '';
    document.getElementById('sc-product-id').value = post.cta_product_id || '';
    document.getElementById('sc-product-ref').value = post.cta_product_ref || '';
    syncMediaFields();
    syncCtaFields();
    updatePreview(post);
  }

  function newPost() {
    _editingId = null;
    _existingThumbUrl = null;
    _existingMediaUrl = null;
    ['sc-title', 'sc-excerpt', 'sc-body', 'sc-external-link', 'sc-product-id', 'sc-product-ref'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      },
    );
    document.getElementById('sc-media-type').value = 'text';
    document.getElementById('sc-cta-type').value = 'catalog';
    syncMediaFields();
    syncCtaFields();
    updatePreview({ title: 'Hera Swimwear', excerpt: 'Tu mensaje aquí…', media_type: 'text' });
  }

  function syncMediaFields() {
    const mt = document.getElementById('sc-media-type')?.value || 'text';
    const imgRow = document.getElementById('sc-row-image');
    const vidRow = document.getElementById('sc-row-video');
    const thumbRow = document.getElementById('sc-row-thumb');
    if (imgRow) imgRow.style.display = mt === 'image' ? '' : 'none';
    if (vidRow) vidRow.style.display = mt === 'video' ? '' : 'none';
    if (thumbRow) thumbRow.style.display = mt === 'video' || mt === 'text' ? '' : 'none';
  }

  function syncCtaFields() {
    const ct = document.getElementById('sc-cta-type')?.value || 'none';
    const prodRow = document.getElementById('sc-row-product');
    const extRow = document.getElementById('sc-row-external');
    if (prodRow) prodRow.style.display = ct === 'product' ? '' : 'none';
    if (extRow) extRow.style.display = ct === 'external' || document.getElementById('sc-media-type')?.value === 'link' ? '' : 'none';
  }

  function updatePreview(post) {
    const box = document.getElementById('sc-push-preview');
    if (!box) return;
    const title = post?.title || 'Hera Swimwear';
    const body = post?.excerpt || '';
    const img = post?.thumb_url || post?.media_url || '';
    box.innerHTML = `
      <div style="border:1px solid var(--border);border-radius:12px;padding:12px;max-width:320px;background:var(--surface)">
        <div style="font-size:10px;color:var(--text2);margin-bottom:6px">Vista notificación</div>
        <strong style="font-size:13px">${esc(title)}</strong>
        <p style="font-size:12px;margin:6px 0 0;color:var(--text2)">${esc(body)}</p>
        ${img ? `<img src="${esc(img)}" alt="" style="width:100%;margin-top:8px;border-radius:8px;max-height:120px;object-fit:cover">` : ''}
      </div>`;
  }

  async function renderList() {
    const el = document.getElementById('sc-posts-list');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text2);padding:8px">Cargando…</div>';
    try {
      const rows = await Api().listPosts({ limit: 40 });
      if (!rows.length) {
        el.innerHTML = '<div style="color:var(--text2);padding:8px">Sin publicaciones aún.</div>';
        return;
      }
      el.innerHTML = `
        <table class="data-table" style="width:100%;font-size:12px">
          <thead><tr>
            <th>Título</th><th>Tipo</th><th>Estado</th><th>Push</th><th>Fecha</th><th></th>
          </tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `<tr>
              <td>${esc(r.title)}</td>
              <td>${esc(r.media_type)}</td>
              <td>${esc(r.status)}</td>
              <td>${esc(r.push_status)}${r.push_sent_count ? ` (${r.push_sent_count})` : ''}</td>
              <td>${esc(fmtTs(r.updated_at))}</td>
              <td><button type="button" class="btn btn-secondary btn-sm" onclick="scEditPost('${r.id}')">Editar</button></td>
            </tr>`,
              )
              .join('')}
          </tbody>
        </table>`;
    } catch (e) {
      el.innerHTML = `<div style="color:var(--danger)">${esc(e.message)}</div>`;
    }
  }

  async function searchProduct() {
    const q = document.getElementById('sc-product-search')?.value || '';
    const box = document.getElementById('sc-product-results');
    if (!box) return;
    try {
      const rows = await Api().searchProducts(q);
      _productHits = rows;
      if (!rows.length) {
        box.innerHTML = '<div style="font-size:11px;color:var(--text2)">Sin resultados</div>';
        return;
      }
      box.innerHTML = rows
        .map(
          (p) =>
            `<button type="button" class="btn btn-secondary btn-sm" style="margin:2px" onclick="scPickProduct('${p.id}')">${esc(p.ref)} — ${esc(p.name)}</button>`,
        )
        .join('');
    } catch (e) {
      box.innerHTML = esc(e.message);
    }
  }

  function renderSocialContenido(ctx) {
    _ctx = ctx;
    const el = document.getElementById('social_contenido-content');
    if (!el) return;

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">📱 Contenido → Push PWA</div>
        <p style="font-size:12px;color:var(--text2);margin:0 0 12px">
          Publica texto, imagen, video o enlace para clientas con la app instalada.
          Límite: <strong>3 pushes editoriales por día</strong>. Los pushes de producto del catálogo no cuentan aquí.
        </p>
        <p id="sc-subscriber-hint" style="font-size:11px;color:var(--text2)">Suscriptores: …</p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start">
        <div class="card">
          <div class="card-title">Nueva publicación</div>
          <label class="form-label">Título (notificación)</label>
          <input id="sc-title" class="form-input" maxlength="80" placeholder="Ej: Nueva colección verano">
          <label class="form-label">Extracto (cuerpo de la notificación)</label>
          <textarea id="sc-excerpt" class="form-input" rows="2" maxlength="240" placeholder="Mensaje corto que verán en el push"></textarea>
          <label class="form-label">Cuerpo extendido (landing, opcional)</label>
          <textarea id="sc-body" class="form-input" rows="4" placeholder="Texto adicional en la página de contenido"></textarea>
          <label class="form-label">Tipo de contenido</label>
          <select id="sc-media-type" class="form-input" onchange="scSyncMedia()">
            <option value="text">Solo texto</option>
            <option value="image">Imagen (+ texto opcional)</option>
            <option value="video">Video (+ miniatura obligatoria)</option>
            <option value="link">Enlace destacado</option>
          </select>
          <div id="sc-row-image" style="display:none;margin-top:8px">
            <label class="form-label">Imagen</label>
            <input type="file" id="sc-file-image" accept="image/*" class="form-input">
          </div>
          <div id="sc-row-video" style="display:none;margin-top:8px">
            <label class="form-label">Video (MP4, máx 30MB)</label>
            <input type="file" id="sc-file-video" accept="video/mp4,video/*" class="form-input">
          </div>
          <div id="sc-row-thumb" style="display:none;margin-top:8px">
            <label class="form-label">Miniatura (obligatoria para video; opcional para texto)</label>
            <input type="file" id="sc-file-thumb" accept="image/*" class="form-input">
          </div>
          <label class="form-label" style="margin-top:12px">CTA al abrir la publicación</label>
          <select id="sc-cta-type" class="form-input" onchange="scSyncCta()">
            <option value="none">Solo ver contenido</option>
            <option value="catalog">Ir al catálogo</option>
            <option value="product">Ir a un producto</option>
            <option value="external">Enlace externo</option>
          </select>
          <div id="sc-row-product" style="display:none;margin-top:8px">
            <label class="form-label">Buscar producto</label>
            <input id="sc-product-search" class="form-input" placeholder="Ref o nombre" oninput="scSearchProduct()">
            <input type="hidden" id="sc-product-id">
            <input type="hidden" id="sc-product-ref">
            <div id="sc-product-results" style="margin-top:6px"></div>
          </div>
          <div id="sc-row-external" style="margin-top:8px">
            <label class="form-label">URL externa</label>
            <input id="sc-external-link" class="form-input" placeholder="https://instagram.com/...">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
            <button type="button" class="btn btn-secondary" onclick="scSaveDraft()">Guardar borrador</button>
            <button type="button" class="btn btn-secondary" onclick="scPublishOnly()">Publicar sin push</button>
            <button type="button" class="btn btn-primary" onclick="scPublishPush()">Publicar + notificar</button>
            <button type="button" class="btn btn-secondary" onclick="scNewPost()">Nuevo</button>
          </div>
        </div>
        <div>
          <div class="card" style="margin-bottom:12px">
            <div class="card-title">Preview push</div>
            <div id="sc-push-preview"></div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-title">Historial</div>
        <div id="sc-posts-list"></div>
      </div>`;

    ['sc-title', 'sc-excerpt'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => updatePreview(readForm()));
    });
    document.getElementById('sc-media-type')?.addEventListener('change', () => {
      syncMediaFields();
      syncCtaFields();
    });

    Api()
      .countPushSubscribers()
      .then((n) => {
        _subscriberCount = n;
        const hint = document.getElementById('sc-subscriber-hint');
        if (hint) hint.textContent = `Suscriptores push actuales: ~${n} dispositivos`;
      })
      .catch(() => {});

    newPost();
    renderList();
  }

  global.scSyncMedia = syncMediaFields;
  global.scSyncCta = syncCtaFields;
  global.scSaveDraft = saveDraft;
  global.scPublishOnly = publishOnly;
  global.scPublishPush = publishAndPush;
  global.scNewPost = newPost;
  global.scEditPost = (id) => loadPost(id);
  global.scSearchProduct = searchProduct;
  global.scPickProduct = (id) => {
    const p = _productHits.find((x) => x.id === id);
    document.getElementById('sc-product-id').value = id;
    document.getElementById('sc-product-ref').value = p?.ref || '';
    document.getElementById('sc-product-results').innerHTML = `<span style="font-size:11px">Seleccionado: ${esc(p?.ref || id)}</span>`;
  };

  global.AppSocialContentModule = { renderSocialContenido };
})(window);
