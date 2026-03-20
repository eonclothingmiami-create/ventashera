// Nomina module: ausencias, anticipos, conceptos y liquidaciones.
(function initNominaModule(global) {
  const SMMLV_2025 = 1423500;
  const AUX_TRANSPORTE_2025 = 200000;
  const PILA_EMP = { salud: 0.04, pension: 0.04 };
  const PILA_EMP_ADOR = { salud: 0.0850, pension: 0.12, arl: 0.00522, caja: 0.04 };
  const PROV = { prima: 1 / 12, cesantias: 1 / 12, intCesantias: 0.12 / 12, vacaciones: 1 / 24 };

  function renderNomAusencias(ctx) {
    const { state, formatDate } = ctx;
    const items = [...(state.nom_ausencias || [])].reverse();
    document.getElementById('nom_ausencias-content').innerHTML = `
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openNomAusenciaModal()">+ Nueva Ausencia</button>
    <div class="card"><div class="card-title">AUSENCIAS LABORALES (${items.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Empleado</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th>Días</th><th>Estado</th><th></th></tr></thead><tbody>
    ${items.map((a) => `<tr><td>${a.empleado}</td><td><span class="badge badge-warn">${a.tipo}</span></td><td>${formatDate(a.desde)}</td><td>${formatDate(a.hasta)}</td><td style="font-weight:700">${a.dias}</td><td><span class="badge ${a.aprobada ? 'badge-ok' : 'badge-pend'}">${a.aprobada ? 'Aprobada' : 'Pendiente'}</span></td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_ausencias','${a.id}','nom_ausencias')">✕</button></td></tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin ausencias</td></tr>'}
    </tbody></table></div></div>`;
  }

  function openNomAusenciaModal(ctx) {
    const { openModal, today } = ctx;
    openModal(`
    <div class="modal-title">Nueva Ausencia<button class="modal-close" onclick="closeModal()">×</button></div>
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

  function saveNomAusencia(ctx) {
    const { state, uid, dbId, saveRecord, closeModal, renderNomAusencias, notify } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const emp = document.getElementById('m-na-emp').value.trim(); if (!emp) return;
    const desde = document.getElementById('m-na-desde').value;
    const hasta = document.getElementById('m-na-hasta').value;
    const dias = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1);
    const aus = { id: nextId(), empleado: emp, tipo: document.getElementById('m-na-tipo').value, desde, hasta, dias, observaciones: document.getElementById('m-na-obs').value.trim(), aprobada: false };
    state.nom_ausencias.push(aus);
    saveRecord('nom_ausencias', aus.id, aus);
    closeModal();
    renderNomAusencias();
    notify('success', '✅', 'Ausencia registrada', emp + ' · ' + dias + ' días', { duration: 3000 });
  }

  function renderNomAnticipos(ctx) {
    const { state, formatDate, fmt } = ctx;
    const items = [...(state.nom_anticipos || [])].reverse();
    document.getElementById('nom_anticipos-content').innerHTML = `
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openSimpleFormModal('nom_anticipos','Anticipo de Nómina',['empleado:text:EMPLEADO','valor:number:VALOR','fecha:date:FECHA','motivo:text:MOTIVO'])">+ Nuevo Anticipo</button>
    <div class="card"><div class="card-title">ANTICIPOS DE NÓMINA (${items.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Empleado</th><th>Valor</th><th>Motivo</th><th></th></tr></thead><tbody>
    ${items.map((a) => `<tr><td>${formatDate(a.fecha)}</td><td>${a.empleado}</td><td style="color:var(--accent);font-weight:700">${fmt(a.valor || 0)}</td><td>${a.motivo || '—'}</td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_anticipos','${a.id}','nom_anticipos')">✕</button></td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:24px">Sin anticipos</td></tr>'}
    </tbody></table></div></div>`;
  }

  function renderNomConceptos(ctx) {
    const { state, fmt } = ctx;
    const items = state.nom_conceptos || [];
    document.getElementById('nom_conceptos-content').innerHTML = `
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openConceptoModal()">+ Nuevo Concepto</button>
    <div class="card"><div class="card-title">CONCEPTOS DE NÓMINA</div>
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Fórmula</th><th>Valor</th><th></th></tr></thead><tbody>
    ${items.map((c) => `<tr><td style="font-weight:700">${c.nombre}</td><td><span class="badge ${c.tipo === 'devengo' ? 'badge-ok' : 'badge-pend'}">${c.tipo}</span></td><td>${c.formula}</td><td>${c.formula === 'porcentaje' ? c.valor + '%' : fmt(c.valor)}</td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_conceptos','${c.id}','nom_conceptos')">✕</button></td></tr>`).join('')}
    </tbody></table></div></div>`;
  }

  function openConceptoModal(ctx) {
    ctx.openModal(`
    <div class="modal-title">Nuevo Concepto<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">NOMBRE</label><input class="form-control" id="m-nc-nombre" placeholder="Ej: Horas Extra"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-nc-tipo"><option value="devengo">Devengo</option><option value="deduccion">Deducción</option></select></div>
      <div class="form-group"><label class="form-label">FÓRMULA</label><select class="form-control" id="m-nc-formula"><option value="fijo">Valor Fijo</option><option value="porcentaje">Porcentaje sobre salario</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">VALOR</label><input type="number" class="form-control" id="m-nc-valor" placeholder="0"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveConcepto()">Guardar</button>
  `);
  }

  function saveConcepto(ctx) {
    const { state, uid, dbId, saveRecord, closeModal, renderNomConceptos } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const nombre = document.getElementById('m-nc-nombre').value.trim(); if (!nombre) return;
    const conc = { id: nextId(), nombre, tipo: document.getElementById('m-nc-tipo').value, formula: document.getElementById('m-nc-formula').value, valor: parseFloat(document.getElementById('m-nc-valor').value) || 0 };
    state.nom_conceptos.push(conc);
    saveRecord('nom_conceptos', conc.id, conc);
    closeModal();
    renderNomConceptos();
  }

  function calcNomina(cfg) {
    const {
      salario = SMMLV_2025, ausenciasNoPagas = 0, incapacidades = 0, anticipos = 0, otrosDevengos = 0, otrasDeducc = 0,
      tipo = 'quincenal', diasVacaciones = 0, diasCesantias = 0, periodosLiquidar = 0
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
      const valorIncap = incapacidades > 0 ? (salarioDia * incapacidades * (2 / 3)) : 0;
      const totalDevengado = salarioBase + auxTrans + otrosDevengos + valorIncap;
      const deducSalud = totalDevengado * PILA_EMP.salud;
      const deducPension = totalDevengado * PILA_EMP.pension;
      const totalDeducc = deducSalud + deducPension + anticipos + otrasDeducc;
      const neto = Math.max(0, totalDevengado - totalDeducc);
      const costoSalud = salarioBase * PILA_EMP_ADOR.salud;
      const costoPension = salarioBase * PILA_EMP_ADOR.pension;
      const costoArl = salarioBase * PILA_EMP_ADOR.arl;
      const costoCaja = salarioBase * PILA_EMP_ADOR.caja;
      const provPrima = (salarioBase + auxTrans) * PROV.prima;
      const provCes = (salarioBase + auxTrans) * PROV.cesantias;
      const provIntCes = provCes * (PROV.intCesantias * 12);
      const provVac = salarioBase * PROV.vacaciones;
      const costoTotal = totalDevengado + costoSalud + costoPension + costoArl + costoCaja + provPrima + provCes + provIntCes + provVac;
      resultado = { tipo, diasEfectivos, salarioBase, auxTrans, valorIncap, otrosDevengos, totalDevengado, deducSalud, deducPension, anticipos, otrasDeducc, totalDeducc, neto, empleador: { costoSalud, costoPension, costoArl, costoCaja, provPrima, provCes, provIntCes, provVac, costoTotal } };
    } else if (tipo === 'vacaciones') {
      const valorVac = salarioDia * diasVacaciones;
      resultado = { tipo, diasVacaciones, salarioBase: valorVac, totalDevengado: valorVac, neto: valorVac };
    } else if (tipo === 'prima') {
      const meses = diasCesantias / 30;
      const base = salario + (tieneAuxTrans ? AUX_TRANSPORTE_2025 : 0);
      const valor = (base / 12) * meses;
      resultado = { tipo, meses, base, valor, totalDevengado: valor, neto: valor };
    } else if (tipo === 'cesantias') {
      const base = salario + (tieneAuxTrans ? AUX_TRANSPORTE_2025 : 0);
      const valor = (base * diasCesantias) / 360;
      const intCes = valor * 0.12 * (diasCesantias / 365);
      resultado = { tipo, diasCesantias, base, valor, intCes, totalDevengado: valor + intCes, neto: valor + intCes };
    } else if (tipo === 'liquidacion') {
      const diasTrab = periodosLiquidar;
      const cesan = (salario + (tieneAuxTrans ? AUX_TRANSPORTE_2025 : 0)) * diasTrab / 360;
      const intCes = cesan * 0.12 * (diasTrab / 365);
      const prima = (salario + (tieneAuxTrans ? AUX_TRANSPORTE_2025 : 0)) / 12 * (diasTrab / 30);
      const vac = salarioDia * (diasTrab / 720) * 15;
      const total = cesan + intCes + prima + vac;
      resultado = { tipo, diasTrab, cesan, intCes, prima, vac, totalDevengado: total, neto: total };
    }
    return resultado;
  }

  function renderNomNominas(ctx) {
    const { state, fmt } = ctx;
    const items = [...(state.nom_nominas || [])].reverse();
    document.getElementById('nom_nominas-content').innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn btn-primary" onclick="openLiquidacionModal('quincenal')">💰 Nueva Quincena</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('mensual')">📅 Nómina Mensual</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('prima')">🎁 Prima</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('cesantias')">🏦 Cesantías</button>
      <button class="btn btn-secondary" onclick="openLiquidacionModal('vacaciones')">🌴 Vacaciones</button>
      <button class="btn btn-warning" onclick="openLiquidacionModal('liquidacion')">📋 Liquidación</button>
    </div>
    <div class="card"><div class="card-title">NÓMINAS LABORALES (${items.length})</div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Tipo</th><th>Periodo</th><th>Empleado</th><th>Devengado</th><th>Deducciones</th><th>Neto</th><th>Estado</th><th></th></tr></thead><tbody>
    ${items.map((n) => `<tr><td style="font-weight:700">${n.numero || '—'}</td><td><span class="badge badge-info">${(n.tipo || 'quincena').toUpperCase()}</span></td><td>${n.periodo || '—'}</td><td>${n.empleado || '—'}</td><td style="color:var(--green)">${fmt(n.devengado || 0)}</td><td style="color:var(--red)">${fmt(n.deducciones || 0)}</td><td style="color:var(--accent);font-weight:700">${fmt(n.neto || 0)}</td><td><span class="badge ${n.pagada ? 'badge-ok' : 'badge-warn'}">${n.pagada ? 'Pagada' : 'Pendiente'}</span></td><td><div class="btn-group"><button class="btn btn-xs btn-secondary" onclick="verNomina('${n.id}')">👁</button><button class="btn btn-xs btn-secondary" onclick="imprimirNomina('${n.id}')">🖨</button>${!n.pagada ? `<button class="btn btn-xs btn-primary" onclick="pagarNomina('${n.id}')">💰 Pagar</button>` : ''}<button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_nominas','${n.id}','nom_nominas')">✕</button></div></td></tr>`).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--text2);padding:24px">Sin nóminas</td></tr>'}
    </tbody></table></div></div>`;
  }

  function renderNominaPreview(ctx) {
    const { r, tipo, fmt } = ctx;
    const el = document.getElementById('nom-preview-content'); if (!el) return;
    const row = (label, val, color = '') => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="color:var(--text2)">${label}</span>${color ? `<span style="color:${color};font-weight:700">${fmt(Math.round(val || 0))}</span>` : `<span style="font-weight:700">${fmt(Math.round(val || 0))}</span>`}</div>`;
    let html = '';
    if (tipo === 'quincenal' || tipo === 'mensual') {
      html = `<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">DEVENGADO</div>${row(`Salario (${r.diasEfectivos} días)`, r.salarioBase, 'var(--green)')}${r.auxTrans > 0 ? row('Aux. Transporte', r.auxTrans, 'var(--green)') : ''}${r.valorIncap > 0 ? row('Incapacidad (EPS 2/3)', r.valorIncap, 'var(--yellow)') : ''}${r.otrosDevengos > 0 ? row('Otros devengos', r.otrosDevengos, 'var(--green)') : ''}${row('TOTAL DEVENGADO', r.totalDevengado, 'var(--green)')}<div style="font-size:11px;font-weight:700;color:var(--text2);margin:8px 0 4px">DEDUCCIONES</div>${row('Salud empleado (4%)', r.deducSalud, 'var(--red)')}${row('Pensión empleado (4%)', r.deducPension, 'var(--red)')}${r.anticipos > 0 ? row('Anticipos', r.anticipos, 'var(--red)') : ''}${r.otrasDeducc > 0 ? row('Otras deducciones', r.otrasDeducc, 'var(--red)') : ''}${row('TOTAL DEDUCCIONES', r.totalDeducc, 'var(--red)')}<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px"><span style="font-family:Syne;font-weight:800;font-size:14px">NETO A PAGAR</span><span style="font-family:Syne;font-weight:800;font-size:16px;color:var(--accent)">${fmt(Math.round(r.neto))}</span></div>`;
    } else if (tipo === 'vacaciones') {
      html = `${row(`Vacaciones (${r.diasVacaciones} días)`, r.salarioBase, 'var(--green)')}<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px"><span style="font-family:Syne;font-weight:800">VALOR VACACIONES</span><span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span></div>`;
    } else if (tipo === 'prima') {
      html = `${row(`Base (${r.meses?.toFixed(1)} meses)`, r.base)}${row('Prima semestral', r.valor, 'var(--green)')}<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px"><span style="font-family:Syne;font-weight:800">PRIMA A PAGAR</span><span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span></div>`;
    } else if (tipo === 'cesantias') {
      html = `${row(`Cesantías (${r.diasCesantias} días)`, r.valor, 'var(--green)')}${row('Intereses cesantías (12%)', r.intCes, 'var(--green)')}<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px"><span style="font-family:Syne;font-weight:800">CESANTÍAS + INTERESES</span><span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span></div>`;
    } else if (tipo === 'liquidacion') {
      html = `<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">LIQUIDACIÓN CONTRATO</div>${row(`Cesantías (${r.diasTrab} días)`, r.cesan, 'var(--green)')}${row('Intereses cesantías', r.intCes, 'var(--green)')}${row('Prima proporcional', r.prima, 'var(--green)')}${row('Vacaciones proporcionales', r.vac, 'var(--green)')}<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px"><span style="font-family:Syne;font-weight:800;font-size:14px">TOTAL LIQUIDACIÓN</span><span style="font-family:Syne;font-weight:800;font-size:16px;color:var(--accent)">${fmt(Math.round(r.neto))}</span></div>`;
    }
    el.innerHTML = html;
  }

  async function pagarNomina(ctx) {
    const { state, id, saveRecord, uid, dbId, today, renderNomNominas, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const n = (state.nom_nominas || []).find((x) => x.id === id); if (!n) return;
    n.pagada = true;
    await saveRecord('nom_nominas', n.id, n);
    const cajaAbierta = (state.cajas || []).find((c) => c.estado === 'abierta');
    if (cajaAbierta) {
      global.AppCajaLogic?.normalizeCaja?.(cajaAbierta);
      const bucket = 'transferencia';
      global.AppCajaLogic?.applyDeltaBucket?.(cajaAbierta, bucket, -n.neto);
      const mov = {
        id: nextId(),
        cajaId: cajaAbierta.id,
        tipo: 'egreso',
        valor: n.neto,
        concepto: `${n.tipo?.toUpperCase() || 'Nómina'} ${n.numero} - ${n.empleado}`,
        fecha: today(),
        metodo: 'transferencia',
        categoria: 'nomina',
        bucket
      };
      global.AppCajaLogic?.enrichMovWithSesion?.(state, cajaAbierta.id, mov, nextId);
      state.tes_movimientos.push(mov);
      await saveRecord('cajas', cajaAbierta.id, cajaAbierta);
      await saveRecord('tes_movimientos', mov.id, mov);
    }
    renderNomNominas();
    notify('success', '💰', '¡Nómina pagada!', `${n.empleado} · ${fmt(n.neto)}`, { duration: 3000 });
  }

  global.AppNominaModule = {
    SMMLV_2025,
    renderNomAusencias,
    openNomAusenciaModal,
    saveNomAusencia,
    renderNomAnticipos,
    renderNomConceptos,
    openConceptoModal,
    saveConcepto,
    calcNomina,
    renderNomNominas,
    renderNominaPreview,
    pagarNomina
  };
})(window);
