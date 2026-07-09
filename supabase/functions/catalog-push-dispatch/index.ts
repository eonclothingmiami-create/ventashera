/**
 * Smart Digest Push: agrupa eventos ERP pending y envía FCM (digest o individual).
 * Invocar con cron o manualmente (service role / secret).
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIREBASE_SERVICE_ACCOUNT
 * Opcional: CATALOG_DISPATCH_SECRET (header x-catalog-dispatch-secret)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { broadcastFcm } from "../_shared/fcm_broadcast.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-catalog-dispatch-secret",
};

const DIGEST_TYPES = new Set([
  "product_created",
  "price_changed",
  "media_added",
  "product_updated",
]);

type PushEventRow = {
  event_id: string;
  event_type: string | null;
  status: string;
  product_ref: string | null;
  title: string | null;
  body: string | null;
  link: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  attempts: number | null;
};

type PushEvent = PushEventRow & { event_type: string };

function resolveEventType(row: PushEventRow): string {
  const col = (row.event_type || "").trim();
  if (DIGEST_TYPES.has(col)) return col;
  const p = row.payload || {};
  const fromPayload = String(p.event_type || p.type || "").trim();
  if (DIGEST_TYPES.has(fromPayload)) return fromPayload;
  const fromId = (row.event_id.split(":")[0]?.split("-")[0] || "").trim();
  if (DIGEST_TYPES.has(fromId)) return fromId;
  return "";
}

function normalizeEvent(row: PushEventRow): PushEvent | null {
  const event_type = resolveEventType(row);
  if (!event_type) return null;
  return { ...row, event_type };
}

type DigestSettings = {
  digest_enabled: boolean;
  digest_threshold: number;
  digest_window_minutes: number;
  catalog_base_url: string;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function windowBounds(iso: string, windowMinutes: number): { start: Date; end: Date; key: string } {
  const d = new Date(iso);
  const ms = windowMinutes * 60 * 1000;
  const startMs = Math.floor(d.getTime() / ms) * ms;
  const start = new Date(startMs);
  const end = new Date(startMs + ms);
  const key = `${start.toISOString()}__${end.toISOString()}`;
  return { start, end, key };
}

function detailLabel(name: string, ref: string): string {
  const n = String(name || "").trim();
  const r = String(ref || "").trim();
  if (n) return n;
  return r || "este modelo";
}

function salesPushCopy(
  eventType: string,
  name: string,
  ref: string,
): { title: string; body: string } {
  const label = detailLabel(name, ref);
  switch (eventType) {
    case "price_changed":
      return {
        title: "💝 Oferta por tiempo limitado",
        body: `${label} con precio especial. Llévalo hoy y ahorra antes de que vuelva a subir.`,
      };
    case "media_added":
      return {
        title: "✨ Así te vas a ver increíble",
        body: `Nuevas fotos de ${label} — míralo, enamórate y pide el tuyo antes que se agote.`,
      };
    case "product_updated":
      return {
        title: "⚡ ¡Volvió! Corre por el tuyo",
        body: `${label} está disponible otra vez. Unidades limitadas — si lo dejas pasar, te arrepientes.`,
      };
    case "product_created":
    default:
      return {
        title: "🔥 Nuevo en Hera — ¡te lo vas a querer!",
        body: `${label} acaba de llegar. Es de esos que se agotan rápido… ¿lo ves antes que se acabe?`,
      };
  }
}

function defaultTitle(type: string): string {
  return salesPushCopy(type, "", "").title;
}

function defaultBody(ev: PushEvent): string {
  const ref = ev.product_ref || (ev.payload?.product_ref as string) || "";
  const name =
    (ev.payload?.product_name as string) ||
    (ev.payload?.product as { name?: string })?.name ||
    ref ||
    "esta referencia";
  return salesPushCopy(ev.event_type, name, ref).body;
}

function eventMessage(ev: PushEvent, baseUrl: string): { title: string; body: string; link: string } {
  const link = (ev.link || (ev.payload?.link as string) || baseUrl).trim() || baseUrl;
  return {
    title: (ev.title || (ev.payload?.title as string) || defaultTitle(ev.event_type)).trim(),
    body: (ev.body || (ev.payload?.body as string) || defaultBody(ev)).trim(),
    link,
  };
}

function buildDigestBody(events: PushEvent[]): string {
  const refs = new Set<string>();
  let created = 0;
  let price = 0;
  let media = 0;
  let updated = 0;

  for (const ev of events) {
    const ref = (ev.product_ref || (ev.payload?.product_ref as string) || "").trim();
    if (ref) refs.add(ref);
    switch (ev.event_type) {
      case "product_created":
        created++;
        break;
      case "price_changed":
        price++;
        break;
      case "media_added":
        media++;
        break;
      case "product_updated":
        updated++;
        break;
    }
  }

  const total = refs.size > 0 ? refs.size : events.length;
  const parts: string[] = [];
  if (created > 0) parts.push(`✨ ${created} novedad${created === 1 ? "" : "es"}`);
  if (price > 0) parts.push(`💝 ${price} en oferta`);
  if (media > 0) parts.push(`📸 ${media} look${media === 1 ? "" : "s"} renovado${media === 1 ? "" : "s"}`);
  if (updated > 0) parts.push(`⚡ ${updated} de vuelta en stock`);

  if (parts.length === 0) {
    return `${total} novedad${total === 1 ? "" : "es"} esperándote en Hera. Entra ya y encuentra tu próximo favorito.`;
  }
  return `${total} razones para entrar hoy: ${parts.join(" · ")}. Tu próximo favorito puede estar aquí — no te lo pierdas.`;
}

async function loadSettings(supabase: ReturnType<typeof createClient>): Promise<DigestSettings> {
  const { data } = await supabase
    .from("catalog_settings")
    .select("digest_enabled, digest_threshold, digest_window_minutes, catalog_base_url")
    .eq("id", 1)
    .maybeSingle();

  return {
    digest_enabled: data?.digest_enabled !== false,
    digest_threshold: Math.max(1, Number(data?.digest_threshold) || 3),
    digest_window_minutes: Math.max(1, Number(data?.digest_window_minutes) || 10),
    catalog_base_url: String(data?.catalog_base_url || "https://eonclothingonline.com/mayoristas/")
      .trim()
      .replace(/\/?$/, "/"),
  };
}

async function digestAlreadySent(
  supabase: ReturnType<typeof createClient>,
  digestKey: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("catalog_push_dispatch_log")
    .select("id")
    .eq("digest_key", digestKey)
    .eq("mode", "digest")
    .is("error", null)
    .maybeSingle();
  return !!data;
}

async function logDispatch(
  supabase: ReturnType<typeof createClient>,
  row: {
    mode: "single" | "digest";
    digest_key: string | null;
    event_ids: string[];
    sent_count: number;
    failed_count: number;
    error: string | null;
  },
): Promise<void> {
  await supabase.from("catalog_push_dispatch_log").insert({
    mode: row.mode,
    digest_key: row.digest_key,
    event_ids: row.event_ids,
    sent_count: row.sent_count,
    failed_count: row.failed_count,
    error: row.error,
  });
}

async function markEventsSent(
  supabase: ReturnType<typeof createClient>,
  eventIds: string[],
  batchId: string,
  digestKey: string | null,
  fcm?: { sent: number; failed: number; removed_invalid: number },
): Promise<void> {
  if (eventIds.length === 0) return;
  const patch: Record<string, unknown> = {
    status: "sent",
    batch_id: batchId,
    digest_key: digestKey,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_error: null,
    error: null,
  };
  if (fcm) {
    patch.sent = fcm.sent;
    patch.invalid = fcm.removed_invalid;
  }
  await supabase.from("catalog_push_events").update(patch).in("event_id", eventIds);
}

async function markEventsError(
  supabase: ReturnType<typeof createClient>,
  eventIds: string[],
  err: string,
): Promise<void> {
  const msg = err.slice(0, 500);
  for (const eventId of eventIds) {
    const { data: ev } = await supabase
      .from("catalog_push_events")
      .select("attempts")
      .eq("event_id", eventId)
      .single();
    const attempts = (ev?.attempts ?? 0) + 1;
    await supabase
      .from("catalog_push_events")
      .update({
        status: "error",
        attempts,
        last_error: msg,
        error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("event_id", eventId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const dispatchSecret = Deno.env.get("CATALOG_DISPATCH_SECRET");
  if (dispatchSecret) {
    const h = (req.headers.get("x-catalog-dispatch-secret") || "").trim();
    if (h !== dispatchSecret.trim()) return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const settings = await loadSettings(supabase);
  const maxAttempts = 5;

  const { data: pending, error: fetchErr } = await supabase
    .from("catalog_push_events")
    .select(
      "event_id, event_type, status, product_ref, title, body, link, payload, created_at, attempts",
    )
    .in("status", ["pending", "error"])
    .lt("attempts", maxAttempts)
    .order("created_at", { ascending: true })
    .limit(500);

  if (fetchErr) return json({ error: fetchErr.message }, 500);

  const events = ((pending || []) as PushEventRow[])
    .map(normalizeEvent)
    .filter((e): e is PushEvent => e !== null);
  if (events.length === 0) {
    return json({ ok: true, processed: 0, digests: 0, singles: 0 });
  }

  const windowMin = settings.digest_window_minutes;
  const groups = new Map<string, PushEvent[]>();

  for (const ev of events) {
    const { key } = windowBounds(ev.created_at, windowMin);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ev);
  }

  let digests = 0;
  let singles = 0;
  const results: Record<string, unknown>[] = [];

  for (const [windowKey, group] of groups) {
    const useDigest =
      settings.digest_enabled && group.length >= settings.digest_threshold;

    if (useDigest) {
      const { key: digestKey } = windowBounds(group[0].created_at, windowMin);
      if (await digestAlreadySent(supabase, digestKey)) {
        const batchId = crypto.randomUUID();
        await markEventsSent(
          supabase,
          group.map((e) => e.event_id),
          batchId,
          digestKey,
        );
        results.push({
          window: windowKey,
          skipped: "digest_already_sent",
          digest_key: digestKey,
          marked_sent: group.length,
        });
        continue;
      }

      const batchId = crypto.randomUUID();
      const title = "🛍️ Novedades de hoy en Hera";
      const body = buildDigestBody(group);
      const link = settings.catalog_base_url;

      try {
        const fcm = await broadcastFcm(supabaseUrl, serviceKey, { title, body, link });
        await logDispatch(supabase, {
          mode: "digest",
          digest_key: digestKey,
          event_ids: group.map((e) => e.event_id),
          sent_count: fcm.sent,
          failed_count: fcm.failed,
          error: fcm.failed > 0 && fcm.sent === 0 ? (fcm.sample_errors[0] || "fcm_failed") : null,
        });
        await markEventsSent(
          supabase,
          group.map((e) => e.event_id),
          batchId,
          digestKey,
          fcm,
        );
        digests++;
        results.push({
          window: windowKey,
          mode: "digest",
          digest_key: digestKey,
          events: group.length,
          fcm,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logDispatch(supabase, {
          mode: "digest",
          digest_key: digestKey,
          event_ids: group.map((ev) => ev.event_id),
          sent_count: 0,
          failed_count: 0,
          error: msg,
        });
        await markEventsError(supabase, group.map((ev) => ev.event_id), msg);

        for (const ev of group) {
          try {
            const msg1 = eventMessage(ev, settings.catalog_base_url);
            const fcm1 = await broadcastFcm(supabaseUrl, serviceKey, msg1);
            const batchId1 = crypto.randomUUID();
            await logDispatch(supabase, {
              mode: "single",
              digest_key: null,
              event_ids: [ev.event_id],
              sent_count: fcm1.sent,
              failed_count: fcm1.failed,
              error: fcm1.sent === 0 ? msg : null,
            });
            if (fcm1.sent > 0) {
              await markEventsSent(supabase, [ev.event_id], batchId1, null, fcm1);
              singles++;
            }
          } catch (e2) {
            await markEventsError(
              supabase,
              [ev.event_id],
              e2 instanceof Error ? e2.message : String(e2),
            );
          }
        }
        results.push({ window: windowKey, mode: "digest_fallback", error: msg });
      }
      continue;
    }

    for (const ev of group) {
      const batchId = crypto.randomUUID();
      const msg = eventMessage(ev, settings.catalog_base_url);
      try {
        const fcm = await broadcastFcm(supabaseUrl, serviceKey, msg);
        await logDispatch(supabase, {
          mode: "single",
          digest_key: null,
          event_ids: [ev.event_id],
          sent_count: fcm.sent,
          failed_count: fcm.failed,
          error: fcm.sent === 0 ? (fcm.sample_errors[0] || "fcm_failed") : null,
        });
        if (fcm.sent > 0) {
          await markEventsSent(supabase, [ev.event_id], batchId, null, fcm);
          singles++;
        } else {
          await markEventsError(supabase, [ev.event_id], fcm.sample_errors[0] || "fcm_failed");
        }
        results.push({ event_id: ev.event_id, mode: "single", fcm });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        await logDispatch(supabase, {
          mode: "single",
          digest_key: null,
          event_ids: [ev.event_id],
          sent_count: 0,
          failed_count: 0,
          error: errMsg,
        });
        await markEventsError(supabase, [ev.event_id], errMsg);
        results.push({ event_id: ev.event_id, mode: "single", error: errMsg });
      }
    }
  }

  return json({
    ok: true,
    processed: events.length,
    windows: groups.size,
    digests,
    singles,
    settings: {
      digest_enabled: settings.digest_enabled,
      digest_threshold: settings.digest_threshold,
      digest_window_minutes: settings.digest_window_minutes,
    },
    results,
  });
});
