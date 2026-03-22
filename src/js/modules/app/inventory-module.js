// Inventory module: trazabilidad, ajustes, traslados.
(function initInventoryModule(global) {
  function renderInvTrazabilidad(ctx) {
    const { state, formatDate } = ctx;
    const movs = [...(state.inv_movimientos || [])].reverse();
    document.getElementById('inv_trazabilidad-content').innerHTML = `
    <div class="card"><div class="card-title">MOVIMIENTOS DE INVENTARIO (${movs.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Bodega</th><th>Tipo</th><th>Cantidad</th><th>Referencia</th><th>Nota</th></tr></thead><tbody>
    ${movs.map((m) => { const art = (state.articulos || []).find((a) => a.id === m.articuloId); const bod = (state.bodegas || []).find((b) => b.id === m.bodegaId); return `<tr><td>${formatDate(m.fecha)}</td><td>${art?.nombre || '—'}</td><td>${bod?.name || '—'}</td><td><span class="badge ${m.cantidad > 0 ? 'badge-ok' : 'badge-pend'}">${m.tipo}</span></td><td style="color:${m.cantidad > 0 ? 'var(--green)' : 'var(--red)'};font-weight:700">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td><td>${m.referencia || '—'}</td><td style="color:var(--text2)">${m.nota || '—'}</td></tr>`; }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin movimientos</td></tr>'}
    </tbody></table></div></div>`;
  }

  function renderInvAjustes(ctx) {
    const { state, formatDate } = ctx;
    document.getElementById('inv_ajustes-content').innerHTML = `
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openAjusteModal()">+ Nuevo Ajuste</button>
    <div class="card"><div class="card-title">AJUSTES DE INVENTARIO</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th></th></tr></thead><tbody>
    ${[...(state.inv_ajustes || [])].reverse().map((a) => { const art = (state.articulos || []).find((x) => x.id === a.articuloId); return `<tr><td>${formatDate(a.fecha)}</td><td>${art?.nombre || '—'}</td><td><span class="badge ${a.tipo === 'entrada' ? 'badge-ok' : 'badge-pend'}">${a.tipo}</span></td><td style="font-weight:700;color:${a.tipo === 'entrada' ? 'var(--green)' : 'var(--red)'}">${a.tipo === 'entrada' ? '+' : '−'}${a.cantidad}</td><td>${a.motivo || '—'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarAjuste('${a.id}')">✕</button></td></tr>`; }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin ajustes</td></tr>'}
    </tbody></table></div></div>`;
  }

  async function eliminarAjuste(ctx) {
    const { state, id, confirm, supabaseClient, renderInvAjustes, renderTesPagosProv, updateNavBadges, notify } = ctx;
    if (!confirm('¿Eliminar este ajuste? El stock se revertirá automáticamente.')) return;
    const a = state.inv_ajustes.find((x) => x.id === id);
    if (!a) return;
    try {
      const art = state.articulos.find((x) => String(x.id) === String(a.articuloId));
      if (art) {
        const revert = a.tipo === 'entrada' ? -a.cantidad : a.cantidad;
        const newStock = Math.max(0, (art.stock || 0) + revert);
        await supabaseClient.from('products').update({ stock: newStock }).eq('id', a.articuloId);
        art.stock = newStock;
      }
      await supabaseClient.from('inv_ajustes').delete().eq('id', id);
      state.inv_ajustes = state.inv_ajustes.filter((x) => x.id !== id);
      const movIndex = state.inv_movimientos.findIndex((m) => m.articuloId === a.articuloId && m.tipo === 'ajuste_' + a.tipo && m.nota === a.motivo);
      if (movIndex !== -1) state.inv_movimientos.splice(movIndex, 1);
      renderInvAjustes();
      if (art?.tituloMercancia === 'credito') {
        if (document.getElementById('tes_pagos_prov-content')) renderTesPagosProv();
        updateNavBadges();
      }
      notify('success', '🗑️', 'Ajuste eliminado', `Stock de ${art?.nombre || ''} revertido.`, { duration: 3000 });
    } catch (err) {
      notify('danger', '⚠️', 'Error al eliminar', err.message, { duration: 5000 });
      console.error('eliminarAjuste:', err);
    }
  }

  function openAjusteModal(ctx) {
    const { state, openModal, getArticuloStock } = ctx;
    openModal(`
    <div class="modal-title">Nuevo Ajuste de Inventario<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">ARTÍCULO</label><select class="form-control" id="m-aj-art">${(state.articulos || []).map((a) => '<option value="' + a.id + '">' + a.nombre + ' (Stock: ' + getArticuloStock(a.id) + ')</option>').join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-aj-tipo"><option value="entrada">📥 Entrada</option><option value="salida">📤 Salida</option></select></div>
      <div class="form-group"><label class="form-label">CANTIDAD</label><input type="number" class="form-control" id="m-aj-cant" min="1" value="1"></div>
    </div>
    <div class="form-group"><label class="form-label">BODEGA</label><select class="form-control" id="m-aj-bod">${(state.bodegas || []).map((b) => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
    <div class="form-group"><label class="form-label">MOTIVO</label><input class="form-control" id="m-aj-motivo" placeholder="Ej. Devolución al proveedor, merma, hallazgo…"></div>
    <p style="font-size:10px;color:var(--text2);margin:-4px 0 0;line-height:1.45">📌 <b>Salida</b> (p. ej. devolución al proveedor) <b>reduce stock</b> y la deuda a proveedor en mercancía a crédito <b>por el stock actual</b>, no suma aparte en «vendido».</p>
    <button class="btn btn-primary" style="width:100%" onclick="saveAjusteInv()">Guardar Ajuste</button>
  `);
  }

  async function saveAjusteInv(ctx) {
    const { state, notify, showLoadingOverlay, supabaseClient, uid, dbId, today, closeModal, renderInvAjustes, renderArticulosList, renderTesPagosProv, updateNavBadges } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const artId = document.getElementById('m-aj-art').value;
    const tipo = document.getElementById('m-aj-tipo').value;
    const cant = parseInt(document.getElementById('m-aj-cant').value, 10) || 0;
    const bodegaId = document.getElementById('m-aj-bod')?.value || 'bodega_main';
    if (!artId) { notify('warning', '⚠️', 'Selecciona un artículo', '', { duration: 3000 }); return; }
    if (cant <= 0) return;
    const product = (state.articulos || []).find((a) => String(a.id) === String(artId));
    if (!product) {
      notify('danger', '⚠️', 'Artículo no cargado', 'Recarga la página o vuelve a abrir inventario. No se guardó el ajuste.', { duration: 6000 });
      return;
    }
    const motivo = document.getElementById('m-aj-motivo').value.trim() || 'Ajuste manual';
    const qtyFinal = tipo === 'entrada' ? cant : -cant;
    try {
      showLoadingOverlay('connecting');
      const ajuste = { id: nextId(), articuloId: artId, bodegaId, tipo, cantidad: cant, motivo, fecha: today() };
      const { error: ajErr } = await supabaseClient.from('inv_ajustes').insert({
        id: ajuste.id, articulo_id: artId, bodega_id: bodegaId, tipo, cantidad: cant, motivo, fecha: today()
      });
      if (ajErr) throw ajErr;
      let insertedAjuste = true;
      if (product) {
        const newStock = Math.max(0, (product.stock || 0) + qtyFinal);
        const { error: prodErr } = await supabaseClient.from('products').update({ stock: newStock }).eq('id', artId);
        if (prodErr) {
          // Compensación: evita ajuste huérfano en BD.
          if (insertedAjuste) {
            try { await supabaseClient.from('inv_ajustes').delete().eq('id', ajuste.id); } catch (_) { /* noop */ }
          }
          throw prodErr;
        }
        product.stock = newStock;
      }
      if (!state.inv_ajustes) state.inv_ajustes = [];
      state.inv_ajustes.push(ajuste);
      const mov = { id: nextId(), articuloId: artId, bodegaId, cantidad: qtyFinal, tipo: 'ajuste_' + tipo, fecha: today(), referencia: 'Ajuste', nota: motivo };
      if (!state.inv_movimientos) state.inv_movimientos = [];
      state.inv_movimientos.push(mov);
      closeModal();
      renderInvAjustes();
      if (document.getElementById('art-tbody')) renderArticulosList();
      if (product?.tituloMercancia === 'credito') {
        if (document.getElementById('tes_pagos_prov-content')) renderTesPagosProv();
        updateNavBadges();
      }
      showLoadingOverlay('hide');
      notify('success', '✅', 'Ajuste guardado', `${tipo === 'entrada' ? '+' : '−'}${cant} unidades · Stock actual: ${product?.stock || 0}`, { duration: 3000 });
    } catch (err) {
      showLoadingOverlay('hide');
      console.error('Error ajuste:', err);
      notify('danger', '⚠️', 'Error', err.message, { duration: 5000 });
    }
  }

  function renderInvTraslados(ctx) {
    const { state, formatDate } = ctx;
    document.getElementById('inv_traslados-content').innerHTML = `
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openTrasladoModal()">+ Nuevo Traslado</button>
    <div class="card"><div class="card-title">TRASLADOS</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Origen</th><th>Destino</th><th>Cantidad</th><th>Nota</th><th></th></tr></thead><tbody>
    ${[...(state.inv_traslados || [])].reverse().map((t) => { const art = (state.articulos || []).find((a) => a.id === t.articuloId); const o = (state.bodegas || []).find((b) => b.id === t.origenId); const d = (state.bodegas || []).find((b) => b.id === t.destinoId); return `<tr><td>${formatDate(t.fecha)}</td><td>${art?.nombre || '—'}</td><td>${o?.name || '—'}</td><td>${d?.name || '—'}</td><td style="font-weight:700">${t.cantidad}</td><td>${t.nota || '—'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarTraslado('${t.id}')">✕</button></td></tr>`; }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin traslados</td></tr>'}
    </tbody></table></div></div>`;
  }

  async function eliminarTraslado(ctx) {
    const { state, id, confirm, renderInvTraslados, notify } = ctx;
    if (!confirm('¿Eliminar este traslado? Las prendas volverán automáticamente a su bodega de origen.')) return;
    const t = state.inv_traslados.find((x) => x.id === id);
    if (!t) return;
    const idxSalida = state.inv_movimientos.findIndex((m) => m.articuloId === t.articuloId && m.bodegaId === t.origenId && m.tipo === 'traslado_salida' && m.nota === t.nota);
    if (idxSalida !== -1) state.inv_movimientos.splice(idxSalida, 1);
    const idxEntrada = state.inv_movimientos.findIndex((m) => m.articuloId === t.articuloId && m.bodegaId === t.destinoId && m.tipo === 'traslado_entrada' && m.nota === t.nota);
    if (idxEntrada !== -1) state.inv_movimientos.splice(idxEntrada, 1);
    state.inv_traslados = state.inv_traslados.filter((x) => x.id !== id);
    renderInvTraslados();
    notify('success', '🗑️', 'Traslado revertido', 'Inventario actualizado.');
  }

  function openTrasladoModal(ctx) {
    const { state, openModal } = ctx;
    openModal(`
    <div class="modal-title">Nuevo Traslado<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">ARTÍCULO</label><select class="form-control" id="m-tr-art">${(state.articulos || []).map((a) => '<option value="' + a.id + '">' + a.nombre + '</option>').join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">BODEGA ORIGEN</label><select class="form-control" id="m-tr-orig">${(state.bodegas || []).map((b) => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
      <div class="form-group"><label class="form-label">BODEGA DESTINO</label><select class="form-control" id="m-tr-dest">${(state.bodegas || []).map((b) => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
    </div>
    <div class="form-group"><label class="form-label">CANTIDAD</label><input type="number" class="form-control" id="m-tr-cant" min="1" value="1"></div>
    <div class="form-group"><label class="form-label">NOTA</label><input class="form-control" id="m-tr-nota" placeholder="Nota del traslado"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveTraslado()">Realizar Traslado</button>
  `);
  }

  async function saveTraslado(ctx) {
    const { state, notify, getArticuloStock, uid, dbId, today, saveRecord, closeModal, renderInvTraslados } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const artId = document.getElementById('m-tr-art').value;
    const origId = document.getElementById('m-tr-orig').value;
    const destId = document.getElementById('m-tr-dest').value;
    const cant = parseInt(document.getElementById('m-tr-cant').value, 10) || 0;
    if (cant <= 0 || origId === destId) { notify('warning', '⚠️', 'Error', 'Verifica los datos.', { duration: 3000 }); return; }
    const stockOrig = getArticuloStock(artId, origId);
    if (stockOrig < cant) { notify('warning', '⚠️', 'Sin stock', 'No hay suficiente stock en la bodega origen.', { duration: 3000 }); return; }
    const nota = document.getElementById('m-tr-nota').value.trim();
    const traslado = { id: nextId(), articuloId: artId, origenId: origId, destinoId: destId, cantidad: cant, nota, fecha: today() };
    const movSalida = { id: nextId(), articuloId: artId, bodegaId: origId, cantidad: -cant, tipo: 'traslado_salida', fecha: today(), referencia: 'Traslado', nota };
    const movEntrada = { id: nextId(), articuloId: artId, bodegaId: destId, cantidad: cant, tipo: 'traslado_entrada', fecha: today(), referencia: 'Traslado', nota };
    state.inv_traslados.push(traslado);
    state.inv_movimientos.push(movSalida);
    state.inv_movimientos.push(movEntrada);
    await saveRecord('inv_traslados', traslado.id, traslado);
    closeModal();
    renderInvTraslados();
    notify('success', '✅', 'Traslado realizado', `${cant} unidades movidas`, { duration: 3000 });
  }

  global.AppInventoryModule = {
    renderInvTrazabilidad,
    renderInvAjustes,
    eliminarAjuste,
    openAjusteModal,
    saveAjusteInv,
    renderInvTraslados,
    eliminarTraslado,
    openTrasladoModal,
    saveTraslado
  };
})(window);
