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

  function render(ctx, mountEl) {
    const el = mountEl || document.getElementById('compras-content');
    if (!el || !Svc()) return;
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
    el.innerHTML = `
    <div class="card" style="margin:0 0 16px">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>Compras</span>
        <div class="btn-group">
          <button type="button" class="btn btn-primary btn-sm" onclick="AppPurchases.openNuevaCompraModal()">+ Nueva compra</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AppPurchases.exportComprasCsv()">Exportar CSV</button>
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
                ? '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text2)">Sin compras. Ejecuta la migración SQL y crea la primera compra.</td></tr>'
                : list
                    .map(
                      (c) => `<tr>
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

  function openNuevaCompraModal() {
    _lineasDraft = [];
    const state = global.state || {};
    const esc = Svc().esc;
    const arts = state.articulos || [];
    global.openModal(
      'Nueva compra',
      `
      <div class="form-group"><label>Proveedor</label>
        <select id="cmp-prov" class="form-control">
          <option value="">—</option>
          ${(state.usu_proveedores || []).map((p) => `<option value="${p.id}" data-nombre="${esc(p.nombre)}">${esc(p.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Tipo</label>
        <select id="cmp-tipo" class="form-control">
          <option value="contado">Contado</option>
          <option value="credito">Crédito</option>
          <option value="consignacion">Consignación</option>
        </select>
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group"><label>Fecha</label><input type="date" id="cmp-fecha" class="form-control" value="${global.today?.() || ''}" /></div>
        <div class="form-group"><label>Factura / remisión proveedor</label><input id="cmp-factura" class="form-control" placeholder="FV-8891" /></div>
      </div>
      <div class="form-group"><label>Nota</label><input id="cmp-nota" class="form-control" /></div>
      <div class="card" style="padding:12px;margin:12px 0">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <b>Líneas</b>
          <button type="button" class="btn btn-secondary btn-sm" onclick="AppPurchases.addLineaDraft()">+ Producto</button>
        </div>
        <div id="cmp-lineas">${lineasDraftHtml(arts, esc)}</div>
        <p id="cmp-total-preview" style="text-align:right;font-weight:700;margin:8px 0 0">Total: ${global.fmt?.(0) || '$0'}</p>
      </div>
      <button type="button" class="btn btn-primary" id="cmp-btn-save" onclick="AppPurchases.guardarCompra()">Guardar compra</button>
    `,
      { wide: true },
    );
  }

  function lineasDraftHtml(arts, esc) {
    if (!_lineasDraft.length) _lineasDraft.push({ articuloId: '', cantidad: 1, costoUnitario: 0 });
    return _lineasDraft
      .map((ln, i) => {
        const opts = arts
          .map(
            (a) =>
              `<option value="${a.id}" data-nombre="${esc(a.nombre)}" data-costo="${a.precioCompra || 0}" ${ln.articuloId === a.id ? 'selected' : ''}>${esc(a.nombre)} (${esc(a.codigo || a.ref)})</option>`,
          )
          .join('');
        return `<div class="form-row" style="display:grid;grid-template-columns:2fr 80px 120px 40px;gap:6px;margin-bottom:6px;align-items:end">
          <select class="form-control cmp-art" data-i="${i}" onchange="AppPurchases.onArtChange(${i},this)"><option value="">Artículo</option>${opts}</select>
          <input type="number" min="1" step="1" class="form-control cmp-qty" data-i="${i}" value="${ln.cantidad}" oninput="AppPurchases.recalcTotal()" />
          <input type="number" min="0" step="100" class="form-control cmp-costo" data-i="${i}" value="${ln.costoUnitario}" oninput="AppPurchases.recalcTotal()" />
          <button type="button" class="btn btn-danger btn-sm" onclick="AppPurchases.removeLinea(${i})">×</button>
        </div>`;
      })
      .join('');
  }

  function addLineaDraft() {
    _lineasDraft.push({ articuloId: '', cantidad: 1, costoUnitario: 0 });
    const box = document.getElementById('cmp-lineas');
    if (box) box.innerHTML = lineasDraftHtml(global.state?.articulos || [], Svc().esc);
    recalcTotal();
  }

  function removeLinea(i) {
    _lineasDraft.splice(i, 1);
    const box = document.getElementById('cmp-lineas');
    if (box) box.innerHTML = lineasDraftHtml(global.state?.articulos || [], Svc().esc);
    recalcTotal();
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
    document.querySelectorAll('.cmp-art').forEach((sel) => {
      const i = parseInt(sel.getAttribute('data-i'), 10);
      const qty = parseFloat(document.querySelector(`.cmp-qty[data-i="${i}"]`)?.value || 0);
      const costo = parseFloat(document.querySelector(`.cmp-costo[data-i="${i}"]`)?.value || 0);
      const opt = sel.options[sel.selectedIndex];
      _lineasDraft[i] = {
        articuloId: sel.value,
        articuloNombre: opt?.getAttribute('data-nombre') || '',
        cantidad: qty,
        costoUnitario: costo,
      };
    });
    const total = _lineasDraft.reduce((s, l) => s + (l.cantidad || 0) * (l.costoUnitario || 0), 0);
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
    const lineas = _lineasDraft
      .filter((l) => l.articuloId && l.cantidad > 0)
      .map((l) => ({
        ...l,
        cantidad: parseInt(l.cantidad, 10) || 0,
        costoUnitario: parseFloat(l.costoUnitario) || 0,
      }));
    const val = Svc().validarPayloadCompra(global.state, {
      proveedorId,
      tipoCompra,
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
      await Svc().guardarCompra(ctxBase(), {
        proveedorId,
        proveedorNombre,
        tipoCompra,
        facturaProveedor: document.getElementById('cmp-factura')?.value?.trim(),
        fecha: document.getElementById('cmp-fecha')?.value,
        nota: document.getElementById('cmp-nota')?.value?.trim(),
        lineas,
      });
      global.showLoadingOverlay?.('hide');
      global.closeModal?.();
      global.notify?.('success', '✅', 'Compra registrada', proveedorNombre);
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

  function exportComprasCsv() {
    const state = global.state || {};
    const fmt = global.fmt;
    const rows = [['Numero', 'Proveedor', 'Fecha', 'Tipo', 'Estado', 'Total']];
    (state.compras || []).forEach((c) => {
      rows.push([c.numero, c.proveedorNombre, c.fecha, c.tipoCompra, c.estado, c.total]);
    });
    const blob = new Blob([rows.map((r) => r.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `compras_${global.today?.() || 'export'}.csv`;
    a.click();
    global.notify?.('success', '📄', 'Exportado', 'CSV de compras (Excel: abrir con separador ;)');
  }

  global.AppPurchases = {
    render,
    setFilt,
    openNuevaCompraModal,
    addLineaDraft,
    removeLinea,
    onArtChange,
    recalcTotal,
    guardarCompra,
    exportComprasCsv,
  };
})(window);
