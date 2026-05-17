// Separados showroom: ventas POS con esSeparado — seguimiento de entrega en mostrador.
(function initSeparadosModule(global) {
  /** Ítems desde factura (mismo id que venta en POS) o fallback en v.items */
  function lineItemsForVenta(state, v) {
    const f = (state.facturas || []).find((x) => x.id === v.id);
    if (f && Array.isArray(f.items) && f.items.length) return f.items;
    if (v.items && Array.isArray(v.items)) return v.items;
    return [];
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Lista HTML con todos los ítems del separado (uno por línea). */
  function fmtLineItemsHtml(items) {
    if (!items.length) return '<span style="color:var(--text2)">—</span>';
    const lis = items
      .map((i) => {
        const name = escapeHtml(i.nombre || i.name || 'Ítem');
        const talla = i.talla ? ' · T:' + escapeHtml(i.talla) : '';
        const q = i.qty || i.cantidad || 1;
        return `<li style="margin:2px 0">${name}${talla} ×${q}</li>`;
      })
      .join('');
    return `<ul style="margin:0;padding-left:18px;font-size:11px;line-height:1.45;color:var(--text2);min-width:200px;max-width:360px">${lis}</ul>`;
  }

  function fmtEntregaCell(v, entregado) {
    const est = v.estadoEntrega || 'Pendiente';
    if (!entregado || !v.fechaHoraEntrega) {
      return `<span class="badge ${entregado ? 'badge-ok' : 'badge-warn'}">${est}</span>`;
    }
    let hora = '';
    try {
      hora = new Date(v.fechaHoraEntrega).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
    } catch (_) {
      hora = '';
    }
    return `<span class="badge badge-ok">Entregado</span>${hora ? `<div style="font-size:10px;color:var(--text2);margin-top:4px;white-space:normal;line-height:1.35">${hora}</div>` : ''}`;
  }

  /** Pendientes primero; luego por fecha descendente */
  function sortSeparados(arr) {
    return [...arr].sort((a, b) => {
      const pa = a.estadoEntrega === 'Entregado' ? 1 : 0;
      const pb = b.estadoEntrega === 'Entregado' ? 1 : 0;
      if (pa !== pb) return pa - pb;
      const cf = (b.fecha || '').localeCompare(a.fecha || '');
      if (cf !== 0) return cf;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }

  function canalBadge(v) {
    const c = v.canal || 'vitrina';
    if (c === 'local') return '<span class="badge badge-warn">🛵 Local</span>';
    if (c === 'inter') return '<span class="badge badge-inter">📦 Inter</span>';
    return '<span class="badge badge-vitrina">🏪 Vitrina</span>';
  }

  /** Comprobante en venta o en factura enlazada (mismo id). */
  function comprobanteForVenta(state, v) {
    const f = (state.facturas || []).find((x) => x.id === v.id);
    return String(v.comprobante || f?.comprobante || '').trim();
  }

  function fmtComprobanteCell(state, v) {
    const c = comprobanteForVenta(state, v);
    if (!c) return '<span style="color:var(--text2)">—</span>';
    return `<div style="max-width:280px;font-size:11px;line-height:1.35;color:var(--text2);word-break:break-word">${escapeHtml(c)}</div>`;
  }

  function renderSeparados(ctx) {
    const { state, formatDate, fmt } = ctx;
    const desde = document.getElementById('sep-desde')?.value || '';
    const hasta = document.getElementById('sep-hasta')?.value || '';
    const q = (document.getElementById('sep-search')?.value || '').toLowerCase();
    const estadoVista = document.getElementById('sep-estado')?.value || '';

    let separados = (state.ventas || []).filter((v) => !v.archived && v.esSeparado);
    if (desde) separados = separados.filter((v) => v.fecha >= desde);
    if (hasta) separados = separados.filter((v) => v.fecha <= hasta);
    if (q) {
      separados = separados.filter((v) => {
        const comp = comprobanteForVenta(state, v).toLowerCase();
        return (
          (v.cliente || '').toLowerCase().includes(q) ||
          comp.includes(q) ||
          (v.telefono || '').includes(q) ||
          (v.desc || '').toLowerCase().includes(q) ||
          (v.guia || '').toLowerCase().includes(q)
        );
      });
    }

    const pendientes = separados.filter((v) => v.estadoEntrega !== 'Entregado');
    const entregados = separados.filter((v) => v.estadoEntrega === 'Entregado');
    const sumPend = pendientes.reduce((a, v) => a + (parseFloat(v.valor) || 0), 0);
    const sumEntr = entregados.reduce((a, v) => a + (parseFloat(v.valor) || 0), 0);

    let lista = separados;
    if (estadoVista === 'pend') lista = lista.filter((v) => v.estadoEntrega !== 'Entregado');
    else if (estadoVista === 'entr') lista = lista.filter((v) => v.estadoEntrega === 'Entregado');
    lista = sortSeparados(lista);

    const rowsHtml =
      lista
        .map((v) => {
          const items = lineItemsForVenta(state, v);
          const itemsCell = fmtLineItemsHtml(items);
          const entregado = v.estadoEntrega === 'Entregado';
          return `<tr style="${entregado ? 'opacity:0.55' : ''}">
      <td>${formatDate(v.fecha)}</td>
      <td>${canalBadge(v)}</td>
      <td style="font-weight:700;color:var(--text2)">${v.desc || '—'}</td>
      <td style="font-weight:700">${v.cliente || 'MOSTRADOR'}</td>
      <td style="vertical-align:top">${fmtComprobanteCell(state, v)}</td>
      <td>${v.telefono || '—'}</td>
      <td style="vertical-align:top">${itemsCell}</td>
      <td style="color:var(--accent);font-weight:700">${fmt(v.valor)}</td>
      <td style="vertical-align:top;min-width:120px">${fmtEntregaCell(v, entregado)}</td>
      <td>${
        !entregado
          ? `<button class="btn btn-xs btn-primary" onclick="entregarSeparado('${v.id}')">✓ Entregar</button>`
          : '<span style="font-size:11px;color:var(--text2)">—</span>'
      }</td>
    </tr>`;
        })
        .join('') ||
      '<tr><td colspan="10" style="text-align:center;color:var(--text2);padding:24px">Sin separados</td></tr>';

    if (document.getElementById('sep-tbody')) {
      document.getElementById('sep-tbody').innerHTML = rowsHtml;
      const p = document.getElementById('sep-pend');
      if (p) p.textContent = pendientes.length;
      const e = document.getElementById('sep-entr');
      if (e) e.textContent = entregados.length;
      const sp = document.getElementById('sep-pend-sum');
      if (sp) sp.textContent = fmt(sumPend);
      const se = document.getElementById('sep-entr-sum');
      if (se) se.textContent = fmt(sumEntr);
      const btnL = document.getElementById('sep-limpiar');
      if (btnL) btnL.style.display = q || desde || hasta || estadoVista ? 'inline-flex' : 'none';
      return;
    }

    document.getElementById('separados-content').innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;min-width:180px;max-width:280px;margin:0"><span class="search-icon">🔍</span><input type="text" id="sep-search" placeholder="Cliente, comprobante, tel, ref, guía..." value="${q}" oninput="renderSeparados()"></div>
      <div>
        <label class="form-label" style="font-size:9px;color:var(--text2);display:block;margin-bottom:3px">Estado</label>
        <select class="form-control" id="sep-estado" style="width:130px" onchange="renderSeparados()">
          <option value="" ${estadoVista === '' ? 'selected' : ''}>Todos</option>
          <option value="pend" ${estadoVista === 'pend' ? 'selected' : ''}>Pendientes</option>
          <option value="entr" ${estadoVista === 'entr' ? 'selected' : ''}>Entregados</option>
        </select>
      </div>
      <input type="date" class="form-control" id="sep-desde" style="width:140px" value="${desde}" onchange="renderSeparados()">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="sep-hasta" style="width:140px" value="${hasta}" onchange="renderSeparados()">
      <button class="btn btn-xs btn-secondary" id="sep-limpiar" style="display:${q || desde || hasta || estadoVista ? 'inline-flex' : 'none'}" onclick="document.getElementById('sep-search').value='';document.getElementById('sep-desde').value='';document.getElementById('sep-hasta').value='';document.getElementById('sep-estado').value='';renderSeparados()">✕ Limpiar</button>
    </div>
    <div class="card" style="margin-bottom:14px;padding:12px 14px;font-size:12px;color:var(--text2)">
      <b>Qué es un separado:</b> venta POS con “Separado” marcado. El inventario y la venta ya quedaron en el POS. Esta pantalla es solo <b>seguimiento de recogida</b>: pulsa <b>Entregar</b> para marcar <code>estado_entrega = Entregado</code> en la base (no borra nada ni revierte stock).
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card" style="margin:0;text-align:center">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--yellow)" id="sep-pend">${pendientes.length}</div>
        <div style="font-size:11px;color:var(--text2)">⏳ Pendientes de entrega</div>
        <div style="font-size:12px;color:var(--accent);font-weight:700;margin-top:6px" id="sep-pend-sum">${fmt(sumPend)}</div>
      </div>
      <div class="card" style="margin:0;text-align:center">
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--green)" id="sep-entr">${entregados.length}</div>
        <div style="font-size:11px;color:var(--text2)">✅ Entregados <span style="opacity:.85">(en el rango / búsqueda)</span></div>
        <div style="font-size:12px;color:var(--accent);font-weight:700;margin-top:6px" id="sep-entr-sum">${fmt(sumEntr)}</div>
      </div>
    </div>
    <div class="card"><div class="card-title">🛍️ SEPARADOS (${lista.length} en tabla · ${separados.length} con filtros fecha/texto)</div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Canal</th><th>Ref</th><th>Cliente</th><th>Comprobante</th><th>Teléfono</th><th>Artículos</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead><tbody id="sep-tbody">${rowsHtml}</tbody></table></div></div>`;
  }

  async function entregarSeparado(ctx) {
    const { state, id, confirm, saveRecord, renderSeparados, notify } = ctx;
    if (!confirm('¿El cliente ya recogió el pedido? Se marcará como Entregado y se sincronizará con la base de datos.')) return;
    const v = state.ventas.find((x) => x.id === id);
    if (!v) return;
    v.estadoEntrega = 'Entregado';
    v.fechaHoraEntrega = new Date().toISOString();
    let ok = false;
    try {
      ok = (await saveRecord('ventas', v.id, v)) !== false;
    } catch (e) {
      ok = false;
    }
    renderSeparados();
    if (ok) notify('success', '📦', 'Entregado', `${v.cliente || 'Cliente'} — ${v.desc || id}`, { duration: 3000 });
    else notify('warning', '📡', 'Sin sincronizar', 'Estado actualizado en pantalla; revisa conexión o permisos en Supabase.', { duration: 5000 });
  }

  global.AppSeparadosModule = { renderSeparados, entregarSeparado };
})(window);
