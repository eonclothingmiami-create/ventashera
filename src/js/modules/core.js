// Recovered from index (1).html as UTF-8 on 2026-03-17T20:36:31

// ===================================================================
// ===== CREDENCIALES & CONEXIÓN =====
// ===================================================================

const SUPABASE_URL = window.AppRepository?.SUPABASE_URL || 'https://niilaxdeetuzutycvdkz.supabase.co';
const SUPABASE_ANON_KEY = window.AppRepository?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paWxheGRlZXR1enV0eWN2ZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjc0NjIsImV4cCI6MjA4ODk0MzQ2Mn0.GI8E7vRzxi5NumN_f4T432Lx4BcmgGLZo81BR9h3h8c';

// Inicializar Supabase
// Init Supabase client safely
var supabaseClient = window.AppRepository?.supabaseClient;
(function() {
  if (supabaseClient) return;
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    if (window.AppRepository) window.AppRepository.supabaseClient = supabaseClient;
  } catch(e) {
    console.error('Supabase init error:', e);
  }
})();

// Variables de control
let isFirstLoad = true;
let _sbConnected = false;
// ===================================================================
// ===== SUPABASE REST API (FUNCIONES BASE) =====
// ===================================================================

async function supabaseCall(method, table, data = null, id = null, filters = null) {
  if (window.AppRepository?.supabaseCall) {
    return window.AppRepository.supabaseCall(method, table, data, id, filters);
  }
  try {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    let bearer = SUPABASE_ANON_KEY;
    try {
      if (supabaseClient?.auth?.getSession) {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.access_token) bearer = session.access_token;
      }
    } catch (_) { /* noop */ }
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

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

// ===================================================================
// ===== SINCRONIZADORES CATÁLOGO WEB (SUPABASE) =====
// ===================================================================

async function syncProductToSupabase(articulo) {
  try {
    // 1. Mapear la data de ERP a lo que necesita el Catálogo Supabase
    const productData = {
      ref: articulo.codigo || articulo.ref || '',
      name: articulo.nombre || articulo.name || '',
      price: parseFloat(articulo.precioVenta || articulo.price || 0),
      description: articulo.descripcion || '',
      sizes: articulo.tallas || articulo.sizes || '',
      colors: JSON.stringify(Array.isArray(articulo.colors) ? articulo.colors : (articulo.colores ? articulo.colores.split(',') : [])),
      images: JSON.stringify(Array.isArray(articulo.images) ? articulo.images : (articulo.imagen ? [articulo.imagen] : [])),
      seccion: articulo.seccion || '',
      cat: articulo.cat || articulo.categoria || '',
      visible: normalizeVisibleFlag(articulo.mostrarEnWeb),
      stock: Math.max(0, getArticuloStock(articulo.id) || 0),
      sku: articulo.codigo || '',
      lastUpdate: new Date().toISOString()
    };

    // 2. Revisar duplicidad por referencia
    const existing = await supabaseCall('GET', 'products', null, null, { ref: articulo.codigo });

    if (existing && existing.length > 0) {
      // PATCH — NO incluir createdAt para no sobreescribir fecha original
      await supabaseCall('PATCH', 'products', productData, existing[0].id);
      return { success: true, action: 'update', id: existing[0].id };
    } else {
      // POST — Solo en creación se asigna createdAt
      productData.createdAt = new Date().toISOString();
      const result = await supabaseCall('POST', 'products', productData);
      return { success: true, action: 'create', id: result[0]?.id };
    }
  } catch (err) {
    console.error('❌ Error sincronizando a Supabase:', err);
    return { success: false, error: err.message };
  }
}

async function deleteProductFromSupabase(codigo) {
  try {
    if (!codigo) return;
    const existing = await supabaseCall('GET', 'products', null, null, { ref: codigo });
    if (existing && existing.length > 0) {
      const productId = existing[0].id;
      if (!supabaseClient || typeof supabaseClient.rpc !== 'function') {
        throw new Error('Supabase client no disponible para RPC delete_product_full');
      }
      const { error } = await supabaseClient.rpc('delete_product_full', { p_product_id: productId });
      if (error) throw error;
      return { success: true };
    }
    return { success: true };
  } catch (err) {
    console.error('❌ Error eliminando de Supabase:', err);
    return { success: false, error: err.message };
  }
}

async function importProductsFromSupabase() {
  try {
    const products = await supabaseCall('GET', 'products');
    if (!Array.isArray(products)) return [];
    
    const refsExistentes = new Set((state.articulos || []).map(a => (a.ref || '').toUpperCase()));
    const imported = [];

    const SECCION_MAP = {
      'Trajes de Baño': 'Trajes de baño',
      'Resort & Pijamas': 'Pijamas',
      'Pijamas': 'Pijamas',
      'Ropa Deportiva': 'Deportiva',
      'Activewear': 'Deportiva',
      'Casual': 'Varias'
    };

    for (const p of products) {
      const refKey = (p.ref || '').toUpperCase();
      if (refKey && refsExistentes.has(refKey)) continue;

      const articulo = {
        id: 'IMP_' + uid(),
        codigo: p.ref || p.sku || '',
        ref: p.ref || p.sku || '',
        nombre: p.name || '',
        name: p.name || '',
        categoria: SECCION_MAP[p.seccion] || 'Varias',
        subcategoria: p.cat || '',
        seccion: p.seccion || '',
        cat: p.cat || '',
        precioVenta: parseFloat(p.price) || 0,
        price: parseFloat(p.price) || 0,
        precioCompra: 0,
        descripcion: p.description || '',
        tallas: p.sizes || '',
        sizes: p.sizes || '',
        colores: typeof p.colors === 'string' ? JSON.parse(p.colors || '[]').join(', ') : '',
        colors: typeof p.colors === 'string' ? JSON.parse(p.colors || '[]') : (p.colors || []),
        images: typeof p.images === 'string' ? JSON.parse(p.images || '[]') : (p.images || []),
        imagen: typeof p.images === 'string' ? (JSON.parse(p.images || '[]')[0] || '') : (p.images?.[0] || ''),
        stock: 0,
        stockMinimo: 0,
        activo: true,
        mostrarEnWeb: catalogVisibleFromProductRow(p),
        importadoDeCatalogo: true,
        supabaseId: p.id,
        createdAt: today()
      };

      state.articulos = state.articulos || [];
      state.articulos.push(articulo);
      imported.push(articulo);
      
      if (refKey) refsExistentes.add(refKey);
    }

    return imported;
  } catch (err) {
    console.error('❌ Error importando de Supabase:', err);
    return [];
  }
}

// ===================================================================
// ===== STATE GENERAL (ERP) =====
// ===================================================================

let state = {
  meta: 34000000, 
  diasLocal: 1, 
  diasInter: 5,
  empleados: [],
  usu_empleados: [],      
  nomina_pagos: [],   
  ventas: [], 
  ventasCatalogo: [],
  currentMonth: null,
  game: { xp:0, streakMax:0, earnedBadges:[], claimedSnacks:{} },
  rewards: {}, 
  notifEnabled: false, 
  notifHour: 21,
  articulos: [],        
  bodegas: [{id:'bodega_main',name:'Bodega Principal',ubicacion:'Local'},{id:'bodega_vitrina',name:'Vitrina',ubicacion:'Vitrina'}],
  inv_movimientos: [],   
  inv_ajustes: [],
  inv_ajustes_lotes: [],
  inv_traslados: [],      
  cotizaciones: [],
  ordenes_venta: [],
  facturas: [],
  notas_credito: [],
  notas_debito: [],
  remisiones: [],
  devoluciones: [],
  anticipos_clientes: [],
  nom_ausencias: [],
  nom_anticipos: [],
  nom_conceptos: [
    {id:'c1',nombre:'Salario Básico',tipo:'devengo',formula:'fijo',valor:0},
    {id:'c2',nombre:'Auxilio Transporte',tipo:'devengo',formula:'fijo',valor:210000},
    {id:'c3',nombre:'Salud (4%)',tipo:'deduccion',formula:'porcentaje',valor:4},
    {id:'c4',nombre:'Pensión (4%)',tipo:'deduccion',formula:'porcentaje',valor:4}
  ],
  nom_nominas: [],
  cajas: [{id:(window.AppId&&window.AppId.CAJA_PRINCIPAL_ID)||'f7c2b8e0-4a1d-4f3e-9c8a-2b6e1d4a7f00',nombre:'Caja Principal',saldo:0,estado:'abierta',apertura:null,bodegaIds:[],saldosMetodo:{efectivo:0,transferencia:0,addi:0,contraentrega:0,tarjeta:0,digital:0,otro:0}}],
  tes_movimientos: [],
  tes_cierres_caja: [],
  tes_impuestos: [],
  tes_retenciones: [],
  tes_comp_retencion: [],
  tes_comp_ingreso: [],
  tes_comp_egreso: [],
  tes_transferencias: [],
  empresa: {nombre:'Hera Swimwear',nit:'',direccion:'',telefono:'',ciudad:''},
  consecutivos: {factura:1,cotizacion:1,orden:1,nc:1,nd:1,remision:1,devolucion:1,ingreso:1,egreso:1,retencion:1},
  pos_cart: [],
  tes_abonos_prov: [],
  tes_compromisos_prov: [],
  tes_cxp_movimientos: [],
  tes_libro_proveedor: [],
  tes_devoluciones_prov: [],
  tes_ajustes_unidades_prov: [],
  stock_moves_ventas: [],
  // ===== CONFIGURACIONES =====
  cfg_categorias: [
    {id:'cat1',seccion:'Trajes de Baño',nombre:'Enterizos'},
    {id:'cat2',seccion:'Trajes de Baño',nombre:'Bikinis'},
    {id:'cat3',seccion:'Trajes de Baño',nombre:'Tankinis'},
    {id:'cat4',seccion:'Trajes de Baño',nombre:'Asoleadores'},
    {id:'cat5',seccion:'Trajes de Baño',nombre:'Salidas de Baño'},
    {id:'cat6',seccion:'Trajes de Baño',nombre:'3 Piezas'},
    {id:'cat7',seccion:'Resort & Pijamas',nombre:'Batas'},
    {id:'cat8',seccion:'Resort & Pijamas',nombre:'Sets 2 Piezas'},
    {id:'cat9',seccion:'Activewear',nombre:'Leggings'},
    {id:'cat10',seccion:'Activewear',nombre:'Conjuntos'},
    {id:'cat11',seccion:'Casual',nombre:'Vestidos'}
  ],
  cfg_secciones: [
    {id:'sec1',nombre:'Trajes de Baño'},
    {id:'sec2',nombre:'Resort & Pijamas'},
    {id:'sec3',nombre:'Activewear'},
    {id:'sec4',nombre:'Casual'}
  ],
  cfg_transportadoras: [
    {id:'t1',nombre:'TCC',activa:true},
    {id:'t2',nombre:'Coordinadora',activa:true},
    {id:'t3',nombre:'Envía',activa:true},
    {id:'t4',nombre:'Interrapidísimo',activa:true},
    {id:'t5',nombre:'Servientrega',activa:true}
  ],
  cfg_metodos_pago: [
    {id:'mp1',nombre:'Nequi',tipo:'digital',activo:true},
    {id:'mp2',nombre:'Bancolombia',tipo:'banco',activo:true},
    {id:'mp3',nombre:'Daviplata',tipo:'digital',activo:true},
    {id:'mp4',nombre:'Bancolombia 2',tipo:'banco',activo:true},
    {id:'mp5',nombre:'Efectivo',tipo:'efectivo',activo:true},
    {id:'mp6',nombre:'Tarjeta',tipo:'tarjeta',activo:true}
  ],
  cfg_tarifas: [
    {id:'tar1',nombre:'Precio Mayorista',porcentaje:0,descripcion:'Precio base'},
    {id:'tar2',nombre:'Precio Público',porcentaje:15,descripcion:'Mayorista + 15k'},
    {id:'tar3',nombre:'Precio Especial',porcentaje:-10,descripcion:'10% descuento'}
  ],
  cfg_impuestos: [
    {id:'imp1',nombre:'IVA',porcentaje:19,tipo:'venta',activo:true},
    {id:'imp2',nombre:'ReteFuente',porcentaje:3.5,tipo:'retencion',activo:false},
    {id:'imp3',nombre:'ReteICA',porcentaje:0.966,tipo:'retencion',activo:false}
  ],
  cfg_game: {
    meta_mensual: 34000000,
    xp_por_venta_vitrina: 150000,
    xp_por_venta_local: 25000,
    xp_por_venta_inter: 20000,
    xp_liquidar: 20,
    dias_local: 1,
    dias_inter: 5
  }
};
if (window.AppState?.createInitialState) {
  state = window.AppState.createInitialState();
}
try {
  window.__HERA_STATE__ = state;
} catch (e) {}

let posFormState = { 
  canal: 'vitrina', empresa: '', transportadora: '', guia: '', ciudad: '', direccion: '',
  comprobante: '', cedula: '', cliente: '', telefono: '', metodo: 'efectivo', cuenta: '', applyIva: false, /* false=default vitrina sin IVA; renderPOS marca el checkbox según canal */ applyFlete: false, flete: 0,
  tipoPago: 'contado',
  mixtoEfectivo: 0,
  mixtoTransferencia: 0,
  bodegaId: 'bodega_main',
  cajaId: ''
};
const CUENTAS_BANCARIAS = ['Nequi','Bancolombia','Daviplata','Bancolombia 2'];
try { window.CUENTAS_BANCARIAS = CUENTAS_BANCARIAS; } catch (e) {}
let histFilters = { canal: '', cat: '', start: '', end: '' };
let _tempGaleria = []; let _portadaIndex = 0;
  let _tempLogoBase64 = null; // Almacena el logo procesado para 80mm

// ===== CONSTANTS =====
const LEVELS=[{level:1,name:'Novata',avatar:'🌱',minXp:0},{level:2,name:'Activa',avatar:'✨',minXp:200},{level:3,name:'Vendedora',avatar:'💫',minXp:500},{level:4,name:'Destacada',avatar:'🌟',minXp:1000},{level:5,name:'Pro',avatar:'⚡',minXp:1800},{level:6,name:'Experta',avatar:'🔥',minXp:3000},{level:7,name:'Campeona',avatar:'💎',minXp:4500},{level:8,name:'Leyenda',avatar:'👑',minXp:6500},{level:9,name:'Élite',avatar:'🏆',minXp:9000},{level:10,name:'Mega Vendedora',avatar:'🚀',minXp:12000}];
const BADGES=[{id:'primera_venta',icon:'🎯',name:'Primera Venta',desc:'Registra tu primera venta'},{id:'racha3',icon:'🔥',name:'Racha x3',desc:'3 días seguidos con ≥5 despachos/día (local+inter, sin vitrina)'},{id:'racha7',icon:'🌊',name:'Racha x7',desc:'7 días seguidos con ≥5 despachos/día (sin vitrina)'},{id:'racha14',icon:'⚡',name:'Racha x14',desc:'14 días seguidos con ≥5 despachos/día (sin vitrina)'},{id:'meta25',icon:'📈',name:'25% Meta',desc:'25% de la meta mensual (suma vitrina+local+inter, ventas activas)'},{id:'meta50',icon:'🎯',name:'Mitad Meta',desc:'50% de la meta mensual (todos los canales)'},{id:'meta75',icon:'🔝',name:'75% Meta',desc:'75% de la meta mensual (todos los canales)'},{id:'meta100',icon:'🏆',name:'¡Meta!',desc:'Meta mensual completa (todos los canales)'},{id:'super',icon:'💥',name:'Súper Meta',desc:'Superas $40M en el mes (suma vitrina+local+inter)'},{id:'v20',icon:'📦',name:'20 Despachos',desc:'20 ventas tipo despacho acumuladas (sin vitrina)'},{id:'v50',icon:'🛵',name:'50 Despachos',desc:'50 despachos acumulados (sin vitrina)'},{id:'v100',icon:'💯',name:'100 Despachos',desc:'100 despachos acumulados (sin vitrina)'},{id:'v150',icon:'🚀',name:'150 Despachos',desc:'150 despachos acumulados (sin vitrina)'},{id:'gran_venta',icon:'💵',name:'Gran Venta',desc:'Una venta mayor a $500k'},{id:'multicanal',icon:'🌐',name:'Multicanal',desc:'Ventas en los 3 canales el mismo día'},{id:'nivel5',icon:'⭐',name:'Nivel 5',desc:'Alcanza el nivel Pro'},{id:'nivel8',icon:'🌟',name:'Nivel 8',desc:'Alcanza el nivel Leyenda'}];
const MISSIONS_LADDER=[5,10,20,30,40,50,65,80,100,120,150];
const SNACKS=[{id:'bonyourt',name:'Bonyourt',emoji:'🥤'},{id:'bimbo',name:'Bimbo',emoji:'🍞'},{id:'turron',name:'Turrón',emoji:'🍬'},{id:'refrigerio',name:'Refrigerio',emoji:'🧃'},{id:'paleta',name:'Paleta',emoji:'🍫'},{id:'chocono',name:'Chocono',emoji:'🍦'},{id:'galleta',name:'Galletas',emoji:'🍪'},{id:'churro',name:'Churro',emoji:'🥐'},{id:'panpizza',name:'Pan Pizza',emoji:'🍕'},{id:'empanada',name:'Empanada',emoji:'🥙'},{id:'bunuelo',name:'Buñuelo',emoji:'🫓'},{id:'pollo',name:'Pollo',emoji:'🍗'},{id:'chocoramo',name:'Chocoramo',emoji:'🍫'},{id:'doritos',name:'Doritos',emoji:'🌮'}];
const SNACK_XP_GOAL=100;
const REWARDS=[{id:'meta_mes',icon:'🍽️',name:'Almuerzo con el Jefe',desc:'Alcanza los $34M de meta mensual',condition:s=>ventasMes(s).active.length>0&&ventasMes(s).totalCOP>=s.meta},{id:'dia_millon',icon:'💵',name:'Bonificación $100k',desc:'Un día con $1M+ sumando todos los canales (vitrina+local+inter)',condition:s=>hasDiaUnMillon(s)},{id:'super_meta',icon:'👑',name:'Segundo Almuerzo',desc:'Supera los $40M en el mes',condition:s=>ventasMes(s).totalCOP>=40000000}];

// ===== HELPERS =====
function uid(){return window.AppId?.legacyUid ? window.AppId.legacyUid() : (Date.now().toString(36)+Math.random().toString(36).slice(2,8))}
/** Use for new rows persisted to Supabase (uuid columns). Keeps legacy `uid()` for non-DB keys e.g. IMP_ imports. */
function dbId(){return window.AppId?.uuid ? window.AppId.uuid() : ((typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():uid())}
function fmt(n){return '$'+Math.round(n).toLocaleString('es-CO')}
function fmtN(n){return Math.round(n).toLocaleString('es-CO')}
function today() { 
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function formatDate(d){if(!d)return '—';const[y,m,day]=d.split('-');return `${day}/${m}/${y}`}
function normalizeVisibleFlag(v){
  if(v === true || v === 1 || v === '1') return true;
  if(v === false || v === 0 || v === '0') return false;
  if(v === null || v === undefined) return false;
  if(typeof v === 'string'){
    const t = v.trim().toLowerCase();
    if(t === 'true' || t === 'si' || t === 'sí' || t === 'yes' || t === 'on') return true;
    if(t === 'false' || t === 'no' || t === 'off' || t === '') return false;
  }
  return Boolean(v);
}
/** Lee visibilidad catálogo web desde fila products (soporta alias de columna en BD). */
function catalogVisibleFromProductRow(p){
  if(!p||typeof p!=='object') return false;
  const raw = p.visible ?? p.is_visible ?? p.show_in_catalog ?? p.mostrar_web;
  return normalizeVisibleFlag(raw);
}
/** URL de la Edge Function ML (misma lógica que al guardar un artículo). */
function getMercadoLibreSyncEndpoint() {
  const custom = (window.MERCADOLIBRE_SYNC_ENDPOINT || '').trim();
  if (custom) return custom;
  const base = window.AppRepository?.SUPABASE_URL;
  if (base) return String(base).replace(/\/$/, '') + '/functions/v1/mercadolibre-sync-product';
  return '';
}
/** URL Edge Function meta-commerce-sync (Facebook / Instagram catálogo). */
function getMetaCommerceSyncEndpoint() {
  const custom = (window.META_COMMERCE_SYNC_ENDPOINT || '').trim();
  if (custom) return custom;
  const base = window.AppRepository?.SUPABASE_URL;
  if (base) return String(base).replace(/\/$/, '') + '/functions/v1/meta-commerce-sync';
  return '';
}
/** URL Edge Function hera-dropi-sync (Dropi dropshipping). */
function getDropiSyncEndpoint() {
  const custom = (window.DROPI_SYNC_ENDPOINT || '').trim();
  if (custom) return custom;
  const base = window.AppRepository?.SUPABASE_URL;
  if (base) return String(base).replace(/\/$/, '') + '/functions/v1/hera-dropi-sync';
  return '';
}
/** URL Edge Function google-merchant-sync (Google Shopping / Merchant Center). */
function getGoogleMerchantSyncEndpoint() {
  const custom = (window.GOOGLE_MERCHANT_SYNC_ENDPOINT || '').trim();
  if (custom) return custom;
  const base = window.AppRepository?.SUPABASE_URL;
  if (base) {
    return String(base).replace(/\/$/, '') + '/functions/v1/google-merchant-sync';
  }
  return '';
}
/** URL Edge Function pinterest-catalog-sync (Pinterest catálogo / Shopping). */
function getPinterestCatalogSyncEndpoint() {
  const custom = (window.PINTEREST_CATALOG_SYNC_ENDPOINT || '').trim();
  if (custom) return custom;
  const base = window.AppRepository?.SUPABASE_URL;
  if (base) {
    return String(base).replace(/\/$/, '') + '/functions/v1/pinterest-catalog-sync';
  }
  return '';
}

/** URL Edge Function hera-rappi-sync (Rappi Public API vía servidor; OAuth en secrets). */
function getRappiSyncEndpoint() {
  const custom = (window.RAPPI_SYNC_ENDPOINT || '').trim();
  if (custom) return custom;
  const base = window.AppRepository?.SUPABASE_URL;
  if (base) return String(base).replace(/\/$/, '') + '/functions/v1/hera-rappi-sync';
  return '';
}

/** URL Edge Function falabella-sync-product (Seller Center API; firma HMAC en servidor). */
function getFalabellaSyncEndpoint() {
  const custom = (window.FALABELLA_SYNC_ENDPOINT || '').trim();
  if (custom) return custom;
  const base = window.AppRepository?.SUPABASE_URL;
  if (base) return String(base).replace(/\/$/, '') + '/functions/v1/falabella-sync-product';
  return '';
}

/** IDs externos opcionales en `products` (o dentro de integrations_json) para no volver a publicar por error. */
function integrationIdsFromProductRow(p) {
  const j =
    p &&
    p.integrations_json &&
    typeof p.integrations_json === 'object' &&
    !Array.isArray(p.integrations_json)
      ? p.integrations_json
      : {};
  const str = (v) => (v != null && String(v).trim() ? String(v).trim() : '');
  return {
    mercadolibreItemId: str(p.mercadolibre_item_id || p.ml_item_id || j.mercadolibre_item_id || j.ml_item_id),
    metaCommerceRetailerId: str(p.meta_commerce_retailer_id || p.meta_retailer_id || j.meta_commerce_retailer_id || j.meta_retailer_id),
    googleMerchantOfferId: str(p.google_merchant_offer_id || p.google_offer_id || j.google_merchant_offer_id || j.google_offer_id),
    pinterestCatalogItemId: str(p.pinterest_catalog_item_id || p.pinterest_item_id || j.pinterest_catalog_item_id || j.pinterest_item_id),
  };
}

function isListedMercadoLibre(art) {
  return !!(art && art.mercadolibreItemId);
}
function isListedMetaCommerce(art) {
  return !!(art && art.metaCommerceRetailerId);
}
function isListedGoogleMerchant(art) {
  return !!(art && art.googleMerchantOfferId);
}
function isListedPinterestCatalog(art) {
  return !!(art && art.pinterestCatalogItemId);
}
function isListedFalabella(art) {
  if (!art) return false;
  const st = String(art.falabellaSyncStatus || '').toLowerCase();
  if (st === 'error' || st === 'error_validacion' || st === 'feed_timeout') return false;
  if (st === 'synced' || st === 'pending') return true;
  return !!(art.falabellaSellerSku && String(art.falabellaSellerSku).trim());
}

/** Resumen Falabella en el modal de artículo (estado sync + FeedStatus API + último error). */
function updateFalabellaStatusLineInModal(art) {
  const el = document.getElementById('art-falabella-status-line');
  if (!el) return;
  if (!art || !art.id) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  const st = String(art.falabellaSyncStatus || '').toLowerCase();
  const feed = String(art.falabellaFeedStatus || '').trim();
  const err = String(art.falabellaLastError || '').trim();
  if (!st && !feed && !err) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  const parts = [];
  if (st) parts.push(`Estado: ${st}`);
  if (feed) parts.push(`Feed API: ${feed}`);
  if (err) parts.push(`Último error: ${err}`);
  el.textContent = parts.join(' · ');
  el.style.display = 'block';
  el.style.color =
    st === 'error' || st === 'error_validacion' || st === 'feed_timeout'
      ? 'var(--danger, #f87171)'
      : st === 'pending'
        ? 'var(--accent)'
        : 'var(--text2)';
}

/**
 * Al abrir el maquetador: desmarca canales donde el producto ya tiene ID externo y muestra aviso breve.
 */
function applyIntegrationChannelListedState(art) {
  const rows = [
    {
      chk: 'art-sync-mercadolibre',
      hint: 'art-sync-mercadolibre-hint',
      listed: isListedMercadoLibre(art),
      label: 'Ya publicado en Mercado Libre — desmarcado para evitar duplicados. Marca solo si quieres volver a enviar.',
    },
    {
      chk: 'art-sync-meta-commerce',
      hint: 'art-sync-meta-commerce-hint',
      listed: isListedMetaCommerce(art),
      label: 'Ya sincronizado en Meta — desmarcado para evitar duplicados.',
    },
    {
      chk: 'art-sync-google-merchant',
      hint: 'art-sync-google-merchant-hint',
      listed: isListedGoogleMerchant(art),
      label: 'Ya en Google Merchant — desmarcado para evitar duplicados.',
    },
    {
      chk: 'art-sync-pinterest-catalog',
      hint: 'art-sync-pinterest-catalog-hint',
      listed: isListedPinterestCatalog(art),
      label: 'Ya en Pinterest — desmarcado para evitar duplicados.',
    },
    {
      chk: 'art-sync-falabella',
      hint: 'art-sync-falabella-hint',
      listed: isListedFalabella(art),
      label: 'Ya enviado a Falabella — desmarcado para evitar duplicados.',
    },
  ];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const el = document.getElementById(r.chk);
    const hi = document.getElementById(r.hint);
    if (!el) continue;
    if (r.listed) {
      el.checked = false;
      if (hi) {
        hi.textContent = r.label;
        hi.style.display = 'block';
      }
    } else {
      if (hi) {
        hi.textContent = '';
        hi.style.display = 'none';
      }
      el.checked = r.chk === 'art-sync-mercadolibre';
    }
  }
}

function onMaquetadorChannelProfileChange() {
  const wrap = document.getElementById('falabella-requisitos-wrap');
  const sel = document.getElementById('m-art-channel-profile');
  if (!wrap || !sel) return;
  if (sel.value !== 'falabella') {
    window._falabellaBrandFallbackDeclined = false;
    window._falabellaBrandFallbackActive = false;
    const fb = document.getElementById('m-fal-badge-brand-fallback');
    if (fb) fb.style.display = 'none';
  }
  wrap.style.display = sel.value === 'falabella' ? 'block' : 'none';
  const draftBtn = document.getElementById('m-art-btn-save-draft');
  if (draftBtn) draftBtn.style.display = sel.value === 'falabella' ? 'block' : 'none';
  if (sel.value === 'falabella' && window.FalabellaMaquetador) {
    window.FalabellaMaquetador.hydrateDraftFieldsFromGenericForm();
  }
  refreshFalabellaMaquetadorValidation();
  if (sel.value === 'falabella') scheduleFalabellaModaOptionsFromCategory();
}

function refreshFalabellaMaquetadorValidation() {
  const profile = document.getElementById('m-art-channel-profile')?.value || 'generic';
  const errEl = document.getElementById('m-fal-inline-errors');
  const btn = document.getElementById('m-art-btn-save');
  const falChk = document.getElementById('art-sync-falabella');
  const badge = document.getElementById('m-fal-badge-state');
  const badgeBlock = document.getElementById('m-fal-badge-blocked');
  if (profile !== 'falabella') {
    if (errEl) errEl.innerHTML = '';
    if (btn) btn.disabled = false;
    if (falChk) falChk.disabled = false;
    if (badgeBlock) badgeBlock.style.display = 'none';
    return;
  }
  if (!window.FalabellaMaquetador) return;
  const draft = window.FalabellaMaquetador.collectDraftFromDom();
  const v = window.FalabellaMaquetador.validateDraft(draft, { buFac: true });
  let errs = (v.errors || []).slice();
  const idx = window._falabellaCategoryIndexed;
  if (idx && idx.byFeedName) {
    const o1 = window.FalabellaMaquetador.validateOptionFields(draft, idx);
    if (!o1.ok) errs = errs.concat(o1.errors || []);
    const o2 = window.FalabellaMaquetador.validateVariationAgainstCategoryOptions(draft, idx);
    if (!o2.ok) errs = errs.concat(o2.errors || []);
  }
  if (errEl) {
    errEl.innerHTML = errs.length
      ? errs.map((e) => `<div><strong>${e.field}</strong>: ${e.message}</div>`).join('')
      : '';
  }
  const localOk = errs.length === 0;
  if (btn) btn.disabled = false;
  if (falChk) {
    falChk.disabled = !localOk;
    falChk.title = !localOk
      ? 'Completa requisitos Falabella; usa Preflight o Guardar borrador.'
      : '';
  }
  if (badge) {
    badge.textContent = localOk ? 'Listo para sync' : 'Borrador incompleto';
    badge.style.background = localOk ? 'rgba(0,229,180,0.22)' : 'rgba(255,180,80,0.22)';
  }
  if (badgeBlock) {
    const blocked = falChk && falChk.checked && !localOk;
    badgeBlock.style.display = blocked ? 'inline' : 'none';
  }
  setFalabellaBrandFallbackBadge(window._falabellaBrandFallbackActive);
  const draftB = window.FalabellaMaquetador.collectDraftFromDom();
  if (window._falabellaBrandFallbackActive && !window.FalabellaMaquetador.isGenericBrand(draftB.brand)) {
    window._falabellaBrandFallbackActive = false;
    setFalabellaBrandFallbackBadge(false);
  }
}

function wireFalabellaMaquetadorInputs() {
  const ids = [
    'm-fal-brand',
    'm-fal-name',
    'm-fal-desc',
    'm-fal-primary-cat',
    'm-fal-seller-sku',
    'm-fal-color',
    'm-fal-color-basico',
    'm-fal-talla',
    'm-fal-condition',
    'm-fal-tax',
    'm-fal-pkg-h',
    'm-fal-pkg-w',
    'm-fal-pkg-l',
    'm-fal-pkg-wt',
    'm-fal-tipo-traje',
    'm-fal-material',
    'm-fal-genero',
    'art-sync-falabella',
    'm-art-channel-profile',
  ];
  const run = () => refreshFalabellaMaquetadorValidation();
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const wrapped =
      id === 'm-fal-primary-cat'
        ? () => {
            run();
            scheduleFalabellaModaOptionsFromCategory();
          }
        : run;
    el.addEventListener('input', wrapped);
    el.addEventListener('change', wrapped);
  });
  const brandEl = document.getElementById('m-fal-brand');
  if (brandEl) {
    brandEl.addEventListener('input', () => {
      window._falabellaBrandFallbackDeclined = false;
    });
  }
}

function applyFalabellaDraftToMaquetadorFields(art) {
  const d = art?.falabellaProductDataJson?.falabellaDraft;
  if (!d || typeof d !== 'object') return;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val != null && val !== undefined ? String(val) : '';
  };
  set('m-fal-brand', d.brand);
  set('m-fal-name', d.name);
  set('m-fal-desc', d.description);
  set('m-fal-primary-cat', d.primaryCategoryId);
  set('m-fal-seller-sku', d.sellerSku);
  set('m-fal-color', d.color);
  set('m-fal-color-basico', d.colorBasico);
  set('m-fal-talla', d.talla);
  set('m-fal-condition', d.conditionType);
  set('m-fal-tax', d.taxPercentage);
  set('m-fal-pkg-h', d.packageHeight);
  set('m-fal-pkg-w', d.packageWidth);
  set('m-fal-pkg-l', d.packageLength);
  set('m-fal-pkg-wt', d.packageWeight);
  set('m-fal-tipo-traje', d.tipoTrajeDeBano);
  set('m-fal-material', d.materialDeVestuario);
  set('m-fal-genero', d.generoDeVestuario);
}

function falabellaPreflightPayloadFromModal() {
  const pid = window._editingArticuloId;
  if (!window.FalabellaMaquetador) return { productId: pid || undefined };
  const d = window.FalabellaMaquetador.collectDraftFromDom();
  return {
    productId: pid || undefined,
    brand: d.brand,
    name: d.name,
    description: d.description,
    primaryCategoryId: d.primaryCategoryId,
    sellerSku: d.sellerSku,
    color: d.color,
    colorBasico: d.colorBasico,
    talla: d.talla,
    conditionType: d.conditionType,
    packageHeight: d.packageHeight,
    packageWidth: d.packageWidth,
    packageLength: d.packageLength,
    packageWeight: d.packageWeight,
    taxPercentage: d.taxPercentage,
    tipoTrajeDeBano: d.tipoTrajeDeBano,
    materialDeVestuario: d.materialDeVestuario,
    generoDeVestuario: d.generoDeVestuario,
  };
}

/** true = pedir confirmación antes de aplicar GENERICO (opción B). false = autocompletar tras alerta (opción A, recomendada). */
if (typeof window.FALABELLA_EMPTY_BRANDS_CONFIRM === 'undefined') {
  window.FALABELLA_EMPTY_BRANDS_CONFIRM = false;
}

function setFalabellaBrandFallbackBadge(active) {
  window._falabellaBrandFallbackActive = !!active;
  const fb = document.getElementById('m-fal-badge-brand-fallback');
  if (!fb || !window.FalabellaMaquetador) return;
  const draft = window.FalabellaMaquetador.collectDraftFromDom();
  const show = !!active && window.FalabellaMaquetador.isGenericBrand(draft.brand);
  fb.style.display = show ? 'inline' : 'none';
}

/**
 * Catálogo GetBrands vacío: alerta + GENERICO (y opcional confirm).
 * @returns {boolean} false si el usuario canceló (opción B).
 */
function offerFalabellaBrandEmptyCatalogFallback() {
  window.alert(
    'Tu cuenta no tiene marcas aprobadas en Falabella.\n\nGetBrands devolvió lista vacía. No deje Brand vacío: se aplicará GENERICO para poder sincronizar, o solicite aprobación de marca en Seller Support.',
  );
  const needConfirm = window.FALABELLA_EMPTY_BRANDS_CONFIRM === true;
  if (needConfirm) {
    const ok = window.confirm('¿Usar marca GENERICO para poder sincronizar con Falabella?');
    if (!ok) {
      window._falabellaBrandFallbackDeclined = true;
      setFalabellaBrandFallbackBadge(false);
      return false;
    }
  }
  window._falabellaBrandFallbackDeclined = false;
  const inp = document.getElementById('m-fal-brand');
  if (inp) inp.value = 'GENERICO';
  setFalabellaBrandFallbackBadge(true);
  refreshFalabellaMaquetadorValidation();
  return true;
}

/**
 * Antes de sync: preflight; si GetBrands vacío y marca no genérica, ofrece fallback GENERICO.
 * @returns {Promise<{ ok: boolean, declined?: boolean }>}
 */
async function ensureFalabellaBrandBeforeSync(productId) {
  try {
    if (!window.requestFalabellaPreflight || !window.FalabellaMaquetador) return { ok: true };
    const pay = {
      ...falabellaPreflightPayloadFromModal(),
      productId: productId || window._editingArticuloId || undefined,
    };
    const res = await window.requestFalabellaPreflight(pay);
    if (res.skipped || res.dryRun) return { ok: true };
    const pf = res.preflight;
    if (pf) window._falabellaPreflightLast = pf;
    if (!pf || !pf.get_brands_catalog_empty) return { ok: true };
    const draft = window.FalabellaMaquetador.collectDraftFromDom();
    if (window.FalabellaMaquetador.isGenericBrand(draft.brand)) {
      setFalabellaBrandFallbackBadge(true);
      return { ok: true };
    }
    const applied = offerFalabellaBrandEmptyCatalogFallback();
    if (!applied) return { ok: false, declined: true };
    setFalabellaBrandFallbackBadge(true);
    return { ok: true };
  } catch (e) {
    console.warn('[Falabella] brand gate (preflight)', e);
    return { ok: true };
  }
}

async function runFalabellaPreflightInModal() {
  const el = document.getElementById('m-fal-preflight-checklist');
  if (!window.requestFalabellaPreflight) {
    if (el) el.innerHTML = '<span style="color:var(--text2)">Endpoint preflight no configurado.</span>';
    return;
  }
  if (el) el.innerHTML = '<span style="color:var(--text2)">Consultando…</span>';
  try {
    const pay = falabellaPreflightPayloadFromModal();
    let res = await window.requestFalabellaPreflight(pay);
    if (res && res.skipped) {
      if (el) el.textContent = res.reason || 'Omitido';
      return;
    }
    let pf = res.preflight;
    if (
      pf &&
      pf.get_brands_catalog_empty &&
      window.FalabellaMaquetador &&
      !window.FalabellaMaquetador.isGenericBrand(String(document.getElementById('m-fal-brand')?.value || '').trim())
    ) {
      const applied = offerFalabellaBrandEmptyCatalogFallback();
      if (applied && window.requestFalabellaPreflight) {
        try {
          res = await window.requestFalabellaPreflight(falabellaPreflightPayloadFromModal());
          pf = res.preflight;
        } catch (e2) {
          console.warn('[Falabella preflight reintento]', e2);
        }
      }
    }
    if (!pf) {
      if (el) el.textContent = 'Sin datos de preflight';
      return;
    }
    window._falabellaPreflightLast = pf;
    const lines = (pf.checklist || []).map((row) => {
      const ok = row.ok ? '✓' : '✗';
      const col = row.ok ? 'var(--accent)' : 'var(--danger, #f87171)';
      return `<div style="margin-bottom:6px"><span style="color:${col}">${ok}</span> <strong>${row.label}</strong><div style="font-size:10px;color:var(--text2);margin-left:16px">${row.detail || ''}</div></div>`;
    });
    if (pf.actionable_errors && pf.actionable_errors.length) {
      lines.push(
        `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);color:var(--danger, #f87171);font-size:11px"><strong>Acciones:</strong><br>${pf.actionable_errors.map((x) => `· ${x}`).join('<br>')}</div>`,
      );
    }
    if (el) el.innerHTML = lines.join('') || '—';
    notify(
      pf.ready ? 'success' : 'warning',
      '🏬',
      'Falabella preflight',
      pf.ready ? 'Listo para enviar feed (revisa checklist).' : 'Hay ítems pendientes en el checklist.',
      { duration: 8000 },
    );
    refreshFalabellaMaquetadorValidation();
  } catch (e) {
    console.warn('[Falabella preflight]', e);
    if (el) el.innerHTML = `<span style="color:var(--danger)">${(e && e.message) || e}</span>`;
    notify('danger', '🏬', 'Preflight', (e && e.message) || String(e), { duration: 10000 });
  }
}

/** Tras indicar PrimaryCategory (y con artículo guardado), pide GetCategoryAttributes y rellena desplegables de moda. */
function scheduleFalabellaModaOptionsFromCategory() {
  if (window._falModaOptsTimer) {
    clearTimeout(window._falModaOptsTimer);
    window._falModaOptsTimer = null;
  }
  window._falModaOptsTimer = setTimeout(() => {
    window._falModaOptsTimer = null;
    const profile = document.getElementById('m-art-channel-profile')?.value;
    const pid = window._editingArticuloId;
    const cat = document.getElementById('m-fal-primary-cat')?.value?.trim();
    if (profile !== 'falabella' || !pid || !cat || !/^\d{2,}$/.test(cat)) return;
    loadFalabellaCategoryOptionsIntoMaquetador();
  }, 500);
}

async function loadFalabellaCategoryOptionsIntoMaquetador() {
  const pid = window._editingArticuloId;
  const cat = document.getElementById('m-fal-primary-cat')?.value?.trim();
  if (!cat) {
    notify('warning', '🏬', 'Falabella', 'Indica PrimaryCategory (ID numérico).', { duration: 6000 });
    return;
  }
  if (!pid) {
    notify(
      'warning',
      '🏬',
      'Falabella',
      'Guarda el artículo al menos una vez para tener UUID en catálogo; la API requiere productId.',
      { duration: 9000 },
    );
    return;
  }
  if (!window.requestFalabellaCategoryAttributes || !window.FalabellaMaquetador) return;
  try {
    notify('info', '🏬', 'Falabella', 'Consultando atributos de categoría…', { duration: 2500 });
    const res = await window.requestFalabellaCategoryAttributes({ productId: pid, primaryCategoryId: cat });
    if (res && res.skipped) {
      notify('warning', '🏬', 'Falabella', res.reason || 'Sin endpoint.', { duration: 5000 });
      return;
    }
    const idx = window.FalabellaMaquetador.indexCategoryAttributes(res);
    window._falabellaCategoryIndexed = idx;
    const fillSelect = (feedName, selectId) => {
      const opts = idx.byFeedName[feedName] || [];
      const sel = document.getElementById(selectId);
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '';
      const z = document.createElement('option');
      z.value = '';
      z.textContent = '— Seleccionar —';
      sel.appendChild(z);
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i];
        const op = document.createElement('option');
        op.value = o;
        op.textContent = o;
        sel.appendChild(op);
      }
      if (cur && opts.some((x) => String(x) === cur)) sel.value = cur;
    };
    fillSelect(window.FalabellaMaquetador.FEED_NAMES.tipoTraje, 'm-fal-tipo-traje');
    fillSelect(window.FalabellaMaquetador.FEED_NAMES.material, 'm-fal-material');
    fillSelect(window.FalabellaMaquetador.FEED_NAMES.genero, 'm-fal-genero');
    const FN = window.FalabellaMaquetador.FEED_NAMES;
    const missingModa = [];
    if (!(idx.byFeedName[FN.tipoTraje] || []).length) missingModa.push('Tipo de traje de baño');
    if (!(idx.byFeedName[FN.material] || []).length) missingModa.push('Material de vestuario');
    if (!(idx.byFeedName[FN.genero] || []).length) missingModa.push('Género de vestuario');
    if (missingModa.length) {
      notify(
        'warning',
        '🏬',
        'Falabella',
        `GetCategoryAttributes no devolvió opciones para: ${missingModa.join(', ')} (${(res.attributes || []).length} atributos en respuesta). Revisa PrimaryCategory o Seller Center.`,
        { duration: 14000 },
      );
    } else {
      notify(
        'success',
        '🏬',
        'Falabella',
        `Listas de moda cargadas con opciones autorizadas (${(res.attributes || []).length} atributos).`,
        { duration: 5000 },
      );
    }
    refreshFalabellaMaquetadorValidation();
  } catch (e) {
    console.warn('[Falabella maquetador]', e);
    notify('danger', '🏬', 'Falabella', (e && e.message) || String(e), { duration: 9000 });
  }
}

/** Cada canal es independiente: no comparte estado con otros; fallo no bloquea el siguiente. Ver docs/INTEGRACIONES_CANALES.md */
/** @returns {{ note: string, patch: Record<string, string> }} patch = columnas snake_case en `products` */
async function postSaveMercadoLibreIntegration(productId, catalogVisibleBool) {
  const out = { note: '', patch: {} };
  const mlEndpoint = getMercadoLibreSyncEndpoint();
  const mlChk = document.getElementById('art-sync-mercadolibre');
  const want = mlEndpoint && mlChk && mlChk.checked;
  if (!want) return out;
  try {
    const mlRes = await requestMercadoLibreSync(productId);
    if (typeof console !== 'undefined' && console.info) {
      console.info(
        '[Mercado Libre]',
        mlRes?.skipped ? 'omitido' : mlRes?.dryRun ? 'dryRun (no publicó)' : mlRes?.ok ? 'ok' : 'revisar',
        mlRes?.permalink || mlRes?.itemId || mlRes?.message || ''
      );
    }
    if (mlRes && mlRes.skipped) {
      out.note = ' · ML: no se llamó al endpoint';
      return out;
    }
    if (mlRes && mlRes.dryRun) {
      notify('warning', '🛒', 'Mercado Libre', mlRes.message || 'Secrets pendientes — revisa la función en Supabase.', { duration: 8000 });
      out.note = ' · ML: modo prueba (configura ML_ACCESS_TOKEN y ML_DEFAULT_CATEGORY_ID_MCO en Supabase)';
      return out;
    }
    if (mlRes && mlRes.ok) {
      let id =
        mlRes.itemId != null && String(mlRes.itemId).trim()
          ? String(mlRes.itemId).trim()
          : '';
      if (!id && mlRes.permalink && typeof mlRes.permalink === 'string') {
        const m = mlRes.permalink.match(/(\d{6,14})/);
        if (m && m[1]) id = m[1];
      }
      if (id) out.patch.mercadolibre_item_id = id;
      const link = mlRes.permalink || mlRes.itemId || '';
      out.note = link ? ` · ML: ${link}` : ' · ML: publicado';
      return out;
    }
    out.note = ' · ML: respuesta inesperada';
    return out;
  } catch (mlErr) {
    console.warn('[Mercado Libre]', mlErr);
    notify('warning', '🛒', 'Mercado Libre', mlErr.message || 'Falló la sincronización', { duration: 8000 });
    out.note = ' · ML: error (consola / Edge Function)';
    return out;
  }
}

async function postSaveMetaCommerceIntegration(productId, catalogVisibleBool) {
  const out = { note: '', patch: {} };
  const metaEndpoint = getMetaCommerceSyncEndpoint();
  const metaChk = document.getElementById('art-sync-meta-commerce');
  const want =
    typeof window.requestMetaCommerceSync === 'function' &&
    metaEndpoint &&
    metaChk &&
    metaChk.checked;
  if (!want) return out;
  try {
    const metaRes = await window.requestMetaCommerceSync(productId);
    if (typeof console !== 'undefined' && console.info) {
      console.info(
        '[Meta Commerce]',
        metaRes?.skipped ? 'omitido' : metaRes?.dryRun ? 'dryRun' : metaRes?.ok ? 'ok' : 'revisar',
        metaRes?.retailerId || ''
      );
    }
    if (metaRes && metaRes.skipped) {
      out.note = ' · Meta: no se llamó al endpoint';
      return out;
    }
    if (metaRes && metaRes.dryRun) {
      notify('warning', '📱', 'Meta Commerce', metaRes.message || 'Configura secrets en la Edge Function.', { duration: 8000 });
      out.note = ' · Meta: modo prueba (META_ACCESS_TOKEN / META_CATALOG_ID en Supabase)';
      return out;
    }
    if (metaRes && metaRes.ok) {
      const rid =
        metaRes.retailerId != null && String(metaRes.retailerId).trim()
          ? String(metaRes.retailerId).trim()
          : '';
      if (rid) out.patch.meta_commerce_retailer_id = rid;
      out.note = rid ? ` · Meta: ${rid}` : ' · Meta: sincronizado';
      return out;
    }
    out.note = ' · Meta: respuesta inesperada';
    return out;
  } catch (metaErr) {
    console.warn('[Meta Commerce]', metaErr);
    notify('warning', '📱', 'Meta Commerce', metaErr.message || 'Falló la sincronización', { duration: 8000 });
    out.note = ' · Meta: error (consola / Edge Function)';
    return out;
  }
}

async function postSaveDropiIntegration(productId, catalogVisibleBool) {
  const dropiEndpoint = getDropiSyncEndpoint();
  const dropiChk = document.getElementById('art-sync-dropi');
  const want =
    typeof window.requestDropiSync === 'function' &&
    dropiEndpoint &&
    (dropiChk ? !!dropiChk.checked : catalogVisibleBool);
  if (!want) return '';
  try {
    const dropiRes = await window.requestDropiSync(productId);
    if (typeof console !== 'undefined' && console.info) {
      console.info(
        '[Dropi]',
        dropiRes?.skipped ? 'omitido' : dropiRes?.dryRun ? 'dryRun' : dropiRes?.ok ? 'ok' : 'revisar',
        dropiRes?.dropiProductId || dropiRes?.message || ''
      );
    }
    if (dropiRes && dropiRes.skipped) return ' · Dropi: no se llamó al endpoint';
    if (dropiRes && dropiRes.dryRun) {
      notify('warning', '📦', 'Dropi', dropiRes.message || 'Configura secrets en la Edge Function.', { duration: 8000 });
      return ' · Dropi: modo prueba (DROPI_ACCESS_TOKEN / API en Supabase)';
    }
    if (dropiRes && dropiRes.ok) {
      const id = dropiRes.dropiProductId || dropiRes.externalId || '';
      return id ? ` · Dropi: ${id}` : ' · Dropi: sincronizado';
    }
    return ' · Dropi: respuesta inesperada';
  } catch (dropiErr) {
    console.warn('[Dropi]', dropiErr);
    notify('warning', '📦', 'Dropi', dropiErr.message || 'Falló la sincronización', { duration: 8000 });
    return ' · Dropi: error (consola / Edge Function)';
  }
}

async function postSaveGoogleMerchantIntegration(productId, catalogVisibleBool) {
  const out = { note: '', patch: {} };
  const googleEndpoint = getGoogleMerchantSyncEndpoint();
  const googleChk = document.getElementById('art-sync-google-merchant');
  const want =
    typeof window.requestGoogleMerchantSync === 'function' &&
    googleEndpoint &&
    googleChk &&
    googleChk.checked;
  if (!want) return out;
  try {
    const gRes = await window.requestGoogleMerchantSync(productId);
    if (typeof console !== 'undefined' && console.info) {
      console.info(
        '[Google Merchant]',
        gRes?.skipped ? 'omitido' : gRes?.dryRun ? 'dryRun' : gRes?.ok ? 'ok' : 'revisar',
        gRes?.googleProductRestId || gRes?.offerId || gRes?.message || ''
      );
    }
    if (gRes && gRes.skipped) {
      out.note = ' · Google: no se llamó al endpoint';
      return out;
    }
    if (gRes && gRes.dryRun) {
      notify('warning', '🔍', 'Google Merchant', gRes.message || 'Configura secrets en la Edge Function.', { duration: 9000 });
      out.note = ' · Google: modo prueba (Merchant ID + cuenta de servicio + URL base en Supabase)';
      return out;
    }
    if (gRes && gRes.ok) {
      const raw = gRes.offerId != null ? gRes.offerId : gRes.googleOfferId;
      const oid = raw != null && String(raw).trim() ? String(raw).trim() : '';
      if (oid) out.patch.google_merchant_offer_id = oid;
      out.note = oid ? ` · Google: ${oid}` : ' · Google: sincronizado';
      return out;
    }
    out.note = ' · Google: respuesta inesperada';
    return out;
  } catch (gErr) {
    console.warn('[Google Merchant]', gErr);
    notify('warning', '🔍', 'Google Merchant', gErr.message || 'Falló la sincronización', { duration: 8000 });
    out.note = ' · Google: error (consola / Edge Function)';
    return out;
  }
}

async function postSavePinterestCatalogIntegration(productId, catalogVisibleBool) {
  const out = { note: '', patch: {} };
  const pinEndpoint = getPinterestCatalogSyncEndpoint();
  const pinChk = document.getElementById('art-sync-pinterest-catalog');
  const want =
    typeof window.requestPinterestCatalogSync === 'function' &&
    pinEndpoint &&
    pinChk &&
    pinChk.checked;
  if (!want) return out;
  try {
    const pinRes = await window.requestPinterestCatalogSync(productId);
    if (typeof console !== 'undefined' && console.info) {
      console.info(
        '[Pinterest]',
        pinRes?.skipped ? 'omitido' : pinRes?.dryRun ? 'dryRun' : pinRes?.ok ? 'ok' : 'revisar',
        pinRes?.itemId || pinRes?.batchId || pinRes?.message || ''
      );
    }
    if (pinRes && pinRes.skipped) {
      out.note = ' · Pinterest: no se llamó al endpoint';
      return out;
    }
    if (pinRes && pinRes.dryRun) {
      notify('warning', '📌', 'Pinterest', pinRes.message || 'Configura secrets en la Edge Function.', { duration: 8000 });
      out.note = ' · Pinterest: modo prueba (token OAuth o refresh+app en Supabase + URL base)';
      return out;
    }
    if (pinRes && pinRes.ok) {
      const iid =
        pinRes.itemId != null && String(pinRes.itemId).trim()
          ? String(pinRes.itemId).trim()
          : '';
      if (iid) out.patch.pinterest_catalog_item_id = iid;
      out.note = iid ? ` · Pinterest: ${iid}` : ' · Pinterest: sincronizado';
      return out;
    }
    out.note = ' · Pinterest: respuesta inesperada';
    return out;
  } catch (pinErr) {
    console.warn('[Pinterest]', pinErr);
    notify('warning', '📌', 'Pinterest', pinErr.message || 'Falló la sincronización', { duration: 8000 });
    out.note = ' · Pinterest: error (consola / Edge Function)';
    return out;
  }
}

async function postSaveRappiIntegration(productId, catalogVisibleBool) {
  const rappiEndpoint = getRappiSyncEndpoint();
  const rappiChk = document.getElementById('art-sync-rappi');
  const want =
    typeof window.requestRappiSync === 'function' &&
    rappiEndpoint &&
    (rappiChk ? !!rappiChk.checked : catalogVisibleBool);
  if (!want) return '';
  try {
    const rappiRes = await window.requestRappiSync(productId);
    if (typeof console !== 'undefined' && console.info) {
      console.info(
        '[Rappi]',
        rappiRes?.skipped ? 'omitido' : rappiRes?.dryRun ? 'dryRun' : rappiRes?.ok ? 'ok' : 'revisar',
        rappiRes?.rappiItemId || rappiRes?.message || ''
      );
    }
    if (rappiRes && rappiRes.skipped) return ' · Rappi: no se llamó al endpoint';
    if (rappiRes && rappiRes.dryRun) {
      notify('warning', '🛵', 'Rappi', rappiRes.message || 'Configura secrets en la Edge Function.', { duration: 8000 });
      return ' · Rappi: modo prueba (RAPPI_CLIENT_ID / RAPPI_CLIENT_SECRET en Supabase)';
    }
    if (rappiRes && rappiRes.ok) {
      const id = rappiRes.rappiItemId || rappiRes.externalId || '';
      return id ? ` · Rappi: ${id}` : ' · Rappi: sincronizado';
    }
    return ' · Rappi: respuesta inesperada';
  } catch (rappiErr) {
    console.warn('[Rappi]', rappiErr);
    notify('warning', '🛵', 'Rappi', rappiErr.message || 'Falló la sincronización', { duration: 8000 });
    return ' · Rappi: error (consola / Edge Function)';
  }
}

/**
 * Falabella no exige «mostrar en catálogo web»: si el usuario marca el checkbox, se envía aunque el artículo esté oculto en el sitio.
 * @returns {{ note: string, falabellaPatch?: object }}
 */
async function postSaveFalabellaIntegration(productId) {
  if (window.__suppressFalabellaSyncThisSave) return { note: '' };
  const falEndpoint = getFalabellaSyncEndpoint();
  const falChk = document.getElementById('art-sync-falabella');
  const want =
    typeof window.requestFalabellaSync === 'function' &&
    falEndpoint &&
    falChk &&
    falChk.checked;
  if (!want) return { note: '' };
  try {
    const profile = document.getElementById('m-art-channel-profile')?.value || 'generic';
    if (profile === 'falabella') {
      const gate = await ensureFalabellaBrandBeforeSync(productId);
      if (!gate.ok && gate.declined) {
        const errDecl =
          '[error_validacion] Sincronización cancelada: con catálogo de marcas vacío (GetBrands) debe aceptar marca GENERICO o solicitar aprobación en Seller Support.';
        notify(
          'warning',
          '🏬',
          'Falabella',
          'Sincronización no enviada: rechazó usar GENERICO con GetBrands vacío.',
          { duration: 12000 },
        );
        return {
          note: ' · Falabella: error_validacion (marca / GetBrands vacío)',
          falabellaPatch: {
            falabellaSyncStatus: 'error_validacion',
            falabellaLastError: errDecl,
            falabellaLastSyncAt: new Date().toISOString(),
            falabellaSyncAuditJson: {
              brand_check_status: 'empty_catalog',
              brand_fallback_applied: false,
              brand_sent: null,
              phase: 'ui_declined_generic_fallback',
            },
          },
        };
      }
    }
    let falExtra;
    if (profile === 'falabella' && window.FalabellaMaquetador && window.FalabellaMaquetador.buildFalabellaPayload) {
      const draft = window.FalabellaMaquetador.collectDraftFromDom();
      const artRow = {
        id: productId,
        nombre: document.getElementById('m-art-nombre')?.value,
        name: document.getElementById('m-art-nombre')?.value,
        descripcion: document.getElementById('m-art-desc')?.value,
        ref: document.getElementById('m-art-codigo')?.value,
      };
      falExtra = window.FalabellaMaquetador.buildFalabellaPayload(artRow, draft);
    } else {
      const tallaForm = document.getElementById('m-art-tallas')?.value || '';
      const colorForm = document.getElementById('m-art-colores')?.value || '';
      const firstTalla = tallaForm.split(',').map((t) => t.trim()).filter(Boolean)[0];
      const firstColor = colorForm.split(',').map((c) => c.trim()).filter(Boolean)[0];
      falExtra =
        firstTalla || firstColor
          ? {
              ...(firstTalla ? { talla: firstTalla } : {}),
              ...(firstColor ? { color: firstColor, colorBasico: firstColor } : {}),
            }
          : undefined;
    }
    const falRes = await window.requestFalabellaSync(productId, falExtra);
    if (typeof console !== 'undefined' && console.info) {
      console.info(
        '[Falabella]',
        falRes?.skipped ? 'omitido' : falRes?.dryRun ? 'dryRun' : falRes?.ok ? 'ok' : 'revisar',
        {
          productId,
          requestIdFeed: falRes?.requestId || null,
          sellerSku: falRes?.sellerSku || null,
          syncStatus: falRes?.syncStatus,
          feedStatus: falRes?.feedStatus,
          message: falRes?.message || null,
        },
      );
    }
    if (falRes && falRes.skipped) return { note: ' · Falabella: no se llamó al endpoint' };
    if (falRes && falRes.dryRun) {
      notify('warning', '🏬', 'Falabella', falRes.message || 'Configura secrets en la Edge Function.', { duration: 9000 });
      return { note: ' · Falabella: modo prueba (secrets en Supabase)' };
    }
    if (falRes && falRes.ok === false) {
      const st = String(falRes.syncStatus || '');
      const errTxt = String(falRes.message || falRes.error || '').trim();
      if (st === 'error_validacion') {
        notify('warning', '🏬', 'Falabella validación', errTxt || 'Revisa requisitos.', { duration: 14000 });
        return {
          note: ' · Falabella: error_validacion',
          falabellaPatch: {
            falabellaSyncStatus: 'error_validacion',
            falabellaLastError: errTxt,
            falabellaLastSyncAt: new Date().toISOString(),
            falabellaSellerSku: falRes.sellerSku || '',
          },
        };
      }
      notify('danger', '🏬', 'Falabella', errTxt || 'Error', { duration: 12000 });
      return {
        note: ' · Falabella: error',
        falabellaPatch: {
          falabellaSyncStatus: st || 'error',
          falabellaLastError: errTxt,
          falabellaLastSyncAt: new Date().toISOString(),
        },
      };
    }
    if (falRes && falRes.ok) {
      const rid = falRes.requestId ? ` feed ${falRes.requestId}` : '';
      const st = falRes.syncStatus || 'synced';
      const errTxt = falRes.lastError != null && String(falRes.lastError).trim() ? String(falRes.lastError) : '';
      const patch = {
        falabellaSyncStatus: st,
        falabellaSellerSku: falRes.sellerSku || '',
        falabellaFeedRequestId: falRes.requestId || '',
        falabellaPrimaryCategoryId: falRes.primaryCategoryId || '',
        falabellaLastError: errTxt,
        falabellaLastSyncAt: new Date().toISOString(),
        falabellaFeedStatus: falRes.feedStatus != null ? String(falRes.feedStatus) : '',
      };
      if (st === 'error' || st === 'feed_timeout') {
        notify('danger', '🏬', 'Falabella feed', falRes.message || errTxt || 'Error en feed', { duration: 12000 });
      } else if (st === 'pending') {
        notify('warning', '🏬', 'Falabella feed', falRes.message || 'Feed en cola o procesando.', { duration: 10000 });
      }
      const label =
        st === 'synced' ? 'OK' : st === 'error' || st === 'feed_timeout' ? 'error' : 'pendiente';
      return {
        note: falRes.sellerSku ? ` · Falabella (${label}): ${falRes.sellerSku}${rid}` : ` · Falabella (${label})${rid}`,
        falabellaPatch: patch,
      };
    }
    return { note: ' · Falabella: respuesta inesperada' };
  } catch (falErr) {
    console.warn('[Falabella]', falErr);
    notify('warning', '🏬', 'Falabella', falErr.message || 'Falló la sincronización', { duration: 9000 });
    return {
      note: ' · Falabella: error (consola / Edge Function)',
      falabellaPatch: {
        falabellaSyncStatus: 'error',
        falabellaLastError: (falErr && falErr.message) || String(falErr),
        falabellaLastSyncAt: new Date().toISOString(),
      },
    };
  }
}

/**
 * Reenvía ProductCreate a Falabella usando el id del artículo en edición (= `products.id` en Supabase).
 * No uses el requestId del feed en consola; ese id es otro.
 */
async function reenviarFalabellaFeedModal() {
  const pid = window._editingArticuloId;
  if (!pid) {
    notify('warning', '🏬', 'Falabella', 'Abre un artículo existente (con guardado en catálogo).', { duration: 6000 });
    return;
  }
  if (window.AppId?.isUuid && !window.AppId.isUuid(String(pid))) {
    notify(
      'warning',
      '🏬',
      'Falabella',
      'Este artículo no tiene UUID de Supabase (p. ej. importado con id local). Sincroniza o usa un producto creado en el catálogo web.',
      { duration: 9000 },
    );
    return;
  }
  if (!window.requestFalabellaSync || !(window.FALABELLA_SYNC_ENDPOINT || '').trim()) {
    notify('warning', '🏬', 'Falabella', 'Endpoint no configurado.', { duration: 5000 });
    return;
  }
  const artSt = (state.articulos || []).find((a) => a.id === pid);
  const profile =
    document.getElementById('m-art-channel-profile')?.value ||
    (artSt?.falabellaProductDataJson?.channelProfile === 'falabella' ? 'falabella' : 'generic');
  if (profile === 'falabella') {
    const gate = await ensureFalabellaBrandBeforeSync(pid);
    if (!gate.ok && gate.declined) {
      notify(
        'warning',
        '🏬',
        'Falabella',
        'Reenvío cancelado: con GetBrands vacío debe aceptar marca GENERICO.',
        { duration: 12000 },
      );
      return;
    }
  }
  let falExtra;
  if (
    profile === 'falabella' &&
    window.FalabellaMaquetador &&
    artSt?.falabellaProductDataJson?.falabellaDraft
  ) {
    falExtra = window.FalabellaMaquetador.buildFalabellaPayload(artSt, artSt.falabellaProductDataJson.falabellaDraft);
  } else if (profile === 'falabella' && window.FalabellaMaquetador) {
    const draft = window.FalabellaMaquetador.collectDraftFromDom();
    falExtra = window.FalabellaMaquetador.buildFalabellaPayload(artSt || { id: pid }, draft);
  } else {
    const tallaForm = document.getElementById('m-art-tallas')?.value || '';
    const colorForm = document.getElementById('m-art-colores')?.value || '';
    const firstTalla = tallaForm.split(',').map((t) => t.trim()).filter(Boolean)[0];
    const firstColor = colorForm.split(',').map((c) => c.trim()).filter(Boolean)[0];
    falExtra =
      firstTalla || firstColor
        ? {
            ...(firstTalla ? { talla: firstTalla } : {}),
            ...(firstColor ? { color: firstColor, colorBasico: firstColor } : {}),
          }
        : undefined;
  }
  try {
    notify('info', '🏬', 'Falabella', 'Enviando feed…', { duration: 2500 });
    const falRes = await window.requestFalabellaSync(pid, falExtra);
    if (falRes && falRes.skipped) {
      notify('warning', '🏬', 'Falabella', falRes.reason || 'No se envió.', { duration: 6000 });
      return;
    }
    if (falRes && falRes.dryRun) {
      notify('warning', '🏬', 'Falabella', falRes.message || 'Configura secrets en la Edge Function.', { duration: 9000 });
      return;
    }
    if (falRes && falRes.ok === false) {
      const errTxt = String(falRes.message || falRes.error || '').trim();
      notify('warning', '🏬', 'Falabella', errTxt || 'Validación o error.', { duration: 14000 });
      return;
    }
    if (falRes && falRes.ok) {
      const rid = falRes.requestId ? ` · Feed ${falRes.requestId}` : '';
      const st = falRes.syncStatus || 'synced';
      const errTxt = falRes.lastError != null && String(falRes.lastError).trim() ? String(falRes.lastError) : '';
      const msg = (falRes.message || 'Feed enviado.') + (falRes.sellerSku ? ` · SKU ${falRes.sellerSku}` : '') + rid;
      if (st === 'error' || st === 'feed_timeout') {
        notify('danger', '🏬', 'Falabella feed', msg, { duration: 12000 });
      } else if (st === 'pending') {
        notify('warning', '🏬', 'Falabella feed', msg, { duration: 10000 });
      } else {
        notify('success', '🏬', 'Falabella', msg, { duration: 10000 });
      }
      if (typeof console !== 'undefined' && console.info) {
        console.info('[Falabella] reenvío manual', {
          productId: pid,
          requestIdFeed: falRes.requestId || null,
          sellerSku: falRes.sellerSku || null,
          syncStatus: st,
          feedStatus: falRes.feedStatus,
        });
      }
      const art = (state.articulos || []).find((a) => a.id === pid);
      if (art) {
        art.falabellaSyncStatus = st;
        art.falabellaSellerSku = falRes.sellerSku || art.falabellaSellerSku || '';
        art.falabellaFeedRequestId = falRes.requestId || '';
        art.falabellaPrimaryCategoryId = falRes.primaryCategoryId || art.falabellaPrimaryCategoryId || '';
        art.falabellaLastError = errTxt;
        art.falabellaFeedStatus = falRes.feedStatus != null ? String(falRes.feedStatus) : '';
        art.falabellaLastSyncAt = new Date().toISOString();
        if (_sbConnected && supabaseClient) {
          try {
            await supabaseClient.from('products').update({
              falabella_sync_status: st,
              falabella_seller_sku: falRes.sellerSku || null,
              falabella_feed_request_id: falRes.requestId || null,
              falabella_primary_category_id: falRes.primaryCategoryId || null,
              falabella_last_error: errTxt || null,
              falabella_last_sync_at: new Date().toISOString(),
              falabella_feed_status: falRes.feedStatus != null ? String(falRes.feedStatus) : null,
            }).eq('id', pid);
          } catch (pe) {
            console.warn('[Falabella] persist estado:', pe?.message || pe);
          }
        }
        updateFalabellaStatusLineInModal(art);
      }
    } else {
      notify('warning', '🏬', 'Falabella', 'Respuesta inesperada.', { duration: 6000 });
    }
  } catch (falErr) {
    console.warn('[Falabella] reenvío', falErr);
    notify('danger', '🏬', 'Falabella', falErr.message || String(falErr), { duration: 9000 });
  }
}

/**
 * GetCategoryAttributes vía Edge Function (misma categoría que sync: mapa + falabella_primary_category_id).
 */
async function verFalabellaAtributosCategoriaModal() {
  const pid = window._editingArticuloId;
  if (!pid) {
    notify('warning', '🏬', 'Falabella', 'Abre un artículo guardado en catálogo.', { duration: 6000 });
    return;
  }
  if (window.AppId?.isUuid && !window.AppId.isUuid(String(pid))) {
    notify(
      'warning',
      '🏬',
      'Falabella',
      'Este artículo no tiene UUID de Supabase. Usa un producto del catálogo web.',
      { duration: 9000 },
    );
    return;
  }
  if (typeof window.requestFalabellaCategoryAttributes !== 'function') {
    notify('warning', '🏬', 'Falabella', 'Integración no cargada.', { duration: 5000 });
    return;
  }
  if (!(window.FALABELLA_CATEGORY_ATTRS_ENDPOINT || '').trim() && !(window.FALABELLA_SYNC_ENDPOINT || '').trim()) {
    notify('warning', '🏬', 'Falabella', 'Endpoint no configurado (Supabase URL).', { duration: 5000 });
    return;
  }
  try {
    notify('info', '🏬', 'Falabella', 'Consultando atributos de categoría…', { duration: 2500 });
    const res = await window.requestFalabellaCategoryAttributes({ productId: pid });
    if (res && res.dryRun) {
      notify('warning', '🏬', 'Falabella', res.message || 'Configura secrets en la Edge Function.', { duration: 9000 });
      return;
    }
    const esc = (s) =>
      String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const summary = JSON.stringify(res.mandatorySummary || [], null, 2);
    const full = JSON.stringify(res.attributes || res.falabella || res, null, 2);
    const pc = esc(res.primaryCategoryId || '');
    openModal(
      `
      <div style="padding:16px;max-height:85vh;overflow:auto">
        <h3 style="margin:0 0 10px">Falabella — atributos de categoría</h3>
        <p style="font-size:12px;color:var(--text2);margin:0 0 12px">PrimaryCategory: <strong>${pc}</strong> · obligatorios: ${res.mandatoryCount ?? '—'} / total: ${res.attributeCount ?? '—'}</p>
        <p style="font-size:11px;color:var(--accent);margin:0 0 8px">Obligatorios (FeedName)</p>
        <pre style="font-size:10px;background:rgba(0,0,0,.2);padding:10px;border-radius:8px;overflow:auto;max-height:220px">${esc(summary)}</pre>
        <p style="font-size:11px;color:var(--text2);margin:12px 0 8px">Lista completa (JSON)</p>
        <pre style="font-size:9px;background:rgba(0,0,0,.2);padding:10px;border-radius:8px;overflow:auto;max-height:420px;white-space:pre-wrap">${esc(full.slice(0, 120000))}</pre>
      </div>
    `,
      true,
    );
  } catch (e) {
    console.warn('[Falabella] GetCategoryAttributes', e);
    notify('danger', '🏬', 'Falabella', e.message || String(e), { duration: 12000 });
  }
}

/**
 * ProductUpdate: envía precio y stock actuales del formulario/BD a Falabella (SKU ya existente).
 */
async function pushFalabellaPrecioStockModal() {
  const pid = window._editingArticuloId;
  if (!pid) {
    notify('warning', '🏬', 'Falabella', 'Abre un artículo guardado en catálogo.', { duration: 6000 });
    return;
  }
  if (window.AppId?.isUuid && !window.AppId.isUuid(String(pid))) {
    notify('warning', '🏬', 'Falabella', 'Este artículo no tiene UUID de Supabase.', { duration: 9000 });
    return;
  }
  if (typeof window.requestFalabellaProductUpdate !== 'function') {
    notify('warning', '🏬', 'Falabella', 'Integración no cargada.', { duration: 5000 });
    return;
  }
  if (!(window.FALABELLA_PRODUCT_UPDATE_ENDPOINT || '').trim() && !(window.FALABELLA_SYNC_ENDPOINT || '').trim()) {
    notify('warning', '🏬', 'Falabella', 'Endpoint no configurado.', { duration: 5000 });
    return;
  }
  const priceEl = document.getElementById('m-art-pv');
  const stockEl = document.getElementById('m-art-stock0');
  const price = priceEl ? parseFloat(String(priceEl.value || '0')) : NaN;
  const stock = stockEl ? parseInt(String(stockEl.value || '0'), 10) : NaN;
  try {
    notify('info', '🏬', 'Falabella', 'Enviando precio y stock (ProductUpdate)…', { duration: 3000 });
    const res = await window.requestFalabellaProductUpdate(pid, {
      ...(Number.isFinite(price) ? { price } : {}),
      ...(Number.isFinite(stock) ? { stock } : {}),
    });
    if (res && res.dryRun) {
      notify('warning', '🏬', 'Falabella', res.message || 'Configura secrets en la función.', { duration: 9000 });
      return;
    }
    const st = res?.syncStatus || '';
    const msg = res?.message || '';
    if (st === 'error' || st === 'feed_timeout') {
      notify('danger', '🏬', 'Falabella oferta', msg || res?.lastError || 'Error', { duration: 12000 });
    } else if (st === 'pending') {
      notify('warning', '🏬', 'Falabella oferta', msg || 'Feed en cola.', { duration: 10000 });
    } else {
      notify('success', '🏬', 'Falabella oferta', msg || 'Precio/stock enviados.', { duration: 9000 });
    }
    const art = (state.articulos || []).find((a) => a.id === pid);
    if (art && _sbConnected && supabaseClient) {
      art.falabellaSyncStatus = st || art.falabellaSyncStatus;
      art.falabellaLastError = res?.lastError != null ? String(res.lastError) : art.falabellaLastError;
      art.falabellaFeedStatus = res?.feedStatus != null ? String(res.feedStatus) : art.falabellaFeedStatus;
      art.falabellaLastSyncAt = new Date().toISOString();
    }
    updateFalabellaStatusLineInModal(art || { id: pid, falabellaSyncStatus: st, falabellaLastError: res?.lastError, falabellaFeedStatus: res?.feedStatus });
  } catch (e) {
    console.warn('[Falabella] ProductUpdate', e);
    notify('danger', '🏬', 'Falabella', e.message || String(e), { duration: 12000 });
  }
}

function addBusinessDays(dateStr,days){const d=new Date(dateStr+'T12:00:00');let added=0;while(added<days){d.setDate(d.getDate()+1);const dow=d.getDay();if(dow!==0&&dow!==6)added++;}return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function daysDiff(dateStr){const d1=new Date(today()+'T00:00:00');const d2=new Date(dateStr+'T00:00:00');return Math.round((d2-d1)/86400000)}
/** Ítems de la factura POS ligada a la venta (mismo id o # en desc). */
function getFacturaItemsForVenta(venta){
  if(!venta) return [];
  const list = state.facturas || [];
  let fac = list.find((f) => f.id === venta.id);
  if(!fac && venta.desc) fac = list.find((f) => f.numero === venta.desc);
  if(!fac || !Array.isArray(fac.items)) return [];
  return fac.items;
}
/** Bloque HTML: productos en tarjeta Cobros pendientes + aclaración ingreso/día. */
function cobrosProductosResumenHtml(venta){
  const items = getFacturaItemsForVenta(venta);
  if(!items.length){
    return '<div style="font-size:11px;color:var(--text2);margin-top:6px;font-style:italic">Sin detalle de ítems (recarga la app o verifica factura).</div>';
  }
  const esc=(s)=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  let h='<div style="margin-top:8px;padding:8px 10px;background:rgba(0,229,180,.07);border:1px solid rgba(0,229,180,.15);border-radius:8px">';
  h+='<div style="font-size:10px;font-weight:700;color:var(--accent);margin-bottom:6px">Productos vendidos</div><ul style="margin:0;padding-left:18px;font-size:11px;line-height:1.5;color:var(--text)">';
  items.slice(0,8).forEach((i)=>{
    const n=esc(i.nombre||i.name||'—');
    const q=parseFloat(i.qty!=null?i.qty:i.cantidad)||1;
    h+=`<li>${n} <span style="color:var(--text2)">×${q}</span></li>`;
  });
  h+='</ul>';
  if(items.length>8) h+=`<div style="font-size:10px;color:var(--text2);margin-top:4px">+${items.length-8} más…</div>`;
  h+=`<div style="font-size:10px;color:var(--text2);margin-top:8px">💰 Ingreso en caja y totales del día: <b>${formatDate(venta.fecha)}</b> (fecha de la venta). «Marcar liquidado» no duplica el movimiento en caja.</div></div>`;
  return h;
}
/** Incluida en totales de meta / informes (excluye archivo y factura POS anulada). */
function ventaCuentaParaTotales(v){
  if(!v||v.archived)return false;
  const f=(state.facturas||[]).find(x=>String(x.id)===String(v.id));
  return!(f&&f.estado==='anulada');
}
function ventasMes(s){
  const active=(s.ventas||[]).filter(v=>ventaCuentaParaTotales(v));
  const despachos=active.filter(v=>v.canal!=='vitrina');
  const vitrina=active.filter(v=>v.canal==='vitrina');
  const local=active.filter(v=>v.canal==='local');
  const inter=active.filter(v=>v.canal==='inter');
  const totalAll=active.reduce((a,v)=>a+(parseFloat(v.valor)||0),0);
  const totalCOPDespachos=despachos.reduce((a,v)=>a+(parseFloat(v.valor)||0),0);
  const totalCOP=totalAll;
  return{active,despachos,vitrina,local,inter,totalDespachos:despachos.length,totalCOP,totalCOPDespachos,vitrineTotal:vitrina.reduce((a,v)=>a+(parseFloat(v.valor)||0),0),localTotal:local.reduce((a,v)=>a+(parseFloat(v.valor)||0),0),interTotal:inter.reduce((a,v)=>a+(parseFloat(v.valor)||0),0),totalAll};
}
/** YYYY-MM desde fecha de factura/venta (ISO). */
function yearMonthFromFecha(fechaStr){if(!fechaStr||typeof fechaStr!=='string')return '';return fechaStr.length>=7?fechaStr.slice(0,7):''}
/** Ventas activas cuyo campo fecha cae en el mes calendario indicado (ej. mes de hoy). */
function ventasEnMesCalendario(ventas,ym){return(ventas||[]).filter(v=>ventaCuentaParaTotales(v)&&yearMonthFromFecha(v.fecha)===ym)}
/** Orden: más reciente primero (fecha desc, luego id desc para empates). Cada venta POS = 1 factura. */
function sortVentasRecientes(ventas){return [...(ventas||[])].sort((a,b)=>{const c=(b.fecha||'').localeCompare(a.fecha||'');if(c!==0)return c;return String(b.id||'').localeCompare(String(a.id||''))})}
function hasDiaUnMillon(s){const active=(s.ventas||[]).filter(v=>ventaCuentaParaTotales(v));const byDay={};active.forEach(v=>{byDay[v.fecha]=(byDay[v.fecha]||0)+(parseFloat(v.valor)||0)});return Object.values(byDay).some(t=>t>=1000000)}
function calcLevel(xp){let lv=LEVELS[0];for(const l of LEVELS){if(xp>=l.minXp)lv=l}return lv}
function calcLevelProgress(xp){const lv=calcLevel(xp);const idx=LEVELS.indexOf(lv);if(idx>=LEVELS.length-1)return{lv,next:null,pct:100,xpToNext:0};const next=LEVELS[idx+1];const pct=Math.min(100,((xp-lv.minXp)/(next.minXp-lv.minXp))*100);return{lv,next,pct,xpToNext:next.minXp-xp}}
function calcStreak(){const active=(state.ventas||[]).filter(v=>ventaCuentaParaTotales(v)&&v.canal!=='vitrina');const byDay={};active.forEach(v=>{byDay[v.fecha]=(byDay[v.fecha]||0)+1});let streak=0;const d=new Date(today()+'T12:00:00');while(true){const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;if((byDay[ds]||0)>=5){streak++;d.setDate(d.getDate()-1)}else break}return streak}
function calcXP(canal,valor){
  const g=state.cfg_game||{};
  if(canal==='vitrina')return Math.floor(valor/(g.xp_por_venta_vitrina||150000));
  if(canal==='local')return Math.max(8,Math.floor(valor/(g.xp_por_venta_local||25000)*1.2));
  if(canal==='inter')return Math.max(10,Math.floor(valor/(g.xp_por_venta_inter||20000)*1.4));
  return 0;
}
function getISOWeek(date){const d=new Date(date);d.setHours(0,0,0,0);d.setDate(d.getDate()+4-(d.getDay()||7));const yearStart=new Date(d.getFullYear(),0,1);return{week:Math.ceil((((d-yearStart)/86400000)+1)/7),year:d.getFullYear()}}
function getWeekSnack(){const{week,year}=getISOWeek(new Date());const hash=Math.abs((week*31+year*7+week*year)%SNACKS.length);return{snack:SNACKS[hash],week,year}}
function getWeekXP(){const now=new Date();const dow=now.getDay()||7;const monday=new Date(now);monday.setDate(now.getDate()-dow+1);monday.setHours(0,0,0,0);const active=(state.ventas||[]).filter(v=>ventaCuentaParaTotales(v));let xp=0;active.forEach(v=>{const vDate=new Date(v.fecha+'T12:00:00');if(vDate>=monday)xp+=calcXP(v.canal,v.valor)});return xp}
function getNextConsec(type){const n=state.consecutivos[type]||1;state.consecutivos[type]=n+1;return String(n).padStart(5,'0')}
function getArticuloStock(artId, bodegaId) {
  // Lee directamente de products.stock (fuente de verdad en Supabase)
  // Si se pide por bodega específica, usa inv_movimientos como antes
  if(bodegaId) {
    return (state.inv_movimientos||[])
      .filter(m => m.articuloId===artId && m.bodegaId===bodegaId)
      .reduce((a,m) => a+m.cantidad, 0);
  }
  const art = (state.articulos||[]).find(a => a.id === artId);
  return art ? (art.stock||0) : 0;
}


// Carga paginada usando REST directo (evita DataCloneError del SDK)
async function fetchAllRows(table, select = '*') {
  let bearer = SUPABASE_ANON_KEY;
  try {
    if (supabaseClient?.auth?.getSession) {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session?.access_token) bearer = session.access_token;
    }
  } catch (_) { /* noop */ }
  const PAGE = 1000;
  let page = 0;
  let all = [];
  while(true) {
    const from = page * PAGE;
    const to = (page + 1) * PAGE - 1;
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${PAGE}&offset=${from}`;
    const resp = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${bearer}`,
        'Content-Type': 'application/json'
      }
    });
    if(!resp.ok) {
      const errText = await resp.text();
      throw new Error(`[${table}] ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    if(!data || data.length === 0) break;
    all = all.concat(data);
    if(data.length < PAGE) break;
    page++;
  }
  return all;
}

/** Igual que fetchAllRows pero con filtros PostgREST (misma sesión JWT que tes_movimientos — alinea con RLS). */
async function fetchAllRowsFiltered(table, select, filterQuery) {
  let bearer = SUPABASE_ANON_KEY;
  try {
    if (supabaseClient?.auth?.getSession) {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session?.access_token) bearer = session.access_token;
    }
  } catch (_) {
    /* noop */
  }
  const PAGE = 1000;
  let page = 0;
  let all = [];
  const fq = String(filterQuery || '').replace(/^&/, '');
  while (true) {
    const from = page * PAGE;
    const q =
      `?select=${encodeURIComponent(select)}` +
      (fq ? `&${fq}` : '') +
      `&limit=${PAGE}&offset=${from}`;
    const url = `${SUPABASE_URL}/rest/v1/${table}${q}`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`[${table}] ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    page++;
  }
  return all;
}

/** Recarga solo `stock_moves` tipo venta_pos → `state.stock_moves_ventas` (tras backfill o si RLS se corrigió). */
async function loadStockMovesVentasIntoState() {
  state.stock_moves_ventas = [];
  if (!supabaseClient) return;
  const normQty =
    typeof window.normalizeStockMoveQtyFromDbRow === 'function'
      ? window.normalizeStockMoveQtyFromDbRow
      : (r) => {
          const q = r.qty ?? r.cantidad ?? r.quantity ?? r.amount;
          return q != null ? Number(q) : 0;
        };
  const pushRows = (chunk) => {
    (chunk || []).forEach((r) => {
      const qty = normQty(r);
      state.stock_moves_ventas.push({
        id: r.id,
        productId: r.product_id,
        cantidad: qty,
        tipo: r.tipo,
        fecha: r.fecha,
        referencia: r.referencia || '',
        documentoId: r.documento_id,
      });
    });
  };
  try {
    const rows = await fetchAllRowsFiltered('stock_moves', '*', 'tipo=eq.venta_pos&order=id.asc');
    pushRows(rows);
  } catch (e) {
    console.warn('stock_moves venta_pos (REST paginado):', e.message);
    try {
      let smOff = 0;
      const SM_PAGE = 1000;
      while (true) {
        const { data: smRows, error: smErr } = await supabaseClient
          .from('stock_moves')
          .select('*')
          .eq('tipo', 'venta_pos')
          .order('id', { ascending: true })
          .range(smOff, smOff + SM_PAGE - 1);
        if (smErr) {
          console.warn('stock_moves venta_pos (SDK):', smErr.message);
          break;
        }
        const chunk = smRows || [];
        pushRows(chunk);
        if (chunk.length < SM_PAGE) break;
        smOff += SM_PAGE;
      }
    } catch (e2) {
      console.warn('stock_moves:', e2.message);
    }
  }
}
try {
  window.reloadStockMovesVentasFromDb = loadStockMovesVentasIntoState;
} catch (e) {}

// ----- Anti-desincronización (refresco parcial, sin duplicar reglas de negocio) -----
let _criticalRefreshChain = Promise.resolve();

function rebuildInvMovimientosFromState() {
  state.inv_movimientos = [];
  (state.inv_ajustes || []).forEach((a) => {
    state.inv_movimientos.push({
      id: 'aj_' + a.id,
      articuloId: a.articuloId,
      bodegaId: a.bodegaId || 'bodega_main',
      cantidad: a.tipo === 'entrada' || a.tipo === 'devolucion' ? a.cantidad : -a.cantidad,
      tipo: 'ajuste_' + a.tipo,
      fecha: a.fecha,
      referencia: 'Ajuste',
      nota: a.motivo
    });
  });
  (state.inv_traslados || []).forEach((t) => {
    state.inv_movimientos.push(
      { id: 'tr_o_' + t.id, articuloId: t.articuloId, bodegaId: t.origenId, cantidad: -t.cantidad, tipo: 'traslado_salida', fecha: t.fecha, referencia: 'Traslado', nota: t.nota },
      { id: 'tr_i_' + t.id, articuloId: t.articuloId, bodegaId: t.destinoId, cantidad: t.cantidad, tipo: 'traslado_entrada', fecha: t.fecha, referencia: 'Traslado', nota: t.nota }
    );
  });
}

async function hydrateArticulosFromSupabase() {
  const [{ data: mediaRows }, { data: allSizes }, { data: allColors }] = await Promise.all([
    supabaseClient.from('product_media').select('product_id,url,is_cover'),
    supabaseClient.from('product_sizes').select('product_id, sizes(label)'),
    supabaseClient.from('product_colors').select('product_id, colors(label)')
  ]);
  let products = [];
  try {
    products = await fetchAllRows('products');
  } catch (e) {
    console.warn('products (paginado):', e.message);
    const { data: pr } = await supabaseClient.from('products').select('*');
    products = pr || [];
  }
  const mediaByProduct = {};
  (mediaRows || []).forEach((m) => {
    if (!mediaByProduct[m.product_id]) mediaByProduct[m.product_id] = [];
    mediaByProduct[m.product_id].push(m);
  });
  const sizesByProduct = {};
  const colorsByProduct = {};
  (allSizes || []).forEach((ps) => {
    if (!sizesByProduct[ps.product_id]) sizesByProduct[ps.product_id] = [];
    if (ps.sizes?.label) sizesByProduct[ps.product_id].push(ps.sizes.label);
  });
  (allColors || []).forEach((pc) => {
    if (!colorsByProduct[pc.product_id]) colorsByProduct[pc.product_id] = [];
    if (pc.colors?.label) colorsByProduct[pc.product_id].push(pc.colors.label);
  });
  state.articulos = (products || []).map((p) => {
    const media = mediaByProduct[p.id] || [];
    const cover = media.find((m) => m.is_cover) || media[0];
    const imgs = media.map((m) => m.url).filter(Boolean);
    const tallasArr = sizesByProduct[p.id] || [];
    const coloresArr = colorsByProduct[p.id] || [];
    const falJson = p.falabella_product_data_json && typeof p.falabella_product_data_json === 'object' && !Array.isArray(p.falabella_product_data_json)
      ? p.falabella_product_data_json
      : {};
    const integIds = integrationIdsFromProductRow(p);
    return {
      id: p.id,
      codigo: p.ref || '',
      ref: p.ref || '',
      nombre: p.name || '',
      name: p.name || '',
      categoria: p.categoria || '',
      seccion: p.seccion || '',
      cat: p.categoria || '',
      descripcion: p.description || '',
      precioVenta: parseFloat(p.price) || 0,
      price: parseFloat(p.price) || 0,
      precioCompra: parseFloat(p.cost) || 0,
      tallas: tallasArr.join(', '),
      sizes: tallasArr.join(', '),
      colors: coloresArr,
      colores: coloresArr.join(', '),
      images: imgs,
      imagen: cover ? cover.url : imgs[0] || '',
      stock: p.stock || 0,
      stockMinimo: p.stock_min || 0,
      activo: p.active !== false,
      mostrarEnWeb: catalogVisibleFromProductRow(p),
      supabaseId: p.id,
      tituloMercancia: p.titulo_mercancia || '',
      proveedorId: p.proveedor_id || null,
      proveedorNombre: p.proveedor_nombre || '',
      falabellaSellerSku: p.falabella_seller_sku || '',
      falabellaFeedRequestId: p.falabella_feed_request_id || '',
      falabellaSyncStatus: p.falabella_sync_status || '',
      falabellaFeedStatus: p.falabella_feed_status || '',
      falabellaLastError: p.falabella_last_error || '',
      falabellaLastSyncAt: p.falabella_last_sync_at || null,
      falabellaPrimaryCategoryId: p.falabella_primary_category_id || '',
      falabellaProductDataJson: falJson,
      mercadolibreItemId: integIds.mercadolibreItemId,
      metaCommerceRetailerId: integIds.metaCommerceRetailerId,
      googleMerchantOfferId: integIds.googleMerchantOfferId,
      pinterestCatalogItemId: integIds.pinterestCatalogItemId
    };
  });
}

async function hydrateInvSliceFromSupabase() {
  const [{ data: invAjustes }, { data: invTraslados }, { data: lotesData, error: lotesErr }] = await Promise.all([
    supabaseClient.from('inv_ajustes').select('*'),
    supabaseClient.from('inv_traslados').select('*'),
    supabaseClient.from('inv_ajustes_lotes').select('*')
  ]);
  if (lotesErr) console.warn('inv_ajustes_lotes:', lotesErr.message);
  state.inv_ajustes_lotes = (lotesData || []).map((l) => ({ id: l.id, bodegaId: l.bodega_id, motivo: l.motivo || '', fecha: l.fecha }));
  state.inv_ajustes = (invAjustes || []).map((a) => ({
    id: a.id,
    articuloId: a.articulo_id,
    bodegaId: a.bodega_id,
    tipo: a.tipo,
    cantidad: a.cantidad,
    motivo: a.motivo || '',
    fecha: a.fecha,
    loteId: a.lote_id || null
  }));
  state.inv_traslados = (invTraslados || []).map((t) => ({
    id: t.id,
    articuloId: t.articulo_id,
    origenId: t.origen_id,
    destinoId: t.destino_id,
    cantidad: t.cantidad,
    nota: t.nota || '',
    fecha: t.fecha
  }));
  rebuildInvMovimientosFromState();
}

async function hydrateCajasMinimalFromSupabase() {
  const { data: cajas } = await supabaseClient.from('cajas').select('*');
  if (cajas && cajas.length > 0) {
    state.cajas = cajas.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      saldo: parseFloat(c.saldo) || 0,
      estado: c.estado || 'abierta',
      apertura: c.apertura,
      bodegaIds: c.bodega_ids,
      saldosMetodo: c.saldos_metodo,
      sesionActivaId: c.sesion_activa_id || null,
      proximaAperturaSaldos: c.proxima_apertura_saldos
    }));
    if (window.AppCajaLogic?.normalizeAllCajas) window.AppCajaLogic.normalizeAllCajas(state);
  }
}

async function hydrateTesProveedorSliceFromSupabase() {
  const [{ data: abonosProv }, { data: compromisosProv }] = await Promise.all([
    supabaseClient.from('tes_abonos_prov').select('*'),
    supabaseClient.from('tes_compromisos_prov').select('*')
  ]);
  state.tes_abonos_prov = (abonosProv || []).map((ab) => ({
    id: ab.id,
    proveedorId: ab.proveedor_id,
    proveedorNombre: ab.proveedor_nombre || '',
    valor: parseFloat(ab.valor) || 0,
    metodo: ab.metodo || '',
    fecha: ab.fecha,
    nota: ab.nota || '',
    fechaCreacion: ab.fecha_creacion || ab.fecha,
    fechaHora: ab.fecha_hora || null
  }));
  state.tes_libro_proveedor = [];
  try {
    const { data: libroRows, error: libroErr } = await supabaseClient.from('tes_libro_proveedor').select('*').order('fecha_hora', { ascending: false }).limit(8000);
    if (!libroErr && libroRows) {
      state.tes_libro_proveedor = libroRows.map((r) => ({
        id: r.id,
        proveedorId: r.proveedor_id,
        proveedorNombre: r.proveedor_nombre || '',
        tipo: r.tipo,
        articuloId: r.articulo_id,
        descripcion: r.descripcion || '',
        valor: parseFloat(r.valor) || 0,
        fechaHora: r.fecha_hora
      }));
    }
  } catch (e) {
    console.warn('tes_libro_proveedor:', e.message);
  }
  state.tes_devoluciones_prov = [];
  try {
    const { data: devRows, error: devErr } = await supabaseClient.from('tes_devoluciones_prov').select('*').order('fecha_hora', { ascending: false }).limit(8000);
    if (!devErr && devRows) {
      state.tes_devoluciones_prov = devRows.map((r) => ({
        id: r.id,
        proveedorId: r.proveedor_id,
        proveedorNombre: r.proveedor_nombre || '',
        articuloId: r.articulo_id,
        cantidad: parseFloat(r.cantidad) || 0,
        valorCosto: parseFloat(r.valor_costo) || 0,
        invAjusteId: r.inv_ajuste_id || null,
        nota: r.nota || '',
        fecha: r.fecha,
        fechaHora: r.fecha_hora
      }));
    }
  } catch (e) {
    console.warn('tes_devoluciones_prov:', e.message);
  }
  state.tes_ajustes_unidades_prov = [];
  try {
    const { data: ajRows, error: ajErr } = await supabaseClient
      .from('tes_ajustes_unidades_prov')
      .select('*')
      .order('fecha_hora', { ascending: false })
      .limit(8000);
    if (!ajErr && ajRows) {
      state.tes_ajustes_unidades_prov = ajRows.map((r) => ({
        id: r.id,
        proveedorId: r.proveedor_id,
        articuloId: r.articulo_id,
        deltaUnidades: parseFloat(r.delta_unidades) || 0,
        nota: r.nota || '',
        fechaHora: r.fecha_hora,
        proveedorNombre: r.proveedor_nombre || '',
        articuloNombre: r.articulo_nombre || ''
      }));
    }
  } catch (e) {
    console.warn('tes_ajustes_unidades_prov:', e.message);
  }
  state.tes_compromisos_prov = (compromisosProv || []).map((c) => {
    const lineasRaw = Array.isArray(c.lineas)
      ? c.lineas
      : c.meta && typeof c.meta === 'object' && Array.isArray(c.meta.lineas)
        ? c.meta.lineas
        : [];
    return {
      id: c.id,
      proveedorId: c.proveedor_id,
      proveedorNombre: c.proveedor_nombre || '',
      valor: parseFloat(c.valor) || 0,
      fecha: c.fecha,
      nota: c.nota || '',
      referencia: c.referencia || '',
      lineas: lineasRaw
    };
  });
  state.tes_cxp_movimientos = [];
  try {
    let cxpOff = 0;
    const CXP_PAGE = 1000;
    while (supabaseClient) {
      const { data: cxpRows, error: cxpErr } = await supabaseClient
        .from('tes_cxp_movimientos')
        .select('*')
        .order('fecha_hora', { ascending: false })
        .range(cxpOff, cxpOff + CXP_PAGE - 1);
      if (cxpErr) {
        console.warn('tes_cxp_movimientos:', cxpErr.message);
        break;
      }
      const chunk = cxpRows || [];
      chunk.forEach((r) => {
        const lineasRaw = Array.isArray(r.lineas)
          ? r.lineas
          : r.meta && typeof r.meta === 'object' && Array.isArray(r.meta.lineas)
            ? r.meta.lineas
            : [];
        state.tes_cxp_movimientos.push({
          id: r.id,
          proveedorId: r.proveedor_id,
          proveedorNombre: r.proveedor_nombre || '',
          tipo: r.tipo,
          naturaleza: r.naturaleza,
          monto: parseFloat(r.monto) || 0,
          fecha: r.fecha,
          referencia: r.referencia || '',
          nota: r.nota || '',
          meta: r.meta && typeof r.meta === 'object' ? r.meta : {},
          lineas: lineasRaw,
          fechaHora: r.fecha_hora
        });
      });
      if (chunk.length < CXP_PAGE) break;
      cxpOff += CXP_PAGE;
    }
  } catch (e) {
    console.warn('tes_cxp_movimientos:', e.message);
  }
}

function pulseCriticalUIAfterSyncChange() {
  const active = document.querySelector('.page.active')?.id?.replace('page-', '');
  if (active === 'pos' && typeof renderPOS === 'function') renderPOS();
  else if (['articulos', 'inv_trazabilidad', 'inv_ajustes', 'inv_traslados'].includes(active) && typeof renderPage === 'function') renderPage(active);
  else if (active === 'tes_pagos_prov' && typeof renderTesPagosProv === 'function') renderTesPagosProv();
}

async function runOneCriticalRefresh(slice) {
  const G = window.AppSyncGuard;
  if (!_sbConnected || !supabaseClient) {
    return { ok: true, skipped: true };
  }
  if (slice !== 'pos' && slice !== 'inventario' && slice !== 'tes_prov') {
    return { ok: false, error: new Error('slice_desconocido') };
  }
  G?.beginSync('Sincronizando datos…');
  pulseCriticalUIAfterSyncChange();
  try {
    if (slice === 'pos') {
      await hydrateArticulosFromSupabase();
      await hydrateCajasMinimalFromSupabase();
      await loadStockMovesVentasIntoState();
    } else if (slice === 'inventario') {
      await Promise.all([hydrateInvSliceFromSupabase(), hydrateArticulosFromSupabase()]);
    } else if (slice === 'tes_prov') {
      await hydrateTesProveedorSliceFromSupabase();
      await hydrateArticulosFromSupabase();
      await loadStockMovesVentasIntoState();
    }
    G?.markSynced(slice);
    pulseCriticalUIAfterSyncChange();
    updateNavBadges();
    return { ok: true };
  } catch (e) {
    console.warn('[refreshCriticalSlice]', slice, e);
    notify('warning', '📡', 'No se pudo sincronizar', 'Reintenta en unos segundos o recarga la página.', { duration: 6500 });
    return { ok: false, error: e };
  } finally {
    G?.endSync();
    pulseCriticalUIAfterSyncChange();
  }
}

function refreshCriticalSlice(slice) {
  return new Promise((resolve) => {
    _criticalRefreshChain = _criticalRefreshChain.catch(() => {}).then(async () => {
      const result = await runOneCriticalRefresh(slice);
      resolve(result);
      return result;
    });
  });
}

async function ensureAntiDesyncBefore(module) {
  const G = window.AppSyncGuard;
  if (!_sbConnected) return { ok: true };
  if (G?.isBusy?.()) {
    notify('warning', '⏳', 'Sincronización en curso', G.waitMessage, { duration: 4500 });
    return { ok: false };
  }
  if (!G?.isStale?.(module)) return { ok: true };
  const r = await refreshCriticalSlice(module);
  return r.ok ? { ok: true } : { ok: false };
}

function requestCriticalReconcileAfterNav(pageId) {
  if (!_sbConnected) return;
  const sliceByPage = {
    pos: 'pos',
    articulos: 'inventario',
    inv_trazabilidad: 'inventario',
    inv_ajustes: 'inventario',
    inv_traslados: 'inventario',
    tes_pagos_prov: 'tes_prov'
  };
  const slice = sliceByPage[pageId];
  if (!slice) return;
  refreshCriticalSlice(slice).then((r) => {
    if (!r.ok && !r.skipped) {
      notify('warning', '📡', 'No se pudo sincronizar', 'Reintenta o vuelve a abrir esta sección.', { duration: 5500 });
    }
  });
}

try {
  window.refreshCriticalSlice = refreshCriticalSlice;
  window.ensureAntiDesyncBefore = ensureAntiDesyncBefore;
} catch (e) {}

async function loadState() {
  showLoadingOverlay('connecting');
  /** Si se fusiona `caja_principal` → uuid canónico, se persiste tras marcar conexión. */
  let pendingLegacyCajaMerge = null;
  try {
    const [
      {data:mediaRows}, {data:_cust},
      {data:employees}, {data:ventas}, {data:cajas},
      {data:nomNominas}, {data:nomAusencias},
      {data:nomAnticipos}, {data:invAjustes}, {data:invTraslados},
      {data:bodegas}, {data:configs},       {data:proveedores},
      {data:abonosProv},
      {data:compromisosProv}
    ] = await Promise.all([
      supabaseClient.from('product_media').select('product_id,url,is_cover'),
      Promise.resolve({data:[]}), // customers cargados por separado (paginado)
      supabaseClient.from('employees').select('*'),
      supabaseClient.from('ventas').select('*'),
      supabaseClient.from('cajas').select('*'),
      supabaseClient.from('nom_nominas').select('*'),
      supabaseClient.from('nom_ausencias').select('*'),
      supabaseClient.from('nom_anticipos').select('*'),
      supabaseClient.from('inv_ajustes').select('*'),
      supabaseClient.from('inv_traslados').select('*'),
      supabaseClient.from('bodegas').select('*'),
      supabaseClient.from('state_config').select('*'),
      supabaseClient.from('proveedores').select('*'),
      supabaseClient.from('tes_abonos_prov').select('*'),
      supabaseClient.from('tes_compromisos_prov').select('*')
    ]);

    let products = [];
    try {
      products = await fetchAllRows('products');
    } catch (e) {
      console.warn('products (paginado):', e.message);
      const { data: pr } = await supabaseClient.from('products').select('*');
      products = pr || [];
    }
    let facturas = [];
    try {
      facturas = await fetchAllRows('invoices');
    } catch (e) {
      console.warn('invoices (paginado):', e.message);
      const { data: inv } = await supabaseClient.from('invoices').select('*');
      facturas = inv || [];
    }

    /** PostgREST limita ~1000 filas por request; sin paginar, al superar ese número “desaparecen” movimientos al recargar. */
    let tesMov = [];
    try {
      tesMov = await fetchAllRows('tes_movimientos');
    } catch (e) {
      console.warn('tes_movimientos (paginado):', e.message);
      const { data: tm } = await supabaseClient.from('tes_movimientos').select('*');
      tesMov = tm || [];
    }

    // Productos + imágenes + tallas + colores
    const mediaByProduct = {};
    (mediaRows||[]).forEach(m=>{if(!mediaByProduct[m.product_id])mediaByProduct[m.product_id]=[];mediaByProduct[m.product_id].push(m)});

    // Cargar tallas y colores en paralelo
    const [{data: allSizes}, {data: allColors}] = await Promise.all([
      supabaseClient.from('product_sizes').select('product_id, sizes(label)'),
      supabaseClient.from('product_colors').select('product_id, colors(label)')
    ]);
    const sizesByProduct = {};
    const colorsByProduct = {};
    (allSizes||[]).forEach(ps => {
      if(!sizesByProduct[ps.product_id]) sizesByProduct[ps.product_id] = [];
      if(ps.sizes?.label) sizesByProduct[ps.product_id].push(ps.sizes.label);
    });
    (allColors||[]).forEach(pc => {
      if(!colorsByProduct[pc.product_id]) colorsByProduct[pc.product_id] = [];
      if(pc.colors?.label) colorsByProduct[pc.product_id].push(pc.colors.label);
    });

    state.articulos = (products||[]).map(p=>{
      const media=mediaByProduct[p.id]||[];
      const cover=media.find(m=>m.is_cover)||media[0];
      const imgs=media.map(m=>m.url).filter(Boolean);
      const tallasArr = sizesByProduct[p.id]||[];
      const coloresArr = colorsByProduct[p.id]||[];
      const falJson = p.falabella_product_data_json && typeof p.falabella_product_data_json === 'object' && !Array.isArray(p.falabella_product_data_json)
        ? p.falabella_product_data_json : {};
      const integIds = integrationIdsFromProductRow(p);
      return {id:p.id,codigo:p.ref||'',ref:p.ref||'',nombre:p.name||'',name:p.name||'',
        categoria:p.categoria||'',seccion:p.seccion||'',cat:p.categoria||'',
        descripcion:p.description||'',precioVenta:parseFloat(p.price)||0,price:parseFloat(p.price)||0,
        precioCompra:parseFloat(p.cost)||0,
        tallas:tallasArr.join(', '),sizes:tallasArr.join(', '),
        colors:coloresArr,colores:coloresArr.join(', '),
        images:imgs,imagen:cover?cover.url:(imgs[0]||''),
        stock:p.stock||0,stockMinimo:p.stock_min||0,
        activo:p.active!==false,mostrarEnWeb:catalogVisibleFromProductRow(p),supabaseId:p.id,
        tituloMercancia:p.titulo_mercancia||'',proveedorId:p.proveedor_id||null,proveedorNombre:p.proveedor_nombre||'',
        falabellaSellerSku:p.falabella_seller_sku||'',
        falabellaFeedRequestId:p.falabella_feed_request_id||'',
        falabellaSyncStatus:p.falabella_sync_status||'',
        falabellaFeedStatus:p.falabella_feed_status||'',
        falabellaLastError:p.falabella_last_error||'',
        falabellaLastSyncAt:p.falabella_last_sync_at||null,
        falabellaPrimaryCategoryId:p.falabella_primary_category_id||'',
        falabellaProductDataJson:falJson,
        mercadolibreItemId:integIds.mercadolibreItemId,
        metaCommerceRetailerId:integIds.metaCommerceRetailerId,
        googleMerchantOfferId:integIds.googleMerchantOfferId,
        pinterestCatalogItemId:integIds.pinterestCatalogItemId};
    });

    // Clientes / Empleados / Proveedores
    // Cargar clientes con paginación (pueden ser miles)
    const customers = await fetchAllRows('customers');
    state.usu_clientes = (customers||[]).map(c=>({...c,tipo:'cliente',tipoId:'CC',celular:c.celular||'',fechaCreacion:c.created_at?c.created_at.split('T')[0]:today()}));
    state.empleados = (employees||[]).map(e=>({...e,salarioBase:parseFloat(e.salario_base)||0,tipoContrato:e.tipo_contrato||'indefinido'}));
    // usu_empleados es el mismo array — renderUsuEmpleados lo usa
    state.usu_empleados = state.empleados;
    state.usu_proveedores = (proveedores||[]).map(p=>({...p,tipo:'proveedor'}));

    // Ventas
    state.ventas = (ventas||[]).map(v=>({id:v.id,fecha:v.fecha,canal:v.canal,valor:parseFloat(v.valor)||0,
      cliente:v.cliente||'',telefono:v.telefono||'',guia:v.guia||'',empresa:v.empresa||'',
      transportadora:v.transportadora||'',ciudad:v.ciudad||'',direccion:v.direccion||'',
      cedulaCliente:v.cedula_cliente||'',
      liquidado:v.liquidado||false,fechaLiquidacion:v.fecha_liquidacion,
      esSeparado:v.es_separado||false,esContraEntrega:v.es_contraentrega||false,
      tipoPago:v.tipo_pago||'contado',
      estadoEntrega:v.estado_entrega||'Pendiente',
      fechaHoraEntrega:v.fecha_hora_entrega||null,
      desc:v.referencia||'',metodoPago:v.metodo_pago||'efectivo',archived:v.archived||false,
      comprobante:v.comprobante||'',
      invoiceId:v.invoice_id!=null&&String(v.invoice_id).trim()!==''?String(v.invoice_id):null,
      stockProductsPendingLines:Array.isArray(v.stock_products_pending)?v.stock_products_pending:[]}));

    // Facturas
    state.facturas = (facturas||[]).map(f=>{
      let itemsParsed = [];
      try {
        if(Array.isArray(f.items)) itemsParsed = f.items;
        else if(typeof f.items === 'string' && f.items.trim()) itemsParsed = JSON.parse(f.items);
      } catch(e) { itemsParsed = []; }
      return {
        id:f.id,numero:f.number||'',fecha:(f.fecha||f.created_at)?(f.fecha||f.created_at).split('T')[0]:today(),
        cliente:f.customer_name||'',telefono:f.customer_phone||'',
        subtotal:parseFloat(f.subtotal)||0,iva:parseFloat(f.iva)||0,flete:parseFloat(f.flete)||0,total:parseFloat(f.total)||0,
        items:(itemsParsed||[]).map(i=>{
          const aidFn = typeof window.articuloIdFromInvoiceItem === 'function' ? window.articuloIdFromInvoiceItem : null;
          const articuloId = (aidFn ? aidFn(i) : '') || String(i.articuloId ?? i.articulo_id ?? i.productId ?? i.product_id ?? i.id ?? '');
          return {
          articuloId,
          nombre:i.nombre||i.name||'',
          talla:i.talla||'',
          qty:parseFloat(i.qty||i.cantidad)||1,
          cantidad:parseFloat(i.cantidad||i.qty)||1,
          precio:parseFloat(i.precio||i.price)||0,
          price:parseFloat(i.price||i.precio)||0
        };
        }),
        metodo:f.metodo_pago||'efectivo',estado:f.estado||'pagada',tipo:f.tipo||'pos',
        canal:f.canal||'vitrina',guia:f.guia||'',empresa:f.empresa||'',transportadora:f.transportadora||'',ciudad:f.ciudad||'',
        direccion:f.direccion||'',cedulaCliente:f.cedula_cliente||'',
        comprobante:f.comprobante||'',
        esSeparado:!!f.es_separado,tipoPago:f.tipo_pago||'contado'
      };
    });

    state.ventasCatalogo = [];
    try {
      let vcRows = [];
      try {
        vcRows = await fetchAllRows('ventas_catalogo');
      } catch (e) {
        const { data: vc } = await supabaseClient.from('ventas_catalogo').select('*');
        vcRows = vc || [];
      }
      state.ventasCatalogo = (vcRows || []).map((r) => ({
        id: r.id,
        reference: r.reference || '',
        estadoPago: r.estado_pago || 'pendiente',
        canalPago: r.canal_pago || '',
        catalogType: r.catalog_type || '',
        origenCanal: r.origen_canal || 'catalogo_web',
        externalOrderId: r.external_order_id || '',
        trackingMeta: r.tracking_meta && typeof r.tracking_meta === 'object' ? r.tracking_meta : {},
        clienteNombre: r.cliente_nombre || '',
        clienteEmail: r.cliente_email || '',
        clienteTelefono: r.cliente_telefono || '',
        clienteDocumentoTipo: r.cliente_documento_tipo || 'CC',
        clienteDocumento: r.cliente_documento || '',
        envioDepartamento: r.envio_departamento || '',
        envioCiudad: r.envio_ciudad || '',
        envioDireccion: r.envio_direccion || '',
        items: Array.isArray(r.items) ? r.items : [],
        totales: r.totales && typeof r.totales === 'object' ? r.totales : {},
        amountCop: parseFloat(r.amount_cop) || 0,
        proveedorRef: r.proveedor_ref || '',
        posFacturaId: r.pos_factura_id || null,
        createdAt: r.created_at,
        pagadoAt: r.pagado_at,
      }));
    } catch (e) {
      console.warn('ventas_catalogo:', e.message);
      state.ventasCatalogo = [];
    }

    state.tes_abonos_prov = (abonosProv||[]).map(ab=>({id:ab.id,proveedorId:ab.proveedor_id,
      proveedorNombre:ab.proveedor_nombre||'',valor:parseFloat(ab.valor)||0,
      metodo:ab.metodo||'',fecha:ab.fecha,nota:ab.nota||'',fechaCreacion:ab.fecha_creacion||ab.fecha,
      fechaHora:ab.fecha_hora||null}));

    state.tes_libro_proveedor = [];
    try {
      const { data: libroRows, error: libroErr } = await supabaseClient.from('tes_libro_proveedor').select('*').order('fecha_hora', { ascending: false }).limit(8000);
      if (!libroErr && libroRows) {
        state.tes_libro_proveedor = libroRows.map((r) => ({
          id: r.id,
          proveedorId: r.proveedor_id,
          proveedorNombre: r.proveedor_nombre || '',
          tipo: r.tipo,
          articuloId: r.articulo_id,
          descripcion: r.descripcion || '',
          valor: parseFloat(r.valor) || 0,
          fechaHora: r.fecha_hora
        }));
      }
    } catch (e) {
      console.warn('tes_libro_proveedor:', e.message);
    }

    state.tes_devoluciones_prov = [];
    try {
      const { data: devRows, error: devErr } = await supabaseClient.from('tes_devoluciones_prov').select('*').order('fecha_hora', { ascending: false }).limit(8000);
      if (!devErr && devRows) {
        state.tes_devoluciones_prov = devRows.map((r) => ({
          id: r.id,
          proveedorId: r.proveedor_id,
          proveedorNombre: r.proveedor_nombre || '',
          articuloId: r.articulo_id,
          cantidad: parseFloat(r.cantidad) || 0,
          valorCosto: parseFloat(r.valor_costo) || 0,
          invAjusteId: r.inv_ajuste_id || null,
          nota: r.nota || '',
          fecha: r.fecha,
          fechaHora: r.fecha_hora
        }));
      }
    } catch (e) {
      console.warn('tes_devoluciones_prov:', e.message);
    }

    state.tes_ajustes_unidades_prov = [];
    try {
      const { data: ajRows, error: ajErr } = await supabaseClient
        .from('tes_ajustes_unidades_prov')
        .select('*')
        .order('fecha_hora', { ascending: false })
        .limit(8000);
      if (!ajErr && ajRows) {
        state.tes_ajustes_unidades_prov = ajRows.map((r) => ({
          id: r.id,
          proveedorId: r.proveedor_id,
          articuloId: r.articulo_id,
          deltaUnidades: parseFloat(r.delta_unidades) || 0,
          nota: r.nota || '',
          fechaHora: r.fecha_hora,
          proveedorNombre: r.proveedor_nombre || '',
          articuloNombre: r.articulo_nombre || ''
        }));
      }
    } catch (e) {
      console.warn('tes_ajustes_unidades_prov:', e.message);
    }

    state.tes_compromisos_prov = (compromisosProv || []).map((c) => {
      const lineasRaw = Array.isArray(c.lineas)
        ? c.lineas
        : c.meta && typeof c.meta === 'object' && Array.isArray(c.meta.lineas)
          ? c.meta.lineas
          : [];
      return {
        id: c.id,
        proveedorId: c.proveedor_id,
        proveedorNombre: c.proveedor_nombre || '',
        valor: parseFloat(c.valor) || 0,
        fecha: c.fecha,
        nota: c.nota || '',
        referencia: c.referencia || '',
        lineas: lineasRaw
      };
    });

    state.tes_cxp_movimientos = [];
    try {
      let cxpOff = 0;
      const CXP_PAGE = 1000;
      while (supabaseClient) {
        const { data: cxpRows, error: cxpErr } = await supabaseClient
          .from('tes_cxp_movimientos')
          .select('*')
          .order('fecha_hora', { ascending: false })
          .range(cxpOff, cxpOff + CXP_PAGE - 1);
        if (cxpErr) {
          console.warn('tes_cxp_movimientos:', cxpErr.message);
          break;
        }
        const chunk = cxpRows || [];
        chunk.forEach((r) => {
          const lineasRaw = Array.isArray(r.lineas)
            ? r.lineas
            : r.meta && typeof r.meta === 'object' && Array.isArray(r.meta.lineas)
              ? r.meta.lineas
              : [];
          state.tes_cxp_movimientos.push({
            id: r.id,
            proveedorId: r.proveedor_id,
            proveedorNombre: r.proveedor_nombre || '',
            tipo: r.tipo,
            naturaleza: r.naturaleza,
            monto: parseFloat(r.monto) || 0,
            fecha: r.fecha,
            referencia: r.referencia || '',
            nota: r.nota || '',
            meta: r.meta && typeof r.meta === 'object' ? r.meta : {},
            lineas: lineasRaw,
            fechaHora: r.fecha_hora
          });
        });
        if (chunk.length < CXP_PAGE) break;
        cxpOff += CXP_PAGE;
      }
    } catch (e) {
      console.warn('tes_cxp_movimientos:', e.message);
    }

    await loadStockMovesVentasIntoState();

    // Cargar configuraciones desde Supabase (si existen, sobreescriben los defaults)
    try {
      const cfgTables = ['cfg_categorias','cfg_secciones','cfg_transportadoras','cfg_metodos_pago','cfg_tarifas','cfg_impuestos'];
      const cfgResults = await Promise.all(cfgTables.map(t => supabaseClient.from(t).select('*').then(r => r.data||[])));
      cfgTables.forEach((t, i) => { if(cfgResults[i].length > 0) state[t] = cfgResults[i]; });
      // Bodegas override
      const {data: bds} = await supabaseClient.from('bodegas').select('*');
      if(bds && bds.length > 0) state.bodegas = bds.map(b=>({id:b.id,name:b.nombre,ubicacion:b.ubicacion||''}));
      // Nom conceptos override
      const {data: ncs} = await supabaseClient.from('nom_conceptos_cfg').select('*').limit(100);
      if(ncs && ncs.length > 0) state.nom_conceptos = ncs.map(c=>({id:c.id,nombre:c.nombre,tipo:c.tipo,formula:c.formula,valor:parseFloat(c.valor)||0}));
      // Game config
      const {data: gcfg} = await supabaseClient.from('state_config').select('value').eq('key','cfg_game').maybeSingle();
      if(gcfg?.value) state.cfg_game = {...state.cfg_game, ...(typeof gcfg.value==='string'?JSON.parse(gcfg.value):gcfg.value)};
    } catch(e) { console.warn('Config tables not yet created:', e.message); }

    // Bodegas y Cajas
    if(bodegas&&bodegas.length>0) state.bodegas=bodegas.map(b=>({id:b.id,name:b.nombre,ubicacion:b.ubicacion}));
    if(cajas&&cajas.length>0) {
      state.cajas=cajas.map(c=>({id:c.id,nombre:c.nombre,saldo:parseFloat(c.saldo)||0,estado:c.estado||'abierta',apertura:c.apertura,bodegaIds:c.bodega_ids,saldosMetodo:c.saldos_metodo,sesionActivaId:c.sesion_activa_id||null,proximaAperturaSaldos:c.proxima_apertura_saldos}));
      if(window.AppCajaLogic?.normalizeAllCajas) window.AppCajaLogic.normalizeAllCajas(state);
    }

    // Tesorería
    state.tes_movimientos = (tesMov||[]).map(m=>({id:m.id,cajaId:m.caja_id,tipo:m.tipo,valor:parseFloat(m.valor)||0,concepto:m.concepto||'',fecha:m.fecha,metodo:m.metodo||'efectivo',categoria:m.categoria||'',bucket:m.bucket||'',sesionId:m.sesion_id||null,refAbonoProvId:m.ref_abono_prov_id||null}));

    state.tes_cierres_caja = [];
    try {
      const cr = await supabaseClient.from('tes_cierres_caja').select('*').order('fecha_cierre', { ascending: false }).limit(400);
      if (!cr.error && cr.data) {
        state.tes_cierres_caja = cr.data.map((r) => ({
          id: r.id,
          cajaId: r.caja_id,
          cajaNombre: r.caja_nombre || '',
          fechaCierre: r.fecha_cierre,
          libroEfectivo: parseFloat(r.libro_efectivo) || 0,
          libroTransferencia: parseFloat(r.libro_transferencia) || 0,
          contadoEfectivo: parseFloat(r.contado_efectivo) || 0,
          declaradoBancos: parseFloat(r.declarado_bancos) || 0,
          difEfectivo: parseFloat(r.dif_efectivo) || 0,
          difTransferencia: parseFloat(r.dif_transferencia) || 0,
          resultadoEfectivo: r.resultado_efectivo || '',
          nota: r.nota || '',
          saldosLibroJson: r.saldos_libro_json
        }));
      }
    } catch (e) {
      console.warn('tes_cierres_caja:', e.message);
    }

    if (window.AppCajaLogic?.mergeLegacyCajaPrincipalDuplicate && window.AppCajaLogic?.remapLegacyCajaIdInCollections) {
      pendingLegacyCajaMerge = window.AppCajaLogic.mergeLegacyCajaPrincipalDuplicate(state);
      if (pendingLegacyCajaMerge.merged) {
        const canon = window.AppId?.CAJA_PRINCIPAL_ID || 'f7c2b8e0-4a1d-4f3e-9c8a-2b6e1d4a7f00';
        window.AppCajaLogic.remapLegacyCajaIdInCollections(state, canon);
        if (window.AppCajaLogic.normalizeAllCajas) window.AppCajaLogic.normalizeAllCajas(state);
      }
    }

    // Nómina
    state.nom_nominas = (nomNominas||[]).map(n=>({id:n.id,numero:n.numero,empleado:n.empleado_nombre,periodo:n.periodo,salario:parseFloat(n.salario_base)||0,devengado:parseFloat(n.devengado)||0,deducciones:parseFloat(n.deducciones)||0,neto:parseFloat(n.neto)||0,detalles:n.detalles||[],pagada:n.pagada||false,fecha:n.fecha}));
    state.nom_ausencias = (nomAusencias||[]).map(a=>({id:a.id,empleado:a.empleado_nombre,tipo:a.tipo,desde:a.desde,hasta:a.hasta,dias:a.dias||0,observaciones:a.observaciones||'',aprobada:a.aprobada||false}));
    state.nom_anticipos = (nomAnticipos||[]).map(a=>({id:a.id,empleado:a.empleado_nombre,valor:parseFloat(a.valor)||0,motivo:a.motivo||'',fecha:a.fecha}));

    // Inventario - reconstruir movimientos
    let invAjustesLotes = [];
    {
      const { data: lotesData, error: lotesErr } = await supabaseClient.from('inv_ajustes_lotes').select('*');
      if (lotesErr) console.warn('inv_ajustes_lotes:', lotesErr.message);
      else invAjustesLotes = lotesData || [];
    }
    state.inv_ajustes_lotes = (invAjustesLotes||[]).map(l=>({id:l.id,bodegaId:l.bodega_id,motivo:l.motivo||'',fecha:l.fecha}));
    state.inv_ajustes = (invAjustes||[]).map(a=>({id:a.id,articuloId:a.articulo_id,bodegaId:a.bodega_id,tipo:a.tipo,cantidad:a.cantidad,motivo:a.motivo||'',fecha:a.fecha,loteId:a.lote_id||null}));
    state.inv_traslados = (invTraslados||[]).map(t=>({id:t.id,articuloId:t.articulo_id,origenId:t.origen_id,destinoId:t.destino_id,cantidad:t.cantidad,nota:t.nota||'',fecha:t.fecha}));
    state.inv_movimientos = [];
    state.inv_ajustes.forEach(a=>{state.inv_movimientos.push({id:'aj_'+a.id,articuloId:a.articuloId,bodegaId:a.bodegaId||'bodega_main',cantidad:(a.tipo==='entrada'||a.tipo==='devolucion')?a.cantidad:-a.cantidad,tipo:'ajuste_'+a.tipo,fecha:a.fecha,referencia:'Ajuste',nota:a.motivo})});
    state.inv_traslados.forEach(t=>{state.inv_movimientos.push({id:'tr_o_'+t.id,articuloId:t.articuloId,bodegaId:t.origenId,cantidad:-t.cantidad,tipo:'traslado_salida',fecha:t.fecha,referencia:'Traslado',nota:t.nota},{id:'tr_i_'+t.id,articuloId:t.articuloId,bodegaId:t.destinoId,cantidad:t.cantidad,tipo:'traslado_entrada',fecha:t.fecha,referencia:'Traslado',nota:t.nota})});

    // Configuración
    (configs||[]).forEach(c=>{
      try {
        const val=typeof c.value==='string'?JSON.parse(c.value):c.value;
        if(c.key==='empresa')state.empresa=val;
        else if(c.key==='meta')state.meta=parseFloat(val)||34000000;
        else if(c.key==='diasLocal')state.diasLocal=parseInt(val)||1;
        else if(c.key==='diasInter')state.diasInter=parseInt(val)||5;
        else if(c.key==='game')state.game=val;
        else if(c.key==='consecutivos')state.consecutivos=val;
      } catch(e){}
    });

    _sbConnected = true;
    if (pendingLegacyCajaMerge && pendingLegacyCajaMerge.merged && pendingLegacyCajaMerge.canonical && supabaseClient) {
      try {
        const cid = pendingLegacyCajaMerge.canonical.id;
        await saveRecord('cajas', cid, pendingLegacyCajaMerge.canonical);
        const { error: em } = await supabaseClient.from('tes_movimientos').update({ caja_id: cid }).eq('caja_id', 'caja_principal');
        if (em) console.warn('[cajas] remap tes_movimientos caja_id:', em.message);
        const { error: ec } = await supabaseClient.from('tes_cierres_caja').update({ caja_id: cid }).eq('caja_id', 'caja_principal');
        if (ec) console.warn('[cajas] remap tes_cierres_caja caja_id:', ec.message);
        const delOk = await deleteRecord('cajas', 'caja_principal');
        if (!delOk) console.warn('[cajas] no se pudo borrar fila legada caja_principal (revisa tipo de columna id / RLS).');
      } catch (e) {
        console.warn('[cajas] consolidación legada en BD:', e?.message || e);
      }
    }
    ['fb-status-dot','fb-status-dot-mobile'].forEach(id=>{const el=document.getElementById(id);if(el){el.style.background='#22c55e';el.title='Conectado a Supabase';}});
    checkMonthReset();
    try { window.AppSyncGuard?.markAllSynced?.(); } catch (e) {}
    showLoadingOverlay('hide');
    renderAll();
    if(isFirstLoad){isFirstLoad=false;notify('success','☁️','¡Conectado!',`${(products||[]).length} artículos · ${(ventas||[]).length} ventas.`,{duration:3000});}

  } catch(error) {
    const errMsg = error?.message || error?.error_description || (typeof error === 'string' ? error : JSON.stringify(error));
    console.error("Error cargando BD:", errMsg, error);
    _sbConnected = false;
    ['fb-status-dot','fb-status-dot-mobile'].forEach(id=>{const el=document.getElementById(id);if(el){el.style.background='#f87171';el.title='Sin conexión: '+errMsg;}});
    showLoadingOverlay('hide');
    renderAll();
    notify('warning','📡','Error BD',errMsg,{duration:8000});
  }
}
function saveState(){ /* Supabase handles persistence */ }

// Guarda un registro individual sin sobreescribir todo el estado (Seguridad Multi-Usuario)
// Mapa de colecciones a tablas Supabase
const COLLECTION_MAP = {
  'ventas':          { table:'ventas', mapFn:(d)=>({id:d.id,fecha:d.fecha,canal:d.canal,valor:d.valor,cliente:d.cliente||'',telefono:d.telefono||'',guia:d.guia||'',empresa:d.empresa||'',transportadora:d.transportadora||'',ciudad:d.ciudad||'',direccion:d.direccion||'',cedula_cliente:d.cedulaCliente||'',comprobante:d.comprobante||'',liquidado:d.liquidado||false,fecha_liquidacion:d.fechaLiquidacion||null,es_separado:d.esSeparado||false,es_contraentrega:d.esContraEntrega||false,tipo_pago:d.tipoPago||'contado',estado_entrega:d.estadoEntrega||'Pendiente',fecha_hora_entrega:d.fechaHoraEntrega!=null?d.fechaHoraEntrega:null,referencia:d.desc||'',metodo_pago:d.metodoPago||'efectivo',archived:d.archived||false,stock_products_pending:Array.isArray(d.stockProductsPendingLines)?d.stockProductsPendingLines:[],invoice_id:d.invoiceId!=null&&String(d.invoiceId).trim()!==''?String(d.invoiceId).trim():null}) },
  'facturas':        { table:'invoices', mapFn:(d)=>({
    id:d.id,number:d.numero||'',customer_name:d.cliente||'',customer_phone:d.telefono||'',
    total:d.total||0,subtotal:d.subtotal||0,iva:d.iva||0,flete:d.flete||0,fecha:d.fecha||today(),
    canal:d.canal||'vitrina',metodo_pago:d.metodo||d.metodoPago||'efectivo',estado:d.estado||'pagada',tipo:d.tipo||'pos',
    guia:d.guia||'',empresa:d.empresa||'',transportadora:d.transportadora||'',ciudad:d.ciudad||'',
    direccion:d.direccion||'',cedula_cliente:d.cedulaCliente||'',
    comprobante:d.comprobante||'',
    es_separado:!!d.esSeparado,tipo_pago:d.tipoPago||'contado',
    items:(()=>{
      let raw=d.items;
      if(typeof raw==='string'&&raw.trim()){
        try{raw=JSON.parse(raw);}catch(_){raw=[];}
      }
      if(!Array.isArray(raw))raw=[];
      return raw.map(i=>({id:i.articuloId||i.articulo_id||'',nombre:i.nombre||i.name||'',talla:i.talla||'',qty:i.qty||i.cantidad||1,precio:i.precio||i.price||0}));
    })()
  }) },
  'cajas':           { table:'cajas', mapFn:(d)=>{
    if(window.AppCajaLogic?.normalizeCaja) window.AppCajaLogic.normalizeCaja(d);
    const saldoEf = window.AppCajaLogic?.cajaToRowSaldo ? window.AppCajaLogic.cajaToRowSaldo(d) : (parseFloat(d.saldo)||0);
    const row = { id:d.id,nombre:d.nombre||'',saldo:saldoEf,estado:d.estado||'abierta',apertura:d.apertura||null };
    row.bodega_ids = d.bodegaIds || [];
    row.saldos_metodo = d.saldosMetodo || {};
    row.sesion_activa_id = d.sesionActivaId || null;
    row.proxima_apertura_saldos = d.proximaAperturaSaldos && typeof d.proximaAperturaSaldos === 'object' ? d.proximaAperturaSaldos : {};
    return row;
  }},
  'tes_movimientos': { table:'tes_movimientos', mapFn:(d)=>({id:d.id,caja_id:d.cajaId||null,tipo:d.tipo||'',valor:d.valor||0,concepto:d.concepto||'',fecha:d.fecha||null,metodo:d.metodo||'efectivo',categoria:d.categoria||null,bucket:d.bucket||null,sesion_id:d.sesionId||null,ref_abono_prov_id:d.refAbonoProvId!=null&&d.refAbonoProvId!==''?d.refAbonoProvId:null}) },
  'tes_cierres_caja': { table:'tes_cierres_caja', mapFn:(d)=>({
    id:d.id,caja_id:d.cajaId,caja_nombre:d.cajaNombre||'',
    fecha_cierre:d.fechaCierre||today(),
    libro_efectivo:d.libroEfectivo||0,libro_transferencia:d.libroTransferencia||0,
    contado_efectivo:d.contadoEfectivo||0,declarado_bancos:d.declaradoBancos||0,
    dif_efectivo:d.difEfectivo||0,dif_transferencia:d.difTransferencia||0,
    resultado_efectivo:d.resultadoEfectivo||'',nota:d.nota||'',
    saldos_libro_json:d.saldosLibroJson||d.saldos_libro_json||null
  }) },
  'nom_nominas':     { table:'nom_nominas', mapFn:(d)=>({id:d.id,numero:d.numero||'',empleado_nombre:d.empleado||'',periodo:d.periodo||'',salario_base:d.salario||0,devengado:d.devengado||0,deducciones:d.deducciones||0,neto:d.neto||0,detalles:d.detalles||[],pagada:d.pagada||false,fecha:d.fecha||null}) },
  'nom_ausencias':   { table:'nom_ausencias', mapFn:(d)=>({id:d.id,empleado_nombre:d.empleado||'',tipo:d.tipo||'',desde:d.desde||null,hasta:d.hasta||null,dias:d.dias||0,observaciones:d.observaciones||'',aprobada:d.aprobada||false,fecha:d.fecha||null}) },
  'nom_anticipos':   { table:'nom_anticipos', mapFn:(d)=>({id:d.id,empleado_nombre:d.empleado||'',valor:d.valor||0,motivo:d.motivo||'',fecha:d.fecha||null}) },
  'inv_ajustes':     { table:'inv_ajustes', mapFn:(d)=>({id:d.id,articulo_id:d.articuloId||null,bodega_id:d.bodegaId||null,tipo:d.tipo||'',cantidad:d.cantidad||0,motivo:d.motivo||'',fecha:d.fecha||null,lote_id:d.loteId||null}) },
  'inv_ajustes_lotes': { table:'inv_ajustes_lotes', mapFn:(d)=>({id:d.id,bodega_id:d.bodegaId||'bodega_main',motivo:d.motivo||'',fecha:d.fecha||null}) },
  'inv_traslados':   { table:'inv_traslados', mapFn:(d)=>({id:d.id,articulo_id:d.articuloId||null,origen_id:d.origenId||null,destino_id:d.destinoId||null,cantidad:d.cantidad||0,nota:d.nota||'',fecha:d.fecha||null}) },
  'tes_ajustes_unidades_prov': { table:'tes_ajustes_unidades_prov', mapFn:(d)=>({id:d.id,proveedor_id:d.proveedorId,articulo_id:d.articuloId||null,delta_unidades:parseFloat(d.deltaUnidades)||0,nota:d.nota||'',fecha_hora:d.fechaHora||new Date().toISOString(),proveedor_nombre:d.proveedorNombre||null,articulo_nombre:d.articuloNombre||null}) },
  'tes_cxp_movimientos': { table:'tes_cxp_movimientos', mapFn:(d)=>({id:d.id,proveedor_id:d.proveedorId,proveedor_nombre:d.proveedorNombre||'',tipo:d.tipo||'cargo_compra',naturaleza:d.naturaleza||'cargo',monto:parseFloat(d.monto)||0,fecha:d.fecha||null,referencia:d.referencia||null,nota:d.nota||null,meta:(d.meta&&typeof d.meta==='object')?d.meta:{},lineas:Array.isArray(d.lineas)?d.lineas:[],fecha_hora:d.fechaHora||new Date().toISOString()}) },
  'ventas_catalogo': { table:'ventas_catalogo', mapFn:(d)=>({id:d.id,reference:d.reference||'',estado_pago:d.estadoPago||'pendiente',canal_pago:d.canalPago||null,catalog_type:d.catalogType||null,origen_canal:d.origenCanal||'catalogo_web',external_order_id:d.externalOrderId||null,tracking_meta:(d.trackingMeta&&typeof d.trackingMeta==='object')?d.trackingMeta:{},cliente_nombre:d.clienteNombre||'',cliente_email:d.clienteEmail||'',cliente_telefono:d.clienteTelefono||'',cliente_documento_tipo:d.clienteDocumentoTipo||'CC',cliente_documento:d.clienteDocumento||'',envio_departamento:d.envioDepartamento||'',envio_ciudad:d.envioCiudad||'',envio_direccion:d.envioDireccion||'',items:Array.isArray(d.items)?d.items:[],totales:(d.totales&&typeof d.totales==='object')?d.totales:{},amount_cop:Number(d.amountCop)||0,proveedor_ref:d.proveedorRef||null,pagado_at:d.pagadoAt||null,pos_factura_id:d.posFacturaId||null}) },
  'empleados':       { table:'employees', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo_contrato:d.tipoContrato||d.tipo_contrato||'indefinido',salario_base:parseFloat(d.salarioBase||d.salario_base)||0,cedula:d.cedula||null,celular:d.celular||null,cargo:d.cargo||'',fecha_ingreso:d.fechaIngreso||d.fecha_ingreso||null}) },
  'usu_empleados':   { table:'employees', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo_contrato:d.tipoContrato||d.tipo_contrato||'indefinido',salario_base:parseFloat(d.salarioBase||d.salario_base)||0,cedula:d.cedula||null,celular:d.celular||null,cargo:d.cargo||'',fecha_ingreso:d.fechaIngreso||d.fecha_ingreso||null}) },
  'usu_clientes':    { table:'customers', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',cedula:d.cedula||null,celular:d.celular||null,telefono:d.telefono||null,whatsapp:d.whatsapp||null,ciudad:d.ciudad||null,direccion:d.direccion||null}) },
  'usu_proveedores': { table:'proveedores', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',cedula:d.cedula||'',tipo_id:d.tipoId||'NIT',celular:d.celular||'',whatsapp:d.whatsapp||'',email:d.email||'',ciudad:d.ciudad||'',departamento:d.departamento||'',direccion:d.direccion||'',tipo_persona:d.tipoPersona||'Natural',observacion:d.observacion||''}) },
  'cfg_categorias':      { table:'cfg_categorias', mapFn:(d)=>({id:d.id,seccion:d.seccion||'',nombre:d.nombre||''}) },
  'cfg_secciones':       { table:'cfg_secciones', mapFn:(d)=>({id:d.id,nombre:d.nombre||''}) },
  'cfg_transportadoras': { table:'cfg_transportadoras', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',activa:d.activa!==false}) },
  'cfg_metodos_pago':    { table:'cfg_metodos_pago', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo:d.tipo||'',activo:d.activo!==false}) },
  'cfg_tarifas':         { table:'cfg_tarifas', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',porcentaje:d.porcentaje||0,descripcion:d.descripcion||''}) },
  'cfg_impuestos':       { table:'cfg_impuestos', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',porcentaje:d.porcentaje||0,tipo:d.tipo||'',activo:d.activo!==false}) },
  'nom_conceptos':       { table:'nom_conceptos_cfg', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo:d.tipo||'devengo',formula:d.formula||'fijo',valor:parseFloat(d.valor)||0}) },
  'nom_conceptos_cfg':   { table:'nom_conceptos_cfg', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo:d.tipo||'devengo',formula:d.formula||'fijo',valor:parseFloat(d.valor)||0}) },
  'bodegas':             { table:'bodegas', mapFn:(d)=>({id:d.id,nombre:d.name||d.nombre||'',ubicacion:d.ubicacion||''}) },
  'bodegas_cfg':         { table:'bodegas', mapFn:(d)=>({id:d.id,nombre:d.name||d.nombre||'',ubicacion:d.ubicacion||''}) }
};

async function saveRecord(collection, id, data) {
  const mapping = COLLECTION_MAP[collection];
  if(!mapping || !_sbConnected) return false;
  try {
    const row = mapping.mapFn(data);
    if (window.AppId?.isUuid && row.id != null && String(row.id) !== '' && !window.AppId.isUuid(String(row.id))) {
      console.warn('[saveRecord] ID no parece UUID v4 — puede rechazarse en Supabase:', collection, mapping.table, row.id);
    }
    const { error } = await supabaseClient.from(mapping.table).upsert(row, {onConflict:'id'});
    if (error) throw error;
    return true;
  } catch(e) {
    console.warn(`saveRecord [${collection}]:`, e.message);
    return false;
  }
}

async function deleteRecord(collection, id) {
  const mapping = COLLECTION_MAP[collection];
  if(!mapping || !_sbConnected) return false;
  try {
    const { error } = await supabaseClient.from(mapping.table).delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch(e) {
    console.warn(`deleteRecord [${collection}]:`, e.message);
    return false;
  }
}

async function saveConfig(key, value) {
  if(!_sbConnected) return false;
  try {
    const { error } = await supabaseClient
      .from('state_config')
      .upsert({key, value, updated_at:new Date().toISOString()},{onConflict:'key'});
    if (error) throw error;
    return true;
  }
  catch(e) {
    console.warn('saveConfig:', e.message);
    return false;
  }
}

function checkMonthReset(){const now=new Date();const ym=now.getFullYear()+'-'+now.getMonth();if(state.currentMonth&&state.currentMonth!==ym){state.ventas=state.ventas.map(v=>({...v,archived:true}));notify('milestone','🌙','¡Nuevo Mes!','Ventas archivadas.',{duration:6000})}state.currentMonth=ym}

function renderAll(){
  renderDashboard();
  updateNavBadges();
  document.querySelectorAll('.page.active').forEach(p=>{
    const id=p.id.replace('page-','');
    renderPage(id);
  });
}

// ===== LOADING =====
function showLoadingOverlay(st){
  if(!document.getElementById('fb-spin-style')){const s=document.createElement('style');s.id='fb-spin-style';s.textContent='@keyframes fbspin{from{transform:rotate(0)}to{transform:rotate(360deg)}}@keyframes fbslide{0%{margin-left:-40%}100%{margin-left:100%}}';document.head.appendChild(s)}
  let ov=document.getElementById('supabase-loading');
  if(!ov){ov=document.createElement('div');ov.id='supabase-loading';ov.style.cssText='position:fixed;inset:0;background:rgba(10,15,30,.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;backdrop-filter:blur(6px);transition:opacity .35s;padding:32px;text-align:center';document.body.appendChild(ov)}
  if(st==='hide'){ov.style.opacity='0';setTimeout(()=>{ov.style.display='none'},380);return}
  ov.style.display='flex';setTimeout(()=>ov.style.opacity='1',10);
  if(st==='connecting')ov.innerHTML='<div style="font-size:52px;animation:fbspin 1.2s linear infinite">☁️</div><div style="font-family:Syne;font-size:18px;font-weight:800;color:#00e5b4;margin-top:18px">Conectando...</div><div style="margin-top:20px;width:200px;height:4px;background:rgba(255,255,255,.1);border-radius:99px;overflow:hidden"><div style="height:100%;width:40%;background:#00e5b4;border-radius:99px;animation:fbslide 1.4s ease-in-out infinite"></div></div>';
  if(st==='error')ov.innerHTML='<div style="font-size:52px">📡</div><div style="font-family:Syne;font-size:20px;font-weight:800;color:#f87171;margin-top:16px">Sin conexión</div><button onclick="location.reload()" style="margin-top:24px;background:linear-gradient(135deg,#00e5b4,#00c4ff);color:#0a0f1e;border:none;border-radius:12px;padding:14px 32px;font-family:Syne;font-size:15px;font-weight:800;cursor:pointer">🔄 Reintentar</button>';
}

// ===== NAVIGATION =====
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+id)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>{if(n.getAttribute('onclick')?.includes("'"+id+"'"))n.classList.add('active')});
  renderPage(id);
  requestCriticalReconcileAfterNav(id);
  if(window.innerWidth<=768)closeSidebar();
  document.getElementById('main').scrollTop=0;
}

function renderPage(id){
  const renderers={
    dashboard:renderDashboard, pos:renderPOS, ventas_catalogo:renderVentasCatalogo, cotizaciones:renderCotizaciones,
    ordenes:renderOrdenes, facturas:renderFacturas, notas_credito:renderNotasCredito,
    notas_debito:renderNotasDebito, remisiones:renderRemisiones, devoluciones:renderDevoluciones,
    anticipos_clientes:renderAnticiposClientes, pendientes:renderPendientes, ingresos_egresos:renderIngresosEgresosPage, logistica:renderLogistica, usu_clientes:renderUsuClientes, usu_empleados:renderUsuEmpleados, usu_proveedores:renderUsuProveedores,
    articulos:renderArticulos, inv_trazabilidad:renderInvTrazabilidad,
    inv_ajustes:renderInvAjustes, inv_traslados:renderInvTraslados,
    nom_ausencias:renderNomAusencias, nom_anticipos:renderNomAnticipos,
    nom_conceptos:renderNomConceptos, nom_nominas:renderNomNominas,
    tes_cajas:renderTesCajas, tes_pagos_prov:renderTesPagosProv, tes_dinero:renderTesDinero,
    tes_impuestos:renderTesImpuestos, tes_retenciones:renderTesRetenciones,
    tes_comp_retencion:renderTesCompRetencion, tes_comp_ingreso:renderTesCompIngreso,
    tes_comp_egreso:renderTesCompEgreso, tes_transferencias:renderTesTransferencias,
    juego:renderGamePage, recompensas:renderRewards,
    alertas:renderAlertas, historial:renderHistorial, config:renderConfig, separados:renderSeparados
  };
  if(renderers[id])renderers[id]();
}

function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('sidebar-overlay').classList.toggle('active')}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('sidebar-overlay').classList.remove('active')}

function updateNavBadges(){
  const pend=(state.ventas||[]).filter(v=>ventaCuentaParaTotales(v)&&v.canal!=='vitrina'&&!v.liquidado);
  const pb=document.getElementById('badge-pendientes');
  if(pb){pb.textContent=pend.length;pb.style.display=pend.length>0?'inline-block':'none'}
  const alerts=buildAlerts();
  const ab=document.getElementById('badge-alertas');
  if(ab){ab.textContent=alerts.length;ab.style.display=alerts.length>0?'inline-block':'none'}
}

// ===== MODAL =====
function openModal(html,isLg){
  document.getElementById('modal-content').innerHTML=html;
  document.getElementById('modal-content').className='modal'+(isLg?' modal-lg':'');
  document.getElementById('modal-overlay').classList.add('active');
  // Ensure there's always an X button visible
  const mc = document.getElementById('modal-content');
  if(mc && !mc.querySelector('.modal-close')) {
    const x = document.createElement('button');
    x.className = 'modal-close'; x.textContent = '×'; x.title = 'Cerrar (ESC)';
    x.onclick = closeModal;
    mc.insertBefore(x, mc.firstChild);
  }
  setTimeout(function(){
    if(document.getElementById('cc-caja-id') && typeof recalcCierreArqueo === 'function') recalcCierreArqueo();
  }, 0);
}
function closeModal(){document.getElementById('modal-overlay').classList.remove('active')}
// Click fuera del modal NO cierra (solo ESC o botón ×)
document.getElementById('modal-overlay').addEventListener('mousedown', function(e){
  window._modalMousedownTarget = e.target.id === 'modal-overlay' ? 'modal-overlay' : 'inner';
});
document.getElementById('modal-overlay').addEventListener('touchstart', function(e){
  window._modalMousedownTarget = e.target.id === 'modal-overlay' ? 'modal-overlay' : 'inner';
}, {passive:true});

// ESC key closes any open modal
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape') {
    // Close main modal
    if(document.getElementById('modal-overlay')?.classList.contains('active')) { closeModal(); return; }
    // Close celebration
    if(document.getElementById('celebration-overlay')?.classList.contains('active')) { closeCelebration(); return; }
  }
});

// ===== NOTIFICATIONS =====
function notify(type,icon,title,body,opts={}){
  const container=document.getElementById('notif-container');
  const toast=document.createElement('div');
  toast.className=`notif-toast ${type}`;
  toast.innerHTML=`<div class="notif-icon">${icon}</div><div style="flex:1"><div class="notif-title">${title}</div><div class="notif-body">${body}</div></div><div class="notif-close" onclick="this.parentElement.remove()">×</div>`;
  container.appendChild(toast);
  setTimeout(()=>{toast.style.animation='toastOut .3s ease forwards';setTimeout(()=>toast.remove(),300)},opts.duration||5000);
}
function screenFlash(color){const flash=document.getElementById('screen-flash');const colors={green:'rgba(74,222,128,.15)',red:'rgba(248,113,113,.2)',gold:'rgba(245,158,11,.2)'};flash.style.background=colors[color]||colors.green;flash.style.opacity='1';setTimeout(()=>{flash.style.opacity='0'},300)}
function spawnConfetti(){const colors=['#00e5b4','#00c4ff','#f59e0b','#f87171','#a78bfa','#4ade80'];for(let i=0;i<30;i++){const c=document.createElement('div');c.className='confetti-piece';c.style.cssText=`left:${Math.random()*100}vw;background:${colors[Math.floor(Math.random()*colors.length)]};animation-duration:${1.5+Math.random()*1.5}s;animation-delay:${Math.random()*.5}s;transform:rotate(${Math.random()*360}deg);width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;border-radius:${Math.random()>0.5?'50%':'2px'}`;document.body.appendChild(c);setTimeout(()=>c.remove(),3500)}}
function showCelebration(emoji,title,sub){document.getElementById('cel-emoji').textContent=emoji;document.getElementById('cel-title').textContent=title;document.getElementById('cel-sub').textContent=sub;document.getElementById('celebration-overlay').classList.add('active');spawnConfetti()}
function closeCelebration(){document.getElementById('celebration-overlay').classList.remove('active')}

// ===== XP & BADGES =====
function awardXP(xp){
  if(!state.game)state.game={xp:0,streakMax:0,earnedBadges:[],claimedSnacks:{}};
  const oldLv=calcLevel(state.game.xp||0).level;
  state.game.xp=(state.game.xp||0)+xp;
  const newLv=calcLevel(state.game.xp).level;
  if(newLv>oldLv){const lv=calcLevel(state.game.xp);showCelebration(lv.avatar,'¡SUBISTE DE NIVEL!','¡Ahora eres '+lv.name+'!');screenFlash('green');if(newLv>=5)checkAndAwardBadge('nivel5');if(newLv>=8)checkAndAwardBadge('nivel8')}
  const streak=calcStreak();if(streak>(state.game.streakMax||0))state.game.streakMax=streak;
  if(streak>=3)checkAndAwardBadge('racha3');if(streak>=7)checkAndAwardBadge('racha7');if(streak>=14)checkAndAwardBadge('racha14');
}
function checkAndAwardBadge(id){if(!state.game.earnedBadges)state.game.earnedBadges=[];if(state.game.earnedBadges.includes(id))return;const badge=BADGES.find(b=>b.id===id);if(!badge)return;state.game.earnedBadges.push(id);notify('milestone',badge.icon,'¡Insignia: '+badge.name+'!',badge.desc,{duration:5000})}
function checkBadges(){const active=(state.ventas||[]).filter(v=>ventaCuentaParaTotales(v));const despachos=active.filter(v=>v.canal!=='vitrina');const vm=ventasMes(state);const pct=vm.totalCOP/state.meta;if(active.length>=1)checkAndAwardBadge('primera_venta');if(despachos.length>=20)checkAndAwardBadge('v20');if(despachos.length>=50)checkAndAwardBadge('v50');if(despachos.length>=100)checkAndAwardBadge('v100');if(despachos.length>=150)checkAndAwardBadge('v150');if(pct>=0.25)checkAndAwardBadge('meta25');if(pct>=0.50)checkAndAwardBadge('meta50');if(pct>=0.75)checkAndAwardBadge('meta75');if(pct>=1.00)checkAndAwardBadge('meta100');if(vm.totalCOP>=40000000)checkAndAwardBadge('super');if(active.some(v=>(parseFloat(v.valor)||0)>=500000))checkAndAwardBadge('gran_venta');const hoy=today();const todayCanals=new Set(active.filter(v=>v.fecha===hoy).map(v=>v.canal));if(todayCanals.has('vitrina')&&todayCanals.has('local')&&todayCanals.has('inter'))checkAndAwardBadge('multicanal')}

// ===================================================================
// ===== DASHBOARD =====
// ===================================================================
function renderDashboard(){
  const vm=ventasMes(state);
  const pct=Math.min(100,(vm.totalCOP/state.meta)*100);
  const g=state.game||{};
  const lv=calcLevel(g.xp||0);
  const{lv:lvp,next:nextLv,pct:xpPct,xpToNext}=calcLevelProgress(g.xp||0);
  const streak=calcStreak();
  const hoy=today();
  const ventasHoy=(state.ventas||[]).filter(v=>ventaCuentaParaTotales(v)&&v.fecha===hoy&&v.canal!=='vitrina');
  const pendientes=(state.ventas||[]).filter(v=>ventaCuentaParaTotales(v)&&v.canal!=='vitrina'&&!v.liquidado).length;
  const totalArticulos=(state.articulos||[]).length;
  const lowStockItems=(state.articulos||[]).filter(a=>{const stock=getArticuloStock(a.id);return stock<=a.stockMinimo}).length;
  const cajaSaldo=(state.cajas||[]).reduce((a,c)=>a+c.saldo,0);
  const earnedBadges=(g.earnedBadges||[]);
  const ymActual=yearMonthFromFecha(hoy);
  const ventasActivasNoArch=(state.ventas||[]).filter(v=>ventaCuentaParaTotales(v));
  const facturasHoyLista=sortVentasRecientes(ventasActivasNoArch.filter(v=>v.fecha===hoy));
  const facturasMesOtrasFechas=sortVentasRecientes(ventasActivasNoArch.filter(v=>yearMonthFromFecha(v.fecha)===ymActual&&v.fecha!==hoy)).slice(0,8);
  const resumenMesCal=ventasEnMesCalendario(state.ventas,ymActual);
  const totalMesCal=resumenMesCal.reduce((a,v)=>a+(parseFloat(v.valor)||0),0);

  const sumValor=(arr)=>arr.reduce((a,v)=>a+(parseFloat(v.valor)||0),0);
  const hoyVentas=ventasActivasNoArch.filter(v=>v.fecha===hoy);
  const hoyVitrina=hoyVentas.filter(v=>v.canal==='vitrina');
  const hoyVitrinaMostrador=hoyVitrina.filter(v=>!v.esSeparado);
  const hoyVitrinaSeparados=hoyVitrina.filter(v=>v.esSeparado);
  const hoyLocal=hoyVentas.filter(v=>v.canal==='local');
  const hoyInter=hoyVentas.filter(v=>v.canal==='inter');

  const despachoHoy=ventasHoy.length;
  const missions=[
    {id:'m1',icon:'⚔️',label:'5 despachos hoy (sin vitrina)',cur:Math.min(5,despachoHoy),max:5,xp:50},
    {id:'m2',icon:'🛡️',label:'Meta 25% mes',cur:Math.min(100,Math.round(pct)),max:100,xp:100,pctTarget:25,done:pct>=25},
    {id:'m3',icon:'🔥',label:'Racha '+streak+' días',cur:Math.min(7,streak),max:7,xp:75},
    {id:'m4',icon:'💰',label:'Venta > $300k',cur:(state.ventas||[]).filter(v=>ventaCuentaParaTotales(v)&&v.fecha===hoy&&v.valor>=300000).length>0?1:0,max:1,xp:60},
  ];

  document.getElementById('dashboard-content').innerHTML=`
  <style>
    .rpg-header{background:linear-gradient(135deg,rgba(0,229,180,.07) 0%,rgba(0,196,255,.04) 50%,rgba(167,139,250,.07) 100%);border:1px solid rgba(0,229,180,.15);border-radius:20px;padding:20px;margin-bottom:16px;position:relative;overflow:hidden}
    .rpg-header::before{content:'';position:absolute;top:-40px;right:-40px;width:180px;height:180px;background:radial-gradient(circle,rgba(0,229,180,.12) 0%,transparent 70%);pointer-events:none}
    .rpg-avatar{font-size:52px;filter:drop-shadow(0 0 16px rgba(0,229,180,.5));animation:float 3s ease-in-out infinite}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
    .xp-bar-wrap{background:rgba(255,255,255,.06);border-radius:20px;height:10px;overflow:hidden;margin:6px 0}
    .xp-bar-fill{height:100%;border-radius:20px;background:linear-gradient(90deg,#00e5b4,#00c4ff);transition:width 1s ease;box-shadow:0 0 10px rgba(0,229,180,.6)}
    .meta-bar-wrap{background:rgba(255,255,255,.06);border-radius:20px;height:14px;overflow:hidden;margin:8px 0;position:relative}
    .meta-bar-fill{height:100%;border-radius:20px;transition:width 1.2s ease;position:relative}
    .meta-bar-fill::after{content:'';position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);animation:shimmer 2s infinite}
    @keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
    .rpg-stat{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:14px;text-align:center;cursor:default;transition:all .2s}
    .rpg-stat:hover{background:rgba(0,229,180,.06);border-color:rgba(0,229,180,.2);transform:translateY(-2px)}
    .rpg-stat-val{font-family:Syne;font-size:26px;font-weight:800;line-height:1}
    .rpg-stat-label{font-size:10px;color:var(--text2);margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
    .mission-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:14px;display:flex;align-items:center;gap:12px;transition:all .2s}
    .mission-card.done{background:rgba(0,229,180,.06);border-color:rgba(0,229,180,.25)}
    .mission-bar{background:rgba(255,255,255,.06);border-radius:10px;height:6px;flex:1;overflow:hidden}
    .mission-bar-fill{height:100%;border-radius:10px;background:linear-gradient(90deg,#00e5b4,#00c4ff);transition:width .8s ease}
    .badge-rpg{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px 8px;text-align:center;transition:all .2s}
    .badge-rpg.earned{background:rgba(0,229,180,.08);border-color:rgba(0,229,180,.3);box-shadow:0 0 12px rgba(0,229,180,.1)}
    .badge-rpg:not(.earned){opacity:.35;filter:grayscale(1)}
    .quick-rpg{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px 10px;text-align:center;cursor:pointer;transition:all .2s;flex:1}
    .quick-rpg:hover{background:rgba(0,229,180,.08);border-color:rgba(0,229,180,.3);transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,229,180,.15)}
    .quick-rpg-icon{font-size:26px;margin-bottom:6px}
    .quick-rpg-label{font-size:10px;font-family:Syne;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px}
    .pend-glow{box-shadow:0 0 20px rgba(255,80,80,.2)}
    .meta-sum-grid{display:flex;flex-direction:column;gap:8px;margin-top:14px}
    .meta-sum-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px}
    .meta-sum-val{font-family:Syne;font-size:18px;font-weight:800;color:var(--accent);flex-shrink:0;min-width:7.5em;text-align:right}
    .meta-sum-body{flex:1;min-width:0}
    .meta-sum-title{font-size:12px;font-weight:700;color:var(--text);line-height:1.25}
    .meta-sum-sub{font-size:10px;color:var(--text2);margin-top:2px}
  </style>

  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    <div class="quick-rpg" onclick="showPage('pos')"><div class="quick-rpg-icon">⚔️</div><div class="quick-rpg-label">Nueva Venta</div></div>
    <div class="quick-rpg" onclick="showPage('facturas')"><div class="quick-rpg-icon">📜</div><div class="quick-rpg-label">Factura</div></div>
    <div class="quick-rpg" onclick="showPage('articulos')"><div class="quick-rpg-icon">🗡️</div><div class="quick-rpg-label">Catálogo</div></div>
    <div class="quick-rpg" onclick="showPage('tes_cajas')"><div class="quick-rpg-icon">💰</div><div class="quick-rpg-label">Cajas</div></div>
    <div class="quick-rpg" onclick="showPage('nom_nominas')"><div class="quick-rpg-icon">👥</div><div class="quick-rpg-label">Nómina</div></div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 280px;gap:16px;margin-bottom:16px">
    <div class="rpg-header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-size:10px;color:var(--text2);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">⚔️ Meta mensual</div>
          <div style="font-family:Syne;font-size:22px;font-weight:800">${fmt(vm.totalCOP)} <span style="font-size:13px;color:var(--text2);font-weight:400">de ${fmt(state.meta)}</span></div>
          <div style="font-size:9px;color:var(--text2);margin-top:4px;max-width:520px;line-height:1.35;opacity:.88" title="Barra % y cifra principal: suma de ventas activas (vitrina+local+inter). Insignias v20–v150, racha y misión 5 despachos: solo local/inter sin vitrina.">ℹ️ Progreso según ventas activas (todos los canales). Logros de “despacho” no cuentan vitrina.</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:Syne;font-size:36px;font-weight:800;color:${pct>=100?'#ffd700':pct>=75?'#00e5b4':pct>=50?'#00c4ff':'var(--text)'};text-shadow:${pct>=100?'0 0 20px rgba(255,215,0,.6)':'none'}">${Math.round(pct)}%</div>
          <div style="font-size:10px;color:var(--text2)">${pct>=100?'🏆 ¡META LOGRADA!':pct>=75?'🔥 ¡Casi!':pct>=50?'⚡ Mitad del camino':'💪 Sigue adelante'}</div>
        </div>
      </div>
      <div class="meta-bar-wrap">
        <div class="meta-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${pct>=100?'#ffd700,#ffaa00':pct>=75?'#00e5b4,#00c4ff':'#a78bfa,#00c4ff'})"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        ${[25,50,75,100].map(t=>`<div style="font-size:10px;color:${pct>=t?'var(--accent)':'var(--text2)'};font-weight:${pct>=t?'700':'400'}">${pct>=t?'✓ ':''}${t}%</div>`).join('')}
      </div>
      <div class="meta-sum-grid">
        <div class="meta-sum-row">
          <div class="meta-sum-val">${fmt(totalMesCal)}</div>
          <div class="meta-sum-body">
            <div class="meta-sum-title">Ventas del mes</div>
            <div class="meta-sum-sub">${resumenMesCal.length} facturas · mes calendario ${ymActual}</div>
          </div>
        </div>
        <div class="meta-sum-row">
          <div class="meta-sum-val">${fmt(sumValor(hoyVitrina))}</div>
          <div class="meta-sum-body">
            <div class="meta-sum-title">Ventas vitrina hoy</div>
            <div class="meta-sum-sub">${hoyVitrina.length} facturas · mostrador + separados vitrina</div>
          </div>
        </div>
        <div class="meta-sum-row">
          <div class="meta-sum-val">${fmt(sumValor(hoyLocal)+sumValor(hoyInter))}</div>
          <div class="meta-sum-body">
            <div class="meta-sum-title">Ventas despachos hoy</div>
            <div class="meta-sum-sub">${hoyLocal.length+hoyInter.length} facturas · local + intermunicipal</div>
          </div>
        </div>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="rpg-header" style="padding:16px;flex:1">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div class="rpg-avatar">${lv.avatar}</div>
          <div>
            <div style="font-family:Syne;font-size:16px;font-weight:800;color:var(--accent)">${lv.name}</div>
            <div style="font-size:11px;color:var(--text2)">Nivel ${lv.level} · ${g.xp||0} XP</div>
            <div style="font-size:11px;color:#ffd700;margin-top:2px">${streak>0?'🔥 Racha '+streak+' días':'Sin racha activa'}</div>
          </div>
        </div>
        ${nextLv?`<div style="font-size:10px;color:var(--text2);margin-bottom:4px">→ ${nextLv.avatar} ${nextLv.name} · faltan ${xpToNext} XP</div><div class="xp-bar-wrap"><div class="xp-bar-fill" style="width:${xpPct}%"></div></div>`:`<div style="font-size:11px;color:#ffd700;text-align:center;padding:4px">🏆 ¡Nivel Máximo!</div>`}
      </div>
      <div class="rpg-header ${pendientes>0?'pend-glow':''}" style="padding:12px;text-align:center;cursor:pointer" onclick="showPage('pendientes')">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:${pendientes>0?'var(--red)':'var(--green)'}">${pendientes}</div>
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">${pendientes>0?'⚠️ Cobros Pendientes':'✅ Todo al día'}</div>
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">
    <div class="rpg-stat"><div class="rpg-stat-val" style="color:var(--accent2)">${vm.totalDespachos}</div><div class="rpg-stat-label">📦 Despachos</div></div>
    <div class="rpg-stat"><div class="rpg-stat-val" style="color:#a78bfa">${vm.vitrina.length}</div><div class="rpg-stat-label">🏪 Vitrina</div><div style="font-size:10px;color:var(--text2);margin-top:2px">${fmt(vm.vitrineTotal)}</div></div>
    <div class="rpg-stat"><div class="rpg-stat-val" style="color:var(--yellow)">${vm.local.length}</div><div class="rpg-stat-label">🛵 Local</div><div style="font-size:10px;color:var(--text2);margin-top:2px">${fmt(vm.localTotal)}</div></div>
    <div class="rpg-stat"><div class="rpg-stat-val" style="color:var(--accent)">${vm.inter.length}</div><div class="rpg-stat-label">📦 Inter</div><div style="font-size:10px;color:var(--text2);margin-top:2px">${fmt(vm.interTotal)}</div></div>
    <div class="rpg-stat" onclick="showPage('articulos')" style="cursor:pointer"><div class="rpg-stat-val" style="color:var(--orange)">${totalArticulos}</div><div class="rpg-stat-label">🗡️ Artículos</div><div style="font-size:10px;color:${lowStockItems>0?'var(--red)':'var(--green)'};margin-top:2px">${lowStockItems>0?'⚠️ '+lowStockItems+' bajo stock':'✓ Stock OK'}</div></div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div class="card" style="margin:0">
      <div class="card-title">⚔️ MISIONES DEL DÍA</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${missions.map(m=>{
          const done=m.id==='m2'?pct>=m.pctTarget:m.cur>=m.max;
          const mpct=m.id==='m2'?Math.min(100,pct):Math.min(100,(m.cur/m.max)*100);
          return `<div class="mission-card ${done?'done':''}">
            <div style="font-size:22px">${m.icon}</div>
            <div style="flex:1">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-size:12px;font-weight:600">${m.label}</span>
                <span style="font-size:10px;color:${done?'var(--accent)':'var(--text2)'}">${done?'✅ +'+m.xp+'XP':m.cur+'/'+m.max}</span>
              </div>
              <div class="mission-bar"><div class="mission-bar-fill" style="width:${mpct}%;background:${done?'linear-gradient(90deg,#ffd700,#ffaa00)':'linear-gradient(90deg,#00e5b4,#00c4ff)'}"></div></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="card" style="margin:0;flex:1">
        <div class="card-title">💰 TESORO (CAJA)</div>
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--accent)">${fmt(cajaSaldo)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">${(state.cajas||[]).filter(c=>c.estado==='abierta').length} caja(s) abiertas</div>
      </div>
      <div class="card" style="margin:0;flex:1">
        <div class="card-title">🗓️ HOY · ${formatDate(hoy)}</div>
        <div style="font-family:Syne;font-size:22px;font-weight:800;color:var(--text)">${facturasHoyLista.length} <span style="font-size:12px;font-weight:600;color:var(--text2)">facturas</span></div>
        <div style="font-size:11px;color:var(--accent);margin-top:4px;font-weight:700">${fmt(sumValor(facturasHoyLista))} <span style="font-weight:400;color:var(--text2)">total día</span></div>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:11px;line-height:1.45">
          <div>
            <div style="font-family:Syne;font-weight:800;color:#a78bfa;margin-bottom:6px;font-size:10px;text-transform:uppercase">🏪 Vitrina</div>
            <div style="color:var(--text2)">Mostrador <span style="color:var(--text)">${hoyVitrinaMostrador.length}</span> · ${fmt(sumValor(hoyVitrinaMostrador))}</div>
            <div style="color:var(--text2)">Separados <span style="color:var(--text)">${hoyVitrinaSeparados.length}</span> · ${fmt(sumValor(hoyVitrinaSeparados))}</div>
            <div style="margin-top:4px;font-weight:700;color:var(--text)">∑ Vitrina ${hoyVitrina.length} · ${fmt(sumValor(hoyVitrina))}</div>
          </div>
          <div>
            <div style="font-family:Syne;font-weight:800;color:var(--accent2);margin-bottom:6px;font-size:10px;text-transform:uppercase">📦 Despachos</div>
            <div style="color:var(--text2)">🛵 Local <span style="color:var(--text)">${hoyLocal.length}</span> · ${fmt(sumValor(hoyLocal))}</div>
            <div style="color:var(--text2)">📦 Intermun. <span style="color:var(--text)">${hoyInter.length}</span> · ${fmt(sumValor(hoyInter))}</div>
            <div style="margin-top:4px;font-weight:700;color:var(--text)">∑ Desp. ${hoyLocal.length+hoyInter.length} · ${fmt(sumValor(hoyLocal)+sumValor(hoyInter))}</div>
          </div>
        </div>
        <div style="font-size:10px;color:var(--text2);margin-top:10px;opacity:.9">Insignias/racha/mis. “5 despachos”: solo local+inter sin vitrina → ${ventasHoy.length} · ${fmt(sumValor(ventasHoy))}</div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-title">🏅 INSIGNIAS — ${earnedBadges.length}/${BADGES.length} desbloqueadas</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px">
      ${BADGES.map(b=>{
        const earned=earnedBadges.includes(b.id);
        return `<div class="badge-rpg ${earned?'earned':''}" title="${b.desc}">
          <div style="font-size:22px;margin-bottom:4px">${b.icon}</div>
          <div style="font-size:9px;font-family:Syne;font-weight:700;color:${earned?'var(--accent)':'var(--text2)'};line-height:1.2">${b.name}</div>
          ${earned?'<div style="font-size:9px;color:var(--accent);margin-top:2px">✓</div>':'<div style="font-size:9px;color:var(--text2);margin-top:2px">🔒</div>'}
        </div>`;
      }).join('')}
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <div class="card-title">📋 FACTURAS DE HOY (${formatDate(hoy)}) — ${facturasHoyLista.length} · ${fmt(facturasHoyLista.reduce((a,v)=>a+v.valor,0))}</div>
    <div style="font-size:11px;color:var(--text2);margin:-6px 0 10px">Cada venta POS genera una factura; orden: más reciente arriba.</div>
    <div class="table-wrap"><table><thead><tr><th>Hora/ID</th><th>Factura</th><th>Canal</th><th>Valor</th><th>Cliente</th><th>Estado</th></tr></thead><tbody>
    ${facturasHoyLista.map(v=>`<tr>
      <td style="font-size:11px;color:var(--text2)">${String(v.id||'').slice(0,8)}…</td>
      <td style="font-weight:700">${v.desc||'—'}</td>
      <td><span class="badge badge-${v.canal}">${v.canal==='vitrina'?'🏪':v.canal==='local'?'🛵':'📦'} ${v.canal}</span></td>
      <td style="color:var(--accent);font-weight:600">${fmt(v.valor)}</td>
      <td style="font-size:12px">${v.cliente||'—'}</td>
      <td><span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'✓ Liq':'⏳ Pend'}</span></td>
    </tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin facturas hoy</td></tr>'}
    </tbody></table></div>
  </div>
  <div class="card">
    <div class="card-title">🗓️ MES ${ymActual} — OTRAS FECHAS (hasta 8 más recientes)</div>
    <div style="font-size:11px;color:var(--text2);margin:-6px 0 10px">Total mes calendario: <b>${resumenMesCal.length}</b> facturas · <b>${fmt(totalMesCal)}</b> (incluye hoy).</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Factura</th><th>Canal</th><th>Valor</th><th>Estado</th></tr></thead><tbody>
    ${facturasMesOtrasFechas.map(v=>`<tr>
      <td>${formatDate(v.fecha)}</td>
      <td style="font-weight:700">${v.desc||'—'}</td>
      <td><span class="badge badge-${v.canal}">${v.canal==='vitrina'?'🏪':v.canal==='local'?'🛵':'📦'} ${v.canal}</span></td>
      <td style="color:var(--accent);font-weight:600">${fmt(v.valor)}</td>
      <td><span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'✓ Liq':'⏳ Pend'}</span></td>
    </tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:24px">No hay más fechas en el mes antes de hoy</td></tr>'}
    </tbody></table></div>
  </div>`;
}

// ===================================================================
// ===== POS (Point of Sale) =====
// ===================================================================
function syncPOSFormState() {
  if (window.AppPosController?.syncFormState) {
    window.AppPosController.syncFormState(state, posFormState);
    return;
  }
  const c = document.getElementById('pos-canal'); if(c) posFormState.canal = c.value;
  const e = document.getElementById('pos-empresa'); if(e) posFormState.empresa = e.value;
  const t = document.getElementById('pos-transportadora'); if(t) posFormState.transportadora = t.value;
  const g = document.getElementById('pos-guia');
  if(g) posFormState.guia = g.value;
  else if (posFormState.canal === 'local') posFormState.guia = '';
  const ci = document.getElementById('pos-ciudad');
  if(ci) posFormState.ciudad = ci.value;
  else if (posFormState.canal === 'local') posFormState.ciudad = '';
  const dir = document.getElementById('pos-direccion'); if(dir) posFormState.direccion = dir.value;
  else if (posFormState.canal !== 'inter' && posFormState.canal !== 'local') posFormState.direccion = '';
  const comp = document.getElementById('pos-comprobante'); if(comp) posFormState.comprobante = comp.value;
  const ced = document.getElementById('pos-cedula'); if(ced) posFormState.cedula = ced.value;
  const cl = document.getElementById('pos-cliente'); if(cl) posFormState.cliente = cl.value;
  const tel = document.getElementById('pos-telefono'); if(tel) posFormState.telefono = tel.value;
  const m = document.getElementById('pos-metodo-pago'); if(m) posFormState.metodo = m.value;
  const cta = document.getElementById('pos-cuenta'); if(cta) posFormState.cuenta = cta.value;
  const iva = document.getElementById('pos-apply-iva'); if(iva) posFormState.applyIva = iva.checked;
  const fleteChk = document.getElementById('pos-apply-flete');
  if(fleteChk) posFormState.applyFlete = fleteChk.checked;
  else if (posFormState.canal === 'local') posFormState.applyFlete = true;
  const fleteVal = document.getElementById('pos-flete-valor'); if(fleteVal) posFormState.flete = parseFloat(fleteVal.value)||0;
  const tipoPagoEl = document.getElementById('pos-tipo-pago'); if(tipoPagoEl) posFormState.tipoPago = tipoPagoEl.value;
  const montoRec = document.getElementById('pos-monto-recibido'); if(montoRec) posFormState.montoRecibido = parseFloat(montoRec.value) || '';
  const mixEfe = document.getElementById('pos-mixto-efectivo'); if(mixEfe) posFormState.mixtoEfectivo = parseFloat(mixEfe.value) || 0;
  const mixTrf = document.getElementById('pos-mixto-transferencia'); if(mixTrf) posFormState.mixtoTransferencia = parseFloat(mixTrf.value) || 0;
  const posBod = document.getElementById('pos-bodega'); if (posBod) { posFormState.bodegaId = posBod.value; try { window.AppCajaLogic?.setPosBodegaId?.(posBod.value); } catch (e) {} }
  const posCaja = document.getElementById('pos-caja'); if (posCaja) { posFormState.cajaId = posCaja.value; try { window.AppCajaLogic?.setPosCajaId?.(posCaja.value); } catch (e) {} }
  (document.querySelectorAll('[data-pos-price-idx]')||[]).forEach(inp=>{
    const idx = parseInt(inp.getAttribute('data-pos-price-idx'),10);
    if(Number.isInteger(idx) && state.pos_cart && state.pos_cart[idx]){
      state.pos_cart[idx].precio = parseFloat(inp.value)||0;
    }
  });
}

  function calcularVuelto(total) {
  const recibido = parseFloat(document.getElementById('pos-monto-recibido').value) || 0;
  const display = document.getElementById('pos-vuelto-display');
  
  if (recibido === 0) {
    display.textContent = '$0';
    display.style.color = 'var(--text2)';
  } else if (recibido >= total) {
    display.textContent = fmt(recibido - total);
    display.style.color = 'var(--green)'; // Verde: Todo OK
  } else {
    display.textContent = 'Faltan ' + fmt(total - recibido);
    display.style.color = 'var(--red)'; // Rojo: Falta dinero
  }
}
  
function renderPOS(){
  if (window.AppPosView?.renderPOSLayout) {
    window.AppPosView.renderPOSLayout({ state, posFormState, syncPOSFormState, fmt });
  } else {
    syncPOSFormState();
  }
  renderPOSProductGrid();
  renderPOSCategoryTabs();
  handlePOSShippingUI();
}

// Actualiza el precio de un ítem específico en el carrito y repinta
function updatePOSCartPrice(idx, val) {
    const nuevoPrecio = parseFloat(val) || 0;
    if (state.pos_cart && state.pos_cart[idx]) {
        state.pos_cart[idx].precio = nuevoPrecio;
        renderPOS(); 
    }
}

function toggleIVA() {
    if (window.AppPosController?.toggleIVA) {
        window.AppPosController.toggleIVA(posFormState, renderPOS);
        return;
    }
    const checkbox = document.getElementById('pos-apply-iva');
    if (checkbox) {
        posFormState.applyIva = checkbox.checked;
        renderPOS();
    }
}
  function toggleFlete() {
  if (window.AppPosController?.toggleFlete) {
    window.AppPosController.toggleFlete(posFormState, renderPOS);
    return;
  }
  const checkbox = document.getElementById('pos-apply-flete');
  if(checkbox) posFormState.applyFlete = checkbox.checked;
  else if (posFormState.canal === 'local') posFormState.applyFlete = true;
  const val = document.getElementById('pos-flete-valor');
  if(val) posFormState.flete = parseFloat(val.value)||0;
  renderPOS();
}

function handlePOSShippingUI() {
  if (window.AppPosController?.handleShippingUI) {
    window.AppPosController.handleShippingUI(state, posFormState);
    return;
  }
  const canal = document.getElementById('pos-canal').value;
  posFormState.canal = canal;
  const container = document.getElementById('pos-shipping-fields');
  const empresaSel = document.getElementById('pos-empresa');
  const transSel = document.getElementById('pos-transportadora');
  
  if(canal === 'vitrina') {
    container.style.display = 'none';
  } else {
    container.style.display = 'flex';
    if(canal === 'local') {
      empresaSel.innerHTML = `<option value="">— Mensajería Local —</option><option value="MensLocal" ${posFormState.empresa==='MensLocal'?'selected':''}>Mensajería Propia</option><option value="Rappi" ${posFormState.empresa==='Rappi'?'selected':''}>Rappi</option><option value="Picap" ${posFormState.empresa==='Picap'?'selected':''}>Picap</option>`;
      transSel.style.display = 'none';
    } else if(canal === 'inter') {
      empresaSel.innerHTML = `<option value="">— Elija plataforma * —</option><option value="HEKA" ${posFormState.empresa==='HEKA'?'selected':''}>HEKA</option><option value="DROPI" ${posFormState.empresa==='DROPI'?'selected':''}>Dropi</option><option value="Directo" ${posFormState.empresa==='Directo'?'selected':''}>Directo / Otra</option>`;
      transSel.style.display = 'block';
      if (transSel.options && transSel.options[0]) transSel.options[0].text = '— Transportadora * —';
    }
  }
}

function handlePOSEmpresa() {
  if (window.AppPosController?.handleEmpresa) {
    window.AppPosController.handleEmpresa(posFormState);
    return;
  }
  posFormState.empresa = document.getElementById('pos-empresa').value;
}

function renderPOSCategoryTabs(){
  if (window.AppPosView?.renderPOSCategoryTabs) {
    window.AppPosView.renderPOSCategoryTabs(state);
    return;
  }
  const cats=[...new Set((state.articulos||[]).map(a=>a.categoria).filter(Boolean))];
  const el=document.getElementById('pos-cat-tabs');
  if(!el)return;
  el.innerHTML=`<div class="tab active" onclick="filterPOSByCategory('')">Todos</div>`+cats.map(c=>`<div class="tab" onclick="filterPOSByCategory('${c}')">${c}</div>`).join('');
}

let _posFilter='';let _posCatFilter='';
function filterPOSProducts(){_posFilter=(document.getElementById('pos-search')?.value||'').toLowerCase();renderPOSProductGrid()}
function filterPOSByCategory(cat){
  _posCatFilter=cat;
  document.querySelectorAll('#pos-cat-tabs .tab').forEach(t=>t.classList.remove('active'));
  event.target.classList.add('active');
  renderPOSProductGrid();
}

function renderPOSProductGrid(){
  if (window.AppPosView?.renderPOSProductGrid) {
    window.AppPosView.renderPOSProductGrid({
      state,
      posFilter: _posFilter,
      posCatFilter: _posCatFilter,
      getArticuloStock,
      fmt
    });
    return;
  }
  const el=document.getElementById('pos-product-grid');if(!el)return;
  let items=(state.articulos||[]).filter(a=>a.activo!==false);
  if(_posFilter)items=items.filter(a=>(a.nombre+a.codigo+a.categoria).toLowerCase().includes(_posFilter));
  if(_posCatFilter)items=items.filter(a=>a.categoria===_posCatFilter);

  el.innerHTML=items.map(a=>{
    const stock=getArticuloStock(a.id);
    const low=stock<=a.stockMinimo;const out=stock<=0;
  const esVideo = a.imagen && a.imagen.split('?')[0].toLowerCase().match(/\.(mp4|mov|webm|avi)$/);
const bgImg = (a.imagen && !esVideo) ? `background-image: linear-gradient(to top, rgba(0,0,0,0.8), transparent), url('${a.imagen}'); background-size: cover; background-position: center; color: white; border: none;` : '';
const videoEl = esVideo ? `<video src="${a.imagen}" autoplay muted loop playsinline style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:12px;z-index:0;"></video><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.8),transparent);border-radius:12px;z-index:1;"></div>` : '';
const videoIcon = (a.video || esVideo) ? `<div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.5);border-radius:50%;padding:4px;font-size:12px;z-index:2;">▶️</div>` : '';

  return`<div class="product-card ${out?'no-stock':low?'low-stock':''}" style="position:relative; min-height:140px; display:flex; flex-direction:column; justify-content:flex-end; ${esVideo ? 'color:white;border:none;' : bgImg}" onclick="promptTallaYAgregar('${a.id}')">
  ${videoEl}
  ${videoIcon}
  ${!a.imagen && !esVideo ? `<div class="p-emoji">${a.emoji||'👙'}</div>` : ''}
  <div class="p-name" style="position:relative;z-index:2;${(a.imagen||esVideo)?'text-shadow:0 1px 3px rgba(0,0,0,0.8);':''}">${a.nombre}</div>
  <div class="p-price" style="position:relative;z-index:2;${(a.imagen||esVideo)?'color:#00e5b4;text-shadow:0 1px 2px rgba(0,0,0,0.8);':''}">${fmt(a.precioVenta)}</div>
  <div class="p-stock" style="position:relative;z-index:2;${(a.imagen||esVideo)?'color:#ddd;':''}">${out?'❌ Agotado':stock+' en stock'+(low?' ⚠️':'')}</div>
  ${a.codigo&&!a.imagen&&!esVideo?'<div style="font-size:9px;color:var(--meta);margin-top:2px">'+a.codigo+'</div>':''}
  
    </div>`}).join('')||'<div style="grid-column:1/-1;text-align:center;color:var(--text2);padding:24px">No se encontraron artículos</div>';
}

function promptTallaYAgregar(artId){
  const art=(state.articulos||[]).find(a=>a.id===artId);if(!art)return;
  const tallas = art.tallas ? art.tallas.split(',') : ['XS','S','M','L','XL','Única'];

  openModal(`
    <div class="modal-title">Seleccionar Talla - ${art.nombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    ${art.descripcion ? `<div style="font-size:12px; color:var(--text2); margin-bottom:16px">${art.descripcion}</div>` : ''}
    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:16px">
      ${tallas.map(t => `<button class="btn btn-secondary" onclick="addToCart('${artId}', '${t.trim()}')">${t.trim()}</button>`).join('')}
    </div>
  `);
}

function addToCart(artId, talla = 'Única'){
  syncPOSFormState(); 
  if (window.AppPosService?.addToCart) {
    const result = window.AppPosService.addToCart({ state, artId, talla, getArticuloStock, notify });
    if (!result.ok) return;
  } else {
    const art=(state.articulos||[]).find(a=>a.id===artId);if(!art)return;
    const stock=getArticuloStock(artId);
    const inCart=(state.pos_cart||[]).find(c=>c.articuloId===artId && c.talla===talla);
    const currentQty=inCart?inCart.qty:0;
    if(currentQty>=stock){notify('warning','⚠️','Sin stock','No hay suficiente inventario.',{duration:3000});return}
    if(inCart){ inCart.qty++; }
    else { state.pos_cart.push({articuloId:artId, nombre:art.nombre, precio:art.precioVenta, qty:1, categoria: art.categoria, talla: talla}); }
  }
  closeModal();
  renderPOS();
}

function posCartQty(idx,delta){
  syncPOSFormState();
  if (window.AppPosService?.updateCartQty) {
    window.AppPosService.updateCartQty(state, idx, delta);
  } else {
    const cart=state.pos_cart||[];
    if(!cart[idx])return;
    cart[idx].qty+=delta;
    if(cart[idx].qty<=0)cart.splice(idx,1);
  }
  renderPOS();
}
function posCartRemove(idx){
  syncPOSFormState();
  if (window.AppPosService?.removeCartItem) window.AppPosService.removeCartItem(state, idx);
  else (state.pos_cart||[]).splice(idx,1);
  renderPOS();
}
function clearPOSCart(){
  syncPOSFormState();
  if (window.AppPosService?.clearCart) window.AppPosService.clearCart(state);
  else state.pos_cart=[];
  renderPOS();
}

async function procesarVentaPOS(opts) {
  const o = opts || {};
  if (!o.skipSyncForm) syncPOSFormState();
  const cart = state.pos_cart || [];
  if(cart.length === 0) return;
  if (_sbConnected && typeof ensureAntiDesyncBefore === 'function') {
    const ad = await ensureAntiDesyncBefore('pos');
    if (!ad.ok) return;
  }
  const esSeparado = o.skipSyncForm ? !!o.esSeparado : (document.getElementById('pos-es-separado')?.checked || false);
  if (esSeparado) {
    const nomSep = String(posFormState.cliente || '').trim();
    const telSep = String(posFormState.telefono || '').trim();
    if (!nomSep || !telSep) {
      notify('warning', '🛍️', 'Separado', 'Nombre del cliente y teléfono son obligatorios para registrar un separado.', { duration: 6500 });
      return;
    }
  }

  const canalV = posFormState.canal;
  if (canalV === 'inter') {
    const emp = String(posFormState.empresa || '').trim();
    if (!['HEKA', 'DROPI', 'Directo'].includes(emp)) {
      notify('warning', '📦', 'Intermunicipal', 'Debe elegir plataforma: HEKA, Dropi o Directo / Otra.', { duration: 7000 });
      return;
    }
    if (!String(posFormState.transportadora || '').trim()) {
      notify('warning', '📦', 'Intermunicipal', 'Seleccione la transportadora.', { duration: 6500 });
      return;
    }
    if (!String(posFormState.guia || '').trim()) {
      notify('warning', '📦', 'Intermunicipal', 'El número de guía es obligatorio.', { duration: 6500 });
      return;
    }
    if (!String(posFormState.direccion || '').trim()) {
      notify('warning', '📦', 'Intermunicipal', 'La dirección de entrega es obligatoria.', { duration: 6500 });
      return;
    }
    if (!String(posFormState.ciudad || '').trim()) {
      notify('warning', '📦', 'Intermunicipal', 'La ciudad es obligatoria.', { duration: 6500 });
      return;
    }
    if (!String(posFormState.cedula || '').trim()) {
      notify('warning', '📦', 'Intermunicipal', 'La cédula del cliente es obligatoria.', { duration: 6500 });
      return;
    }
    if (!String(posFormState.cliente || '').trim()) {
      notify('warning', '📦', 'Intermunicipal', 'El nombre del cliente es obligatorio.', { duration: 6500 });
      return;
    }
    if (!String(posFormState.telefono || '').trim()) {
      notify('warning', '📦', 'Intermunicipal', 'El teléfono del cliente es obligatorio.', { duration: 6500 });
      return;
    }
    const tpInter = posFormState.tipoPago || 'contado';
    if (tpInter === 'contraentrega') {
      posFormState.metodo = 'transferencia';
    } else {
      const okMet = ['nequi', 'daviplata', 'transferencia', 'tarjeta_debito', 'tarjeta_credito'];
      if (!okMet.includes(posFormState.metodo)) {
        notify('warning', '📦', 'Intermunicipal', 'En pago de contado elija: Nequi, Daviplata, transferencia bancaria o tarjeta débito/crédito.', { duration: 7500 });
        return;
      }
    }
  }
  if (canalV === 'local') {
    if (!String(posFormState.direccion || '').trim()) {
      notify('warning', '🛵', 'Mensajería local', 'La dirección de entrega es obligatoria.', { duration: 6500 });
      return;
    }
    if (!String(posFormState.cedula || '').trim()) {
      notify('warning', '🛵', 'Mensajería local', 'La cédula del cliente es obligatoria.', { duration: 6500 });
      return;
    }
    if (!String(posFormState.cliente || '').trim()) {
      notify('warning', '🛵', 'Mensajería local', 'El nombre del cliente es obligatorio.', { duration: 6500 });
      return;
    }
    if (!String(posFormState.telefono || '').trim()) {
      notify('warning', '🛵', 'Mensajería local', 'El celular o teléfono es obligatorio.', { duration: 6500 });
      return;
    }
    const tpLoc = posFormState.tipoPago || 'contado';
    if (tpLoc === 'contraentrega') {
      posFormState.metodo = 'transferencia';
    } else {
      const okLoc = ['nequi', 'daviplata', 'transferencia', 'tarjeta_debito', 'tarjeta_credito', 'efectivo', 'mixto'];
      if (!okLoc.includes(posFormState.metodo)) {
        notify('warning', '🛵', 'Mensajería local', 'Seleccione un medio de pago (Nequi, Daviplata, transferencia, tarjeta o efectivo).', { duration: 7500 });
        return;
      }
    }
    posFormState.applyFlete = true;
    const flLoc = parseFloat(posFormState.flete);
    if (!flLoc || flLoc <= 0) {
      notify('warning', '🛵', 'Mensajería local', 'El flete es obligatorio: indique el costo (mayor a 0).', { duration: 6500 });
      return;
    }
  }
  const subtotalV = cart.reduce((a, item) => a + (item.precio * item.qty), 0);
  const ivaV = posFormState.applyIva ? subtotalV * 0.19 : 0;
  const fleteV =
    canalV === 'local'
      ? parseFloat(posFormState.flete) || 0
      : posFormState.applyFlete && canalV === 'inter'
        ? parseFloat(posFormState.flete) || 0
        : 0;
  const totalV = subtotalV + ivaV + fleteV;
  if (posFormState.metodo === 'mixto') {
    const mixE = Math.max(0, parseFloat(posFormState.mixtoEfectivo) || 0);
    const mixT = Math.max(0, parseFloat(posFormState.mixtoTransferencia) || 0);
    const sumMix = mixE + mixT;
    if (mixE <= 0 || mixT <= 0) {
      notify('warning', '🧾', 'Pago mixto', 'Ingresa valores mayores a 0 en efectivo y transferencia.', { duration: 6000 });
      return;
    }
    if (Math.abs(sumMix - totalV) > 0.01) {
      notify('warning', '🧾', 'Pago mixto', `La suma efectivo + transferencia debe ser exactamente ${fmt(totalV)}.`, { duration: 7000 });
      return;
    }
  }
  posFormState.__posTotal = totalV;
  const bodegaIdV = posFormState.bodegaId || window.AppCajaLogic?.getPosBodegaId?.() || 'bodega_main';
  const cajaPrefV = posFormState.cajaId || window.AppCajaLogic?.getPosCajaId?.() || '';
  if (window.AppCajaLogic?.assertPosSaleAllowed) {
    const chk = window.AppCajaLogic.assertPosSaleAllowed(state, posFormState, bodegaIdV, cajaPrefV);
    if (!chk.ok) {
      notify('warning', '🏧', 'Caja POS', chk.message, { duration: 7000 });
      return;
    }
  }

  let canal, subtotal, iva, flete, total, numFactura, fechaActual, factura, ventaRecord;
  if (window.AppPosService?.buildPosDocuments) {
    const built = window.AppPosService.buildPosDocuments({
      state,
      posFormState,
      today,
      getNextConsec,
      uid,
      dbId,
      addBusinessDays,
      esSeparado
    });
    ({ canal, subtotal, iva, flete, total, numFactura, fechaActual, factura, ventaRecord } = built);
  } else {
    canal = posFormState.canal;
    subtotal = cart.reduce((a,item)=>a+(item.precio*item.qty),0);
    iva = posFormState.applyIva ? subtotal*0.19 : 0;
    flete = canal==='local' ? (parseFloat(posFormState.flete)||0) : (posFormState.applyFlete&&canal==='inter')?(parseFloat(posFormState.flete)||0):0;
    total = subtotal+iva+flete;
    numFactura = 'POS-'+getNextConsec('factura');
    fechaActual = today();
    const posDocId = dbId();
    const tipoPago = (canal === 'vitrina') ? 'contado' : (posFormState.tipoPago || 'contado');
    const esContraEntrega = tipoPago === 'contraentrega';
    const liquidadoInicial = canal === 'vitrina' || tipoPago === 'contado';
    const fechaLiq = liquidadoInicial ? fechaActual : addBusinessDays(fechaActual, canal === 'local' ? (state.diasLocal||1) : (state.diasInter||5));
    factura = {
      id:posDocId, numero:numFactura, fecha:fechaActual,
      cliente:posFormState.cliente, telefono:posFormState.telefono,
      items:cart.map(c=>({...c})), subtotal, iva, flete, total,
      metodo:posFormState.metodo, estado:'pagada', tipo:'pos',
      canal, guia:posFormState.guia, empresa:posFormState.empresa,
      transportadora:posFormState.transportadora, ciudad:posFormState.ciudad,
      direccion:posFormState.direccion||'', cedulaCliente:posFormState.cedula||'',
      comprobante:posFormState.comprobante||'',
      esSeparado
    };
    ventaRecord = {
      id:factura.id, fecha:fechaActual, canal, valor:total,
      cliente:posFormState.cliente, telefono:posFormState.telefono,
      guia:posFormState.guia, empresa:posFormState.empresa,
      transportadora:posFormState.transportadora, ciudad:posFormState.ciudad,
      direccion:posFormState.direccion||'', cedulaCliente:posFormState.cedula||'',
      comprobante:posFormState.comprobante||'',
      liquidado:liquidadoInicial, fechaLiquidacion:fechaLiq,
      esContraEntrega, tipoPago,
      esSeparado, estadoEntrega:'Pendiente', fechaHoraEntrega:null,
      desc:numFactura, metodoPago:posFormState.metodo,
      invoiceId:factura.id
    };
  }

  // Guardar en state local
  if(!Array.isArray(state.facturas)) state.facturas = [];
  if(!Array.isArray(state.ventas)) state.ventas = [];
  state.facturas.push(factura);
  state.ventas.push(ventaRecord);

  // Seguridad: toda venta POS debe existir como factura en memoria
  if(!state.facturas.some(f => f.id === factura.id)){
    state.facturas.push(factura);
  }

  // Descontar stock local
  const posBodega = posFormState.bodegaId || window.AppCajaLogic?.getPosBodegaId?.() || 'bodega_main';
  if (window.AppPosRepository?.applyLocalInventoryMovement) {
    window.AppPosRepository.applyLocalInventoryMovement(state, cart, dbId, fechaActual, numFactura, posBodega);
  } else {
    cart.forEach(item=>{
      const mov={id:dbId(),articuloId:item.articuloId,bodegaId:posBodega,cantidad:-item.qty,tipo:'venta',fecha:fechaActual,referencia:numFactura,nota:`Talla: ${item.talla}`};
      state.inv_movimientos.push(mov);
    });
  }

  // Persistencia principal: POS siempre registra factura + venta
  let persistedOK = false;
  if (window.AppPosRepository?.persistPosSale) {
    persistedOK = await window.AppPosRepository.persistPosSale(saveRecord, factura, ventaRecord);
  } else {
    if (window.AppPosRepository?.preparePosSaleForPersist) {
      window.AppPosRepository.preparePosSaleForPersist(factura, ventaRecord);
    } else {
      ventaRecord.invoiceId = factura.id;
    }
    const facturaSaved = await saveRecord('facturas', factura.id, factura);
    const ventaSaved = await saveRecord('ventas', ventaRecord.id, ventaRecord);
    persistedOK = facturaSaved && ventaSaved;
  }
  if(!persistedOK){
    ventaRecord.syncPending = true;
    ventaRecord.syncError = 'factura_venta';
    factura.syncPending = true;
    factura.syncError = 'factura_venta';
    notify('warning','📡','Sin sincronización BD','La venta se guardó localmente, pero no se pudo sincronizar factura/venta a la base de datos.',{duration:6000});
  }

  // stock_moves primero; solo tras insert OK se descuenta stock (pos-repository). Luego caja.
  if(_sbConnected){
    try {
      if (window.AppPosRepository?.registerPosSaleSideEffects) {
        await window.AppPosRepository.registerPosSaleSideEffects({
          state, cart, factura, ventaRecord, numFactura, fechaActual,
          dbId, saveRecord, supabaseClient, sbConnected: _sbConnected, posFormState, notify
        });
      } else {
        if (window.AppPosRepository?.syncStockToSupabase) {
          await window.AppPosRepository.syncStockToSupabase(state, cart, supabaseClient, _sbConnected);
        } else {
          for (const item of cart) {
            const art = state.articulos.find((a) => a.id === item.articuloId);
            if (art) {
              const q = Math.abs(parseInt(item.qty, 10) || 0);
              if (q <= 0) continue;
              const { data, error } = await supabaseClient.rpc('decrement_stock', {
                p_product_id: item.articuloId,
                p_qty: q,
              });
              if (error) throw error;
              art.stock = parseFloat(data) || 0;
            }
          }
        }
      }
    } catch(e){
      console.warn('Supabase POS stock / efectos venta:', e.message);
      ventaRecord.syncPending = true;
      ventaRecord.syncError = 'stock_efectos';
      notify('warning','⚠️','Sincronización parcial',`La venta ${numFactura} quedó pendiente de sincronizar inventario/caja.`,{duration:6500});
      if (window.AppPosRepository?.preparePosSaleForPersist) {
        window.AppPosRepository.preparePosSaleForPersist(factura, ventaRecord);
      }
      try { await saveRecord('ventas', ventaRecord.id, ventaRecord); } catch(_) { /* noop */ }
    }
  }

  // Auto-registrar cliente
  if (window.AppPosRepository?.autoRegisterCustomer) {
    window.AppPosRepository.autoRegisterCustomer(state, posFormState, dbId, fechaActual, supabaseClient, _sbConnected);
  } else if(posFormState.cliente){
    if(!Array.isArray(state.usu_clientes))state.usu_clientes=[];
    const yaExiste=state.usu_clientes.some(u=>(u.cedula&&u.cedula===posFormState.cedula)||(u.nombre&&u.nombre.toLowerCase()===posFormState.cliente.toLowerCase()));
    if(!yaExiste){
      const nc={id:dbId(),tipo:'cliente',tipoId:'CC',cedula:posFormState.cedula||'',nombre:posFormState.cliente,celular:posFormState.telefono||'',whatsapp:posFormState.telefono||'',ciudad:posFormState.ciudad||'',direccion:posFormState.direccion||'',fechaCreacion:fechaActual};
      state.usu_clientes.push(nc);
      if(_sbConnected){
        supabaseClient.from('customers').upsert({
          id:nc.id, nombre:nc.nombre, cedula:nc.cedula||null,
          celular:nc.celular||null, telefono:nc.celular||null,
          whatsapp:nc.whatsapp||null, ciudad:nc.ciudad||null, direccion:nc.direccion||null
        },{onConflict:'id'}).then(({error})=>{ if(error) console.warn('Auto-cliente error:',error.message); }).catch(e => console.warn('Auto-cliente catch:', e.message));
      }
    }
  }

  const xpGained=calcXP(canal,total);
  awardXP(xpGained);
  checkBadges();
  saveConfig('game', state.game);
  saveConfig('consecutivos', state.consecutivos);

  state.pos_cart=[];
  const _keepBod = posFormState.bodegaId || window.AppCajaLogic?.getPosBodegaId?.() || 'bodega_main';
  const _keepCaja = posFormState.cajaId || window.AppCajaLogic?.getPosCajaId?.() || '';
  posFormState={canal:'vitrina',empresa:'',transportadora:'',guia:'',ciudad:'',direccion:'',comprobante:'',cedula:'',cliente:'',telefono:'',metodo:'efectivo',cuenta:'',applyIva:false,applyFlete:false,flete:0,tipoPago:'contado',bodegaId:_keepBod,cajaId:_keepCaja};

  if (!o.skipCashDrawer) openCashDrawer();
  printReceipt(factura);
  notify('sale','✅','¡Venta registrada!',`${numFactura} · ${fmt(total)} · +${xpGained}XP`,{duration:4000});
  if (!ventaRecord.liquidado && canal !== 'vitrina') {
    notify('warning','⏳','Cobros / alertas',`${numFactura}: pendiente de liquidación — visible en Cobros y en Alertas para quien cobra.`,{duration:7000});
  }
  if (!o.skipConfetti) {
    spawnConfetti();
    screenFlash('green');
  }
  if (_sbConnected && typeof refreshCriticalSlice === 'function') {
    try {
      const rr = await refreshCriticalSlice('pos');
      if (!rr.ok) {
        notify('warning', '📡', 'Actualización parcial', 'La venta se registró; no se pudo refrescar todo desde el servidor. Reintenta o recarga si ves stock desactualizado.', { duration: 6500 });
      }
    } catch (e) {
      notify('warning', '📡', 'No se pudo sincronizar', 'Reintenta.', { duration: 5000 });
    }
  }
  renderPOS();
  updateNavBadges();
}

function _metodoPagoDesdeCanalCatalogo(canal) {
  const c = String(canal || '').toLowerCase();
  if (c.includes('addi')) return 'addi';
  if (c.includes('wompi')) return 'transferencia';
  return 'digital';
}

function _articuloDesdeItemCatalogo(it) {
  if (it.productId) {
    const a = (state.articulos || []).find((x) => String(x.id) === String(it.productId));
    if (a) return a;
  }
  const ref = String(it.ref || '').trim();
  if (ref) {
    return (state.articulos || []).find(
      (x) => String(x.ref || x.codigo || '').trim() === ref
    ) || null;
  }
  return null;
}

/**
 * Convierte un pedido catálogo pagado (Wompi/Addi) en venta POS: factura, venta, stock, stock_moves, caja.
 */
async function convertirVentaCatalogoAPos(catalogRowId) {
  const r = (state.ventasCatalogo || []).find((x) => String(x.id) === String(catalogRowId));
  if (!r) {
    notify('warning', '📦', 'Pedido', 'No se encontró el registro.', { duration: 4000 });
    return;
  }
  if (r.posFacturaId) {
    notify('warning', '📦', 'Ya convertido', 'Este pedido ya tiene venta POS vinculada.', { duration: 5000 });
    return;
  }
  if (r.estadoPago !== 'pago_exitoso') {
    notify('warning', '📦', 'Estado', 'Solo se puede convertir un pedido con pago exitoso.', { duration: 5000 });
    return;
  }
  const items = Array.isArray(r.items) ? r.items : [];
  if (items.length === 0) {
    notify('warning', '📦', 'Ítems', 'El pedido no tiene líneas de producto.', { duration: 4000 });
    return;
  }
  if (!confirm('¿Crear venta POS con estas líneas, descontar stock y registrar en caja (si hay caja abierta)?')) return;

  const built = [];
  const errores = [];
  items.forEach((it, idx) => {
    const art = _articuloDesdeItemCatalogo(it);
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const talla = String(it.size || it.talla || 'Única').trim() || 'Única';
    if (!art) {
      errores.push(`Línea ${idx + 1}: no se encontró artículo (ref ${it.ref || '—'}).`);
      return;
    }
    const stock = getArticuloStock(art.id);
    if (stock < qty) {
      errores.push(`${art.nombre}: stock ${stock}, se piden ${qty}.`);
      return;
    }
    const precioLinea = Number(it.price);
    const precio = Number.isFinite(precioLinea) && precioLinea > 0 ? precioLinea : art.precioVenta;
    built.push({
      articuloId: art.id,
      nombre: art.nombre,
      precio,
      qty,
      categoria: art.categoria,
      talla
    });
  });

  if (errores.length) {
    notify('danger', '📦', 'No se puede convertir', errores.slice(0, 6).join(' '), { duration: 9000 });
    return;
  }
  if (built.length === 0) {
    notify('warning', '📦', 'Ítems', 'No hay líneas válidas para vender.', { duration: 5000 });
    return;
  }

  const savedCart = JSON.parse(JSON.stringify(state.pos_cart || []));
  const savedPos = { ...posFormState };
  const nFacturasAntes = (state.facturas || []).length;

  try {
    state.pos_cart = built;
    Object.assign(posFormState, {
      canal: 'vitrina',
      empresa: '',
      transportadora: '',
      guia: '',
      ciudad: r.envioCiudad || '',
      direccion: r.envioDireccion || '',
      comprobante: r.reference || '',
      cedula: r.clienteDocumento || '',
      cliente: r.clienteNombre || 'Cliente catálogo web',
      telefono: r.clienteTelefono || '',
      metodo: _metodoPagoDesdeCanalCatalogo(r.canalPago),
      cuenta: '',
      applyIva: false,
      applyFlete: false,
      flete: 0,
      tipoPago: 'contado'
    });

    await procesarVentaPOS({
      skipSyncForm: true,
      esSeparado: false,
      skipCashDrawer: true,
      skipConfetti: true
    });

    if ((state.facturas || []).length <= nFacturasAntes) {
      notify('danger', '📦', 'Error', 'No se generó la factura POS. Revisa caja/bodega o la consola.', { duration: 7000 });
      return;
    }

    const factura = state.facturas[state.facturas.length - 1];
    const venta = (state.ventas || []).find((v) => String(v.id) === String(factura.id));
    const refCat = r.reference || '';
    if (venta) {
      venta.desc = `${factura.numero || ''} · Cat:${refCat}`.trim();
    }
    if (factura) {
      factura.comprobante = [factura.comprobante || '', `Web ${refCat}`].filter(Boolean).join(' · ');
    }
    if (window.AppPosRepository?.preparePosSaleForPersist) {
      window.AppPosRepository.preparePosSaleForPersist(factura, venta);
    }
    if (venta) {
      await saveRecord('ventas', venta.id, venta);
    }
    if (factura) {
      await saveRecord('facturas', factura.id, factura);
    }

    r.posFacturaId = factura.id;
    const okVc = await saveRecord('ventas_catalogo', r.id, r);
    if (okVc) {
      const ix = (state.ventasCatalogo || []).findIndex((x) => String(x.id) === String(r.id));
      if (ix >= 0) state.ventasCatalogo[ix] = { ...r };
    }

    notify(
      'success',
      '🛒',
      'Venta POS creada',
      `${factura.numero || ''} · vinculada a pedido ${refCat}`,
      { duration: 5000 }
    );
    if (typeof renderVentasCatalogo === 'function') renderVentasCatalogo();
  } catch (e) {
    console.error('convertirVentaCatalogoAPos:', e);
    notify('danger', '📦', 'Error', e.message || String(e), { duration: 8000 });
  } finally {
    state.pos_cart = savedCart;
    posFormState = { ...savedPos };
  }
}

/** Anula venta POS: stock, stock_moves (neto vendido), factura.estado — no revierte ingreso en caja. */
async function anularVentaPOS(facturaId){
  const id = String(facturaId);
  const factura = (state.facturas||[]).find(f=>String(f.id)===id);
  if(!factura){
    notify('warning','⚠️','Factura','No se encontró la factura.',{duration:4000});
    return;
  }
  if(factura.estado==='anulada'){
    notify('warning','⚠️','Factura','Esta venta ya está anulada.',{duration:3000});
    return;
  }
  const esPos = factura.tipo==='pos' || String(factura.numero||'').startsWith('POS-');
  if(!esPos){
    notify('warning','⚠️','Solo POS','Solo se pueden anular ventas POS desde esta acción.',{duration:4000});
    return;
  }
  const rawItems = Array.isArray(factura.items)?factura.items:[];
  const cart = rawItems.map(i=>({
    articuloId:i.articuloId||i.id,
    qty:Math.abs(parseInt(i.qty||i.cantidad,10)||0),
    nombre:i.nombre||'',
    talla:i.talla||''
  })).filter(i=>i.articuloId&&i.qty>0);
  if(cart.length===0){
    notify('warning','⚠️','Ítems','La factura no tiene líneas para revertir.',{duration:4000});
    return;
  }
  try{
    if(window.AppPosRepository?.restoreStockAfterPosAnulacion){
      await window.AppPosRepository.restoreStockAfterPosAnulacion(state,cart,supabaseClient,_sbConnected);
    }
    if(window.AppPosRepository?.registerPosAnulacionStockMoves){
      await window.AppPosRepository.registerPosAnulacionStockMoves({
        state,cart,factura,facturaId:factura.id,numFactura:factura.numero||'',fechaActual:today(),dbId,
        supabaseClient,sbConnected:_sbConnected,
        posFormState:{bodegaId:posFormState?.bodegaId||window.AppCajaLogic?.getPosBodegaId?.()||'bodega_main'},
        notify
      });
    }
    factura.estado='anulada';
    factura.posStockAnulacionAplicada=true;
    await saveRecord('facturas',factura.id,factura);
    const venta=(state.ventas||[]).find(v=>String(v.id)===id);
    if(venta)venta.anulada=true;
    if (typeof renderTesPagosProv === 'function') renderTesPagosProv();
    renderHistorial();
    updateNavBadges();
    notify('success','✅','Venta anulada',`${factura.numero||id} — stock y vendido POS (referencia) actualizados. Revisa caja si hubo ingreso.`,{duration:7000});
  }catch(e){
    console.warn('anularVentaPOS:',e);
    notify('danger','⚠️','Error',e.message||String(e),{duration:6000});
  }
}
function anularVentaPOSConfirm(facturaId){
  if(!confirm('¿Anular esta venta POS? Se devolverá stock, se revertirá el vendido POS (referencia) y la factura quedará anulada. El ingreso en caja debe ajustarse manualmente si aplica.'))return;
  anularVentaPOS(facturaId);
}
window.anularVentaPOS=anularVentaPOS;
window.anularVentaPOSConfirm=anularVentaPOSConfirm;
window.convertirVentaCatalogoAPos=convertirVentaCatalogoAPos;


// ===== SCANNER =====
function openScannerOverlay(){
  document.getElementById('scanner-overlay').classList.add('active');
  const inp=document.getElementById('scanner-input');
  inp.value='';inp.focus();
  inp.onkeydown=function(e){
    if(e.key==='Enter'){
      const code=inp.value.trim();
      if(code){
        closeScannerOverlay();
        const art=(state.articulos||[]).find(a=>a.codigo===code);
        if(art)promptTallaYAgregar(art.id);
        else notify('warning','⚠️','No encontrado','Código: '+code,{duration:3000});
      }
    }
  };
}
function closeScannerOverlay(){document.getElementById('scanner-overlay').classList.remove('active')}
function handlePOSScan(e){
  if(e.key==='Enter'){
    const val=e.target.value.trim();
    const art=(state.articulos||[]).find(a=>a.codigo===val);
    if(art){promptTallaYAgregar(art.id);e.target.value=''}
  }
}

// ===== RECEIPT PRINTING =====
function printReceipt(factura) {
  const emp = state.empresa || {};

  const logoHtml = emp.logoBase64
    ? `<img src="${emp.logoBase64}" style="max-width:180px;display:block;margin:0 auto 8px;filter:grayscale(1);">`
    : `<div style="font-family:Arial;font-size:18px;font-weight:900;text-align:center;letter-spacing:2px;margin-bottom:4px">${emp.nombre||'EON CLOTHING'}</div>`;

  const itemsList = factura.items || [];
  const subtotal = factura.subtotal || 0;
  const iva = factura.iva || 0;
  const flete = factura.flete || 0;
  const total = factura.total || (subtotal + iva + flete);
  const nombreCliente = factura.customer_name || factura.cliente || 'CLIENTE MOSTRADOR';
  const telefonoCliente = factura.customer_phone || factura.telefono || '';
  const ciudadCliente = factura.ciudad || '';
  const numeroFactura = factura.number || factura.numero || 'PREVIEW';
  const fecha = factura.fecha || today();
  const hora = new Date().toLocaleTimeString('es-CO', {hour:'2-digit',minute:'2-digit'});
  const metodo = factura.metodo || factura.metodoPago || 'Efectivo';
  const vendedora = emp.vendedora || '';
  const bodega = emp.nombreComercial || emp.nombre || '';

  const itemsHTML = itemsList.map(i => {
    const precio = i.price || i.precio || 0;
    const qty = i.qty || i.cantidad || 1;
    const nom = i.name || i.nombre || '';
    const ref = i.ref || i.codigo || '';
    const talla = i.talla || '';
    return `<tr>
      <td style="padding:3px 0;vertical-align:top;line-height:1.4;word-break:break-word;">
        <b>${nom}</b>${ref ? ' | '+ref : ''}${talla ? '<br>Talla: '+talla : ''}
      </td>
      <td style="text-align:center;vertical-align:top;padding:3px 4px;white-space:nowrap;">x${qty}</td>
      <td style="text-align:right;vertical-align:top;white-space:nowrap;"><b>${fmtN(precio*qty)}</b></td>
    </tr>`;
  }).join('');

  const receiptHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Courier New',Courier,monospace; font-size:11px; width:72mm; color:#000; }
    .center { text-align:center; }
    .bold { font-weight:bold; }
    .line { border-top:1px dashed #000; margin:5px 0; }
    table { width:100%; border-collapse:collapse; }
    th { font-size:10px; border-bottom:1px solid #000; padding:2px 0; text-align:left; }
    th:last-child, td:last-child { text-align:right; }
    th:nth-child(2), td:nth-child(2) { text-align:center; }
    .total-row td { font-size:13px; font-weight:900; padding-top:4px; }
    .small { font-size:9px; }
  </style></head><body>

  <div class="center">${logoHtml}</div>
  <div class="center bold" style="font-size:13px;">${emp.nombre||'EON CLOTHING'}</div>
  ${emp.nombreComercial && emp.nombreComercial !== emp.nombre ? `<div class="center">${emp.nombreComercial}</div>` : ''}
  <div class="center small">NIT: ${emp.nit||''} | ${emp.regimenFiscal||'Régimen ordinario No responsable de IVA'}</div>
  <div class="center small">${emp.departamento||''} / ${emp.ciudad||''} / ${emp.direccion||''}</div>
  <div class="center small">Teléfonos: ${emp.telefono||''}${emp.telefono2?' / '+emp.telefono2:''}</div>
  ${emp.email?`<div class="center small">Email: ${emp.email}</div>`:''}
  ${emp.web?`<div class="center small">Página web: ${emp.web}</div>`:''}

  <div class="line"></div>
  <div class="center bold" style="font-size:12px;">FACTURA DE VENTA</div>
  <div class="center bold">No.: ${numeroFactura}</div>
  <div class="center small">${emp.nombreComercial||emp.nombre||''}</div>
  <div class="center small">${fecha} ${hora}</div>

  ${emp.mensajeHeader ? `<div class="line"></div><div class="center small" style="white-space:pre-wrap;">${emp.mensajeHeader}</div>` : ''}

  <div class="line"></div>
  <div class="small">Cliente: <b>${nombreCliente}</b>${telefonoCliente?' | '+telefonoCliente:''}${factura.cedulaCliente||factura.cedula_cliente ? ' | CC: '+(factura.cedulaCliente||factura.cedula_cliente) : ''}${ciudadCliente?' | Ciudad: '+ciudadCliente:''}${factura.direccion ? ' | Dir: '+factura.direccion : ''}</div>
  ${vendedora?`<div class="small">Elaboró: ${vendedora}</div>`:''}
  ${bodega?`<div class="small">Vendedor: ${vendedora||''} | Bodega: ${bodega}</div>`:''}

  <div class="line"></div>
  <table>
    <thead><tr><th>DESCRIPCIÓN</th><th>CANT</th><th>TOTAL</th></tr></thead>
    <tbody>${itemsHTML}</tbody>
  </table>
  <div class="line"></div>

  <table>
    <tr><td>SUBTOTAL</td><td></td><td style="text-align:right">${fmtN(subtotal)}</td></tr>
    ${iva > 0 ? `<tr><td>IVA (19%)</td><td></td><td style="text-align:right">${fmtN(iva)}</td></tr>` : ''}
    ${flete > 0 ? `<tr><td>Flete</td><td></td><td style="text-align:right">${fmtN(flete)}</td></tr>` : ''}
    <tr class="total-row"><td colspan="2">TOTAL NETO</td><td style="text-align:right;font-size:14px;">${fmtN(total)}</td></tr>
  </table>
  <div class="line"></div>

  <div class="small bold">MEDIO DE PAGO:</div>
  <div class="small">${metodo}</div>

  ${emp.mensajePie ? `<div class="line"></div><div class="center small bold" style="white-space:pre-wrap;">${emp.mensajePie}</div>` : ''}
  ${emp.politicaDatos ? `<div class="line"></div><div class="center small" style="white-space:pre-wrap;">${emp.politicaDatos}</div>` : ''}
  ${emp.web ? `<div class="center small">${emp.web}</div>` : ''}
  ${emp.mensajeGarantias ? `<div class="line"></div><div class="center small" style="white-space:pre-wrap;font-style:italic;">${emp.mensajeGarantias}</div>` : ''}

  <div class="line"></div>
  <div class="center small">Factura generada por VentasHera ERP</div>

  </body></html>`;

  const pWin = window.open('', '_blank', 'width=380,height=750,scrollbars=yes');
  if(!pWin) { notify('warning','⚠️','Popup bloqueado','Permite popups para imprimir.',{duration:4000}); return; }
  pWin.document.write(receiptHTML);
  pWin.document.close();
  setTimeout(() => { pWin.print(); }, 600);
}
function previewReceipt(){
  const cart=state.pos_cart||[];if(cart.length===0){notify('warning','⚠️','Carrito vacío','Agrega productos primero.',{duration:3000});return}
  syncPOSFormState();
  const subtotal=cart.reduce((a,i)=>a+(i.precio*i.qty),0);
  const iva = posFormState.applyIva ? subtotal*0.19 : 0;
  const factura={numero:'PREVIEW',fecha:today(),cliente:document.getElementById('pos-cliente')?.value||'',telefono:document.getElementById('pos-telefono')?.value||'',items:cart,subtotal,iva,total:subtotal+iva,metodo:posFormState.metodo};
  printReceipt(factura);
}

function openCashDrawer(){
  try{
    const encoder=new TextEncoder();
    const cmd=new Uint8Array([27,112,0,25,250]);
    notify('success','🏧','Cajón','Comando enviado al cajón POS.',{duration:2000});
  }catch(e){notify('warning','⚠️','Cajón','No se pudo abrir el cajón.',{duration:3000})}
}

// ===================================================================
// ===== ARTÍCULOS / INVENTARIO =====
// ===================================================================
function renderArticulos(){
  const items=state.articulos||[];
  document.getElementById('articulos-content').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div class="search-bar" style="flex:1;max-width:400px;margin:0"><span class="search-icon">🔍</span><input type="text" id="art-search" placeholder="Buscar artículo..." oninput="renderArticulosList()"></div>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="openArticuloModal()">+ Nueva Prenda</button>
        <button class="btn btn-secondary btn-sm" onclick="importarDesdeCatalogo()" style="border-color:rgba(0,229,180,.3);color:var(--accent);">⬇️ Importar</button>
        ${(window.AppRepository?.SUPABASE_URL || (window.MERCADOLIBRE_SYNC_ENDPOINT || '').trim()) ? `<button class="btn btn-secondary btn-sm" onclick="bulkMercadoLibreSyncVisibleArticles()" title="Solo prendas ya visibles en catálogo web" style="border-color:rgba(255,200,80,.45);color:#e8b020;">🛒 ML: publicar visibles</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="showPage('config');setCfgTab('inventario')" title="Configurar categorías">⚙️ Categorías</button>
      </div>
    </div>
    <div class="card"><div class="card-title">CATÁLOGO DE PRENDAS (${items.length})</div>
      <div class="table-wrap"><table><thead><tr><th>Foto</th><th>Referencia</th><th>Nombre</th><th>Categoría</th><th>Título</th><th>Proveedor</th><th>P.Compra</th><th>P.Venta</th><th>Stock</th><th>Min</th><th></th></tr></thead><tbody id="art-tbody"></tbody></table></div>
    </div>`;
  renderArticulosList();
}

function renderArticulosList(){
  const search=(document.getElementById('art-search')?.value||'').toLowerCase();
  let items=(state.articulos||[]).filter(a=>(a.nombre+a.codigo+a.categoria).toLowerCase().includes(search));
  const artTbody = document.getElementById('art-tbody'); if(!artTbody) return;
  artTbody.innerHTML=items.map(a=>{
    const stock=getArticuloStock(a.id);const low=stock<=a.stockMinimo;
    const thumb = a.imagen ? `<div style="width:36px;height:36px;border-radius:8px;background:url('${a.imagen}') center/cover;border:1px solid var(--border)"></div>` : `<div style="font-size:24px">👙</div>`;
   const tituloLabel = {propia:'🏷️ Propia',contado:'💵 Contado',credito:'💳 Crédito'};
   return `<tr>
        <td style="width:50px">${thumb}</td>
        <td>${a.codigo || '—'}</td>
        <td style="font-weight:700">${a.nombre}</td>
        <td><span class="badge badge-info">${a.categoria || '—'}</span></td>
        <td>${a.tituloMercancia ? `<span class="badge badge-warn">${tituloLabel[a.tituloMercancia]||a.tituloMercancia}</span>` : '—'}</td>
        <td style="font-size:11px;color:var(--text2)">${a.proveedorNombre||'—'}</td>
        <td>${fmt(a.precioCompra)}</td>
        <td style="color:var(--accent); font-weight:700">${fmt(a.precioVenta)}</td>
        <td style="color:${low ? 'var(--red)' : 'var(--green)'}; font-weight:700">${stock}</td>
        <td>${a.stockMinimo}</td>
        <td>
          <div class="btn-group">
            <button class="btn btn-xs btn-secondary" onclick="generateProductQR('${a.id}')" title="Generar QR">📱 QR</button>
            <button class="btn btn-xs btn-secondary" onclick="openArticuloModal('${a.id}')" title="Editar">✏️</button>
            <button class="btn btn-xs btn-danger" onclick="deleteArticulo('${a.id}')" title="Eliminar">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');
}

async function deleteArticulo(id){
  const art = (state.articulos || []).find(a => a.id === id);
  if(!art) return;

  if(!confirm(`¿Eliminar "${art.nombre}"? Esta acción no se puede deshacer.`)) return;

  try {
    showLoadingOverlay('connecting');

    if (_sbConnected) {
      if (!supabaseClient || typeof supabaseClient.rpc !== 'function') {
        throw new Error('Supabase client no disponible para RPC delete_product_full');
      }
      const { error } = await supabaseClient.rpc('delete_product_full', { p_product_id: id });
      if (error) throw error;
    }

    state.articulos = (state.articulos || []).filter(a => a.id !== id);
    state.pos_cart = (state.pos_cart || []).filter(i => i.articuloId !== id);
    state.inv_movimientos = (state.inv_movimientos || []).filter(m => m.articuloId !== id);
    state.inv_ajustes = (state.inv_ajustes || []).filter(a => a.articuloId !== id);
    state.inv_traslados = (state.inv_traslados || []).filter(t => t.articuloId !== id);

    renderArticulosList();
    renderDashboard();
    updateNavBadges();

    showLoadingOverlay('hide');
    notify('success', '🗑️', 'Artículo eliminado', art.nombre, { duration: 2500 });
  } catch (err) {
    showLoadingOverlay('hide');
    console.error('deleteArticulo error:', err);
    notify('danger', '⚠️', 'Error eliminando artículo', err.message || 'Revisa consola', { duration: 5000 });
  }
}

/** Publica en Mercado Libre todas las prendas con «Mostrar en catálogo web» (misma API que al guardar con el checkbox ML). */
async function bulkMercadoLibreSyncVisibleArticles() {
  const mlEndpoint = getMercadoLibreSyncEndpoint();
  if (!mlEndpoint) {
    notify('warning', '🛒', 'Mercado Libre', 'Sin endpoint — revisa Supabase / repository.js.', { duration: 6000 });
    return;
  }
  if (typeof window.requestMercadoLibreSync !== 'function') {
    notify('danger', '🛒', 'Mercado Libre', 'mercadolibre.js no cargó.', { duration: 5000 });
    return;
  }
  const list = (state.articulos || []).filter((a) => normalizeVisibleFlag(a.mostrarEnWeb));
  if (!list.length) {
    notify('warning', '🛒', 'Mercado Libre', 'No hay prendas con «Mostrar en catálogo web» activo.', { duration: 6000 });
    return;
  }
  if (!confirm(`Se publicará en Mercado Libre ${list.length} prenda(s) ya visibles en el catálogo. Puede tardar varios minutos (pausa entre ítems). ¿Continuar?`)) return;
  showLoadingOverlay('connecting');
  let published = 0;
  let dryRun = 0;
  let failed = 0;
  const lines = [];
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const label = a.codigo || a.nombre || a.id;
    try {
      const mlRes = await window.requestMercadoLibreSync(a.id);
      if (mlRes && mlRes.skipped) {
        failed++;
        lines.push(`${label}: omitido (${mlRes.reason || '—'})`);
      } else if (mlRes && mlRes.dryRun) {
        dryRun++;
        lines.push(`${label}: modo prueba (sin publicar) — ${mlRes.message || 'revisa ML_ACCESS_TOKEN / categoría'}`);
      } else if (mlRes && mlRes.ok !== false) {
        published++;
        const link = mlRes.permalink || mlRes.itemId || '';
        if (link) lines.push(`${label}: ${link}`);
      } else {
        failed++;
        lines.push(`${label}: respuesta inesperada`);
      }
    } catch (e) {
      failed++;
      lines.push(`${label}: ${(e && e.message) || e}`);
    }
    await delay(650);
  }
  showLoadingOverlay('hide');
  const head = `Publicadas: ${published} · Sin publicar (dryRun): ${dryRun} · Error: ${failed}`;
  const detail = lines.length ? '\n' + lines.slice(0, 12).join('\n') + (lines.length > 12 ? '\n…' : '') : '';
  const tone = failed && !published && !dryRun ? 'danger' : failed || dryRun ? 'warning' : 'success';
  notify(tone, '🛒', 'Mercado Libre (lote)', head + detail, { duration: 14000 });
  console.log('[Mercado Libre lote]', { published, dryRun, failed, total: list.length });
}
  
// ===================================================================
// ===== MAQUETADOR PRO (MODO CATÁLOGO + ERP INTEGRADO) =====
// ===================================================================

function openArticuloModal(id){
    const art = id ? (state.articulos || []).find(a => a.id === id) : null;
    // Cargar imágenes existentes del artículo en la galería temporal
    // Load images: from state first, then from product_media if empty
    _tempGaleria = art ? [...(art.images || art.galeria || [])] : [];
    // If existing article has no images in state, try to fetch from product_media
    if(art && _tempGaleria.length === 0) {
      supabaseClient.from('product_media').select('url,is_cover').eq('product_id', art.id)
        .then(({data}) => {
          if(data && data.length > 0) {
            _tempGaleria = data.sort((a,b)=>(b.is_cover?1:0)-(a.is_cover?1:0)).map(m=>m.url);
            const artInState = state.articulos.find(a=>a.id===art.id);
            if(artInState) { artInState.images = _tempGaleria; artInState.imagen = _tempGaleria[0]||''; }
            renderGaleriaVisual();
          }
        }).catch(()=>{});
    }
    _portadaIndex = 0;
    window._galeriaModificada = false;
    // Flag para saber si es edición (preservar imágenes si no se tocan)
    window._editingArticuloId = id || null; 
    
    openModal(`
        <div class="modal-title" style="font-family:'Syne'; letter-spacing:1px;">🚀 MAQUETADOR DE PRENDA PROFESIONAL</div>
        <div style="max-height: 75vh; overflow-y: auto; padding-right: 10px; text-align:left;">
            
            <div style="background:rgba(255,255,255,0.03); padding:20px; border-radius:12px; border:1px solid var(--border); margin-bottom:20px;">
                <label class="form-label">📸 GALERÍA MULTIMEDIA</label>
                <div style="background:var(--bg); border:1px dashed var(--accent); padding:20px; text-align:center; border-radius:8px; position:relative; cursor:pointer;">
                    <span style="font-size:20px;">📤 Subir Fotos / Videos</span><br>
                    <span style="font-size:10px; opacity:0.6;">Toca la ⭐ para elegir la foto de portada.</span>
                    <input type="file" multiple accept="image/*,video/*" style="position:absolute; inset:0; opacity:0; cursor:pointer;" onchange="uploadGalleryImages(this)">
                </div>
                <div id="m-art-galeria-visual" style="display:flex; gap:10px; flex-wrap:wrap; margin-top:15px;"></div>
            </div>

            <div class="form-row">
                <div class="form-group"><label class="form-label">REFERENCIA (REF)</label><input class="form-control" id="m-art-codigo" value="${art?.codigo || ''}"></div>
                <div class="form-group"><label class="form-label">COLECCIÓN / TEMPORADA</label><input class="form-control" id="m-art-coleccion" value="${art?.coleccion || ''}" placeholder="Ej: Verano 2026"></div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Perfil de canal (maquetador)</label>
                    <select class="form-control" id="m-art-channel-profile" onchange="onMaquetadorChannelProfileChange()">
                        <option value="generic">Genérico (ERP)</option>
                        <option value="falabella">Falabella</option>
                    </select>
                </div>
            </div>
            <div id="falabella-requisitos-wrap" style="display:none;padding:14px;border-radius:10px;border:1px solid rgba(100,80,200,0.35);background:rgba(100,80,200,0.06);margin-bottom:16px;">
                <div style="font-weight:800;color:var(--accent);margin-bottom:10px;">Requisitos Falabella</div>
                <p style="font-size:10px;color:var(--text2);margin:0 0 10px;line-height:1.35;">Indica PrimaryCategory (ID numérico): las listas de moda se rellenan solas con las opciones autorizadas por Falabella (GetCategoryAttributes). También puedes pulsar «Cargar opciones». No uses valores que no aparezcan en el desplegable.</p>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Brand</label><input class="form-control" id="m-fal-brand" autocomplete="off" placeholder="GENERICO si no hay marcas aprobadas">
                      <p style="font-size:10px;color:var(--text2);margin:6px 0 0;line-height:1.35;">Solicita aprobación de marca en Seller Support para dejar de usar GENERICO.</p>
                      <span id="m-fal-badge-brand-fallback" style="display:none;font-size:10px;font-weight:700;margin-top:6px;padding:3px 8px;border-radius:6px;background:rgba(255,200,100,0.25);">Fallback aplicado (GENERICO · GetBrands vacío)</span>
                    </div>
                    <div class="form-group"><label class="form-label">Nombre (Falabella)</label><input class="form-control" id="m-fal-name" autocomplete="off"></div>
                </div>
                <div class="form-group"><label class="form-label">Descripción</label><textarea class="form-control" id="m-fal-desc" rows="2"></textarea></div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">PrimaryCategory (ID)</label><input class="form-control" id="m-fal-primary-cat" placeholder="ID numérico" autocomplete="off"></div>
                    <div class="form-group"><label class="form-label">Seller SKU</label><input class="form-control" id="m-fal-seller-sku" autocomplete="off"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Color</label><input class="form-control" id="m-fal-color" autocomplete="off"></div>
                    <div class="form-group"><label class="form-label">Color básico</label><input class="form-control" id="m-fal-color-basico" autocomplete="off"></div>
                    <div class="form-group"><label class="form-label">Talla</label><input class="form-control" id="m-fal-talla" autocomplete="off"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">ConditionType</label>
                        <select class="form-control" id="m-fal-condition"><option value="Nuevo">Nuevo</option><option value="Usado">Usado</option><option value="Reacondicionado">Reacondicionado</option></select>
                    </div>
                    <div class="form-group"><label class="form-label">Tax % (FACO)</label><input class="form-control" id="m-fal-tax" placeholder="19" autocomplete="off"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Paquete alto (cm)</label><input type="number" class="form-control" id="m-fal-pkg-h" min="1" step="1"></div>
                    <div class="form-group"><label class="form-label">Paquete ancho (cm)</label><input type="number" class="form-control" id="m-fal-pkg-w" min="1" step="1"></div>
                    <div class="form-group"><label class="form-label">Paquete largo (cm)</label><input type="number" class="form-control" id="m-fal-pkg-l" min="1" step="1"></div>
                    <div class="form-group"><label class="form-label">Peso (kg)</label><input type="number" class="form-control" id="m-fal-pkg-wt" min="0.01" step="0.01"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Tipo traje baño</label><select class="form-control" id="m-fal-tipo-traje"><option value="">— Seleccionar (opciones Falabella) —</option></select></div>
                    <div class="form-group"><label class="form-label">Material vestuario</label><select class="form-control" id="m-fal-material"><option value="">— Seleccionar (opciones Falabella) —</option></select></div>
                    <div class="form-group"><label class="form-label">Género vestuario</label><select class="form-control" id="m-fal-genero"><option value="">— Seleccionar (opciones Falabella) —</option></select></div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" style="width:100%;margin-bottom:8px" onclick="loadFalabellaCategoryOptionsIntoMaquetador()">📋 Cargar opciones desde categoría (GetCategoryAttributes)</button>
                <div class="form-row" style="align-items:center;gap:10px;margin:8px 0;">
                  <span id="m-fal-badge-state" style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;display:inline-block;background:rgba(255,180,80,0.2);">Borrador</span>
                  <span id="m-fal-badge-blocked" style="font-size:10px;color:var(--danger, #f87171);display:none;">Sync bloqueado por validación</span>
                </div>
                <div id="m-fal-preflight-panel" style="margin-bottom:10px;padding:10px;border-radius:8px;border:1px solid rgba(100,80,200,0.25);background:rgba(0,0,0,0.12);">
                  <div style="font-weight:700;font-size:11px;margin-bottom:8px;color:var(--accent);">Preflight (checklist final)</div>
                  <p style="font-size:10px;color:var(--text2);margin:0 0 8px;line-height:1.35;">Valida contra GetBrands, atributos de categoría (vía API) y mapeo parent/child (GetMappedAttributeOptions). Marca no listada: usar <strong>GENERICO</strong> o alta en Seller Center.</p>
                  <div id="m-fal-preflight-checklist" style="font-size:11px;line-height:1.5;"></div>
                  <button type="button" class="btn btn-secondary btn-sm" style="width:100%;margin-top:8px" onclick="runFalabellaPreflightInModal()">✓ Verificar con Seller Center (preflight)</button>
                </div>
                <div id="m-fal-inline-errors" style="font-size:11px;color:var(--danger, #f87171);line-height:1.35;min-height:1em;"></div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">SECCIÓN WEB</label>
                    <select class="form-control" id="m-art-seccion" onchange="actualizarCatsERP()">
                        ${(state.cfg_secciones && state.cfg_secciones.length > 0
                          ? state.cfg_secciones
                          : [{nombre:'Trajes de Baño'},{nombre:'Resort & Pijamas'},{nombre:'Activewear'},{nombre:'Casual'}]
                        ).map(s => `<option value="${s.nombre}" ${art?.seccion === s.nombre ? 'selected' : ''}>${s.nombre}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label class="form-label">CATEGORÍA</label><select class="form-control" id="m-art-cat"></select></div>
            </div>

            <div class="form-group"><label class="form-label">NOMBRE COMERCIAL</label><input class="form-control" id="m-art-nombre" value="${art?.nombre || ''}"></div>
            <div class="form-group"><label class="form-label">DESCRIPCIÓN (Para el Catálogo)</label><textarea class="form-control" id="m-art-desc" rows="2">${art?.descripcion || ''}</textarea></div>

            <div class="form-row">
                <div class="form-group"><label class="form-label">TALLAS</label><input class="form-control" id="m-art-tallas" value="${art?.tallas || (art ? '' : 'S, M, L, XL')}"></div>
                <div class="form-group"><label class="form-label">COLORES</label><input class="form-control" id="m-art-colores" value="${art ? (art.colores||art.colors?.join(', ')||'') : ''}"></div>
            </div>

            <div class="form-group"><label class="form-label">TÍTULO DE MERCANCÍA</label>
                    <select class="form-control" id="m-art-titulo-mercancia">
                        <option value="" ${!art?.tituloMercancia ? 'selected' : ''}>— Seleccionar —</option>
                        <option value="propia" ${art?.tituloMercancia === 'propia' ? 'selected' : ''}>🏷️ Mercancía Propia</option>
                        <option value="contado" ${art?.tituloMercancia === 'contado' ? 'selected' : ''}>💵 Mercancía de Contado</option>
                        <option value="credito" ${art?.tituloMercancia === 'credito' ? 'selected' : ''}>💳 Mercancía a Crédito</option>
                    </select>
                </div>

            <div class="card-title" style="margin-top:10px; border-top:1px solid var(--border); padding-top:15px; color:var(--accent);">💰 INVENTARIO Y PRECIOS</div>
            <div class="form-row-3">
                <div class="form-group"><label class="form-label">COSTO</label><input type="number" class="form-control" id="m-art-pc" value="${art?.precioCompra || 0}"></div>
                <div class="form-group"><label class="form-label">P. MAYORISTA</label><input type="number" class="form-control" id="m-art-pv" value="${art?.precioVenta || 0}"></div>
                <div class="form-group"><label class="form-label">IVA %</label><input type="number" class="form-control" id="m-art-iva" value="${art?.iva ?? 19}"></div>
            </div>
            <div class="form-group"><label class="form-label">🏭 PROVEEDOR</label>
                <select class="form-control" id="m-art-proveedor">
                    <option value="">— Sin proveedor —</option>
                    ${(state.usu_proveedores||[]).map(p => `<option value="${p.id}" ${art?.proveedorId === p.id ? 'selected' : ''}>${p.nombre}${p.cedula ? ' · ' + p.cedula : ''}</option>`).join('')}
                </select>
                ${(state.usu_proveedores||[]).length === 0 ? '<span style="font-size:10px;color:var(--text2)">Sin proveedores. <a onclick="closeModal();showPage(\'usu_proveedores\')" style="color:var(--accent);cursor:pointer">→ Crear proveedor</a></span>' : ''}
            </div>
            <div class="form-group" style="margin-top: 15px; padding: 10px; background: rgba(0,255,170,0.1); border-radius: 8px;">
  <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text1); font-weight: bold;">
    <input type="checkbox" id="art-mostrar-web" style="width: 18px; height: 18px;"> 
    🌐 Mostrar esta prenda en el Catálogo Web (Supabase)
  </label>
</div>
${(window.AppRepository?.SUPABASE_URL || (window.MERCADOLIBRE_SYNC_ENDPOINT || '').trim()) ? `
            <div class="form-group" data-integration-channel="mercadolibre" style="margin-top: 8px; padding: 10px; background: rgba(255,230,120,0.12); border-radius: 8px; border: 1px solid rgba(255,200,80,0.35);">
  <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text1); font-weight: bold;">
    <input type="checkbox" id="art-sync-mercadolibre" style="width: 18px; height: 18px;">
    🛒 Publicar en Mercado Libre al guardar
  </label>
  <div id="art-sync-mercadolibre-hint" style="display:none;font-size:11px;color:var(--accent);margin-top:6px;margin-left:28px;line-height:1.3;"></div>
</div>` : ''}
${(window.AppRepository?.SUPABASE_URL || (window.META_COMMERCE_SYNC_ENDPOINT || '').trim()) ? `
            <div class="form-group" data-integration-channel="meta-commerce" style="margin-top: 8px; padding: 10px; background: rgba(120,160,255,0.1); border-radius: 8px; border: 1px solid rgba(100,140,255,0.35);">
  <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text1); font-weight: bold;">
    <input type="checkbox" id="art-sync-meta-commerce" style="width: 18px; height: 18px;">
    📱 Meta (Facebook / Instagram) al guardar
  </label>
  <div id="art-sync-meta-commerce-hint" style="display:none;font-size:11px;color:var(--accent);margin-top:6px;margin-left:28px;line-height:1.3;"></div>
</div>` : ''}
${(window.AppRepository?.SUPABASE_URL || (window.GOOGLE_MERCHANT_SYNC_ENDPOINT || '').trim()) ? `
            <div class="form-group" data-integration-channel="google-merchant" style="margin-top: 8px; padding: 10px; background: rgba(255,255,255,0.06); border-radius: 8px; border: 1px solid rgba(66,133,244,0.45);">
  <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text1); font-weight: bold;">
    <input type="checkbox" id="art-sync-google-merchant" style="width: 18px; height: 18px;">
    🔍 Google Merchant al guardar
  </label>
  <div id="art-sync-google-merchant-hint" style="display:none;font-size:11px;color:var(--accent);margin-top:6px;margin-left:28px;line-height:1.3;"></div>
</div>` : ''}
${(window.AppRepository?.SUPABASE_URL || (window.PINTEREST_CATALOG_SYNC_ENDPOINT || '').trim()) ? `
            <div class="form-group" data-integration-channel="pinterest-catalog" style="margin-top: 8px; padding: 10px; background: rgba(230,0,35,0.08); border-radius: 8px; border: 1px solid rgba(230,0,35,0.35);">
  <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text1); font-weight: bold;">
    <input type="checkbox" id="art-sync-pinterest-catalog" style="width: 18px; height: 18px;">
    📌 Pinterest (catálogo) al guardar
  </label>
  <div id="art-sync-pinterest-catalog-hint" style="display:none;font-size:11px;color:var(--accent);margin-top:6px;margin-left:28px;line-height:1.3;"></div>
</div>` : ''}
${(window.AppRepository?.SUPABASE_URL || (window.DROPI_SYNC_ENDPOINT || '').trim()) ? `
            <div class="form-group" data-integration-channel="dropi" style="margin-top: 8px; padding: 10px; background: rgba(80,200,160,0.1); border-radius: 8px; border: 1px solid rgba(60,180,140,0.35);">
  <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text1); font-weight: bold;">
    <input type="checkbox" id="art-sync-dropi" style="width: 18px; height: 18px;">
    📦 Dropi al guardar
  </label>
  <div style="font-size:11px;color:var(--text2);margin:4px 0 0 28px;line-height:1.35;">Se envía aunque el artículo esté oculto en tu catálogo web.</div>
</div>` : ''}
${(window.AppRepository?.SUPABASE_URL || (window.RAPPI_SYNC_ENDPOINT || '').trim()) ? `
            <div class="form-group" data-integration-channel="rappi" style="margin-top: 8px; padding: 10px; background: rgba(255,140,80,0.1); border-radius: 8px; border: 1px solid rgba(255,120,60,0.35);">
  <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text1); font-weight: bold;">
    <input type="checkbox" id="art-sync-rappi" style="width: 18px; height: 18px;">
    🛵 Rappi al guardar
  </label>
  <div style="font-size:11px;color:var(--text2);margin:4px 0 0 28px;line-height:1.35;">Se envía aunque el artículo esté oculto en tu catálogo web.</div>
</div>` : ''}
${(window.AppRepository?.SUPABASE_URL || (window.FALABELLA_SYNC_ENDPOINT || '').trim()) ? `
            <div class="form-group" data-integration-channel="falabella" style="margin-top: 8px; padding: 10px; background: rgba(100,80,200,0.1); border-radius: 8px; border: 1px solid rgba(100,80,200,0.35);">
  <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text1); font-weight: bold;">
    <input type="checkbox" id="art-sync-falabella" style="width: 18px; height: 18px;">
    🏬 Falabella Seller Center al guardar
  </label>
  <div style="font-size:11px;color:var(--text2);margin:4px 0 0 28px;line-height:1.35;">No requiere «mostrar en catálogo web»; el feed puede enviarse con el producto oculto en tu sitio.</div>
  <div id="art-sync-falabella-hint" style="display:none;font-size:11px;color:var(--accent);margin-top:6px;margin-left:28px;line-height:1.3;"></div>
  <div id="art-falabella-status-line" style="display:none;font-size:10px;margin-top:8px;line-height:1.35;"></div>
  ${id ? `<button type="button" class="btn btn-secondary btn-sm" style="margin-top:10px;width:100%" onclick="reenviarFalabellaFeedModal()">🔄 Reenviar feed a Falabella</button>
  <button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;width:100%" onclick="verFalabellaAtributosCategoriaModal()">📋 Atributos de categoría (Falabella API)</button>
  <button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;width:100%" onclick="pushFalabellaPrecioStockModal()">💲 Actualizar precio y stock (Falabella)</button>
  <div style="font-size:10px;color:var(--text2);margin-top:4px;line-height:1.35;">Alta = sync al guardar. Luego usa «Actualizar precio y stock» para ProductUpdate (mismo SKU). «Atributos» = GetCategoryAttributes.</div>` : `<div style="font-size:10px;color:var(--text2);margin-top:8px;line-height:1.35;">Tras guardar el artículo podrás reenviar el feed, actualizar precio/stock y consultar atributos.</div>`}
</div>` : ''}

            <div class="form-row">
                <div class="form-group"><label class="form-label">BODEGA</label><select class="form-control" id="m-art-bodega">${(state.bodegas || []).map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
                <div class="form-group">
                  <label class="form-label">${art ? 'STOCK ACTUAL' : 'STOCK INICIAL'}</label>
                  <input type="number" class="form-control" id="m-art-stock0"
                    value="${art ? (art.stock||0) : 0}"
                    ${art ? 'readonly style="opacity:0.5;cursor:not-allowed"' : 'min="0"'}>
                  ${art ? '<div style="font-size:10px;color:var(--text2);margin-top:3px">Para ajustar el stock usa: Inventario → Ajustes</div>' : ''}
                </div>
            </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:15px;">
        <button type="button" class="btn btn-primary" id="m-art-btn-save" style="width:100%; font-weight:800;" onclick="saveArticulo('${id || ''}', {})">💾 GUARDAR Y ACTUALIZAR WEB</button>
        <button type="button" class="btn btn-secondary btn-sm" id="m-art-btn-save-draft" style="width:100%;" onclick="saveArticulo('${id || ''}', { draftOnly: true })">📄 Guardar borrador Falabella (sin sync)</button>
        </div>
    `, true);
  setTimeout(() => {
    document.getElementById('art-mostrar-web').checked = art ? normalizeVisibleFlag(art.mostrarEnWeb) : true;
    applyIntegrationChannelListedState(art);
    updateFalabellaStatusLineInModal(art);
    const chProf = document.getElementById('m-art-channel-profile');
    if (chProf) {
      chProf.value = art?.falabellaProductDataJson?.channelProfile === 'falabella' ? 'falabella' : 'generic';
    }
    applyFalabellaDraftToMaquetadorFields(art || {});
    onMaquetadorChannelProfileChange();
    wireFalabellaMaquetadorInputs();
    window._falabellaCategoryIndexed = null;
    refreshFalabellaMaquetadorValidation();
    scheduleFalabellaModaOptionsFromCategory();
  }, 10);
    actualizarCatsERP(art?.cat);
    renderGaleriaVisual();
}

function removeMainImg(){
    document.getElementById('m-art-img-preview-container').style.display = 'none';
}

function renderGaleriaVisual(){
    const container = document.getElementById('m-art-galeria-visual');
    if(!container) return;
    container.innerHTML = _tempGaleria.map((url, idx) => {
        const esVideo = url.split('?')[0].toLowerCase().match(/\.(mp4|mov|webm|avi)$/);
        const media = esVideo 
            ? `<video src="${url}" style="width:100%; height:100%; object-fit:cover;"></video>`
            : `<img src="${url}" style="width:100%; height:100%; object-fit:cover;">`;
        return `
            <div style="position:relative; width:72px; height:96px; border-radius:6px; overflow:hidden; border:2px solid ${idx === _portadaIndex ? 'var(--accent)' : 'transparent'}; cursor:pointer;" onclick="_portadaIndex=${idx}; window._galeriaModificada=true; renderGaleriaVisual();">
                ${media}
                <button class="btn-danger" style="position:absolute; top:2px; right:2px; width:18px; height:18px; border-radius:50%; border:none; font-size:9px;" onclick="event.stopPropagation(); _tempGaleria.splice(${idx},1); window._galeriaModificada=true; if(_portadaIndex>=${idx})_portadaIndex=0; renderGaleriaVisual();">✕</button>
                <div style="position:absolute; bottom:2px; left:2px; background:${idx === _portadaIndex ? 'var(--accent)' : 'rgba(0,0,0,0.5)'}; color:#000; border-radius:50%; width:18px; height:18px; display:flex; align-items:center; justify-content:center; font-size:10px;">⭐</div>
            </div>`;
    }).join('');
}

function actualizarCatsERP(selectedCat){
    const sec = document.getElementById('m-art-seccion').value;
    const cat = document.getElementById('m-art-cat');

    // ★ Usar categorías del ERP (cfg_categorias) si están disponibles
    const cfgCats = (state.cfg_categorias || []).filter(c => c.seccion === sec);
    let opciones = [];
    if(cfgCats.length > 0) {
      opciones = cfgCats.map(c => c.nombre);
    } else {
      // Fallback hardcoded
      if(sec === 'Trajes de Baño') opciones = ['Enterizos','Bikinis','Tankinis','Asoleadores','Salidas de Baño','3 Piezas'];
      else if(sec === 'Pijamas' || sec === 'Resort & Pijamas') opciones = ['Batas','Pantalones Largos','Shorts','Sets 2 Piezas'];
      else if(sec === 'Ropa Deportiva' || sec === 'Activewear') opciones = ['Leggings','Tops','Conjuntos'];
      else opciones = ['Vestidos','Faldas','Tops','Pantalones'];
    }

    cat.innerHTML = opciones.map(o => `<option value="${o}" ${selectedCat === o ? 'selected' : ''}>${o}</option>`).join('');
}

async function compressToWebP(file, maxWidth = 1080, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
          const webpFile = new File([blob], newName, { type: "image/webp" });
          resolve(webpFile);
        }, 'image/webp', quality);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

async function uploadGalleryImages(input) {
  const files = input.files;
  if (!files.length) return;

  showLoadingOverlay('connecting');

  try {
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      if (_tempGaleria.length >= 15) break;
      let file = files[i];

      if (file.type.startsWith('image/')) {
        file = await compressToWebP(file, 1080, 0.8);
      }

      const safeName = file.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
      const fileName = `products/temp/${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabaseClient.storage
        .from('Catalog-media')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabaseClient.storage
        .from('Catalog-media')
        .getPublicUrl(fileName);

      _tempGaleria.push(publicUrl);
      window._galeriaModificada = true;
      added++;
    }

    renderGaleriaVisual();
    showLoadingOverlay('hide');
    notify('success', '📸', 'Completado', `Subidos ${added} archivos.`);

  } catch (e) {
    showLoadingOverlay('hide');
    notify('danger', '⚠️', 'Error', e.message);
  }
}
async function saveArticulo(existingId, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const nombre = document.getElementById('m-art-nombre').value.trim();
    const refID = document.getElementById('m-art-codigo').value.trim().toUpperCase();
    
    if(!nombre || !refID) return alert('Nombre y Referencia son obligatorios.');

    const channelProfile = document.getElementById('m-art-channel-profile')?.value || 'generic';
    window.__suppressFalabellaSyncThisSave = false;

    // Preparamos el objeto EXACTO para la tabla 'products' de Supabase
    const tituloMercancia = document.getElementById('m-art-titulo-mercancia')?.value || '';
    const proveedorId = document.getElementById('m-art-proveedor')?.value || null;
    const proveedorObj = proveedorId ? (state.usu_proveedores||[]).find(p=>p.id===proveedorId) : null;

    if (tituloMercancia === 'credito' && !proveedorId) {
      alert('La mercancía a crédito requiere un proveedor creado y seleccionado. Créelo en Usuarios → Proveedores si no existe.');
      return;
    }

    const chkCatalogo = document.getElementById('art-mostrar-web');
    const catalogVisibleBool = normalizeVisibleFlag(!!(chkCatalogo && chkCatalogo.checked));

    const tallasStr = document.getElementById('m-art-tallas')?.value || '';
    const coloresStr = document.getElementById('m-art-colores')?.value || '';
    const colorsArr = coloresStr.split(',').map((c) => c.trim()).filter(Boolean);

    let falabella_product_data_json = {};
    if (existingId) {
      const prevFj = (state.articulos || []).find((a) => a.id === existingId)?.falabellaProductDataJson;
      if (prevFj && typeof prevFj === 'object') falabella_product_data_json = { ...prevFj };
    }
    if (channelProfile === 'falabella' && window.FalabellaMaquetador) {
      falabella_product_data_json = {
        ...falabella_product_data_json,
        channelProfile: 'falabella',
        falabellaDraft: window.FalabellaMaquetador.collectDraftFromDom(),
      };
    } else {
      falabella_product_data_json = { ...falabella_product_data_json, channelProfile: 'generic' };
    }

    const productData = {
        id: existingId || dbId(),
        ref: refID,
        name: nombre,
        seccion: document.getElementById('m-art-seccion').value,
        categoria: document.getElementById('m-art-cat').value,
        description: document.getElementById('m-art-desc').value.trim(),
        price: parseFloat(document.getElementById('m-art-pv').value) || 0,
        cost: parseFloat(document.getElementById('m-art-pc').value) || 0,
        // Nuevo producto: usa el stock inicial del formulario
        // Producto existente: mantiene el stock actual (no sobreescribir)
        stock: existingId
          ? ((state.articulos||[]).find(a=>a.id===existingId)?.stock || 0)
          : (parseInt(document.getElementById('m-art-stock0').value) || 0),
        active: true,
        visible: catalogVisibleBool,
        titulo_mercancia: tituloMercancia || null,
        proveedor_id: proveedorId || null,
        proveedor_nombre: proveedorObj?.nombre || null,
        sizes: tallasStr,
        colors: JSON.stringify(colorsArr),
        falabella_product_data_json: falabella_product_data_json,
        updated_at: new Date().toISOString()
    };

    const productId = productData.id;

    try {
        showLoadingOverlay('connecting');
        
        // 1. UPSERT del producto
        const { error } = await supabaseClient
            .from('products')
            .upsert(productData, { onConflict: 'id' });
        if (error) throw error;

        // 1a. Forzar columna visible (evita que quede true si el upsert no aplicó false; catálogo web debe consultar visible=true)
        const { error: visUpdErr } = await supabaseClient
            .from('products')
            .update({ visible: catalogVisibleBool })
            .eq('id', productId);
        if (visUpdErr) console.warn('[saveArticulo] actualizar visible:', visUpdErr.message);

        // 1b. Solo en alta: stock inicial → un inv_ajuste. En edición el stock del modal es solo lectura
        // (no insertar otra entrada en cada guardado: inflaba inv_ajustes y tes_abonos_prov a crédito).
        const stockInicial = parseInt(document.getElementById('m-art-stock0')?.value)||0;
        if (!existingId && stockInicial > 0) {
          const ajId = dbId();
          try {
            await supabaseClient.from('inv_ajustes').insert({
              id: ajId, articulo_id: productId, bodega_id: 'bodega_main',
              tipo: 'entrada', cantidad: stockInicial,
              motivo: 'Stock inicial al crear artículo',
              fecha: today()
            });
            if(!state.inv_ajustes) state.inv_ajustes = [];
            state.inv_ajustes.push({id:ajId, articuloId:productId, bodegaId:'bodega_main',
              tipo:'entrada', cantidad:stockInicial,
              motivo: 'Stock inicial', fecha:today()});
            if(!state.inv_movimientos) state.inv_movimientos = [];
            state.inv_movimientos.push({id:'aj_'+ajId, articuloId:productId,
              bodegaId:'bodega_main', cantidad:stockInicial, tipo:'ajuste_entrada',
              fecha:today(), referencia:'Ajuste', nota:'Stock inicial'});
          } catch(e) { console.warn('inv_ajuste stock error:', e.message); }
        }

        // 2. MANEJAR IMÁGENES en product_media - solo si hubo cambios reales
        if(window._galeriaModificada || !existingId) {
          // Obtener imágenes actuales en BD
          const { data: existingMedia } = await supabaseClient
            .from('product_media')
            .select('id, url, is_cover')
            .eq('product_id', productId);

          const existingUrls = (existingMedia||[]).map(m => m.url);
          const newUrls = _tempGaleria;

          // Eliminar las que ya no están en _tempGaleria
          const toDelete = (existingMedia||[]).filter(m => !newUrls.includes(m.url));
          for(const m of toDelete) {
            await supabaseClient.from('product_media').delete().eq('id', m.id);
          }

          // Insertar las nuevas (que no existían antes)
          const toInsert = newUrls.filter(url => !existingUrls.includes(url));
          for(let i = 0; i < toInsert.length; i++) {
            const url = toInsert[i];
            const isCover = newUrls.indexOf(url) === _portadaIndex;
            await supabaseClient.from('product_media').insert({
              product_id: productId,
              url: url,
              is_cover: isCover
            });
          }

          // Actualizar is_cover si cambió la portada
          if(existingMedia && existingMedia.length > 0) {
            const coverUrl = newUrls[_portadaIndex];
            for(const m of existingMedia) {
              const shouldBeCover = m.url === coverUrl;
              if(m.is_cover !== shouldBeCover) {
                await supabaseClient.from('product_media')
                  .update({ is_cover: shouldBeCover })
                  .eq('id', m.id);
              }
            }
          }
        }

        // 3. GUARDAR TALLAS en product_sizes
        if(tallasStr.trim()) {
          // Borrar tallas anteriores
          await supabaseClient.from('product_sizes').delete().eq('product_id', productId);
          // Insertar nuevas
          for(const tallaLabel of tallasStr.split(',').map(t=>t.trim()).filter(Boolean)) {
            let { data: size } = await supabaseClient.from('sizes').select('id').eq('label', tallaLabel).single();
            if(!size) {
              const { data: ns } = await supabaseClient.from('sizes').insert([{label: tallaLabel}]).select().single();
              size = ns;
            }
            if(size) await supabaseClient.from('product_sizes').insert([{product_id: productId, size_id: size.id}]);
          }
        }

        // 4. GUARDAR COLORES en product_colors
        if(coloresStr.trim()) {
          // Borrar colores anteriores
          await supabaseClient.from('product_colors').delete().eq('product_id', productId);
          // Insertar nuevos
          for(const colorLabel of coloresStr.split(',').map(c=>c.trim()).filter(Boolean)) {
            let { data: color } = await supabaseClient.from('colors').select('id').eq('label', colorLabel).single();
            if(!color) {
              const { data: nc } = await supabaseClient.from('colors').insert([{code: colorLabel.toLowerCase().replace(/\s+/g,'_'), label: colorLabel}]).select().single();
              color = nc;
            }
            if(color) await supabaseClient.from('product_colors').insert([{product_id: productId, color_id: color.id}]);
          }
        }

        if (opts.draftOnly) {
          window.__suppressFalabellaSyncThisSave = true;
        } else if (
          channelProfile === 'falabella' &&
          document.getElementById('art-sync-falabella')?.checked &&
          window.FalabellaMaquetador
        ) {
          const draftV = window.FalabellaMaquetador.collectDraftFromDom();
          const v0 = window.FalabellaMaquetador.validateDraft(draftV, { buFac: true });
          let errsV = (v0.errors || []).slice();
          const idxV = window._falabellaCategoryIndexed;
          if (idxV && idxV.byFeedName) {
            errsV = errsV.concat(window.FalabellaMaquetador.validateOptionFields(draftV, idxV).errors || []);
            errsV = errsV.concat(
              window.FalabellaMaquetador.validateVariationAgainstCategoryOptions(draftV, idxV).errors || [],
            );
          }
          if (errsV.length) {
            window.__suppressFalabellaSyncThisSave = true;
            const falChkUn = document.getElementById('art-sync-falabella');
            if (falChkUn) falChkUn.checked = false;
            notify(
              'warning',
              '🏬',
              'Falabella',
              `Producto guardado; sincronización Falabella omitida (${errsV.length} pendiente(s)). Completa requisitos, Preflight o usa «Guardar borrador».`,
              { duration: 12000 },
            );
          }
        }

        const mlR = await postSaveMercadoLibreIntegration(productId, catalogVisibleBool);
        const metaR = await postSaveMetaCommerceIntegration(productId, catalogVisibleBool);
        const googleR = await postSaveGoogleMerchantIntegration(productId, catalogVisibleBool);
        const pinR = await postSavePinterestCatalogIntegration(productId, catalogVisibleBool);
        const integrationPatch = Object.assign({}, mlR.patch, metaR.patch, googleR.patch, pinR.patch);
        if (Object.keys(integrationPatch).length && supabaseClient) {
          try {
            const { error: intErr } = await supabaseClient.from('products').update(integrationPatch).eq('id', productId);
            if (intErr) console.warn('[integrations] persist ids:', intErr.message);
          } catch (e) {
            console.warn('[integrations] persist ids:', e);
          }
        }
        const mlNote = mlR.note || '';
        const metaNote = metaR.note || '';
        const googleNote = googleR.note || '';
        const pinterestNote = pinR.note || '';
        const dropiNote = await postSaveDropiIntegration(productId, catalogVisibleBool);
        const rappiNote = await postSaveRappiIntegration(productId, catalogVisibleBool);
        const falabellaResult = await postSaveFalabellaIntegration(productId);
        const falabellaNote = falabellaResult && typeof falabellaResult.note === 'string' ? falabellaResult.note : '';
        if (falabellaResult && falabellaResult.falabellaPatch) {
          const patch = falabellaResult.falabellaPatch;
          const row = {};
          if (patch.falabellaSyncStatus != null) row.falabella_sync_status = patch.falabellaSyncStatus;
          if (patch.falabellaSellerSku != null) row.falabella_seller_sku = patch.falabellaSellerSku;
          if (patch.falabellaFeedRequestId != null) row.falabella_feed_request_id = patch.falabellaFeedRequestId;
          if (patch.falabellaPrimaryCategoryId != null) row.falabella_primary_category_id = patch.falabellaPrimaryCategoryId;
          if (patch.falabellaLastError != null) row.falabella_last_error = patch.falabellaLastError;
          if (patch.falabellaLastSyncAt != null) row.falabella_last_sync_at = patch.falabellaLastSyncAt;
          if (patch.falabellaFeedStatus != null) row.falabella_feed_status = patch.falabellaFeedStatus;
          if (patch.falabellaSyncAuditJson != null && typeof patch.falabellaSyncAuditJson === 'object') {
            row.falabella_sync_audit_json = patch.falabellaSyncAuditJson;
          }
          try {
            const { error: falUpdErr } = await supabaseClient.from('products').update(row).eq('id', productId);
            if (falUpdErr) console.warn('[Falabella] persist:', falUpdErr.message);
          } catch (e) {
            console.warn('[Falabella] persist:', e);
          }
        }

        // 5. Actualizar state local inmediatamente
        const artIdx = state.articulos.findIndex(a => a.id === productId);
        const prevArt = artIdx >= 0 ? state.articulos[artIdx] : {};
        const falabellaPatch = falabellaResult && falabellaResult.falabellaPatch ? falabellaResult.falabellaPatch : null;
        const artLocal = {
          id: productId, codigo: refID, ref: refID, nombre: nombre, name: nombre,
          categoria: productData.categoria, seccion: productData.seccion,
          descripcion: productData.description,
          precioVenta: productData.price, price: productData.price,
          precioCompra: productData.cost,
          tallas: tallasStr, sizes: tallasStr,
          colores: coloresStr, colors: coloresStr.split(',').map(c=>c.trim()).filter(Boolean),
          images: window._galeriaModificada ? _tempGaleria : (existingId ? ((state.articulos.find(a=>a.id===productId)||{}).images || _tempGaleria) : _tempGaleria),
          imagen: window._galeriaModificada ? (_tempGaleria[_portadaIndex]||_tempGaleria[0]||'') : (existingId ? ((state.articulos.find(a=>a.id===productId)||{}).imagen || _tempGaleria[0] || '') : (_tempGaleria[_portadaIndex]||_tempGaleria[0]||'')),
          stock: productData.stock, stockMinimo: 0,
          activo: true, mostrarEnWeb: catalogVisibleBool,
          tituloMercancia: tituloMercancia,
          proveedorId: proveedorId||null, proveedorNombre: proveedorObj?.nombre||'',
          falabellaProductDataJson:
            falabella_product_data_json && typeof falabella_product_data_json === 'object'
              ? falabella_product_data_json
              : prevArt.falabellaProductDataJson && typeof prevArt.falabellaProductDataJson === 'object'
                ? prevArt.falabellaProductDataJson
                : {},
          falabellaSellerSku: falabellaPatch ? (falabellaPatch.falabellaSellerSku ?? prevArt.falabellaSellerSku) : (prevArt.falabellaSellerSku || ''),
          falabellaFeedRequestId: falabellaPatch ? (falabellaPatch.falabellaFeedRequestId ?? prevArt.falabellaFeedRequestId) : (prevArt.falabellaFeedRequestId || ''),
          falabellaSyncStatus: falabellaPatch ? (falabellaPatch.falabellaSyncStatus ?? prevArt.falabellaSyncStatus) : (prevArt.falabellaSyncStatus || ''),
          falabellaLastError: falabellaPatch ? (falabellaPatch.falabellaLastError ?? prevArt.falabellaLastError) : (prevArt.falabellaLastError || ''),
          falabellaLastSyncAt: falabellaPatch ? (falabellaPatch.falabellaLastSyncAt ?? prevArt.falabellaLastSyncAt) : (prevArt.falabellaLastSyncAt || null),
          falabellaPrimaryCategoryId: falabellaPatch ? (falabellaPatch.falabellaPrimaryCategoryId ?? prevArt.falabellaPrimaryCategoryId) : (prevArt.falabellaPrimaryCategoryId || ''),
          falabellaFeedStatus: falabellaPatch ? (falabellaPatch.falabellaFeedStatus ?? prevArt.falabellaFeedStatus) : (prevArt.falabellaFeedStatus || ''),
          mercadolibreItemId:
            integrationPatch.mercadolibre_item_id != null
              ? String(integrationPatch.mercadolibre_item_id)
              : prevArt.mercadolibreItemId || '',
          metaCommerceRetailerId:
            integrationPatch.meta_commerce_retailer_id != null
              ? String(integrationPatch.meta_commerce_retailer_id)
              : prevArt.metaCommerceRetailerId || '',
          googleMerchantOfferId:
            integrationPatch.google_merchant_offer_id != null
              ? String(integrationPatch.google_merchant_offer_id)
              : prevArt.googleMerchantOfferId || '',
          pinterestCatalogItemId:
            integrationPatch.pinterest_catalog_item_id != null
              ? String(integrationPatch.pinterest_catalog_item_id)
              : prevArt.pinterestCatalogItemId || ''
        };
        if(artIdx >= 0) state.articulos[artIdx] = artLocal;
        else state.articulos.push(artLocal);

        // ===== Deuda proveedor: detectar transición no-deuda -> deuda (idempotente) =====
        const esCredito = (t) =>
          typeof window.esMercanciaCredito === 'function'
            ? window.esMercanciaCredito(t)
            : String(t || '').trim().toLowerCase() === 'credito';
        const elig = (a) => {
          const pc = parseFloat(a?.precioCompra ?? a?.cost ?? 0) || 0;
          const st = parseFloat(a?.stock ?? 0) || 0;
          const provOk = !!(a?.proveedorId || a?.proveedor_id);
          return !!(esCredito(a?.tituloMercancia || a?.titulo_mercancia) && provOk && pc > 0 && st > 0);
        };
        const beforeEligible = elig(prevArt);
        const afterEligible = elig(artLocal);
        const transitionToDebt = !beforeEligible && afterEligible;
        // #region agent log
        fetch('http://127.0.0.1:7397/ingest/fdd15a6c-f2bb-4e50-9cda-32cc3a03f3ff',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'00229b'},body:JSON.stringify({sessionId:'00229b',runId:'pre-fix',hypothesisId:'A_transition_detection',location:'src/js/modules/core.js:saveArticulo',message:'debt_transition_check',data:{productId,existingId:!!existingId,beforeEligible,afterEligible,transitionToDebt,beforeTitulo:prevArt?.tituloMercancia,afterTitulo:artLocal?.tituloMercancia,beforeProv:prevArt?.proveedorId,afterProv:artLocal?.proveedorId,beforeCost:prevArt?.precioCompra,afterCost:artLocal?.precioCompra,beforeStock:prevArt?.stock,afterStock:artLocal?.stock},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (transitionToDebt && window.AppTreasuryModule?.logRegistroDeudaArticulo) {
          try {
            await window.AppTreasuryModule.logRegistroDeudaArticulo({
              state,
              supabaseClient,
              uid,
              dbId,
              artLocal,
              reason: existingId ? 'edit_transition' : 'create_transition'
            });
          } catch (e) {
            console.warn('libro proveedor:', e);
          }
        }

        closeModal();
        renderArticulos();
        showLoadingOverlay('hide');
        notify('success', '✅', 'Guardado', `${refID} guardado.${catalogVisibleBool ? '' : ' Oculto en catálogo web (el sitio debe filtrar visible=true).'}${mlNote}${metaNote}${googleNote}${pinterestNote}${dropiNote}${rappiNote}${falabellaNote}`);

    } catch(e) {
        showLoadingOverlay('hide');
        alert("Error al guardar: " + e.message);
    }
}
  
// ===================================================================
// ===== INVENTORY TRAZABILIDAD =====
// ===================================================================
function renderInvTrazabilidad(){
  if (window.AppInventoryModule?.renderInvTrazabilidad) {
    return window.AppInventoryModule.renderInvTrazabilidad({ state, formatDate, today });
  }
  const movs=[...(state.inv_movimientos||[])].reverse();
  document.getElementById('inv_trazabilidad-content').innerHTML=`
    <div class="card"><div class="card-title">MOVIMIENTOS DE INVENTARIO (${movs.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Bodega</th><th>Tipo</th><th>Cantidad</th><th>Referencia</th><th>Nota</th></tr></thead><tbody>
    ${movs.map(m=>{const art=(state.articulos||[]).find(a=>a.id===m.articuloId);const bod=(state.bodegas||[]).find(b=>b.id===m.bodegaId);return`<tr><td>${formatDate(m.fecha)}</td><td>${art?.nombre||'—'}</td><td>${bod?.name||'—'}</td><td><span class="badge ${m.cantidad>0?'badge-ok':'badge-pend'}">${m.tipo}</span></td><td style="color:${m.cantidad>0?'var(--green)':'var(--red)'};font-weight:700">${m.cantidad>0?'+':''}${m.cantidad}</td><td>${m.referencia||'—'}</td><td style="color:var(--text2)">${m.nota||'—'}</td></tr>`}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin movimientos</td></tr>'}
    </tbody></table></div></div>`;
}

// ===================================================================
// ===== INVENTORY AJUSTES =====
// ===================================================================
function renderInvAjustes(){
  if (window.AppInventoryModule?.renderInvAjustes) {
    return window.AppInventoryModule.renderInvAjustes({ state, formatDate });
  }
  document.getElementById('inv_ajustes-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openAjusteModal()">+ Nuevo Ajuste</button>
    <div class="card"><div class="card-title">AJUSTES DE INVENTARIO</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th></th></tr></thead><tbody>
    ${[...(state.inv_ajustes||[])].reverse().map(a=>{const art=(state.articulos||[]).find(x=>x.id===a.articuloId);const pos=a.tipo==='entrada'||a.tipo==='devolucion';return`<tr><td>${formatDate(a.fecha)}</td><td>${art?.nombre||'—'}</td><td><span class="badge ${pos?'badge-ok':'badge-pend'}">${a.tipo}</span></td><td style="font-weight:700;color:${pos?'var(--green)':'var(--red)'}">${pos?'+':'−'}${a.cantidad}</td><td>${a.motivo||'—'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarAjuste('${a.id}')">✕</button></td></tr>`}).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin ajustes</td></tr>'}
    </tbody></table></div></div>`;
}

async function eliminarAjusteLote(loteId) {
  if (window.AppInventoryModule?.eliminarAjusteLote) {
    return window.AppInventoryModule.eliminarAjusteLote({
      state, loteId, confirm, supabaseClient, renderInvAjustes, renderTesPagosProv, updateNavBadges, notify
    });
  }
}

async function eliminarAjuste(id) {
  if (window.AppInventoryModule?.eliminarAjuste) {
    return window.AppInventoryModule.eliminarAjuste({
      state, id, confirm, supabaseClient, renderInvAjustes, renderTesPagosProv, updateNavBadges, notify
    });
  }
  if(!confirm('¿Eliminar este ajuste? El stock se revertirá automáticamente.')) return;
  const a = state.inv_ajustes.find(x => x.id === id);
  if(!a) return;

  try {
    // 1. Revertir stock en Supabase y localmente
    const art = state.articulos.find(x => String(x.id) === String(a.articuloId));
    if(art) {
      const revert = a.tipo === 'entrada' || a.tipo === 'devolucion' ? -a.cantidad : a.cantidad;
      if (window.AppInventoryModule?.syncStockViaRpc) {
        const newStock = await window.AppInventoryModule.syncStockViaRpc(supabaseClient, a.articuloId, revert);
        if (newStock != null) art.stock = newStock;
      } else {
        const newStock = Math.max(0, (art.stock||0) + revert);
        await supabaseClient.from('products').update({stock: newStock}).eq('id', a.articuloId);
        art.stock = newStock;
      }
    }
    if (a.tipo === 'devolucion') {
      const dv = (state.tes_devoluciones_prov||[]).find(x => String(x.invAjusteId) === String(a.id));
      if (dv) {
        if (window.AppTreasuryModule?.deleteCxpMirrorDevolucion) {
          await window.AppTreasuryModule.deleteCxpMirrorDevolucion(state, supabaseClient, dv.id);
        }
        await supabaseClient.from('tes_devoluciones_prov').delete().eq('id', dv.id);
        state.tes_devoluciones_prov = (state.tes_devoluciones_prov||[]).filter(x => x.id !== dv.id);
      }
    }

    if (window.AppInventoryModule?.removeAbonoInvEntradaIfAny) {
      await window.AppInventoryModule.removeAbonoInvEntradaIfAny(state, supabaseClient, id);
    }

    // 2. Borrar de inv_ajustes en Supabase
    await supabaseClient.from('inv_ajustes').delete().eq('id', id);

    // 3. Actualizar estado local
    state.inv_ajustes = state.inv_ajustes.filter(x => x.id !== id);
    const movIndex = state.inv_movimientos.findIndex(m =>
      m.articuloId === a.articuloId && m.tipo === 'ajuste_'+a.tipo && m.nota === a.motivo);
    if(movIndex !== -1) state.inv_movimientos.splice(movIndex, 1);

    renderInvAjustes();
    if(art?.tituloMercancia === 'credito' || a.tipo === 'devolucion') {
      if (typeof renderTesPagosProv === 'function') renderTesPagosProv();
      updateNavBadges();
    }
    notify('success','🗑️','Ajuste eliminado',`Stock de ${art?.nombre||''} revertido.`,{duration:3000});

  } catch(err) {
    notify('danger','⚠️','Error al eliminar', err.message, {duration:5000});
    console.error('eliminarAjuste:', err);
  }
}

function openAjusteModal(){
  if (window.AppInventoryModule?.openAjusteModal) {
    return window.AppInventoryModule.openAjusteModal({ state, openModal, getArticuloStock });
  }
  openModal(`
    <div class="modal-title">Nuevo Ajuste de Inventario<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">ARTÍCULO</label><select class="form-control" id="m-aj-art">${(state.articulos||[]).map(a=>'<option value="'+a.id+'">'+a.nombre+' (Stock: '+getArticuloStock(a.id)+')</option>').join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-aj-tipo"><option value="entrada">📥 Entrada</option><option value="salida">📤 Salida</option><option value="devolucion">↩️ Devolución</option></select></div>
      <div class="form-group"><label class="form-label">CANTIDAD</label><input type="number" class="form-control" id="m-aj-cant" min="1" value="1"></div>
    </div>
    <div class="form-group"><label class="form-label">BODEGA</label><select class="form-control" id="m-aj-bod">${(state.bodegas||[]).map(b=>'<option value="'+b.id+'">'+b.name+'</option>').join('')}</select></div>
    <div class="form-group"><label class="form-label">MOTIVO</label><input class="form-control" id="m-aj-motivo" placeholder="Motivo del ajuste"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveAjusteInv()">Guardar Ajuste</button>
  `);
}

async function saveAjusteInv() {
  if (window.AppInventoryModule?.saveAjusteInv) {
    return window.AppInventoryModule.saveAjusteInv({
      state, notify, showLoadingOverlay, supabaseClient, uid, dbId, today, closeModal, renderInvAjustes, renderArticulosList, renderTesPagosProv, updateNavBadges
    });
  }
  if (_sbConnected && typeof ensureAntiDesyncBefore === 'function') {
    const ad = await ensureAntiDesyncBefore('inventario');
    if (!ad.ok) return;
  }
  const artId = document.getElementById('m-aj-art').value;
  const tipo = document.getElementById('m-aj-tipo').value;
  const cant = parseInt(document.getElementById('m-aj-cant').value) || 0;
  const bodegaId = document.getElementById('m-aj-bod')?.value || 'bodega_main';
  if(!artId) { notify('warning','⚠️','Selecciona un artículo','',{duration:3000}); return; }
  if(cant <= 0) return;

  const product = (state.articulos||[]).find(a => String(a.id) === String(artId));
  if(!product) {
    notify('danger','⚠️','Artículo no cargado','Recarga la página. No se guardó el ajuste.',{duration:6000});
    return;
  }

  const motivo = document.getElementById('m-aj-motivo').value.trim() || 'Ajuste manual';
  const qtyFinal = tipo === 'entrada' || tipo === 'devolucion' ? cant : -cant;

  try {
    showLoadingOverlay('connecting');

    // 1. Guardar en inv_ajustes (tabla visible en el ERP)
    const ajuste = {
      id: dbId(), articuloId: artId, bodegaId: bodegaId,
      tipo, cantidad: cant, motivo, fecha: today()
    };
    const { error: ajErr } = await supabaseClient.from('inv_ajustes').insert({
      id: ajuste.id, articulo_id: artId, bodega_id: bodegaId,
      tipo, cantidad: cant, motivo, fecha: today()
    });
    if(ajErr) throw ajErr;

    // 2. Actualizar stock en products
    if(product) {
      const newStock = Math.max(0, (product.stock||0) + qtyFinal);
      const { error: prodErr } = await supabaseClient.from('products')
        .update({ stock: newStock }).eq('id', artId);
      if(prodErr) throw prodErr;
      product.stock = newStock;
    }

    if (tipo === 'devolucion' && product.tituloMercancia === 'credito' && product.proveedorId) {
      const prov = (state.usu_proveedores||[]).find(p => String(p.id) === String(product.proveedorId));
      const provNombre = prov?.nombre || product.proveedorNombre || '';
      const costoUnit = parseFloat(product.precioCompra) || parseFloat(product.cost) || 0;
      const valorCosto = costoUnit * cant;
      const devId = dbId();
      const notaDv = `Devolución inventario · ${product.nombre||artId} · ${motivo}`;
      const fh = new Date().toISOString();
      const { error: dInsErr } = await supabaseClient.from('tes_devoluciones_prov').insert({
        id: devId, proveedor_id: product.proveedorId, proveedor_nombre: provNombre,
        articulo_id: artId, cantidad: cant, valor_costo: valorCosto,
        inv_ajuste_id: ajuste.id, nota: notaDv, fecha: today(), fecha_hora: fh
      });
      if (!dInsErr) {
        if (!state.tes_devoluciones_prov) state.tes_devoluciones_prov = [];
        state.tes_devoluciones_prov.unshift({
          id: devId, proveedorId: product.proveedorId, proveedorNombre: provNombre, articuloId: artId,
          cantidad, valorCosto, invAjusteId: ajuste.id, nota: notaDv, fecha: today(), fechaHora: fh
        });
        if (window.AppTreasuryModule?.mirrorDevolucionToCxp) {
          const m = await window.AppTreasuryModule.mirrorDevolucionToCxp(state, supabaseClient, {
            devolucionId: devId,
            proveedorId: product.proveedorId,
            proveedorNombre: provNombre,
            valorCosto,
            fecha: today(),
            nota: notaDv,
            fechaHora: fh,
            lineas: [
              {
                articulo_id: artId,
                articulo_nombre: product.nombre || '',
                cantidad: cant,
                costo_unitario: cant > 0 ? valorCosto / cant : 0
              }
            ]
          });
          if (!m.ok) console.warn('[CXP devolución]', m.error);
        }
      }
    }

    if (
      tipo === 'entrada' &&
      product.proveedorId &&
      (typeof window.esMercanciaCredito === 'function'
        ? window.esMercanciaCredito(product.tituloMercancia)
        : String(product.tituloMercancia || '').trim().toLowerCase() === 'credito')
    ) {
      const costoUnit = parseFloat(product.precioCompra) || parseFloat(product.cost) || 0;
      if (costoUnit > 0) {
        const marker = window.AppTreasuryModule?.CXPIV_ABONO_MARKER || '[cxp:inv_entrada]';
        const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(product.proveedorId));
        const provNombre = prov?.nombre || product.proveedorNombre || '';
        const valorNeg = -(costoUnit * cant);
        const abonoInvId = dbId();
        const fhAb = new Date().toISOString();
        const notaAb = `${marker} inv_ajuste_id:${ajuste.id} · Entrada inventario crédito · ${product.nombre || artId} · ${motivo}`;
        const { error: abInsErr } = await supabaseClient.from('tes_abonos_prov').insert({
          id: abonoInvId,
          proveedor_id: product.proveedorId,
          proveedor_nombre: provNombre,
          valor: valorNeg,
          metodo: 'inv_entrada_credito',
          fecha: today(),
          nota: notaAb,
          fecha_hora: fhAb
        });
        if (!abInsErr) {
          if (!state.tes_abonos_prov) state.tes_abonos_prov = [];
          state.tes_abonos_prov.unshift({
            id: abonoInvId,
            proveedorId: product.proveedorId,
            proveedorNombre: provNombre,
            valor: valorNeg,
            metodo: 'inv_entrada_credito',
            fecha: today(),
            nota: notaAb,
            fechaCreacion: today(),
            fechaHora: fhAb
          });
        } else {
          console.warn('[tes_abonos_prov inv entrada]', abInsErr.message);
        }
      }
    }

    // 3. Actualizar estado local
    if(!state.inv_ajustes) state.inv_ajustes = [];
    state.inv_ajustes.push(ajuste);

    const mov = {
      id: dbId(), articuloId: artId, bodegaId: bodegaId,
      cantidad: qtyFinal, tipo: 'ajuste_'+tipo,
      fecha: today(), referencia: 'Ajuste', nota: motivo
    };
    if(!state.inv_movimientos) state.inv_movimientos = [];
    state.inv_movimientos.push(mov);

    closeModal();
    renderInvAjustes();
    if(document.getElementById('art-tbody')) renderArticulosList();

    if(product?.tituloMercancia === 'credito' || tipo === 'devolucion') {
      if (typeof renderTesPagosProv === 'function') renderTesPagosProv();
      updateNavBadges();
    }

    showLoadingOverlay('hide');
    notify('success','✅','Ajuste guardado',
      `${tipo==='entrada'||tipo==='devolucion'?'+':'−'}${cant} uds · Stock: ${product?.stock||0}${tipo==='devolucion'&&product.tituloMercancia==='credito'&&product.proveedorId?' · Deuda proveedor actualizada':''}`,
      {duration:3500});
    if (_sbConnected && typeof refreshCriticalSlice === 'function') {
      try {
        const rr = await refreshCriticalSlice('inventario');
        if (!rr.ok) notify('warning', '📡', 'No se pudo sincronizar', 'El ajuste se guardó; la vista puede estar desactualizada. Reintenta.', { duration: 5500 });
      } catch (_) { /* noop */ }
    }

  } catch(err) {
    showLoadingOverlay('hide');
    console.error('Error ajuste:', err);
    notify('danger','⚠️','Error', err.message, {duration:5000});
  }
}
// ===================================================================
// ===== INVENTORY TRASLADOS =====
// ===================================================================
function renderInvTraslados(){
  if (window.AppInventoryModule?.renderInvTraslados) {
    return window.AppInventoryModule.renderInvTraslados({ state, formatDate });
  }
  document.getElementById('inv_traslados-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openTrasladoModal()">+ Nuevo Traslado</button>
    <div class="card"><div class="card-title">TRASLADOS</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Origen</th><th>Destino</th><th>Cantidad</th><th>Nota</th><th></th></tr></thead><tbody>
    ${[...(state.inv_traslados||[])].reverse().map(t=>{const art=(state.articulos||[]).find(a=>a.id===t.articuloId);const o=(state.bodegas||[]).find(b=>b.id===t.origenId);const d=(state.bodegas||[]).find(b=>b.id===t.destinoId);return`<tr><td>${formatDate(t.fecha)}</td><td>${art?.nombre||'—'}</td><td>${o?.name||'—'}</td><td>${d?.name||'—'}</td><td style="font-weight:700">${t.cantidad}</td><td>${t.nota||'—'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarTraslado('${t.id}')">✕</button></td></tr>`}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin traslados</td></tr>'}
    </tbody></table></div></div>`;
}

async function eliminarTraslado(id) {
  if (window.AppInventoryModule?.eliminarTraslado) {
    return window.AppInventoryModule.eliminarTraslado({
      state, id, confirm, renderInvTraslados, notify
    });
  }
  if(!confirm('¿Eliminar este traslado? Las prendas volverán automáticamente a su bodega de origen.')) return;
  const t = state.inv_traslados.find(x => x.id === id);
  if(!t) return;

  // Revertir la salida de la bodega origen
  const idxSalida = state.inv_movimientos.findIndex(m => m.articuloId === t.articuloId && m.bodegaId === t.origenId && m.tipo === 'traslado_salida' && m.nota === t.nota);
  if(idxSalida !== -1) state.inv_movimientos.splice(idxSalida, 1);

  // Revertir la entrada a la bodega destino
  const idxEntrada = state.inv_movimientos.findIndex(m => m.articuloId === t.articuloId && m.bodegaId === t.destinoId && m.tipo === 'traslado_entrada' && m.nota === t.nota);
  if(idxEntrada !== -1) state.inv_movimientos.splice(idxEntrada, 1);

  // Borrar registro visual
  state.inv_traslados = state.inv_traslados.filter(x => x.id !== id);
  renderInvTraslados();
  notify('success', '🗑️', 'Traslado revertido', 'Inventario actualizado.');
}

function openTrasladoModal(){
  if (window.AppInventoryModule?.openTrasladoModal) {
    return window.AppInventoryModule.openTrasladoModal({ state, openModal });
  }
  openModal(`
    <div class="modal-title">Nuevo Traslado<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">ARTÍCULO</label><select class="form-control" id="m-tr-art">${(state.articulos||[]).map(a=>'<option value="'+a.id+'">'+a.nombre+'</option>').join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">BODEGA ORIGEN</label><select class="form-control" id="m-tr-orig">${(state.bodegas||[]).map(b=>'<option value="'+b.id+'">'+b.name+'</option>').join('')}</select></div>
      <div class="form-group"><label class="form-label">BODEGA DESTINO</label><select class="form-control" id="m-tr-dest">${(state.bodegas||[]).map(b=>'<option value="'+b.id+'">'+b.name+'</option>').join('')}</select></div>
    </div>
    <div class="form-group"><label class="form-label">CANTIDAD</label><input type="number" class="form-control" id="m-tr-cant" min="1" value="1"></div>
    <div class="form-group"><label class="form-label">NOTA</label><input class="form-control" id="m-tr-nota" placeholder="Nota del traslado"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveTraslado()">Realizar Traslado</button>
  `);
}

async function saveTraslado(){
  if (window.AppInventoryModule?.saveTraslado) {
    return window.AppInventoryModule.saveTraslado({
      state, notify, getArticuloStock, uid, dbId, today, saveRecord, closeModal, renderInvTraslados
    });
  }
  const artId = document.getElementById('m-tr-art').value;
  const origId = document.getElementById('m-tr-orig').value;
  const destId = document.getElementById('m-tr-dest').value;
  const cant = parseInt(document.getElementById('m-tr-cant').value) || 0;
  
  if(cant <= 0 || origId === destId) { notify('warning','⚠️','Error','Verifica los datos.',{duration:3000}); return; }
  
  const stockOrig = getArticuloStock(artId, origId);
  if(stockOrig < cant) { notify('warning','⚠️','Sin stock','No hay suficiente stock en la bodega origen.',{duration:3000}); return; }
  
  const nota = document.getElementById('m-tr-nota').value.trim();
  const traslado = {id: dbId(), articuloId: artId, origenId: origId, destinoId: destId, cantidad: cant, nota, fecha: today()};
  const movSalida = {id: dbId(), articuloId: artId, bodegaId: origId, cantidad: -cant, tipo: 'traslado_salida', fecha: today(), referencia: 'Traslado', nota};
  const movEntrada = {id: dbId(), articuloId: artId, bodegaId: destId, cantidad: cant, tipo: 'traslado_entrada', fecha: today(), referencia: 'Traslado', nota};
  
  state.inv_traslados.push(traslado);
  state.inv_movimientos.push(movSalida);
  state.inv_movimientos.push(movEntrada);
  
  await saveRecord('inv_traslados', traslado.id, traslado);
  // inv_movimientos no tiene tabla propia en Supabase, se reconstruye de ajustes/traslados
  
  closeModal();
  renderInvTraslados();
  notify('success','✅','Traslado realizado',`${cant} unidades movidas`,{duration:3000});
}
// ===================================================================
// ===== GENERIC DOCUMENT RENDERER (Cotizaciones, Órdenes, etc) =====
// ===================================================================
function renderDocumentList(pageId,title,collection,tipo,fields){
  if (window.AppDocumentsModule?.renderDocumentList) {
    return window.AppDocumentsModule.renderDocumentList({
      state, pageId, title, collection, tipo, fields, formatDate, fmt
    });
  }
  const el=document.getElementById(pageId+'-content');
  if(!el) return;

  // Leer filtros actuales
  const q=(document.getElementById(pageId+'-search')?.value||'').toLowerCase();
  const desdeEl=document.getElementById(pageId+'-desde');
  const hastaEl=document.getElementById(pageId+'-hasta');
  const desde=desdeEl?.value||'';
  const hasta=hastaEl?.value||'';

  try {
    const raw = state?.[collection];
    const rawType = raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw;
    const safeArray = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
    let items=[...safeArray].reverse();

    // Aplicar filtros
    if(q) items=items.filter(d=>(d?.numero||'').toLowerCase().includes(q)||(d?.cliente||'').toLowerCase().includes(q));
    if(desde) items=items.filter(d=>d?.fecha&&d.fecha>=desde);
    if(hasta) items=items.filter(d=>d?.fecha&&d.fecha<=hasta);

    const total=safeArray.length;

    const tbodyId = pageId+'-doc-tbody';
    const contId = pageId+'-doc-count';
    const safeDate = (v) => { try { return formatDate(v); } catch (_) { return (v || '—'); } };
    const safeMoney = (v) => { try { return fmt(v || 0); } catch (_) { return String(v || 0); } };
    const rowsHtml = items.map((d) => {
      const pdfB =
        collection === 'cotizaciones' || collection === 'facturas'
          ? `<button type="button" class="btn btn-xs btn-secondary" title="Descargar PDF" onclick="downloadDocPdf('${collection}','${d?.id}')">📄 PDF</button>`
          : '';
      return `<tr>
      <td style="font-weight:700">${d?.numero||'—'}</td>
      <td>${safeDate(d?.fecha)}</td>
      <td>${d?.cliente||'—'}</td>
      <td style="color:var(--accent);font-weight:700">${safeMoney(d?.total||0)}</td>
      <td><span class="badge badge-${d?.estado==='pagada'||d?.estado==='aprobada'?'ok':d?.estado==='anulada'?'pend':'warn'}">${d?.estado||'borrador'}</span></td>
      <td><div class="btn-group" style="flex-wrap:wrap;gap:4px">
        <button type="button" class="btn btn-xs btn-secondary" onclick="viewDoc('${collection}','${d?.id}')">👁</button>
        <button type="button" class="btn btn-xs btn-secondary" onclick="printDoc('${collection}','${d?.id}')">🖨</button>
        ${pdfB}
        <button type="button" class="btn btn-xs btn-danger" onclick="deleteDoc('${collection}','${d?.id}')">✕</button>
      </div></td>
    </tr>`;
    }).join('')||`<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin ${title.toLowerCase()}s</td></tr>`;


    // Si ya existe la tabla, solo actualizar filas (mantiene foco del input)
    if(document.getElementById(tbodyId)) {
      document.getElementById(tbodyId).innerHTML = rowsHtml;
      const cnt = document.getElementById(contId);
      if(cnt) cnt.textContent = `${items.length} de ${total}`;
      const btnL = document.getElementById(pageId+'-doc-limpiar');
      if(btnL) btnL.style.display = (q||desde||hasta)?'inline-flex':'none';
      return;
    }

    el.innerHTML=`
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
        <button class="btn btn-primary" onclick="openDocModal('${collection}','${tipo}')">+ ${title}</button>
        <div class="search-bar" style="flex:1;min-width:180px;max-width:300px;margin:0">
          <span class="search-icon">🔍</span>
          <input type="text" id="${pageId}-search" placeholder="Buscar # o cliente..." value="${q}"
            oninput="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')">
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <input type="date" id="${pageId}-desde" class="form-control" style="width:140px;padding:8px" value="${desde}"
            onchange="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')" title="Desde">
          <span style="color:var(--text2);font-size:11px;">hasta</span>
          <input type="date" id="${pageId}-hasta" class="form-control" style="width:140px;padding:8px" value="${hasta}"
            onchange="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')" title="Hasta">
          <button class="btn btn-xs btn-secondary" id="${pageId}-doc-limpiar" style="display:${(q||desde||hasta)?'inline-flex':'none'}"
            onclick="document.getElementById('${pageId}-search').value='';document.getElementById('${pageId}-desde').value='';document.getElementById('${pageId}-hasta').value='';renderDocumentList('${pageId}','${title}','${collection}','${tipo}')">✕ Limpiar</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">${title.toUpperCase()} — <span id="${contId}">${items.length} de ${total}</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody id="${tbodyId}">${rowsHtml}</tbody>
        </table></div>
      </div>`;
  } catch (err) {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">${title.toUpperCase()}</div>
        <div style="padding:16px;color:var(--text2)">No se pudo renderizar esta sección. Revisa la consola o recarga.</div>
      </div>`;
  }
}

function openDocModal(collection,tipo,existingId){
  if (window.AppDocumentsModule?.openDocModal) {
    return window.AppDocumentsModule.openDocModal({
      state, openModal, addDocItem, collection, tipo, existingId, today, fmt
    });
  }
  const tipos={cotizacion:'Cotización',orden:'Orden de Venta',factura:'Factura',nc:'Nota Crédito',nd:'Nota Débito',remision:'Remisión',devolucion:'Devolución',anticipo_cliente:'Anticipo Cliente'};
  const label=tipos[tipo]||tipo;
  openModal(`
    <div class="modal-title">Nueva ${label}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">FECHA</label><input type="date" class="form-control" id="m-doc-fecha" value="${today()}"></div>
      <div class="form-group"><label class="form-label">CLIENTE</label><input class="form-control" id="m-doc-cliente" placeholder="Nombre del cliente"></div>
    </div>
    ${(tipo==='nc'||tipo==='nd'||tipo==='devolucion')?`<div class="form-group"><label class="form-label">FACTURA REFERENCIA</label><select class="form-control" id="m-doc-ref"><option value="">— Seleccionar —</option>${(state.facturas||[]).map(f=>'<option value="'+f.id+'">'+f.numero+' · '+fmt(f.total)+'</option>').join('')}</select></div>`:''}
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="m-doc-obs" rows="2"></textarea></div>
    <div class="card-title" style="margin-top:16px">ÍTEMS</div>
    <div id="m-doc-items"></div>
    <button class="btn btn-sm btn-secondary" style="margin-bottom:16px" onclick="addDocItem()">+ Agregar Ítem</button>
    ${collection==='facturas'?`<div class="form-group" style="margin-bottom:12px"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px"><input type="checkbox" id="m-doc-apply-iva" onchange="updateDocTotal()"> IVA (19%)</label></div>`:''}
    <div style="text-align:right;margin-bottom:16px" id="m-doc-total">Total: $0</div>
    <button class="btn btn-primary" style="width:100%" onclick="saveDoc('${collection}','${tipo}')">Guardar ${label}</button>
  `,true);
  addDocItem();
}

let _docItems=[];
function addDocItem(){
  if (window.AppDocumentsModule?.addDocItem) {
    return window.AppDocumentsModule.addDocItem({
      getDocItems: () => _docItems,
      setDocItems: (v) => { _docItems = v; },
      renderDocItems
    });
  }
  _docItems.push({articuloId:'',nombre:'',cantidad:1,precio:0});
  renderDocItems();
}
function renderDocItems(){
  if (window.AppDocumentsModule?.renderDocItems) {
    return window.AppDocumentsModule.renderDocItems({
      state,
      getDocItems: () => _docItems,
      updateDocTotal
    });
  }
  const el=document.getElementById('m-doc-items');if(!el)return;
  el.innerHTML=_docItems.map((item,i)=>`
    <div style="display:grid;grid-template-columns:2fr 80px 120px 40px;gap:8px;margin-bottom:8px;align-items:end">
      <div class="form-group" style="margin:0"><label class="form-label">${i===0?'ARTÍCULO':''}</label><select class="form-control" onchange="docItemChanged(${i},this.value)" style="padding:8px"><option value="">— Seleccionar —</option>${(state.articulos||[]).map(a=>'<option value="'+a.id+'" '+(item.articuloId===a.id?'selected':'')+'>'+a.nombre+'</option>').join('')}<option value="custom">✏️ Personalizado</option></select></div>
      <div class="form-group" style="margin:0"><label class="form-label">${i===0?'CANT':''}</label><input type="number" class="form-control" value="${item.cantidad}" min="1" onchange="docItemQty(${i},this.value)" style="padding:8px"></div>
      <div class="form-group" style="margin:0"><label class="form-label">${i===0?'PRECIO':''}</label><input type="number" class="form-control" value="${item.precio}" min="0" onchange="docItemPrice(${i},this.value)" style="padding:8px" id="doc-item-price-${i}"></div>
      <button class="btn btn-xs btn-danger" onclick="removeDocItem(${i})" style="margin-bottom:0;height:38px">✕</button>
    </div>`).join('');
  updateDocTotal();
}
function docItemChanged(i,artId){
  if (window.AppDocumentsModule?.docItemChanged) {
    return window.AppDocumentsModule.docItemChanged({
      state, i, artId,
      getDocItems: () => _docItems,
      setDocItems: (v) => { _docItems = v; },
      renderDocItems
    });
  }
  if(artId==='custom'){_docItems[i].articuloId='custom';_docItems[i].nombre='Personalizado'}
  else{const art=(state.articulos||[]).find(a=>a.id===artId);if(art){_docItems[i].articuloId=artId;_docItems[i].nombre=art.nombre;_docItems[i].precio=art.precioVenta}}
  renderDocItems();
}
function docItemQty(i,val){
  if (window.AppDocumentsModule?.docItemQty) {
    return window.AppDocumentsModule.docItemQty({
      i, val,
      getDocItems: () => _docItems,
      setDocItems: (v) => { _docItems = v; },
      updateDocTotal
    });
  }
  _docItems[i].cantidad=parseInt(val)||1;updateDocTotal()
}
function docItemPrice(i,val){
  if (window.AppDocumentsModule?.docItemPrice) {
    return window.AppDocumentsModule.docItemPrice({
      i, val,
      getDocItems: () => _docItems,
      setDocItems: (v) => { _docItems = v; },
      updateDocTotal
    });
  }
  _docItems[i].precio=parseFloat(val)||0;updateDocTotal()
}
function removeDocItem(i){
  if (window.AppDocumentsModule?.removeDocItem) {
    return window.AppDocumentsModule.removeDocItem({
      i,
      getDocItems: () => _docItems,
      setDocItems: (v) => { _docItems = v; },
      renderDocItems
    });
  }
  _docItems.splice(i,1);renderDocItems()
}
function updateDocTotal(){
  if (window.AppDocumentsModule?.updateDocTotal) {
    return window.AppDocumentsModule.updateDocTotal({
      getDocItems: () => _docItems,
      fmt
    });
  }
  const subtotal=_docItems.reduce((a,item)=>a+(item.cantidad*item.precio),0);
  const ivaEl=document.getElementById('m-doc-apply-iva');
  const applyIva=ivaEl?ivaEl.checked:false;
  const iva=applyIva?subtotal*0.19:0;
  const total=subtotal+iva;
  const el=document.getElementById('m-doc-total');if(!el)return;
  el.innerHTML='<div style="font-size:12px;color:var(--text2)">Subtotal: '+fmt(subtotal)+'</div>'+
    '<div style="font-size:12px;color:var(--text2)">IVA (19%): '+fmt(iva)+'</div>'+
    '<div style="font-family:Syne;font-size:18px;font-weight:800;color:var(--accent);margin-top:4px">Total: '+fmt(total)+'</div>';
}

async function saveDoc(collection,tipo){
  if (window.AppDocumentsModule?.saveDoc) {
    return window.AppDocumentsModule.saveDoc({
      state, collection, tipo, today, uid, dbId, getNextConsec, supabaseClient, saveConfig, saveRecord, closeModal, renderPage, notify, fmt,
      getDocItems: () => _docItems,
      setDocItems: (v) => { _docItems = v; }
    });
  }
  const fecha=document.getElementById('m-doc-fecha').value||today();
  const cliente=document.getElementById('m-doc-cliente').value.trim();
  const obs=document.getElementById('m-doc-obs').value.trim();
  const refId=document.getElementById('m-doc-ref')?.value||'';
  const items=_docItems.filter(i=>i.precio>0);
  if(items.length===0){notify('warning','⚠️','Sin ítems','Agrega al menos un ítem.',{duration:3000});return}
  const subtotal=items.reduce((a,i)=>a+(i.cantidad*i.precio),0);
  const ivaEl=document.getElementById('m-doc-apply-iva');
  const applyIvaF=ivaEl?ivaEl.checked:false;
  const iva=collection==='facturas'?(applyIvaF?subtotal*0.19:0):subtotal*0.19;
  const total=subtotal+iva;
  const prefixes={cotizaciones:'COT',ordenes_venta:'OV',facturas:'FAC',notas_credito:'NC',
    notas_debito:'ND',remisiones:'REM',devoluciones:'DEV',anticipos_clientes:'ANT'};
  const consKeys={cotizaciones:'cotizacion',ordenes_venta:'orden',facturas:'factura',
    notas_credito:'nc',notas_debito:'nd',remisiones:'remision',devoluciones:'devolucion',anticipos_clientes:'anticipo'};
  const prefix=prefixes[collection]||'DOC';
  const consKey=consKeys[collection]||'factura';
  const numero=prefix+'-'+getNextConsec(consKey);
  const itemsNormalized=collection==='facturas'?items.map(i=>{
    const q=parseFloat(i.cantidad)||1,p=parseFloat(i.precio)||0;
    return {articuloId:i.articuloId||'',nombre:i.nombre||'',talla:i.talla||'',cantidad:q,qty:q,precio:p};
  }):items.map(i=>({...i}));
  const docTipo=collection==='facturas'?'manual':tipo;
  const docData={id:dbId(),numero,fecha,cliente,items:itemsNormalized,
    subtotal,iva,flete:0,total,estado:'borrador',observaciones:obs,facturaRef:refId,tipo:docTipo,
    ...(collection==='facturas'?{canal:'vitrina',telefono:'',metodo:'efectivo'}:{})};

  // Guardar en state local
  if(!state[collection]) state[collection]=[];
  state[collection].push(docData);
  _docItems=[];

  try {
    if (collection==='facturas') await saveRecord('facturas',docData.id,docData);
    else await supabaseClient.from('legacy_docs').insert({id:docData.id, tipo, numero:docData.numero, data:docData});
    await saveConfig('consecutivos', state.consecutivos);
  } catch(e){ console.warn('saveDoc Supabase error:', e.message); }

  closeModal();
  renderPage(document.querySelector('.page.active')?.id.replace('page-',''));
  notify('success','✅','Documento creado',`${numero} · ${fmt(total)}`,{duration:3000});
}


function viewDoc(collection,id){
  const doc=(state[collection]||[]).find(d=>d.id===id);if(!doc)return;
  openModal(`
    <div class="modal-title">${doc.numero}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="grid-2" style="margin-bottom:16px">
      <div><span style="color:var(--text2);font-size:12px">Fecha:</span> ${formatDate(doc.fecha)}</div>
      <div><span style="color:var(--text2);font-size:12px">Cliente:</span> ${doc.cliente||'—'}</div>
    </div>
    <div class="table-wrap" style="margin-bottom:16px"><table><thead><tr><th>Artículo</th><th>Cant</th><th>Precio</th><th>Total</th></tr></thead><tbody>
    ${(doc.items||[]).map(i=>{const q=parseFloat(i.cantidad||i.qty)||1,p=parseFloat(i.precio||i.price)||0;return `<tr><td>${i.nombre||i.name||'—'}</td><td>${q}</td><td>${fmt(p)}</td><td style="font-weight:700;color:var(--accent)">${fmt(q*p)}</td></tr>`;}).join('')}
    </tbody></table></div>
    <div style="text-align:right;margin-bottom:8px"><span style="color:var(--text2)">Subtotal:</span> ${fmt(doc.subtotal)}</div>
    <div style="text-align:right;margin-bottom:8px"><span style="color:var(--text2)">IVA:</span> ${fmt(doc.iva)}</div>
    ${parseFloat(doc.flete)>0?`<div style="text-align:right;margin-bottom:8px"><span style="color:var(--text2)">Flete:</span> ${fmt(doc.flete)}</div>`:''}
    <div style="text-align:right;font-family:Syne;font-size:20px;font-weight:800;color:var(--accent)">${fmt(doc.total)}</div>
    ${doc.observaciones?'<div style="margin-top:12px;font-size:12px;color:var(--text2)">'+doc.observaciones+'</div>':''}
    <div class="btn-group" style="margin-top:16px;flex-wrap:wrap;gap:8px">
      <button type="button" class="btn btn-primary btn-sm" onclick="printDoc('${collection}','${id}')">🖨 Imprimir</button>
      ${collection === 'cotizaciones' || collection === 'facturas' ? `<button type="button" class="btn btn-secondary btn-sm" onclick="downloadDocPdf('${collection}','${id}')">📄 Descargar PDF</button>` : ''}
      ${doc.estado!=='pagada'?`<button type="button" class="btn btn-sm" style="background:rgba(74,222,128,.15);color:var(--green);border:1px solid rgba(74,222,128,.3)" onclick="changeDocStatus('${collection}','${id}','pagada')">✓ Marcar Pagada</button>`:''}
      ${doc.estado!=='anulada'?`<button type="button" class="btn btn-sm btn-danger" onclick="changeDocStatus('${collection}','${id}','anulada')">✕ Anular</button>`:''}
    </div>
  `);
}

function changeDocStatus(collection,id,newStatus){
  const doc=(state[collection]||[]).find(d=>d.id===id);if(!doc)return;
  doc.estado=newStatus;
  
  saveRecord(collection, doc.id, doc);
  closeModal();
  renderPage(document.querySelector('.page.active')?.id.replace('page-',''));
  notify('success','✅','Estado actualizado',doc.numero+' → '+newStatus,{duration:3000});
}

function deleteDoc(collection, id) {
  if (window.AppDocumentsModule?.deleteDoc) {
    return window.AppDocumentsModule.deleteDoc({
      state, collection, id, confirm, renderPage
    });
  }
  // --- CANDADO DE SEGURIDAD PARA FACTURAS ---
  if (collection === 'facturas') {
    alert('⚠️ ¡Alto ahí! Para mantener tu inventario y caja perfectamente cuadrados, las facturas solo se pueden anular desde la pestaña: SISTEMA > Historial.');
    return; // Detiene la acción inmediatamente
  }
  // ------------------------------------------

  if (!confirm('¿Eliminar este documento?')) return;
  state[collection] = (state[collection] || []).filter(d => d.id !== id);
  renderPage(document.querySelector('.page.active')?.id.replace('page-', ''));
}

function printDoc(collection,id){
  if (window.AppDocumentsModule?.printDoc) {
    return window.AppDocumentsModule.printDoc({
      state, collection, id, printReceipt
    });
  }
  const doc=(state[collection]||[]).find(d=>d.id===id);if(!doc)return;
  printReceipt(doc);
}

/** PDF descargable (Cotizaciones / Facturas). Usa totales guardados en el documento + jsPDF en cliente. */
async function downloadDocPdf(collection, id) {
  if (collection !== 'cotizaciones' && collection !== 'facturas') return;
  const doc = (state[collection] || []).find((d) => String(d.id) === String(id));
  if (!doc) {
    notify('warning', 'PDF', 'No encontrado', 'No hay documento en la sesión actual. Recarga si hace falta.', { duration: 5000 });
    return;
  }
  notify('info', '📄', 'Generando PDF…', 'Un momento…', { duration: 4000 });
  await new Promise((r) => setTimeout(r, 80));
  if (!window.AppDocumentPdf?.download) {
    notify('danger', 'PDF', 'No disponible', 'Módulo PDF no cargado. Recarga la página.', { duration: 6000 });
    return;
  }
  try {
    await window.AppDocumentPdf.download({ doc, collection, state, fmt, notify });
  } catch (e) {
    console.warn('downloadDocPdf', e);
    notify('danger', 'PDF', 'Error', 'No se pudo generar el PDF, intenta de nuevo.', { duration: 6000 });
  }
}

function renderCotizaciones(){_docItems=[];renderDocumentList('cotizaciones','Cotización','cotizaciones','cotizacion')}
function renderOrdenes(){_docItems=[];renderDocumentList('ordenes','Orden de Venta','ordenes_venta','orden')}
function renderFacturas(){_docItems=[];renderDocumentList('facturas','Factura','facturas','factura')}
function renderNotasCredito(){_docItems=[];renderDocumentList('notas_credito','Nota Crédito','notas_credito','nc')}
function renderNotasDebito(){_docItems=[];renderDocumentList('notas_debito','Nota Débito','notas_debito','nd')}
function renderRemisiones(){_docItems=[];renderDocumentList('remisiones','Remisión','remisiones','remision')}
function renderDevoluciones(){_docItems=[];renderDocumentList('devoluciones','Devolución','devoluciones','devolucion')}
function renderAnticiposClientes(){_docItems=[];renderDocumentList('anticipos_clientes','Anticipo Cliente','anticipos_clientes','anticipo_cliente')}
  // ==========================================
// ===== USUARIOS =====
// ==========================================

function renderUsuarios(pageId, titulo, collection, tipo){
  if (window.AppUsersModule?.renderUsuarios) {
    return window.AppUsersModule.renderUsuarios(state, pageId, titulo, collection, tipo);
  }
  const el = document.getElementById(pageId+'-content'); if(!el) return;

  const q = (document.getElementById(pageId+'-search')?.value||'').toLowerCase();
  const desde = document.getElementById(pageId+'-desde')?.value||'';
  const hasta = document.getElementById(pageId+'-hasta')?.value||'';

  if(!state[collection]) state[collection]=[];
  let items = Array.isArray(state[collection]) ? [...state[collection]].reverse() : [];
  if(q) items = items.filter(u =>
    (u.nombre||'').toLowerCase().includes(q) ||
    (u.cedula||'').toLowerCase().includes(q) ||
    (u.celular||'').toLowerCase().includes(q) ||
    (u.email||'').toLowerCase().includes(q) ||
    (u.ciudad||'').toLowerCase().includes(q)
  );
  if(desde) items = items.filter(u => (u.fechaCreacion||'') >= desde);
  if(hasta) items = items.filter(u => (u.fechaCreacion||'') <= hasta);

  const total = (state[collection]||[]).length;

  // Si ya existe el contenedor, solo actualizar la tabla (evita perder foco del input)
  const tbodyId = pageId+'-tbody';
  const contadorId = pageId+'-contador';
  const existing = document.getElementById(tbodyId);

  if(existing) {
    // Solo repintar tabla y contador
    existing.innerHTML = renderUsuariosRows(items, collection, tipo, pageId);
    const contador = document.getElementById(contadorId);
    if(contador) contador.textContent = `${items.length} de ${total}`;
    return;
  }

  // Primera carga: pintar todo
  el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <button class="btn btn-primary" onclick="openUsuarioModal('${collection}','${tipo}')">+ Nuevo ${titulo}</button>
      <button class="btn btn-secondary" onclick="importarUsuariosCSV('${collection}','${tipo}','${pageId}')" title="Importar CSV/Excel">📥 Importar</button>
      <button class="btn btn-secondary" onclick="exportarUsuarios('${collection}','${tipo}')" title="Exportar a CSV">⬆ Exportar</button>
      <button class="btn btn-secondary" onclick="descargarPlantilla('${tipo}')" title="Descargar plantilla">⬇ Plantilla</button>
      <div class="search-bar" style="flex:1;min-width:180px;max-width:300px;margin:0">
        <span class="search-icon">🔍</span>
        <input type="text" id="${pageId}-search" placeholder="Nombre, cédula, ciudad..."
          value="${q}"
          oninput="renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">
      </div>
      <input type="date" class="form-control" id="${pageId}-desde" style="width:140px" value="${desde}"
        onchange="renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="${pageId}-hasta" style="width:140px" value="${hasta}"
        onchange="renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">
      <button class="btn btn-xs btn-secondary" id="${pageId}-limpiar" style="display:${(q||desde||hasta)?'inline-flex':'none'}"
        onclick="document.getElementById('${pageId}-search').value='';document.getElementById('${pageId}-desde').value='';document.getElementById('${pageId}-hasta').value='';renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">✕ Limpiar</button>
    </div>

    <div class="card">
      <div class="card-title">👥 ${titulo.toUpperCase()}S — <span id="${contadorId}">${items.length} de ${total}</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Nombre</th><th>Identificación</th><th>Celular</th><th>WhatsApp</th>
            <th>Email</th><th>Ciudad</th><th>Tipo</th><th></th>
          </tr></thead>
          <tbody id="${tbodyId}">
            ${renderUsuariosRows(items, collection, tipo, pageId)}
          </tbody>
        </table>
      </div>
    </div>
    <input type="file" id="${pageId}-file-input" accept=".csv,.xls,.xlsx" style="display:none"
      onchange="procesarArchivoUsuarios(this,'${collection}','${tipo}','${pageId}')">`;
}

function renderUsuariosTabla(pageId, titulo, collection, tipo) {
  if (window.AppUsersModule?.renderUsuariosTabla) {
    return window.AppUsersModule.renderUsuariosTabla(state, pageId, titulo, collection, tipo);
  }
  // Actualiza solo la tabla sin repintar los filtros (mantiene foco)
  const q = (document.getElementById(pageId+'-search')?.value||'').toLowerCase();
  const desde = document.getElementById(pageId+'-desde')?.value||'';
  const hasta = document.getElementById(pageId+'-hasta')?.value||'';

  if(!state[collection]) state[collection]=[];
  let items = Array.isArray(state[collection]) ? [...state[collection]].reverse() : [];
  if(q) items = items.filter(u =>
    (u.nombre||'').toLowerCase().includes(q) ||
    (u.cedula||'').toLowerCase().includes(q) ||
    (u.celular||'').toLowerCase().includes(q) ||
    (u.email||'').toLowerCase().includes(q) ||
    (u.ciudad||'').toLowerCase().includes(q)
  );
  if(desde) items = items.filter(u => (u.fechaCreacion||'') >= desde);
  if(hasta) items = items.filter(u => (u.fechaCreacion||'') <= hasta);

  const total = (state[collection]||[]).length;
  const tbody = document.getElementById(pageId+'-tbody');
  if(tbody) tbody.innerHTML = renderUsuariosRows(items, collection, tipo, pageId);
  const contador = document.getElementById(pageId+'-contador');
  if(contador) contador.textContent = `${items.length} de ${total}`;
  // Mostrar/ocultar botón limpiar
  const btnLimpiar = document.getElementById(pageId+'-limpiar');
  if(btnLimpiar) btnLimpiar.style.display = (q||desde||hasta) ? 'inline-flex' : 'none';
}

function renderUsuariosRows(items, collection, tipo, pageId) {
  if (window.AppUsersModule?.renderUsuariosRows) {
    return window.AppUsersModule.renderUsuariosRows(items, collection, tipo, pageId);
  }
  if(!items.length) return '<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>';
  // Show max 200 rows for performance with 8000+ records
  const visible = items.slice(0, 200);
  const more = items.length > 200 ? `<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:12px;font-size:11px">... y ${items.length-200} más. Usa el buscador para filtrar.</td></tr>` : '';
  return visible.map((u,idx) => `<tr>
    <td style="font-weight:700">${u.nombre||'—'}</td>
    <td>${u.tipoId||''} ${u.cedula||'—'}</td>
    <td>${u.celular||'—'}</td>
    <td>${u.whatsapp||'—'}</td>
    <td>${u.email||'—'}</td>
    <td>${u.ciudad||'—'}</td>
    <td><span class="badge badge-warn">${u.tipoPersona||tipo}</span></td>
    <td><div class="btn-group">
      <button class="btn btn-xs btn-secondary" onclick="openUsuarioModal('${collection}','${tipo}','${pageId}','${idx}',true)">✏️</button>
      <button class="btn btn-xs btn-danger" onclick="eliminarUsuario('${collection}','${u.id}','${pageId}','${tipo}','${tipo}')">✕</button>
    </div></td>
  </tr>`).join('') + more;
}


function renderUsuClientes(){ renderUsuarios('usu_clientes','Cliente','usu_clientes','cliente'); }
function renderUsuEmpleados(){ renderUsuarios('usu_empleados','Empleado','usu_empleados','empleado'); }
function renderUsuProveedores(){ renderUsuarios('usu_proveedores','Proveedor','usu_proveedores','proveedor'); }

function openUsuarioModal(collection, tipo, pageId, idx, editar){
  if (window.AppUsersModule?.openUsuarioModal) {
    return window.AppUsersModule.openUsuarioModal(state, openModal, closeModal, collection, tipo, pageId, idx, editar);
  }
  const items = state[collection]||[];
  const u = (editar && idx!==undefined) ? items[items.length-1-parseInt(idx)] : null;
  const titulos = {cliente:'Cliente', empleado:'Empleado', proveedor:'Proveedor'};
  openModal(`
    <div class="modal-title">${u?'Editar':'Nuevo'} ${titulos[tipo]||tipo}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO ID</label>
        <select class="form-control" id="usu-tipoid">
          <option value="CC" ${u?.tipoId==='CC'?'selected':''}>CC - Cédula</option>
          <option value="NIT" ${u?.tipoId==='NIT'?'selected':''}>NIT</option>
          <option value="CE" ${u?.tipoId==='CE'?'selected':''}>CE - Extranjería</option>
          <option value="PA" ${u?.tipoId==='PA'?'selected':''}>PA - Pasaporte</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">N° IDENTIFICACIÓN</label><input class="form-control" id="usu-cedula" value="${u?.cedula||''}"></div>
    </div>
    <div class="form-group"><label class="form-label">NOMBRE COMPLETO *</label><input class="form-control" id="usu-nombre" value="${u?.nombre||''}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">CELULAR</label><input class="form-control" id="usu-celular" value="${u?.celular||''}"></div>
      <div class="form-group"><label class="form-label">WHATSAPP</label><input class="form-control" id="usu-whatsapp" value="${u?.whatsapp||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">EMAIL</label><input class="form-control" id="usu-email" value="${u?.email||''}"></div>
      <div class="form-group"><label class="form-label">CIUDAD</label><input class="form-control" id="usu-ciudad" value="${u?.ciudad||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">DEPARTAMENTO</label><input class="form-control" id="usu-dpto" value="${u?.departamento||''}"></div>
      <div class="form-group"><label class="form-label">DIRECCIÓN</label><input class="form-control" id="usu-dir" value="${u?.direccion||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO PERSONA</label>
        <select class="form-control" id="usu-tipopersona">
          <option value="Natural" ${u?.tipoPersona==='Natural'?'selected':''}>Natural</option>
          <option value="Jurídica" ${u?.tipoPersona==='Jurídica'?'selected':''}>Jurídica</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">FECHA NACIMIENTO</label><input type="date" class="form-control" id="usu-fnac" value="${u?.fechaNac||''}"></div>
    </div>
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="usu-obs" rows="2">${u?.observacion||''}</textarea></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarUsuario('${collection}','${tipo}','${pageId||'usu_'+tipo+'s'}','${u?.id||''}')">Guardar ${titulos[tipo]||tipo}</button>
  `);
}

async function guardarUsuario(collection, tipo, pageId, existingId) {
  if (window.AppUsersModule?.guardarUsuario) {
    return window.AppUsersModule.guardarUsuario({
      state, supabaseClient, showLoadingOverlay, closeModal, renderPage, notify,
      collection, tipo, pageId, existingId
    });
  }
  const nombre = document.getElementById('usu-nombre').value.trim();
  if(!nombre){ notify('danger','⚠️','Error','El nombre es obligatorio'); return; }

  // Determinar la tabla y preparar los datos según el tipo
  let table = '';
  let data = {};
  const recordId = existingId || crypto.randomUUID();

  if (tipo === 'cliente') {
    table = 'customers';
    data = {
      id: recordId,
      nombre: nombre,
      cedula: document.getElementById('usu-cedula').value.trim(),
      celular: document.getElementById('usu-celular').value.trim(),
      telefono: document.getElementById('usu-celular').value.trim(), // Usamos el mismo si no hay otro input
      whatsapp: document.getElementById('usu-whatsapp').value.trim(),
      ciudad: document.getElementById('usu-ciudad').value.trim(),
      direccion: document.getElementById('usu-dir').value.trim()
    };
  } else if (tipo === 'empleado') {
    table = 'employees';
    data = {
      id: recordId,
      nombre: nombre,
      tipo_contrato: 'indefinido', // Valor por defecto
      salario_base: 0 
    };
  } else {
    // Proveedor → tabla proveedores
    table = 'proveedores';
    data = {
      id: recordId,
      nombre: nombre,
      tipo_id: document.getElementById('usu-tipoid')?.value || 'CC',
      cedula: document.getElementById('usu-cedula')?.value.trim() || '',
      celular: document.getElementById('usu-celular')?.value.trim() || '',
      whatsapp: document.getElementById('usu-whatsapp')?.value.trim() || '',
      email: document.getElementById('usu-email')?.value.trim() || '',
      ciudad: document.getElementById('usu-ciudad')?.value.trim() || '',
      departamento: document.getElementById('usu-dpto')?.value.trim() || '',
      direccion: document.getElementById('usu-dir')?.value.trim() || '',
      tipo_persona: document.getElementById('usu-tipopersona')?.value || 'Natural',
      observacion: document.getElementById('usu-obs')?.value.trim() || ''
    };
  }

  try {
    showLoadingOverlay('connecting');
    
    // UPSERT: Inserta si es nuevo, actualiza si ya existe
    const { error } = await supabaseClient.from(table).upsert(data, { onConflict: 'id' });
    if (error) throw error;

    // Actualizar la vista local para que la interfaz responda al instante
    if (!state[collection]) state[collection] = [];
    if (existingId) {
      const i = state[collection].findIndex(x => x.id === existingId);
      if (i >= 0) state[collection][i] = { ...state[collection][i], ...data };
    } else {
      state[collection].push(data);
    }
    // Mantener sincronía entre state.empleados y state.usu_empleados
    if(tipo === 'empleado') state.empleados = state.usu_empleados;
    if(tipo === 'cliente') state.usu_clientes = state.usu_clientes; // ya sincronizado

    closeModal();
    renderPage(pageId);
    showLoadingOverlay('hide');
    notify('success','✅','Guardado',`${nombre} guardado correctamente en BD`,{duration:3000});

  } catch (err) {
    showLoadingOverlay('hide');
    console.error("Error guardando usuario:", err);
    notify('danger','⚠️','Error', err.message, {duration: 5000});
  }
}

async function eliminarUsuario(collection, id, pageId, titulo, tipo) {
  if (window.AppUsersModule?.eliminarUsuario) {
    return window.AppUsersModule.eliminarUsuario({
      state, supabaseClient, showLoadingOverlay, renderPage, notify, confirm,
      collection, id, pageId, titulo, tipo
    });
  }
  if(!confirm(`¿Eliminar este ${titulo}? Esta acción no se puede deshacer.`)) return;

  const table = tipo === 'cliente' ? 'customers' : (tipo === 'empleado' ? 'employees' : null);
  if (!table) return;

  try {
    showLoadingOverlay('connecting');
    
    const { error } = await supabaseClient.from(table).delete().eq('id', id);
    if (error) throw error;

    // Remover de la vista local
    state[collection] = (state[collection] || []).filter(x => x.id !== id);
    // Mantener sincronía
    if(tipo === 'empleado') state.empleados = state.usu_empleados;
    renderPage(pageId);
    
    showLoadingOverlay('hide');
    notify('success', '🗑️', 'Eliminado', `${titulo} borrado del sistema.`);
  } catch (err) {
    showLoadingOverlay('hide');
    notify('danger', '⚠️', 'Error al eliminar', err.message, {duration: 5000});
  }
}
function importarUsuariosCSV(collection, tipo, pageId){
  const input = document.getElementById(pageId+'-file-input');
  if(input) input.click();
}
function descargarPlantilla(tipo){
  const titulos = {cliente:'Clientes', empleado:'Empleados', proveedor:'Proveedores'};
  let csv = '';
  if(tipo === 'cliente'){
    const headers = 'ID EFFI Tipo de identificación,Tipo de identificación,Número de identificación,Nombre,Teléfono 1,Teléfono 2,Celular,WhatsApp,Facetime,Skype,Email,Web,Direcciones,País,Departamento,Ciudad,ID EFFI Ciudad,Dirección,Fecha de nacimiento,Género,Tipo de persona,Régimen tributario,Tipo de cliente,Tipo de marketing,Tarifa de precios,Actividad económica CIIU,Forma de pago,Descuento,Cupo de crédito CXC,Moneda principal,Sucursal,Ruta logística,Vendedor,Responsable asignado,Fecha última venta,Observación,Vigencia,Fecha de creación,Responsable de creación,Fecha de modificación,Responsable de modificación,Fecha de anulación,Responsable de anulación';
    const ejemplo = '2,Cédula de ciudadanía,12345678,María García López,3001234567,,3001234567,3001234567,,,maria@email.com,,,,Antioquia,Medellín,,Calle 10 # 5-20,1990-05-15,,Física (natural),,,,,,,0,0,Peso Colombiano $ COP,,,,,,,Cliente de prueba,Vigente,' + new Date().toISOString().split("T")[0] + ',,,,';
    csv = headers + '\n' + ejemplo;
  } else if(tipo === 'empleado'){
    csv = 'Nombre,Cédula,Celular,Email,Ciudad,Salario Base,Tipo Contrato\nJuan Pérez,12345678,3001234567,juan@email.com,Medellín,1750905,indefinido';
  } else {
    csv = 'Tipo ID,Cédula/NIT,Nombre,Celular,WhatsApp,Email,Ciudad,Departamento,Dirección,Tipo Persona,Observación\nNIT,900123456,Empresa XYZ,3001234567,,info@empresa.com,Medellín,Antioquia,Cra 1 #2-3,Jurídica,';
  }
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `plantilla_${titulos[tipo]||tipo}.csv`; a.click();
  notify('success','⬇','Plantilla descargada','Completa y luego importa el archivo.',{duration:3000});
}

function exportarUsuarios(collection, tipo){
  const items = state[collection] || [];
  if(items.length === 0){ notify('warning','⚠️','Sin datos','No hay registros para exportar.',{duration:3000}); return; }

  const BOM = '\uFEFF';
  const headers = [
    'ID EFFI Tipo de identificación','Tipo de identificación','Número de identificación',
    'Nombre','Teléfono 1','Teléfono 2','Celular','WhatsApp','Facetime','Skype',
    'Email','Web','Direcciones','País','Departamento','Ciudad','ID EFFI Ciudad',
    'Dirección','Fecha de nacimiento','Género','Tipo de persona','Régimen tributario',
    'Tipo de cliente','Tipo de marketing','Tarifa de precios','Actividad económica CIIU',
    'Forma de pago','Descuento','Cupo de crédito CXC','Moneda principal','Sucursal',
    'Ruta logística','Vendedor','Responsable asignado','Fecha última venta','Observación',
    'Vigencia','Fecha de creación','Responsable de creación','Fecha de modificación',
    'Responsable de modificación','Fecha de anulación','Responsable de anulación'
  ];

  const q = (v) => `"${String(v||'').replace(/"/g,'""')}"`;

  const rows = items.map(u => [
    q('2'), q(u.tipoId==='NIT'?'NIT':'Cédula de ciudadanía'),
    q(u.cedula||''), q(u.nombre||''),
    q(u.telefono||u.celular||''), q(''), q(u.celular||''), q(u.whatsapp||''),
    q(''), q(''), q(u.email||''), q(''),
    q(u.departamento&&u.ciudad ? `*Colombia / ${u.departamento} / ${u.ciudad} / ${u.direccion||''}` : ''),
    q('Colombia'), q(u.departamento||''), q(u.ciudad||''), q(''),
    q(u.direccion||''), q(u.fechaNac||''), q(u.genero||''),
    q(u.tipoPersona==='Jurídica'?'Jurídica':'Física (natural)'),
    q(''), q('Común'), q(''), q('Tarifa normal | Mayorista'),
    q(''), q(''), q('0,00'), q('0,00'), q('Peso Colombiano $ COP'),
    q(''), q(''), q(''), q(''), q(''), q(u.observacion||''),
    q('Vigente'), q(u.fechaCreacion||today()), q('VentasHera'), q(''), q(''), q(''), q('')
  ].join(','));

  const csv = BOM + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${tipo}s_VentasHera_${today()}.csv`;
  a.click();
  notify('success','⬆','Exportación exitosa',`${items.length} registros exportados.`,{duration:3000});
}


function procesarArchivoUsuarios(input, collection, tipo, pageId) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      showLoadingOverlay('connecting');
      const raw = e.target.result;

      let rows = []; // Array de arrays de strings

      // Detectar si es HTML (XLS de EFFI/Excel exportado como HTML)
      const isHTML = raw.trim().startsWith('<') || raw.includes('<table') || raw.includes('<tr');

      if(isHTML) {
        // Parsear tabla HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(raw, 'text/html');
        const trs = doc.querySelectorAll('tr');
        trs.forEach(tr => {
          const cells = [...tr.querySelectorAll('th,td')].map(td => td.textContent.trim());
          if(cells.length > 0) rows.push(cells);
        });
      } else {
        // CSV/TSV texto plano
        const text = raw.replace(/^\uFEFF/, '');
        const firstLine = text.split(/\r?\n/)[0];
        const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        lines.forEach(line => {
          if(sep === '\t') {
            rows.push(line.split('\t').map(c => c.trim()));
          } else {
            const cols = [];
            let cur = '', inQ = false;
            for(const ch of (line + sep)) {
              if(ch === '"') { inQ = !inQ; }
              else if(ch === sep && !inQ) { cols.push(cur.trim()); cur = ''; }
              else cur += ch;
            }
            rows.push(cols);
          }
        });
      }

      if(rows.length < 2) throw new Error("Archivo vacío o sin datos.");

      // Detectar fila de encabezados
      const headerRow = rows[0];
      const isEFFI = headerRow.some(h => h.includes('Tipo de identificaci') || h.includes('mero de identificaci') || h.includes('ID EFFI'));

      let importados = 0, duplicados = 0;
      if(!Array.isArray(state[collection])) state[collection] = [];
      const existentes = new Set(state[collection].map(u => u.cedula).filter(Boolean));
      let batch = [];

      for(let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        if(cols.length < 3) continue;

        const clean = (n) => (cols[n]||'').replace(/^"|"$/g,'').trim();

        let u;
        if(isEFFI) {
          // Formato EFFI exacto (43 columnas)
          // 0=ID EFFI tipo, 1=Tipo ID texto, 2=Número ID, 3=Nombre
          // 4=Tel1, 5=Tel2, 6=Celular, 7=WhatsApp, 10=Email
          // 13=País, 14=Departamento, 15=Ciudad, 17=Dirección
          // 18=Fecha nac, 19=Género, 20=Tipo persona, 35=Observación
          const cedula = clean(2);
          const nombre = clean(3);
          if(!nombre) continue;
          if(cedula && existentes.has(cedula)) { duplicados++; continue; }
          u = {
            id: crypto.randomUUID(), tipo, tipoId: 'CC',
            cedula, nombre,
            telefono: clean(4),
            celular: clean(6) || clean(4),
            whatsapp: clean(7),
            email: clean(10),
            departamento: clean(14),
            ciudad: clean(15),
            direccion: clean(17),
            fechaNac: clean(18),
            genero: clean(19),
            tipoPersona: (clean(20)||'').toLowerCase().includes('natural') || (clean(20)||'').toLowerCase().includes('física') ? 'Natural' : 'Jurídica',
            observacion: clean(35),
            fechaCreacion: today()
          };
        } else {
          // Formato simple VentasHera
          const cedula = clean(1);
          const nombre = clean(2);
          if(!nombre) continue;
          if(cedula && existentes.has(cedula)) { duplicados++; continue; }
          u = {
            id: crypto.randomUUID(), tipo, tipoId: clean(0)||'CC',
            cedula, nombre,
            celular: clean(3), whatsapp: clean(4), email: clean(5),
            ciudad: clean(6), departamento: clean(7), direccion: clean(8),
            tipoPersona: clean(9)||'Natural', fechaNac: clean(10),
            observacion: clean(11), fechaCreacion: today()
          };
        }

        state[collection].push(u);
        if(u.cedula) existentes.add(u.cedula);
        importados++;

        if(tipo === 'cliente') {
          batch.push({
            id: u.id, nombre: u.nombre,
            cedula: u.cedula||null, celular: u.celular||null,
            telefono: u.telefono||null, whatsapp: u.whatsapp||null,
            ciudad: u.ciudad||null, direccion: u.direccion||null
          });
        }

        if(batch.length >= 500) {
          try { await supabaseClient.from('customers').upsert(batch, {onConflict:'id'}); }
          catch(ue) { console.warn('Batch upsert:', ue.message); }
          batch = [];
        }
      }

      if(batch.length > 0) {
        try { await supabaseClient.from('customers').upsert(batch, {onConflict:'id'}); }
        catch(ue) { console.warn('Final upsert:', ue.message); }
      }

      input.value = '';
      showLoadingOverlay('hide');
      renderPage(pageId);
      notify('success','📥','Importación exitosa',`${importados} importados · ${duplicados} duplicados omitidos`,{duration:4000});

    } catch(err) {
      showLoadingOverlay('hide');
      console.error('Import error:', err);
      notify('danger','⚠️','Error en importación', err.message, {duration:5000});
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// ===================================================================
// ===== GUÍAS / LOGÍSTICA =====
// ===================================================================

function _logisticaReadFilters(){
  return {
    q:(document.getElementById('log-search')?.value||'').toLowerCase(),
    desde:document.getElementById('log-desde')?.value||'',
    hasta:document.getElementById('log-hasta')?.value||'',
    canal:document.getElementById('log-canal')?.value||'',
    trans:document.getElementById('log-trans')?.value||'',
    estado:document.getElementById('log-estado')?.value||'',
    tipo:document.getElementById('log-tipo')?.value||'',
    ciudad:(document.getElementById('log-ciudad')?.value||'').toLowerCase()
  };
}

function _filterVentasGuias(f){
  let guias=[...(state.ventas||[])].filter(v=>v.canal==='local'||v.canal==='inter');
  if(f.canal)guias=guias.filter(v=>v.canal===f.canal);
  if(f.trans)guias=guias.filter(v=>(v.transportadora||v.empresa||'').toLowerCase().includes(f.trans.toLowerCase()));
  if(f.estado==='liq')guias=guias.filter(v=>!!v.liquidado);
  if(f.estado==='pend')guias=guias.filter(v=>!v.liquidado);
  if(f.tipo==='ce')guias=guias.filter(v=>!!v.esContraEntrega);
  if(f.tipo==='contado')guias=guias.filter(v=>!v.esContraEntrega);
  if(f.ciudad)guias=guias.filter(v=>(v.ciudad||'').toLowerCase().includes(f.ciudad));
  if(f.desde)guias=guias.filter(v=>v.fecha>=f.desde);
  if(f.hasta)guias=guias.filter(v=>v.fecha<=f.hasta);
  if(f.q)guias=guias.filter(v=>(v.cliente||'').toLowerCase().includes(f.q)||(v.guia||'').toLowerCase().includes(f.q)||(v.telefono||'').toLowerCase().includes(f.q)||(v.ciudad||'').toLowerCase().includes(f.q)||(v.transportadora||v.empresa||'').toLowerCase().includes(f.q));
  return guias;
}

function renderLogistica(){
  const el=document.getElementById('logistica-content');if(!el)return;
  const f=_logisticaReadFilters();
  let guias=_filterVentasGuias(f).reverse();
  const total=(state.ventas||[]).filter(v=>v.canal==='local'||v.canal==='inter').length;
  const totalFiltrado=guias.reduce((s,v)=>s+(parseFloat(v.valor)||0),0);
  const totalCE=guias.filter(v=>v.esContraEntrega).reduce((s,v)=>s+(parseFloat(v.valor)||0),0);
  const totalLiq=guias.filter(v=>v.liquidado).length;
  const totalPend=guias.length-totalLiq;
  const resumenTrans={};
  guias.forEach(v=>{
    const k=v.transportadora||v.empresa||'—';
    if(!resumenTrans[k])resumenTrans[k]={n:0,val:0};
    resumenTrans[k].n+=1;
    resumenTrans[k].val+=parseFloat(v.valor)||0;
  });
  const topTrans=Object.entries(resumenTrans).sort((a,b)=>b[1].val-a[1].val).slice(0,6);

  const hasFiltros=!!(f.q||f.canal||f.trans||f.desde||f.hasta||f.estado||f.tipo||f.ciudad);

  const rowsHtml = guias.map(v=>`<tr>
    <td>${formatDate(v.fecha)}</td>
    <td><span class="badge ${v.canal==='local'?'badge-warn':'badge-inter'}">${v.canal==='local'?'🛵':'📦'} ${v.canal}</span></td>
    <td style="font-weight:700">${v.cliente||'—'}</td>
    <td>${v.telefono||'—'}</td>
    <td>${v.ciudad||'—'}</td>
    <td>${v.transportadora||v.empresa||'—'}</td>
    <td style="color:var(--accent);font-weight:700">${v.guia||'—'}</td>
    <td style="font-weight:700">${fmt(v.valor||0)}</td>
    <td><span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'✓ Liq':'⏳ Pend'}</span></td>
    <td><span class="badge ${v.esContraEntrega?'badge-warn':'badge-ok'}">${v.esContraEntrega?'📦 C/E':'💵 Ctdo'}</span></td>
    <td class="log-guias-accion" style="white-space:nowrap">
      <button type="button" class="btn btn-xs btn-secondary" title="Abrir para imprimir o guardar como PDF" onclick="printRelacionDespacho('${v.id}')">🖨️</button>
      <button type="button" class="btn btn-xs btn-secondary" title="Descargar relación (.html → abrí y Guardar como PDF)" onclick="downloadRelacionDespacho('${v.id}')">⬇️</button>
    </td>
  </tr>`).join('')||'<tr><td colspan="11" style="text-align:center;color:var(--text2);padding:24px">Sin guías</td></tr>';

  if(document.getElementById('log-tbody')) {
    document.getElementById('log-tbody').innerHTML = rowsHtml;
    const cnt = document.getElementById('log-count');
    if(cnt) cnt.textContent = `${guias.length} de ${total}`;
    const btnL = document.getElementById('log-limpiar');
    if(btnL) btnL.style.display=hasFiltros?'inline-flex':'none';
    const kpis = document.getElementById('log-kpis');
    if(kpis) kpis.innerHTML = `
      <div class="card" style="margin:0;text-align:center"><div style="font-family:Syne;font-size:20px;font-weight:800;color:var(--accent)">${fmt(totalFiltrado)}</div><div style="font-size:11px;color:var(--text2)">Total filtrado</div></div>
      <div class="card" style="margin:0;text-align:center"><div style="font-family:Syne;font-size:20px;font-weight:800;color:var(--yellow)">${fmt(totalCE)}</div><div style="font-size:11px;color:var(--text2)">Contraentrega</div></div>
      <div class="card" style="margin:0;text-align:center"><div style="font-family:Syne;font-size:20px;font-weight:800;color:var(--green)">${totalLiq}</div><div style="font-size:11px;color:var(--text2)">Liquidadas</div></div>
      <div class="card" style="margin:0;text-align:center"><div style="font-family:Syne;font-size:20px;font-weight:800;color:var(--red)">${totalPend}</div><div style="font-size:11px;color:var(--text2)">Pendientes</div></div>`;
    const rt = document.getElementById('log-resumen-trans');
    if(rt) rt.innerHTML = topTrans.length ? topTrans.map(([k,v])=>`<span class="badge badge-pend" style="margin-right:6px;margin-bottom:6px">${k}: ${v.n} · ${fmt(v.val)}</span>`).join('') : '<span style="color:var(--text2);font-size:11px">Sin datos</span>';
    return;
  }

  el.innerHTML=`
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;min-width:180px;max-width:280px;margin:0"><span class="search-icon">🔍</span>
        <input type="text" id="log-search" placeholder="Cliente, guía, teléfono..." value="${f.q}" oninput="renderLogistica()"></div>
      <select class="form-control" id="log-canal" style="width:130px" onchange="renderLogistica()">
        <option value="">Todos</option><option value="local" ${f.canal==='local'?'selected':''}>🛵 Local</option>
        <option value="inter" ${f.canal==='inter'?'selected':''}>📦 Inter</option></select>
      <select class="form-control" id="log-estado" style="width:130px" onchange="renderLogistica()">
        <option value="">Estado</option><option value="liq" ${f.estado==='liq'?'selected':''}>Liquidadas</option>
        <option value="pend" ${f.estado==='pend'?'selected':''}>Pendientes</option></select>
      <select class="form-control" id="log-tipo" style="width:140px" onchange="renderLogistica()">
        <option value="">Cobro</option><option value="ce" ${f.tipo==='ce'?'selected':''}>📦 C/E</option>
        <option value="contado" ${f.tipo==='contado'?'selected':''}>💵 Contado</option></select>
      <input type="text" class="form-control" id="log-trans" placeholder="Transportadora..." style="width:150px" value="${f.trans}" oninput="renderLogistica()">
      <input type="text" class="form-control" id="log-ciudad" placeholder="Ciudad..." style="width:130px" value="${f.ciudad}" oninput="renderLogistica()">
      <input type="date" class="form-control" id="log-desde" style="width:130px" value="${f.desde}" onchange="renderLogistica()">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="log-hasta" style="width:130px" value="${f.hasta}" onchange="renderLogistica()">
      <button class="btn btn-xs btn-secondary" onclick="exportGuiasExcel()">Excel</button>
      <button class="btn btn-xs btn-secondary" id="log-limpiar" style="display:${hasFiltros?'inline-flex':'none'}"
        onclick="['log-search','log-trans','log-ciudad'].forEach(id=>{document.getElementById(id).value=''});['log-canal','log-estado','log-tipo','log-desde','log-hasta'].forEach(id=>{document.getElementById(id).value=''});renderLogistica()">✕</button>
    </div>
    <div class="grid-4" id="log-kpis" style="margin-bottom:12px">
      <div class="card" style="margin:0;text-align:center"><div style="font-family:Syne;font-size:20px;font-weight:800;color:var(--accent)">${fmt(totalFiltrado)}</div><div style="font-size:11px;color:var(--text2)">Total filtrado</div></div>
      <div class="card" style="margin:0;text-align:center"><div style="font-family:Syne;font-size:20px;font-weight:800;color:var(--yellow)">${fmt(totalCE)}</div><div style="font-size:11px;color:var(--text2)">Contraentrega</div></div>
      <div class="card" style="margin:0;text-align:center"><div style="font-family:Syne;font-size:20px;font-weight:800;color:var(--green)">${totalLiq}</div><div style="font-size:11px;color:var(--text2)">Liquidadas</div></div>
      <div class="card" style="margin:0;text-align:center"><div style="font-family:Syne;font-size:20px;font-weight:800;color:var(--red)">${totalPend}</div><div style="font-size:11px;color:var(--text2)">Pendientes</div></div>
    </div>
    <div class="card" style="margin-bottom:12px;padding:10px 12px"><div style="font-size:11px;color:var(--text2);margin-bottom:6px">Resumen transportadoras (filtro actual)</div><div id="log-resumen-trans">${topTrans.length ? topTrans.map(([k,v])=>`<span class="badge badge-pend" style="margin-right:6px;margin-bottom:6px">${k}: ${v.n} · ${fmt(v.val)}</span>`).join('') : '<span style="color:var(--text2);font-size:11px">Sin datos</span>'}</div></div>
    <div class="card"><div class="card-title">🚚 GUÍAS — <span id="log-count">${guias.length} de ${total}</span></div>
    <div class="table-wrap"><table class="log-guias-table">
      <thead><tr><th>Fecha</th><th>Canal</th><th>Cliente</th><th>Teléfono</th><th>Ciudad</th><th>Transportadora</th><th>N° Guía</th><th>Total</th><th>Estado</th><th>Tipo Cobro</th><th>Acción</th></tr></thead>
      <tbody id="log-tbody">${rowsHtml}</tbody>
    </table></div></div>`;
}

function exportGuiasExcel(){
  const f=_logisticaReadFilters();
  const guias=_filterVentasGuias(f).reverse();
  const escXml=(s)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const header=['Fecha','Canal','Cliente','Telefono','Ciudad','Transportadora','Guia','Valor','Estado','TipoCobro'];
  let rowsXml='<Row>'+header.map(h=>`<Cell><Data ss:Type="String">${escXml(h)}</Data></Cell>`).join('')+'</Row>';
  guias.forEach(v=>{
    const vals=[
      formatDate(v.fecha||''),
      v.canal||'',
      v.cliente||'',
      v.telefono||'',
      v.ciudad||'',
      v.transportadora||v.empresa||'',
      v.guia||'',
      parseFloat(v.valor)||0,
      v.liquidado?'Liquidado':'Pendiente',
      v.esContraEntrega?'Contraentrega':'Contado'
    ];
    rowsXml+='<Row>';
    vals.forEach((val,i)=>{
      if(i===7)rowsXml+=`<Cell><Data ss:Type="Number">${val}</Data></Cell>`;
      else rowsXml+=`<Cell><Data ss:Type="String">${escXml(val)}</Data></Cell>`;
    });
    rowsXml+='</Row>';
  });
  const xml=`<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
<Worksheet ss:Name="Guias"><Table>${rowsXml}</Table></Worksheet>
</Workbook>`;
  const blob=new Blob([xml],{type:'application/vnd.ms-excel'});
  const fn=`guias_generadas_${today()}.xls`;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=fn;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
  notify('success','📊','Excel generado',`Descargado: ${fn}`,{duration:2500});
}

function buildRelacionDespachoDocumentHtml(venta){
  if(!venta)return'';
  const emp=state.empresa||{};
  const esc=(v)=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const canalTxt=venta.canal==='local'?'Local':'Intermunicipal';
  const tipoCobro=venta.esContraEntrega?'Contraentrega':'Contado';
  const estadoCobro=venta.liquidado?'Liquidado':'Pendiente';
  const transportadora=venta.transportadora||venta.empresa||'—';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>Relacion de despacho ${esc(venta.guia||venta.id||'')}</title>
  <style>
    :root{color-scheme:light;}
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;margin:20px;color:#111}
    .top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}
    .title{font-size:22px;font-weight:800;letter-spacing:.4px}
    .sub{font-size:12px;color:#4b5563;margin-top:4px}
    .badge{display:inline-block;border:1px solid #d1d5db;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700}
    .card{border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:12px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px}
    .label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.4px}
    .value{font-size:15px;font-weight:700}
    .note{margin-top:16px;font-size:12px;color:#374151}
    .actions{margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap}
    .actions button{padding:8px 14px;border:0;border-radius:8px;background:#111;color:#fff;font-weight:700;cursor:pointer}
    .actions .sec{background:#374151}
    @media (max-width:700px){.grid{grid-template-columns:1fr}}
    @media print{.actions{display:none}body{margin:10mm}.card{break-inside:avoid}}
  </style></head><body>
    <div class="actions">
      <button type="button" onclick="window.print()">Imprimir / Guardar PDF</button>
      <button type="button" class="sec" onclick="window.close()">Cerrar</button>
    </div>
    <div class="top">
      <div>
        <div class="title">Relacion de despacho</div>
        <div class="sub">${esc(emp.nombre||'VentasHera ERP')} · ${esc(formatDate(venta.fecha||today()))}</div>
      </div>
      <div class="badge">Guia: ${esc(venta.guia||'—')}</div>
    </div>
    <div class="card">
      <div class="grid">
        <div><div class="label">Cliente</div><div class="value">${esc(venta.cliente||'—')}</div></div>
        <div><div class="label">Telefono</div><div class="value">${esc(venta.telefono||'—')}</div></div>
        <div><div class="label">Ciudad</div><div class="value">${esc(venta.ciudad||'—')}</div></div>
        <div><div class="label">Transportadora</div><div class="value">${esc(transportadora)}</div></div>
        <div><div class="label">Canal</div><div class="value">${esc(canalTxt)}</div></div>
        <div><div class="label">Tipo cobro</div><div class="value">${esc(tipoCobro)}</div></div>
        <div><div class="label">Estado cobro</div><div class="value">${esc(estadoCobro)}</div></div>
        <div><div class="label">Valor despacho</div><div class="value">${esc(fmt(venta.valor||0))}</div></div>
      </div>
      <div class="note">Documento generado desde Guias Generadas para soporte logistico de despacho.</div>
    </div>
  </body></html>`;
}

function printRelacionDespacho(id){
  const venta=(state.ventas||[]).find(v=>v.id===id);
  if(!venta){notify('warning','⚠️','Guía no encontrada','No se encontró la venta asociada.',{duration:3000});return;}
  const html=buildRelacionDespachoDocumentHtml(venta);
  const w=window.open('','_blank','width=900,height=700,scrollbars=yes');
  if(!w){
    notify('warning','⚠️','Popup bloqueado','Permite ventanas emergentes o usa el botón ⬇️ para descargar la relación.',{duration:5000});
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
}

function downloadRelacionDespacho(id){
  const venta=(state.ventas||[]).find(v=>v.id===id);
  if(!venta){notify('warning','⚠️','Guía no encontrada','No se encontró la venta asociada.',{duration:3000});return;}
  const html=buildRelacionDespachoDocumentHtml(venta);
  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const a=document.createElement('a');
  const safe=String(venta.guia||venta.id||'guia').replace(/[^\w\-.]+/g,'_');
  const fn=`Relacion_despacho_${safe}.html`;
  a.href=URL.createObjectURL(blob);
  a.download=fn;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
  notify('success','📄','Relación descargada',`Abrí ${fn} → Imprimir → Guardar como PDF`,{duration:5500});
}

// ===================================================================
// ===== COBROS / PENDIENTES =====
// ===================================================================

function renderPendientes(){
  // Ventas local/inter no liquidadas (casi siempre contra entrega): seguimiento de cobro; ingreso ya va en caja con fecha de venta
  const pend=(state.ventas||[]).filter(v=>ventaCuentaParaTotales(v)&&v.canal!=='vitrina'&&!v.liquidado).sort((a,b)=>(a.fechaLiquidacion||'')>(b.fechaLiquidacion||'')?1:-1);
  const totalPend=pend.reduce((a,v)=>a+v.valor,0);
  let html=`<div class="card" style="margin-bottom:16px;padding:12px;font-size:12px;color:var(--text2)">💡 <b>Contra entrega:</b> al vender en POS el <b>ingreso en caja</b> y los <b>totales del día</b> usan la <b>fecha de la venta</b>. Esta lista es seguimiento hasta confirmar cobro al cliente/transp. <b>Marcar liquidado</b> solo cierra el pendiente — <b>no crea otro ingreso</b> ni duplica la venta.</div>`;
  html+=`<div class="grid-2" style="margin-bottom:20px"><div class="card" style="margin:0"><div class="stat-val" style="color:var(--red)">${pend.length}</div><div class="stat-label">Pendientes de liquidar</div></div><div class="card" style="margin:0"><div class="stat-val" style="color:var(--yellow)">${fmt(totalPend)}</div><div class="stat-label">Total en lista</div></div></div>`;
  if(pend.length===0)html+='<div class="empty-state"><div class="es-icon">✅</div><div class="es-title" style="color:var(--green)">¡Todo al día!</div><div class="es-text">No hay ventas pendientes de liquidación</div></div>';
  else pend.forEach(v=>{
    const diff=daysDiff(v.fechaLiquidacion);const urgClass=diff<0?'urgent':diff<=1?'warning':'ok';const urgLabel=diff<0?`⚡ VENCIDO hace ${Math.abs(diff)}d`:diff===0?'⚠️ Vence HOY':diff===1?'⚠️ Vence mañana':`✓ Vence en ${diff}d`;
    const empresaString = v.empresa ? (v.transportadora ? `${v.empresa} (${v.transportadora})` : v.empresa) : '';
    const refDoc = v.desc || '—';
    const tipoCobro = v.esContraEntrega ? '📦 Contraentrega' : '💳 Cobro / cierre';
    html+=`<div class="urgency-item ${urgClass}"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><div><span class="badge badge-${v.canal}">${v.canal==='local'?'🛵 Local':'📦 Inter'}</span> <span class="badge badge-warn" style="margin-left:4px">${tipoCobro}</span> <span style="font-family:Syne;font-weight:700;color:var(--accent);margin-left:6px">${fmt(v.valor)}</span></div><span style="font-size:11px;font-weight:700;color:${urgClass==='urgent'?'var(--red)':urgClass==='warning'?'var(--yellow)':'var(--green)'}">${urgLabel}</span></div><div style="font-size:12px;margin-bottom:4px"><b>${v.cliente||'Sin nombre'}</b>${v.telefono?' · '+v.telefono:''}</div><div style="font-size:11px;color:var(--accent);margin-bottom:4px">Ref: ${refDoc}</div>${v.guia?'<div style="font-size:12px;color:var(--text2);margin-bottom:4px">Guía: '+v.guia+' · '+empresaString+'</div>':''}<div style="font-size:12px;color:var(--text2);margin-bottom:10px">${formatDate(v.fecha)} → Recordatorio límite: ${formatDate(v.fechaLiquidacion)}</div>${cobrosProductosResumenHtml(v)}<div class="btn-group" style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="marcarLiquidado('${v.id}')">✓ Marcar liquidado (+20XP)</button></div></div>`});
  document.getElementById('pendientes-content').innerHTML=html;
}
function marcarLiquidado(id) {
  const v = state.ventas.find((x) => x.id === id);
  if (!v) return;
  if (v.liquidado) {
    notify('info', 'ℹ️', 'Ya liquidada', 'No hay otro ingreso en caja ni venta duplicada — solo se actualizó el estado antes.', { duration: 4500 });
    return;
  }

  v.liquidado = true;
  awardXP(20);

  // Solo persistir venta: el ingreso en tesorería se registró en el POS (fecha = día de la venta).
  saveRecord('ventas', v.id, v);
  saveConfig('game', state.game);

  renderPendientes();
  updateNavBadges();
  notify('success', '✅', 'Seguimiento cerrado', `${v.desc || 'Venta'} liquidada · sin duplicar ingreso en caja · +20XP`, { duration: 4000 });
  screenFlash('green');
}

function renderIngresosEgresosPage() {
  if (window.AppIngresosEgresosModule?.renderPage) {
    // Pasa el contexto completo al "otro módulo" para que guarde y refresque su UI.
    if (typeof window.__IE_SETUP__ === 'function') {
      window.__IE_SETUP__({
        state,
        fmt,
        formatDate,
        openModal,
        closeModal,
        notify,
        today,
        dbId,
        uid,
        saveRecord
      });
    }
    return window.AppIngresosEgresosModule.renderPage({
      state,
      fmt,
      formatDate,
      openModal,
      closeModal,
      notify,
      today,
      dbId,
      uid,
      saveRecord
    });
  }

  const el = document.getElementById('ingresos_egresos-content');
  if (el) el.innerHTML = `<div class="empty-state" style="padding:16px;color:var(--text2)">Módulo Ingresos/Egresos no disponible.</div>`;
}

// ===================================================================
// ===== NÓMINA =====
// ===================================================================
function renderNomAusencias(){
  if (window.AppNominaModule?.renderNomAusencias) {
    return window.AppNominaModule.renderNomAusencias({ state, formatDate });
  }
  const items=[...(state.nom_ausencias||[])].reverse();
  document.getElementById('nom_ausencias-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openNomAusenciaModal()">+ Nueva Ausencia</button>
    <div class="card"><div class="card-title">AUSENCIAS LABORALES (${items.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Empleado</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th>Días</th><th>Estado</th><th></th></tr></thead><tbody>
    ${items.map(a=>`<tr><td>${a.empleado}</td><td><span class="badge badge-warn">${a.tipo}</span></td><td>${formatDate(a.desde)}</td><td>${formatDate(a.hasta)}</td><td style="font-weight:700">${a.dias}</td><td><span class="badge ${a.aprobada?'badge-ok':'badge-pend'}">${a.aprobada?'Aprobada':'Pendiente'}</span></td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_ausencias','${a.id}','nom_ausencias')">✕</button></td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin ausencias</td></tr>'}
    </tbody></table></div></div>`;
}

function openNomAusenciaModal(){
  if (window.AppNominaModule?.openNomAusenciaModal) {
    return window.AppNominaModule.openNomAusenciaModal({ openModal, today });
  }
  openModal(`
    <div class="modal-title">Nueva Ausencia<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">EMPLEADO</label><input class="form-control" id="m-na-emp" placeholder="Nombre del empleado"></div>
    <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-na-tipo"><option value="Vacaciones">Vacaciones</option><option value="Incapacidad">Incapacidad</option><option value="Licencia">Licencia</option><option value="Permiso">Permiso</option><option value="Maternidad">Maternidad</option><option value="Calamidad">Calamidad</option></select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">DESDE</label><input type="date" class="form-control" id="m-na-desde" value="${today()}"></div>
      <div class="form-group"><label class="form-label">HASTA</label><input type="date" class="form-control" id="m-na-hasta" value="${today()}"></div>
    </div>
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="m-na-obs" rows="2"></textarea></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveNomAusencia()">Guardar Ausencia</button>
  `);
}

function saveNomAusencia(){
  if (window.AppNominaModule?.saveNomAusencia) {
    return window.AppNominaModule.saveNomAusencia({ state, uid, dbId, saveRecord, closeModal, renderNomAusencias, notify });
  }
  const emp=document.getElementById('m-na-emp').value.trim();if(!emp)return;
  const desde=document.getElementById('m-na-desde').value;const hasta=document.getElementById('m-na-hasta').value;
  const dias=Math.max(1,Math.round((new Date(hasta)-new Date(desde))/86400000)+1);
  const aus={id:dbId(),empleado:emp,tipo:document.getElementById('m-na-tipo').value,desde,hasta,dias,observaciones:document.getElementById('m-na-obs').value.trim(),aprobada:false};
  state.nom_ausencias.push(aus);
  saveRecord('nom_ausencias',aus.id,aus);
  closeModal();renderNomAusencias();notify('success','✅','Ausencia registrada',emp+' · '+dias+' días',{duration:3000});
}

function renderNomAnticipos(){
  if (window.AppNominaModule?.renderNomAnticipos) {
    return window.AppNominaModule.renderNomAnticipos({ state, formatDate, fmt });
  }
  const items=[...(state.nom_anticipos||[])].reverse();
  document.getElementById('nom_anticipos-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openSimpleFormModal('nom_anticipos','Anticipo de Nómina',['empleado:text:EMPLEADO','valor:number:VALOR','fecha:date:FECHA','motivo:text:MOTIVO'])">+ Nuevo Anticipo</button>
    <div class="card"><div class="card-title">ANTICIPOS DE NÓMINA (${items.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Empleado</th><th>Valor</th><th>Motivo</th><th></th></tr></thead><tbody>
    ${items.map(a=>`<tr><td>${formatDate(a.fecha)}</td><td>${a.empleado}</td><td style="color:var(--accent);font-weight:700">${fmt(a.valor||0)}</td><td>${a.motivo||'—'}</td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_anticipos','${a.id}','nom_anticipos')">✕</button></td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:24px">Sin anticipos</td></tr>'}
    </tbody></table></div></div>`;
}

function renderNomConceptos(){
  if (window.AppNominaModule?.renderNomConceptos) {
    return window.AppNominaModule.renderNomConceptos({ state, fmt });
  }
  const items=state.nom_conceptos||[];
  document.getElementById('nom_conceptos-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openConceptoModal()">+ Nuevo Concepto</button>
    <div class="card"><div class="card-title">CONCEPTOS DE NÓMINA</div>
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Fórmula</th><th>Valor</th><th></th></tr></thead><tbody>
    ${items.map(c=>`<tr><td style="font-weight:700">${c.nombre}</td><td><span class="badge ${c.tipo==='devengo'?'badge-ok':'badge-pend'}">${c.tipo}</span></td><td>${c.formula}</td><td>${c.formula==='porcentaje'?c.valor+'%':fmt(c.valor)}</td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_conceptos','${c.id}','nom_conceptos')">✕</button></td></tr>`).join('')}
    </tbody></table></div></div>`;
}

function openConceptoModal(){
  if (window.AppNominaModule?.openConceptoModal) {
    return window.AppNominaModule.openConceptoModal({ openModal });
  }
  openModal(`
    <div class="modal-title">Nuevo Concepto<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">NOMBRE</label><input class="form-control" id="m-nc-nombre" placeholder="Ej: Horas Extra"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-nc-tipo"><option value="devengo">Devengo</option><option value="deduccion">Deducción</option></select></div>
      <div class="form-group"><label class="form-label">FÓRMULA</label><select class="form-control" id="m-nc-formula"><option value="fijo">Valor Fijo</option><option value="porcentaje">Porcentaje sobre salario</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">VALOR</label><input type="number" class="form-control" id="m-nc-valor" placeholder="0"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveConcepto()">Guardar</button>
  `);
}

function saveConcepto(){
  if (window.AppNominaModule?.saveConcepto) {
    return window.AppNominaModule.saveConcepto({ state, uid, dbId, saveRecord, closeModal, renderNomConceptos });
  }
  const nombre=document.getElementById('m-nc-nombre').value.trim();if(!nombre)return;
  const conc={id:dbId(),nombre,tipo:document.getElementById('m-nc-tipo').value,formula:document.getElementById('m-nc-formula').value,valor:parseFloat(document.getElementById('m-nc-valor').value)||0};
  state.nom_conceptos.push(conc);
  saveRecord('nom_conceptos',conc.id,conc);
  closeModal();renderNomConceptos();
}

// ===================================================================
// ===== NÓMINA COLOMBIA - MÓDULO COMPLETO =====
// ===================================================================

// Constantes legales Colombia 2026 (Decretos 1469 / 1470; UVT Res. DIAN)
const SMMLV_2026 = 1750905;
const AUX_TRANSPORTE_2026 = 249095;
const UVT_2026 = 52374;

// Porcentajes PILA empleado
const PILA_EMP = { salud: 0.04, pension: 0.04 };
// Porcentajes PILA empleador
const PILA_EMP_ADOR = { salud: 0.0850, pension: 0.12, arl: 0.00522, caja: 0.04 };
// Provisiones empleador
const PROV = { prima: 1/12, cesantias: 1/12, intCesantias: 0.12/12, vacaciones: 1/24 };

function calcNomina(cfg) {
  if (window.AppNominaModule?.calcNomina) {
    return window.AppNominaModule.calcNomina(cfg);
  }
  // cfg: { salario, diasTrabajados, diasPeriodo, ausenciasNoPagas, incapacidades,
  //        anticipos, otrosDevengos, otrasDeducc, tipo ('quincenal'|'mensual'|'vacaciones'|'prima'|'cesantias'|'liquidacion') }
  const {
    salario = SMMLV_2026,
    diasTrabajados = 15,
    diasPeriodo = 15,
    ausenciasNoPagas = 0,
    incapacidades = 0, // días incapacidad
    anticipos = 0,
    otrosDevengos = 0,
    otrasDeducc = 0,
    tipo = 'quincenal',
    diasVacaciones = 0,
    diasCesantias = 0,
    periodosLiquidar = 0 // para liquidación completa
  } = cfg;

  const salarioDia = salario / 30;
  const auxTransDia = (salario <= 2 * SMMLV_2026) ? AUX_TRANSPORTE_2026 / 30 : 0;
  const tieneAuxTrans = salario <= 2 * SMMLV_2026;

  let resultado = {};

  if (tipo === 'quincenal' || tipo === 'mensual') {
    const dp = tipo === 'quincenal' ? 15 : 30;
    const diasEfectivos = Math.max(0, dp - ausenciasNoPagas);
    const salarioBase = salarioDia * diasEfectivos;
    const auxTrans = tieneAuxTrans ? (auxTransDia * diasEfectivos) : 0;
    // Incapacidad: EPS paga 2/3 desde día 3
    const valorIncap = incapacidades > 0 ? (salarioDia * incapacidades * (2/3)) : 0;
    const totalDevengado = salarioBase + auxTrans + otrosDevengos + valorIncap;

    const deducSalud = totalDevengado * PILA_EMP.salud;
    const deducPension = totalDevengado * PILA_EMP.pension;
    const totalDeducc = deducSalud + deducPension + anticipos + otrasDeducc;
    const neto = Math.max(0, totalDevengado - totalDeducc);

    // Costos empleador
    const costoSalud = salarioBase * PILA_EMP_ADOR.salud;
    const costoPension = salarioBase * PILA_EMP_ADOR.pension;
    const costoArl = salarioBase * PILA_EMP_ADOR.arl;
    const costoCaja = salarioBase * PILA_EMP_ADOR.caja;
    // Provisiones
    const provPrima = (salarioBase + auxTrans) * PROV.prima;
    const provCes = (salarioBase + auxTrans) * PROV.cesantias;
    const provIntCes = provCes * (PROV.intCesantias * 12);
    const provVac = salarioBase * PROV.vacaciones;
    const costoTotal = totalDevengado + costoSalud + costoPension + costoArl + costoCaja + provPrima + provCes + provIntCes + provVac;

    resultado = {
      tipo, diasEfectivos, salarioBase, auxTrans, valorIncap, otrosDevengos,
      totalDevengado, deducSalud, deducPension, anticipos, otrasDeducc,
      totalDeducc, neto,
      empleador: { costoSalud, costoPension, costoArl, costoCaja, provPrima, provCes, provIntCes, provVac, costoTotal }
    };

  } else if (tipo === 'vacaciones') {
    // Vacaciones: salario/30 × días (15 días por año trabajado)
    const valorVac = salarioDia * diasVacaciones;
    resultado = { tipo, diasVacaciones, salarioBase: valorVac, totalDevengado: valorVac, neto: valorVac };

  } else if (tipo === 'prima') {
    // Prima: (salario + auxTransporte) / 12 × meses trabajados (máx 6 por semestre)
    const meses = diasCesantias / 30;
    const base = salario + (tieneAuxTrans ? AUX_TRANSPORTE_2026 : 0);
    const valor = (base / 12) * meses;
    resultado = { tipo, meses, base, valor, totalDevengado: valor, neto: valor };

  } else if (tipo === 'cesantias') {
    // Cesantías: salario × días / 360
    const base = salario + (tieneAuxTrans ? AUX_TRANSPORTE_2026 : 0);
    const valor = (base * diasCesantias) / 360;
    const intCes = valor * 0.12 * (diasCesantias / 365);
    resultado = { tipo, diasCesantias, base, valor, intCes, totalDevengado: valor + intCes, neto: valor + intCes };

  } else if (tipo === 'liquidacion') {
    // Liquidación completa al terminar contrato
    const diasTrab = periodosLiquidar; // días totales trabajados
    const cesan = (salario + (tieneAuxTrans ? AUX_TRANSPORTE_2026 : 0)) * diasTrab / 360;
    const intCes = cesan * 0.12 * (diasTrab / 365);
    const prima = (salario + (tieneAuxTrans ? AUX_TRANSPORTE_2026 : 0)) / 12 * (diasTrab / 30);
    const vac = salarioDia * (diasTrab / 720) * 15;
    const total = cesan + intCes + prima + vac;
    resultado = { tipo, diasTrab, cesan, intCes, prima, vac, totalDevengado: total, neto: total };
  }

  return resultado;
}

function renderNomNominas(){
  if (window.AppNominaModule?.renderNomNominas) {
    return window.AppNominaModule.renderNomNominas({ state, fmt });
  }
  const items=[...(state.nom_nominas||[])].reverse();
  document.getElementById('nom_nominas-content').innerHTML=`
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn btn-primary" onclick="openLiquidacionModal('quincenal')">💰 Nueva Quincena</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('mensual')">📅 Nómina Mensual</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('prima')">🎁 Prima</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('cesantias')">🏦 Cesantías</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('vacaciones')">🌴 Vacaciones</button>
      <button class="btn btn-warning" onclick="openLiquidacionModal('liquidacion')">📋 Liquidación</button>
    </div>
    <div class="card"><div class="card-title">NÓMINAS LABORALES (${items.length})</div>
    <div class="table-wrap"><table><thead><tr>
      <th>#</th><th>Tipo</th><th>Periodo</th><th>Empleado</th>
      <th>Devengado</th><th>Deducciones</th><th>Neto</th><th>Estado</th><th></th>
    </tr></thead><tbody>
    ${items.map(n=>`<tr>
      <td style="font-weight:700">${n.numero||'—'}</td>
      <td><span class="badge badge-info">${(n.tipo||'quincena').toUpperCase()}</span></td>
      <td>${n.periodo||'—'}</td>
      <td>${n.empleado||'—'}</td>
      <td style="color:var(--green)">${fmt(n.devengado||0)}</td>
      <td style="color:var(--red)">${fmt(n.deducciones||0)}</td>
      <td style="color:var(--accent);font-weight:700">${fmt(n.neto||0)}</td>
      <td><span class="badge ${n.pagada?'badge-ok':'badge-warn'}">${n.pagada?'Pagada':'Pendiente'}</span></td>
      <td><div class="btn-group">
        <button class="btn btn-xs btn-secondary" onclick="verNomina('${n.id}')">👁</button>
        <button class="btn btn-xs btn-secondary" onclick="imprimirNomina('${n.id}')">🖨</button>
        ${!n.pagada?`<button class="btn btn-xs btn-primary" onclick="pagarNomina('${n.id}')">💰 Pagar</button>`:''}
        <button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_nominas','${n.id}','nom_nominas')">✕</button>
      </div></td>
    </tr>`).join('')||'<tr><td colspan="9" style="text-align:center;color:var(--text2);padding:24px">Sin nóminas</td></tr>'}
    </tbody></table></div></div>`;
}

function openLiquidacionModal(tipo){
  const empleados = state.empleados || [];
  const ausencias = state.nom_ausencias || [];
  const anticiposNom = state.nom_anticipos || [];
  const tipoLabel = {quincenal:'Nómina Quincenal',mensual:'Nómina Mensual',prima:'Liquidación Prima',cesantias:'Cesantías + Intereses',vacaciones:'Liquidación Vacaciones',liquidacion:'Liquidación Contrato'};

  const empOptions = empleados.length > 0
    ? empleados.map(e=>`<option value="${e.id}" data-salario="${e.salarioBase||e.salario_base||SMMLV_2026}">${e.nombre}</option>`).join('')
    : `<option value="">— Primero crea empleados —</option>`;

  const hoy = today();
  const [y, m] = hoy.split('-');
  const quincena1Desde = `${y}-${m}-01`;
  const quincena1Hasta = `${y}-${m}-15`;
  const quincena2Desde = `${y}-${m}-16`;
  const quincena2Hasta = `${y}-${m}-${new Date(y, m, 0).getDate()}`;

  let extraFields = '';
  if(tipo === 'quincenal') {
    extraFields = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">QUINCENA</label>
          <select class="form-control" id="nom-quincena" onchange="autoFillPeriodo()">
            <option value="1" data-desde="${quincena1Desde}" data-hasta="${quincena1Hasta}">1ª Quincena (1-15)</option>
            <option value="2" data-desde="${quincena2Desde}" data-hasta="${quincena2Hasta}">2ª Quincena (16-${new Date(y, m, 0).getDate()})</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">DÍAS AUSENTISMO NO PAGOS</label>
          <input type="number" class="form-control" id="nom-ausencias" value="0" min="0" max="15" oninput="calcularPreviewNomina()"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">DÍAS INCAPACIDAD</label>
          <input type="number" class="form-control" id="nom-incap" value="0" min="0" oninput="calcularPreviewNomina()"></div>
        <div class="form-group"><label class="form-label">OTROS DEVENGOS ($)</label>
          <input type="number" class="form-control" id="nom-otros-dev" value="0" min="0" oninput="calcularPreviewNomina()"></div>
      </div>`;
  } else if(tipo === 'mensual') {
    extraFields = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">DÍAS AUSENTISMO NO PAGOS</label>
          <input type="number" class="form-control" id="nom-ausencias" value="0" min="0" oninput="calcularPreviewNomina()"></div>
        <div class="form-group"><label class="form-label">DÍAS INCAPACIDAD</label>
          <input type="number" class="form-control" id="nom-incap" value="0" min="0" oninput="calcularPreviewNomina()"></div>
      </div>`;
  } else if(tipo === 'vacaciones') {
    extraFields = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">DÍAS DE VACACIONES</label>
          <input type="number" class="form-control" id="nom-dias-vac" value="15" min="1" oninput="calcularPreviewNomina()"></div>
        <div class="form-group"><label class="form-label">FECHA INICIO VACACIONES</label>
          <input type="date" class="form-control" id="nom-inicio-vac" value="${hoy}"></div>
      </div>`;
  } else if(tipo === 'prima' || tipo === 'cesantias') {
    extraFields = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">DÍAS A LIQUIDAR</label>
          <input type="number" class="form-control" id="nom-dias-ces" value="180" min="1" oninput="calcularPreviewNomina()"></div>
        <div class="form-group"><label class="form-label">PERIODO</label>
          <input class="form-control" id="nom-periodo-ces" placeholder="Ej: Ene-Jun 2026" value="Ene-Jun ${y}"></div>
      </div>`;
  } else if(tipo === 'liquidacion') {
    extraFields = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">DÍAS TOTALES TRABAJADOS</label>
          <input type="number" class="form-control" id="nom-dias-liq" value="360" min="1" oninput="calcularPreviewNomina()"></div>
        <div class="form-group"><label class="form-label">FECHA RETIRO</label>
          <input type="date" class="form-control" id="nom-fecha-retiro" value="${hoy}"></div>
      </div>`;
  }

  openModal(`
    <div class="modal-title">${tipoLabel[tipo]||tipo}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div style="max-height:75vh;overflow-y:auto;padding-right:8px">

      <div class="form-row">
        <div class="form-group"><label class="form-label">EMPLEADO *</label>
          <select class="form-control" id="nom-empleado" onchange="onNomEmpleadoChange()">
            <option value="">— Seleccionar —</option>${empOptions}
          </select></div>
        <div class="form-group"><label class="form-label">SALARIO BASE ($)</label>
          <input type="number" class="form-control" id="nom-salario" value="${SMMLV_2026}" oninput="calcularPreviewNomina()">
          <span style="font-size:10px;color:var(--text2)">SMMLV 2026: ${fmt(SMMLV_2026)}</span></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label class="form-label">PERIODO</label>
          <input class="form-control" id="nom-periodo" value="${tipo==='quincenal'?'1-15 '+new Date().toLocaleDateString('es-CO',{month:'long',year:'numeric'}):new Date().toLocaleDateString('es-CO',{month:'long',year:'numeric'})}"></div>
        <div class="form-group"><label class="form-label">ANTICIPOS DESCONTAR ($)</label>
          <input type="number" class="form-control" id="nom-anticipos-val" value="0" min="0" oninput="calcularPreviewNomina()">
          <span style="font-size:10px;color:var(--accent);cursor:pointer" onclick="cargarAnticiposEmpleado()">↙ Cargar anticipos pendientes</span></div>
      </div>

      ${extraFields}

      <div class="form-group"><label class="form-label">OTRAS DEDUCCIONES ($)</label>
        <input type="number" class="form-control" id="nom-otras-deducc" value="0" min="0" oninput="calcularPreviewNomina()"></div>

      <!-- RESUMEN CALCULADO -->
      <div id="nom-preview" style="background:rgba(0,229,180,.06);border:1px solid rgba(0,229,180,.2);border-radius:12px;padding:16px;margin-top:12px">
        <div style="font-family:Syne;font-size:12px;font-weight:700;color:var(--accent);margin-bottom:10px">📊 RESUMEN LIQUIDACIÓN</div>
        <div id="nom-preview-content" style="font-size:12px">Selecciona un empleado para calcular...</div>
      </div>

    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-secondary" style="flex:1" onclick="calcularPreviewNomina()">🔄 Recalcular</button>
      <button class="btn btn-primary" style="flex:1" onclick="guardarNomina('${tipo}')">💾 Guardar Liquidación</button>
    </div>
  `, true);

  window._nomTipo = tipo;
  setTimeout(() => calcularPreviewNomina(), 100);
}

function onNomEmpleadoChange() {
  const sel = document.getElementById('nom-empleado');
  const opt = sel.options[sel.selectedIndex];
  const salario = opt?.getAttribute('data-salario');
  if(salario) {
    document.getElementById('nom-salario').value = salario;
    cargarAnticiposEmpleado();
  }
  calcularPreviewNomina();
}

function autoFillPeriodo() {
  const sel = document.getElementById('nom-quincena');
  const opt = sel?.options[sel.selectedIndex];
  if(!opt) return;
  const q = sel.value;
  const [y, m] = today().split('-');
  const mNom = new Date(y, parseInt(m)-1, 1).toLocaleDateString('es-CO',{month:'long'});
  document.getElementById('nom-periodo').value = q === '1'
    ? `1-15 ${mNom} ${y}` : `16-${new Date(y, m, 0).getDate()} ${mNom} ${y}`;
  calcularPreviewNomina();
}

function cargarAnticiposEmpleado() {
  const empId = document.getElementById('nom-empleado')?.value;
  if(!empId) return;
  const emp = (state.empleados||[]).find(e => e.id === empId);
  if(!emp) return;
  const anticiposPend = (state.nom_anticipos||[])
    .filter(a => (a.empleado_nombre||a.empleado||'').toLowerCase() === (emp.nombre||'').toLowerCase())
    .reduce((sum, a) => sum + (parseFloat(a.valor)||0), 0);
  if(anticiposPend > 0) {
    document.getElementById('nom-anticipos-val').value = anticiposPend;
    calcularPreviewNomina();
    notify('success','💰',`Anticipos: ${fmt(anticiposPend)}`,'Cargados automáticamente',{duration:2000});
  }
}

function calcularPreviewNomina() {
  const tipo = window._nomTipo || 'quincenal';
  const salario = parseFloat(document.getElementById('nom-salario')?.value) || SMMLV_2026;
  const anticipos = parseFloat(document.getElementById('nom-anticipos-val')?.value) || 0;
  const otrasDeducc = parseFloat(document.getElementById('nom-otras-deducc')?.value) || 0;
  const ausencias = parseFloat(document.getElementById('nom-ausencias')?.value) || 0;
  const incap = parseFloat(document.getElementById('nom-incap')?.value) || 0;
  const otrosDevengos = parseFloat(document.getElementById('nom-otros-dev')?.value) || 0;
  const diasVac = parseFloat(document.getElementById('nom-dias-vac')?.value) || 15;
  const diasCes = parseFloat(document.getElementById('nom-dias-ces')?.value) || 180;
  const diasLiq = parseFloat(document.getElementById('nom-dias-liq')?.value) || 360;

  const cfg = { salario, anticipos, otrasDeducc, tipo,
    ausenciasNoPagas: ausencias, incapacidades: incap,
    otrosDevengos, diasVacaciones: diasVac, diasCesantias: diasCes, periodosLiquidar: diasLiq };

  try {
    const r = calcNomina(cfg);
    window._nomResult = r;
    renderNominaPreview(r, tipo);
  } catch(e) {
    document.getElementById('nom-preview-content').innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
  }
}

function renderNominaPreview(r, tipo) {
  if (window.AppNominaModule?.renderNominaPreview) {
    return window.AppNominaModule.renderNominaPreview({ r, tipo, fmt });
  }
  const el = document.getElementById('nom-preview-content');
  if(!el) return;

  const fmtR = (n) => `<span style="font-weight:700">${fmt(Math.round(n||0))}</span>`;
  const row = (label, val, color='') => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="color:var(--text2)">${label}</span>${color?`<span style="color:${color};font-weight:700">${fmt(Math.round(val||0))}</span>`:fmtR(val)}</div>`;

  let html = '';

  if(tipo === 'quincenal' || tipo === 'mensual') {
    html = `
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">DEVENGADO</div>
      ${row(`Salario (${r.diasEfectivos} días)`, r.salarioBase, 'var(--green)')}
      ${r.auxTrans > 0 ? row('Aux. Transporte', r.auxTrans, 'var(--green)') : ''}
      ${r.valorIncap > 0 ? row('Incapacidad (EPS 2/3)', r.valorIncap, 'var(--yellow)') : ''}
      ${r.otrosDevengos > 0 ? row('Otros devengos', r.otrosDevengos, 'var(--green)') : ''}
      ${row('TOTAL DEVENGADO', r.totalDevengado, 'var(--green)')}
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin:8px 0 4px">DEDUCCIONES</div>
      ${row('Salud empleado (4%)', r.deducSalud, 'var(--red)')}
      ${row('Pensión empleado (4%)', r.deducPension, 'var(--red)')}
      ${r.anticipos > 0 ? row('Anticipos', r.anticipos, 'var(--red)') : ''}
      ${r.otrasDeducc > 0 ? row('Otras deducciones', r.otrasDeducc, 'var(--red)') : ''}
      ${row('TOTAL DEDUCCIONES', r.totalDeducc, 'var(--red)')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px">
        <span style="font-family:Syne;font-weight:800;font-size:14px">NETO A PAGAR</span>
        <span style="font-family:Syne;font-weight:800;font-size:16px;color:var(--accent)">${fmt(Math.round(r.neto))}</span>
      </div>
      ${r.empleador ? `
      <details style="margin-top:10px">
        <summary style="font-size:11px;color:var(--text2);cursor:pointer">📊 Ver costos empleador (no se descuentan al empleado)</summary>
        <div style="margin-top:8px;font-size:11px">
          ${row('Salud empleador (8.5%)', r.empleador.costoSalud)}
          ${row('Pensión empleador (12%)', r.empleador.costoPension)}
          ${row('ARL (0.522%)', r.empleador.costoArl)}
          ${row('Caja compensación (4%)', r.empleador.costoCaja)}
          ${row('Provisión prima', r.empleador.provPrima)}
          ${row('Provisión cesantías', r.empleador.provCes)}
          ${row('Provisión int. cesantías', r.empleador.provIntCes)}
          ${row('Provisión vacaciones', r.empleador.provVac)}
          ${row('COSTO TOTAL EMPLEADOR', r.empleador.costoTotal, 'var(--orange)')}
        </div>
      </details>` : ''}`;

  } else if(tipo === 'vacaciones') {
    html = `${row(`Vacaciones (${r.diasVacaciones} días)`, r.salarioBase, 'var(--green)')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px">
        <span style="font-family:Syne;font-weight:800">VALOR VACACIONES</span>
        <span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span>
      </div>`;
  } else if(tipo === 'prima') {
    html = `${row(`Base (${r.meses?.toFixed(1)} meses)`, r.base)}
      ${row('Prima semestral', r.valor, 'var(--green)')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px">
        <span style="font-family:Syne;font-weight:800">PRIMA A PAGAR</span>
        <span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span>
      </div>`;
  } else if(tipo === 'cesantias') {
    html = `${row(`Cesantías (${r.diasCesantias} días)`, r.valor, 'var(--green)')}
      ${row('Intereses cesantías (12%)', r.intCes, 'var(--green)')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px">
        <span style="font-family:Syne;font-weight:800">CESANTÍAS + INTERESES</span>
        <span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span>
      </div>`;
  } else if(tipo === 'liquidacion') {
    html = `<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">LIQUIDACIÓN CONTRATO</div>
      ${row(`Cesantías (${r.diasTrab} días)`, r.cesan, 'var(--green)')}
      ${row('Intereses cesantías', r.intCes, 'var(--green)')}
      ${row('Prima proporcional', r.prima, 'var(--green)')}
      ${row('Vacaciones proporcionales', r.vac, 'var(--green)')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px">
        <span style="font-family:Syne;font-weight:800;font-size:14px">TOTAL LIQUIDACIÓN</span>
        <span style="font-family:Syne;font-weight:800;font-size:16px;color:var(--accent)">${fmt(Math.round(r.neto))}</span>
      </div>`;
  }

  el.innerHTML = html;
}

async function guardarNomina(tipo) {
  const empSel = document.getElementById('nom-empleado');
  const empNombre = empSel?.options[empSel.selectedIndex]?.text || 'Empleado';
  if(!empNombre || empNombre === '— Seleccionar —') {
    notify('warning','⚠️','Selecciona un empleado','',{duration:3000}); return;
  }
  const periodo = document.getElementById('nom-periodo')?.value || today();
  const r = window._nomResult;
  if(!r) { notify('warning','⚠️','Primero recalcula','',{duration:3000}); return; }

  const nomina = {
    id: dbId(),
    numero: 'NOM-' + String((state.nom_nominas||[]).length + 1).padStart(4,'0'),
    tipo, empleado: empNombre,
    periodo, salario: parseFloat(document.getElementById('nom-salario')?.value)||SMMLV_2026,
    devengado: r.totalDevengado || 0,
    deducciones: r.totalDeducc || 0,
    neto: r.neto || 0,
    detalles: r,
    pagada: false, fecha: today()
  };

  if(!state.nom_nominas) state.nom_nominas = [];
  state.nom_nominas.push(nomina);
  await saveRecord('nom_nominas', nomina.id, nomina);

  closeModal();
  renderNomNominas();
  notify('success','✅','Nómina guardada', `${empNombre} · ${fmt(nomina.neto)}`, {duration:3000});
}

function verNomina(id) {
  const n = (state.nom_nominas||[]).find(x => x.id === id);
  if(!n) return;
  const r = n.detalles || {};
  window._nomResult = r;
  window._nomTipo = n.tipo;

  // Mostrar resumen en modal
  let preview = '';
  renderNominaPreview(r, n.tipo);

  const tipoLabel = {quincenal:'Nómina Quincenal',mensual:'Nómina Mensual',prima:'Prima',cesantias:'Cesantías',vacaciones:'Vacaciones',liquidacion:'Liquidación'};

  openModal(`
    <div class="modal-title">${n.numero} · ${tipoLabel[n.tipo]||n.tipo}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">
      <b>${n.empleado}</b> · ${n.periodo} · ${n.fecha}
    </div>
    <div id="nom-preview-content"></div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-secondary" style="flex:1" onclick="imprimirNomina('${id}')">🖨 Imprimir PDF</button>
      ${!n.pagada?`<button class="btn btn-primary" style="flex:1" onclick="closeModal();pagarNomina('${id}')">💰 Pagar</button>`:''}
    </div>
  `);
  setTimeout(() => renderNominaPreview(r, n.tipo), 50);
}

function imprimirNomina(id) {
  const n = (state.nom_nominas||[]).find(x => x.id === id);
  if(!n) return;
  const emp = state.empresa || {};
  const r = n.detalles || {};
  const tipoLabel = {quincenal:'NÓMINA QUINCENAL',mensual:'NÓMINA MENSUAL',prima:'LIQUIDACIÓN PRIMA',cesantias:'CESANTÍAS E INTERESES',vacaciones:'LIQUIDACIÓN VACACIONES',liquidacion:'LIQUIDACIÓN CONTRATO'};

  const row = (label, val, bold=false, color='#000') =>
    val > 0 ? `<tr><td style="padding:4px 8px">${label}</td><td style="text-align:right;padding:4px 8px;color:${color};${bold?'font-weight:900':''}">${Math.round(val).toLocaleString('es-CO')}</td></tr>` : '';

  const detallesHTML = n.tipo === 'quincenal' || n.tipo === 'mensual' ? `
    <tr style="background:#f5f5f5"><th colspan="2" style="padding:6px 8px;text-align:left">DEVENGADO</th></tr>
    ${row(`Salario básico (${r.diasEfectivos} días hábiles)`, r.salarioBase)}
    ${row('Auxilio de transporte', r.auxTrans)}
    ${row('Subsidio incapacidad (EPS)', r.valorIncap)}
    ${row('Otros devengos', r.otrosDevengos)}
    <tr style="background:#e8f5e9"><td style="padding:6px 8px;font-weight:700">TOTAL DEVENGADO</td><td style="text-align:right;padding:6px 8px;font-weight:700;color:green">${Math.round(r.totalDevengado||0).toLocaleString('es-CO')}</td></tr>
    <tr style="background:#f5f5f5"><th colspan="2" style="padding:6px 8px;text-align:left">DEDUCCIONES</th></tr>
    ${row('Aporte salud empleado (4%)', r.deducSalud)}
    ${row('Aporte pensión empleado (4%)', r.deducPension)}
    ${row('Anticipos de nómina', r.anticipos)}
    ${row('Otras deducciones', r.otrasDeducc)}
    <tr style="background:#ffebee"><td style="padding:6px 8px;font-weight:700">TOTAL DEDUCCIONES</td><td style="text-align:right;padding:6px 8px;font-weight:700;color:red">${Math.round(r.totalDeducc||0).toLocaleString('es-CO')}</td></tr>
  ` : n.tipo === 'liquidacion' ? `
    ${row('Cesantías', r.cesan)}
    ${row('Intereses a las cesantías', r.intCes)}
    ${row('Prima de servicios proporcional', r.prima)}
    ${row('Vacaciones proporcionales', r.vac)}
  ` : n.tipo === 'cesantias' ? `
    ${row(`Cesantías (${r.diasCesantias} días)`, r.valor)}
    ${row('Intereses a las cesantías (12%)', r.intCes)}
  ` : n.tipo === 'prima' ? `
    ${row(`Prima semestral (${r.meses?.toFixed(1)} meses)`, r.valor)}
  ` : `
    ${row(`Vacaciones (${r.diasVacaciones} días)`, r.salarioBase)}
  `;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;font-size:11px;color:#000;margin:20px}
    .header{text-align:center;margin-bottom:16px;border-bottom:2px solid #000;padding-bottom:12px}
    table{width:100%;border-collapse:collapse;margin-bottom:12px}
    th,td{border:1px solid #ddd;padding:4px 8px}
    th{background:#f0f0f0}
    .neto{font-size:16px;font-weight:900;text-align:right;padding:8px;background:#e8f5e9;border:2px solid #4caf50;border-radius:4px;margin-top:8px}
    .firma{margin-top:40px;display:flex;justify-content:space-between}
    .firma-box{text-align:center;width:45%}
    .firma-line{border-top:1px solid #000;margin-top:30px;padding-top:4px}
    @media print{button{display:none}}
  </style></head><body>
  <button onclick="window.print()" style="margin-bottom:12px;padding:8px 16px;background:#00e5b4;border:none;border-radius:6px;cursor:pointer;font-weight:700">🖨 Imprimir / Guardar PDF</button>
  <div class="header">
    ${emp.logoBase64?`<img src="${emp.logoBase64}" style="height:50px;margin-bottom:8px"><br>`:''}
    <div style="font-size:16px;font-weight:900">${emp.nombre||'EMPRESA'}</div>
    <div>NIT: ${emp.nit||''} | ${emp.ciudad||''}</div>
    <div style="font-size:14px;font-weight:700;margin-top:8px">${tipoLabel[n.tipo]||'NÓMINA'}</div>
  </div>
  <table>
    <tr><th>Empleado</th><td><b>${n.empleado}</b></td><th>N° Liquidación</th><td>${n.numero}</td></tr>
    <tr><th>Periodo</th><td>${n.periodo}</td><th>Fecha</th><td>${n.fecha}</td></tr>
    <tr><th>Salario base</th><td>${Math.round(n.salario||0).toLocaleString('es-CO')}</td><th>Tipo contrato</th><td>Indefinido</td></tr>
  </table>
  <table>${detallesHTML}</table>
  <div class="neto">NETO A PAGAR: $ ${Math.round(n.neto||0).toLocaleString('es-CO')}</div>
  ${r.empleador?`
  <div style="margin-top:16px;font-size:10px;color:#666;border-top:1px dashed #ccc;padding-top:8px">
    <b>Información para el empleador (no afecta el neto del empleado):</b><br>
    Salud empleador: $${Math.round(r.empleador.costoSalud||0).toLocaleString('es-CO')} |
    Pensión: $${Math.round(r.empleador.costoPension||0).toLocaleString('es-CO')} |
    ARL: $${Math.round(r.empleador.costoArl||0).toLocaleString('es-CO')} |
    Caja: $${Math.round(r.empleador.costoCaja||0).toLocaleString('es-CO')}<br>
    <b>Costo total del empleado para la empresa: $${Math.round(r.empleador.costoTotal||0).toLocaleString('es-CO')}</b>
  </div>`:''}
  <div class="firma">
    <div class="firma-box"><div class="firma-line">Firma Empleador</div></div>
    <div class="firma-box"><div class="firma-line">Firma Empleado: ${n.empleado}</div></div>
  </div>
  <div style="margin-top:20px;font-size:9px;color:#999;text-align:center">
    Generado por VentasHera ERP · ${today()} · SMMLV 2026: $${SMMLV_2026.toLocaleString('es-CO')}
  </div>
  </body></html>`;

  const w = window.open('', '_blank', 'width=800,height=700');
  if(!w) { notify('warning','⚠️','Permite popups','Para imprimir el comprobante.',{duration:3000}); return; }
  w.document.write(html);
  w.document.close();
}

async function pagarNomina(id){
  if (window.AppNominaModule?.pagarNomina) {
    return window.AppNominaModule.pagarNomina({ state, id, saveRecord, uid, dbId, today, renderNomNominas, notify, fmt });
  }
  const n=(state.nom_nominas||[]).find(x=>x.id===id);if(!n)return;
  n.pagada=true;
  await saveRecord('nom_nominas', n.id, n);

  const cajaAbierta=(state.cajas||[]).find(c=>c.estado==='abierta');
  if(cajaAbierta){
    window.AppCajaLogic?.normalizeCaja?.(cajaAbierta);
    window.AppCajaLogic?.applyDeltaBucket?.(cajaAbierta, 'transferencia', -n.neto);
    const mov={id:dbId(),cajaId:cajaAbierta.id,tipo:'egreso',valor:n.neto,
      concepto:`${n.tipo?.toUpperCase()||'Nómina'} ${n.numero} - ${n.empleado}`,fecha:today(),metodo:'transferencia',categoria:'nomina',bucket:'transferencia'};
    window.AppCajaLogic?.enrichMovWithSesion?.(state, cajaAbierta.id, mov, dbId);
    state.tes_movimientos.push(mov);
    await saveRecord('cajas', cajaAbierta.id, cajaAbierta);
    await saveRecord('tes_movimientos', mov.id, mov);
  }
  renderNomNominas();
  notify('success','💰','¡Nómina pagada!',`${n.empleado} · ${fmt(n.neto)}`,{duration:3000});
}


// ===================================================================
// ===== TESORERÍA — bridge hacia AppTreasuryModule (treasury-module.js) =====
// ===================================================================

let _erpTreasuryMissingWarned = false;
function treasuryFn(name) {
  const f = window.AppTreasuryModule && typeof window.AppTreasuryModule[name] === 'function' ? window.AppTreasuryModule[name] : null;
  if (!f && !_erpTreasuryMissingWarned) {
    _erpTreasuryMissingWarned = true;
    console.error('[ERP] AppTreasuryModule.' + name + ' no disponible. Incluye treasury-module.js antes de core.js.');
    notify('danger', '⚠️', 'Tesorería', 'No se cargó treasury-module.js. Recarga la página.', { duration: 8000 });
  }
  return f;
}

/** KPI deuda / alertas: exige `calcDeudaProveedor` publicado por treasury-module. */
function isTreasuryModuleValidForCalc() {
  const m = window.AppTreasuryModule;
  if (m && typeof m.isTreasuryModuleValidForCalc === 'function') return m.isTreasuryModuleValidForCalc();
  return !!(m && typeof m.calcDeudaProveedor === 'function');
}

/** Pantallas tesorería (pagos, listas simples): además de cálculo. */
function isTreasuryModuleValidForUi() {
  const m = window.AppTreasuryModule;
  if (m && typeof m.isTreasuryModuleValidForUi === 'function') return m.isTreasuryModuleValidForUi();
  return !!(
    m &&
    typeof m.calcDeudaProveedor === 'function' &&
    typeof m.renderTesPagosProv === 'function' &&
    typeof m.renderSimpleCollection === 'function'
  );
}

function emptyCalcDeudaProveedor() {
  return {
    valorInventarioCosto: 0,
    valorInventarioCostoNeto: 0,
    invEntradaCredAbonoDedup: 0,
    costoVendidoHist: 0,
    unidadesVendidasHist: 0,
    costoVendidoPosMoves: 0,
    udsVendidasPosMoves: 0,
    costoVendidoPosFacturaSinMove: 0,
    udsVendidasPosFacturaSinMove: 0,
    vendidoDesdeUltimoAbono: 0,
    unidadesVendidasDesdeUltimoAbono: 0,
    costoVendidoUltAbPosMoves: 0,
    udsVendidasUltAbPosMoves: 0,
    costoVendidoUltAbFacturaSinMove: 0,
    udsVendidasUltAbFacturaSinMove: 0,
    fechaUltimoAbonoLabel: null,
    vendidoDesdeUltimoAbonoAlcanzaSaldo: false,
    refOperativaTotal: 0,
    compromisoReconocido: 0,
    compromisoTotal: 0,
    deudaBruta: 0,
    ajusteUnidadesCosto: 0,
    unidadesAjusteModulo: 0,
    abonos: 0,
    abonosPagados: 0,
    abonosRegistroNegativo: 0,
    devolucionesDeuda: 0,
    devolucionesNcCxpSinEspejoInv: 0,
    devolucionesOperativa: 0,
    saldo: 0,
    saldoLibro: 0,
    saldoOperativoEstimado: 0,
    topePagoRespaldadoVentas: 0,
    pendienteSinRespaldoVentaCosto: 0,
    cxpCargo: 0,
    cxpCredito: 0,
    saldoOficialCxp: 0,
    usaCxp: false,
    difEstimVsCxp: null,
    articulos: [],
    ajustesSalidaCosto: 0,
    ajustesSalidaUds: 0,
    ajustesEntradaCosto: 0,
    ajustesEntradaUds: 0,
    ajustesInvNeto: 0,
    _erpTreasuryStub: true
  };
}

/**
 * Deuda por proveedor: delega a `AppTreasuryModule.calcDeudaProveedor` (única fuente de verdad).
 * Convención: no llamar sin `isTreasuryModuleValidForCalc()` en lógica de negocio/KPIs; si el retorno trae `_erpTreasuryStub`, no es dato real.
 */
function calcDeudaProveedor(provId) {
  const fn = treasuryFn('calcDeudaProveedor');
  if (!fn) return emptyCalcDeudaProveedor();
  return fn(state, provId);
}

/** Consola: `__erpAuditVendidoProv('uuid-proveedor')` — desglose moves vs factura (Pagos proveedores). */
try {
  window.__erpAuditVendidoProv = function (provId) {
    const m = window.AppTreasuryModule;
    if (m && typeof m.logAuditVendidoProveedor === 'function') return m.logAuditVendidoProveedor(state, provId);
    console.warn('AppTreasuryModule.logAuditVendidoProveedor no disponible');
    return null;
  };
} catch (e) {}

/** Alertas de tesorería/proveedores (anexar siempre al resultado de buildAlerts base). */
function appendBuildAlertsTreasuryProveedor() {
  const extra = [];
  if (!isTreasuryModuleValidForCalc()) {
    treasuryFn('calcDeudaProveedor');
    extra.push({
      type: 'urgent',
      icon: '🏧',
      title: 'Tesorería no cargada',
      desc: 'Falta AppTreasuryModule operativo (treasury-module.js). No se calculan alertas de deuda a proveedores hasta recargar.',
      action: 'location.reload()',
      actionLabel: 'Recargar'
    });
    return extra;
  }
  if (!isTreasuryModuleValidForUi()) {
    extra.push({
      type: 'warning',
      icon: '⚙️',
      title: 'Tesorería incompleta',
      desc: 'El módulo expone cálculo pero faltan piezas de UI (pagos proveedores o listas). Revisa la consola y recarga.',
      action: "showPage('tes_pagos_prov')",
      actionLabel: 'Pagos proveedores'
    });
  }
  const _buildProvList = () => {
    const list = (state.usu_proveedores || []).map((p) => {
      const d = calcDeudaProveedor(p.id);
      const fechasComp = (state.tes_compromisos_prov || [])
        .filter((c) => c.proveedorId === p.id)
        .map((c) => c.fecha)
        .filter(Boolean)
        .sort();
      const fechasArt = (d.articulos || []).map((a) => a.fechaCompra || a.createdAt || '').filter(Boolean).sort();
      const fechas = fechasComp.length ? fechasComp : fechasArt;
      const diasDeuda = fechas.length ? Math.round((new Date() - new Date(fechas[0])) / 86400000) : 0;
      return { ...p, saldo: d.saldo, diasDeuda, artCredito: d.articulos };
    }).filter((p) => p.saldo > 0);
    return list;
  };
  const provConDeuda = _buildProvList();
  const totalDeuda = provConDeuda.reduce((s, p) => s + p.saldo, 0);
  if (provConDeuda.length > 0) {
    const urgente = provConDeuda.filter((p) => p.diasDeuda >= 30);
    extra.push({
      type: urgente.length > 0 ? 'urgent' : 'warning',
      icon: '🏭',
      title: `Deuda con proveedores: ${fmt(totalDeuda)}`,
      desc: provConDeuda
        .map((p) => `${p.nombre}: ${fmt(p.saldo)}${p.diasDeuda > 0 ? ` (${p.diasDeuda}d)` : ''}`)
        .join(' · '),
      action: "showPage('tes_pagos_prov')",
      actionLabel: 'Ver pagos proveedores'
    });
    urgente.forEach((p) => {
      extra.push({
        type: 'urgent',
        icon: '⚠️',
        title: `${p.nombre} — ${p.diasDeuda} días sin pagar`,
        desc: `Saldo pendiente: ${fmt(p.saldo)}. Esta deuda lleva más de 30 días acumulándose.`,
        action: "showPage('tes_pagos_prov')",
        actionLabel: 'Abonar ahora'
      });
    });
  }
  return extra;
}

/** Una sola vez: stock_moves desde facturas POS históricas (deuda proveedor / columna vendido). */
async function backfillStockMovesVentaPos(skipConfirm) {
  if (
    !skipConfirm &&
    !confirm(
      'Se crearán en la base las líneas stock_moves POS que falten según tus facturas (no vuelve a descontar stock). ¿Continuar?',
    )
  ) {
    return;
  }
  if (window.AppPosRepository?.backfillStockMovesFromFacturas) {
    return window.AppPosRepository.backfillStockMovesFromFacturas({
      state,
      supabaseClient,
      sbConnected: _sbConnected,
      dbId,
      notify,
      showLoadingOverlay,
      onDone: async () => {
        try {
          if (typeof window.reloadStockMovesVentasFromDb === 'function') {
            await window.reloadStockMovesVentasFromDb();
          }
        } catch (e) {
          console.warn('reloadStockMovesVentasFromDb:', e);
        }
        if (typeof renderTesPagosProv === 'function') renderTesPagosProv();
      },
    });
  }
  notify('warning', '⚠️', 'Módulo POS', 'Carga pos-repository.js', { duration: 3000 });
}

function renderTesPagosProv() {
  const fn = treasuryFn('renderTesPagosProv');
  if (fn) return fn({ state, fmt, formatDate });
  const el = document.getElementById('tes_pagos_prov-content');
  if (el) {
    el.innerHTML =
      '<div class="card" style="padding:20px;color:var(--red)">No se cargó <b>treasury-module.js</b>. Pagos a proveedores no disponibles hasta recargar.</div>';
  }
}

function openCompromisoProvModal(provId = '', provNombre = '') {
  const fn = treasuryFn('openCompromisoProvModal');
  if (fn) return fn({ state, provId, provNombre, fmt, openModal, notify, today });
}

async function guardarCompromisoProv() {
  const fn = treasuryFn('guardarCompromisoProv');
  if (fn) {
    return fn({
      state, uid, dbId, today, showLoadingOverlay, supabaseClient, closeModal, renderTesPagosProv, notify, fmt
    });
  }
}

async function eliminarCompromisoProv(id) {
  const fn = treasuryFn('eliminarCompromisoProv');
  if (fn) return fn({ state, id, confirm, supabaseClient, renderTesPagosProv, notify });
}

function verCompromisosProv(provId, provNombre) {
  const fn = treasuryFn('verCompromisosProv');
  if (fn) return fn({ state, provId, provNombre, fmt, formatDate, openModal });
}

async function importarEstimacionCompromisosProv() {
  const fn = treasuryFn('importarEstimacionCompromisosProv');
  if (fn) {
    return fn({
      state, uid, dbId, today, showLoadingOverlay, supabaseClient, renderTesPagosProv, notify, fmt, confirm
    });
  }
}

function openCargoCxpModal(provId = '', provNombre = '') {
  const fn = treasuryFn('openCargoCxpModal');
  if (fn) return fn({ state, provId, provNombre, openModal, notify, today, fmt });
}

function openNotaCreditoCxpModal(provId = '', provNombre = '') {
  const fn = treasuryFn('openNotaCreditoCxpModal');
  if (fn) return fn({ state, provId, provNombre, openModal, notify, today });
}

async function guardarCargoCxpMov() {
  const fn = treasuryFn('guardarCargoCxpMov');
  if (fn) {
    return fn({
      state, uid, dbId, today, showLoadingOverlay, supabaseClient, closeModal, renderTesPagosProv, notify, fmt
    });
  }
}

async function guardarNotaCreditoCxpMov() {
  const fn = treasuryFn('guardarNotaCreditoCxpMov');
  if (fn) {
    return fn({
      state, uid, dbId, today, showLoadingOverlay, supabaseClient, closeModal, renderTesPagosProv, notify, fmt
    });
  }
}

function verLibroCxpModal(provId, provNombre) {
  const fn = treasuryFn('verLibroCxpModal');
  if (fn) return fn({ state, provId, provNombre, fmt, formatDate, openModal });
}

async function eliminarCxpMovimiento(id) {
  const fn = treasuryFn('eliminarCxpMovimiento');
  if (fn) {
    return fn({
      state, id, confirm, supabaseClient, renderTesPagosProv, notify, closeModal
    });
  }
}

async function alinearCxpEstimacionProv(provId) {
  const fn = treasuryFn('alinearCxpEstimacionProv');
  if (fn) {
    return fn({
      state, provId, supabaseClient, dbId, uid, today, showLoadingOverlay, renderTesPagosProv, notify, fmt, confirm
    });
  }
}

function openAbonoProvModal(provId = '', provNombre = '') {
  const fn = treasuryFn('openAbonoProvModal');
  if (fn) return fn({ state, provId, provNombre, fmt, openModal, notify, today });
}

function updateSaldoPendiente() {
  const fn = treasuryFn('updateSaldoPendiente');
  if (fn) return fn({ fmt, state });
}

function validateAbono() {
  const fn = treasuryFn('validateAbono');
  if (fn) return fn({ fmt, state });
}

function abonoUsarMontoVendidoSugerido() {
  const fn = treasuryFn('abonoUsarMontoVendidoSugerido');
  if (fn) return fn({ fmt, state });
}

async function guardarAbonoProv() {
  const fn = treasuryFn('guardarAbonoProv');
  if (fn) {
    return fn({ state, uid, dbId, today, showLoadingOverlay, supabaseClient, saveRecord, closeModal, renderTesPagosProv, notify, fmt, renderTesCajas });
  }
}

function verLibroProveedorModal(provId, provNombre) {
  const fn = treasuryFn('verLibroProveedorModal');
  if (fn) return fn({ state, provId, provNombre, fmt, formatDate, openModal });
}

function quitarCreditoArticuloProveedorFromPagos(artId) {
  const fn = treasuryFn('quitarCreditoArticuloProveedor');
  if (fn) {
    return fn({
      state,
      artId,
      confirm,
      supabaseClient,
      showLoadingOverlay,
      renderTesPagosProv,
      notify,
      fmt,
      dbId,
      uid,
      renderArticulosList,
      renderArticulos,
      updateNavBadges
    });
  }
}

function openAjusteUnidadesProvModal(provId, artId) {
  const fn = treasuryFn('openAjusteUnidadesProvModal');
  if (fn) return fn({ state, provId, artId, fmt, openModal, notify });
}

function guardarAjusteUnidadesProv(provId, artId) {
  const fn = treasuryFn('guardarAjusteUnidadesProv');
  if (fn) {
    return fn({
      state,
      provId,
      artId,
      uid,
      dbId,
      showLoadingOverlay,
      supabaseClient,
      closeModal,
      renderTesPagosProv,
      notify,
      fmt,
      saveRecord
    });
  }
}

function eliminarAjusteUnidadesProv(id, provId, artId) {
  const fn = treasuryFn('eliminarAjusteUnidadesProv');
  if (fn) {
    return fn({
      state,
      id,
      confirm,
      supabaseClient,
      renderTesPagosProv,
      notify,
      closeModal,
      reopen: provId && artId ? () => openAjusteUnidadesProvModal(provId, artId) : null
    });
  }
}

function verAbonosProv(provId, provNombre) {
  const fn = treasuryFn('verAbonosProv');
  if (fn) return fn({ state, provId, provNombre, fmt, formatDate, openModal });
}

async function eliminarAbonoProv(id) {
  const fn = treasuryFn('eliminarAbonoProv');
  if (fn) {
    return fn({ state, id, confirm, supabaseClient, saveRecord, renderTesPagosProv, notify, renderTesCajas });
  }
}

function recalcCierreArqueo() {
  const le = parseFloat(window._cierreLibroEfe) || 0;
  const lt = parseFloat(window._cierreLibroTrans) || 0;
  const cont = parseFloat(document.getElementById('cc-contado-efe')?.value) || 0;
  const db = parseFloat(document.getElementById('cc-decl-banco')?.value) || 0;
  const dE = cont - le;
  const dT = db - lt;
  const elE = document.getElementById('cc-diff-efe');
  const elT = document.getElementById('cc-diff-trans');
  const txt = (d) => {
    if (Math.abs(d) < 0.5) return { s: 'CUADRA (Δ ' + fmt(0) + ')', c: 'var(--green)' };
    if (d > 0) return { s: 'SOBRANTE ' + fmt(d), c: 'var(--green)' };
    return { s: 'FALTANTE ' + fmt(Math.abs(d)), c: 'var(--red)' };
  };
  const rE = txt(dE);
  const rT = txt(dT);
  if (elE) {
    elE.textContent = 'Libro ' + fmt(le) + ' → Contado ' + fmt(cont) + ' · ' + rE.s;
    elE.style.color = rE.c;
  }
  if (elT) {
    elT.textContent = 'Libro ' + fmt(lt) + ' → Declarado ' + fmt(db) + ' · ' + rT.s;
    elT.style.color = rT.c;
  }
}

function guardarAbrirCaja() {
  const fn = treasuryFn('guardarAbrirCaja');
  if (fn) return fn({ state, dbId, uid, saveRecord, closeModal, renderTesCajas, notify, fmt, today });
}

function guardarCierreCaja() {
  const fn = treasuryFn('guardarCierreCaja');
  if (fn) return fn({ state, dbId, uid, today, saveRecord, closeModal, renderTesCajas, notify, fmt });
}

function verCierresCajaModal(id) {
  const fn = treasuryFn('verCierresCajaModal');
  if (fn) return fn({ state, id, openModal, fmt, formatDate });
}

/** Cajas: implementación en `treasury-module.js`. */
function renderTesCajas() {
  const fn = treasuryFn('renderTesCajas');
  if (fn) {
    return fn({
      state,
      fmt,
      openModal,
      formatDate,
      today,
      notify,
      dbId,
      uid,
      saveRecord
    });
  }
  const el = document.getElementById('tes_cajas-content');
  if (el) {
    el.innerHTML =
      '<div class="card" style="padding:20px;color:var(--red)">No se cargó <b>treasury-module.js</b>. Recarga la página para usar cajas.</div>';
  }
}

function openCajaModal() {
  const fn = treasuryFn('openCajaModal');
  if (fn) return fn({ openModal });
}

function saveCaja() {
  const fn = treasuryFn('saveCaja');
  if (fn) {
    return fn({
      state,
      uid,
      dbId,
      saveRecord,
      closeModal,
      renderTesCajas,
      today,
      notify
    });
  }
}

function cerrarCaja(id) {
  const fn = treasuryFn('cerrarCaja');
  if (fn) return fn({ state, id, openModal, fmt, today });
}

function abrirCaja(id) {
  const fn = treasuryFn('abrirCaja');
  if (fn) return fn({ state, id, openModal, fmt, notify, today });
}

function movCaja(cajaId, tipo) {
  const fn = treasuryFn('openMovCajaModal');
  if (fn) return fn({ state, cajaId, tipo, openModal, fmt, today, notify });
}

function saveMovCaja(cajaId, tipo) {
  const fn = treasuryFn('saveMovCaja');
  if (fn) {
    return fn({
      state,
      cajaId,
      tipo,
      uid,
      dbId,
      today,
      saveRecord,
      closeModal,
      renderTesCajas,
      notify,
      fmt
    });
  }
}

function renderTesDinero() {
  const fn = treasuryFn('renderTesDinero');
  if (fn) return fn({ state, formatDate, fmt, today });
  const el = document.getElementById('tes_dinero-content');
  if (el) {
    el.innerHTML =
      '<div class="card" style="padding:20px;color:var(--red)">No se cargó <b>treasury-module.js</b>. Recarga la página.</div>';
  }
}

/** Listas simples tesorería (impuestos, retenciones, …): UI en `treasury-module.js`; formularios genéricos siguen en core (`openSimpleFormModal`, etc.). */
function renderSimpleCollection(pageId, title, collection, columns) {
  const fn = treasuryFn('renderSimpleCollection');
  if (fn) return fn({ state, pageId, title, collection, columns, fmt });
  const el = document.getElementById(pageId + '-content');
  if (el) {
    el.innerHTML =
      '<div class="card" style="padding:20px;color:var(--red)">No se cargó <b>treasury-module.js</b>. Recarga la página.</div>';
  }
}

function openSimpleFormModal(collection,title,columns){
  if(typeof columns==='string')columns=JSON.parse(columns.replace(/'/g,'"'));
  openModal(`
    <div class="modal-title">Nuevo - ${title}<button class="modal-close" onclick="closeModal()">×</button></div>
    ${columns.map(c=>{const[key,type,label]=c.split(':');return`<div class="form-group"><label class="form-label">${label}</label><input type="${type==='number'?'number':type==='date'?'date':'text'}" class="form-control" id="m-sf-${key}" ${type==='date'?'value="'+today()+'"':''}></div>`}).join('')}
    <button class="btn btn-primary" style="width:100%" onclick="saveSimpleForm('${collection}',${JSON.stringify(columns).replace(/"/g,"'")})">Guardar</button>
  `);
}

function saveSimpleForm(collection, columns) {
  if (typeof columns === 'string') columns = JSON.parse(columns.replace(/'/g, '"'));
  const item = { id: dbId(), fecha: today() };
  
  columns.forEach(c => {
    const [key, type] = c.split(':');
    const el = document.getElementById('m-sf-' + key);
    if (el) item[key] = type === 'number' ? parseFloat(el.value) || 0 : el.value.trim();
  });
  
  if (!state[collection]) state[collection] = [];
  state[collection].push(item);
  
  saveRecord(collection, item.id, item);
  
  closeModal();
  renderPage(document.querySelector('.page.active')?.id.replace('page-', ''));
  notify('success', '✅', 'Registro guardado', '', { duration: 2000 });
}

function deleteFromCollection(collection, id, pageId) {
  if (!confirm('¿Eliminar este registro?')) return;
  
  // 1. Borrar de la memoria local
  state[collection] = (state[collection] || []).filter(x => x.id !== id);
  
  deleteRecord(collection, id);
  
  renderPage(pageId);
  notify('success', '🗑️', 'Eliminado', 'Registro borrado correctamente.');
}

function renderTesImpuestos(){renderSimpleCollection('tes_impuestos','Impuestos','tes_impuestos',['fecha:date:FECHA','tipo:text:TIPO IMPUESTO','base:number:BASE','tarifa:text:TARIFA %','valor:number:VALOR','referencia:text:REFERENCIA'])}
function renderTesRetenciones(){renderSimpleCollection('tes_retenciones','Retenciones','tes_retenciones',['fecha:date:FECHA','tipo:text:TIPO','base:number:BASE','tarifa:text:TARIFA %','valor:number:VALOR','tercero:text:TERCERO'])}
function renderTesCompRetencion(){renderSimpleCollection('tes_comp_retencion','Comprobantes Retención','tes_comp_retencion',['fecha:date:FECHA','numero:text:NÚMERO','tercero:text:TERCERO','concepto:text:CONCEPTO','base:number:BASE','valor:number:VALOR'])}
function renderTesCompIngreso(){renderSimpleCollection('tes_comp_ingreso','Comprobantes Ingreso','tes_comp_ingreso',['fecha:date:FECHA','numero:text:NÚMERO','tercero:text:TERCERO','concepto:text:CONCEPTO','valor:number:VALOR'])}

function renderTesCompEgreso(){renderSimpleCollection('tes_comp_egreso','Comprobantes Egreso','tes_comp_egreso',['fecha:date:FECHA','numero:text:NÚMERO','tercero:text:TERCERO','concepto:text:CONCEPTO','valor:number:VALOR'])}
function renderTesTransferencias(){renderSimpleCollection('tes_transferencias','Transferencias','tes_transferencias',['fecha:date:FECHA','origen:text:ORIGEN','destino:text:DESTINO','valor:number:VALOR','motivo:text:MOTIVO'])}

// ===================================================================
// ===== GAMIFICACIÓN & JUEGO =====
// ===================================================================

function renderGamePage(){
  if (window.AppGameSystemModule?.renderGamePage) {
    return window.AppGameSystemModule.renderGamePage({ state, calcLevel, calcLevelProgress });
  }
  const g = state.game || { xp: 0 };
  const lv = calcLevel(g.xp);
  const {next, pct, xpToNext} = calcLevelProgress(g.xp);
  
  document.getElementById('juego-content').innerHTML = `
    <div class="card" style="text-align:center; padding: 48px 20px;">
      <div style="font-size: 80px; animation: bounce 2s infinite alternate;">${lv.avatar}</div>
      <div style="font-family: Syne; font-size: 32px; font-weight: 800; color: var(--accent); margin-top: 16px;">${lv.name}</div>
      <div style="color: var(--text2); margin-bottom: 24px;">Nivel ${lv.level} • ${g.xp} XP acumulados</div>
      
      ${next ? `
        <div style="background: rgba(255,255,255,0.1); height: 14px; border-radius: 8px; overflow: hidden; max-width: 400px; margin: 0 auto; position: relative;">
          <div style="background: linear-gradient(90deg, var(--accent), var(--accent2)); height: 100%; width: ${pct}%; transition: width 1s ease;"></div>
        </div>
        <div style="font-size: 13px; color: var(--text2); margin-top: 12px; font-weight: 600;">Faltan ${xpToNext} XP para alcanzar el nivel ${next.name}</div>
      ` : '<div style="color: gold; font-weight: 800; font-size: 16px;">¡HAS ALCANZADO EL NIVEL MÁXIMO! 🏆</div>'}
    </div>
  `;
}

function renderRewards(){
  if (window.AppGameSystemModule?.renderRewards) {
    return window.AppGameSystemModule.renderRewards({ state, REWARDS });
  }
  document.getElementById('recompensas-content').innerHTML = `
    <div class="card">
      <div class="card-title">🏆 RECOMPENSAS Y METAS</div>
      <div class="grid-3">
        ${REWARDS.map(r => {
          const isUnlocked = r.condition(state);
          return `
          <div class="card" style="margin:0; text-align:center; transition: all 0.3s; border-color: ${isUnlocked ? 'var(--green)' : 'var(--border)'}; background: ${isUnlocked ? 'rgba(74,222,128,0.05)' : 'var(--card)'}">
            <div style="font-size: 40px; margin-bottom: 12px; filter: ${isUnlocked ? 'none' : 'grayscale(100%) opacity(0.5)'}">${r.icon}</div>
            <div style="font-family: Syne; font-weight: 800; font-size: 14px; color: ${isUnlocked ? 'var(--green)' : 'var(--text)'};">${r.name}</div>
            <div style="font-size: 11px; color: var(--text2); margin-top: 6px; line-height: 1.4;">${r.desc}</div>
            <div style="margin-top: 14px;">
              <span class="badge ${isUnlocked ? 'badge-ok' : 'badge-pend'}">${isUnlocked ? '¡DESBLOQUEADA!' : '🔒 En progreso'}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function buildAlerts() {
  let alerts = [];
  if (window.AppGameSystemModule?.buildAlerts) {
    alerts = window.AppGameSystemModule.buildAlerts({
      state,
      fmt,
      getArticuloStock,
      ventaCuentaParaTotales
    });
  } else {
    const pend = (state.ventas || []).filter(
      (v) => ventaCuentaParaTotales(v) && v.canal !== 'vitrina' && !v.liquidado
    );
    if (pend.length > 0) {
      alerts.push({
        type: 'warning',
        icon: '⏳',
        title: `${pend.length} venta${pend.length > 1 ? 's' : ''} sin liquidar (seguimiento)`,
        desc: `Total lista: ${fmt(pend.reduce((s, v) => s + v.valor, 0))}. Ingreso en caja = día de la venta; liquidar no duplica movimiento.`,
        action: "showPage('pendientes')",
        actionLabel: 'Ir a Cobros'
      });
    }
    const lowStock = (state.articulos || []).filter((a) => getArticuloStock(a.id) <= a.stockMinimo);
    if (lowStock.length > 0) {
      alerts.push({
        type: 'urgent',
        icon: '📦',
        title: `Stock crítico en ${lowStock.length} artículo${lowStock.length > 1 ? 's' : ''}`,
        desc:
          lowStock
            .slice(0, 3)
            .map((a) => `${a.nombre} (${getArticuloStock(a.id)} uds)`)
            .join(' · ') + (lowStock.length > 3 ? ` y ${lowStock.length - 3} más` : ''),
        action: "showPage('articulos')",
        actionLabel: 'Ver inventario'
      });
    }
  }
  alerts.push(...appendBuildAlertsTreasuryProveedor());
  return alerts;
}

function renderAlertas(){
  if (window.AppGameSystemModule?.renderAlertas) {
    return window.AppGameSystemModule.renderAlertas({ state, fmt, getArticuloStock, today, ventaCuentaParaTotales });
  }
  const alertas = buildAlerts();
  const urgentes = alertas.filter(a=>a.type==='urgent').length;
  const warnings = alertas.filter(a=>a.type==='warning').length;

  document.getElementById('alertas-content').innerHTML = `
    ${alertas.length > 0 ? `
    <div class="grid-3" style="margin-bottom:16px">
      <div class="card" style="margin:0;text-align:center;border-color:rgba(248,113,113,.3)">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--red)">${urgentes}</div>
        <div style="font-size:11px;color:var(--text2)">🚨 Críticas</div>
      </div>
      <div class="card" style="margin:0;text-align:center;border-color:rgba(251,191,36,.3)">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--yellow)">${warnings}</div>
        <div style="font-size:11px;color:var(--text2)">⚠️ Advertencias</div>
      </div>
      <div class="card" style="margin:0;text-align:center">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--text)">${alertas.length}</div>
        <div style="font-size:11px;color:var(--text2)">📋 Total</div>
      </div>
    </div>` : ''}
    <div class="card">
      <div class="card-title">🔔 CENTRO DE ALERTAS — ${today()}</div>
      ${alertas.length === 0 ? `
        <div class="empty-state">
          <div class="es-icon">✅</div>
          <div class="es-title" style="color:var(--green)">Todo bajo control</div>
          <div class="es-text">No hay alertas críticas en este momento. ¡Buen trabajo!</div>
        </div>
      ` : alertas.map(a => `
        <div class="urgency-item ${a.type}" style="padding:16px;display:flex;gap:12px;align-items:flex-start;margin-bottom:8px">
          <div style="font-size:26px;flex-shrink:0;margin-top:2px">${a.icon||'🔔'}</div>
          <div style="flex:1">
            <div style="font-family:Syne;font-weight:800;font-size:14px;margin-bottom:4px">${a.title}</div>
            <div style="font-size:12px;color:var(--text2);line-height:1.5">${a.desc}</div>
          </div>
          ${a.action ? `<button class="btn btn-xs ${a.type==='urgent'?'btn-danger':'btn-secondary'}" onclick="${a.action}">${a.actionLabel||'Ver'}</button>` : ''}
        </div>
      `).join('')}
    </div>`;
}

// ===================================================================
// ===== SISTEMA & CONFIGURACIÓN =====
// ===================================================================

function renderHistorial(){
  if (window.AppGameSystemModule?.renderHistorial) {
    return window.AppGameSystemModule.renderHistorial({ state, formatDate, fmt, today, yearMonthFromFecha, sortVentasRecientes, ventasEnMesCalendario, ventaCuentaParaTotales });
  }
  const q = (document.getElementById('hist-search')?.value || '').toLowerCase();
  const scope = document.getElementById('hist-scope')?.value || 'mes';
  const hoy = today();
  const ym = yearMonthFromFecha(hoy);
  let ventas = state.ventas || [];
  if (scope === 'hoy') ventas = ventas.filter((v) => v.fecha === hoy);
  else if (scope === 'mes') ventas = (state.ventas || []).filter((v) => !v.archived && yearMonthFromFecha(v.fecha) === ym);
  else ventas = [...ventas];
  if (q) ventas = ventas.filter(v => (v.desc||'').toLowerCase().includes(q) || (v.cliente||'').toLowerCase().includes(q) || (v.guia||'').toLowerCase().includes(q));
  ventas = sortVentasRecientes(ventas);
  const hoyResumen = (state.ventas || []).filter((v) => v.fecha === hoy);
  const mesList = ventasEnMesCalendario(state.ventas, ym);
  const sumArr = (arr) => arr.reduce((a, v) => a + (parseFloat(v.valor) || 0), 0);
  const sumArrActivas = (arr) => arr.filter(ventaCuentaParaTotales).reduce((a, v) => a + (parseFloat(v.valor) || 0), 0);
  const row = (v) => {
    const fac = (state.facturas||[]).find(f=>String(f.id)===String(v.id));
    const anulada = fac && fac.estado==='anulada';
    const puedeAnular = fac && fac.tipo==='pos' && !anulada;
    return `<tr style="${v.archived ? 'opacity:0.6;' : ''}${anulada?'opacity:0.75;':''}">
      <td>${formatDate(v.fecha)}</td>
      <td><span class="badge badge-${v.canal}">${v.canal}</span>${v.canal!=='vitrina'?`<span class="badge ${v.esContraEntrega?'badge-warn':'badge-ok'}" style="margin-left:4px;font-size:9px">${v.esContraEntrega?'📦CE':'💵CD'}</span>`:''}</td>
      <td style="font-weight:bold;">${v.desc||'—'}</td>
      <td>${v.cliente||'—'}</td>
      <td style="color:var(--accent);font-weight:700;">${fmt(v.valor)}</td>
      <td>
        <span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'Liquidado':'Pendiente'}</span>
        ${anulada?`<span class="badge badge-warn" style="margin-left:4px">Anulada</span>`:''}
        ${v.syncPending ? `<span class="badge badge-warn" style="margin-left:4px">Sync pendiente</span>` : ''}
        ${puedeAnular?`<button type="button" class="btn btn-xs btn-danger" style="margin-left:6px" onclick="anularVentaPOSConfirm('${String(v.id).replace(/'/g,"\\'")}')">Anular</button>`:''}
      </td>
    </tr>`;
  };
  let rowsHtml = '';
  if (scope === 'todas' || scope === 'mes') {
    let lastF = null;
    for (const v of ventas) {
      if (v.fecha !== lastF) {
        lastF = v.fecha;
        const sameDay = ventas.filter((x) => x.fecha === lastF);
        const sub = sumArr(sameDay);
        rowsHtml += `<tr><td colspan="6" style="background:rgba(0,229,180,.07);font-weight:700;font-size:11px;padding:8px 10px;border-top:1px solid var(--border)">📅 ${formatDate(lastF)} · ${sameDay.length} factura(s) · ${fmt(sub)}${sameDay.some((x) => x.archived) ? ' · incl. archivo' : ''}</td></tr>`;
      }
      rowsHtml += row(v);
    }
  } else {
    rowsHtml = ventas.map((v) => row(v)).join('');
  }
  if (!rowsHtml) rowsHtml = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text2)">Sin registros</td></tr>';

  if(document.getElementById('hist-tbody')) {
    document.getElementById('hist-tbody').innerHTML = rowsHtml;
    const cnt = document.getElementById('hist-count');
    if(cnt) cnt.textContent = String(ventas.length);
    const subEl = document.getElementById('hist-sub');
    if (subEl) subEl.textContent = `${hoyResumen.filter(ventaCuentaParaTotales).length} hoy · ${fmt(sumArrActivas(hoyResumen))} | Mes ${ym}: ${mesList.length} fact. · ${fmt(sumArrActivas(mesList))} | En vista: ${ventas.length}`;
    return;
  }

  const pendSync = (state.ventas || []).filter(v => !!v.syncPending);
  const pendSyncHtml = pendSync.length ? `
    <div class="card" style="margin-bottom:12px;border-color:rgba(251,191,36,.35)">
      <div class="card-title">⚠️ Sincronización pendiente (${pendSync.length})</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:10px;line-height:1.45">
        Aquí ves ventas guardadas localmente con algún paso pendiente de sincronizar. Reintenta solo documentos cuando aplique para evitar duplicados en caja/inventario.
        También puedes recuperar descuentos de stock en <b>Tesorería → Pagos proveedores</b>: «POS stock» (solo <code>products</code>) o «POS todo» (moves + stock).
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Factura</th><th>Cliente</th><th>Error</th><th></th></tr></thead>
          <tbody>
            ${pendSync.slice(0,50).map(v=>`<tr>
              <td>${formatDate(v.fecha)}</td>
              <td style="font-weight:700">${v.desc||v.id}</td>
              <td>${v.cliente||'—'}</td>
              <td style="font-size:11px;color:var(--yellow)">${v.syncError||'desconocido'}</td>
              <td>
                <div class="btn-group">
                  <button class="btn btn-xs btn-secondary" onclick="reintentarSyncDocumentos('${v.id}')">Reintentar docs</button>
                  <button class="btn btn-xs btn-secondary" onclick="reintentarSyncCajaInventario('${v.id}')">Reintentar caja/inv</button>
                  <button class="btn btn-xs btn-danger" onclick="marcarSyncResuelto('${v.id}')">Marcar resuelto</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  ` : '';

  document.getElementById('historial-content').innerHTML = `
    ${pendSyncHtml}
    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="search-bar" style="flex:1;min-width:200px;max-width:360px;margin:0;">
        <span class="search-icon">🔍</span>
        <input type="text" id="hist-search" placeholder="# factura, cliente, guía..."
          value="${q}" oninput="renderHistorial()">
      </div>
      <div>
        <label class="form-label" style="font-size:10px;color:var(--text2);display:block;margin-bottom:4px">Ámbito</label>
        <select class="form-control" id="hist-scope" style="min-width:160px" onchange="renderHistorial()">
          <option value="hoy" ${scope==='hoy'?'selected':''}>Solo hoy</option>
          <option value="mes" ${scope==='mes'?'selected':''}>Mes calendario (${ym})</option>
          <option value="todas" ${scope==='todas'?'selected':''}>Todas (incl. archivo)</option>
        </select>
      </div>
    </div>
    <div class="card" style="margin-bottom:12px;padding:12px;font-size:12px;color:var(--text2)">
      <b>Venta POS = factura</b> (referencia = # doc). Resumen: <span id="hist-sub">${hoyResumen.filter(ventaCuentaParaTotales).length} hoy · ${fmt(sumArrActivas(hoyResumen))} | Mes ${ym}: ${mesList.length} fact. · ${fmt(sumArrActivas(mesList))} | En vista: ${ventas.length}</span>
    </div>
    <div class="card">
      <div class="card-title">HISTORIAL DE FACTURAS (<span id="hist-count">${ventas.length}</span> en vista)</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Canal</th><th>Factura</th><th>Cliente</th><th>Total</th><th>Estado</th></tr></thead>
          <tbody id="hist-tbody">${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

async function reintentarSyncDocumentos(id) {
  const v = (state.ventas || []).find((x) => x.id === id);
  if (!v) return;
  const f = (state.facturas || []).find((x) => x.id === id);
  if (!f) {
    notify('warning', '⚠️', 'Sin factura local', 'No se encontró la factura para reintentar.', { duration: 4500 });
    return;
  }
  if (v.syncError && v.syncError !== 'factura_venta') {
    notify('warning', '⚠️', 'Revisión manual requerida', 'Este pendiente incluye inventario/caja. Revisa en Tesorería/Inventario antes de marcar resuelto.', { duration: 6500 });
    return;
  }
  if (window.AppPosRepository?.preparePosSaleForPersist) {
    window.AppPosRepository.preparePosSaleForPersist(f, v);
  }
  const okF = await saveRecord('facturas', f.id, f);
  const okV = await saveRecord('ventas', v.id, v);
  if (okF && okV) {
    v.syncPending = false;
    v.syncError = '';
    f.syncPending = false;
    f.syncError = '';
    notify('success', '✅', 'Sincronizado', `${v.desc || id} sincronizada en BD.`, { duration: 3000 });
  } else {
    notify('danger', '⚠️', 'Falló reintento', 'No se pudo sincronizar factura/venta.', { duration: 5000 });
  }
  renderHistorial();
}

/**
 * Reconcilia stock_moves + products.stock para una venta POS (mismo id que factura).
 * Usado por reintentos, reparación masiva y recuperación de descuentos pendientes.
 * @returns {{ invOk: boolean }}
 */
async function syncPosVentaInventoryFromDb(v, f) {
  const id = v.id;
  const numFactura = v.desc || f.numero || id;
  const bodegaId = v.bodegaId || 'bodega_main';
  const items = Array.isArray(f.items) ? f.items : [];
  let invOk = true;
  let ventaPendingDirty = false;
  try {
    const qtyCol = typeof window.stockMovesQtyColumn === 'function'
      ? window.stockMovesQtyColumn()
      : 'qty';
    const normMoveQty =
      typeof window.normalizeStockMoveQtyFromDbRow === 'function'
        ? window.normalizeStockMoveQtyFromDbRow
        : (row) => parseFloat(row.qty ?? row.cantidad) || 0;

    const { data: movesRows, error: mvErr } = await supabaseClient
      .from('stock_moves')
      .select('*')
      .eq('tipo', 'venta_pos')
      .eq('documento_id', id);
    if (mvErr) throw mvErr;

    const moves = movesRows || [];

    const lineItems = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const pid = it.articuloId || it.id;
      const qty = Math.abs(parseInt(it.qty || it.cantidad, 10) || 0);
      if (!pid || qty <= 0) continue;
      lineItems.push({ pid, qty, it });
    }

    const needByPid = new Map();
    for (let li = 0; li < lineItems.length; li++) {
      const { pid, qty } = lineItems[li];
      needByPid.set(pid, (needByPid.get(pid) || 0) + qty);
    }

    function netForProduct(pid) {
      let s = 0;
      for (let m = 0; m < moves.length; m++) {
        const row = moves[m];
        if (String(row.product_id) !== String(pid)) continue;
        s += normMoveQty(row);
      }
      return s;
    }

    // Una fila agregada por producto (p. ej. backfill «Rellenar movimientos») ya cubre la venta; no insertar líneas extra por talla.
    for (const pid of needByPid.keys()) {
      const need = needByPid.get(pid) || 0;
      if (need <= 0) continue;
      const target = -need;
      const net = netForProduct(pid);
      if (net <= target) continue;
      const delta = target - net;
      if (delta >= 0) continue;
      const absDelta = Math.abs(delta);
      const fechaRec = v.fecha || today();
      const linesRpc = [{
        id: dbId(),
        product_id: pid,
        bodega_id: bodegaId,
        qty: absDelta,
        referencia: numFactura,
        documento_id: id,
        fecha: fechaRec,
        nota: 'Reconciliación POS · stock',
        tipo: 'venta_pos',
      }];
      if (!window.AppPosRepository?.applyPosSaleStockLinesAtomic) {
        invOk = false;
        continue;
      }
      try {
        const rpcRes = await window.AppPosRepository.applyPosSaleStockLinesAtomic(
          state,
          supabaseClient,
          linesRpc,
          qtyCol,
          {
            pushMovesVentas: true,
            fechaRef: fechaRec,
            numFactura,
            documentoId: id,
          },
        );
        if (!rpcRes.ok) throw rpcRes.error;
        const movesPayload = rpcRes.payload && rpcRes.payload.moves ? rpcRes.payload.moves : [];
        if (movesPayload.length > 0) {
          const m0 = movesPayload[0];
          moves.push({
            id: m0.id,
            product_id: pid,
            bodega_id: bodegaId,
            qty: m0.qty,
            cantidad: m0.cantidad,
            quantity: m0.quantity,
          });
        }
        if (window.AppPosRepository.removeStockProductsPendingLine) {
          const before = (v.stockProductsPendingLines || []).length;
          const linesPid = lineItems.filter((x) => String(x.pid) === String(pid));
          for (let li = 0; li < linesPid.length; li++) {
            window.AppPosRepository.removeStockProductsPendingLine(v, pid, linesPid[li].qty);
          }
          if ((v.stockProductsPendingLines || []).length < before) ventaPendingDirty = true;
        }
      } catch (pe) {
        console.warn('syncPosVentaInventoryFromDb apply_pos_sale_stock_lines:', pe?.message || pe);
        invOk = false;
        if (window.AppPosRepository.pushStockProductsPendingLine) {
          const linesPid = lineItems.filter((x) => String(x.pid) === String(pid));
          for (let li = 0; li < linesPid.length; li++) {
            window.AppPosRepository.pushStockProductsPendingLine(v, pid, linesPid[li].qty);
          }
          ventaPendingDirty = true;
        }
      }
    }

    const pendingSnap = [...(v.stockProductsPendingLines || [])];
    for (let pi = 0; pi < pendingSnap.length; pi++) {
      const pl = pendingSnap[pi];
      const pid = pl.articuloId;
      const qty = Math.abs(parseInt(pl.qty, 10) || 0);
      if (!pid || qty <= 0) continue;
      const stillPending = (v.stockProductsPendingLines || []).some(
        (x) => String(x.articuloId) === String(pid) && Math.abs(parseInt(x.qty, 10) || 0) === qty
      );
      if (!stillPending) continue;
      const needTotal = needByPid.get(pid) || 0;
      const target = -needTotal;
      const netP = netForProduct(pid);
      const hasMove = needTotal > 0 && netP <= target;
      if (!hasMove) continue;
      if (!window.AppPosRepository?.applyStockDecrementForLine) continue;
      try {
        if (window.AppPosRepository.refreshArticuloStockFromSupabase) {
          await window.AppPosRepository.refreshArticuloStockFromSupabase(state, supabaseClient, pid);
        }
        await window.AppPosRepository.applyStockDecrementForLine(state, supabaseClient, pid, qty);
        window.AppPosRepository.removeStockProductsPendingLine(v, pid, qty);
        ventaPendingDirty = true;
      } catch (pe) {
        console.warn('syncPosVentaInventoryFromDb pending stock:', pe?.message || pe);
        invOk = false;
      }
    }

    if (ventaPendingDirty) {
      if (window.AppPosRepository?.preparePosSaleForPersist) {
        window.AppPosRepository.preparePosSaleForPersist(f, v);
      }
      try { await saveRecord('ventas', v.id, v); } catch (_) { /* noop */ }
    }
  } catch (e) {
    invOk = false;
    console.warn('syncPosVentaInventoryFromDb:', e.message || e);
  }
  return { invOk };
}

/** Una factura POS: crea stock_moves faltantes y aplica descuentos en products (pendientes y líneas nuevas). */
async function repararStockProductosPosVenta(id) {
  const v = (state.ventas || []).find((x) => String(x.id) === String(id));
  const f = (state.facturas || []).find((x) => String(x.id) === String(id));
  if (!v || !f) {
    notify('warning', '⚠️', 'Faltan datos', 'No se encontró venta/factura local con ese id.', { duration: 5000 });
    return { ok: false };
  }
  const tipo = (f.tipo || 'pos').toLowerCase();
  if (tipo !== 'pos' || f.estado === 'anulada') {
    notify('warning', '⚠️', 'No aplica', 'Solo facturas POS activas (no anuladas).', { duration: 4000 });
    return { ok: false };
  }
  if (!_sbConnected || !supabaseClient) {
    notify('warning', '📡', 'Sin conexión BD', 'Conecta Supabase.', { duration: 5000 });
    return { ok: false };
  }
  showLoadingOverlay('connecting');
  try {
    const { invOk } = await syncPosVentaInventoryFromDb(v, f);
    if (invOk) {
      notify('success', '✅', 'Stock sincronizado', `${v.desc || id}: inventario actualizado según factura y movimientos.`, { duration: 4500 });
    } else {
      notify('warning', '⚠️', 'Revisar', `${v.desc || id}: parte del inventario pudo quedar pendiente (consola F12).`, { duration: 6000 });
    }
    if (typeof renderHistorial === 'function') renderHistorial();
    if (document.getElementById('art-tbody') && typeof renderArticulosList === 'function') renderArticulosList();
    return { ok: invOk };
  } finally {
    showLoadingOverlay('hide');
  }
}

/** Todas las facturas POS: recuperar movimientos faltantes y descuentos pendientes en products. */
async function repararStockProductosPosMasivo(opts) {
  const skipConfirm = opts && opts.skipConfirm;
  if (
    !skipConfirm &&
    !confirm(
      'Se revisarán todas las facturas POS del catálogo local: líneas stock_moves faltantes y descuentos en productos (incl. columna stock_products_pending en ventas). No duplica ingresos de caja. ¿Continuar?',
    )
  ) {
    return;
  }
  if (!_sbConnected || !supabaseClient) {
    notify('warning', '📡', 'Sin conexión BD', 'Conecta Supabase.', { duration: 5000 });
    return;
  }
  const facturas = (state.facturas || []).filter(
    (f) => (f.tipo || 'pos').toLowerCase() === 'pos' && f.estado !== 'anulada',
  );
  let ok = 0;
  let fail = 0;
  if (!skipConfirm) showLoadingOverlay('connecting');
  try {
    for (let i = 0; i < facturas.length; i++) {
      const f = facturas[i];
      const v = (state.ventas || []).find((x) => String(x.id) === String(f.id));
      if (!v) continue;
      const { invOk } = await syncPosVentaInventoryFromDb(v, f);
      if (invOk) ok++;
      else fail++;
    }
    notify(
      'success',
      '📦',
      'Sincronización POS',
      `Procesadas ${facturas.length} factura(s): ${ok} sin error de inventario, ${fail} con advertencias (revisa F12).`,
      { duration: 8000 },
    );
    if (typeof renderHistorial === 'function') renderHistorial();
    if (document.getElementById('art-tbody') && typeof renderArticulosList === 'function') renderArticulosList();
    if (typeof renderTesPagosProv === 'function') renderTesPagosProv();
  } finally {
    if (!skipConfirm) showLoadingOverlay('hide');
  }
}

/** Rellenar stock_moves (histórico) y luego sincronizar products. Orden recomendado para datos viejos. */
async function sincronizarPosInventarioCompleto() {
  if (
    !confirm(
      'Paso 1: crear stock_moves POS faltantes desde facturas. Paso 2: sincronizar stock en productos (products). ¿Ejecutar ambos?',
    )
  ) {
    return;
  }
  if (!_sbConnected || !supabaseClient) {
    notify('warning', '📡', 'Sin conexión BD', 'Conecta Supabase.', { duration: 5000 });
    return;
  }
  showLoadingOverlay('connecting');
  try {
    if (window.AppPosRepository?.backfillStockMovesFromFacturas) {
      await window.AppPosRepository.backfillStockMovesFromFacturas({
        state,
        supabaseClient,
        sbConnected: _sbConnected,
        dbId,
        notify,
        showLoadingOverlay: () => {},
        onDone: async () => {
          try {
            if (typeof window.reloadStockMovesVentasFromDb === 'function') {
              await window.reloadStockMovesVentasFromDb();
            }
          } catch (e) {
            console.warn('reloadStockMovesVentasFromDb:', e);
          }
          if (typeof renderTesPagosProv === 'function') renderTesPagosProv();
        },
      });
    }
    await repararStockProductosPosMasivo({ skipConfirm: true });
  } finally {
    showLoadingOverlay('hide');
  }
}

async function reintentarSyncCajaInventario(id) {
  const v = (state.ventas || []).find((x) => x.id === id);
  const f = (state.facturas || []).find((x) => x.id === id);
  if (!v || !f) {
    notify('warning', '⚠️', 'Faltan datos', 'No se encontró venta/factura local para reintento.', { duration: 5000 });
    return;
  }
  if (!_sbConnected || !supabaseClient) {
    notify('warning', '📡', 'Sin conexión BD', 'Conecta Supabase para reintentar sincronización.', { duration: 5000 });
    return;
  }

  const numFactura = v.desc || f.numero || id;
  const bodegaId = v.bodegaId || 'bodega_main';
  let invOk = true;
  let cajaOk = true;

  const invRes = await syncPosVentaInventoryFromDb(v, f);
  invOk = invRes.invOk;

  // 2) Reintento movimiento de caja sin duplicar.
  try {
    const existingMov = (state.tes_movimientos || []).some((m) =>
      m.categoria === 'venta_pos' && String(m.concepto || '').includes(numFactura)
    );
    if (!existingMov) {
      const prefCaja = window.AppCajaLogic?.getPosCajaId?.() || '';
      const caja =
        window.AppCajaLogic?.resolveCajaForPos?.(state, bodegaId, prefCaja) ||
        (state.cajas || []).find((c) => c.estado === 'abierta');
      if (!caja) throw new Error('No hay caja abierta para registrar el ingreso POS.');
      window.AppCajaLogic?.normalizeCaja?.(caja);
      const metodo = f.metodo || v.metodoPago || 'efectivo';
      const bucket = v.tipoPago === 'contraentrega'
        ? 'contraentrega'
        : (window.AppCajaLogic?.bucketFromMetodoId?.(metodo, state.cfg_metodos_pago) || 'efectivo');
      const total = parseFloat(f.total || v.valor) || 0;
      window.AppCajaLogic?.applyDeltaBucket?.(caja, bucket, total);
      const mov = {
        id: dbId(),
        cajaId: caja.id,
        tipo: 'ingreso',
        valor: total,
        concepto: `Venta POS ${numFactura} · Reintento sync`,
        fecha: v.fecha || today(),
        metodo,
        categoria: 'venta_pos',
        bucket
      };
      window.AppCajaLogic?.enrichMovWithSesion?.(state, caja.id, mov, dbId);
      if (!Array.isArray(state.tes_movimientos)) state.tes_movimientos = [];
      state.tes_movimientos.push(mov);
      const okCaja = await saveRecord('cajas', caja.id, caja);
      const okMov = await saveRecord('tes_movimientos', mov.id, mov);
      if (!okCaja || !okMov) throw new Error('No se pudo persistir caja/movimiento.');
    }
  } catch (e) {
    cajaOk = false;
    console.warn('reintentarSyncCajaInventario caja:', e.message || e);
  }

  if (invOk && cajaOk) {
    v.syncPending = false;
    v.syncError = '';
    if (f) { f.syncPending = false; f.syncError = ''; }
    if (window.AppPosRepository?.preparePosSaleForPersist) {
      window.AppPosRepository.preparePosSaleForPersist(f, v);
    }
    await saveRecord('ventas', v.id, v);
    await saveRecord('facturas', f.id, f);
    notify('success', '✅', 'Sync completado', `${numFactura} sincronizada en caja/inventario.`, { duration: 3500 });
  } else {
    v.syncPending = true;
    v.syncError = `retry:${invOk ? 'ok' : 'inv'}_${cajaOk ? 'ok' : 'caja'}`;
    if (window.AppPosRepository?.preparePosSaleForPersist) {
      window.AppPosRepository.preparePosSaleForPersist(f, v);
    }
    await saveRecord('ventas', v.id, v);
    notify('warning', '⚠️', 'Sync parcial', `${numFactura}: revisa ${!invOk ? 'inventario' : ''}${!invOk && !cajaOk ? ' y ' : ''}${!cajaOk ? 'caja' : ''}.`, { duration: 5500 });
  }
  renderHistorial();
}

function marcarSyncResuelto(id) {
  const v = (state.ventas || []).find((x) => x.id === id);
  const f = (state.facturas || []).find((x) => x.id === id);
  if (!v) return;
  v.syncPending = false;
  v.syncError = '';
  if (f) {
    f.syncPending = false;
    f.syncError = '';
  }
  notify('success', '✅', 'Marcado como resuelto', v.desc || id, { duration: 2500 });
  renderHistorial();
}

async function guardarCfgCajaBodegas() {
  const list = state.cajas || [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const checks = document.querySelectorAll(`input.cfg-caja-bod-cb[data-caja="${c.id}"]:checked`);
    const ids = Array.from(checks).map((el) => el.getAttribute('data-bodega')).filter(Boolean);
    c.bodegaIds = ids;
    window.AppCajaLogic?.normalizeCaja?.(c);
    await saveRecord('cajas', c.id, c);
  }
  notify('success', '✅', 'Cajas POS', 'Enlaces caja–bodega guardados.', { duration: 3000 });
  renderCfgTab('cajas_pos');
}

function openCfgCajaModal() {
  const bodegas = state.bodegas || [];
  openModal(`
    <div class="modal-title">+ Nueva Caja (Configuración)<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group">
      <label class="form-label">NOMBRE</label>
      <input class="form-control" id="cfg-caja-nombre" placeholder="Ej: Caja Bodega Norte">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">SALDO INICIAL EFECTIVO</label>
        <input type="number" class="form-control" id="cfg-caja-saldo" value="0" step="any">
      </div>
      <div class="form-group">
        <label class="form-label">ESTADO INICIAL</label>
        <select class="form-control" id="cfg-caja-estado">
          <option value="cerrada">Cerrada</option>
          <option value="abierta">Abierta</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">BODEGAS QUE OPERA (si no marcas, atiende todas)</label>
      <div style="display:flex;flex-wrap:wrap;gap:10px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg3)">
        ${
          bodegas.length
            ? bodegas.map((b) => `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="cfg-new-caja-bod" data-bodega="${b.id}"> ${(b.name || b.nombre || b.id)}</label>`).join('')
            : '<span style="color:var(--text2);font-size:12px">No hay bodegas creadas todavía.</span>'
        }
      </div>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarCfgCajaDesdeConfig()">💾 Crear caja</button>
  `);
}

async function guardarCfgCajaDesdeConfig() {
  const nombre = document.getElementById('cfg-caja-nombre')?.value.trim();
  if (!nombre) {
    notify('warning', '⚠️', 'Nombre requerido', 'Escribe el nombre de la caja.', { duration: 3000 });
    return;
  }
  const inicial = parseFloat(document.getElementById('cfg-caja-saldo')?.value) || 0;
  const estado = document.getElementById('cfg-caja-estado')?.value === 'abierta' ? 'abierta' : 'cerrada';
  const ids = Array.from(document.querySelectorAll('.cfg-new-caja-bod:checked'))
    .map((el) => el.getAttribute('data-bodega'))
    .filter(Boolean);

  const saldos = window.AppCajaLogic?.emptySaldos
    ? window.AppCajaLogic.emptySaldos()
    : { efectivo: 0, transferencia: 0, addi: 0, contraentrega: 0, tarjeta: 0, digital: 0, otro: 0 };
  saldos.efectivo = inicial;

  const caja = {
    id: dbId(),
    nombre,
    saldo: inicial,
    estado,
    apertura: estado === 'abierta' ? today() : null,
    bodegaIds: ids,
    saldosMetodo: saldos,
    sesionActivaId: estado === 'abierta' ? dbId() : null
  };
  window.AppCajaLogic?.normalizeCaja?.(caja);
  state.cajas.push(caja);
  await saveRecord('cajas', caja.id, caja);
  closeModal();
  notify('success', '✅', 'Caja creada', `${nombre} (${estado})`, { duration: 3000 });
  renderCfgTab('cajas_pos');
}

function renderConfig(){
  if (window.AppConfigModule?.renderConfig) {
    return window.AppConfigModule.renderConfig({ state, renderCfgTab });
  }
  const emp = state.empresa || {};
  const activeTab = window._cfgTab || 'empresa';
  const tabs = [
    {id:'empresa', icon:'🏢', label:'Empresa & Ticket'},
    {id:'inventario', icon:'🗂️', label:'Categorías'},
    {id:'logistica', icon:'🚚', label:'Logística'},
    {id:'pagos', icon:'💳', label:'Pagos'},
    {id:'precios', icon:'💰', label:'Tarifas & IVA'},
    {id:'nomina', icon:'👔', label:'Nómina'},
    {id:'bodegas', icon:'🏭', label:'Bodegas'},
    {id:'cajas_pos', icon:'🏧', label:'Cajas POS'},
    {id:'gamif', icon:'🎮', label:'Gamificación'},
    {id:'peligro', icon:'⚡', label:'Sistema'},
  ];

  document.getElementById('config-content').innerHTML = `
    <div class="tabs" style="margin-bottom:20px">
      ${tabs.map(t=>`<div class="tab ${activeTab===t.id?'active':''}" onclick="setCfgTab('${t.id}')">${t.icon} ${t.label}</div>`).join('')}
    </div>
    <div id="cfg-tab-body"></div>`;

  renderCfgTab(activeTab);
}

function setCfgTab(tab) {
  if (window.AppConfigModule?.setCfgTab) {
    return window.AppConfigModule.setCfgTab({ tab, renderCfgTab });
  }
  window._cfgTab = tab;
  document.querySelectorAll('#config-content .tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('onclick')?.includes("'"+tab+"'"));
  });
  renderCfgTab(tab);
}

function renderCfgTab(tab) {
  if (window.AppConfigModule?.renderCfgTab) {
    return window.AppConfigModule.renderCfgTab({
      state, tab, today, fmt, saveConfig, renderDashboard, renderConfig,
      openModal, closeModal, saveRecord, deleteRecord, notify, deleteFromCollection,
      supabaseClient, checkMonthReset, renderAll, confirm
    });
  }
  const el = document.getElementById('cfg-tab-body');
  if(!el) return;
  const emp = state.empresa || {};

  if(tab === 'empresa') {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">🖨️ VISTA PREVIA TICKET 80mm</div>
        <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
          <div style="background:white;color:#000;font-family:'Courier New',monospace;font-size:10px;width:72mm;padding:8px;border:1px solid #ddd;border-radius:4px;margin:0 auto">
            ${emp.logoBase64?`<div style="text-align:center;margin-bottom:4px"><img src="${emp.logoBase64}" style="max-width:160px"></div>`:`<div style="text-align:center;font-weight:900;font-size:13px;letter-spacing:2px">${emp.nombre||'NOMBRE EMPRESA'}</div>`}
            <div style="text-align:center;font-weight:700">${emp.nombre||'NOMBRE EMPRESA'}</div>
            <div style="text-align:center;font-size:9px">NIT: ${emp.nit||'---'} | ${emp.regimenFiscal||'Régimen ordinario'}</div>
            <div style="text-align:center;font-size:9px">${emp.departamento||''}/${emp.ciudad||''} / ${emp.direccion||''}</div>
            <div style="text-align:center;font-size:9px">Tel: ${emp.telefono||''}${emp.telefono2?' / '+emp.telefono2:''}</div>
            ${emp.email?`<div style="text-align:center;font-size:9px">${emp.email}</div>`:''}
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="text-align:center;font-weight:700">FACTURA DE VENTA No.: 00001</div>
            <div style="text-align:center;font-size:9px">${today()}</div>
            ${emp.mensajeHeader?`<div style="text-align:center;font-size:9px;white-space:pre-wrap">${emp.mensajeHeader}</div>`:''}
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="font-size:9px">Cliente: CLIENTE MOSTRADOR</div>
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="font-size:9px">Producto ejemplo x1 → 48.000</div>
            <div style="border-top:1px dashed #000;margin:4px 0"></div>
            <div style="font-weight:900;font-size:11px;text-align:right">TOTAL: $48.000</div>
            ${emp.mensajePie?`<div style="text-align:center;font-size:9px;margin-top:4px;white-space:pre-wrap">${emp.mensajePie}</div>`:''}
          </div>
          <div style="flex:2;min-width:280px">
            <div class="form-group">
              <label class="form-label">📸 LOGO (recomendado 400×120px, fondo blanco)</label>
              <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('cfg-logo-input').click()">📁 Subir Logo</button>
                <input type="file" id="cfg-logo-input" accept="image/*" style="display:none" onchange="procesarLogoConfig(this)">
                ${emp.logoBase64?`<button class="btn btn-xs btn-danger" onclick="state.empresa.logoBase64='';saveConfig('empresa',state.empresa).then(()=>renderCfgTab('empresa'))">✕ Quitar</button>`:''}
                <div style="width:80px;height:40px;border:1px solid var(--border);border-radius:6px;background:${emp.logoBase64?`url('${emp.logoBase64}') center/contain no-repeat white`:'var(--bg3)'}"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🏢 DATOS DE EMPRESA</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">NOMBRE EMPRESA</label><input class="form-control" id="cfg-nombre" value="${emp.nombre||''}" placeholder="EON CLOTHING"></div>
          <div class="form-group"><label class="form-label">NOMBRE SECUNDARIO</label><input class="form-control" id="cfg-nombre2" value="${emp.nombreComercial||''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">NIT</label><input class="form-control" id="cfg-nit" value="${emp.nit||''}"></div>
          <div class="form-group"><label class="form-label">RÉGIMEN FISCAL</label><input class="form-control" id="cfg-regimen" value="${emp.regimenFiscal||''}" placeholder="No responsable de IVA"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">DEPARTAMENTO</label><input class="form-control" id="cfg-dpto" value="${emp.departamento||''}"></div>
          <div class="form-group"><label class="form-label">CIUDAD</label><input class="form-control" id="cfg-ciudad" value="${emp.ciudad||''}"></div>
        </div>
        <div class="form-group"><label class="form-label">DIRECCIÓN</label><input class="form-control" id="cfg-dir" value="${emp.direccion||''}"></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">TELÉFONO 1</label><input class="form-control" id="cfg-tel" value="${emp.telefono||''}"></div>
          <div class="form-group"><label class="form-label">TELÉFONO 2</label><input class="form-control" id="cfg-tel2" value="${emp.telefono2||''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">EMAIL</label><input class="form-control" id="cfg-email" value="${emp.email||''}"></div>
          <div class="form-group"><label class="form-label">PÁGINA WEB</label><input class="form-control" id="cfg-web" value="${emp.web||''}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">VENDEDORA</label><input class="form-control" id="cfg-vendedora" value="${emp.vendedora||''}"></div>
          <div class="form-group"><label class="form-label">INSTAGRAM / REDES</label><input class="form-control" id="cfg-social" value="${emp.social||''}"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🧾 TEXTOS DEL TICKET</div>
        <div class="form-group"><label class="form-label">MENSAJE ENCABEZADO</label><textarea class="form-control" id="cfg-header" rows="3">${emp.mensajeHeader||''}</textarea></div>
        <div class="form-group"><label class="form-label">MENSAJE PIE</label><textarea class="form-control" id="cfg-pie" rows="2">${emp.mensajePie||''}</textarea></div>
        <div class="form-group"><label class="form-label">POLÍTICA DE DATOS</label><textarea class="form-control" id="cfg-datos" rows="2">${emp.politicaDatos||''}</textarea></div>
        <div class="form-group"><label class="form-label">POLÍTICA CAMBIOS / GARANTÍAS</label><textarea class="form-control" id="cfg-garantias" rows="2">${emp.mensajeGarantias||''}</textarea></div>
      </div>
      <button class="btn btn-primary" style="width:100%;height:50px;font-size:16px" onclick="guardarConfigCompleta()">💾 Guardar Configuración de Empresa</button>`;
  }

  else if(tab === 'inventario') {
    const cats = state.cfg_categorias || [];
    const secs = state.cfg_secciones || [];
    el.innerHTML = `
      <div class="grid-2">
        <div class="card" style="margin:0">
          <div class="card-title">📁 SECCIONES WEB
            <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_secciones','Sección',['nombre:text:Nombre'])">+ Nueva</button>
          </div>
          <div class="table-wrap"><table><thead><tr><th>Nombre</th><th></th></tr></thead><tbody>
          ${secs.map(s=>`<tr><td style="font-weight:700">${s.nombre}</td><td>
            <button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_secciones','${s.id}','inventario')">✕</button>
          </td></tr>`).join('')||'<tr><td colspan="2" style="text-align:center;color:var(--text2);padding:12px">Sin secciones</td></tr>'}
          </tbody></table></div>
        </div>
        <div class="card" style="margin:0">
          <div class="card-title">🗂️ CATEGORÍAS
            <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModalCat()">+ Nueva</button>
          </div>
          <div class="table-wrap"><table><thead><tr><th>Sección</th><th>Categoría</th><th></th></tr></thead><tbody>
          ${cats.map(c=>`<tr>
            <td style="font-size:11px;color:var(--text2)">${c.seccion}</td>
            <td style="font-weight:700">${c.nombre}</td>
            <td><button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_categorias','${c.id}','inventario')">✕</button></td>
          </tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:12px">Sin categorías</td></tr>'}
          </tbody></table></div>
        </div>
      </div>`;
  }

  else if(tab === 'logistica') {
    const trans = state.cfg_transportadoras || [];
    el.innerHTML = `
      <div class="card">
        <div class="card-title">🚚 TRANSPORTADORAS
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_transportadoras','Transportadora',['nombre:text:Nombre'])">+ Nueva</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Activa</th><th></th></tr></thead><tbody>
        ${trans.map(t=>`<tr>
          <td style="font-weight:700">${t.nombre}</td>
          <td><span class="badge ${t.activa!==false?'badge-ok':'badge-pend'}">${t.activa!==false?'✓ Activa':'Inactiva'}</span></td>
          <td><div class="btn-group">
            <button class="btn btn-xs btn-secondary" onclick="toggleCfgActivo('cfg_transportadoras','${t.id}','logistica')">${t.activa!==false?'Desactivar':'Activar'}</button>
            <button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_transportadoras','${t.id}','logistica')">✕</button>
          </div></td>
        </tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:12px">Sin transportadoras</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-title">⏱️ TIEMPOS DE LIQUIDACIÓN</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">DÍAS LIQ. LOCAL (hábiles)</label><input type="number" class="form-control" id="cfg-dias-local" value="${state.diasLocal||1}" min="1"></div>
          <div class="form-group"><label class="form-label">DÍAS LIQ. INTER (hábiles)</label><input type="number" class="form-control" id="cfg-dias-inter" value="${state.diasInter||5}" min="1"></div>
        </div>
        <button class="btn btn-primary" onclick="guardarDiasLiq()">💾 Guardar Tiempos</button>
      </div>`;
  }

  else if(tab === 'pagos') {
    const metodos = state.cfg_metodos_pago || [];
    el.innerHTML = `
      <div class="card">
        <div class="card-title">💳 MÉTODOS DE PAGO
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_metodos_pago','Método de Pago',['nombre:text:Nombre','tipo:text:Tipo (efectivo/digital/banco/tarjeta)'])">+ Nuevo</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>
        ${metodos.map(m=>`<tr>
          <td style="font-weight:700">${m.nombre}</td>
          <td><span class="badge badge-info">${m.tipo||'otro'}</span></td>
          <td><span class="badge ${m.activo!==false?'badge-ok':'badge-pend'}">${m.activo!==false?'Activo':'Inactivo'}</span></td>
          <td><div class="btn-group">
            <button class="btn btn-xs btn-secondary" onclick="toggleCfgActivo('cfg_metodos_pago','${m.id}','pagos')">${m.activo!==false?'Desactivar':'Activar'}</button>
            <button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_metodos_pago','${m.id}','pagos')">✕</button>
          </div></td>
        </tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px">Sin métodos</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  else if(tab === 'precios') {
    const tarifas = state.cfg_tarifas || [];
    const impuestos = state.cfg_impuestos || [];
    el.innerHTML = `
      <div class="card">
        <div class="card-title">💰 TARIFAS DE PRECIO
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_tarifas','Tarifa',['nombre:text:Nombre','porcentaje:number:% Ajuste (negativo=descuento)','descripcion:text:Descripción'])">+ Nueva</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>% Ajuste</th><th>Descripción</th><th></th></tr></thead><tbody>
        ${tarifas.map(t=>`<tr>
          <td style="font-weight:700">${t.nombre}</td>
          <td style="color:${t.porcentaje>0?'var(--green)':t.porcentaje<0?'var(--red)':'var(--text2)'};font-weight:700">${t.porcentaje>0?'+':''}${t.porcentaje}%</td>
          <td style="color:var(--text2);font-size:11px">${t.descripcion||'—'}</td>
          <td><button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_tarifas','${t.id}','precios')">✕</button></td>
        </tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px">Sin tarifas</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-title">📊 IMPUESTOS Y RETENCIONES
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('cfg_impuestos','Impuesto',['nombre:text:Nombre','porcentaje:number:Porcentaje %','tipo:text:Tipo (venta/retencion)'])">+ Nuevo</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>%</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>
        ${impuestos.map(i=>`<tr>
          <td style="font-weight:700">${i.nombre}</td>
          <td style="font-weight:700;color:var(--accent)">${i.porcentaje}%</td>
          <td><span class="badge badge-info">${i.tipo||'venta'}</span></td>
          <td><span class="badge ${i.activo!==false?'badge-ok':'badge-pend'}">${i.activo!==false?'Activo':'Inactivo'}</span></td>
          <td><div class="btn-group">
            <button class="btn btn-xs btn-secondary" onclick="toggleCfgActivo('cfg_impuestos','${i.id}','precios')">${i.activo!==false?'Desactivar':'Activar'}</button>
            <button class="btn btn-xs btn-danger" onclick="eliminarCfgItem('cfg_impuestos','${i.id}','precios')">✕</button>
          </div></td>
        </tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:12px">Sin impuestos</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  else if(tab === 'nomina') {
    const conceptos = state.nom_conceptos || [];
    el.innerHTML = `
      <div class="card">
        <div class="card-title">📝 CONCEPTOS DE NÓMINA
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="openConceptoModal()">+ Nuevo</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Fórmula</th><th>Valor</th><th></th></tr></thead><tbody>
        ${conceptos.map(c=>`<tr>
          <td style="font-weight:700">${c.nombre}</td>
          <td><span class="badge ${c.tipo==='devengo'?'badge-ok':'badge-pend'}">${c.tipo}</span></td>
          <td><span class="badge badge-info">${c.formula}</span></td>
          <td style="font-weight:700">${c.formula==='porcentaje'?c.valor+'%':fmt(c.valor)}</td>
          <td><button class="btn btn-xs btn-danger" onclick="eliminarConceptoCfg('${c.id}')">✕</button></td>
        </tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-title">📅 PARÁMETROS DE NÓMINA</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">SMMLV 2026</label>
            <input type="number" class="form-control" id="cfg-smmlv" value="${state.cfg_game?.smmlv||1750905}">
          </div>
          <div class="form-group"><label class="form-label">AUX. TRANSPORTE 2026</label>
            <input type="number" class="form-control" id="cfg-auxtrans" value="${state.cfg_game?.aux_trans||249095}">
          </div>
        </div>
        <button class="btn btn-primary" onclick="guardarParamsNomina()">💾 Guardar Parámetros</button>
      </div>`;
  }

  else if(tab === 'bodegas') {
    const bodegas = state.bodegas || [];
    el.innerHTML = `
      <div class="card">
        <div class="card-title">🏭 BODEGAS
          <button class="btn btn-xs btn-primary" style="margin-left:auto" onclick="abrirCfgModal('bodegas','Bodega',['nombre:text:Nombre','ubicacion:text:Ubicación/Descripción'])">+ Nueva</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>Nombre</th><th>Ubicación</th><th></th></tr></thead><tbody>
        ${bodegas.map(b=>`<tr>
          <td style="font-size:10px;color:var(--text2)">${b.id}</td>
          <td style="font-weight:700">${b.name||b.nombre||''}</td>
          <td>${b.ubicacion||'—'}</td>
          <td><button class="btn btn-xs btn-danger" onclick="eliminarBodega('${b.id}')">✕</button></td>
        </tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px">Sin bodegas</td></tr>'}
        </tbody></table></div>
      </div>`;
  }

  else if(tab === 'gamif') {
    const g = state.cfg_game || {};
    el.innerHTML = `
      <div class="card">
        <div class="card-title">🎮 CONFIGURACIÓN GAMIFICACIÓN</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">META MENSUAL ($)</label><input type="number" class="form-control" id="cfg-meta" value="${state.meta||34000000}"></div>
          <div class="form-group"><label class="form-label">XP AL LIQUIDAR UN COBRO</label><input type="number" class="form-control" id="cfg-xp-liq" value="${g.xp_liquidar||20}"></div>
        </div>
        <div class="card-title" style="margin-top:8px">XP POR CANAL</div>
        <div class="form-row-3">
          <div class="form-group"><label class="form-label">VITRINA (1 XP c/$ de)</label><input type="number" class="form-control" id="cfg-xp-vitrina" value="${g.xp_por_venta_vitrina||150000}"></div>
          <div class="form-group"><label class="form-label">LOCAL (1 XP c/$ de)</label><input type="number" class="form-control" id="cfg-xp-local" value="${g.xp_por_venta_local||25000}"></div>
          <div class="form-group"><label class="form-label">INTER (1 XP c/$ de)</label><input type="number" class="form-control" id="cfg-xp-inter" value="${g.xp_por_venta_inter||20000}"></div>
        </div>
        <button class="btn btn-primary" style="margin-top:8px" onclick="guardarCfgGame()">💾 Guardar Gamificación</button>
      </div>`;
  }

  else if(tab === 'peligro') {
    el.innerHTML = `
      <div class="card" style="border-color:rgba(248,113,113,0.3)">
        <div class="card-title" style="color:var(--red)">⚡ ZONA DE PELIGRO</div>
        <div style="color:var(--text2);font-size:12px;margin-bottom:20px">Estas acciones afectan el estado general del ERP.</div>
        <div class="btn-group">
          <button class="btn btn-danger btn-sm" onclick="forceMonthReset()">🔄 Archivar Ventas del Mes</button>
          <button class="btn btn-secondary btn-sm" style="color:var(--red)" onclick="location.reload()">🔌 Forzar Recarga</button>
        </div>
      </div>`;
  }
}

// ===== CONFIG HELPERS =====

function abrirCfgModal(collection, titulo, fields) {
  if (window.AppConfigModule?.abrirCfgModal) {
    return window.AppConfigModule.abrirCfgModal({ collection, titulo, fields, openModal });
  }
  openModal(`
    <div class="modal-title">+ ${titulo}<button class="modal-close" onclick="closeModal()">×</button></div>
    ${fields.map(f=>{const[key,type,label]=f.split(':');return`<div class="form-group"><label class="form-label">${label}</label><input type="${type==='number'?'number':'text'}" class="form-control" id="cfg-field-${key}"></div>`}).join('')}
    <button class="btn btn-primary" style="width:100%" onclick="guardarCfgItem('${collection}',${JSON.stringify(fields).replace(/"/g,"'")})">Guardar</button>
  `);
}

function abrirEditarCfgItem(collection, titulo, fields, id) {
  if (window.AppConfigModule?.abrirEditarCfgItem) {
    return window.AppConfigModule.abrirEditarCfgItem({ state, collection, titulo, fields, id, openModal, notify });
  }
}

function abrirCfgModalCat() {
  if (window.AppConfigModule?.abrirCfgModalCat) {
    return window.AppConfigModule.abrirCfgModalCat({ state, openModal });
  }
  const secs = state.cfg_secciones || [];
  openModal(`
    <div class="modal-title">+ Nueva Categoría<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">SECCIÓN</label>
      <select class="form-control" id="cfg-field-seccion">
        ${secs.map(s=>`<option value="${s.nombre}">${s.nombre}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label class="form-label">NOMBRE CATEGORÍA</label>
      <input type="text" class="form-control" id="cfg-field-nombre">
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarCfgItem('cfg_categorias',['seccion:text:Sección','nombre:text:Nombre'])">Guardar</button>
  `);
}

async function guardarCfgItem(collection, fields, editId) {
  if (window.AppConfigModule?.guardarCfgItem) {
    return window.AppConfigModule.guardarCfgItem({
      state, collection, fields, editId, uid, dbId, saveRecord, closeModal, renderCfgTab, notify
    });
  }
  if(typeof fields === 'string') fields = JSON.parse(fields.replace(/'/g,'"'));
  const item = { id: dbId() };
  for(const f of fields) {
    const key = f.split(':')[0];
    const type = f.split(':')[1];
    const el = document.getElementById('cfg-field-'+key);
    if(el) item[key] = type==='number' ? parseFloat(el.value)||0 : el.value.trim();
  }
  if(collection === 'bodegas') {
    item.name = item.nombre; item.activa = true;
  }
  if(!state[collection]) state[collection] = [];
  state[collection].push(item);
  await saveRecord(collection, item.id, item);
  closeModal();
  renderCfgTab(window._cfgTab||'inventario');
  notify('success','✅','Guardado',`${Object.values(item).filter(v=>typeof v==='string'&&v.length>0)[0]||''}`,{duration:2000});
}

async function eliminarCfgItem(collection, id, tab) {
  if (window.AppConfigModule?.eliminarCfgItem) {
    return window.AppConfigModule.eliminarCfgItem({
      state, collection, id, tab, confirm, deleteRecord, renderCfgTab, notify
    });
  }
  if(!confirm('¿Eliminar este registro?')) return;
  state[collection] = (state[collection]||[]).filter(x=>x.id!==id);
  await deleteRecord(collection, id);
  renderCfgTab(tab);
}

async function toggleCfgActivo(collection, id, tab) {
  if (window.AppConfigModule?.toggleCfgActivo) {
    return window.AppConfigModule.toggleCfgActivo({
      state, collection, id, tab, saveRecord, renderCfgTab, notify
    });
  }
  const item = (state[collection]||[]).find(x=>x.id===id);
  if(!item) return;
  const field = collection==='cfg_transportadoras' ? 'activa' : 'activo';
  item[field] = !item[field];
  await saveRecord(collection, id, item);
  renderCfgTab(tab);
}

async function eliminarBodega(id) {
  if (window.AppConfigModule?.eliminarBodega) {
    return window.AppConfigModule.eliminarBodega({
      state, id, confirm, supabaseClient, renderCfgTab
    });
  }
  if(!confirm('¿Eliminar esta bodega? Verifica que no tenga inventario activo.')) return;
  state.bodegas = state.bodegas.filter(b=>b.id!==id);
  try { await supabaseClient.from('bodegas').delete().eq('id',id); } catch(e){}
  renderCfgTab('bodegas');
}

async function guardarDiasLiq() {
  if (window.AppConfigModule?.guardarDiasLiq) {
    return window.AppConfigModule.guardarDiasLiq({ state, saveConfig, notify });
  }
  state.diasLocal = parseInt(document.getElementById('cfg-dias-local')?.value)||1;
  state.diasInter = parseInt(document.getElementById('cfg-dias-inter')?.value)||5;
  await saveConfig('diasLocal', state.diasLocal);
  await saveConfig('diasInter', state.diasInter);
  notify('success','✅','Tiempos guardados','',{duration:2000});
}

async function guardarCfgGame() {
  if (window.AppConfigModule?.guardarCfgGame) {
    return window.AppConfigModule.guardarCfgGame({ state, saveConfig, renderDashboard, notify });
  }
  state.meta = parseFloat(document.getElementById('cfg-meta')?.value)||34000000;
  state.cfg_game = {
    ...state.cfg_game,
    xp_liquidar: parseInt(document.getElementById('cfg-xp-liq')?.value)||20,
    xp_por_venta_vitrina: parseInt(document.getElementById('cfg-xp-vitrina')?.value)||150000,
    xp_por_venta_local: parseInt(document.getElementById('cfg-xp-local')?.value)||25000,
    xp_por_venta_inter: parseInt(document.getElementById('cfg-xp-inter')?.value)||20000,
  };
  await saveConfig('meta', state.meta);
  await saveConfig('cfg_game', state.cfg_game);
  renderDashboard();
  notify('success','✅','Gamificación guardada','',{duration:2000});
}

async function guardarParamsNomina() {
  if (window.AppConfigModule?.guardarParamsNomina) {
    return window.AppConfigModule.guardarParamsNomina({ state, saveConfig, notify });
  }
  state.cfg_game = {
    ...state.cfg_game,
    smmlv: parseFloat(document.getElementById('cfg-smmlv')?.value)||1750905,
    aux_trans: parseFloat(document.getElementById('cfg-auxtrans')?.value)||249095,
  };
  await saveConfig('cfg_game', state.cfg_game);
  notify('success','✅','Parámetros guardados','Se aplicarán en el próximo cálculo.',{duration:3000});
}

function eliminarConceptoCfg(id) {
  if (window.AppConfigModule?.eliminarConceptoCfg) {
    return window.AppConfigModule.eliminarConceptoCfg({ id, deleteFromCollection, renderCfgTab });
  }
  deleteFromCollection('nom_conceptos', id, 'config');
  renderCfgTab('nomina');
}


function procesarLogoConfig(input) {
  if (window.AppConfigModule?.procesarLogoConfig) {
    return window.AppConfigModule.procesarLogoConfig({ input, state, saveConfig, renderConfig, notify });
  }
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = async function() {
      const canvas = document.createElement('canvas');
      const MAX_W = 400;
      const scale = Math.min(1, MAX_W / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if(!state.empresa) state.empresa = {};
      state.empresa.logoBase64 = canvas.toDataURL('image/png');
      await saveConfig('empresa', state.empresa);
      renderConfig();
      notify('success','🖼️','Logo cargado','Se ajustó automáticamente para 80mm.',{duration:3000});
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function guardarConfigCompleta() {
  if (window.AppConfigModule?.guardarConfigCompleta) {
    return window.AppConfigModule.guardarConfigCompleta({ state, saveConfig, notify, renderConfig, renderDashboard });
  }
  if(!state.empresa) state.empresa = {};
  state.empresa.nombre        = document.getElementById('cfg-nombre')?.value.trim() || state.empresa.nombre;
  state.empresa.nombreComercial = document.getElementById('cfg-nombre2')?.value.trim() || '';
  state.empresa.nit           = document.getElementById('cfg-nit')?.value.trim() || '';
  state.empresa.regimenFiscal = document.getElementById('cfg-regimen')?.value.trim() || '';
  state.empresa.departamento  = document.getElementById('cfg-dpto')?.value.trim() || '';
  state.empresa.ciudad        = document.getElementById('cfg-ciudad')?.value.trim() || '';
  state.empresa.direccion     = document.getElementById('cfg-dir')?.value.trim() || '';
  state.empresa.telefono      = document.getElementById('cfg-tel')?.value.trim() || '';
  state.empresa.telefono2     = document.getElementById('cfg-tel2')?.value.trim() || '';
  state.empresa.email         = document.getElementById('cfg-email')?.value.trim() || '';
  state.empresa.web           = document.getElementById('cfg-web')?.value.trim() || '';
  state.empresa.vendedora     = document.getElementById('cfg-vendedora')?.value.trim() || '';
  state.empresa.social        = document.getElementById('cfg-social')?.value.trim() || '';
  state.empresa.mensajeHeader = document.getElementById('cfg-header')?.value.trim() || '';
  state.empresa.mensajePie    = document.getElementById('cfg-pie')?.value.trim() || '';
  state.empresa.politicaDatos = document.getElementById('cfg-datos')?.value.trim() || '';
  state.empresa.mensajeGarantias = document.getElementById('cfg-garantias')?.value.trim() || '';

  state.meta      = parseFloat(document.getElementById('cfg-meta')?.value) || 34000000;
  state.diasLocal = parseInt(document.getElementById('cfg-dias-local')?.value) || 1;
  state.diasInter = parseInt(document.getElementById('cfg-dias-inter')?.value) || 5;

  await saveConfig('empresa', state.empresa);
  await saveConfig('meta', state.meta);
  await saveConfig('diasLocal', state.diasLocal);
  await saveConfig('diasInter', state.diasInter);

  notify('success','✅','Configuración guardada','Los datos se reflejan en el ticket.',{duration:3000});
  renderConfig();
  renderDashboard();
}

// Mantener saveConfig como función legacy (no confundir con la async de Supabase)
function saveConfigLegacy() { guardarConfigCompleta(); }
if (window.AppConfigModule?.saveConfigLegacy) {
  saveConfigLegacy = function() {
    return window.AppConfigModule.saveConfigLegacy({ state, saveConfig, notify, renderConfig, renderDashboard });
  };
}

function forceMonthReset(){
  if (window.AppConfigModule?.forceMonthReset) {
    return window.AppConfigModule.forceMonthReset({ state, checkMonthReset, saveConfig, renderAll, notify, confirm });
  }
  if(confirm('⚠️ ¿Estás seguro? Esto archivará todas las ventas actuales y reiniciará el progreso de la meta mensual. Esta acción no se puede deshacer fácilmente.')) {
    state.currentMonth = null;
    checkMonthReset();
    saveConfig('consecutivos', state.consecutivos);
    renderAll();
    notify('success', '🔄', 'Mes Reseteado', 'Las ventas han sido archivadas correctamente.', {duration: 4000});
  }
}

// ===================================================================
// ===== SEPARADOS (SHOWROOM) =====
// ===================================================================
function _sepEscapeHtml(s){
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _sepLineItemsHtml(v){
  const f=(state.facturas||[]).find(x=>x.id===v.id);
  const items=(f&&Array.isArray(f.items)&&f.items.length)?f.items:(v.items||[]);
  if(!items.length)return'<span style="color:var(--text2)">—</span>';
  const lis=items.map(i=>{
    const name=_sepEscapeHtml(i.nombre||i.name||'Ítem');
    const talla=i.talla?' · T:'+_sepEscapeHtml(i.talla):'';
    const q=i.qty||i.cantidad||1;
    return`<li style="margin:2px 0">${name}${talla} ×${q}</li>`;
  }).join('');
  return`<ul style="margin:0;padding-left:18px;font-size:11px;line-height:1.45;color:var(--text2);min-width:200px;max-width:360px">${lis}</ul>`;
}
function _sepFmtEntregaCell(v,ent){
  const est=v.estadoEntrega||'Pendiente';
  if(!ent||!v.fechaHoraEntrega)return`<span class="badge ${ent?'badge-ok':'badge-warn'}">${est}</span>`;
  let hora='';
  try{hora=new Date(v.fechaHoraEntrega).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'medium'});}catch(_){}
  return`<span class="badge badge-ok">Entregado</span>${hora?`<div style="font-size:10px;color:var(--text2);margin-top:4px;white-space:normal;line-height:1.35">${hora}</div>`:''}`;
}
function _sepCanalBadge(v){
  const c=v.canal||'vitrina';
  if(c==='local')return'<span class="badge badge-warn">🛵 Local</span>';
  if(c==='inter')return'<span class="badge badge-inter">📦 Inter</span>';
  return'<span class="badge badge-vitrina">🏪 Vitrina</span>';
}
function _sepComprobanteForVenta(v){
  const f=(state.facturas||[]).find(x=>x.id===v.id);
  return String(v.comprobante||f?.comprobante||'').trim();
}
function _sepFmtComprobanteCell(v){
  const c=_sepComprobanteForVenta(v);
  if(!c)return'<span style="color:var(--text2)">—</span>';
  return`<div style="max-width:280px;font-size:11px;line-height:1.35;color:var(--text2);word-break:break-word">${_sepEscapeHtml(c)}</div>`;
}
function _sepSort(arr){
  return[...arr].sort((a,b)=>{
    const pa=a.estadoEntrega==='Entregado'?1:0,pb=b.estadoEntrega==='Entregado'?1:0;
    if(pa!==pb)return pa-pb;
    const cf=(b.fecha||'').localeCompare(a.fecha||'');if(cf!==0)return cf;
    return String(b.id||'').localeCompare(String(a.id||''));
  });
}

function renderVentasCatalogo(){
  if (!Array.isArray(state.ventasCatalogo)) state.ventasCatalogo = [];
  if (window.AppVentasCatalogoModule?.renderVentasCatalogo) {
    return window.AppVentasCatalogoModule.renderVentasCatalogo({
      state, fmt, openModal, saveRecord, notify, renderVentasCatalogo, nextId: () => dbId()
    });
  }
  const el = document.getElementById('vcatalog-content');
  if (el) el.innerHTML = '<div class="card" style="padding:20px;color:var(--text2)">No se cargó ventas-catalogo-module.js</div>';
}

function renderSeparados(){
  if (window.AppSeparadosModule?.renderSeparados) {
    return window.AppSeparadosModule.renderSeparados({ state, formatDate, fmt });
  }
  const desde = document.getElementById('sep-desde')?.value||'';
  const hasta = document.getElementById('sep-hasta')?.value||'';
  const q = (document.getElementById('sep-search')?.value||'').toLowerCase();
  const estadoVista = document.getElementById('sep-estado')?.value||'';

  let separados = (state.ventas||[]).filter(v => ventaCuentaParaTotales(v) && v.esSeparado);
  if(desde) separados = separados.filter(v => v.fecha >= desde);
  if(hasta) separados = separados.filter(v => v.fecha <= hasta);
  if(q) separados = separados.filter(v => {
    const comp=_sepComprobanteForVenta(v).toLowerCase();
    return (v.cliente||'').toLowerCase().includes(q)||comp.includes(q)||(v.telefono||'').includes(q)||(v.desc||'').toLowerCase().includes(q)||(v.guia||'').toLowerCase().includes(q);
  });

  const pendientes = separados.filter(v => v.estadoEntrega !== 'Entregado');
  const entregados = separados.filter(v => v.estadoEntrega === 'Entregado');
  const sumPend = pendientes.reduce((a,v)=>a+(parseFloat(v.valor)||0),0);
  const sumEntr = entregados.reduce((a,v)=>a+(parseFloat(v.valor)||0),0);

  let lista = separados;
  if(estadoVista==='pend') lista = lista.filter(v=>v.estadoEntrega!=='Entregado');
  else if(estadoVista==='entr') lista = lista.filter(v=>v.estadoEntrega==='Entregado');
  lista = _sepSort(lista);

  const rowsHtml = lista.map(v => {
    const ent=v.estadoEntrega==='Entregado';
    return `<tr style="${ent?'opacity:0.55':''}">
    <td>${formatDate(v.fecha)}</td>
    <td>${_sepCanalBadge(v)}</td>
    <td style="font-weight:700;color:var(--text2)">${v.desc||'—'}</td>
    <td style="font-weight:700">${v.cliente||'MOSTRADOR'}</td>
    <td style="vertical-align:top">${_sepFmtComprobanteCell(v)}</td>
    <td>${v.telefono||'—'}</td>
    <td style="vertical-align:top">${_sepLineItemsHtml(v)}</td>
    <td style="color:var(--accent);font-weight:700">${fmt(v.valor)}</td>
    <td style="vertical-align:top;min-width:120px">${_sepFmtEntregaCell(v,ent)}</td>
    <td>${!ent?`<button class="btn btn-xs btn-primary" onclick="entregarSeparado('${v.id}')">✓ Entregar</button>`:'<span style="font-size:11px;color:var(--text2)">—</span>'}</td>
  </tr>`;
  }).join('')||'<tr><td colspan="10" style="text-align:center;color:var(--text2);padding:24px">Sin separados</td></tr>';

  if(document.getElementById('sep-tbody')) {
    document.getElementById('sep-tbody').innerHTML = rowsHtml;
    const p = document.getElementById('sep-pend'); if(p) p.textContent = pendientes.length;
    const e = document.getElementById('sep-entr'); if(e) e.textContent = entregados.length;
    const sp = document.getElementById('sep-pend-sum'); if(sp) sp.textContent = fmt(sumPend);
    const se = document.getElementById('sep-entr-sum'); if(se) se.textContent = fmt(sumEntr);
    const btnL = document.getElementById('sep-limpiar');
    if(btnL) btnL.style.display=(q||desde||hasta||estadoVista)?'inline-flex':'none';
    return;
  }

  document.getElementById('separados-content').innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;min-width:180px;max-width:280px;margin:0">
        <span class="search-icon">🔍</span>
        <input type="text" id="sep-search" placeholder="Cliente, comprobante, tel, ref..." value="${q}" oninput="renderSeparados()">
      </div>
      <div><label class="form-label" style="font-size:9px;color:var(--text2);display:block;margin-bottom:3px">Estado</label>
      <select class="form-control" id="sep-estado" style="width:130px" onchange="renderSeparados()">
        <option value="" ${estadoVista===''?'selected':''}>Todos</option>
        <option value="pend" ${estadoVista==='pend'?'selected':''}>Pendientes</option>
        <option value="entr" ${estadoVista==='entr'?'selected':''}>Entregados</option>
      </select></div>
      <input type="date" class="form-control" id="sep-desde" style="width:140px" value="${desde}" onchange="renderSeparados()">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="sep-hasta" style="width:140px" value="${hasta}" onchange="renderSeparados()">
      <button class="btn btn-xs btn-secondary" id="sep-limpiar" style="display:${(q||desde||hasta||estadoVista)?'inline-flex':'none'}"
        onclick="document.getElementById('sep-search').value='';document.getElementById('sep-desde').value='';document.getElementById('sep-hasta').value='';document.getElementById('sep-estado').value='';renderSeparados()">✕ Limpiar</button>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card" style="margin:0;text-align:center">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--yellow)" id="sep-pend">${pendientes.length}</div>
        <div style="font-size:11px;color:var(--text2)">⏳ Pendientes de entrega</div>
        <div style="font-size:12px;color:var(--accent);font-weight:700;margin-top:6px" id="sep-pend-sum">${fmt(sumPend)}</div>
      </div>
      <div class="card" style="margin:0;text-align:center">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--green)" id="sep-entr">${entregados.length}</div>
        <div style="font-size:11px;color:var(--text2)">✅ Entregados (rango / búsqueda)</div>
        <div style="font-size:12px;color:var(--accent);font-weight:700;margin-top:6px" id="sep-entr-sum">${fmt(sumEntr)}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">🛍️ SEPARADOS (${lista.length} en tabla · ${separados.length} con filtros)</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Canal</th><th>Ref</th><th>Cliente</th><th>Comprobante</th><th>Teléfono</th><th>Artículos</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead>
        <tbody id="sep-tbody">${rowsHtml}</tbody>
      </table></div>
    </div>`;
}


async function entregarSeparado(id) {
  if (window.AppSeparadosModule?.entregarSeparado) {
    return window.AppSeparadosModule.entregarSeparado({ state, id, confirm, saveRecord, renderSeparados, notify });
  }
  if(!confirm('¿El cliente ya recogió? Se marcará como entregado.')) return;
  const v = state.ventas.find(x => x.id === id);
  if(!v) return;
  v.estadoEntrega = 'Entregado';
  v.fechaHoraEntrega = new Date().toISOString();
  let ok=false; try { ok = (await saveRecord('ventas', v.id, v)) !== false; } catch(e) { ok=false; }
  renderSeparados();
  if(ok) notify('success','📦','¡Entregado!',`${v.cliente||'Cliente'} — ${v.desc||''}`,{duration:3000});
  else notify('warning','📡','Sin sincronizar','Revisa conexión Supabase.',{duration:5000});
}


// ===================================================================
// ===== INICIALIZACIÓN DEL SISTEMA =====
// ===================================================================

let _erpSessionBootstrapped = false;
/** True mientras el usuario debe definir contraseña nueva (enlace “Olvidé mi contraseña”). */
let _erpRecoveryPending = false;

function erpShowRecoveryUi() {
  _erpRecoveryPending = true;
  const rec = document.getElementById('erp-recovery-overlay');
  const overlay = document.getElementById('erp-login-overlay');
  if (rec) rec.style.display = 'flex';
  if (overlay) overlay.style.display = 'none';
}

function erpHideRecoveryUi() {
  const rec = document.getElementById('erp-recovery-overlay');
  if (rec) rec.style.display = 'none';
}

async function erpFinishRecoveryAndLoad() {
  _erpRecoveryPending = false;
  erpHideRecoveryUi();
  try {
    const path = window.location.pathname + window.location.search;
    window.history.replaceState({}, document.title, path);
  } catch (_) {
    /* noop */
  }
  const overlay = document.getElementById('erp-login-overlay');
  if (overlay) overlay.style.display = 'none';
  if (!_erpSessionBootstrapped) {
    _erpSessionBootstrapped = true;
    await loadState();
  }
}

async function erpSignOut() {
  try {
    await supabaseClient.auth.signOut();
  } catch (e) {
    console.error(e);
  }
  location.reload();
}
window.erpSignOut = erpSignOut;

/** URL base para enlaces de Auth (debe estar en Supabase → Redirect URLs). */
function erpAuthRedirectBaseUrl() {
  try {
    const u = new URL(window.location.href);
    u.hash = '';
    return u.toString();
  } catch (_) {
    return window.location.origin + window.location.pathname + window.location.search;
  }
}

/** Sesión creada por enlace “olvidé contraseña” (JWT amr incluye recovery). */
function erpJwtIsRecoverySession(session) {
  if (!session?.access_token) return false;
  try {
    const part = session.access_token.split('.')[1];
    if (!part) return false;
    const padLen = (4 - (part.length % 4)) % 4;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
    const payload = JSON.parse(atob(b64));
    const amr = payload.amr;
    if (!Array.isArray(amr)) return false;
    return amr.some((entry) => {
      if (typeof entry === 'string') return entry === 'recovery';
      if (entry && typeof entry === 'object') return entry.method === 'recovery';
      return false;
    });
  } catch (_) {
    return false;
  }
}

window.onload = async () => {
  const overlay = document.getElementById('erp-login-overlay');
  const form = document.getElementById('erp-login-form');
  const errEl = document.getElementById('erp-login-error');
  const submitBtn = document.getElementById('erp-login-submit');
  const loginView = document.getElementById('erp-login-view');
  const forgotView = document.getElementById('erp-forgot-view');
  const forgotForm = document.getElementById('erp-forgot-form');
  const forgotErr = document.getElementById('erp-forgot-error');
  const forgotOk = document.getElementById('erp-forgot-success');
  const forgotSubmit = document.getElementById('erp-forgot-submit');
  const recoveryForm = document.getElementById('erp-recovery-form');
  const recoveryErr = document.getElementById('erp-recovery-error');
  const recoverySubmit = document.getElementById('erp-recovery-submit');

  try {
    if (window.__HERA_RECOVERY_PENDING === true) _erpRecoveryPending = true;
    if (window.location.hash && /type=recovery/i.test(window.location.hash)) _erpRecoveryPending = true;
    if (window.location.search && /type=recovery/i.test(window.location.search)) _erpRecoveryPending = true;
  } catch (_) {
    /* noop */
  }

  document.getElementById('erp-forgot-show')?.addEventListener('click', () => {
    if (loginView) loginView.style.display = 'none';
    if (forgotView) forgotView.style.display = 'block';
    if (forgotErr) {
      forgotErr.style.display = 'none';
      forgotErr.textContent = '';
    }
    if (forgotOk) {
      forgotOk.style.display = 'none';
      forgotOk.textContent = '';
    }
    const fe = document.getElementById('erp-forgot-email');
    const le = document.getElementById('erp-login-email');
    if (fe && le && le.value) fe.value = le.value;
  });

  document.getElementById('erp-forgot-back')?.addEventListener('click', () => {
    if (forgotView) forgotView.style.display = 'none';
    if (loginView) loginView.style.display = 'block';
    if (forgotErr) {
      forgotErr.style.display = 'none';
      forgotErr.textContent = '';
    }
    if (forgotOk) {
      forgotOk.style.display = 'none';
      forgotOk.textContent = '';
    }
  });

  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (document.getElementById('erp-forgot-email')?.value || '').trim();
      if (forgotErr) {
        forgotErr.style.display = 'none';
        forgotErr.textContent = '';
      }
      if (forgotOk) {
        forgotOk.style.display = 'none';
        forgotOk.textContent = '';
      }
      if (!email) {
        if (forgotErr) {
          forgotErr.textContent = 'Ingresa tu correo.';
          forgotErr.style.display = 'block';
        }
        return;
      }
      if (forgotSubmit) forgotSubmit.disabled = true;
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: erpAuthRedirectBaseUrl(),
      });
      if (forgotSubmit) forgotSubmit.disabled = false;
      if (error) {
        if (forgotErr) {
          forgotErr.textContent = error.message || 'No se pudo enviar el enlace';
          forgotErr.style.display = 'block';
        }
        return;
      }
      if (forgotOk) {
        forgotOk.textContent =
          'Si ese correo está registrado, recibirás un enlace en unos minutos. Revisa spam.';
        forgotOk.style.display = 'block';
      }
    });
  }

  supabaseClient.auth.onAuthStateChange(async (event, sess) => {
    if (event === 'SIGNED_OUT') {
      location.reload();
      return;
    }
    if (event === 'PASSWORD_RECOVERY') {
      erpShowRecoveryUi();
      return;
    }
    if (event === 'INITIAL_SESSION' && sess && erpJwtIsRecoverySession(sess)) {
      erpShowRecoveryUi();
      return;
    }
    if (event === 'SIGNED_IN' && sess) {
      if (erpJwtIsRecoverySession(sess)) {
        erpShowRecoveryUi();
        return;
      }
      if (!_erpSessionBootstrapped && !_erpRecoveryPending) {
        _erpSessionBootstrapped = true;
        if (overlay) overlay.style.display = 'none';
        await loadState();
      }
    }
  });

  if (recoveryForm) {
    recoveryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = document.getElementById('erp-recovery-p1')?.value || '';
      const p2 = document.getElementById('erp-recovery-p2')?.value || '';
      if (recoveryErr) {
        recoveryErr.style.display = 'none';
        recoveryErr.textContent = '';
      }
      if (p1.length < 6) {
        if (recoveryErr) {
          recoveryErr.textContent = 'La contraseña debe tener al menos 6 caracteres.';
          recoveryErr.style.display = 'block';
        }
        return;
      }
      if (p1 !== p2) {
        if (recoveryErr) {
          recoveryErr.textContent = 'Las contraseñas no coinciden.';
          recoveryErr.style.display = 'block';
        }
        return;
      }
      if (recoverySubmit) recoverySubmit.disabled = true;
      const { error } = await supabaseClient.auth.updateUser({ password: p1 });
      if (recoverySubmit) recoverySubmit.disabled = false;
      if (error) {
        if (recoveryErr) {
          recoveryErr.textContent = error.message || 'No se pudo actualizar la contraseña';
          recoveryErr.style.display = 'block';
        }
        return;
      }
      await erpFinishRecoveryAndLoad();
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (document.getElementById('erp-login-email')?.value || '').trim();
      const password = document.getElementById('erp-login-password')?.value || '';
      if (errEl) {
        errEl.style.display = 'none';
        errEl.textContent = '';
      }
      if (submitBtn) submitBtn.disabled = true;
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (submitBtn) submitBtn.disabled = false;
      if (error) {
        if (errEl) {
          errEl.textContent = error.message || 'No se pudo iniciar sesión';
          errEl.style.display = 'block';
        }
        return;
      }
      if (overlay) overlay.style.display = 'none';
      if (!_erpSessionBootstrapped) {
        _erpSessionBootstrapped = true;
        await loadState();
      }
    });
  }

  const { data: { session } } = await supabaseClient.auth.getSession();

  const mustSetPassword =
    _erpRecoveryPending || (session && erpJwtIsRecoverySession(session));

  if (mustSetPassword) {
    if (session) {
      erpShowRecoveryUi();
    } else if (_erpRecoveryPending) {
      erpShowRecoveryUi();
      if (recoveryErr) {
        recoveryErr.textContent =
          'No se pudo validar el enlace. Pedí otro desde “Olvidé mi contraseña” o revisá que la URL esté en Redirect URLs de Supabase.';
        recoveryErr.style.display = 'block';
      }
    }
    return;
  }

  if (session) {
    if (overlay) overlay.style.display = 'none';
    _erpSessionBootstrapped = true;
    await loadState();
  } else {
    if (overlay) overlay.style.display = 'flex';
  }
};


