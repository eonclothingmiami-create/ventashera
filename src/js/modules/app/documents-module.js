// Documents module: generic list, modal items, save/delete/print handlers.
(function initDocumentsModule(global) {
  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function listDocArticulos(state) {
    return (state.articulos || []).filter((a) => {
      if (a == null) return false;
      if (a.activo === false || a.active === false) return false;
      if (a.visible === false) return false;
      return true;
    });
  }

  function docArtSearchHaystack(a) {
    return [
      a.nombre || a.name || '',
      a.codigo || a.code || '',
      a.scanAlias || '',
      a.ref || '',
      a.id || '',
    ]
      .join(' ')
      .toLowerCase();
  }

  function docArtDisplayName(item) {
    if (!item) return '';
    if (item.articuloId === 'custom') return item.nombre || '';
    return item.nombre || '';
  }

  function renderDocArtSuggestions(row, state, q) {
    const box = row.querySelector('.doc-art-sug');
    if (!box) return;
    const qq = String(q || '').trim().toLowerCase();
    if (qq.length < 1) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    const idx = Number(row.getAttribute('data-idx'));
    const hits = listDocArticulos(state)
      .filter((a) => docArtSearchHaystack(a).includes(qq))
      .slice(0, 80);
    if (hits.length === 0) {
      box.innerHTML = '<div class="inv-art-sug-empty">Sin coincidencias · podés usar Personalizado</div>';
      box.style.display = 'block';
      return;
    }
    box.innerHTML = hits
      .map((a) => {
        const id = escAttr(String(a.id));
        const lab = escHtml(a.nombre || a.name || '—');
        const code = a.codigo || a.code || a.scanAlias || '';
        const extra = code ? ` <span style="color:var(--text2);font-size:10px">${escHtml(String(code))}</span>` : '';
        return `<button type="button" class="inv-art-sug-item doc-art-sug-item" data-id="${id}">${lab}${extra}</button>`;
      })
      .join('');
    box.style.display = 'block';
    box.querySelectorAll('.doc-art-sug-item').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (typeof global.docItemChanged === 'function') {
          global.docItemChanged(idx, btn.getAttribute('data-id'));
        }
        box.style.display = 'none';
      });
    });
  }

  function initDocArtComboRow(row, state) {
    if (!row || row.dataset.docArtInit === '1') return;
    row.dataset.docArtInit = '1';
    const search = row.querySelector('.doc-art-search');
    const box = row.querySelector('.doc-art-sug');
    let tmr = null;
    if (!search) return;
    search.addEventListener('input', () => {
      clearTimeout(tmr);
      tmr = setTimeout(() => renderDocArtSuggestions(row, state, search.value), 80);
    });
    search.addEventListener('focus', () => {
      if (String(search.value || '').trim().length >= 1) {
        renderDocArtSuggestions(row, state, search.value);
      }
    });
    search.addEventListener('blur', () => {
      setTimeout(() => {
        if (box) box.style.display = 'none';
      }, 180);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && box) {
        box.style.display = 'none';
      }
    });
  }

  function initDocArtCombos(state) {
    const root = global.document?.getElementById('m-doc-items');
    if (!root) return;
    root.querySelectorAll('.doc-art-combo').forEach((row) => initDocArtComboRow(row, state));
  }

  function fmtComprobanteFacturaCell(comprobante) {
    const c = String(comprobante ?? '').trim();
    if (!c) return '<span style="color:var(--text2)">—</span>';
    return `<div style="font-size:11px;line-height:1.35;color:var(--text2);word-break:break-word;max-width:280px">${escHtml(c)}</div>`;
  }

  function normalizeCollectionList(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
  }

  // Consecutivo numérico del documento (POS-01486 -> 1486). Sirve de desempate estable.
  function docConsecutivo(d) {
    const m = String((d && d.numero) || '').match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : -1;
  }

  /**
   * Ordena de más reciente a más antiguo. Antes se usaba `.reverse()` sobre el arreglo
   * tal como venía de Supabase, cuyo orden es por `id` (UUID aleatorio): la lista de
   * Facturas mezclaba marzo, julio y junio en filas consecutivas.
   */
  function compareDocsMasRecientePrimero(a, b) {
    const fa = String((a && a.fecha) || '');
    const fb = String((b && b.fecha) || '');
    if (fa !== fb) return fb < fa ? -1 : 1;
    const ca = String((a && a.createdAt) || '');
    const cb = String((b && b.createdAt) || '');
    if (ca !== cb) return cb < ca ? -1 : 1;
    return docConsecutivo(b) - docConsecutivo(a);
  }

  function ymdHoy() {
    if (typeof global.today === 'function') return global.today();
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getFilteredItems(state, collection, pageId) {
    const searchEl = document.getElementById(pageId + '-search');
    const desdeEl = document.getElementById(pageId + '-desde');
    const hastaEl = document.getElementById(pageId + '-hasta');
    const q = (searchEl?.value || '').toLowerCase();
    let desde = desdeEl?.value || '';
    let hasta = hastaEl?.value || '';

    // Facturas: al abrir el módulo (primera pintura) filtra el día de hoy.
    // Sin esto, al listar 1.400+ filas el desorden histórico se siente como "caos".
    const firstPaint = !document.getElementById(pageId + '-doc-tbody');
    if (collection === 'facturas' && firstPaint && !q && !desde && !hasta) {
      const hoy = ymdHoy();
      desde = hoy;
      hasta = hoy;
    }

    const baseItems = collection === 'facturas'
      ? [
          ...normalizeCollectionList(state?.facturas),
          ...normalizeCollectionList(state?.prefacturas).map((d) => ({ ...d, _docCollection: 'prefacturas' }))
        ]
      : normalizeCollectionList(state?.[collection]);
    let items = [...baseItems].sort(compareDocsMasRecientePrimero);
    if (q) {
      items = items.filter((d) => {
        const base =
          (d.numero || '').toLowerCase().includes(q) || (d.cliente || '').toLowerCase().includes(q);
        if (collection === 'facturas') {
          return base || (d.comprobante || '').toLowerCase().includes(q);
        }
        return base;
      });
    }
    if (desde) items = items.filter((d) => d.fecha && d.fecha >= desde);
    if (hasta) items = items.filter((d) => d.fecha && d.fecha <= hasta);
    return { items, q, desde, hasta };
  }

  function renderDocumentList(ctx) {
    const { state, pageId, title, collection, tipo, formatDate, fmt } = ctx;
    const el = document.getElementById(pageId + '-content'); if (!el) return;
    const { items, q, desde, hasta } = getFilteredItems(state, collection, pageId);
    const total = collection === 'facturas'
      ? normalizeCollectionList(state?.facturas).length + normalizeCollectionList(state?.prefacturas).length
      : normalizeCollectionList(state?.[collection]).length;
    const tbodyId = pageId + '-doc-tbody';
    const contId = pageId + '-doc-count';
    const origenBadge = (d) => {
      if (collection === 'prefacturas' || d.documentType === 'proforma' || d.tipo === 'proforma') {
        return '<span class="badge badge-warn" style="font-size:9px">PROFORMA · NO FISCAL</span>';
      }
      if (collection !== 'facturas') return '';
      const t = (d.tipo || 'pos').toLowerCase();
      if (t === 'pos') return '<span class="badge badge-inter" style="font-size:9px">POS</span>';
      if (t === 'manual') return '<span class="badge badge-warn" style="font-size:9px">Manual</span>';
      return `<span class="badge badge-vitrina" style="font-size:9px">${String(d.tipo || '—')}</span>`;
    };
    const statusLabel = (s) => ({
      draft:'borrador',sent:'enviada',accepted:'aceptada',confirmed:'confirmada',
      issued:'emitida',converted:'convertida',cancelled:'cancelada',expired:'vencida'
    }[s] || s || 'borrador');
    const actionButtons = (d) => {
      if (d.documentType === 'quotation' && !['accepted','cancelled','expired'].includes(d.estado)) {
        return `<button type="button" class="btn btn-xs btn-primary" onclick="transitionCommercialDocument('${d.id}','quote_to_order')">→ Orden</button>`;
      }
      if (d.documentType === 'sales_order' && d.estado === 'confirmed') {
        return `<button type="button" class="btn btn-xs btn-primary" onclick="transitionCommercialDocument('${d.id}','order_to_proforma')">→ Proforma</button>`;
      }
      if (d.documentType === 'sales_order' && d.estado === 'draft') {
        return `<button type="button" class="btn btn-xs btn-primary" onclick="transitionCommercialDocument('${d.id}','confirm_order')">✓ Confirmar / reservar</button>`;
      }
      if (d.documentType === 'proforma' && d.estado === 'issued') {
        return `<button type="button" class="btn btn-xs btn-primary" onclick="cargarPrefacturaEnPOS('${d.id}')">→ Facturar</button>`;
      }
      return '';
    };
    const colspanList = collection === 'facturas' ? 8 : 6;
    const rowsHtml = items.map((d) => {
      const rowCollection = d._docCollection || collection;
      return `<tr>
    <td style="font-weight:700">${d.numero || '—'} ${origenBadge(d)}</td>
    ${collection === 'facturas' ? `<td style="font-size:11px;color:var(--text2)">${d.canal === 'local' ? '🛵' : d.canal === 'inter' ? '📦' : '🏪'} ${d.canal || 'vitrina'}</td>` : ''}
    <td>${formatDate(d.fecha)}</td>
    <td>${d.cliente || '—'}</td>
    ${collection === 'facturas' ? `<td style="vertical-align:top">${fmtComprobanteFacturaCell(d.comprobante)}</td>` : ''}
    <td style="color:var(--accent);font-weight:700">${fmt(d.total || 0)}</td>
    <td><span class="badge badge-${['pagada','aprobada','accepted','confirmed','issued','converted'].includes(d.estado) ? 'ok' : ['anulada','cancelled','expired'].includes(d.estado) ? 'pend' : 'warn'}">${statusLabel(d.estado)}</span></td>
    <td><div class="btn-group" style="flex-wrap:wrap;gap:4px">
      <button type="button" class="btn btn-xs btn-secondary" onclick="viewDoc('${rowCollection}','${d.id}')">👁</button>
      <button type="button" class="btn btn-xs btn-secondary" onclick="printDoc('${rowCollection}','${d.id}')">🖨</button>
      ${['cotizaciones','prefacturas','facturas'].includes(rowCollection) ? `<button type="button" class="btn btn-xs btn-secondary" title="Descargar PDF" onclick="downloadDocPdf('${rowCollection}','${d.id}')">📄 PDF</button>` : ''}
      ${actionButtons(d)}
      ${d.documentType ? `<button type="button" class="btn btn-xs btn-danger" onclick="transitionCommercialDocument('${d.id}','cancel')">✕</button>` : `<button type="button" class="btn btn-xs btn-danger" onclick="deleteDoc('${collection}','${d.id}')">✕</button>`}
    </div></td>
  </tr>`;
    }).join('') || `<tr><td colspan="${colspanList}" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>`;

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
        <input type="text" id="${pageId}-search" placeholder="${collection === 'facturas' ? 'Buscar #, cliente o comprobante...' : 'Buscar # o cliente...'}" value="${q}"
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
      ${collection === 'facturas' ? '<b>Orden:</b> más recientes primero (fecha y hora). Al abrir se muestra <b>solo el día de hoy</b>; usa las fechas o Limpiar para ver histórico. POS y + Factura viven en la misma tabla (<code>invoices</code>).' : ''}
      ${collection === 'cotizaciones' ? '<b>Cotización:</b> propuesta comercial. No reserva inventario, no mueve caja y no es una venta.' : ''}
      ${collection === 'ordenes_venta' ? '<b>Orden confirmada:</b> compromiso de compra. Reserva inventario, pero no descuenta existencias ni mueve caja.' : ''}
      ${collection === 'prefacturas' ? '<b>Prefactura / Proforma:</b> vista previa no fiscal. No descuenta inventario ni mueve caja; se factura desde el POS.' : ''}
    </div>
    <div class="card">
      <div class="card-title">${title.toUpperCase()} — <span id="${contId}">${items.length} de ${total}</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th>${collection === 'facturas' ? '<th>Canal</th>' : ''}<th>Fecha</th><th>Cliente</th>${collection === 'facturas' ? '<th>Comprobante</th>' : ''}<th>Total</th><th>Estado</th><th></th></tr></thead>
        <tbody id="${tbodyId}">${rowsHtml}</tbody>
      </table></div>
    </div>`;
  }

  function openDocModal(ctx) {
    const { state, openModal, addDocItem, collection, tipo, today, fmt } = ctx;
    const tipos = { cotizacion: 'Cotización', orden: 'Orden de Venta', prefactura: 'Prefactura / Proforma', factura: 'Factura', nc: 'Nota Crédito', nd: 'Nota Débito', remision: 'Remisión', devolucion: 'Devolución', anticipo_cliente: 'Anticipo Cliente' };
    const label = tipos[tipo] || tipo;
    const facturasRef = normalizeCollectionList(state?.facturas);
    const ivaToggleCollections = new Set(['cotizaciones', 'ordenes_venta', 'prefacturas', 'facturas']);
    const showIvaToggle = ivaToggleCollections.has(collection);
    const ivaCheckedByDefault = collection !== 'facturas';
    openModal(`
    <div class="modal-title">Nueva ${label}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">FECHA</label><input type="date" class="form-control" id="m-doc-fecha" value="${today()}"></div>
      <div class="form-group"><label class="form-label">CLIENTE</label><input class="form-control" id="m-doc-cliente" placeholder="Nombre del cliente"></div>
    </div>
    ${(tipo === 'nc' || tipo === 'nd' || tipo === 'devolucion') ? `<div class="form-group"><label class="form-label">FACTURA REFERENCIA</label><select class="form-control" id="m-doc-ref"><option value="">— Seleccionar —</option>${facturasRef.map((f) => '<option value="' + f.id + '">' + f.numero + ' · ' + fmt(f.total) + '</option>').join('')}</select></div>` : ''}
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="m-doc-obs" rows="2"></textarea></div>
    <div class="card-title" style="margin-top:16px">ÍTEMS</div>
    <div id="m-doc-items"></div>
    <button class="btn btn-sm btn-secondary" style="margin-bottom:16px" onclick="addDocItem()">+ Agregar Ítem</button>
    ${showIvaToggle ? `<div class="form-group" style="margin-bottom:12px"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px"><input type="checkbox" id="m-doc-apply-iva" onchange="updateDocTotal()" ${ivaCheckedByDefault ? 'checked' : ''}> IVA (19%)</label></div>` : ''}
    <div style="text-align:right;margin-bottom:16px" id="m-doc-total">Total: $0</div>
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
    el.innerHTML = items.map((item, i) => {
      const selectedLabel = docArtDisplayName(item);
      const placeholder = item.articuloId === 'custom'
        ? 'Ítem personalizado (descripción abajo)'
        : 'Escribir para buscar artículo…';
      return `
    <div style="margin-bottom:8px">
      <div style="display:grid;grid-template-columns:2fr 80px 120px 40px;gap:8px;align-items:end">
        <div class="form-group doc-art-combo" data-idx="${i}" style="margin:0;position:relative;min-width:0">
          <label class="form-label">${i === 0 ? 'ARTÍCULO' : ''}</label>
          <div class="inv-art-search-wrap">
            <input type="text" class="form-control doc-art-search" value="${escAttr(selectedLabel)}" placeholder="${escAttr(placeholder)}" autocomplete="off" spellcheck="false" style="padding:8px">
            <div class="inv-art-sug doc-art-sug" style="display:none" role="listbox"></div>
          </div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
            <button type="button" class="btn btn-xs btn-secondary" onclick="docItemChanged(${i},'custom')" title="Ítem libre sin catálogo">✏️ Personalizado</button>
            ${item.articuloId && item.articuloId !== 'custom' ? `<button type="button" class="btn btn-xs btn-secondary" onclick="docItemChanged(${i},'')" title="Quitar selección">Limpiar</button>` : ''}
          </div>
        </div>
        <div class="form-group" style="margin:0"><label class="form-label">${i === 0 ? 'CANT' : ''}</label><input type="number" class="form-control" value="${item.cantidad}" min="1" onchange="docItemQty(${i},this.value)" style="padding:8px"></div>
        <div class="form-group" style="margin:0"><label class="form-label">${i === 0 ? 'PRECIO' : ''}</label><input type="number" class="form-control" value="${item.precio}" min="0" onchange="docItemPrice(${i},this.value)" style="padding:8px" id="doc-item-price-${i}"></div>
        <button class="btn btn-xs btn-danger" onclick="removeDocItem(${i})" style="margin-bottom:0;height:38px">✕</button>
      </div>
      ${item.articuloId === 'custom' ? `<div style="display:grid;grid-template-columns:2fr 120px 40px;gap:8px;margin-top:6px">
        <input type="text" class="form-control" value="${escHtml(item.nombre || '')}" placeholder="Descripción del producto" oninput="docItemName(${i},this.value)" style="padding:8px">
        <input type="text" class="form-control" value="${escHtml(item.talla || '')}" placeholder="Talla (opcional)" oninput="docItemTalla(${i},this.value)" style="padding:8px">
        <span></span>
      </div>` : ''}
    </div>`;
    }).join('');
    updateDocTotal();
    setTimeout(() => initDocArtCombos(state), 0);
  }

  function docItemChanged(ctx) {
    const { state, i, artId, renderDocItems } = ctx;
    const items = ctx.getDocItems();
    if (artId === 'custom') {
      items[i].articuloId = 'custom';
      // Antes se fijaba 'Personalizado'; ahora se limpia para forzar descripción real
      // capturada vía el input de texto que aparece bajo la fila.
      if (!items[i].nombre || items[i].nombre === 'Personalizado') items[i].nombre = '';
    } else {
      const art = (state.articulos || []).find((a) => a.id === artId);
      if (art) {
        items[i].articuloId = artId;
        items[i].nombre = art.nombre;
        items[i].precio = art.precioVenta;
      } else {
        // "— Seleccionar —": sin artículo asignado.
        items[i].articuloId = '';
      }
    }
    ctx.setDocItems(items);
    renderDocItems();
  }

  // Captura de descripción libre / talla para ítems "Personalizado" (no re-renderiza
  // para no perder el foco mientras se escribe).
  function docItemName(ctx) {
    const items = ctx.getDocItems();
    if (items[ctx.i]) items[ctx.i].nombre = ctx.val;
    ctx.setDocItems(items);
  }

  function docItemTalla(ctx) {
    const items = ctx.getDocItems();
    if (items[ctx.i]) items[ctx.i].talla = ctx.val;
    ctx.setDocItems(items);
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
    const subtotal = ctx.getDocItems().reduce((a, item) => a + (item.cantidad * item.precio), 0);
    const ivaEl = document.getElementById('m-doc-apply-iva');
    const applyIva = ivaEl ? ivaEl.checked : false;
    const iva = applyIva ? subtotal * 0.19 : 0;
    const total = subtotal + iva;
    const el = document.getElementById('m-doc-total');
    if (!el) return;
    el.innerHTML =
      '<div style="font-size:12px;color:var(--text2)">Subtotal: ' + ctx.fmt(subtotal) + '</div>' +
      '<div style="font-size:12px;color:var(--text2)">IVA (19%): ' + ctx.fmt(iva) + '</div>' +
      '<div style="font-family:Syne;font-size:18px;font-weight:800;color:var(--accent);margin-top:4px">Total: ' +
      ctx.fmt(total) +
      '</div>';
  }

  async function saveDoc(ctx) {
    const { state, collection, today, supabaseClient, saveConfig, closeModal, renderPage, notify, fmt, loadState } = ctx;
    const fecha = document.getElementById('m-doc-fecha').value || today();
    const cliente = document.getElementById('m-doc-cliente').value.trim();
    const obs = document.getElementById('m-doc-obs').value.trim();
    const refId = document.getElementById('m-doc-ref')?.value || '';
    const items = ctx.getDocItems().filter((i) => i.precio > 0);
    if (items.length === 0) { notify('warning', '⚠️', 'Sin ítems', 'Agrega al menos un ítem.', { duration: 3000 }); return; }
    // No permitir guardar líneas con precio pero SIN descripción (causaba facturas
    // con "una sola prenda sin nombre" en el PDF). No toca totales ni numeración.
    const sinNombre = items.findIndex((i) => !String(i.nombre || '').trim());
    if (sinNombre !== -1) {
      notify('warning', '⚠️', 'Falta descripción', `La línea ${sinNombre + 1} tiene precio pero no tiene nombre de producto. Selecciona un artículo o escribe una descripción ("Personalizado").`, { duration: 6000 });
      return;
    }
    const subtotal = items.reduce((a, i) => a + (i.cantidad * i.precio), 0);
    const ivaEl = document.getElementById('m-doc-apply-iva');
    const applyIva = ivaEl ? ivaEl.checked : (collection !== 'facturas');
    const iva = applyIva ? subtotal * 0.19 : 0;
    const total = subtotal + iva;
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
    // Todo saveDoc es atómico: RPC + erp_consecutivos.
    const DOC_RPC = {
      cotizaciones: { kind: 'commercial', type: 'quotation', status: 'draft', page: 'cotizaciones', mirror: 'cotizacion' },
      ordenes_venta: { kind: 'commercial', type: 'sales_order', status: 'draft', page: 'ordenes', mirror: 'orden' },
      prefacturas: { kind: 'commercial', type: 'proforma', status: 'issued', page: 'prefacturas', mirror: 'prefactura' },
      notas_credito: { kind: 'commercial', type: 'credit_note', status: 'draft', page: 'notas_credito', mirror: 'nc' },
      notas_debito: { kind: 'commercial', type: 'debit_note', status: 'draft', page: 'notas_debito', mirror: 'nd' },
      remisiones: { kind: 'commercial', type: 'remittance', status: 'draft', page: 'remisiones', mirror: 'remision' },
      devoluciones: { kind: 'commercial', type: 'return_doc', status: 'draft', page: 'devoluciones', mirror: 'devolucion' },
      anticipos_clientes: { kind: 'commercial', type: 'customer_advance', status: 'draft', page: 'anticipos_clientes', mirror: 'anticipo' },
      facturas: { kind: 'manual_invoice', page: 'facturas', mirror: 'factura_manual' }
    };
    const rpcMeta = DOC_RPC[collection];
    if (!rpcMeta) {
      notify(
        'danger',
        '🛑',
        'Tipo no soportado',
        `«${collection}» no tiene RPC atómico definido.`,
        { duration: 9000 }
      );
      return;
    }
    if (!supabaseClient) {
      notify('danger', '📡', 'Sin conexión', 'No se puede guardar el documento.', { duration: 6000 });
      return;
    }

    const lineItems = itemsNormalized.map((i) => ({
      product_id: i.articuloId && i.articuloId !== 'custom' ? i.articuloId : null,
      name: i.nombre,
      size: i.talla || '',
      qty: i.cantidad,
      unit_price: i.precio
    }));

    let data = null;
    let error = null;
    if (rpcMeta.kind === 'manual_invoice') {
      const result = await supabaseClient.rpc('create_manual_invoice_v1', {
        p_request: {
          document_date: fecha,
          customer_name: cliente,
          notes: obs,
          tax: iva,
          shipping: 0,
          channel: 'vitrina',
          method: 'efectivo',
          items: lineItems
        }
      });
      data = result.data;
      error = result.error;
    } else {
      const result = await supabaseClient.rpc('create_commercial_document_v1', {
        p_request: {
          document_type: rpcMeta.type,
          status: rpcMeta.status,
          document_date: fecha,
          customer_name: cliente,
          notes: obs,
          tax: iva,
          shipping: 0,
          channel: 'vitrina',
          factura_ref: refId || '',
          items: lineItems
        }
      });
      data = result.data;
      error = result.error;
    }

    if (error || !data?.ok) {
      notify('danger', '⚠️', 'Documento no creado', error?.message || 'Supabase rechazó el documento.', { duration: 9000 });
      return;
    }

    const serverConsec = parseInt(String(data.number || '').replace(/\D/g, ''), 10);
    if (Number.isFinite(serverConsec) && serverConsec > 0 && rpcMeta.mirror) {
      if (!state.consecutivos) state.consecutivos = {};
      state.consecutivos[rpcMeta.mirror] = Math.max(Number(state.consecutivos[rpcMeta.mirror]) || 1, serverConsec + 1);
      if (typeof saveConfig === 'function') {
        try { await saveConfig('consecutivos', state.consecutivos); } catch (_) { /* noop */ }
      }
    }

    ctx.setDocItems([]);
    closeModal();
    if (typeof loadState === 'function') await loadState();
    if (typeof global.showPage === 'function') global.showPage(rpcMeta.page);
    else if (typeof renderPage === 'function') renderPage(rpcMeta.page);
    notify('success', '✅', 'Documento creado', `${data.number} · ${fmt(data.total)}`, { duration: 4000 });
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
    docItemName,
    docItemTalla,
    docItemQty,
    docItemPrice,
    removeDocItem,
    updateDocTotal,
    saveDoc,
    deleteDoc,
    printDoc
  };
})(window);
