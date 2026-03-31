// Shared repository layer for Supabase access.
(function initAppRepository(global) {
  const SUPABASE_URL = 'https://niilaxdeetuzutycvdkz.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paWxheGRlZXR1enV0eWN2ZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjc0NjIsImV4cCI6MjA4ODk0MzQ2Mn0.GI8E7vRzxi5NumN_f4T432Lx4BcmgGLZo81BR9h3h8c';

  let supabaseClient = null;
  try {
    if (global.supabase && typeof global.supabase.createClient === 'function') {
      supabaseClient = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }
  } catch (e) {
    console.error('Supabase init error:', e);
  }

  async function restHeaders() {
    let token = SUPABASE_ANON_KEY;
    try {
      if (supabaseClient && typeof supabaseClient.auth?.getSession === 'function') {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.access_token) token = session.access_token;
      }
    } catch (_) {
      /* noop */
    }
    return {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    };
  }

  /**
   * Cabeceras para invocar Edge Functions (fetch directo).
   * Usa JWT de sesión si hay usuario logueado; si el gateway devuelve 401, el cliente puede reintentar solo con anon.
   */
  async function getSupabaseEdgeHeaders() {
    const apikey = SUPABASE_ANON_KEY;
    let bearer = apikey;
    try {
      if (supabaseClient && typeof supabaseClient.auth?.getSession === 'function') {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.access_token) bearer = session.access_token;
      }
    } catch (_) {
      /* noop */
    }
    return {
      'Content-Type': 'application/json',
      apikey,
      Authorization: 'Bearer ' + bearer,
    };
  }

  async function supabaseCall(method, table, data = null, id = null, filters = null) {
    try {
      let url = `${SUPABASE_URL}/rest/v1/${table}`;
      const headers = await restHeaders();

      if (method === 'GET') {
        if (id) url += `?id=eq.${id}`;
        else if (filters) {
          const filterStr = Object.entries(filters).map(([k, v]) => `${k}=eq.${v}`).join('&');
          url += `?${filterStr}`;
        }
        const resp = await fetch(url, { method: 'GET', headers });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
      }

      if (method === 'POST') {
        const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
      }

      if (method === 'PATCH') {
        if (!id) throw new Error('ID required for PATCH');
        url += `?id=eq.${id}`;
        const resp = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(data) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
      }

      if (method === 'DELETE') {
        if (!id) throw new Error('ID required for DELETE');
        url += `?id=eq.${id}`;
        const resp = await fetch(url, { method: 'DELETE', headers });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return { success: true };
      }

      throw new Error(`Método ${method} no soportado`);
    } catch (err) {
      console.error(`Supabase error [${method} ${table}]:`, err);
      throw err;
    }
  }

  global.AppRepository = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    supabaseClient,
    supabaseCall,
    getSupabaseEdgeHeaders,
  };

  /**
   * Contrato stock_moves (ERP):
   * - CANÓNICO: columna `qty` (NOT NULL en producción). Toda lectura lógica debe pasar por normalizeStockMoveQtyFromDbRow.
   * - LEGACY en transición: `cantidad` / `quantity` — solo como respaldo si qty es 0 ausente o fila histórica sin qty.
   * - Escritura: pos-repository setStockMoveRowQty escribe `qty` y, si STOCK_MOVES_DUAL_WRITE_QTY_CANTIDAD, espeja `cantidad`
   *   hasta una migración BD que elimine `cantidad`.
   * - RPC apply_pos_sale_stock_lines: p_qty_column debe ser 'qty' (stockMovesQtyColumn()).
   */
  global.stockMovesQtyColumn = function stockMovesQtyColumn() {
    const c = String(global.STOCK_MOVES_QTY_COLUMN ?? 'qty').trim();
    return c || 'qty';
  };

  /**
   * Cantidad firmada en una fila stock_moves desde REST/SDK.
   * Prioridad: `qty` distinto de 0; si qty es 0 o vacío, legacy cantidad → quantity → amount (filas viejas mal migradas).
   */
  global.normalizeStockMoveQtyFromDbRow = function normalizeStockMoveQtyFromDbRow(r) {
    if (!r || typeof r !== 'object') return 0;
    const qRaw = r.qty;
    if (qRaw != null && qRaw !== '') {
      const qn = Number(qRaw);
      if (Number.isFinite(qn) && qn !== 0) return qn;
    }
    const legacy = ['cantidad', 'quantity', 'amount'];
    for (let i = 0; i < legacy.length; i++) {
      const k = legacy[i];
      const raw = r[k];
      if (raw == null || raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n !== 0) return n;
    }
    if (qRaw != null && qRaw !== '') {
      const qn = Number(qRaw);
      if (Number.isFinite(qn)) return qn;
    }
    for (let j = 0; j < legacy.length; j++) {
      const k = legacy[j];
      const raw = r[k];
      if (raw == null || raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  };

  /** Uds vendidas POS (valor absoluto de la cantidad firmada del movimiento). */
  global.unidadesVentaPosAbs = function unidadesVentaPosAbs(m) {
    const q =
      typeof global.normalizeStockMoveQtyFromDbRow === 'function'
        ? global.normalizeStockMoveQtyFromDbRow(m)
        : parseFloat(m && m.qty != null ? m.qty : m && m.cantidad != null ? m.cantidad : 0) || 0;
    return Math.abs(parseFloat(q) || 0);
  };

  /** Ítem de factura (JSON invoices.items): admite camelCase y snake_case. */
  global.articuloIdFromInvoiceItem = function articuloIdFromInvoiceItem(i) {
    if (!i || typeof i !== 'object') return '';
    const id =
      i.articuloId ||
      i.articulo_id ||
      i.productId ||
      i.product_id ||
      i.id ||
      '';
    return id != null && id !== '' ? String(id) : '';
  };

  /**
   * Pagos a proveedores / ref. deuda: solo entran artículos con mercancía a crédito y proveedor asignado.
   * Esta función no sustituye al proveedor ni incluye contado: solo normaliza el valor de `titulo_mercancia`
   * (acentos, mayúsculas, espacios) para que siga siendo obligatorio equivaler semánticamente a «crédito».
   */
  global.esMercanciaCredito = function esMercanciaCredito(tituloMercancia) {
    return String(tituloMercancia || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') === 'credito';
  };
})(window);
