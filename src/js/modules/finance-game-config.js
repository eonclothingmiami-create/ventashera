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

// ===================================================================
// ===== GAMIFICACIÓN & JUEGO =====
// ===================================================================

function renderGamePage(){
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
  const alerts = [];

  // --- Cobros pendientes ---
  const pend = (state.ventas||[]).filter(v => !v.archived && v.canal !== 'vitrina' && !v.liquidado && v.esContraEntrega !== false);
  if(pend.length > 0) alerts.push({
    type: 'warning', icon: '⏳',
    title: `${pend.length} cobro${pend.length>1?'s':''} pendiente${pend.length>1?'s':''}`,
    desc: `Tienes ${fmt(pend.reduce((s,v)=>s+v.valor,0))} por liquidar. Revisa la pestaña Cobros.`,
    action: "showPage('pendientes')", actionLabel: 'Ver cobros'
  });

  // --- Stock crítico ---
  const lowStock = (state.articulos||[]).filter(a => getArticuloStock(a.id) <= a.stockMinimo);
  if(lowStock.length > 0) alerts.push({
    type: 'urgent', icon: '📦',
    title: `Stock crítico en ${lowStock.length} artículo${lowStock.length>1?'s':''}`,
    desc: lowStock.slice(0,3).map(a=>`${a.nombre} (${getArticuloStock(a.id)} uds)`).join(' · ') + (lowStock.length>3?` y ${lowStock.length-3} más`:''),
    action: "showPage('articulos')", actionLabel: 'Ver inventario'
  });

  // --- Deudas a proveedores (diaria) ---
  const _buildProvList = () => {
    const list = (state.usu_proveedores||[]).map(p => {
      const artCredito = (state.articulos||[]).filter(a => a.tituloMercancia === 'credito' && a.proveedorId === p.id);
      const deudaBruta = artCredito.reduce((s,a) => s + ((a.precioCompra||0)*(a.stock||0)), 0);
      const abonos = (state.tes_abonos_prov||[]).filter(ab=>ab.proveedorId===p.id).reduce((s,ab)=>s+(ab.valor||0),0);
      const saldo = Math.max(0, deudaBruta - abonos);
      const fechas = artCredito.map(a=>a.fechaCompra||a.createdAt||'').filter(Boolean).sort();
      const diasDeuda = fechas.length ? Math.round((new Date()-new Date(fechas[0]))/86400000) : 0;
      return { ...p, saldo, diasDeuda, artCredito };
    }).filter(p => p.saldo > 0);
    // Sin especificar
    const sinProv = (state.articulos||[]).filter(a => a.tituloMercancia==='credito' && (!a.proveedorId||a.proveedorId===''));
    const deudaSin = sinProv.reduce((s,a)=>s+((a.precioCompra||0)*(a.stock||0)),0);
    if(deudaSin > 0) list.push({id:'__sin_proveedor__',nombre:'Sin proveedor',saldo:deudaSin,diasDeuda:0,artCredito:sinProv});
    return list;
  };
  const provConDeuda = _buildProvList();

  const totalDeuda = provConDeuda.reduce((s,p)=>s+p.saldo, 0);

  if(provConDeuda.length > 0) {
    // Alerta general de deuda total
    const urgente = provConDeuda.filter(p => p.diasDeuda >= 30);
    alerts.push({
      type: urgente.length > 0 ? 'urgent' : 'warning',
      icon: '🏭',
      title: `Deuda con proveedores: ${fmt(totalDeuda)}`,
      desc: provConDeuda.map(p => `${p.nombre}: ${fmt(p.saldo)}${p.diasDeuda>0?' ('+p.diasDeuda+'d)':''}`).join(' · '),
      action: "showPage('tes_pagos_prov')", actionLabel: 'Ver pagos proveedores'
    });

    // Alertas individuales por proveedor con +30 días
    urgente.forEach(p => {
      alerts.push({
        type: 'urgent', icon: '⚠️',
        title: `${p.nombre} — ${p.diasDeuda} días sin pagar`,
        desc: `Saldo pendiente: ${fmt(p.saldo)}. Esta deuda lleva más de 30 días acumulándose.`,
        action: "showPage('tes_pagos_prov')", actionLabel: 'Abonar ahora'
      });
    });
  }

  return alerts;
}

function renderAlertas(){
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
  const q = (document.getElementById('hist-search')?.value || '').toLowerCase();
  let ventas = (state.ventas || []).slice().reverse();
  if(q) ventas = ventas.filter(v => (v.desc||'').toLowerCase().includes(q) || (v.cliente||'').toLowerCase().includes(q) || (v.guia||'').toLowerCase().includes(q));

  const rowsHtml = ventas.map(v => `
    <tr style="${v.archived ? 'opacity:0.6;' : ''}">
      <td>${formatDate(v.fecha)}</td>
      <td><span class="badge badge-${v.canal}">${v.canal}</span>${v.canal!=='vitrina'?`<span class="badge ${v.esContraEntrega?'badge-warn':'badge-ok'}" style="margin-left:4px;font-size:9px">${v.esContraEntrega?'📦CE':'💵CD'}</span>`:''}</td>
      <td style="font-weight:bold;">${v.desc||'—'}</td>
      <td>${v.cliente||'—'}</td>
      <td style="color:var(--accent);font-weight:700;">${fmt(v.valor)}</td>
      <td><span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'Liquidado':'Pendiente'}</span></td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text2)">Sin historial</td></tr>';

  if(document.getElementById('hist-tbody')) {
    document.getElementById('hist-tbody').innerHTML = rowsHtml;
    const cnt = document.getElementById('hist-count');
    if(cnt) cnt.textContent = ventas.length;
    return;
  }

  document.getElementById('historial-content').innerHTML = `
    <div style="display:flex;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;max-width:400px;margin:0;">
        <span class="search-icon">🔍</span>
        <input type="text" id="hist-search" placeholder="Buscar por # factura, cliente o guía..."
          value="${q}" oninput="renderHistorial()">
      </div>
    </div>
    <div class="card">
      <div class="card-title">HISTORIAL GLOBAL DE VENTAS (<span id="hist-count">${ventas.length}</span>)</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Canal</th><th>Referencia</th><th>Cliente</th><th>Total</th><th>Estado</th></tr></thead>
          <tbody id="hist-tbody">${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

function renderConfig(){
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
  window._cfgTab = tab;
  document.querySelectorAll('#config-content .tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('onclick')?.includes("'"+tab+"'"));
  });
  renderCfgTab(tab);
}

function renderCfgTab(tab) {
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
          <div class="form-group"><label class="form-label">SMMLV 2025</label>
            <input type="number" class="form-control" id="cfg-smmlv" value="${state.cfg_game?.smmlv||1423500}">
          </div>
          <div class="form-group"><label class="form-label">AUX. TRANSPORTE 2025</label>
            <input type="number" class="form-control" id="cfg-auxtrans" value="${state.cfg_game?.aux_trans||200000}">
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
  openModal(`
    <div class="modal-title">+ ${titulo}<button class="modal-close" onclick="closeModal()">×</button></div>
    ${fields.map(f=>{const[key,type,label]=f.split(':');return`<div class="form-group"><label class="form-label">${label}</label><input type="${type==='number'?'number':'text'}" class="form-control" id="cfg-field-${key}"></div>`}).join('')}
    <button class="btn btn-primary" style="width:100%" onclick="guardarCfgItem('${collection}',${JSON.stringify(fields).replace(/"/g,"'")})">Guardar</button>
  `);
}

function abrirCfgModalCat() {
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

async function guardarCfgItem(collection, fields) {
  if(typeof fields === 'string') fields = JSON.parse(fields.replace(/'/g,'"'));
  const item = { id: uid() };
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
  if(!confirm('¿Eliminar este registro?')) return;
  state[collection] = (state[collection]||[]).filter(x=>x.id!==id);
  await deleteRecord(collection, id);
  renderCfgTab(tab);
}

async function toggleCfgActivo(collection, id, tab) {
  const item = (state[collection]||[]).find(x=>x.id===id);
  if(!item) return;
  const field = collection==='cfg_transportadoras' ? 'activa' : 'activo';
  item[field] = !item[field];
  await saveRecord(collection, id, item);
  renderCfgTab(tab);
}

async function eliminarBodega(id) {
  if(!confirm('¿Eliminar esta bodega? Verifica que no tenga inventario activo.')) return;
  state.bodegas = state.bodegas.filter(b=>b.id!==id);
  try { await supabaseClient.from('bodegas').delete().eq('id',id); } catch(e){}
  renderCfgTab('bodegas');
}

async function guardarDiasLiq() {
  state.diasLocal = parseInt(document.getElementById('cfg-dias-local')?.value)||1;
  state.diasInter = parseInt(document.getElementById('cfg-dias-inter')?.value)||5;
  await saveConfig('diasLocal', state.diasLocal);
  await saveConfig('diasInter', state.diasInter);
  notify('success','✅','Tiempos guardados','',{duration:2000});
}

async function guardarCfgGame() {
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
  state.cfg_game = {
    ...state.cfg_game,
    smmlv: parseFloat(document.getElementById('cfg-smmlv')?.value)||1423500,
    aux_trans: parseFloat(document.getElementById('cfg-auxtrans')?.value)||200000,
  };
  await saveConfig('cfg_game', state.cfg_game);
  notify('success','✅','Parámetros guardados','Se aplicarán en el próximo cálculo.',{duration:3000});
}

function eliminarConceptoCfg(id) {
  deleteFromCollection('nom_conceptos', id, 'config');
  renderCfgTab('nomina');
}


function procesarLogoConfig(input) {
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

function forceMonthReset(){
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

function renderSeparados(){
  const desde = document.getElementById('sep-desde')?.value||'';
  const hasta = document.getElementById('sep-hasta')?.value||'';
  const q = (document.getElementById('sep-search')?.value||'').toLowerCase();

  let separados = (state.ventas||[]).filter(v => !v.archived && v.esSeparado);
  if(desde) separados = separados.filter(v => v.fecha >= desde);
  if(hasta) separados = separados.filter(v => v.fecha <= hasta);
  if(q) separados = separados.filter(v => (v.cliente||'').toLowerCase().includes(q) || (v.telefono||'').includes(q) || (v.desc||'').toLowerCase().includes(q));
  separados = separados.reverse();

  const pendientes = separados.filter(v => v.estadoEntrega !== 'Entregado');
  const entregados = separados.filter(v => v.estadoEntrega === 'Entregado');

  const rowsHtml = separados.map(v => `<tr style="${v.estadoEntrega==='Entregado'?'opacity:0.5':''}">
    <td>${formatDate(v.fecha)}</td>
    <td style="font-weight:700;color:var(--text2)">${v.desc||'—'}</td>
    <td style="font-weight:700">${v.cliente||'MOSTRADOR'}</td>
    <td>${v.telefono||'—'}</td>
    <td style="font-size:11px;color:var(--text2)">${(v.items||[]).map(i=>(i.nombre||i.name||'')+(i.talla?' T:'+i.talla:'')).join(', ')||'—'}</td>
    <td style="color:var(--accent);font-weight:700">${fmt(v.valor)}</td>
    <td><span class="badge ${v.estadoEntrega==='Entregado'?'badge-ok':'badge-warn'}">${v.estadoEntrega||'Pendiente'}</span></td>
    <td>${v.estadoEntrega!=='Entregado'
      ?`<button class="btn btn-xs btn-primary" onclick="entregarSeparado('${v.id}')">✓ Entregar</button>`
      :`<button class="btn btn-xs btn-danger" onclick="eliminarSeparado('${v.id}')">🗑</button>`}
    </td>
  </tr>`).join('')||'<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:24px">Sin separados</td></tr>';

  if(document.getElementById('sep-tbody')) {
    document.getElementById('sep-tbody').innerHTML = rowsHtml;
    const p = document.getElementById('sep-pend'); if(p) p.textContent = pendientes.length;
    const e = document.getElementById('sep-entr'); if(e) e.textContent = entregados.length;
    const btnL = document.getElementById('sep-limpiar');
    if(btnL) btnL.style.display=(q||desde||hasta)?'inline-flex':'none';
    return;
  }

  document.getElementById('separados-content').innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;min-width:180px;max-width:280px;margin:0">
        <span class="search-icon">🔍</span>
        <input type="text" id="sep-search" placeholder="Cliente, teléfono..." value="${q}" oninput="renderSeparados()">
      </div>
      <input type="date" class="form-control" id="sep-desde" style="width:140px" value="${desde}" onchange="renderSeparados()">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="sep-hasta" style="width:140px" value="${hasta}" onchange="renderSeparados()">
      <button class="btn btn-xs btn-secondary" id="sep-limpiar" style="display:${(q||desde||hasta)?'inline-flex':'none'}"
        onclick="document.getElementById('sep-search').value='';document.getElementById('sep-desde').value='';document.getElementById('sep-hasta').value='';renderSeparados()">✕ Limpiar</button>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card" style="margin:0;text-align:center">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--yellow)" id="sep-pend">${pendientes.length}</div>
        <div style="font-size:11px;color:var(--text2)">⏳ Pendientes de entrega</div>
      </div>
      <div class="card" style="margin:0;text-align:center">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--green)" id="sep-entr">${entregados.length}</div>
        <div style="font-size:11px;color:var(--text2)">✅ Entregados hoy</div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">🛍️ SEPARADOS (${separados.length})</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Ref</th><th>Cliente</th><th>Teléfono</th><th>Artículos</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead>
        <tbody id="sep-tbody">${rowsHtml}</tbody>
      </table></div>
    </div>`;
}


function entregarSeparado(id) {
  if(!confirm('¿El cliente ya recogió? Se marcará como entregado.')) return;
  const v = state.ventas.find(x => x.id === id);
  if(!v) return;
  v.estadoEntrega = 'Entregado';
  saveRecord('ventas', v.id, v);
  renderSeparados();
  notify('success','📦','¡Entregado!',`${v.cliente||'Cliente'} recogió su pedido.`,{duration:3000});
}

function eliminarSeparado(id) {
  if(!confirm('¿Eliminar este separado del registro?')) return;
  state.ventas = state.ventas.filter(v => v.id !== id);
  deleteRecord('ventas', id);
  renderSeparados();
  notify('success','🗑️','Eliminado','Separado removido del registro.',{duration:2000});
}

// ===================================================================
// ===== INICIALIZACIÓN DEL SISTEMA =====
// ===================================================================

window.onload = () => {
  // Conectar con Supabase y cargar estado
  loadState();
};
  

