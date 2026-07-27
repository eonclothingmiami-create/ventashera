/**
 * Batch «Generar con IA» para todo el catálogo.
 * Equivale a pulsar el botón en cada modal de artículo:
 *   copy (auto-accept → products.description) + enrichment silencioso
 *   (seo → attributes → knowledge → embedding). Relaciones NO.
 *
 * Uso:
 *   node scripts/batch-generar-ia.mjs                  # dry-run (lista)
 *   node scripts/batch-generar-ia.mjs --apply --yes    # ejecuta todos
 *   node scripts/batch-generar-ia.mjs --apply --yes --only-missing
 *   node scripts/batch-generar-ia.mjs --apply --yes --copy-only --limit 5
 *   node scripts/batch-generar-ia.mjs --apply --yes --delay 2000
 *
 * Auth (obligatoria con --apply):
 *   HERA_ERP_EMAIL + HERA_ERP_PASSWORD
 *   o SUPABASE_ACCESS_TOKEN (JWT de sesión ERP)
 *
 * Service role (listado / fallback):
 *   SUPABASE_SERVICE_ROLE_KEY  o  `supabase projects api-keys`
 *
 * Coste aproximado: ~4–5 llamadas LLM por producto (copy+seo+attr+knowledge+embed).
 * 149 productos ≈ varios dólares con gpt-4o-mini; usá --only-missing / --limit primero.
 */
import { execSync } from 'child_process';
import readline from 'readline';

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || 'https://niilaxdeetuzutycvdkz.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY?.trim() ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paWxheGRlZXR1enV0eWN2ZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjc0NjIsImV4cCI6MjA4ODk0MzQ2Mn0.GI8E7vRzxi5NumN_f4T432Lx4BcmgGLZo81BR9h3h8c';

const WORKER_URL = `${SUPABASE_URL}/functions/v1/product-intelligence-worker`;
const SILENT_PIPELINE = ['seo', 'attributes', 'knowledge'];

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const YES = args.has('--yes') || args.has('-y');
const ONLY_MISSING = args.has('--only-missing');
const COPY_ONLY = args.has('--copy-only');
const FORCE = args.has('--force'); // regenera aunque ya tenga copy_v3_short

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const LIMIT = Number(argValue('--limit', '0')) || 0;
const DELAY_MS = Math.max(0, Number(argValue('--delay', '1200')) || 1200);
const REF_FILTER = String(argValue('--ref', '') || '')
  .trim()
  .toUpperCase();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveServiceKey() {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = execSync(
      'npx supabase projects api-keys --project-ref niilaxdeetuzutycvdkz -o json',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end < 0) return null;
    const rows = JSON.parse(raw.slice(start, end + 1));
    const row = rows.find((r) => r.name === 'service_role');
    return row?.api_key?.trim() || null;
  } catch {
    return null;
  }
}

async function signIn() {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (token) return token;

  const email = process.env.HERA_ERP_EMAIL?.trim();
  const password = process.env.HERA_ERP_PASSWORD?.trim();
  if (email && password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new Error(
        `Login falló (${res.status}): ${body.error_description || body.msg || body.error || 'sin token'}`,
      );
    }
    return body.access_token;
  }

  // Batch: service role (worker must accept it)
  const serviceKey = resolveServiceKey();
  if (serviceKey) {
    console.log('Auth: service_role (batch)');
    return serviceKey;
  }

  throw new Error(
    'Falta auth. Definí HERA_ERP_EMAIL + HERA_ERP_PASSWORD, SUPABASE_ACCESS_TOKEN, o SUPABASE_SERVICE_ROLE_KEY.',
  );
}

function authHeaders(accessToken) {
  // When batching with service_role, send it as both apikey and Bearer.
  const isService = accessToken && accessToken !== SUPABASE_ANON_KEY &&
    (accessToken.startsWith('eyJ') && accessToken.length > 200);
  const key = isService ? accessToken : SUPABASE_ANON_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function restGet(path, accessToken, { serviceKey } = {}) {
  const headers = serviceKey
    ? {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      }
    : authHeaders(accessToken);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

async function rpc(name, payload, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.message || body.error || body.hint || JSON.stringify(body);
    throw new Error(`RPC ${name}: ${msg}`);
  }
  return body;
}

async function invokeWorker(accessToken, payload) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error || body.hint || body.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function fetchVisibleProducts(serviceKey, accessToken) {
  const out = [];
  const page = 200;
  for (let from = 0; ; from += page) {
    const path =
      `products?select=id,ref,name,description,visible,active` +
      `&active=eq.true&visible=eq.true&order=ref.asc&offset=${from}&limit=${page}`;
    const chunk = await restGet(path, accessToken, { serviceKey });
    if (!chunk.length) break;
    out.push(...chunk);
    if (chunk.length < page) break;
  }
  return out.filter((p) => String(p.ref || '').trim());
}

function needsCopy(product) {
  if (FORCE) return true;
  const desc = String(product.description || '').trim();
  if (!ONLY_MISSING) return true;
  return !desc;
}

async function latestSuggested(accessToken, ref, artifactType) {
  const path =
    `product_ai_artifacts?select=*&ref=eq.${encodeURIComponent(ref)}` +
    `&artifact_type=eq.${encodeURIComponent(artifactType)}` +
    `&status=eq.suggested&order=created_at.desc&limit=1`;
  const rows = await restGet(path, accessToken);
  return rows?.[0] || null;
}

async function runAndAccept(accessToken, ref, module, artifactType) {
  await rpc('ensure_product_intelligence', { p_ref: ref }, accessToken);
  const job = await rpc(
    'enqueue_product_ai_job',
    { p_ref: ref, p_module: module },
    accessToken,
  );
  const worker = await invokeWorker(accessToken, {
    job_id: job.id,
    ref,
    module,
  });

  if (worker.reason === 'module_disabled') {
    return { skipped: true, reason: 'module_disabled', worker };
  }
  if (worker.ok === false) {
    throw new Error(worker.error || `Worker falló (${module})`);
  }

  let art = worker?.result?.artifact || null;
  if (!art?.id) {
    art = await latestSuggested(accessToken, ref, artifactType);
  }
  if (!art?.id) {
    return { skipped: true, reason: 'no_artifact', worker, job };
  }

  const accepted = await rpc(
    'accept_product_ai_artifact',
    { p_artifact_id: art.id },
    accessToken,
  );
  return {
    skipped: false,
    artifact: accepted?.artifact || art,
    accept: accepted,
    worker,
    job,
  };
}

async function generateInlineCopy(accessToken, ref) {
  const out = await runAndAccept(accessToken, ref, 'copy', 'copy');
  if (out.skipped && out.reason === 'module_disabled') {
    throw new Error('Módulo Copy desactivado');
  }
  if (out.skipped && out.reason === 'no_artifact') {
    throw new Error('No se generó artifact copy');
  }
  const payload = out.artifact?.payload || {};
  return {
    name: payload.name || '',
    description:
      payload.description_short ||
      payload.description ||
      payload.description_long ||
      '',
    prompt_version: payload?._meta?.prompt_version || '',
  };
}

async function enqueueSilentEnrichment(accessToken, ref) {
  const results = [];
  for (const mod of SILENT_PIPELINE) {
    const artifactType = mod === 'knowledge' ? 'knowledge_doc' : mod;
    try {
      const out = await runAndAccept(accessToken, ref, mod, artifactType);
      results.push({ module: mod, ...out });
      if (out.skipped && out.reason === 'module_disabled') continue;
    } catch (e) {
      results.push({ module: mod, ok: false, error: e.message });
      if (mod === 'knowledge') break;
    }
  }

  const knowledgeOk = results.some(
    (r) => r.module === 'knowledge' && !r.skipped && !r.error,
  );
  if (knowledgeOk) {
    try {
      const job = await rpc(
        'enqueue_product_ai_job',
        { p_ref: ref, p_module: 'embedding' },
        accessToken,
      );
      const worker = await invokeWorker(accessToken, {
        job_id: job.id,
        ref,
        module: 'embedding',
      });
      results.push({ module: 'embedding', job, worker });
    } catch (e) {
      results.push({ module: 'embedding', ok: false, error: e.message });
    }
  }
  return results;
}

async function confirm(msg) {
  if (YES) return true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise((resolve) => {
    rl.question(`${msg} [y/N] `, resolve);
  });
  rl.close();
  return /^y(es)?$/i.test(String(answer || '').trim());
}

async function main() {
  console.log('=== Batch Generar con IA (Hera) ===');
  console.log(
    `Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'} | only-missing=${ONLY_MISSING} | copy-only=${COPY_ONLY} | delay=${DELAY_MS}ms`,
  );

  const serviceKey = resolveServiceKey();
  let accessToken = null;

  if (APPLY) {
    accessToken = await signIn();
    console.log('Auth OK');
  } else {
    // dry-run: anon/service basta para listar
    try {
      accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim() || null;
      if (!accessToken && process.env.HERA_ERP_EMAIL) {
        accessToken = await signIn();
      }
    } catch {
      accessToken = null;
    }
  }

  if (!accessToken && !serviceKey) {
    throw new Error('Necesito service role o login para listar productos.');
  }

  // Para dry-run sin login, usamos service key o anon (visible products may need policies)
  const listToken = accessToken || SUPABASE_ANON_KEY;
  let products = await fetchVisibleProducts(serviceKey, listToken);
  if (REF_FILTER) {
    products = products.filter((p) => String(p.ref).toUpperCase() === REF_FILTER);
  }

  const targets = products.filter(needsCopy);
  const limited = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;

  console.log(
    `Visibles: ${products.length} | a procesar: ${limited.length}` +
      (LIMIT ? ` (limit ${LIMIT})` : '') +
      (ONLY_MISSING ? ' [solo sin description]' : ' [todos]'),
  );

  if (!limited.length) {
    console.log('Nada que hacer.');
    return;
  }

  console.log('Ejemplos:');
  for (const p of limited.slice(0, 8)) {
    const d = String(p.description || '').trim();
    console.log(
      `  - ${p.ref} | ${p.name || '—'} | desc=${d ? `${d.length}c` : 'vacía'}`,
    );
  }
  if (limited.length > 8) console.log(`  … +${limited.length - 8} más`);

  if (!APPLY) {
    console.log('\nDry-run. Para ejecutar:');
    console.log(
      '  $env:HERA_ERP_EMAIL="..."; $env:HERA_ERP_PASSWORD="..."; node scripts/batch-generar-ia.mjs --apply --yes --only-missing',
    );
    return;
  }

  const estCalls = limited.length * (COPY_ONLY ? 1 : 5);
  const ok = await confirm(
    `\nSe procesarán ${limited.length} productos (~${estCalls} llamadas LLM). ¿Continuar?`,
  );
  if (!ok) {
    console.log('Cancelado.');
    return;
  }

  const summary = { ok: 0, fail: 0, errors: [] };

  for (let i = 0; i < limited.length; i++) {
    const p = limited[i];
    const ref = String(p.ref).trim().toUpperCase();
    const n = `[${i + 1}/${limited.length}] ${ref}`;
    process.stdout.write(`${n} copy… `);

    try {
      const copy = await generateInlineCopy(accessToken, ref);
      process.stdout.write(
        `OK (${copy.description.length}c${copy.prompt_version ? `, ${copy.prompt_version}` : ''})`,
      );

      if (!COPY_ONLY) {
        process.stdout.write(' +enrich… ');
        await enqueueSilentEnrichment(accessToken, ref);
        process.stdout.write('OK');
      }
      process.stdout.write('\n');
      summary.ok += 1;
    } catch (e) {
      process.stdout.write(`FAIL ${e.message}\n`);
      summary.fail += 1;
      summary.errors.push({ ref, error: e.message });
    }

    if (i < limited.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log('\n=== Resumen ===');
  console.log(`OK: ${summary.ok} | FAIL: ${summary.fail}`);
  if (summary.errors.length) {
    console.log('Errores:');
    for (const e of summary.errors.slice(0, 30)) {
      console.log(`  ${e.ref}: ${e.error}`);
    }
  }
}

main().catch((e) => {
  console.error('\nERROR:', e.message || e);
  process.exit(1);
});
