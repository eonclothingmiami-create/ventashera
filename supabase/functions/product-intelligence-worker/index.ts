/**
 * product-intelligence-worker
 * Runtime: AiProvider port → OpenAI (extensible). Domain: PI jobs/artifacts.
 * Auth: ERP JWT. Secrets: OPENAI_API_KEY (never in DB).
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createAiProvider, type AiProvider } from "../_shared/ai_provider.ts";
import {
  PROMPT_VERSIONS,
  artifactTypeForModule,
  buildMessages,
  parseJsonObject,
  type PiModule,
  type ProductContext,
} from "../_shared/product_intelligence.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type RuntimeConfig = {
  active_provider: string;
  chat_model: string;
  embed_model: string;
  modules: Record<string, boolean>;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type JobRow = {
  id: number;
  ref: string;
  module: PiModule;
  status: string;
  attempts: number;
};

async function loadBrandVoiceGuide(admin: SupabaseClient): Promise<{
  guide: string;
  version: number | null;
  id: string | null;
}> {
  const { data, error } = await admin.rpc("get_active_brand_voice");
  if (error || !data) {
    return { guide: "", version: null, id: null };
  }
  const row = data as Record<string, unknown>;
  const guide = String(row.guide_markdown || "").trim();
  return {
    guide,
    version: row.version != null ? Number(row.version) : null,
    id: row.id ? String(row.id) : null,
  };
}

async function loadRuntimeConfig(admin: SupabaseClient): Promise<RuntimeConfig> {
  const { data, error } = await admin.rpc("get_ai_runtime_config");
  if (error) {
    // Fallback if migration not applied yet
    return {
      active_provider: "openai",
      chat_model: Deno.env.get("OPENAI_CHAT_MODEL") || "gpt-4o-mini",
      embed_model: Deno.env.get("OPENAI_EMBED_MODEL") || "text-embedding-3-small",
      modules: {
        copy: true,
        seo: true,
        attributes: true,
        relations: false,
        knowledge: true,
        embedding: true,
      },
    };
  }
  const row = data as Record<string, unknown>;
  return {
    active_provider: String(row.active_provider || "openai"),
    chat_model: String(
      Deno.env.get("OPENAI_CHAT_MODEL") || row.chat_model || "gpt-4o-mini",
    ),
    embed_model: String(
      Deno.env.get("OPENAI_EMBED_MODEL") || row.embed_model || "text-embedding-3-small",
    ),
    modules: (row.modules || {}) as Record<string, boolean>,
  };
}

function moduleEnabled(cfg: RuntimeConfig, module: string): boolean {
  if (cfg.modules[module] === false) return false;
  return true;
}

async function loadContext(
  admin: SupabaseClient,
  ref: string,
): Promise<ProductContext> {
  const { data: product, error } = await admin
    .from("products")
    .select("ref, name, description, seccion, categoria, colors, sizes")
    .eq("ref", ref)
    .maybeSingle();
  if (error) throw error;
  if (!product) throw new Error(`product ${ref} not found`);

  const { data: attrs } = await admin
    .from("product_attributes")
    .select(
      "product_type, style, occasions, fit_goals, silhouette, coverage, materials, season, collection_slugs, attrs",
    )
    .eq("ref", ref)
    .maybeSingle();

  const { data: sample } = await admin
    .from("products")
    .select("ref, name, seccion, categoria")
    .neq("ref", ref)
    .eq("visible", true)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(40);

  return {
    ref: product.ref,
    name: product.name,
    description: product.description,
    seccion: product.seccion,
    categoria: product.categoria,
    colors: typeof product.colors === "string"
      ? product.colors
      : Array.isArray(product.colors)
      ? product.colors.join(", ")
      : null,
    sizes: typeof product.sizes === "string"
      ? product.sizes
      : Array.isArray(product.sizes)
      ? product.sizes.join(", ")
      : null,
    attributes: attrs || null,
    catalogSample: (sample || []).map((r) => ({
      ref: r.ref,
      name: r.name,
      seccion: r.seccion,
      categoria: r.categoria,
    })),
  };
}

async function nextVersion(
  admin: SupabaseClient,
  ref: string,
  artifactType: string,
): Promise<number> {
  const { data } = await admin
    .from("product_ai_artifacts")
    .select("version")
    .eq("ref", ref)
    .eq("artifact_type", artifactType)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.version || 0) + 1;
}

async function patchModuleStatus(
  admin: SupabaseClient,
  ref: string,
  module: string,
  patch: Record<string, unknown>,
  piStatus?: string,
) {
  await admin.rpc("ensure_product_intelligence", { p_ref: ref });
  const { data: row } = await admin
    .from("product_intelligence")
    .select("modules")
    .eq("ref", ref)
    .maybeSingle();
  const modules = {
    ...(row?.modules || {}),
    [module]: { ...((row?.modules || {})[module] || {}), ...patch },
  };
  const update: Record<string, unknown> = {
    modules,
    updated_at: new Date().toISOString(),
  };
  if (piStatus) update.status = piStatus;
  if (patch.status === "error" && patch.error) {
    update.last_error = String(patch.error).slice(0, 500);
    update.status = "error";
  }
  await admin.from("product_intelligence").update(update).eq("ref", ref);
}

async function assertKnowledgeAccepted(admin: SupabaseClient, ref: string) {
  const { data } = await admin
    .from("product_ai_artifacts")
    .select("id")
    .eq("ref", ref)
    .eq("artifact_type", "knowledge_doc")
    .eq("status", "accepted")
    .limit(1)
    .maybeSingle();
  if (!data) {
    throw new Error(
      "Embedding blocked: approve Knowledge first (knowledge_doc accepted)",
    );
  }
}

async function processGenerationJob(
  admin: SupabaseClient,
  job: JobRow,
  provider: AiProvider,
  cfg: RuntimeConfig,
  userId: string | null,
  brandVoiceGuide: string,
  brandVoiceVersion: number | null,
) {
  const module = job.module as Exclude<PiModule, "embedding">;
  const artifactType = artifactTypeForModule(module);
  if (!artifactType) throw new Error("invalid generation module");

  const ctx = await loadContext(admin, job.ref);
  const messages = buildMessages(module, ctx, brandVoiceGuide);
  const chat = await provider.chatJson({
    model: cfg.chat_model,
    messages,
  });
  const payload = parseJsonObject(chat.content);
  // Stamp brand voice version for audit (non-breaking)
  const stamped = {
    ...payload,
    _meta: {
      brand_voice_version: brandVoiceVersion,
      prompt_version: PROMPT_VERSIONS[module],
    },
  };
  const version = await nextVersion(admin, job.ref, artifactType);

  const { data: artifact, error: artErr } = await admin
    .from("product_ai_artifacts")
    .insert({
      ref: job.ref,
      artifact_type: artifactType,
      version,
      payload: stamped,
      status: "suggested",
      model: chat.model,
      prompt_version: PROMPT_VERSIONS[module],
      provider: provider.id,
      created_by: userId,
    })
    .select("*")
    .single();
  if (artErr) throw artErr;

  await patchModuleStatus(
    admin,
    job.ref,
    module === "knowledge" ? "knowledge" : module,
    {
      status: "suggested",
      artifact_id: artifact.id,
      updated_at: new Date().toISOString(),
    },
    "partial",
  );

  return { artifact };
}

async function processEmbeddingModule(
  admin: SupabaseClient,
  ref: string,
  provider: AiProvider,
  cfg: RuntimeConfig,
) {
  await assertKnowledgeAccepted(admin, ref);

  let { data: embJob } = await admin
    .from("embedding_jobs")
    .select("id, ref, status, attempts")
    .eq("ref", ref)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!embJob) {
    const { data: doc } = await admin
      .from("product_search_docs")
      .select("ref, embedding_text, embedding, content_hash")
      .eq("ref", ref)
      .maybeSingle();
    if (!doc?.embedding_text) {
      return { skipped: true, reason: "no_search_doc_text" };
    }
    if (doc.embedding) {
      return { skipped: true, reason: "embedding_already_present" };
    }
    const { data: inserted, error } = await admin
      .from("embedding_jobs")
      .insert({ ref, reason: "pi_embedding_module", status: "pending" })
      .select("id, ref, status, attempts")
      .single();
    if (error) throw error;
    embJob = inserted;
  }

  await admin
    .from("embedding_jobs")
    .update({
      status: "processing",
      attempts: (embJob.attempts || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", embJob.id);

  const { data: doc, error: docErr } = await admin
    .from("product_search_docs")
    .select("ref, embedding_text")
    .eq("ref", ref)
    .maybeSingle();
  if (docErr) throw docErr;
  if (!doc?.embedding_text) {
    await admin
      .from("embedding_jobs")
      .update({
        status: "skipped",
        last_error: "empty embedding_text",
        updated_at: new Date().toISOString(),
      })
      .eq("id", embJob.id);
    return { skipped: true, reason: "empty_embedding_text" };
  }

  try {
    const emb = await provider.embed({
      model: cfg.embed_model,
      input: doc.embedding_text,
    });
    if (emb.dims !== 1536) {
      throw new Error(
        `embedding dims ${emb.dims} != 1536; refuse write (use text-embedding-3-small)`,
      );
    }
    const { error: upErr } = await admin
      .from("product_search_docs")
      .update({
        embedding: emb.embedding,
        embedding_model: emb.model,
        updated_at: new Date().toISOString(),
      })
      .eq("ref", ref);
    if (upErr) throw upErr;

    await admin
      .from("embedding_jobs")
      .update({
        status: "done",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", embJob.id);

    await patchModuleStatus(
      admin,
      ref,
      "embedding",
      {
        status: "ready",
        embedding_job_id: embJob.id,
        updated_at: new Date().toISOString(),
      },
      "partial",
    );

    return { embedding_job_id: embJob.id, dims: emb.dims, model: emb.model };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("embedding_jobs")
      .update({
        status: "failed",
        last_error: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", embJob.id);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  let body: {
    action?: string;
    job_id?: number;
    ref?: string;
    module?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const cfg = await loadRuntimeConfig(admin);
  const brandVoice = await loadBrandVoiceGuide(admin);

  // --- Ping / provider health ---
  if (body.action === "ping") {
    try {
      const provider = createAiProvider(cfg.active_provider, {
        OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") || "",
      });
      const ping = await provider.ping({ chatModel: cfg.chat_model });
      await admin.rpc("record_ai_provider_ping", {
        p_ok: ping.ok,
        p_latency_ms: ping.latency_ms,
        p_message: ping.message,
        p_model: ping.model,
      });
      return json({
        ok: ping.ok,
        provider: ping.provider,
        model: ping.model,
        chat_model: cfg.chat_model,
        embed_model: cfg.embed_model,
        latency_ms: ping.latency_ms,
        message: ping.message,
        modules: cfg.modules,
        brand_voice_version: brandVoice.version,
        secret_configured: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const missing = /OPENAI_API_KEY/i.test(msg);
      try {
        await admin.rpc("record_ai_provider_ping", {
          p_ok: false,
          p_latency_ms: 0,
          p_message: msg.slice(0, 500),
          p_model: cfg.chat_model,
        });
      } catch {
        /* ignore */
      }
      return json(
        {
          ok: false,
          provider: cfg.active_provider,
          model: cfg.chat_model,
          chat_model: cfg.chat_model,
          embed_model: cfg.embed_model,
          latency_ms: 0,
          message: msg,
          modules: cfg.modules,
          secret_configured: !missing,
          error: missing ? "OPENAI_API_KEY not configured" : msg,
          hint: missing
            ? "Set secret OPENAI_API_KEY on Supabase Edge Functions"
            : undefined,
        },
        missing ? 503 : 500,
      );
    }
  }

  let provider: AiProvider;
  try {
    provider = createAiProvider(cfg.active_provider, {
      OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") || "",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(
      {
        error: /OPENAI_API_KEY/i.test(msg)
          ? "OPENAI_API_KEY not configured"
          : msg,
        hint: "Set secret OPENAI_API_KEY on the Edge Function",
      },
      503,
    );
  }

  let job: JobRow | null = null;
  if (body.job_id) {
    const { data, error } = await admin
      .from("product_ai_jobs")
      .select("id, ref, module, status, attempts")
      .eq("id", body.job_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    job = data as JobRow | null;
  } else if (body.ref && body.module) {
    const { data, error } = await admin
      .from("product_ai_jobs")
      .select("id, ref, module, status, attempts")
      .eq("ref", String(body.ref).toUpperCase())
      .eq("module", String(body.module).toLowerCase())
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    job = data as JobRow | null;
  } else {
    const { data, error } = await admin
      .from("product_ai_jobs")
      .select("id, ref, module, status, attempts")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    job = data as JobRow | null;
  }

  if (!job) return json({ ok: true, processed: false, reason: "no_pending_jobs" });

  if (!moduleEnabled(cfg, job.module)) {
    await admin
      .from("product_ai_jobs")
      .update({
        status: "skipped",
        last_error: `module ${job.module} disabled in ai_runtime_config`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return json({
      ok: true,
      processed: false,
      reason: "module_disabled",
      module: job.module,
      job_id: job.id,
    });
  }

  await admin
    .from("product_ai_jobs")
    .update({
      status: "processing",
      attempts: (job.attempts || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await patchModuleStatus(admin, job.ref, job.module, {
    status: "processing",
    job_id: job.id,
    updated_at: new Date().toISOString(),
  }, "generating");

  try {
    let result: Record<string, unknown>;
    if (job.module === "embedding") {
      result = await processEmbeddingModule(admin, job.ref, provider, cfg);
    } else {
      result = await processGenerationJob(
        admin,
        job,
        provider,
        cfg,
        user.id,
        brandVoice.guide,
        brandVoice.version,
      );
    }

    await admin
      .from("product_ai_jobs")
      .update({
        status: "done",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return json({
      ok: true,
      processed: true,
      job_id: job.id,
      module: job.module,
      provider: provider.id,
      result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("product_ai_jobs")
      .update({
        status: "failed",
        last_error: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    await patchModuleStatus(admin, job.ref, job.module, {
      status: "error",
      error: msg.slice(0, 300),
      job_id: job.id,
      updated_at: new Date().toISOString(),
    });
    return json({ ok: false, job_id: job.id, error: msg }, 500);
  }
});
