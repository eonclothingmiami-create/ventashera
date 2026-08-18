/**
 * Edge Function: faire-sync
 *
 * Faire External API v2 — canal wholesale aislado del ERP.
 * Acciones:
 *   account_setup   — prueba credenciales / perfil marca
 *   publish         — crea o actualiza producto + variantes (color/talla)
 *   deactivate      — retira producto en Faire
 *   sync_inventory  — stock ERP → Faire (uno o todos)
 *   pull_orders     — importa pedidos nuevos a faire_orders
 *   bulk_publish    — publica lote de activos sin mapa
 *
 * Secrets (Supabase → Edge Functions):
 *   FAIRE_ACCESS_TOKEN — token generado en Brand Portal (integración sin publicar)
 *   FAIRE_APPLICATION_ID / FAIRE_APPLICATION_SECRET — opcional (OAuth)
 *   FAIRE_DEFAULT_TAXONOMY_TYPE_ID — taxonomía Faire (requerida para publish)
 *
 * Precios: mayorista unitario = products.price COP → USD; MOQ desde faire_publish_config.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  copToUsdCents,
  getTrmSnapshot,
  shippingUnitCop,
} from "../_shared/cop_usd_fx.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-faire-cron-secret",
};

const FAIRE_API = "https://www.faire.com/external-api/v2";
const BATCH_SIZE = 20;

type Body = {
  productId?: string;
  action?: string;
  cronSecret?: string;
  limit?: number;
};

type PublishConfig = {
  moq: number;
  trm_fallback: number;
  retail_markup_cop: number;
  shipping_cop_per_kg_us: number;
  units_per_kg: number;
  default_taxonomy_type_id: string | null;
  made_in_country: string;
  auto_sync_enabled: boolean;
  cron_secret: string;
  last_order_id: string | null;
};

type ProductRow = {
  id: string;
  ref: string | null;
  name: string | null;
  description: string | null;
  price: number | null;
  stock: number | null;
  active: boolean | null;
  visible: boolean | null;
};

type MapRow = {
  product_id: string;
  faire_product_id: string | null;
  variant_map: Record<string, { faire_variant_id?: string; sku?: string }>;
  sync_status: string | null;
  last_error: string | null;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function env(name: string, fallback = ""): string {
  return (Deno.env.get(name) ?? fallback).trim();
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function slugPart(s: string, max = 24): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, max) || "VAR";
}

async function resolveAccessToken(supabase: SupabaseClient): Promise<string> {
  const fromEnv = env("FAIRE_ACCESS_TOKEN");
  if (fromEnv) return fromEnv;
  const { data } = await supabase
    .from("faire_auth")
    .select("access_token")
    .eq("id", "default")
    .maybeSingle();
  const tok = String(data?.access_token || "").trim();
  if (!tok) throw new Error("missing_faire_access_token");
  return tok;
}

function faireHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-FAIRE-ACCESS-TOKEN": token,
  };
  const appId = env("FAIRE_APPLICATION_ID");
  const appSecret = env("FAIRE_APPLICATION_SECRET");
  if (appId && appSecret) {
    headers["X-FAIRE-APP-CREDENTIALS"] = btoa(`${appId}:${appSecret}`);
    headers["X-FAIRE-OAUTH-ACCESS-TOKEN"] = token;
    delete headers["X-FAIRE-ACCESS-TOKEN"];
  }
  return headers;
}

async function faireRequest(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const res = await fetch(`${FAIRE_API}${path}`, {
    method,
    headers: faireHeaders(token),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data, text };
}

async function loadConfig(supabase: SupabaseClient): Promise<PublishConfig> {
  const { data, error } = await supabase
    .from("faire_publish_config")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    moq: Number(data?.moq) || 12,
    trm_fallback: Number(data?.cop_per_usd) || 4000,
    retail_markup_cop: Number(data?.retail_markup_cop) ?? 15000,
    shipping_cop_per_kg_us: Number(data?.shipping_cop_per_kg_us) || 250000,
    units_per_kg: Number(data?.units_per_kg) || 12,
    default_taxonomy_type_id: data?.default_taxonomy_type_id
      ? String(data.default_taxonomy_type_id)
      : env("FAIRE_DEFAULT_TAXONOMY_TYPE_ID") || null,
    made_in_country: String(data?.made_in_country || "COL"),
    auto_sync_enabled: data?.auto_sync_enabled !== false,
    cron_secret: String(data?.cron_secret || ""),
    last_order_id: data?.last_order_id ? String(data.last_order_id) : null,
  };
}

async function loadProductBundle(supabase: SupabaseClient, productId: string) {
  const { data: product, error: pErr } = await supabase
    .from("products")
    .select("id,ref,name,description,price,stock,active,visible")
    .eq("id", productId)
    .maybeSingle<ProductRow>();
  if (pErr) throw new Error(pErr.message);
  if (!product) throw new Error("product_not_found");

  const { data: media } = await supabase
    .from("product_media")
    .select("url,is_cover")
    .eq("product_id", productId)
    .order("is_cover", { ascending: false });

  const { data: colorRows } = await supabase
    .from("product_colors")
    .select("colors(label)")
    .eq("product_id", productId);

  const { data: sizeRows } = await supabase
    .from("product_sizes")
    .select("sizes(label)")
    .eq("product_id", productId);

  const colors = (colorRows || [])
    .map((r: { colors?: { label?: string } }) => String(r.colors?.label || "").trim())
    .filter(Boolean);
  const sizes = (sizeRows || [])
    .map((r: { sizes?: { label?: string } }) => String(r.sizes?.label || "").trim())
    .filter(Boolean);

  const images = (media || [])
    .map((m: { url?: string }) => String(m.url || "").trim())
    .filter((u: string) => /^https:\/\//i.test(u));

  return { product, colors, sizes, images };
}

/** Talla única / OS no cuenta como open sizing en Faire. */
function normalizeSizesForFaire(sizes: string[]): string[] {
  const list = sizes.map((s) => s.trim()).filter(Boolean);
  if (list.length === 1 && /^(unica|única|one size|os|tu|u)$/i.test(list[0])) return [];
  return list;
}

function faireRetailCents(wholesaleCents: number, retailFromCop: number): number {
  const minRetail = Math.ceil(wholesaleCents * 1.26);
  const maxRetail = Math.floor(wholesaleCents * 10);
  return Math.max(minRetail, Math.min(maxRetail, retailFromCop));
}

type VariantDraft = {
  sku: string;
  idempotence_token: string;
  options: Array<{ name: string; value: string }>;
  wholesale_cents: number;
  retail_cents: number;
  available_quantity: number;
};

function buildVariantDrafts(
  product: ProductRow,
  colors: string[],
  sizes: string[],
  cfg: PublishConfig,
  trm: number,
): VariantDraft[] {
  const ref = String(product.ref || product.id).trim();
  const unitCop = Number(product.price) || 0;
  const shipUnitCop = shippingUnitCop(cfg.shipping_cop_per_kg_us, cfg.units_per_kg);
  const wholesaleLandedCop = unitCop + shipUnitCop;
  const retailLandedCop = unitCop + Number(cfg.retail_markup_cop) + shipUnitCop;
  const wholesaleCents = copToUsdCents(wholesaleLandedCop, trm);
  const retailCents = faireRetailCents(
    wholesaleCents,
    copToUsdCents(retailLandedCop, trm),
  );
  const qty = Math.max(0, Math.floor(Number(product.stock) || 0));
  const drafts: VariantDraft[] = [];

  const push = (sku: string, options: Array<{ name: string; value: string }>) => {
    drafts.push({
      sku: sku.slice(0, 64),
      idempotence_token: `hera-${product.id}-${sku}`.slice(0, 64),
      options,
      wholesale_cents: wholesaleCents,
      retail_cents: retailCents,
      available_quantity: qty,
    });
  };

  if (colors.length && sizes.length) {
    for (const c of colors) {
      for (const s of sizes) {
        push(`${ref}-${slugPart(c)}-${slugPart(s)}`, [
          { name: "Color", value: c.slice(0, 50) },
          { name: "Size", value: s.slice(0, 50) },
        ]);
      }
    }
    return drafts;
  }
  if (colors.length) {
    for (const c of colors) {
      push(`${ref}-${slugPart(c)}`, [{ name: "Color", value: c.slice(0, 50) }]);
    }
    return drafts;
  }
  if (sizes.length) {
    for (const s of sizes) {
      push(`${ref}-${slugPart(s)}`, [{ name: "Size", value: s.slice(0, 50) }]);
    }
    return drafts;
  }
  push(ref, []);
  return drafts;
}

function variantToApi(v: VariantDraft) {
  return {
    idempotence_token: v.idempotence_token,
    sku: v.sku,
    available_quantity: v.available_quantity,
    wholesale_price_cents: v.wholesale_cents,
    retail_price_cents: v.retail_cents,
    prices: [
      {
        geo_constraint: { country: "USA" },
        wholesale_price: { amount_minor: v.wholesale_cents, currency: "USD" },
        retail_price: { amount_minor: v.retail_cents, currency: "USD" },
      },
    ],
    options: v.options,
  };
}

function variantsToApiForUpdate(
  drafts: VariantDraft[],
  existingMap: Record<string, { faire_variant_id?: string; sku?: string }>,
) {
  return drafts.map((v) => {
    const ex = existingMap[v.sku];
    if (ex?.faire_variant_id) {
      return {
        id: ex.faire_variant_id,
        wholesale_price_cents: v.wholesale_cents,
        retail_price_cents: v.retail_cents,
        available_quantity: v.available_quantity,
        prices: [
          {
            geo_constraint: { country: "USA" },
            wholesale_price: { amount_minor: v.wholesale_cents, currency: "USD" },
            retail_price: { amount_minor: v.retail_cents, currency: "USD" },
          },
        ],
      };
    }
    return variantToApi(v);
  });
}

function validateFairePublishReady(
  product: ProductRow,
  images: string[],
  cfg: PublishConfig,
  variants: VariantDraft[],
): string | null {
  if (!cfg.default_taxonomy_type_id) return "missing_taxonomy";
  if (!images.length) return "missing_images";
  if (!variants.length) return "missing_variants";
  if (!product.active) return "product_inactive";
  if (Number(product.stock) <= 0) return "no_stock";
  if (cfg.moq < 1) return "invalid_moq";
  const badPrice = variants.some((v) => v.wholesale_cents < 1 || v.retail_cents < 1);
  if (badPrice) return "invalid_prices";
  return null;
}

function buildProductPayload(
  product: ProductRow,
  variants: VariantDraft[],
  images: string[],
  cfg: PublishConfig,
  existingFaireId?: string | null,
  hasOpenSizing = false,
  existingVariantMap: Record<string, { faire_variant_id?: string; sku?: string }> = {},
) {
  const name = String(product.name || product.ref || "Product").trim().slice(0, 60);
  const desc = stripHtml(String(product.description || product.name || "")).slice(0, 3000);
  const taxonomyId = cfg.default_taxonomy_type_id;
  if (!taxonomyId) {
    throw new Error("missing_taxonomy: configura FAIRE_DEFAULT_TAXONOMY_TYPE_ID o faire_publish_config.default_taxonomy_type_id");
  }

  const payload: Record<string, unknown> = {
    idempotence_token: `hera-product-${product.id}`.slice(0, 64),
    name,
    short_description: desc.slice(0, 75),
    description: desc,
    unit_multiplier: 1,
    minimum_order_quantity: cfg.moq,
    lifecycle_state: "PUBLISHED",
    made_in_country: cfg.made_in_country,
    taxonomy_type: { id: taxonomyId },
    variants: existingFaireId
      ? variantsToApiForUpdate(variants, existingVariantMap)
      : variants.map(variantToApi),
    images: images.slice(0, 10).map((url) => ({ url })),
  };

  if (existingFaireId) {
    delete payload.idempotence_token;
  } else {
    delete payload.sale_state;
  }
  return payload;
}

async function upsertMap(
  supabase: SupabaseClient,
  productId: string,
  patch: Partial<MapRow> & { faire_product_id?: string | null },
) {
  const row = {
    product_id: productId,
    updated_at: new Date().toISOString(),
    ...patch,
  };
  const { error } = await supabase.from("faire_product_map").upsert(row, {
    onConflict: "product_id",
  });
  if (error) throw new Error(error.message);
}

function extractVariantMap(data: unknown): Record<string, { faire_variant_id: string; sku: string }> {
  const out: Record<string, { faire_variant_id: string; sku: string }> = {};
  const variants = (data as { variants?: Array<{ id?: string; sku?: string }> })?.variants || [];
  for (const v of variants) {
    const sku = String(v.sku || "").trim();
    const id = String(v.id || "").trim();
    if (sku && id) out[sku] = { faire_variant_id: id, sku };
  }
  return out;
}

async function handleAccountSetup(token: string) {
  const res = await faireRequest(token, "GET", "/brands/profile");
  if (!res.ok) {
    return json({
      ok: false,
      dryRun: true,
      error: "faire_auth_failed",
      status: res.status,
      detail: res.data,
    }, 401);
  }
  return json({ ok: true, profile: res.data });
}

async function handlePublish(
  supabase: SupabaseClient,
  token: string,
  productId: string,
  cfg: PublishConfig,
) {
  const { product, colors, sizes: rawSizes, images } = await loadProductBundle(supabase, productId);
  if (!product.active) throw new Error("product_inactive");
  if (!images.length) throw new Error("missing_images");

  const sizes = normalizeSizesForFaire(rawSizes);
  const trmSnap = await getTrmSnapshot(cfg.trm_fallback);
  const variants = buildVariantDrafts(product, colors, sizes, cfg, trmSnap.copPerUsd);
  const hasOpenSizing = sizes.length > 1;
  const policyErr = validateFairePublishReady(product, images, cfg, variants);
  if (policyErr) throw new Error(policyErr);

  const { data: existingMap } = await supabase
    .from("faire_product_map")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle<MapRow>();

  const faireProductId = existingMap?.faire_product_id || null;
  const variantMapExisting = (existingMap?.variant_map || {}) as Record<
    string,
    { faire_variant_id?: string; sku?: string }
  >;
  const payload = buildProductPayload(
    product,
    variants,
    images,
    cfg,
    faireProductId,
    hasOpenSizing,
    variantMapExisting,
  );

  let res;
  if (faireProductId) {
    res = await faireRequest(token, "PATCH", `/products/${faireProductId}`, payload);
  } else {
    res = await faireRequest(token, "POST", "/products", payload);
  }

  if (!res.ok) {
    await upsertMap(supabase, productId, {
      sync_status: "error",
      last_error: JSON.stringify(res.data).slice(0, 500),
      last_sync_at: new Date().toISOString(),
    });
    return json({
      ok: false,
      error: "faire_publish_failed",
      status: res.status,
      detail: res.data,
    }, 502);
  }

  const created = res.data as { id?: string; variants?: unknown };
  const newFaireId = String(created?.id || faireProductId || "").trim();
  const variantMap = {
    ...variantMapExisting,
    ...extractVariantMap(created),
  };

  await upsertMap(supabase, productId, {
    faire_product_id: newFaireId,
    variant_map: variantMap,
    sync_status: "published",
    last_error: null,
    last_sync_at: new Date().toISOString(),
  });

  const shipUnitCop = shippingUnitCop(cfg.shipping_cop_per_kg_us, cfg.units_per_kg);
  return json({
    ok: true,
    faireProductId: newFaireId,
    variantCount: Object.keys(variantMap).length,
    sku: variants[0]?.sku || product.ref,
    wholesaleUsd: (variants[0]?.wholesale_cents || 0) / 100,
    retailUsd: (variants[0]?.retail_cents || 0) / 100,
    moq: cfg.moq,
    pricing: {
      unitCop: Number(product.price) || 0,
      shippingUnitCop: shipUnitCop,
      trm: trmSnap.copPerUsd,
      trmSource: trmSnap.source,
    },
  });
}

async function handleDeactivate(
  supabase: SupabaseClient,
  token: string,
  productId: string,
) {
  const { data: mapRow } = await supabase
    .from("faire_product_map")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle<MapRow>();
  const faireId = mapRow?.faire_product_id;
  if (!faireId) {
    return json({ ok: true, skipped: true, reason: "not_published" });
  }

  const res = await faireRequest(token, "PATCH", `/products/${faireId}`, {
    lifecycle_state: "DRAFT",
    sale_state: "NOT_FOR_SALE",
  });

  if (!res.ok) {
    return json({ ok: false, error: "faire_deactivate_failed", detail: res.data }, 502);
  }

  await upsertMap(supabase, productId, {
    sync_status: "deactivated",
    last_sync_at: new Date().toISOString(),
  });

  return json({ ok: true, faireProductId: faireId });
}

async function syncInventoryForProduct(
  supabase: SupabaseClient,
  token: string,
  productId: string,
  cfg: PublishConfig,
) {
  const { product } = await loadProductBundle(supabase, productId);
  const { data: mapRow } = await supabase
    .from("faire_product_map")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle<MapRow>();

  if (!mapRow?.faire_product_id) {
    return { ok: false, skipped: true, reason: "not_mapped" };
  }

  const variantMap = (mapRow.variant_map || {}) as Record<
    string,
    { faire_variant_id?: string; sku?: string }
  >;
  const entries = Object.values(variantMap).filter((v) => v.faire_variant_id);
  if (!entries.length) {
    return { ok: false, skipped: true, reason: "no_variants" };
  }

  const qty = Math.max(0, Math.floor(Number(product.stock) || 0));
  const inventories = entries.map((v) => ({
    product_variant_id: v.faire_variant_id,
    on_hand_quantity: qty,
  }));

  const res = await faireRequest(token, "PATCH", "/product-inventory/by-product-variant-ids", {
    inventories,
  });

  if (!res.ok) {
    await upsertMap(supabase, productId, {
      sync_status: "inventory_error",
      last_error: JSON.stringify(res.data).slice(0, 500),
      last_sync_at: new Date().toISOString(),
    });
    return { ok: false, error: res.data };
  }

  await upsertMap(supabase, productId, {
    sync_status: "synced",
    last_error: null,
    last_sync_at: new Date().toISOString(),
  });
  return { ok: true, qty };
}

async function handleSyncInventory(
  supabase: SupabaseClient,
  token: string,
  productId: string | undefined,
  cfg: PublishConfig,
) {
  if (productId) {
    const r = await syncInventoryForProduct(supabase, token, productId, cfg);
    return json({ ok: !!r.ok, ...r });
  }

  const { data: maps } = await supabase
    .from("faire_product_map")
    .select("product_id")
    .not("faire_product_id", "is", null);

  let ok = 0;
  let fail = 0;
  let skip = 0;
  for (const row of maps || []) {
    const r = await syncInventoryForProduct(supabase, token, row.product_id, cfg);
    if (r.skipped) skip++;
    else if (r.ok) ok++;
    else fail++;
  }

  await supabase
    .from("faire_publish_config")
    .update({ last_inventory_sync_at: new Date().toISOString() })
    .eq("id", "default");

  return json({ ok: true, inventory: { ok, fail, skip, total: (maps || []).length } });
}

async function handlePullOrders(supabase: SupabaseClient, token: string, cfg: PublishConfig) {
  const res = await faireRequest(token, "GET", "/orders?limit=50&page=1");
  if (!res.ok) {
    return json({ ok: false, error: "faire_orders_failed", detail: res.data }, 502);
  }

  const orders = (res.data as { orders?: Array<Record<string, unknown>> })?.orders || [];
  let imported = 0;
  let skipped = 0;

  for (const order of orders) {
    const orderId = String(order.id || "").trim();
    if (!orderId) continue;

    const { data: exists } = await supabase
      .from("faire_orders")
      .select("id")
      .eq("faire_order_id", orderId)
      .maybeSingle();
    if (exists) {
      skipped++;
      continue;
    }

    const retailer = order.retailer as { name?: string } | undefined;
    const { error } = await supabase.from("faire_orders").insert({
      faire_order_id: orderId,
      state: String(order.state || ""),
      retailer_name: retailer?.name ? String(retailer.name) : null,
      payload: order,
    });
    if (!error) imported++;
  }

  const newestId = orders[0]?.id ? String(orders[0].id) : cfg.last_order_id;
  await supabase
    .from("faire_publish_config")
    .update({
      last_order_pull_at: new Date().toISOString(),
      last_order_id: newestId,
    })
    .eq("id", "default");

  return json({ ok: true, orders: { imported, skipped, fetched: orders.length } });
}

async function handleBulkPublish(
  supabase: SupabaseClient,
  token: string,
  cfg: PublishConfig,
  limit = BATCH_SIZE,
) {
  const { data: mapped } = await supabase
    .from("faire_product_map")
    .select("product_id")
    .not("faire_product_id", "is", null)
    .neq("faire_product_id", "");
  const mappedIds = new Set((mapped || []).map((r: { product_id: string }) => r.product_id));

  const { data: products } = await supabase
    .from("products")
    .select("id,ref")
    .eq("active", true)
    .gt("stock", 0)
    .order("ref")
    .limit(Math.min(2000, Math.max(limit * 3, 500)));

  const pending = (products || [])
    .filter((p: { id: string }) => !mappedIds.has(p.id))
    .slice(0, limit);

  const results: Array<Record<string, unknown>> = [];
  for (const p of pending) {
    try {
      const r = await handlePublish(supabase, token, p.id, cfg);
      const body = await r.json();
      results.push({ ref: p.ref, ...body });
    } catch (e) {
      results.push({ ref: p.ref, ok: false, error: String(e) });
    }
  }

  return json({
    ok: true,
    bulk: { attempted: pending.length, results },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const action = String(body.action || "publish").trim();
  const productId = body.productId ? String(body.productId).trim() : "";
  const cronActions = new Set(["sync_inventory", "pull_orders", "bulk_publish"]);

  let cfg: PublishConfig;
  try {
    cfg = await loadConfig(supabase);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }

  if (cronActions.has(action)) {
    const secret = String(body.cronSecret || req.headers.get("x-faire-cron-secret") || "");
    if (!secret || secret !== cfg.cron_secret) {
      return json({ ok: false, error: "invalid_cron_secret" }, 403);
    }
  }

  let token: string;
  try {
    token = await resolveAccessToken(supabase);
  } catch {
    return json({
      ok: false,
      dryRun: true,
      message: "Configura FAIRE_ACCESS_TOKEN en secrets de la Edge Function (Brand Portal → Integraciones → integración sin publicar).",
    });
  }

  try {
    switch (action) {
      case "account_setup":
        return await handleAccountSetup(token);
      case "publish":
        if (!productId) return json({ ok: false, error: "product_id_required" }, 400);
        return await handlePublish(supabase, token, productId, cfg);
      case "deactivate":
        if (!productId) return json({ ok: false, error: "product_id_required" }, 400);
        return await handleDeactivate(supabase, token, productId);
      case "sync_inventory":
        return await handleSyncInventory(supabase, token, productId || undefined, cfg);
      case "pull_orders":
        return await handlePullOrders(supabase, token, cfg);
      case "bulk_publish":
        return await handleBulkPublish(supabase, token, cfg, Number(body.limit) || BATCH_SIZE);
      default:
        return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
