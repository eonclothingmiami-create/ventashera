// Inventory module: trazabilidad, ajustes, traslados.
(function initInventoryModule(global) {
  let _invTrFilt = { desde: null, hasta: null, artId: '', provId: '', bodegaId: '', tipo: '' };

  function normFechaInv(f) {
    if (f == null || f === '') return '';
    const s = String(f);
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  function matchInvTipo(m, tipoFilt) {
    if (!tipoFilt) return true;
    if (tipoFilt === 'traslado') return m.tipo === 'traslado_salida' || m.tipo === 'traslado_entrada';
    return m.tipo === tipoFilt;
  }

  function renderInvTrazabilidad(ctx) {
    const { state, formatDate, today } = ctx;
    const t = typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10);
    const desdeEl = document.getElementById('inv-tr-desde');
    const hastaEl = document.getElementById('inv-tr-hasta');
    if (desdeEl) _invTrFilt.desde = desdeEl.value || t;
    if (hastaEl) _invTrFilt.hasta = hastaEl.value || t;
    if (_invTrFilt.desde == null) _invTrFilt.desde = t;
    if (_invTrFilt.hasta == null) _invTrFilt.hasta = t;
    let desde = _invTrFilt.desde;
    let hasta = _invTrFilt.hasta;
    if (desde > hasta) {
      const x = desde;
      desde = hasta;
      hasta = x;
      _invTrFilt.desde = desde;
      _invTrFilt.hasta = hasta;
    }

    const artEl = document.getElementById('inv-tr-art');
    const provEl = document.getElementById('inv-tr-prov');
    const bodEl = document.getElementById('inv-tr-bod');
    const tipoEl = document.getElementById('inv-tr-tipo');
    if (artEl) _invTrFilt.artId = artEl.value || '';
    if (provEl) _invTrFilt.provId = provEl.value || '';
    if (bodEl) _invTrFilt.bodegaId = bodEl.value || '';
    if (tipoEl) _invTrFilt.tipo = tipoEl.value || '';

    const movs = [...(state.inv_movimientos || [])]
      .filter((m) => {
        const d = normFechaInv(m.fecha);
        if (d < desde || d > hasta) return false;
        if (_invTrFilt.artId && String(m.articuloId) !== String(_invTrFilt.artId)) return false;
        if (_invTrFilt.bodegaId && String(m.bodegaId) !== String(_invTrFilt.bodegaId)) return false;
        if (!matchInvTipo(m, _invTrFilt.tipo)) return false;
        if (_invTrFilt.provId) {
          const art = (state.articulos || []).find((a) => String(a.id) === String(m.articuloId));
          if (!art || String(art.proveedorId || '') !== String(_invTrFilt.provId)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const da = normFechaInv(a.fecha);
        const db = normFechaInv(b.fecha);
        if (da !== db) return db.localeCompare(da);
        return String(b.id || '').localeCompare(String(a.id || ''));
      });

    const arts = state.articulos || [];
    const provs = state.usu_proveedores || [];
    const bods = state.bodegas || [];
    const optArt =
      `<option value="" ${_invTrFilt.artId ? '' : 'selected'}>Artículo</option>` +
      arts.map((a) => `<option value="${a.id}" ${_invTrFilt.artId && String(a.id) === String(_invTrFilt.artId) ? 'selected' : ''}>${String(a.nombre || a.id).replace(/</g, '&lt;')}</option>`).join('');
    const optProv =
      `<option value="" ${_invTrFilt.provId ? '' : 'selected'}>Proveedor</option>` +
      provs.map((p) => `<option value="${p.id}" ${_invTrFilt.provId && String(p.id) === String(_invTrFilt.provId) ? 'selected' : ''}>${String(p.nombre || p.id).replace(/</g, '&lt;')}</option>`).join('');
    const optBod =
      `<option value="" ${_invTrFilt.bodegaId ? '' : 'selected'}>Bodega</option>` +
      bods.map((b) => `<option value="${b.id}" ${_invTrFilt.bodegaId && String(b.id) === String(_invTrFilt.bodegaId) ? 'selected' : ''}>${String(b.name || b.id).replace(/</g, '&lt;')}</option>`).join('');

    const sel = (val, cur) => (cur === val ? 'selected' : '');
    const optTipo = `<option value="" ${_invTrFilt.tipo ? '' : 'selected'}>Tipo</option>
      <option value="ajuste_entrada" ${sel('ajuste_entrada', _invTrFilt.tipo)}>Ajuste · entrada</option>
      <option value="ajuste_salida" ${sel('ajuste_salida', _invTrFilt.tipo)}>Ajuste · salida</option>
      <option value="ajuste_devolucion" ${sel('ajuste_devolucion', _invTrFilt.tipo)}>Ajuste · devolución</option>
      <option value="traslado" ${sel('traslado', _invTrFilt.tipo)}>Traslado</option>
      <option value="traslado_salida" ${sel('traslado_salida', _invTrFilt.tipo)}>Traslado · salida</option>
      <option value="traslado_entrada" ${sel('traslado_entrada', _invTrFilt.tipo)}>Traslado · entrada</option>
      <option value="venta" ${sel('venta', _invTrFilt.tipo)}>Venta</option>`;

    const rows =
      movs
        .map((m) => {
          const art = (state.articulos || []).find((a) => a.id === m.articuloId);
          const bod = (state.bodegas || []).find((b) => b.id === m.bodegaId);
          return `<tr><td>${formatDate(m.fecha)}</td><td>${art?.nombre || '—'}</td><td>${bod?.name || '—'}</td><td><span class="badge ${m.cantidad > 0 ? 'badge-ok' : 'badge-pend'}">${m.tipo}</span></td><td style="color:${m.cantidad > 0 ? 'var(--green)' : 'var(--red)'};font-weight:700">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td><td>${m.referencia || '—'}</td><td style="color:var(--text2)">${m.nota || '—'}</td></tr>`;
        })
        .join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin movimientos</td></tr>';

    document.getElementById('inv_trazabilidad-content').innerHTML = `
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">
      <div class="form-group" style="margin:0"><label class="form-label">Desde</label><input type="date" class="form-control" id="inv-tr-desde" value="${desde}"></div>
      <div class="form-group" style="margin:0"><label class="form-label">Hasta</label><input type="date" class="form-control" id="inv-tr-hasta" value="${hasta}"></div>
      <div class="form-group" style="margin:0"><label class="form-label">Artículo</label><select class="form-control" id="inv-tr-art" style="min-width:160px;max-width:220px">${optArt}</select></div>
      <div class="form-group" style="margin:0"><label class="form-label">Proveedor</label><select class="form-control" id="inv-tr-prov" style="min-width:140px;max-width:200px">${optProv}</select></div>
      <div class="form-group" style="margin:0"><label class="form-label">Bodega</label><select class="form-control" id="inv-tr-bod" style="min-width:130px">${optBod}</select></div>
      <div class="form-group" style="margin:0"><label class="form-label">Tipo</label><select class="form-control" id="inv-tr-tipo" style="min-width:150px">${optTipo}</select></div>
      <button type="button" class="btn btn-secondary" onclick="renderInvTrazabilidad()">Filtrar</button>
    </div>
    <div class="card"><div class="card-title">MOVIMIENTOS DE INVENTARIO (${movs.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Bodega</th><th>Tipo</th><th>Cantidad</th><th>Referencia</th><th>Nota</th></tr></thead><tbody>
    ${rows}
    </tbody></table></div></div>`;
  }

  function buildAjustesVistaRows(state) {
    const list = state.inv_ajustes || [];
    const lotes = state.inv_ajustes_lotes || [];
    const lotesMap = Object.fromEntries(lotes.map((l) => [String(l.id), l]));
    const byLote = new Map();
    const singles = [];
    for (const a of list) {
      if (a.loteId) {
        const k = String(a.loteId);
        if (!byLote.has(k)) byLote.set(k, []);
        byLote.get(k).push(a);
      } else singles.push(a);
    }
    const rows = [];
    for (const [lid, lines] of byLote) {
      const lote = lotesMap[lid];
      rows.push({ kind: 'lote', loteId: lid, lote: lote || null, lines });
    }
    for (const a of singles) {
      rows.push({ kind: 'single', line: a });
    }
    rows.sort((x, y) => {
      const fx = x.kind === 'lote' ? (x.lines[0] && x.lines[0].fecha) || '' : x.line.fecha;
      const fy = y.kind === 'lote' ? (y.lines[0] && y.lines[0].fecha) || '' : y.line.fecha;
      return String(fy || '').localeCompare(String(fx || ''));
    });
    return rows;
  }

  function renderInvAjustes(ctx) {
    const { state, formatDate } = ctx;
    const vista = buildAjustesVistaRows(state);
    const tbody =
      vista
        .map((row) => {
          if (row.kind === 'single') {
            const a = row.line;
            const art = (state.articulos || []).find((x) => x.id === a.articuloId);
            const pos = a.tipo === 'entrada' || a.tipo === 'devolucion';
            return (
              `<tr><td>${formatDate(a.fecha)}</td><td>${art?.nombre || '—'}</td><td><span class="badge ${pos ? 'badge-ok' : 'badge-pend'}">${a.tipo}</span></td>` +
              `<td style="font-weight:700;color:${pos ? 'var(--green)' : 'var(--red)'}">${pos ? '+' : '−'}${a.cantidad}</td><td>${a.motivo || '—'}</td>` +
              `<td><button class="btn btn-xs btn-danger" onclick="eliminarAjuste('${a.id}')">✕</button></td></tr>`
            );
          }
          const lines = row.lines || [];
          const lote = row.lote;
          const fecha = (lote && lote.fecha) || (lines[0] && lines[0].fecha);
          const motivo = (lote && lote.motivo) || (lines[0] && lines[0].motivo) || '—';
          const detalle = lines
            .map((l) => {
              const art = (state.articulos || []).find((x) => x.id === l.articuloId);
              const pos = l.tipo === 'entrada' || l.tipo === 'devolucion';
              const sign = pos ? '+' : '−';
              return `<div class="aj-lote-line">${art?.nombre || '—'} · <span class="badge ${pos ? 'badge-ok' : 'badge-pend'}">${l.tipo}</span> · <span style="font-weight:700;color:${pos ? 'var(--green)' : 'var(--red)'}">${sign}${l.cantidad}</span></div>`;
            })
            .join('');
          return (
            `<tr><td>${formatDate(fecha)}</td><td colspan="3" style="vertical-align:top;padding-top:10px"><div style="font-size:11px;line-height:1.45;color:var(--text)">${detalle}</div>` +
            `<div style="font-size:10px;color:var(--text2);margin-top:6px">Lote · ${lines.length} línea(s)</div></td>` +
            `<td>${motivo}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarAjusteLote('${row.loteId}')">✕ Eliminar lote</button></td></tr>`
          );
        })
        .join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin ajustes</td></tr>';
    document.getElementById('inv_ajustes-content').innerHTML = `
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openAjusteModal()">+ Nuevo Ajuste</button>
    <div class="card"><div class="card-title">AJUSTES DE INVENTARIO</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo / detalle</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th></th></tr></thead><tbody>
    ${tbody}
    </tbody></table></div></div>`;
  }

  async function eliminarAjusteLote(ctx) {
    const { state, loteId, confirm, supabaseClient, renderInvAjustes, renderTesPagosProv, updateNavBadges, notify } = ctx;
    const lines = (state.inv_ajustes || []).filter((x) => String(x.loteId) === String(loteId));
    if (lines.length === 0) return;
    if (
      !confirm(
        `¿Eliminar todo el lote (${lines.length} línea${lines.length === 1 ? '' : 's'})? El stock y las devoluciones asociadas se revertirán.`
      )
    ) {
      return;
    }
    let anyCreditoOrDev = false;
    try {
      for (const a of lines) {
        const art = state.articulos.find((x) => String(x.id) === String(a.articuloId));
        if (art) {
          const revert = a.tipo === 'entrada' || a.tipo === 'devolucion' ? -a.cantidad : a.cantidad;
          const newStock = Math.max(0, (art.stock || 0) + revert);
          await supabaseClient.from('products').update({ stock: newStock }).eq('id', a.articuloId);
          art.stock = newStock;
        }
        if (a.tipo === 'devolucion') {
          const dv = (state.tes_devoluciones_prov || []).find((x) => String(x.invAjusteId) === String(a.id));
          if (dv) {
            if (global.AppTreasuryModule?.deleteCxpMirrorDevolucion) {
              await global.AppTreasuryModule.deleteCxpMirrorDevolucion(state, supabaseClient, dv.id);
            }
            await supabaseClient.from('tes_devoluciones_prov').delete().eq('id', dv.id);
            state.tes_devoluciones_prov = (state.tes_devoluciones_prov || []).filter((x) => x.id !== dv.id);
          }
        }
        const movIndex = state.inv_movimientos.findIndex(
          (m) => m.articuloId === a.articuloId && m.tipo === 'ajuste_' + a.tipo && m.nota === a.motivo
        );
        if (movIndex !== -1) state.inv_movimientos.splice(movIndex, 1);
        if (art?.tituloMercancia === 'credito' || a.tipo === 'devolucion') anyCreditoOrDev = true;
      }
      await supabaseClient.from('inv_ajustes').delete().eq('lote_id', loteId);
      await supabaseClient.from('inv_ajustes_lotes').delete().eq('id', loteId);
      state.inv_ajustes = (state.inv_ajustes || []).filter((x) => String(x.loteId) !== String(loteId));
      state.inv_ajustes_lotes = (state.inv_ajustes_lotes || []).filter((x) => String(x.id) !== String(loteId));
      renderInvAjustes();
      if (anyCreditoOrDev) {
        if (document.getElementById('tes_pagos_prov-content')) renderTesPagosProv();
        updateNavBadges();
      }
      notify('success', '🗑️', 'Lote eliminado', 'Ajustes y stock revertidos.', { duration: 3500 });
    } catch (err) {
      notify('danger', '⚠️', 'Error al eliminar lote', err.message, { duration: 5000 });
      console.error('eliminarAjusteLote:', err);
    }
  }

  async function eliminarAjuste(ctx) {
    const { state, id, confirm, supabaseClient, renderInvAjustes, renderTesPagosProv, updateNavBadges, notify } = ctx;
    const a = state.inv_ajustes.find((x) => x.id === id);
    if (!a) return;
    if (a.loteId) {
      return eliminarAjusteLote({ state, loteId: a.loteId, confirm, supabaseClient, renderInvAjustes, renderTesPagosProv, updateNavBadges, notify });
    }
    if (!confirm('¿Eliminar este ajuste? El stock se revertirá automáticamente.')) return;
    try {
      const art = state.articulos.find((x) => String(x.id) === String(a.articuloId));
      if (art) {
        const revert = a.tipo === 'entrada' || a.tipo === 'devolucion' ? -a.cantidad : a.cantidad;
        const newStock = Math.max(0, (art.stock || 0) + revert);
        await supabaseClient.from('products').update({ stock: newStock }).eq('id', a.articuloId);
        art.stock = newStock;
      }
      if (a.tipo === 'devolucion') {
        const dv = (state.tes_devoluciones_prov || []).find((x) => String(x.invAjusteId) === String(a.id));
        if (dv) {
          if (global.AppTreasuryModule?.deleteCxpMirrorDevolucion) {
            await global.AppTreasuryModule.deleteCxpMirrorDevolucion(state, supabaseClient, dv.id);
          }
          await supabaseClient.from('tes_devoluciones_prov').delete().eq('id', dv.id);
          state.tes_devoluciones_prov = (state.tes_devoluciones_prov || []).filter((x) => x.id !== dv.id);
        }
      }
      await supabaseClient.from('inv_ajustes').delete().eq('id', id);
      state.inv_ajustes = state.inv_ajustes.filter((x) => x.id !== id);
      const movIndex = state.inv_movimientos.findIndex((m) => m.articuloId === a.articuloId && m.tipo === 'ajuste_' + a.tipo && m.nota === a.motivo);
      if (movIndex !== -1) state.inv_movimientos.splice(movIndex, 1);
      renderInvAjustes();
      if (art?.tituloMercancia === 'credito' || a.tipo === 'devolucion') {
        if (document.getElementById('tes_pagos_prov-content')) renderTesPagosProv();
        updateNavBadges();
      }
      notify('success', '🗑️', 'Ajuste eliminado', `Stock de ${art?.nombre || ''} revertido.`, { duration: 3000 });
    } catch (err) {
      notify('danger', '⚠️', 'Error al eliminar', err.message, { duration: 5000 });
      console.error('eliminarAjuste:', err);
    }
  }

  function buildAjusteLineaRowHtml(artOptionsHtml) {
    return (
      '<div class="ajuste-linea" style="display:grid;grid-template-columns:1fr minmax(130px,0.9fr) 72px 34px;gap:8px;align-items:end;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)">' +
      '<div class="form-group" style="margin:0"><label class="form-label" style="font-size:10px">Artículo</label><select class="form-control m-aj-art">' +
      artOptionsHtml +
      '</select></div>' +
      '<div class="form-group" style="margin:0"><label class="form-label" style="font-size:10px">Tipo</label><select class="form-control m-aj-tipo">' +
      '<option value="entrada">📥 Entrada</option><option value="salida">📤 Salida</option><option value="devolucion">↩️ Devolución</option>' +
      '</select></div>' +
      '<div class="form-group" style="margin:0"><label class="form-label" style="font-size:10px">Cant.</label>' +
      '<input type="number" class="form-control m-aj-cant" min="1" value="1"></div>' +
      '<button type="button" class="btn btn-xs btn-danger" style="height:34px;padding:0 6px" onclick="window.AppInventoryModule.removeAjusteLinea(this)" title="Quitar línea">✕</button>' +
      '</div>'
    );
  }

  function addAjusteLinea() {
    const opts = global._ajusteArtOptionsHtml || '';
    const container = global.document.getElementById('ajuste-lineas');
    if (!container || !opts) return;
    const wrap = global.document.createElement('div');
    wrap.innerHTML = buildAjusteLineaRowHtml(opts);
    const node = wrap.firstElementChild;
    if (node) container.appendChild(node);
  }

  function removeAjusteLinea(btn) {
    const container = global.document.getElementById('ajuste-lineas');
    if (!container) return;
    const rows = container.querySelectorAll('.ajuste-linea');
    if (rows.length <= 1) {
      if (typeof global.notify === 'function') {
        global.notify('warning', '⚠️', 'Ajuste', 'Debe quedar al menos una línea de artículo.', { duration: 2500 });
      }
      return;
    }
    const row = btn.closest('.ajuste-linea');
    if (row) row.remove();
  }

  function openAjusteModal(ctx) {
    const { state, openModal, getArticuloStock } = ctx;
    const artOptionsHtml = (state.articulos || [])
      .map((a) => '<option value="' + a.id + '">' + a.nombre + ' (Stock: ' + getArticuloStock(a.id) + ')</option>')
      .join('');
    global._ajusteArtOptionsHtml = artOptionsHtml;
    const primeraLinea = buildAjusteLineaRowHtml(artOptionsHtml);
    openModal(`
    <div class="modal-title">Nuevo Ajuste de Inventario<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);margin:0 0 10px;line-height:1.4">Podés agregar <b>varias líneas</b> (artículo + tipo + cantidad) y guardar un solo movimiento con el mismo motivo y bodega.</p>
    <div id="ajuste-lineas" style="max-height:min(42vh,320px);overflow-y:auto;padding-right:4px;margin-bottom:8px">
      ${primeraLinea}
    </div>
    <button type="button" class="btn btn-secondary btn-sm" style="width:100%;margin-bottom:12px" onclick="window.AppInventoryModule.addAjusteLinea()">+ Añadir otro artículo</button>
    <div class="form-group"><label class="form-label">BODEGA (todas las líneas)</label><select class="form-control" id="m-aj-bod">${(state.bodegas || []).map((b) => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
    <div class="form-group"><label class="form-label">MOTIVO (común)</label><input class="form-control" id="m-aj-motivo" placeholder="Ej. Devolución al proveedor, merma, hallazgo…"></div>
    <p style="font-size:10px;color:var(--text2);margin:-4px 0 0;line-height:1.45">📌 <b>Devolución</b>: suma al stock; si el artículo es <b>a crédito</b> con <b>proveedor</b>, también registra reducción de deuda (costo × cantidad) en Pagos a proveedores. <b>Salida</b> reduce stock físico.</p>
    <button class="btn btn-primary" style="width:100%" onclick="saveAjusteInv()">Guardar ajuste(s)</button>
  `);
  }

  async function saveAjusteInv(ctx) {
    const { state, notify, showLoadingOverlay, supabaseClient, uid, dbId, today, closeModal, renderInvAjustes, renderArticulosList, renderTesPagosProv, updateNavBadges } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const doc = global.document;
    const bodegaId = doc.getElementById('m-aj-bod')?.value || 'bodega_main';
    const motivo = (doc.getElementById('m-aj-motivo')?.value || '').trim() || 'Ajuste manual';

    const lineas = [];
    const container = doc.getElementById('ajuste-lineas');
    if (container) {
      container.querySelectorAll('.ajuste-linea').forEach((row) => {
        const artSel = row.querySelector('.m-aj-art');
        const tipoSel = row.querySelector('.m-aj-tipo');
        const cantInp = row.querySelector('.m-aj-cant');
        const artId = artSel ? artSel.value : '';
        const tipo = tipoSel ? tipoSel.value : 'entrada';
        const cant = parseInt(cantInp ? cantInp.value : '0', 10) || 0;
        if (artId && cant > 0) lineas.push({ artId, tipo, cant });
      });
    }
    if (lineas.length === 0) {
      const legacyArt = doc.getElementById('m-aj-art');
      const legacyTipo = doc.getElementById('m-aj-tipo');
      const legacyCant = doc.getElementById('m-aj-cant');
      if (legacyArt && legacyTipo && legacyCant) {
        const artId = legacyArt.value;
        const tipo = legacyTipo.value;
        const cant = parseInt(legacyCant.value, 10) || 0;
        if (artId && cant > 0) lineas.push({ artId, tipo, cant });
      }
    }
    if (lineas.length === 0) {
      notify('warning', '⚠️', 'Sin líneas válidas', 'Agrega al menos un artículo con cantidad mayor a 0.', { duration: 3500 });
      return;
    }

    let anyCreditoOrDev = false;
    const fechaStr = today();
    const loteId = nextId();

    async function rollbackLoteSave(completed) {
      for (let i = completed.length - 1; i >= 0; i--) {
        const c = completed[i];
        const { product, artId, tipo, cant, devId } = c;
        if (product) {
          const revert = tipo === 'entrada' || tipo === 'devolucion' ? -cant : cant;
          const newStock = Math.max(0, (product.stock || 0) + revert);
          await supabaseClient.from('products').update({ stock: newStock }).eq('id', artId);
          product.stock = newStock;
        }
        if (devId) {
          if (global.AppTreasuryModule?.deleteCxpMirrorDevolucion) {
            try {
              await global.AppTreasuryModule.deleteCxpMirrorDevolucion(state, supabaseClient, devId);
            } catch (_) { /* noop */ }
          }
          try {
            await supabaseClient.from('tes_devoluciones_prov').delete().eq('id', devId);
          } catch (_) { /* noop */ }
          state.tes_devoluciones_prov = (state.tes_devoluciones_prov || []).filter((x) => x.id !== devId);
        }
      }
      try {
        await supabaseClient.from('inv_ajustes').delete().eq('lote_id', loteId);
      } catch (_) { /* noop */ }
      try {
        await supabaseClient.from('inv_ajustes_lotes').delete().eq('id', loteId);
      } catch (_) { /* noop */ }
    }

    try {
      showLoadingOverlay('connecting');
      const { error: loteErr } = await supabaseClient.from('inv_ajustes_lotes').insert({
        id: loteId,
        bodega_id: bodegaId,
        motivo,
        fecha: fechaStr
      });
      if (loteErr) throw loteErr;

      const completed = [];
      const pendingAjustes = [];
      const pendingMovs = [];
      let okCount = 0;
      for (let li = 0; li < lineas.length; li++) {
        const { artId, tipo, cant } = lineas[li];
        const product = (state.articulos || []).find((a) => String(a.id) === String(artId));
        if (!product) {
          await rollbackLoteSave(completed);
          throw new Error('Artículo no encontrado en estado local. Recarga e intenta de nuevo.');
        }
        const qtyFinal = tipo === 'entrada' || tipo === 'devolucion' ? cant : -cant;
        const ajuste = { id: nextId(), articuloId: artId, bodegaId, tipo, cantidad: cant, motivo, fecha: fechaStr, loteId };
        let devId = null;
        const { error: ajErr } = await supabaseClient.from('inv_ajustes').insert({
          id: ajuste.id,
          articulo_id: artId,
          bodega_id: bodegaId,
          tipo,
          cantidad: cant,
          motivo,
          fecha: fechaStr,
          lote_id: loteId
        });
        if (ajErr) {
          await rollbackLoteSave(completed);
          throw ajErr;
        }
        const newStock = Math.max(0, (product.stock || 0) + qtyFinal);
        const { error: prodErr } = await supabaseClient.from('products').update({ stock: newStock }).eq('id', artId);
        if (prodErr) {
          await rollbackLoteSave(completed);
          throw prodErr;
        }
        product.stock = newStock;

        if (tipo === 'devolucion' && product.tituloMercancia === 'credito' && product.proveedorId) {
          const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(product.proveedorId));
          const provNombre = prov?.nombre || product.proveedorNombre || '';
          const costoUnit = parseFloat(product.precioCompra) || parseFloat(product.cost) || 0;
          const valorCosto = costoUnit * cant;
          devId = nextId();
          const notaDv = `Devolución inventario · ${product.nombre || artId} · ${motivo}`;
          const fh = new Date().toISOString();
          const { error: dErr } = await supabaseClient.from('tes_devoluciones_prov').insert({
            id: devId,
            proveedor_id: product.proveedorId,
            proveedor_nombre: provNombre,
            articulo_id: artId,
            cantidad: cant,
            valor_costo: valorCosto,
            inv_ajuste_id: ajuste.id,
            nota: notaDv,
            fecha: fechaStr,
            fecha_hora: fh
          });
          if (dErr) {
            console.warn('[devoluciones_prov]', dErr.message);
            devId = null;
          } else {
            if (!state.tes_devoluciones_prov) state.tes_devoluciones_prov = [];
            state.tes_devoluciones_prov.unshift({
              id: devId,
              proveedorId: product.proveedorId,
              proveedorNombre: provNombre,
              articuloId: artId,
              cantidad: cant,
              valorCosto: valorCosto,
              invAjusteId: ajuste.id,
              nota: notaDv,
              fecha: fechaStr,
              fechaHora: fh
            });
            if (global.AppTreasuryModule?.mirrorDevolucionToCxp) {
              const m = await global.AppTreasuryModule.mirrorDevolucionToCxp(state, supabaseClient, {
                devolucionId: devId,
                proveedorId: product.proveedorId,
                proveedorNombre: provNombre,
                valorCosto,
                fecha: fechaStr,
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
        if (product?.tituloMercancia === 'credito' || tipo === 'devolucion') anyCreditoOrDev = true;

        completed.push({ product, artId, tipo, cant, devId });
        pendingAjustes.push(ajuste);
        pendingMovs.push({
          id: nextId(),
          articuloId: artId,
          bodegaId,
          cantidad: qtyFinal,
          tipo: 'ajuste_' + tipo,
          fecha: fechaStr,
          referencia: 'Ajuste',
          nota: motivo
        });
        okCount += 1;
      }

      if (!state.inv_ajustes) state.inv_ajustes = [];
      if (!state.inv_movimientos) state.inv_movimientos = [];
      pendingAjustes.forEach((a) => state.inv_ajustes.push(a));
      pendingMovs.forEach((m) => state.inv_movimientos.push(m));
      if (!state.inv_ajustes_lotes) state.inv_ajustes_lotes = [];
      state.inv_ajustes_lotes.unshift({ id: loteId, bodegaId, motivo, fecha: fechaStr });

      closeModal();
      renderInvAjustes();
      if (document.getElementById('art-tbody')) renderArticulosList();
      if (anyCreditoOrDev) {
        if (document.getElementById('tes_pagos_prov-content')) renderTesPagosProv();
        updateNavBadges();
      }
      showLoadingOverlay('hide');
      notify(
        'success',
        '✅',
        'Ajustes guardados',
        `1 lote · ${okCount} línea(s) · mismo motivo y bodega.`,
        { duration: 4000 }
      );
    } catch (err) {
      showLoadingOverlay('hide');
      console.error('Error ajuste:', err);
      notify('danger', '⚠️', 'Error', err.message || String(err), { duration: 6000 });
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
    eliminarAjusteLote,
    openAjusteModal,
    addAjusteLinea,
    removeAjusteLinea,
    saveAjusteInv,
    renderInvTraslados,
    eliminarTraslado,
    openTrasladoModal,
    saveTraslado
  };
})(window);
