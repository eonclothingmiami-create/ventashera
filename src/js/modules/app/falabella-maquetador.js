/**
 * Perfil Falabella en el maquetador genérico: DTO, validación UI y armado de payload para Edge Function.
 * No toca POS / inventario / tesorería.
 */
(function initFalabellaMaquetador(global) {
  const FEED_NAMES = {
    tipoTraje: 'TipoDeTrajeDeBano',
    material: 'MaterialDeVestuario',
    genero: 'GeneroDeVestuario',
  };

  /**
   * @typedef {Object} FalabellaDraft
   * @property {string} [brand]
   * @property {string} [name]
   * @property {string} [description]
   * @property {string} [primaryCategoryId]
   * @property {string} [sellerSku]
   * @property {string} [color]
   * @property {string} [colorBasico]
   * @property {string} [talla]
   * @property {string} [conditionType]
   * @property {number} [packageHeight]
   * @property {number} [packageLength]
   * @property {number} [packageWeight]
   * @property {number} [packageWidth]
   * @property {string} [taxPercentage]
   * @property {string} [tipoTrajeDeBano]
   * @property {string} [materialDeVestuario]
   * @property {string} [generoDeVestuario]
   * @property {string} [variationParentKey] snapshot opcional p. ej. Color+Talla validado
   */

  function numOr(v, def) {
    const n = parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : def;
  }

  function normalizeBrandKey(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** Alineado con Edge `isGenericBrand` (GENERICO / genérico / etc.). */
  function isGenericBrand(brand) {
    const t = normalizeBrandKey(brand);
    return (
      t === 'generico' ||
      t === 'generic' ||
      t === 'marca generica' ||
      t === 'generica' ||
      t === 'generico temporal'
    );
  }

  /**
   * Recoge draft desde el DOM (ids m-fal-*). Si no existe panel, devuelve objeto vacío.
   * @returns {FalabellaDraft}
   */
  function collectDraftFromDom() {
    const g = (id) => global.document.getElementById(id);
    const val = (id) => (g(id)?.value ?? '').trim();
    const num = (id) => numOr(g(id)?.value, NaN);
    return {
      brand: val('m-fal-brand'),
      name: val('m-fal-name'),
      description: val('m-fal-desc'),
      primaryCategoryId: val('m-fal-primary-cat'),
      sellerSku: val('m-fal-seller-sku'),
      color: val('m-fal-color'),
      colorBasico: val('m-fal-color-basico') || val('m-fal-color'),
      talla: val('m-fal-talla'),
      conditionType: val('m-fal-condition'),
      packageHeight: num('m-fal-pkg-h'),
      packageWidth: num('m-fal-pkg-w'),
      packageLength: num('m-fal-pkg-l'),
      packageWeight: num('m-fal-pkg-wt'),
      taxPercentage: val('m-fal-tax'),
      tipoTrajeDeBano: val('m-fal-tipo-traje'),
      materialDeVestuario: val('m-fal-material'),
      generoDeVestuario: val('m-fal-genero'),
    };
  }

  /**
   * @param {object} product — artículo ERP (articulos[])
   * @param {FalabellaDraft} draft
   * @returns {object} payload para requestFalabellaSync (Edge Function)
   */
  function buildFalabellaPayload(product, draft) {
    const pid = product?.id || '';
    const name = String(draft.name || product?.nombre || product?.name || '').trim();
    const desc = String(draft.description || product?.descripcion || '').trim();
    const sellerSku = String(draft.sellerSku || product?.ref || product?.codigo || pid)
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(0, 200);
    const productDataMandatory = {};
    if (draft.tipoTrajeDeBano) productDataMandatory[FEED_NAMES.tipoTraje] = String(draft.tipoTrajeDeBano);
    if (draft.materialDeVestuario) productDataMandatory[FEED_NAMES.material] = String(draft.materialDeVestuario);
    if (draft.generoDeVestuario) productDataMandatory[FEED_NAMES.genero] = String(draft.generoDeVestuario);

    const raw = {
      productId: pid,
      brand: String(draft.brand || '').trim(),
      primaryCategoryId: String(draft.primaryCategoryId || '').trim(),
      sellerSku,
      color: String(draft.color || '').trim(),
      colorBasico: String(draft.colorBasico || draft.color || '').trim(),
      talla: String(draft.talla || '').trim(),
      parentSku: String(draft.sellerSku || sellerSku || '').trim().slice(0, 200),
      conditionType: String(draft.conditionType || 'Nuevo').trim(),
      packageHeight: Number.isFinite(draft.packageHeight) ? draft.packageHeight : undefined,
      packageWidth: Number.isFinite(draft.packageWidth) ? draft.packageWidth : undefined,
      packageLength: Number.isFinite(draft.packageLength) ? draft.packageLength : undefined,
      packageWeight: Number.isFinite(draft.packageWeight) ? draft.packageWeight : undefined,
      taxPercentage: String(draft.taxPercentage || '').trim() || undefined,
      productDataMandatory: Object.keys(productDataMandatory).length ? productDataMandatory : undefined,
      overrideName: name || undefined,
      overrideDescription: desc || undefined,
      falabellaProfile: true,
    };
    return Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
  }

  /**
   * Opciones desde fila atributo GetCategoryAttributes (estructura variable).
   * @param {object} attr
   * @returns {string[]}
   */
  function optionsFromAttribute(attr) {
    if (!attr || typeof attr !== 'object') return [];
    const raw = attr.Options ?? attr.options ?? attr.Option;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (const o of list) {
      if (typeof o === 'string') {
        if (o.trim()) out.push(o.trim());
        continue;
      }
      if (o && typeof o === 'object') {
        const v = o.Name ?? o.name ?? o.Value ?? o.value ?? o.Label ?? o.label;
        if (v != null && String(v).trim()) out.push(String(v).trim());
      }
    }
    return [...new Set(out)];
  }

  /**
   * @param {object} apiRes — respuesta requestFalabellaCategoryAttributes
   * @returns {{ byFeedName: Record<string, string[]>, attributes: unknown[] }}
   */
  function indexCategoryAttributes(apiRes) {
    const attrs = apiRes?.attributes || [];
    const list = Array.isArray(attrs) ? attrs : [];
    const byFeedName = {};
    for (const a of list) {
      const fn = String(a?.FeedName ?? a?.feedName ?? '').trim();
      if (!fn) continue;
      const opts = optionsFromAttribute(a);
      if (opts.length) byFeedName[fn] = opts;
    }
    return { byFeedName, attributes: list };
  }

  /**
   * Valida que valores de draft estén en listas de opciones (no texto libre en dropdowns).
   * @param {FalabellaDraft} draft
   * @param {{ byFeedName: Record<string, string[]> }} indexed
   * @returns {{ ok: boolean, errors: { field: string, message: string }[] }}
   */
  function validateOptionFields(draft, indexed) {
    const errors = [];
    const { byFeedName } = indexed || { byFeedName: {} };
    const check = (feedName, value, label) => {
      const opts = byFeedName[feedName];
      if (!opts || opts.length === 0) return;
      const v = String(value || '').trim();
      if (!v) return;
      const ok = opts.some((o) => String(o).trim().toLowerCase() === v.toLowerCase());
      if (!ok) {
        errors.push({
          field: feedName,
          message: `${label}: el valor "${v}" no está en las opciones permitidas de la categoría.`,
        });
      }
    };
    check(FEED_NAMES.tipoTraje, draft.tipoTrajeDeBano, 'Tipo de traje');
    check(FEED_NAMES.material, draft.materialDeVestuario, 'Material');
    check(FEED_NAMES.genero, draft.generoDeVestuario, 'Género');
    return { ok: errors.length === 0, errors };
  }

  /**
   * Variación Color / ColorBasico / Talla vs opciones de categoría (mismos FeedName que el XML raíz).
   */
  function validateVariationAgainstCategoryOptions(draft, indexed) {
    const errors = [];
    const { byFeedName } = indexed || { byFeedName: {} };
    const check = (feedName, value, label) => {
      const opts = byFeedName[feedName];
      if (!opts || opts.length === 0) return;
      const v = String(value || '').trim();
      if (!v) return;
      const ok = opts.some((o) => String(o).trim().toLowerCase() === v.toLowerCase());
      if (!ok) {
        errors.push({
          field: feedName,
          message: `${label}: combinación no válida para la categoría (use un valor de la lista).`,
        });
      }
    };
    check('Color', draft.color, 'Color');
    check('ColorBasico', draft.colorBasico, 'Color básico');
    check('Talla', draft.talla, 'Talla');
    return { ok: errors.length === 0, errors };
  }

  /**
   * Validación UI perfil Falabella (FACO = tax obligatorio).
   * @param {FalabellaDraft} draft
   * @param {{ buFac?: boolean }} [opts]
   * @returns {{ ok: boolean, errors: { field: string, message: string }[] }}
   */
  function validateDraft(draft, opts) {
    const errors = [];
    const req = (field, msg) => {
      if (!String(draft[field] ?? '').trim()) errors.push({ field, message: msg });
    };
    req('brand', 'Marca obligatoria.');
    req('name', 'Nombre obligatorio.');
    if (String(draft.description || '').trim().length < 10) {
      errors.push({ field: 'description', message: 'Descripción obligatoria (mín. 10 caracteres).' });
    }
    req('primaryCategoryId', 'PrimaryCategory (ID numérico Falabella) obligatorio.');
    req('sellerSku', 'Seller SKU obligatorio.');
    req('color', 'Color obligatorio.');
    req('colorBasico', 'Color básico obligatorio (o igual a color).');
    req('talla', 'Talla obligatoria.');
    req('conditionType', 'Tipo de condición obligatorio.');
    ['packageHeight', 'packageWidth', 'packageLength', 'packageWeight'].forEach((k) => {
      const n = draft[k];
      if (!Number.isFinite(n) || n <= 0) errors.push({ field: k, message: `${k} debe ser un número > 0.` });
    });
    if (opts?.buFac !== false) {
      if (!String(draft.taxPercentage || '').trim()) {
        errors.push({ field: 'taxPercentage', message: 'Tax % obligatorio para FACO (Colombia).' });
      }
    }
    req('tipoTrajeDeBano', 'Tipo de traje de baño obligatorio.');
    req('materialDeVestuario', 'Material de vestuario obligatorio.');
    req('generoDeVestuario', 'Género de vestuario obligatorio.');

    return { ok: errors.length === 0, errors };
  }

  /**
   * Sincroniza nombre/desc/ref del formulario genérico si los campos Falabella están vacíos al activar perfil.
   */
  function hydrateDraftFieldsFromGenericForm() {
    const g = (id) => global.document.getElementById(id);
    const setIfEmpty = (fid, val) => {
      const el = g(fid);
      if (el && !String(el.value || '').trim() && val) el.value = val;
    };
    setIfEmpty('m-fal-name', g('m-art-nombre')?.value);
    setIfEmpty('m-fal-desc', g('m-art-desc')?.value);
    setIfEmpty('m-fal-seller-sku', (g('m-art-codigo')?.value || '').trim().toUpperCase());
    const t = (g('m-art-tallas')?.value || '').split(',')[0]?.trim();
    const c = (g('m-art-colores')?.value || '').split(',')[0]?.trim();
    setIfEmpty('m-fal-talla', t);
    setIfEmpty('m-fal-color', c);
    setIfEmpty('m-fal-color-basico', c);
  }

  global.FalabellaMaquetador = {
    FEED_NAMES,
    collectDraftFromDom,
    buildFalabellaPayload,
    validateDraft,
    validateOptionFields,
    validateVariationAgainstCategoryOptions,
    indexCategoryAttributes,
    optionsFromAttribute,
    hydrateDraftFieldsFromGenericForm,
    isGenericBrand,
    normalizeBrandKey,
  };
})(window);
