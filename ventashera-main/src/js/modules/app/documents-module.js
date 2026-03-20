// Documents module: generic list, modal items, save/delete/print handlers.
(function initDocumentsModule(global) {
  function getFilteredItems(state, collection, pageId) {
    const q = (document.getElementById(pageId + '-search')?.value || '').toLowerCase();
    const desde = document.getElementById(pageId + '-desde')?.value || '';
    const hasta = document.getElementById(pageId + '-hasta')?.value || '';
    let items = [...(state[collection] || [])].reverse();
    if (q) items = items.filter((d) => (d.numero || '').toLowerCase().includes(q) || (d.cliente || '').toLowerCase().includes(q));
    if (desde) items = items.filter((d) => d.fecha && d.fecha >= desde);
    if (hasta) items = items.filter((d) => d.fecha && d.fecha <= hasta);
    return { items, q, desde, hasta };
  }

  function renderDocumentList(ctx) {
    const { state, pageId, title, collection, tipo, formatDate, fmt } = ctx;
    const el = document.getElementById(pageId + '-content'); if (!el) return;
    const { items, q, desde, hasta } = getFilteredItems(state, collection, pageId);
    const total = [...(state[collection] || [])].length;
    const tbodyId = pageId + '-doc-tbody';
    const contId = pageId + '-doc-count';
    const origenBadge = (d) => {
      if (collection !== 'facturas') return '';
      const t = (d.tipo || 'pos').toLowerCase();
      if (t === 'pos') return '<span class="badge badge-inter" style="font-size:9px">POS</span>';
      if (t === 'manual') return '<span class="badge badge-warn" style="font-size:9px">Manual</span>';
      return `<span class="badge badge-vitrina" style="font-size:9px">${String(d.tipo || '—')}</span>`;
    };
    const colspanList = collection === 'facturas' ? 7 : 6;
    const rowsHtml = items.map((d) => `<tr>
    <td style="font-weight:700">${d.numero || '—'} ${origenBadge(d)}</td>
    ${collection === 'facturas' ? `<td style="font-size:11px;color:var(--text2)">${d.canal === 'local' ? '🛵' : d.canal === 'inter' ? '📦' : '🏪'} ${d.canal || 'vitrina'}</td>` : ''}
    <td>${formatDate(d.fecha)}</td>
    <td>${d.cliente || '—'}</td>
    <td style="color:var(--accent);font-weight:700">${fmt(d.total || 0)}</td>
    <td><span class="badge badge-${d.estado === 'pagada' || d.estado === 'aprobada' ? 'ok' : d.estado === 'anulada' ? 'pend' : 'warn'}">${d.estado || 'borrador'}</span></td>
    <td><div class="btn-group">
      <button class="btn btn-xs btn-secondary" onclick="viewDoc('${collection}','${d.id}')">👁</button>
      <button class="btn btn-xs btn-secondary" onclick="printDoc('${collection}','${d.id}')">🖨</button>
      <button class="btn btn-xs btn-danger" onclick="deleteDoc('${collection}','${d.id}')">✕</button>
    </div></td>
  </tr>`).join('') || `<tr><td colspan="${colspanList}" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>`;

    if (document.getElementById(tbodyId)) {
      document.getElementById(tbodyId).innerHTML = rowsHtml;
      const cnt = document.getElementById(contId);
      if (cnt) cnt.textContent = `${items.length} de ${total}`;
      const btnL = document.getElementById(pageId + '-doc-limpiar');
      if (btnL) btnL.style.display = (q || desde || hasta) ? 'inline-flex' : 'none';
      return;
    }

    el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <button class="btn btn-primary" onclick="openDocModal('${collection}','${tipo}')">+ ${title}</button>
      <div class="search-bar" style="flex:1;min-width:180px;max-width:300px;margin:0">
        <span class="search-icon">🔍</span>
        <input type="text" id="${pageId}-search" placeholder="Buscar # o cliente..." value="${q}"
          oninput="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')">
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <input type="date" id="${pageId}-desde" class="form-control" style="width:140px;padding:8px" value="${desde}"
          onchange="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')" title="Desde">
        <span style="color:var(--text2);font-size:11px;">hasta</span>
        <input type="date" id="${pageId}-hasta" class="form-control" style="width:140px;padding:8px" value="${hasta}"
          onchange="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')" title="Hasta">
        <button class="btn btn-xs btn-secondary" id="${pageId}-doc-limpiar" style="display:${(q || desde || hasta) ? 'inline-flex' : 'none'}"
          onclick="document.getElementById('${pageId}-search').value='';document.getElementById('${pageId}-desde').value='';document.getElementById('${pageId}-hasta').value='';renderDocumentList('${pageId}','${title}','${collection}','${tipo}')">✕ Limpiar</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:12px;padding:12px 14px;font-size:12px;color:var(--text2)">
      ${collection === 'facturas' ? '<b>Un solo registro:</b> las facturas <b>POS</b> (POS-…) y las que crees con <b>+ Factura</b> se guardan en la misma tabla (<code>invoices</code>). El POS descuenta inventario; una factura manual solo registra el documento (sin salida de stock automática).' : ''}
    </div>
    <div class="card">
      <div class="card-title">${title.toUpperCase()} — <span id="${contId}">${items.length} de ${total}</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th>${collection === 'facturas' ? '<th>Canal</th>' : ''}<th>Fecha</th><th>Cliente</th><th>Total</th><th>Estado</th><th></th></tr></thead>
        <tbody id="${tbodyId}">${rowsHtml}</tbody>
      </table></div>
    </div>`;
  }

  function openDocModal(ctx) {
    const { state, openModal, addDocItem, collection, tipo, today, fmt } = ctx;
    const tipos = { cotizacion: 'Cotización', orden: 'Orden de Venta', factura: 'Factura', nc: 'Nota Crédito', nd: 'Nota Débito', remision: 'Remisión', devolucion: 'Devolución', anticipo_cliente: 'Anticipo Cliente' };
    const label = tipos[tipo] || tipo;
    openModal(`
    <div class="modal-title">Nueva ${label}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">FECHA</label><input type="date" class="form-control" id="m-doc-fecha" value="${today()}"></div>
      <div class="form-group"><label class="form-label">CLIENTE</label><input class="form-control" id="m-doc-cliente" placeholder="Nombre del cliente"></div>
    </div>
    ${(tipo === 'nc' || tipo === 'nd' || tipo === 'devolucion') ? `<div class="form-group"><label class="form-label">FACTURA REFERENCIA</label><select class="form-control" id="m-doc-ref"><option value="">— Seleccionar —</option>${(state.facturas || []).map((f) => '<option value="' + f.id + '">' + f.numero + ' · ' + fmt(f.total) + '</option>').join('')}</select></div>` : ''}
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="m-doc-obs" rows="2"></textarea></div>
    <div class="card-title" style="margin-top:16px">ÍTEMS</div>
    <div id="m-doc-items"></div>
    <button class="btn btn-sm btn-secondary" style="margin-bottom:16px" onclick="addDocItem()">+ Agregar Ítem</button>
    <div style="text-align:right;font-family:Syne;font-size:18px;font-weight:800;color:var(--accent);margin-bottom:16px" id="m-doc-total">Total: $0</div>
    <button class="btn btn-primary" style="width:100%" onclick="saveDoc('${collection}','${tipo}')">Guardar ${label}</button>
  `, true);
    addDocItem();
  }

  function addDocItem(ctx) {
    const items = ctx.getDocItems();
    items.push({ articuloId: '', nombre: '', cantidad: 1, precio: 0 });
    ctx.setDocItems(items);
    ctx.renderDocItems();
  }

  function renderDocItems(ctx) {
    const { state, updateDocTotal } = ctx;
    const items = ctx.getDocItems();
    const el = document.getElementById('m-doc-items'); if (!el) return;
    el.innerHTML = items.map((item, i) => `
    <div style="display:grid;grid-template-columns:2fr 80px 120px 40px;gap:8px;margin-bottom:8px;align-items:end">
      <div class="form-group" style="margin:0"><label class="form-label">${i === 0 ? 'ARTÍCULO' : ''}</label><select class="form-control" onchange="docItemChanged(${i},this.value)" style="padding:8px"><option value="">— Seleccionar —</option>${(state.articulos || []).map((a) => '<option value="' + a.id + '" ' + (item.articuloId === a.id ? 'selected' : '') + '>' + a.nombre + '</option>').join('')}<option value="custom">✏️ Personalizado</option></select></div>
      <div class="form-group" style="margin:0"><label class="form-label">${i === 0 ? 'CANT' : ''}</label><input type="number" class="form-control" value="${item.cantidad}" min="1" onchange="docItemQty(${i},this.value)" style="padding:8px"></div>
      <div class="form-group" style="margin:0"><label class="form-label">${i === 0 ? 'PRECIO' : ''}</label><input type="number" class="form-control" value="${item.precio}" min="0" onchange="docItemPrice(${i},this.value)" style="padding:8px" id="doc-item-price-${i}"></div>
      <button class="btn btn-xs btn-danger" onclick="removeDocItem(${i})" style="margin-bottom:0;height:38px">✕</button>
    </div>`).join('');
    updateDocTotal();
  }

  function docItemChanged(ctx) {
    const { state, i, artId, renderDocItems } = ctx;
    const items = ctx.getDocItems();
    if (artId === 'custom') {
      items[i].articuloId = 'custom';
      items[i].nombre = 'Personalizado';
    } else {
      const art = (state.articulos || []).find((a) => a.id === artId);
      if (art) {
        items[i].articuloId = artId;
        items[i].nombre = art.nombre;
        items[i].precio = art.precioVenta;
      }
    }
    ctx.setDocItems(items);
    renderDocItems();
  }

  function docItemQty(ctx) {
    const items = ctx.getDocItems();
    items[ctx.i].cantidad = parseInt(ctx.val, 10) || 1;
    ctx.setDocItems(items);
    ctx.updateDocTotal();
  }

  function docItemPrice(ctx) {
    const items = ctx.getDocItems();
    items[ctx.i].precio = parseFloat(ctx.val) || 0;
    ctx.setDocItems(items);
    ctx.updateDocTotal();
  }

  function removeDocItem(ctx) {
    const items = ctx.getDocItems();
    items.splice(ctx.i, 1);
    ctx.setDocItems(items);
    ctx.renderDocItems();
  }

  function updateDocTotal(ctx) {
    const total = ctx.getDocItems().reduce((a, item) => a + (item.cantidad * item.precio), 0);
    const el = document.getElementById('m-doc-total'); if (el) el.textContent = 'Total: ' + ctx.fmt(total);
  }

  async function saveDoc(ctx) {
    const { state, collection, tipo, today, uid, dbId, getNextConsec, supabaseClient, saveConfig, saveRecord, closeModal, renderPage, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const fecha = document.getElementById('m-doc-fecha').value || today();
    const cliente = document.getElementById('m-doc-cliente').value.trim();
    const obs = document.getElementById('m-doc-obs').value.trim();
    const refId = document.getElementById('m-doc-ref')?.value || '';
    const items = ctx.getDocItems().filter((i) => i.precio > 0);
    if (items.length === 0) { notify('warning', '⚠️', 'Sin ítems', 'Agrega al menos un ítem.', { duration: 3000 }); return; }
    const subtotal = items.reduce((a, i) => a + (i.cantidad * i.precio), 0);
    const iva = subtotal * 0.19; const total = subtotal + iva;
    const prefixes = { cotizaciones: 'COT', ordenes_venta: 'OV', facturas: 'FAC', notas_credito: 'NC', notas_debito: 'ND', remisiones: 'REM', devoluciones: 'DEV', anticipos_clientes: 'ANT' };
    const consKeys = { cotizaciones: 'cotizacion', ordenes_venta: 'orden', facturas: 'factura', notas_credito: 'nc', notas_debito: 'nd', remisiones: 'remision', devoluciones: 'devolucion', anticipos_clientes: 'anticipo' };
    const numero = (prefixes[collection] || 'DOC') + '-' + getNextConsec(consKeys[collection] || 'factura');
    const itemsNormalized = items.map((i) => {
      const q = parseFloat(i.cantidad) || 1;
      const p = parseFloat(i.precio) || 0;
      return {
        articuloId: i.articuloId || '',
        nombre: i.nombre || '',
        talla: i.talla || '',
        cantidad: q,
        qty: q,
        precio: p
      };
    });
    const docTipo = collection === 'facturas' ? 'manual' : tipo;
    const docData = {
      id: nextId(),
      numero,
      fecha,
      cliente,
      items: itemsNormalized,
      subtotal,
      iva,
      flete: 0,
      total,
      estado: 'borrador',
      observaciones: obs,
      facturaRef: refId,
      tipo: docTipo,
      canal: collection === 'facturas' ? 'vitrina' : undefined,
      telefono: '',
      metodo: 'efectivo'
    };
    if (!state[collection]) state[collection] = [];
    state[collection].push(docData);
    ctx.setDocItems([]);
    try {
      if (collection === 'facturas' && typeof saveRecord === 'function') {
        await saveRecord('facturas', docData.id, docData);
      } else {
        await supabaseClient.from('legacy_docs').insert({ id: docData.id, tipo, numero: docData.numero, data: docData });
      }
      await saveConfig('consecutivos', state.consecutivos);
    } catch (e) { console.warn('saveDoc Supabase error:', e.message); }
    closeModal();
    renderPage(document.querySelector('.page.active')?.id.replace('page-', ''));
    notify('success', '✅', 'Documento creado', `${numero} · ${fmt(total)}`, { duration: 3000 });
  }

  function deleteDoc(ctx) {
    const { state, collection, id, confirm, renderPage } = ctx;
    if (collection === 'facturas') {
      alert('⚠️ ¡Alto ahí! Para mantener tu inventario y caja perfectamente cuadrados, las facturas solo se pueden anular desde la pestaña: SISTEMA > Historial.');
      return;
    }
    if (!confirm('¿Eliminar este documento?')) return;
    state[collection] = (state[collection] || []).filter((d) => d.id !== id);
    renderPage(document.querySelector('.page.active')?.id.replace('page-', ''));
  }

  function printDoc(ctx) {
    const doc = (ctx.state[ctx.collection] || []).find((d) => d.id === ctx.id); if (!doc) return;
    ctx.printReceipt(doc);
  }

  global.AppDocumentsModule = {
    renderDocumentList,
    openDocModal,
    addDocItem,
    renderDocItems,
    docItemChanged,
    docItemQty,
    docItemPrice,
    removeDocItem,
    updateDocTotal,
    saveDoc,
    deleteDoc,
    printDoc
  };
})(window);
