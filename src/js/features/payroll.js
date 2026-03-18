// ===================================================================
// ===== NÃ“MINA =====
// ===================================================================
function renderNomAusencias(){
  const items=[...(state.nom_ausencias||[])].reverse();
  document.getElementById('nom_ausencias-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openNomAusenciaModal()">+ Nueva Ausencia</button>
    <div class="card"><div class="card-title">AUSENCIAS LABORALES (${items.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Empleado</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th>DÃ­as</th><th>Estado</th><th></th></tr></thead><tbody>
    ${items.map(a=>`<tr><td>${a.empleado}</td><td><span class="badge badge-warn">${a.tipo}</span></td><td>${formatDate(a.desde)}</td><td>${formatDate(a.hasta)}</td><td style="font-weight:700">${a.dias}</td><td><span class="badge ${a.aprobada?'badge-ok':'badge-pend'}">${a.aprobada?'Aprobada':'Pendiente'}</span></td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_ausencias','${a.id}','nom_ausencias')">âœ•</button></td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin ausencias</td></tr>'}
    </tbody></table></div></div>`;
}

function openNomAusenciaModal(){
  openModal(`
    <div class="modal-title">Nueva Ausencia<button class="modal-close" onclick="closeModal()">Ã—</button></div>
    <div class="form-group"><label class="form-label">EMPLEADO</label><input class="form-control" id="m-na-emp" placeholder="Nombre del empleado"></div>
    <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-na-tipo"><option value="Vacaciones">Vacaciones</option><option value="Incapacidad">Incapacidad</option><option value="Licencia">Licencia</option><option value="Permiso">Permiso</option><option value="Maternidad">Maternidad</option><option value="Calamidad">Calamidad</option></select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">DESDE</label><input type="date" class="form-control" id="m-na-desde" value="${today()}"></div>
      <div class="form-group"><label class="form-label">HASTA</label><input type="date" class="form-control" id="m-na-hasta" value="${today()}"></div>
    </div>
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="m-na-obs" rows="2"></textarea></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveNomAusencia()">Guardar Ausencia</button>
  `);
}

function saveNomAusencia(){
  const emp=document.getElementById('m-na-emp').value.trim();if(!emp)return;
  const desde=document.getElementById('m-na-desde').value;const hasta=document.getElementById('m-na-hasta').value;
  const dias=Math.max(1,Math.round((new Date(hasta)-new Date(desde))/86400000)+1);
  const aus={id:uid(),empleado:emp,tipo:document.getElementById('m-na-tipo').value,desde,hasta,dias,observaciones:document.getElementById('m-na-obs').value.trim(),aprobada:false};
  state.nom_ausencias.push(aus);
  saveRecord('nom_ausencias',aus.id,aus);
  closeModal();renderNomAusencias();notify('success','âœ…','Ausencia registrada',emp+' Â· '+dias+' dÃ­as',{duration:3000});
}

function renderNomAnticipos(){
  const items=[...(state.nom_anticipos||[])].reverse();
  document.getElementById('nom_anticipos-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openSimpleFormModal('nom_anticipos','Anticipo de NÃ³mina',['empleado:text:EMPLEADO','valor:number:VALOR','fecha:date:FECHA','motivo:text:MOTIVO'])">+ Nuevo Anticipo</button>
    <div class="card"><div class="card-title">ANTICIPOS DE NÃ“MINA (${items.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Empleado</th><th>Valor</th><th>Motivo</th><th></th></tr></thead><tbody>
    ${items.map(a=>`<tr><td>${formatDate(a.fecha)}</td><td>${a.empleado}</td><td style="color:var(--accent);font-weight:700">${fmt(a.valor||0)}</td><td>${a.motivo||'â€”'}</td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_anticipos','${a.id}','nom_anticipos')">âœ•</button></td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:24px">Sin anticipos</td></tr>'}
    </tbody></table></div></div>`;
}

function renderNomConceptos(){
  const items=state.nom_conceptos||[];
  document.getElementById('nom_conceptos-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openConceptoModal()">+ Nuevo Concepto</button>
    <div class="card"><div class="card-title">CONCEPTOS DE NÃ“MINA</div>
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>FÃ³rmula</th><th>Valor</th><th></th></tr></thead><tbody>
    ${items.map(c=>`<tr><td style="font-weight:700">${c.nombre}</td><td><span class="badge ${c.tipo==='devengo'?'badge-ok':'badge-pend'}">${c.tipo}</span></td><td>${c.formula}</td><td>${c.formula==='porcentaje'?c.valor+'%':fmt(c.valor)}</td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_conceptos','${c.id}','nom_conceptos')">âœ•</button></td></tr>`).join('')}
    </tbody></table></div></div>`;
}

function openConceptoModal(){
  openModal(`
    <div class="modal-title">Nuevo Concepto<button class="modal-close" onclick="closeModal()">Ã—</button></div>
    <div class="form-group"><label class="form-label">NOMBRE</label><input class="form-control" id="m-nc-nombre" placeholder="Ej: Horas Extra"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-nc-tipo"><option value="devengo">Devengo</option><option value="deduccion">DeducciÃ³n</option></select></div>
      <div class="form-group"><label class="form-label">FÃ“RMULA</label><select class="form-control" id="m-nc-formula"><option value="fijo">Valor Fijo</option><option value="porcentaje">Porcentaje sobre salario</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">VALOR</label><input type="number" class="form-control" id="m-nc-valor" placeholder="0"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveConcepto()">Guardar</button>
  `);
}

function saveConcepto(){
  const nombre=document.getElementById('m-nc-nombre').value.trim();if(!nombre)return;
  const conc={id:uid(),nombre,tipo:document.getElementById('m-nc-tipo').value,formula:document.getElementById('m-nc-formula').value,valor:parseFloat(document.getElementById('m-nc-valor').value)||0};
  state.nom_conceptos.push(conc);
  saveRecord('nom_conceptos',conc.id,conc);
  closeModal();renderNomConceptos();
}

// ===================================================================
// ===== NÃ“MINA COLOMBIA - MÃ“DULO COMPLETO =====
// ===================================================================

// Constantes legales Colombia 2025
const SMMLV_2025 = 1423500;
const AUX_TRANSPORTE_2025 = 200000;
const UVT_2025 = 47065;

// Porcentajes PILA empleado
const PILA_EMP = { salud: 0.04, pension: 0.04 };
// Porcentajes PILA empleador
const PILA_EMP_ADOR = { salud: 0.0850, pension: 0.12, arl: 0.00522, caja: 0.04 };
// Provisiones empleador
const PROV = { prima: 1/12, cesantias: 1/12, intCesantias: 0.12/12, vacaciones: 1/24 };

function calcNomina(cfg) {
  // cfg: { salario, diasTrabajados, diasPeriodo, ausenciasNoPagas, incapacidades,
  //        anticipos, otrosDevengos, otrasDeducc, tipo ('quincenal'|'mensual'|'vacaciones'|'prima'|'cesantias'|'liquidacion') }
  const {
    salario = SMMLV_2025,
    diasTrabajados = 15,
    diasPeriodo = 15,
    ausenciasNoPagas = 0,
    incapacidades = 0, // dÃ­as incapacidad
    anticipos = 0,
    otrosDevengos = 0,
    otrasDeducc = 0,
    tipo = 'quincenal',
    diasVacaciones = 0,
    diasCesantias = 0,
    periodosLiquidar = 0 // para liquidaciÃ³n completa
  } = cfg;

  const salarioDia = salario / 30;
  const auxTransDia = (salario <= 2 * SMMLV_2025) ? AUX_TRANSPORTE_2025 / 30 : 0;
  const tieneAuxTrans = salario <= 2 * SMMLV_2025;

  let resultado = {};

  if (tipo === 'quincenal' || tipo === 'mensual') {
    const dp = tipo === 'quincenal' ? 15 : 30;
    const diasEfectivos = Math.max(0, dp - ausenciasNoPagas);
    const salarioBase = salarioDia * diasEfectivos;
    const auxTrans = tieneAuxTrans ? (auxTransDia * diasEfectivos) : 0;
    // Incapacidad: EPS paga 2/3 desde dÃ­a 3
    const valorIncap = incapacidades > 0 ? (salarioDia * incapacidades * (2/3)) : 0;
    const totalDevengado = salarioBase + auxTrans + otrosDevengos + valorIncap;

    const deducSalud = totalDevengado * PILA_EMP.salud;
    const deducPension = totalDevengado * PILA_EMP.pension;
    const totalDeducc = deducSalud + deducPension + anticipos + otrasDeducc;
    const neto = Math.max(0, totalDevengado - totalDeducc);

    // Costos empleador
    const costoSalud = salarioBase * PILA_EMP_ADOR.salud;
    const costoPension = salarioBase * PILA_EMP_ADOR.pension;
    const costoArl = salarioBase * PILA_EMP_ADOR.arl;
    const costoCaja = salarioBase * PILA_EMP_ADOR.caja;
    // Provisiones
    const provPrima = (salarioBase + auxTrans) * PROV.prima;
    const provCes = (salarioBase + auxTrans) * PROV.cesantias;
    const provIntCes = provCes * (PROV.intCesantias * 12);
    const provVac = salarioBase * PROV.vacaciones;
    const costoTotal = totalDevengado + costoSalud + costoPension + costoArl + costoCaja + provPrima + provCes + provIntCes + provVac;

    resultado = {
      tipo, diasEfectivos, salarioBase, auxTrans, valorIncap, otrosDevengos,
      totalDevengado, deducSalud, deducPension, anticipos, otrasDeducc,
      totalDeducc, neto,
      empleador: { costoSalud, costoPension, costoArl, costoCaja, provPrima, provCes, provIntCes, provVac, costoTotal }
    };

  } else if (tipo === 'vacaciones') {
    // Vacaciones: salario/30 Ã— dÃ­as (15 dÃ­as por aÃ±o trabajado)
    const valorVac = salarioDia * diasVacaciones;
    resultado = { tipo, diasVacaciones, salarioBase: valorVac, totalDevengado: valorVac, neto: valorVac };

  } else if (tipo === 'prima') {
    // Prima: (salario + auxTransporte) / 12 Ã— meses trabajados (mÃ¡x 6 por semestre)
    const meses = diasCesantias / 30;
    const base = salario + (tieneAuxTrans ? AUX_TRANSPORTE_2025 : 0);
    const valor = (base / 12) * meses;
    resultado = { tipo, meses, base, valor, totalDevengado: valor, neto: valor };

  } else if (tipo === 'cesantias') {
    // CesantÃ­as: salario Ã— dÃ­as / 360
    const base = salario + (tieneAuxTrans ? AUX_TRANSPORTE_2025 : 0);
    const valor = (base * diasCesantias) / 360;
    const intCes = valor * 0.12 * (diasCesantias / 365);
    resultado = { tipo, diasCesantias, base, valor, intCes, totalDevengado: valor + intCes, neto: valor + intCes };

  } else if (tipo === 'liquidacion') {
    // LiquidaciÃ³n completa al terminar contrato
    const diasTrab = periodosLiquidar; // dÃ­as totales trabajados
    const cesan = (salario + (tieneAuxTrans ? AUX_TRANSPORTE_2025 : 0)) * diasTrab / 360;
    const intCes = cesan * 0.12 * (diasTrab / 365);
    const prima = (salario + (tieneAuxTrans ? AUX_TRANSPORTE_2025 : 0)) / 12 * (diasTrab / 30);
    const vac = salarioDia * (diasTrab / 720) * 15;
    const total = cesan + intCes + prima + vac;
    resultado = { tipo, diasTrab, cesan, intCes, prima, vac, totalDevengado: total, neto: total };
  }

  return resultado;
}

function renderNomNominas(){
  const items=[...(state.nom_nominas||[])].reverse();
  document.getElementById('nom_nominas-content').innerHTML=`
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn btn-primary" onclick="openLiquidacionModal('quincenal')">ðŸ’° Nueva Quincena</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('mensual')">ðŸ“… NÃ³mina Mensual</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('prima')">ðŸŽ Prima</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('cesantias')">ðŸ¦ CesantÃ­as</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('vacaciones')">ðŸŒ´ Vacaciones</button>
      <button class="btn btn-warning" onclick="openLiquidacionModal('liquidacion')">ðŸ“‹ LiquidaciÃ³n</button>
    </div>
    <div class="card"><div class="card-title">NÃ“MINAS LABORALES (${items.length})</div>
    <div class="table-wrap"><table><thead><tr>
      <th>#</th><th>Tipo</th><th>Periodo</th><th>Empleado</th>
      <th>Devengado</th><th>Deducciones</th><th>Neto</th><th>Estado</th><th></th>
    </tr></thead><tbody>
    ${items.map(n=>`<tr>
      <td style="font-weight:700">${n.numero||'â€”'}</td>
      <td><span class="badge badge-info">${(n.tipo||'quincena').toUpperCase()}</span></td>
      <td>${n.periodo||'â€”'}</td>
      <td>${n.empleado||'â€”'}</td>
      <td style="color:var(--green)">${fmt(n.devengado||0)}</td>
      <td style="color:var(--red)">${fmt(n.deducciones||0)}</td>
      <td style="color:var(--accent);font-weight:700">${fmt(n.neto||0)}</td>
      <td><span class="badge ${n.pagada?'badge-ok':'badge-warn'}">${n.pagada?'Pagada':'Pendiente'}</span></td>
      <td><div class="btn-group">
        <button class="btn btn-xs btn-secondary" onclick="verNomina('${n.id}')">ðŸ‘</button>
        <button class="btn btn-xs btn-secondary" onclick="imprimirNomina('${n.id}')">ðŸ–¨</button>
        ${!n.pagada?`<button class="btn btn-xs btn-primary" onclick="pagarNomina('${n.id}')">ðŸ’° Pagar</button>`:''}
        <button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_nominas','${n.id}','nom_nominas')">âœ•</button>
      </div></td>
    </tr>`).join('')||'<tr><td colspan="9" style="text-align:center;color:var(--text2);padding:24px">Sin nÃ³minas</td></tr>'}
    </tbody></table></div></div>`;
}

function openLiquidacionModal(tipo){
  const empleados = state.empleados || [];
  const ausencias = state.nom_ausencias || [];
  const anticiposNom = state.nom_anticipos || [];
  const tipoLabel = {quincenal:'NÃ³mina Quincenal',mensual:'NÃ³mina Mensual',prima:'LiquidaciÃ³n Prima',cesantias:'CesantÃ­as + Intereses',vacaciones:'LiquidaciÃ³n Vacaciones',liquidacion:'LiquidaciÃ³n Contrato'};

  const empOptions = empleados.length > 0
    ? empleados.map(e=>`<option value="${e.id}" data-salario="${e.salarioBase||e.salario_base||SMMLV_2025}">${e.nombre}</option>`).join('')
    : `<option value="">â€” Primero crea empleados â€”</option>`;

  const hoy = today();
  const [y, m] = hoy.split('-');
  const quincena1Desde = `${y}-${m}-01`;
  const quincena1Hasta = `${y}-${m}-15`;
  const quincena2Desde = `${y}-${m}-16`;
  const quincena2Hasta = `${y}-${m}-${new Date(y, m, 0).getDate()}`;

  let extraFields = '';
  if(tipo === 'quincenal') {
    extraFields = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">QUINCENA</label>
          <select class="form-control" id="nom-quincena" onchange="autoFillPeriodo()">
            <option value="1" data-desde="${quincena1Desde}" data-hasta="${quincena1Hasta}">1Âª Quincena (1-15)</option>
            <option value="2" data-desde="${quincena2Desde}" data-hasta="${quincena2Hasta}">2Âª Quincena (16-${new Date(y, m, 0).getDate()})</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">DÃAS AUSENTISMO NO PAGOS</label>
          <input type="number" class="form-control" id="nom-ausencias" value="0" min="0" max="15" oninput="calcularPreviewNomina()"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">DÃAS INCAPACIDAD</label>
          <input type="number" class="form-control" id="nom-incap" value="0" min="0" oninput="calcularPreviewNomina()"></div>
        <div class="form-group"><label class="form-label">OTROS DEVENGOS ($)</label>
          <input type="number" class="form-control" id="nom-otros-dev" value="0" min="0" oninput="calcularPreviewNomina()"></div>
      </div>`;
  } else if(tipo === 'mensual') {
    extraFields = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">DÃAS AUSENTISMO NO PAGOS</label>
          <input type="number" class="form-control" id="nom-ausencias" value="0" min="0" oninput="calcularPreviewNomina()"></div>
        <div class="form-group"><label class="form-label">DÃAS INCAPACIDAD</label>
          <input type="number" class="form-control" id="nom-incap" value="0" min="0" oninput="calcularPreviewNomina()"></div>
      </div>`;
  } else if(tipo === 'vacaciones') {
    extraFields = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">DÃAS DE VACACIONES</label>
          <input type="number" class="form-control" id="nom-dias-vac" value="15" min="1" oninput="calcularPreviewNomina()"></div>
        <div class="form-group"><label class="form-label">FECHA INICIO VACACIONES</label>
          <input type="date" class="form-control" id="nom-inicio-vac" value="${hoy}"></div>
      </div>`;
  } else if(tipo === 'prima' || tipo === 'cesantias') {
    extraFields = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">DÃAS A LIQUIDAR</label>
          <input type="number" class="form-control" id="nom-dias-ces" value="180" min="1" oninput="calcularPreviewNomina()"></div>
        <div class="form-group"><label class="form-label">PERIODO</label>
          <input class="form-control" id="nom-periodo-ces" placeholder="Ej: Ene-Jun 2025" value="Ene-Jun ${y}"></div>
      </div>`;
  } else if(tipo === 'liquidacion') {
    extraFields = `
      <div class="form-row">
        <div class="form-group"><label class="form-label">DÃAS TOTALES TRABAJADOS</label>
          <input type="number" class="form-control" id="nom-dias-liq" value="360" min="1" oninput="calcularPreviewNomina()"></div>
        <div class="form-group"><label class="form-label">FECHA RETIRO</label>
          <input type="date" class="form-control" id="nom-fecha-retiro" value="${hoy}"></div>
      </div>`;
  }

  openModal(`
    <div class="modal-title">${tipoLabel[tipo]||tipo}<button class="modal-close" onclick="closeModal()">Ã—</button></div>
    <div style="max-height:75vh;overflow-y:auto;padding-right:8px">

      <div class="form-row">
        <div class="form-group"><label class="form-label">EMPLEADO *</label>
          <select class="form-control" id="nom-empleado" onchange="onNomEmpleadoChange()">
            <option value="">â€” Seleccionar â€”</option>${empOptions}
          </select></div>
        <div class="form-group"><label class="form-label">SALARIO BASE ($)</label>
          <input type="number" class="form-control" id="nom-salario" value="${SMMLV_2025}" oninput="calcularPreviewNomina()">
          <span style="font-size:10px;color:var(--text2)">SMMLV 2025: ${fmt(SMMLV_2025)}</span></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label class="form-label">PERIODO</label>
          <input class="form-control" id="nom-periodo" value="${tipo==='quincenal'?'1-15 '+new Date().toLocaleDateString('es-CO',{month:'long',year:'numeric'}):new Date().toLocaleDateString('es-CO',{month:'long',year:'numeric'})}"></div>
        <div class="form-group"><label class="form-label">ANTICIPOS DESCONTAR ($)</label>
          <input type="number" class="form-control" id="nom-anticipos-val" value="0" min="0" oninput="calcularPreviewNomina()">
          <span style="font-size:10px;color:var(--accent);cursor:pointer" onclick="cargarAnticiposEmpleado()">â†™ Cargar anticipos pendientes</span></div>
      </div>

      ${extraFields}

      <div class="form-group"><label class="form-label">OTRAS DEDUCCIONES ($)</label>
        <input type="number" class="form-control" id="nom-otras-deducc" value="0" min="0" oninput="calcularPreviewNomina()"></div>

      <!-- RESUMEN CALCULADO -->
      <div id="nom-preview" style="background:rgba(0,229,180,.06);border:1px solid rgba(0,229,180,.2);border-radius:12px;padding:16px;margin-top:12px">
        <div style="font-family:Syne;font-size:12px;font-weight:700;color:var(--accent);margin-bottom:10px">ðŸ“Š RESUMEN LIQUIDACIÃ“N</div>
        <div id="nom-preview-content" style="font-size:12px">Selecciona un empleado para calcular...</div>
      </div>

    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-secondary" style="flex:1" onclick="calcularPreviewNomina()">ðŸ”„ Recalcular</button>
      <button class="btn btn-primary" style="flex:1" onclick="guardarNomina('${tipo}')">ðŸ’¾ Guardar LiquidaciÃ³n</button>
    </div>
  `, true);

  window._nomTipo = tipo;
  setTimeout(() => calcularPreviewNomina(), 100);
}

function onNomEmpleadoChange() {
  const sel = document.getElementById('nom-empleado');
  const opt = sel.options[sel.selectedIndex];
  const salario = opt?.getAttribute('data-salario');
  if(salario) {
    document.getElementById('nom-salario').value = salario;
    cargarAnticiposEmpleado();
  }
  calcularPreviewNomina();
}

function autoFillPeriodo() {
  const sel = document.getElementById('nom-quincena');
  const opt = sel?.options[sel.selectedIndex];
  if(!opt) return;
  const q = sel.value;
  const [y, m] = today().split('-');
  const mNom = new Date(y, parseInt(m)-1, 1).toLocaleDateString('es-CO',{month:'long'});
  document.getElementById('nom-periodo').value = q === '1'
    ? `1-15 ${mNom} ${y}` : `16-${new Date(y, m, 0).getDate()} ${mNom} ${y}`;
  calcularPreviewNomina();
}

function cargarAnticiposEmpleado() {
  const empId = document.getElementById('nom-empleado')?.value;
  if(!empId) return;
  const emp = (state.empleados||[]).find(e => e.id === empId);
  if(!emp) return;
  const anticiposPend = (state.nom_anticipos||[])
    .filter(a => (a.empleado_nombre||a.empleado||'').toLowerCase() === (emp.nombre||'').toLowerCase())
    .reduce((sum, a) => sum + (parseFloat(a.valor)||0), 0);
  if(anticiposPend > 0) {
    document.getElementById('nom-anticipos-val').value = anticiposPend;
    calcularPreviewNomina();
    notify('success','ðŸ’°',`Anticipos: ${fmt(anticiposPend)}`,'Cargados automÃ¡ticamente',{duration:2000});
  }
}

function calcularPreviewNomina() {
  const tipo = window._nomTipo || 'quincenal';
  const salario = parseFloat(document.getElementById('nom-salario')?.value) || SMMLV_2025;
  const anticipos = parseFloat(document.getElementById('nom-anticipos-val')?.value) || 0;
  const otrasDeducc = parseFloat(document.getElementById('nom-otras-deducc')?.value) || 0;
  const ausencias = parseFloat(document.getElementById('nom-ausencias')?.value) || 0;
  const incap = parseFloat(document.getElementById('nom-incap')?.value) || 0;
  const otrosDevengos = parseFloat(document.getElementById('nom-otros-dev')?.value) || 0;
  const diasVac = parseFloat(document.getElementById('nom-dias-vac')?.value) || 15;
  const diasCes = parseFloat(document.getElementById('nom-dias-ces')?.value) || 180;
  const diasLiq = parseFloat(document.getElementById('nom-dias-liq')?.value) || 360;

  const cfg = { salario, anticipos, otrasDeducc, tipo,
    ausenciasNoPagas: ausencias, incapacidades: incap,
    otrosDevengos, diasVacaciones: diasVac, diasCesantias: diasCes, periodosLiquidar: diasLiq };

  try {
    const r = calcNomina(cfg);
    window._nomResult = r;
    renderNominaPreview(r, tipo);
  } catch(e) {
    document.getElementById('nom-preview-content').innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
  }
}

function renderNominaPreview(r, tipo) {
  const el = document.getElementById('nom-preview-content');
  if(!el) return;

  const fmtR = (n) => `<span style="font-weight:700">${fmt(Math.round(n||0))}</span>`;
  const row = (label, val, color='') => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="color:var(--text2)">${label}</span>${color?`<span style="color:${color};font-weight:700">${fmt(Math.round(val||0))}</span>`:fmtR(val)}</div>`;

  let html = '';

  if(tipo === 'quincenal' || tipo === 'mensual') {
    html = `
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">DEVENGADO</div>
      ${row(`Salario (${r.diasEfectivos} dÃ­as)`, r.salarioBase, 'var(--green)')}
      ${r.auxTrans > 0 ? row('Aux. Transporte', r.auxTrans, 'var(--green)') : ''}
      ${r.valorIncap > 0 ? row('Incapacidad (EPS 2/3)', r.valorIncap, 'var(--yellow)') : ''}
      ${r.otrosDevengos > 0 ? row('Otros devengos', r.otrosDevengos, 'var(--green)') : ''}
      ${row('TOTAL DEVENGADO', r.totalDevengado, 'var(--green)')}
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin:8px 0 4px">DEDUCCIONES</div>
      ${row('Salud empleado (4%)', r.deducSalud, 'var(--red)')}
      ${row('PensiÃ³n empleado (4%)', r.deducPension, 'var(--red)')}
      ${r.anticipos > 0 ? row('Anticipos', r.anticipos, 'var(--red)') : ''}
      ${r.otrasDeducc > 0 ? row('Otras deducciones', r.otrasDeducc, 'var(--red)') : ''}
      ${row('TOTAL DEDUCCIONES', r.totalDeducc, 'var(--red)')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px">
        <span style="font-family:Syne;font-weight:800;font-size:14px">NETO A PAGAR</span>
        <span style="font-family:Syne;font-weight:800;font-size:16px;color:var(--accent)">${fmt(Math.round(r.neto))}</span>
      </div>
      ${r.empleador ? `
      <details style="margin-top:10px">
        <summary style="font-size:11px;color:var(--text2);cursor:pointer">ðŸ“Š Ver costos empleador (no se descuentan al empleado)</summary>
        <div style="margin-top:8px;font-size:11px">
          ${row('Salud empleador (8.5%)', r.empleador.costoSalud)}
          ${row('PensiÃ³n empleador (12%)', r.empleador.costoPension)}
          ${row('ARL (0.522%)', r.empleador.costoArl)}
          ${row('Caja compensaciÃ³n (4%)', r.empleador.costoCaja)}
          ${row('ProvisiÃ³n prima', r.empleador.provPrima)}
          ${row('ProvisiÃ³n cesantÃ­as', r.empleador.provCes)}
          ${row('ProvisiÃ³n int. cesantÃ­as', r.empleador.provIntCes)}
          ${row('ProvisiÃ³n vacaciones', r.empleador.provVac)}
          ${row('COSTO TOTAL EMPLEADOR', r.empleador.costoTotal, 'var(--orange)')}
        </div>
      </details>` : ''}`;

  } else if(tipo === 'vacaciones') {
    html = `${row(`Vacaciones (${r.diasVacaciones} dÃ­as)`, r.salarioBase, 'var(--green)')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px">
        <span style="font-family:Syne;font-weight:800">VALOR VACACIONES</span>
        <span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span>
      </div>`;
  } else if(tipo === 'prima') {
    html = `${row(`Base (${r.meses?.toFixed(1)} meses)`, r.base)}
      ${row('Prima semestral', r.valor, 'var(--green)')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px">
        <span style="font-family:Syne;font-weight:800">PRIMA A PAGAR</span>
        <span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span>
      </div>`;
  } else if(tipo === 'cesantias') {
    html = `${row(`CesantÃ­as (${r.diasCesantias} dÃ­as)`, r.valor, 'var(--green)')}
      ${row('Intereses cesantÃ­as (12%)', r.intCes, 'var(--green)')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px">
        <span style="font-family:Syne;font-weight:800">CESANTÃAS + INTERESES</span>
        <span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span>
      </div>`;
  } else if(tipo === 'liquidacion') {
    html = `<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">LIQUIDACIÃ“N CONTRATO</div>
      ${row(`CesantÃ­as (${r.diasTrab} dÃ­as)`, r.cesan, 'var(--green)')}
      ${row('Intereses cesantÃ­as', r.intCes, 'var(--green)')}
      ${row('Prima proporcional', r.prima, 'var(--green)')}
      ${row('Vacaciones proporcionales', r.vac, 'var(--green)')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px">
        <span style="font-family:Syne;font-weight:800;font-size:14px">TOTAL LIQUIDACIÃ“N</span>
        <span style="font-family:Syne;font-weight:800;font-size:16px;color:var(--accent)">${fmt(Math.round(r.neto))}</span>
      </div>`;
  }

  el.innerHTML = html;
}

async function guardarNomina(tipo) {
  const empSel = document.getElementById('nom-empleado');
  const empNombre = empSel?.options[empSel.selectedIndex]?.text || 'Empleado';
  if(!empNombre || empNombre === 'â€” Seleccionar â€”') {
    notify('warning','âš ï¸','Selecciona un empleado','',{duration:3000}); return;
  }
  const periodo = document.getElementById('nom-periodo')?.value || today();
  const r = window._nomResult;
  if(!r) { notify('warning','âš ï¸','Primero recalcula','',{duration:3000}); return; }

  const nomina = {
    id: uid(),
    numero: 'NOM-' + String((state.nom_nominas||[]).length + 1).padStart(4,'0'),
    tipo, empleado: empNombre,
    periodo, salario: parseFloat(document.getElementById('nom-salario')?.value)||SMMLV_2025,
    devengado: r.totalDevengado || 0,
    deducciones: r.totalDeducc || 0,
    neto: r.neto || 0,
    detalles: r,
    pagada: false, fecha: today()
  };

  if(!state.nom_nominas) state.nom_nominas = [];
  state.nom_nominas.push(nomina);
  await saveRecord('nom_nominas', nomina.id, nomina);

  closeModal();
  renderNomNominas();
  notify('success','âœ…','NÃ³mina guardada', `${empNombre} Â· ${fmt(nomina.neto)}`, {duration:3000});
}

function verNomina(id) {
  const n = (state.nom_nominas||[]).find(x => x.id === id);
  if(!n) return;
  const r = n.detalles || {};
  window._nomResult = r;
  window._nomTipo = n.tipo;

  // Mostrar resumen en modal
  let preview = '';
  renderNominaPreview(r, n.tipo);

  const tipoLabel = {quincenal:'NÃ³mina Quincenal',mensual:'NÃ³mina Mensual',prima:'Prima',cesantias:'CesantÃ­as',vacaciones:'Vacaciones',liquidacion:'LiquidaciÃ³n'};

  openModal(`
    <div class="modal-title">${n.numero} Â· ${tipoLabel[n.tipo]||n.tipo}<button class="modal-close" onclick="closeModal()">Ã—</button></div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">
      <b>${n.empleado}</b> Â· ${n.periodo} Â· ${n.fecha}
    </div>
    <div id="nom-preview-content"></div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-secondary" style="flex:1" onclick="imprimirNomina('${id}')">ðŸ–¨ Imprimir PDF</button>
      ${!n.pagada?`<button class="btn btn-primary" style="flex:1" onclick="closeModal();pagarNomina('${id}')">ðŸ’° Pagar</button>`:''}
    </div>
  `);
  setTimeout(() => renderNominaPreview(r, n.tipo), 50);
}

function imprimirNomina(id) {
  const n = (state.nom_nominas||[]).find(x => x.id === id);
  if(!n) return;
  const emp = state.empresa || {};
  const r = n.detalles || {};
  const tipoLabel = {quincenal:'NÃ“MINA QUINCENAL',mensual:'NÃ“MINA MENSUAL',prima:'LIQUIDACIÃ“N PRIMA',cesantias:'CESANTÃAS E INTERESES',vacaciones:'LIQUIDACIÃ“N VACACIONES',liquidacion:'LIQUIDACIÃ“N CONTRATO'};

  const row = (label, val, bold=false, color='#000') =>
    val > 0 ? `<tr><td style="padding:4px 8px">${label}</td><td style="text-align:right;padding:4px 8px;color:${color};${bold?'font-weight:900':''}">${Math.round(val).toLocaleString('es-CO')}</td></tr>` : '';

  const detallesHTML = n.tipo === 'quincenal' || n.tipo === 'mensual' ? `
    <tr style="background:#f5f5f5"><th colspan="2" style="padding:6px 8px;text-align:left">DEVENGADO</th></tr>
    ${row(`Salario bÃ¡sico (${r.diasEfectivos} dÃ­as hÃ¡biles)`, r.salarioBase)}
    ${row('Auxilio de transporte', r.auxTrans)}
    ${row('Subsidio incapacidad (EPS)', r.valorIncap)}
    ${row('Otros devengos', r.otrosDevengos)}
    <tr style="background:#e8f5e9"><td style="padding:6px 8px;font-weight:700">TOTAL DEVENGADO</td><td style="text-align:right;padding:6px 8px;font-weight:700;color:green">${Math.round(r.totalDevengado||0).toLocaleString('es-CO')}</td></tr>
    <tr style="background:#f5f5f5"><th colspan="2" style="padding:6px 8px;text-align:left">DEDUCCIONES</th></tr>
    ${row('Aporte salud empleado (4%)', r.deducSalud)}
    ${row('Aporte pensiÃ³n empleado (4%)', r.deducPension)}
    ${row('Anticipos de nÃ³mina', r.anticipos)}
    ${row('Otras deducciones', r.otrasDeducc)}
    <tr style="background:#ffebee"><td style="padding:6px 8px;font-weight:700">TOTAL DEDUCCIONES</td><td style="text-align:right;padding:6px 8px;font-weight:700;color:red">${Math.round(r.totalDeducc||0).toLocaleString('es-CO')}</td></tr>
  ` : n.tipo === 'liquidacion' ? `
    ${row('CesantÃ­as', r.cesan)}
    ${row('Intereses a las cesantÃ­as', r.intCes)}
    ${row('Prima de servicios proporcional', r.prima)}
    ${row('Vacaciones proporcionales', r.vac)}
  ` : n.tipo === 'cesantias' ? `
    ${row(`CesantÃ­as (${r.diasCesantias} dÃ­as)`, r.valor)}
    ${row('Intereses a las cesantÃ­as (12%)', r.intCes)}
  ` : n.tipo === 'prima' ? `
    ${row(`Prima semestral (${r.meses?.toFixed(1)} meses)`, r.valor)}
  ` : `
    ${row(`Vacaciones (${r.diasVacaciones} dÃ­as)`, r.salarioBase)}
  `;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;font-size:11px;color:#000;margin:20px}
    .header{text-align:center;margin-bottom:16px;border-bottom:2px solid #000;padding-bottom:12px}
    table{width:100%;border-collapse:collapse;margin-bottom:12px}
    th,td{border:1px solid #ddd;padding:4px 8px}
    th{background:#f0f0f0}
    .neto{font-size:16px;font-weight:900;text-align:right;padding:8px;background:#e8f5e9;border:2px solid #4caf50;border-radius:4px;margin-top:8px}
    .firma{margin-top:40px;display:flex;justify-content:space-between}
    .firma-box{text-align:center;width:45%}
    .firma-line{border-top:1px solid #000;margin-top:30px;padding-top:4px}
    @media print{button{display:none}}
  </style></head><body>
  <button onclick="window.print()" style="margin-bottom:12px;padding:8px 16px;background:#00e5b4;border:none;border-radius:6px;cursor:pointer;font-weight:700">ðŸ–¨ Imprimir / Guardar PDF</button>
  <div class="header">
    ${emp.logoBase64?`<img src="${emp.logoBase64}" style="height:50px;margin-bottom:8px"><br>`:''}
    <div style="font-size:16px;font-weight:900">${emp.nombre||'EMPRESA'}</div>
    <div>NIT: ${emp.nit||''} | ${emp.ciudad||''}</div>
    <div style="font-size:14px;font-weight:700;margin-top:8px">${tipoLabel[n.tipo]||'NÃ“MINA'}</div>
  </div>
  <table>
    <tr><th>Empleado</th><td><b>${n.empleado}</b></td><th>NÂ° LiquidaciÃ³n</th><td>${n.numero}</td></tr>
    <tr><th>Periodo</th><td>${n.periodo}</td><th>Fecha</th><td>${n.fecha}</td></tr>
    <tr><th>Salario base</th><td>${Math.round(n.salario||0).toLocaleString('es-CO')}</td><th>Tipo contrato</th><td>Indefinido</td></tr>
  </table>
  <table>${detallesHTML}</table>
  <div class="neto">NETO A PAGAR: $ ${Math.round(n.neto||0).toLocaleString('es-CO')}</div>
  ${r.empleador?`
  <div style="margin-top:16px;font-size:10px;color:#666;border-top:1px dashed #ccc;padding-top:8px">
    <b>InformaciÃ³n para el empleador (no afecta el neto del empleado):</b><br>
    Salud empleador: $${Math.round(r.empleador.costoSalud||0).toLocaleString('es-CO')} |
    PensiÃ³n: $${Math.round(r.empleador.costoPension||0).toLocaleString('es-CO')} |
    ARL: $${Math.round(r.empleador.costoArl||0).toLocaleString('es-CO')} |
    Caja: $${Math.round(r.empleador.costoCaja||0).toLocaleString('es-CO')}<br>
    <b>Costo total del empleado para la empresa: $${Math.round(r.empleador.costoTotal||0).toLocaleString('es-CO')}</b>
  </div>`:''}
  <div class="firma">
    <div class="firma-box"><div class="firma-line">Firma Empleador</div></div>
    <div class="firma-box"><div class="firma-line">Firma Empleado: ${n.empleado}</div></div>
  </div>
  <div style="margin-top:20px;font-size:9px;color:#999;text-align:center">
    Generado por VentasHera ERP Â· ${today()} Â· SMMLV 2025: $${SMMLV_2025.toLocaleString('es-CO')}
  </div>
  </body></html>`;

  const w = window.open('', '_blank', 'width=800,height=700');
  if(!w) { notify('warning','âš ï¸','Permite popups','Para imprimir el comprobante.',{duration:3000}); return; }
  w.document.write(html);
  w.document.close();
}

async function pagarNomina(id){
  const n=(state.nom_nominas||[]).find(x=>x.id===id);if(!n)return;
  n.pagada=true;
  await saveRecord('nom_nominas', n.id, n);

  const cajaAbierta=(state.cajas||[]).find(c=>c.estado==='abierta');
  if(cajaAbierta){
    cajaAbierta.saldo-=n.neto;
    const mov={id:uid(),cajaId:cajaAbierta.id,tipo:'egreso',valor:n.neto,
      concepto:`${n.tipo?.toUpperCase()||'NÃ³mina'} ${n.numero} - ${n.empleado}`,fecha:today(),metodo:'transferencia'};
    state.tes_movimientos.push(mov);
    await saveRecord('cajas', cajaAbierta.id, cajaAbierta);
    await saveRecord('tes_movimientos', mov.id, mov);
  }
  renderNomNominas();
  notify('success','ðŸ’°','Â¡NÃ³mina pagada!',`${n.empleado} Â· ${fmt(n.neto)}`,{duration:3000});
}


