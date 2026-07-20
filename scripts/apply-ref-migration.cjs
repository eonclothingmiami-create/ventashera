/**
 * Aplica migración HERA-* leyendo normalize-product-refs.map.json (CommonJS, sin fetch ESM).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const MAP = path.join(ROOT, 'scripts/normalize-product-refs.map.json');
const SUPABASE_URL = 'niilaxdeetuzutycvdkz.supabase.co';

function serviceKey() {
  const raw = execSync('supabase projects api-keys --project-ref niilaxdeetuzutycvdkz -o json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const rows = JSON.parse(raw.slice(raw.indexOf('[')));
  return rows.find((r) => r.name === 'service_role').api_key;
}

function patch(key, id, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: SUPABASE_URL,
        path: `/rest/v1/products?id=eq.${encodeURIComponent(id)}`,
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`${id} ${res.statusCode} ${buf}`));
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function writeAliases(map) {
  const aliases = {};
  for (const row of map) {
    const oldU = String(row.old_ref || '').trim().toUpperCase();
    if (oldU && oldU !== row.new_ref) aliases[oldU] = row.new_ref;
  }
  const json = JSON.stringify(aliases, null, 2);
  const targets = [
    path.join(ROOT, '../../mayoristas/Mayoristas/ref-aliases.json'),
    path.join(ROOT, '../../pagina seo hera swimwear/hera-github-pages/catalogo/ref-aliases.json'),
  ];
  for (const t of targets) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, json, 'utf8');
    console.log('Wrote', t);
  }
}

async function main() {
  const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  const key = serviceKey();
  console.log('Phase 1…');
  for (const row of map) {
    if (String(row.old_ref).toUpperCase() === row.new_ref && /^HERA-/.test(row.new_ref)) continue;
    if (String(row.old_ref).startsWith('TMP-')) continue;
    await patch(key, row.id, { ref: `TMP-${row.id}` });
  }
  console.log('Phase 2…');
  const now = new Date().toISOString();
  for (const row of map) {
    await patch(key, row.id, { ref: row.new_ref, sku: row.new_ref, updated_at: now });
  }
  writeAliases(map);
  console.log('Done', map.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
