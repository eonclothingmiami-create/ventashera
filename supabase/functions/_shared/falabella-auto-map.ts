/**
 * Auto-mapa ERP → Falabella Seller Center (FACO / moda).
 * Prioridad: body override > secret JSON > built-in Hera > defaults.
 * Categoría 3199 = hoja usada con éxito en producción Hera (Trajes de Baño).
 */

export type ErpProductLike = {
  seccion?: string | null;
  categoria?: string | null;
  cat?: string | null;
  name?: string | null;
  ref?: string | null;
};

export type FalabellaAutoMapResult = {
  primaryCategoryId: string;
  color: string;
  colorBasico: string;
  talla: string;
  brand: string;
  productDataMandatory: Record<string, string>;
  mapTrace: {
    categorySource: string;
    colorSource: string;
    tallaSource: string;
    brandSource: string;
    productDataKeys: string[];
  };
};

const FEED = {
  tipoTraje: 'TipoDeTrajeDeBano',
  material: 'MaterialDeVestuario',
  genero: 'GeneroDeVestuario',
} as const;

/** Categorías hoja conocidas en la cuenta Hera (evidencia DB synced / feeds). */
export const HERA_BUILTIN_CATEGORY_MAP: Record<string, string> = {
  // Trajes de baño (PrimaryCategory productivo)
  bikinis: '3199',
  bikini: '3199',
  enterizos: '3199',
  enterizo: '3199',
  monokinis: '3199',
  monokini: '3199',
  tankinis: '3199',
  tankini: '3199',
  '3 piezas': '3199',
  trikinis: '3199',
  trikini: '3199',
  asoleadores: '3199',
  asoleador: '3199',
  infantil: '3199',
  'trajes de bano': '3199',
  'traje de bano': '3199',
  // Pareos / salidas (draft histórico usó 3188)
  'salidas de bano': '3188',
  pareo: '3188',
  // Secciones ERP no-baño: no forzar 3199 aquí — usa FALABELLA_CATEGORY_MAP_JSON o __default__
  // (si no hay secret, __default__ 3199 mantiene el comportamiento histórico Hera-baño)
  __default__: '3199',
};

const TIPO_TRAJE_BY_CAT: Record<string, string> = {
  bikinis: 'Bikini',
  bikini: 'Bikini',
  enterizos: 'Enterizo',
  enterizo: 'Enterizo',
  monokinis: 'Enterizo',
  monokini: 'Enterizo',
  tankinis: 'Tankini',
  tankini: 'Tankini',
  '3 piezas': 'Bikini',
  trikinis: 'Bikini',
  trikini: 'Bikini',
  asoleadores: 'Enterizo',
  asoleador: 'Enterizo',
  infantil: 'Bikini',
  'salidas de bano': 'Pareo',
  pareo: 'Pareo',
  pijamas: 'Pijama',
  pijama: 'Pijama',
};

/** Colores básicos Falabella-friendly a partir de etiquetas ERP libres. */
const COLOR_BASICO_RULES: { re: RegExp; value: string }[] = [
  { re: /\b(negro|black|noir)\b/i, value: 'Negro' },
  { re: /\b(blanco|white|ivory|crudo|hueso)\b/i, value: 'Blanco' },
  { re: /\b(azul|blue|marino|navy|celeste|turquesa|cobalto|indigo)\b/i, value: 'Azul' },
  { re: /\b(verde|green|oliva|menta|esmeralda|jade|pino)\b/i, value: 'Verde' },
  // Vino / burgundy antes de "rojo" genérico y de print/abstract
  { re: /\b(vinotinto|vino|wine|burgundy|guinda|borgoña|bordeaux|granate)\b/i, value: 'Rojo' },
  { re: /\b(rojo|red|escarlata|cereza)\b/i, value: 'Rojo' },
  { re: /\b(rosa|rose|pink|fucsia|fuscia|magenta|palo\s*de\s*rosa|rosado)\b/i, value: 'Rosa' },
  { re: /\b(amarillo|yellow|mostaza|dorado|gold)\b/i, value: 'Amarillo' },
  { re: /\b(naranja|orange|terracota|coral|salmon|salmón|mandarina)\b/i, value: 'Naranja' },
  { re: /\b(morado|violeta|lila|purple|uva|lavanda)\b/i, value: 'Morado' },
  { re: /\b(gris|gray|grey|plata|silver|plomo|acero)\b/i, value: 'Gris' },
  { re: /\b(beige|camel|arena|nude|crema|taupe|khaki|caqui|marfil)\b/i, value: 'Beige' },
  { re: /\b(cafe|café|marron|marrón|brown|chocolate|cognac|terracota\s*cafe)\b/i, value: 'Cafe' },
  // Estampados / nombres creativos sin color sólido claro
  {
    re: /\b(unico|única|unica|multicolo|print|sublimad|abstract|floral|animal|leopard|tigre|cebra|snake|sesgo|pill|mirage|galaxy|tie\s*dye|batik)\b/i,
    value: 'Multicolor',
  },
];

/** Valores tipicos de variación Color/ColorBasico en moda FACO. */
const FALABELLA_SAFE_COLORS = new Set([
  'Negro',
  'Blanco',
  'Azul',
  'Verde',
  'Rojo',
  'Rosa',
  'Amarillo',
  'Naranja',
  'Morado',
  'Gris',
  'Beige',
  'Cafe',
  'Multicolor',
  'Fucsia',
  'UNICO',
  'Única',
]);

/** Normaliza etiquetas ERP a valores de variación aceptables en moda FACO (nunca nombres creativos). */
export function normalizeColorVariation(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';

  const u = normalizeKey(s).replace(/\s+/g, '');
  const aliases: Record<string, string> = {
    fuscia: 'Rosa',
    fucsia: 'Rosa',
    fuchsia: 'Rosa',
    cafe: 'Cafe',
    café: 'Cafe',
    marron: 'Cafe',
    marrón: 'Cafe',
    negro: 'Negro',
    blanco: 'Blanco',
    rojo: 'Rojo',
    azul: 'Azul',
    rosa: 'Rosa',
    verde: 'Verde',
    unico: 'Multicolor',
    única: 'Multicolor',
    unica: 'Multicolor',
    multicolor: 'Multicolor',
  };
  if (aliases[u]) return aliases[u];

  // Detectar color dentro de etiquetas largas: "abstract sesgo vinotinto", "pill sesgo azul oscuro"
  for (const rule of COLOR_BASICO_RULES) {
    if (rule.re.test(s)) return rule.value;
  }

  // Una sola palabra corta ya tipificada
  const titled = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (FALABELLA_SAFE_COLORS.has(titled)) return titled;

  // Nunca enviar el nombre creativo del ERP: Falabella responde "Variation value is wrong"
  return 'Multicolor';
}

export function normalizeKey(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function firstToken(list: string | null | undefined): string {
  if (!list) return '';
  const raw = String(list).trim();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr) && arr.length) return String(arr[0] ?? '').trim();
    } catch {
      /* fall through */
    }
  }
  return raw
    .split(/[,|;/]/)
    .map((x) => x.trim())
    .filter(Boolean)[0] || '';
}

export function mapColorBasico(colorLabel: string): string {
  const s = String(colorLabel || '').trim();
  if (!s) return 'Multicolor';
  // Reutilizar la misma detección que Color (variación)
  const detected = normalizeColorVariation(s);
  if (detected && detected !== 'UNICO') return detected === 'Única' ? 'Multicolor' : detected;
  return 'Multicolor';
}

export function normalizeTalla(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  const u = normalizeKey(t).replace(/\s+/g, '');
  const aliases: Record<string, string> = {
    xs: 'XS',
    s: 'S',
    m: 'M',
    l: 'L',
    xl: 'XL',
    xxl: 'XXL',
    '2xl': 'XXL',
    unica: 'Única',
    único: 'Única',
    unico: 'Única',
    u: 'Única',
    one: 'Única',
    onesize: 'Única',
  };
  if (aliases[u]) return aliases[u];
  const up = t.toUpperCase().slice(0, 20);
  // Solo tallas conocidas FACO; evita "Variation value is wrong" por textos libres
  if (['XS', 'S', 'M', 'L', 'XL', 'XXL', 'ÚNICA', 'UNICA'].includes(up) || up === 'ÚNICA') {
    return up === 'UNICA' || up === 'ÚNICA' ? 'Única' : up;
  }
  return '';
}

function parseCategoryMapJson(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  try {
    const p = JSON.parse(raw) as unknown;
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
        if (v != null && String(v).trim()) out[k] = String(v).trim();
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function lookupCategoryId(
  product: ErpProductLike,
  mergedMap: Record<string, string>,
  fallbackSecret: string,
): { id: string; source: string } {
  const candidates = [
    product.categoria,
    product.cat,
    product.seccion,
    [product.seccion, product.categoria].filter(Boolean).join(' '),
    [product.categoria, product.seccion].filter(Boolean).join(' '),
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  // Exact
  for (const c of candidates) {
    const n = normalizeKey(c);
    for (const [mk, val] of Object.entries(mergedMap)) {
      if (mk === '__default__' || mk === 'default') continue;
      if (normalizeKey(mk) === n && val) return { id: val, source: `exact:${mk}` };
    }
  }
  // Includes
  for (const c of candidates) {
    const n = normalizeKey(c);
    for (const [mk, val] of Object.entries(mergedMap)) {
      if (mk === '__default__' || mk === 'default') continue;
      const nk = normalizeKey(mk);
      if (nk.length < 3) continue;
      if ((n.includes(nk) || nk.includes(n)) && val) return { id: val, source: `fuzzy:${mk}` };
    }
  }
  const def = mergedMap['__default__'] ?? mergedMap['default'];
  if (def) return { id: def, source: 'map.__default__' };
  if (fallbackSecret.trim()) return { id: fallbackSecret.trim(), source: 'FALABELLA_PRIMARY_CATEGORY_ID' };
  return { id: '3199', source: 'builtin.fallback_3199' };
}

function resolveTipoTraje(product: ErpProductLike): string {
  const keys = [product.categoria, product.cat, product.seccion, product.name].map((x) => normalizeKey(String(x || '')));
  for (const k of keys) {
    for (const [mk, val] of Object.entries(TIPO_TRAJE_BY_CAT)) {
      if (k === mk || k.includes(mk)) return val;
    }
  }
  if (keys.some((k) => k.includes('pijama'))) return 'Pijama';
  if (keys.some((k) => k.includes('deport'))) return 'Enterizo';
  return 'Bikini';
}

function parseProductDataExtra(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  try {
    const p = JSON.parse(raw) as unknown;
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
        if (v != null && String(v).trim()) out[k] = String(v).trim();
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export type AutoMapInput = {
  product: ErpProductLike;
  /** Overrides from client (maquetador opcional). */
  body?: {
    primaryCategoryId?: string;
    brand?: string;
    color?: string;
    colorBasico?: string;
    talla?: string;
    productDataMandatory?: Record<string, unknown>;
  };
  env?: {
    categoryMapJson?: string;
    primaryCategoryFallback?: string;
    brandDefault?: string;
    defaultColor?: string;
    defaultColorBasico?: string;
    defaultTalla?: string;
    productDataExtraJson?: string;
    defaultMaterial?: string;
    defaultGenero?: string;
  };
  /** Color/talla ya resueltos desde BD (product_colors / sizes / row). */
  resolvedColor?: string;
  resolvedTalla?: string;
};

/**
 * Construye el mapa completo para ProductCreate sin UI de maquetador.
 */
export function buildFalabellaAutoMap(input: AutoMapInput): FalabellaAutoMapResult {
  const product = input.product || {};
  const body = input.body || {};
  const env = input.env || {};

  const mergedMap: Record<string, string> = {
    ...HERA_BUILTIN_CATEGORY_MAP,
    ...parseCategoryMapJson(String(env.categoryMapJson || '')),
  };

  let primaryCategoryId = String(body.primaryCategoryId || '').trim();
  let categorySource = 'body';
  if (!primaryCategoryId) {
    const hit = lookupCategoryId(product, mergedMap, String(env.primaryCategoryFallback || ''));
    primaryCategoryId = hit.id;
    categorySource = hit.source;
  }

  let colorRaw = String(body.color || input.resolvedColor || env.defaultColor || '').trim();
  let colorSource = body.color ? 'body' : input.resolvedColor ? 'db' : env.defaultColor ? 'env.default' : 'empty';
  let color = '';
  if (!colorRaw) {
    color = 'Multicolor';
    colorSource = 'fallback.Multicolor';
  } else {
    color = normalizeColorVariation(colorRaw);
    if (color !== colorRaw && colorSource === 'db') colorSource = 'db.detected';
    else if (color !== colorRaw && colorSource === 'body') colorSource = 'body.detected';
  }

  let colorBasico = String(body.colorBasico || env.defaultColorBasico || '').trim();
  if (!colorBasico) {
    // Misma detección sobre el texto original del ERP (no sobre el Color ya mapeado)
    colorBasico = mapColorBasico(colorRaw || color);
  } else {
    colorBasico = normalizeColorVariation(colorBasico) || colorBasico;
  }
  // Mantener Color y ColorBasico alineados a valores seguros
  if (!FALABELLA_SAFE_COLORS.has(colorBasico)) colorBasico = color;
  if (!color) color = colorBasico || 'Multicolor';

  let talla = normalizeTalla(String(body.talla || input.resolvedTalla || env.defaultTalla || ''));
  let tallaSource = body.talla ? 'body' : input.resolvedTalla ? 'db' : env.defaultTalla ? 'env.default' : 'empty';
  if (!talla) {
    talla = 'M';
    tallaSource = 'fallback.M';
  }

  let brand = String(body.brand || env.brandDefault || '').trim();
  let brandSource = body.brand ? 'body' : env.brandDefault ? 'env.FALABELLA_BRAND' : 'empty';
  if (!brand) {
    brand = 'GENERICO';
    brandSource = 'fallback.GENERICO';
  }

  const secretPd = parseProductDataExtra(String(env.productDataExtraJson || ''));
  const bodyPd: Record<string, string> = {};
  if (body.productDataMandatory && typeof body.productDataMandatory === 'object') {
    for (const [k, v] of Object.entries(body.productDataMandatory)) {
      if (v != null && String(v).trim()) bodyPd[k] = String(v).trim();
    }
  }

  const autoPd: Record<string, string> = {
    [FEED.tipoTraje]: resolveTipoTraje(product),
    [FEED.material]: String(env.defaultMaterial || 'Poliéster').trim() || 'Poliéster',
    [FEED.genero]: String(env.defaultGenero || 'Mujer').trim() || 'Mujer',
  };

  // secret < auto < body (body gana)
  const productDataMandatory = { ...secretPd, ...autoPd, ...bodyPd };

  return {
    primaryCategoryId,
    color,
    colorBasico,
    talla,
    brand,
    productDataMandatory,
    mapTrace: {
      categorySource,
      colorSource,
      tallaSource,
      brandSource,
      productDataKeys: Object.keys(productDataMandatory),
    },
  };
}

export { FEED as FALABELLA_FEED_NAMES };
