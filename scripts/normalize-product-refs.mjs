/**
 * Migra products.ref → formato HERA-XXXXX y publica ref-aliases.json.
 *
 *   node scripts/normalize-product-refs.mjs           # dry-run
 *   node scripts/normalize-product-refs.mjs --apply   # aplica (SUPABASE_SERVICE_ROLE_KEY)
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildRefMigrationMap, isNormalizedHeraRef } from './lib/product-ref.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SUPABASE_URL = 'https://niilaxdeetuzutycvdkz.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paWxheGRlZXR1enV0eWN2ZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjc0NjIsImV4cCI6MjA4ODk0MzQ2Mn0.GI8E7vRzxi5NumN_f4T432Lx4BcmgGLZo81BR9h3h8c';

const apply = process.argv.includes('--apply');

const ALIAS_TARGETS = [
  path.join(ROOT, '../../mayoristas/Mayoristas/ref-aliases.json'),
  path.join(
    ROOT,
    '../../pagina seo hera swimwear/hera-github-pages/catalogo/ref-aliases.json',
  ),
];

function headers(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
}

async function fetchProducts() {
  const out = [];
  const page = 200;
  for (let from = 0; ; from += page) {
    const url = `${SUPABASE_URL}/rest/v1/products?select=id,ref&order=ref.asc&offset=${from}&limit=${page}`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`fetch products ${res.status}`);
    const chunk = await res.json();
    if (!chunk.length) break;
    out.push(...chunk);
    if (chunk.length < page) break;
  }
  return out;
}

async function patchProduct(serviceKey, id, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers(serviceKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PATCH ${id} ${res.status}: ${t}`);
  }
}

function resolveServiceKey() {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = execSync('supabase projects api-keys --project-ref niilaxdeetuzutycvdkz -o json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
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

function writeAliasFiles(map) {
  const aliases = {};
  for (const row of map) {
    const oldU = String(row.old_ref || '').trim().toUpperCase();
    if (oldU && oldU !== row.new_ref) aliases[oldU] = row.new_ref;
  }
  const json = JSON.stringify(aliases, null, 2);
  for (const target of ALIAS_TARGETS) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json, 'utf8');
    console.log('Wrote', target, `(${Object.keys(aliases).length} aliases)`);
  }
}

async function applyMigration(map, serviceKey) {
  console.log('Phase 1: temp refs…');
  for (const row of map) {
    await patchProduct(serviceKey, row.id, { ref: `TMP-${row.id}` });
  }
  console.log('Phase 2: HERA refs + sku…');
  const now = new Date().toISOString();
  for (const row of map) {
    await patchProduct(serviceKey, row.id, {
      ref: row.new_ref,
      sku: row.new_ref,
      updated_at: now,
    });
  }
  writeAliasFiles(map);
}

async function main() {
  const products = await fetchProducts();
  const map = buildRefMigrationMap(products);
  const changes = map.filter((m) => m.old_ref.toUpperCase() !== m.new_ref);
  const already = map.filter((m) => isNormalizedHeraRef(m.old_ref) && m.old_ref === m.new_ref);

  console.log(`Products: ${products.length}`);
  console.log(`Already HERA-*: ${already.length}`);
  console.log(`To migrate: ${changes.length}`);
  for (const row of changes.slice(0, 8)) {
    console.log(`  ${row.old_ref} → ${row.new_ref}`);
  }

  const jsonPath = path.join(ROOT, 'scripts/normalize-product-refs.map.json');
  fs.writeFileSync(jsonPath, JSON.stringify(map, null, 2), 'utf8');
  console.log(`Wrote ${jsonPath}`);

  if (!apply) {
    writeAliasFiles(map);
    console.log('\nDry-run aliases written. Re-run with --apply to update Supabase.');
    return;
  }

  const serviceKey = resolveServiceKey();
  if (!serviceKey) {
    console.error('Set SUPABASE_SERVICE_ROLE_KEY or run with Supabase CLI linked.');
    process.exit(1);
  }

  await applyMigration(map, serviceKey);
  console.log('Migration complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
