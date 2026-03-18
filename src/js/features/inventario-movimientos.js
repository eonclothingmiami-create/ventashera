// ===================================================================
// ===== INVENTORY TRAZABILIDAD =====
// ===================================================================
function renderInvTrazabilidad(){
  const movs=[...(state.inv_movimientos||[])].reverse();
  document.getElementById('inv_trazabilidad-content').innerHTML=`
    <div class="card"><div class="card-title">MOVIMIENTOS DE INVENTARIO (${movs.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>ArtÃ­culo</th><th>Bodega</th><th>Tipo</th><th>Cantidad</th><th>Referencia</th><th>Nota</th></tr></thead><tbody>
    ${movs.map(m=>{const art=(state.articulos||[]).find(a=>a.id===m.articuloId);const bod=(state.bodegas||[]).find(b=>b.id===m.bodegaId);return`<tr><td>${formatDate(m.fecha)}</td><td>${art?.nombre||'â€”'}</td><td>${bod?.name||'â€”'}</td><td><span class="badge ${m.cantidad>0?'badge-ok':'badge-pend'}">${m.tipo}</span></td><td style="color:${m.cantidad>0?'var(--green)':'var(--red)'};font-weight:700">${m.cantidad>0?'+':''}${m.cantidad}</td><td>${m.referencia||'â€”'}</td><td style="color:var(--text2)">${m.nota||'â€”'}</td></tr>`}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin movimientos</td></tr>'}
    </tbody></table></div></div>`;
}

// ===================================================================
// ===== INVENTORY AJUSTES =====
// ===================================================================
function renderInvAjustes(){
  document.getElementById('inv_ajustes-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openAjusteModal()">+ Nuevo Ajuste</button>
    <div class="card"><div class="card-title">AJUSTES DE INVENTARIO</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>ArtÃ­culo</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th></th></tr></thead><tbody>
    ${[...(state.inv_ajustes||[])].reverse().map(a=>{const art=(state.articulos||[]).find(x=>x.id===a.articuloId);return`<tr><td>${formatDate(a.fecha)}</td><td>${art?.nombre||'â€”'}</td><td><span class="badge ${a.tipo==='entrada'?'badge-ok':'badge-pend'}">${a.tipo}</span></td><td style="font-weight:700;color:${a.tipo==='entrada'?'var(--green)':'var(--red)'}">${a.tipo==='entrada'?'+':'âˆ’'}${a.cantidad}</td><td>${a.motivo||'â€”'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarAjuste('${a.id}')">âœ•</button></td></tr>`}).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin ajustes</td></tr>'}
    </tbody></table></div></div>`;
}

async function eliminarAjuste(id) {
  if(!confirm('Â¿Eliminar este ajuste? El stock se revertirÃ¡ automÃ¡ticamente.')) return;
  const a = state.inv_ajustes.find(x => x.id === id);
  if(!a) return;

  try {
    // 1. Revertir stock en Supabase y localmente
    const art = state.articulos.find(x => x.id === a.articuloId);
    if(art) {
      const revert = a.tipo === 'entrada' ? -a.cantidad : a.cantidad;
      const newStock = Math.max(0, (art.stock||0) + revert);
      await supabaseClient.from('products').update({stock: newStock}).eq('id', a.articuloId);
      art.stock = newStock;
    }

    // 2. Borrar de inv_ajustes en Supabase
    await supabaseClient.from('inv_ajustes').delete().eq('id', id);

    // 3. Actualizar estado local
    state.inv_ajustes = state.inv_ajustes.filter(x => x.id !== id);
    const movIndex = state.inv_movimientos.findIndex(m =>
      m.articuloId === a.articuloId && m.tipo === 'ajuste_'+a.tipo && m.nota === a.motivo);
    if(movIndex !== -1) state.inv_movimientos.splice(movIndex, 1);

    renderInvAjustes();
    // Si el artÃ­culo es a crÃ©dito, actualizar pagos proveedores
    if(art?.tituloMercancia === 'credito') {
      if(document.getElementById('tes_pagos_prov-content')) renderTesPagosProv();
      updateNavBadges();
    }
    notify('success','ðŸ—‘ï¸','Ajuste eliminado',`Stock de ${art?.nombre||''} revertido.`,{duration:3000});

  } catch(err) {
    notify('danger','âš ï¸','Error al eliminar', err.message, {duration:5000});
    console.error('eliminarAjuste:', err);
  }
}

function openAjusteModal(){
  openModal(`
    <div class="modal-title">Nuevo Ajuste de Inventario<button class="modal-close" onclick="closeModal()">Ã—</button></div>
    <div class="form-group"><label class="form-label">ARTÃCULO</label><select class="form-control" id="m-aj-art">${(state.articulos||[]).map(a=>'<option value="'+a.id+'">'+a.nombre+' (Stock: '+getArticuloStock(a.id)+')</option>').join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-aj-tipo"><option value="entrada">ðŸ“¥ Entrada</option><option value="salida">ðŸ“¤ Salida</option></select></div>
      <div class="form-group"><label class="form-label">CANTIDAD</label><input type="number" class="form-control" id="m-aj-cant" min="1" value="1"></div>
    </div>
    <div class="form-group"><label class="form-label">BODEGA</label><select class="form-control" id="m-aj-bod">${(state.bodegas||[]).map(b=>'<option value="'+b.id+'">'+b.name+'</option>').join('')}</select></div>
    <div class="form-group"><label class="form-label">MOTIVO</label><input class="form-control" id="m-aj-motivo" placeholder="Motivo del ajuste"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveAjusteInv()">Guardar Ajuste</button>
  `);
}

async function saveAjusteInv() {
  const artId = document.getElementById('m-aj-art').value;
  const tipo = document.getElementById('m-aj-tipo').value;
  const cant = parseInt(document.getElementById('m-aj-cant').value) || 0;
  const bodegaId = document.getElementById('m-aj-bod')?.value || 'bodega_main';
  if(!artId) { notify('warning','âš ï¸','Selecciona un artÃ­culo','',{duration:3000}); return; }
  if(cant <= 0) return;

  const motivo = document.getElementById('m-aj-motivo').value.trim() || 'Ajuste manual';
  const qtyFinal = tipo === 'entrada' ? cant : -cant;

  try {
    showLoadingOverlay('connecting');

    // 1. Guardar en inv_ajustes (tabla visible en el ERP)
    const ajuste = {
      id: uid(), articuloId: artId, bodegaId: bodegaId,
      tipo, cantidad: cant, motivo, fecha: today()
    };
    const { error: ajErr } = await supabaseClient.from('inv_ajustes').insert({
      id: ajuste.id, articulo_id: artId, bodega_id: bodegaId,
      tipo, cantidad: cant, motivo, fecha: today()
    });
    if(ajErr) throw ajErr;

    // 2. Actualizar stock en products
    const product = state.articulos.find(a => a.id === artId);
    if(product) {
      const newStock = Math.max(0, (product.stock||0) + qtyFinal);
      const { error: prodErr } = await supabaseClient.from('products')
        .update({ stock: newStock }).eq('id', artId);
      if(prodErr) throw prodErr;
      product.stock = newStock;
    }

    // 3. Actualizar estado local
    if(!state.inv_ajustes) state.inv_ajustes = [];
    state.inv_ajustes.push(ajuste);

    const mov = {
      id: uid(), articuloId: artId, bodegaId: bodegaId,
      cantidad: qtyFinal, tipo: 'ajuste_'+tipo,
      fecha: today(), referencia: 'Ajuste', nota: motivo
    };
    if(!state.inv_movimientos) state.inv_movimientos = [];
    state.inv_movimientos.push(mov);

    closeModal();
    renderInvAjustes();
    if(document.getElementById('art-tbody')) renderArticulosList();

    // Si el artÃ­culo es a crÃ©dito, actualizar pagos proveedores
    if(product?.tituloMercancia === 'credito') {
      if(document.getElementById('tes_pagos_prov-content')) renderTesPagosProv();
      updateNavBadges(); // actualiza alertas de deuda
    }

    showLoadingOverlay('hide');
    notify('success','âœ…','Ajuste guardado',
      `${tipo==='entrada'?'+':'âˆ’'}${cant} unidades Â· Stock actual: ${product?.stock||0}`,
      {duration:3000});

  } catch(err) {
    showLoadingOverlay('hide');
    console.error('Error ajuste:', err);
    notify('danger','âš ï¸','Error', err.message, {duration:5000});
  }
}
// ===================================================================
// ===== INVENTORY TRASLADOS =====
// ===================================================================
function renderInvTraslados(){
  document.getElementById('inv_traslados-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openTrasladoModal()">+ Nuevo Traslado</button>
    <div class="card"><div class="card-title">TRASLADOS</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>ArtÃ­culo</th><th>Origen</th><th>Destino</th><th>Cantidad</th><th>Nota</th><th></th></tr></thead><tbody>
    ${[...(state.inv_traslados||[])].reverse().map(t=>{const art=(state.articulos||[]).find(a=>a.id===t.articuloId);const o=(state.bodegas||[]).find(b=>b.id===t.origenId);const d=(state.bodegas||[]).find(b=>b.id===t.destinoId);return`<tr><td>${formatDate(t.fecha)}</td><td>${art?.nombre||'â€”'}</td><td>${o?.name||'â€”'}</td><td>${d?.name||'â€”'}</td><td style="font-weight:700">${t.cantidad}</td><td>${t.nota||'â€”'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarTraslado('${t.id}')">âœ•</button></td></tr>`}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin traslados</td></tr>'}
    </tbody></table></div></div>`;
}

async function eliminarTraslado(id) {
  if(!confirm('Â¿Eliminar este traslado? Las prendas volverÃ¡n automÃ¡ticamente a su bodega de origen.')) return;
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
  notify('success', 'ðŸ—‘ï¸', 'Traslado revertido', 'Inventario actualizado.');
}

function openTrasladoModal(){
  openModal(`
    <div class="modal-title">Nuevo Traslado<button class="modal-close" onclick="closeModal()">Ã—</button></div>
    <div class="form-group"><label class="form-label">ARTÃCULO</label><select class="form-control" id="m-tr-art">${(state.articulos||[]).map(a=>'<option value="'+a.id+'">'+a.nombre+'</option>').join('')}</select></div>
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
  const artId = document.getElementById('m-tr-art').value;
  const origId = document.getElementById('m-tr-orig').value;
  const destId = document.getElementById('m-tr-dest').value;
  const cant = parseInt(document.getElementById('m-tr-cant').value) || 0;
  
  if(cant <= 0 || origId === destId) { notify('warning','âš ï¸','Error','Verifica los datos.',{duration:3000}); return; }
  
  const stockOrig = getArticuloStock(artId, origId);
  if(stockOrig < cant) { notify('warning','âš ï¸','Sin stock','No hay suficiente stock en la bodega origen.',{duration:3000}); return; }
  
  const nota = document.getElementById('m-tr-nota').value.trim();
  const traslado = {id: uid(), articuloId: artId, origenId: origId, destinoId: destId, cantidad: cant, nota, fecha: today()};
  const movSalida = {id: uid(), articuloId: artId, bodegaId: origId, cantidad: -cant, tipo: 'traslado_salida', fecha: today(), referencia: 'Traslado', nota};
  const movEntrada = {id: uid(), articuloId: artId, bodegaId: destId, cantidad: cant, tipo: 'traslado_entrada', fecha: today(), referencia: 'Traslado', nota};
  
  state.inv_traslados.push(traslado);
  state.inv_movimientos.push(movSalida);
  state.inv_movimientos.push(movEntrada);
  
  await saveRecord('inv_traslados', traslado.id, traslado);
  // inv_movimientos no tiene tabla propia en Supabase, se reconstruye de ajustes/traslados
  
  closeModal();
  renderInvTraslados();
  notify('success','âœ…','Traslado realizado',`${cant} unidades movidas`,{duration:3000});
}
