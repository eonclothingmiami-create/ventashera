// Users module: UI rendering + CRUD orchestration for clientes/empleados/proveedores.
(function initUsersModule(global) {
  function renderUsuariosRows(items, collection, tipo, pageId) {
    if (!items.length) return '<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>';
    const visible = items.slice(0, 200);
    const more = items.length > 200 ? `<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:12px;font-size:11px">... y ${items.length - 200} más. Usa el buscador para filtrar.</td></tr>` : '';
    return visible.map((u, idx) => `<tr>
    <td style="font-weight:700">${u.nombre || '—'}</td>
    <td>${u.tipoId || ''} ${u.cedula || '—'}</td>
    <td>${u.celular || '—'}</td>
    <td>${u.whatsapp || '—'}</td>
    <td>${u.email || '—'}</td>
    <td>${u.ciudad || '—'}</td>
    <td><span class="badge badge-warn">${u.tipoPersona || tipo}</span></td>
    <td><div class="btn-group">
      <button class="btn btn-xs btn-secondary" onclick="openUsuarioModal('${collection}','${tipo}','${pageId}','${idx}',true)">✏️</button>
      <button class="btn btn-xs btn-danger" onclick="eliminarUsuario('${collection}','${u.id}','${pageId}','${tipo}','${tipo}')">✕</button>
    </div></td>
  </tr>`).join('') + more;
  }

  function renderUsuarios(state, pageId, titulo, collection, tipo) {
    const el = document.getElementById(pageId + '-content'); if (!el) return;
    const q = (document.getElementById(pageId + '-search')?.value || '').toLowerCase();
    const desde = document.getElementById(pageId + '-desde')?.value || '';
    const hasta = document.getElementById(pageId + '-hasta')?.value || '';
    if (!state[collection]) state[collection] = [];
    let items = Array.isArray(state[collection]) ? [...state[collection]].reverse() : [];
    if (q) items = items.filter((u) =>
      (u.nombre || '').toLowerCase().includes(q) ||
      (u.cedula || '').toLowerCase().includes(q) ||
      (u.celular || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.ciudad || '').toLowerCase().includes(q)
    );
    if (desde) items = items.filter((u) => (u.fechaCreacion || '') >= desde);
    if (hasta) items = items.filter((u) => (u.fechaCreacion || '') <= hasta);
    const total = (state[collection] || []).length;
    const tbodyId = pageId + '-tbody';
    const contadorId = pageId + '-contador';
    const existing = document.getElementById(tbodyId);
    if (existing) {
      existing.innerHTML = renderUsuariosRows(items, collection, tipo, pageId);
      const contador = document.getElementById(contadorId);
      if (contador) contador.textContent = `${items.length} de ${total}`;
      return;
    }
    el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <button class="btn btn-primary" onclick="openUsuarioModal('${collection}','${tipo}')">+ Nuevo ${titulo}</button>
      <button class="btn btn-secondary" onclick="importarUsuariosCSV('${collection}','${tipo}','${pageId}')" title="Importar CSV/Excel">📥 Importar</button>
      <button class="btn btn-secondary" onclick="exportarUsuarios('${collection}','${tipo}')" title="Exportar a CSV">⬆ Exportar</button>
      <button class="btn btn-secondary" onclick="descargarPlantilla('${tipo}')" title="Descargar plantilla">⬇ Plantilla</button>
      <div class="search-bar" style="flex:1;min-width:180px;max-width:300px;margin:0">
        <span class="search-icon">🔍</span>
        <input type="text" id="${pageId}-search" placeholder="Nombre, cédula, ciudad..."
          value="${q}"
          oninput="renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">
      </div>
      <input type="date" class="form-control" id="${pageId}-desde" style="width:140px" value="${desde}"
        onchange="renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="${pageId}-hasta" style="width:140px" value="${hasta}"
        onchange="renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">
      <button class="btn btn-xs btn-secondary" id="${pageId}-limpiar" style="display:${(q || desde || hasta) ? 'inline-flex' : 'none'}"
        onclick="document.getElementById('${pageId}-search').value='';document.getElementById('${pageId}-desde').value='';document.getElementById('${pageId}-hasta').value='';renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">✕ Limpiar</button>
    </div>
    <div class="card">
      <div class="card-title">👥 ${titulo.toUpperCase()}S — <span id="${contadorId}">${items.length} de ${total}</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Nombre</th><th>Identificación</th><th>Celular</th><th>WhatsApp</th>
            <th>Email</th><th>Ciudad</th><th>Tipo</th><th></th>
          </tr></thead>
          <tbody id="${tbodyId}">
            ${renderUsuariosRows(items, collection, tipo, pageId)}
          </tbody>
        </table>
      </div>
    </div>
    <input type="file" id="${pageId}-file-input" accept=".csv,.xls,.xlsx" style="display:none"
      onchange="procesarArchivoUsuarios(this,'${collection}','${tipo}','${pageId}')">`;
  }

  function renderUsuariosTabla(state, pageId, titulo, collection, tipo) {
    const q = (document.getElementById(pageId + '-search')?.value || '').toLowerCase();
    const desde = document.getElementById(pageId + '-desde')?.value || '';
    const hasta = document.getElementById(pageId + '-hasta')?.value || '';
    if (!state[collection]) state[collection] = [];
    let items = Array.isArray(state[collection]) ? [...state[collection]].reverse() : [];
    if (q) items = items.filter((u) =>
      (u.nombre || '').toLowerCase().includes(q) ||
      (u.cedula || '').toLowerCase().includes(q) ||
      (u.celular || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.ciudad || '').toLowerCase().includes(q)
    );
    if (desde) items = items.filter((u) => (u.fechaCreacion || '') >= desde);
    if (hasta) items = items.filter((u) => (u.fechaCreacion || '') <= hasta);
    const total = (state[collection] || []).length;
    const tbody = document.getElementById(pageId + '-tbody');
    if (tbody) tbody.innerHTML = renderUsuariosRows(items, collection, tipo, pageId);
    const contador = document.getElementById(pageId + '-contador');
    if (contador) contador.textContent = `${items.length} de ${total}`;
    const btnLimpiar = document.getElementById(pageId + '-limpiar');
    if (btnLimpiar) btnLimpiar.style.display = (q || desde || hasta) ? 'inline-flex' : 'none';
  }

  function openUsuarioModal(state, openModal, closeModal, collection, tipo, pageId, idx, editar) {
    const items = state[collection] || [];
    const u = (editar && idx !== undefined) ? items[items.length - 1 - parseInt(idx, 10)] : null;
    const titulos = { cliente: 'Cliente', empleado: 'Empleado', proveedor: 'Proveedor' };
    openModal(`
    <div class="modal-title">${u ? 'Editar' : 'Nuevo'} ${titulos[tipo] || tipo}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO ID</label>
        <select class="form-control" id="usu-tipoid">
          <option value="CC" ${u?.tipoId === 'CC' ? 'selected' : ''}>CC - Cédula</option>
          <option value="NIT" ${u?.tipoId === 'NIT' ? 'selected' : ''}>NIT</option>
          <option value="CE" ${u?.tipoId === 'CE' ? 'selected' : ''}>CE - Extranjería</option>
          <option value="PA" ${u?.tipoId === 'PA' ? 'selected' : ''}>PA - Pasaporte</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">N° IDENTIFICACIÓN</label><input class="form-control" id="usu-cedula" value="${u?.cedula || ''}"></div>
    </div>
    <div class="form-group"><label class="form-label">NOMBRE COMPLETO *</label><input class="form-control" id="usu-nombre" value="${u?.nombre || ''}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">CELULAR</label><input class="form-control" id="usu-celular" value="${u?.celular || ''}"></div>
      <div class="form-group"><label class="form-label">WHATSAPP</label><input class="form-control" id="usu-whatsapp" value="${u?.whatsapp || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">EMAIL</label><input class="form-control" id="usu-email" value="${u?.email || ''}"></div>
      <div class="form-group"><label class="form-label">CIUDAD</label><input class="form-control" id="usu-ciudad" value="${u?.ciudad || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">DEPARTAMENTO</label><input class="form-control" id="usu-dpto" value="${u?.departamento || ''}"></div>
      <div class="form-group"><label class="form-label">DIRECCIÓN</label><input class="form-control" id="usu-dir" value="${u?.direccion || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO PERSONA</label>
        <select class="form-control" id="usu-tipopersona">
          <option value="Natural" ${u?.tipoPersona === 'Natural' ? 'selected' : ''}>Natural</option>
          <option value="Jurídica" ${u?.tipoPersona === 'Jurídica' ? 'selected' : ''}>Jurídica</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">FECHA NACIMIENTO</label><input type="date" class="form-control" id="usu-fnac" value="${u?.fechaNac || ''}"></div>
    </div>
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="usu-obs" rows="2">${u?.observacion || ''}</textarea></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarUsuario('${collection}','${tipo}','${pageId || 'usu_' + tipo + 's'}','${u?.id || ''}')">Guardar ${titulos[tipo] || tipo}</button>
  `);
  }

  async function guardarUsuario(ctx) {
    const { state, supabaseClient, showLoadingOverlay, closeModal, renderPage, notify, collection, tipo, pageId, existingId } = ctx;
    const nombre = document.getElementById('usu-nombre').value.trim();
    if (!nombre) { notify('danger', '⚠️', 'Error', 'El nombre es obligatorio'); return; }
    let table = '';
    let data = {};
    const recordId = existingId || crypto.randomUUID();
    if (tipo === 'cliente') {
      table = 'customers';
      data = {
        id: recordId, nombre,
        cedula: document.getElementById('usu-cedula').value.trim(),
        celular: document.getElementById('usu-celular').value.trim(),
        telefono: document.getElementById('usu-celular').value.trim(),
        whatsapp: document.getElementById('usu-whatsapp').value.trim(),
        ciudad: document.getElementById('usu-ciudad').value.trim(),
        direccion: document.getElementById('usu-dir').value.trim()
      };
    } else if (tipo === 'empleado') {
      table = 'employees';
      data = { id: recordId, nombre, tipo_contrato: 'indefinido', salario_base: 0 };
    } else {
      table = 'proveedores';
      data = {
        id: recordId,
        nombre,
        tipo_id: document.getElementById('usu-tipoid')?.value || 'CC',
        cedula: document.getElementById('usu-cedula')?.value.trim() || '',
        celular: document.getElementById('usu-celular')?.value.trim() || '',
        whatsapp: document.getElementById('usu-whatsapp')?.value.trim() || '',
        email: document.getElementById('usu-email')?.value.trim() || '',
        ciudad: document.getElementById('usu-ciudad')?.value.trim() || '',
        departamento: document.getElementById('usu-dpto')?.value.trim() || '',
        direccion: document.getElementById('usu-dir')?.value.trim() || '',
        tipo_persona: document.getElementById('usu-tipopersona')?.value || 'Natural',
        observacion: document.getElementById('usu-obs')?.value.trim() || ''
      };
    }
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from(table).upsert(data, { onConflict: 'id' });
      if (error) throw error;
      if (!state[collection]) state[collection] = [];
      if (existingId) {
        const i = state[collection].findIndex((x) => x.id === existingId);
        if (i >= 0) state[collection][i] = { ...state[collection][i], ...data };
      } else {
        state[collection].push(data);
      }
      if (tipo === 'empleado') state.empleados = state.usu_empleados;
      closeModal();
      renderPage(pageId);
      showLoadingOverlay('hide');
      notify('success', '✅', 'Guardado', `${nombre} guardado correctamente en BD`, { duration: 3000 });
    } catch (err) {
      showLoadingOverlay('hide');
      console.error('Error guardando usuario:', err);
      notify('danger', '⚠️', 'Error', err.message, { duration: 5000 });
    }
  }

  async function eliminarUsuario(ctx) {
    const { state, supabaseClient, showLoadingOverlay, renderPage, notify, confirm, collection, id, pageId, titulo, tipo } = ctx;
    if (!confirm(`¿Eliminar este ${titulo}? Esta acción no se puede deshacer.`)) return;
    const table = tipo === 'cliente' ? 'customers' : (tipo === 'empleado' ? 'employees' : null);
    if (!table) return;
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from(table).delete().eq('id', id);
      if (error) throw error;
      state[collection] = (state[collection] || []).filter((x) => x.id !== id);
      if (tipo === 'empleado') state.empleados = state.usu_empleados;
      renderPage(pageId);
      showLoadingOverlay('hide');
      notify('success', '🗑️', 'Eliminado', `${titulo} borrado del sistema.`);
    } catch (err) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error al eliminar', err.message, { duration: 5000 });
    }
  }

  global.AppUsersModule = {
    renderUsuarios,
    renderUsuariosTabla,
    renderUsuariosRows,
    openUsuarioModal,
    guardarUsuario,
    eliminarUsuario
  };
})(window);
