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
   * Nombre de la columna de cantidad en `public.stock_moves`.
   * Por defecto `cantidad`. Si Supabase devuelve "column cantidad does not exist",
   * definí antes de cargar el ERP: `window.STOCK_MOVES_QTY_COLUMN = 'quantity'`
   */
  global.stockMovesQtyColumn = function stockMovesQtyColumn() {
    const c = String(global.STOCK_MOVES_QTY_COLUMN || 'cantidad').trim();
    return c || 'cantidad';
  };

  /**
   * Fila REST de stock_moves: evita `cantidad ?? quantity` cuando cantidad=0 y quantity=-5 (coalesce devolvía 0).
   * Respeta la columna configurada (cantidad vs quantity) y cae a la otra si hace falta.
   */
  global.normalizeStockMoveQtyFromDbRow = function normalizeStockMoveQtyFromDbRow(r) {
    if (!r || typeof r !== 'object') return 0;
    const primary = global.stockMovesQtyColumn ? global.stockMovesQtyColumn() : 'cantidad';
    const secondary = primary === 'quantity' ? 'cantidad' : 'quantity';
    const v1 = r[primary];
    const v2 = r[secondary];
    const n1 = v1 != null && v1 !== '' ? Number(v1) : NaN;
    const n2 = v2 != null && v2 !== '' ? Number(v2) : NaN;
    if (Number.isFinite(n1) && n1 !== 0) return n1;
    if (Number.isFinite(n2) && n2 !== 0) return n2;
    if (Number.isFinite(n1)) return n1;
    if (Number.isFinite(n2)) return n2;
    const fb = Number(r.qty ?? r.amount);
    return Number.isFinite(fb) ? fb : 0;
  };

  /** Uds vendidas POS a partir de movimiento ya normalizado (venta_pos: salida = negativo o positivo). */
  global.unidadesVentaPosAbs = function unidadesVentaPosAbs(m) {
    const q = parseFloat(m && m.cantidad != null ? m.cantidad : 0) || 0;
    return Math.abs(q);
  };
})(window);
