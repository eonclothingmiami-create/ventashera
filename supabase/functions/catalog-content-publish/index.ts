/**
 * Publicar contenido editorial + push FCM a todas las PWA (producción).
 * JWT de usuario autenticado (ERP). Rate limit: 3 pushes/día (America/Bogota).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { broadcastFcm } from "../_shared/fcm_broadcast.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_PUSHES_PER_DAY = 3;
const DEFAULT_CATALOG_BASE = "https://eonclothingonline.com/mayoristas/";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type PostRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body_html: string | null;
  media_type: string;
  media_url: string | null;
  thumb_url: string | null;
  external_link: string | null;
  cta_type: string;
  cta_product_ref: string | null;
  status: string;
};

function bogotaDayStartIso(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymd = fmt.format(new Date());
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0)).toISOString();
}

function withPushUtm(link: string, campaignId: string): string {
  try {
    const u = new URL(link);
    u.searchParams.set("utm_source", "push");
    u.searchParams.set("utm_medium", "fcm");
    u.searchParams.set("utm_campaign", campaignId);
    return u.toString();
  } catch {
    return link;
  }
}

function buildLandingUrl(base: string, postId: string, campaign: string): string {
  const root = base.replace(/\/?$/, "/");
  const url = `${root}contenido.html?id=${encodeURIComponent(postId)}`;
  return withPushUtm(url, campaign);
}

function validatePostMedia(post: PostRow): string | null {
  const mt = post.media_type;
  if (mt === "image" && !post.media_url) return "image requires media_url";
  if (mt === "video") {
    if (!post.media_url) return "video requires media_url";
    if (!post.thumb_url) return "video requires thumb_url";
  }
  if (mt === "link" && !post.external_link && post.cta_type !== "catalog" && post.cta_type !== "product" && post.cta_type !== "whatsapp") {
    return "link requires external_link or catalog/product/whatsapp CTA";
  }
  return null;
}

function notificationImage(post: PostRow): string | undefined {
  if (post.media_type === "video") return post.thumb_url || undefined;
  if (post.media_type === "image") return post.thumb_url || post.media_url || undefined;
  return post.thumb_url || undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  let body: { post_id?: string; send_push?: boolean; exclude_token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const postId = String(body.post_id || "").trim();
  if (!postId) return json({ error: "post_id required" }, 400);
  const sendPush = body.send_push !== false;

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: post, error: postErr } = await admin
    .from("catalog_content_posts")
    .select(
      "id, slug, title, excerpt, body_html, media_type, media_url, thumb_url, external_link, cta_type, cta_product_ref, status",
    )
    .eq("id", postId)
    .maybeSingle();

  if (postErr) return json({ error: postErr.message }, 500);
  if (!post) return json({ error: "post_not_found" }, 404);

  const mediaErr = validatePostMedia(post as PostRow);
  if (mediaErr) return json({ error: mediaErr }, 400);

  const title = String(post.title || "").trim();
  if (!title) return json({ error: "title required" }, 400);

  const excerpt = String(post.excerpt || "").trim();
  const pushBody = excerpt || title;
  if (!pushBody) return json({ error: "excerpt or title required for notification" }, 400);

  const catalogBase =
    Deno.env.get("HERA_CATALOG_BASE_URL")?.trim().replace(/\/?$/, "/") || DEFAULT_CATALOG_BASE;
  const campaign = `content-${post.id}`;
  const landingLink = buildLandingUrl(catalogBase, post.id, campaign);

  const now = new Date().toISOString();
  const publishUpdate: Record<string, unknown> = {
    status: "published",
    updated_at: now,
    push_status: sendPush ? "pending" : "none",
  };
  if (post.status !== "published") publishUpdate.published_at = now;
  await admin.from("catalog_content_posts").update(publishUpdate).eq("id", postId);

  if (!sendPush) {
    return json({ ok: true, published: true, push: { skipped: true } });
  }

  const dayStart = bogotaDayStartIso();
  const { count: pushesToday } = await admin
    .from("catalog_content_posts")
    .select("*", { count: "exact", head: true })
    .eq("push_status", "sent")
    .gte("push_sent_at", dayStart);

  if ((pushesToday ?? 0) >= MAX_PUSHES_PER_DAY) {
    await admin
      .from("catalog_content_posts")
      .update({ push_status: "error", push_error: "daily_push_limit", updated_at: now })
      .eq("id", postId);
    return json({ error: "daily_push_limit", limit: MAX_PUSHES_PER_DAY }, 429);
  }

  const pushPayload = {
    title,
    body: pushBody,
    link: landingLink,
    image: notificationImage(post as PostRow),
    campaign,
    media_type: post.media_type,
  };

  const { data: pushRow, error: insErr } = await admin
    .from("content_push_events")
    .insert({
      post_id: postId,
      status: "pending",
      payload: pushPayload,
    })
    .select("id")
    .single();

  if (insErr) return json({ error: insErr.message }, 500);

  try {
    const fcm = await broadcastFcm(supabaseUrl, serviceKey, {
      title,
      body: pushBody,
      link: landingLink,
      image: notificationImage(post as PostRow),
      exclude_token: body.exclude_token ? String(body.exclude_token) : undefined,
      data: {
        utm_campaign: campaign,
        content_id: post.id,
      },
    });

    const sentAt = new Date().toISOString();
    await admin
      .from("content_push_events")
      .update({
        status: fcm.sent > 0 ? "sent" : "error",
        sent: fcm.sent,
        invalid: fcm.removed_invalid,
        sent_at: sentAt,
        error: fcm.sent > 0 ? null : (fcm.sample_errors[0] || "fcm_failed").slice(0, 500),
      })
      .eq("id", pushRow.id);

    await admin
      .from("catalog_content_posts")
      .update({
        push_status: fcm.sent > 0 ? "sent" : "error",
        push_sent_at: sentAt,
        push_sent_count: fcm.sent,
        push_error: fcm.sent > 0 ? null : (fcm.sample_errors[0] || "fcm_failed").slice(0, 500),
        updated_at: sentAt,
      })
      .eq("id", postId);

    return json({
      ok: true,
      published: true,
      push: { mode: "broadcast", event_id: pushRow.id, ...fcm },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("content_push_events")
      .update({ status: "error", error: msg.slice(0, 500) })
      .eq("id", pushRow.id);
    await admin
      .from("catalog_content_posts")
      .update({ push_status: "error", push_error: msg.slice(0, 500), updated_at: now })
      .eq("id", postId);
    return json({ error: msg }, 500);
  }
});
