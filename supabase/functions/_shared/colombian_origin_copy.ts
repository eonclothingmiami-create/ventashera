/** Copy de origen colombiano — catálogo, IA y marketplaces (eBay, etc.). */

const COLOMBIA_RE =
  /colombia|colombian|colombiano|colombiana|hecho en colombia|made in colombia|confeccionado en colombia|manufactured in colombia|colombian-made|diseñado en colombia|designed in colombia/i;

export function hasColombianOriginMention(text: string): boolean {
  return COLOMBIA_RE.test(String(text || ""));
}

/** Descripción corta catálogo (es-CO), máx ~160 caracteres. */
export function ensureColombianOriginEs(text: string, maxLen = 160): string {
  const base = String(text || "").trim();
  if (!base) {
    return "Traje de baño colombiano Hera Swimwear, confeccionado en Colombia.".slice(0, maxLen);
  }
  if (hasColombianOriginMention(base)) return base.slice(0, maxLen);

  const suffixes = [
    " Confeccionado en Colombia.",
    " Hecho en Colombia.",
    " Origen colombiano.",
  ];
  for (const suffix of suffixes) {
    if (base.length + suffix.length <= maxLen) return (base + suffix).slice(0, maxLen);
  }

  const prefix = "Traje de baño colombiano. ";
  if (prefix.length + base.length <= maxLen) return (prefix + base).slice(0, maxLen);
  return base.slice(0, maxLen);
}

/** Descripciones largas / marketplaces en inglés (eBay wholesale). */
export function ensureColombianOriginEn(text: string, maxLen = 4000): string {
  const base = String(text || "").trim();
  const stamp =
    " Authentic Colombian swimwear by Hera Swimwear — designed and manufactured in Colombia.";
  if (!base) return stamp.trim().slice(0, maxLen);
  if (hasColombianOriginMention(base)) return base.slice(0, maxLen);
  return (base + stamp).slice(0, maxLen);
}

export const EBAY_LOT_ORIGIN_LEAD =
  "Wholesale lot of authentic Colombian swimwear, manufactured in Colombia by Hera Swimwear. ";

export const SEO_META_COLOMBIA_HINT =
  "Incluir origen colombiano (traje de baño hecho/confeccionado en Colombia) cuando quepa en el límite de caracteres.";
