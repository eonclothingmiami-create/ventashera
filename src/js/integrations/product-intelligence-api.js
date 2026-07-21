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
    return pingProvider();
  }

  async function pingProvider() {
    try {
      const body = await invokeWorker({ action: 'ping' });
      return {
        ok: !!body.ok,
        openai: !!body.ok || !!body.secret_configured,
        connected: !!body.ok,
        provider: body.provider || 'openai',
        model: body.model || body.chat_model,
        chat_model: body.chat_model,
        embed_model: body.embed_model,
        latency_ms: body.latency_ms,
        message: body.message || body.error || '',
        modules: body.modules,
        secret_configured: body.secret_configured !== false,
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
        openai: false,
        connected: false,
        provider: e.body?.provider || 'openai',
        model: e.body?.chat_model,
        chat_model: e.body?.chat_model,
        embed_model: e.body?.embed_model,
        latency_ms: e.body?.latency_ms || 0,
        message: e.message || String(e),
        secret_configured: !openaiMissing,
        status,
        body: e.body,
      };
    }
  }

  async function getRuntimeConfig() {
    const { data, error } = await sb().rpc('get_ai_runtime_config');
    if (error) throw error;
    return data;
  }

  async function updateRuntimeModules(modules) {
    const { data, error } = await sb().rpc('update_ai_runtime_modules', {
      p_modules: modules,
    });
    if (error) throw error;
    return data;
  }

  async function updateRuntimeModels(chatModel, embedModel) {
    const { data, error } = await sb().rpc('update_ai_runtime_models', {
      p_chat_model: chatModel || null,
      p_embed_model: embedModel || null,
    });
    if (error) throw error;
    return data;
  }

  async function getDashboardSummary() {
    const [cfg, status, pendingArts, recentFailed, brand] = await Promise.all([
      getRuntimeConfig(),
      getCatalogStatus(),
      listPendingReview({ limit: 5 }),
      listRecentJobs({ limit: 5, status: 'failed' }),
      getActiveBrandVoice().catch(() => null),
    ]);
    return {
      config: cfg,
      catalog: status,
      brand_voice: brand,
      pending_artifacts: pendingArts.length,
      pending_jobs: status.jobs.pending,
      failed_jobs: status.jobs.failed,
      last_failed: recentFailed[0] || null,
      cost_today: null,
    };
  }

  async function getActiveBrandVoice() {
    const { data, error } = await sb().rpc('get_active_brand_voice');
    if (error) throw error;
    return data;
  }

  async function listBrandVoices() {
    const { data, error } = await sb()
      .from('ai_brand_voice')
      .select(
        'id, version, status, title, tone, audience, always_use, never_use, description_style, seo_structure, good_examples, bad_examples, guide_markdown, activated_at, updated_at',
      )
      .order('version', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function saveBrandVoiceDraft(patch) {
    const client = sb();
    const { data: maxRow } = await client
      .from('ai_brand_voice')
      .select('version')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxRow?.version || 0) + 1;
    const row = {
      version: nextVersion,
      status: 'draft',
      title: patch.title || 'Hera Brand Voice',
      locale: patch.locale || 'es-CO',
      tone: patch.tone || '',
      audience: patch.audience || '',
      always_use: patch.always_use || [],
      never_use: patch.never_use || [],
      description_style: patch.description_style || '',
      seo_structure: patch.seo_structure || '',
      good_examples: patch.good_examples || '',
      bad_examples: patch.bad_examples || '',
      guide_markdown: patch.guide_markdown || '',
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client
      .from('ai_brand_voice')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async function updateBrandVoice(id, patch) {
    const { data, error } = await sb()
      .from('ai_brand_voice')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async function activateBrandVoice(id) {
    const { data, error } = await sb().rpc('activate_brand_voice', { p_id: id });
    if (error) throw error;
    return data;
  }

  const SILENT_PIPELINE = ['seo', 'attributes', 'knowledge'];

  function moduleIsAccepted(modules, key) {
    const st = modules && modules[key] && modules[key].status;
    return st === 'accepted' || st === 'done';
  }

  /**
   * True if background enrichment (seo/attributes/knowledge) is incomplete.
   * Copy is operator-driven via Generar con IA — not gated here.
   */
  function shouldSilentEnrich(intel) {
    if (!intel) return true;
    const mods = intel.modules || {};
    return SILENT_PIPELINE.some((k) => !moduleIsAccepted(mods, k));
  }

  function artifactFromWorker(worker) {
    return (
      worker?.result?.artifact ||
      worker?.artifact ||
      null
    );
  }

  async function latestSuggestedArtifact(ref, artifactType) {
    const clean = String(ref || '').trim().toUpperCase();
    const { data, error } = await sb()
      .from('product_ai_artifacts')
      .select('*')
      .eq('ref', clean)
      .eq('artifact_type', artifactType)
      .eq('status', 'suggested')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  /**
   * Run one module, auto-accept suggested artifact. Returns accept result or null.
   */
  async function runAndAccept(ref, module, artifactType) {
    const { job, worker } = await enqueue(ref, module, { run: true });
    if (worker && worker.ok === false) {
      const err = new Error(worker.error || `Worker falló (${module})`);
      err.worker = worker;
      throw err;
    }
    if (worker && worker.reason === 'module_disabled') {
      return { skipped: true, reason: 'module_disabled', job, worker };
    }
    let art = artifactFromWorker(worker);
    if (!art || !art.id) {
      art = await latestSuggestedArtifact(ref, artifactType);
    }
    if (!art || !art.id) {
      return { skipped: true, reason: 'no_artifact', job, worker };
    }
    if (art.status === 'accepted') {
      return { skipped: true, reason: 'already_accepted', artifact: art, job, worker };
    }
    const accepted = await accept(art.id);
    return { skipped: false, artifact: accepted?.artifact || art, accept: accepted, job, worker };
  }

  /**
   * Operator path: generate copy, auto-apply to products, return payload for form fill.
   */
  async function generateInlineCopy(ref) {
    const clean = String(ref || '').trim().toUpperCase();
    if (!clean) throw new Error('ref requerido');
    await ensure(clean);
    const out = await runAndAccept(clean, 'copy', 'copy');
    if (out.skipped && out.reason === 'module_disabled') {
      throw new Error('Módulo Copy desactivado en Centro de IA → Activación');
    }
    if (out.skipped && out.reason === 'no_artifact') {
      throw new Error('No se generó copy. Revisá OPENAI_API_KEY / Centro de IA.');
    }
    const payload = out.artifact?.payload || out.accept?.artifact?.payload || {};
    return {
      payload,
      name: payload.name || '',
      description:
        payload.description_long ||
        payload.description_short ||
        payload.description ||
        '',
      accept: out.accept,
      worker: out.worker,
    };
  }

  /**
   * Background: seo → attributes → knowledge → embedding. Never relations.
   * Fire-and-forget friendly; does not throw to caller if wrapped.
   */
  async function enqueueSilentEnrichment(ref) {
    const clean = String(ref || '').trim().toUpperCase();
    if (!clean) throw new Error('ref requerido');
    await ensure(clean);

    let gates = {};
    try {
      const runtime = await getRuntimeConfig();
      gates = (runtime && runtime.modules) || {};
    } catch (_) {
      gates = {};
    }

    const results = [];
    for (const mod of SILENT_PIPELINE) {
      if (gates[mod] === false) {
        results.push({ module: mod, skipped: true, reason: 'module_disabled' });
        continue;
      }
      const artifactType = mod === 'knowledge' ? 'knowledge_doc' : mod;
      try {
        const out = await runAndAccept(clean, mod, artifactType);
        results.push({ module: mod, ...out });
      } catch (e) {
        console.warn('[PI silent]', mod, e.message || e);
        results.push({ module: mod, ok: false, error: e.message || String(e) });
        // Continue other modules; knowledge fail blocks embedding below.
        if (mod === 'knowledge') break;
      }
    }

    const knowledgeOk = results.some(
      (r) => r.module === 'knowledge' && !r.skipped && !r.error,
    );
    const knowledgeAlready =
      results.some((r) => r.module === 'knowledge' && r.reason === 'already_accepted') ||
      moduleIsAccepted((await getIntelligence(clean).catch(() => null))?.modules, 'knowledge');

    if ((knowledgeOk || knowledgeAlready) && gates.embedding !== false) {
      try {
        const { job, worker } = await enqueue(clean, 'embedding', { run: true });
        results.push({ module: 'embedding', job, worker });
      } catch (e) {
        console.warn('[PI silent] embedding', e.message || e);
        results.push({ module: 'embedding', ok: false, error: e.message || String(e) });
      }
    }

    return { ref: clean, results };
  }

  global.ProductIntelligenceApi = {
    MODULES,
    SILENT_PIPELINE,
    ensure,
    getIntelligence,
    listArtifacts,
    listJobs,
    listRecentJobs,
    listPendingReview,
    getCatalogStatus,
    getRuntimeConfig,
    updateRuntimeModules,
    updateRuntimeModels,
    getDashboardSummary,
    getActiveBrandVoice,
    listBrandVoices,
    saveBrandVoiceDraft,
    updateBrandVoice,
    activateBrandVoice,
    probeWorker,
    pingProvider,
    enqueue,
    accept,
    reject,
    invokeWorker,
    workerUrl,
    shouldSilentEnrich,
    generateInlineCopy,
    enqueueSilentEnrichment,
  };
})(window);
