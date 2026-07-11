/**
 * Recuperación de carrito abandonado: marca carritos inactivos y envía push FCM (1 por snapshot).
 * Invocar con cron cada 15–30 min (header x-catalog-dispatch-secret si está configurado).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { broadcastFcm } from "../_shared/fcm_broadcast.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-catalog-dispatch-secret",
};

const RECOVERY_DELAY_MIN = Math.max(60, Number(Deno.env.get("CART_RECOVERY_DELAY_MIN") || 120));
const IDLE_MINUTES = Math.max(30, Number(Deno.env.get("CART_IDLE_MINUTES") || 45));
const RECOVERY_COOLDOWN_DAYS = Math.max(1, Number(Deno.env.get("CART_RECOVERY_COOLDOWN_DAYS") || 7));
const MAX_PER_RUN = Math.min(100, Math.max(1, Number(Deno.env.get("CART_RECOVERY_BATCH") || 40)));
const DAILY_PUSH_CAP = 3;

type CartRow = {
  id: string;
  session_id: string;
  fcm_token: string;
  item_count: number;
  total_cop: number;
  hero_image_url: string | null;
  hero_product_name: string | null;
  abandoned_at: string | null;
  recovery_push_count: number;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bogotaTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatCop(n: number): string {
  const v = Math.round(Number(n) || 0);
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(v);
}

function cartRecoveryCopy(row: CartRow): { title: string; body: string } {
  const n = Math.max(1, Number(row.item_count) || 1);
  const total = formatCop(row.total_cop);
  const hero = (row.hero_product_name || "").trim();
  const pieces = n === 1 ? "1 pieza" : `${n} piezas`;
  if (hero) {
    return {
      title: "🛍️ Tu selección te está esperando",
      body: `${pieces} · ${total} — ${hero} y más te esperan. Termina tu pedido antes de que se agoten.`,
    };
  }
  return {
    title: "🛍️ Te quedó tu selección en Hera",
    body: `${pieces} · ${total} — termina tu pedido antes de que se agoten.`,
  };
}

function recoveryLink(baseUrl: string, cartId: string): string {
  const u = new URL(baseUrl);
  u.searchParams.set("recover_cart", cartId);
  u.searchParams.set("utm_source", "cart_recovery");
  u.searchParams.set("utm_medium", "fcm");
  u.searchParams.set("utm_campaign", `cart-${cartId}`);
  return u.toString();
}

async function loadCatalogBase(
  supabase: ReturnType<typeof createClient>,
): Promise<string> {
  const { data } = await supabase
    .from("catalog_settings")
    .select("catalog_base_url")
    .eq("id", 1)
    .maybeSingle();
  const raw = String(
    data?.catalog_base_url ||
      Deno.env.get("HERA_CATALOG_BASE_URL") ||
      "https://eonclothingonline.com/mayoristas/",
  ).trim();
  return raw.replace(/\/?$/, "/");
}

async function tokenWithinDailyCap(
  supabase: ReturnType<typeof createClient>,
  token: string,
  day: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("fcm_tokens")
    .select("push_day, push_day_count")
    .eq("token", token)
    .maybeSingle();
  if (!data) return true;
  const count = data.push_day === day ? Number(data.push_day_count) || 0 : 0;
  return count < DAILY_PUSH_CAP;
}

async function tokenInRecoveryCooldown(
  supabase: ReturnType<typeof createClient>,
  token: string,
): Promise<boolean> {
  const since = new Date();
  since.setDate(since.getDate() - RECOVERY_COOLDOWN_DAYS);
  const { data } = await supabase
    .from("catalog_cart_snapshots")
    .select("id")
    .eq("fcm_token", token)
    .gte("recovery_push_sent_at", since.toISOString())
    .limit(1);
  return (data?.length ?? 0) > 0;
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

  const { data: staleMarked, error: staleErr } = await supabase.rpc(
    "mark_stale_carts_abandoned",
    { p_idle_minutes: IDLE_MINUTES },
  );
  if (staleErr) return json({ error: staleErr.message }, 500);

  const cutoff = new Date(Date.now() - RECOVERY_DELAY_MIN * 60 * 1000).toISOString();
  const { data: candidates, error: fetchErr } = await supabase
    .from("catalog_cart_snapshots")
    .select(
      "id, session_id, fcm_token, item_count, total_cop, hero_image_url, hero_product_name, abandoned_at, recovery_push_count",
    )
    .eq("status", "abandoned")
    .gt("item_count", 0)
    .not("fcm_token", "is", null)
    .lt("recovery_push_count", 1)
    .lte("abandoned_at", cutoff)
    .order("abandoned_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (fetchErr) return json({ error: fetchErr.message }, 500);

  const baseUrl = await loadCatalogBase(supabase);
  const bogotaDay = bogotaTodayYmd();
  const rows = (candidates || []) as CartRow[];
  let sent = 0;
  let skipped = 0;
  const results: Record<string, unknown>[] = [];

  for (const row of rows) {
    const token = (row.fcm_token || "").trim();
    if (!token) {
      skipped++;
      continue;
    }

    if (!(await tokenWithinDailyCap(supabase, token, bogotaDay))) {
      skipped++;
      results.push({ id: row.id, skipped: "daily_cap" });
      continue;
    }

    if (await tokenInRecoveryCooldown(supabase, token)) {
      skipped++;
      results.push({ id: row.id, skipped: "recovery_cooldown" });
      continue;
    }

    const copy = cartRecoveryCopy(row);
    const link = recoveryLink(baseUrl, row.id);
    const image = (row.hero_image_url || "").trim() || undefined;

    try {
      const fcm = await broadcastFcm(supabaseUrl, serviceKey, {
        title: copy.title,
        body: copy.body,
        link,
        image,
        only_token: token,
        data: {
          type: "cart_recovery",
          recover_cart: row.id,
          utm_campaign: `cart-${row.id}`,
        },
      });

      if (fcm.sent > 0) {
        await supabase
          .from("catalog_cart_snapshots")
          .update({
            status: "recovery_sent",
            recovery_push_sent_at: new Date().toISOString(),
            recovery_push_count: (row.recovery_push_count || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        await supabase.rpc("increment_fcm_push_counts", {
          p_tokens: [token],
          p_day: bogotaDay,
        });

        sent++;
        results.push({ id: row.id, sent: true, fcm });
      } else {
        skipped++;
        results.push({ id: row.id, sent: false, fcm });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id: row.id, error: msg });
      skipped++;
    }
  }

  return json({
    ok: true,
    stale_marked: staleMarked ?? 0,
    candidates: rows.length,
    sent,
    skipped,
    settings: {
      recovery_delay_min: RECOVERY_DELAY_MIN,
      idle_minutes: IDLE_MINUTES,
      cooldown_days: RECOVERY_COOLDOWN_DAYS,
    },
    results,
  });
});
