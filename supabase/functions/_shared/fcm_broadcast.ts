/**
 * FCM HTTP v1 broadcast a tokens en fcm_tokens.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

export type FcmBroadcastResult = {
  sent: number;
  failed: number;
  total_tokens: number;
  removed_invalid: number;
  sample_errors: string[];
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

let cachedAccessToken: { token: string; exp: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.exp > now + 60) {
    return cachedAccessToken.token;
  }
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const payload = btoa(JSON.stringify(claim))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const toSign = `${header}.${payload}`;
  const pem = sa.private_key.replace(/\\n/g, "\n");
  const keyData = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(toSign),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = `${toSign}.${sigB64}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(json.error || "OAuth token failed");
  cachedAccessToken = { token: json.access_token, exp: now + (json.expires_in || 3600) };
  return json.access_token;
}

export async function broadcastFcm(
  supabaseUrl: string,
  serviceKey: string,
  opts: {
    title: string;
    body: string;
    link?: string;
    image?: string;
    exclude_token?: string;
    data?: Record<string, string>;
  },
): Promise<FcmBroadcastResult> {
  const saRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!saRaw) throw new Error("FIREBASE_SERVICE_ACCOUNT not set");
  const sa = JSON.parse(saRaw) as ServiceAccount;

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: rows, error } = await supabase.from("fcm_tokens").select("token");
  if (error) throw error;

  const tokens = (rows || [])
    .map((r: { token: string }) => r.token)
    .filter((t: string) => t && t !== opts.exclude_token);

  if (tokens.length === 0) {
    return { sent: 0, failed: 0, total_tokens: 0, removed_invalid: 0, sample_errors: [] };
  }

  const accessToken = await getAccessToken(sa);
  const projectId = sa.project_id;
  let sent = 0;
  let failed = 0;
  const invalid: string[] = [];
  const sample_errors: string[] = [];

  const link = opts.link || "";
  const image = opts.image?.trim() || "";
  for (let i = 0; i < tokens.length; i += 25) {
    const chunk = tokens.slice(i, i + 25);
    await Promise.all(
      chunk.map(async (token) => {
        const notification: Record<string, string> = {
          title: opts.title,
          body: opts.body,
        };
        const webpushNotification: Record<string, string> = {
          title: opts.title,
          body: opts.body,
        };
        if (image) {
          notification.image = image;
          webpushNotification.image = image;
        }

        const message: Record<string, unknown> = {
          token,
          notification,
          webpush: {
            fcm_options: { link },
            notification: webpushNotification,
          },
        };
        if (opts.data && Object.keys(opts.data).length > 0) {
          message.data = opts.data;
        }
        const res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ message }),
          },
        );
        if (res.ok) {
          sent++;
          return;
        }
        failed++;
        const errText = await res.text();
        if (sample_errors.length < 5) sample_errors.push(errText.slice(0, 200));
        if (
          errText.includes("UNREGISTERED") ||
          errText.includes("INVALID_ARGUMENT") ||
          errText.includes("NOT_FOUND")
        ) {
          invalid.push(token);
        }
      }),
    );
  }

  if (invalid.length > 0) {
    await supabase.from("fcm_tokens").delete().in("token", invalid);
  }

  return {
    sent,
    failed,
    total_tokens: tokens.length,
    removed_invalid: invalid.length,
    sample_errors,
  };
}
