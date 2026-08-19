/**
 * Edge Function: google-merchant-sync
 *
 * Sincroniza un producto del ERP con Google Merchant Center (Content API v2.1).
 * POST https://shoppingcontent.googleapis.com/content/v2.1/{merchantId}/products
 * — `products.insert` sustituye si ya existe el mismo channel + contentLanguage +
 *   offerId + targetCountry.
 *
 * Secrets (Supabase → Edge Functions):
 * - GOOGLE_MERCHANT_ID — ID numérico de la cuenta Merchant (no usar la multicuenta raíz).
 * - GOOGLE_SERVICE_ACCOUNT_JSON — JSON de cuenta de servicio (Google Cloud). En Windows CMD puede corromperse por `%` en URLs.
 * - GOOGLE_SERVICE_ACCOUNT_JSON_B64 — mismo JSON en Base64 (UTF-8); **recomendado** si subes por CLI/script (evita corrupción). Si existe, tiene prioridad sobre el JSON en claro.
 * - GOOGLE_PRODUCT_BASE_URL — Origen de enlaces públicos HTTPS (catálogo web / PDP).
 *
 * Opcionales (alineados con la guía products.insert / insert.py de Google):
 * - GOOGLE_PRODUCT_LINK_MODE — "query_id" (default) | "path_ref" | "template"
 * - GOOGLE_PRODUCT_LINK_TEMPLATE — modo template: ej. https://tu-dominio.com/p/__REF__ o ?pid=__ID__
 * - GOOGLE_CONTENT_LANGUAGE — default "es"
 * - GOOGLE_TARGET_COUNTRY — default "CO" (ISO 3166-1 alpha-2)
 * - GOOGLE_CHANNEL — default "online"
 * - GOOGLE_BRAND — marca (recomendada si no envías GTIN: usa identifierExists=false + mpn)
 * - GOOGLE_PRODUCT_CATEGORY — taxonomía Google, ej. "Apparel & Accessories > Clothing"
 * - GOOGLE_SHIPPING_JSON — array JSON de envíos (como insert.py); si vacío, se arma uno mínimo a CO
 * - GOOGLE_SHIPPING_SERVICE — nombre del servicio si no usas JSON (default "Envío estándar")
 * - GOOGLE_SHIPPING_PRICE_VALUE / GOOGLE_SHIPPING_PRICE_CURRENCY — precio envío (default 0 COP)
 * - GOOGLE_SHIPPING_WEIGHT_VALUE / GOOGLE_SHIPPING_WEIGHT_UNIT — ej. "300" y "g" (como el sample en gramos)
 * - GOOGLE_MPN_FROM_REF — "true" (default): envía mpn desde la referencia del ERP cuando no hay GTIN
 * - GOOGLE_FEED_LABEL — opcional; en cuentas multi-país suele coincidir con el país (ej. doc GB+feedLabel GB)
 * - GOOGLE_SUPPLEMENTAL_FEED_ID — si usas feed suplementario: query ?feedId= en products.insert (ver doc Google)
 *
 * En Merchant Center → Configuración → Usuarios: añade el email …@….iam.gserviceaccount.com
 * con permisos que permitan gestionar productos y vincula el Cloud project con la API habilitada
 * "Content API for Shopping".
 *
 * Body desde el navegador: { productId: "<uuid>", gtin?: "770..." } (gtin opcional 8–14 dígitos).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import * as jose from "npm:jose@5.9.6";
import { ensureColombianOriginEs } from "../_shared/colombian_origin_copy.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ProductRow = {
  id: string;
  ref: string | null;
  name: string | null;
  description: string | null;
  price: number | null;
  stock: number | null;
  visible: boolean | null;
  seccion: string | null;
  categoria: string | null;
  active: boolean | null;
};

type MediaRow = { url: string; is_cover: boolean | null };

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** offerId: 1–50 chars, alfanumérico + _ y - */
function offerIdFromProduct(ref: string | null, id: string): string {
  const raw = (ref && ref.trim()) ? ref.trim() : id.replace(/-/g, "");
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  return (safe || id.replace(/-/g, "").slice(0, 50)) || "item";
}

function titleFromProduct(name: string | null, ref: string | null): string {
  const base = (name && name.trim()) ? name.trim() : (ref || "Producto").trim();
  return base.slice(0, 150);
}

function descriptionFromProduct(
  description: string | null,
  name: string | null,
): string {
  const plain = stripHtml(description || "") || (name || "Sin descripción");
  return ensureColombianOriginEs(plain, 5000);
}

function priceValueCOP(price: number | null): string {
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return "0";
  return String(Math.round(n));
}

function pickImageUrls(media: MediaRow[]): string[] {
  const rows = [...media].sort((a, b) => {
    if (a.is_cover && !b.is_cover) return -1;
    if (!a.is_cover && b.is_cover) return 1;
    return 0;
  });
  const urls: string[] = [];
  for (const r of rows) {
    const u = typeof r.url === "string" ? r.url.trim() : "";
    if (!u) continue;
    if (!/^https:\/\//i.test(u)) continue;
    if (!urls.includes(u)) urls.push(u);
    if (urls.length >= 10) break;
  }
  return urls;
}

function normalizeGtin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.replace(/\D/g, "");
  if (d.length >= 8 && d.length <= 14) return d;
  return null;
}

function mpnFromRef(ref: string | null, offerId: string): string {
  const s = (ref && ref.trim()) ? ref.trim() : offerId;
  return s.slice(0, 70);
}

/** shipping[] como en insert.py: country, service, price { value, currency } */
function buildShippingPayload(
  targetCountry: string,
  serviceName: string,
  priceValue: string,
  priceCurrency: string,
  shippingJsonRaw: string,
): Record<string, unknown>[] {
  const trimmed = shippingJsonRaw.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as Record<string, unknown>[];
      }
    } catch {
      /* fall through */
    }
  }
  return [{
    country: targetCountry,
    service: serviceName,
    price: {
      value: priceValue,
      currency: priceCurrency,
    },
  }];
}

function buildProductLink(
  baseUrl: string,
  mode: string,
  template: string,
  productId: string,
  ref: string | null,
): string {
  const tid = encodeURIComponent(productId);
  const refEsc = encodeURIComponent((ref || "").trim());
  const refSan = encodeURIComponent(
    String(ref || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80),
  );
  if (mode === "template" && template.trim()) {
    return template
      .replace(/__ID__/g, tid)
      .replace(/__REF__/g, refSan || tid);
  }
  const base = baseUrl.replace(/\/$/, "");
  if (mode === "path_ref") {
    return refEsc
      ? `${base}/${refEsc}`
      : `${base}/${tid}`;
  }
  /** Si la base ya lleva query (?type=public), usar &id= en lugar de ?id= */
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}id=${tid}`;
}

/** Base64 evita que Windows CMD altere `%40` etc. dentro del JSON al pasar por la línea de comandos. */
function resolveGoogleServiceAccountJson():
  | { json: string }
  | { error: string } {
  const saB64 = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON_B64") || "").trim();
  const saPlain = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();

  if (saB64) {
    try {
      const clean = saB64.replace(/\s+/g, "");
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      let s = new TextDecoder("utf-8").decode(bytes);
      if (s.length > 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      return { json: s };
    } catch {
      return { error: "GOOGLE_SERVICE_ACCOUNT_JSON_B64 no es Base64 válido" };
    }
  }

  let s = saPlain.trim();
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return { json: s };
}

async function getGoogleContentAccessToken(
  serviceAccountJson: string,
): Promise<{ token: string } | { error: string }> {
  let cred: { client_email?: string; private_key?: string };
  let raw = serviceAccountJson.trim();
  /** BOM UTF-8 (Bloc de notas / copias desde Excel) rompe JSON.parse */
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try {
    cred = JSON.parse(raw);
  } catch {
    return {
      error:
        "Credencial de Google no es JSON válido. En Dashboard → Secrets pega el .json sin texto extra, o usa el secret GOOGLE_SERVICE_ACCOUNT_JSON_B64 (recomendado en Windows: scripts/set-google-service-account-secret.ps1 evita que CMD corrompa % en el JSON).",
    };
  }
  const email = cred.client_email;
  let pkPem = cred.private_key;
  if (!email || !pkPem) {
    return {
      error:
        "Faltan client_email o private_key en la cuenta de servicio (JSON o B64)",
    };
  }
  if (pkPem.includes("\\n")) pkPem = pkPem.replace(/\\n/g, "\n");
  try {
    const pk = await jose.importPKCS8(pkPem, "RS256");
    const jwt = await new jose.SignJWT({
      scope: "https://www.googleapis.com/auth/content",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(email)
      .setSubject(email)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(pk);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) {
      const msg =
        typeof tokenJson.error_description === "string"
          ? tokenJson.error_description
          : typeof tokenJson.error === "string"
          ? tokenJson.error
          : JSON.stringify(tokenJson);
      return { error: `OAuth Google: ${msg}` };
    }
    const access = tokenJson.access_token;
    if (typeof access !== "string" || !access) {
      return { error: "OAuth Google: sin access_token" };
    }
    return { token: access };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Firma/token Google: ${msg}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let body: { productId?: string; gtin?: string; action?: "upsert" | "delete" };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const productId = typeof body.productId === "string"
    ? body.productId.trim()
    : "";
  if (!productId) {
    return json({ ok: false, error: "productId requerido" }, 400);
  }
  const action = body.action === "delete" ? "delete" : "upsert";

  const gtinFromClient = normalizeGtin(body.gtin);

  const merchantId = (Deno.env.get("GOOGLE_MERCHANT_ID") || "").trim();
  const saResolved = resolveGoogleServiceAccountJson();
  if ("error" in saResolved) {
    return json({ ok: false, error: saResolved.error }, 200);
  }
  const saJson = saResolved.json.trim();
  const baseUrl = (Deno.env.get("GOOGLE_PRODUCT_BASE_URL") || "").trim();
  const linkMode = (Deno.env.get("GOOGLE_PRODUCT_LINK_MODE") || "query_id")
    .trim()
    .toLowerCase();
  const linkTemplate = (Deno.env.get("GOOGLE_PRODUCT_LINK_TEMPLATE") || "")
    .trim();
  const contentLanguage = (Deno.env.get("GOOGLE_CONTENT_LANGUAGE") || "es")
    .trim() || "es";
  const targetCountry = (Deno.env.get("GOOGLE_TARGET_COUNTRY") || "CO")
    .trim()
    .toUpperCase() || "CO";
  const channel = (Deno.env.get("GOOGLE_CHANNEL") || "online").trim() ||
    "online";
  const brand = (Deno.env.get("GOOGLE_BRAND") || "").trim();
  const googleProductCategory = (Deno.env.get("GOOGLE_PRODUCT_CATEGORY") || "")
    .trim();
  const shippingJsonRaw = (Deno.env.get("GOOGLE_SHIPPING_JSON") || "").trim();
  const shippingService = (Deno.env.get("GOOGLE_SHIPPING_SERVICE") ||
    "Envío estándar").trim();
  const shipPriceVal = (Deno.env.get("GOOGLE_SHIPPING_PRICE_VALUE") || "0")
    .trim();
  const shipPriceCur = (Deno.env.get("GOOGLE_SHIPPING_PRICE_CURRENCY") || "COP")
    .trim()
    .toUpperCase();
  const shipWeightVal = (Deno.env.get("GOOGLE_SHIPPING_WEIGHT_VALUE") || "300")
    .trim();
  const shipWeightUnit = (Deno.env.get("GOOGLE_SHIPPING_WEIGHT_UNIT") || "grams")
    .trim();
  const mpnFromRefEnv = (Deno.env.get("GOOGLE_MPN_FROM_REF") || "true")
    .trim()
    .toLowerCase();
  const useMpnFromRef = mpnFromRefEnv !== "false" && mpnFromRefEnv !== "0";
  const feedLabelRaw = (Deno.env.get("GOOGLE_FEED_LABEL") || "").trim();
  const supplementalFeedId = (Deno.env.get("GOOGLE_SUPPLEMENTAL_FEED_ID") || "")
    .trim();

  if (!merchantId || !saJson || (action === "upsert" && !baseUrl)) {
    return json({
      ok: true,
      dryRun: true,
      message:
        "Faltan GOOGLE_MERCHANT_ID, GOOGLE_SERVICE_ACCOUNT_JSON (o _B64) o GOOGLE_PRODUCT_BASE_URL en secrets.",
      preview: {
        contentLanguage,
        targetCountry,
        channel,
        linkMode,
        feedLabel: feedLabelRaw || undefined,
        supplementalFeedId: supplementalFeedId || undefined,
      },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return json({
      ok: false,
      error: "Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno",
    }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: product, error: pErr } = await admin
    .from("products")
    .select(
      "id, ref, name, description, price, stock, visible, seccion, categoria, active",
    )
    .eq("id", productId)
    .maybeSingle();

  if (pErr) return json({ ok: false, error: pErr.message }, 500);
  if (!product) return json({ ok: false, error: "Producto no encontrado" }, 404);

  const row = product as ProductRow;

  const offerId = offerIdFromProduct(row.ref, row.id);
  const tokenRes = await getGoogleContentAccessToken(saJson);
  if ("error" in tokenRes) {
    return json({ ok: false, error: tokenRes.error }, 200);
  }

  if (action === "delete") {
    if (row.active !== false) {
      return json({
        ok: false,
        error: "El producto debe estar archivado antes de eliminarlo de Google Merchant",
      }, 409);
    }
    const restId = `${channel}:${contentLanguage}:${targetCountry}:${offerId}`;
    const deleteUrl =
      `https://shoppingcontent.googleapis.com/content/v2.1/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(restId)}`;
    let deleteRes: Response;
    try {
      deleteRes = await fetch(deleteUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenRes.token}` },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ ok: false, error: `Red Google: ${msg}` }, 502);
    }
    const deleteText = await deleteRes.text();
    if (!deleteRes.ok && deleteRes.status !== 404) {
      return json({
        ok: false,
        error: deleteText.slice(0, 1200) || `Google Merchant HTTP ${deleteRes.status}`,
        googleStatus: deleteRes.status,
        offerId,
      }, 200);
    }
    return json({
      ok: true,
      action: "deleted",
      offerId,
      googleProductRestId: restId,
      alreadyAbsent: deleteRes.status === 404,
    });
  }

  const { data: mediaRows, error: mErr } = await admin
    .from("product_media")
    .select("url, is_cover")
    .eq("product_id", productId);

  if (mErr) return json({ ok: false, error: mErr.message }, 500);

  const images = pickImageUrls((mediaRows ?? []) as MediaRow[]);
  if (images.length === 0) {
    return json({
      ok: false,
      error:
        "Google Merchant exige al menos una imagen HTTPS en product_media (portada o galería).",
    }, 200);
  }

  const productLink = buildProductLink(
    baseUrl,
    linkMode,
    linkTemplate,
    row.id,
    row.ref,
  );
  if (!/^https:\/\//i.test(productLink)) {
    return json({
      ok: false,
      error:
        "El enlace del producto debe ser HTTPS (revisa GOOGLE_PRODUCT_BASE_URL o template).",
    }, 200);
  }

  const stockNum = Number(row.stock);
  const availability = Number.isFinite(stockNum) && stockNum > 0
    ? "in stock"
    : "out of stock";

  const gtin = gtinFromClient;
  if (!gtin && !brand) {
    return json({
      ok: false,
      error:
        "Sin GTIN en el cuerpo de la petición: configura GOOGLE_BRAND en secrets (marca + MPN) o envía gtin desde el cliente.",
    }, 200);
  }

  const payload: Record<string, unknown> = {
    offerId,
    title: titleFromProduct(row.name, row.ref),
    description: descriptionFromProduct(row.description, row.name),
    link: productLink,
    imageLink: images[0],
    contentLanguage,
    targetCountry,
    channel,
    availability,
    condition: "new",
    price: {
      value: priceValueCOP(row.price),
      currency: "COP",
    },
  };

  if (images.length > 1) {
    payload.additionalImageLinks = images.slice(1);
  }

  if (googleProductCategory) {
    payload.googleProductCategory = googleProductCategory;
  }

  if (gtin) {
    payload.gtin = gtin;
    payload.identifierExists = true;
  } else {
    payload.identifierExists = false;
    payload.brand = brand;
    if (useMpnFromRef) {
      payload.mpn = mpnFromRef(row.ref, offerId);
    }
  }
  if (brand) {
    payload.brand = brand;
  }

  const shipping = buildShippingPayload(
    targetCountry,
    shippingService,
    shipPriceVal,
    shipPriceCur,
    shippingJsonRaw,
  );
  payload.shipping = shipping;

  payload.shippingWeight = {
    value: shipWeightVal,
    unit: shipWeightUnit,
  };

  if (feedLabelRaw) {
    payload.feedLabel = feedLabelRaw;
  } else if (supplementalFeedId) {
    /** Doc Google: con feed suplementario suele enviarse feedLabel (ej. mismo que targetCountry). */
    payload.feedLabel = targetCountry;
  }

  const url =
    `https://shoppingcontent.googleapis.com/content/v2.1/${encodeURIComponent(merchantId)}/products` +
    (supplementalFeedId
      ? `?feedId=${encodeURIComponent(supplementalFeedId)}`
      : "");

  let gRes: Response;
  try {
    gRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenRes.token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: `Red Google: ${msg}` }, 502);
  }

  const text = await gRes.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!gRes.ok) {
    return json(
      {
        ok: false,
        error: typeof parsed === "object" && parsed !== null &&
            "error" in parsed
          ? JSON.stringify((parsed as { error: unknown }).error).slice(0, 1200)
          : (typeof parsed === "string"
            ? parsed.slice(0, 800)
            : `Google Merchant HTTP ${gRes.status}`),
        googleStatus: gRes.status,
        googleBody: parsed,
        sentOfferId: offerId,
      },
      200,
    );
  }

  const restId =
    `${channel}:${contentLanguage}:${targetCountry}:${offerId}`;

  return json({
    ok: true,
    offerId,
    /** Para products.get: GET .../products/{online:es:CO:offerId} (codificar en URL). */
    googleProductRestId: restId,
    merchantCenter: parsed,
  });
});
