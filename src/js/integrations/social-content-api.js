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
      .limit(20);
    if (error) throw error;
    return data || [];
  }

  async function publishPost(postId, { sendPush = true } = {}) {
    const headers = await global.AppRepository.getSupabaseEdgeHeaders();
    const res = await fetch(publishEndpoint(), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: postId, send_push: sendPush }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || res.statusText || 'publish_failed');
      err.details = json;
      throw err;
    }
    return json;
  }

  function landingPreviewUrl(postId) {
    return `${catalogBase()}contenido.html?id=${encodeURIComponent(postId)}`;
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
  };
})(window);
