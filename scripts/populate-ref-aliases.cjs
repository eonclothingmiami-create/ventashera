/**
 * Crea tabla product_ref_aliases (si falta), RPC y puebla desde ref-aliases.json + map.
 *
 *   node scripts/populate-ref-aliases.cjs
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.dirname(path.dirname(__filename));
const SUPABASE_HOST = 'niilaxdeetuzutycvdkz.supabase.co';

function serviceKey() {
  const raw = execSync('supabase projects api-keys --project-ref niilaxdeetuzutycvdkz -o json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(raw.slice(raw.indexOf('['))).find((r) => r.name === 'service_role').api_key;
}

function request(method, pathAndQuery, key, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: SUPABASE_HOST,
        path: pathAndQuery,
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: method === 'POST' ? 'resolution=merge-duplicates' : 'return=minimal',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function tableExists(key) {
  const r = await request('GET', '/rest/v1/product_ref_aliases?select=old_ref&limit=1', key);
  return r.status === 200;
}

async function main() {
  const key = serviceKey();
  if (!(await tableExists(key))) {
    console.error('Tabla product_ref_aliases no existe. Ejecuta:');
    console.error('  npx supabase@2.109.1 db query --linked -f supabase/migrations/20260720120000_product_ref_aliases.sql');
    console.error('  npx supabase@2.109.1 db query --linked -f supabase/migrations/20260720130000_product_ref_aliases_rpc.sql');
    process.exit(1);
  }

  const jsonPath = path.join(ROOT, '../../mayoristas/Mayoristas/ref-aliases.json');
  const mapPath = path.join(ROOT, 'scripts/normalize-product-refs.map.json');
  const aliases = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const map = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : [];

  const byOld = new Map();
  for (const [oldRef, newRef] of Object.entries(aliases)) {
    byOld.set(String(oldRef).trim().toUpperCase(), newRef);
  }
  for (const row of map) {
    const oldU = String(row.old_ref || '').trim().toUpperCase();
    if (oldU && row.new_ref && oldU !== row.new_ref) {
      byOld.set(oldU, row.new_ref);
    }
  }

  const productsRes = await request('GET', '/rest/v1/products?select=id,ref', key);
  if (productsRes.status !== 200) throw new Error(productsRes.body);
  const products = JSON.parse(productsRes.body);
  const refToId = new Map(products.map((p) => [String(p.ref).toUpperCase(), p.id]));

  const rows = [];
  for (const [oldRef, newRef] of byOld.entries()) {
    const productId = refToId.get(String(newRef).toUpperCase());
    if (!productId) {
      console.warn('skip (sin product_id):', oldRef, '->', newRef);
      continue;
    }
    rows.push({ old_ref: oldRef, new_ref: newRef, product_id: productId });
  }

  const chunk = 50;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    const res = await request('POST', '/rest/v1/product_ref_aliases?on_conflict=old_ref', key, batch);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`UPSERT ${res.status}: ${res.body}`);
    }
  }

  console.log(`populate-ref-aliases: ${rows.length} filas`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
