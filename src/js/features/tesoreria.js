// ===================================================================
// ===== TESORERÍA =====
// ===================================================================
// ===================================================================
// ===== TESORERÍA: PAGOS A PROVEEDORES =====
// ===================================================================

function calcDeudaProveedor(provId) {
  const esSinEspecificar = provId === '__sin_proveedor__';
  const articulos = (state.articulos||[]).filter(a => {
    if(a.tituloMercancia !== 'credito') return false;
    if(esSinEspecificar) return !a.proveedorId || a.proveedorId === '';
    return a.proveedorId === provId;
  });
  // Deuda bruta: costo × stock
  const deudaBruta = articulos.reduce((sum, a) => sum + ((a.precioCompra||0) * (a.stock||0)), 0);
  // Abonos realizados
  const abonos = (state.tes_abonos_prov||[])
    .filter(ab => ab.proveedorId === provId)
    .reduce((sum, ab) => sum + (ab.valor||0), 0);
  return { deudaBruta, abonos, saldo: Math.max(0, deudaBruta - abonos), articulos };
}

function renderTesPagosProv() {
  const el = document.getElementById('tes_pagos_prov-content');
  if(!el) return;

  // Recopilar proveedores que tienen mercancía a crédito
  // Proveedores registrados con deuda
  const provConDeuda = (state.usu_proveedores||[]).map(p => {
    const d = calcDeudaProveedor(p.id);
    return { ...p, ...d };
  }).filter(p => p.deudaBruta > 0);

  // Artículos a crédito sin proveedor especificado
  const dSinProv = calcDeudaProveedor('__sin_proveedor__');
  if(dSinProv.deudaBruta > 0) {
    provConDeuda.push({
      id: '__sin_proveedor__',
      nombre: '⚠️ Sin Proveedor Especificado',
      cedula: '', ciudad: '',
      ...dSinProv
    });
  }

  // Totales generales
  const totalDeuda = provConDeuda.reduce((s,p) => s + p.deudaBruta, 0);
  const totalAbonos = provConDeuda.reduce((s,p) => s + p.abonos, 0);
  const totalSaldo = provConDeuda.reduce((s,p) => s + p.saldo, 0);

  // Historial de abonos recientes
  const abonosRecientes = [...(state.tes_abonos_prov||[])].reverse().slice(0, 20);

  el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary" onclick="openAbonoProvModal()">💳 Registrar Abono</button>
      <div style="margin-left:auto;font-size:11px;color:var(--text2)">
        Solo muestra proveedores con mercancía <span class="badge badge-warn">💳 A Crédito</span>
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:16px">
      <div class="card" style="margin:0;text-align:center;border-color:rgba(248,113,113,.3)">
        <div style="font-family:Syne;font-size:22px;font-weight:800;color:var(--red)">${fmt(totalDeuda)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">📦 Deuda Total Bruta</div>
      </div>
      <div class="card" style="margin:0;text-align:center;border-color:rgba(74,222,128,.3)">
        <div style="font-family:Syne;font-size:22px;font-weight:800;color:var(--green)">${fmt(totalAbonos)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">✅ Total Abonado</div>
      </div>
      <div class="card" style="margin:0;text-align:center;border-color:rgba(251,191,36,.3)">
        <div style="font-family:Syne;font-size:22px;font-weight:800;color:var(--yellow)">${fmt(totalSaldo)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">⚠️ Saldo Por Pagar</div>
      </div>
    </div>

    ${provConDeuda.length === 0 ? `
      <div class="empty-state">
        <div class="es-icon">🏭</div>
        <div class="es-title">Sin deudas a crédito</div>
        <div class="es-text">Cuando registres artículos con título "Mercancía a Crédito" y un proveedor, aparecerán aquí.</div>
      </div>` : provConDeuda.map(p => {
        const pct = p.deudaBruta > 0 ? Math.min(100, (p.abonos / p.deudaBruta) * 100) : 0;
        const diasDesde = p.articulos.length > 0 ? (() => {
          const fechas = p.articulos.map(a => a.fechaCompra||a.createdAt||'').filter(Boolean).sort();
          if(!fechas.length) return null;
          const d = Math.round((new Date() - new Date(fechas[0])) / 86400000);
          return d;
        })() : null;

        return `
        <div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
            <div>
              <div style="font-family:Syne;font-size:16px;font-weight:800">${p.nombre}</div>
              <div style="font-size:11px;color:var(--text2)">${p.cedula||''} · ${p.ciudad||''}</div>
              ${diasDesde !== null ? `<div style="font-size:10px;color:var(--orange);margin-top:2px">⏱ ${diasDesde} días desde primera compra</div>` : ''}
            </div>
            <div style="text-align:right">
              <div style="font-family:Syne;font-size:20px;font-weight:800;color:${p.saldo>0?'var(--yellow)':'var(--green)'}">${fmt(p.saldo)}</div>
              <div style="font-size:10px;color:var(--text2)">saldo pendiente</div>
            </div>
          </div>

          <div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap">
            <div style="font-size:12px"><span style="color:var(--text2)">Deuda bruta:</span> <b>${fmt(p.deudaBruta)}</b></div>
            <div style="font-size:12px"><span style="color:var(--text2)">Abonado:</span> <b style="color:var(--green)">${fmt(p.abonos)}</b></div>
            <div style="font-size:12px"><span style="color:var(--text2)">Artículos:</span> <b>${p.articulos.length}</b></div>
          </div>

          <div style="background:rgba(255,255,255,.05);border-radius:8px;height:8px;overflow:hidden;margin-bottom:10px">
            <div style="height:100%;border-radius:8px;background:linear-gradient(90deg,var(--green),var(--accent));width:${pct}%;transition:width 1s ease"></div>
          </div>
          <div style="font-size:10px;color:var(--text2);margin-bottom:12px">${pct.toFixed(1)}% pagado</div>

          <details style="margin-bottom:10px">
            <summary style="font-size:11px;color:var(--text2);cursor:pointer">📦 Ver artículos a crédito (${p.articulos.length})</summary>
            <div class="table-wrap" style="margin-top:8px">
              <table><thead><tr><th>Ref</th><th>Artículo</th><th>Stock</th><th>Costo unit.</th><th>Total</th><th>Desde</th></tr></thead><tbody>
              ${p.articulos.map(a => `<tr>
                <td>${a.codigo||'—'}</td>
                <td style="font-weight:700">${a.nombre}</td>
                <td>${a.stock||0}</td>
                <td>${fmt(a.precioCompra||0)}</td>
                <td style="color:var(--red);font-weight:700">${fmt((a.precioCompra||0)*(a.stock||0))}</td>
                <td style="font-size:10px;color:var(--text2)">${a.fechaCompra ? formatDate(a.fechaCompra) : (a.createdAt ? formatDate(a.createdAt.split('T')[0]) : '—')}</td>
              </tr>`).join('')}
              </tbody></table>
            </div>
          </details>

          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-primary" onclick="openAbonoProvModal('${p.id}','${p.nombre}')">💳 Abonar</button>
            <button class="btn btn-sm btn-secondary" onclick="verAbonosProv('${p.id}','${p.nombre}')">📋 Ver abonos</button>
          </div>
        </div>`;
    }).join('')}

    ${abonosRecientes.length > 0 ? `
    <div class="card">
      <div class="card-title">💳 ÚLTIMOS ABONOS REGISTRADOS</div>
      <div class="table-wrap"><table><thead><tr>
        <th>Fecha</th><th>Proveedor</th><th>Valor</th><th>Método</th><th>Nota</th><th></th>
      </tr></thead><tbody>
      ${abonosRecientes.map(ab => `<tr>
        <td>${formatDate(ab.fecha)}</td>
        <td style="font-weight:700">${ab.proveedorNombre||'—'}</td>
        <td style="color:var(--green);font-weight:700">${fmt(ab.valor||0)}</td>
        <td>${ab.metodo||'—'}</td>
        <td style="color:var(--text2);font-size:11px">${ab.nota||'—'}</td>
        <td><button class="btn btn-xs btn-danger" onclick="eliminarAbonoProv('${ab.id}')">✕</button></td>
      </tr>`).join('')}
      </tbody></table></div>
    </div>` : ''}`;
}

function openAbonoProvModal(provId='', provNombre='') {
  const proveedores = (state.usu_proveedores||[]).filter(p => {
    const d = calcDeudaProveedor(p.id);
    return d.saldo > 0;
  });

  if(proveedores.length === 0 && !provId) {
    notify('warning','⚠️','Sin deudas','No hay proveedores con saldo pendiente.',{duration:3000});
    return;
  }

  openModal(`
    <div class="modal-title">💳 Registrar Abono a Proveedor<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">PROVEEDOR *</label>
      <select class="form-control" id="ab-prov-sel" onchange="updateSaldoPendiente()">
        <option value="">— Seleccionar —</option>
        ${proveedores.map(p => {
          const d = calcDeudaProveedor(p.id);
          return `<option value="${p.id}" data-saldo="${d.saldo}" data-nombre="${p.nombre}" ${p.id===provId?'selected':''}>${p.nombre} · Saldo: ${fmt(d.saldo)}</option>`;
        }).join('')}
      </select>
    </div>
    <div id="ab-saldo-info" style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;display:none">
      <span style="color:var(--text2)">Saldo pendiente:</span> <span id="ab-saldo-val" style="font-weight:700;color:var(--yellow)"></span>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">VALOR ABONO *</label>
        <input type="number" class="form-control" id="ab-valor" min="0" placeholder="0" oninput="validateAbono()">
      </div>
      <div class="form-group"><label class="form-label">MÉTODO DE PAGO</label>
        <select class="form-control" id="ab-metodo">
          ${(state.cfg_metodos_pago && state.cfg_metodos_pago.filter(m=>m.activo!==false).length > 0
          ? state.cfg_metodos_pago.filter(m=>m.activo!==false)
          : [{id:'efectivo',nombre:'💵 Efectivo'},{id:'transferencia',nombre:'📱 Transferencia'},{id:'nequi',nombre:'Nequi'},{id:'daviplata',nombre:'Daviplata'},{id:'cheque',nombre:'Cheque'}]
        ).map(m=>`<option value="${m.id}">${m.nombre}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">FECHA</label>
        <input type="date" class="form-control" id="ab-fecha" value="${today()}">
      </div>
      <div class="form-group"><label class="form-label">COMPROBANTE / NOTA</label>
        <input class="form-control" id="ab-nota" placeholder="N° transferencia, observación...">
      </div>
    </div>
    <div id="ab-warning" style="display:none;color:var(--red);font-size:11px;margin-bottom:8px"></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarAbonoProv()">💳 Guardar Abono</button>
  `);

  if(provId) {
    setTimeout(() => {
      document.getElementById('ab-prov-sel').value = provId;
      updateSaldoPendiente();
    }, 50);
  }
}

function updateSaldoPendiente() {
  const sel = document.getElementById('ab-prov-sel');
  const opt = sel?.options[sel.selectedIndex];
  const saldo = parseFloat(opt?.getAttribute('data-saldo')||0);
  const info = document.getElementById('ab-saldo-info');
  const val = document.getElementById('ab-saldo-val');
  if(saldo > 0) {
    info.style.display = 'block';
    val.textContent = fmt(saldo);
  } else {
    info.style.display = 'none';
  }
}

function validateAbono() {
  const sel = document.getElementById('ab-prov-sel');
  const opt = sel?.options[sel.selectedIndex];
  const saldo = parseFloat(opt?.getAttribute('data-saldo')||0);
  const valor = parseFloat(document.getElementById('ab-valor')?.value||0);
  const warn = document.getElementById('ab-warning');
  if(valor > saldo && saldo > 0) {
    warn.style.display = 'block';
    warn.textContent = `⚠️ El abono (${fmt(valor)}) supera el saldo pendiente (${fmt(saldo)})`;
  } else {
    warn.style.display = 'none';
  }
}

async function guardarAbonoProv() {
  const sel = document.getElementById('ab-prov-sel');
  const opt = sel?.options[sel.selectedIndex];
  const provId = sel?.value;
  const provNombre = opt?.getAttribute('data-nombre') || opt?.text || '';
  const valor = parseFloat(document.getElementById('ab-valor')?.value||0);
  const metodo = document.getElementById('ab-metodo')?.value || 'efectivo';
  const fecha = document.getElementById('ab-fecha')?.value || today();
  const nota = document.getElementById('ab-nota')?.value.trim() || '';

  if(!provId) { notify('warning','⚠️','Selecciona un proveedor','',{duration:3000}); return; }
  if(valor <= 0) { notify('warning','⚠️','Ingresa un valor','',{duration:3000}); return; }

  const abono = { id: uid(), proveedorId: provId, proveedorNombre: provNombre,
    valor, metodo, fecha, nota, fechaCreacion: today() };

  if(!state.tes_abonos_prov) state.tes_abonos_prov = [];
  state.tes_abonos_prov.push(abono);

  // Guardar en Supabase
  try {
    showLoadingOverlay('connecting');
    const { error } = await supabaseClient.from('tes_abonos_prov').upsert({
      id: abono.id, proveedor_id: provId, proveedor_nombre: provNombre,
      valor, metodo, fecha, nota
    }, { onConflict: 'id' });
    if(error) throw error;

    // Registrar egreso en caja si hay una abierta
    const cajaAbierta = (state.cajas||[]).find(c => c.estado === 'abierta');
    if(cajaAbierta) {
      cajaAbierta.saldo -= valor;
      const mov = { id: uid(), cajaId: cajaAbierta.id, tipo: 'egreso', valor,
        concepto: `Abono proveedor: ${provNombre}`, fecha, metodo };
      state.tes_movimientos.push(mov);
      await saveRecord('cajas', cajaAbierta.id, cajaAbierta);
      await saveRecord('tes_movimientos', mov.id, mov);
    }

    showLoadingOverlay('hide');
    closeModal();
    renderTesPagosProv();
    notify('success','💳','Abono registrado',`${fmt(valor)} a ${provNombre}`,{duration:3000});

  } catch(err) {
    showLoadingOverlay('hide');
    notify('danger','⚠️','Error al guardar', err.message, {duration:5000});
    console.error(err);
  }
}

function verAbonosProv(provId, provNombre) {
  const abonos = (state.tes_abonos_prov||[]).filter(ab => ab.proveedorId === provId);
  const d = calcDeudaProveedor(provId);
  openModal(`
    <div class="modal-title">📋 Abonos — ${provNombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
      <div><span style="color:var(--text2);font-size:12px">Deuda bruta:</span> <b>${fmt(d.deudaBruta)}</b></div>
      <div><span style="color:var(--text2);font-size:12px">Total abonado:</span> <b style="color:var(--green)">${fmt(d.abonos)}</b></div>
      <div><span style="color:var(--text2);font-size:12px">Saldo:</span> <b style="color:var(--yellow)">${fmt(d.saldo)}</b></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Valor</th><th>Método</th><th>Nota</th></tr></thead><tbody>
    ${abonos.length > 0 ? abonos.reverse().map(ab => `<tr>
      <td>${formatDate(ab.fecha)}</td>
      <td style="color:var(--green);font-weight:700">${fmt(ab.valor)}</td>
      <td>${ab.metodo||'—'}</td>
      <td style="color:var(--text2);font-size:11px">${ab.nota||'—'}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:20px">Sin abonos registrados</td></tr>'}
    </tbody></table></div>
    <button class="btn btn-primary btn-sm" style="margin-top:12px;width:100%" onclick="closeModal();openAbonoProvModal('${provId}','${provNombre}')">+ Nuevo Abono</button>
  `);
}

async function eliminarAbonoProv(id) {
  if(!confirm('¿Eliminar este abono? El saldo pendiente se recalculará.')) return;
  state.tes_abonos_prov = (state.tes_abonos_prov||[]).filter(ab => ab.id !== id);
  try {
    await supabaseClient.from('tes_abonos_prov').delete().eq('id', id);
  } catch(e) { console.warn('Error eliminando abono:', e.message); }
  renderTesPagosProv();
  notify('success','🗑️','Abono eliminado','Saldo recalculado.',{duration:2000});
}

function renderTesCajas(){
  const cajas=state.cajas||[];
  document.getElementById('tes_cajas-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openCajaModal()">+ Nueva Caja</button>
    <div class="grid-2">${cajas.map(c=>`
      <div class="card" style="margin:0;border-color:${c.estado==='abierta'?'rgba(0,229,180,.3)':'var(--border)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-family:Syne;font-weight:800;font-size:16px">${c.nombre}</div>
          <span class="badge ${c.estado==='abierta'?'badge-ok':'badge-pend'}">${c.estado}</span>
        </div>
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--accent);margin-bottom:12px">${fmt(c.saldo)}</div>
        <div class="btn-group">
          ${c.estado==='abierta'?`
            <button class="btn btn-sm btn-secondary" onclick="movCaja('${c.id}','ingreso')">📥 Ingreso</button>
            <button class="btn btn-sm btn-secondary" onclick="movCaja('${c.id}','egreso')">📤 Egreso</button>
            <button class="btn btn-sm btn-danger" onclick="cerrarCaja('${c.id}')">🔒 Cerrar</button>
          `:`<button class="btn btn-sm btn-primary" onclick="abrirCaja('${c.id}')">🔓 Abrir</button>`}
        </div>
      </div>`).join('')}</div>`;
}

function openCajaModal(){
  openModal(`
    <div class="modal-title">Nueva Caja<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">NOMBRE</label><input class="form-control" id="m-caja-nombre" placeholder="Ej: Caja 2"></div>
    <div class="form-group"><label class="form-label">SALDO INICIAL</label><input type="number" class="form-control" id="m-caja-saldo" value="0"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveCaja()">Crear Caja</button>
  `);
}
function saveCaja(){
  const nombre=document.getElementById('m-caja-nombre').value.trim();if(!nombre)return;
  const caja = {id:uid(),nombre,saldo:parseFloat(document.getElementById('m-caja-saldo').value)||0,estado:'abierta',apertura:today()};
  state.cajas.push(caja);
  saveRecord('cajas', caja.id, caja);
  closeModal();renderTesCajas();
}
function cerrarCaja(id){
  const c=(state.cajas||[]).find(x=>x.id===id);
  if(c){
    c.estado='cerrada'; 
    saveRecord('cajas', c.id, c);
    renderTesCajas();notify('success','🔒','Caja cerrada',c.nombre+' · Saldo: '+fmt(c.saldo),{duration:3000});
  }
}
function abrirCaja(id){
  const c=(state.cajas||[]).find(x=>x.id===id);
  if(c){
    c.estado='abierta'; c.apertura=today(); 
    saveRecord('cajas', c.id, c);
    renderTesCajas();
  }
}

function saveMovCaja(cajaId, tipo) {
  const valor = parseFloat(document.getElementById('m-mov-valor').value) || 0; 
  if (valor <= 0) return;
  const concepto = document.getElementById('m-mov-concepto').value.trim();
  const metodo = document.getElementById('m-mov-metodo').value;
  const caja = (state.cajas || []).find(c => c.id === cajaId); 
  if (!caja) return;
  
  if (tipo === 'ingreso') caja.saldo += valor; else caja.saldo -= valor;
  const mov = { id: uid(), cajaId, tipo, valor, concepto, fecha: today(), metodo };
  state.tes_movimientos.push(mov);
  
  saveRecord('cajas', caja.id, caja);
  saveRecord('tes_movimientos', mov.id, mov);
  
  closeModal();
  renderTesCajas();
  notify('success', '✅', tipo === 'ingreso' ? 'Ingreso' : 'Egreso', fmt(valor) + ' · ' + concepto, { duration: 3000 });
}

function renderTesDinero(){
  const movs=[...(state.tes_movimientos||[])].reverse();
  document.getElementById('tes_dinero-content').innerHTML=`
    <div class="card"><div class="card-title">MOVIMIENTOS DE DINERO (${movs.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Caja</th><th>Tipo</th><th>Valor</th><th>Concepto</th><th>Método</th></tr></thead><tbody>
    ${movs.map(m=>{const caja=(state.cajas||[]).find(c=>c.id===m.cajaId);return`<tr><td>${formatDate(m.fecha)}</td><td>${caja?.nombre||'—'}</td><td><span class="badge ${m.tipo==='ingreso'?'badge-ok':'badge-pend'}">${m.tipo}</span></td><td style="color:${m.tipo==='ingreso'?'var(--green)':'var(--red)'};font-weight:700">${fmt(m.valor)}</td><td>${m.concepto||'—'}</td><td>${m.metodo||'—'}</td></tr>`}).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin movimientos</td></tr>'}
    </tbody></table></div></div>`;
}

// GENERIC SIMPLE RENDERERS FOR TESORERÍA SUB-MODULES
function renderSimpleCollection(pageId,title,collection,columns){
  const items=[...(state[collection]||[])].reverse();
  const el=document.getElementById(pageId+'-content');if(!el)return;
  el.innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openSimpleFormModal('${collection}','${title}',${JSON.stringify(columns).replace(/"/g,"'")})">+ Nuevo</button>
    <div class="card"><div class="card-title">${title.toUpperCase()} (${items.length})</div>
    <div class="table-wrap"><table><thead><tr>${columns.map(c=>'<th>'+c.split(':')[2]+'</th>').join('')}<th></th></tr></thead><tbody>
    ${items.map(item=>`<tr>${columns.map(c=>{const key=c.split(':')[0];const type=c.split(':')[1];const val=item[key];return type==='number'?`<td style="font-weight:700;color:var(--accent)">${fmt(val||0)}</td>`:`<td>${val||'—'}</td>`}).join('')}<td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('${collection}','${item.id}','${pageId}')">✕</button></td></tr>`).join('')||`<tr><td colspan="${columns.length+1}" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>`}
    </tbody></table></div></div>`;
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
  const item = { id: uid(), fecha: today() };
  
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

