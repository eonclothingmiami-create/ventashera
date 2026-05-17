// Proveedores / Cuentas por pagar V1 (tablas compras + proveedor_*)
(function initProveedoresPaymentsModule(global) {
  const Svc = () => global.AppComprasCxp;
  let _detalleProvId = null;
  let _devLineasDraft = [];

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
    const hayDeuda = deudaTotal > 0.009;
    const abonoBtnTitle = !provs.length
      ? 'Registra proveedores en Usuarios → Proveedores'
      : !hayDeuda
        ? 'Sin deuda: registra una compra a crédito en Compras'
        : 'Registrar abono a proveedor';
    const sinComprasCxp = !(state.compras || []).length && deudaTotal <= 0.009;
    const cxpEmptyHint = sinComprasCxp
      ? `<div class="card" style="margin:0 0 12px;padding:12px;border-color:var(--border);background:var(--surface2)">
      <p style="font-size:12px;color:var(--text2);margin:0;line-height:1.45">
        Sin deuda porque aún no hay compras a crédito. Registra una compra a <b>crédito</b> o <b>consignación</b> en
        <button type="button" class="btn btn-link btn-sm" style="padding:0;vertical-align:baseline" onclick="AppProveedoresPayments.irACompras()">Compras</button> primero.
      </p>
    </div>`
      : '';

    el.innerHTML = `
    ${cxpEmptyHint}
    <div class="kpi-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px">
      <div class="card" style="padding:14px;margin:0"><div style="font-size:11px;color:var(--text2)">Deuda total actual</div><div style="font-size:20px;font-weight:800;color:var(--red)">${fmt(deudaTotal)}</div></div>
      <div class="card" style="padding:14px;margin:0"><div style="font-size:11px;color:var(--text2)">Pagado este mes</div><div style="font-size:20px;font-weight:800;color:var(--accent)">${fmt(pagadoMes)}</div></div>
      <div class="card" style="padding:14px;margin:0"><div style="font-size:11px;color:var(--text2)">Proveedores</div><div style="font-size:20px;font-weight:800">${provs.length}</div></div>
    </div>
    <div class="card" style="margin:0 0 16px">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>Cuentas por pagar · proveedores</span>
        <div class="btn-group">
          <button type="button" class="btn btn-primary btn-sm" title="${esc(abonoBtnTitle)}" onclick="AppProveedoresPayments.openAbonoModal()">+ Abono</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.exportCsv()">Exportar proveedores</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.exportAbonosTodos()">Exportar abonos</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.irACompras()">Ir a Compras</button>
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
                <td style="text-align:right" title="${m.pctVendidoPendiente ? 'Sin ventas POS trazadas aún' : '% unidades vendidas vs compradas (referencia)'}">${esc(Svc().etiquetaPctVendido(m))}</td>
                <td><button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.verDetalle(${JSON.stringify(String(p.id))})">Detalle</button></td>
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
    const ajustesCosto = (state.proveedor_cxp_movimientos || [])
      .filter((m) => String(m.proveedorId) === String(p.id) && m.origen === 'ajuste_precio' && m.estado === 'active')
      .slice(0, 8);
    const concRes = Svc().conciliacionResumenProveedor(state, p.id);
    const concByAbono = {};
    concRes.items.forEach((r) => {
      if (r.abonoId) concByAbono[String(r.abonoId)] = r;
    });
    const concRows =
      concRes.items.length > 0
        ? concRes.items
            .map((r) => {
              const st = r.ok ? 'OK' : Svc().etiquetaConciliacion(r.motivo);
              const color = r.ok ? 'var(--green)' : 'var(--red)';
              const tesLink = r.tesId
                ? `<button type="button" class="btn btn-secondary btn-sm" onclick="showPage('tesoreria')">Tesorería</button>`
                : '—';
              return `<tr>
        <td>${esc(r.fecha || '—')}</td>
        <td style="text-align:right">${r.montoAbono != null ? fmt(r.montoAbono) : '—'}</td>
        <td style="font-size:11px">${esc((r.cajaMovId || r.tesId || '—').toString().slice(0, 12))}</td>
        <td style="color:${color};font-weight:600">${esc(st)}</td>
        <td>${tesLink}</td>
      </tr>`;
            })
            .join('')
        : '<tr><td colspan="5">Sin abonos con trazabilidad de caja</td></tr>';
    const capasFifo = m.capas || [];
    const fifoRows = capasFifo.length
      ? capasFifo
          .map(
            (cap) => `<tr>
        <td>${esc(cap.compraNumero)}</td>
        <td>${esc(cap.articuloNombre || cap.articuloId)}</td>
        <td style="text-align:right">${cap.unidadesConsumidas}</td>
        <td style="text-align:right">${fmt(cap.costoVendido)}</td>
        <td style="text-align:right">${(cap.porcentajeDeCompra ?? 0).toFixed(1)}%</td>
      </tr>`,
          )
          .join('')
      : '<tr><td colspan="5">Sin consumo asignado a compras (o sin ventas POS trazadas)</td></tr>';

    panel.innerHTML = `
    <div class="card" style="margin:0">
      <div class="card-title">${esc(p.nombre)} <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.cerrarDetalle()">Cerrar</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.openAbonoModal(${JSON.stringify(String(p.id))})">+ Abono</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.openDevolucionModal(${JSON.stringify(String(p.id))})">↩ Devolución</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.openNcModal(${JSON.stringify(String(p.id))})">📄 Nota crédito</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.openAjusteCostoModal(${JSON.stringify(String(p.id))})">📊 Ajuste costo</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.exportCxpDetalle(${JSON.stringify(String(p.id))})">Exportar CXP</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.exportAbonosDetalle(${JSON.stringify(String(p.id))})">Exportar abonos</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:13px;margin-bottom:12px">
        <span>Deuda: <b style="color:var(--red)">${fmt(m.saldo)}</b></span>
        <span>Inv. costo: <b>${fmt(m.inventarioCosto)}</b></span>
        <span>% vendido (referencia POS): <b>${m.porcentajeVendido.toFixed(1)}%</b> · costo vendido <b>${fmt(m.costoVendido)}</b></span>
        ${m.saldoAFavor > 0 ? `<span>Saldo a favor: <b>${fmt(m.saldoAFavor)}</b></span>` : ''}
        ${m.sinCapa > 0 ? `<span style="color:var(--orange)">Sin capa FIFO: <b>${m.sinCapa}</b> uds</span>` : ''}
      </div>
      <details style="margin-bottom:12px">
        <summary style="cursor:pointer;font-size:13px;font-weight:600">Conciliación caja (abonos) · ${concRes.rotos > 0 ? `<span style="color:var(--red)">${concRes.rotos} alerta(s)</span>` : `<span style="color:var(--green)">${concRes.ok} OK</span>`}</summary>
        <p style="font-size:11px;color:var(--text2);margin:6px 0">Cruza <code>caja_movimiento_id</code> del abono con <code>tes_movimientos</code> (<code>ref_abono_prov_id</code>).</p>
        <div class="table-wrap"><table><thead><tr><th>Fecha</th><th style="text-align:right">Monto</th><th>Ref caja</th><th>Estado</th><th></th></tr></thead>
        <tbody>${concRows}</tbody></table></div>
      </details>
      <details style="margin-bottom:12px">
        <summary style="cursor:pointer;font-size:13px;font-weight:600">FIFO por compra (referencia POS)</summary>
        <p style="font-size:11px;color:var(--text2);margin:6px 0">No afecta saldo CXP ni caja. Asigna ventas POS a capas de compra por artículo.</p>
        <div class="table-wrap"><table><thead><tr><th>Compra</th><th>Artículo</th><th style="text-align:right">Uds consumidas</th><th style="text-align:right">Costo vendido</th><th style="text-align:right">% compra</th></tr></thead>
        <tbody>${fifoRows}</tbody></table></div>
      </details>
      <h4 style="margin:12px 0 6px;font-size:13px">Compras</h4>
      <div class="table-wrap"><table><thead><tr><th>Número</th><th>Fecha</th><th>Tipo</th><th>Estado</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${compras.length ? compras.map((c) => `<tr><td>${esc(c.numero)}</td><td>${esc(c.fecha)}</td><td>${esc(c.tipoCompra)}</td><td>${esc(c.estado)}</td><td style="text-align:right">${fmt(c.total)}</td></tr>`).join('') : '<tr><td colspan="5">Sin compras</td></tr>'}</tbody></table></div>
      <h4 style="margin:12px 0 6px;font-size:13px">Cargos pendientes</h4>
      <div class="table-wrap"><table><thead><tr><th>Ref</th><th>Fecha</th><th style="text-align:right">Monto</th><th style="text-align:right">Pendiente</th></tr></thead>
      <tbody>${cargos.length ? cargos.map((c) => `<tr><td>${esc(c.referencia || c.id?.slice(0, 8))}</td><td>${esc(c.fecha)}</td><td style="text-align:right">${fmt(c.monto)}</td><td style="text-align:right">${fmt(c.pendiente)}</td></tr>`).join('') : '<tr><td colspan="4">Sin cargos pendientes</td></tr>'}</tbody></table></div>
      <h4 style="margin:12px 0 6px;font-size:13px">Abonos</h4>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Método</th><th style="text-align:right">Monto</th><th></th></tr></thead>
      <tbody>${abonos.map((a) => {
        const pdfBtns = a.comprobanteUrl
          ? `<button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.verPdfAbono(${JSON.stringify(String(a.id))})">Ver PDF</button>`
          : '';
        const conc = concByAbono[String(a.id)];
        const concBadge =
          conc && !conc.ok
            ? ` <span style="color:var(--red);font-size:10px;font-weight:700" title="${esc(Svc().etiquetaConciliacion(conc.motivo))}">⚠ caja</span>`
            : '';
        return `<tr><td>${esc(a.fecha)}${concBadge}</td><td>${esc(a.metodo)}</td><td style="text-align:right">${fmt(a.monto)}</td>
        <td style="white-space:nowrap">${pdfBtns}
        <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.imprimirAbono(${JSON.stringify(String(a.id))})">Imprimir</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.regenerarPdfAbono(${JSON.stringify(String(a.id))})">Regenerar</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="AppProveedoresPayments.anularAbono(${JSON.stringify(String(a.id))})">Anular</button></td></tr>`;
      }).join('') || '<tr><td colspan="4">Sin abonos</td></tr>'}</tbody></table></div>
      <h4 style="margin:12px 0 6px;font-size:13px">Notas crédito</h4>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Estado</th><th>Motivo</th><th style="text-align:right">Monto</th><th></th></tr></thead>
      <tbody>${nc.map((n) => {
        const st = n.estado || 'applied';
        const acts =
          st === 'draft'
            ? `<button type="button" class="btn btn-primary btn-sm" onclick="AppProveedoresPayments.aplicarNc(${JSON.stringify(String(n.id))})">Aplicar</button>
               <button type="button" class="btn btn-danger btn-sm" onclick="AppProveedoresPayments.anularNc(${JSON.stringify(String(n.id))})">Anular</button>`
            : st === 'applied' || st === 'active'
              ? `<button type="button" class="btn btn-danger btn-sm" onclick="AppProveedoresPayments.anularNc(${JSON.stringify(String(n.id))})">Anular</button>`
              : '';
        return `<tr><td>${esc(n.fecha)}</td><td>${esc(st)}</td><td>${esc(n.motivo)}</td><td style="text-align:right">${fmt(n.monto)}</td><td>${acts}</td></tr>`;
      }).join('') || '<tr><td colspan="5">Sin notas crédito</td></tr>'}</tbody></table></div>
      <h4 style="margin:12px 0 6px;font-size:13px">Ajustes de costo recientes</h4>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Naturaleza</th><th style="text-align:right">Monto</th><th>Nota</th></tr></thead>
      <tbody>${ajustesCosto.map((m) => `<tr><td>${esc(m.fecha)}</td><td>${esc(m.naturaleza)}</td><td style="text-align:right">${fmt(m.monto)}</td><td>${esc(m.nota || '')}</td></tr>`).join('') || '<tr><td colspan="4">Sin ajustes de costo</td></tr>'}</tbody></table></div>
    </div>`;
  }

  function verDetalle(provId) {
    if (!Svc()) {
      global.notify?.('danger', '❌', 'Módulo no cargado', 'Falta compras-cxp-service.js. Recarga con Ctrl+F5.');
      return;
    }
    _detalleProvId = provId;
    render(ctxBase());
    requestAnimationFrame(() => {
      const panel = document.getElementById('prov-detalle-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function irACompras() {
    if (typeof global.showPage === 'function') {
      global.showPage('compras');
      return;
    }
    global.notify?.('warning', '⚠️', 'Compras', 'No se pudo abrir el módulo Compras. Recarga la aplicación (Ctrl+F5).');
  }

  function cerrarDetalle() {
    _detalleProvId = null;
    const panel = document.getElementById('prov-detalle-panel');
    if (panel) panel.innerHTML = '';
  }

  function openAbonoModal(provIdPre) {
    if (!Svc()) {
      global.notify?.('danger', '❌', 'Módulo no cargado', 'Falta compras-cxp-service.js. Recarga con Ctrl+F5.');
      return;
    }
    const state = global.state || {};
    const esc = Svc().esc;
    const provs = state.usu_proveedores || [];
    if (!provs.length) {
      global.notify?.('warning', '⚠️', 'Sin proveedores', 'Crea proveedores antes de registrar abonos.');
      return;
    }
    if (typeof global.openModal !== 'function') {
      global.notify?.('danger', '❌', 'Modal no disponible', 'Recarga la aplicación (Ctrl+F5).');
      console.error('[CXP] openModal no definido');
      return;
    }
    const sinDeudaGlobal = totalDeudaGlobal(state) <= 0.009;
    const cajasAbiertas = (state.cajas || []).filter((c) => c.estado === 'abierta');
    const provOpts = provs
      .filter((p) => !sinDeudaGlobal || Svc().calcSaldoProveedor(state, p.id).saldo > 0.009)
      .map(
        (p) =>
          `<option value="${esc(p.id)}" data-nombre="${esc(p.nombre)}" ${String(provIdPre) === String(p.id) ? 'selected' : ''}>${esc(p.nombre)}</option>`,
      )
      .join('');
    global.openModal(
      `<div class="modal-title">Registrar abono<button type="button" class="modal-close" onclick="closeModal()">×</button></div>
      ${sinDeudaGlobal ? '<p style="padding:10px 12px;margin:0 0 12px;background:rgba(255,180,0,.12);border-radius:8px;font-size:13px">Sin deuda global. Crea una compra a <b>crédito</b> en Compras.</p>' : ''}
      <div class="form-group"><label>Proveedor *</label>
        <select id="cxp-ab-prov" class="form-control" onchange="AppProveedoresPayments.onAbonoProvChange()">
          ${provOpts || '<option value="">— Sin proveedores con deuda —</option>'}
        </select>
      </div>
      <p id="cxp-ab-saldo" style="font-size:13px;color:var(--text2)">Saldo pendiente: —</p>
      <div class="form-group"><label>Monto (COP)</label><input type="number" id="cxp-ab-monto" class="form-control" min="1" step="1000" /></div>
      <div class="form-group"><label>Método</label>
        <select id="cxp-ab-metodo" class="form-control"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option></select>
      </div>
      <div class="form-group"><label>Fecha</label><input type="date" id="cxp-ab-fecha" class="form-control" value="${global.today?.() || ''}" /></div>
      <div class="form-group"><label>Referencia (opcional)</label><input id="cxp-ab-ref" class="form-control" placeholder="TRX, recibo…" /></div>
      <div class="form-group"><label>Nota (opcional)</label><input id="cxp-ab-nota" class="form-control" /></div>
      <div class="form-group">
        <label><input type="checkbox" id="cxp-ab-caja" /> Registrar egreso en caja (opcional)</label>
        ${cajasAbiertas.length ? '' : '<p style="font-size:11px;color:var(--orange);margin:4px 0 0">No hay caja abierta: el abono quedará solo en cuentas por pagar.</p>'}
      </div>
      <div class="form-group" id="cxp-ab-caja-wrap">
        <label>Caja</label>
        <select id="cxp-ab-caja-sel" class="form-control" ${cajasAbiertas.length ? '' : 'disabled'}>
          ${cajasAbiertas.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('') || '<option value="">Sin caja abierta</option>'}
        </select>
      </div>
      <button type="button" class="btn btn-primary" id="cxp-ab-save" onclick="AppProveedoresPayments.guardarAbono()">Guardar abono</button>
      <button type="button" class="btn btn-secondary" style="margin-left:8px" onclick="closeModal()">Cancelar</button>`,
      true,
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
    const referencia = document.getElementById('cxp-ab-ref')?.value?.trim();
    const crearEgresoCaja = !!document.getElementById('cxp-ab-caja')?.checked;
    const cajaId = document.getElementById('cxp-ab-caja-sel')?.value;
    if (!proveedorId) {
      global.notify?.('warning', '⚠️', 'Proveedor requerido', 'Selecciona un proveedor con deuda pendiente.');
      if (btn) btn.disabled = false;
      return;
    }
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
        referencia,
        crearEgresoCaja,
        cajaId,
      });
      global.showLoadingOverlay?.('hide');
      global.closeModal?.();
      global.notify?.('success', '💳', 'Abono registrado', global.fmt?.(monto));
      if (res?.advertenciaCaja) {
        global.notify?.('warning', '⚠️', 'Abono sin egreso de caja', res.advertenciaCaja);
      }
      if (res?.advertenciaComprobante) {
        global.notify?.('warning', '⚠️', 'Comprobante PDF', res.advertenciaComprobante);
      }
      if (res?.comprobanteUrl || res?.abono?.comprobanteUrl) {
        global.notify?.('success', '📄', 'Comprobante PDF', 'Disponible en Ver PDF o se abrirá ahora.');
      }
      render(ctxBase());
      if (res?.abono) {
        Svc().imprimirComprobanteAbono(res.abono, proveedorNombre, global.fmt, res.aplicaciones, global.state);
      }
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

  function verPdfAbono(abonoId) {
    const a = (global.state.proveedor_abonos || []).find((x) => String(x.id) === String(abonoId));
    if (a?.comprobanteUrl) window.open(a.comprobanteUrl, '_blank', 'noopener,noreferrer');
    else global.notify?.('warning', '⚠️', 'Sin PDF', 'Use Regenerar para crear el comprobante.');
  }

  function imprimirAbono(abonoId) {
    const a = (global.state.proveedor_abonos || []).find((x) => String(x.id) === String(abonoId));
    const p = (global.state.usu_proveedores || []).find((x) => String(x.id) === String(a?.proveedorId));
    if (a) Svc().imprimirComprobanteAbono(a, p?.nombre || '', global.fmt, null, global.state);
  }

  async function regenerarPdfAbono(abonoId) {
    const a = (global.state.proveedor_abonos || []).find((x) => String(x.id) === String(abonoId));
    const p = (global.state.usu_proveedores || []).find((x) => String(x.id) === String(a?.proveedorId));
    if (!a) return;
    try {
      global.showLoadingOverlay?.('connecting');
      const url = await Svc().regenerarComprobanteAbono(ctxBase(), abonoId, p?.nombre || a.proveedorNombre);
      global.showLoadingOverlay?.('hide');
      if (url) {
        global.notify?.('success', '📄', 'PDF actualizado', '');
        render(ctxBase());
      } else {
        global.notify?.('warning', '⚠️', 'PDF', 'No se pudo generar (jsPDF no disponible).');
      }
    } catch (e) {
      global.showLoadingOverlay?.('hide');
      global.notify?.('danger', '❌', 'Error', e.message);
    }
  }

  function exportCxpDetalle(provId) {
    const name =
      (global.state.usu_proveedores || []).find((p) => String(p.id) === String(provId))?.nombre || provId;
    Svc().downloadCsv(`cxp_movimientos_${name}_${global.today?.() || 'export'}.csv`, Svc().exportCsvCxpMovimientos(global.state, provId));
    global.notify?.('success', '📄', 'Exportado', 'Movimientos CXP');
  }

  function exportAbonosDetalle(provId) {
    const name =
      (global.state.usu_proveedores || []).find((p) => String(p.id) === String(provId))?.nombre || provId;
    Svc().downloadCsv(`cxp_abonos_${name}_${global.today?.() || 'export'}.csv`, Svc().exportCsvAbonosProveedor(global.state, provId));
    global.notify?.('success', '📄', 'Exportado', 'Abonos del proveedor');
  }

  function exportAbonosTodos() {
    if (!Svc()?.exportCsvAbonosProveedor) {
      global.notify?.('warning', '⚠️', 'Exportación', 'Servicio CXP no cargado.');
      return;
    }
    Svc().downloadCsv(`cxp_abonos_${global.today?.() || 'export'}.csv`, Svc().exportCsvAbonosProveedor(global.state));
    global.notify?.('success', '📄', 'Exportado', 'Abonos (todos)');
  }

  function artsParaProveedor(state, proveedorId) {
    const arts = state.articulos || [];
    if (!proveedorId) return arts;
    const fil = arts.filter((a) => String(a.proveedorId || '') === String(proveedorId));
    return fil.length ? fil : arts;
  }

  function devLineasTableHtml(state, esc) {
    if (!_devLineasDraft.length) _devLineasDraft.push({ articuloId: '', cantidad: 1, costoUnitario: 0 });
    const provId = document.getElementById('cxp-dev-prov')?.value;
    const arts = artsParaProveedor(state, provId);
    return _devLineasDraft
      .map((ln, i) => {
        const opts = arts
          .map(
            (a) =>
              `<option value="${esc(a.id)}" data-nombre="${esc(a.nombre)}" data-costo="${a.costo || 0}" ${String(ln.articuloId) === String(a.id) ? 'selected' : ''}>${esc(a.nombre)}</option>`,
          )
          .join('');
        return `<tr>
          <td><select class="form-control cxp-dev-art" data-i="${i}" onchange="AppProveedoresPayments.onDevArtChange(${i},this)"><option value="">—</option>${opts}</select></td>
          <td><input type="number" class="form-control cxp-dev-qty" data-i="${i}" min="1" step="1" value="${ln.cantidad || 1}" oninput="AppProveedoresPayments.recalcDevPreview()" /></td>
          <td><input type="number" class="form-control cxp-dev-costo" data-i="${i}" min="0" step="100" value="${ln.costoUnitario || 0}" oninput="AppProveedoresPayments.recalcDevPreview()" /></td>
          <td class="cxp-dev-sub" data-i="${i}">—</td>
          <td>${_devLineasDraft.length > 1 ? `<button type="button" class="btn btn-danger btn-sm" onclick="AppProveedoresPayments.removeDevLinea(${i})">×</button>` : ''}</td>
        </tr>`;
      })
      .join('');
  }

  function openDevolucionModal(provIdPre) {
    if (!Svc()) return;
    const state = global.state || {};
    const esc = Svc().esc;
    const provs = state.usu_proveedores || [];
    if (!provs.length) {
      global.notify?.('warning', '⚠️', 'Sin proveedores', '');
      return;
    }
    _devLineasDraft = [{ articuloId: '', cantidad: 1, costoUnitario: 0 }];
    const comprasOpts = (id) => {
      const list = Svc().comprasDeProveedor(state, id).filter((c) => c.estado !== 'cancelled');
      return `<option value="">— Sin compra —</option>${list.map((c) => `<option value="${esc(c.id)}">${esc(c.numero)} · ${esc(c.fecha)} · ${esc(c.estado)}</option>`).join('')}`;
    };
    global.openModal(
      `<div class="modal-title">Devolución a proveedor<button type="button" class="modal-close" onclick="closeModal()">×</button></div>
      <div class="form-group"><label>Proveedor</label>
        <select id="cxp-dev-prov" class="form-control" onchange="AppProveedoresPayments.onDevProvChange()">
          ${provs.map((p) => `<option value="${esc(p.id)}" data-nombre="${esc(p.nombre)}" ${String(provIdPre) === String(p.id) ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Compra origen (opcional)</label><select id="cxp-dev-compra" class="form-control">${comprasOpts(provIdPre || provs[0]?.id)}</select></div>
      <div class="form-group"><label>Fecha</label><input type="date" id="cxp-dev-fecha" class="form-control" value="${global.today?.() || ''}" /></div>
      <div class="form-group"><label>Motivo</label><input id="cxp-dev-motivo" class="form-control" placeholder="Devolución mercancía" /></div>
      <p id="cxp-dev-preview" style="font-size:13px;color:var(--text2)">Monto NC estimado: —</p>
      <div class="table-wrap"><table><thead><tr><th>Artículo</th><th>Cant.</th><th>Costo</th><th>Subtotal</th><th></th></tr></thead>
      <tbody id="cxp-dev-lineas-tbody">${devLineasTableHtml(state, esc)}</tbody></table></div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="AppProveedoresPayments.addDevLinea()">+ Línea</button>
      <button type="button" class="btn btn-primary" id="cxp-dev-save" onclick="AppProveedoresPayments.guardarDevolucion()">Registrar devolución</button>
      <button type="button" class="btn btn-secondary" style="margin-left:8px" onclick="closeModal()">Cerrar</button>`,
      true,
    );
    recalcDevPreview();
  }

  function onDevProvChange() {
    const provId = document.getElementById('cxp-dev-prov')?.value;
    const sel = document.getElementById('cxp-dev-compra');
    if (sel && provId) {
      const state = global.state || {};
      const esc = Svc().esc;
      const list = Svc().comprasDeProveedor(state, provId).filter((c) => c.estado !== 'cancelled');
      sel.innerHTML = `<option value="">— Sin compra —</option>${list.map((c) => `<option value="${esc(c.id)}">${esc(c.numero)} · ${esc(c.fecha)}</option>`).join('')}`;
    }
    const tbody = document.getElementById('cxp-dev-lineas-tbody');
    if (tbody) tbody.innerHTML = devLineasTableHtml(global.state || {}, Svc().esc);
    recalcDevPreview();
  }

  function addDevLinea() {
    _devLineasDraft.push({ articuloId: '', cantidad: 1, costoUnitario: 0 });
    const tbody = document.getElementById('cxp-dev-lineas-tbody');
    if (tbody) tbody.innerHTML = devLineasTableHtml(global.state || {}, Svc().esc);
    recalcDevPreview();
  }

  function removeDevLinea(i) {
    _devLineasDraft.splice(i, 1);
    const tbody = document.getElementById('cxp-dev-lineas-tbody');
    if (tbody) tbody.innerHTML = devLineasTableHtml(global.state || {}, Svc().esc);
    recalcDevPreview();
  }

  function onDevArtChange(i, sel) {
    const opt = sel.options[sel.selectedIndex];
    _devLineasDraft[i].articuloId = sel.value;
    _devLineasDraft[i].articuloNombre = opt?.getAttribute('data-nombre') || '';
    _devLineasDraft[i].costoUnitario = parseFloat(opt?.getAttribute('data-costo') || 0) || 0;
    const costInp = document.querySelector(`.cxp-dev-costo[data-i="${i}"]`);
    if (costInp) costInp.value = _devLineasDraft[i].costoUnitario;
    recalcDevPreview();
  }

  function recalcDevPreview() {
    document.querySelectorAll('.cxp-dev-art').forEach((sel) => {
      const i = parseInt(sel.getAttribute('data-i'), 10);
      if (!Number.isFinite(i) || !_devLineasDraft[i]) return;
      const qty = parseFloat(document.querySelector(`.cxp-dev-qty[data-i="${i}"]`)?.value || 0);
      const costo = parseFloat(document.querySelector(`.cxp-dev-costo[data-i="${i}"]`)?.value || 0);
      const opt = sel.options[sel.selectedIndex];
      _devLineasDraft[i] = {
        ..._devLineasDraft[i],
        articuloId: sel.value,
        articuloNombre: opt?.getAttribute('data-nombre') || '',
        cantidad: qty,
        costoUnitario: costo,
      };
      const subEl = document.querySelector(`.cxp-dev-sub[data-i="${i}"]`);
      if (subEl) subEl.textContent = global.fmt?.(qty * costo) || String(qty * costo);
    });
    const total = _devLineasDraft.reduce((s, l) => s + (parseFloat(l.cantidad) || 0) * (parseFloat(l.costoUnitario) || 0), 0);
    const el = document.getElementById('cxp-dev-preview');
    if (el) el.textContent = `Monto NC estimado: ${global.fmt?.(total) || total}`;
  }

  async function guardarDevolucion() {
    const btn = document.getElementById('cxp-dev-save');
    if (btn) btn.disabled = true;
    recalcDevPreview();
    const sel = document.getElementById('cxp-dev-prov');
    const opt = sel?.options[sel.selectedIndex];
    const proveedorId = sel?.value;
    const proveedorNombre = opt?.getAttribute('data-nombre') || '';
    const compraId = document.getElementById('cxp-dev-compra')?.value || null;
    const fecha = document.getElementById('cxp-dev-fecha')?.value;
    const motivo = document.getElementById('cxp-dev-motivo')?.value?.trim();
    const lineas = _devLineasDraft
      .filter((l) => l.articuloId && l.cantidad > 0)
      .map((l) => ({
        articuloId: l.articuloId,
        articuloNombre: l.articuloNombre,
        cantidad: parseInt(l.cantidad, 10) || 0,
        costoUnitario: parseFloat(l.costoUnitario) || 0,
        bodegaId: (global.state.bodegas || [])[0]?.id || 'bodega_main',
      }));
    if (!lineas.length) {
      global.notify?.('warning', '⚠️', 'Líneas requeridas', 'Agrega al menos un artículo.');
      if (btn) btn.disabled = false;
      return;
    }
    try {
      global.showLoadingOverlay?.('connecting');
      await Svc().registrarDevolucion(ctxBase(), {
        proveedorId,
        proveedorNombre,
        compraId: compraId || undefined,
        lineas,
        motivo,
        fecha,
      });
      global.showLoadingOverlay?.('hide');
      global.closeModal?.();
      global.notify?.('success', '↩️', 'Devolución registrada', proveedorNombre);
      render(ctxBase());
    } catch (e) {
      global.showLoadingOverlay?.('hide');
      global.notify?.('danger', '❌', 'Error', e.message);
      if (btn) btn.disabled = false;
    }
  }

  function openNcModal(provIdPre) {
    if (!Svc()) return;
    const state = global.state || {};
    const esc = Svc().esc;
    const provs = state.usu_proveedores || [];
    const pid = provIdPre || provs[0]?.id;
    const compras = Svc().comprasDeProveedor(state, pid).filter((c) => c.estado !== 'cancelled');
    global.openModal(
      `<div class="modal-title">Nota crédito manual (borrador)<button type="button" class="modal-close" onclick="closeModal()">×</button></div>
      <div class="form-group"><label>Proveedor</label>
        <select id="cxp-nc-prov" class="form-control" onchange="AppProveedoresPayments.onNcProvChange()">
          ${provs.map((p) => `<option value="${esc(p.id)}" data-nombre="${esc(p.nombre)}" ${String(pid) === String(p.id) ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Compra (opcional)</label>
        <select id="cxp-nc-compra" class="form-control">
          <option value="">—</option>
          ${compras.map((c) => `<option value="${esc(c.id)}">${esc(c.numero)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Monto (COP)</label><input type="number" id="cxp-nc-monto" class="form-control" min="1" step="1000" /></div>
      <div class="form-group"><label>Fecha</label><input type="date" id="cxp-nc-fecha" class="form-control" value="${global.today?.() || ''}" /></div>
      <div class="form-group"><label>Motivo</label><input id="cxp-nc-motivo" class="form-control" /></div>
      <p style="font-size:12px;color:var(--text2)">Se guarda en estado <b>draft</b>. Aplícala desde el detalle del proveedor.</p>
      <button type="button" class="btn btn-primary" id="cxp-nc-save" onclick="AppProveedoresPayments.guardarNcDraft()">Guardar borrador</button>
      <button type="button" class="btn btn-secondary" style="margin-left:8px" onclick="closeModal()">Cerrar</button>`,
    );
  }

  function onNcProvChange() {
    const provId = document.getElementById('cxp-nc-prov')?.value;
    const sel = document.getElementById('cxp-nc-compra');
    if (!sel || !provId) return;
    const state = global.state || {};
    const esc = Svc().esc;
    const compras = Svc().comprasDeProveedor(state, provId).filter((c) => c.estado !== 'cancelled');
    sel.innerHTML = `<option value="">—</option>${compras.map((c) => `<option value="${esc(c.id)}">${esc(c.numero)}</option>`).join('')}`;
  }

  async function guardarNcDraft() {
    const btn = document.getElementById('cxp-nc-save');
    if (btn) btn.disabled = true;
    const sel = document.getElementById('cxp-nc-prov');
    const opt = sel?.options[sel.selectedIndex];
    const proveedorId = sel?.value;
    const proveedorNombre = opt?.getAttribute('data-nombre') || '';
    const monto = parseFloat(document.getElementById('cxp-nc-monto')?.value || 0);
    const compraId = document.getElementById('cxp-nc-compra')?.value || null;
    const fecha = document.getElementById('cxp-nc-fecha')?.value;
    const motivo = document.getElementById('cxp-nc-motivo')?.value?.trim();
    try {
      global.showLoadingOverlay?.('connecting');
      await Svc().crearNotaCreditoManual(ctxBase(), {
        proveedorId,
        proveedorNombre,
        compraId: compraId || undefined,
        monto,
        motivo,
        fecha,
      });
      global.showLoadingOverlay?.('hide');
      global.closeModal?.();
      global.notify?.('success', '📄', 'Nota crédito (borrador)', 'Aplícala desde el detalle del proveedor.');
      render(ctxBase());
    } catch (e) {
      global.showLoadingOverlay?.('hide');
      global.notify?.('danger', '❌', 'Error', e.message);
      if (btn) btn.disabled = false;
    }
  }

  async function aplicarNc(ncId) {
    if (!global.confirm?.('¿Aplicar esta nota crédito? Reducirá la deuda del proveedor.')) return;
    try {
      global.showLoadingOverlay?.('connecting');
      await Svc().aplicarNotaCredito(ctxBase(), ncId);
      global.showLoadingOverlay?.('hide');
      global.notify?.('success', '✅', 'Nota crédito aplicada', '');
      render(ctxBase());
    } catch (e) {
      global.showLoadingOverlay?.('hide');
      global.notify?.('danger', '❌', 'Error', e.message);
    }
  }

  async function anularNc(ncId) {
    if (!global.confirm?.('¿Anular esta nota crédito?')) return;
    try {
      global.showLoadingOverlay?.('connecting');
      await Svc().anularNotaCredito(ctxBase(), ncId);
      global.showLoadingOverlay?.('hide');
      global.notify?.('success', '↩️', 'Nota crédito anulada', '');
      render(ctxBase());
    } catch (e) {
      global.showLoadingOverlay?.('hide');
      global.notify?.('danger', '❌', 'Error', e.message);
    }
  }

  function openAjusteCostoModal(provIdPre) {
    if (!Svc()) return;
    const state = global.state || {};
    const esc = Svc().esc;
    const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(provIdPre));
    if (!prov) return;
    const arts = artsParaProveedor(state, prov.id);
    const compras = Svc().comprasDeProveedor(state, prov.id).filter((c) => c.estado !== 'cancelled');
    global.openModal(
      `<div class="modal-title">Ajuste de costo · ${esc(prov.nombre)}<button type="button" class="modal-close" onclick="closeModal()">×</button></div>
      <div class="form-group"><label>Artículo</label>
        <select id="cxp-aj-art" class="form-control" onchange="AppProveedoresPayments.onAjusteArtChange()">
          <option value="">— Seleccionar —</option>
          ${arts.map((a) => `<option value="${esc(a.id)}" data-costo="${a.costo || a.precioCompra || 0}" data-stock="${a.stock || 0}" data-nombre="${esc(a.nombre)}">${esc(a.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Costo anterior</label><input type="number" id="cxp-aj-costo-ant" class="form-control" readonly /></div>
        <div class="form-group"><label>Costo nuevo</label><input type="number" id="cxp-aj-costo-nuevo" class="form-control" min="0" step="100" oninput="AppProveedoresPayments.recalcAjustePreview()" /></div>
        <div class="form-group"><label>Unidades afectadas</label><input type="number" id="cxp-aj-unidades" class="form-control" min="1" step="1" oninput="AppProveedoresPayments.recalcAjustePreview()" /></div>
      </div>
      <div class="form-group"><label>Compra (opcional)</label>
        <select id="cxp-aj-compra" class="form-control">
          <option value="">—</option>
          ${compras.map((c) => `<option value="${esc(c.id)}">${esc(c.numero)}</option>`).join('')}
        </select>
      </div>
      <p id="cxp-aj-preview" style="font-size:13px;color:var(--text2)">Delta estimado: —</p>
      <button type="button" class="btn btn-primary" id="cxp-aj-save" onclick="AppProveedoresPayments.guardarAjusteCosto(${JSON.stringify(String(prov.id))}, ${JSON.stringify(String(prov.nombre))})">Registrar ajuste</button>
      <button type="button" class="btn btn-secondary" style="margin-left:8px" onclick="closeModal()">Cerrar</button>`,
    );
  }

  function onAjusteArtChange() {
    const sel = document.getElementById('cxp-aj-art');
    const opt = sel?.options[sel.selectedIndex];
    const costoAnt = document.getElementById('cxp-aj-costo-ant');
    const unidades = document.getElementById('cxp-aj-unidades');
    const costoNuevo = document.getElementById('cxp-aj-costo-nuevo');
    if (!opt || !costoAnt) return;
    const c = parseFloat(opt.getAttribute('data-costo') || 0) || 0;
    const stk = parseInt(opt.getAttribute('data-stock') || 0, 10) || 0;
    costoAnt.value = String(c);
    if (unidades) unidades.value = String(Math.max(1, stk));
    if (costoNuevo && !costoNuevo.value) costoNuevo.value = String(c);
    recalcAjustePreview();
  }

  function recalcAjustePreview() {
    const ant = parseFloat(document.getElementById('cxp-aj-costo-ant')?.value || 0) || 0;
    const nue = parseFloat(document.getElementById('cxp-aj-costo-nuevo')?.value || 0) || 0;
    const u = parseInt(document.getElementById('cxp-aj-unidades')?.value || 0, 10) || 0;
    const delta = (nue - ant) * u;
    const el = document.getElementById('cxp-aj-preview');
    const fmtFn = global.fmt || ((v) => String(v));
    if (!el) return;
    if (u <= 0) {
      el.textContent = 'Indica unidades afectadas.';
      return;
    }
    if (Math.abs(delta) < 0.01) {
      el.textContent = 'Sin cambio de valor en CXP.';
      return;
    }
    el.textContent =
      delta > 0
        ? `Se registrará cargo CXP por ${fmtFn(delta)} (costo subió).`
        : `Se registrará nota crédito por ${fmtFn(Math.abs(delta))} (costo bajó).`;
  }

  async function guardarAjusteCosto(proveedorId, proveedorNombre) {
    const btn = document.getElementById('cxp-aj-save');
    if (btn) btn.disabled = true;
    const artId = document.getElementById('cxp-aj-art')?.value;
    const costoAnterior = parseFloat(document.getElementById('cxp-aj-costo-ant')?.value || 0) || 0;
    const costoNuevo = parseFloat(document.getElementById('cxp-aj-costo-nuevo')?.value || 0) || 0;
    const unidades = parseInt(document.getElementById('cxp-aj-unidades')?.value || 0, 10) || 0;
    const compraId = document.getElementById('cxp-aj-compra')?.value || null;
    if (!artId) {
      global.notify?.('warning', '⚠️', 'Artículo requerido', '');
      if (btn) btn.disabled = false;
      return;
    }
    if (unidades <= 0) {
      global.notify?.('warning', '⚠️', 'Unidades inválidas', '');
      if (btn) btn.disabled = false;
      return;
    }
    try {
      global.showLoadingOverlay?.('connecting');
      const res = await Svc().ajusteCostoProveedor(ctxBase(), {
        proveedorId,
        proveedorNombre,
        articuloId: artId,
        unidades,
        costoAnterior,
        costoNuevo,
        compraId: compraId || undefined,
      });
      global.showLoadingOverlay?.('hide');
      global.closeModal?.();
      if (!res) {
        global.notify?.('info', 'ℹ️', 'Sin cambio', 'El delta de costo es cero.');
      } else {
        global.notify?.(
          'success',
          '📊',
          'Ajuste registrado',
          res.tipo === 'cargo' ? `Cargo ${global.fmt?.(res.monto)}` : `NC ${global.fmt?.(res.monto)}`,
        );
      }
      render(ctxBase());
    } catch (e) {
      global.showLoadingOverlay?.('hide');
      global.notify?.('danger', '❌', 'Error', e.message);
      if (btn) btn.disabled = false;
    }
  }

  function exportCsv() {
    if (!Svc()?.exportCsvProveedores) {
      global.notify?.('warning', '⚠️', 'Exportación', 'Servicio CXP no cargado.');
      return;
    }
    Svc().downloadCsv(`cxp_proveedores_${global.today?.() || 'export'}.csv`, Svc().exportCsvProveedores(global.state, global.fmt));
    global.notify?.('success', '📄', 'Exportado', 'Resumen proveedores');
  }

  global.AppProveedoresPayments = {
    render,
    verDetalle,
    cerrarDetalle,
    irACompras,
    openAbonoModal,
    onAbonoProvChange,
    guardarAbono,
    anularAbono,
    imprimirAbono,
    verPdfAbono,
    regenerarPdfAbono,
    exportCxpDetalle,
    exportAbonosDetalle,
    exportAbonosTodos,
    openDevolucionModal,
    onDevProvChange,
    addDevLinea,
    removeDevLinea,
    onDevArtChange,
    recalcDevPreview,
    guardarDevolucion,
    openNcModal,
    onNcProvChange,
    guardarNcDraft,
    aplicarNc,
    anularNc,
    openAjusteCostoModal,
    onAjusteArtChange,
    recalcAjustePreview,
    guardarAjusteCosto,
    exportCsv,
  };
})(window);
