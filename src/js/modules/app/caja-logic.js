// Caja ↔ bodegas, buckets por medio (efectivo, transferencia, addi, contraentrega, …).
(function initCajaLogic(global) {
  const LS_POS_CAJA = 'ventashera_pos_caja_id';
  const LS_POS_BODEGA = 'ventashera_pos_bodega_id';

  const BUCKET_KEYS = ['efectivo', 'transferencia', 'addi', 'contraentrega', 'tarjeta', 'digital', 'otro'];

  function emptySaldos() {
    const o = {};
    BUCKET_KEYS.forEach((k) => {
      o[k] = 0;
    });
    return o;
  }

  function parseJsonField(v, fallback) {
    if (v == null) return fallback;
    if (typeof v === 'object' && !Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  /** Asegura bodegaIds, saldosMetodo y saldo (= efectivo legado). */
  function normalizeCaja(c) {
    if (!c) return c;
    let bodegaIds = c.bodegaIds;
    if (bodegaIds == null) bodegaIds = c.bodega_ids;
    if (typeof bodegaIds === 'string') bodegaIds = parseJsonField(bodegaIds, []);
    if (!Array.isArray(bodegaIds)) bodegaIds = [];

    let saldosMetodo = c.saldosMetodo || c.saldos_metodo;
    saldosMetodo = parseJsonField(saldosMetodo, null);
    if (!saldosMetodo || typeof saldosMetodo !== 'object') saldosMetodo = emptySaldos();
    BUCKET_KEYS.forEach((k) => {
      if (typeof saldosMetodo[k] !== 'number' || Number.isNaN(saldosMetodo[k])) saldosMetodo[k] = 0;
    });

    const legacy = parseFloat(c.saldo) || 0;
    const sumBuckets = BUCKET_KEYS.reduce((s, k) => s + (saldosMetodo[k] || 0), 0);
    if (sumBuckets === 0 && legacy !== 0) {
      saldosMetodo.efectivo = legacy;
    }

    c.bodegaIds = bodegaIds;
    c.saldosMetodo = saldosMetodo;
    c.saldo = saldosMetodo.efectivo;

    if (c.sesionActivaId == null && c.sesion_activa_id != null) c.sesionActivaId = c.sesion_activa_id;
    if (c.sesionActivaId === undefined) c.sesionActivaId = null;
    let pa = c.proximaAperturaSaldos != null ? c.proximaAperturaSaldos : c.proxima_apertura_saldos;
    pa = parseJsonField(pa, null);
    c.proximaAperturaSaldos = pa && typeof pa === 'object' && !Array.isArray(pa) ? pa : null;

    return c;
  }

  function normalizeAllCajas(state) {
    (state.cajas || []).forEach(normalizeCaja);
  }

  function bucketFromMetodoId(metodoId, cfgMetodos) {
    const id = String(metodoId || 'efectivo').toLowerCase();
    const cfg = (cfgMetodos || []).find((m) => m.id === metodoId || String(m.id).toLowerCase() === id);
    const t = String(cfg?.tipo || '').toLowerCase();

    if (id === 'addi' || id.includes('addi')) return 'addi';
    if (id === 'nequi' || id === 'daviplata') return 'digital';
    if (id === 'bancolombia') return 'transferencia';
    if (id === 'tarjeta_debito' || id === 'tarjeta_credito') return 'tarjeta';
    if (id === 'transferencia' || t === 'banco' || t === 'transferencia') return 'transferencia';
    if (id === 'tarjeta' || t === 'tarjeta') return 'tarjeta';
    if (id === 'efectivo' || t === 'efectivo') return 'efectivo';
    if (t === 'digital') return 'digital';
    return 'otro';
  }

  /** Bucket destino para ingreso POS según método y tipo de cobro. */
  function resolvePosSaleBucket(posFormState, state) {
    const canal = posFormState?.canal || 'vitrina';
    const tipoPago = canal === 'vitrina' ? 'contado' : posFormState?.tipoPago || 'contado';
    if (tipoPago === 'contraentrega') return 'contraentrega';
    const mid = posFormState?.metodo || 'efectivo';
    if (mid === 'mixto') return 'otro';
    return bucketFromMetodoId(mid, state?.cfg_metodos_pago);
  }

  function cajaServesBodega(caja, bodegaId) {
    normalizeCaja(caja);
    const ids = caja.bodegaIds || [];
    if (ids.length === 0) return true;
    return ids.includes(bodegaId);
  }

  function listOpenCajasForBodega(state, bodegaId) {
    const bid = bodegaId || 'bodega_main';
    return (state.cajas || []).filter((c) => c.estado === 'abierta' && cajaServesBodega(c, bid));
  }

  function resolveCajaForPos(state, bodegaId, preferredCajaId) {
    const bid = bodegaId || 'bodega_main';
    const open = listOpenCajasForBodega(state, bid);
    if (open.length === 0) return null;
    if (preferredCajaId && open.some((c) => c.id === preferredCajaId)) {
      return open.find((c) => c.id === preferredCajaId);
    }
    return open[0];
  }

  function getPosCajaId() {
    try {
      let v = global.localStorage.getItem(LS_POS_CAJA) || '';
      const canonical = global.AppId?.CAJA_PRINCIPAL_ID;
      if (canonical && v === 'caja_principal') {
        global.localStorage.setItem(LS_POS_CAJA, canonical);
        v = canonical;
      }
      return v;
    } catch {
      return '';
    }
  }

  function setPosCajaId(id) {
    try {
      if (id) global.localStorage.setItem(LS_POS_CAJA, String(id));
      else global.localStorage.removeItem(LS_POS_CAJA);
    } catch {
      /* ignore */
    }
  }

  function getPosBodegaId() {
    try {
      return global.localStorage.getItem(LS_POS_BODEGA) || '';
    } catch {
      return '';
    }
  }

  function setPosBodegaId(id) {
    try {
      if (id) global.localStorage.setItem(LS_POS_BODEGA, String(id));
      else global.localStorage.removeItem(LS_POS_BODEGA);
    } catch {
      /* ignore */
    }
  }

  function saldoEnBucket(caja, bucket) {
    normalizeCaja(caja);
    const b = BUCKET_KEYS.includes(bucket) ? bucket : 'otro';
    return parseFloat(caja.saldosMetodo[b]) || 0;
  }

  function applyDeltaBucket(caja, bucket, delta) {
    normalizeCaja(caja);
    const b = BUCKET_KEYS.includes(bucket) ? bucket : 'otro';
    caja.saldosMetodo[b] = (parseFloat(caja.saldosMetodo[b]) || 0) + delta;
    caja.saldo = caja.saldosMetodo.efectivo;
  }

  /** Para upsert: columna saldo en BD = efectivo (compat). */
  function cajaToRowSaldo(caja) {
    normalizeCaja(caja);
    return caja.saldosMetodo.efectivo || 0;
  }

  function assertPosSaleAllowed(state, posFormState, bodegaId, preferredCajaId) {
    const bid = bodegaId || 'bodega_main';
    const open = listOpenCajasForBodega(state, bid);
    if (open.length === 0) {
      return {
        ok: false,
        message: 'No hay caja abierta para esta bodega. Abre una caja en Tesorería o enlázala en Configuración → Cajas POS.'
      };
    }
    const caja = resolveCajaForPos(state, bid, preferredCajaId);
    if (!caja) {
      return { ok: false, message: 'No se pudo resolver la caja para el POS.' };
    }

    const canal = posFormState?.canal || 'vitrina';
    const tipoPago = canal === 'vitrina' ? 'contado' : posFormState?.tipoPago || 'contado';
    const metodo = posFormState?.metodo || 'efectivo';
    const total =
      posFormState && typeof posFormState.__posTotal === 'number' ? posFormState.__posTotal : null;

    if (metodo === 'efectivo' && tipoPago === 'contado' && total != null && total > 0) {
      const rec = parseFloat(posFormState.montoRecibido);
      if (!rec || rec < total) {
        return {
          ok: false,
          message: 'En efectivo indica el monto recibido (debe ser ≥ total) antes de cobrar.'
        };
      }
    }

    return { ok: true, caja };
  }

  /** Asigna sesión al movimiento; crea sesionActivaId si la caja está abierta y aún no tiene. Devuelve caja si hubo que persistirla. */
  function enrichMovWithSesion(state, cajaId, mov, dbIdFn) {
    const caja = (state.cajas || []).find((c) => c.id === cajaId);
    if (!caja || caja.estado !== 'abierta') return { cajaPatched: null };
    normalizeCaja(caja);
    let cajaPatched = null;
    if (!caja.sesionActivaId && typeof dbIdFn === 'function') {
      caja.sesionActivaId = dbIdFn();
      cajaPatched = caja;
    }
    if (caja.sesionActivaId) mov.sesionId = caja.sesionActivaId;
    return { cajaPatched };
  }

  /** Resumen de movimientos de la sesión actual (por bucket). */
  function resumenSesionCaja(state, cajaId, sesionId) {
    const movs = (state.tes_movimientos || []).filter((m) => {
      if (m.cajaId !== cajaId) return false;
      if (sesionId) return m.sesionId === sesionId;
      return true;
    });
    const sum = { efectivo: { ing: 0, egr: 0 }, transferencia: { ing: 0, egr: 0 }, otros: { ing: 0, egr: 0 } };
    for (let i = 0; i < movs.length; i++) {
      const m = movs[i];
      const b = m.bucket || 'efectivo';
      const target = b === 'efectivo' ? sum.efectivo : b === 'transferencia' ? sum.transferencia : sum.otros;
      if (m.tipo === 'ingreso') target.ing += parseFloat(m.valor) || 0;
      else target.egr += parseFloat(m.valor) || 0;
    }
    return {
      movsCount: movs.length,
      efectivoNeto: sum.efectivo.ing - sum.efectivo.egr,
      transferNeto: sum.transferencia.ing - sum.transferencia.egr,
      sum
    };
  }

  /** Saldos sugeridos al abrir turno (último cierre o libro actual). */
  function saldosSugeridosApertura(caja) {
    normalizeCaja(caja);
    const base = emptySaldos();
    const pa = caja.proximaAperturaSaldos;
    if (pa && typeof pa === 'object') {
      BUCKET_KEYS.forEach((k) => {
        if (typeof pa[k] === 'number' && !Number.isNaN(pa[k])) base[k] = pa[k];
      });
      return base;
    }
    BUCKET_KEYS.forEach((k) => {
      base[k] = parseFloat(caja.saldosMetodo[k]) || 0;
    });
    return base;
  }

  global.AppCajaLogic = {
    BUCKET_KEYS,
    LS_POS_CAJA,
    LS_POS_BODEGA,
    emptySaldos,
    normalizeCaja,
    normalizeAllCajas,
    bucketFromMetodoId,
    resolvePosSaleBucket,
    cajaServesBodega,
    listOpenCajasForBodega,
    resolveCajaForPos,
    getPosCajaId,
    setPosCajaId,
    getPosBodegaId,
    setPosBodegaId,
    saldoEnBucket,
    applyDeltaBucket,
    cajaToRowSaldo,
    assertPosSaleAllowed,
    enrichMovWithSesion,
    resumenSesionCaja,
    saldosSugeridosApertura
  };
})(window);
