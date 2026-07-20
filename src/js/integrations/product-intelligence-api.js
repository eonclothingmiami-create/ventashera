/**
 * Product Intelligence API — ERP client for jobs/artifacts (no saveArticulo coupling).
 */
(function initProductIntelligenceApi(global) {
  const SUPABASE_URL =
    global.AppRepository?.SUPABASE_URL || 'https://niilaxdeetuzutycvdkz.supabase.co';

  const MODULES = ['copy', 'seo', 'attributes', 'relations', 'knowledge', 'embedding'];

  function sb() {
    const c = global.AppRepository?.supabaseClient || global.supabaseClient;
    if (!c) throw new Error('Supabase no inicializado');
    return c;
  }

  function workerUrl() {
    const ep = String(global.PRODUCT_INTELLIGENCE_WORKER_ENDPOINT || '').trim();
    if (ep) return ep;
    return `${SUPABASE_URL}/functions/v1/product-intelligence-worker`;
  }

  async function authHeaders() {
    const client = sb();
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.access_token) throw new Error('Sesión requerida');
    const anon =
      global.AppRepository?.SUPABASE_ANON_KEY ||
      global.SUPABASE_ANON_KEY ||
      '';
    return {
      Authorization: `Bearer ${session.access_token}`,
      apikey: anon,
      'Content-Type': 'application/json',
    };
  }

  async function ensure(ref) {
    const clean = String(ref || '').trim().toUpperCase();
    if (!clean) throw new Error('ref requerido');
    const { data, error } = await sb().rpc('ensure_product_intelligence', {
      p_ref: clean,
    });
    if (error) throw error;
    return data;
  }

  async function getIntelligence(ref) {
    const clean = String(ref || '').trim().toUpperCase();
    await ensure(clean);
    const { data, error } = await sb()
      .from('product_intelligence')
      .select('*')
      .eq('ref', clean)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function listArtifacts(ref, { limit = 40 } = {}) {
    const clean = String(ref || '').trim().toUpperCase();
    const { data, error } = await sb()
      .from('product_ai_artifacts')
      .select('*')
      .eq('ref', clean)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function listJobs(ref, { limit = 20 } = {}) {
    const clean = String(ref || '').trim().toUpperCase();
    const { data, error } = await sb()
      .from('product_ai_jobs')
      .select('*')
      .eq('ref', clean)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function invokeWorker(payload) {
    const headers = await authHeaders();
    const res = await fetch(workerUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload || {}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.error || body.hint || `Worker HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  async function enqueue(ref, module, { run = true } = {}) {
    const clean = String(ref || '').trim().toUpperCase();
    const mod = String(module || '').trim().toLowerCase();
    if (!MODULES.includes(mod)) throw new Error(`módulo inválido: ${module}`);

    const { data: job, error } = await sb().rpc('enqueue_product_ai_job', {
      p_ref: clean,
      p_module: mod,
    });
    if (error) throw error;

    let worker = null;
    if (run) {
      try {
        worker = await invokeWorker({ job_id: job.id, ref: clean, module: mod });
      } catch (e) {
        worker = { ok: false, error: e.message, status: e.status, body: e.body };
      }
    }
    return { job, worker };
  }

  async function accept(artifactId) {
    const { data, error } = await sb().rpc('accept_product_ai_artifact', {
      p_artifact_id: artifactId,
    });
    if (error) throw error;
    return data;
  }

  async function reject(artifactId) {
    const { data, error } = await sb().rpc('reject_product_ai_artifact', {
      p_artifact_id: artifactId,
    });
    if (error) throw error;
    return data;
  }

  async function listRecentJobs({ limit = 40, status } = {}) {
    let q = sb()
      .from('product_ai_jobs')
      .select('id, ref, module, status, attempts, last_error, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function listPendingReview({ limit = 40 } = {}) {
    const { data, error } = await sb()
      .from('product_ai_artifacts')
      .select('id, ref, artifact_type, version, status, payload, model, prompt_version, created_at')
      .eq('status', 'suggested')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  /**
   * Cobertura del catálogo visible (métricas de negocio, no panel LLM).
   */
  async function getCatalogStatus() {
    const client = sb();
    const { data: products, error: pErr } = await client
      .from('products')
      .select('id, ref, name')
      .eq('visible', true)
      .eq('active', true);
    if (pErr) throw pErr;
    const list = (products || []).filter((p) => p.ref);
    const total = list.length;
    const byRef = Object.fromEntries(list.map((p) => [p.ref, p]));
    const allRefs = new Set(list.map((p) => p.ref));

    const [{ data: arts }, { data: docs }, { data: rels }, { data: links }, { data: jobStats }] =
      await Promise.all([
        client
          .from('product_ai_artifacts')
          .select('ref, artifact_type, status')
          .in('status', ['accepted', 'suggested']),
        client.from('product_search_docs').select('ref, embedding_model, content_hash'),
        client.from('product_relations').select('from_ref').eq('active', true),
        client
          .from('product_knowledge_links')
          .select('ref, kind')
          .eq('active', true)
          .not('ref', 'is', null),
        client
          .from('product_ai_jobs')
          .select('status')
          .in('status', ['pending', 'processing', 'failed']),
      ]);

    const acceptedRefs = new Set();
    const suggestedRefs = new Set();
    const seoAccepted = new Set();
    const copyAccepted = new Set();
    (arts || []).forEach((a) => {
      if (!allRefs.has(a.ref)) return;
      if (a.status === 'accepted') {
        acceptedRefs.add(a.ref);
        if (a.artifact_type === 'seo') seoAccepted.add(a.ref);
        if (a.artifact_type === 'copy') copyAccepted.add(a.ref);
      }
      if (a.status === 'suggested') suggestedRefs.add(a.ref);
    });

    const embedded = new Set();
    (docs || []).forEach((d) => {
      if (allRefs.has(d.ref) && d.embedding_model) embedded.add(d.ref);
    });

    const withRelations = new Set();
    (rels || []).forEach((r) => {
      if (allRefs.has(r.from_ref)) withRelations.add(r.from_ref);
    });

    const socialKinds = new Set(['instagram', 'tiktok', 'blog', 'guide', 'video', 'lookbook', 'editorial']);
    const withSocial = new Set();
    (links || []).forEach((l) => {
      if (allRefs.has(l.ref) && socialKinds.has(l.kind)) withSocial.add(l.ref);
    });

    const jobs = { pending: 0, processing: 0, failed: 0 };
    (jobStats || []).forEach((j) => {
      if (jobs[j.status] != null) jobs[j.status] += 1;
    });

    function sampleMissing(hasSet, n = 12) {
      const out = [];
      for (const ref of allRefs) {
        if (!hasSet.has(ref)) {
          out.push({ ref, name: byRef[ref]?.name || ref });
          if (out.length >= n) break;
        }
      }
      return out;
    }

    return {
      total,
      metrics: {
        intelligence_approved: {
          label: 'Con inteligencia aprobada',
          count: acceptedRefs.size,
          pct: total ? Math.round((acceptedRefs.size / total) * 100) : 0,
          missing_sample: sampleMissing(acceptedRefs),
        },
        pending_review: {
          label: 'Pendientes de revisión',
          count: suggestedRefs.size,
          pct: total ? Math.round((suggestedRefs.size / total) * 100) : 0,
          sample_refs: [...suggestedRefs].slice(0, 12).map((ref) => ({
            ref,
            name: byRef[ref]?.name || ref,
          })),
        },
        without_embedding: {
          label: 'Sin embedding',
          count: total - embedded.size,
          pct: total ? Math.round(((total - embedded.size) / total) * 100) : 0,
          missing_sample: sampleMissing(embedded),
        },
        without_relations: {
          label: 'Sin relaciones',
          count: total - withRelations.size,
          pct: total ? Math.round(((total - withRelations.size) / total) * 100) : 0,
          missing_sample: sampleMissing(withRelations),
        },
        without_seo: {
          label: 'Sin SEO aprobado',
          count: total - seoAccepted.size,
          pct: total ? Math.round(((total - seoAccepted.size) / total) * 100) : 0,
          missing_sample: sampleMissing(seoAccepted),
        },
        without_copy: {
          label: 'Sin copy aprobado',
          count: total - copyAccepted.size,
          pct: total ? Math.round(((total - copyAccepted.size) / total) * 100) : 0,
          missing_sample: sampleMissing(copyAccepted),
        },
        without_social: {
          label: 'Sin enlaces sociales',
          count: total - withSocial.size,
          pct: total ? Math.round(((total - withSocial.size) / total) * 100) : 0,
          missing_sample: sampleMissing(withSocial),
        },
      },
      jobs,
      coverage: {
        embedding: embedded.size,
        relations: withRelations.size,
        seo: seoAccepted.size,
        copy: copyAccepted.size,
        social: withSocial.size,
      },
    };
  }

  async function probeWorker() {
    try {
      const body = await invokeWorker({});
      if (body && body.error === 'OPENAI_API_KEY not configured') {
        return { ok: false, openai: false, message: body.hint || body.error, body };
      }
      return {
        ok: true,
        openai: true,
        message: body.processed
          ? `Job procesado (#${body.job_id})`
          : body.reason === 'no_pending_jobs'
            ? 'Worker OK · sin jobs pendientes'
            : 'Worker OK',
        body,
      };
    } catch (e) {
      const status = e.status;
      const openaiMissing =
        status === 503 ||
        /OPENAI_API_KEY/i.test(String(e.message || '')) ||
        /OPENAI_API_KEY/i.test(String(e.body?.error || ''));
      return {
        ok: false,
        openai: !openaiMissing && status !== 503,
        message: e.message || String(e),
        status,
        body: e.body,
      };
    }
  }

  global.ProductIntelligenceApi = {
    MODULES,
    ensure,
    getIntelligence,
    listArtifacts,
    listJobs,
    listRecentJobs,
    listPendingReview,
    getCatalogStatus,
    probeWorker,
    enqueue,
    accept,
    reject,
    invokeWorker,
    workerUrl,
  };
})(window);
