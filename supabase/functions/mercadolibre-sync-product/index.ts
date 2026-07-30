/**
 * Edge Function: Supabase → Mercado Libre (publicación vendedor).
 * Independiente de: wompi-create-checkout, addi-create-checkout y cualquier pasarela del catálogo.
 * Mismo proyecto Supabase; otra URL y otra lógica.
 *
 * Implementado: leer producto + medios; borrador o POST /items si hay token.
 * Categoría: ML_DEFAULT_CATEGORY_ID_MCO, body.categoryId, o predictor
 *   GET /sites/{SITE_ID}/domain_discovery/search?q=&limit=3&target=core (requiere ML_ACCESS_TOKEN).
 * Secrets: SUPABASE_SERVICE_ROLE_KEY, ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REFRESH_TOKEN,
 *   ML_ACCESS_TOKEN (opcional si ya hay fila en ml_oauth_tokens).
 * Tabla public.ml_oauth_tokens: la función guarda access/refresh y expiración al renovar (sql/ml_oauth_tokens.sql).
 * Cuotas: ML_INSTALLMENTS_SAME_PRICE default "none" (evita tag 3x_campaign si ML lo rechaza).
 *   Activar 3 cuotas mismo precio: ML_INSTALLMENTS_SAME_PRICE=3 → 3x_campaign + gold_pro (requiere elegibilidad ML).
 * Predictor: se omiten atributos no modificables (p. ej. AGE_GROUP). Extra: ML_SKIP_PREDICTOR_ATTRIBUTE_IDS=id1,id2
 * Moda / MCO430281: COLOR, MODEL, BRAND, GENDER (catálogo); ML_BRAND_VALUE_NAME, ML_DEFAULT_MODEL,
 *   ML_COLOR_VALUE_ID|ML_COLOR_VALUE_NAME; product_colors en BD; ML_FABRIC_DESIGN_VALUE_ID (Lisa 930483);
 *   ML_SIZE_GRID_*; ML_SHIPPING_MODE default me2; ML_FREE_SHIPPING=true → free_shipping en el ítem.
 *   ML_PRICE_MARKUP_COP: entero sumado al precio del ERP (listado en ML).
 *   Fotos: por defecto ML_UPLOAD_PICTURES_TO_ML=true — descarga cada URL del ERP y POST
 *   multipart a /pictures/items/upload; el ítem usa { id } (recomendado por ML). Desactivar: false.
 *   Si las URLs son públicas pero ML no puede descargarlas (403), whitelist de IPs ML en tu hosting.
 *   GET categories/{id} → settings.catalog_domain → GET catalog_domains/{domain}/attributes/GENDER|SIZE.
 * Alineación doc ML: channels (no exclusive_channel); condición vía ITEM_CONDITION en attributes;
 *   opcional ML_USE_LEGACY_ITEM_CONDITION=true para enviar también "condition" raíz.
 * User Products: nuevo flujo de publicación — revisar fechas en documentación oficial ML.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Body = {
  productId?: string;
  action?: "publish" | "deactivate";
  siteId?: string;
  categoryId?: string;
  /** value_id ML para GENDER (prioridad sobre heurística por nombre de producto) */
  genderValueId?: string;
  sizeGridId?: string;
  sizeGridRowId?: string;
  /** talla (label) → row id de la guía (JSON o objeto); obligatorio si hay varias tallas */
  sizeGridRowMap?: Record<string, string> | string;
  brandValueId?: string;
  /** fuerza SIZE (value_name o value_id numérico) */
  size?: string;
};

type PredictorHit = {
  domain_id?: string;
  domain_name?: string;
  category_id?: string;
  category_name?: string;
  attributes?: Array<{
    id: string;
    value_id?: string;
    value_name?: string;
  }>;
};

async function predictCategoryFromTitle(
  token: string,
  siteId: string,
  title: string,
): Promise<{ category_id: string; hit: PredictorHit } | null> {
  const q = encodeURIComponent(title.trim().slice(0, 500));
  const limit = Math.min(
    8,
    Math.max(1, Number(Deno.env.get("ML_DOMAIN_DISCOVERY_LIMIT") || "3") || 3),
  );
  const url =
    `https://api.mercadolibre.com/sites/${siteId}/domain_discovery/search?limit=${limit}&q=${q}&target=core`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as PredictorHit[];
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (!first?.category_id) return null;
  return { category_id: first.category_id, hit: first };
}

/** Atributos que el predictor suele enviar pero ML rechaza o ignora en POST (no modificables). */
const SKIP_PREDICTOR_ATTR_IDS = new Set<string>(["AGE_GROUP"]);

function mapPredictorAttributes(
  attrs: PredictorHit["attributes"] | undefined,
): Array<{ id: string; value_id?: string; value_name?: string }> {
  if (!Array.isArray(attrs)) return [];
  const out: Array<{ id: string; value_id?: string; value_name?: string }> = [];
  for (const a of attrs) {
    if (!a?.id || SKIP_PREDICTOR_ATTR_IDS.has(a.id)) continue;
    if (a.value_id != null && String(a.value_id).trim() !== "") {
      out.push({ id: a.id, value_id: String(a.value_id) });
    } else if (a.value_name != null && String(a.value_name).trim() !== "") {
      out.push({ id: a.id, value_name: String(a.value_name) });
    }
  }
  return out;
}

function omitNonModifiableAttributes(
  attrs: Array<{ id: string; value_id?: string; value_name?: string }>,
): Array<{ id: string; value_id?: string; value_name?: string }> {
  const extra = (Deno.env.get("ML_SKIP_PREDICTOR_ATTRIBUTE_IDS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const skip = new Set(SKIP_PREDICTOR_ATTR_IDS);
  for (const id of extra) skip.add(id);
  return attrs.filter((a) => !skip.has(a.id));
}

/** IDs estándar ML para ITEM_CONDITION (doc /categories/.../attributes). */
const ITEM_CONDITION_IDS = {
  new: "2230284",
  used: "2230581",
  refurbished: "2230582",
} as const;

type ItemCondKey = keyof typeof ITEM_CONDITION_IDS;

function resolveItemConditionKey(): ItemCondKey {
  const raw = (Deno.env.get("ML_ITEM_CONDITION") ?? "new").trim().toLowerCase();
  if (raw === "used" || raw === "usado") return "used";
  if (
    raw === "refurbished" || raw === "reacondicionado" || raw === "reacondicionada"
  ) {
    return "refurbished";
  }
  return "new";
}

/** Combina atributos del predictor con ITEM_CONDITION (sin duplicar). */
function mergeItemAttributes(
  predicted: Array<{ id: string; value_id?: string; value_name?: string }>,
  conditionKey: ItemCondKey,
): Array<{ id: string; value_id?: string; value_name?: string }> {
  const map = new Map<string, { id: string; value_id?: string; value_name?: string }>();
  for (const a of predicted) {
    if (!a?.id || a.id === "ITEM_CONDITION") continue;
    map.set(a.id, a);
  }
  map.set("ITEM_CONDITION", {
    id: "ITEM_CONDITION",
    value_id: ITEM_CONDITION_IDS[conditionKey],
  });
  return [...map.values()];
}

function appendAttributeIfMissing(
  attrs: Array<{ id: string; value_id?: string; value_name?: string }>,
  attrId: string,
  raw: string,
): Array<{ id: string; value_id?: string; value_name?: string }> {
  const v = raw.trim();
  if (!v) return attrs;
  if (attrs.some((a) => a.id === attrId)) return attrs;
  if (/^\d+$/.test(v)) return [...attrs, { id: attrId, value_id: v }];
  return [...attrs, { id: attrId, value_name: v }];
}

function upsertAttribute(
  attrs: Array<{ id: string; value_id?: string; value_name?: string }>,
  attr: { id: string; value_id?: string; value_name?: string },
): Array<{ id: string; value_id?: string; value_name?: string }> {
  const rest = attrs.filter((a) => a.id !== attr.id);
  rest.push(attr);
  return rest;
}

type MlCategorySettings = { catalog_domain?: string };
type MlCategoryResponse = { settings?: MlCategorySettings };

async function fetchCategoryCatalogDomain(
  categoryId: string,
): Promise<string | null> {
  const res = await fetch(
    `https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as MlCategoryResponse;
  const d = data?.settings?.catalog_domain;
  return typeof d === "string" && d.trim() ? d.trim() : null;
}

const MSG_SIZE_GRID_SECRET =
  "Falta la guía de talles: en Supabase → Project Settings → Edge Functions → Secrets define ML_SIZE_GRID_ID con el número (ID) de tu guía en Mercado Libre (misma cuenta que el token). Opcional: ML_SIZE_GRID_ROW_ID (una talla) o ML_SIZE_GRID_ROW_MAP en JSON (varias tallas).";

function mlPayloadIndicatesMissingSizeGrid(ml: unknown): boolean {
  if (ml == null) return false;
  const s = typeof ml === "string" ? ml : JSON.stringify(ml);
  if (
    /missing\.fashion_grid\.grid_id|\[SIZE_GRID_ID\].*missing|SIZE_GRID_ID.*is missing/i
      .test(s)
  ) {
    return true;
  }
  const cause = typeof ml === "object" && ml !== null &&
      Array.isArray((ml as { cause?: unknown[] }).cause)
    ? (ml as { cause: unknown[] }).cause
    : null;
  if (!cause) return false;
  for (const c of cause) {
    if (c && typeof c === "object" && "message" in c) {
      const m = String((c as { message?: string }).message);
      if (/SIZE_GRID_ID|size_grid/i.test(m) && /missing|fashion_grid/i.test(m)) {
        return true;
      }
    }
  }
  return false;
}

function extractMlErrorMessage(ml: unknown): string {
  if (ml == null) return "";
  if (typeof ml === "string") return ml.slice(0, 600);
  if (typeof ml === "object" && ml !== null) {
    const o = ml as Record<string, unknown>;
    if (Array.isArray(o.cause)) {
      const msgs: string[] = [];
      for (const c of o.cause) {
        if (c && typeof c === "object" && "message" in c) {
          const m = String((c as { message?: string }).message);
          if (m.trim()) msgs.push(m);
        }
      }
      if (msgs.length) return msgs.join(" · ").slice(0, 800);
    }
    if (typeof o.message === "string" && o.message.trim()) {
      return o.message.slice(0, 600);
    }
  }
  return "";
}

type MlDomainAttrValue = { id?: string; name?: string };
type MlDomainAttribute = {
  id?: string;
  values?: MlDomainAttrValue[];
};

async function fetchDomainAttribute(
  token: string,
  domainId: string,
  attributeId: string,
): Promise<MlDomainAttribute | null> {
  const url =
    `https://api.mercadolibre.com/catalog_domains/${
      encodeURIComponent(domainId)
    }/attributes/${encodeURIComponent(attributeId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as MlDomainAttribute;
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Elige value_id de GENDER según nombre del producto o env ML_GENDER_VALUE_ID. */
function pickGenderValueId(
  values: MlDomainAttrValue[] | undefined,
  productTitle: string,
  envValueId: string,
): { value_id: string; value_name?: string } | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const fromEnv = envValueId.trim();
  if (fromEnv && /^\d+$/.test(fromEnv)) {
    const hit = values.find((v) => v.id === fromEnv);
    return {
      value_id: fromEnv,
      value_name: hit?.name,
    };
  }
  const t = normalizeText(productTitle);
  const rules: Array<{ keys: string[]; match: (name: string) => boolean }> = [
    {
      keys: ["mujer", "dama", "femenino", "bikini", "vestido", "swim", "banador"],
      match: (name) =>
        /mujer|femenino|dama|female|women/i.test(name),
    },
    {
      keys: ["hombre", "caballero", "masculino", "male", "men"],
      match: (name) =>
        /hombre|masculino|caballero|male|men/i.test(name),
    },
    {
      keys: ["unisex", "niño", "nino", "niña", "nina", "bebe", "bebé", "infant"],
      match: (name) =>
        /unisex|niño|niña|infant|bebe|kids/i.test(name),
    },
  ];
  for (const rule of rules) {
    if (!rule.keys.some((k) => t.includes(k))) continue;
    const hit = values.find((v) => v.name && rule.match(v.name));
    if (hit?.id) return { value_id: String(hit.id), value_name: hit.name };
  }
  const first = values.find((v) => v.id);
  if (first?.id) return { value_id: String(first.id), value_name: first.name };
  return null;
}

/** Encuentra value_id de SIZE en la ficha del dominio por etiqueta de talla (S, M, 38, etc.). */
function pickSizeAttributeValue(
  domainSize: MlDomainAttribute | null,
  sizeLabel: string,
): { value_id?: string; value_name: string } {
  const label = sizeLabel.trim();
  if (!label) return { value_name: label };
  const values = domainSize?.values;
  if (!Array.isArray(values)) return { value_name: label };
  const n = normalizeText(label);
  const exact = values.find((v) => v.name && normalizeText(v.name) === n);
  if (exact?.id) return { value_id: String(exact.id), value_name: exact.name || label };
  const partial = values.find((v) =>
    v.name && (normalizeText(v.name).includes(n) || n.includes(normalizeText(v.name)))
  );
  if (partial?.id) {
    return { value_id: String(partial.id), value_name: partial.name || label };
  }
  return { value_name: label };
}

function splitStock(total: number, n: number): number[] {
  if (n <= 0) return [];
  const t = Math.max(0, Math.floor(total));
  const base = Math.floor(t / n);
  const rem = t - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

function parseJsonEnvMap(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) out[normalizeText(k)] = v.trim();
        else if (typeof v === "number") out[normalizeText(k)] = String(v);
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

type CatAttrDef = {
  id: string;
  value_type?: string;
  values?: Array<{ id: string; name?: string }>;
};

async function fetchCategoryAttributesPublic(
  categoryId: string,
): Promise<CatAttrDef[]> {
  const res = await fetch(
    `https://api.mercadolibre.com/categories/${
      encodeURIComponent(categoryId)
    }/attributes`,
  );
  if (!res.ok) return [];
  return (await res.json()) as CatAttrDef[];
}

function pickColorAttribute(
  defs: CatAttrDef[],
  colorLabel: string | undefined,
  envId: string,
  envName: string,
): { id: "COLOR"; value_id?: string; value_name?: string } {
  const envIdT = envId.trim();
  if (envIdT && /^\d+$/.test(envIdT)) {
    return { id: "COLOR", value_id: envIdT };
  }
  const envNameT = envName.trim();
  if (envNameT) return { id: "COLOR", value_name: envNameT };
  const def = defs.find((d) => d.id === "COLOR");
  if (colorLabel && def?.values?.length) {
    const n = normalizeText(colorLabel);
    const exact = def.values.find((v) =>
      v.name && normalizeText(v.name) === n
    );
    if (exact?.id) return { id: "COLOR", value_id: String(exact.id) };
    const partial = def.values.find((v) =>
      v.name &&
      (normalizeText(v.name).includes(n) || n.includes(normalizeText(v.name)))
    );
    if (partial?.id) return { id: "COLOR", value_id: String(partial.id) };
    return { id: "COLOR", value_name: colorLabel };
  }
  if (def?.values?.length) {
    const negro = def.values.find((v) => v.name && /negro/i.test(v.name));
    if (negro?.id) return { id: "COLOR", value_id: String(negro.id) };
    const first = def.values[0];
    if (first?.id) return { id: "COLOR", value_id: String(first.id) };
  }
  return { id: "COLOR", value_name: colorLabel || "Negro" };
}

type MlTokenRow = {
  id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
};

type MlRefreshResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

async function exchangeMercadoLibreRefresh(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<MlRefreshResponse | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  return (await res.json()) as MlRefreshResponse;
}

const TOKEN_BUFFER_MS = 5 * 60 * 1000;

/**
 * Devuelve access_token válido: lee ml_oauth_tokens o secrets; si expiró o falta, refresca con ML_REFRESH_TOKEN.
 */
async function getValidMercadoLibreAccessToken(
  sb: SupabaseClient,
): Promise<{ token: string; refreshed: boolean }> {
  const clientId = (Deno.env.get("ML_CLIENT_ID") ?? "").trim();
  const clientSecret = (Deno.env.get("ML_CLIENT_SECRET") ?? "").trim();
  const envAccess = (Deno.env.get("ML_ACCESS_TOKEN") ?? "").trim();
  const envRefresh = (Deno.env.get("ML_REFRESH_TOKEN") ?? "").trim();

  let row: MlTokenRow | null = null;
  try {
    const { data, error } = await sb.from("ml_oauth_tokens").select("*").eq("id", "default")
      .maybeSingle();
    if (!error && data && typeof (data as MlTokenRow).access_token === "string") {
      row = data as MlTokenRow;
    }
  } catch {
    // tabla inexistente u otro error: seguir solo con env
  }

  let access = (row?.access_token ?? envAccess).trim();
  let refresh = (row?.refresh_token ?? envRefresh).trim();
  const expMs = row?.expires_at ? new Date(row.expires_at).getTime() : 0;
  const now = Date.now();
  const stillValid = access &&
    expMs > now + TOKEN_BUFFER_MS;

  if (stillValid) return { token: access, refreshed: false };

  if (!refresh || !clientId || !clientSecret) {
    return { token: access, refreshed: false };
  }

  const exchanged = await exchangeMercadoLibreRefresh(refresh, clientId, clientSecret);
  if (!exchanged?.access_token) {
    if (row && expMs > 0 && expMs <= now + TOKEN_BUFFER_MS) {
      return { token: "", refreshed: false };
    }
    return { token: access, refreshed: false };
  }

  access = exchanged.access_token;
  if (exchanged.refresh_token) refresh = exchanged.refresh_token;
  const expiresIn = Math.max(60, Number(exchanged.expires_in) || 21600);
  const expiresAt = new Date(now + expiresIn * 1000).toISOString();

  try {
    await sb.from("ml_oauth_tokens").upsert(
      {
        id: "default",
        access_token: access,
        refresh_token: refresh || null,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  } catch (e) {
    console.warn("[ML] no se pudo guardar ml_oauth_tokens:", e);
  }

  return { token: access, refreshed: true };
}

const ML_UPLOAD_TIMEOUT_MS = 60_000;
const ML_FETCH_IMAGE_TIMEOUT_MS = 45_000;

/**
 * Sube bytes a ML y devuelve picture id (p. ej. "123-MCO...").
 * Evita depender de que los servidores de ML descarguen URLs del ERP (403 / whitelist).
 */
async function uploadPictureToMl(
  accessToken: string,
  imageUrl: string,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(ML_FETCH_IMAGE_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn("[ML] fetch imagen:", String(imageUrl).slice(0, 90), e);
    return null;
  }
  if (!res.ok) {
    console.warn("[ML] fetch imagen status", res.status, String(imageUrl).slice(0, 90));
    return null;
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > 10 * 1024 * 1024) {
    console.warn("[ML] tamaño imagen inválido", buf.byteLength);
    return null;
  }
  const ct = res.headers.get("content-type") || "image/jpeg";
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const blob = new Blob([buf], { type: ct });
  const form = new FormData();
  form.append("file", blob, `photo.${ext}`);

  const up = await fetch("https://api.mercadolibre.com/pictures/items/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    signal: AbortSignal.timeout(ML_UPLOAD_TIMEOUT_MS),
  });
  const txt = await up.text();
  if (!up.ok) {
    console.warn("[ML] POST pictures/items/upload", up.status, txt.slice(0, 350));
    return null;
  }
  try {
    const data = JSON.parse(txt) as { id?: string };
    return typeof data?.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const productId = (body.productId || "").trim();
  if (!productId) return json({ error: "productId requerido" }, 400);
  const action = body.action === "deactivate" ? "deactivate" : "publish";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno" }, 500);
  }

  const sb = createClient(supabaseUrl, serviceKey);

  const { token: mlToken, refreshed: tokenRefreshed } = await getValidMercadoLibreAccessToken(sb);

  const { data: product, error: pErr } = await sb
    .from("products")
    .select("id,ref,name,description,price,stock,visible,active,mercadolibre_item_id")
    .eq("id", productId)
    .maybeSingle();

  if (pErr) return json({ error: pErr.message }, 500);
  if (!product) return json({ error: "Producto no encontrado" }, 404);

  if (action === "deactivate") {
    if (product.active !== false) {
      return json({
        ok: false,
        error: "El producto debe estar archivado antes de pausar Mercado Libre",
      }, 409);
    }
    const itemId = String(product.mercadolibre_item_id || "").trim();
    if (!itemId) {
      return json({ ok: true, skipped: true, reason: "sin item_id de Mercado Libre" });
    }
    if (!mlToken) {
      return json({ ok: false, error: "Sin token válido de Mercado Libre" }, 200);
    }
    const pauseRes = await fetch(
      `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${mlToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "paused" }),
      },
    );
    const pauseText = await pauseRes.text();
    let pauseBody: unknown = null;
    try {
      pauseBody = pauseText ? JSON.parse(pauseText) : null;
    } catch {
      pauseBody = pauseText;
    }
    if (!pauseRes.ok) {
      return json({
        ok: false,
        error: extractMlErrorMessage(pauseBody) || `Mercado Libre HTTP ${pauseRes.status}`,
        status: pauseRes.status,
        mercadolibre: pauseBody,
      }, 200);
    }
    return json({
      ok: true,
      action: "deactivated",
      itemId,
      status: "paused",
      mercadolibre: pauseBody,
      tokenRefreshed,
    });
  }

  const psRes = await sb
    .from("product_sizes")
    .select("sizes(label)")
    .eq("product_id", productId);
  if (psRes.error) {
    console.warn("[ML] product_sizes:", psRes.error.message);
  }
  const psRows = psRes.error ? [] : psRes.data;

  const pcRes = await sb
    .from("product_colors")
    .select("colors(label)")
    .eq("product_id", productId);
  if (pcRes.error) {
    console.warn("[ML] product_colors:", pcRes.error.message);
  }
  const pcRows = pcRes.error ? [] : pcRes.data;

  const { data: media } = await sb
    .from("product_media")
    .select("url,is_cover")
    .eq("product_id", productId)
    .order("is_cover", { ascending: false });

  const sourceUrls = (media || [])
    .map((m: { url: string }) => m.url)
    .filter(Boolean)
    .slice(0, 12) as string[];

  const uploadToMlEnv = (Deno.env.get("ML_UPLOAD_PICTURES_TO_ML") ?? "true").trim().toLowerCase();
  const uploadPicturesToMl =
    uploadToMlEnv !== "false" && uploadToMlEnv !== "0" && uploadToMlEnv !== "no";

  let picturesForItem: Array<{ source: string } | { id: string }> = sourceUrls.map((source) => ({
    source,
  }));
  /** IDs ML o URLs según doc; tope 10 para variaciones. */
  let variationPictureIds: string[] = sourceUrls.slice(0, 10);

  let pictureUploadMeta: {
    mode: "source" | "ml_upload";
    attempted: number;
    uploaded: number;
  } = {
    mode: "source",
    attempted: sourceUrls.length,
    uploaded: 0,
  };

  if (mlToken && sourceUrls.length && uploadPicturesToMl) {
    const uploadedIds: string[] = [];
    for (const url of sourceUrls) {
      const id = await uploadPictureToMl(mlToken, url);
      if (id) uploadedIds.push(id);
    }
    pictureUploadMeta = {
      mode: "ml_upload",
      attempted: sourceUrls.length,
      uploaded: uploadedIds.length,
    };
    if (uploadedIds.length > 0) {
      picturesForItem = uploadedIds.map((id) => ({ id }));
      variationPictureIds = uploadedIds.slice(0, 10);
    }
  }

  const siteId = (body.siteId || "MCO").trim();
  const currencyId = siteId === "MCO" ? "COP" : "COP";

  const titleForMl = String(product.name || product.ref || "Producto").slice(0, 60);

  let categoryId =
    (body.categoryId || "").trim() ||
    (Deno.env.get("ML_DEFAULT_CATEGORY_ID_MCO") ?? "").trim();
  let predictorMeta: {
    from_predictor: boolean;
    domain_id?: string;
    domain_name?: string;
    category_name?: string;
    predictor_attributes?: PredictorHit["attributes"];
  } | null = null;

  const skipPredictor = (Deno.env.get("ML_SKIP_DOMAIN_DISCOVERY") ?? "")
    .trim()
    .toLowerCase() === "true" ||
    (Deno.env.get("ML_SKIP_DOMAIN_DISCOVERY") ?? "").trim() === "1";

  if (!categoryId && mlToken && !skipPredictor) {
    const pred = await predictCategoryFromTitle(mlToken, siteId, titleForMl);
    if (pred) {
      categoryId = pred.category_id;
      predictorMeta = {
        from_predictor: true,
        domain_id: pred.hit.domain_id,
        domain_name: pred.hit.domain_name,
        category_name: pred.hit.category_name,
        predictor_attributes: pred.hit.attributes,
      };
    }
  }

  /** "3" = 3 cuotas mismo precio (tag 3x_campaign + gold_pro; puede fallar si ML no permite la campaña). "none" = sin tag. */
  const installmentsSamePrice = (
    Deno.env.get("ML_INSTALLMENTS_SAME_PRICE") ?? "none"
  ).trim()
    .toLowerCase();
  const want3xCampaign =
    installmentsSamePrice === "3" || installmentsSamePrice === "3x";

  const plainDescription = String(product.description || "")
    .trim()
    .slice(0, 50000);

  const envListingType = (Deno.env.get("ML_LISTING_TYPE_ID") ?? "").trim();
  // 3x_campaign exige gold_pro en la doc ML; si pedís 3 cuotas, no uses gold_special.
  let listingTypeId = envListingType || "gold_special";
  if (want3xCampaign) {
    listingTypeId =
      envListingType && envListingType !== "gold_special"
        ? envListingType
        : "gold_pro";
  }

  const predictedAttrs = predictorMeta?.predictor_attributes
    ? mapPredictorAttributes(predictorMeta.predictor_attributes)
    : [];

  const itemConditionKey = resolveItemConditionKey();
  let mergedAttributes = mergeItemAttributes(predictedAttrs, itemConditionKey);

  const sizeLabelsFromDb = (psRows ?? [])
    .map((r: { sizes?: { label?: string } | null }) => r?.sizes?.label)
    .filter((x): x is string => typeof x === "string" && String(x).trim() !== "")
    .map((s) => s.trim());

  const defaultSizeEnv = (Deno.env.get("ML_DEFAULT_SIZE") ?? "").trim();
  const sizeOverride = (body.size ?? "").trim();
  let effectiveSizeLabels: string[] = [];
  if (sizeOverride) {
    effectiveSizeLabels = [sizeOverride];
  } else if (sizeLabelsFromDb.length > 0) {
    effectiveSizeLabels = sizeLabelsFromDb;
  } else if (defaultSizeEnv) {
    effectiveSizeLabels = [defaultSizeEnv];
  }

  let catalogDomain = (predictorMeta?.domain_id ?? "").trim() || null;
  if (!catalogDomain && categoryId) {
    catalogDomain = await fetchCategoryCatalogDomain(categoryId);
  }

  let categoryAttrDefs: CatAttrDef[] = [];
  if (categoryId) {
    categoryAttrDefs = await fetchCategoryAttributesPublic(categoryId);
  }

  let genderAttr: MlDomainAttribute | null = null;
  let sizeAttr: MlDomainAttribute | null = null;
  if (mlToken && catalogDomain) {
    const [g, s] = await Promise.all([
      fetchDomainAttribute(mlToken, catalogDomain, "GENDER"),
      fetchDomainAttribute(mlToken, catalogDomain, "SIZE"),
    ]);
    genderAttr = g;
    sizeAttr = s;
  }

  const envGender = (Deno.env.get("ML_GENDER_VALUE_ID") ?? "").trim();
  const bodyGender = (body.genderValueId ?? "").trim();
  const chosenGender = bodyGender || envGender;
  if (genderAttr?.values?.length) {
    const picked = pickGenderValueId(genderAttr.values, titleForMl, chosenGender);
    if (picked) {
      mergedAttributes = upsertAttribute(mergedAttributes, {
        id: "GENDER",
        value_id: picked.value_id,
      });
    }
  }
  if (!mergedAttributes.some((a) => a.id === "GENDER") && chosenGender && /^\d+$/.test(chosenGender)) {
    mergedAttributes = upsertAttribute(mergedAttributes, {
      id: "GENDER",
      value_id: chosenGender,
    });
  }

  const bodyBrand = (body.brandValueId ?? "").trim();
  const envBrand = (Deno.env.get("ML_BRAND_VALUE_ID") ?? "").trim();
  const brandVal = bodyBrand || envBrand;
  if (brandVal) {
    mergedAttributes = /^\d+$/.test(brandVal)
      ? upsertAttribute(mergedAttributes, { id: "BRAND", value_id: brandVal })
      : upsertAttribute(mergedAttributes, { id: "BRAND", value_name: brandVal });
  }
  if (!mergedAttributes.some((a) => a.id === "BRAND")) {
    const defaultBrand =
      (Deno.env.get("ML_BRAND_VALUE_NAME") ?? Deno.env.get("ML_DEFAULT_BRAND") ?? "").trim();
    if (defaultBrand) {
      mergedAttributes = upsertAttribute(mergedAttributes, {
        id: "BRAND",
        value_name: defaultBrand,
      });
    }
  }

  const envModel = (Deno.env.get("ML_DEFAULT_MODEL") ?? "").trim();
  const modelName = envModel ||
    String(product.name || product.ref || "Modelo").slice(0, 255);
  mergedAttributes = upsertAttribute(mergedAttributes, {
    id: "MODEL",
    value_name: modelName,
  });

  const colorLabelsFromDb = (pcRows ?? [])
    .map((r: { colors?: { label?: string } | null }) => r?.colors?.label)
    .filter((x): x is string => typeof x === "string" && String(x).trim() !== "")
    .map((s) => s.trim());
  const firstColorLabel = colorLabelsFromDb[0];
  const envColorId = (Deno.env.get("ML_COLOR_VALUE_ID") ?? "").trim();
  const envColorName = (Deno.env.get("ML_COLOR_VALUE_NAME") ?? "").trim();
  const colorResolved = pickColorAttribute(
    categoryAttrDefs,
    firstColorLabel,
    envColorId,
    envColorName,
  );

  const bodyGrid = (body.sizeGridId ?? "").trim();
  const sizeGridId = bodyGrid ||
    (Deno.env.get("ML_SIZE_GRID_ID") ??
      Deno.env.get("ML_DEFAULT_SIZE_GRID_ID_MCO") ?? "").trim();
  mergedAttributes = appendAttributeIfMissing(
    mergedAttributes,
    "SIZE_GRID_ID",
    sizeGridId,
  );

  if (effectiveSizeLabels.length <= 1) {
    mergedAttributes = upsertAttribute(mergedAttributes, colorResolved);
    const fabricIdSingle = (Deno.env.get("ML_FABRIC_DESIGN_VALUE_ID") ?? "").trim();
    if (fabricIdSingle && /^\d+$/.test(fabricIdSingle)) {
      mergedAttributes = upsertAttribute(mergedAttributes, {
        id: "FABRIC_DESIGN",
        value_id: fabricIdSingle,
      });
    }
  }

  if (effectiveSizeLabels.length > 1) {
    mergedAttributes = mergedAttributes.filter((a) =>
      a.id !== "SIZE" && a.id !== "SIZE_GRID_ROW_ID" && a.id !== "COLOR" &&
      a.id !== "FABRIC_DESIGN"
    );
  }

  const rowMapEnv = parseJsonEnvMap(Deno.env.get("ML_SIZE_GRID_ROW_MAP"));
  let rowMapBody: Record<string, string> = {};
  if (body.sizeGridRowMap) {
    if (typeof body.sizeGridRowMap === "string") {
      rowMapBody = parseJsonEnvMap(body.sizeGridRowMap);
    } else {
      for (const [k, v] of Object.entries(body.sizeGridRowMap)) {
        if (typeof v === "string" && v.trim()) rowMapBody[normalizeText(k)] = v.trim();
      }
    }
  }
  const rowMap: Record<string, string> = { ...rowMapEnv, ...rowMapBody };

  const envRowOnly = (Deno.env.get("ML_SIZE_GRID_ROW_ID") ?? "").trim();
  const bodyRowOnly = (body.sizeGridRowId ?? "").trim();

  function rowIdForLabel(label: string): string {
    const k = normalizeText(label);
    if (rowMap[k]) return rowMap[k];
    if (rowMap[label.trim()]) return rowMap[label.trim()];
    return "";
  }

  if (sizeGridId && effectiveSizeLabels.length > 1) {
    const missing = effectiveSizeLabels.filter((l) => !rowIdForLabel(l));
    if (missing.length) {
      return json({
        ok: false,
        error:
          "Moda (varias tallas): definí ML_SIZE_GRID_ROW_MAP en secrets (JSON talla→row id) o sizeGridRowMap en el body",
        fashionMissingRowForSizes: missing,
        catalogDomain,
        sizeGridId,
      }, 400);
    }
  }

  const fashionWarnings: string[] = [];
  if (
    pictureUploadMeta.mode === "ml_upload" &&
    pictureUploadMeta.attempted > 0 &&
    pictureUploadMeta.uploaded < pictureUploadMeta.attempted
  ) {
    fashionWarnings.push(
      `Solo ${pictureUploadMeta.uploaded}/${pictureUploadMeta.attempted} fotos subieron a ML; revisa URLs accesibles o logs`,
    );
  }
  if (sizeGridId && effectiveSizeLabels.length === 0) {
    fashionWarnings.push(
      "Sin tallas en el producto: añade tallas en el ERP o ML_DEFAULT_SIZE para cumplir SIZE en moda",
    );
  }

  if (effectiveSizeLabels.length <= 1) {
    const singleLabel = effectiveSizeLabels[0] ?? "";
    const rowId = rowIdForLabel(singleLabel) || bodyRowOnly || envRowOnly;
    if (rowId) {
      mergedAttributes = appendAttributeIfMissing(
        mergedAttributes,
        "SIZE_GRID_ROW_ID",
        rowId,
      );
    }
    if (singleLabel) {
      const sz = pickSizeAttributeValue(sizeAttr, singleLabel);
      mergedAttributes = upsertAttribute(mergedAttributes, {
        id: "SIZE",
        ...(sz.value_id ? { value_id: sz.value_id } : { value_name: sz.value_name }),
      });
    }
  }

  mergedAttributes = omitNonModifiableAttributes(mergedAttributes);

  const priceMarkupCop = Math.max(
    0,
    Math.floor(Number((Deno.env.get("ML_PRICE_MARKUP_COP") ?? "").trim()) || 0),
  );
  const priceNum = (Number(product.price) || 0) + priceMarkupCop;
  const stockNum = Math.max(0, Math.min(99999, Number(product.stock) || 0));

  const itemDraft: Record<string, unknown> = {
    title: titleForMl,
    currency_id: currencyId,
    price: priceNum,
    buying_mode: "buy_it_now",
    listing_type_id: listingTypeId,
    pictures: picturesForItem,
    channels: ["marketplace"],
    attributes: mergedAttributes,
  };

  const shipMode = (Deno.env.get("ML_SHIPPING_MODE") ?? "me2").trim();
  const freeShipEnv = (Deno.env.get("ML_FREE_SHIPPING") ?? "").trim().toLowerCase();
  const freeShipping = freeShipEnv === "true" || freeShipEnv === "1" || freeShipEnv === "yes";
  itemDraft.shipping = { mode: shipMode, free_shipping: freeShipping };

  if (effectiveSizeLabels.length > 1) {
    const qtys = splitStock(stockNum, effectiveSizeLabels.length);
    const fabricVar = (Deno.env.get("ML_FABRIC_DESIGN_VALUE_ID") ?? "930483").trim();
    itemDraft.variations = effectiveSizeLabels.map((label, i) => {
      const sz = pickSizeAttributeValue(sizeAttr, label);
      const combo: Array<{ id: string; value_id?: string; value_name?: string }> = [
        colorResolved.value_id
          ? { id: "COLOR", value_id: colorResolved.value_id }
          : { id: "COLOR", value_name: colorResolved.value_name ?? "" },
      ];
      if (fabricVar && /^\d+$/.test(fabricVar)) {
        combo.push({ id: "FABRIC_DESIGN", value_id: fabricVar });
      }
      combo.push(
        sz.value_id
          ? { id: "SIZE", value_id: sz.value_id }
          : { id: "SIZE", value_name: sz.value_name },
      );
      const rowId = rowIdForLabel(label) || bodyRowOnly || envRowOnly;
      const varAttrs: Array<{ id: string; value_id?: string; value_name?: string }> = [];
      if (rowId) {
        varAttrs.push(
          /^\d+$/.test(rowId)
            ? { id: "SIZE_GRID_ROW_ID", value_id: rowId }
            : { id: "SIZE_GRID_ROW_ID", value_name: rowId },
        );
      }
      return {
        price: priceNum,
        available_quantity: qtys[i] ?? 0,
        attribute_combinations: combo,
        ...(variationPictureIds.length
          ? { picture_ids: variationPictureIds }
          : {}),
        ...(varAttrs.length ? { attributes: varAttrs } : {}),
      };
    });
  } else {
    itemDraft.available_quantity = stockNum;
  }

  if ((Deno.env.get("ML_USE_LEGACY_ITEM_CONDITION") ?? "").trim() === "true") {
    itemDraft.condition = itemConditionKey === "used"
      ? "used"
      : itemConditionKey === "refurbished"
      ? "not_specified"
      : "new";
  }

  const tags: string[] = [];
  if (want3xCampaign) tags.push("3x_campaign");
  if ((Deno.env.get("ML_TAG_IMMEDIATE_PAYMENT") ?? "").trim() === "true") {
    tags.push("immediate_payment");
  }
  if (tags.length) itemDraft.tags = tags;

  if (categoryId) itemDraft.category_id = categoryId;
  if (plainDescription) {
    itemDraft.description = { plain_text: plainDescription };
  }

  const fashionMeta = {
    catalogDomain,
    effectiveSizeLabels,
    sizeGridId: sizeGridId || null,
    variationMode: effectiveSizeLabels.length > 1 ? "multi" : "single",
    fashionWarnings,
    pictureUpload: pictureUploadMeta,
  };

  if (!mlToken || !categoryId) {
    return json({
      ok: true,
      dryRun: true,
      message: !mlToken
        ? "Configura ML_ACCESS_TOKEN / ML_REFRESH_TOKEN + ML_CLIENT_ID + ML_CLIENT_SECRET (y tabla ml_oauth_tokens opcional)."
        : !categoryId
        ? "Sin categoría: define ML_DEFAULT_CATEGORY_ID_MCO, o body.categoryId, o habilita el predictor (quita ML_SKIP_DOMAIN_DISCOVERY y usa token)."
        : "",
      categoryPrediction: predictorMeta,
      fashionMeta,
      itemDraft,
      product: { id: product.id, ref: product.ref, name: product.name },
      tokenRefreshed,
    });
  }

  const res = await fetch("https://api.mercadolibre.com/items", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mlToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(itemDraft),
  });

  const txt = await res.text();
  let mlJson: unknown = null;
  try {
    mlJson = txt ? JSON.parse(txt) : null;
  } catch {
    mlJson = { raw: txt };
  }

  if (!res.ok) {
    const missingGrid = mlPayloadIndicatesMissingSizeGrid(mlJson);
    const mlMsg = extractMlErrorMessage(mlJson);
    const errorText = missingGrid
      ? MSG_SIZE_GRID_SECRET
      : (mlMsg || "Mercado Libre rechazó la publicación");
    return json(
      {
        ok: false,
        error: errorText,
        hint: missingGrid ? "missing_size_grid_ml" : undefined,
        status: res.status,
        mercadolibre: mlJson,
        fashionMeta,
        itemDraft,
        tokenRefreshed,
      },
      200,
    );
  }

  const created = mlJson as { id?: string; permalink?: string };
  return json({
    ok: true,
    dryRun: false,
    itemId: created.id,
    permalink: created.permalink,
    categoryPrediction: predictorMeta,
    fashionMeta,
    mercadolibre: mlJson,
    tokenRefreshed,
  });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
