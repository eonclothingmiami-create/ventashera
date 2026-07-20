/** OpenAPI 3.0 document served at GET /v1/openapi.json */
export const OPENAPI_V1 = {
  openapi: "3.0.3",
  info: {
    title: "Hera Swimwear Catalog API",
    version: "1.0.0",
    description:
      "AI-ready public catalog API. Canonical product id = products.ref (HERA-*). MCP and future assistants should call this API — not Supabase directly.",
    contact: { name: "Hera Swimwear", url: "https://heraswimsuit.com" },
  },
  servers: [
    { url: "https://heraswimsuit.com/api/v1", description: "Production (Hostinger rewrite)" },
    {
      url: "https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/catalog-api-v1",
      description: "Direct Edge Function",
    },
  ],
  paths: {
    "/capabilities": {
      get: {
        summary: "API capabilities discovery",
        operationId: "getCapabilities",
        responses: { "200": { description: "Capability document" } },
      },
    },
    "/resolve": {
      get: {
        summary: "Resolve legacy id / alias to HERA-* product",
        operationId: "resolveProductId",
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Resolved product" },
          "404": { description: "Not found" },
        },
      },
    },
    "/products": {
      get: {
        summary: "List / filter products",
        operationId: "listProducts",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "in_stock", in: "query", schema: { type: "boolean" } },
          { name: "max_price", in: "query", schema: { type: "number" } },
          { name: "min_price", in: "query", schema: { type: "number" } },
          { name: "product_type", in: "query", schema: { type: "string" } },
          { name: "style", in: "query", schema: { type: "string" } },
          { name: "occasion", in: "query", schema: { type: "string" } },
          { name: "fit_goal", in: "query", schema: { type: "string" } },
          { name: "collection", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 24 } },
          { name: "cursor", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: { "200": { description: "Paginated product list" } },
      },
    },
    "/products/{ref}": {
      get: {
        summary: "Get product by canonical ref",
        operationId: "getProduct",
        parameters: [
          { name: "ref", in: "path", required: true, schema: { type: "string", example: "HERA-13003" } },
        ],
        responses: {
          "200": { description: "Product resource" },
          "404": { description: "Not found" },
        },
      },
    },
    "/products/{ref}/related": {
      get: {
        summary: "Related products (graph + heuristic fallback)",
        operationId: "getRelatedProducts",
        parameters: [
          { name: "ref", in: "path", required: true, schema: { type: "string" } },
          {
            name: "intent",
            in: "query",
            schema: {
              type: "string",
              enum: [
                "similar",
                "kimono",
                "cover_up",
                "pairs_with",
                "completes_outfit",
                "upsell",
                "same_look",
                "alternative",
              ],
              default: "similar",
            },
          },
        ],
        responses: { "200": { description: "Related items" } },
      },
    },
    "/products/{ref}/knowledge": {
      get: {
        summary: "Commercial knowledge pack (graph view)",
        description:
          "Structured projection of knowledge_nodes/edges: product, relationships, media, social, guides, editorial, recommendations, semantic.",
        operationId: "getProductKnowledge",
        parameters: [
          { name: "ref", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Knowledge document (graph view)" } },
      },
    },
    "/search": {
      post: {
        summary: "Search products (keyword + facets; semantic later)",
        operationId: "searchProducts",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  q: { type: "string", example: "bikini elegante Cartagena" },
                  in_stock: { type: "boolean", example: true },
                  max_price: { type: "number", example: 150000 },
                  product_type: { type: "string" },
                  style: { type: "string", example: "quiet_luxury" },
                  occasion: { type: "string", example: "honeymoon" },
                  fit_goal: { type: "string", example: "cinch_waist" },
                  collection: { type: "string", example: "quiet-luxury" },
                  limit: { type: "integer", default: 24 },
                  cursor: { type: "integer", default: 0 },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Search results" } },
      },
    },
    "/collections": {
      get: {
        summary: "List editorial collections",
        operationId: "listCollections",
        responses: { "200": { description: "Collections" } },
      },
    },
    "/collections/{slug}": {
      get: {
        summary: "Products in a collection",
        operationId: "getCollection",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Collection + products" } },
      },
    },
  },
  components: {
    schemas: {
      Product: {
        type: "object",
        required: ["id", "ref", "name", "offer", "availability"],
        properties: {
          id: { type: "string", description: "Same as ref (HERA-*)" },
          ref: { type: "string" },
          brand: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          product_type: { type: "string", nullable: true },
          style: { type: "array", items: { type: "string" } },
          occasions: { type: "array", items: { type: "string" } },
          fit_goals: { type: "array", items: { type: "string" } },
          collections: { type: "array", items: { type: "string" } },
          offer: {
            type: "object",
            properties: {
              price: { type: "number" },
              currency: { type: "string", example: "COP" },
              channel: { type: "string" },
            },
          },
          availability: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["in_stock", "out_of_stock"] },
              quantity: { type: "integer" },
            },
          },
        },
      },
    },
  },
} as const;
