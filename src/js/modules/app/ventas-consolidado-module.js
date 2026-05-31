// ============================================================================
// Consolidado de ventas (capa de SOLO LECTURA sobre `sale_items`).
//
// Pantalla operativa para consultar el consolidado por líneas de venta usando la
// fuente central `window.getSaleItemsReportRows()` (que EXCLUYE facturas anuladas
// por defecto). NO escribe nada: no llama insert/update/delete/upsert/saveRecord,
// no toca ventas, facturas, stock_moves, tes_movimientos, products ni caja.
//
// Bridge: core.js -> window.AppVentasConsolidadoModule.renderVentasConsolidado(ctx)
// ============================================================================
(function initVentasConsolidado(global) {
  'use strict';

  // ctx capturado en cada render (state, fmt, fmtN, formatDate, today). Permite que
  // los handlers inline (apply/clear/exportCsv) operen sin re-recibir el contexto.
  let _ctx = null;

  // ---- helpers de formato (usa los del ERP si existen; si no, fallback local) ----
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
    );
  const fmtCOP = (n) =>
    _ctx && typeof _ctx.fmt === 'function'
      ? _ctx.fmt(Number(n) || 0)
      : '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
  const fmtNum = (n) =>
    _ctx && typeof _ctx.fmtN === 'function'
      ? _ctx.fmtN(Number(n) || 0)
      : Math.round(Number(n) || 0).toLocaleString('es-CO');
  const fmtFecha = (ymd) =>
    !ymd ? '—' : _ctx && typeof _ctx.formatDate === 'function' ? _ctx.formatDate(ymd) : ymd;

  function ymdToday() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ---- derivaciones de fila ----
  function rowFechaYmd(r) {
    if (r && r.fecha) return String(r.fecha).slice(0, 10);
    if (r && r.fechaHora) return String(r.fechaHora).slice(0, 10);
    return '';
  }
  function rowHora(r) {
    if (!r || !r.fechaHora) return '';
    const d = new Date(r.fechaHora);
    if (!isNaN(d.getTime())) {
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    const m = String(r.fechaHora).match(/T(\d{2}:\d{2})/);
    return m ? m[1] : '';
  }
  function rowSortKey(r) {
    return String((r && (r.fechaHora || r.fecha)) || '');
  }

  // Proveedor NO vive en sale_items; se deriva del producto (productId -> artículo ->
  // proveedorNombre). Mapa cacheado por render para no reconstruirlo en cada filtro.
  let _provByProduct = null;
  function buildProvMap() {
    const st = (_ctx && _ctx.state) || global.state || {};
    const arts = Array.isArray(st.articulos) ? st.articulos : [];
    const m = new Map();
    arts.forEach((a) => {
      if (a && a.id != null) m.set(String(a.id), String(a.proveedorNombre || '').trim());
    });
    _provByProduct = m;
  }
  function rowProveedor(r) {
    if (!_provByProduct) buildProvMap();
    const pid = r && r.productId != null ? String(r.productId) : '';
    return (pid && _provByProduct.get(pid)) || '';
  }

  // ---- fuente de datos (central; fallback seguro) ----
  function getBaseRows(includeAnuladas) {
    if (typeof global.getSaleItemsReportRows === 'function') {
      try {
        return global.getSaleItemsReportRows(includeAnuladas ? { includeAnuladas: true } : undefined) || [];
      } catch (e) {
        console.warn('[VentasConsolidado] getSaleItemsReportRows:', e && e.message);
      }
    }
    const st = (_ctx && _ctx.state) || global.state || {};
    return Array.isArray(st.saleItems) ? st.saleItems.slice() : [];
  }

  // ---- lectura de filtros desde el DOM (null-safe) ----
  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }
  function checked(id) {
    const el = document.getElementById(id);
    return !!(el && el.checked);
  }
  function readFilters() {
    return {
      fDesde: val('vc-f-desde'),
      fHasta: val('vc-f-hasta'),
      hDesde: val('vc-h-desde'),
      hHasta: val('vc-h-hasta'),
      cliente: val('vc-cliente').trim().toLowerCase(),
      articulo: val('vc-articulo').trim().toLowerCase(),
      canal: val('vc-canal'),
      talla: val('vc-talla'),
      proveedor: val('vc-proveedor'),
      includeAnuladas: checked('vc-incluir-anuladas'),
    };
  }

  function filterRows(rows, f) {
    return rows.filter((r) => {
      const fy = rowFechaYmd(r);
      if (f.fDesde && (!fy || fy < f.fDesde)) return false;
      if (f.fHasta && (!fy || fy > f.fHasta)) return false;
      if (f.hDesde || f.hHasta) {
        const hh = rowHora(r);
        if (f.hDesde && (!hh || hh < f.hDesde)) return false;
        if (f.hHasta && (!hh || hh > f.hHasta)) return false;
      }
      if (f.cliente) {
        const hay = (String(r.clienteNombre || '') + ' ' + String(r.clienteTelefono || '')).toLowerCase();
        if (hay.indexOf(f.cliente) === -1) return false;
      }
      if (f.articulo) {
        const hay = (
          String(r.productName || '') + ' ' + String(r.productRef || '') + ' ' + String(r.productId || '')
        ).toLowerCase();
        if (hay.indexOf(f.articulo) === -1) return false;
      }
      if (f.canal && f.canal !== '__all__' && String(r.canal || '') !== f.canal) return false;
      if (f.talla && f.talla !== '__all__' && String(r.talla || '') !== f.talla) return false;
      if (f.proveedor && f.proveedor !== '__all__') {
        const pv = rowProveedor(r);
        if (f.proveedor === '__none__') {
          if (pv) return false;
        } else if (pv !== f.proveedor) {
          return false;
        }
      }
      return true;
    });
  }

  function currentFilteredRows() {
    const f = readFilters();
    const base = getBaseRows(f.includeAnuladas);
    const filtered = filterRows(base, f);
    filtered.sort((a, b) => (rowSortKey(a) < rowSortKey(b) ? 1 : rowSortKey(a) > rowSortKey(b) ? -1 : 0));
    return filtered;
  }

  // ---- KPIs ----
  function computeKpis(rows) {
    let totalCop = 0;
    let unidades = 0;
    const facturas = new Set();
    const porArticulo = Object.create(null);
    rows.forEach((r) => {
      totalCop += Number(r.subtotal) || 0;
      const q = Number(r.qty) || 0;
      unidades += q;
      const fk = r.invoiceId || r.invoiceNumber;
      if (fk) facturas.add(String(fk));
      const nombre = r.productName || r.productRef || r.productId || '—';
      porArticulo[nombre] = (porArticulo[nombre] || 0) + q;
    });
    const numFacturas = facturas.size;
    let topNombre = '—';
    let topQty = 0;
    Object.keys(porArticulo).forEach((k) => {
      if (porArticulo[k] > topQty) {
        topQty = porArticulo[k];
        topNombre = k;
      }
    });
    return {
      totalCop,
      unidades,
      lineas: rows.length,
      numFacturas,
      ticketProm: numFacturas ? totalCop / numFacturas : 0,
      topNombre,
      topQty,
    };
  }

  function kpiCardsHtml(k) {
    const card = (label, value, extra) =>
      `<div style="flex:1;min-width:140px;background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:10px 12px">
         <div style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--text2)">${esc(label)}</div>
         <div style="font-size:18px;font-weight:800;margin-top:2px">${value}</div>
         ${extra ? `<div style="font-size:11px;color:var(--text2);margin-top:2px">${extra}</div>` : ''}
       </div>`;
    return (
      `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">` +
      card('Total COP', fmtCOP(k.totalCop)) +
      card('Unidades', fmtNum(k.unidades)) +
      card('Líneas', fmtNum(k.lineas)) +
      card('Facturas únicas', fmtNum(k.numFacturas)) +
      card('Ticket promedio', fmtCOP(k.ticketProm)) +
      card('Top artículo (uds)', esc(k.topNombre), `${fmtNum(k.topQty)} uds`) +
      `</div>`
    );
  }

  function tbodyHtml(rows) {
    if (!rows.length) {
      return `<tr><td colspan="13" style="text-align:center;color:var(--text2);padding:24px">Sin líneas para los filtros actuales</td></tr>`;
    }
    return rows
      .map(
        (r) => `<tr>
        <td>${esc(fmtFecha(rowFechaYmd(r)))}</td>
        <td style="color:var(--text2)">${esc(rowHora(r) || '—')}</td>
        <td>${esc(r.invoiceNumber || '—')}</td>
        <td>${esc(r.clienteNombre || '—')}${r.clienteTelefono ? `<div style="font-size:10px;color:var(--text2)">${esc(r.clienteTelefono)}</div>` : ''}</td>
        <td>${esc(r.productName || '—')}</td>
        <td style="color:var(--text2)">${esc(r.productRef || '—')}</td>
        <td>${esc(r.talla || '—')}</td>
        <td style="text-align:right;font-weight:700">${fmtNum(r.qty)}</td>
        <td style="text-align:right">${fmtCOP(r.unitPrice)}</td>
        <td style="text-align:right;font-weight:700;color:var(--accent)">${fmtCOP(r.subtotal)}</td>
        <td>${esc(r.canal || '—')}</td>
        <td style="font-size:10px;color:var(--text2)">${esc(r.source || '—')}</td>
        <td style="text-align:right"><button type="button" class="btn btn-xs btn-secondary" title="Descargar PDF de factura" data-vc-pdf data-vc-pdf-iid="${esc(r.invoiceId || '')}" data-vc-pdf-inum="${esc(r.invoiceNumber || '')}">PDF</button></td>
      </tr>`,
      )
      .join('');
  }

  // Reutiliza el flujo PDF EXISTENTE de Facturas (no genera PDF nuevo ni recalcula
  // totales). Abre la factura COMPLETA asociada a la línea. 100% solo lectura.
  function openFacturaPdf(invoiceId, invoiceNumber) {
    const st = (_ctx && _ctx.state) || global.state || {};
    const facturas = Array.isArray(st.facturas) ? st.facturas : [];
    let f = null;
    if (invoiceId) f = facturas.find((x) => String(x.id) === String(invoiceId));
    if (!f && invoiceNumber) f = facturas.find((x) => String(x.numero) === String(invoiceNumber));
    if (!f && invoiceNumber) f = facturas.find((x) => String(x.number) === String(invoiceNumber));
    if (!f) {
      if (typeof global.notify === 'function') {
        global.notify('warning', 'PDF', 'Factura no encontrada', 'No se encontró la factura asociada a esta línea. Recarga datos o revisa sale_items.', { duration: 5000 });
      } else {
        global.alert('Factura no encontrada. Recarga datos o revisa sale_items.');
      }
      return;
    }
    if (typeof global.downloadDocPdf === 'function') {
      global.downloadDocPdf('facturas', f.id);
      return;
    }
    if (typeof global.viewDoc === 'function') {
      global.viewDoc('facturas', f.id);
      return;
    }
    if (typeof global.notify === 'function') {
      global.notify('warning', 'PDF', 'No disponible', 'No se pudo abrir el PDF (módulo no cargado). Recarga la página.', { duration: 5000 });
    } else {
      global.alert('No se pudo abrir el PDF. Recarga la página.');
    }
  }

  // Listener delegado en el <tbody> (nodo estable aunque cambie su innerHTML al filtrar).
  function bindPdfDelegation() {
    const tbodyEl = document.getElementById('vc-tbody');
    if (!tbodyEl || tbodyEl.__vcPdfBound) return;
    tbodyEl.__vcPdfBound = true;
    tbodyEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-vc-pdf]') : null;
      if (!btn) return;
      openFacturaPdf(btn.getAttribute('data-vc-pdf-iid') || '', btn.getAttribute('data-vc-pdf-inum') || '');
    });
  }

  // Recalcula KPIs + tbody + contador SIN re-renderizar los inputs (preserva foco).
  function apply() {
    const rows = currentFilteredRows();
    const kpisEl = document.getElementById('vc-kpis');
    if (kpisEl) kpisEl.innerHTML = kpiCardsHtml(computeKpis(rows));
    const tbodyEl = document.getElementById('vc-tbody');
    if (tbodyEl) tbodyEl.innerHTML = tbodyHtml(rows);
    const countEl = document.getElementById('vc-count');
    if (countEl) countEl.textContent = fmtNum(rows.length);
  }

  function clear() {
    ['vc-f-desde', 'vc-f-hasta', 'vc-h-desde', 'vc-h-hasta', 'vc-cliente', 'vc-articulo'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['vc-canal', 'vc-talla', 'vc-proveedor'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '__all__';
    });
    const inc = document.getElementById('vc-incluir-anuladas');
    if (inc) inc.checked = false;
    apply();
  }

  function exportCsv() {
    const rows = currentFilteredRows();
    const sep = ';';
    const headers = [
      'Fecha',
      'Hora',
      'Factura',
      'Cliente',
      'Telefono',
      'Articulo',
      'Ref',
      'Talla',
      'Cantidad',
      'PrecioUnitario',
      'Subtotal',
      'Canal',
      'Fuente',
    ];
    const cell = (v) => {
      let s = String(v == null ? '' : v);
      if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [headers.join(sep)];
    rows.forEach((r) => {
      lines.push(
        [
          rowFechaYmd(r),
          rowHora(r),
          r.invoiceNumber || '',
          r.clienteNombre || '',
          r.clienteTelefono || '',
          r.productName || '',
          r.productRef || '',
          r.talla || '',
          Number(r.qty) || 0,
          Number(r.unitPrice) || 0,
          Number(r.subtotal) || 0,
          r.canal || '',
          r.source || '',
        ]
          .map(cell)
          .join(sep),
      );
    });
    // BOM UTF-8 + CRLF para tildes y compatibilidad Excel.
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ventas_consolidado_' + ymdToday() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function distinct(rows, key) {
    const set = new Set();
    rows.forEach((r) => {
      const v = r && r[key];
      if (v) set.add(String(v));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }

  // ---- notificación tolerante (usa notify del ERP si existe) ----
  function notifyMsg(type, icon, title, desc) {
    if (typeof global.notify === 'function') {
      try {
        global.notify(type, icon, title, desc, { duration: 4500 });
        return true;
      } catch (e) {
        /* noop */
      }
    }
    return false;
  }

  function setBtnBusy(id, busyText) {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = true;
      el.dataset.prevText = el.textContent;
      el.textContent = busyText;
    }
  }

  // Acción administrativa explícita: genera el histórico llamando SOLO al backfill
  // existente (idempotente, no crea duplicados, no toca caja/stock/ventas/facturas).
  async function generarHistorico() {
    if (typeof global.backfillSaleItemsVentaPos !== 'function') {
      notifyMsg('warning', '⚠️', 'No disponible', 'No se cargó el backfill (pos-repository.js / core.js). Recarga la página.');
      return;
    }
    if (
      !global.confirm(
        'Se generarán líneas consolidadas desde facturas existentes. No toca caja, stock, ventas ni facturas. Es idempotente. ¿Continuar?',
      )
    ) {
      return;
    }
    setBtnBusy('vc-btn-generar', 'Generando…');
    setBtnBusy('vc-btn-generar-empty', 'Generando…');
    try {
      // `true` => evita la confirmación propia del backfill (ya confirmamos aquí).
      await global.backfillSaleItemsVentaPos(true);
      if (typeof global.loadSaleItemsIntoState === 'function') {
        try {
          await global.loadSaleItemsIntoState();
        } catch (e) {
          console.warn('[VentasConsolidado] loadSaleItemsIntoState:', e && e.message);
        }
      }
      renderVentasConsolidado(_ctx);
    } catch (e) {
      console.warn('[VentasConsolidado] generarHistorico:', e);
      if (!notifyMsg('danger', '⚠️', 'No se pudo generar', (e && e.message) || 'Error inesperado.')) {
        renderVentasConsolidado(_ctx);
      }
    }
  }

  // Recarga datos desde el estado (sin modificar nada) y re-renderiza.
  async function recargar() {
    setBtnBusy('vc-btn-recargar', 'Recargando…');
    setBtnBusy('vc-btn-recargar-empty', 'Recargando…');
    try {
      if (typeof global.loadSaleItemsIntoState === 'function') {
        await global.loadSaleItemsIntoState();
      }
    } catch (e) {
      console.warn('[VentasConsolidado] recargar:', e && e.message);
    }
    renderVentasConsolidado(_ctx);
  }

  function emptyStateHtml() {
    return `<div class="card">
      <div class="card-title">Consolidado de ventas</div>
      <div style="max-width:560px;margin:0 auto;text-align:center;color:var(--text2);padding:28px 16px">
        <div style="font-size:13px;line-height:1.5;margin-bottom:16px">
          Todavía no hay líneas consolidadas. Las ventas nuevas se consolidan automáticamente;
          para cargar ventas históricas desde facturas existentes puedes generar el histórico una sola vez.
        </div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn btn-primary" id="vc-btn-generar-empty" onclick="AppVentasConsolidadoModule.generarHistorico()">Generar histórico</button>
          <button class="btn btn-secondary" id="vc-btn-recargar-empty" onclick="AppVentasConsolidadoModule.recargar()">Recargar</button>
        </div>
        <div style="font-size:11px;color:var(--text2)">
          Esta acción no toca caja, stock, ventas ni facturas. Solo crea líneas de reporte faltantes.
        </div>
      </div>
    </div>`;
  }

  function renderVentasConsolidado(ctx) {
    _ctx = ctx || _ctx || {};
    const mount = document.getElementById('ventas_consolidado-content');
    if (!mount) return;

    // Opciones estables (canal/talla) calculadas sobre TODO (incl. anuladas) para que
    // no desaparezcan al alternar el toggle.
    const allRows = getBaseRows(true);
    if (!allRows.length) {
      mount.innerHTML = emptyStateHtml();
      return;
    }

    const canales = distinct(allRows, 'canal');
    const tallas = distinct(allRows, 'talla');
    const optHtml = (arr) =>
      `<option value="__all__">Todos</option>` +
      arr.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');

    // Opciones de proveedor derivadas de los productos presentes (estables).
    buildProvMap();
    const provSet = new Set();
    let hasSinProv = false;
    allRows.forEach((r) => {
      const pv = rowProveedor(r);
      if (pv) provSet.add(pv);
      else hasSinProv = true;
    });
    const proveedores = Array.from(provSet).sort((a, b) => a.localeCompare(b, 'es'));
    const provOptHtml =
      `<option value="__all__">Todos</option>` +
      proveedores.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('') +
      (hasSinProv ? `<option value="__none__">(Sin proveedor)</option>` : '');

    const labelStyle = 'font-size:10px;color:var(--text2);display:block;margin-bottom:4px';

    mount.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div><label style="${labelStyle}">Fecha desde</label><input type="date" id="vc-f-desde" class="form-control" oninput="AppVentasConsolidadoModule.apply()"></div>
          <div><label style="${labelStyle}">Fecha hasta</label><input type="date" id="vc-f-hasta" class="form-control" oninput="AppVentasConsolidadoModule.apply()"></div>
          <div><label style="${labelStyle}">Hora desde</label><input type="time" id="vc-h-desde" class="form-control" oninput="AppVentasConsolidadoModule.apply()"></div>
          <div><label style="${labelStyle}">Hora hasta</label><input type="time" id="vc-h-hasta" class="form-control" oninput="AppVentasConsolidadoModule.apply()"></div>
          <div style="flex:1;min-width:160px"><label style="${labelStyle}">Cliente (nombre/teléfono)</label><input type="text" id="vc-cliente" class="form-control" placeholder="Buscar cliente…" oninput="AppVentasConsolidadoModule.apply()"></div>
          <div style="flex:1;min-width:160px"><label style="${labelStyle}">Artículo (nombre/ref/id)</label><input type="text" id="vc-articulo" class="form-control" placeholder="Buscar artículo…" oninput="AppVentasConsolidadoModule.apply()"></div>
          <div><label style="${labelStyle}">Canal</label><select id="vc-canal" class="form-control" onchange="AppVentasConsolidadoModule.apply()">${optHtml(canales)}</select></div>
          <div><label style="${labelStyle}">Talla</label><select id="vc-talla" class="form-control" onchange="AppVentasConsolidadoModule.apply()">${optHtml(tallas)}</select></div>
          <div><label style="${labelStyle}">Proveedor</label><select id="vc-proveedor" class="form-control" onchange="AppVentasConsolidadoModule.apply()">${provOptHtml}</select></div>
          <div><label style="${labelStyle}">&nbsp;</label><label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;white-space:nowrap"><input type="checkbox" id="vc-incluir-anuladas" onchange="AppVentasConsolidadoModule.apply()"> Incluir anuladas</label></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary" onclick="AppVentasConsolidadoModule.clear()">Limpiar</button><button class="btn btn-secondary" id="vc-btn-recargar" onclick="AppVentasConsolidadoModule.recargar()">Recargar</button><button class="btn btn-secondary" id="vc-btn-generar" onclick="AppVentasConsolidadoModule.generarHistorico()" title="Crea líneas de reporte faltantes desde facturas. Idempotente; no toca caja, stock, ventas ni facturas.">Generar histórico</button><button class="btn btn-primary" onclick="AppVentasConsolidadoModule.exportCsv()">Exportar CSV</button></div>
        </div>
      </div>

      <div id="vc-kpis"></div>

      <div class="card">
        <div class="card-title">LÍNEAS DE VENTA (<span id="vc-count">0</span> en vista)</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Fecha</th><th>Hora</th><th>Factura</th><th>Cliente</th><th>Artículo</th><th>Ref</th><th>Talla</th>
              <th style="text-align:right">Cant</th><th style="text-align:right">P. Unit</th><th style="text-align:right">Subtotal</th><th>Canal</th><th>Fuente</th><th style="text-align:right">PDF</th>
            </tr></thead>
            <tbody id="vc-tbody"></tbody>
          </table>
        </div>
      </div>`;

    apply();
    bindPdfDelegation();
  }

  global.AppVentasConsolidadoModule = {
    renderVentasConsolidado,
    apply,
    clear,
    exportCsv,
    generarHistorico,
    recargar,
    openFacturaPdf,
  };
})(window);
