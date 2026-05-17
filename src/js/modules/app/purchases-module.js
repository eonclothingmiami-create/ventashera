// Módulo Compras ERP V1
(function initPurchasesModule(global) {
  const Svc = () => global.AppComprasCxp;
  let _filt = { desde: '', hasta: '', provId: '', estado: '', tipo: '' };
  let _lineasDraft = [];

  function ctxBase() {
    return {
      state: global.state,
      supabaseClient: global.supabaseClient,
      dbId: global.dbId,
      uid: global.uid,
      notify: global.notify,
      fmt: global.fmt,
      today: global.today,
      openModal: global.openModal,
      closeModal: global.closeModal,
      showLoadingOverlay: global.showLoadingOverlay,
    };
  }

  function n(v) {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : 0;
  }

  function defaultBodegaId(state) {
    const bods = state.bodegas || [];
    return bods[0]?.id || 'bodega_main';
  }

  function render(ctx, mountEl) {
    const el = mountEl || document.getElementById('compras-content');
    if (!el) return;
    if (!Svc()) {
      el.innerHTML =
        '<div class="card" style="padding:20px;color:var(--red)">No se cargó <b>compras-cxp-service.js</b>. Verifica el orden de scripts en index.html y recarga (Ctrl+F5).</div>';
      return;
    }
    const state = (ctx && ctx.state) || global.state || {};
    const fmt = (ctx && ctx.fmt) || global.fmt;
    const esc = Svc().esc;
    let list = [...(state.compras || [])];
    if (_filt.provId) list = list.filter((c) => String(c.proveedorId) === String(_filt.provId));
    if (_filt.estado) list = list.filter((c) => c.estado === _filt.estado);
    if (_filt.tipo) list = list.filter((c) => c.tipoCompra === _filt.tipo);
    if (_filt.desde) list = list.filter((c) => String(c.fecha) >= _filt.desde);
    if (_filt.hasta) list = list.filter((c) => String(c.fecha) <= _filt.hasta);
    list.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    const provs = state.usu_proveedores || [];
    const sinCompras = !(state.compras || []).length;
    const goLiveBanner = sinCompras
      ? `<div class="card" style="margin:0 0 12px;padding:14px;border-color:var(--accent);background:rgba(0,120,100,.06)">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px">Primer uso — módulo Compras V1</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 10px;line-height:1.45">
        Las tablas <code>compras</code> y <code>proveedor_*</code> vacías en Supabase son normales hasta registrar la primera compra aquí.
        Para probar CXP de punta a punta, crea una compra a <b>crédito</b> o <b>consignación</b> (genera deuda en proveedor).
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" class="btn btn-primary btn-sm" onclick="AppPurchases.openNuevaCompraModal()">+ Nueva compra</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="typeof __cxpGoLiveCheck==='function'?__cxpGoLiveCheck():alert('Recarga con compras11 y abre consola F12')">Diagnóstico consola</button>
      </div>
    </div>`
      : '';
    el.innerHTML = `
    ${goLiveBanner}
    <div class="card" style="margin:0 0 16px">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>Compras</span>
        <div class="btn-group">
          <button type="button" class="btn btn-primary btn-sm" onclick="AppPurchases.openNuevaCompraModal()">+ Nueva compra</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AppPurchases.exportComprasCsv()">Exportar resumen</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AppPurchases.exportComprasDetalleCsv()">Exportar detalle (CSV)</button>
        </div>
      </div>
      <div class="filter-row" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <select id="cmp-f-prov" class="form-control" style="max-width:200px" onchange="AppPurchases.setFilt('provId',this.value)">
          <option value="">Todos proveedores</option>
          ${provs.map((p) => `<option value="${p.id}" ${_filt.provId === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
        </select>
        <select id="cmp-f-est" class="form-control" style="max-width:160px" onchange="AppPurchases.setFilt('estado',this.value)">
          <option value="">Estado</option>
          ${Svc().ESTADOS_COMPRA.map((e) => `<option value="${e}" ${_filt.estado === e ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
        <select id="cmp-f-tipo" class="form-control" style="max-width:160px" onchange="AppPurchases.setFilt('tipo',this.value)">
          <option value="">Tipo</option>
          ${Svc().TIPOS_COMPRA.map((t) => `<option value="${t}" ${_filt.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <input type="date" id="cmp-f-desde" class="form-control" value="${_filt.desde}" onchange="AppPurchases.setFilt('desde',this.value)" />
        <input type="date" id="cmp-f-hasta" class="form-control" value="${_filt.hasta}" onchange="AppPurchases.setFilt('hasta',this.value)" />
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Número</th><th>Proveedor</th><th>Fecha</th><th>Tipo</th><th>Factura prov.</th><th>Estado</th><th style="text-align:right">Total</th>
          </tr></thead>
          <tbody>
            ${
              list.length === 0
                ? '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text2)">Sin compras. Crea la primera con «Nueva compra».</td></tr>'
                : list
                    .map(
                      (c) => `<tr style="cursor:pointer" onclick="AppPurchases.openDetalleCompra(${JSON.stringify(String(c.id))})">
                <td><b>${esc(c.numero)}</b></td>
                <td>${esc(c.proveedorNombre)}</td>
                <td>${esc(c.fecha)}</td>
                <td><span class="badge">${esc(c.tipoCompra)}</span></td>
                <td>${esc(c.facturaProveedor || '—')}</td>
                <td>${esc(c.estado)}</td>
                <td style="text-align:right;font-weight:700">${fmt(c.total)}</td>
              </tr>`,
                    )
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function setFilt(key, val) {
    _filt[key] = val || '';
    render(ctxBase());
  }

  function lineasDraftTableHtml(arts, esc) {
    if (!_lineasDraft.length) {
      _lineasDraft.push({ articuloId: '', cantidad: 1, costoUnitario: 0 });
    }
    const sinArts = !arts.length;
    const filas = _lineasDraft
      .map((ln, i) => {
        const opts = arts.length
          ? arts
              .map(
                (a) =>
                  `<option value="${esc(a.id)}" data-nombre="${esc(a.nombre)}" data-costo="${a.precioCompra || 0}" ${String(ln.articuloId) === String(a.id) ? 'selected' : ''}>${esc(a.nombre)}${a.codigo || a.ref ? ` (${esc(a.codigo || a.ref)})` : ''}</option>`,
              )
              .join('')
          : '';
        const sub = n(ln.cantidad) * n(ln.costoUnitario);
        return `<tr>
          <td><select class="form-control cmp-art" data-i="${i}" onchange="AppPurchases.onArtChange(${i},this)" ${sinArts ? 'disabled' : ''}>
            <option value="">— Producto —</option>${opts}
          </select></td>
          <td style="width:90px"><input type="number" min="1" step="1" class="form-control cmp-qty" data-i="${i}" value="${ln.cantidad}" oninput="AppPurchases.recalcTotal()" /></td>
          <td style="width:120px"><input type="number" min="0" step="100" class="form-control cmp-costo" data-i="${i}" value="${ln.costoUnitario}" oninput="AppPurchases.recalcTotal()" /></td>
          <td class="cmp-sub" data-i="${i}" style="width:100px;text-align:right;font-weight:600">${esc(global.fmt?.(sub) || sub)}</td>
          <td style="width:44px"><button type="button" class="btn btn-danger btn-sm" title="Quitar línea" onclick="AppPurchases.removeLinea(${i})" ${_lineasDraft.length <= 1 ? 'disabled' : ''}>×</button></td>
        </tr>`;
      })
      .join('');
    return `<table>
      <thead><tr>
        <th>Producto</th><th>Cant.</th><th>Costo unit.</th><th style="text-align:right">Subtotal</th><th></th>
      </tr></thead>
      <tbody>
        ${
          sinArts
            ? '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text2)">Sin productos en catálogo.</td></tr>'
            : filas
        }
      </tbody>
    </table>`;
  }

  function refreshLineasUi() {
    const wrap = document.getElementById('cmp-lineas-wrap');
    if (!wrap) return;
    wrap.innerHTML = lineasDraftTableHtml(global.state?.articulos || [], Svc().esc);
    recalcTotal();
  }

  function openNuevaCompraModal() {
    if (!Svc()) {
      global.notify?.(
        'danger',
        '❌',
        'Módulo no cargado',
        'Falta compras-cxp-service.js o la migración SQL. Recarga con Ctrl+F5.',
      );
      return;
    }
    const state = global.state || {};
    _lineasDraft = [{ articuloId: '', cantidad: 1, costoUnitario: 0 }];
    const esc = Svc().esc;
    const provs = state.usu_proveedores || [];
    const arts = state.articulos || [];
    const bods = state.bodegas || [];
    const sinProv = !provs.length;
    const sinArts = !arts.length;
    const bodegaOpts = bods
      .map((b) => `<option value="${esc(b.id)}">${esc(b.name || b.nombre || b.id)}</option>`)
      .join('');

    global.openModal(
      `<div class="modal-title">Nueva compra<button type="button" class="modal-close" onclick="closeModal()">×</button></div>
      ${
        sinProv
          ? '<p style="padding:10px 12px;margin:0 0 12px;background:rgba(255,180,0,.12);border-radius:8px;font-size:13px">⚠️ No hay proveedores. Crea uno en <b>Usuarios → Proveedores</b> antes de registrar compras.</p>'
          : ''
      }
      ${
        sinArts
          ? '<p style="padding:10px 12px;margin:0 0 12px;background:rgba(255,180,0,.12);border-radius:8px;font-size:13px">⚠️ No hay productos en catálogo. Agrega artículos en <b>Inventario → Catálogo</b>.</p>'
          : ''
      }
      <div class="form-group"><label class="form-label">Proveedor</label>
        <select id="cmp-prov" class="form-control" ${sinProv ? 'disabled' : ''}>
          <option value="">— Seleccionar —</option>
          ${provs.map((p) => `<option value="${esc(p.id)}" data-nombre="${esc(p.nombre)}">${esc(p.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group"><label class="form-label">Fecha</label>
          <input type="date" id="cmp-fecha" class="form-control" value="${esc(global.today?.() || '')}" />
        </div>
        <div class="form-group"><label class="form-label">Factura / remisión proveedor</label>
          <input id="cmp-factura" class="form-control" placeholder="FV-8891" />
        </div>
      </div>
      <div class="form-group"><label class="form-label">Tipo de compra</label>
        <select id="cmp-tipo" class="form-control">
          <option value="contado">Contado</option>
          <option value="credito">Crédito</option>
          <option value="consignacion">Consignación</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Bodega destino (todas las líneas)</label>
        <select id="cmp-bodega" class="form-control" ${bods.length ? '' : 'disabled'}>
          ${bodegaOpts || '<option value="bodega_main">Bodega Principal</option>'}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Nota (opcional)</label>
        <input id="cmp-nota" class="form-control" placeholder="Observaciones internas" />
      </div>
      <div class="card" style="padding:12px;margin:12px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
          <b>Líneas de compra</b>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AppPurchases.addLineaDraft()" ${sinArts ? 'disabled' : ''}>+ Agregar línea</button>
        </div>
        <div id="cmp-lineas-wrap" class="table-wrap">${lineasDraftTableHtml(arts, esc)}</div>
        <p id="cmp-total-preview" style="text-align:right;font-weight:700;margin:12px 0 0;font-size:15px">Total: ${esc(global.fmt?.(0) || '$0')}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary" id="cmp-btn-save" style="flex:1" onclick="AppPurchases.guardarCompra()" ${sinProv || sinArts ? 'disabled' : ''}>Guardar compra</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
      </div>`,
      true,
    );
    setTimeout(() => recalcTotal(), 0);
  }

  function addLineaDraft() {
    _lineasDraft.push({ articuloId: '', cantidad: 1, costoUnitario: 0 });
    refreshLineasUi();
  }

  function removeLinea(i) {
    if (_lineasDraft.length <= 1) return;
    _lineasDraft.splice(i, 1);
    refreshLineasUi();
  }

  function onArtChange(i, sel) {
    const opt = sel.options[sel.selectedIndex];
    _lineasDraft[i].articuloId = sel.value;
    _lineasDraft[i].articuloNombre = opt?.getAttribute('data-nombre') || '';
    _lineasDraft[i].costoUnitario = parseFloat(opt?.getAttribute('data-costo') || 0) || 0;
    const costInp = document.querySelector(`.cmp-costo[data-i="${i}"]`);
    if (costInp) costInp.value = _lineasDraft[i].costoUnitario;
    recalcTotal();
  }

  function recalcTotal() {
    const bodegaId = document.getElementById('cmp-bodega')?.value || defaultBodegaId(global.state || {});
    document.querySelectorAll('.cmp-art').forEach((sel) => {
      const i = parseInt(sel.getAttribute('data-i'), 10);
      if (!Number.isFinite(i) || !_lineasDraft[i]) return;
      const qty = parseFloat(document.querySelector(`.cmp-qty[data-i="${i}"]`)?.value || 0);
      const costo = parseFloat(document.querySelector(`.cmp-costo[data-i="${i}"]`)?.value || 0);
      const opt = sel.options[sel.selectedIndex];
      _lineasDraft[i] = {
        ..._lineasDraft[i],
        articuloId: sel.value,
        articuloNombre: opt?.getAttribute('data-nombre') || _lineasDraft[i].articuloNombre || '',
        cantidad: qty,
        costoUnitario: costo,
        bodegaId,
      };
      const subEl = document.querySelector(`.cmp-sub[data-i="${i}"]`);
      if (subEl) subEl.textContent = global.fmt?.(qty * costo) || String(qty * costo);
    });
    const total = _lineasDraft.reduce((s, l) => s + n(l.cantidad) * n(l.costoUnitario), 0);
    const el = document.getElementById('cmp-total-preview');
    if (el) el.textContent = `Total: ${global.fmt?.(total) || total}`;
  }

  async function guardarCompra() {
    const btn = document.getElementById('cmp-btn-save');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Guardando…';
    }
    recalcTotal();
    const sel = document.getElementById('cmp-prov');
    const opt = sel?.options[sel.selectedIndex];
    const proveedorId = sel?.value;
    const proveedorNombre = opt?.getAttribute('data-nombre') || opt?.text || '';
    const tipoCompra = document.getElementById('cmp-tipo')?.value || 'credito';
    const fecha = document.getElementById('cmp-fecha')?.value?.trim();
    const bodegaId = document.getElementById('cmp-bodega')?.value || defaultBodegaId(global.state || {});
    if (!fecha) {
      global.notify?.('warning', '⚠️', 'Revisa la compra', 'Indica la fecha de la compra.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Guardar compra';
      }
      return;
    }
    const lineas = _lineasDraft
      .filter((l) => l.articuloId && l.cantidad > 0)
      .map((l) => ({
        ...l,
        cantidad: parseInt(l.cantidad, 10) || 0,
        costoUnitario: parseFloat(l.costoUnitario) || 0,
        bodegaId,
      }));
    const val = Svc().validarPayloadCompra(global.state, {
      proveedorId,
      tipoCompra,
      fecha,
      lineas,
    });
    if (!val.ok) {
      global.notify?.('warning', '⚠️', 'Revisa la compra', val.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Guardar compra';
      }
      return;
    }
    try {
      global.showLoadingOverlay?.('connecting');
      const res = await Svc().guardarCompra(ctxBase(), {
        proveedorId,
        proveedorNombre,
        tipoCompra,
        facturaProveedor: document.getElementById('cmp-factura')?.value?.trim(),
        fecha,
        nota: document.getElementById('cmp-nota')?.value?.trim(),
        lineas,
      });
      global.showLoadingOverlay?.('hide');
      global.closeModal?.();
      global.notify?.('success', '✅', 'Compra registrada', proveedorNombre);
      if (res?.advertenciaStock) {
        global.notify?.('warning', '⚠️', 'Stock parcial', res.advertenciaStock);
      }
      render(ctxBase());
      if (typeof global.renderTesPagosProv === 'function') global.renderTesPagosProv();
    } catch (e) {
      global.showLoadingOverlay?.('hide');
      global.notify?.('danger', '❌', 'Error', e.message || String(e));
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Guardar compra';
      }
    }
  }

  function openDetalleCompra(compraId) {
    if (!Svc()) return;
    const state = global.state || {};
    const esc = Svc().esc;
    const fmt = global.fmt;
    const c = (state.compras || []).find((x) => String(x.id) === String(compraId));
    if (!c) {
      global.notify?.('warning', '⚠️', 'Compra no encontrada', '');
      return;
    }
    const items = Svc().itemsDeCompra(state, compraId);
    const cargo = (state.proveedor_cxp_movimientos || []).find(
      (m) => String(m.compraId) === String(compraId) && m.naturaleza === 'cargo' && m.estado === 'active',
    );
    const apps = cargo
      ? (state.proveedor_abono_aplicaciones || []).filter(
          (a) => a.estado === 'active' && String(a.movimientoCargoId) === String(cargo.id),
        )
      : [];
    const puedeAnular =
      c.estado !== 'cancelled' && !Svc().compraTieneAbonosActivos(state, compraId);
    const lineasHtml = items.length
      ? items
          .map(
            (it) =>
              `<tr><td>${esc(it.articuloNombre || it.articuloId)}</td><td style="text-align:right">${it.cantidad}</td><td style="text-align:right">${fmt(it.costoUnitario)}</td><td style="text-align:right">${fmt(it.subtotal ?? it.cantidad * it.costoUnitario)}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4">Sin líneas</td></tr>';
    const appsHtml = apps.length
      ? apps
          .map((a) => {
            const ab = (state.proveedor_abonos || []).find((x) => String(x.id) === String(a.abonoId));
            return `<tr><td>${esc(ab?.fecha || '—')}</td><td style="text-align:right">${fmt(a.montoAplicado)}</td></tr>`;
          })
          .join('')
      : '<tr><td colspan="2">Sin abonos aplicados a esta compra</td></tr>';
    global.openModal(
      `<div class="modal-title">Compra ${esc(c.numero)}<button type="button" class="modal-close" onclick="closeModal()">×</button></div>
      <p style="font-size:13px;margin-bottom:12px">${esc(c.proveedorNombre)} · ${esc(c.fecha)} · ${esc(c.tipoCompra)} · <b>${esc(c.estado)}</b> · Total <b>${fmt(c.total)}</b></p>
      ${c.facturaProveedor ? `<p style="font-size:12px">Factura prov.: ${esc(c.facturaProveedor)}</p>` : ''}
      ${c.nota ? `<p style="font-size:12px;color:var(--text2)">${esc(c.nota)}</p>` : ''}
      <h4 style="font-size:13px;margin:12px 0 6px">Líneas</h4>
      <div class="table-wrap"><table><thead><tr><th>Artículo</th><th style="text-align:right">Cant.</th><th style="text-align:right">Costo</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${lineasHtml}</tbody></table></div>
      ${
        cargo
          ? `<h4 style="font-size:13px;margin:12px 0 6px">Cargo CXP · ${fmt(cargo.monto)}</h4>
      <div class="table-wrap"><table><thead><tr><th>Abono (fecha)</th><th style="text-align:right">Aplicado</th></tr></thead><tbody>${appsHtml}</tbody></table></div>`
          : ''
      }
      ${
        puedeAnular
          ? `<button type="button" class="btn btn-danger" style="margin-top:12px" onclick="AppPurchases.anularCompra(${JSON.stringify(String(compraId))})">Anular compra</button>`
          : c.estado !== 'cancelled'
            ? '<p style="font-size:12px;color:var(--orange);margin-top:12px">No se puede anular: hay abonos aplicados. Anule los abonos primero.</p>'
            : ''
      }
      <button type="button" class="btn btn-secondary" style="margin-top:12px;margin-left:8px" onclick="closeModal()">Cerrar</button>`,
      true,
    );
  }

  async function anularCompra(compraId) {
    if (!global.confirm?.('¿Anular esta compra? El cargo en CXP se marcará cancelado (sin borrar filas).')) return;
    try {
      global.showLoadingOverlay?.('connecting');
      await Svc().anularCompra(ctxBase(), compraId);
      global.showLoadingOverlay?.('hide');
      global.closeModal?.();
      global.notify?.('success', '↩️', 'Compra anulada', '');
      render(ctxBase());
    } catch (e) {
      global.showLoadingOverlay?.('hide');
      global.notify?.('danger', '❌', 'Error', e.message);
    }
  }

  function exportComprasCsv() {
    const state = global.state || {};
    const rows = [['Numero', 'Proveedor', 'Fecha', 'Tipo', 'Estado', 'Total']];
    (state.compras || []).forEach((c) => {
      rows.push([c.numero, c.proveedorNombre, c.fecha, c.tipoCompra, c.estado, c.total]);
    });
    const csv = '\ufeff' + rows.map((r) => r.map((c) => String(c ?? '').replace(/;/g, ',')).join(';')).join('\n');
    Svc().downloadCsv(`compras_resumen_${global.today?.() || 'export'}.csv`, csv);
    global.notify?.('success', '📄', 'Exportado', 'Resumen de compras');
  }

  function exportComprasDetalleCsv() {
    const csv = Svc().exportCsvComprasDetalle(global.state || {}, _filt);
    Svc().downloadCsv(`compras_detalle_${global.today?.() || 'export'}.csv`, csv);
    global.notify?.('success', '📄', 'Exportado', 'Detalle por línea (Excel: separador ;)');
  }

  global.AppPurchases = {
    render,
    setFilt,
    openNuevaCompraModal,
    openDetalleCompra,
    anularCompra,
    addLineaDraft,
    removeLinea,
    onArtChange,
    recalcTotal,
    guardarCompra,
    exportComprasCsv,
    exportComprasDetalleCsv,
  };
})(window);
