/**
 * Mapeo foto portada por color en el maquetador ERP.
 */
(function initProductColorMedia(global) {
  const VIDEO_EXT = /\.(mp4|mov|webm|avi)$/i;

  function parseColors(raw) {
    return String(raw || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
  }

  function isVideoUrl(url) {
    return VIDEO_EXT.test(String(url || '').split('?')[0]);
  }

  function imageUrlsFromGallery() {
    return (global._tempGaleria || []).filter((u) => u && !isVideoUrl(u));
  }

  function getGlobalCoverUrl() {
    const g = global._tempGaleria || [];
    const idx = global._portadaIndex ?? 0;
    const cover = g[idx];
    if (cover && !isVideoUrl(cover)) return cover;
    const fromGallery = imageUrlsFromGallery()[0] || '';
    if (fromGallery) return fromGallery;
    const artId = global._editingArticuloId;
    if (artId && global.state?.articulos) {
      const art = global.state.articulos.find((a) => a.id === artId);
      if (art?.imagen && !isVideoUrl(art.imagen)) return art.imagen;
    }
    return '';
  }

  function escAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  async function hydrateFromDb(productId) {
    if (!productId || !global.supabaseClient) {
      global._colorCoverMap = {};
      return;
    }
    const { data } = await global.supabaseClient
      .from('product_color_media')
      .select('url, colors(label)')
      .eq('product_id', productId);
    const map = {};
    (data || []).forEach((row) => {
      const label = row.colors?.label;
      if (label && row.url) map[label] = row.url;
    });
    global._colorCoverMap = map;
  }

  function initForModal(productId) {
    global._colorCoversModificada = false;
    global._colorCoverPickerFor = null;
    const colors = parseColors(document.getElementById('m-art-colores')?.value);
    if (productId) {
      hydrateFromDb(productId).then(() => {
        const map = global._colorCoverMap || {};
        colors.forEach((c) => {
          if (!(c in map)) map[c] = null;
        });
        global._colorCoverMap = map;
        renderPanel();
      });
    } else {
      global._colorCoverMap = {};
      colors.forEach((c) => {
        global._colorCoverMap[c] = null;
      });
      renderPanel();
    }
  }

  function onColorsInputChanged() {
    const colors = parseColors(document.getElementById('m-art-colores')?.value);
    const prev = global._colorCoverMap || {};
    const next = {};
    colors.forEach((c) => {
      next[c] = prev[c] ?? null;
    });
    global._colorCoverMap = next;
    global._colorCoversModificada = true;
    global._colorCoverPickerFor = null;
    renderPanel();
  }

  function onGalleryChanged() {
    const gallery = new Set(imageUrlsFromGallery());
    const map = global._colorCoverMap || {};
    let changed = false;
    Object.keys(map).forEach((color) => {
      if (map[color] && !gallery.has(map[color])) {
        map[color] = null;
        changed = true;
      }
    });
    if (changed) global._colorCoversModificada = true;
    renderPanel();
  }

  function collectCoverMap() {
    return { ...(global._colorCoverMap || {}) };
  }

  function collectColorCoversForSync() {
    const map = collectCoverMap();
    const out = [];
    Object.keys(map).forEach((color) => {
      if (map[color]) out.push({ color, url: map[color] });
    });
    return out;
  }

  function pickFromGallery(colorLabel) {
    if (!imageUrlsFromGallery().length) {
      if (typeof global.notify === 'function') {
        global.notify('warning', '📸', 'Galería', 'Sube fotos a la galería primero.');
      }
      return;
    }
    global._colorCoverPickerFor =
      global._colorCoverPickerFor === colorLabel ? null : colorLabel;
    renderPanel();
  }

  function setCover(colorLabel, url) {
    if (!global._colorCoverMap) global._colorCoverMap = {};
    global._colorCoverMap[colorLabel] = url || null;
    global._colorCoversModificada = true;
    global._colorCoverPickerFor = null;
    renderPanel();
  }

  function useGlobalCover(colorLabel) {
    setCover(colorLabel, null);
  }

  function renderPanel() {
    const wrap = document.getElementById('m-art-color-covers-wrap');
    if (!wrap) return;
    const colors = parseColors(document.getElementById('m-art-colores')?.value);
    const map = global._colorCoverMap || {};
    const globalCover = getGlobalCoverUrl();

    if (colors.length < 2) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }

    wrap.style.display = 'block';
    const pickerFor = global._colorCoverPickerFor;
    const gallery = imageUrlsFromGallery();

    wrap.innerHTML = `
      <label class="form-label" style="margin-top:12px;">🎨 FOTO PRINCIPAL POR COLOR</label>
      <p style="font-size:10px;opacity:0.65;margin:0 0 10px;">Asigna una imagen de la galería a cada color (WooCommerce/Addi). Sin asignar = portada global ⭐.</p>
      <div id="m-art-color-covers" style="display:flex;flex-direction:column;gap:10px;">
        ${colors
          .map((color) => {
            const assigned = map[color] || null;
            const thumb = assigned || globalCover;
            const isGlobal = !assigned;
            const showPicker = pickerFor === color;
            const colorEsc = escAttr(color);
            return `
            <div>
              <div style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border);">
                <div style="width:48px;height:64px;border-radius:6px;overflow:hidden;border:2px solid ${isGlobal ? 'rgba(255,255,255,0.2)' : 'var(--accent)'};flex-shrink:0;">
                  ${thumb ? `<img src="${escAttr(thumb)}" style="width:100%;height:100%;object-fit:cover;">` : '<div style="width:100%;height:100%;background:rgba(0,0,0,0.3);"></div>'}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:700;font-size:12px;">${colorEsc}</div>
                  <div style="font-size:10px;opacity:0.6;">${isGlobal ? 'Portada global' : 'Imagen asignada'}</div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" data-pcm-pick="${colorEsc}">Elegir</button>
                <button type="button" class="btn btn-xs" style="opacity:0.8" data-pcm-global="${colorEsc}" ${isGlobal ? 'disabled' : ''}>Global</button>
              </div>
              ${
                showPicker
                  ? `<div style="display:flex;gap:8px;flex-wrap:wrap;padding:4px 0 0 60px;">
                ${gallery
                  .map(
                    (url) => `
                  <div data-pcm-set="${colorEsc}" data-pcm-url="${escAttr(url)}" style="width:56px;height:72px;border-radius:6px;overflow:hidden;cursor:pointer;border:2px solid ${assigned === url ? 'var(--accent)' : 'transparent'};">
                    <img src="${escAttr(url)}" style="width:100%;height:100%;object-fit:cover;">
                  </div>`,
                  )
                  .join('')}
              </div>`
                  : ''
              }
            </div>`;
          })
          .join('')}
      </div>`;

    wrap.querySelectorAll('[data-pcm-pick]').forEach((btn) => {
      btn.addEventListener('click', () => pickFromGallery(btn.getAttribute('data-pcm-pick')));
    });
    wrap.querySelectorAll('[data-pcm-global]').forEach((btn) => {
      btn.addEventListener('click', () => useGlobalCover(btn.getAttribute('data-pcm-global')));
    });
    wrap.querySelectorAll('[data-pcm-set]').forEach((el) => {
      el.addEventListener('click', () =>
        setCover(el.getAttribute('data-pcm-set'), el.getAttribute('data-pcm-url')),
      );
    });
  }

  async function resolveColorId(label) {
    const { data: color } = await global.supabaseClient
      .from('colors')
      .select('id')
      .eq('label', label)
      .maybeSingle();
    return color?.id || null;
  }

  async function persist(productId, coloresStr) {
    if (!productId || !global.supabaseClient) return;
    const colors = parseColors(coloresStr);
    const map = collectCoverMap();

    const { data: existing } = await global.supabaseClient
      .from('product_color_media')
      .select('color_id, colors(label)')
      .eq('product_id', productId);

    const keepLabels = new Set(colors);
    for (const row of existing || []) {
      const label = row.colors?.label;
      if (label && !keepLabels.has(label)) {
        await global.supabaseClient
          .from('product_color_media')
          .delete()
          .eq('product_id', productId)
          .eq('color_id', row.color_id);
      }
    }

    for (const label of colors) {
      const url = map[label];
      const colorId = await resolveColorId(label);
      if (!colorId) continue;

      if (!url) {
        await global.supabaseClient
          .from('product_color_media')
          .delete()
          .eq('product_id', productId)
          .eq('color_id', colorId);
        continue;
      }

      const { data: existingRow } = await global.supabaseClient
        .from('product_color_media')
        .select('product_id')
        .eq('product_id', productId)
        .eq('color_id', colorId)
        .maybeSingle();

      if (existingRow) {
        await global.supabaseClient
          .from('product_color_media')
          .update({ url })
          .eq('product_id', productId)
          .eq('color_id', colorId);
      } else {
        await global.supabaseClient
          .from('product_color_media')
          .insert({ product_id: productId, color_id: colorId, url });
      }
    }
  }

  global.ProductColorMedia = {
    initForModal,
    onColorsInputChanged,
    onGalleryChanged,
    collectCoverMap,
    collectColorCoversForSync,
    pickFromGallery,
    setCover,
    useGlobalCover,
    renderPanel,
    persist,
  };
})(window);
