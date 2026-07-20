/**
 * Hera Catalog MCP — thin adapter over Catalog API v1.
 * No business logic here: all intelligence lives in the API.
 *
 * Base URL (override with HERA_CATALOG_API_BASE):
 *   https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/catalog-api-v1
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = (
  process.env.HERA_CATALOG_API_BASE ||
  "https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/catalog-api-v1"
).replace(/\/$/, "");

async function api(path, { method = "GET", body } = {}) {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data;
}

function asText(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function asError(err) {
  return {
    content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
    isError: true,
  };
}

const server = new McpServer({
  name: "hera-catalog",
  version: "1.0.0",
});

server.tool(
  "capabilities",
  "Discover Hera Catalog API capabilities (filters, knowledge, endpoints).",
  {},
  async () => {
    try {
      return asText(await api("/capabilities"));
    } catch (e) {
      return asError(e);
    }
  },
);

server.tool(
  "resolve_product",
  "Resolve a legacy id/alias/name fragment to canonical HERA-* product.",
  { id: z.string().describe("Legacy id, alias, or product ref (e.g. 13003 or HERA-13003)") },
  async ({ id }) => {
    try {
      return asText(await api(`/resolve?id=${encodeURIComponent(id)}`));
    } catch (e) {
      return asError(e);
    }
  },
);

server.tool(
  "search_products",
  "Search Hera products with keyword + facets (stock, price, style, occasion, collection).",
  {
    q: z.string().optional().describe("Free text, e.g. bikini elegante Cartagena"),
    in_stock: z.boolean().optional(),
    max_price: z.number().optional().describe("Max price in COP"),
    min_price: z.number().optional(),
    product_type: z.string().optional().describe("bikini | one_piece | cover_up | …"),
    style: z.string().optional().describe("quiet_luxury | elegant | minimal"),
    occasion: z.string().optional().describe("cartagena | honeymoon | beach | …"),
    fit_goal: z.string().optional().describe("cinch_waist"),
    collection: z.string().optional().describe("quiet-luxury | cartagena | luna-de-miel"),
    limit: z.number().int().min(1).max(48).optional(),
  },
  async (args) => {
    try {
      return asText(await api("/search", { method: "POST", body: args }));
    } catch (e) {
      return asError(e);
    }
  },
);

server.tool(
  "get_product",
  "Get a single product by canonical HERA-* ref.",
  { ref: z.string().describe("Canonical product ref, e.g. HERA-20132") },
  async ({ ref }) => {
    try {
      return asText(await api(`/products/${encodeURIComponent(ref)}`));
    } catch (e) {
      return asError(e);
    }
  },
);

server.tool(
  "get_product_knowledge",
  "Commercial knowledge pack: pairs/outfits, collections, videos, IG/TikTok, editorial, blog/guides.",
  { ref: z.string().describe("Canonical product ref, e.g. HERA-20132") },
  async ({ ref }) => {
    try {
      return asText(await api(`/products/${encodeURIComponent(ref)}/knowledge`));
    } catch (e) {
      return asError(e);
    }
  },
);

server.tool(
  "get_related_products",
  "Related products by intent (pairs_with, completes_outfit, kimono, similar, …).",
  {
    ref: z.string(),
    intent: z
      .enum([
        "similar",
        "kimono",
        "cover_up",
        "pairs_with",
        "completes_outfit",
        "upsell",
        "same_look",
        "alternative",
      ])
      .optional()
      .default("completes_outfit"),
  },
  async ({ ref, intent }) => {
    try {
      const q = intent ? `?intent=${encodeURIComponent(intent)}` : "";
      return asText(await api(`/products/${encodeURIComponent(ref)}/related${q}`));
    } catch (e) {
      return asError(e);
    }
  },
);

server.tool(
  "list_collections",
  "List editorial collections (Quiet Luxury, Cartagena, Luna de miel, …).",
  {},
  async () => {
    try {
      return asText(await api("/collections"));
    } catch (e) {
      return asError(e);
    }
  },
);

server.tool(
  "get_collection",
  "Products belonging to a collection slug.",
  {
    slug: z.string().describe("e.g. quiet-luxury, cartagena, luna-de-miel, estiliza-cintura"),
    limit: z.number().int().min(1).max(48).optional(),
  },
  async ({ slug, limit }) => {
    try {
      const q = limit ? `?limit=${limit}` : "";
      return asText(await api(`/collections/${encodeURIComponent(slug)}${q}`));
    } catch (e) {
      return asError(e);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
