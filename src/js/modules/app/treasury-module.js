// Treasury module: pagos proveedores, cajas, movimientos y colecciones simples.
(function initTreasuryModule(global) {
  /** Libro CXP (cuenta por pagar): saldo oficial = sum(cargos) − sum(créditos). */
  function sumCxpProveedor(state, provId) {
    const rows = (state.tes_cxp_movimientos || []).filter((r) => String(r.proveedorId) === String(provId));
    let cargo = 0;
    let credito = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const m = parseFloat(r.monto) || 0;
      if (r.naturaleza === 'cargo') cargo += m;
      else credito += m;
    }
    const net = cargo - credito;
    return {
      cargo,
      credito,
      saldoOficial: Math.max(0, net),
      count: rows.length,
      hayCxp: rows.length > 0
    };
  }

  /**
   * Deuda informativa (a costo) = stock a costo + vendido POS a costo + ajustes de unidades (solo este módulo), artículos a crédito con proveedor.
   * Saldo por pagar: si hay movimientos en libro CXP, usa ese saldo; si no, estimación operativa (inventario − abonos − devoluciones).
   */
  function calcDeudaProveedor(state, provId) {
    const articulos = (state.articulos || []).filter((a) => {
      if (a.tituloMercancia !== 'credito') return false;
      if (!a.proveedorId) return false;
      return String(a.proveedorId) === String(provId);
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
      const art = (state.articulos || []).find((a) => String(a.id) === String(pid));
      if (!art || art.tituloMercancia !== 'credito' || !art.proveedorId) continue;
      if (String(art.proveedorId) !== String(provId)) continue;

      const qRaw = parseFloat(m.cantidad) || 0;
      const netOut = -qRaw;
      const cost = parseFloat(art.precioCompra) || 0;
      costoVendidoHist += netOut * cost;
      unidadesVendidasHist += netOut;
    }

    const costoVendidoNeto = Math.max(0, costoVendidoHist);
    const unidadesVendidasNetas = Math.max(0, unidadesVendidasHist);
    let ajustesSalidaCosto = 0;
    let ajustesSalidaUds = 0;
    let ajustesEntradaCosto = 0;
    let ajustesEntradaUds = 0;
    const ajustes = state.inv_ajustes || [];
    for (let j = 0; j < ajustes.length; j++) {
      const aj = ajustes[j];
      const artAj = (state.articulos || []).find((a) => String(a.id) === String(aj.articuloId));
      if (!artAj || artAj.tituloMercancia !== 'credito' || !artAj.proveedorId) continue;
      if (String(artAj.proveedorId) !== String(provId)) continue;
      const cAj = parseFloat(artAj.precioCompra) || 0;
      const qAj = parseFloat(aj.cantidad) || 0;
      if (aj.tipo === 'salida') {
        ajustesSalidaUds += qAj;
        ajustesSalidaCosto += qAj * cAj;
      } else if (aj.tipo === 'entrada') {
        ajustesEntradaUds += qAj;
        ajustesEntradaCosto += qAj * cAj;
      }
    }
    let ajusteUnidadesCosto = 0;
    (state.tes_ajustes_unidades_prov || []).forEach((r) => {
      if (String(r.proveedorId) !== String(provId)) return;
      const artA = (state.articulos || []).find((a) => String(a.id) === String(r.articuloId));
      const cAj = artA ? parseFloat(artA.precioCompra) || 0 : 0;
      const du = parseFloat(r.deltaUnidades) || 0;
      ajusteUnidadesCosto += du * cAj;
    });
    const refOperativaTotal = valorInventarioCosto + costoVendidoNeto + ajusteUnidadesCosto;
    const compromisoReconocido = (state.tes_compromisos_prov || [])
      .filter((c) => String(c.proveedorId) === String(provId))
      .reduce((sum, c) => sum + (c.valor || 0), 0);
    const abonos = (state.tes_abonos_prov || [])
      .filter((ab) => String(ab.proveedorId) === String(provId))
      .reduce((sum, ab) => sum + (ab.valor || 0), 0);
    const devolucionesDeuda = (state.tes_devoluciones_prov || [])
      .filter((dv) => String(dv.proveedorId) === String(provId))
      .reduce((sum, dv) => sum + (parseFloat(dv.valorCosto) || 0), 0);
    const saldoLibro = Math.max(0, compromisoReconocido - abonos);
    const saldoOperativoEstimado = Math.max(0, refOperativaTotal - abonos - devolucionesDeuda);
    const cxp = sumCxpProveedor(state, provId);
    const saldo = cxp.hayCxp ? cxp.saldoOficial : saldoOperativoEstimado;

    return {
      valorInventarioCosto,
      costoVendidoHist: costoVendidoNeto,
      unidadesVendidasHist: unidadesVendidasNetas,
      refOperativaTotal,
      compromisoReconocido,
      compromisoTotal: compromisoReconocido,
      deudaBruta: refOperativaTotal,
      ajusteUnidadesCosto,
      abonos,
      devolucionesDeuda,
      saldo,
      saldoLibro,
      saldoOperativoEstimado,
      cxpCargo: cxp.cargo,
      cxpCredito: cxp.credito,
      saldoOficialCxp: cxp.saldoOficial,
      usaCxp: cxp.hayCxp,
      difEstimVsCxp: cxp.hayCxp ? saldoOperativoEstimado - cxp.saldoOficial : null,
      articulos,
      ajustesSalidaCosto,
      ajustesSalidaUds,
      ajustesEntradaCosto,
      ajustesEntradaUds
    };
  }

  function articuloUnidadesVendidas(state, artId) {
    let u = 0;
    (state.stock_moves_ventas || []).forEach((m) => {
      if (String(m.productId) !== String(artId)) return;
      const qRaw = parseFloat(m.cantidad) || 0;
      const netOut = -qRaw;
      if (netOut > 0) u += netOut;
    });
    return u;
  }

  function sumDeltaUnidadesModulo(state, provId, artId) {
    return (state.tes_ajustes_unidades_prov || [])
      .filter((r) => String(r.proveedorId) === String(provId) && String(r.articuloId) === String(artId))
      .reduce((s, r) => s + (parseFloat(r.deltaUnidades) || 0), 0);
  }

  function lineaRefDeudaArticulo(state, art, provId) {
    const pc = parseFloat(art.precioCompra) || 0;
    const st = parseFloat(art.stock) || 0;
    const vend = articuloUnidadesVendidas(state, art.id);
    const deltaU = provId != null && provId !== '' ? sumDeltaUnidadesModulo(state, provId, art.id) : 0;
    return pc * (st + vend + deltaU);
  }

  function fmtLineaHora(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
    } catch (_) {
      return '—';
    }
  }

  function ventasInformativasLista(state, provId) {
    const arts = (state.articulos || []).filter(
      (a) => a.tituloMercancia === 'credito' && String(a.proveedorId) === String(provId)
    );
    const ids = new Set(arts.map((a) => String(a.id)));
    const lines = [];
    (state.stock_moves_ventas || []).forEach((m) => {
      if (!ids.has(String(m.productId))) return;
      const art = arts.find((x) => String(x.id) === String(m.productId));
      if (!art) return;
      const qRaw = parseFloat(m.cantidad) || 0;
      const netOut = -qRaw;
      if (netOut <= 0) return;
      lines.push({ fecha: m.fecha, referencia: m.referencia || '—', uds: netOut, art });
    });
    lines.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return lines.slice(0, 60);
  }

  function provTieneActividadCredito(state, d) {
    const cxp = sumCxpProveedor(state, d.id);
    return (
      cxp.count > 0 ||
      d.compromisoReconocido > 0 ||
      d.saldo > 0 ||
      d.abonos > 0 ||
      (d.devolucionesDeuda || 0) > 0 ||
      d.valorInventarioCosto > 0 ||
      d.costoVendidoHist > 0 ||
      Math.abs(d.ajusteUnidadesCosto || 0) > 1e-9
    );
  }

  function renderTesPagosProv(ctx) {
    const { state, fmt, formatDate } = ctx;
    const el = document.getElementById('tes_pagos_prov-content');
    if (!el) return;
    const provConDeuda = (state.usu_proveedores || [])
      .map((p) => ({ ...p, ...calcDeudaProveedor(state, p.id) }))
      .filter((p) => provTieneActividadCredito(state, p));
    const totalDeudaOperativa = provConDeuda.reduce((s, p) => s + p.refOperativaTotal, 0);
    const totalAbonos = provConDeuda.reduce((s, p) => s + p.abonos, 0);
    const totalSaldo = provConDeuda.reduce((s, p) => s + p.saldo, 0);
    const totalCxpCargo = provConDeuda.reduce((s, p) => s + (p.cxpCargo || 0), 0);
    const totalCxpCredito = provConDeuda.reduce((s, p) => s + (p.cxpCredito || 0), 0);
    const totalEstimacion = provConDeuda.reduce((s, p) => s + (p.saldoOperativoEstimado || 0), 0);
    const abonosRecientes = [...(state.tes_abonos_prov || [])].reverse().slice(0, 20);
    const compromisosRecientes = [...(state.tes_compromisos_prov || [])].reverse().slice(0, 20);
    const puedeImportar = (state.usu_proveedores || []).some((p) => {
      const d = calcDeudaProveedor(state, p.id);
      return d.compromisoReconocido === 0 && d.refOperativaTotal > 0;
    });

    el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <button type="button" class="btn btn-primary" onclick="openCargoCxpModal()" title="Alta de deuda en libro CXP (compra a crédito)">＋ Cargo compra (CXP)</button>
      <button type="button" class="btn btn-secondary" onclick="openNotaCreditoCxpModal()" title="Reduce saldo: nota de crédito del proveedor">📄 Nota crédito (CXP)</button>
      <button type="button" class="btn btn-secondary" onclick="backfillStockMovesVentaPos()" title="Crea en la base los movimientos POS faltantes desde facturas ya guardadas (no baja stock otra vez; solo trazabilidad para vendido a costo)">📦 Rellenar movimientos POS</button>
      <button class="btn btn-secondary" onclick="openCompromisoProvModal()">📥 Nota en libro (opcional)</button>
      <button class="btn btn-secondary" onclick="openAbonoProvModal()">💳 Registrar abono</button>
      ${
        puedeImportar
          ? `<button class="btn btn-sm btn-secondary" onclick="importarEstimacionCompromisosProv()" title="Copia la deuda operativa actual al libro (contabilidad opcional)">📎 Copiar deuda al libro</button>`
          : ''
      }
      <div style="margin-left:auto;font-size:11px;color:var(--text2);max-width:480px;text-align:right">
        <b>Saldo por pagar</b> usa el <b>libro CXP</b> (cargos − créditos) cuando hay movimientos; si no, la <b>estimación operativa</b> (inventario/POS). Inventario no se modifica aquí.
      </div>
    </div>
    <div class="card" style="margin-bottom:14px;padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.5">
      📌 <b>CXP</b> = cuenta por pagar por proveedor. <b>Cargo</b> aumenta lo debido; <b>abonos / nota crédito</b> lo reducen. Tras migración, compromisos y abonos históricos quedaron en este libro. La columna «estimación» contrasta con stock + vendido a costo.
    </div>
    <div class="grid-3" style="margin-bottom:10px">
      <div class="card" style="margin:0;text-align:center;border-color:rgba(251,191,36,.45)"><div style="font-family:Syne;font-size:22px;font-weight:800;color:var(--yellow)">${fmt(totalSaldo)}</div><div style="font-size:11px;color:var(--text2);margin-top:4px">⚠️ Saldo por pagar (oficial)</div></div>
      <div class="card" style="margin:0;text-align:center;border-color:rgba(248,113,113,.35)"><div style="font-family:Syne;font-size:20px;font-weight:800;color:var(--red)">${fmt(totalCxpCargo)}</div><div style="font-size:11px;color:var(--text2);margin-top:4px">📥 Cargos CXP (libro)</div></div>
      <div class="card" style="margin:0;text-align:center;border-color:rgba(74,222,128,.35)"><div style="font-family:Syne;font-size:20px;font-weight:800;color:var(--green)">${fmt(totalCxpCredito)}</div><div style="font-size:11px;color:var(--text2);margin-top:4px">📤 Créditos CXP (libro)</div></div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;font-size:11px;color:var(--text2);line-height:1.45;padding:8px 10px;background:rgba(255,255,255,.04);border-radius:8px;border:1px solid var(--border)">
      <span><b>Referencia inventario/POS:</b> deuda a costo ${fmt(totalDeudaOperativa)} · abonos registrados ${fmt(totalAbonos)} · <b>estimación saldo</b> ${fmt(totalEstimacion)}</span>
    </div>
    ${
      provConDeuda.length === 0
        ? `<div class="empty-state"><div class="es-icon">🏭</div><div class="es-title">Sin deuda a crédito con proveedor</div><div class="es-text">Crea el proveedor en <b>Usuarios → Proveedores</b>, luego en el artículo elige <b>mercancía a crédito</b> y ese proveedor. La deuda = costo × unidades; el saldo solo baja con <b>abonos</b>.</div></div>`
        : provConDeuda
            .map((p) => {
              const basePct = p.refOperativaTotal;
              const cubierto = (p.abonos || 0) + (p.devolucionesDeuda || 0);
              const pct = basePct > 0 ? Math.min(100, (cubierto / basePct) * 100) : 0;
              const libroExtra = p.compromisoReconocido > 0
                ? `<div style="font-size:10px;color:var(--text2);margin-top:4px">Compromisos (tabla clásica): ${fmt(p.compromisoReconocido)}</div>`
                : '';
              const cxpLine = p.usaCxp
                ? `<div style="font-size:10px;color:var(--accent);margin-top:4px">Libro CXP: cargos ${fmt(p.cxpCargo)} · créditos ${fmt(p.cxpCredito)}</div>`
                : `<div style="font-size:10px;color:var(--orange);margin-top:4px">Sin movimientos CXP aún — saldo = estimación inventario</div>`;
              const difLine =
                p.usaCxp && p.difEstimVsCxp != null && Math.abs(p.difEstimVsCxp) > 0.5
                  ? `<div style="font-size:10px;color:var(--text2);margin-top:4px">Δ estimación inventario − CXP: ${p.difEstimVsCxp > 0 ? '+' : ''}${fmt(p.difEstimVsCxp)}</div>`
                  : '';
              const ventasLines = ventasInformativasLista(state, p.id);
              const ventasHtml =
                ventasLines.length === 0
                  ? '<div style="font-size:10px;color:var(--text2)">Sin ventas POS registradas aún para estos artículos.</div>'
                  : `<ul style="margin:0;padding-left:16px;font-size:10px;line-height:1.45;color:var(--text2);max-height:140px;overflow:auto">${ventasLines
                      .map((ln) => {
                        const cost = parseFloat(ln.art.precioCompra) || 0;
                        const sub = ln.uds * cost;
                        return `<li>${formatDate(ln.fecha)} · ${ln.art.nombre || ln.art.codigo || ''}: <b>${ln.uds}</b> uds × ${fmt(cost)} = <b>${fmt(sub)}</b> · Ref. ${ln.referencia} <span style="opacity:.85">(informativo)</span></li>`;
                      })
                      .join('')}</ul>`;
              const artsRows = (p.articulos || [])
                .map((a) => {
                  const uv = articuloUnidadesVendidas(state, a.id);
                  const deltaU = sumDeltaUnidadesModulo(state, p.id, a.id);
                  const linea = lineaRefDeudaArticulo(state, a, p.id);
                  const deltaHint =
                    deltaU !== 0
                      ? `<div style="font-size:9px;font-weight:400;color:var(--text2)">ajuste mód. ${deltaU > 0 ? '+' : ''}${deltaU} uds</div>`
                      : '';
                  return `<tr>
                    <td style="font-size:10px">${a.codigo || '—'}</td>
                    <td style="font-weight:700">${a.nombre || '—'}</td>
                    <td>${a.stock || 0}</td>
                    <td>${uv}</td>
                    <td>${fmt(a.precioCompra || 0)}</td>
                    <td style="color:var(--red);font-weight:700">${fmt(linea)}${deltaHint}</td>
                    <td style="white-space:nowrap">
                      <button type="button" class="btn btn-xs btn-secondary" onclick="openAjusteUnidadesProvModal('${p.id}','${a.id}')" title="Sumar o restar unidades (solo deuda en este módulo; no inventario)">±</button>
                      <button type="button" class="btn btn-xs btn-danger" onclick="quitarCreditoArticuloProveedorFromPagos('${a.id}')" title="Quitar crédito (corrige deuda)">⚠️</button>
                    </td>
                  </tr>`;
                })
                .join('');
              return `<div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px"><div><div style="font-family:Syne;font-size:16px;font-weight:800">${p.nombre}</div><div style="font-size:11px;color:var(--text2)">${p.cedula || ''} · ${p.ciudad || ''}</div>${cxpLine}${difLine}</div><div style="text-align:right"><div style="font-family:Syne;font-size:20px;font-weight:800;color:${p.saldo > 0 ? 'var(--yellow)' : 'var(--green)'}">${fmt(p.saldo)}</div><div style="font-size:10px;color:var(--text2)">${p.usaCxp ? 'saldo oficial (CXP)' : 'saldo (estimación)'}</div></div></div>
              <div style="display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap;font-size:12px;line-height:1.45;border-left:3px solid var(--accent);padding-left:10px;background:rgba(0,229,180,.06);border-radius:6px;padding:8px 10px">
              <div><span style="color:var(--text2)">Estimación deuda (inv./POS):</span> <b>${fmt(p.refOperativaTotal)}</b></div>
              <div><span style="color:var(--text2)">Estim. saldo:</span> <b style="color:var(--yellow)">${fmt(p.saldoOperativoEstimado)}</b></div>
              <div><span style="color:var(--text2)">Abonos (hist.):</span> <b style="color:var(--green)">${fmt(p.abonos)}</b></div>
              <div><span style="color:var(--text2)">Devoluciones:</span> <b style="color:var(--accent)">${fmt(p.devolucionesDeuda || 0)}</b></div>
              </div>${libroExtra}
              <div style="font-size:10px;color:var(--text2);margin:6px 0 8px">Desglose: en stock ${fmt(p.valorInventarioCosto)} · ya vendido (POS a costo) ${fmt(p.costoVendidoHist)} (${p.unidadesVendidasHist} uds) · ajustes salida hist. ${fmt(p.ajustesSalidaCosto || 0)} (${p.ajustesSalidaUds || 0} uds)${
                Math.abs(p.ajusteUnidadesCosto || 0) > 1e-9
                  ? ` · <b>ajuste unidades (mód. pagos)</b> ${fmt(p.ajusteUnidadesCosto)}`
                  : ''
              }. Artículos a crédito: ${p.articulos.length}</div>
              <details style="margin-bottom:10px"><summary style="font-size:11px;color:var(--accent);cursor:pointer;font-weight:700">🛒 Ventas POS (informativo — no sustituye abonos)</summary><div style="margin-top:8px">${ventasHtml}</div></details>
              <details open style="margin-bottom:10px"><summary style="font-size:11px;color:var(--text2);cursor:pointer;font-weight:700">📦 Artículos que generan esta deuda</summary>
              <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Ref</th><th>Artículo</th><th>Stock</th><th>Vend.</th><th>Costo u.</th><th>Ref. deuda</th><th></th></tr></thead><tbody>${artsRows || '<tr><td colspan="7" style="text-align:center;color:var(--text2)">—</td></tr>'}</tbody></table></div>
              </details>
              <div style="background:rgba(255,255,255,.05);border-radius:8px;height:8px;overflow:hidden;margin-bottom:10px"><div style="height:100%;border-radius:8px;background:linear-gradient(90deg,var(--green),var(--accent));width:${pct}%;transition:width 1s ease"></div></div><div style="font-size:10px;color:var(--text2);margin-bottom:12px">${pct.toFixed(1)}% de la deuda cubierta (abonos + devoluciones)</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-sm btn-primary" onclick="openCargoCxpModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">＋ Cargo</button><button class="btn btn-sm btn-secondary" onclick="openNotaCreditoCxpModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">📄 N/C</button><button class="btn btn-sm btn-secondary" onclick="alinearCxpEstimacionProv('${p.id}')">⚖️ Alinear</button><button class="btn btn-sm btn-secondary" onclick="verLibroCxpModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">📒 Libro CXP</button><button class="btn btn-sm btn-secondary" onclick="openCompromisoProvModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">📥 Nota clásica</button><button class="btn btn-sm btn-secondary" onclick="openAbonoProvModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">💳 Abonar</button><button class="btn btn-sm btn-secondary" onclick="verLibroProveedorModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">📔 Hist. antiguo</button><button class="btn btn-sm btn-secondary" onclick="verCompromisosProv('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">📋 Compromisos</button><button class="btn btn-sm btn-secondary" onclick="verAbonosProv('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">📋 Abonos</button></div></div>`;
            })
            .join('')
    }
    ${
      abonosRecientes.length > 0
        ? `<div class="card"><div class="card-title">💳 ÚLTIMOS ABONOS REGISTRADOS</div><div class="table-wrap"><table><thead><tr><th>Fecha / hora</th><th>Proveedor</th><th>Valor</th><th>Método</th><th>Nota</th><th></th></tr></thead><tbody>${abonosRecientes
            .map(
              (ab) =>
                `<tr><td style="white-space:nowrap;font-size:11px">${fmtLineaHora(ab.fechaHora) || formatDate(ab.fecha)}</td><td style="font-weight:700">${ab.proveedorNombre || '—'}</td><td style="color:var(--green);font-weight:700">${fmt(ab.valor || 0)}</td><td>${ab.metodo || '—'}</td><td style="color:var(--text2);font-size:11px">${ab.nota || '—'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarAbonoProv('${ab.id}')">✕</button></td></tr>`
            )
            .join('')}</tbody></table></div></div>`
        : ''
    }
    ${
      compromisosRecientes.length > 0
        ? `<div class="card"><div class="card-title">📒 ÚLTIMAS NOTAS EN LIBRO (OPCIONAL)</div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Valor</th><th>Ref.</th><th>Nota</th><th></th></tr></thead><tbody>${compromisosRecientes
            .map(
              (c) =>
                `<tr><td>${formatDate(c.fecha)}</td><td style="font-weight:700">${c.proveedorNombre || '—'}</td><td style="color:var(--accent);font-weight:700">${fmt(c.valor || 0)}</td><td style="color:var(--text2);font-size:11px">${c.referencia || '—'}</td><td style="color:var(--text2);font-size:11px">${c.nota || '—'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarCompromisoProv('${c.id}')">✕</button></td></tr>`
            )
            .join('')}</tbody></table></div></div>`
        : ''
    }`;
  }

  function compromisoProveedorOptions(state) {
    return (state.usu_proveedores || []).map((p) => ({ id: p.id, nombre: p.nombre }));
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
        return `<option value="${o.id}" data-nombre="${nm}" ${sel}>${o.nombre} · Deuda op. ${fmt(d.refOperativaTotal)} · Libro ${fmt(d.compromisoReconocido)}</option>`;
      })
      .join('');
    openModal(`
    <div class="modal-title">📥 Nota en libro (opcional)<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">Registra aquí una <b>factura o remisión</b> si quieres llevar ese control aparte. La <b>deuda operativa</b> arriba es <b>stock + vendido a costo</b>; <b>No</b> mueve caja; el saldo por pagar baja con <b>abonos</b>.</p>
    <div class="form-group"><label class="form-label">PROVEEDOR *</label><select class="form-control" id="cp-prov-sel">${optHtml}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">VALOR (COSTO) *</label><input type="number" class="form-control" id="cp-valor" min="0" step="any" placeholder="0"></div>
      <div class="form-group"><label class="form-label">FECHA</label><input type="date" class="form-control" id="cp-fecha" value="${today()}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">REFERENCIA</label><input class="form-control" id="cp-ref" placeholder="N° factura / remisión"></div>
      <div class="form-group"><label class="form-label">NOTA</label><input class="form-control" id="cp-nota" placeholder="Observación"></div>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarCompromisoProv()">📥 Guardar nota en libro</button>`);
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
      const cxpCId = `cxp-comp-${row.id}`;
      const cxpRow = {
        id: cxpCId,
        proveedor_id: provId,
        proveedor_nombre: provNombre,
        tipo: 'cargo_compra',
        naturaleza: 'cargo',
        monto: valor,
        fecha,
        referencia: referencia || null,
        nota: nota || null,
        meta: { compromisoId: row.id, origen: 'compromiso_modal' },
        fecha_hora: new Date().toISOString()
      };
      const { error: eCxp } = await supabaseClient.from('tes_cxp_movimientos').upsert(cxpRow, { onConflict: 'id' });
      if (eCxp) console.warn('[CXP] mirror compromiso:', eCxp.message);
      else {
        if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
        state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => r.id !== cxpCId);
        state.tes_cxp_movimientos.push({
          id: cxpCId,
          proveedorId: provId,
          proveedorNombre: provNombre,
          tipo: 'cargo_compra',
          naturaleza: 'cargo',
          monto: valor,
          fecha,
          referencia: referencia || '',
          nota: nota || '',
          meta: cxpRow.meta,
          fechaHora: cxpRow.fecha_hora
        });
      }
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      notify('success', '📒', 'Nota en libro guardada', `${fmt(valor)} · ${provNombre}`, { duration: 3000 });
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
      const cxpIds = [`cxp-comp-${id}`, `cxp-leg-cp-${id}`];
      for (let i = 0; i < cxpIds.length; i++) {
        await supabaseClient.from('tes_cxp_movimientos').delete().eq('id', cxpIds[i]);
      }
      state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => !cxpIds.includes(r.id));
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
    openModal(`<div class="modal-title">📒 Notas en libro — ${provNombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;font-size:12px;line-height:1.45">
    <div><span style="color:var(--text2)">Deuda total (a costo):</span> <b>${fmt(d.refOperativaTotal)}</b></div>
    <div><span style="color:var(--text2)">Suma libro (opc.):</span> <b>${fmt(d.compromisoReconocido)}</b></div>
    <div><span style="color:var(--text2)">Abonado:</span> <b style="color:var(--green)">${fmt(d.abonos)}</b></div>
    <div><span style="color:var(--text2)">Saldo por pagar:</span> <b style="color:var(--yellow)">${fmt(d.saldo)}</b></div></div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Valor</th><th>Ref.</th><th>Nota</th><th></th></tr></thead><tbody>${lines.length > 0 ? lines
      .slice()
      .reverse()
      .map(
        (c) =>
          `<tr><td>${formatDate(c.fecha)}</td><td style="color:var(--accent);font-weight:700">${fmt(c.valor)}</td><td style="font-size:11px;color:var(--text2)">${c.referencia || '—'}</td><td style="font-size:11px;color:var(--text2)">${c.nota || '—'}</td><td><button class="btn btn-xs btn-danger" onclick="closeModal();eliminarCompromisoProv('${c.id}')">✕</button></td></tr>`
      )
      .join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:20px">Sin notas en libro</td></tr>'}</tbody></table></div>
    <button class="btn btn-primary btn-sm" style="margin-top:12px;width:100%" onclick="closeModal();openCompromisoProvModal('${provId}','${String(provNombre).replace(/'/g, "\\'")}')">+ Nueva nota en libro</button>`);
  }

  async function importarEstimacionCompromisosProv(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, renderTesPagosProv, notify, fmt, confirm } = ctx;
    if (
      !confirm(
        'Se creará una línea de compromiso por cada proveedor con estimación > 0 y sin compromisos en libro. Valor = misma base que la deuda operativa (stock + vendido a costo). ¿Continuar?'
      )
    )
      return;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const targets = [];
    (state.usu_proveedores || []).forEach((p) => {
      const d = calcDeudaProveedor(state, p.id);
      if (d.compromisoReconocido === 0 && d.refOperativaTotal > 0) targets.push({ provId: p.id, nombre: p.nombre, valor: d.refOperativaTotal });
    });
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
          nota: 'Importación estimación (deuda a costo: stock+vendido)'
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
        const cxpCId = `cxp-comp-${row.id}`;
        const cxpIns = {
          id: cxpCId,
          proveedor_id: t.provId,
          proveedor_nombre: t.nombre,
          tipo: 'cargo_compra',
          naturaleza: 'cargo',
          monto: t.valor,
          fecha: row.fecha,
          referencia: '',
          nota: row.nota,
          meta: { compromisoId: row.id, origen: 'import_estimacion' },
          fecha_hora: new Date().toISOString()
        };
        const { error: ex } = await supabaseClient.from('tes_cxp_movimientos').upsert(cxpIns, { onConflict: 'id' });
        if (ex) console.warn('[CXP] import compromiso:', ex.message);
        else {
          if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
          state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => r.id !== cxpCId);
          state.tes_cxp_movimientos.push({
            id: cxpCId,
            proveedorId: t.provId,
            proveedorNombre: t.nombre,
            tipo: 'cargo_compra',
            naturaleza: 'cargo',
            monto: t.valor,
            fecha: row.fecha,
            referencia: '',
            nota: row.nota,
            meta: cxpIns.meta,
            fechaHora: cxpIns.fecha_hora
          });
        }
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
    return opts;
  }

  function openAbonoProvModal(ctx) {
    const { state, provId = '', provNombre = '', fmt, openModal, notify, today } = ctx;
    const opts = abonoModalOptions(state);
    if (provId && !opts.find((o) => o.id === provId)) {
      const d = calcDeudaProveedor(state, provId);
      opts.push({
        id: provId,
        nombre: provNombre || 'Proveedor',
        saldo: d.saldo
      });
    }
    if (opts.length === 0 && !provId) {
      notify('warning', '⚠️', 'Sin saldo pendiente', 'No hay proveedores con saldo por pagar (deuda operativa − abonos).', {
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
    <div id="ab-saldo-info" style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;display:none"><span style="color:var(--text2)">Saldo pendiente (deuda operativa − abonos):</span> <span id="ab-saldo-val" style="font-weight:700;color:var(--yellow)"></span></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">VALOR ABONO *</label><input type="number" class="form-control" id="ab-valor" min="0" placeholder="0" oninput="validateAbono()"></div>
      <div class="form-group"><label class="form-label">PAGO DEL ABONO * <span style="font-size:9px;color:var(--text2)">(define bucket en caja)</span></label><select class="form-control" id="ab-medio-caja"><option value="efectivo">💵 Efectivo → bucket efectivo</option><option value="transferencia">🏦 Transferencia → bucket transferencia</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">CAJA (egreso desde el bucket indicado)</label><select class="form-control" id="ab-caja-sel">${(state.cajas || [])
      .filter((c) => c.estado === 'abierta')
      .map((c) => `<option value="${c.id}">${c.nombre}</option>`)
      .join('') || '<option value="">— Sin caja abierta —</option>'}</select><div style="font-size:10px;color:var(--text2);margin-top:4px">Al anular o conciliar, el reintegro debe ir al mismo bucket (efectivo vs transferencia).</div></div>
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
    const metodo = document.getElementById('ab-medio-caja')?.value || 'efectivo';
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

    const fechaHoraIso = new Date().toISOString();
    const abono = {
      id: nextId(),
      proveedorId: provId,
      proveedorNombre: provNombre,
      valor,
      metodo,
      fecha,
      nota,
      fechaCreacion: today(),
      fechaHora: fechaHoraIso
    };
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from('tes_abonos_prov').upsert(
        {
          id: abono.id,
          proveedor_id: provId,
          proveedor_nombre: provNombre,
          valor,
          metodo,
          fecha,
          nota,
          fecha_hora: fechaHoraIso
        },
        { onConflict: 'id' }
      );
      if (error) throw error;
      if (!state.tes_abonos_prov) state.tes_abonos_prov = [];
      state.tes_abonos_prov.push(abono);

      const cxpAbonoId = `cxp-abono-${abono.id}`;
      const cxpAbonoRow = {
        id: cxpAbonoId,
        proveedor_id: provId,
        proveedor_nombre: provNombre,
        tipo: 'abono',
        naturaleza: 'credito',
        monto: valor,
        fecha,
        referencia: metodo || null,
        nota: nota || null,
        meta: { abonoId: abono.id, origen: 'abono_modal' },
        fecha_hora: fechaHoraIso
      };
      const { error: cxpErr } = await supabaseClient.from('tes_cxp_movimientos').upsert(cxpAbonoRow, { onConflict: 'id' });
      if (cxpErr) {
        console.warn('[CXP] mirror abono:', cxpErr.message);
        notify('warning', '📒', 'Libro CXP', 'Abono guardado; no se pudo duplicar en libro CXP. Revisa permisos o migración.', { duration: 6000 });
      } else {
        if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
        state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => r.id !== cxpAbonoId);
        state.tes_cxp_movimientos.push({
          id: cxpAbonoId,
          proveedorId: provId,
          proveedorNombre: provNombre,
          tipo: 'abono',
          naturaleza: 'credito',
          monto: valor,
          fecha,
          referencia: metodo || '',
          nota: nota || '',
          meta: cxpAbonoRow.meta,
          fechaHora: fechaHoraIso
        });
      }

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
    <div><span style="color:var(--text2)">Deuda total (a costo):</span> <b>${fmt(d.refOperativaTotal)}</b></div>
    <div><span style="color:var(--text2)">Libro (opc.):</span> <b>${fmt(d.compromisoReconocido)}</b></div>
    <div><span style="color:var(--text2)">Abonado:</span> <b style="color:var(--green)">${fmt(d.abonos)}</b></div>
    <div><span style="color:var(--text2)">Devoluciones:</span> <b style="color:var(--accent)">${fmt(d.devolucionesDeuda || 0)}</b></div>
    <div><span style="color:var(--text2)">Saldo por pagar:</span> <b style="color:var(--yellow)">${fmt(d.saldo)}</b></div></div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:12px;line-height:1.45">Desglose: en stock ${fmt(d.valorInventarioCosto)} · ya vendido (POS a costo) ${fmt(d.costoVendidoHist)} (${d.unidadesVendidasHist} uds) · ajustes salida (hist.) ${fmt(d.ajustesSalidaCosto || 0)} (${d.ajustesSalidaUds || 0} uds, ya en stock)${
      Math.abs(d.ajusteUnidadesCosto || 0) > 1e-9
        ? ` · ajuste unidades (mód. pagos) ${fmt(d.ajusteUnidadesCosto)}`
        : ''
    }</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha / hora</th><th>Valor</th><th>Método</th><th>Nota</th></tr></thead><tbody>${abonos.length > 0 ? abonos.reverse().map((ab) => `<tr><td style="white-space:nowrap;font-size:11px">${fmtLineaHora(ab.fechaHora) || formatDate(ab.fecha)}</td><td style="color:var(--green);font-weight:700">${fmt(ab.valor)}</td><td>${ab.metodo || '—'}</td><td style="color:var(--text2);font-size:11px">${ab.nota || '—'}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:20px">Sin abonos registrados</td></tr>'}</tbody></table></div>
    <button class="btn btn-primary btn-sm" style="margin-top:12px;width:100%" onclick="closeModal();openAbonoProvModal('${provId}','${String(provNombre).replace(/'/g, "\\'")}')">+ Nuevo Abono</button>`);
  }

  function openAjusteUnidadesProvModal(ctx) {
    const { state, provId, artId, fmt, openModal, notify } = ctx;
    const art = (state.articulos || []).find((a) => String(a.id) === String(artId));
    if (!art || art.tituloMercancia !== 'credito' || !art.proveedorId) {
      notify('warning', '⚠️', 'Artículo', 'Solo aplica a mercancía a crédito con proveedor.', { duration: 3500 });
      return;
    }
    if (String(art.proveedorId) !== String(provId)) {
      notify('warning', '⚠️', 'Proveedor', 'El artículo no corresponde a este proveedor.', { duration: 3500 });
      return;
    }
    const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(provId));
    const provNombre = prov?.nombre || '';
    const pc = parseFloat(art.precioCompra) || 0;
    const acum = sumDeltaUnidadesModulo(state, provId, artId);
    const historial = (state.tes_ajustes_unidades_prov || [])
      .filter((r) => String(r.proveedorId) === String(provId) && String(r.articuloId) === String(artId))
      .slice()
      .sort((a, b) => new Date(b.fechaHora || 0).getTime() - new Date(a.fechaHora || 0).getTime())
      .slice(0, 12);
    const histRows =
      historial.length === 0
        ? '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px;font-size:11px">Sin movimientos aún</td></tr>'
        : historial
            .map(
              (r) =>
                `<tr><td style="font-size:10px;white-space:nowrap">${fmtLineaHora(r.fechaHora)}</td><td style="font-weight:700">${(parseFloat(r.deltaUnidades) || 0) > 0 ? '+' : ''}${parseFloat(r.deltaUnidades) || 0}</td><td style="font-size:10px;color:var(--text2)">${String(r.nota || '—').replace(/</g, '&lt;')}</td><td><button type="button" class="btn btn-xs btn-danger" onclick="eliminarAjusteUnidadesProv('${r.id}','${provId}','${artId}')">✕</button></td></tr>`
            )
            .join('');
    const tituloArt = String(art.nombre || art.codigo || artId).replace(/</g, '&lt;');
    openModal(`<div class="modal-title">Ajuste de unidades (solo deuda)<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">No modifica <b>inventario</b>. Suma o resta unidades <b>virtuales</b> para este proveedor: el impacto en deuda es <b>unidades × costo actual</b> (${fmt(pc)}).</p>
    <div style="font-size:12px;margin-bottom:10px"><b>${tituloArt}</b><div style="font-size:10px;color:var(--text2);margin-top:4px">${provNombre} · acumulado ajuste: <b>${acum > 0 ? '+' : ''}${acum}</b> uds</div></div>
    <div class="form-group"><label class="form-label">UNIDADES (+ sumar deuda · − restar)</label><input type="number" class="form-control" id="apu-delta" step="1" placeholder="Ej: 2 o -1"></div>
    <div class="form-group"><label class="form-label">NOTA (opcional)</label><input class="form-control" id="apu-nota" placeholder="Motivo del ajuste"></div>
    <p style="font-size:11px;color:var(--accent);margin:0 0 12px" id="apu-preview">Impacto estimado: —</p>
    <button class="btn btn-primary" style="width:100%;margin-bottom:14px" onclick="guardarAjusteUnidadesProv('${provId}','${artId}')">Guardar ajuste</button>
    <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">Últimos movimientos (este artículo)</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Δ uds</th><th>Nota</th><th></th></tr></thead><tbody>${histRows}</tbody></table></div>`);
    setTimeout(() => {
      const inp = document.getElementById('apu-delta');
      const prev = document.getElementById('apu-preview');
      const recalc = () => {
        const d = parseFloat(inp?.value);
        if (!prev) return;
        if (!Number.isFinite(d) || d === 0) {
          prev.textContent = 'Impacto estimado: —';
          return;
        }
        prev.textContent = `Impacto estimado: ${d > 0 ? '+' : ''}${fmt(d * pc)} (${d > 0 ? '+' : ''}${d} uds × ${fmt(pc)})`;
      };
      if (inp) {
        inp.addEventListener('input', recalc);
        inp.focus();
      }
      recalc();
    }, 50);
  }

  async function guardarAjusteUnidadesProv(ctx) {
    const {
      state,
      provId,
      artId,
      uid,
      dbId,
      showLoadingOverlay,
      supabaseClient,
      closeModal,
      renderTesPagosProv,
      notify,
      fmt,
      saveRecord
    } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const delta = parseFloat(document.getElementById('apu-delta')?.value || '');
    const nota = (document.getElementById('apu-nota')?.value || '').trim();
    if (!Number.isFinite(delta) || delta === 0) {
      notify('warning', '⚠️', 'Unidades', 'Ingresa un número distinto de cero (entero recomendado).', { duration: 3500 });
      return;
    }
    const art = (state.articulos || []).find((a) => String(a.id) === String(artId));
    const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(provId));
    if (!art || !prov) {
      notify('warning', '⚠️', 'Datos', 'Artículo o proveedor no encontrado.', { duration: 3000 });
      return;
    }
    const row = {
      id: nextId(),
      proveedorId: provId,
      articuloId: artId,
      deltaUnidades: delta,
      nota,
      fechaHora: new Date().toISOString()
    };
    try {
      showLoadingOverlay('connecting');
      const useSave = typeof saveRecord === 'function';
      if (useSave) {
        const ok = await saveRecord('tes_ajustes_unidades_prov', row.id, row);
        if (!ok) throw new Error('No se pudo guardar el ajuste.');
      } else {
        const { error } = await supabaseClient.from('tes_ajustes_unidades_prov').upsert(
          {
            id: row.id,
            proveedor_id: provId,
            articulo_id: artId,
            delta_unidades: delta,
            nota: nota || null,
            fecha_hora: row.fechaHora
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
      }
      if (!state.tes_ajustes_unidades_prov) state.tes_ajustes_unidades_prov = [];
      state.tes_ajustes_unidades_prov.unshift(row);
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      const pc = parseFloat(art.precioCompra) || 0;
      notify('success', '±', 'Ajuste guardado', `${delta > 0 ? '+' : ''}${delta} uds · ${fmt(delta * pc)}`, { duration: 3500 });
    } catch (err) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', err.message || String(err), { duration: 6000 });
      console.error(err);
    }
  }

  async function eliminarAjusteUnidadesProv(ctx) {
    const { state, id, confirm, supabaseClient, renderTesPagosProv, notify, closeModal, reopen } = ctx;
    if (!confirm('¿Eliminar este ajuste de unidades? La deuda se recalculará.')) return;
    try {
      const { error } = await supabaseClient.from('tes_ajustes_unidades_prov').delete().eq('id', id);
      if (error) throw error;
      state.tes_ajustes_unidades_prov = (state.tes_ajustes_unidades_prov || []).filter((r) => r.id !== id);
      if (typeof closeModal === 'function') closeModal();
      renderTesPagosProv();
      notify('success', '🗑️', 'Ajuste eliminado', 'Deuda recalculada.', { duration: 2000 });
      if (typeof reopen === 'function') setTimeout(() => reopen(), 80);
    } catch (e) {
      console.warn('eliminarAjusteUnidadesProv:', e.message || e);
      notify('danger', '⚠️', 'No se pudo eliminar', e.message || 'Error en base de datos', { duration: 4500 });
    }
  }

  async function eliminarAbonoProv(ctx) {
    const { state, id, confirm, supabaseClient, renderTesPagosProv, notify } = ctx;
    if (!confirm('¿Eliminar este abono? El saldo pendiente se recalculará.')) return;
    try {
      const { error } = await supabaseClient.from('tes_abonos_prov').delete().eq('id', id);
      if (error) throw error;
      state.tes_abonos_prov = (state.tes_abonos_prov || []).filter((ab) => ab.id !== id);
      const cxpIds = [`cxp-abono-${id}`, `cxp-leg-ab-${id}`];
      for (let i = 0; i < cxpIds.length; i++) {
        await supabaseClient.from('tes_cxp_movimientos').delete().eq('id', cxpIds[i]);
      }
      state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => !cxpIds.includes(r.id));
      renderTesPagosProv();
      notify('success', '🗑️', 'Abono eliminado', 'Saldo recalculado.', { duration: 2000 });
    } catch (e) {
      console.warn('Error eliminando abono:', e.message || e);
      notify('danger', '⚠️', 'No se pudo eliminar', e.message || 'Error en base de datos', { duration: 4500 });
    }
  }

  function verLibroProveedorModal(ctx) {
    const { state, provId, provNombre, fmt, formatDate, openModal } = ctx;
    const rows = [];
    (state.tes_libro_proveedor || [])
      .filter((r) => String(r.proveedorId) === String(provId))
      .forEach((r) => {
        const label = r.tipo === 'correccion' ? 'Corrección de deuda' : 'Registro de deuda (artículo)';
        rows.push({
          sort: new Date(r.fechaHora || 0).getTime(),
          html: `<tr><td style="font-size:11px;white-space:nowrap">${fmtLineaHora(r.fechaHora)}</td><td><span class="badge badge-warn">${label}</span></td><td style="font-size:11px;color:var(--text2)">${(r.descripcion || '—').replace(/</g, '&lt;')}</td><td style="font-weight:700">${fmt(r.valor || 0)}</td></tr>`
        });
      });
    (state.tes_abonos_prov || [])
      .filter((a) => String(a.proveedorId) === String(provId))
      .forEach((a) => {
        const fh = a.fechaHora || a.fecha;
        rows.push({
          sort: new Date(fh || a.fecha || 0).getTime(),
          html: `<tr><td style="font-size:11px;white-space:nowrap">${fmtLineaHora(a.fechaHora || null) || formatDate(a.fecha)}</td><td><span class="badge badge-ok">Abono</span></td><td style="font-size:11px;color:var(--text2)">${(a.metodo || '') + (a.nota ? ' · ' + a.nota : '')}</td><td style="font-weight:700;color:var(--green)">${fmt(a.valor || 0)}</td></tr>`
        });
      });
    (state.tes_devoluciones_prov || [])
      .filter((dv) => String(dv.proveedorId) === String(provId))
      .forEach((dv) => {
        rows.push({
          sort: new Date(dv.fechaHora || 0).getTime(),
          html: `<tr><td style="font-size:11px;white-space:nowrap">${fmtLineaHora(dv.fechaHora)}</td><td><span class="badge badge-vitrina">Devolución</span></td><td style="font-size:11px;color:var(--text2)">${String(dv.nota || dv.articuloNombre || '—').replace(/</g, '&lt;')}</td><td style="font-weight:700;color:var(--accent)">−${fmt(dv.valorCosto || 0)}</td></tr>`
        });
      });
    (state.tes_ajustes_unidades_prov || [])
      .filter((r) => String(r.proveedorId) === String(provId))
      .forEach((r) => {
        const artA = (state.articulos || []).find((a) => String(a.id) === String(r.articuloId));
        const nm = artA ? artA.nombre || artA.codigo || r.articuloId : r.articuloId;
        const pc = artA ? parseFloat(artA.precioCompra) || 0 : 0;
        const du = parseFloat(r.deltaUnidades) || 0;
        const val = du * pc;
        const col = val >= 0 ? 'var(--red)' : 'var(--green)';
        const sign = val >= 0 ? '+' : '−';
        const absVal = Math.abs(val);
        rows.push({
          sort: new Date(r.fechaHora || 0).getTime(),
          html: `<tr><td style="font-size:11px;white-space:nowrap">${fmtLineaHora(r.fechaHora)}</td><td><span class="badge badge-pend">Ajuste uds (mód.)</span></td><td style="font-size:11px;color:var(--text2)">${String(nm).replace(/</g, '&lt;')}: ${du > 0 ? '+' : ''}${du} uds × ${fmt(pc)}${r.nota ? ' · ' + String(r.nota).replace(/</g, '&lt;') : ''}</td><td style="font-weight:700;color:${col}">${sign}${fmt(absVal)}</td></tr>`
        });
      });
    rows.sort((a, b) => b.sort - a.sort);
    const tbody = rows.length ? rows.map((r) => r.html).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:20px">Sin movimientos en libro</td></tr>';
    openModal(`<div class="modal-title">📔 Libro — ${provNombre.replace(/</g, '&lt;')}<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">Deuda, abonos, <b>devoluciones</b> y <b>ajustes de unidades</b> (solo módulo pagos) con fecha y hora.</p>
    <div class="table-wrap"><table><thead><tr><th>Fecha / hora</th><th>Tipo</th><th>Detalle</th><th>Valor</th></tr></thead><tbody>${tbody}</tbody></table></div>`);
  }

  async function quitarCreditoArticuloProveedor(ctx) {
    const {
      state,
      artId,
      confirm,
      supabaseClient,
      showLoadingOverlay,
      renderTesPagosProv,
      notify,
      fmt,
      dbId,
      uid,
      renderArticulosList,
      renderArticulos,
      updateNavBadges
    } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const art = (state.articulos || []).find((a) => String(a.id) === String(artId));
    if (!art || art.tituloMercancia !== 'credito' || !art.proveedorId) {
      notify('warning', '⚠️', 'Sin crédito', 'Este artículo no está a crédito con proveedor.', { duration: 3000 });
      return;
    }
    const provId = art.proveedorId;
    const provNombre = art.proveedorNombre || (state.usu_proveedores || []).find((p) => String(p.id) === String(provId))?.nombre || '';
    const refAntes = lineaRefDeudaArticulo(state, art, provId);
    if (!confirm('¿Está seguro de editar esta deuda? Se quitará la mercancía a crédito de este artículo. El stock no se modifica desde este módulo.')) return;
    if (!confirm('Confirme que desea continuar con la corrección de la deuda.')) return;
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient
        .from('products')
        .update({
          titulo_mercancia: 'contado',
          proveedor_id: null,
          proveedor_nombre: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', artId);
      if (error) throw error;
      art.tituloMercancia = 'contado';
      art.proveedorId = null;
      art.proveedorNombre = '';
      const desc = `Corrección: quitado crédito · ${art.nombre || art.codigo || artId}`;
      const libroRow = {
        id: nextId(),
        proveedorId: provId,
        proveedorNombre: provNombre,
        tipo: 'correccion',
        articuloId: artId,
        descripcion: desc,
        valor: refAntes,
        fechaHora: new Date().toISOString()
      };
      const { error: e2 } = await supabaseClient.from('tes_libro_proveedor').insert({
        id: libroRow.id,
        proveedor_id: provId,
        proveedor_nombre: provNombre,
        tipo: 'correccion',
        articulo_id: artId,
        descripcion: desc,
        valor: refAntes,
        fecha_hora: libroRow.fechaHora
      });
      if (e2) console.warn('tes_libro_proveedor:', e2.message);
      else {
        if (!state.tes_libro_proveedor) state.tes_libro_proveedor = [];
        state.tes_libro_proveedor.unshift(libroRow);
      }
      showLoadingOverlay('hide');
      if (typeof renderArticulosList === 'function' && document.getElementById('art-tbody')) renderArticulosList();
      else if (typeof renderArticulos === 'function') renderArticulos();
      renderTesPagosProv();
      if (typeof updateNavBadges === 'function') updateNavBadges();
      notify('success', '✅', 'Deuda corregida', `Referencia anterior: ${fmt(refAntes)}`, { duration: 4000 });
    } catch (err) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', err.message || String(err), { duration: 5000 });
      console.error(err);
    }
  }

  async function logRegistroDeudaArticulo(ctx) {
    const { state, supabaseClient, dbId, uid, artLocal } = ctx;
    if (!artLocal || artLocal.tituloMercancia !== 'credito' || !artLocal.proveedorId) return;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(artLocal.proveedorId));
    const provNombre = prov?.nombre || artLocal.proveedorNombre || '';
    const pc = parseFloat(artLocal.precioCompra) || 0;
    const st = parseFloat(artLocal.stock) || 0;
    const valor = pc * st;
    const descripcionSafe = `Alta deuda por artículo: ${artLocal.nombre || artLocal.codigo || ''} (${st} uds × costo ${pc})`;
    const fechaHora = new Date().toISOString();
    const row = {
      id: nextId(),
      proveedorId: artLocal.proveedorId,
      proveedorNombre: provNombre,
      tipo: 'registro_deuda',
      articuloId: artLocal.id,
      descripcion: descripcionSafe,
      valor,
      fechaHora
    };
    const { error } = await supabaseClient.from('tes_libro_proveedor').insert({
      id: row.id,
      proveedor_id: artLocal.proveedorId,
      proveedor_nombre: provNombre,
      tipo: 'registro_deuda',
      articulo_id: artLocal.id,
      descripcion: descripcionSafe,
      valor,
      fecha_hora: fechaHora
    });
    if (error) {
      console.warn('[libro proveedor]', error.message);
      return;
    }
    if (!state.tes_libro_proveedor) state.tes_libro_proveedor = [];
    state.tes_libro_proveedor.unshift(row);
  }

  function renderTesCajas(ctx) {
    const { state, fmt } = ctx;
    const cajas = state.cajas || [];
    if (global.AppCajaLogic?.normalizeAllCajas) global.AppCajaLogic.normalizeAllCajas(state);
    const miniSaldos = (c) => {
      global.AppCajaLogic?.normalizeCaja?.(c);
      const s = c.saldosMetodo || {};
      const keys = ['transferencia', 'addi', 'contraentrega', 'tarjeta', 'digital', 'otro'];
      const bits = keys.map((k) => {
        const v = parseFloat(s[k]);
        if (!Number.isFinite(v) || v === 0) return '';
        const col = v < 0 ? '#f87171' : 'var(--text2)';
        return `<span style="color:var(--text2)">${k}:</span> <b style="color:${col}">${fmt(v)}</b>`;
      }).filter(Boolean);
      return bits.length ? `<div style="font-size:10px;line-height:1.5;margin:8px 0;color:var(--text2)">${bits.join(' · ')}</div>` : '';
    };
    document.getElementById('tes_cajas-content').innerHTML = `<div style="font-size:11px;color:var(--text2);margin-bottom:12px;line-height:1.45">💵 <b>Turno</b>: con la caja <b>cerrada</b> usa <b>Abrir turno</b> (arrastra lo del último cierre). Con la caja <b>abierta</b> cobras en POS; al terminar <b>Cerrar turno</b> hace arqueo (efectivo contado vs libro, bancos declarados, sobrante/faltante). El número grande es efectivo en libro.</div><button class="btn btn-primary" style="margin-bottom:16px" onclick="openCajaModal()">+ Nueva Caja</button><div class="grid-2">${cajas
      .map(
        (c) =>
          `<div class="card" style="margin:0;border-color:${c.estado === 'abierta' ? 'rgba(0,229,180,.3)' : 'var(--border)'}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-family:Syne;font-weight:800;font-size:16px">${c.nombre}</div><span class="badge ${c.estado === 'abierta' ? 'badge-ok' : 'badge-pend'}">${c.estado === 'abierta' ? 'turno abierto' : 'cerrada'}</span></div><div style="font-size:10px;color:var(--text2);margin-bottom:4px">Efectivo en caja (libro)</div>${(() => {
            global.AppCajaLogic?.normalizeCaja?.(c);
            const efe = Number(c.saldosMetodo?.efectivo ?? c.saldo ?? 0);
            const col = efe < 0 ? '#f87171' : 'var(--accent)';
            return '<div style="font-family:Syne;font-size:28px;font-weight:800;color:' + col + ';margin-bottom:4px">' + fmt(efe) + '</div>';
          })()}${miniSaldos(c)}<div class="btn-group" style="flex-wrap:wrap">${c.estado === 'abierta' ? `<button class="btn btn-sm btn-danger" onclick="cerrarCaja('${c.id}')">🔒 Cerrar turno</button>` : `<button class="btn btn-sm btn-primary" onclick="abrirCaja('${c.id}')">🔓 Abrir turno</button>`}<button class="btn btn-sm btn-secondary" onclick="verCierresCajaModal('${c.id}')">📋 Cierres</button></div></div>`
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

  function escCxp(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function openCargoCxpModal(ctx) {
    const { state, provId = '', provNombre = '', openModal, notify, today } = ctx;
    const provs = state.usu_proveedores || [];
    if (provs.length === 0) {
      notify('warning', '⚠️', 'Proveedores', 'Crea al menos un proveedor.', { duration: 3000 });
      return;
    }
    const optHtml = provs
      .map((o) => {
        const sel = o.id === provId ? 'selected' : '';
        const nm = escCxp(o.nombre);
        return `<option value="${escCxp(o.id)}" data-nombre="${nm}" ${sel}>${nm}</option>`;
      })
      .join('');
    openModal(`<div class="modal-title">＋ Cargo compra (libro CXP)<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">Aumenta la deuda reconocida con el proveedor (factura, remisión, compra a crédito). No modifica inventario.</p>
    <div class="form-group"><label class="form-label">Proveedor *</label><select class="form-control" id="cxp-cargo-prov">${optHtml}</select></div>
    <div class="form-row"><div class="form-group"><label class="form-label">Monto (COP) *</label><input type="number" class="form-control" id="cxp-cargo-valor" min="0" step="any" placeholder="0"></div>
    <div class="form-group"><label class="form-label">Fecha</label><input type="date" class="form-control" id="cxp-cargo-fecha" value="${today()}"></div></div>
    <div class="form-group"><label class="form-label">Referencia</label><input class="form-control" id="cxp-cargo-ref" placeholder="N° factura / remisión"></div>
    <div class="form-group"><label class="form-label">Nota</label><input class="form-control" id="cxp-cargo-nota" placeholder="Observación"></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarCargoCxpMov()">Guardar cargo</button>`);
    if (provId) {
      setTimeout(() => {
        const s = document.getElementById('cxp-cargo-prov');
        if (s) s.value = provId;
      }, 50);
    }
  }

  function openNotaCreditoCxpModal(ctx) {
    const { state, provId = '', openModal, notify, today } = ctx;
    const provs = state.usu_proveedores || [];
    if (provs.length === 0) {
      notify('warning', '⚠️', 'Proveedores', 'Crea al menos un proveedor.', { duration: 3000 });
      return;
    }
    const optHtml = provs
      .map((o) => {
        const sel = o.id === provId ? 'selected' : '';
        const nm = escCxp(o.nombre);
        return `<option value="${escCxp(o.id)}" data-nombre="${nm}" ${sel}>${nm}</option>`;
      })
      .join('');
    openModal(`<div class="modal-title">📄 Nota de crédito (libro CXP)<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">Reduce el saldo por pagar (NC del proveedor, descuento acordado). No mueve caja sola.</p>
    <div class="form-group"><label class="form-label">Proveedor *</label><select class="form-control" id="cxp-nc-prov">${optHtml}</select></div>
    <div class="form-row"><div class="form-group"><label class="form-label">Monto (COP) *</label><input type="number" class="form-control" id="cxp-nc-valor" min="0" step="any"></div>
    <div class="form-group"><label class="form-label">Fecha</label><input type="date" class="form-control" id="cxp-nc-fecha" value="${today()}"></div></div>
    <div class="form-group"><label class="form-label">Referencia</label><input class="form-control" id="cxp-nc-ref" placeholder="N° nota crédito"></div>
    <div class="form-group"><label class="form-label">Nota</label><input class="form-control" id="cxp-nc-nota"></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarNotaCreditoCxpMov()">Guardar nota crédito</button>`);
    if (provId) {
      setTimeout(() => {
        const s = document.getElementById('cxp-nc-prov');
        if (s) s.value = provId;
      }, 50);
    }
  }

  async function guardarCargoCxpMov(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, closeModal, renderTesPagosProv, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const sel = document.getElementById('cxp-cargo-prov');
    const opt = sel?.options[sel.selectedIndex];
    const provId = sel?.value;
    const provNombre = opt?.getAttribute('data-nombre') || '';
    const valor = parseFloat(document.getElementById('cxp-cargo-valor')?.value || 0);
    const fecha = document.getElementById('cxp-cargo-fecha')?.value || today();
    const referencia = document.getElementById('cxp-cargo-ref')?.value.trim() || '';
    const nota = document.getElementById('cxp-cargo-nota')?.value.trim() || '';
    if (!provId || valor <= 0) {
      notify('warning', '⚠️', 'Datos', 'Proveedor y monto válido requeridos.', { duration: 3000 });
      return;
    }
    const id = nextId();
    const fechaHora = new Date().toISOString();
    const row = {
      id,
      proveedor_id: provId,
      proveedor_nombre: provNombre,
      tipo: 'cargo_compra',
      naturaleza: 'cargo',
      monto: valor,
      fecha,
      referencia: referencia || null,
      nota: nota || null,
      meta: { origen: 'manual_cargo' },
      fecha_hora: fechaHora
    };
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from('tes_cxp_movimientos').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
      state.tes_cxp_movimientos.unshift({
        id,
        proveedorId: provId,
        proveedorNombre: provNombre,
        tipo: 'cargo_compra',
        naturaleza: 'cargo',
        monto: valor,
        fecha,
        referencia,
        nota,
        meta: row.meta,
        fechaHora: fechaHora
      });
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      notify('success', '📥', 'Cargo CXP', `${fmt(valor)} · ${provNombre}`, { duration: 3000 });
    } catch (e) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', e.message || String(e), { duration: 5000 });
    }
  }

  async function guardarNotaCreditoCxpMov(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, closeModal, renderTesPagosProv, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const sel = document.getElementById('cxp-nc-prov');
    const opt = sel?.options[sel.selectedIndex];
    const provId = sel?.value;
    const provNombre = opt?.getAttribute('data-nombre') || '';
    const valor = parseFloat(document.getElementById('cxp-nc-valor')?.value || 0);
    const fecha = document.getElementById('cxp-nc-fecha')?.value || today();
    const referencia = document.getElementById('cxp-nc-ref')?.value.trim() || '';
    const nota = document.getElementById('cxp-nc-nota')?.value.trim() || '';
    if (!provId || valor <= 0) {
      notify('warning', '⚠️', 'Datos', 'Proveedor y monto válido requeridos.', { duration: 3000 });
      return;
    }
    const id = nextId();
    const fechaHora = new Date().toISOString();
    const row = {
      id,
      proveedor_id: provId,
      proveedor_nombre: provNombre,
      tipo: 'nota_credito',
      naturaleza: 'credito',
      monto: valor,
      fecha,
      referencia: referencia || null,
      nota: nota || null,
      meta: { origen: 'manual_nc' },
      fecha_hora: fechaHora
    };
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from('tes_cxp_movimientos').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
      state.tes_cxp_movimientos.unshift({
        id,
        proveedorId: provId,
        proveedorNombre: provNombre,
        tipo: 'nota_credito',
        naturaleza: 'credito',
        monto: valor,
        fecha,
        referencia,
        nota,
        meta: row.meta,
        fechaHora: fechaHora
      });
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      notify('success', '📄', 'Nota crédito CXP', `${fmt(valor)} · ${provNombre}`, { duration: 3000 });
    } catch (e) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', e.message || String(e), { duration: 5000 });
    }
  }

  function verLibroCxpModal(ctx) {
    const { state, provId, provNombre, fmt, formatDate, openModal } = ctx;
    const lines = (state.tes_cxp_movimientos || [])
      .filter((r) => String(r.proveedorId) === String(provId))
      .slice()
      .sort((a, b) => String(b.fechaHora || '').localeCompare(String(a.fechaHora || '')));
    const d = calcDeudaProveedor(state, provId);
    const rowsHtml =
      lines.length === 0
        ? '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:20px">Sin movimientos en libro CXP</td></tr>'
        : lines
            .map((r) => {
              const sign = r.naturaleza === 'cargo' ? '+' : '−';
              const col = r.naturaleza === 'cargo' ? 'var(--red)' : 'var(--green)';
              const tipoLbl =
                r.tipo === 'cargo_compra'
                  ? 'Cargo'
                  : r.tipo === 'abono'
                    ? 'Abono'
                    : r.tipo === 'nota_credito'
                      ? 'N/C'
                      : r.tipo === 'ajuste'
                        ? 'Ajuste'
                        : r.tipo;
              return `<tr><td style="font-size:11px;white-space:nowrap">${fmtLineaHora(r.fechaHora) || formatDate(r.fecha)}</td><td><span class="badge badge-warn" style="font-size:9px">${tipoLbl}</span></td><td style="font-size:11px;color:var(--text2)">${escCxp(r.referencia || '—')}</td><td style="font-size:11px;color:var(--text2)">${escCxp(r.nota || '—')}</td><td style="font-weight:700;color:${col}">${sign}${fmt(r.monto)}</td><td><button type="button" class="btn btn-xs btn-danger" onclick="eliminarCxpMovimiento('${escCxp(r.id)}')">✕</button></td></tr>`;
            })
            .join('');
    openModal(`<div class="modal-title">📒 Libro CXP — ${escCxp(provNombre)}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;font-size:12px;line-height:1.45">
    <div><span style="color:var(--text2)">Cargos:</span> <b style="color:var(--red)">${fmt(d.cxpCargo)}</b></div>
    <div><span style="color:var(--text2)">Créditos:</span> <b style="color:var(--green)">${fmt(d.cxpCredito)}</b></div>
    <div><span style="color:var(--text2)">Saldo:</span> <b style="color:var(--yellow)">${fmt(d.saldo)}</b></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Ref.</th><th>Nota</th><th>Monto</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`);
  }

  async function eliminarCxpMovimiento(ctx) {
    const { state, id, confirm, supabaseClient, renderTesPagosProv, notify, closeModal } = ctx;
    if (!confirm('¿Eliminar este movimiento del libro CXP?')) return;
    try {
      const { error } = await supabaseClient.from('tes_cxp_movimientos').delete().eq('id', id);
      if (error) throw error;
      state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => r.id !== id);
      if (typeof closeModal === 'function') closeModal();
      renderTesPagosProv();
      notify('success', '🗑️', 'Movimiento eliminado', 'Saldo recalculado.', { duration: 2000 });
    } catch (e) {
      notify('danger', '⚠️', 'Error', e.message || String(e), { duration: 4500 });
    }
  }

  async function alinearCxpEstimacionProv(ctx) {
    const { state, provId, supabaseClient, dbId, uid, today, showLoadingOverlay, renderTesPagosProv, notify, fmt, confirm } = ctx;
    const d = calcDeudaProveedor(state, provId);
    if (!d.usaCxp) {
      notify('info', '📒', 'CXP', 'No hay movimientos en libro CXP para este proveedor. Registra cargos o sincroniza datos.', { duration: 4500 });
      return;
    }
    const cxp = sumCxpProveedor(state, provId);
    const net = cxp.cargo - cxp.credito;
    const target = d.saldoOperativoEstimado;
    const delta = target - net;
    if (Math.abs(delta) < 0.5) {
      notify('success', '✓', 'Alineado', 'El saldo CXP ya coincide con la estimación operativa.', { duration: 3500 });
      return;
    }
    if (
      !confirm(
        `Se creará un movimiento de ajuste de ${fmt(Math.abs(delta))} para acercar el neto CXP (${fmt(net)}) a la estimación operativa (${fmt(target)}). ¿Continuar?`,
      )
    ) {
      return;
    }
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(provId));
    const provNombre = prov?.nombre || '';
    const id = nextId();
    const fechaHora = new Date().toISOString();
    const fecha = today();
    let row;
    if (delta > 0) {
      row = {
        id,
        proveedor_id: provId,
        proveedor_nombre: provNombre,
        tipo: 'ajuste',
        naturaleza: 'cargo',
        monto: delta,
        fecha,
        referencia: 'Alineación estimación',
        nota: 'Ajuste para igualar saldo CXP a estimación inventario/POS',
        meta: { origen: 'alinear_estimacion' },
        fecha_hora: fechaHora
      };
    } else {
      row = {
        id,
        proveedor_id: provId,
        proveedor_nombre: provNombre,
        tipo: 'ajuste',
        naturaleza: 'credito',
        monto: -delta,
        fecha,
        referencia: 'Alineación estimación',
        nota: 'Ajuste para igualar saldo CXP a estimación inventario/POS',
        meta: { origen: 'alinear_estimacion' },
        fecha_hora: fechaHora
      };
    }
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from('tes_cxp_movimientos').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
      state.tes_cxp_movimientos.unshift({
        id: row.id,
        proveedorId: provId,
        proveedorNombre: provNombre,
        tipo: 'ajuste',
        naturaleza: row.naturaleza,
        monto: row.monto,
        fecha: row.fecha,
        referencia: row.referencia,
        nota: row.nota,
        meta: row.meta,
        fechaHora: fechaHora
      });
      showLoadingOverlay('hide');
      renderTesPagosProv();
      notify('success', '⚖️', 'Ajuste CXP', `Neto ajustado hacia estimación (${fmt(target)}).`, { duration: 4500 });
    } catch (e) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', e.message || String(e), { duration: 5000 });
    }
  }

  global.AppTreasuryModule = {
    sumCxpProveedor,
    calcDeudaProveedor,
    renderTesPagosProv,
    openAjusteUnidadesProvModal,
    guardarAjusteUnidadesProv,
    eliminarAjusteUnidadesProv,
    openCompromisoProvModal,
    guardarCompromisoProv,
    eliminarCompromisoProv,
    verCompromisosProv,
    importarEstimacionCompromisosProv,
    openCargoCxpModal,
    openNotaCreditoCxpModal,
    guardarCargoCxpMov,
    guardarNotaCreditoCxpMov,
    verLibroCxpModal,
    eliminarCxpMovimiento,
    alinearCxpEstimacionProv,
    verLibroProveedorModal,
    quitarCreditoArticuloProveedor,
    logRegistroDeudaArticulo,
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
