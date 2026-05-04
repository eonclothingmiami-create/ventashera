// ===================================================================
// ===== TESORERÍA =====
// ===================================================================
// Pagos a proveedores, abonos y vista de pagos delegan en
// `AppTreasuryModule` (treasury-module.js) para una sola fuente de verdad.
// Si usas este archivo aparte de index.html principal, carga antes:
//   treasury-module.js → caja-logic.js → (tu bootstrap con state, supabase, etc.)
// ===================================================================
// ===== TESORERÍA: PAGOS A PROVEEDORES (delegación) =====
// ===================================================================

function renderTesPagosProv() {
  if (window.AppTreasuryModule?.renderTesPagosProv) {
    return window.AppTreasuryModule.renderTesPagosProv({ state, fmt, formatDate });
  }
  const el = document.getElementById('tes_pagos_prov-content');
  if (el) {
    el.innerHTML =
      '<div class="card" style="padding:16px"><b>Módulo tesorería no cargado.</b> Incluye <code>treasury-module.js</code> antes de esta vista.</div>';
  }
}

function openAbonoProvModal(provId = '', provNombre = '') {
  if (window.AppTreasuryModule?.openAbonoProvModal) {
    return window.AppTreasuryModule.openAbonoProvModal({
      state,
      provId,
      provNombre,
      fmt,
      openModal,
      notify,
      today
    });
  }
  notify('warning', '⚠️', 'Módulo tesorería', 'Carga treasury-module.js para registrar abonos.', { duration: 4000 });
}

function updateSaldoPendiente() {
  if (window.AppTreasuryModule?.updateSaldoPendiente) {
    return window.AppTreasuryModule.updateSaldoPendiente({ fmt, state });
  }
}

function validateAbono() {
  if (window.AppTreasuryModule?.validateAbono) {
    return window.AppTreasuryModule.validateAbono({ fmt, state });
  }
}

async function guardarAbonoProv() {
  if (window.AppTreasuryModule?.guardarAbonoProv) {
    const nextId = typeof dbId === 'function' ? dbId : uid;
    return window.AppTreasuryModule.guardarAbonoProv({
      state,
      uid,
      dbId: nextId,
      today,
      showLoadingOverlay,
      supabaseClient,
      saveRecord,
      closeModal,
      renderTesPagosProv,
      notify,
      fmt,
      renderTesCajas: typeof renderTesCajas === 'function' ? renderTesCajas : undefined
    });
  }
  notify('danger', '⚠️', 'Módulo tesorería', 'Carga treasury-module.js para guardar abonos.', { duration: 5000 });
}

function verAbonosProv(provId, provNombre) {
  if (window.AppTreasuryModule?.verAbonosProv) {
    return window.AppTreasuryModule.verAbonosProv({ state, provId, provNombre, fmt, formatDate, openModal });
  }
  notify('warning', '⚠️', 'Módulo tesorería', 'Carga treasury-module.js para ver abonos.', { duration: 4000 });
}

async function eliminarAbonoProv(id) {
  if (window.AppTreasuryModule?.eliminarAbonoProv) {
    return window.AppTreasuryModule.eliminarAbonoProv({
      state,
      id,
      confirm,
      supabaseClient,
      saveRecord,
      renderTesPagosProv,
      notify,
      renderTesCajas: typeof renderTesCajas === 'function' ? renderTesCajas : undefined
    });
  }
  notify('danger', '⚠️', 'Módulo tesorería', 'Carga treasury-module.js para eliminar abonos.', { duration: 5000 });
}

function renderTesCajas() {
  const cajas = state.cajas || [];
  document.getElementById('tes_cajas-content').innerHTML = `
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openCajaModal()">+ Nueva Caja</button>
    <div class="grid-2">${cajas
      .map(
        (c) => `
      <div class="card" style="margin:0;border-color:${c.estado === 'abierta' ? 'rgba(0,229,180,.3)' : 'var(--border)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-family:Syne;font-weight:800;font-size:16px">${c.nombre}</div>
          <span class="badge ${c.estado === 'abierta' ? 'badge-ok' : 'badge-pend'}">${c.estado}</span>
        </div>
        <div style="font-family:Syne;font-size:28px;font-weight:800;color:var(--accent);margin-bottom:12px">${fmt(c.saldo)}</div>
        <div class="btn-group">
          ${
            c.estado === 'abierta'
              ? `
            <button class="btn btn-sm btn-secondary" onclick="movCaja('${c.id}','ingreso')">📥 Ingreso</button>
            <button class="btn btn-sm btn-secondary" onclick="movCaja('${c.id}','egreso')">📤 Egreso</button>
            <button class="btn btn-sm btn-danger" onclick="cerrarCaja('${c.id}')">🔒 Cerrar</button>
          `
              : `<button class="btn btn-sm btn-primary" onclick="abrirCaja('${c.id}')">🔓 Abrir</button>`
          }
        </div>
      </div>`
      )
      .join('')}</div>`;
}

function openCajaModal() {
  openModal(`
    <div class="modal-title">Nueva Caja<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">NOMBRE</label><input class="form-control" id="m-caja-nombre" placeholder="Ej: Caja 2"></div>
    <div class="form-group"><label class="form-label">SALDO INICIAL</label><input type="number" class="form-control" id="m-caja-saldo" value="0"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveCaja()">Crear Caja</button>
  `);
}
function saveCaja() {
  const nombre = document.getElementById('m-caja-nombre').value.trim();
  if (!nombre) return;
  const caja = {
    id: uid(),
    nombre,
    saldo: parseFloat(document.getElementById('m-caja-saldo').value) || 0,
    estado: 'abierta',
    apertura: today()
  };
  state.cajas.push(caja);
  saveRecord('cajas', caja.id, caja);
  closeModal();
  renderTesCajas();
}
function cerrarCaja(id) {
  const c = (state.cajas || []).find((x) => x.id === id);
  if (c) {
    c.estado = 'cerrada';
    saveRecord('cajas', c.id, c);
    renderTesCajas();
    notify('success', '🔒', 'Caja cerrada', c.nombre + ' · Saldo: ' + fmt(c.saldo), { duration: 3000 });
  }
}
function abrirCaja(id) {
  const c = (state.cajas || []).find((x) => x.id === id);
  if (c) {
    c.estado = 'abierta';
    c.apertura = today();
    saveRecord('cajas', c.id, c);
    renderTesCajas();
  }
}

function saveMovCaja(cajaId, tipo) {
  const valor = parseFloat(document.getElementById('m-mov-valor').value) || 0;
  if (valor <= 0) return;
  const concepto = document.getElementById('m-mov-concepto').value.trim();
  const metodo = document.getElementById('m-mov-metodo').value;
  const caja = (state.cajas || []).find((c) => c.id === cajaId);
  if (!caja) return;

  if (tipo === 'ingreso') caja.saldo += valor;
  else caja.saldo -= valor;
  const mov = { id: uid(), cajaId, tipo, valor, concepto, fecha: today(), metodo };
  state.tes_movimientos.push(mov);

  saveRecord('cajas', caja.id, caja);
  saveRecord('tes_movimientos', mov.id, mov);

  closeModal();
  renderTesCajas();
  notify('success', '✅', tipo === 'ingreso' ? 'Ingreso' : 'Egreso', fmt(valor) + ' · ' + concepto, { duration: 3000 });
}

/* index.html usa treasury-module.js (renderTesDinero con cards Efectivo/Transferencia y filtro por fechas). Esta versión es legado / tabla simple. */
function renderTesDinero() {
  const movs = [...(state.tes_movimientos || [])].reverse();
  document.getElementById('tes_dinero-content').innerHTML = `
    <div class="card"><div class="card-title">MOVIMIENTOS DE DINERO (${movs.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Caja</th><th>Tipo</th><th>Valor</th><th>Concepto</th><th>Método</th></tr></thead><tbody>
    ${
      movs
        .map((m) => {
          const caja = (state.cajas || []).find((c) => c.id === m.cajaId);
          return `<tr><td>${formatDate(m.fecha)}</td><td>${caja?.nombre || '—'}</td><td><span class="badge ${
            m.tipo === 'ingreso' ? 'badge-ok' : 'badge-pend'
          }">${m.tipo}</span></td><td style="color:${m.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)'};font-weight:700">${fmt(
            m.valor
          )}</td><td>${m.concepto || '—'}</td><td>${m.metodo || '—'}</td></tr>`;
        })
        .join('') ||
      '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin movimientos</td></tr>'
    }
    </tbody></table></div></div>`;
}

// GENERIC SIMPLE RENDERERS FOR TESORERÍA SUB-MODULES
function renderSimpleCollection(pageId, title, collection, columns) {
  const items = [...(state[collection] || [])].reverse();
  const el = document.getElementById(pageId + '-content');
  if (!el) return;
  el.innerHTML = `
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openSimpleFormModal('${collection}','${title}',${JSON.stringify(columns).replace(
      /"/g,
      "'"
    )})">+ Nuevo</button>
    <div class="card"><div class="card-title">${title.toUpperCase()} (${items.length})</div>
    <div class="table-wrap"><table><thead><tr>${columns.map((c) => '<th>' + c.split(':')[2] + '</th>').join('')}<th></th></tr></thead><tbody>
    ${
      items
        .map(
          (item) =>
            `<tr>${columns
              .map((c) => {
                const key = c.split(':')[0];
                const type = c.split(':')[1];
                const val = item[key];
                return type === 'number'
                  ? `<td style="font-weight:700;color:var(--accent)">${fmt(val || 0)}</td>`
                  : `<td>${val || '—'}</td>`;
              })
              .join('')}<td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('${collection}','${item.id}','${pageId}')">✕</button></td></tr>`
        )
        .join('') ||
      `<tr><td colspan="${columns.length + 1}" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>`
    }
    </tbody></table></div></div>`;
}

function openSimpleFormModal(collection, title, columns) {
  if (typeof columns === 'string') columns = JSON.parse(columns.replace(/'/g, '"'));
  openModal(`
    <div class="modal-title">Nuevo - ${title}<button class="modal-close" onclick="closeModal()">×</button></div>
    ${columns
      .map((c) => {
        const [key, type, label] = c.split(':');
        return `<div class="form-group"><label class="form-label">${label}</label><input type="${
          type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'
        }" class="form-control" id="m-sf-${key}" ${type === 'date' ? 'value="' + today() + '"' : ''}></div>`;
      })
      .join('')}
    <button class="btn btn-primary" style="width:100%" onclick="saveSimpleForm('${collection}',${JSON.stringify(columns).replace(/"/g, "'")})">Guardar</button>
  `);
}

function saveSimpleForm(collection, columns) {
  if (typeof columns === 'string') columns = JSON.parse(columns.replace(/'/g, '"'));
  const item = { id: uid(), fecha: today() };

  columns.forEach((c) => {
    const [key, type] = c.split(':');
    const el = document.getElementById('m-sf-' + key);
    if (el) item[key] = type === 'number' ? parseFloat(el.value) || 0 : el.value.trim();
  });

  if (!state[collection]) state[collection] = [];
  state[collection].push(item);

  saveRecord(collection, item.id, item);

  closeModal();
  renderPage(document.querySelector('.page.active')?.id.replace('page-', ''));
  notify('success', '✅', 'Registro guardado', '', { duration: 2000 });
}

function deleteFromCollection(collection, id, pageId) {
  if (!confirm('¿Eliminar este registro?')) return;

  state[collection] = (state[collection] || []).filter((x) => x.id !== id);

  deleteRecord(collection, id);

  renderPage(pageId);
  notify('success', '🗑️', 'Eliminado', 'Registro borrado correctamente.');
}

function renderTesImpuestos() {
  renderSimpleCollection('tes_impuestos', 'Impuestos', 'tes_impuestos', [
    'fecha:date:FECHA',
    'tipo:text:TIPO IMPUESTO',
    'base:number:BASE',
    'tarifa:text:TARIFA %',
    'valor:number:VALOR',
    'referencia:text:REFERENCIA'
  ]);
}
function renderTesRetenciones() {
  renderSimpleCollection('tes_retenciones', 'Retenciones', 'tes_retenciones', [
    'fecha:date:FECHA',
    'tipo:text:TIPO',
    'base:number:BASE',
    'tarifa:text:TARIFA %',
    'valor:number:VALOR',
    'tercero:text:TERCERO'
  ]);
}
function renderTesCompRetencion() {
  renderSimpleCollection('tes_comp_retencion', 'Comprobantes Retención', 'tes_comp_retencion', [
    'fecha:date:FECHA',
    'numero:text:NÚMERO',
    'tercero:text:TERCERO',
    'concepto:text:CONCEPTO',
    'base:number:BASE',
    'valor:number:VALOR'
  ]);
}
function renderTesCompIngreso() {
  renderSimpleCollection('tes_comp_ingreso', 'Comprobantes Ingreso', 'tes_comp_ingreso', [
    'fecha:date:FECHA',
    'numero:text:NÚMERO',
    'tercero:text:TERCERO',
    'concepto:text:CONCEPTO',
    'valor:number:VALOR'
  ]);
}

function renderTesCompEgreso() {
  renderSimpleCollection('tes_comp_egreso', 'Comprobantes Egreso', 'tes_comp_egreso', [
    'fecha:date:FECHA',
    'numero:text:NÚMERO',
    'tercero:text:TERCERO',
    'concepto:text:CONCEPTO',
    'valor:number:VALOR'
  ]);
}
function renderTesTransferencias() {
  renderSimpleCollection('tes_transferencias', 'Transferencias', 'tes_transferencias', [
    'fecha:date:FECHA',
    'origen:text:ORIGEN',
    'destino:text:DESTINO',
    'valor:number:VALOR',
    'motivo:text:MOTIVO'
  ]);
}
