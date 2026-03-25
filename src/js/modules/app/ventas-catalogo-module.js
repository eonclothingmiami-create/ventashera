// Ventas desde catálogo mayorista (Wompi / Addi): ítems, envío y estado de pago.
(function initVentasCatalogoModule(global) {
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTs(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return '—';
    }
  }

  const LABEL_ESTADO = {
    pendiente: 'Pendiente',
    pago_exitoso: 'Pago exitoso',
    cancelada: 'Cancelada',
  };

  function badgeClass(estado) {
    if (estado === 'pago_exitoso') return 'badge-ok';
    if (estado === 'cancelada') return 'badge-pend';
    return 'badge-warn';
  }

  function renderVentasCatalogo(ctx) {
    const { state, fmt, openModal, saveRecord, notify, renderVentasCatalogo: rerender } = ctx;
    const el = document.getElementById('vcatalog-content');
    if (!el) return;

    const q = (document.getElementById('vcatalog-search')?.value || '').toLowerCase().trim();
    const filtroEstado = document.getElementById('vcatalog-estado')?.value || '';

    let rows = [...(state.ventasCatalogo || [])].sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });

    if (filtroEstado) rows = rows.filter((r) => r.estadoPago === filtroEstado);
    if (q) {
      rows = rows.filter((r) => {
        const blob = [
          r.reference,
          r.clienteNombre,
          r.clienteEmail,
          r.clienteTelefono,
          r.proveedorRef,
        ]
          .join(' ')
          .toLowerCase();
        return blob.includes(q);
      });
    }

    const tbody = rows
      .map((r) => {
        const est = r.estadoPago || 'pendiente';
        const lbl = LABEL_ESTADO[est] || est;
        const canal = r.canalPago ? String(r.canalPago).toUpperCase() : '—';
        return `<tr>
      <td style="font-size:11px;color:var(--text2);white-space:nowrap">${fmtTs(r.createdAt)}</td>
      <td style="font-weight:700;color:var(--text2)">${esc(r.reference)}</td>
      <td>${esc(r.clienteNombre || '—')}</td>
      <td style="font-size:12px">${esc(r.clienteTelefono || '—')}</td>
      <td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.clienteEmail || '')}">${esc(r.clienteEmail || '—')}</td>
      <td style="color:var(--accent);font-weight:700">${fmt(r.amountCop || 0)}</td>
      <td style="font-size:11px">${esc(canal)}</td>
      <td><span class="badge ${badgeClass(est)}">${esc(lbl)}</span></td>
      <td>
        <div class="btn-group">
          <button type="button" class="btn btn-xs btn-secondary" data-vcat-detail="${r.id}">Ver</button>
          <select class="form-control" style="max-width:130px;padding:4px 8px;font-size:11px;display:inline-block;width:auto" data-vcat-estado="${r.id}">
            <option value="pendiente" ${est === 'pendiente' ? 'selected' : ''}>Pendiente</option>
            <option value="pago_exitoso" ${est === 'pago_exitoso' ? 'selected' : ''}>Pago exitoso</option>
            <option value="cancelada" ${est === 'cancelada' ? 'selected' : ''}>Cancelada</option>
          </select>
          <button type="button" class="btn btn-xs btn-primary" data-vcat-save="${r.id}">Guardar</button>
        </div>
      </td>
    </tr>`;
      })
      .join('');

    el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;min-width:200px;max-width:360px;margin:0">
        <span class="search-icon">🔍</span>
        <input type="text" id="vcatalog-search" class="form-control" placeholder="Ref, nombre, tel, email…" value="${esc(document.getElementById('vcatalog-search')?.value || '')}"
          oninput="renderVentasCatalogo()">
      </div>
      <div>
        <label class="form-label" style="font-size:9px;color:var(--text2);display:block;margin-bottom:3px">Estado</label>
        <select id="vcatalog-estado" class="form-control" style="width:160px" onchange="renderVentasCatalogo()">
          <option value="" ${filtroEstado === '' ? 'selected' : ''}>Todos</option>
          <option value="pendiente" ${filtroEstado === 'pendiente' ? 'selected' : ''}>Pendiente</option>
          <option value="pago_exitoso" ${filtroEstado === 'pago_exitoso' ? 'selected' : ''}>Pago exitoso</option>
          <option value="cancelada" ${filtroEstado === 'cancelada' ? 'selected' : ''}>Cancelada</option>
        </select>
      </div>
      <span style="font-size:12px;color:var(--text2)">${rows.length} pedido(s)</span>
    </div>
    <div class="card">
      <div class="card-title">Pedidos web (catálogo mayorista)</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 14px;line-height:1.45">
        Los pedidos se registran al iniciar pago en el sitio. El estado <b>Pago exitoso</b> o <b>Cancelada</b> puede actualizarse por webhook
        (<code>catalog-order-status</code>) o manualmente aquí.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th><th>Referencia</th><th>Cliente</th><th>Teléfono</th><th>Correo</th><th>Total</th><th>Pasarela</th><th>Estado</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length === 0
                ? '<tr><td colspan="9" style="text-align:center;color:var(--text2);padding:28px">' +
                  (state.ventasCatalogo?.length
                    ? 'Ningún pedido coincide con el filtro.'
                    : 'Sin pedidos de catálogo. Aplica la migración Supabase y despliega la función <code>catalog-order-create</code>.') +
                  '</td></tr>'
                : tbody
            }
          </tbody>
        </table>
      </div>
    </div>`;

    rows.forEach((r) => {
      const btnD = document.querySelector(`[data-vcat-detail="${r.id}"]`);
      if (btnD) {
        btnD.onclick = () => openDetailModal(r, { fmt, openModal });
      }
      const btnS = document.querySelector(`[data-vcat-save="${r.id}"]`);
      if (btnS) {
        btnS.onclick = async () => {
          const sel = document.querySelector(`[data-vcat-estado="${r.id}"]`);
          const nuevo = sel?.value || 'pendiente';
          const row = { ...r, estadoPago: nuevo };
          if (nuevo === 'pago_exitoso' && !row.pagadoAt) row.pagadoAt = new Date().toISOString();
          if (nuevo === 'cancelada') row.pagadoAt = null;
          const ok = await saveRecord('ventas_catalogo', r.id, row);
          if (ok) {
            const ix = state.ventasCatalogo.findIndex((x) => x.id === r.id);
            if (ix >= 0) state.ventasCatalogo[ix] = row;
            notify('success', '📦', 'Actualizado', r.reference, { duration: 2500 });
            rerender();
          } else {
            notify('warning', '📡', 'No guardado', 'Revisa conexión o permisos.', { duration: 4000 });
          }
        };
      }
    });
  }

  function openDetailModal(r, { fmt, openModal }) {
    const items = Array.isArray(r.items) ? r.items : [];
    const tot = r.totales && typeof r.totales === 'object' ? r.totales : {};
    const lines = items
      .map(
        (it) =>
          `<li style="margin:4px 0">${esc(it.name || it.nombre || '—')} · Ref ${esc(it.ref || '')} · ${esc(it.color || '')} / ${esc(it.size || it.talla || '')} · ${fmt(it.price || it.precio || 0)}</li>`,
      )
      .join('');
    openModal(
      `
      <div class="modal-title">Pedido ${esc(r.reference)}</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:12px">
        <div><b>Creado:</b> ${esc(fmtTs(r.createdAt))}</div>
        <div><b>Estado:</b> ${esc(LABEL_ESTADO[r.estadoPago] || r.estadoPago)}</div>
        <div><b>Pasarela:</b> ${esc(r.canalPago || '—')} ${r.proveedorRef ? ` · ID ref: ${esc(r.proveedorRef)}` : ''}</div>
        ${r.pagadoAt ? `<div><b>Pagado:</b> ${esc(fmtTs(r.pagadoAt))}</div>` : ''}
      </div>
      <div class="card-title" style="font-size:13px">Cliente y envío</div>
      <div style="font-size:12px;line-height:1.55;margin-bottom:14px">
        <div>${esc(r.clienteNombre || '')}</div>
        <div>Doc: ${esc(r.clienteDocumentoTipo || '')} ${esc(r.clienteDocumento || '')}</div>
        <div>Tel: ${esc(r.clienteTelefono || '')} · ${esc(r.clienteEmail || '')}</div>
        <div>${esc(r.envioDepartamento || '')} · ${esc(r.envioCiudad || '')}</div>
        <div>${esc(r.envioDireccion || '')}</div>
      </div>
      <div class="card-title" style="font-size:13px">Ítems</div>
      <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--text2)">${lines || '<li>—</li>'}</ul>
      <div style="margin-top:12px;font-family:Syne;font-weight:800;color:var(--accent)">Total: ${fmt(r.amountCop || 0)}</div>
      ${
        Object.keys(tot).length
          ? `<div style="margin-top:8px;font-size:11px;color:var(--text2)"><pre style="white-space:pre-wrap;margin:0">${esc(JSON.stringify(tot, null, 2))}</pre></div>`
          : ''
      }
    `,
      true,
    );
  }

  global.AppVentasCatalogoModule = { renderVentasCatalogo };
})(window);
