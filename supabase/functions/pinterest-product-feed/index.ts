/**
 * Feed para Pinterest «Crear Pines en lote» → «Publicar automáticamente» (RSS) o CSV manual.
 *
 * Pinterest exige RSS 2.0 con imagen por ítem (media:content o enclosure). Los enlaces deben
 * coincidir con el dominio verificado en Pinterest Business.
 *
 * Secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
 *   PINTEREST_RSS_SECRET — token largo (solo tú y la URL en Pinterest); ej. openssl rand -hex 32
 *   PINTEREST_PRODUCT_LINK_BASE — URL base del producto en tu web, con ref al final. Ej:
 *     https://tudominio.com/tienda/?ref=
 *     El link del pin será: base + encodeURIComponent(ref || id)
 *
 * Uso:
 *   GET .../functions/v1/pinterest-product-feed?token=TU_SECRET
 *   GET .../functions/v1/pinterest-product-feed?token=TU_SECRET&format=csv
 *
 * verify_jwt = false (Pinterest no envía Authorization al leer el RSS).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function parseImages(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string') as string[];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function firstImageUrl(images: unknown): string | null {
  const arr = parseImages(images);
  for (const u of arr) {
    if (/^https?:\/\//i.test(String(u).trim())) return String(u).trim();
  }
  return null;
}

function rfc822(d: Date): string {
  return d.toUTCString();
}

function cdata(s: string): string {
  const t = String(s || '').replace(/]]>/g, ']]]]><![CDATA[>');
  return `<![CDATA[${t}]]>`;
}

type ProductRow = {
  id: string;
  ref?: string | null;
  name?: string | null;
  price?: number | string | null;
  description?: string | null;
  images?: string | null;
  visible?: boolean | null;
  updated_at?: string | null;
};

async function fetchVisibleProducts(limit: number): Promise<ProductRow[]> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !key) throw new Error('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');

  const url =
    `${supabaseUrl}/rest/v1/products?visible=eq.true&select=id,ref,name,description,price,images,visible,updated_at` +
    `&order=updated_at.desc&limit=${limit}`;
  const r = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`products: HTTP ${r.status} ${t}`);
  }
  return (await r.json()) as ProductRow[];
}

function productLink(base: string, p: ProductRow): string {
  const b = String(base).trim();
  const ref = encodeURIComponent(String(p.ref || p.id).trim());
  if (!b) return `https://example.com/?ref=${ref}`;
  if (/[?&]ref=$/i.test(b)) return b + ref;
  return `${b}${b.includes('?') ? '&' : '?'}ref=${ref}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Use GET' }), {
        status: 405,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';
    const secret = Deno.env.get('PINTEREST_RSS_SECRET') || '';
    if (!secret || token !== secret) {
      return new Response(JSON.stringify({ error: 'token inválido o falta PINTEREST_RSS_SECRET' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const format = (url.searchParams.get('format') || 'rss').toLowerCase();
    const linkBase = (Deno.env.get('PINTEREST_PRODUCT_LINK_BASE') || '').trim();
    if (!linkBase) {
      return new Response(
        JSON.stringify({
          error: 'Configura PINTEREST_PRODUCT_LINK_BASE (ej. https://tudominio.com/cat/?ref=)',
        }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const products = await fetchVisibleProducts(300);
    const channelTitle = 'Catálogo VentasHera';
    const channelLink = String(linkBase).split('?')[0].replace(/\/$/, '') || 'https://www.pinterest.com';

    if (format === 'csv') {
      const lines = ['Title,Description,Link,"Image URL"'];
      for (const p of products) {
        const img = firstImageUrl(p.images);
        if (!img) continue;
        const title = String(p.name || 'Producto').replace(/"/g, '""');
        const desc = String(p.description || title)
          .replace(/\r?\n/g, ' ')
          .replace(/"/g, '""');
        const link = productLink(linkBase, p);
        lines.push(`"${title}","${desc}","${link}","${img.replace(/"/g, '""')}"`);
      }
      const body = '\uFEFF' + lines.join('\r\n');
      return new Response(body, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="pinterest-pins.csv"',
        },
      });
    }

    const now = rfc822(new Date());
    const items: string[] = [];
    for (const p of products) {
      const img = firstImageUrl(p.images);
      if (!img) continue;
      const title = String(p.name || 'Producto').trim() || 'Producto';
      let desc = String(p.description || '').trim();
      const price = p.price != null ? `\n${Number(p.price).toLocaleString('es-CO')} COP` : '';
      if (desc.length < 2) desc = title + price;
      else desc = desc + price;
      const link = productLink(linkBase, p);
      const guid = `ventashera:${p.id}`;
      const pub = p.updated_at ? rfc822(new Date(p.updated_at)) : now;
      const ext = img.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';

      items.push(`    <item>
      <title>${cdata(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(guid)}</guid>
      <pubDate>${pub}</pubDate>
      <description>${cdata(desc)}</description>
      <media:content url="${escapeXml(img)}" type="${ext}" medium="image"/>
      <enclosure url="${escapeXml(img)}" type="${ext}"/>
    </item>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${cdata(channelTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${cdata('Productos visibles — VentasHera')}</description>
    <language>es-co</language>
    <lastBuildDate>${now}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>`;

    return new Response(xml, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
