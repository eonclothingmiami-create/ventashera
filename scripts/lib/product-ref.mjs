/**
 * REF canónico para catálogo / feeds / TikTok: HERA-{número}.
 * VentasHera ERP es el origen; Supabase products.ref replica este formato.
 */

export const HERA_REF_RE = /^HERA-\d{4,6}$/;

/** @param {string} ref */
export function isNormalizedHeraRef(ref) {
  return HERA_REF_RE.test(String(ref || '').trim().toUpperCase());
}

/**
 * Propone HERA-* a partir de un ref legacy (sin comprobar colisiones en BD).
 * @param {string} raw
 * @param {Set<string>} used
 * @param {{ seq?: number }} [opts]
 */
export function proposeHeraRef(raw, used, opts = {}) {
  let seq = opts.seq ?? 20000;
  const nextSeq = () => {
    while (used.has(`HERA-${String(seq).padStart(5, '0')}`)) seq += 1;
    return seq++;
  };

  const r = String(raw || '').trim().toUpperCase();
  if (isNormalizedHeraRef(r)) {
    used.add(r);
    return r;
  }

  let cand = null;
  if (/^\d+$/.test(r)) cand = `HERA-${r}`;
  else {
    const m = r.match(/(?:^|\s)(\d{3,6})$/);
    if (m) cand = `HERA-${m[1]}`;
  }

  if (cand && !used.has(cand)) {
    used.add(cand);
    return cand;
  }

  let out;
  do {
    out = `HERA-${String(nextSeq()).padStart(5, '0')}`;
  } while (used.has(out));
  used.add(out);
  return out;
}

/**
 * @param {Array<{ id: string, ref: string }>} products
 * @returns {Array<{ id: string, old_ref: string, new_ref: string }>}
 */
export function buildRefMigrationMap(products) {
  const used = new Set();
  let seq = 20000;
  const sorted = [...products].sort((a, b) =>
    String(a.ref || '').localeCompare(String(b.ref || ''), 'es'),
  );
  return sorted.map((p) => {
    const oldRef = String(p.ref || '').trim();
    const newRef = proposeHeraRef(oldRef, used, { seq });
    seq = Math.max(seq, 20000);
    return { id: p.id, old_ref: oldRef, new_ref: newRef };
  });
}
