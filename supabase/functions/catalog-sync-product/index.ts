/**
 * Edge Function: catalog-sync-product
 *
 * ERP → Catálogo mayoristas + cola Smart Digest (catalog_push_events).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ProductIn = {
  id: string;
  ref?: string | null;
  name?: string | null;
  description?: string | null;
  price?: number | null;
  stock?: number | null;
  seccion?: string | null;
  categoria?: string | null;
  visible?: boolean | null;
  active?: boolean | null;
  updated_at?: string | null;
};

type ProductRow = {
  id: string;
  ref: string | null;
  name: string | null;
  description: string | null;
  price: number | null;
  stock: number | null;
  seccion: string | null;
  categoria: string | null;
  visible: boolean | null;
  active: boolean | null;
  updated_at: string | null;
};

type NotifyHints = {
  is_new?: boolean;
  media_changed?: boolean;
  color_covers_changed?: boolean;
  price_changed?: boolean;
  stock_changed?: boolean;
  visible_changed?: boolean;
};

type ColorCoverIn = { color?: string; url?: string };

const RELEVANT_FIELDS = new Set(["price", "stock", "visible", "active"]);

function normStr(x: unknown): string | null {
  const s = String(x ?? "").trim();
  return s ? s : null;
}

function boolOrNull(x: unknown): boolean | null {
  if (x === true) return true;
  if (x === false) return false;
  return null;
}

function numOrNull(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function uniqStrings(xs: unknown): string[] {
  const arr = Array.isArray(xs) ? xs : [];
  const out: string[] = [];
  for (const v of arr) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function normColorCovers(xs: unknown): Array<{ color: string; url: string }> {
  const arr = Array.isArray(xs) ? xs : [];
  const out: Array<{ color: string; url: string }> = [];
  for (const row of arr) {
    const color = String((row as ColorCoverIn)?.color ?? "").trim();
    const url = String((row as ColorCoverIn)?.url ?? "").trim();
    if (!color || !url) continue;
    if (out.some((x) => x.color === color)) continue;
    out.push({ color, url });
  }
  return out;
}

function diffFields(prev: ProductRow | null, next: Partial<ProductRow>): string[] {
  if (!prev) return Object.keys(next);
  const changed: string[] = [];
  (Object.keys(next) as (keyof ProductRow)[]).forEach((k) => {
    const a = (prev as any)[k];
    const b = (next as any)[k];
    if (a !== b) changed.push(String(k));
  });
  return changed;
}

function resolvePushEventType(hints: NotifyHints): string | null {
  if (hints.is_new) return "product_created";
  if (hints.media_changed) return "media_added";
  if (hints.price_changed) return "price_changed";
  if (hints.stock_changed) return "product_updated";
  if (hints.visible_changed) return "product_updated";
  return null;
}

function shouldEnqueueFromHints(hints: NotifyHints, visible: boolean | null): boolean {
  if (visible !== true) return false;
  return !!(
    hints.is_new ||
    hints.media_changed ||
    hints.price_changed ||
    hints.stock_changed ||
    hints.visible_changed
  );
}

function log(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...data }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const authz = req.headers.get("authorization") || "";
  const jwt = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7) : "";
  if (!jwt) return json({ ok: false, error: "missing_bearer_token" }, 401);
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ ok: false, error: "not_authenticated" }, 403);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const eventId = String(body?.event_id || "").trim();
  const p = (body?.product || {}) as ProductIn;
  const productId = String(p.id || "").trim();
  const notifyHints = (body?.notify_hints || {}) as NotifyHints;
  if (!eventId) return json({ ok: false, error: "event_id_required" }, 400);
  if (!productId) return json({ ok: false, error: "product.id_required" }, 400);

  log("sync_start", { event_id: eventId, product_id: productId, notify_hints: notifyHints });

  const nextRow: Partial<ProductRow> = {
    id: productId,
    ref: normStr(p.ref),
    name: normStr(p.name),
    description: normStr(p.description),
    price: numOrNull(p.price),
    stock: numOrNull(p.stock),
    seccion: normStr(p.seccion),
    categoria: normStr(p.categoria),
    visible: boolOrNull(p.visible),
    active: boolOrNull(p.active),
    updated_at: normStr(p.updated_at),
  };

  const { data: existing, error: exErr } = await supabase
    .from("products")
    .select("id,ref,name,description,price,stock,seccion,categoria,visible,active,updated_at")
    .eq("id", productId)
    .maybeSingle<ProductRow>();
  if (exErr) {
    log("sync_fail", { event_id: eventId, product_id: productId, stage: "fetch", error: exErr.message });
    return json({ ok: false, error: exErr.message }, 500);
  }

  const changedFields = diffFields(existing || null, nextRow);
  let action: "created" | "updated" | "noop" = existing ? "noop" : "created";
  if (existing && changedFields.length) action = "updated";

  if (action !== "noop") {
    const { error: upErr } = await supabase.from("products").upsert(nextRow, { onConflict: "id" });
    if (upErr) {
      log("sync_fail", { event_id: eventId, product_id: productId, stage: "upsert", error: upErr.message });
      return json({ ok: false, error: upErr.message }, 500);
    }
  }

  const images = uniqStrings(body?.images);
  let mediaChanged = false;
  if (images.length) {
    const { data: prevMedia, error: mErr } = await supabase
      .from("product_media")
      .select("url,is_cover")
      .eq("product_id", productId);
    if (mErr) {
      log("sync_fail", { event_id: eventId, product_id: productId, stage: "media_fetch", error: mErr.message });
      return json({ ok: false, error: mErr.message }, 500);
    }
    const prevUrls = (prevMedia || []).map((m: any) => String(m.url || ""));
    const prevCover = (prevMedia || []).find((m: any) => m.is_cover)?.url || "";
    const nextCover = images[0] || "";
    mediaChanged =
      prevUrls.length !== images.length ||
      prevUrls.some((u) => !images.includes(u)) ||
      (prevCover && nextCover && String(prevCover) !== String(nextCover));

    if (mediaChanged) {
      await supabase.from("product_media").delete().eq("product_id", productId);
      const rows = images.map((url, idx) => ({
        product_id: productId,
        url,
        is_cover: idx === 0,
      }));
      const { error: insErr } = await supabase.from("product_media").insert(rows);
      if (insErr) {
        log("sync_fail", { event_id: eventId, product_id: productId, stage: "media_insert", error: insErr.message });
        return json({ ok: false, error: insErr.message }, 500);
      }
    }
  }

  const colorCovers = normColorCovers(body?.color_covers);
  let colorCoversChanged = false;
  if (!colorCovers.length && notifyHints.color_covers_changed) {
    await supabase.from("product_color_media").delete().eq("product_id", productId);
    colorCoversChanged = true;
  } else if (colorCovers.length) {
    const { data: prevCovers, error: pcErr } = await supabase
      .from("product_color_media")
      .select("color_id, url, colors(label)")
      .eq("product_id", productId);
    if (pcErr) {
      log("sync_fail", { event_id: eventId, product_id: productId, stage: "color_covers_fetch", error: pcErr.message });
      return json({ ok: false, error: pcErr.message }, 500);
    }
    const prevMap = new Map<string, string>();
    for (const row of prevCovers || []) {
      const label = String((row as { colors?: { label?: string } }).colors?.label || "").trim();
      const url = String((row as { url?: string }).url || "").trim();
      if (label) prevMap.set(label, url);
    }
    const nextMap = new Map(colorCovers.map((c) => [c.color, c.url]));
    colorCoversChanged =
      prevMap.size !== nextMap.size ||
      [...nextMap.entries()].some(([k, v]) => prevMap.get(k) !== v);

    if (colorCoversChanged || !!notifyHints.color_covers_changed) {
      await supabase.from("product_color_media").delete().eq("product_id", productId);
      for (const cover of colorCovers) {
        const { data: colorRow } = await supabase
          .from("colors")
          .select("id")
          .eq("label", cover.color)
          .maybeSingle();
        if (!colorRow?.id) continue;
        const { error: insCoverErr } = await supabase.from("product_color_media").insert({
          product_id: productId,
          color_id: colorRow.id,
          url: cover.url,
        });
        if (insCoverErr) {
          log("sync_fail", { event_id: eventId, product_id: productId, stage: "color_covers_insert", error: insCoverErr.message });
          return json({ ok: false, error: insCoverErr.message }, 500);
        }
      }
    }
  }

  const serverChangedRelevant =
    action === "created"
      ? nextRow.visible === true
      : changedFields.some((f) => RELEVANT_FIELDS.has(f));
  const clientChangedRelevant = shouldEnqueueFromHints(notifyHints, nextRow.visible ?? null);
  const changedRelevant = serverChangedRelevant || clientChangedRelevant;

  let pushEnqueued = false;
  let pushEventType: string | null = null;

  if (clientChangedRelevant) {
    pushEventType = resolvePushEventType(notifyHints);
    if (pushEventType) {
      const { data: existingEvent } = await supabase
        .from("catalog_push_events")
        .select("event_id,status")
        .eq("event_id", eventId)
        .maybeSingle();

      if (!existingEvent || existingEvent.status === "error") {
        const title = String(body?.notify_title || "Nueva Colección 🌊").slice(0, 200);
        const notifyBody = String(
          body?.notify_body || `"${nextRow.name || nextRow.ref || "Producto"}" ya está en el catálogo.`,
        ).slice(0, 500);
        const link = String(body?.notify_link || "").trim() || null;

        const row = {
          event_id: eventId,
          product_id: productId,
          product_ref: nextRow.ref,
          event_type: pushEventType,
          status: "pending",
          title,
          body: notifyBody,
          link,
          payload: {
            product: p,
            images,
            notify_hints: notifyHints,
            action,
            media_changed: mediaChanged || !!notifyHints.media_changed,
          },
          attempts: 0,
          sent: 0,
          invalid: 0,
          updated_at: new Date().toISOString(),
        };

        const { error: insPushErr } = existingEvent?.status === "error"
          ? await supabase.from("catalog_push_events").update(row).eq("event_id", eventId)
          : await supabase.from("catalog_push_events").insert(row);

        if (insPushErr) {
          log("push_enqueue_fail", { event_id: eventId, product_id: productId, error: insPushErr.message });
        } else {
          pushEnqueued = true;
          log("push_enqueued", { event_id: eventId, product_id: productId, event_type: pushEventType });
        }
      } else if (existingEvent.status === "pending") {
        pushEnqueued = true;
        pushEventType = pushEventType;
      }
    }
  }

  log("sync_ok", {
    event_id: eventId,
    product_id: productId,
    action,
    changedRelevant,
    changedFields,
    mediaChanged,
    pushEnqueued,
    pushEventType,
  });

  return json({
    ok: true,
    event_id: eventId,
    action,
    productId,
    changedRelevant,
    pushEnqueued,
    pushEventType,
  });
});
