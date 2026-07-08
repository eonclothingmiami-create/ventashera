/**
 * Reencola push FCM para productos visibles actualizados en un día (America/Bogota)
 * y dispara catalog-push-dispatch.
 *
 * POST { "date": "2026-07-07" }  // opcional, default hoy Bogota
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-catalog-dispatch-secret",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bogotaTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: { date?: string; catalog_url?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const day = String(body.date || bogotaTodayISO()).trim();
  const catalogUrl = String(body.catalog_url || "https://eonclothingonline.com/mayoristas/").trim();
  const replayTag = day.replace(/-/g, "");

  const { data: settings } = await supabase
    .from("catalog_settings")
    .select("catalog_base_url")
    .eq("id", 1)
    .maybeSingle();
  const link = String(settings?.catalog_base_url || catalogUrl).trim() || catalogUrl;

  const { data: products, error: prodErr } = await supabase
    .from("products")
    .select("id, ref, name, updated_at")
    .eq("visible", true)
    .gte("updated_at", `${day}T00:00:00-05:00`)
    .lte("updated_at", `${day}T23:59:59-05:00`)
    .order("updated_at", { ascending: false });

  if (prodErr) return json({ error: prodErr.message }, 500);

  const filtered = (products || []).filter((p) => {
    const bogota = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(p.updated_at as string));
    return bogota === day;
  });

  if (!filtered.length) {
    return json({ ok: true, date: day, enqueued: 0, message: "no_products_for_date" });
  }

  const enqueued: string[] = [];
  for (const p of filtered) {
    const shortId = String(p.id).replace(/-/g, "").slice(0, 8);
    const eventId = `replay-${replayTag}-${shortId}`;
    const name = String(p.name || p.ref || "Producto");
    const row = {
      event_id: eventId,
      product_id: p.id,
      product_ref: p.ref,
      event_type: "media_added",
      status: "pending",
      title: "Nueva Colección 🌊",
      body: `"${name}" ya está disponible en el catálogo.`,
      link,
      payload: { replay: true, replay_date: day, product_ref: p.ref },
      attempts: 0,
      sent: 0,
      invalid: 0,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from("catalog_push_events")
      .select("event_id, status")
      .eq("event_id", eventId)
      .maybeSingle();

    if (!existing) {
      const { error: insErr } = await supabase.from("catalog_push_events").insert(row);
      if (!insErr) enqueued.push(eventId);
    } else {
      const { error: upErr } = await supabase
        .from("catalog_push_events")
        .update({ ...row, status: "pending", error: null, last_error: null })
        .eq("event_id", eventId);
      if (!upErr) enqueued.push(eventId);
    }
  }

  const dispatchAuth = anonKey || serviceKey;
  const dispatchResp = await fetch(`${supabaseUrl}/functions/v1/catalog-push-dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${dispatchAuth}`,
      apikey: dispatchAuth,
    },
    body: "{}",
  });
  const dispatchJson = await dispatchResp.json().catch(() => ({}));

  const { data: events } = await supabase
    .from("catalog_push_events")
    .select("event_id, product_ref, status, sent, invalid, sent_at")
    .like("event_id", `replay-${replayTag}-%`);

  const sentTotal = Number(
    (dispatchJson as { results?: Array<{ fcm?: { sent?: number } }> })?.results?.[0]?.fcm?.sent ?? 0,
  );

  return json({
    ok: true,
    date: day,
    products: filtered.length,
    enqueued: enqueued.length,
    dispatch: dispatchJson,
    sent_total: sentTotal,
    events: events || [],
  });
});
