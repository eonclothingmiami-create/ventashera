/**
 * Webhook de confirmación Sistecredito (urlConfirmation).
 * Acepta POST (recomendado) y GET con querystring.
 * Actualiza ventas_catalogo por invoice (= reference del catálogo) o _id.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mapGatewayStatus } from "../_shared/ventas_catalogo_map.ts";
import { patchCatalogOrder } from "../_shared/catalog_order_status.ts";
import {
  getSistecreditoTransaction,
  mapSistecreditoStatus,
} from "../_shared/sistecredito_client.ts";

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

function pickStatus(payload: Record<string, unknown>): string {
  const data = (payload.data && typeof payload.data === "object"
    ? payload.data
    : payload) as Record<string, unknown>;
  const pmr = (data.paymentMethodResponse &&
      typeof data.paymentMethodResponse === "object"
    ? data.paymentMethodResponse
    : {}) as Record<string, unknown>;
  return String(
    pmr.statusResponse ||
      data.transactionStatus ||
      payload.transactionStatus ||
      "",
  ).trim();
}

function pickIds(payload: Record<string, unknown>) {
  const data = (payload.data && typeof payload.data === "object"
    ? payload.data
    : payload) as Record<string, unknown>;
  return {
    txId: String(data._id || payload._id || payload.transactionId || "").trim(),
    invoice: String(data.invoice || payload.invoice || "").trim(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let payload: Record<string, unknown> = {};
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      u.searchParams.forEach((v, k) => {
        payload[k] = v;
      });
    } else if (req.method === "POST") {
      const ct = (req.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        payload = await req.json();
      } else {
        const text = await req.text();
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          const params = new URLSearchParams(text);
          params.forEach((v, k) => {
            payload[k] = v;
          });
        }
      }
    } else {
      return json({ ok: false, error: "GET or POST only" }, 405);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, 400);
  }

  const { txId, invoice } = pickIds(payload);
  let statusRaw = pickStatus(payload);

  // Contraste con consulta oficial (recomendado por G-ALI-08)
  if (txId) {
    try {
      const live = await getSistecreditoTransaction(txId);
      const liveStatus = String(
        live.paymentMethodResponse?.statusResponse ||
          live.transactionStatus ||
          "",
      ).trim();
      if (liveStatus) statusRaw = liveStatus;
      if (!invoice && live.invoice) {
        payload.invoice = live.invoice;
      }
    } catch (e) {
      console.warn(
        "[sistecredito-confirmation] get failed",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const mappedGateway = mapSistecreditoStatus(statusRaw);
  const estado = mapGatewayStatus(mappedGateway);
  if (!estado) {
    console.info("[sistecredito-confirmation] ignore status", statusRaw, {
      txId,
      invoice,
    });
    return json({ ok: true, ignored: true, status: statusRaw, txId, invoice });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key);

  let row = null as Record<string, unknown> | null;
  const inv = String(payload.invoice || invoice || "").trim();

  if (inv) {
    const { data } = await sb.from("ventas_catalogo")
      .select("*")
      .eq("reference", inv)
      .maybeSingle();
    row = data;
  }
  if (!row && txId) {
    const { data } = await sb.from("ventas_catalogo")
      .select("*")
      .eq("proveedor_ref", txId)
      .maybeSingle();
    row = data;
  }

  if (!row) {
    console.warn("[sistecredito-confirmation] order not found", { txId, inv });
    return json({ ok: false, error: "order not found", txId, invoice: inv }, 404);
  }

  try {
    const result = await patchCatalogOrder(sb, row, estado, {
      proveedorRef: txId || String(row.proveedor_ref || ""),
      paymentRaw: statusRaw || mappedGateway,
      source: "sistecredito_webhook",
      extraMeta: {
        sistecredito_webhook_at: new Date().toISOString(),
        sistecredito_transaction_id: txId || null,
        sistecredito_status: statusRaw || null,
      },
    });
    return json({ ok: true, reference: row.reference, estado, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sistecredito-confirmation]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
