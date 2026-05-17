// Proveedores / Cuentas por pagar V1 (tablas compras + proveedor_*)
(function initProveedoresPaymentsModule(global) {
  const Svc = () => global.AppComprasCxp;
  let _detalleProvId = null;

  function ctxBase() {
    return {
      state: global.state,
      supabaseClient: global.supabaseClient,
      dbId: global.dbId,
      notify: global.notify,
      fmt: global.fmt,
      today: global.today,
      openModal: global.openModal,
      closeModal: global.closeModal,
      showLoadingOverlay: global.showLoadingOverlay,
    };
  }

  function totalDeudaGlobal(state) {
    return (state.usu_proveedores || []).reduce((s, p) => s + (Svc()?.calcSaldoProveedor(state, p.id).saldo || 0), 0);
  }

  /** Pagos del mes según libro CXP (misma fuente que el saldo). */
  function abonosMes(state) {
    const mes = (global.today?.() || '').slice(0, 7);
    return (state.proveedor_cxp_movimientos || [])
      .filter(
        (m) =>
          m.estado === 'active' &&
          m.tipo === 'abono' &&
          m.naturaleza === 'credito' &&
          String(m.fecha || '').slice(0, 7) === mes,
      )
      .reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
  }

  function render(ctx, mountEl) {
    const el = mountEl || document.getElementById('tes-pagos-prov-rebuild-body') || document.getElementById('tes_pagos_prov-content');
    if (!el || !Svc()) {
      if (el)
        el.innerHTML =
          '<div class="card" style="padding:20px;color:var(--red)">Cargue <b>compras-cxp-service.js</b> antes de este módulo.</div>';
      return;
    }
    const state = (ctx && ctx.state) || global.state || {};
    const fmt = (ctx && ctx.fmt) || global.fmt;
    const esc = Svc().esc;
    const deudaTotal = totalDeudaGlobal(state);
    const pagadoMes = abonosMes(state);
    const provs = [...(state.usu_proveedores || [])].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    const puedeAbonar = provs.length > 0 && deudaTotal > 0.009;
    const abonoBtnTitle = !provs.length
      ? 'Registra proveedores en Usuarios → Proveedores'
      : deudaTotal <= 0.009
        ? 'No hay deuda pendiente por pagar'
        : '';

    el.innerHTML = `
    <div class="kpi-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px">
      <div class="card" style="padding:14px;margin:0"><div style="font-size:11px;color:var(--text2)">Deuda total actual</div><div style="font-size:20px;font-weight:800;color:var(--red)">${fmt(deudaTotal)}</div></div>
      <div class="card" style="padding:14px;margin:0"><div style="font-size:11px;color:var(--text2)">Pagado este mes</div><div style="font-size:20px;font-weight:800;color:var(--accent)">${fmt(pagadoMes)}</div></div>
      <div class="card" style="padding:14px;margin:0"><div style="font-size:11px;color:var(--text2)">Proveedores</div><div style="font-size:20px;font-weight:800">${provs.length}</div></div>
    </div>
    <div class="card" style="margin:0 0 16px">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>Cuentas por pagar · proveedores</span>
        <div class="btn-group">
          <button type="button" class="btn btn-primary btn-sm" ${puedeAbonar ? '' : 'disabled'} title="${esc(abonoBtnTitle)}" onclick="AppProveedoresPayments.openAbonoModal()">+ Abono</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.exportCsv()">Exportar CSV</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="showPage('compras')">Ir a Compras</button>
        </div>
      </div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px">La deuda se calcula desde compras a crédito o consignación menos pagos y notas crédito. Las ventas POS no cambian este saldo. El % vendido es solo referencia.</p>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Proveedor</th><th style="text-align:right">Deuda</th><th style="text-align:right">Comprado</th>
            <th style="text-align:right">Abonado</th><th style="text-align:right">Inv. costo</th><th style="text-align:right">% vendido</th><th></th>
          </tr></thead>
          <tbody>
            ${
              provs.length === 0
                ? '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text2)">Sin proveedores</td></tr>'
                : provs
                    .map((p) => {
                      const m = Svc().metricasProveedor(state, p.id);
                      return `<tr>
                <td style="font-weight:700">${esc(p.nombre)}</td>
                <td style="text-align:right;color:${m.saldo > 0 ? 'var(--red)' : 'var(--text2)'}">${fmt(m.saldo)}</td>
                <td style="text-align:right">${fmt(m.totalComprado)}</td>
                <td style="text-align:right">${fmt(m.totalAbonado)}</td>
                <td style="text-align:right">${fmt(m.inventarioCosto)}</td>
                <td style="text-align:right">${m.porcentajeVendido.toFixed(1)}%</td>
                <td><button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.verDetalle('${p.id}')">Detalle</button></td>
              </tr>`;
                    })
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>
    <div id="prov-detalle-panel"></div>`;

    if (_detalleProvId) renderDetalle(state, fmt, esc);
  }

  function renderDetalle(state, fmt, esc) {
    const panel = document.getElementById('prov-detalle-panel');
    if (!panel) return;
    const p = (state.usu_proveedores || []).find((x) => String(x.id) === String(_detalleProvId));
    if (!p) {
      _detalleProvId = null;
      return;
    }
    const m = Svc().metricasProveedor(state, p.id);
    const compras = Svc().comprasDeProveedor(state, p.id);
    const cargos = Svc().cargosPendientesProveedor(state, p.id).filter((c) => c.pendiente > 0.01);
    const abonos = (state.proveedor_abonos || []).filter(
      (a) => String(a.proveedorId) === String(p.id) && a.estado === 'active',
    );
    const nc = (state.proveedor_notas_credito || []).filter((n) => String(n.proveedorId) === String(p.id));

    panel.innerHTML = `
    <div class="card" style="margin:0">
      <div class="card-title">${esc(p.nombre)} <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.cerrarDetalle()">Cerrar</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:13px;margin-bottom:12px">
        <span>Deuda: <b style="color:var(--red)">${fmt(m.saldo)}</b></span>
        <span>Inv. costo: <b>${fmt(m.inventarioCosto)}</b></span>
        <span>% vendido (referencia POS): <b>${m.porcentajeVendido.toFixed(1)}%</b> · costo vendido <b>${fmt(m.costoVendido)}</b></span>
        ${m.saldoAFavor > 0 ? `<span>Saldo a favor: <b>${fmt(m.saldoAFavor)}</b></span>` : ''}
      </div>
      <h4 style="margin:12px 0 6px;font-size:13px">Compras</h4>
      <div class="table-wrap"><table><thead><tr><th>Número</th><th>Fecha</th><th>Tipo</th><th>Estado</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${compras.length ? compras.map((c) => `<tr><td>${esc(c.numero)}</td><td>${esc(c.fecha)}</td><td>${esc(c.tipoCompra)}</td><td>${esc(c.estado)}</td><td style="text-align:right">${fmt(c.total)}</td></tr>`).join('') : '<tr><td colspan="5">Sin compras</td></tr>'}</tbody></table></div>
      <h4 style="margin:12px 0 6px;font-size:13px">Cargos pendientes</h4>
      <div class="table-wrap"><table><thead><tr><th>Ref</th><th>Fecha</th><th style="text-align:right">Monto</th><th style="text-align:right">Pendiente</th></tr></thead>
      <tbody>${cargos.length ? cargos.map((c) => `<tr><td>${esc(c.referencia || c.id?.slice(0, 8))}</td><td>${esc(c.fecha)}</td><td style="text-align:right">${fmt(c.monto)}</td><td style="text-align:right">${fmt(c.pendiente)}</td></tr>`).join('') : '<tr><td colspan="4">Sin cargos pendientes</td></tr>'}</tbody></table></div>
      <h4 style="margin:12px 0 6px;font-size:13px">Abonos</h4>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Método</th><th style="text-align:right">Monto</th><th></th></tr></thead>
      <tbody>${abonos.map((a) => `<tr><td>${esc(a.fecha)}</td><td>${esc(a.metodo)}</td><td style="text-align:right">${fmt(a.monto)}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.imprimirAbono('${a.id}')">PDF</button>
        <button class="btn btn-danger btn-sm" onclick="AppProveedoresPayments.anularAbono('${a.id}')">Anular</button></td></tr>`).join('') || '<tr><td colspan="4">Sin abonos</td></tr>'}</tbody></table></div>
      <h4 style="margin:12px 0 6px;font-size:13px">Notas crédito</h4>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Motivo</th><th style="text-align:right">Monto</th></tr></thead>
      <tbody>${nc.map((n) => `<tr><td>${esc(n.fecha)}</td><td>${esc(n.motivo)}</td><td style="text-align:right">${fmt(n.monto)}</td></tr>`).join('') || '<tr><td colspan="3">Sin notas crédito</td></tr>'}</tbody></table></div>
    </div>`;
  }

  function verDetalle(provId) {
    _detalleProvId = provId;
    render(ctxBase());
  }

  function cerrarDetalle() {
    _detalleProvId = null;
    const panel = document.getElementById('prov-detalle-panel');
    if (panel) panel.innerHTML = '';
  }

  function openAbonoModal(provIdPre) {
    const state = global.state || {};
    const esc = Svc().esc;
    const provs = state.usu_proveedores || [];
    if (!provs.length) {
      global.notify?.('warning', '⚠️', 'Sin proveedores', 'Crea proveedores antes de registrar abonos.');
      return;
    }
    if (totalDeudaGlobal(state) <= 0.009) {
      global.notify?.('info', 'ℹ️', 'Sin deuda', 'No hay saldo pendiente por pagar en este momento.');
      return;
    }
    const cajasAbiertas = (state.cajas || []).filter((c) => c.estado === 'abierta');
    global.openModal(
      'Registrar abono',
      `
      <div class="form-group"><label>Proveedor</label>
        <select id="cxp-ab-prov" class="form-control" onchange="AppProveedoresPayments.onAbonoProvChange()">
          ${(state.usu_proveedores || [])
            .map(
              (p) =>
                `<option value="${p.id}" data-nombre="${esc(p.nombre)}" ${provIdPre === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`,
            )
            .join('')}
        </select>
      </div>
      <p id="cxp-ab-saldo" style="font-size:13px;color:var(--text2)">Saldo pendiente: —</p>
      <div class="form-group"><label>Monto (COP)</label><input type="number" id="cxp-ab-monto" class="form-control" min="1" step="1000" /></div>
      <div class="form-group"><label>Método</label>
        <select id="cxp-ab-metodo" class="form-control"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option></select>
      </div>
      <div class="form-group"><label>Fecha</label><input type="date" id="cxp-ab-fecha" class="form-control" value="${global.today?.() || ''}" /></div>
      <div class="form-group"><label>Nota</label><input id="cxp-ab-nota" class="form-control" /></div>
      <div class="form-group">
        <label><input type="checkbox" id="cxp-ab-caja" ${cajasAbiertas.length ? 'checked' : ''} ${cajasAbiertas.length ? '' : 'disabled'} /> Registrar egreso en caja</label>
        ${cajasAbiertas.length ? '' : '<p style="font-size:11px;color:var(--orange);margin:4px 0 0">No hay caja abierta: el abono quedará solo en cuentas por pagar.</p>'}
      </div>
      <div class="form-group" id="cxp-ab-caja-wrap">
        <label>Caja</label>
        <select id="cxp-ab-caja-sel" class="form-control">
          ${(state.cajas || [])
            .filter((c) => c.estado === 'abierta')
            .map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`)
            .join('') || '<option value="">Sin caja abierta</option>'}
        </select>
      </div>
      <button type="button" class="btn btn-primary" id="cxp-ab-save" onclick="AppProveedoresPayments.guardarAbono()">Guardar abono</button>
    `,
    );
    onAbonoProvChange();
  }

  function onAbonoProvChange() {
    const sel = document.getElementById('cxp-ab-prov');
    const id = sel?.value;
    const el = document.getElementById('cxp-ab-saldo');
    if (!id || !el) return;
    const { saldo } = Svc().calcSaldoProveedor(global.state, id);
    el.textContent =
      saldo > 0.009
        ? `Deuda pendiente: ${global.fmt?.(saldo) || saldo} (el pago se aplica a las compras más antiguas)`
        : 'Este proveedor no tiene deuda pendiente.';
    const inp = document.getElementById('cxp-ab-monto');
    const saveBtn = document.getElementById('cxp-ab-save');
    if (inp && saldo > 0) inp.value = String(Math.floor(saldo));
    if (saveBtn) saveBtn.disabled = saldo <= 0.009;
  }

  async function guardarAbono() {
    const btn = document.getElementById('cxp-ab-save');
    if (btn) {
      btn.disabled = true;
    }
    const sel = document.getElementById('cxp-ab-prov');
    const opt = sel?.options[sel.selectedIndex];
    const proveedorId = sel?.value;
    const proveedorNombre = opt?.getAttribute('data-nombre') || '';
    const monto = parseFloat(document.getElementById('cxp-ab-monto')?.value || 0);
    const metodo = document.getElementById('cxp-ab-metodo')?.value || 'efectivo';
    const fecha = document.getElementById('cxp-ab-fecha')?.value;
    const nota = document.getElementById('cxp-ab-nota')?.value?.trim();
    const crearEgresoCaja = !!document.getElementById('cxp-ab-caja')?.checked;
    const cajaId = document.getElementById('cxp-ab-caja-sel')?.value;
    const valPrev = Svc().validarMontoAbono(global.state, proveedorId, monto, global.fmt);
    if (!valPrev.ok) {
      global.notify?.('warning', '⚠️', 'Abono no válido', valPrev.message);
      if (btn) btn.disabled = false;
      return;
    }
    if (crearEgresoCaja && !(global.state.cajas || []).some((c) => c.estado === 'abierta')) {
      global.notify?.('warning', '⚠️', 'Caja cerrada', 'Abre una caja o desmarca el egreso en caja.');
      if (btn) btn.disabled = false;
      return;
    }
    try {
      global.showLoadingOverlay?.('connecting');
      const res = await Svc().guardarAbono(ctxBase(), {
        proveedorId,
        proveedorNombre,
        monto,
        metodo,
        fecha,
        nota,
        crearEgresoCaja,
        cajaId,
      });
      global.showLoadingOverlay?.('hide');
      global.closeModal?.();
      global.notify?.('success', '💳', 'Abono registrado', global.fmt?.(monto));
      render(ctxBase());
      if (res?.abono) Svc().imprimirComprobanteAbono(res.abono, proveedorNombre, global.fmt);
    } catch (e) {
      global.showLoadingOverlay?.('hide');
      global.notify?.('danger', '❌', 'Error', e.message);
      if (btn) btn.disabled = false;
    }
  }

  async function anularAbono(abonoId) {
    if (!global.confirm?.('¿Anular este abono? Se restaurará la deuda y se marcará el egreso de caja.')) return;
    try {
      global.showLoadingOverlay?.('connecting');
      await Svc().anularAbono(ctxBase(), abonoId);
      global.showLoadingOverlay?.('hide');
      global.notify?.('success', '↩️', 'Abono anulado', '');
      render(ctxBase());
    } catch (e) {
      global.showLoadingOverlay?.('hide');
      global.notify?.('danger', '❌', 'Error', e.message);
    }
  }

  function imprimirAbono(abonoId) {
    const a = (global.state.proveedor_abonos || []).find((x) => String(x.id) === String(abonoId));
    const p = (global.state.usu_proveedores || []).find((x) => String(x.id) === String(a?.proveedorId));
    if (a) Svc().imprimirComprobanteAbono(a, p?.nombre || '', global.fmt);
  }

  function exportCsv() {
    const csv = Svc().exportCsvProveedores(global.state, global.fmt);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cxp_proveedores_${global.today?.() || 'export'}.csv`;
    a.click();
  }

  global.AppProveedoresPayments = {
    render,
    verDetalle,
    cerrarDetalle,
    openAbonoModal,
    onAbonoProvChange,
    guardarAbono,
    anularAbono,
    imprimirAbono,
    exportCsv,
  };
})(window);
