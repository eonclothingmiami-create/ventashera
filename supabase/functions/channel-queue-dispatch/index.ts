/**
 * Despacha channel_publish_queue (solo eBay) → ebay-sync-product.
 * Cron cada 5 min + invocación manual { action: "dispatch" }.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH = 12;

type QueueRow = {
  id: string;
  product_id: string;
  channel: "mercadolibre" | "ebay" | "faire";
  action: string;
  attempts: number;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fnUrl(name: string): string {
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  return `${base}/functions/v1/${name}`;
}

function invokeBearer(): string {
  return (Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
}

async function invokeEdge(
  slug: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const bearer = invokeBearer();
  const res = await fetch(fnUrl(slug), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer}`,
      apikey: bearer,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok && data.ok !== false, status: res.status, data };
}

async function persistChannelIds(
  sb: SupabaseClient,
  productId: string,
  channel: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (channel === "mercadolibre") {
    const itemId = String(data.itemId || "").trim();
    if (itemId) {
      await sb.from("products").update({ mercadolibre_item_id: itemId }).eq("id", productId);
    }
    return;
  }
  if (channel === "ebay") {
    const patch: Record<string, unknown> = { ebay_last_sync_at: new Date().toISOString() };
    const lid = String(data.listingId || "").trim();
    const oid = String(data.offerId || "").trim();
    const sku = String(data.sku || "").trim();
    if (lid) patch.ebay_listing_id = lid;
    if (oid) patch.ebay_offer_id = oid;
    if (sku) patch.ebay_sku = sku;
    if (data.skipped) patch.ebay_sync_status = "skipped";
    else if (data.ok) patch.ebay_sync_status = "published";
    await sb.from("products").update(patch).eq("id", productId);
    return;
  }
  if (channel === "faire") {
    const faireId = String(data.faireProductId || "").trim();
    if (!faireId) return;
    const { data: row } = await sb.from("products").select("integrations_json").eq("id", productId).maybeSingle();
    const prev = row?.integrations_json && typeof row.integrations_json === "object" && !Array.isArray(row.integrations_json)
      ? row.integrations_json as Record<string, unknown>
      : {};
    await sb.from("products").update({
      integrations_json: { ...prev, faire_product_id: faireId },
    }).eq("id", productId);
  }
}

async function processJob(sb: SupabaseClient, job: QueueRow): Promise<Record<string, unknown>> {
  return (await invokeEdge("ebay-sync-product", {
    productId: job.product_id,
    action: "publish",
    listingKind: "retail",
  })).data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: jobs, error: qErr } = await sb
    .from("channel_publish_queue")
    .select("id, product_id, channel, action, attempts")
    .eq("status", "pending")
    .eq("channel", "ebay")
    .order("updated_at", { ascending: true })
    .limit(BATCH);

  if (qErr) return json({ ok: false, error: qErr.message }, 500);
  if (!jobs?.length) return json({ ok: true, processed: 0, done: true });

  const results: Array<Record<string, unknown>> = [];

  for (const job of jobs as QueueRow[]) {
    await sb.from("channel_publish_queue").update({
      status: "processing",
      attempts: job.attempts + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);

    try {
      const data = await processJob(sb, job);
      const skipped = !!data.skipped;
      const failed = data.ok === false && !skipped;
      const status = skipped ? "skipped" : failed ? "error" : "done";

      await sb.from("channel_publish_queue").update({
        status,
        last_error: failed ? String(data.error || data.message || "sync_failed").slice(0, 500) : null,
        result: data,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      if (!skipped && !failed) {
        await persistChannelIds(sb, job.product_id, "ebay", data);
      }

      results.push({
        id: job.id,
        channel: job.channel,
        productId: job.product_id,
        status,
        skipped: data.reason || null,
        error: failed ? data.error : null,
      });
    } catch (e) {
      const msg = String(e).slice(0, 500);
      await sb.from("channel_publish_queue").update({
        status: "error",
        last_error: msg,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      results.push({ id: job.id, channel: job.channel, status: "error", error: msg });
    }
  }

  return json({
    ok: true,
    action: "dispatch",
    processed: results.length,
    results,
  });
});
