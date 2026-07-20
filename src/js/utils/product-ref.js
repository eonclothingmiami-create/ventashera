/**
 * REF canónico HERA-XXXXX (catálogo, feeds TikTok, Events API).
 * Cargar antes de core.js en index.html.
 */
(function (global) {
  const HERA_REF_RE = /^HERA-\d{4,6}$/;

  function isNormalizedHeraRef(ref) {
    return HERA_REF_RE.test(String(ref || '').trim().toUpperCase());
  }

  function proposeHeraRef(raw, used, opts) {
    let seq = (opts && opts.seq) || 20000;
    const nextSeq = function () {
      while (used.has('HERA-' + String(seq).padStart(5, '0'))) seq += 1;
      return seq++;
    };

    const r = String(raw || '').trim().toUpperCase();
    if (isNormalizedHeraRef(r)) {
      used.add(r);
      return r;
    }

    let cand = null;
    if (/^\d+$/.test(r)) cand = 'HERA-' + r;
    else {
      const m = r.match(/(?:^|\s)(\d{3,6})$/);
      if (m) cand = 'HERA-' + m[1];
    }

    if (cand && !used.has(cand)) {
      used.add(cand);
      return cand;
    }

    let out;
    do {
      out = 'HERA-' + String(nextSeq()).padStart(5, '0');
    } while (used.has(out));
    used.add(out);
    return out;
  }

  function normalizeProductRef(raw, usedRefs) {
    const used = usedRefs instanceof Set ? usedRefs : new Set();
    return proposeHeraRef(raw, used);
  }

  async function suggestNextHeraRef(supabaseClient) {
    const used = new Set();
    let maxSeq = 19999;
    const { data, error } = await supabaseClient
      .from('products')
      .select('ref')
      .like('ref', 'HERA-%');
    if (error) throw error;
    for (const row of data || []) {
      const ref = String(row.ref || '').trim().toUpperCase();
      if (!HERA_REF_RE.test(ref)) continue;
      used.add(ref);
      const m = ref.match(/^HERA-(\d+)$/);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    }
    let seq = Math.max(20000, maxSeq + 1);
    while (used.has('HERA-' + String(seq).padStart(5, '0'))) seq += 1;
    return 'HERA-' + String(seq).padStart(5, '0');
  }

  global.ProductRefUtil = {
    HERA_REF_RE,
    isNormalizedHeraRef,
    normalizeProductRef,
    proposeHeraRef,
    suggestNextHeraRef,
  };
})(typeof window !== 'undefined' ? window : globalThis);
