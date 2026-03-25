// POS view layer: rendering and DOM painting.
(function initPosView(global) {
  function escAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  const INTER_METODOS_CONTADO = [
    { id: 'nequi', nombre: '📱 Nequi' },
    { id: 'daviplata', nombre: '📱 Daviplata' },
    { id: 'transferencia', nombre: '🏦 Transferencia bancaria' },
    { id: 'tarjeta_debito', nombre: '💳 Tarjeta débito' },
    { id: 'tarjeta_credito', nombre: '💳 Tarjeta crédito' }
  ];
  const LOCAL_METODOS_CONTADO = [
    ...INTER_METODOS_CONTADO,
    { id: 'efectivo', nombre: '💵 Efectivo' }
  ];

  function normalizePosCanalMetodo(posFormState) {
    const interContado = ['nequi', 'daviplata', 'transferencia', 'tarjeta_debito', 'tarjeta_credito'];
    const localContado = [...interContado, 'efectivo'];
    if (posFormState.canal === 'inter') {
      if (posFormState.tipoPago === 'contraentrega') {
        posFormState.metodo = 'transferencia';
      } else if (posFormState.tipoPago === 'contado' && !interContado.includes(posFormState.metodo)) {
        posFormState.metodo = 'nequi';
      }
    } else if (posFormState.canal === 'local') {
      posFormState.applyFlete = true;
      if (posFormState.tipoPago === 'contraentrega') {
        posFormState.metodo = 'transferencia';
      } else if (!localContado.includes(posFormState.metodo)) {
        posFormState.metodo = 'nequi';
      }
    } else if (interContado.includes(posFormState.metodo)) {
      posFormState.metodo = 'efectivo';
    }
  }

  function renderPOSLayout(ctx) {
    const { state, posFormState, syncPOSFormState, fmt } = ctx;
    const cart = state.pos_cart || [];
    const articulos = state.articulos || [];
    syncPOSFormState();
    normalizePosCanalMetodo(posFormState);

    const subtotal = cart.reduce((a, item) => a + (item.precio * item.qty), 0);
    const iva = posFormState.applyIva ? subtotal * 0.19 : 0;
    const flete =
      posFormState.canal === 'local'
        ? parseFloat(posFormState.flete) || 0
        : posFormState.applyFlete && posFormState.canal === 'inter'
          ? parseFloat(posFormState.flete) || 0
          : 0;
    const total = subtotal + iva + flete;

    const bodegas = state.bodegas || [];
    const lsB = global.AppCajaLogic?.getPosBodegaId?.() || '';
    const selBodega = posFormState.bodegaId || lsB || bodegas[0]?.id || 'bodega_main';
    const cajasPos = global.AppCajaLogic?.listOpenCajasForBodega?.(state, selBodega) || (state.cajas || []).filter((c) => c.estado === 'abierta');
    const lsC = global.AppCajaLogic?.getPosCajaId?.() || '';
    const selCaja = posFormState.cajaId || lsC || cajasPos[0]?.id || '';

    const cuentasBancarias =
      global.CUENTAS_BANCARIAS && global.CUENTAS_BANCARIAS.length
        ? global.CUENTAS_BANCARIAS
        : ['Nequi', 'Bancolombia', 'Daviplata', 'Bancolombia 2'];
    const showCuentaBancaria = global.AppCajaLogic?.bucketFromMetodoId
      ? global.AppCajaLogic.bucketFromMetodoId(posFormState.metodo, state.cfg_metodos_pago) === 'transferencia'
      : String(posFormState.metodo || '') === 'transferencia';

    const isInter = posFormState.canal === 'inter';
    const isLocal = posFormState.canal === 'local';
    const curMetodo = posFormState.metodo || 'efectivo';
    let metodoOptionsHtml = '';
    if ((isInter || isLocal) && posFormState.tipoPago === 'contraentrega') {
      metodoOptionsHtml = '<option value="transferencia" selected>🏦 Transferencia (contra entrega)</option>';
    } else if (isInter && posFormState.tipoPago === 'contado') {
      metodoOptionsHtml = INTER_METODOS_CONTADO.map((m) => `<option value="${m.id}" ${curMetodo === m.id ? 'selected' : ''}>${m.nombre}</option>`).join('');
    } else if (isLocal && posFormState.tipoPago === 'contado') {
      metodoOptionsHtml = LOCAL_METODOS_CONTADO.map((m) => `<option value="${m.id}" ${curMetodo === m.id ? 'selected' : ''}>${m.nombre}</option>`).join('');
    } else {
      const cfgList =
        state.cfg_metodos_pago && state.cfg_metodos_pago.filter((m) => m.activo !== false).length > 0
          ? state.cfg_metodos_pago.filter((m) => m.activo !== false)
          : [
              { id: 'efectivo', nombre: '💵 Efectivo' },
              { id: 'tarjeta', nombre: '💳 Tarjeta' },
              { id: 'transferencia', nombre: '📱 Transferencia' },
              { id: 'addi', nombre: '💜 Addi' },
              { id: 'mixto', nombre: '🔄 Mixto' }
            ];
      metodoOptionsHtml = cfgList.map((m) => `<option value="${m.id}" ${curMetodo === m.id ? 'selected' : ''}>${m.nombre}</option>`).join('');
    }

    const addrBlock = isInter
      ? `<label class="form-label" style="font-size:9px;color:var(--text2);margin:0">Dirección de entrega *</label>
            <input type="text" class="form-control" id="pos-direccion" placeholder="Dirección completa" value="${escAttr(posFormState.direccion)}">
            <label class="form-label" style="font-size:9px;color:var(--text2);margin:0">Ciudad *</label>
            <input type="text" class="form-control" id="pos-ciudad" placeholder="Ciudad" value="${escAttr(posFormState.ciudad)}">`
      : isLocal
        ? `<label class="form-label" style="font-size:9px;color:var(--text2);margin:0">Dirección de entrega *</label>
            <input type="text" class="form-control" id="pos-direccion" placeholder="Dirección completa (barrio, referencia)" value="${escAttr(posFormState.direccion)}">`
        : '';

    const phCed = isInter || isLocal ? 'Cédula *' : '🔍 Cédula o Celular (Buscar)';
    const phNom = isInter || isLocal ? 'Nombre del cliente *' : 'Cliente (opcional)';
    const phTel = isInter || isLocal ? 'Celular / teléfono *' : 'Teléfono (opcional)';
    const phGuia = 'Número de guía *';

    const posContent = global.document.getElementById('pos-content');
    if (!posContent) return;

    posContent.innerHTML = `
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
        <div style="padding:0 12px 10px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid var(--border)">
          <div class="form-group" style="margin:0">
            <label class="form-label" style="font-size:10px;margin-bottom:4px">🏭 Bodega (stock / caja)</label>
            <select class="form-control" id="pos-bodega" onchange="syncPOSFormState();renderPOS()" style="padding:6px 10px;font-size:12px">
              ${bodegas.length
                ? bodegas.map((b) => {
                    const id = b.id;
                    const nm = (b.name || b.nombre || id).replace(/</g, '');
                    return `<option value="${id}" ${String(selBodega) === String(id) ? 'selected' : ''}>${nm}</option>`;
                  }).join('')
                : `<option value="bodega_main">Bodega principal</option>`}
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label" style="font-size:10px;margin-bottom:4px">🏧 Caja POS abierta</label>
            <select class="form-control" id="pos-caja" onchange="syncPOSFormState()" style="padding:6px 10px;font-size:12px">
              ${
                cajasPos.length === 0
                  ? '<option value="">— Sin caja abierta para esta bodega —</option>'
                  : cajasPos
                      .map((c) => {
                        const nm = String(c.nombre || c.id).replace(/</g, '');
                        return `<option value="${c.id}" ${String(selCaja) === String(c.id) ? 'selected' : ''}>${nm}</option>`;
                      })
                      .join('')
              }
            </select>
            <div style="font-size:9px;color:var(--yellow);margin-top:4px;line-height:1.35">Debe haber una caja <b>abierta</b> enlazada a la bodega (Configuración → Cajas POS o Tesorería).</div>
          </div>
        </div>
        <div class="pos-cart-items" id="pos-cart-items">
          ${cart.length === 0 ? '<div style="text-align:center;padding:40px 16px;color:var(--text2)"><div style="font-size:40px;margin-bottom:8px">🛒</div><div style="font-size:12px">Agrega productos al carrito</div></div>' : ''}
          ${cart.map((item, i) => `
            <div class="pos-item">
              <div style="flex:1">
                <div style="font-family:Syne; font-size:12px; font-weight:700">${item.nombre}</div>
                <div style="font-size:10px; color:var(--accent2)">Talla: ${item.talla}</div>
                <div style="display:flex; align-items:center; gap:4px; margin-top:4px;">
                  <span style="font-size:10px; color:var(--text2)">$</span>
                  <input type="number" style="width:85px; height:22px; background:var(--bg3); border:1px solid var(--border); color:var(--accent); font-family:'DM Mono'; font-size:11px; padding:0 5px; border-radius:4px;" value="${item.precio}" onchange="updatePOSCartPrice(${i}, this.value)">
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
            IVA (19%)
          </label>
          ${posFormState.canal === 'inter' ? `
          <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text2); margin-bottom:10px; cursor:pointer;">
            <input type="checkbox" id="pos-apply-flete" ${posFormState.applyFlete ? 'checked' : ''} onchange="toggleFlete()">
            Aplicar costo de envío (COP)
          </label>` : ''}
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="color:var(--text2);font-size:12px">Subtotal</span>
            <span style="font-size:12px">${fmt(subtotal)}</span>
          </div>
          ${posFormState.applyIva ? `
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="color:var(--text2);font-size:12px">IVA (19%)</span>
            <span style="font-size:12px">${fmt(iva)}</span>
          </div>` : ''}
          ${isLocal || (isInter && posFormState.applyFlete) ? `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
            <span style="color:var(--text2);font-size:12px;max-width:52%">🚚 Costo envío <span style="font-size:10px;opacity:.9">(pesos COP${isLocal ? ', obligatorio' : ''})</span></span>
            <div style="display:flex;align-items:center;gap:6px;flex:1;justify-content:flex-end;min-width:140px">
              <span style="font-size:12px;color:var(--text2);font-family:'DM Mono',monospace">$</span>
              <input type="number" id="pos-flete-valor" class="form-control pos-input-cop" inputmode="numeric" autocomplete="off"
                title="Valor del envío en pesos colombianos (COP). No es cantidad de prendas."
                style="padding:6px 8px;max-width:160px;text-align:right" value="${posFormState.flete || 0}" min="0" step="1" oninput="toggleFlete()" placeholder="Ej. 8000">
            </div>
          </div>
          <div style="font-size:9px;color:var(--text2);margin:-4px 0 8px;line-height:1.35;opacity:.9">Escribe el monto del flete en pesos (igual que el total a cobrar por mensajería), no el número de unidades.</div>` : ''}
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
                <option value="">${isInter ? '— Transportadora * —' : '— Transportadora —'}</option>
                <option value="TCC" ${posFormState.transportadora === 'TCC' ? 'selected' : ''}>TCC</option>
                <option value="Coordinadora" ${posFormState.transportadora === 'Coordinadora' ? 'selected' : ''}>Coordinadora</option>
                <option value="Envía" ${posFormState.transportadora === 'Envía' ? 'selected' : ''}>Envía</option>
                <option value="Interrapidisimo" ${posFormState.transportadora === 'Interrapidisimo' ? 'selected' : ''}>Inter Rapidísimo</option>
                <option value="Servientrega" ${posFormState.transportadora === 'Servientrega' ? 'selected' : ''}>Servientrega</option>
             </select>
             ${isInter ? `<input type="text" class="form-control" id="pos-guia" placeholder="${phGuia}" value="${escAttr(posFormState.guia)}">` : ''}
             ${addrBlock}
             <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
               <label style="font-size:10px;color:var(--text2);font-weight:700;display:block;margin-bottom:4px">TIPO DE COBRO</label>
               <select class="form-control" id="pos-tipo-pago" onchange="syncPOSFormState();renderPOS()" style="padding:8px">
                 <option value="contado" ${posFormState.tipoPago === 'contado' ? 'selected' : ''}>💵 Pago de Contado</option>
                 <option value="contraentrega" ${posFormState.tipoPago === 'contraentrega' ? 'selected' : ''}>📦 Contra Entrega</option>
               </select>
             </div>
          </div>
          ${posFormState.metodo === 'efectivo' ? (() => {
            let displayStr = '$0'; let colorStr = 'var(--text2)';
            if (posFormState.montoRecibido) {
              if (posFormState.montoRecibido >= total) { displayStr = fmt(posFormState.montoRecibido - total); colorStr = 'var(--green)'; }
              else { displayStr = 'Faltan ' + fmt(total - posFormState.montoRecibido); colorStr = 'var(--red)'; }
            }
            return `<div style="background:var(--bg3); padding:12px; border-radius:10px; border:1px dashed var(--border); margin-bottom:12px;"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><label class="form-label" style="margin:0; font-size:11px;">💵 EFECTIVO RECIBIDO</label><input type="number" class="form-control" id="pos-monto-recibido" style="width:140px; padding:6px; font-size:14px; font-weight:700; color:var(--green); text-align:right;" placeholder="0" oninput="calcularVuelto(${total})" value="${posFormState.montoRecibido || ''}"></div><div style="display:flex; justify-content:space-between; align-items:center;"><span style="font-size:12px; color:var(--text2); font-weight:700;">CAMBIO / VUELTO</span><span id="pos-vuelto-display" style="font-family:Syne; font-size:18px; font-weight:800; color:${colorStr};">${displayStr}</span></div></div>`;
          })() : ''}
          <div class="form-group" style="margin-bottom:10px; display:flex; gap:8px; flex-wrap:wrap;">
            <select class="form-control" id="pos-metodo-pago" style="padding:8px 12px; flex:1; min-width:160px" onchange="renderPOS()" ${(isInter || isLocal) && posFormState.tipoPago === 'contraentrega' ? 'disabled' : ''}>
              ${metodoOptionsHtml}
            </select>
            ${showCuentaBancaria ? `<select class="form-control" id="pos-cuenta" style="padding:8px 12px; flex:1; min-width:140px">${cuentasBancarias.map((c, idx) => `<option value="${escAttr(c)}" ${posFormState.cuenta === c || (!posFormState.cuenta && idx === 0) ? 'selected' : ''}>${c}</option>`).join('')}</select>` : ''}
          </div>
          <div class="form-row" style="gap:8px; margin-bottom:8px">
            <input type="text" class="form-control" id="pos-comprobante" placeholder="Comprobante (ref. pago, nota)" style="padding:8px 12px" value="${escAttr(posFormState.comprobante)}">
          </div>
          <div class="form-row" style="gap:8px; margin-bottom:8px">
            <input type="text" class="form-control" id="pos-cedula" placeholder="${phCed}" style="padding:8px 12px; font-weight:bold; color:var(--accent)" value="${escAttr(posFormState.cedula)}" onblur="typeof autocompletarCliente==='function'&&autocompletarCliente(this)">
          </div>
          <div class="form-row" style="gap:8px; margin-bottom:10px">
            <input type="text" class="form-control" id="pos-cliente" placeholder="${phNom}" style="padding:8px 12px" value="${escAttr(posFormState.cliente)}">
            <input type="tel" class="form-control" id="pos-telefono" placeholder="${phTel}" style="padding:8px 12px" value="${escAttr(posFormState.telefono)}">
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
  }

  function renderPOSCategoryTabs(state) {
    const cats = [...new Set((state.articulos || []).map((a) => a.categoria).filter(Boolean))];
    const el = global.document.getElementById('pos-cat-tabs');
    if (!el) return;
    el.innerHTML = `<div class="tab active" onclick="filterPOSByCategory('')">Todos</div>` + cats.map((c) => `<div class="tab" onclick="filterPOSByCategory('${c}')">${c}</div>`).join('');
  }

  function renderPOSProductGrid(ctx) {
    const { state, posFilter, posCatFilter, getArticuloStock, fmt } = ctx;
    const el = global.document.getElementById('pos-product-grid');
    if (!el) return;
    let items = (state.articulos || []).filter((a) => a.activo !== false);
    if (posFilter) items = items.filter((a) => (a.nombre + a.codigo + a.categoria).toLowerCase().includes(posFilter));
    if (posCatFilter) items = items.filter((a) => a.categoria === posCatFilter);

    el.innerHTML = items.map((a) => {
      const stock = getArticuloStock(a.id);
      const low = stock <= a.stockMinimo;
      const out = stock <= 0;
      const esVideo = a.imagen && a.imagen.split('?')[0].toLowerCase().match(/\.(mp4|mov|webm|avi)$/);
      const bgImg = (a.imagen && !esVideo) ? `background-image: linear-gradient(to top, rgba(0,0,0,0.8), transparent), url('${a.imagen}'); background-size: cover; background-position: center; color: white; border: none;` : '';
      const videoEl = esVideo ? `<video src="${a.imagen}" autoplay muted loop playsinline style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:12px;z-index:0;"></video><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.8),transparent);border-radius:12px;z-index:1;"></div>` : '';
      const videoIcon = (a.video || esVideo) ? `<div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.5);border-radius:50%;padding:4px;font-size:12px;z-index:2;">▶️</div>` : '';
      return `<div class="product-card ${out ? 'no-stock' : low ? 'low-stock' : ''}" style="position:relative; min-height:140px; display:flex; flex-direction:column; justify-content:flex-end; ${esVideo ? 'color:white;border:none;' : bgImg}" onclick="promptTallaYAgregar('${a.id}')">${videoEl}${videoIcon}${!a.imagen && !esVideo ? `<div class="p-emoji">${a.emoji || '👙'}</div>` : ''}<div class="p-name" style="position:relative;z-index:2;${(a.imagen || esVideo) ? 'text-shadow:0 1px 3px rgba(0,0,0,0.8);' : ''}">${a.nombre}</div><div class="p-price" style="position:relative;z-index:2;${(a.imagen || esVideo) ? 'color:#00e5b4;text-shadow:0 1px 2px rgba(0,0,0,0.8);' : ''}">${fmt(a.precioVenta)}</div><div class="p-stock" style="position:relative;z-index:2;${(a.imagen || esVideo) ? 'color:#ddd;' : ''}">${out ? '❌ Agotado' : stock + ' en stock' + (low ? ' ⚠️' : '')}</div>${a.codigo && !a.imagen && !esVideo ? '<div style="font-size:9px;color:var(--meta);margin-top:2px">' + a.codigo + '</div>' : ''}</div>`;
    }).join('') || '<div style="grid-column:1/-1;text-align:center;color:var(--text2);padding:24px">No se encontraron artículos</div>';
  }

  global.AppPosView = {
    renderPOSLayout,
    renderPOSCategoryTabs,
    renderPOSProductGrid
  };
})(window);
