// ===== USUARIOS =====
// ==========================================

function renderUsuarios(pageId, titulo, collection, tipo){
  const el = document.getElementById(pageId+'-content'); if(!el) return;

  const q = (document.getElementById(pageId+'-search')?.value||'').toLowerCase();
  const desde = document.getElementById(pageId+'-desde')?.value||'';
  const hasta = document.getElementById(pageId+'-hasta')?.value||'';

  if(!state[collection]) state[collection]=[];
  let items = Array.isArray(state[collection]) ? [...state[collection]].reverse() : [];
  if(q) items = items.filter(u =>
    (u.nombre||'').toLowerCase().includes(q) ||
    (u.cedula||'').toLowerCase().includes(q) ||
    (u.celular||'').toLowerCase().includes(q) ||
    (u.email||'').toLowerCase().includes(q) ||
    (u.ciudad||'').toLowerCase().includes(q)
  );
  if(desde) items = items.filter(u => (u.fechaCreacion||'') >= desde);
  if(hasta) items = items.filter(u => (u.fechaCreacion||'') <= hasta);

  const total = (state[collection]||[]).length;

  // Si ya existe el contenedor, solo actualizar la tabla (evita perder foco del input)
  const tbodyId = pageId+'-tbody';
  const contadorId = pageId+'-contador';
  const existing = document.getElementById(tbodyId);

  if(existing) {
    // Solo repintar tabla y contador
    existing.innerHTML = renderUsuariosRows(items, collection, tipo, pageId);
    const contador = document.getElementById(contadorId);
    if(contador) contador.textContent = `${items.length} de ${total}`;
    return;
  }

  // Primera carga: pintar todo
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
      <button class="btn btn-xs btn-secondary" id="${pageId}-limpiar" style="display:${(q||desde||hasta)?'inline-flex':'none'}"
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

function renderUsuariosTabla(pageId, titulo, collection, tipo) {
  // Actualiza solo la tabla sin repintar los filtros (mantiene foco)
  const q = (document.getElementById(pageId+'-search')?.value||'').toLowerCase();
  const desde = document.getElementById(pageId+'-desde')?.value||'';
  const hasta = document.getElementById(pageId+'-hasta')?.value||'';

  if(!state[collection]) state[collection]=[];
  let items = Array.isArray(state[collection]) ? [...state[collection]].reverse() : [];
  if(q) items = items.filter(u =>
    (u.nombre||'').toLowerCase().includes(q) ||
    (u.cedula||'').toLowerCase().includes(q) ||
    (u.celular||'').toLowerCase().includes(q) ||
    (u.email||'').toLowerCase().includes(q) ||
    (u.ciudad||'').toLowerCase().includes(q)
  );
  if(desde) items = items.filter(u => (u.fechaCreacion||'') >= desde);
  if(hasta) items = items.filter(u => (u.fechaCreacion||'') <= hasta);

  const total = (state[collection]||[]).length;
  const tbody = document.getElementById(pageId+'-tbody');
  if(tbody) tbody.innerHTML = renderUsuariosRows(items, collection, tipo, pageId);
  const contador = document.getElementById(pageId+'-contador');
  if(contador) contador.textContent = `${items.length} de ${total}`;
  // Mostrar/ocultar botón limpiar
  const btnLimpiar = document.getElementById(pageId+'-limpiar');
  if(btnLimpiar) btnLimpiar.style.display = (q||desde||hasta) ? 'inline-flex' : 'none';
}

function renderUsuariosRows(items, collection, tipo, pageId) {
  if(!items.length) return '<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>';
  // Show max 200 rows for performance with 8000+ records
  const visible = items.slice(0, 200);
  const more = items.length > 200 ? `<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:12px;font-size:11px">... y ${items.length-200} más. Usa el buscador para filtrar.</td></tr>` : '';
  return visible.map((u,idx) => `<tr>
    <td style="font-weight:700">${u.nombre||'—'}</td>
    <td>${u.tipoId||''} ${u.cedula||'—'}</td>
    <td>${u.celular||'—'}</td>
    <td>${u.whatsapp||'—'}</td>
    <td>${u.email||'—'}</td>
    <td>${u.ciudad||'—'}</td>
    <td><span class="badge badge-warn">${u.tipoPersona||tipo}</span></td>
    <td><div class="btn-group">
      <button class="btn btn-xs btn-secondary" onclick="openUsuarioModal('${collection}','${tipo}','${pageId}','${idx}',true)">✏️</button>
      <button class="btn btn-xs btn-danger" onclick="eliminarUsuario('${collection}','${u.id}','${pageId}','${tipo}','${tipo}')">✕</button>
    </div></td>
  </tr>`).join('') + more;
}


function renderUsuClientes(){ renderUsuarios('usu_clientes','Cliente','usu_clientes','cliente'); }
function renderUsuEmpleados(){ renderUsuarios('usu_empleados','Empleado','usu_empleados','empleado'); }
function renderUsuProveedores(){ renderUsuarios('usu_proveedores','Proveedor','usu_proveedores','proveedor'); }

function openUsuarioModal(collection, tipo, pageId, idx, editar){
  const items = state[collection]||[];
  const u = (editar && idx!==undefined) ? items[items.length-1-parseInt(idx)] : null;
  const titulos = {cliente:'Cliente', empleado:'Empleado', proveedor:'Proveedor'};
  openModal(`
    <div class="modal-title">${u?'Editar':'Nuevo'} ${titulos[tipo]||tipo}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO ID</label>
        <select class="form-control" id="usu-tipoid">
          <option value="CC" ${u?.tipoId==='CC'?'selected':''}>CC - Cédula</option>
          <option value="NIT" ${u?.tipoId==='NIT'?'selected':''}>NIT</option>
          <option value="CE" ${u?.tipoId==='CE'?'selected':''}>CE - Extranjería</option>
          <option value="PA" ${u?.tipoId==='PA'?'selected':''}>PA - Pasaporte</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">N° IDENTIFICACIÓN</label><input class="form-control" id="usu-cedula" value="${u?.cedula||''}"></div>
    </div>
    <div class="form-group"><label class="form-label">NOMBRE COMPLETO *</label><input class="form-control" id="usu-nombre" value="${u?.nombre||''}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">CELULAR</label><input class="form-control" id="usu-celular" value="${u?.celular||''}"></div>
      <div class="form-group"><label class="form-label">WHATSAPP</label><input class="form-control" id="usu-whatsapp" value="${u?.whatsapp||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">EMAIL</label><input class="form-control" id="usu-email" value="${u?.email||''}"></div>
      <div class="form-group"><label class="form-label">CIUDAD</label><input class="form-control" id="usu-ciudad" value="${u?.ciudad||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">DEPARTAMENTO</label><input class="form-control" id="usu-dpto" value="${u?.departamento||''}"></div>
      <div class="form-group"><label class="form-label">DIRECCIÓN</label><input class="form-control" id="usu-dir" value="${u?.direccion||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO PERSONA</label>
        <select class="form-control" id="usu-tipopersona">
          <option value="Natural" ${u?.tipoPersona==='Natural'?'selected':''}>Natural</option>
          <option value="Jurídica" ${u?.tipoPersona==='Jurídica'?'selected':''}>Jurídica</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">FECHA NACIMIENTO</label><input type="date" class="form-control" id="usu-fnac" value="${u?.fechaNac||''}"></div>
    </div>
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="usu-obs" rows="2">${u?.observacion||''}</textarea></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarUsuario('${collection}','${tipo}','${pageId||'usu_'+tipo+'s'}','${u?.id||''}')">Guardar ${titulos[tipo]||tipo}</button>
  `);
}

async function guardarUsuario(collection, tipo, pageId, existingId) {
  const nombre = document.getElementById('usu-nombre').value.trim();
  if(!nombre){ notify('danger','⚠️','Error','El nombre es obligatorio'); return; }

  // Determinar la tabla y preparar los datos según el tipo
  let table = '';
  let data = {};
  const recordId = existingId || crypto.randomUUID();

  if (tipo === 'cliente') {
    table = 'customers';
    data = {
      id: recordId,
      nombre: nombre,
      cedula: document.getElementById('usu-cedula').value.trim(),
      celular: document.getElementById('usu-celular').value.trim(),
      telefono: document.getElementById('usu-celular').value.trim(), // Usamos el mismo si no hay otro input
      whatsapp: document.getElementById('usu-whatsapp').value.trim(),
      ciudad: document.getElementById('usu-ciudad').value.trim(),
      direccion: document.getElementById('usu-dir').value.trim()
    };
  } else if (tipo === 'empleado') {
    table = 'employees';
    data = {
      id: recordId,
      nombre: nombre,
      tipo_contrato: 'indefinido', // Valor por defecto
      salario_base: 0 
    };
  } else {
    // Proveedor → tabla proveedores
    table = 'proveedores';
    data = {
      id: recordId,
      nombre: nombre,
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
    
    // UPSERT: Inserta si es nuevo, actualiza si ya existe
    const { error } = await supabaseClient.from(table).upsert(data, { onConflict: 'id' });
    if (error) throw error;

    // Actualizar la vista local para que la interfaz responda al instante
    if (!state[collection]) state[collection] = [];
    if (existingId) {
      const i = state[collection].findIndex(x => x.id === existingId);
      if (i >= 0) state[collection][i] = { ...state[collection][i], ...data };
    } else {
      state[collection].push(data);
    }
    // Mantener sincronía entre state.empleados y state.usu_empleados
    if(tipo === 'empleado') state.empleados = state.usu_empleados;
    if(tipo === 'cliente') state.usu_clientes = state.usu_clientes; // ya sincronizado

    closeModal();
    renderPage(pageId);
    showLoadingOverlay('hide');
    notify('success','✅','Guardado',`${nombre} guardado correctamente en BD`,{duration:3000});

  } catch (err) {
    showLoadingOverlay('hide');
    console.error("Error guardando usuario:", err);
    notify('danger','⚠️','Error', err.message, {duration: 5000});
  }
}

async function eliminarUsuario(collection, id, pageId, titulo, tipo) {
  if(!confirm(`¿Eliminar este ${titulo}? Esta acción no se puede deshacer.`)) return;

  const table = tipo === 'cliente' ? 'customers' : (tipo === 'empleado' ? 'employees' : null);
  if (!table) return;

  try {
    showLoadingOverlay('connecting');
    
    const { error } = await supabaseClient.from(table).delete().eq('id', id);
    if (error) throw error;

    // Remover de la vista local
    state[collection] = (state[collection] || []).filter(x => x.id !== id);
    // Mantener sincronía
    if(tipo === 'empleado') state.empleados = state.usu_empleados;
    renderPage(pageId);
    
    showLoadingOverlay('hide');
    notify('success', '🗑️', 'Eliminado', `${titulo} borrado del sistema.`);
  } catch (err) {
    showLoadingOverlay('hide');
    notify('danger', '⚠️', 'Error al eliminar', err.message, {duration: 5000});
  }
}
function importarUsuariosCSV(collection, tipo, pageId){
  const input = document.getElementById(pageId+'-file-input');
  if(input) input.click();
}
function descargarPlantilla(tipo){
  const titulos = {cliente:'Clientes', empleado:'Empleados', proveedor:'Proveedores'};
  let csv = '';
  if(tipo === 'cliente'){
    const headers = 'ID EFFI Tipo de identificación,Tipo de identificación,Número de identificación,Nombre,Teléfono 1,Teléfono 2,Celular,WhatsApp,Facetime,Skype,Email,Web,Direcciones,País,Departamento,Ciudad,ID EFFI Ciudad,Dirección,Fecha de nacimiento,Género,Tipo de persona,Régimen tributario,Tipo de cliente,Tipo de marketing,Tarifa de precios,Actividad económica CIIU,Forma de pago,Descuento,Cupo de crédito CXC,Moneda principal,Sucursal,Ruta logística,Vendedor,Responsable asignado,Fecha última venta,Observación,Vigencia,Fecha de creación,Responsable de creación,Fecha de modificación,Responsable de modificación,Fecha de anulación,Responsable de anulación';
    const ejemplo = '2,Cédula de ciudadanía,12345678,María García López,3001234567,,3001234567,3001234567,,,maria@email.com,,,,Antioquia,Medellín,,Calle 10 # 5-20,1990-05-15,,Física (natural),,,,,,,0,0,Peso Colombiano $ COP,,,,,,,Cliente de prueba,Vigente,' + new Date().toISOString().split("T")[0] + ',,,,';
    csv = headers + '\n' + ejemplo;
  } else if(tipo === 'empleado'){
    csv = 'Nombre,Cédula,Celular,Email,Ciudad,Salario Base,Tipo Contrato\nJuan Pérez,12345678,3001234567,juan@email.com,Medellín,1750000,indefinido';
  } else {
    csv = 'Tipo ID,Cédula/NIT,Nombre,Celular,WhatsApp,Email,Ciudad,Departamento,Dirección,Tipo Persona,Observación\nNIT,900123456,Empresa XYZ,3001234567,,info@empresa.com,Medellín,Antioquia,Cra 1 #2-3,Jurídica,';
  }
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `plantilla_${titulos[tipo]||tipo}.csv`; a.click();
  notify('success','⬇','Plantilla descargada','Completa y luego importa el archivo.',{duration:3000});
}

function exportarUsuarios(collection, tipo){
  const items = state[collection] || [];
  if(items.length === 0){ notify('warning','⚠️','Sin datos','No hay registros para exportar.',{duration:3000}); return; }

  const BOM = '\uFEFF';
  const headers = [
    'ID EFFI Tipo de identificación','Tipo de identificación','Número de identificación',
    'Nombre','Teléfono 1','Teléfono 2','Celular','WhatsApp','Facetime','Skype',
    'Email','Web','Direcciones','País','Departamento','Ciudad','ID EFFI Ciudad',
    'Dirección','Fecha de nacimiento','Género','Tipo de persona','Régimen tributario',
    'Tipo de cliente','Tipo de marketing','Tarifa de precios','Actividad económica CIIU',
    'Forma de pago','Descuento','Cupo de crédito CXC','Moneda principal','Sucursal',
    'Ruta logística','Vendedor','Responsable asignado','Fecha última venta','Observación',
    'Vigencia','Fecha de creación','Responsable de creación','Fecha de modificación',
    'Responsable de modificación','Fecha de anulación','Responsable de anulación'
  ];

  const q = (v) => `"${String(v||'').replace(/"/g,'""')}"`;

  const rows = items.map(u => [
    q('2'), q(u.tipoId==='NIT'?'NIT':'Cédula de ciudadanía'),
    q(u.cedula||''), q(u.nombre||''),
    q(u.telefono||u.celular||''), q(''), q(u.celular||''), q(u.whatsapp||''),
    q(''), q(''), q(u.email||''), q(''),
    q(u.departamento&&u.ciudad ? `*Colombia / ${u.departamento} / ${u.ciudad} / ${u.direccion||''}` : ''),
    q('Colombia'), q(u.departamento||''), q(u.ciudad||''), q(''),
    q(u.direccion||''), q(u.fechaNac||''), q(u.genero||''),
    q(u.tipoPersona==='Jurídica'?'Jurídica':'Física (natural)'),
    q(''), q('Común'), q(''), q('Tarifa normal | Mayorista'),
    q(''), q(''), q('0,00'), q('0,00'), q('Peso Colombiano $ COP'),
    q(''), q(''), q(''), q(''), q(''), q(u.observacion||''),
    q('Vigente'), q(u.fechaCreacion||today()), q('VentasHera'), q(''), q(''), q(''), q('')
  ].join(','));

  const csv = BOM + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${tipo}s_VentasHera_${today()}.csv`;
  a.click();
  notify('success','⬆','Exportación exitosa',`${items.length} registros exportados.`,{duration:3000});
}


function procesarArchivoUsuarios(input, collection, tipo, pageId) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      showLoadingOverlay('connecting');
      const raw = e.target.result;

      let rows = []; // Array de arrays de strings

      // Detectar si es HTML (XLS de EFFI/Excel exportado como HTML)
      const isHTML = raw.trim().startsWith('<') || raw.includes('<table') || raw.includes('<tr');

      if(isHTML) {
        // Parsear tabla HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(raw, 'text/html');
        const trs = doc.querySelectorAll('tr');
        trs.forEach(tr => {
          const cells = [...tr.querySelectorAll('th,td')].map(td => td.textContent.trim());
          if(cells.length > 0) rows.push(cells);
        });
      } else {
        // CSV/TSV texto plano
        const text = raw.replace(/^\uFEFF/, '');
        const firstLine = text.split(/\r?\n/)[0];
        const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        lines.forEach(line => {
          if(sep === '\t') {
            rows.push(line.split('\t').map(c => c.trim()));
          } else {
            const cols = [];
            let cur = '', inQ = false;
            for(const ch of (line + sep)) {
              if(ch === '"') { inQ = !inQ; }
              else if(ch === sep && !inQ) { cols.push(cur.trim()); cur = ''; }
              else cur += ch;
            }
            rows.push(cols);
          }
        });
      }

      if(rows.length < 2) throw new Error("Archivo vacío o sin datos.");

      // Detectar fila de encabezados
      const headerRow = rows[0];
      const isEFFI = headerRow.some(h => h.includes('Tipo de identificaci') || h.includes('mero de identificaci') || h.includes('ID EFFI'));

      let importados = 0, duplicados = 0;
      if(!Array.isArray(state[collection])) state[collection] = [];
      const existentes = new Set(state[collection].map(u => u.cedula).filter(Boolean));
      let batch = [];

      for(let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        if(cols.length < 3) continue;

        const clean = (n) => (cols[n]||'').replace(/^"|"$/g,'').trim();

        let u;
        if(isEFFI) {
          // Formato EFFI exacto (43 columnas)
          // 0=ID EFFI tipo, 1=Tipo ID texto, 2=Número ID, 3=Nombre
          // 4=Tel1, 5=Tel2, 6=Celular, 7=WhatsApp, 10=Email
          // 13=País, 14=Departamento, 15=Ciudad, 17=Dirección
          // 18=Fecha nac, 19=Género, 20=Tipo persona, 35=Observación
          const cedula = clean(2);
          const nombre = clean(3);
          if(!nombre) continue;
          if(cedula && existentes.has(cedula)) { duplicados++; continue; }
          u = {
            id: crypto.randomUUID(), tipo, tipoId: 'CC',
            cedula, nombre,
            telefono: clean(4),
            celular: clean(6) || clean(4),
            whatsapp: clean(7),
            email: clean(10),
            departamento: clean(14),
            ciudad: clean(15),
            direccion: clean(17),
            fechaNac: clean(18),
            genero: clean(19),
            tipoPersona: (clean(20)||'').toLowerCase().includes('natural') || (clean(20)||'').toLowerCase().includes('física') ? 'Natural' : 'Jurídica',
            observacion: clean(35),
            fechaCreacion: today()
          };
        } else {
          // Formato simple VentasHera
          const cedula = clean(1);
          const nombre = clean(2);
          if(!nombre) continue;
          if(cedula && existentes.has(cedula)) { duplicados++; continue; }
          u = {
            id: crypto.randomUUID(), tipo, tipoId: clean(0)||'CC',
            cedula, nombre,
            celular: clean(3), whatsapp: clean(4), email: clean(5),
            ciudad: clean(6), departamento: clean(7), direccion: clean(8),
            tipoPersona: clean(9)||'Natural', fechaNac: clean(10),
            observacion: clean(11), fechaCreacion: today()
          };
        }

        state[collection].push(u);
        if(u.cedula) existentes.add(u.cedula);
        importados++;

        if(tipo === 'cliente') {
          batch.push({
            id: u.id, nombre: u.nombre,
            cedula: u.cedula||null, celular: u.celular||null,
            telefono: u.telefono||null, whatsapp: u.whatsapp||null,
            ciudad: u.ciudad||null, direccion: u.direccion||null
          });
        }

        if(batch.length >= 500) {
          try { await supabaseClient.from('customers').upsert(batch, {onConflict:'id'}); }
          catch(ue) { console.warn('Batch upsert:', ue.message); }
          batch = [];
        }
      }

      if(batch.length > 0) {
        try { await supabaseClient.from('customers').upsert(batch, {onConflict:'id'}); }
        catch(ue) { console.warn('Final upsert:', ue.message); }
      }

      input.value = '';
      showLoadingOverlay('hide');
      renderPage(pageId);
      notify('success','📥','Importación exitosa',`${importados} importados · ${duplicados} duplicados omitidos`,{duration:4000});

    } catch(err) {
      showLoadingOverlay('hide');
      console.error('Import error:', err);
      notify('danger','⚠️','Error en importación', err.message, {duration:5000});
    }
  };
  reader.readAsText(file, 'UTF-8');
}
  async function saveDoc(collection, tipo) {
  const fecha = document.getElementById('m-doc-fecha').value || today();
  const cliente = document.getElementById('m-doc-cliente').value.trim();
  const obs = document.getElementById('m-doc-obs').value.trim();
  const refId = document.getElementById('m-doc-ref')?.value || '';
  const items = _docItems.filter(i => i.precio > 0);
  
  if (items.length === 0) { notify('warning','⚠️','Sin ítems','Agrega al menos un ítem.',{duration:3000}); return; }
  
  const subtotal = items.reduce((a,i) => a + (i.cantidad * i.precio), 0);
  const iva = subtotal * 0.19; 
  const total = subtotal + iva;
  
  const consKeys = {cotizaciones:'cotizacion', ordenes_venta:'orden', notas_credito:'nc', notas_debito:'nd', remisiones:'remision', devoluciones:'devolucion', anticipos_clientes:'anticipo'};
  const prefixes = {cotizaciones:'COT', ordenes_venta:'OV', notas_credito:'NC', notas_debito:'ND', remisiones:'REM', devoluciones:'DEV', anticipos_clientes:'ANT'};
  
  const prefix = prefixes[collection] || 'DOC';
  const consKey = consKeys[collection] || 'factura';
  const numero = prefix + '-' + getNextConsec(consKey);
  
  // Objeto JSON completo con la data del documento
  const docData = { id: crypto.randomUUID(), numero, fecha, cliente, items: items.map(i => ({...i})), subtotal, iva, total, estado: 'borrador', observaciones: obs, facturaRef: refId, tipo };

  try {
    showLoadingOverlay('connecting');

    const { error } = await supabaseClient.from('legacy_docs').insert({id:docData.id,tipo,numero:docData.numero,data:docData});

    if (error) throw error;

    // Actualizar el estado local
    if (!state[collection]) state[collection] = [];
    state[collection].push(docData);
    _docItems = [];
    
    saveConfig('consecutivos', state.consecutivos);
    closeModal();
    renderPage(document.querySelector('.page.active')?.id.replace('page-',''));
    showLoadingOverlay('hide');
    notify('success','✅','Documento creado',`${numero} guardado en BD.`,{duration:3000});

  } catch (err) {
    showLoadingOverlay('hide');
    notify('danger','⚠️','Error al crear documento', err.message);
  }
}

