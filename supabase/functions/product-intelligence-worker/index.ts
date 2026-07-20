/**
 * product-intelligence-worker
 * Processes one pending product_ai_jobs row (or embedding drain).
 * Auth: ERP user JWT. Uses service role for DB writes. OPENAI_API_KEY secret.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  PROMPT_VERSIONS,
  artifactTypeForModule,
  buildMessages,
  openaiChatJson,
  openaiEmbed,
  parseJsonObject,
  type PiModule,
  type ProductContext,
} from "../_shared/product_intelligence.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CHAT_MODEL = Deno.env.get("OPENAI_CHAT_MODEL") || "gpt-4o-mini";
const EMBED_MODEL = Deno.env.get("OPENAI_EMBED_MODEL") || "text-embedding-3-small";

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

async function processGenerationJob(
  admin: SupabaseClient,
  job: JobRow,
  apiKey: string,
  userId: string | null,
) {
  const module = job.module as Exclude<PiModule, "embedding">;
  const artifactType = artifactTypeForModule(module);
  if (!artifactType) throw new Error("invalid generation module");

  const ctx = await loadContext(admin, job.ref);
  const messages = buildMessages(module, ctx);
  const { content, model } = await openaiChatJson({
    apiKey,
    model: CHAT_MODEL,
    messages,
  });
  const payload = parseJsonObject(content);
  const version = await nextVersion(admin, job.ref, artifactType);

  const { data: artifact, error: artErr } = await admin
    .from("product_ai_artifacts")
    .insert({
      ref: job.ref,
      artifact_type: artifactType,
      version,
      payload,
      status: "suggested",
      model,
      prompt_version: PROMPT_VERSIONS[module],
      provider: "openai",
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
  apiKey: string,
) {
  // Prefer existing pending embedding_jobs for this ref; else enqueue from search doc.
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
    const vector = await openaiEmbed({
      apiKey,
      model: EMBED_MODEL,
      input: doc.embedding_text,
    });
    const { error: upErr } = await admin
      .from("product_search_docs")
      .update({
        embedding: vector,
        embedding_model: EMBED_MODEL,
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

    return { embedding_job_id: embJob.id, dims: vector.length };
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
  const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  if (!openaiKey) {
    return json(
      {
        error: "OPENAI_API_KEY not configured",
        hint: "Set secret OPENAI_API_KEY on the Edge Function",
      },
      503,
    );
  }

  let body: { job_id?: number; ref?: string; module?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const admin = createClient(supabaseUrl, serviceKey);

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
      result = await processEmbeddingModule(admin, job.ref, openaiKey);
    } else {
      result = await processGenerationJob(admin, job, openaiKey, user.id);
    }

    await admin
      .from("product_ai_jobs")
      .update({
        status: "done",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return json({ ok: true, processed: true, job_id: job.id, module: job.module, result });
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
