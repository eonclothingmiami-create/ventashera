// Treasury module: pagos proveedores, cajas, movimientos y colecciones simples.
(function initTreasuryModule(global) {
  /**
   * Pasivo vs proveedor (mercancía a crédito) — modelo libro:
   * - compromisoReconocido: Σ tes_compromisos_prov (ingresos a crédito registrados; no se mueve con ventas).
   * - saldo: max(0, compromisoReconocido − abonos). Solo los abonos bajan el saldo oficial.
   * - valorInventarioCosto, costoVendidoHist: referencia operativa (inventario + POS en BD), estilo “separados”.
   */
  function calcDeudaProveedor(state, provId) {
    const esSinEspecificar = provId === '__sin_proveedor__';
    const articulos = (state.articulos || []).filter((a) => {
      if (a.tituloMercancia !== 'credito') return false;
      if (esSinEspecificar) return !a.proveedorId || a.proveedorId === '';
      return a.proveedorId === provId;
    });
    const valorInventarioCosto = articulos.reduce(
      (sum, a) => sum + ((a.precioCompra || 0) * (a.stock || 0)),
      0
    );

    const moves = state.stock_moves_ventas || [];
    let costoVendidoHist = 0;
    let unidadesVendidasHist = 0;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const pid = m.productId;
      const art = (state.articulos || []).find((a) => a.id === pid);
      if (!art || art.tituloMercancia !== 'credito') continue;
      if (esSinEspecificar) {
        if (art.proveedorId) continue;
      } else if (art.proveedorId !== provId) continue;

      const qty = Math.abs(parseFloat(m.cantidad) || 0);
      const cost = parseFloat(art.precioCompra) || 0;
      costoVendidoHist += qty * cost;
      unidadesVendidasHist += qty;
    }

    const refOperativaTotal = valorInventarioCosto + costoVendidoHist;
    const compromisoReconocido = (state.tes_compromisos_prov || [])
      .filter((c) => c.proveedorId === provId)
      .reduce((sum, c) => sum + (c.valor || 0), 0);
    const abonos = (state.tes_abonos_prov || [])
      .filter((ab) => ab.proveedorId === provId)
      .reduce((sum, ab) => sum + (ab.valor || 0), 0);
    const saldo = Math.max(0, compromisoReconocido - abonos);

    return {
      valorInventarioCosto,
      costoVendidoHist,
      unidadesVendidasHist,
      refOperativaTotal,
      compromisoReconocido,
      compromisoTotal: compromisoReconocido,
      deudaBruta: compromisoReconocido,
      abonos,
      saldo,
      articulos
    };
  }

  function provTieneActividadCredito(state, d) {
    return (
      d.compromisoReconocido > 0 ||
      d.saldo > 0 ||
      d.abonos > 0 ||
      d.refOperativaTotal > 0
    );
  }

  function renderTesPagosProv(ctx) {
    const { state, fmt, formatDate } = ctx;
    const el = document.getElementById('tes_pagos_prov-content');
    if (!el) return;
    const provConDeuda = (state.usu_proveedores || [])
      .map((p) => ({ ...p, ...calcDeudaProveedor(state, p.id) }))
      .filter((p) => provTieneActividadCredito(state, p));
    const dSinProv = calcDeudaProveedor(state, '__sin_proveedor__');
    if (provTieneActividadCredito(state, dSinProv)) {
      provConDeuda.push({
        id: '__sin_proveedor__',
        nombre: '⚠️ Sin Proveedor Especificado',
        cedula: '',
        ciudad: '',
        ...dSinProv
      });
    }
    const totalCompromiso = provConDeuda.reduce((s, p) => s + p.compromisoReconocido, 0);
    const totalAbonos = provConDeuda.reduce((s, p) => s + p.abonos, 0);
    const totalSaldo = provConDeuda.reduce((s, p) => s + p.saldo, 0);
    const abonosRecientes = [...(state.tes_abonos_prov || [])].reverse().slice(0, 20);
    const compromisosRecientes = [...(state.tes_compromisos_prov || [])].reverse().slice(0, 20);
    const puedeImportar =
      (state.usu_proveedores || []).some((p) => {
        const d = calcDeudaProveedor(state, p.id);
        return d.compromisoReconocido === 0 && d.refOperativaTotal > 0;
      }) ||
      (() => {
        const d = calcDeudaProveedor(state, '__sin_proveedor__');
        return d.compromisoReconocido === 0 && d.refOperativaTotal > 0;
      })();

    el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary" onclick="openCompromisoProvModal()">📥 Registrar compromiso (ingreso)</button>
      <button class="btn btn-secondary" onclick="openAbonoProvModal()">💳 Registrar abono</button>
      ${
        puedeImportar
          ? `<button class="btn btn-sm btn-secondary" onclick="importarEstimacionCompromisosProv()" title="Crea líneas de compromiso = inventario+vendido POS actual por proveedor">📎 Usar estimación como compromiso</button>`
          : ''
      }
      <div style="margin-left:auto;font-size:11px;color:var(--text2);max-width:460px;text-align:right">
        <b>Saldo oficial</b> = compromisos registrados − abonos. Las ventas y el stock <b>no</b> lo bajan; sirven solo como referencia (como Separados con inventario/caja).
      </div>
    </div>
    <div class="card" style="margin-bottom:14px;padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.5">
      📌 <b>Referencia operativa</b>: inventario a costo + vendido POS vía <code>stock_moves</code> (<code>tipo = venta_pos</code>). No altera el saldo. Si aún no tienes tabla <code>tes_compromisos_prov</code>, créala en Supabase (archivo <code>sql/tes_compromisos_prov.sql</code>).
    </div>
    <div class="grid-3" style="margin-bottom:16px">
      <div class="card" style="margin:0;text-align:center;border-color:rgba(248,113,113,.3)"><div style="font-family:Syne;font-size:22px;font-weight:800;color:var(--red)">${fmt(totalCompromiso)}</div><div style="font-size:11px;color:var(--text2);margin-top:4px">📒 Compromiso reconocido (libro)</div></div>
      <div class="card" style="margin:0;text-align:center;border-color:rgba(74,222,128,.3)"><div style="font-family:Syne;font-size:22px;font-weight:800;color:var(--green)">${fmt(totalAbonos)}</div><div style="font-size:11px;color:var(--text2);margin-top:4px">✅ Total abonado</div></div>
      <div class="card" style="margin:0;text-align:center;border-color:rgba(251,191,36,.3)"><div style="font-family:Syne;font-size:22px;font-weight:800;color:var(--yellow)">${fmt(totalSaldo)}</div><div style="font-size:11px;color:var(--text2);margin-top:4px">⚠️ Saldo por pagar</div></div>
    </div>
    ${
      provConDeuda.length === 0
        ? `<div class="empty-state"><div class="es-icon">🏭</div><div class="es-title">Sin actividad a crédito</div><div class="es-text">Crea artículos “Mercancía a Crédito”, registra <b>compromisos</b> al recibir factura/remisión del proveedor, y abona cuando pagues.</div></div>`
        : provConDeuda
            .map((p) => {
              const pct =
                p.compromisoReconocido > 0
                  ? Math.min(100, (p.abonos / p.compromisoReconocido) * 100)
                  : 0;
              return `<div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px"><div><div style="font-family:Syne;font-size:16px;font-weight:800">${p.nombre}</div><div style="font-size:11px;color:var(--text2)">${p.cedula || ''} · ${p.ciudad || ''}</div></div><div style="text-align:right"><div style="font-family:Syne;font-size:20px;font-weight:800;color:${p.saldo > 0 ? 'var(--yellow)' : 'var(--green)'}">${fmt(p.saldo)}</div><div style="font-size:10px;color:var(--text2)">saldo pendiente</div></div></div>
              <div style="display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap;font-size:12px;line-height:1.45;border-left:3px solid var(--accent);padding-left:10px;background:rgba(0,229,180,.06);border-radius:6px;padding:8px 10px">
              <div><span style="color:var(--text2)">Compromiso (libro):</span> <b>${fmt(p.compromisoReconocido)}</b></div>
              <div><span style="color:var(--text2)">Abonado:</span> <b style="color:var(--green)">${fmt(p.abonos)}</b></div>
              </div>
              <div style="font-size:10px;color:var(--text2);margin:6px 0 8px"><b>Referencia</b> (informativa): inventario ${fmt(p.valorInventarioCosto)} · vendido POS ${fmt(p.costoVendidoHist)} (${p.unidadesVendidasHist} uds) · suma ${fmt(p.refOperativaTotal)} · refs. ${p.articulos.length}</div>
              <div style="background:rgba(255,255,255,.05);border-radius:8px;height:8px;overflow:hidden;margin-bottom:10px"><div style="height:100%;border-radius:8px;background:linear-gradient(90deg,var(--green),var(--accent));width:${pct}%;transition:width 1s ease"></div></div><div style="font-size:10px;color:var(--text2);margin-bottom:12px">${pct.toFixed(1)}% del compromiso cubierto por abonos</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-sm btn-secondary" onclick="openCompromisoProvModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">📥 Compromiso</button><button class="btn btn-sm btn-primary" onclick="openAbonoProvModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">💳 Abonar</button><button class="btn btn-sm btn-secondary" onclick="verCompromisosProv('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">📋 Compromisos</button><button class="btn btn-sm btn-secondary" onclick="verAbonosProv('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">📋 Abonos</button></div></div>`;
            })
            .join('')
    }
    ${
      abonosRecientes.length > 0
        ? `<div class="card"><div class="card-title">💳 ÚLTIMOS ABONOS REGISTRADOS</div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Valor</th><th>Método</th><th>Nota</th><th></th></tr></thead><tbody>${abonosRecientes
            .map(
              (ab) =>
                `<tr><td>${formatDate(ab.fecha)}</td><td style="font-weight:700">${ab.proveedorNombre || '—'}</td><td style="color:var(--green);font-weight:700">${fmt(ab.valor || 0)}</td><td>${ab.metodo || '—'}</td><td style="color:var(--text2);font-size:11px">${ab.nota || '—'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarAbonoProv('${ab.id}')">✕</button></td></tr>`
            )
            .join('')}</tbody></table></div></div>`
        : ''
    }
    ${
      compromisosRecientes.length > 0
        ? `<div class="card"><div class="card-title">📒 ÚLTIMOS COMPROMISOS (INGRESO A CRÉDITO)</div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Valor</th><th>Ref.</th><th>Nota</th><th></th></tr></thead><tbody>${compromisosRecientes
            .map(
              (c) =>
                `<tr><td>${formatDate(c.fecha)}</td><td style="font-weight:700">${c.proveedorNombre || '—'}</td><td style="color:var(--accent);font-weight:700">${fmt(c.valor || 0)}</td><td style="color:var(--text2);font-size:11px">${c.referencia || '—'}</td><td style="color:var(--text2);font-size:11px">${c.nota || '—'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarCompromisoProv('${c.id}')">✕</button></td></tr>`
            )
            .join('')}</tbody></table></div></div>`
        : ''
    }`;
  }

  function compromisoProveedorOptions(state) {
    const opts = (state.usu_proveedores || []).map((p) => ({ id: p.id, nombre: p.nombre }));
    const sin = (state.articulos || []).some(
      (a) => a.tituloMercancia === 'credito' && (!a.proveedorId || a.proveedorId === '')
    );
    if (sin) opts.push({ id: '__sin_proveedor__', nombre: '⚠️ Sin proveedor (crédito)' });
    return opts;
  }

  function openCompromisoProvModal(ctx) {
    const { state, provId = '', provNombre = '', fmt, openModal, notify, today } = ctx;
    const provs = compromisoProveedorOptions(state);
    if (provs.length === 0) {
      notify('warning', '⚠️', 'Sin proveedores', 'Registra proveedores o artículos a crédito primero.', { duration: 4000 });
      return;
    }
    const optHtml = provs
      .map((o) => {
        const sel = o.id === provId ? 'selected' : '';
        const nm = String(o.nombre).replace(/"/g, '&quot;');
        const d = calcDeudaProveedor(state, o.id);
        return `<option value="${o.id}" data-nombre="${nm}" ${sel}>${o.nombre} · Ref. operativa ${fmt(d.refOperativaTotal)} · Compromiso libro ${fmt(d.compromisoReconocido)}</option>`;
      })
      .join('');
    openModal(`
    <div class="modal-title">📥 Registrar compromiso (ingreso a crédito)<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">Aumenta el pasivo reconocido con el proveedor (factura, remisión, etc.). <b>No</b> mueve caja. El saldo oficial solo baja con <b>abonos</b>.</p>
    <div class="form-group"><label class="form-label">PROVEEDOR *</label><select class="form-control" id="cp-prov-sel">${optHtml}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">VALOR (COSTO) *</label><input type="number" class="form-control" id="cp-valor" min="0" step="any" placeholder="0"></div>
      <div class="form-group"><label class="form-label">FECHA</label><input type="date" class="form-control" id="cp-fecha" value="${today()}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">REFERENCIA</label><input class="form-control" id="cp-ref" placeholder="N° factura / remisión"></div>
      <div class="form-group"><label class="form-label">NOTA</label><input class="form-control" id="cp-nota" placeholder="Observación"></div>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarCompromisoProv()">📥 Guardar compromiso</button>`);
    if (provId) {
      setTimeout(() => {
        const selEl = document.getElementById('cp-prov-sel');
        if (selEl) selEl.value = provId;
      }, 50);
    }
  }

  async function guardarCompromisoProv(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, closeModal, renderTesPagosProv, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const sel = document.getElementById('cp-prov-sel');
    const opt = sel?.options[sel.selectedIndex];
    const provId = sel?.value;
    const provNombre = opt?.getAttribute('data-nombre') || opt?.text || '';
    const valor = parseFloat(document.getElementById('cp-valor')?.value || 0);
    const fecha = document.getElementById('cp-fecha')?.value || today();
    const referencia = document.getElementById('cp-ref')?.value.trim() || '';
    const nota = document.getElementById('cp-nota')?.value.trim() || '';
    if (!provId) {
      notify('warning', '⚠️', 'Proveedor', 'Selecciona proveedor.', { duration: 3000 });
      return;
    }
    if (valor <= 0) {
      notify('warning', '⚠️', 'Valor', 'Ingresa un valor mayor a 0.', { duration: 3000 });
      return;
    }
    const row = {
      id: nextId(),
      proveedorId: provId,
      proveedorNombre: provNombre,
      valor,
      fecha,
      referencia,
      nota
    };
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from('tes_compromisos_prov').upsert(
        {
          id: row.id,
          proveedor_id: provId,
          proveedor_nombre: provNombre,
          valor,
          fecha,
          referencia,
          nota
        },
        { onConflict: 'id' }
      );
      if (error) throw error;
      if (!state.tes_compromisos_prov) state.tes_compromisos_prov = [];
      state.tes_compromisos_prov.push(row);
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      notify('success', '📒', 'Compromiso registrado', `${fmt(valor)} · ${provNombre}`, { duration: 3000 });
    } catch (err) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', err.message || String(err), { duration: 6000 });
      console.error(err);
    }
  }

  async function eliminarCompromisoProv(ctx) {
    const { state, id, confirm, supabaseClient, renderTesPagosProv, notify } = ctx;
    if (!confirm('¿Eliminar este compromiso? El saldo pendiente se recalculará.')) return;
    try {
      const { error } = await supabaseClient.from('tes_compromisos_prov').delete().eq('id', id);
      if (error) throw error;
      state.tes_compromisos_prov = (state.tes_compromisos_prov || []).filter((c) => c.id !== id);
      renderTesPagosProv();
      notify('success', '🗑️', 'Compromiso eliminado', 'Saldo recalculado.', { duration: 2000 });
    } catch (e) {
      console.warn('Error eliminando compromiso:', e.message || e);
      notify('danger', '⚠️', 'No se pudo eliminar', e.message || 'Error en base de datos', { duration: 4500 });
    }
  }

  function verCompromisosProv(ctx) {
    const { state, provId, provNombre, fmt, formatDate, openModal } = ctx;
    const lines = (state.tes_compromisos_prov || []).filter((c) => c.proveedorId === provId);
    const d = calcDeudaProveedor(state, provId);
    openModal(`<div class="modal-title">📒 Compromisos — ${provNombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;font-size:12px;line-height:1.45">
    <div><span style="color:var(--text2)">Compromiso (libro):</span> <b>${fmt(d.compromisoReconocido)}</b></div>
    <div><span style="color:var(--text2)">Abonado:</span> <b style="color:var(--green)">${fmt(d.abonos)}</b></div>
    <div><span style="color:var(--text2)">Saldo:</span> <b style="color:var(--yellow)">${fmt(d.saldo)}</b></div>
    <div><span style="color:var(--text2)">Ref. operativa:</span> <b style="color:var(--text2)">${fmt(d.refOperativaTotal)}</b> <span style="font-size:10px">(info)</span></div></div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Valor</th><th>Ref.</th><th>Nota</th><th></th></tr></thead><tbody>${lines.length > 0 ? lines
      .slice()
      .reverse()
      .map(
        (c) =>
          `<tr><td>${formatDate(c.fecha)}</td><td style="color:var(--accent);font-weight:700">${fmt(c.valor)}</td><td style="font-size:11px;color:var(--text2)">${c.referencia || '—'}</td><td style="font-size:11px;color:var(--text2)">${c.nota || '—'}</td><td><button class="btn btn-xs btn-danger" onclick="closeModal();eliminarCompromisoProv('${c.id}')">✕</button></td></tr>`
      )
      .join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:20px">Sin líneas de compromiso</td></tr>'}</tbody></table></div>
    <button class="btn btn-primary btn-sm" style="margin-top:12px;width:100%" onclick="closeModal();openCompromisoProvModal('${provId}','${String(provNombre).replace(/'/g, "\\'")}')">+ Nuevo compromiso</button>`);
  }

  async function importarEstimacionCompromisosProv(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, renderTesPagosProv, notify, fmt, confirm } = ctx;
    if (
      !confirm(
        'Se creará una línea de compromiso por cada proveedor con estimación > 0 y sin compromisos en libro. Valor = inventario a costo + vendido POS (referencia actual). ¿Continuar?'
      )
    )
      return;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const targets = [];
    (state.usu_proveedores || []).forEach((p) => {
      const d = calcDeudaProveedor(state, p.id);
      if (d.compromisoReconocido === 0 && d.refOperativaTotal > 0) targets.push({ provId: p.id, nombre: p.nombre, valor: d.refOperativaTotal });
    });
    const dSin = calcDeudaProveedor(state, '__sin_proveedor__');
    if (dSin.compromisoReconocido === 0 && dSin.refOperativaTotal > 0)
      targets.push({ provId: '__sin_proveedor__', nombre: 'Sin proveedor (crédito)', valor: dSin.refOperativaTotal });
    if (targets.length === 0) {
      notify('warning', 'ℹ️', 'Nada que importar', 'Todos ya tienen compromiso en libro o la estimación es 0.', { duration: 4000 });
      return;
    }
    try {
      showLoadingOverlay('connecting');
      if (!state.tes_compromisos_prov) state.tes_compromisos_prov = [];
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const row = {
          id: nextId(),
          proveedorId: t.provId,
          proveedorNombre: t.nombre,
          valor: t.valor,
          fecha: today(),
          referencia: '',
          nota: 'Importación estimación (inv.+vendido POS)'
        };
        const { error } = await supabaseClient.from('tes_compromisos_prov').upsert(
          {
            id: row.id,
            proveedor_id: t.provId,
            proveedor_nombre: t.nombre,
            valor: t.valor,
            fecha: row.fecha,
            referencia: row.referencia,
            nota: row.nota
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
        state.tes_compromisos_prov.push(row);
      }
      showLoadingOverlay('hide');
      renderTesPagosProv();
      notify('success', '📎', 'Compromisos importados', `${targets.length} línea(s). Revisa y ajusta en el libro si hace falta.`, { duration: 5000 });
    } catch (err) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error importando', err.message || String(err), { duration: 6000 });
      console.error(err);
    }
  }

  function abonoModalOptions(state) {
    const opts = [];
    (state.usu_proveedores || []).forEach((p) => {
      const d = calcDeudaProveedor(state, p.id);
      if (d.saldo > 0) opts.push({ id: p.id, nombre: p.nombre, saldo: d.saldo });
    });
    const dSin = calcDeudaProveedor(state, '__sin_proveedor__');
    if (dSin.saldo > 0) {
      opts.push({ id: '__sin_proveedor__', nombre: '⚠️ Sin proveedor (crédito)', saldo: dSin.saldo });
    }
    return opts;
  }

  function openAbonoProvModal(ctx) {
    const { state, provId = '', provNombre = '', fmt, openModal, notify, today } = ctx;
    const opts = abonoModalOptions(state);
    if (provId && !opts.find((o) => o.id === provId)) {
      const d = calcDeudaProveedor(state, provId);
      opts.push({
        id: provId,
        nombre: provNombre || (provId === '__sin_proveedor__' ? 'Sin proveedor (crédito)' : 'Proveedor'),
        saldo: d.saldo
      });
    }
    if (opts.length === 0 && !provId) {
      notify('warning', '⚠️', 'Sin saldo pendiente', 'No hay proveedores con saldo por pagar según compromiso − abonos.', {
        duration: 4000
      });
      return;
    }
    const optHtml = opts
      .map((o) => {
        const sel = o.id === provId ? 'selected' : '';
        const nm = String(o.nombre).replace(/"/g, '&quot;');
        return `<option value="${o.id}" data-saldo="${o.saldo}" data-nombre="${nm}" ${sel}>${o.nombre} · Saldo: ${fmt(o.saldo)}</option>`;
      })
      .join('');
    openModal(`
    <div class="modal-title">💳 Registrar Abono a Proveedor<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">PROVEEDOR *</label><select class="form-control" id="ab-prov-sel" onchange="updateSaldoPendiente()"><option value="">— Seleccionar —</option>${optHtml}</select></div>
    <div id="ab-saldo-info" style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;display:none"><span style="color:var(--text2)">Saldo pendiente (compromiso − abonos):</span> <span id="ab-saldo-val" style="font-weight:700;color:var(--yellow)"></span></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">VALOR ABONO *</label><input type="number" class="form-control" id="ab-valor" min="0" placeholder="0" oninput="validateAbono()"></div>
      <div class="form-group"><label class="form-label">MÉTODO DE PAGO</label><select class="form-control" id="ab-metodo">${(state.cfg_metodos_pago && state.cfg_metodos_pago.filter((m) => m.activo !== false).length > 0 ? state.cfg_metodos_pago.filter((m) => m.activo !== false) : [{ id: 'efectivo', nombre: '💵 Efectivo' }, { id: 'transferencia', nombre: '📱 Transferencia' }]).map((m) => `<option value="${m.id}">${m.nombre}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label class="form-label">CAJA (descuenta del bucket del método)</label><select class="form-control" id="ab-caja-sel">${(state.cajas || [])
      .filter((c) => c.estado === 'abierta')
      .map((c) => `<option value="${c.id}">${c.nombre}</option>`)
      .join('') || '<option value="">— Sin caja abierta —</option>'}</select><div style="font-size:10px;color:var(--text2);margin-top:4px">Efectivo descuenta de efectivo; transferencia/nequi del bucket correspondiente.</div></div>
    <div class="form-row"><div class="form-group"><label class="form-label">FECHA</label><input type="date" class="form-control" id="ab-fecha" value="${today()}"></div><div class="form-group"><label class="form-label">COMPROBANTE / NOTA</label><input class="form-control" id="ab-nota" placeholder="N° transferencia, observación..."></div></div>
    <div id="ab-warning" style="display:none;color:var(--red);font-size:11px;margin-bottom:8px"></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarAbonoProv()">💳 Guardar Abono</button>`);
    if (provId) {
      setTimeout(() => {
        const selEl = document.getElementById('ab-prov-sel');
        if (selEl) {
          selEl.value = provId;
          updateSaldoPendiente(ctx);
        }
      }, 50);
    }
  }

  function updateSaldoPendiente(ctx) {
    const { fmt } = ctx;
    const sel = document.getElementById('ab-prov-sel');
    const opt = sel?.options[sel.selectedIndex];
    const saldo = parseFloat(opt?.getAttribute('data-saldo') || 0);
    const info = document.getElementById('ab-saldo-info');
    const val = document.getElementById('ab-saldo-val');
    if (saldo > 0) {
      info.style.display = 'block';
      val.textContent = fmt(saldo);
    } else {
      info.style.display = 'none';
    }
  }

  function validateAbono(ctx) {
    const { fmt } = ctx;
    const sel = document.getElementById('ab-prov-sel');
    const opt = sel?.options[sel.selectedIndex];
    const saldo = parseFloat(opt?.getAttribute('data-saldo') || 0);
    const valor = parseFloat(document.getElementById('ab-valor')?.value || 0);
    const warn = document.getElementById('ab-warning');
    if (valor > saldo && saldo > 0) {
      warn.style.display = 'block';
      warn.textContent = `⚠️ El abono (${fmt(valor)}) supera el saldo (${fmt(saldo)}). Puedes registrar anticipo si tu política lo permite.`;
    } else warn.style.display = 'none';
  }

  async function guardarAbonoProv(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, saveRecord, closeModal, renderTesPagosProv, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const sel = document.getElementById('ab-prov-sel');
    const opt = sel?.options[sel.selectedIndex];
    const provId = sel?.value;
    const provNombre = opt?.getAttribute('data-nombre') || opt?.text || '';
    const valor = parseFloat(document.getElementById('ab-valor')?.value || 0);
    const metodo = document.getElementById('ab-metodo')?.value || 'efectivo';
    const fecha = document.getElementById('ab-fecha')?.value || today();
    const nota = document.getElementById('ab-nota')?.value.trim() || '';
    if (!provId) {
      notify('warning', '⚠️', 'Selecciona un proveedor', '', { duration: 3000 });
      return;
    }
    if (valor <= 0) {
      notify('warning', '⚠️', 'Ingresa un valor', '', { duration: 3000 });
      return;
    }
    const cajaSel = document.getElementById('ab-caja-sel')?.value;
    const cajaAbierta =
      (cajaSel && (state.cajas || []).find((c) => c.id === cajaSel && c.estado === 'abierta')) ||
      (state.cajas || []).find((c) => c.estado === 'abierta');
    if (cajaAbierta) {
      global.AppCajaLogic?.normalizeCaja?.(cajaAbierta);
      const bucket = global.AppCajaLogic?.bucketFromMetodoId?.(metodo, state.cfg_metodos_pago) || 'efectivo';
      const disp = global.AppCajaLogic?.saldoEnBucket?.(cajaAbierta, bucket) ?? 0;
      if (disp < valor) {
        notify('warning', '⚠️', 'Saldo en bucket', `En «${bucket}» solo hay ${fmt(disp)}. Elige otra caja o método.`, { duration: 6000 });
        return;
      }
    }

    const abono = {
      id: nextId(),
      proveedorId: provId,
      proveedorNombre: provNombre,
      valor,
      metodo,
      fecha,
      nota,
      fechaCreacion: today()
    };
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from('tes_abonos_prov').upsert(
        { id: abono.id, proveedor_id: provId, proveedor_nombre: provNombre, valor, metodo, fecha, nota },
        { onConflict: 'id' }
      );
      if (error) throw error;
      if (!state.tes_abonos_prov) state.tes_abonos_prov = [];
      state.tes_abonos_prov.push(abono);

      if (cajaAbierta) {
        const bucket = global.AppCajaLogic?.bucketFromMetodoId?.(metodo, state.cfg_metodos_pago) || 'efectivo';
        global.AppCajaLogic?.applyDeltaBucket?.(cajaAbierta, bucket, -valor);
        const mov = {
          id: nextId(),
          cajaId: cajaAbierta.id,
          tipo: 'egreso',
          valor,
          concepto: `Abono proveedor: ${provNombre}`,
          fecha,
          metodo,
          categoria: 'abono_proveedor',
          bucket
        };
        global.AppCajaLogic?.enrichMovWithSesion?.(state, cajaAbierta.id, mov, nextId);
        state.tes_movimientos.push(mov);
        await saveRecord('cajas', cajaAbierta.id, cajaAbierta);
        await saveRecord('tes_movimientos', mov.id, mov);
      } else {
        notify('warning', '🏧', 'Sin caja', 'El abono quedó en libro; abre una caja para registrar el egreso en caja después si aplica.', { duration: 5000 });
      }
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      notify('success', '💳', 'Abono registrado', `${fmt(valor)} a ${provNombre}`, { duration: 3000 });
    } catch (err) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error al guardar', err.message, { duration: 5000 });
      console.error(err);
    }
  }

  function verAbonosProv(ctx) {
    const { state, provId, provNombre, fmt, formatDate, openModal } = ctx;
    const abonos = (state.tes_abonos_prov || []).filter((ab) => ab.proveedorId === provId);
    const d = calcDeudaProveedor(state, provId);
    openModal(`<div class="modal-title">📋 Abonos — ${provNombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;font-size:12px;line-height:1.45">
    <div><span style="color:var(--text2)">Compromiso (libro):</span> <b>${fmt(d.compromisoReconocido)}</b></div>
    <div><span style="color:var(--text2)">Abonado:</span> <b style="color:var(--green)">${fmt(d.abonos)}</b></div>
    <div><span style="color:var(--text2)">Saldo:</span> <b style="color:var(--yellow)">${fmt(d.saldo)}</b></div></div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:12px;line-height:1.45"><b>Referencia (info):</b> inventario ${fmt(d.valorInventarioCosto)} · vendido POS ${fmt(d.costoVendidoHist)} (${d.unidadesVendidasHist} uds) · suma ${fmt(d.refOperativaTotal)}</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Valor</th><th>Método</th><th>Nota</th></tr></thead><tbody>${abonos.length > 0 ? abonos.reverse().map((ab) => `<tr><td>${formatDate(ab.fecha)}</td><td style="color:var(--green);font-weight:700">${fmt(ab.valor)}</td><td>${ab.metodo || '—'}</td><td style="color:var(--text2);font-size:11px">${ab.nota || '—'}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:20px">Sin abonos registrados</td></tr>'}</tbody></table></div>
    <button class="btn btn-primary btn-sm" style="margin-top:12px;width:100%" onclick="closeModal();openAbonoProvModal('${provId}','${String(provNombre).replace(/'/g, "\\'")}')">+ Nuevo Abono</button>`);
  }

  async function eliminarAbonoProv(ctx) {
    const { state, id, confirm, supabaseClient, renderTesPagosProv, notify } = ctx;
    if (!confirm('¿Eliminar este abono? El saldo pendiente se recalculará.')) return;
    try {
      const { error } = await supabaseClient.from('tes_abonos_prov').delete().eq('id', id);
      if (error) throw error;
      state.tes_abonos_prov = (state.tes_abonos_prov || []).filter((ab) => ab.id !== id);
      renderTesPagosProv();
      notify('success', '🗑️', 'Abono eliminado', 'Saldo recalculado.', { duration: 2000 });
    } catch (e) {
      console.warn('Error eliminando abono:', e.message || e);
      notify('danger', '⚠️', 'No se pudo eliminar', e.message || 'Error en base de datos', { duration: 4500 });
    }
  }

  function renderTesCajas(ctx) {
    const { state, fmt } = ctx;
    const cajas = state.cajas || [];
    if (global.AppCajaLogic?.normalizeAllCajas) global.AppCajaLogic.normalizeAllCajas(state);
    const miniSaldos = (c) => {
      global.AppCajaLogic?.normalizeCaja?.(c);
      const s = c.saldosMetodo || {};
      const bits = ['transferencia', 'addi', 'contraentrega', 'tarjeta', 'digital', 'otro']
        .map((k) => (s[k] > 0 ? `<span style="color:var(--text2)">${k}:</span> <b>${fmt(s[k])}</b>` : ''))
        .filter(Boolean);
      return bits.length ? `<div style="font-size:10px;line-height:1.5;margin:8px 0;color:var(--text2)">${bits.join(' · ')}</div>` : '';
    };
    document.getElementById('tes_cajas-content').innerHTML = `<div style="font-size:11px;color:var(--text2);margin-bottom:12px;line-height:1.45">💵 <b>Turno</b>: con la caja <b>cerrada</b> usa <b>Abrir turno</b> (arrastra lo del último cierre). Con la caja <b>abierta</b> cobras en POS; al terminar <b>Cerrar turno</b> hace arqueo (efectivo contado vs libro, bancos declarados, sobrante/faltante). El número grande es efectivo en libro.</div><button class="btn btn-primary" style="margin-bottom:16px" onclick="openCajaModal()">+ Nueva Caja</button><div class="grid-2">${cajas
      .map(
        (c) =>
          `<div class="card" style="margin:0;border-color:${c.estado === 'abierta' ? 'rgba(0,229,180,.3)' : 'var(--border)'}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-family:Syne;font-weight:800;font-size:16px">${c.nombre}</div><span class="badge ${c.estado === 'abierta' ? 'badge-ok' : 'badge-pend'}">${c.estado === 'abierta' ? 'turno abierto' : 'cerrada'}</span></div><div style="font-size:10px;color:var(--text2);margin-bottom:4px">Efectivo en caja (libro)</div><div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--accent);margin-bottom:4px">${fmt((() => { global.AppCajaLogic?.normalizeCaja?.(c); return c.saldosMetodo?.efectivo ?? c.saldo ?? 0; })())}</div>${miniSaldos(c)}<div class="btn-group" style="flex-wrap:wrap">${c.estado === 'abierta' ? `<button class="btn btn-sm btn-danger" onclick="cerrarCaja('${c.id}')">🔒 Cerrar turno</button>` : `<button class="btn btn-sm btn-primary" onclick="abrirCaja('${c.id}')">🔓 Abrir turno</button>`}<button class="btn btn-sm btn-secondary" onclick="verCierresCajaModal('${c.id}')">📋 Cierres</button></div></div>`
      )
      .join('')}</div>`;
  }

  function openCajaModal(ctx) {
    ctx.openModal(
      `<div class="modal-title">Nueva Caja<button class="modal-close" onclick="closeModal()">×</button></div><div class="form-group"><label class="form-label">NOMBRE</label><input class="form-control" id="m-caja-nombre" placeholder="Ej: Caja 2"></div><div class="form-group"><label class="form-label">SALDO INICIAL</label><input type="number" class="form-control" id="m-caja-saldo" value="0"></div><button class="btn btn-primary" style="width:100%" onclick="saveCaja()">Crear Caja</button>`
    );
  }

  async function saveCaja(ctx) {
    const { state, uid, dbId, saveRecord, closeModal, renderTesCajas } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const nombre = document.getElementById('m-caja-nombre').value.trim();
    if (!nombre) return;
    const inicial = parseFloat(document.getElementById('m-caja-saldo').value) || 0;
    const saldos = global.AppCajaLogic?.emptySaldos ? global.AppCajaLogic.emptySaldos() : { efectivo: 0, transferencia: 0, addi: 0, contraentrega: 0, tarjeta: 0, digital: 0, otro: 0 };
    saldos.efectivo = inicial;
    const caja = {
      id: nextId(),
      nombre,
      saldo: inicial,
      estado: 'abierta',
      apertura: ctx.today(),
      bodegaIds: [],
      saldosMetodo: saldos
    };
    global.AppCajaLogic?.normalizeCaja?.(caja);
    caja.sesionActivaId = nextId();
    state.cajas.push(caja);
    const ok = await saveRecord('cajas', caja.id, caja);
    if (!ok) {
      state.cajas = (state.cajas || []).filter((x) => x.id !== caja.id);
      if (typeof ctx.notify === 'function') {
        ctx.notify('danger', '⚠️', 'No se pudo crear caja', 'Error al persistir en base de datos.', { duration: 4500 });
      }
      return;
    }
    closeModal();
    renderTesCajas();
  }

  function openAbrirCajaModal(ctx) {
    const { state, id, openModal, fmt, today, notify } = ctx;
    const c = (state.cajas || []).find((x) => x.id === id);
    if (!c) return;
    if (c.estado === 'abierta') {
      notify('warning', '🏧', 'Caja abierta', 'Esta caja ya tiene turno abierto.', { duration: 3000 });
      return;
    }
    global.AppCajaLogic?.normalizeCaja?.(c);
    const sug = global.AppCajaLogic?.saldosSugeridosApertura?.(c) || { efectivo: 0, transferencia: 0 };
    const sk = global.AppCajaLogic?.BUCKET_KEYS || [];
    const rows = sk
      .map(
        (k) =>
          `<div class="form-group"><label class="form-label">${k.toUpperCase()} (apertura)</label><input type="number" class="form-control ap-saldo-bucket" data-bucket="${k}" value="${sug[k] ?? 0}" step="any"></div>`
      )
      .join('');
    openModal(`<div class="modal-title">🔓 Abrir turno — ${c.nombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <input type="hidden" id="ap-caja-id" value="${c.id}">
    <p style="font-size:11px;color:var(--text2);line-height:1.5;margin:0 0 12px">Los valores por defecto vienen del <b>último cierre</b> (efectivo contado y bancos declarados). Puedes corregirlos si hace falta. Luego se abre una <b>nueva sesión</b> para amarrar movimientos.</p>
    <div class="form-group"><label class="form-label">FECHA APERTURA</label><input type="date" class="form-control" id="ap-fecha" value="${today()}"></div>
    ${rows}
    <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="guardarAbrirCaja()">✅ Abrir caja y comenzar turno</button>`);
  }

  async function guardarAbrirCaja(ctx) {
    const { state, dbId, uid, saveRecord, closeModal, renderTesCajas, notify, today } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const id = document.getElementById('ap-caja-id')?.value;
    const c = (state.cajas || []).find((x) => x.id === id);
    if (!c) return;
    const fecha = document.getElementById('ap-fecha')?.value || today();
    const saldos = global.AppCajaLogic?.emptySaldos ? global.AppCajaLogic.emptySaldos() : {};
    document.querySelectorAll('.ap-saldo-bucket').forEach((el) => {
      const k = el.getAttribute('data-bucket');
      if (k) saldos[k] = parseFloat(el.value) || 0;
    });
    global.AppCajaLogic?.normalizeCaja?.(c);
    c.saldosMetodo = saldos;
    c.saldo = saldos.efectivo || 0;
    c.estado = 'abierta';
    c.apertura = fecha;
    c.sesionActivaId = nextId();
    c.proximaAperturaSaldos = null;
    await saveRecord('cajas', c.id, c);
    closeModal();
    renderTesCajas();
    notify('success', '🔓', 'Turno abierto', `${c.nombre} · Sesión nueva · Efectivo inicial ${ctx.fmt(saldos.efectivo || 0)}`, { duration: 4000 });
  }

  function openCerrarCajaModal(ctx) {
    const { state, id, openModal, fmt, today } = ctx;
    const c = (state.cajas || []).find((x) => x.id === id);
    if (!c || c.estado !== 'abierta') return;
    global.AppCajaLogic?.normalizeCaja?.(c);
    const libroEfe = global.AppCajaLogic?.saldoEnBucket?.(c, 'efectivo') ?? c.saldo ?? 0;
    const libroTrans = global.AppCajaLogic?.saldoEnBucket?.(c, 'transferencia') ?? 0;
    const ses = global.AppCajaLogic?.resumenSesionCaja?.(state, c.id, c.sesionActivaId) || { movsCount: 0, efectivoNeto: 0, transferNeto: 0 };
    global._cierreLibroEfe = libroEfe;
    global._cierreLibroTrans = libroTrans;
    global._cierreCajaId = c.id;
    openModal(`<div class="modal-title">🔒 Cierre y arqueo — ${c.nombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <input type="hidden" id="cc-caja-id" value="${c.id}">
    <div style="font-size:11px;color:var(--text2);line-height:1.55;margin-bottom:12px;padding:10px;background:rgba(0,229,180,.08);border-radius:8px;border:1px solid rgba(0,229,180,.25)">
      <b>Libro (ingresos − egresos en buckets)</b><br>
      Efectivo en libro: <b style="color:var(--accent)">${fmt(libroEfe)}</b> · Transferencias/bancos en libro: <b>${fmt(libroTrans)}</b><br>
      <span style="font-size:10px">Movimientos esta sesión: ${ses.movsCount} · Neto efectivo mov.: ${fmt(ses.efectivoNeto)} · Neto transf. mov.: ${fmt(ses.transferNeto)}</span>
    </div>
    <div class="form-group"><label class="form-label">💵 EFECTIVO CONTADO (físico en caja)</label><input type="number" class="form-control" id="cc-contado-efe" value="${Math.round(libroEfe)}" step="any" oninput="recalcCierreArqueo()"></div>
    <div class="form-group"><label class="form-label">🏦 SALDO EN CUENTAS / BANCOS (declarado)</label><input type="number" class="form-control" id="cc-decl-banco" value="${Math.round(libroTrans)}" step="any" oninput="recalcCierreArqueo()"></div>
    <div id="cc-arqueo-box" style="margin:12px 0;padding:12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3)">
      <div style="font-size:11px;font-weight:800;margin-bottom:6px">ARQUEO EFECTIVO (contado − libro)</div>
      <div id="cc-diff-efe" style="font-size:13px;font-weight:700;color:var(--green)">${fmt(0)} · CUADRA</div>
      <div style="font-size:11px;font-weight:800;margin:10px 0 6px">ARQUEO BANCOS (declarado − libro)</div>
      <div id="cc-diff-trans" style="font-size:13px;font-weight:700;color:var(--green)">${fmt(0)} · CUADRA</div>
    </div>
    <div class="form-group"><label class="form-label">NOTA DEL CIERRE</label><input class="form-control" id="cc-nota" placeholder="Observaciones"></div>
    <p style="font-size:10px;color:var(--text2);line-height:1.45">Al confirmar se <b>ajusta el libro</b> a lo contado (movimientos de arqueo) y se guarda el histórico. Al <b>abrir</b> el próximo turno se sugerirán estos montos como arrastre.</p>
    <button class="btn btn-danger" style="width:100%" onclick="guardarCierreCaja()">🔒 Confirmar cierre</button>`);
  }

  async function guardarCierreCaja(ctx) {
    const { state, dbId, uid, today, saveRecord, closeModal, renderTesCajas, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const id = document.getElementById('cc-caja-id')?.value;
    const c = (state.cajas || []).find((x) => x.id === id);
    if (!c || c.estado !== 'abierta') return;
    global.AppCajaLogic?.normalizeCaja?.(c);
    const libroEfe = global.AppCajaLogic?.saldoEnBucket?.(c, 'efectivo') ?? 0;
    const libroTrans = global.AppCajaLogic?.saldoEnBucket?.(c, 'transferencia') ?? 0;
    const contado = parseFloat(document.getElementById('cc-contado-efe')?.value) || 0;
    const declBanco = parseFloat(document.getElementById('cc-decl-banco')?.value) || 0;
    const nota = document.getElementById('cc-nota')?.value.trim() || '';
    const difE = contado - libroEfe;
    const difT = declBanco - libroTrans;
    const resE = Math.abs(difE) < 0.5 ? 'cuadra' : difE > 0 ? 'sobrante' : 'faltante';

    const arqueoMovs = [];
    const pushArqueoMov = (bucket, delta, label) => {
      if (Math.abs(delta) < 0.005) return;
      const tipo = delta > 0 ? 'ingreso' : 'egreso';
      const valor = Math.abs(delta);
      const mov = {
        id: nextId(),
        cajaId: c.id,
        tipo,
        valor,
        concepto: label,
        fecha: today(),
        metodo: bucket === 'efectivo' ? 'efectivo' : 'transferencia',
        categoria: 'arqueo_cierre',
        bucket
      };
      const { cajaPatched } = global.AppCajaLogic?.enrichMovWithSesion?.(state, c.id, mov, nextId) || {};
      if (cajaPatched) {
        /* sesión ya existía normalmente */
      }
      global.AppCajaLogic?.applyDeltaBucket?.(c, bucket, tipo === 'ingreso' ? valor : -valor);
      if (!state.tes_movimientos) state.tes_movimientos = [];
      state.tes_movimientos.push(mov);
      arqueoMovs.push(mov);
    };

    pushArqueoMov('efectivo', difE, `Arqueo cierre efectivo (${resE === 'cuadra' ? 'cuadre' : resE})`);
    pushArqueoMov('transferencia', difT, 'Arqueo cierre bancos / transferencias');

    const saldosFin = { ...(c.saldosMetodo || {}) };
    const cierre = {
      id: nextId(),
      cajaId: c.id,
      cajaNombre: c.nombre,
      fechaCierre: today(),
      libroEfectivo: libroEfe,
      libroTransferencia: libroTrans,
      contadoEfectivo: contado,
      declaradoBancos: declBanco,
      difEfectivo: difE,
      difTransferencia: difT,
      resultadoEfectivo: resE,
      nota,
      saldosLibroJson: saldosFin
    };
    if (!state.tes_cierres_caja) state.tes_cierres_caja = [];
    state.tes_cierres_caja.push(cierre);

    const empty = global.AppCajaLogic?.emptySaldos ? global.AppCajaLogic.emptySaldos() : {};
    c.proximaAperturaSaldos = { ...empty };
    (global.AppCajaLogic?.BUCKET_KEYS || []).forEach((k) => {
      c.proximaAperturaSaldos[k] = parseFloat(c.saldosMetodo[k]) || 0;
    });
    c.proximaAperturaSaldos.efectivo = contado;
    c.proximaAperturaSaldos.transferencia = declBanco;

    c.estado = 'cerrada';
    c.sesionActivaId = null;

    for (let i = 0; i < arqueoMovs.length; i++) {
      await saveRecord('tes_movimientos', arqueoMovs[i].id, arqueoMovs[i]);
    }
    await saveRecord('tes_cierres_caja', cierre.id, cierre);
    await saveRecord('cajas', c.id, c);

    closeModal();
    renderTesCajas();
    const msg =
      resE === 'cuadra'
        ? 'Efectivo cuadra.'
        : resE === 'sobrante'
          ? `Sobrante efectivo ${fmt(difE)}.`
          : `Faltante efectivo ${fmt(Math.abs(difE))}.`;
    notify('success', '🔒', 'Cierre registrado', msg + ' · Bancos Δ ' + fmt(difT), { duration: 5000 });
  }

  function verCierresCajaModal(ctx) {
    const { state, id, openModal, fmt, formatDate } = ctx;
    const c = (state.cajas || []).find((x) => x.id === id);
    if (!c) return;
    const hist = (state.tes_cierres_caja || []).filter((x) => x.cajaId === id).slice(0, 15);
    openModal(`<div class="modal-title">📋 Cierres — ${c.nombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Libro Efe.</th><th>Contado</th><th>Δ Efe.</th><th>Bancos decl.</th><th>Resultado</th></tr></thead><tbody>${
      hist.length
        ? hist
            .map(
              (h) =>
                `<tr><td>${formatDate(h.fechaCierre)}</td><td>${fmt(h.libroEfectivo)}</td><td>${fmt(h.contadoEfectivo)}</td><td style="color:${h.difEfectivo >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(h.difEfectivo)}</td><td>${fmt(h.declaradoBancos)}</td><td>${h.resultadoEfectivo || '—'}</td></tr>`
            )
            .join('')
        : '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:16px">Sin cierres guardados</td></tr>'
    }</tbody></table></div>`);
  }

  function cerrarCaja(ctx) {
    openCerrarCajaModal(ctx);
  }

  function abrirCaja(ctx) {
    openAbrirCajaModal(ctx);
  }

  async function saveMovCaja(ctx) {
    const { state, cajaId, tipo, uid, dbId, today, saveRecord, closeModal, renderTesCajas, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const valor = parseFloat(document.getElementById('m-mov-valor').value) || 0;
    if (valor <= 0) return;
    const concepto = document.getElementById('m-mov-concepto').value.trim();
    if (!concepto) {
      notify('warning', '⚠️', 'Concepto', 'Describe el movimiento.', { duration: 3000 });
      return;
    }
    const metodo = document.getElementById('m-mov-metodo').value;
    const catEl = document.getElementById('m-mov-categoria');
    const categoria = catEl ? catEl.value : tipo === 'egreso' ? 'gasto' : 'otro_ingreso';
    const caja = (state.cajas || []).find((c) => c.id === cajaId);
    if (!caja) return;
    global.AppCajaLogic?.normalizeCaja?.(caja);
    const bucket =
      (document.getElementById('m-mov-bucket') && document.getElementById('m-mov-bucket').value) ||
      global.AppCajaLogic?.bucketFromMetodoId?.(metodo, state.cfg_metodos_pago) ||
      'efectivo';

    if (tipo === 'ingreso') {
      global.AppCajaLogic?.applyDeltaBucket?.(caja, bucket, valor);
    } else {
      const disp = global.AppCajaLogic?.saldoEnBucket?.(caja, bucket) ?? caja.saldo ?? 0;
      if (disp < valor) {
        notify('warning', '⚠️', 'Saldo insuficiente', `En bucket «${bucket}» hay ${fmt(disp)}.`, { duration: 5000 });
        return;
      }
      global.AppCajaLogic?.applyDeltaBucket?.(caja, bucket, -valor);
    }

    const mov = {
      id: nextId(),
      cajaId,
      tipo,
      valor,
      concepto,
      fecha: today(),
      metodo,
      categoria,
      bucket
    };
    global.AppCajaLogic?.enrichMovWithSesion?.(state, cajaId, mov, nextId);
    state.tes_movimientos.push(mov);
    await saveRecord('cajas', caja.id, caja);
    await saveRecord('tes_movimientos', mov.id, mov);
    closeModal();
    renderTesCajas();
    notify('success', '✅', tipo === 'ingreso' ? 'Ingreso' : 'Egreso', fmt(valor) + ' · ' + bucket + ' · ' + concepto, { duration: 3000 });
  }

  function openMovCajaModal(ctx) {
    const { state, cajaId, tipo, openModal, fmt, notify } = ctx;
    const caja = (state.cajas || []).find((c) => c.id === cajaId);
    if (!caja) return;
    if (caja.estado !== 'abierta') {
      if (typeof notify === 'function') notify('warning', '🔒', 'Caja cerrada', 'Abre la caja antes de registrar movimientos.', { duration: 4000 });
      return;
    }
    global.AppCajaLogic?.normalizeCaja?.(caja);
    const metodosOpts = (
      state.cfg_metodos_pago && state.cfg_metodos_pago.filter((m) => m.activo !== false).length > 0
        ? state.cfg_metodos_pago.filter((m) => m.activo !== false)
        : [
            { id: 'efectivo', nombre: '💵 Efectivo' },
            { id: 'transferencia', nombre: '📱 Transferencia' },
            { id: 'addi', nombre: '💜 Addi' },
            { id: 'tarjeta', nombre: '💳 Tarjeta' }
          ]
    )
      .map((m) => `<option value="${m.id}">${m.nombre}</option>`)
      .join('');
    const bucketOpts = (global.AppCajaLogic?.BUCKET_KEYS || ['efectivo', 'transferencia', 'addi', 'contraentrega', 'tarjeta', 'digital', 'otro'])
      .map((k) => `<option value="${k}">${k}</option>`)
      .join('');
    const catIngreso = `<select class="form-control" id="m-mov-categoria"><option value="base_caja">📥 Base / arrastre efectivo</option><option value="otro_ingreso">Otro ingreso</option></select>`;
    const catEgreso = `<select class="form-control" id="m-mov-categoria"><option value="gasto">📤 Gasto operativo</option><option value="otro_egreso">Otro egreso</option></select>`;
    openModal(`<div class="modal-title">${tipo === 'ingreso' ? '📥 Ingreso' : '📤 Egreso / Gasto'} — ${caja.nombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45">Efectivo: <b>${fmt(caja.saldosMetodo?.efectivo ?? caja.saldo ?? 0)}</b> · Registra en qué <b>bucket</b> entra o sale el dinero.</p>
    <div class="form-group"><label class="form-label">VALOR</label><input type="number" class="form-control" id="m-mov-valor" min="0" step="any" placeholder="0"></div>
    <div class="form-group"><label class="form-label">CONCEPTO</label><input class="form-control" id="m-mov-concepto" placeholder="Ej: Papelería, base día, etc."></div>
    <div class="form-row"><div class="form-group"><label class="form-label">MÉTODO (referencia)</label><select class="form-control" id="m-mov-metodo">${metodosOpts}</select></div>
    <div class="form-group"><label class="form-label">BUCKET</label><select class="form-control" id="m-mov-bucket">${bucketOpts}</select></div></div>
    <div class="form-group"><label class="form-label">CLASIFICACIÓN</label>${tipo === 'ingreso' ? catIngreso : catEgreso}</div>
    <button class="btn btn-primary" style="width:100%" onclick="saveMovCaja('${cajaId}','${tipo}')">Guardar</button>`);
  }

  function renderTesDinero(ctx) {
    const { state, formatDate, fmt } = ctx;
    const movs = [...(state.tes_movimientos || [])].reverse();
    document.getElementById('tes_dinero-content').innerHTML = `<div class="card"><div class="card-title">MOVIMIENTOS DE DINERO (${movs.length})</div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Caja</th><th>Tipo</th><th>Valor</th><th>Bucket</th><th>Clase</th><th>Concepto</th><th>Método</th></tr></thead><tbody>${movs
      .map((m) => {
        const caja = (state.cajas || []).find((c) => c.id === m.cajaId);
        return `<tr><td>${formatDate(m.fecha)}</td><td>${caja?.nombre || '—'}</td><td><span class="badge ${m.tipo === 'ingreso' ? 'badge-ok' : 'badge-pend'}">${m.tipo}</span></td><td style="color:${m.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)'};font-weight:700">${fmt(m.valor)}</td><td style="font-size:11px">${m.bucket || '—'}</td><td style="font-size:11px;color:var(--text2)">${m.categoria || '—'}</td><td>${m.concepto || '—'}</td><td>${m.metodo || '—'}</td></tr>`;
      })
      .join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:24px">Sin movimientos</td></tr>'}</tbody></table></div></div>`;
  }

  function renderSimpleCollection(ctx) {
    const { state, pageId, title, collection, columns, fmt } = ctx;
    const items = [...(state[collection] || [])].reverse();
    const el = document.getElementById(pageId + '-content');
    if (!el) return;
    el.innerHTML = `<button class="btn btn-primary" style="margin-bottom:16px" onclick="openSimpleFormModal('${collection}','${title}',${JSON.stringify(columns).replace(/"/g, "'")})">+ Nuevo</button><div class="card"><div class="card-title">${title.toUpperCase()} (${items.length})</div><div class="table-wrap"><table><thead><tr>${columns.map((c) => '<th>' + c.split(':')[2] + '</th>').join('')}<th></th></tr></thead><tbody>${items
      .map(
        (item) =>
          `<tr>${columns
            .map((c) => {
              const key = c.split(':')[0];
              const type = c.split(':')[1];
              const val = item[key];
              return type === 'number' ? `<td style="font-weight:700;color:var(--accent)">${fmt(val || 0)}</td>` : `<td>${val || '—'}</td>`;
            })
            .join('')}<td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('${collection}','${item.id}','${pageId}')">✕</button></td></tr>`
      )
      .join('') || `<tr><td colspan="${columns.length + 1}" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>`}</tbody></table></div></div>`;
  }

  global.AppTreasuryModule = {
    calcDeudaProveedor,
    renderTesPagosProv,
    openCompromisoProvModal,
    guardarCompromisoProv,
    eliminarCompromisoProv,
    verCompromisosProv,
    importarEstimacionCompromisosProv,
    openAbonoProvModal,
    updateSaldoPendiente,
    validateAbono,
    guardarAbonoProv,
    verAbonosProv,
    eliminarAbonoProv,
    renderTesCajas,
    openCajaModal,
    saveCaja,
    cerrarCaja,
    abrirCaja,
    guardarAbrirCaja,
    guardarCierreCaja,
    verCierresCajaModal,
    openMovCajaModal,
    saveMovCaja,
    renderTesDinero,
    renderSimpleCollection
  };
})(window);
