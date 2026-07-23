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
  { re: /\b(blanco|white|ivory|crudo)\b/i, value: 'Blanco' },
  { re: /\b(azul|blue|marino|navy|celeste|turquesa)\b/i, value: 'Azul' },
  { re: /\b(verde|green|oliva|menta|esmeralda)\b/i, value: 'Verde' },
  { re: /\b(rojo|red|vinotinto|burgundy|guinda)\b/i, value: 'Rojo' },
  { re: /\b(rosa|pink|fucsia|fucsia|magenta)\b/i, value: 'Rosa' },
  { re: /\b(amarillo|yellow|mostaza|dorado|gold)\b/i, value: 'Amarillo' },
  { re: /\b(naranja|orange|terracota|coral)\b/i, value: 'Naranja' },
  { re: /\b(morado|violeta|lila|purple|uva)\b/i, value: 'Morado' },
  { re: /\b(gris|gray|grey|plata|silver)\b/i, value: 'Gris' },
  { re: /\b(beige|camel|arena|nude|crema|taupe|khaki|caqui)\b/i, value: 'Beige' },
  { re: /\b(cafe|marron|brown|chocolate|cognac)\b/i, value: 'Cafe' },
  { re: /\b(unico|única|unica|multicolo|print|sublimad|abstract|floral|animal)\b/i, value: 'Multicolor' },
];

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
  for (const rule of COLOR_BASICO_RULES) {
    if (rule.re.test(s)) return rule.value;
  }
  // Una sola palabra corta → capitalizar
  if (/^[a-záéíóúüñ\s-]{2,24}$/i.test(s) && !/\s{2,}/.test(s)) {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
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
  return t.toUpperCase().slice(0, 20);
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

  let color = String(body.color || input.resolvedColor || env.defaultColor || '').trim();
  let colorSource = body.color ? 'body' : input.resolvedColor ? 'db' : env.defaultColor ? 'env.default' : 'empty';
  if (!color) {
    color = 'UNICO';
    colorSource = 'fallback.UNICO';
  }

  let colorBasico = String(body.colorBasico || env.defaultColorBasico || '').trim();
  if (!colorBasico) colorBasico = mapColorBasico(color);

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
