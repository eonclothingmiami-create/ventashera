/**
 * Actualiza estado de pago de un pedido catálogo (retorno Wompi/Addi, webhook, reconciliación).
 * POST actions:
 * - resolve_wompi_return — consulta Wompi por transaction_id o reference
 * - resolve_addi_return — callback catálogo o consulta API Addi
 * - reconcile_pending_payments — repregunta pasarelas por pedidos pendientes
 * - expire_stale — marca pendientes > N horas como checkout_abandonado
 */
import {
  catalogOrderClientAuthOk,
  catalogOrderPrivilegedAuthOk,
  catalogOrderUserAuthOk,
  addiWebhookAuthOk,
} from "../_shared/catalog_order_auth.ts";
import {
  createServiceClient,
  patchCatalogOrder,
  reconcileCatalogOrderRow,
  reconcilePendingCatalogPayments,
  resolveEstadoFromBody,
} from "../_shared/catalog_order_status.ts";
import { mapGatewayStatus } from "../_shared/ventas_catalogo_map.ts";
import {
  fetchWompiTransactionById,
  fetchWompiTransactionByReference,
} from "../_shared/wompi_client.ts";
import { addiConfigured } from "../_shared/addi_client.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-catalog-order-secret",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Addi exige HTTP 200 devolviendo el mismo JSON recibido. */
function addiWebhookEcho(rawText: string): Response {
  return new Response(rawText, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleAddiWebhookNotification(
  sb: ReturnType<typeof createServiceClient>,
  body: Record<string, unknown>,
  opts: { clientIp?: string; userAgent?: string },
): Promise<{ processed: boolean; error?: string }> {
  const reference = String(
    body.orderId ?? body.order_id ?? body.reference ?? body.externalReference ?? "",
  ).trim();
  const rawStatus = String(
    body.status ?? body.applicationStatus ?? body.application_status ?? body.state ?? "",
  ).trim();
  const appId = String(
    body.applicationId ?? body.application_id ?? body.id ?? "",
  ).trim();

  if (!reference) {
    return { processed: false, error: "orderId/reference required" };
  }
  if (!rawStatus) {
    return { processed: false, error: "status required" };
  }

  const nuevoEstado = mapGatewayStatus(rawStatus);
  if (!nuevoEstado) {
    return { processed: false, error: `Unknown Addi status: ${rawStatus}` };
  }

  const { data: row, error: fetchErr } = await sb.from("ventas_catalogo")
    .select("*")
    .eq("reference", reference)
    .maybeSingle();

  if (fetchErr) {
    return { processed: false, error: fetchErr.message };
  }
  if (!row) {
    return { processed: false, error: `Order not found: ${reference}` };
  }

  try {
    await patchCatalogOrder(sb, row, nuevoEstado, {
      proveedorRef: appId || undefined,
      paymentRaw: rawStatus,
      source: "addi_webhook",
      extraMeta: {
        addi_webhook_at: new Date().toISOString(),
        ...(appId ? { addi_application_id: appId } : {}),
      },
      clientIp: opts.clientIp,
      userAgent: opts.userAgent,
    });
    return { processed: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { processed: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const clientIp = (
    req.headers.get("x-forwarded-for") ||
    req.headers.get("cf-connecting-ip") ||
    ""
  ).split(",")[0]?.trim() || undefined;
  const userAgent = req.headers.get("user-agent") || undefined;

  const sb = createServiceClient();

  if (req.method === "POST") {
    const rawText = await req.text();
    let body: Record<string, unknown> = {};
    try {
      body = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const action = String(body.action || "").trim();

    if (addiWebhookAuthOk(req)) {
      const result = await handleAddiWebhookNotification(sb, body, { clientIp, userAgent });
      if (!result.processed) {
        console.warn("[addi_webhook]", result.error, body);
      }
      return addiWebhookEcho(rawText);
    }

    if (action === "addi_webhook") {
      if (!await catalogOrderPrivilegedAuthOk(req)) {
        return json({ ok: false, error: "Addi webhook unauthorized" }, 401);
      }
      const result = await handleAddiWebhookNotification(sb, body, { clientIp, userAgent });
      if (!result.processed) {
        return json({ ok: false, error: result.error || "webhook failed" }, 400);
      }
      return json({ ok: true, echoed: false });
    }

    if (action === "expire_stale") {
      if (!await catalogOrderUserAuthOk(req)) {
        return json({ ok: false, error: "Authorization required" }, 401);
      }
      const hours = Math.max(1, Number(body.hours) || 168);
      const { data, error } = await sb.rpc("expire_stale_catalog_orders", {
        p_hours: hours,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, expired: data ?? 0, hours });
    }

    if (action === "reconcile_pending_payments") {
      const cronOk = await catalogOrderPrivilegedAuthOk(req);
      const userOk = !cronOk && await catalogOrderUserAuthOk(req);
      if (!cronOk && !userOk) {
        return json({ ok: false, error: "Authorization required" }, 401);
      }
      try {
        const result = await reconcilePendingCatalogPayments(sb, {
          limit: Number(body.limit) || 30,
          days: Number(body.days) || 30,
          clientIp,
          userAgent,
        });
        return json(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ ok: false, error: msg }, 500);
      }
    }

    if (action === "resolve_wompi_return") {
      if (!await catalogOrderClientAuthOk(req)) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      const transactionId = String(
        body.transaction_id ?? body.transactionId ?? body.id ?? "",
      ).trim();
      let reference = String(body.reference || "").trim();

      try {
        let tx = transactionId
          ? await fetchWompiTransactionById(transactionId)
          : null;
        if (!tx && reference) {
          tx = await fetchWompiTransactionByReference(reference);
        }
        if (!tx) {
          return json({ ok: false, error: "Wompi transaction not found" }, 404);
        }

        reference = reference || tx.reference;
        if (!reference) {
          return json({ ok: false, error: "Could not resolve order reference" }, 400);
        }

        const nuevoEstado = mapGatewayStatus(tx.status);
        if (!nuevoEstado) {
          return json({
            ok: false,
            error: `Unknown Wompi status: ${tx.status}`,
            wompi_status: tx.status,
          }, 400);
        }

        const { data: row, error: fetchErr } = await sb.from("ventas_catalogo")
          .select("*")
          .eq("reference", reference)
          .maybeSingle();

        if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
        if (!row) {
          return json({ ok: false, error: "Order not found", reference }, 404);
        }

        const result = await patchCatalogOrder(sb, row, nuevoEstado, {
          proveedorRef: tx.id,
          paymentRaw: tx.status,
          source: "wompi_return",
          extraMeta: { wompi_reconciled_at: new Date().toISOString() },
          clientIp,
          userAgent,
        });

        return json({ ok: true, wompi: tx, ...result });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ ok: false, error: msg }, 500);
      }
    }

    if (action === "resolve_addi_return") {
      if (!await catalogOrderClientAuthOk(req)) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      const reference = String(body.reference || body.orderId || "").trim();
      if (!reference) {
        return json({ ok: false, error: "reference required" }, 400);
      }

      const { data: row, error: fetchErr } = await sb.from("ventas_catalogo")
        .select("*")
        .eq("reference", reference)
        .maybeSingle();

      if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
      if (!row) return json({ ok: false, error: "Order not found", reference }, 404);

      const rawStatus = String(
        body.payment_status_raw ??
          body.status ??
          body.addi_status ??
          body.application_status ??
          "",
      ).trim();

      try {
        if (rawStatus) {
          const nuevoEstado = mapGatewayStatus(rawStatus);
          if (!nuevoEstado) {
            return json({
              ok: false,
              error: `Unknown Addi status: ${rawStatus}`,
              addi_status: rawStatus,
            }, 400);
          }
          const appId = String(
            body.application_id ?? body.applicationId ?? body.proveedor_ref ?? "",
          ).trim();
          const result = await patchCatalogOrder(sb, row, nuevoEstado, {
            proveedorRef: appId || undefined,
            paymentRaw: rawStatus,
            source: "addi_return",
            extraMeta: {
              addi_reconciled_at: new Date().toISOString(),
              ...(appId ? { addi_application_id: appId } : {}),
            },
            clientIp,
            userAgent,
          });
          return json({ ok: true, addi_status: rawStatus, ...result });
        }

        if (!addiConfigured()) {
          return json({
            ok: false,
            error: "Addi status or ADDI credentials required",
          }, 400);
        }

        const result = await reconcileCatalogOrderRow(sb, row, {
          source: "addi_return",
          clientIp,
          userAgent,
        });
        return json(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ ok: false, error: msg }, 500);
      }
    }

    const source = String(body.source || "").trim();
    const clientReturnSources = new Set(["addi_return", "wompi_return", "wompi_webhook"]);
    const authOk = clientReturnSources.has(source)
      ? await catalogOrderClientAuthOk(req)
      : await catalogOrderPrivilegedAuthOk(req);
    if (!authOk) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const reference = String(body.reference || "").trim();
    if (!reference) {
      return json({ ok: false, error: "reference required" }, 400);
    }

    const nuevoEstado = resolveEstadoFromBody(body);
    if (!nuevoEstado) {
      return json({ ok: false, error: "Could not resolve estado_pago" }, 400);
    }

    const { data: row, error: fetchErr } = await sb.from("ventas_catalogo")
      .select("*")
      .eq("reference", reference)
      .maybeSingle();

    if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
    if (!row) return json({ ok: false, error: "Order not found" }, 404);

    try {
      const appId = String(
        body.application_id ?? body.applicationId ?? body.proveedor_ref ?? "",
      ).trim();
      const paymentRaw = String(
        body.payment_status_raw ?? body.status ?? body.transaction_status ?? "",
      ).trim() || undefined;

      const result = await patchCatalogOrder(sb, row, nuevoEstado, {
        proveedorRef: appId ||
          String(body.proveedor_ref ?? body.proveedorRef ?? body.transaction_id ?? "").trim() ||
          undefined,
        paymentRaw,
        source: source || "catalog-order-status",
        extraMeta: appId ? { addi_application_id: appId } : undefined,
        clientIp,
        userAgent,
      });
      return json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ ok: false, error: msg }, 500);
    }
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
});
