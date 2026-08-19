/**
 * Despacha channel_publish_queue (solo eBay lotes mayoristas) → ebay-sync-product.
 * Cron cada 5 min + invocación manual { action: "dispatch" }.
 * Para al primer selling limit; reintenta pending en la siguiente corrida.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH = 5;

type QueueRow = {
  id: string;
  product_id: string;
  channel: "mercadolibre" | "ebay" | "faire";
  action: string;
  attempts: number;
  products?: { stock?: number | null } | Array<{ stock?: number | null }> | null;
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

function isSellingLimitError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("exceed the amount") ||
    m.includes("selling limit") ||
    m.includes("selling_limit") ||
    m.includes("amount you can list")
  );
}

function isRetryableContentError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("fragrance name") ||
    m.includes("size type") ||
    m.includes("cannot revise listing") ||
    m.includes("title and/or description")
  );
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

async function persistEbaySyncTouch(sb: SupabaseClient, productId: string): Promise<void> {
  await sb.from("products").update({
    ebay_last_sync_at: new Date().toISOString(),
  }).eq("id", productId);
}

async function processJob(sb: SupabaseClient, job: QueueRow): Promise<Record<string, unknown>> {
  const { data: derived } = await sb
    .from("ebay_derived_listings")
    .select("ebay_listing_id")
    .eq("product_id", job.product_id)
    .eq("listing_kind", "lot")
    .maybeSingle();

  if (derived?.ebay_listing_id && String(derived.ebay_listing_id).trim()) {
    return { ok: true, skipped: true, reason: "already_listed" };
  }

  return (await invokeEdge("ebay-sync-product", {
    productId: job.product_id,
    action: "publish",
    listingKind: "lot",
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
    .select("id, product_id, channel, action, attempts, products(stock)")
    .eq("status", "pending")
    .eq("channel", "ebay")
    .order("updated_at", { ascending: true })
    .limit(BATCH * 4);

  if (qErr) return json({ ok: false, error: qErr.message }, 500);
  if (!jobs?.length) return json({ ok: true, processed: 0, done: true });

  const sorted = [...(jobs as QueueRow[])].sort((a, b) => {
    const stockA = Number(Array.isArray(a.products) ? a.products[0]?.stock : a.products?.stock) || 0;
    const stockB = Number(Array.isArray(b.products) ? b.products[0]?.stock : b.products?.stock) || 0;
    return stockB - stockA;
  }).slice(0, BATCH);

  const results: Array<Record<string, unknown>> = [];
  let stoppedForLimit = false;

  for (const job of sorted) {
    if (stoppedForLimit) break;

    await sb.from("channel_publish_queue").update({
      status: "processing",
      attempts: job.attempts + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);

    try {
      const data = await processJob(sb, job);
      const skipped = !!data.skipped;
      const errMsg = String(data.error || data.message || "").trim();
      const sellingLimit = !skipped && data.ok === false && isSellingLimitError(errMsg);
      const contentError = !skipped && data.ok === false && isRetryableContentError(errMsg);
      const failed = data.ok === false && !skipped && !sellingLimit;

      let status: string;
      if (skipped) status = "skipped";
      else if (sellingLimit) status = "pending";
      else if (failed) status = contentError ? "error" : "error";
      else status = "done";

      await sb.from("channel_publish_queue").update({
        status,
        last_error: (failed || sellingLimit) ? errMsg.slice(0, 500) : null,
        result: data,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      if (!skipped && !failed && data.ok !== false) {
        await persistEbaySyncTouch(sb, job.product_id);
      }

      if (sellingLimit) {
        stoppedForLimit = true;
        results.push({
          id: job.id,
          channel: job.channel,
          productId: job.product_id,
          status: "pending",
          stoppedBatch: true,
          error: errMsg,
        });
        continue;
      }

      results.push({
        id: job.id,
        channel: job.channel,
        productId: job.product_id,
        status,
        skipped: data.reason || null,
        error: failed ? errMsg : null,
        listingId: data.listingId || null,
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
    stoppedForLimit,
    results,
  });
});
