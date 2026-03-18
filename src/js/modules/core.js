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
      await supabaseCall('DELETE', 'products', null, existing[0].id);
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
  cajas: [{id:'caja_principal',nombre:'Caja Principal',saldo:0,estado:'abierta',apertura:null}],
  tes_movimientos: [],
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
  cliente: '', telefono: '', metodo: 'efectivo', cuenta: '', applyIva: true, applyFlete: false, flete: 0,
  tipoPago: 'contado'
};
const CUENTAS_BANCARIAS = ['Nequi','Bancolombia','Daviplata','Bancolombia 2'];
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
      {data:bodegas}, {data:configs}, {data:proveedores}, {data:facturas},
      {data:abonosProv}
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
      supabaseClient.from('tes_abonos_prov').select('*')
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
      desc:v.referencia||'',metodoPago:v.metodo_pago||'efectivo',archived:v.archived||false}));

    // Facturas
    state.facturas = (facturas||[]).map(f=>({id:f.id,numero:f.number||'',fecha:f.created_at?f.created_at.split('T')[0]:today(),
      cliente:f.customer_name||'',telefono:f.customer_phone||'',total:parseFloat(f.total)||0,estado:'pagada',tipo:'pos'}));

    state.tes_abonos_prov = (abonosProv||[]).map(ab=>({id:ab.id,proveedorId:ab.proveedor_id,
      proveedorNombre:ab.proveedor_nombre||'',valor:parseFloat(ab.valor)||0,
      metodo:ab.metodo||'',fecha:ab.fecha,nota:ab.nota||'',fechaCreacion:ab.fecha}));

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
    if(cajas&&cajas.length>0) state.cajas=cajas.map(c=>({id:c.id,nombre:c.nombre,saldo:parseFloat(c.saldo)||0,estado:c.estado||'abierta',apertura:c.apertura}));

    // Tesorería
    state.tes_movimientos = (tesMov||[]).map(m=>({id:m.id,cajaId:m.caja_id,tipo:m.tipo,valor:parseFloat(m.valor)||0,concepto:m.concepto||'',fecha:m.fecha,metodo:m.metodo||'efectivo'}));

    // Nómina
    state.nom_nominas = (nomNominas||[]).map(n=>({id:n.id,numero:n.numero,empleado:n.empleado_nombre,periodo:n.periodo,salario:parseFloat(n.salario_base)||0,devengado:parseFloat(n.devengado)||0,deducciones:parseFloat(n.deducciones)||0,neto:parseFloat(n.neto)||0,detalles:n.detalles||[],pagada:n.pagada||false,fecha:n.fecha}));
    state.nom_ausencias = (nomAusencias||[]).map(a=>({id:a.id,empleado:a.empleado_nombre,tipo:a.tipo,desde:a.desde,hasta:a.hasta,dias:a.dias||0,observaciones:a.observaciones||'',aprobada:a.aprobada||false}));
    state.nom_anticipos = (nomAnticipos||[]).map(a=>({id:a.id,empleado:a.empleado_nombre,valor:parseFloat(a.valor)||0,motivo:a.motivo||'',fecha:a.fecha}));

    // Inventario - reconstruir movimientos
    state.inv_ajustes = (invAjustes||[]).map(a=>({id:a.id,articuloId:a.articulo_id,bodegaId:a.bodega_id,tipo:a.tipo,cantidad:a.cantidad,motivo:a.motivo||'',fecha:a.fecha}));
    state.inv_traslados = (invTraslados||[]).map(t=>({id:t.id,articuloId:t.articulo_id,origenId:t.origen_id,destinoId:t.destino_id,cantidad:t.cantidad,nota:t.nota||'',fecha:t.fecha}));
    state.inv_movimientos = [];
    state.inv_ajustes.forEach(a=>{state.inv_movimientos.push({id:'aj_'+a.id,articuloId:a.articuloId,bodegaId:a.bodegaId||'bodega_main',cantidad:a.tipo==='entrada'?a.cantidad:-a.cantidad,tipo:'ajuste_'+a.tipo,fecha:a.fecha,referencia:'Ajuste',nota:a.motivo})});
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
  'ventas':          { table:'ventas', mapFn:(d)=>({id:d.id,fecha:d.fecha,canal:d.canal,valor:d.valor,cliente:d.cliente||'',telefono:d.telefono||'',guia:d.guia||'',empresa:d.empresa||'',transportadora:d.transportadora||'',ciudad:d.ciudad||'',liquidado:d.liquidado||false,fecha_liquidacion:d.fechaLiquidacion||null,es_separado:d.esSeparado||false,es_contraentrega:d.esContraEntrega||false,tipo_pago:d.tipoPago||'contado',estado_entrega:d.estadoEntrega||'Pendiente',referencia:d.desc||'',metodo_pago:d.metodoPago||'efectivo',archived:d.archived||false}) },
  'facturas':        { table:'invoices', mapFn:(d)=>({id:d.id,number:d.numero||'',customer_name:d.cliente||'',customer_phone:d.telefono||'',total:d.total||0}) },
  'cajas':           { table:'cajas', mapFn:(d)=>({id:d.id,nombre:d.nombre||'',saldo:d.saldo||0,estado:d.estado||'abierta',apertura:d.apertura||null}) },
  'tes_movimientos': { table:'tes_movimientos', mapFn:(d)=>({id:d.id,caja_id:d.cajaId||null,tipo:d.tipo||'',valor:d.valor||0,concepto:d.concepto||'',fecha:d.fecha||null,metodo:d.metodo||'efectivo'}) },
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
  const ventasHoy=(state.ventas||[]).filter(v=>!v.archived&&v.fecha===hoy&&v.canal!=='vitrina');
  const pendientes=(state.ventas||[]).filter(v=>!v.archived&&v.canal!=='vitrina'&&!v.liquidado).length;
  const totalArticulos=(state.articulos||[]).length;
  const lowStockItems=(state.articulos||[]).filter(a=>{const stock=getArticuloStock(a.id);return stock<=a.stockMinimo}).length;
  const cajaSaldo=(state.cajas||[]).reduce((a,c)=>a+c.saldo,0);
  const earnedBadges=(g.earnedBadges||[]);
  const ultimasVentas=[...(state.ventas||[])].filter(v=>!v.archived).reverse().slice(0,5);

  const despachoHoy=ventasHoy.length;
  const missions=[
    {id:'m1',icon:'⚔️',label:'5 despachos hoy',cur:Math.min(5,despachoHoy),max:5,xp:50},
    {id:'m2',icon:'🛡️',label:'Meta 25% mes',cur:Math.min(100,Math.round(pct)),max:100,xp:100,pctTarget:25,done:pct>=25},
    {id:'m3',icon:'🔥',label:'Racha '+streak+' días',cur:Math.min(7,streak),max:7,xp:75},
    {id:'m4',icon:'💰',label:'Venta > $300k',cur:(state.ventas||[]).filter(v=>!v.archived&&v.fecha===hoy&&v.valor>=300000).length>0?1:0,max:1,xp:60},
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
          <div style="font-size:10px;color:var(--text2);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">⚔️ Misión del Mes</div>
          <div style="font-family:Syne;font-size:22px;font-weight:800">${fmt(vm.totalCOP)} <span style="font-size:13px;color:var(--text2);font-weight:400">de ${fmt(state.meta)}</span></div>
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
      <div style="font-size:11px;color:var(--text2);margin-top:8px">Total con vitrina: ${fmt(vm.totalAll)} · HOY: ${ventasHoy.length} despachos · ${fmt(ventasHoy.reduce((a,v)=>a+v.valor,0))}</div>
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
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--text)">${ventasHoy.length}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">despachos · ${fmt(ventasHoy.reduce((a,v)=>a+v.valor,0))}</div>
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

  <div class="card">
    <div class="card-title">⚡ ÚLTIMAS 5 BATALLAS (VENTAS)</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Canal</th><th>Valor</th><th>Guía</th><th>Estado</th></tr></thead><tbody>
    ${ultimasVentas.map(v=>`<tr>
      <td>${formatDate(v.fecha)}</td>
      <td><span class="badge badge-${v.canal}">${v.canal==='vitrina'?'🏪':v.canal==='local'?'🛵':'📦'} ${v.canal}</span></td>
      <td style="color:var(--accent);font-weight:600">${fmt(v.valor)}</td>
      <td>${v.guia||'—'}</td>
      <td><span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'✓ Liq':'⏳ Pend'}</span></td>
    </tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:24px">Sin ventas</td></tr>'}
    </tbody></table></div>
  </div>`;
}

// ===================================================================
// ===== POS (Point of Sale) =====
// ===================================================================
function syncPOSFormState() {
  const c = document.getElementById('pos-canal'); if(c) posFormState.canal = c.value;
  const e = document.getElementById('pos-empresa'); if(e) posFormState.empresa = e.value;
  const t = document.getElementById('pos-transportadora'); if(t) posFormState.transportadora = t.value;
  const g = document.getElementById('pos-guia'); if(g) posFormState.guia = g.value;
  const ci = document.getElementById('pos-ciudad'); if(ci) posFormState.ciudad = ci.value;
  const cl = document.getElementById('pos-cliente'); if(cl) posFormState.cliente = cl.value;
  const tel = document.getElementById('pos-telefono'); if(tel) posFormState.telefono = tel.value;
  const m = document.getElementById('pos-metodo-pago'); if(m) posFormState.metodo = m.value;
  const cta = document.getElementById('pos-cuenta'); if(cta) posFormState.cuenta = cta.value;
  const iva = document.getElementById('pos-apply-iva'); if(iva) posFormState.applyIva = iva.checked;
  const fleteChk = document.getElementById('pos-apply-flete'); if(fleteChk) posFormState.applyFlete = fleteChk.checked;
  const fleteVal = document.getElementById('pos-flete-valor'); if(fleteVal) posFormState.flete = parseFloat(fleteVal.value)||0;
  const tipoPagoEl = document.getElementById('pos-tipo-pago'); if(tipoPagoEl) posFormState.tipoPago = tipoPagoEl.value;
  // NUEVO: Capturar efectivo recibido
  const montoRec = document.getElementById('pos-monto-recibido'); if(montoRec) posFormState.montoRecibido = parseFloat(montoRec.value) || '';
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
  const cart = state.pos_cart || [];
  const articulos = state.articulos || [];
  
  // Sincroniza el estado del formulario antes de repintar
  syncPOSFormState();

  // CÁLCULOS DE VALORES
  const subtotal = cart.reduce((a, item) => a + (item.precio * item.qty), 0);
  // El IVA es opcional: solo se calcula si applyIva es true
  const iva = posFormState.applyIva ? subtotal * 0.19 : 0;
  const flete = (posFormState.applyFlete && (posFormState.canal==='local'||posFormState.canal==='inter')) ? (posFormState.flete||0) : 0;
  const total = subtotal + iva + flete;

  document.getElementById('pos-content').innerHTML = `
    <div class="pos-layout">
      <div class="pos-products">
        <div class="search-bar">
          <span class="search-icon">🔍</span>
          <input type="text" id="pos-search" placeholder="Buscar artículo o escanear..." oninput="filterPOSProducts()" onkeydown="handlePOSScan(event)">
          <button class="btn btn-sm btn-secondary scanner-btn" onclick="openScannerOverlay()" title="Escanear código de barras">📡</button>
        </div>
        <div class="tabs" id="pos-cat-tabs"></div>
        <div class="product-grid" id="pos-product-grid"></div>
        ${articulos.length === 0 ? `
          <div class="empty-state">
            <div class="es-icon">📋</div>
            <div class="es-title">Sin artículos</div>
            <div class="es-text">Agrega artículos en Inventario → Artículos para empezar a vender.</div>
            <button class="btn btn-primary" style="margin-top:16px" onclick="showPage('articulos')">Ir a Artículos</button>
          </div>` : ''}
      </div>

      <div class="pos-cart">
        <div class="pos-cart-header">
          <span>🛒 Carrito (${cart.length})</span>
          <button class="btn btn-xs btn-danger" onclick="clearPOSCart()">Vaciar</button>
        </div>
        
        <div class="pos-cart-items" id="pos-cart-items">
          ${cart.length === 0 ? 
            '<div style="text-align:center;padding:40px 16px;color:var(--text2)"><div style="font-size:40px;margin-bottom:8px">🛒</div><div style="font-size:12px">Agrega productos al carrito</div></div>' : ''}
          
          ${cart.map((item, i) => `
            <div class="pos-item">
              <div style="flex:1">
                <div style="font-family:Syne; font-size:12px; font-weight:700">${item.nombre}</div>
                <div style="font-size:10px; color:var(--accent2)">Talla: ${item.talla}</div>
                
                <div style="display:flex; align-items:center; gap:4px; margin-top:4px;">
                  <span style="font-size:10px; color:var(--text2)">$</span>
                  <input type="number" 
                         style="width:85px; height:22px; background:var(--bg3); border:1px solid var(--border); color:var(--accent); font-family:'DM Mono'; font-size:11px; padding:0 5px; border-radius:4px;" 
                         value="${item.precio}" 
                         onchange="updatePOSCartPrice(${i}, this.value)">
                  <span style="font-size:10px; color:var(--text2)">c/u</span>
                </div>
              </div>
              
              <div class="pos-item-qty">
                <button onclick="posCartQty(${i},-1)">−</button>
                <span>${item.qty}</span>
                <button onclick="posCartQty(${i},1)">+</button>
              </div>
              
              <div style="font-family:Syne; font-weight:700; color:var(--accent); min-width:70px; text-align:right">
                ${fmt(item.precio * item.qty)}
              </div>
              
              <button class="btn-icon btn-danger" style="font-size:10px; width:24px; height:24px" onclick="posCartRemove(${i})">✕</button>
            </div>`).join('')}
        </div>

        <div class="pos-cart-footer">
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text2); margin-bottom:10px; cursor:pointer;">
            <input type="checkbox" id="pos-apply-iva" ${posFormState.applyIva ? 'checked' : ''} onchange="toggleIVA()"> 
            Aplicar IVA (19%) e Impuestos
          </label>
          ${(posFormState.canal==='local'||posFormState.canal==='inter') ? `
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text2); margin-bottom:6px; cursor:pointer;">
            <input type="checkbox" id="pos-apply-flete" ${posFormState.applyFlete ? 'checked' : ''} onchange="toggleFlete()">
            Aplicar Flete
          </label>
          ${posFormState.applyFlete ? `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:12px;color:var(--text2);white-space:nowrap">$ Flete</span>
            <input type="number" id="pos-flete-valor" class="form-control" style="padding:6px;width:120px" value="${posFormState.flete||0}" min="0" oninput="toggleFlete()">
          </div>` : ''}` : ''}

          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="color:var(--text2);font-size:12px">Subtotal</span>
            <span style="font-size:12px">${fmt(subtotal)}</span>
          </div>
          
          ${posFormState.applyIva ? `
            <div style="display:flex;justify-content:space-between;margin-bottom:6px">
              <span style="color:var(--text2);font-size:12px">IVA (19%)</span>
              <span style="font-size:12px">${fmt(iva)}</span>
            </div>` : ''}

            ${posFormState.applyFlete && posFormState.flete > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-bottom:6px">
              <span style="color:var(--text2);font-size:12px">Flete</span>
              <span style="font-size:12px">${fmt(posFormState.flete)}</span>
            </div>` : ''}
          
          <div style="display:flex;justify-content:space-between;margin-bottom:12px;padding-top:8px;border-top:1px solid var(--border)">
            <span style="font-family:Syne;font-weight:800;font-size:16px">TOTAL</span>
            <span style="font-family:Syne;font-weight:800;font-size:20px;color:var(--accent)">${fmt(total)}</span>
          </div>

          <div class="form-group" style="margin-bottom:10px">
            <select class="form-control" id="pos-canal" onchange="handlePOSShippingUI()" style="padding:8px 12px; background:var(--bg3)">
              <option value="vitrina" ${posFormState.canal === 'vitrina' ? 'selected' : ''}>🏪 Venta Vitrina</option>
              <option value="local" ${posFormState.canal === 'local' ? 'selected' : ''}>🛵 Mensajería Local</option>
              <option value="inter" ${posFormState.canal === 'inter' ? 'selected' : ''}>📦 Intermunicipal</option>
            </select>
          </div>

          <div id="pos-shipping-fields" style="display:${posFormState.canal !== 'vitrina' ? 'flex' : 'none'}; flex-direction:column; gap:8px; margin-bottom:12px; background:var(--bg3); padding:10px; border-radius:10px; border:1px solid var(--border)">
             <select class="form-control" id="pos-empresa" onchange="handlePOSEmpresa()"></select>
             <select class="form-control" id="pos-transportadora" style="display:none">
                <option value="">— Transportadora —</option>
                <option value="TCC" ${posFormState.transportadora === 'TCC' ? 'selected' : ''}>TCC</option>
                <option value="Coordinadora" ${posFormState.transportadora === 'Coordinadora' ? 'selected' : ''}>Coordinadora</option>
                <option value="Envía" ${posFormState.transportadora === 'Envía' ? 'selected' : ''}>Envía</option>
                <option value="Interrapidisimo" ${posFormState.transportadora === 'Interrapidisimo' ? 'selected' : ''}>Inter Rapidísimo</option>
                <option value="Servientrega" ${posFormState.transportadora === 'Servientrega' ? 'selected' : ''}>Servientrega</option>
             </select>
             <input type="text" class="form-control" id="pos-guia" placeholder="Número de Guía" value="${posFormState.guia}">
             <input type="text" class="form-control" id="pos-ciudad" placeholder="Ciudad / Dirección" value="${posFormState.ciudad}">
             <div id="pos-liq-info" style="font-size:10px; color:var(--accent); margin-top:4px"></div>
             <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
               <label style="font-size:10px;color:var(--text2);font-weight:700;display:block;margin-bottom:4px">TIPO DE COBRO</label>
               <select class="form-control" id="pos-tipo-pago" onchange="syncPOSFormState();renderPOS()" style="padding:8px">
                 <option value="contado" ${posFormState.tipoPago==='contado'?'selected':''}>💵 Pago de Contado</option>
                 <option value="contraentrega" ${posFormState.tipoPago==='contraentrega'?'selected':''}>📦 Contra Entrega</option>
               </select>
               ${posFormState.tipoPago==='contraentrega' ? `<div style="font-size:10px;color:var(--yellow);margin-top:4px">⚠️ Se registrará en Cobros Pendientes hasta recibir el pago.</div>` : `<div style="font-size:10px;color:var(--green);margin-top:4px">✅ Pago inmediato — solo se registra en facturas.</div>`}
             </div>
          </div>
${posFormState.metodo === 'efectivo' ? (() => {
              let displayStr = '$0'; let colorStr = 'var(--text2)';
              if (posFormState.montoRecibido) {
                  if (posFormState.montoRecibido >= total) { 
                      displayStr = fmt(posFormState.montoRecibido - total); 
                      colorStr = 'var(--green)'; 
                  } else { 
                      displayStr = 'Faltan ' + fmt(total - posFormState.montoRecibido); 
                      colorStr = 'var(--red)'; 
                  }
              }
              return `
              <div style="background:var(--bg3); padding:12px; border-radius:10px; border:1px dashed var(--border); margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                  <label class="form-label" style="margin:0; font-size:11px;">💵 EFECTIVO RECIBIDO</label>
                  <input type="number" class="form-control" id="pos-monto-recibido" style="width:140px; padding:6px; font-size:14px; font-weight:700; color:var(--green); text-align:right;" placeholder="0" oninput="calcularVuelto(${total})" value="${posFormState.montoRecibido || ''}">
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-size:12px; color:var(--text2); font-weight:700;">CAMBIO / VUELTO</span>
                  <span id="pos-vuelto-display" style="font-family:Syne; font-size:18px; font-weight:800; color:${colorStr};">${displayStr}</span>
                </div>
              </div>`;
          })() : ''}
          <div class="form-group" style="margin-bottom:10px; display:flex; gap:8px;">
            <select class="form-control" id="pos-metodo-pago" style="padding:8px 12px" onchange="renderPOS()">
              ${(state.cfg_metodos_pago && state.cfg_metodos_pago.filter(m=>m.activo!==false).length > 0
                ? state.cfg_metodos_pago.filter(m=>m.activo!==false)
                : [{id:'efectivo',nombre:'💵 Efectivo'},{id:'tarjeta',nombre:'💳 Tarjeta'},{id:'transferencia',nombre:'📱 Transferencia'},{id:'addi',nombre:'💜 Addi'},{id:'mixto',nombre:'🔄 Mixto'}]
              ).map(m=>`<option value="${m.id}" ${posFormState.metodo===m.id?'selected':''}>${m.nombre}</option>`).join('')}
            </select>
            ${posFormState.metodo === 'transferencia' ? `
            <select class="form-control" id="pos-cuenta" style="padding:8px 12px">
              ${(window.CUENTAS_BANCARIAS||[]).map(c => `<option value="${c}" ${posFormState.cuenta === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>` : ''}
          </div>

          <div class="form-row" style="gap:8px; margin-bottom:8px">
            <input type="text" class="form-control" id="pos-cedula" placeholder="🔍 Cédula o Celular (Buscar)" style="padding:8px 12px; font-weight:bold; color:var(--accent)" onblur="autocompletarCliente(this)">
          </div>
          <div class="form-row" style="gap:8px; margin-bottom:10px">
            <input type="text" class="form-control" id="pos-cliente" placeholder="Cliente (opcional)" style="padding:8px 12px" value="${posFormState.cliente}">
            <input type="tel" class="form-control" id="pos-telefono" placeholder="Teléfono (opcional)" style="padding:8px 12px" value="${posFormState.telefono}">
          </div>

<div class="form-group" style="margin-top: 15px; margin-bottom: 15px; background: #f8f9fa; padding: 10px; border-radius: 8px; border: 1px dashed var(--accent);">
  <label style="cursor: pointer; display: flex; align-items: center; gap: 10px; font-weight: bold; color: var(--accent);">
    <input type="checkbox" id="pos-es-separado" style="width: 20px; height: 20px;">
    🛍️ ES UN SEPARADO (Stand By en el local)
  </label>
</div>

          <button class="btn btn-primary" style="width:100%" onclick="procesarVentaPOS()" ${cart.length === 0 ? 'disabled' : ''}>💰 Cobrar ${fmt(total)}</button>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-secondary btn-sm" style="flex:1" onclick="previewReceipt()">🧾 Vista Previa</button>
            <button class="btn btn-secondary btn-sm" style="flex:1" onclick="openCashDrawer()">🏧 Abrir Cajón</button>
          </div>
        </div>
      </div>
    </div>`;

  // Renderizado de componentes secundarios
  renderPOSProductGrid();
  renderPOSCategoryTabs();
  handlePOSShippingUI();
}

/** * NUEVAS FUNCIONES DE APOYO PARA PRECIOS E IVA 
 */

// Actualiza el precio de un ítem específico en el carrito y repinta
function updatePOSCartPrice(idx, val) {
    const nuevoPrecio = parseFloat(val) || 0;
    if (state.pos_cart && state.pos_cart[idx]) {
        state.pos_cart[idx].precio = nuevoPrecio;
        renderPOS(); 
    }
}

// Control manual del IVA
function toggleIVA() {
    const checkbox = document.getElementById('pos-apply-iva');
    if (checkbox) {
        posFormState.applyIva = checkbox.checked;
        renderPOS();
    }
}
  function toggleFlete() {
  const checkbox = document.getElementById('pos-apply-flete');
  if(checkbox) posFormState.applyFlete = checkbox.checked;
  const val = document.getElementById('pos-flete-valor');
  if(val) posFormState.flete = parseFloat(val.value)||0;
  renderPOS();
}

function handlePOSShippingUI() {
  const canal = document.getElementById('pos-canal').value;
  posFormState.canal = canal;
  const container = document.getElementById('pos-shipping-fields');
  const empresaSel = document.getElementById('pos-empresa');
  const liqInfo = document.getElementById('pos-liq-info');
  const transSel = document.getElementById('pos-transportadora');
  
  if(canal === 'vitrina') {
    container.style.display = 'none';
  } else {
    container.style.display = 'flex';
    if(canal === 'local') {
      empresaSel.innerHTML = `<option value="">— Mensajería Local —</option><option value="MensLocal" ${posFormState.empresa==='MensLocal'?'selected':''}>Mensajería Propia</option><option value="Rappi" ${posFormState.empresa==='Rappi'?'selected':''}>Rappi</option><option value="Picap" ${posFormState.empresa==='Picap'?'selected':''}>Picap</option>`;
      transSel.style.display = 'none';
      liqInfo.textContent = '⚡ Liquidación al día siguiente hábil.';
    } else if(canal === 'inter') {
      empresaSel.innerHTML = `<option value="">— Plataforma / Directo —</option><option value="HEKA" ${posFormState.empresa==='HEKA'?'selected':''}>HEKA</option><option value="DROPI" ${posFormState.empresa==='DROPI'?'selected':''}>Dropi</option><option value="Directo" ${posFormState.empresa==='Directo'?'selected':''}>Directo / Otra</option>`;
      transSel.style.display = 'block';
      liqInfo.textContent = `📦 Liquidación en ${state.diasInter} días hábiles.`;
    }
  }
}

function handlePOSEmpresa() {
  posFormState.empresa = document.getElementById('pos-empresa').value;
}

function renderPOSCategoryTabs(){
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
  const art=(state.articulos||[]).find(a=>a.id===artId);if(!art)return;
  const stock=getArticuloStock(artId);
  const inCart=(state.pos_cart||[]).find(c=>c.articuloId===artId && c.talla===talla);
  const currentQty=inCart?inCart.qty:0;

  if(currentQty>=stock){notify('warning','⚠️','Sin stock','No hay suficiente inventario.',{duration:3000});return}

  if(inCart){
    inCart.qty++;
  } else {
    state.pos_cart.push({articuloId:artId, nombre:art.nombre, precio:art.precioVenta, qty:1, categoria: art.categoria, talla: talla});
  }
  closeModal();
  renderPOS();
}

function posCartQty(idx,delta){
  syncPOSFormState();
  const cart=state.pos_cart||[];
  if(!cart[idx])return;
  cart[idx].qty+=delta;
  if(cart[idx].qty<=0)cart.splice(idx,1);
  renderPOS();
}
function posCartRemove(idx){syncPOSFormState();(state.pos_cart||[]).splice(idx,1);renderPOS()}
function clearPOSCart(){syncPOSFormState();state.pos_cart=[];renderPOS()}

async function procesarVentaPOS() {
  syncPOSFormState();
  const cart = state.pos_cart || [];
  if(cart.length === 0) return;

  const canal = posFormState.canal;
  const subtotal = cart.reduce((a,item)=>a+(item.precio*item.qty),0);
  const iva = posFormState.applyIva ? subtotal*0.19 : 0;
  const flete = (posFormState.applyFlete&&(canal==='local'||canal==='inter'))?(posFormState.flete||0):0;
  const total = subtotal+iva+flete;
  const numFactura = 'POS-'+getNextConsec('factura');
  const fechaActual = today();
  const esSeparado = document.getElementById('pos-es-separado')?document.getElementById('pos-es-separado').checked:false;

  // Construir objetos locales
  const factura = {
    id:uid(), numero:numFactura, fecha:fechaActual,
    cliente:posFormState.cliente, telefono:posFormState.telefono,
    items:cart.map(c=>({...c})), subtotal, iva, flete, total,
    metodo:posFormState.metodo, estado:'pagada', tipo:'pos',
    canal, guia:posFormState.guia, empresa:posFormState.empresa,
    transportadora:posFormState.transportadora, ciudad:posFormState.ciudad,
    esSeparado
  };

  const tipoPago = (canal === 'vitrina') ? 'contado' : (posFormState.tipoPago || 'contado');
  const esContraEntrega = tipoPago === 'contraentrega';
  // Contado: ya está liquidado. ContraEntrega: pendiente hasta cobro.
  const liquidadoInicial = canal === 'vitrina' || tipoPago === 'contado';
  // Fecha de liquidación según canal
  const fechaLiq = liquidadoInicial ? fechaActual : addBusinessDays(fechaActual, canal === 'local' ? (state.diasLocal||1) : (state.diasInter||5));

  const ventaRecord = {
    id:factura.id, fecha:fechaActual, canal, valor:total,
    cliente:posFormState.cliente, telefono:posFormState.telefono,
    guia:posFormState.guia, empresa:posFormState.empresa,
    transportadora:posFormState.transportadora, ciudad:posFormState.ciudad,
    liquidado:liquidadoInicial, fechaLiquidacion:fechaLiq,
    esContraEntrega, tipoPago,
    esSeparado, estadoEntrega:'Pendiente',
    desc:numFactura, metodoPago:posFormState.metodo
  };

  // Guardar en state local
  state.facturas.push(factura);
  state.ventas.push(ventaRecord);

  // Descontar stock local
  cart.forEach(item=>{
    const mov={id:uid(),articuloId:item.articuloId,bodegaId:'bodega_main',cantidad:-item.qty,tipo:'venta',fecha:fechaActual,referencia:numFactura,nota:`Talla: ${item.talla}`};
    state.inv_movimientos.push(mov);
  });

  // Guardar en Supabase (no bloquea si falla)
  if(_sbConnected){
    try {
      await supabaseClient.from('invoices').insert({id:factura.id,number:numFactura,customer_name:posFormState.cliente||'CLIENTE MOSTRADOR',customer_phone:posFormState.telefono||'',total});
      await supabaseClient.from('ventas').upsert({id:ventaRecord.id,fecha:fechaActual,canal,valor:total,cliente:posFormState.cliente||'',telefono:posFormState.telefono||'',guia:posFormState.guia||'',empresa:posFormState.empresa||'',transportadora:posFormState.transportadora||'',ciudad:posFormState.ciudad||'',liquidado:liquidadoInicial,fecha_liquidacion:fechaLiq,es_separado:esSeparado,estado_entrega:'Pendiente',referencia:numFactura,metodo_pago:posFormState.metodo,tipo_pago:tipoPago,es_contraentrega:esContraEntrega,archived:false},{onConflict:'id'});
      for(const item of cart){
        const art=state.articulos.find(a=>a.id===item.articuloId);
        if(art){const ns=Math.max(0,(art.stock||0)-item.qty);await supabaseClient.from('products').update({stock:ns}).eq('id',item.articuloId);art.stock=ns;}
      }
    } catch(e){ console.warn('Supabase POS save failed:', e.message); }
  }

  // Auto-registrar cliente
  if(posFormState.cliente){
    if(!Array.isArray(state.usu_clientes))state.usu_clientes=[];
    const yaExiste=state.usu_clientes.some(u=>(u.cedula&&u.cedula===posFormState.cedula)||(u.nombre&&u.nombre.toLowerCase()===posFormState.cliente.toLowerCase()));
    if(!yaExiste){
      const nc={id:uid(),tipo:'cliente',tipoId:'CC',cedula:posFormState.cedula||'',nombre:posFormState.cliente,celular:posFormState.telefono||'',whatsapp:posFormState.telefono||'',ciudad:posFormState.ciudad||'',fechaCreacion:fechaActual};
      state.usu_clientes.push(nc);
      // Guardar en Supabase customers directamente
      if(_sbConnected){
        supabaseClient.from('customers').upsert({
          id:nc.id, nombre:nc.nombre, cedula:nc.cedula||null,
          celular:nc.celular||null, telefono:nc.celular||null,
          whatsapp:nc.whatsapp||null, ciudad:nc.ciudad||null
        },{onConflict:'id'}).then(({error})=>{ if(error) console.warn('Auto-cliente error:',error.message); });
      }
    }
  }

  const xpGained=calcXP(canal,total);
  awardXP(xpGained);
  checkBadges();
  saveConfig('game', state.game);
  saveConfig('consecutivos', state.consecutivos);

  state.pos_cart=[];
  posFormState={canal:'vitrina',empresa:'',transportadora:'',guia:'',ciudad:'',cliente:'',telefono:'',metodo:'efectivo',cuenta:'',applyIva:true,applyFlete:false,flete:0};

  openCashDrawer();
  printReceipt(factura);
  notify('sale','✅','¡Venta registrada!',`${numFactura} · ${fmt(total)} · +${xpGained}XP`,{duration:4000});
  spawnConfetti();
  screenFlash('green');
  renderPOS();
  updateNavBadges();
}


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
  <div class="small">Cliente: <b>${nombreCliente}</b>${telefonoCliente?' | '+telefonoCliente:''}${ciudadCliente?' | Ciudad: '+ciudadCliente:''}</div>
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