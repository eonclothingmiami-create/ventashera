// Ventas por canales: catálogo web (Wompi/Addi) + registro y seguimiento de otras plataformas integradas.
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

  /** Origen del pedido (columna origen_canal en BD). */
  const LABEL_ORIGEN = {
    catalogo_web: 'Catálogo web',
    mercadolibre: 'Mercado Libre',
    falabella: 'Falabella',
    meta_commerce: 'Meta (FB/IG)',
    google_merchant: 'Google Merchant',
    pinterest: 'Pinterest',
    dropi: 'Dropi',
    rappi: 'Rappi',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    otro: 'Otro',
  };

  const ORIGEN_OPTIONS = [
    ['catalogo_web', LABEL_ORIGEN.catalogo_web],
    ['mercadolibre', LABEL_ORIGEN.mercadolibre],
    ['falabella', LABEL_ORIGEN.falabella],
    ['meta_commerce', LABEL_ORIGEN.meta_commerce],
    ['google_merchant', LABEL_ORIGEN.google_merchant],
    ['pinterest', LABEL_ORIGEN.pinterest],
    ['dropi', LABEL_ORIGEN.dropi],
    ['rappi', LABEL_ORIGEN.rappi],
    ['instagram', LABEL_ORIGEN.instagram],
    ['tiktok', LABEL_ORIGEN.tiktok],
    ['otro', LABEL_ORIGEN.otro],
  ];

  function origenLabel(r) {
    const o = r.origenCanal || 'catalogo_web';
    return LABEL_ORIGEN[o] || o;
  }

  /**
   * Despacho “revisar canal” solo para integraciones (ML, Falabella, registro manual, etc.).
   * Pedidos del catálogo web (Wompi/Addi) siguen el flujo que ya tenías; aquí mostramos —.
   */
  function necesitaDespachoCanalIntegrado(r) {
    const o = r.origenCanal || 'catalogo_web';
    const tm = r.trackingMeta && typeof r.trackingMeta === 'object' ? r.trackingMeta : {};
    if (o !== 'catalogo_web') return true;
    if (tm.manualRegistro) return true;
    return false;
  }

  /** Pago exitoso en canal integrado y aún no se marcó el despacho como gestionado. */
  function despachoUIFila(r) {
    const est = r.estadoPago || '';
    const tm = r.trackingMeta && typeof r.trackingMeta === 'object' ? r.trackingMeta : {};
    if (est !== 'pago_exitoso') {
      return '<span style="font-size:10px;color:var(--text2)">—</span>';
    }
    if (!necesitaDespachoCanalIntegrado(r)) {
      return '<span style="font-size:10px;color:var(--text2)" title="Catálogo web (Wompi/Addi): usa tu flujo habitual de envío.">—</span>';
    }
    if (tm.despacho_revisado_at) {
      return '<span class="badge badge-ok" style="font-size:9px" title="Despacho revisado / gestionado">✓ Envío OK</span>';
    }
    return `<div style="display:flex;flex-direction:column;gap:4px;max-width:150px">
      <span class="badge badge-warn" style="font-size:9px;white-space:normal;line-height:1.25;text-align:left" title="Prepara el envío; si vendiste por ML, Falabella u otro canal, ábrelo para etiqueta y estado.">🚚 Revisar canal / envío</span>
      <button type="button" class="btn btn-xs btn-secondary" data-vcat-despacho-ok="${r.id}" style="font-size:9px;padding:2px 6px;align-self:flex-start">Marcar envío OK</button>
    </div>`;
  }

  function badgeClass(estado) {
    if (estado === 'pago_exitoso') return 'badge-ok';
    if (estado === 'cancelada') return 'badge-pend';
    return 'badge-warn';
  }

  function itemsSearchBlob(r) {
    const items = Array.isArray(r.items) ? r.items : [];
    return items
      .map((it) =>
        [it.name, it.nombre, it.ref, it.productId, it.color, it.size, it.talla].filter(Boolean).join(' '),
      )
      .join(' ');
  }

  function summaryItemsCell(r) {
    const items = Array.isArray(r.items) ? r.items : [];
    const n = items.length;
    if (n === 0) {
      return '<span style="color:var(--text2);font-size:11px">—</span>';
    }
    const refs = items.map((it) => String(it.ref || '').trim()).filter(Boolean);
    const uniq = [...new Set(refs)];
    const preview = uniq.slice(0, 4).join(', ');
    const suffix = uniq.length > 4 || n > uniq.length ? '…' : '';
    const title = items
      .map((it) => `${it.name || it.nombre || '—'} (${it.ref || '—'})`)
      .join(' · ');
    return `<span style="font-size:11px;line-height:1.35;color:var(--text2)" title="${esc(title)}"><b style="color:var(--accent)">${n}</b> · ${esc(preview)}${suffix}</span>`;
  }

  function openRegistrarExternoModal(ctx) {
    const { saveRecord, notify, renderVentasCatalogo: rerender, state, nextId, openModal } = ctx;
    const opts = ORIGEN_OPTIONS.map(
      ([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`,
    ).join('');
    openModal(
      `
      <div class="modal-title">Registrar venta / pedido externo</div>
      <p style="font-size:12px;color:var(--text2);line-height:1.45;margin-bottom:12px">
        Para <b>Mercado Libre</b>, <b>Falabella</b> y el resto de canales: registra aquí el pedido para tenerlo en el mismo listado.
        Referencia única (ej. <code>ML-2000001234567</code>). Para <b>Venta POS</b> desde este módulo, los ítems deben incluir <code>ref</code> que exista en el ERP y opcionalmente <code>productId</code> (UUID).
      </p>
      <div class="form-group"><label class="form-label">Referencia única *</label>
        <input type="text" id="vc-reg-ref" class="form-control" placeholder="ML-… o FAL-…" maxlength="120"></div>
      <div class="form-group"><label class="form-label">Origen *</label>
        <select id="vc-reg-origen" class="form-control">${opts}</select></div>
      <div class="form-group"><label class="form-label">ID pedido en la plataforma</label>
        <input type="text" id="vc-reg-ext" class="form-control" placeholder="Order id en ML, Falabella, etc."></div>
      <div class="form-group"><label class="form-label">Pasarela / medio (texto libre)</label>
        <input type="text" id="vc-reg-canal" class="form-control" placeholder="mercadolibre, wompi, contraentrega…"></div>
      <div class="form-row-3" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div class="form-group"><label class="form-label">Total (COP) *</label>
          <input type="number" id="vc-reg-monto" class="form-control" min="0" step="1" value="0"></div>
        <div class="form-group"><label class="form-label">Estado *</label>
          <select id="vc-reg-estado" class="form-control">
            <option value="pendiente">Pendiente</option>
            <option value="pago_exitoso">Pago exitoso</option>
            <option value="cancelada">Cancelada</option>
          </select></div>
      </div>
      <div class="form-group"><label class="form-label">Cliente</label>
        <input type="text" id="vc-reg-nombre" class="form-control" placeholder="Nombre"></div>
      <div class="form-row-3" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group"><label class="form-label">Teléfono</label>
          <input type="text" id="vc-reg-tel" class="form-control"></div>
        <div class="form-group"><label class="form-label">Correo</label>
          <input type="text" id="vc-reg-email" class="form-control"></div>
      </div>
      <div class="form-group"><label class="form-label">Ítems (JSON)</label>
        <textarea id="vc-reg-items" class="form-control" rows="5" style="font-family:DM Mono,monospace;font-size:11px"
          placeholder='[{"name":"Vestido","ref":"ABC1","qty":1,"price":99000}]'></textarea></div>
      <div class="form-group"><label class="form-label">Nota interna (se guarda en tracking)</label>
        <textarea id="vc-reg-nota" class="form-control" rows="2" placeholder="Comisión, envío, link al panel…"></textarea></div>
      <button type="button" class="btn btn-primary" id="vc-reg-submit" style="width:100%;margin-top:8px">Guardar registro</button>
    `,
      true,
    );
    setTimeout(() => {
      const btn = document.getElementById('vc-reg-submit');
      if (!btn) return;
      btn.onclick = async () => {
        const ref = (document.getElementById('vc-reg-ref')?.value || '').trim();
        if (!ref) {
          notify('warning', '📦', 'Referencia', 'Indica una referencia única.', { duration: 4000 });
          return;
        }
        if ((state.ventasCatalogo || []).some((x) => String(x.reference).toLowerCase() === ref.toLowerCase())) {
          notify('warning', '📦', 'Duplicado', 'Ya existe un pedido con esa referencia.', { duration: 5000 });
          return;
        }
        let itemsParsed = [];
        const rawItems = (document.getElementById('vc-reg-items')?.value || '').trim();
        if (rawItems) {
          try {
            const p = JSON.parse(rawItems);
            itemsParsed = Array.isArray(p) ? p : [];
          } catch (e) {
            notify('danger', '📦', 'JSON', 'Ítems: JSON inválido. ' + (e.message || ''), { duration: 6000 });
            return;
          }
        }
        const est = document.getElementById('vc-reg-estado')?.value || 'pendiente';
        const monto = parseFloat(document.getElementById('vc-reg-monto')?.value) || 0;
        if (monto < 0) {
          notify('warning', '📦', 'Monto', 'Total inválido.', { duration: 4000 });
          return;
        }
        const nota = (document.getElementById('vc-reg-nota')?.value || '').trim();
        const origen = document.getElementById('vc-reg-origen')?.value || 'otro';
        const trackingMeta = {
          manualRegistro: true,
          pendiente_revisar_despacho: true,
          alerta_despacho:
            'Registro manual: revisa la plataforma de venta (ML, Falabella, etc.) para etiqueta y seguimiento, y prepara el envío con los datos del cliente.',
        };
        if (nota) trackingMeta.nota = nota;

        const nid = typeof nextId === 'function' ? nextId() : null;
        if (!nid) {
          notify('danger', '📦', 'ID', 'No se pudo generar id. Recarga la página.', { duration: 5000 });
          return;
        }

        const row = {
          id: nid,
          reference: ref,
          estadoPago: est,
          canalPago: (document.getElementById('vc-reg-canal')?.value || '').trim() || null,
          catalogType: null,
          origenCanal: origen,
          externalOrderId: (document.getElementById('vc-reg-ext')?.value || '').trim() || '',
          trackingMeta,
          clienteNombre: (document.getElementById('vc-reg-nombre')?.value || '').trim(),
          clienteEmail: (document.getElementById('vc-reg-email')?.value || '').trim(),
          clienteTelefono: (document.getElementById('vc-reg-tel')?.value || '').trim(),
          clienteDocumentoTipo: 'CC',
          clienteDocumento: '',
          envioDepartamento: '',
          envioCiudad: '',
          envioDireccion: '',
          items: itemsParsed,
          totales: {},
          amountCop: monto,
          proveedorRef: null,
          posFacturaId: null,
          pagadoAt: est === 'pago_exitoso' ? new Date().toISOString() : null,
          createdAt: new Date().toISOString(),
        };

        const ok = await saveRecord('ventas_catalogo', nid, row);
        if (ok) {
          state.ventasCatalogo = state.ventasCatalogo || [];
          state.ventasCatalogo.push(row);
          global.document.getElementById('modal-overlay')?.classList.remove('active');
          notify('success', '📦', 'Registrado', ref, { duration: 3500 });
          rerender();
        } else {
          notify('warning', '📡', 'No guardado', 'Revisa conexión, permisos INSERT en ventas_catalogo o migración aplicada.', {
            duration: 7000,
          });
        }
      };
    }, 0);
  }

  function renderVentasCatalogo(ctx) {
    const { state, fmt, openModal, saveRecord, notify, renderVentasCatalogo: rerender, nextId } = ctx;
    const el = document.getElementById('vcatalog-content');
    if (!el) return;

    const q = (document.getElementById('vcatalog-search')?.value || '').toLowerCase().trim();
    const filtroEstado = document.getElementById('vcatalog-estado')?.value || '';
    const filtroOrigen = document.getElementById('vcatalog-origen')?.value || '';

    let rows = [...(state.ventasCatalogo || [])].sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });

    if (filtroEstado) rows = rows.filter((r) => r.estadoPago === filtroEstado);
    if (filtroOrigen) rows = rows.filter((r) => (r.origenCanal || 'catalogo_web') === filtroOrigen);
    if (q) {
      rows = rows.filter((r) => {
        const tm = r.trackingMeta && typeof r.trackingMeta === 'object' ? JSON.stringify(r.trackingMeta) : '';
        const blob = [
          r.reference,
          r.clienteNombre,
          r.clienteEmail,
          r.clienteTelefono,
          r.proveedorRef,
          r.externalOrderId,
          r.origenCanal,
          origenLabel(r),
          itemsSearchBlob(r),
          tm,
        ]
          .join(' ')
          .toLowerCase();
        return blob.includes(q);
      });
    }

    const origenFilterOpts = [
      ['', 'Todos los orígenes'],
      ...ORIGEN_OPTIONS,
    ]
      .map(
        ([v, l]) =>
          `<option value="${esc(v)}" ${filtroOrigen === v ? 'selected' : ''}>${esc(l)}</option>`,
      )
      .join('');

    const tbody = rows
      .map((r) => {
        const est = r.estadoPago || 'pendiente';
        const lbl = LABEL_ESTADO[est] || est;
        const canal = r.canalPago ? String(r.canalPago).toUpperCase() : '—';
        const itemsArr = Array.isArray(r.items) ? r.items : [];
        const canToPos = est === 'pago_exitoso' && !r.posFacturaId && itemsArr.length > 0;
        const posExtra = r.posFacturaId
          ? `<span class="badge badge-ok" style="font-size:9px;vertical-align:middle" title="Ya generada venta POS">POS ✓</span>`
          : canToPos
            ? `<button type="button" class="btn btn-xs btn-primary" data-vcat-topos="${r.id}" title="Factura POS, stock y caja (como cobrar en mostrador)">🛒 Venta POS</button>`
            : '';
        const oshort = origenLabel(r);
        const ext = r.externalOrderId ? `<span style="font-size:9px;color:var(--text2)" title="ID externo">· ${esc(String(r.externalOrderId).slice(0, 14))}${String(r.externalOrderId).length > 14 ? '…' : ''}</span>` : '';
        return `<tr>
      <td style="font-size:11px;color:var(--text2);white-space:nowrap">${fmtTs(r.createdAt)}</td>
      <td style="font-weight:700;color:var(--text2)">${esc(r.reference)}</td>
      <td style="font-size:11px;max-width:120px"><span class="badge" style="font-size:9px">${esc(oshort)}</span>${ext}</td>
      <td>${esc(r.clienteNombre || '—')}</td>
      <td style="max-width:200px">${summaryItemsCell(r)}</td>
      <td style="font-size:12px">${esc(r.clienteTelefono || '—')}</td>
      <td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.clienteEmail || '')}">${esc(r.clienteEmail || '—')}</td>
      <td style="color:var(--accent);font-weight:700">${fmt(r.amountCop || 0)}</td>
      <td style="font-size:11px">${esc(canal)}</td>
      <td><span class="badge ${badgeClass(est)}">${esc(lbl)}</span></td>
      <td style="vertical-align:top">${despachoUIFila(r)}</td>
      <td>
        <div class="btn-group" style="flex-wrap:wrap;align-items:center;gap:4px">
          ${posExtra}
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
        <input type="text" id="vcatalog-search" class="form-control" placeholder="Ref., cliente, ID externo, origen…" value="${esc(document.getElementById('vcatalog-search')?.value || '')}"
          oninput="renderVentasCatalogo()">
      </div>
      <div>
        <label class="form-label" style="font-size:9px;color:var(--text2);display:block;margin-bottom:3px">Origen</label>
        <select id="vcatalog-origen" class="form-control" style="width:200px" onchange="renderVentasCatalogo()">
          ${origenFilterOpts}
        </select>
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
      <button type="button" class="btn btn-secondary" id="vcatalog-btn-reg" style="margin-bottom:2px">＋ Registrar venta externa</button>
      <span style="font-size:12px;color:var(--text2)">${rows.length} pedido(s)</span>
    </div>
    <div class="card">
      <div class="card-title">Ventas por canal (catálogo + integraciones)</div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 14px;line-height:1.45">
        Listado unificado: pedidos del <b>catálogo web</b> (Wompi/Addi) y ventas de <b>otros canales</b> que registres aquí.
        La columna <b>Despacho</b> (revisar marketplace / preparar envío) aplica a <b>Mercado Libre</b>, <b>Falabella</b>, etc.;
        los pedidos solo catálogo web no la usan — su pasarela ya estaba bien integrada.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th><th>Referencia</th><th>Origen</th><th>Cliente</th><th>Productos</th><th>Teléfono</th><th>Correo</th><th>Total</th><th>Pasarela</th><th>Estado</th><th>Despacho</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length === 0
                ? '<tr><td colspan="12" style="text-align:center;color:var(--text2);padding:28px">' +
                  (state.ventasCatalogo?.length
                    ? 'Ningún pedido coincide con el filtro.'
                    : 'Sin pedidos. Aplica la migración Supabase y despliega <code>catalog-order-create</code> si usas catálogo web.') +
                  '</td></tr>'
                : tbody
            }
          </tbody>
        </table>
      </div>
    </div>`;

    const btnReg = document.getElementById('vcatalog-btn-reg');
    if (btnReg) {
      btnReg.onclick = () =>
        openRegistrarExternoModal({ saveRecord, notify, renderVentasCatalogo: rerender, state, nextId, openModal });
    }

    rows.forEach((r) => {
      const btnPos = document.querySelector(`[data-vcat-topos="${r.id}"]`);
      if (btnPos && typeof global.convertirVentaCatalogoAPos === 'function') {
        btnPos.onclick = () => global.convertirVentaCatalogoAPos(r.id);
      }
      const btnD = document.querySelector(`[data-vcat-detail="${r.id}"]`);
      if (btnD) {
        btnD.onclick = () => openDetailModal(r, { fmt, openModal });
      }
      const btnDesp = document.querySelector(`[data-vcat-despacho-ok="${r.id}"]`);
      if (btnDesp) {
        btnDesp.onclick = async () => {
          const prevTm = r.trackingMeta && typeof r.trackingMeta === 'object' ? { ...r.trackingMeta } : {};
          const row = {
            ...r,
            trackingMeta: {
              ...prevTm,
              despacho_revisado_at: new Date().toISOString(),
              pendiente_revisar_despacho: false,
            },
          };
          const ok = await saveRecord('ventas_catalogo', r.id, row);
          if (ok) {
            const ix = state.ventasCatalogo.findIndex((x) => x.id === r.id);
            if (ix >= 0) state.ventasCatalogo[ix] = row;
            notify('success', '🚚', 'Despacho', 'Marcado como gestionado.', { duration: 2500 });
            rerender();
          } else {
            notify('warning', '📡', 'No guardado', 'Revisa conexión o permisos.', { duration: 4000 });
          }
        };
      }
      const btnS = document.querySelector(`[data-vcat-save="${r.id}"]`);
      if (btnS) {
        btnS.onclick = async () => {
          const sel = document.querySelector(`[data-vcat-estado="${r.id}"]`);
          const nuevo = sel?.value || 'pendiente';
          const row = { ...r, estadoPago: nuevo };
          if (nuevo === 'pago_exitoso' && !row.pagadoAt) row.pagadoAt = new Date().toISOString();
          if (nuevo === 'cancelada') row.pagadoAt = null;
          if (nuevo === 'pago_exitoso' && necesitaDespachoCanalIntegrado(row)) {
            const tm = row.trackingMeta && typeof row.trackingMeta === 'object' ? { ...row.trackingMeta } : {};
            if (!tm.despacho_revisado_at) {
              row.trackingMeta = {
                ...tm,
                pendiente_revisar_despacho: true,
                alerta_despacho:
                  tm.alerta_despacho ||
                  'Pago registrado. Prepara el envío y revisa el canal de venta (marketplace) si aplica para etiqueta y estado.',
              };
            }
          }
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
    const est = r.estadoPago || '';
    const canToPos = est === 'pago_exitoso' && !r.posFacturaId && items.length > 0;
    const tot = r.totales && typeof r.totales === 'object' ? r.totales : {};
    const tm = r.trackingMeta && typeof r.trackingMeta === 'object' ? r.trackingMeta : {};
    const lines = items
      .map((it) => {
        const pid = it.productId ? ` · <span style="color:var(--text2)">ID ${esc(it.productId)}</span>` : '';
        const q = Number(it.qty) > 1 ? ` ×${esc(String(it.qty))}` : '';
        return `<li style="margin:4px 0">${esc(it.name || it.nombre || '—')} · Ref ${esc(it.ref || '')}${pid}${q} · ${esc(it.color || '')} / ${esc(it.size || it.talla || '')} · ${fmt(it.price || it.precio || 0)}</li>`;
      })
      .join('');
    openModal(
      `
      <div class="modal-title">Pedido ${esc(r.reference)}</div>
      ${
        est === 'pago_exitoso' &&
          necesitaDespachoCanalIntegrado(r) &&
          !tm.despacho_revisado_at &&
          (tm.alerta_despacho || tm.pendiente_revisar_despacho)
          ? `<div style="margin-bottom:14px;padding:12px 14px;border-radius:8px;background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.45);font-size:12px;line-height:1.5;color:var(--text)">
        <b style="display:block;margin-bottom:6px">🚚 Despacho — revisar canal</b>
        ${esc(
          typeof tm.alerta_despacho === 'string' && tm.alerta_despacho.trim()
            ? tm.alerta_despacho
            : 'Prepara el envío con los datos del cliente. Si el pedido se gestiona en otra plataforma (ML, Falabella, etc.), ábrela para etiqueta y estado.',
        )}
      </div>`
          : ''
      }
      <div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:12px">
        <div><b>Creado:</b> ${esc(fmtTs(r.createdAt))}</div>
        <div><b>Origen:</b> ${esc(origenLabel(r))}${r.externalOrderId ? ` · <b>ID externo:</b> ${esc(r.externalOrderId)}` : ''}</div>
        <div><b>Estado:</b> ${esc(LABEL_ESTADO[r.estadoPago] || r.estadoPago)}</div>
        <div><b>Pasarela / medio:</b> ${esc(r.canalPago || '—')} ${r.proveedorRef ? ` · ID ref pago: ${esc(r.proveedorRef)}` : ''}</div>
        ${r.pagadoAt ? `<div><b>Pagado:</b> ${esc(fmtTs(r.pagadoAt))}</div>` : ''}
        ${r.posFacturaId ? `<div style="margin-top:8px;font-size:11px"><b>Venta POS:</b> factura <code>${esc(r.posFacturaId)}</code></div>` : ''}
        ${
          Object.keys(tm).length
            ? `<div style="margin-top:10px;font-size:11px"><b>Tracking:</b><pre style="white-space:pre-wrap;margin:6px 0 0;font-size:10px;color:var(--text2)">${esc(JSON.stringify(tm, null, 2))}</pre></div>`
            : ''
        }
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
      ${
        canToPos
          ? `<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button type="button" class="btn btn-primary" id="vcatalog-modal-topos">🛒 Transformar a venta POS</button>
        <span style="font-size:11px;color:var(--text2)">Factura POS, descuento de stock y caja (si aplica).</span>
      </div>`
          : ''
      }
    `,
      true,
    );
    if (canToPos) {
      setTimeout(() => {
        const btn = document.getElementById('vcatalog-modal-topos');
        if (!btn || typeof global.convertirVentaCatalogoAPos !== 'function') return;
        btn.onclick = () => {
          document.getElementById('modal-overlay')?.classList.remove('active');
          global.convertirVentaCatalogoAPos(r.id);
        };
      }, 0);
    }
  }

  global.AppVentasCatalogoModule = { renderVentasCatalogo };
})(window);
