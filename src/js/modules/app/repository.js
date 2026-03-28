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
   * Nombre de la columna de cantidad en `public.stock_moves` para inserts directos (backfill, anulación).
   * Por defecto `cantidad`. Valores típicos: `quantity`, o `qty` si la tabla tiene NOT NULL en `qty` y default 0 en `cantidad`.
   * El RPC `apply_pos_sale_stock_lines` en BD rellena `cantidad`+`qty` cuando existe la columna `qty`.
   */
  global.stockMovesQtyColumn = function stockMovesQtyColumn() {
    const c = String(global.STOCK_MOVES_QTY_COLUMN || 'cantidad').trim();
    return c || 'cantidad';
  };

  /**
   * Fila REST/SDK de stock_moves: si `cantidad` quedó en 0 (default) y el valor real está en `qty` o `quantity`, lo usa.
   * Orden: primero cualquier valor distinto de 0 entre qty, columna configurada y el par cantidad/quantity.
   */
  global.normalizeStockMoveQtyFromDbRow = function normalizeStockMoveQtyFromDbRow(r) {
    if (!r || typeof r !== 'object') return 0;
    const primary = global.stockMovesQtyColumn ? global.stockMovesQtyColumn() : 'cantidad';
    const altPair = primary === 'quantity' ? 'cantidad' : primary === 'cantidad' ? 'quantity' : null;
    const keys = ['qty', primary, altPair, 'cantidad', 'quantity'].filter(Boolean).filter((k, i, a) => a.indexOf(k) === i);
    let firstZero = NaN;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const raw = r[k];
      if (raw == null || raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      if (n !== 0) return n;
      if (!Number.isFinite(firstZero)) firstZero = n;
    }
    const fb = Number(r.amount);
    if (Number.isFinite(fb)) return fb;
    return Number.isFinite(firstZero) ? firstZero : 0;
  };

  /** Uds vendidas POS (venta_pos: salida negativa o positiva; admite fila BD con `qty` y `cantidad` en 0). */
  global.unidadesVentaPosAbs = function unidadesVentaPosAbs(m) {
    const q =
      typeof global.normalizeStockMoveQtyFromDbRow === 'function'
        ? global.normalizeStockMoveQtyFromDbRow(m)
        : parseFloat(m && m.cantidad != null ? m.cantidad : 0) || 0;
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
