/**
 * IndexNow — solo catálogo público Hera (heraswimsuit.com).
 * Key: secret INDEXNOW_KEY. Nunca en frontend.
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const DEDUPE_MS = 5 * 60 * 1000;
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const HOST = "heraswimsuit.com";
const HERA_REF_RE = /^HERA-[A-Z0-9._-]+$/i;

export function heraCatalogCanonicalUrl(refRaw: string): string | null {
  const ref = String(refRaw || "").trim().toUpperCase();
  if (!HERA_REF_RE.test(ref)) return null;
  const url = `https://${HOST}/catalogo/?p=${encodeURIComponent(ref)}`;
  if (!url.startsWith(`https://${HOST}/catalogo/?p=`)) return null;
  if (/[?&]admin=/i.test(url)) return null;
  if (/eonclothingonline\.com/i.test(url)) return null;
  if (/\/privacy|\/terms/i.test(url)) return null;
  return url;
}

export async function notifyHeraCatalogIndexNow(
  supabase: SupabaseClient,
  refRaw: string | null | undefined,
): Promise<{ skipped?: string; status?: number; url?: string }> {
  const url = heraCatalogCanonicalUrl(String(refRaw || ""));
  if (!url) return { skipped: "invalid_ref" };

  const key = (Deno.env.get("INDEXNOW_KEY") || "").trim();
  if (!key) {
    console.log(JSON.stringify({ event: "indexnow_skip", reason: "missing_INDEXNOW_KEY", ref: refRaw }));
    return { skipped: "missing_key" };
  }

  const ref = String(refRaw || "").trim().toUpperCase();
  try {
    const { data: prev } = await supabase
      .from("indexnow_pings")
      .select("last_ping_at")
      .eq("product_ref", ref)
      .maybeSingle();
    if (prev?.last_ping_at) {
      const age = Date.now() - new Date(String(prev.last_ping_at)).getTime();
      if (Number.isFinite(age) && age >= 0 && age < DEDUPE_MS) {
        console.log(JSON.stringify({ event: "indexnow_skip", reason: "deduped_5m", ref, url }));
        return { skipped: "deduped_5m", url };
      }
    }
  } catch (e) {
    console.log(JSON.stringify({ event: "indexnow_dedupe_read_fail", ref, error: String(e) }));
  }

  const keyLocation = `https://${HOST}/${key}.txt`;
  let status = 0;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOST,
        key,
        keyLocation,
        urlList: [url],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    status = res.status;
    const ok = status === 200 || status === 202;
    console.log(JSON.stringify({ event: "indexnow_ping", ref, url, status, ok }));
  } catch (e) {
    console.log(JSON.stringify({ event: "indexnow_fail", ref, url, error: String(e) }));
  }

  try {
    await supabase.from("indexnow_pings").upsert({
      product_ref: ref,
      last_ping_at: new Date().toISOString(),
      last_status: status || null,
      last_url: url,
      updated_at: new Date().toISOString(),
    }, { onConflict: "product_ref" });
  } catch (e) {
    console.log(JSON.stringify({ event: "indexnow_dedupe_write_fail", ref, error: String(e) }));
  }

  return { status, url };
}
