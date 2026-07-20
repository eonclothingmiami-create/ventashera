/**
 * ERP → Redes sociales → Contenido (push editorial a PWA).
 */
(function initSocialContentModule(global) {
  const Api = () => global.SocialContentApi;
  const DEFAULT_WA = '573244389873';
  let _ctx = null;
  let _editingId = null;
  let _existingThumbUrl = null;
  let _existingMediaUrl = null;
  let _subscriberCount = 0;
  let _productHits = [];
  let _productHits2 = [];

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

  function normalizeWa(raw) {
    return String(raw || '').replace(/\D/g, '');
  }

  function ctaOptionHtml(selected) {
    const opts = [
      ['none', 'Solo ver contenido'],
      ['catalog', 'Ir al catálogo'],
      ['product', 'Ir a un producto'],
      ['whatsapp', 'WhatsApp'],
      ['external', 'Enlace externo'],
    ];
    return opts
      .map(([v, label]) => `<option value="${v}"${selected === v ? ' selected' : ''}>${label}</option>`)
      .join('');
  }

  function readCtaSlot(slot) {
    const sfx = slot === 2 ? '-2' : '';
    const ctaType = document.getElementById(`sc-cta-type${sfx}`)?.value || 'none';
    const productRef = String(document.getElementById(`sc-product-ref${sfx}`)?.value || '').trim();
    const productId = String(document.getElementById(`sc-product-id${sfx}`)?.value || '').trim();
    const externalLink = String(document.getElementById(`sc-external-link${sfx}`)?.value || '').trim();
    const whatsapp = normalizeWa(document.getElementById(`sc-whatsapp${sfx}`)?.value || '');

    return {
      cta_type: ctaType,
      cta_product_id: ctaType === 'product' && productId ? productId : null,
      cta_product_ref: ctaType === 'product' && productRef ? productRef : null,
      external_link: slot === 1 && ctaType === 'external' ? externalLink || null : undefined,
      cta_external_link_2: slot === 2 && ctaType === 'external' ? externalLink || null : undefined,
      cta_whatsapp_number: slot === 1 && ctaType === 'whatsapp' ? whatsapp || null : undefined,
      cta_whatsapp_number_2: slot === 2 && ctaType === 'whatsapp' ? whatsapp || null : undefined,
    };
  }

  function readForm() {
    const mediaType = document.getElementById('sc-media-type')?.value || 'text';
    const title = String(document.getElementById('sc-title')?.value || '').trim();
    const excerpt = String(document.getElementById('sc-excerpt')?.value || '').trim();
    const bodyHtml = String(document.getElementById('sc-body')?.value || '').trim();
    const linkUrl = String(document.getElementById('sc-link-url')?.value || '').trim();
    const cta1 = readCtaSlot(1);
    const cta2 = readCtaSlot(2);

    const row = {
      title,
      excerpt,
      body_html: bodyHtml || null,
      media_type: mediaType,
      cta_type: cta1.cta_type,
      cta_product_id: cta1.cta_product_id,
      cta_product_ref: cta1.cta_product_ref,
      cta_type_2: cta2.cta_type,
      cta_product_id_2: cta2.cta_product_id,
      cta_product_ref_2: cta2.cta_product_ref,
    };

    if (mediaType === 'link') row.external_link = linkUrl || null;
    else if (cta1.cta_type === 'external') row.external_link = cta1.external_link || null;
    else row.external_link = null;

    row.cta_whatsapp_number = cta1.cta_type === 'whatsapp' ? cta1.cta_whatsapp_number : null;
    row.cta_whatsapp_number_2 = cta2.cta_type === 'whatsapp' ? cta2.cta_whatsapp_number_2 : null;
    row.cta_external_link_2 = cta2.cta_type === 'external' ? cta2.cta_external_link_2 || null : null;

    return row;
  }

  function validateCtaSlot(row, slot) {
    const sfx = slot === 2 ? ' 2' : '';
    const type = slot === 2 ? row.cta_type_2 : row.cta_type;
    if (!type || type === 'none') return null;
    if (type === 'product') {
      const pid = slot === 2 ? row.cta_product_id_2 : row.cta_product_id;
      const pref = slot === 2 ? row.cta_product_ref_2 : row.cta_product_ref;
      if (!pid) return `Selecciona un producto para el CTA${sfx}.`;
      if (!pref || !/^HERA-/i.test(String(pref))) {
        return `CTA${sfx}: el producto debe tener ref HERA-* (vuelve a buscar y seleccionar).`;
      }
    }
    if (type === 'external') {
      const url = slot === 2 ? row.cta_external_link_2 : row.external_link;
      if (!url) return `CTA${sfx} externo requiere URL.`;
    }
    if (type === 'whatsapp') {
      const wa = slot === 2 ? row.cta_whatsapp_number_2 : row.cta_whatsapp_number;
      if (!normalizeWa(wa)) return `CTA${sfx} WhatsApp requiere número (ej. ${DEFAULT_WA}).`;
    }
    return null;
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
    if (
      row.media_type === 'link' &&
      !row.external_link &&
      row.cta_type === 'none' &&
      row.cta_type_2 === 'none'
    ) {
      return 'Tipo link: indica enlace del contenido o al menos un CTA.';
    }
    return validateCtaSlot(row, 1) || validateCtaSlot(row, 2);
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
      try {
        await Api().syncEditorialKnowledge();
      } catch (_) {
        /* noop */
      }
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
      try {
        await Api().syncEditorialKnowledge();
      } catch (_) {
        /* noop */
      }
      const sent = res?.push?.sent ?? 0;
      notify(`Publicado y enviado a ${sent} dispositivos`);
      await renderList();
    } catch (e) {
      const msg = e?.message === 'daily_push_limit' ? 'Límite diario alcanzado (3 pushes/día)' : e?.message;
      notify(msg || 'Error en push', false);
    }
  }

  function fillCtaSlot(post, slot) {
    const sfx = slot === 2 ? '-2' : '';
    const type = slot === 2 ? post.cta_type_2 : post.cta_type;
    document.getElementById(`sc-cta-type${sfx}`).value = type || 'none';
    document.getElementById(`sc-product-id${sfx}`).value =
      (slot === 2 ? post.cta_product_id_2 : post.cta_product_id) || '';
    document.getElementById(`sc-product-ref${sfx}`).value =
      (slot === 2 ? post.cta_product_ref_2 : post.cta_product_ref) || '';
    document.getElementById(`sc-external-link${sfx}`).value =
      slot === 2 ? post.cta_external_link_2 || '' : post.cta_type === 'external' ? post.external_link || '' : '';
    document.getElementById(`sc-whatsapp${sfx}`).value =
      (slot === 2 ? post.cta_whatsapp_number_2 : post.cta_whatsapp_number) || '';
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
    document.getElementById('sc-link-url').value = post.media_type === 'link' ? post.external_link || '' : '';
    fillCtaSlot(post, 1);
    fillCtaSlot(post, 2);
    syncMediaFields();
    syncCtaFields();
    updatePreview(post);
  }

  function newPost() {
    _editingId = null;
    _existingThumbUrl = null;
    _existingMediaUrl = null;
    [
      'sc-title',
      'sc-excerpt',
      'sc-body',
      'sc-link-url',
      'sc-external-link',
      'sc-external-link-2',
      'sc-product-id',
      'sc-product-ref',
      'sc-product-id-2',
      'sc-product-ref-2',
      'sc-whatsapp',
      'sc-whatsapp-2',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('sc-media-type').value = 'text';
    document.getElementById('sc-cta-type').value = 'catalog';
    document.getElementById('sc-cta-type-2').value = 'none';
    syncMediaFields();
    syncCtaFields();
    updatePreview({ title: 'Hera Swimwear', excerpt: 'Tu mensaje aquí…', media_type: 'text' });
  }

  function syncMediaFields() {
    const mt = document.getElementById('sc-media-type')?.value || 'text';
    const imgRow = document.getElementById('sc-row-image');
    const vidRow = document.getElementById('sc-row-video');
    const thumbRow = document.getElementById('sc-row-thumb');
    const linkRow = document.getElementById('sc-row-link');
    if (imgRow) imgRow.style.display = mt === 'image' ? '' : 'none';
    if (vidRow) vidRow.style.display = mt === 'video' ? '' : 'none';
    if (thumbRow) thumbRow.style.display = mt === 'video' || mt === 'text' ? '' : 'none';
    if (linkRow) linkRow.style.display = mt === 'link' ? '' : 'none';
  }

  function syncCtaSlotFields(slot) {
    const sfx = slot === 2 ? '-2' : '';
    const ct = document.getElementById(`sc-cta-type${sfx}`)?.value || 'none';
    const prodRow = document.getElementById(`sc-row-product${sfx}`);
    const extRow = document.getElementById(`sc-row-external${sfx}`);
    const waRow = document.getElementById(`sc-row-whatsapp${sfx}`);
    if (prodRow) prodRow.style.display = ct === 'product' ? '' : 'none';
    if (extRow) extRow.style.display = ct === 'external' ? '' : 'none';
    if (waRow) waRow.style.display = ct === 'whatsapp' ? '' : 'none';
  }

  function syncCtaFields() {
    syncCtaSlotFields(1);
    syncCtaSlotFields(2);
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

  async function searchProduct(slot) {
    const sfx = slot === 2 ? '-2' : '';
    const q = document.getElementById(`sc-product-search${sfx}`)?.value || '';
    const box = document.getElementById(`sc-product-results${sfx}`);
    if (!box) return;
    try {
      const rows = await Api().searchProducts(q);
      if (slot === 2) _productHits2 = rows;
      else _productHits = rows;
      if (!rows.length) {
        box.innerHTML = '<div style="font-size:11px;color:var(--text2)">Sin resultados</div>';
        return;
      }
      const pickFn = slot === 2 ? 'scPickProduct2' : 'scPickProduct';
      box.innerHTML = rows
        .map(
          (p) =>
            `<button type="button" class="btn btn-secondary btn-sm" style="margin:2px" onclick="${pickFn}('${p.id}')">${esc(p.ref)} — ${esc(p.name)}</button>`,
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
          <div id="sc-row-link" style="display:none;margin-top:8px">
            <label class="form-label">URL del enlace destacado</label>
            <input id="sc-link-url" class="form-input" placeholder="https://instagram.com/...">
          </div>

          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
            <label class="form-label">CTA 1 al abrir la publicación</label>
            <select id="sc-cta-type" class="form-input" onchange="scSyncCta()">
              ${ctaOptionHtml('catalog')}
            </select>
            <div id="sc-row-product" style="display:none;margin-top:8px">
              <label class="form-label">Buscar producto (CTA 1)</label>
              <input id="sc-product-search" class="form-input" placeholder="Ref o nombre" oninput="scSearchProduct()">
              <input type="hidden" id="sc-product-id">
              <input type="hidden" id="sc-product-ref">
              <div id="sc-product-results" style="margin-top:6px"></div>
            </div>
            <div id="sc-row-external" style="display:none;margin-top:8px">
              <label class="form-label">URL externa (CTA 1)</label>
              <input id="sc-external-link" class="form-input" placeholder="https://...">
            </div>
            <div id="sc-row-whatsapp" style="display:none;margin-top:8px">
              <label class="form-label">WhatsApp (CTA 1)</label>
              <input id="sc-whatsapp" class="form-input" inputmode="tel" placeholder="Ej: ${DEFAULT_WA}">
              <p style="font-size:11px;color:var(--text2);margin:4px 0 0">Solo dígitos con código de país (57 para Colombia).</p>
            </div>
          </div>

          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
            <label class="form-label">CTA 2 (opcional)</label>
            <select id="sc-cta-type-2" class="form-input" onchange="scSyncCta()">
              ${ctaOptionHtml('none')}
            </select>
            <div id="sc-row-product-2" style="display:none;margin-top:8px">
              <label class="form-label">Buscar producto (CTA 2)</label>
              <input id="sc-product-search-2" class="form-input" placeholder="Ref o nombre" oninput="scSearchProduct2()">
              <input type="hidden" id="sc-product-id-2">
              <input type="hidden" id="sc-product-ref-2">
              <div id="sc-product-results-2" style="margin-top:6px"></div>
            </div>
            <div id="sc-row-external-2" style="display:none;margin-top:8px">
              <label class="form-label">URL externa (CTA 2)</label>
              <input id="sc-external-link-2" class="form-input" placeholder="https://...">
            </div>
            <div id="sc-row-whatsapp-2" style="display:none;margin-top:8px">
              <label class="form-label">WhatsApp (CTA 2)</label>
              <input id="sc-whatsapp-2" class="form-input" inputmode="tel" placeholder="Ej: ${DEFAULT_WA}">
              <p style="font-size:11px;color:var(--text2);margin:4px 0 0">Puede ser otra línea distinta a la del CTA 1.</p>
            </div>
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
        <div class="card-title">🔗 Conocimiento comercial (IG / TikTok / Blog → producto)</div>
        <p style="font-size:12px;color:var(--text2);margin:0 0 12px">
          Enlaza posts o artículos a un <code>HERA-*</code>. Aparecen en
          <code>/api/v1/products/{ref}/knowledge</code> para asistentes de IA.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div>
            <label class="form-label">Ref producto</label>
            <input id="sk-ref" class="form-input" placeholder="HERA-20132">
          </div>
          <div>
            <label class="form-label">Tipo</label>
            <select id="sk-kind" class="form-input">
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="blog">Blog</option>
              <option value="guide">Guía</option>
              <option value="video">Video externo</option>
              <option value="lookbook">Lookbook</option>
            </select>
          </div>
          <div>
            <label class="form-label">Título</label>
            <input id="sk-title" class="form-input" placeholder="Reel look Cartagena">
          </div>
        </div>
        <label class="form-label" style="margin-top:8px">URL</label>
        <input id="sk-url" class="form-input" placeholder="https://www.instagram.com/p/...">
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" onclick="scSaveKnowledgeLink()">Guardar enlace</button>
          <button type="button" class="btn btn-secondary" onclick="scSyncEditorialKnowledge()">Sincronizar editoriales → knowledge</button>
        </div>
        <div id="sk-status" style="font-size:11px;color:var(--text2);margin-top:8px"></div>
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

  function pickProduct(slot, id) {
    const sfx = slot === 2 ? '-2' : '';
    const hits = slot === 2 ? _productHits2 : _productHits;
    const p = hits.find((x) => x.id === id);
    document.getElementById(`sc-product-id${sfx}`).value = id;
    document.getElementById(`sc-product-ref${sfx}`).value = p?.ref || '';
    document.getElementById(`sc-product-results${sfx}`).innerHTML =
      `<span style="font-size:11px">Seleccionado: ${esc(p?.ref || id)}</span>`;
  }

  global.scSyncMedia = syncMediaFields;
  global.scSyncCta = syncCtaFields;
  global.scSaveDraft = saveDraft;
  global.scPublishOnly = publishOnly;
  global.scPublishPush = publishAndPush;
  global.scNewPost = newPost;
  global.scEditPost = (id) => loadPost(id);
  global.scSearchProduct = () => searchProduct(1);
  global.scSearchProduct2 = () => searchProduct(2);
  global.scPickProduct = (id) => pickProduct(1, id);
  global.scPickProduct2 = (id) => pickProduct(2, id);

  global.scSaveKnowledgeLink = async () => {
    const status = document.getElementById('sk-status');
    try {
      const row = {
        ref: document.getElementById('sk-ref')?.value,
        kind: document.getElementById('sk-kind')?.value,
        title: document.getElementById('sk-title')?.value,
        url: document.getElementById('sk-url')?.value,
      };
      const saved = await Api().upsertKnowledgeLink(row);
      try {
        await Api().rebuildKnowledgeGraph();
      } catch (_) {
        /* link saved; graph rebuild optional */
      }
      if (status) {
        status.textContent = `OK: ${saved.kind} → ${saved.ref || '(marca/categoría)'} (${saved.id}) · grafo actualizado`;
      }
      notify('Enlace de conocimiento guardado');
      document.getElementById('sk-title').value = '';
      document.getElementById('sk-url').value = '';
    } catch (e) {
      if (status) status.textContent = e.message || String(e);
      notify(e.message || 'Error al guardar enlace', false);
    }
  };

  global.scSyncEditorialKnowledge = async () => {
    const status = document.getElementById('sk-status');
    try {
      const n = await Api().syncEditorialKnowledge();
      if (status) status.textContent = `Editoriales sincronizados: ${n}`;
      notify(`Knowledge editorial actualizado (${n})`);
    } catch (e) {
      if (status) status.textContent = e.message || String(e);
      notify(e.message || 'Error al sincronizar', false);
    }
  };

  global.AppSocialContentModule = { renderSocialContenido };
})(window);
