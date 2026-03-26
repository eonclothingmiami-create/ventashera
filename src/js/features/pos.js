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
  if (esSeparado) {
    const nomSep = String(posFormState.cliente || '').trim();
    const telSep = String(posFormState.telefono || '').trim();
    if (!nomSep || !telSep) {
      notify('warning', '🛍️', 'Separado', 'Nombre del cliente y teléfono son obligatorios para registrar un separado.', { duration: 6500 });
      return;
    }
  }

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
    esSeparado, estadoEntrega:'Pendiente', fechaHoraEntrega:null,
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
      await supabaseClient.from('invoices').insert({
        id:             factura.id,
        number:         numFactura,
        customer_name:  posFormState.cliente||'CLIENTE MOSTRADOR',
        customer_phone: posFormState.telefono||'',
        total,
        subtotal,
        iva,
        flete,
        fecha:          fechaActual,
        canal,
        metodo_pago:    posFormState.metodo||'efectivo',
        estado:         'pagada',
        tipo:           'pos',
        guia:           posFormState.guia||'',
        empresa:        posFormState.empresa||'',
        transportadora: posFormState.transportadora||'',
        ciudad:         posFormState.ciudad||'',
        es_separado:    esSeparado,
        tipo_pago:      tipoPago,
        items:          JSON.stringify(cart.map(c=>({id:c.articuloId,nombre:c.nombre,talla:c.talla,qty:c.qty,precio:c.precio})))
      });
      await supabaseClient.from('ventas').upsert({id:ventaRecord.id,fecha:fechaActual,canal,valor:total,cliente:posFormState.cliente||'',telefono:posFormState.telefono||'',guia:posFormState.guia||'',empresa:posFormState.empresa||'',transportadora:posFormState.transportadora||'',ciudad:posFormState.ciudad||'',liquidado:liquidadoInicial,fecha_liquidacion:fechaLiq,es_separado:esSeparado,estado_entrega:'Pendiente',fecha_hora_entrega:null,referencia:numFactura,metodo_pago:posFormState.metodo,tipo_pago:tipoPago,es_contraentrega:esContraEntrega,archived:false},{onConflict:'id'});
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

