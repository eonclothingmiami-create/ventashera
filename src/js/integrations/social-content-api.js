/**
 * API Contenido editorial → Supabase + Storage + Edge publish.
 */
(function initSocialContentApi(global) {
  const BUCKET = 'Catalog-media';
  const SUPABASE_URL =
    global.AppRepository?.SUPABASE_URL || 'https://niilaxdeetuzutycvdkz.supabase.co';

  function sb() {
    const c = global.AppRepository?.supabaseClient;
    if (!c) throw new Error('Supabase no inicializado');
    return c;
  }

  function catalogBase() {
    const v = String(global.HERA_CATALOG_BASE_URL || '').trim();
    return v ? v.replace(/\/?$/, '/') : 'https://eonclothingonline.com/mayoristas/';
  }

  function publishEndpoint() {
    const ep = String(global.CATALOG_CONTENT_PUBLISH_ENDPOINT || '').trim();
    if (ep) return ep;
    return `${SUPABASE_URL}/functions/v1/catalog-content-publish`;
  }

  function slugify(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'contenido';
  }

  function uniqueSlug(base) {
    const tail = Date.now().toString(36).slice(-5);
    return `${slugify(base)}-${tail}`;
  }

  function compressToWebP(file, maxW = 1280, quality = 0.82) {
    return new Promise((resolve) => {
      if (!file?.type?.startsWith('image/')) {
        resolve(file);
        return;
      }
      const fr = new FileReader();
      fr.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width;
          let h = img.height;
          if (maxW && w > maxW) {
            h = Math.round((h * maxW) / w);
            w = maxW;
          }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (blob) => {
              if (!blob) resolve(file);
              else
                resolve(
                  new File([blob], file.name.replace(/\.[^/.]+$/, '') + '.webp', {
                    type: 'image/webp',
                  }),
                );
            },
            'image/webp',
            quality,
          );
        };
        img.onerror = () => resolve(file);
        img.src = ev.target.result;
      };
      fr.onerror = () => resolve(file);
      fr.readAsDataURL(file);
    });
  }

  async function uploadContentFile(postId, file, label) {
    const client = sb();
    const y = new Date().getFullYear();
    const safe = String(label || 'file').replace(/[^a-z0-9._-]+/gi, '_');
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
    const path = `content/${y}/${postId}/${safe}.${ext}`;
    const { error: upErr } = await client.storage.from(BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type || undefined,
    });
    if (upErr) throw upErr;
    const { data } = client.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function countPushSubscribers() {
    const client = sb();
    const { count, error } = await client
      .from('fcm_tokens')
      .select('*', { count: 'exact', head: true });
    if (error) throw error;
    return count || 0;
  }

  async function listPosts({ status, limit = 50 } = {}) {
    const client = sb();
    let q = client
      .from('catalog_content_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function getPost(id) {
    const { data, error } = await sb()
      .from('catalog_content_posts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function savePost(patch, existingId) {
    const client = sb();
    const {
      data: { user },
    } = await client.auth.getUser();
    const row = {
      ...patch,
      updated_at: new Date().toISOString(),
    };
    if (!existingId) {
      row.slug = row.slug || uniqueSlug(row.title || 'contenido');
      row.created_by = user?.id || null;
      const { data, error } = await client
        .from('catalog_content_posts')
        .insert(row)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await client
      .from('catalog_content_posts')
      .update(row)
      .eq('id', existingId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async function searchProducts(query) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    const client = sb();
    const { data, error } = await client
      .from('products')
      .select('id, ref, name')
      .or(`name.ilike.%${q}%,ref.ilike.%${q}%`)
      .eq('active', true)
      .eq('visible', true)
      .limit(20);
    if (error) throw error;
    return data || [];
  }

  function landingPreviewUrl(postId) {
    const id = String(postId || '').trim();
    if (!id) return catalogBase() + 'contenido.html';
    return `${catalogBase()}contenido.html?id=${encodeURIComponent(id)}`;
  }

  async function authHeaders() {
    const client = sb();
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.access_token) throw new Error('Sesión no disponible. Vuelve a iniciar sesión.');
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };
    const anon = global.AppRepository?.SUPABASE_ANON_KEY || global.SUPABASE_ANON_KEY || '';
    if (anon) headers.apikey = anon;
    return headers;
  }

  /**
   * Publica el post vía Edge Function catalog-content-publish.
   * @param {string} postId
   * @param {{ sendPush?: boolean }} [opts]
   */
  async function publishPost(postId, opts) {
    const id = String(postId || '').trim();
    if (!id) throw new Error('post_id required');
    const sendPush = !!(opts && opts.sendPush);
    const headers = await authHeaders();
    const res = await fetch(publishEndpoint(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ post_id: id, send_push: sendPush }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const errCode = data?.error || `HTTP ${res.status}`;
      const err = new Error(String(errCode));
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data || { ok: true };
  }

  async function upsertKnowledgeLink(row) {
    const client = sb();
    const payload = {
      ref: row.ref ? String(row.ref).trim().toUpperCase() : null,
      kind: String(row.kind || '').trim(),
      title: String(row.title || '').trim(),
      url: String(row.url || '').trim(),
      thumbnail_url: row.thumbnail_url || null,
      external_id: row.external_id || null,
      locale: row.locale || 'es-CO',
      applies_to: row.applies_to || {},
      active: row.active !== false,
      published_at: row.published_at || new Date().toISOString(),
      meta: { ...(row.meta || {}), source: (row.meta && row.meta.source) || 'erp' },
      updated_at: new Date().toISOString(),
    };
    if (!payload.kind || !payload.title || !payload.url) {
      throw new Error('kind, title y url son obligatorios');
    }
    if (payload.ref && !/^HERA-/i.test(payload.ref)) {
      throw new Error('ref debe ser HERA-* (o vacío para conocimiento de marca/categoría)');
    }

    let q = client
      .from('product_knowledge_links')
      .select('id')
      .eq('kind', payload.kind)
      .eq('url', payload.url);
    if (payload.ref) q = q.eq('ref', payload.ref);
    else q = q.is('ref', null);
    const { data: existing, error: findErr } = await q.maybeSingle();
    if (findErr) throw findErr;

    if (existing?.id) {
      const { data, error } = await client
        .from('product_knowledge_links')
        .update(payload)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await client
      .from('product_knowledge_links')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async function listKnowledgeLinks({ ref, kind, limit = 40 } = {}) {
    const client = sb();
    let q = client
      .from('product_knowledge_links')
      .select('*')
      .eq('active', true)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (ref) q = q.eq('ref', ref);
    if (kind) q = q.eq('kind', kind);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function syncEditorialKnowledge() {
    const { data, error } = await sb().rpc('sync_editorial_knowledge_links');
    if (error) throw error;
    const { data: graph, error: gErr } = await sb().rpc('rebuild_knowledge_graph');
    if (gErr) throw gErr;
    return { editorial: data, graph };
  }

  async function rebuildKnowledgeGraph() {
    const { data, error } = await sb().rpc('rebuild_knowledge_graph');
    if (error) throw error;
    return data;
  }

  global.SocialContentApi = {
    slugify,
    uniqueSlug,
    compressToWebP,
    uploadContentFile,
    countPushSubscribers,
    listPosts,
    getPost,
    savePost,
    searchProducts,
    publishPost,
    landingPreviewUrl,
    catalogBase,
    upsertKnowledgeLink,
    listKnowledgeLinks,
    syncEditorialKnowledge,
    rebuildKnowledgeGraph,
  };
})(window);
