/**
 * Supabase Edge Function: sincroniza un producto del catálogo (`products`) con Rappi (POST menu).
 * “Menu” en la API Rappi = catálogo de ítems de la tienda (productos); el prefijo “restaurants-” es legado.
 *
 * Secrets (Project Settings → Edge Functions):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
 *   RAPPI_DOMAIN — ej. https://microservices.dev.rappi.com o https://api.rappi.com.co
 *   RAPPI_CLIENT_ID, RAPPI_CLIENT_SECRET
 *   RAPPI_STORE_ID — storeId de integración (string)
 *   RAPPI_CATEGORY_ID, RAPPI_CATEGORY_NAME — categoría del menú en Rappi (obligatorios en el JSON)
 * Opcionales:
 *   RAPPI_AUTH_MODE — "domain" (default) | "auth0"
 *   RAPPI_AUTH0_TOKEN_URL — default dev Auth0; en prod usar https://rests-integrations.auth0.com/oauth/token
 *   RAPPI_AUTH0_AUDIENCE — default https://int-public-api-v2/api (validar con Rappi)
 *
 * Body JSON: { "productId": "<uuid products.id>" }
 *
 * Despliegue: supabase functions deploy hera-rappi-sync
 */
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function getRappiAccessToken(): Promise<string> {
  const cid = Deno.env.get('RAPPI_CLIENT_ID');
  const secret = Deno.env.get('RAPPI_CLIENT_SECRET');
  if (!cid || !secret) throw new Error('Faltan RAPPI_CLIENT_ID o RAPPI_CLIENT_SECRET');

  const mode = (Deno.env.get('RAPPI_AUTH_MODE') || 'domain').toLowerCase();

  if (mode === 'auth0') {
    const tokenUrl =
      Deno.env.get('RAPPI_AUTH0_TOKEN_URL') ||
      'https://rests-integrations-dev.auth0.com/oauth/token';
    const audience =
      Deno.env.get('RAPPI_AUTH0_AUDIENCE') || 'https://int-public-api-v2/api';
    const r = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: cid,
        client_secret: secret,
        audience,
        grant_type: 'client_credentials',
      }),
    });
    const j = (await r.json()) as Record<string, unknown>;
    if (!r.ok) {
      throw new Error(
        String(j.error_description || j.message || j.error || `Auth0 HTTP ${r.status}`),
      );
    }
    const at = j.access_token;
    if (typeof at !== 'string' || !at) throw new Error('Auth0: sin access_token');
    return at;
  }

  const domain = (Deno.env.get('RAPPI_DOMAIN') || '').replace(/\/$/, '');
  if (!domain) throw new Error('RAPPI_DOMAIN requerido cuando RAPPI_AUTH_MODE=domain');

  const url = `${domain}/restaurants/auth/v1/token/login/integrations`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: cid, client_secret: secret }),
  });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    throw new Error(String(j.message || JSON.stringify(j)));
  }
  const at = j.access_token;
  if (typeof at !== 'string' || !at) throw new Error('Rappi login: sin access_token');
  return at;
}

function publicApiBase(domain: string): string {
  return `${domain.replace(/\/$/, '')}/api/v2/restaurants-integrations-public-api`;
}

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

type ProductRow = {
  id: string;
  ref?: string | null;
  name?: string | null;
  price?: number | string | null;
  description?: string | null;
  seccion?: string | null;
  cat?: string | null;
  images?: string | null;
  visible?: boolean | null;
};

async function fetchProduct(productId: string): Promise<ProductRow | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !key) throw new Error('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados');

  const url = `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=*&limit=1`;
  const r = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase products: HTTP ${r.status} ${t}`);
  }
  const rows = (await r.json()) as ProductRow[];
  return rows[0] || null;
}

function buildMenuItem(
  p: ProductRow,
  categoryId: string,
  categoryName: string,
  sortingPosition: number,
) {
  const sku = String(p.ref || p.id).slice(0, 200);
  const name = String(p.name || 'Producto').trim() || 'Producto';
  let description = String(p.description || '').trim();
  if (description.length < 2) description = `${name} — catálogo VentasHera`;
  const price = Math.max(0, Math.round(parseFloat(String(p.price ?? 0)) || 0));
  const imgs = parseImages(p.images);
  const imageUrl = imgs[0] && /^https?:\/\//i.test(imgs[0]) ? imgs[0] : undefined;

  const item: Record<string, unknown> = {
    name,
    description,
    sku,
    sortingPosition,
    type: 'PRODUCT',
    price,
    category: {
      id: categoryId,
      maxQty: 0,
      minQty: 0,
      name: categoryName,
      sortingPosition: 0,
    },
    children: [],
  };
  if (imageUrl) item.imageUrl = imageUrl;
  return item;
}

async function getLastMenuRappi(
  token: string,
  domain: string,
  storeId: string,
): Promise<{ storeId?: string; items?: unknown[] } | null> {
  const base = publicApiBase(domain);
  const url = `${base}/menu/rappi/${encodeURIComponent(storeId)}`;
  const r = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-authorization': `Bearer ${token}`,
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const t = await r.text();
    console.warn('[hera-rappi-sync] GET menu/rappi:', r.status, t);
    return null;
  }
  const body = await r.json();
  if (Array.isArray(body) && body[0] && typeof body[0] === 'object') {
    const o = body[0] as Record<string, unknown>;
    return { storeId: String(o.storeId || storeId), items: (o.items as unknown[]) || [] };
  }
  if (body && typeof body === 'object' && 'items' in body) {
    const o = body as Record<string, unknown>;
    return { storeId: String(o.storeId || storeId), items: (o.items as unknown[]) || [] };
  }
  return null;
}

function mergeItemsBySku(existing: unknown[], newItem: Record<string, unknown>, sku: string): unknown[] {
  const out: unknown[] = [];
  let replaced = false;
  for (const it of existing) {
    if (it && typeof it === 'object' && 'sku' in it && String((it as Record<string, unknown>).sku) === sku) {
      out.push(newItem);
      replaced = true;
    } else {
      out.push(it);
    }
  }
  if (!replaced) out.push(newItem);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'Use POST' }, 405);

    let body: { productId?: string; storeId?: string };
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'JSON inválido' }, 400);
    }

    const productId = String(body.productId || '').trim();
    if (!productId) return json({ ok: false, error: 'productId requerido' }, 400);

    const storeId = String(body.storeId || Deno.env.get('RAPPI_STORE_ID') || '').trim();
    if (!storeId) return json({ ok: false, error: 'RAPPI_STORE_ID (secret) o storeId en body' }, 400);

    const categoryId = String(Deno.env.get('RAPPI_CATEGORY_ID') || '').trim();
    const categoryName = String(Deno.env.get('RAPPI_CATEGORY_NAME') || 'Catálogo').trim();
    if (!categoryId) {
      return json(
        {
          ok: false,
          error: 'Configura RAPPI_CATEGORY_ID (y RAPPI_CATEGORY_NAME) en secrets de la función',
        },
        400,
      );
    }

    const domain = (Deno.env.get('RAPPI_DOMAIN') || '').replace(/\/$/, '');
    if (!domain) return json({ ok: false, error: 'RAPPI_DOMAIN no configurado' }, 400);

    const product = await fetchProduct(productId);
    if (!product) return json({ ok: false, error: 'Producto no encontrado en products' }, 404);

    const token = await getRappiAccessToken();
    const sku = String(product.ref || product.id);

    const last = await getLastMenuRappi(token, domain, storeId);
    const existingItems = Array.isArray(last?.items) ? last!.items! : [];
    const newItem = buildMenuItem(product, categoryId, categoryName, existingItems.length);
    const items = mergeItemsBySku(existingItems, newItem, sku);

    const menuPayload = { storeId, items };
    const postUrl = `${publicApiBase(domain)}/menu`;
    const pr = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(menuPayload),
    });

    const text = await pr.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!pr.ok) {
      return json(
        {
          ok: false,
          error: typeof parsed === 'object' && parsed && 'message' in (parsed as object)
            ? (parsed as { message: string }).message
            : text || `Rappi HTTP ${pr.status}`,
          status: pr.status,
        },
        502,
      );
    }

    return json({
      ok: true,
      sku,
      storeId,
      itemsCount: items.length,
      message: 'Menú enviado a validación Rappi (revisa GET menu/approved en consola aliados)',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[hera-rappi-sync]', msg);
    return json({ ok: false, error: msg }, 500);
  }
});
