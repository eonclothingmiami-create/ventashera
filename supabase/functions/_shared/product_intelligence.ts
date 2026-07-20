/**
 * Product Intelligence — module adapters (copy / seo / attributes / relations / knowledge).
 * Each module = interchangeable prompt + provider; not a multi-agent swarm.
 */

export type PiModule =
  | "copy"
  | "seo"
  | "attributes"
  | "relations"
  | "knowledge"
  | "embedding";

export type ProductContext = {
  ref: string;
  name: string | null;
  description: string | null;
  seccion: string | null;
  categoria: string | null;
  colors: string | null;
  sizes: string | null;
  attributes: Record<string, unknown> | null;
  catalogSample: Array<{
    ref: string;
    name: string | null;
    seccion: string | null;
    categoria: string | null;
  }>;
};

const BRAND_FALLBACK = `Hera Swimwear (Colombia). Tono Quiet Luxury: femenino, aspiracional, claro, sin exagerar.
No inventes materiales, precios, stock ni URLs de redes. Español es-CO.`;

export const PROMPT_VERSIONS: Record<Exclude<PiModule, "embedding">, string> = {
  copy: "copy_v2_brand",
  seo: "seo_v2_brand",
  attributes: "attributes_v2_brand",
  relations: "relations_v2_brand",
  knowledge: "knowledge_v2_brand",
};

export function artifactTypeForModule(
  module: PiModule,
): "copy" | "seo" | "attributes" | "relations" | "knowledge_doc" | null {
  if (module === "embedding") return null;
  if (module === "knowledge") return "knowledge_doc";
  return module;
}

function ctxBlock(p: ProductContext): string {
  return JSON.stringify(
    {
      ref: p.ref,
      name: p.name,
      description: p.description,
      seccion: p.seccion,
      categoria: p.categoria,
      colors: p.colors,
      sizes: p.sizes,
      attributes: p.attributes,
    },
    null,
    2,
  );
}

function systemPreamble(brandVoiceGuide?: string | null): string {
  const guide = String(brandVoiceGuide || "").trim() || BRAND_FALLBACK;
  return `## Brand Voice (obligatoria — todos los módulos)
${guide}

## Regla de proveedor
Aunque el modelo LLM cambie, el resultado debe sonar a Hera Swimwear según la Brand Voice anterior — nunca al estilo genérico del modelo.`;
}

export function buildMessages(
  module: Exclude<PiModule, "embedding">,
  p: ProductContext,
  brandVoiceGuide?: string | null,
): Array<{ role: "system" | "user"; content: string }> {
  const productJson = ctxBlock(p);
  const brand = systemPreamble(brandVoiceGuide);

  if (module === "copy") {
    return [
      {
        role: "system",
        content: `${brand}

Eres copywriter de Hera. Responde SOLO JSON válido:
{
  "name": string,
  "description_short": string,
  "description_long": string
}
description_short <= 160 chars. description_long 2-4 párrafos cortos. Respeta tono Quiet Luxury y listas always/never de la Brand Voice.`,
      },
      {
        role: "user",
        content: `Genera copy comercial para este producto:\n${productJson}`,
      },
    ];
  }

  if (module === "seo") {
    return [
      {
        role: "system",
        content: `${brand}

Eres especialista SEO de Hera. Responde SOLO JSON:
{
  "meta_title": string,
  "meta_description": string,
  "slug": string,
  "keywords": string[]
}
Sigue la estructura SEO de la Brand Voice. meta_title ≤ 60. meta_description ≤ 155. slug kebab-case sin acentos.`,
      },
      {
        role: "user",
        content: `Genera pack SEO para:\n${productJson}`,
      },
    ];
  }

  if (module === "attributes") {
    return [
      {
        role: "system",
        content: `${brand}

Eres stylist Hera (Quiet Luxury, Resort, Cartagena, Honeymoon). Responde SOLO JSON:
{
  "product_type": string,
  "style": string[],
  "occasions": string[],
  "fit_goals": string[],
  "silhouette": string|null,
  "coverage": string|null,
  "materials": string[],
  "season": string[],
  "collection_slugs": string[],
  "attrs": {
    "luxury_level": string|null,
    "brand_tone": string|null,
    "semantic_tags": string[]
  }
}
Slugs de colección cuando apliquen: quiet-luxury, cartagena, luna-de-miel, estiliza-cintura.
No inventes materiales; materials [] si no hay dato. brand_tone alineado a Quiet Luxury cuando corresponda.`,
      },
      {
        role: "user",
        content: `Infiere atributos de moda para:\n${productJson}`,
      },
    ];
  }

  if (module === "relations") {
    const sample = JSON.stringify(p.catalogSample.slice(0, 40), null, 2);
    return [
      {
        role: "system",
        content: `${brand}

Eres knowledge curator Hera. Sugiere relaciones SOLO hacia refs del catálogo dado.
Prioriza outfits coherentes con Quiet Luxury / resort / Cartagena cuando el producto lo sostenga.
Responde SOLO JSON:
{
  "candidates": [
    {
      "to_ref": string,
      "relation_type": "pairs_with"|"similar"|"upsell"|"completes_outfit"|"same_look"|"alternative",
      "score": number,
      "reason": string,
      "approved": true
    }
  ]
}
Máximo 8 candidatos. score 0-100. No inventes refs.`,
      },
      {
        role: "user",
        content: `Producto origen:\n${productJson}\n\nCatálogo candidato:\n${sample}`,
      },
    ];
  }

  return [
    {
      role: "system",
      content: `${brand}

Compones el documento de conocimiento canónico Hera para búsqueda semántica.
Responde SOLO JSON:
{
  "document": string
}
Incluye: ref, nombre, tipo, ocasión, estilo Quiet Luxury si aplica, descripción, facetas.
Texto plano, denso, en español. Sin markdown. Sin inventar hechos.`,
    },
    {
      role: "user",
      content: `Compón knowledge document para:\n${productJson}`,
    },
  ];
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = String(raw || "").trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM response is not JSON object");
  return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
}
