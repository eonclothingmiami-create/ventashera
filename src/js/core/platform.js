// ===================================================================
// ===== CREDENCIALES & CONEXIÓN =====
// ===================================================================

const SUPABASE_URL = 'https://niilaxdeetuzutycvdkz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paWxheGRlZXR1enV0eWN2ZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjc0NjIsImV4cCI6MjA4ODk0MzQ2Mn0.GI8E7vRzxi5NumN_f4T432Lx4BcmgGLZo81BR9h3h8c';

// Inicializar Supabase
// Init Supabase client safely
var supabaseClient;
(function() {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
  try {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
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
      visible: articulo.mostrarEnWeb !== false ? true : false,
      stock: Math.max(0, getArticuloStock(articulo.id) || 0),
      sku: articulo.codigo || '',
      createdAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString()
    };

    // 2. Revisar duplicidad por referencia
    const existing = await supabaseCall('GET', 'products', null, null, { ref: articulo.codigo });

    if (existing && existing.length > 0) {
      // PATCH (No sobrescribe todo)
      await supabaseCall('PATCH', 'products', productData, existing[0].id);
      return { success: true, action: 'update', id: existing[0].id };
    } else {
      // POST (Creación Nueva)
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
        mostrarEnWeb: p.visible !== false,
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
  currentMonth: null,
  game: { xp:0, streakMax:0, earnedBadges:[], claimedSnacks:{} },
  rewards: {}, 
  notifEnabled: false, 
  notifHour: 21,
  articulos: [],        
  bodegas: [{id:'bodega_main',name:'Bodega Principal',ubicacion:'Local'},{id:'bodega_vitrina',name:'Vitrina',ubicacion:'Vitrina'}],
  inv_movimientos: [],   
  inv_ajustes: [],        
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
  cajas: [{id:'caja_principal',nombre:'Caja Principal',saldo:0,estado:'abierta',apertura:null,bodegaIds:[],saldosMetodo:{efectivo:0,transferencia:0,addi:0,contraentrega:0,tarjeta:0,digital:0,otro:0}}],
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
  tes_devoluciones_prov: [],
  tes_ajustes_unidades_prov: [],
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

let posFormState = { 
  canal: 'vitrina', empresa: '', transportadora: '', guia: '', ciudad: '', 
  comprobante: '', cliente: '', telefono: '', metodo: 'efectivo', cuenta: '', applyIva: false, applyFlete: false, flete: 0,
  tipoPago: 'contado'
};
const CUENTAS_BANCARIAS = ['Nequi','Bancolombia','Daviplata','Bancolombia 2'];
try { window.CUENTAS_BANCARIAS = CUENTAS_BANCARIAS; } catch (e) {}
let histFilters = { canal: '', cat: '', start: '', end: '' };
let _tempGaleria = []; let _portadaIndex = 0;
  let _tempLogoBase64 = null; // Almacena el logo procesado para 80mm

// ===== CONSTANTS =====
const LEVELS=[{level:1,name:'Novata',avatar:'🌱',minXp:0},{level:2,name:'Activa',avatar:'✨',minXp:200},{level:3,name:'Vendedora',avatar:'💫',minXp:500},{level:4,name:'Destacada',avatar:'🌟',minXp:1000},{level:5,name:'Pro',avatar:'⚡',minXp:1800},{level:6,name:'Experta',avatar:'🔥',minXp:3000},{level:7,name:'Campeona',avatar:'💎',minXp:4500},{level:8,name:'Leyenda',avatar:'👑',minXp:6500},{level:9,name:'Élite',avatar:'🏆',minXp:9000},{level:10,name:'Mega Vendedora',avatar:'🚀',minXp:12000}];
const BADGES=[{id:'primera_venta',icon:'🎯',name:'Primera Venta',desc:'Registra tu primera venta'},{id:'racha3',icon:'🔥',name:'Racha x3',desc:'3 días consecutivos con ≥5 despachos'},{id:'racha7',icon:'🌊',name:'Racha x7',desc:'7 días seguidos con ≥5 despachos'},{id:'racha14',icon:'⚡',name:'Racha x14',desc:'14 días seguidos con ≥5 despachos'},{id:'meta25',icon:'📈',name:'25% Meta',desc:'Alcanza 25% de la meta mensual'},{id:'meta50',icon:'🎯',name:'Mitad Meta',desc:'Alcanza el 50% de la meta mensual'},{id:'meta75',icon:'🔝',name:'75% Meta',desc:'Alcanza el 75% de la meta mensual'},{id:'meta100',icon:'🏆',name:'¡Meta!',desc:'¡Alcanzas la meta mensual!'},{id:'super',icon:'💥',name:'Súper Meta',desc:'Superas $40M en el mes'},{id:'v20',icon:'📦',name:'20 Ventas',desc:'20 ventas en el mes'},{id:'v50',icon:'🛵',name:'50 Ventas',desc:'50 ventas en el mes'},{id:'v100',icon:'💯',name:'100 Ventas',desc:'100 ventas en el mes'},{id:'v150',icon:'🚀',name:'150 Ventas',desc:'150 ventas en el mes'},{id:'gran_venta',icon:'💵',name:'Gran Venta',desc:'Una venta mayor a $500k'},{id:'multicanal',icon:'🌐',name:'Multicanal',desc:'Ventas en los 3 canales el mismo día'},{id:'nivel5',icon:'⭐',name:'Nivel 5',desc:'Alcanza el nivel Pro'},{id:'nivel8',icon:'🌟',name:'Nivel 8',desc:'Alcanza el nivel Leyenda'}];
const MISSIONS_LADDER=[5,10,20,30,40,50,65,80,100,120,150];
const SNACKS=[{id:'bonyourt',name:'Bonyourt',emoji:'🥤'},{id:'bimbo',name:'Bimbo',emoji:'🍞'},{id:'turron',name:'Turrón',emoji:'🍬'},{id:'refrigerio',name:'Refrigerio',emoji:'🧃'},{id:'paleta',name:'Paleta',emoji:'🍫'},{id:'chocono',name:'Chocono',emoji:'🍦'},{id:'galleta',name:'Galletas',emoji:'🍪'},{id:'churro',name:'Churro',emoji:'🥐'},{id:'panpizza',name:'Pan Pizza',emoji:'🍕'},{id:'empanada',name:'Empanada',emoji:'🥙'},{id:'bunuelo',name:'Buñuelo',emoji:'🫓'},{id:'pollo',name:'Pollo',emoji:'🍗'},{id:'chocoramo',name:'Chocoramo',emoji:'🍫'},{id:'doritos',name:'Doritos',emoji:'🌮'}];
const SNACK_XP_GOAL=100;
const REWARDS=[{id:'meta_mes',icon:'🍽️',name:'Almuerzo con el Jefe',desc:'Alcanza los $34M de meta mensual',condition:s=>ventasMes(s).totalDespachos>0&&ventasMes(s).totalCOP>=s.meta},{id:'dia_millon',icon:'💵',name:'Bonificación $100k',desc:'Un día con $1M+ en despachos',condition:s=>hasDiaUnMillon(s)},{id:'super_meta',icon:'👑',name:'Segundo Almuerzo',desc:'Supera los $40M en el mes',condition:s=>ventasMes(s).totalCOP>=40000000}];

// ===== HELPERS =====
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
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
function addBusinessDays(dateStr,days){const d=new Date(dateStr+'T12:00:00');let added=0;while(added<days){d.setDate(d.getDate()+1);const dow=d.getDay();if(dow!==0&&dow!==6)added++;}return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function daysDiff(dateStr){const d1=new Date(today()+'T00:00:00');const d2=new Date(dateStr+'T00:00:00');return Math.round((d2-d1)/86400000)}
function ventasMes(s){const active=(s.ventas||[]).filter(v=>!v.archived);const despachos=active.filter(v=>v.canal!=='vitrina');const vitrina=active.filter(v=>v.canal==='vitrina');const local=active.filter(v=>v.canal==='local');const inter=active.filter(v=>v.canal==='inter');const totalCOP=despachos.reduce((a,v)=>a+v.valor,0);return{active,despachos,vitrina,local,inter,totalDespachos:despachos.length,totalCOP,vitrineTotal:vitrina.reduce((a,v)=>a+v.valor,0),localTotal:local.reduce((a,v)=>a+v.valor,0),interTotal:inter.reduce((a,v)=>a+v.valor,0),totalAll:active.reduce((a,v)=>a+v.valor,0)}}
function hasDiaUnMillon(s){const active=(s.ventas||[]).filter(v=>!v.archived&&v.canal!=='vitrina');const byDay={};active.forEach(v=>{byDay[v.fecha]=(byDay[v.fecha]||0)+v.valor});return Object.values(byDay).some(t=>t>=1000000)}
function calcLevel(xp){let lv=LEVELS[0];for(const l of LEVELS){if(xp>=l.minXp)lv=l}return lv}
function calcLevelProgress(xp){const lv=calcLevel(xp);const idx=LEVELS.indexOf(lv);if(idx>=LEVELS.length-1)return{lv,next:null,pct:100,xpToNext:0};const next=LEVELS[idx+1];const pct=Math.min(100,((xp-lv.minXp)/(next.minXp-lv.minXp))*100);return{lv,next,pct,xpToNext:next.minXp-xp}}
function calcStreak(){const active=(state.ventas||[]).filter(v=>!v.archived&&v.canal!=='vitrina');const byDay={};active.forEach(v=>{byDay[v.fecha]=(byDay[v.fecha]||0)+1});let streak=0;const d=new Date(today()+'T12:00:00');while(true){const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;if((byDay[ds]||0)>=5){streak++;d.setDate(d.getDate()-1)}else break}return streak}
function calcXP(canal,valor){
  const g=state.cfg_game||{};
  if(canal==='vitrina')return Math.floor(valor/(g.xp_por_venta_vitrina||150000));
  if(canal==='local')return Math.max(8,Math.floor(valor/(g.xp_por_venta_local||25000)*1.2));
  if(canal==='inter')return Math.max(10,Math.floor(valor/(g.xp_por_venta_inter||20000)*1.4));
  return 0;
}
function getISOWeek(date){const d=new Date(date);d.setHours(0,0,0,0);d.setDate(d.getDate()+4-(d.getDay()||7));const yearStart=new Date(d.getFullYear(),0,1);return{week:Math.ceil((((d-yearStart)/86400000)+1)/7),year:d.getFullYear()}}
function getWeekSnack(){const{week,year}=getISOWeek(new Date());const hash=Math.abs((week*31+year*7+week*year)%SNACKS.length);return{snack:SNACKS[hash],week,year}}
function getWeekXP(){const now=new Date();const dow=now.getDay()||7;const monday=new Date(now);monday.setDate(now.getDate()-dow+1);monday.setHours(0,0,0,0);const active=(state.ventas||[]).filter(v=>!v.archived);let xp=0;active.forEach(v=>{const vDate=new Date(v.fecha+'T12:00:00');if(vDate>=monday)xp+=calcXP(v.canal,v.valor)});return xp}
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
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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

async function loadState() {
  showLoadingOverlay('connecting');
  try {
    const [
      {data:products}, {data:mediaRows}, {data:_cust},
      {data:employees}, {data:ventas}, {data:cajas},
      {data:tesMov}, {data:nomNominas}, {data:nomAusencias},
      {data:nomAnticipos}, {data:invAjustes}, {data:invTraslados},
      {data:bodegas}, {data:configs},       {data:proveedores}, {data:facturas},
      {data:abonosProv},
      {data:compromisosProv}
    ] = await Promise.all([
      supabaseClient.from('products').select('*'),
      supabaseClient.from('product_media').select('product_id,url,is_cover'),
      Promise.resolve({data:[]}), // customers cargados por separado (paginado)
      supabaseClient.from('employees').select('*'),
      supabaseClient.from('ventas').select('*'),
      supabaseClient.from('cajas').select('*'),
      supabaseClient.from('tes_movimientos').select('*'),
      supabaseClient.from('nom_nominas').select('*'),
      supabaseClient.from('nom_ausencias').select('*'),
      supabaseClient.from('nom_anticipos').select('*'),
      supabaseClient.from('inv_ajustes').select('*'),
      supabaseClient.from('inv_traslados').select('*'),
      supabaseClient.from('bodegas').select('*'),
      supabaseClient.from('state_config').select('*'),
      supabaseClient.from('proveedores').select('*'),
      supabaseClient.from('invoices').select('*'),
      supabaseClient.from('tes_abonos_prov').select('*'),
      supabaseClient.from('tes_compromisos_prov').select('*')
    ]);

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
      return {id:p.id,codigo:p.ref||'',ref:p.ref||'',nombre:p.name||'',name:p.name||'',
        categoria:p.categoria||'',seccion:p.seccion||'',cat:p.categoria||'',
        descripcion:p.description||'',precioVenta:parseFloat(p.price)||0,price:parseFloat(p.price)||0,
        precioCompra:parseFloat(p.cost)||0,
        tallas:tallasArr.join(', '),sizes:tallasArr.join(', '),
        colors:coloresArr,colores:coloresArr.join(', '),
        images:imgs,imagen:cover?cover.url:(imgs[0]||''),
        stock:p.stock||0,stockMinimo:p.stock_min||0,
        activo:p.active!==false,mostrarEnWeb:p.visible!==false,supabaseId:p.id,
        tituloMercancia:p.titulo_mercancia||'',proveedorId:p.proveedor_id||null,proveedorNombre:p.proveedor_nombre||''};
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
      transportadora:v.transportadora||'',ciudad:v.ciudad||'',
      liquidado:v.liquidado||false,fechaLiquidacion:v.fecha_liquidacion,
      esSeparado:v.es_separado||false,esContraEntrega:v.es_contraentrega||false,
      tipoPago:v.tipo_pago||'contado',
      estadoEntrega:v.estado_entrega||'Pendiente',
      fechaHoraEntrega:v.fecha_hora_entrega||null,
      desc:v.referencia||'',metodoPago:v.metodo_pago||'efectivo',archived:v.archived||false}));

    // Facturas
    state.facturas = (facturas||[]).map(f=>({
      id:             f.id,
      numero:         f.number||'',
      fecha:          f.fecha || (f.created_at ? f.created_at.split('T')[0] : today()),
      cliente:        f.customer_name||'',
      telefono:       f.customer_phone||'',
      total:          parseFloat(f.total)||0,
      subtotal:       parseFloat(f.subtotal)||0,
      iva:            parseFloat(f.iva)||0,
      flete:          parseFloat(f.flete)||0,
      canal:          f.canal||'vitrina',
      metodo:         f.metodo_pago||'efectivo',
      estado:         f.estado||'pagada',
      tipo:           f.tipo||'pos',
      guia:           f.guia||'',
      empresa:        f.empresa||'',
      transportadora: f.transportadora||'',
      ciudad:         f.ciudad||'',
      esSeparado:     f.es_separado||false,
      tipoPago:       f.tipo_pago||'contado',
      items:          (() => { try { return typeof f.items === 'string' ? JSON.parse(f.items) : (f.items||[]); } catch(e) { return []; } })()
    }));

    state.tes_abonos_prov = (abonosProv||[]).map(ab=>({id:ab.id,proveedorId:ab.proveedor_id,
      proveedorNombre:ab.proveedor_nombre||'',valor:parseFloat(ab.valor)||0,
      metodo:ab.metodo||'',fecha:ab.fecha,nota:ab.nota||'',fechaCreacion:ab.fecha}));

    state.tes_compromisos_prov = (compromisosProv || []).map((c) => ({
      id: c.id,
      proveedorId: c.proveedor_id,
      proveedorNombre: c.proveedor_nombre || '',
      valor: parseFloat(c.valor) || 0,
      fecha: c.fecha,
      nota: c.nota || '',
      referencia: c.referencia || ''
    }));

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
          fechaHora: r.fecha_hora
        }));
      }
    } catch (e) {
      console.warn('tes_ajustes_unidades_prov:', e.message);
    }

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
    state.tes_movimientos = (tesMov||[]).map(m=>({id:m.id,cajaId:m.caja_id,tipo:m.tipo,valor:parseFloat(m.valor)||0,concepto:m.concepto||'',fecha:m.fecha,metodo:m.metodo||'efectivo',categoria:m.categoria||'',bucket:m.bucket||'',sesionId:m.sesion_id||null}));

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
    } catch (e) { console.warn('tes_cierres_caja:', e.message); }

    // Nómina
    state.nom_nominas = (nomNominas||[]).map(n=>({id:n.id,numero:n.numero,empleado:n.empleado_nombre,periodo:n.periodo,salario:parseFloat(n.salario_base)||0,devengado:parseFloat(n.devengado)||0,deducciones:parseFloat(n.deducciones)||0,neto:parseFloat(n.neto)||0,detalles:n.detalles||[],pagada:n.pagada||false,fecha:n.fecha}));
    state.nom_ausencias = (nomAusencias||[]).map(a=>({id:a.id,empleado:a.empleado_nombre,tipo:a.tipo,desde:a.desde,hasta:a.hasta,dias:a.dias||0,observaciones:a.observaciones||'',aprobada:a.aprobada||false}));
    state.nom_anticipos = (nomAnticipos||[]).map(a=>({id:a.id,empleado:a.empleado_nombre,valor:parseFloat(a.valor)||0,motivo:a.motivo||'',fecha:a.fecha}));

    // Inventario - reconstruir movimientos
    state.inv_ajustes = (invAjustes||[]).map(a=>({id:a.id,articuloId:a.articulo_id,bodegaId:a.bodega_id,tipo:a.tipo,cantidad:a.cantidad,motivo:a.motivo||'',fecha:a.fecha}));
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
    ['fb-status-dot','fb-status-dot-mobile'].forEach(id=>{const el=document.getElementById(id);if(el){el.style.background='#22c55e';el.title='Conectado a Supabase';}});
    checkMonthReset();
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
  'ventas':          { table:'ventas', mapFn:(d)=>({id:d.id,fecha:d.fecha,canal:d.canal,valor:d.valor,cliente:d.cliente||'',telefono:d.telefono||'',guia:d.guia||'',empresa:d.empresa||'',transportadora:d.transportadora||'',ciudad:d.ciudad||'',liquidado:d.liquidado||false,fecha_liquidacion:d.fechaLiquidacion||null,es_separado:d.esSeparado||false,es_contraentrega:d.esContraEntrega||false,tipo_pago:d.tipoPago||'contado',estado_entrega:d.estadoEntrega||'Pendiente',fecha_hora_entrega:d.fechaHoraEntrega!=null?d.fechaHoraEntrega:null,referencia:d.desc||'',metodo_pago:d.metodoPago||'efectivo',archived:d.archived||false}) },
  'facturas':        { table:'invoices', mapFn:(d)=>({id:d.id,number:d.numero||'',customer_name:d.cliente||'',customer_phone:d.telefono||'',total:d.total||0}) },
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
  'tes_movimientos': { table:'tes_movimientos', mapFn:(d)=>({id:d.id,caja_id:d.cajaId||null,tipo:d.tipo||'',valor:d.valor||0,concepto:d.concepto||'',fecha:d.fecha||null,metodo:d.metodo||'efectivo',categoria:d.categoria||null,bucket:d.bucket||null,sesion_id:d.sesionId||null}) },
  'tes_cierres_caja': { table:'tes_cierres_caja', mapFn:(d)=>({
    id:d.id,
    caja_id:d.cajaId,
    caja_nombre:d.cajaNombre||'',
    fecha_cierre:d.fechaCierre||today(),
    libro_efectivo:d.libroEfectivo||0,
    libro_transferencia:d.libroTransferencia||0,
    contado_efectivo:d.contadoEfectivo||0,
    declarado_bancos:d.declaradoBancos||0,
    dif_efectivo:d.difEfectivo||0,
    dif_transferencia:d.difTransferencia||0,
    resultado_efectivo:d.resultadoEfectivo||'',
    nota:d.nota||'',
    saldos_libro_json:d.saldosLibroJson||d.saldos_libro_json||null
  }) },
  'nom_nominas':     { table:'nom_nominas', mapFn:(d)=>({id:d.id,numero:d.numero||'',empleado_nombre:d.empleado||'',periodo:d.periodo||'',salario_base:d.salario||0,devengado:d.devengado||0,deducciones:d.deducciones||0,neto:d.neto||0,detalles:d.detalles||[],pagada:d.pagada||false,fecha:d.fecha||null}) },
  'nom_ausencias':   { table:'nom_ausencias', mapFn:(d)=>({id:d.id,empleado_nombre:d.empleado||'',tipo:d.tipo||'',desde:d.desde||null,hasta:d.hasta||null,dias:d.dias||0,observaciones:d.observaciones||'',aprobada:d.aprobada||false,fecha:d.fecha||null}) },
  'nom_anticipos':   { table:'nom_anticipos', mapFn:(d)=>({id:d.id,empleado_nombre:d.empleado||'',valor:d.valor||0,motivo:d.motivo||'',fecha:d.fecha||null}) },
  'inv_ajustes':     { table:'inv_ajustes', mapFn:(d)=>({id:d.id,articulo_id:d.articuloId||null,bodega_id:d.bodegaId||null,tipo:d.tipo||'',cantidad:d.cantidad||0,motivo:d.motivo||'',fecha:d.fecha||null}) },
  'inv_traslados':   { table:'inv_traslados', mapFn:(d)=>({id:d.id,articulo_id:d.articuloId||null,origen_id:d.origenId||null,destino_id:d.destinoId||null,cantidad:d.cantidad||0,nota:d.nota||'',fecha:d.fecha||null}) },
  'usu_clientes':    { table:'customers', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',cedula:d.cedula||null,celular:d.celular||null,telefono:d.telefono||null,whatsapp:d.whatsapp||null,ciudad:d.ciudad||null,direccion:d.direccion||null}) },
  'usu_proveedores': { table:'proveedores', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',cedula:d.cedula||'',tipo_id:d.tipoId||'NIT',celular:d.celular||'',whatsapp:d.whatsapp||'',email:d.email||'',ciudad:d.ciudad||'',departamento:d.departamento||'',direccion:d.direccion||'',tipo_persona:d.tipoPersona||'Natural',observacion:d.observacion||''}) },
  'cfg_categorias':      { table:'cfg_categorias', mapFn:(d)=>({id:d.id,seccion:d.seccion||'',nombre:d.nombre||''}) },
  'cfg_secciones':       { table:'cfg_secciones', mapFn:(d)=>({id:d.id,nombre:d.nombre||''}) },
  'cfg_transportadoras': { table:'cfg_transportadoras', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',activa:d.activa!==false}) },
  'cfg_metodos_pago':    { table:'cfg_metodos_pago', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo:d.tipo||'',activo:d.activo!==false}) },
  'cfg_tarifas':         { table:'cfg_tarifas', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',porcentaje:d.porcentaje||0,descripcion:d.descripcion||''}) },
  'cfg_impuestos':       { table:'cfg_impuestos', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',porcentaje:d.porcentaje||0,tipo:d.tipo||'',activo:d.activo!==false}) },
  'cfg_transportadoras': { table:'cfg_transportadoras', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',activa:d.activa!==false}) },
  'cfg_metodos_pago':    { table:'cfg_metodos_pago', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo:d.tipo||'',activo:d.activo!==false}) },
  'cfg_tarifas':         { table:'cfg_tarifas', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',porcentaje:d.porcentaje||0,descripcion:d.descripcion||''}) },
  'nom_conceptos':       { table:'nom_conceptos_cfg', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo:d.tipo||'devengo',formula:d.formula||'fijo',valor:parseFloat(d.valor)||0}) },
  'bodegas_cfg':         { table:'bodegas', mapFn:(d)=>({id:d.id,nombre:d.name||d.nombre||'',ubicacion:d.ubicacion||''}) },
  'bodegas':             { table:'bodegas', mapFn:(d)=>({id:d.id,nombre:d.name||d.nombre||'',ubicacion:d.ubicacion||''}) },
  'nom_ausencias':       { table:'nom_ausencias', mapFn:(d)=>({id:d.id,empleado_nombre:d.empleado||'',tipo:d.tipo||'',desde:d.desde||null,hasta:d.hasta||null,dias:d.dias||0,observaciones:d.observaciones||'',aprobada:d.aprobada||false,fecha:d.fecha||null}) },
  'nom_anticipos':       { table:'nom_anticipos', mapFn:(d)=>({id:d.id,empleado_nombre:d.empleado||'',valor:d.valor||0,motivo:d.motivo||'',fecha:d.fecha||null}) },
  'nom_conceptos_cfg':   { table:'nom_conceptos_cfg', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo:d.tipo||'devengo',formula:d.formula||'fijo',valor:d.valor||0}) },
  'cfg_transportadoras': { table:'cfg_transportadoras', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',activa:d.activa!==false}) },
  'cfg_metodos_pago':    { table:'cfg_metodos_pago', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo:d.tipo||'',activo:d.activo!==false}) },
  'cfg_tarifas':         { table:'cfg_tarifas', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',porcentaje:d.porcentaje||0,descripcion:d.descripcion||''}) },
  'cfg_impuestos':       { table:'cfg_impuestos', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',porcentaje:d.porcentaje||0,tipo:d.tipo||'',activo:d.activo!==false}) },
  'cfg_transportadoras': { table:'cfg_transportadoras', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',activa:d.activa!==false}) },
  'cfg_metodos_pago':    { table:'cfg_metodos_pago', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo:d.tipo||'',activo:d.activo!==false}) },
  'cfg_tarifas':         { table:'cfg_tarifas', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',porcentaje:d.porcentaje||0,descripcion:d.descripcion||''}) },
  'nom_conceptos':       { table:'nom_conceptos_cfg', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',tipo:d.tipo||'devengo',formula:d.formula||'fijo',valor:parseFloat(d.valor)||0}) },
  'bodegas_cfg':         { table:'bodegas', mapFn:(d)=>({id:d.id,nombre:d.name||d.nombre||'',ubicacion:d.ubicacion||''}) }
};

async function saveRecord(collection, id, data) {
  const mapping = COLLECTION_MAP[collection];
  if(!mapping || !_sbConnected) return;
  try {
    const row = mapping.mapFn(data);
    await supabaseClient.from(mapping.table).upsert(row, {onConflict:'id'});
  } catch(e) { console.warn(`saveRecord [${collection}]:`, e.message); }
}

async function deleteRecord(collection, id) {
  const mapping = COLLECTION_MAP[collection];
  if(!mapping || !_sbConnected) return;
  try {
    await supabaseClient.from(mapping.table).delete().eq('id', id);
  } catch(e) { console.warn(`deleteRecord [${collection}]:`, e.message); }
}

async function saveConfig(key, value) {
  if(!_sbConnected) return;
  try { await supabaseClient.from('state_config').upsert({key, value, updated_at:new Date().toISOString()},{onConflict:'key'}); }
  catch(e) { console.warn('saveConfig:', e.message); }
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
  if(window.innerWidth<=768)closeSidebar();
  document.getElementById('main').scrollTop=0;
}

function renderPage(id){
  const renderers={
    dashboard:renderDashboard, pos:renderPOS, cotizaciones:renderCotizaciones,
    ordenes:renderOrdenes, facturas:renderFacturas, notas_credito:renderNotasCredito,
    notas_debito:renderNotasDebito, remisiones:renderRemisiones, devoluciones:renderDevoluciones,
    anticipos_clientes:renderAnticiposClientes, pendientes:renderPendientes, logistica:renderLogistica, usu_clientes:renderUsuClientes, usu_empleados:renderUsuEmpleados, usu_proveedores:renderUsuProveedores,
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
  const pend=(state.ventas||[]).filter(v=>!v.archived&&v.canal!=='vitrina'&&!v.liquidado);
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
function checkBadges(){const active=(state.ventas||[]).filter(v=>!v.archived);const despachos=active.filter(v=>v.canal!=='vitrina');const vm=ventasMes(state);const pct=vm.totalCOP/state.meta;if(active.length>=1)checkAndAwardBadge('primera_venta');if(despachos.length>=20)checkAndAwardBadge('v20');if(despachos.length>=50)checkAndAwardBadge('v50');if(despachos.length>=100)checkAndAwardBadge('v100');if(despachos.length>=150)checkAndAwardBadge('v150');if(pct>=0.25)checkAndAwardBadge('meta25');if(pct>=0.50)checkAndAwardBadge('meta50');if(pct>=0.75)checkAndAwardBadge('meta75');if(pct>=1.00)checkAndAwardBadge('meta100');if(vm.totalCOP>=40000000)checkAndAwardBadge('super');if(active.some(v=>v.valor>=500000))checkAndAwardBadge('gran_venta');const hoy=today();const todayCanals=new Set(active.filter(v=>v.fecha===hoy).map(v=>v.canal));if(todayCanals.has('vitrina')&&todayCanals.has('local')&&todayCanals.has('inter'))checkAndAwardBadge('multicanal')}

