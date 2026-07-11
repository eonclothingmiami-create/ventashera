// Nomina module: ausencias, anticipos, conceptos y liquidaciones.
(function initNominaModule(global) {
  const PILA_EMP = { salud: 0.04, pension: 0.04 };
  const PILA_EMP_ADOR = { salud: 0.0850, pension: 0.12, arl: 0.00522, caja: 0.04 };
  const PROV = { prima: 1 / 12, cesantias: 1 / 12, intCesantias: 0.12 / 12, vacaciones: 1 / 24 };

  function normEmpName(s) {
    return String(s || '').trim().toLowerCase();
  }

  function parseYmd(str) {
    if (!str) return null;
    const p = String(str).split('T')[0].split('-');
    if (p.length < 3) return null;
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function fmtYmd(d) {
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function daysBetweenInclusive(from, to) {
    const a = parseYmd(from);
    const b = parseYmd(to);
    if (!a || !b || b < a) return 0;
    return Math.floor((b - a) / 86400000) + 1;
  }

  /** Inicio ciclo cesantías (1° feb) o ingreso si es posterior. */
  function inicioPeriodoCesantias(fechaRetiro, fechaIngreso) {
    const ret = parseYmd(fechaRetiro);
    const ing = parseYmd(fechaIngreso);
    if (!ret || !ing) return ing;
    let feb1 = new Date(ret.getFullYear(), 1, 1);
    if (ret < feb1) feb1 = new Date(ret.getFullYear() - 1, 1, 1);
    return ing > feb1 ? ing : feb1;
  }

  /** Inicio semestre prima (1 ene / 1 jul) o ingreso si es posterior. */
  function inicioPeriodoPrima(fechaRetiro, fechaIngreso) {
    const ret = parseYmd(fechaRetiro);
    const ing = parseYmd(fechaIngreso);
    if (!ret || !ing) return ing;
    const semStart = ret.getMonth() < 6
      ? new Date(ret.getFullYear(), 0, 1)
      : new Date(ret.getFullYear(), 6, 1);
    return ing > semStart ? ing : semStart;
  }

  function nominaTipoRecord(n) {
    return String(n?.tipo || n?.detalles?.tipo || '').toLowerCase();
  }

  function matchesEmpleadoNomina(n, empNombre, empId) {
    const nName = normEmpName(n?.empleado || n?.empleado_nombre);
    if (empNombre && nName === normEmpName(empNombre)) return true;
    const nid = n?.empleadoId || n?.detalles?.empleadoId;
    return !!(empId && nid && nid === empId);
  }

  /** Suma prestaciones ya pagadas/registradas para descontar en liquidación. */
  function resumirPrestacionesPagadas(nominas, empNombre, empId, opts = {}) {
    const { sinceCesan, sincePrima } = opts;
    const out = { prima: 0, cesantias: 0, intCes: 0, vacaciones: 0, diasVacPagados: 0, registros: 0 };
    for (const n of nominas || []) {
      if (!matchesEmpleadoNomina(n, empNombre, empId)) continue;
      const t = nominaTipoRecord(n);
      const d = n.detalles || {};
      const f = String(n.fecha || '').split('T')[0];
      if (t === 'prima') {
        if (sincePrima && f && f < sincePrima) continue;
        out.prima += Number(d.valor ?? n.neto ?? 0);
        out.registros += 1;
      } else if (t === 'cesantias') {
        if (sinceCesan && f && f < sinceCesan) continue;
        out.cesantias += Number(d.valor ?? 0);
        out.intCes += Number(d.intCes ?? 0);
        if (!d.valor && !d.intCes) out.cesantias += Number(n.neto ?? 0);
        out.registros += 1;
      } else if (t === 'vacaciones') {
        out.vacaciones += Number(d.salarioBase ?? n.neto ?? 0);
        out.diasVacPagados += Number(d.diasVacaciones ?? 0);
        out.registros += 1;
      } else if (t === 'liquidacion') {
        out.prima += Number(d.prima ?? 0);
        out.cesantias += Number(d.cesan ?? 0);
        out.intCes += Number(d.intCes ?? 0);
        out.vacaciones += Number(d.vac ?? 0);
        out.registros += 1;
      }
    }
    return out;
  }

  function diasVacacionesDisfrutadas(ausencias, empNombre) {
    const name = normEmpName(empNombre);
    return (ausencias || [])
      .filter((a) => normEmpName(a.empleado || a.empleado_nombre) === name && String(a.tipo || '').toLowerCase() === 'vacaciones')
      .reduce((s, a) => s + (Number(a.dias) || 0), 0);
  }

  function calcLiquidacionContrato(input) {
    const np = input.nominaParams || resolveParams(input);
    const SMMLV = np.smmlv;
    const AUX_TRANSPORTE = np.auxTrans;
    const salario = Number(input.salario) || SMMLV;
    const salarioDia = salario / 30;
    const tieneAuxTrans = salario <= 2 * SMMLV;
    const base = salario + (tieneAuxTrans ? AUX_TRANSPORTE : 0);
    const fechaIngreso = input.fechaIngreso;
    const fechaRetiro = input.fechaRetiro;
    const diasTrab = daysBetweenInclusive(fechaIngreso, fechaRetiro);
    if (!diasTrab) {
      throw new Error('Revisa fechas de ingreso y retiro');
    }

    const iniCesan = inicioPeriodoCesantias(fechaRetiro, fechaIngreso);
    const iniPrima = inicioPeriodoPrima(fechaRetiro, fechaIngreso);
    const diasCesan = daysBetweenInclusive(iniCesan, parseYmd(fechaRetiro));
    const diasPrima = daysBetweenInclusive(iniPrima, parseYmd(fechaRetiro));

    const cesanBruto = (base * diasCesan) / 360;
    const intCesBruto = cesanBruto * 0.12 * (diasCesan / 360);
    const primaBruto = (base * diasPrima) / 360;
    const vacBruto = (salario * diasTrab) / 720;

    const diasVacDisfr = Number(input.diasVacDisfrutadas) || 0;
    const vacDisfrutadasValor = salarioDia * diasVacDisfr;

    const pag = input.prestacionesPagadas || { prima: 0, cesantias: 0, intCes: 0, vacaciones: 0 };
    const cesan = Math.max(0, cesanBruto - pag.cesantias);
    const intCes = Math.max(0, intCesBruto - pag.intCes);
    const prima = Math.max(0, primaBruto - pag.prima);
    const vac = Math.max(0, vacBruto - pag.vacaciones - vacDisfrutadasValor);
    const total = cesan + intCes + prima + vac;

    return {
      diasTrab,
      diasCesan,
      diasPrima,
      base,
      smmlvVigente: SMMLV,
      auxVigente: AUX_TRANSPORTE,
      nominaYear: np.year || np.calendarYear,
      cesanBruto,
      intCesBruto,
      primaBruto,
      vacBruto,
      descontado: {
        cesantias: pag.cesantias,
        intCes: pag.intCes,
        prima: pag.prima,
        vacaciones: pag.vacaciones + vacDisfrutadasValor,
        diasVacDisfr,
        registros: pag.registros || 0,
      },
      cesan,
      intCes,
      prima,
      vac,
      totalDevengado: total,
      neto: total,
      periodos: {
        ingreso: fechaIngreso,
        retiro: fechaRetiro,
        cesantiasDesde: fmtYmd(iniCesan),
        primaDesde: fmtYmd(iniPrima),
      },
    };
  }

  function resolveParams(cfg) {
    if (cfg?.nominaParams?.smmlv) return cfg.nominaParams;
    const st = global.state || global.__HERA_STATE__;
    if (global.AppNominaParams?.getNominaParams) {
      return global.AppNominaParams.getNominaParams(st);
    }
    return { smmlv: 1750905, auxTrans: 249095, year: 2026 };
  }

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
    const np = resolveParams(cfg);
    const SMMLV = np.smmlv;
    const AUX_TRANSPORTE = np.auxTrans;
    const {
      salario = SMMLV, ausenciasNoPagas = 0, incapacidades = 0, anticipos = 0, otrosDevengos = 0, otrasDeducc = 0,
      tipo = 'quincenal', diasVacaciones = 0, diasCesantias = 0, periodosLiquidar = 0,
      fechaIngreso = null, fechaRetiro = null, empleadoNombre = '', empleadoId = null,
      nomNominas = null, ausencias = null, prestacionesPagadas = null
    } = cfg;
    const salarioDia = salario / 30;
    const auxTransDia = (salario <= 2 * SMMLV) ? AUX_TRANSPORTE / 30 : 0;
    const tieneAuxTrans = salario <= 2 * SMMLV;
    let resultado = {};
    if (tipo === 'quincenal' || tipo === 'mensual') {
      const dp = tipo === 'quincenal' ? 15 : 30;
      const diasEfectivos = Math.max(0, dp - ausenciasNoPagas);
      const salarioBase = salarioDia * diasEfectivos;
      const auxTrans = tieneAuxTrans ? (auxTransDia * diasEfectivos) : 0;
      const valorIncap = incapacidades > 0 ? (salarioDia * incapacidades * (2 / 3)) : 0;
      const totalDevengado = salarioBase + auxTrans + otrosDevengos + valorIncap;
      // IBC salud/pensión: NO incluye auxilio de transporte (prestación no salarial — Colombia).
      const baseCotizacion = salarioBase + otrosDevengos + valorIncap;
      const deducSalud = baseCotizacion * PILA_EMP.salud;
      const deducPension = baseCotizacion * PILA_EMP.pension;
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
      resultado = { tipo, diasEfectivos, salarioBase, auxTrans, valorIncap, otrosDevengos, baseCotizacion, totalDevengado, deducSalud, deducPension, anticipos, otrasDeducc, totalDeducc, neto, empleador: { costoSalud, costoPension, costoArl, costoCaja, provPrima, provCes, provIntCes, provVac, costoTotal } };
    } else if (tipo === 'vacaciones') {
      // Vacaciones: solo salario básico (sin aux. transporte) — Art. 189 CST.
      const valorVac = salarioDia * diasVacaciones;
      resultado = { tipo, diasVacaciones, salarioBase: valorVac, totalDevengado: valorVac, neto: valorVac };
    } else if (tipo === 'prima') {
      // Prima: (salario + aux.) × días / 360 — Arts. 306-307 CST; Ley 1ª/1963 art. 7.
      const diasPrima = diasCesantias > 0 ? diasCesantias : 180;
      const base = salario + (tieneAuxTrans ? AUX_TRANSPORTE : 0);
      const valor = (base * diasPrima) / 360;
      resultado = { tipo, diasPrima, meses: diasPrima / 30, base, valor, totalDevengado: valor, neto: valor };
    } else if (tipo === 'cesantias') {
      const base = salario + (tieneAuxTrans ? AUX_TRANSPORTE : 0);
      const valor = (base * diasCesantias) / 360;
      const intCes = valor * 0.12 * (diasCesantias / 360);
      resultado = { tipo, diasCesantias, base, valor, intCes, totalDevengado: valor + intCes, neto: valor + intCes };
    } else if (tipo === 'liquidacion') {
      if (fechaIngreso && fechaRetiro) {
        const st = global.state || global.__HERA_STATE__ || {};
        const nominas = nomNominas || st.nom_nominas || [];
        const aus = ausencias || st.nom_ausencias || [];
        const iniCesan = inicioPeriodoCesantias(fechaRetiro, fechaIngreso);
        const iniPrima = inicioPeriodoPrima(fechaRetiro, fechaIngreso);
        const pagos = prestacionesPagadas || resumirPrestacionesPagadas(nominas, empleadoNombre, empleadoId, {
          sinceCesan: fmtYmd(iniCesan),
          sincePrima: fmtYmd(iniPrima),
        });
        const liq = calcLiquidacionContrato({
          salario,
          fechaIngreso,
          fechaRetiro,
          nominaParams: np,
          prestacionesPagadas: pagos,
          diasVacDisfrutadas: diasVacacionesDisfrutadas(aus, empleadoNombre),
        });
        if (empleadoId) liq.empleadoId = empleadoId;
        resultado = { tipo: 'liquidacion', ...liq };
      } else {
        const diasTrab = periodosLiquidar;
        const base = salario + (tieneAuxTrans ? AUX_TRANSPORTE : 0);
        const cesan = (base * diasTrab) / 360;
        const intCes = cesan * 0.12 * (diasTrab / 360);
        const prima = (base * diasTrab) / 360;
        const vac = (salario * diasTrab) / 720;
        const total = cesan + intCes + prima + vac;
        resultado = { tipo, diasTrab, cesan, intCes, prima, vac, totalDevengado: total, neto: total, manual: true };
      }
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
      html = `<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">DEVENGADO</div>${row(`Salario (${r.diasEfectivos} días)`, r.salarioBase, 'var(--green)')}${r.auxTrans > 0 ? row('Aux. Transporte', r.auxTrans, 'var(--green)') : ''}${r.valorIncap > 0 ? row('Incapacidad (EPS 2/3)', r.valorIncap, 'var(--yellow)') : ''}${r.otrosDevengos > 0 ? row('Otros devengos', r.otrosDevengos, 'var(--green)') : ''}${row('TOTAL DEVENGADO', r.totalDevengado, 'var(--green)')}<div style="font-size:11px;font-weight:700;color:var(--text2);margin:8px 0 4px">DEDUCCIONES</div>${r.baseCotizacion != null ? `<div style="font-size:10px;color:var(--text2);margin-bottom:4px">Base cotización salud/pensión (sin aux. transporte): ${fmt(Math.round(r.baseCotizacion))}</div>` : ''}${row('Salud empleado (4%)', r.deducSalud, 'var(--red)')}${row('Pensión empleado (4%)', r.deducPension, 'var(--red)')}${r.anticipos > 0 ? row('Anticipos', r.anticipos, 'var(--red)') : ''}${r.otrasDeducc > 0 ? row('Otras deducciones', r.otrasDeducc, 'var(--red)') : ''}${row('TOTAL DEDUCCIONES', r.totalDeducc, 'var(--red)')}<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px"><span style="font-family:Syne;font-weight:800;font-size:14px">NETO A PAGAR</span><span style="font-family:Syne;font-weight:800;font-size:16px;color:var(--accent)">${fmt(Math.round(r.neto))}</span></div>`;
    } else if (tipo === 'vacaciones') {
      html = `${row(`Vacaciones (${r.diasVacaciones} días)`, r.salarioBase, 'var(--green)')}<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px"><span style="font-family:Syne;font-weight:800">VALOR VACACIONES</span><span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span></div>`;
    } else if (tipo === 'prima') {
      html = `${row(`Base prestacional (${r.diasPrima ?? r.meses * 30} días)`, r.base)}${row('Prima de servicios', r.valor, 'var(--green)')}<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px"><span style="font-family:Syne;font-weight:800">PRIMA A PAGAR</span><span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span></div>`;
    } else if (tipo === 'cesantias') {
      html = `${row(`Cesantías (${r.diasCesantias} días)`, r.valor, 'var(--green)')}${row('Intereses cesantías (12%)', r.intCes, 'var(--green)')}<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px"><span style="font-family:Syne;font-weight:800">CESANTÍAS + INTERESES</span><span style="font-family:Syne;font-weight:800;color:var(--accent)">${fmt(Math.round(r.neto))}</span></div>`;
    } else if (tipo === 'liquidacion') {
      const desc = r.descontado || {};
      const per = r.periodos || {};
      const hint = r.manual
        ? ''
        : `<div style="font-size:10px;color:var(--text2);margin-bottom:8px;line-height:1.4">SMMLV ${r.nominaYear || '—'}: ${fmt(Math.round(r.smmlvVigente || 0))} · ${r.diasTrab} días trabajados · Cesantías desde ${per.cesantiasDesde || '—'} · Prima desde ${per.primaDesde || '—'}${desc.registros ? ` · ${desc.registros} pago(s) descontados` : ''}</div>`;
      const brutoRow = (label, bruto, neto, descVal) => {
        if (!bruto && !neto) return '';
        if (descVal > 0 && bruto > neto) {
          return `${row(`${label} (bruto)`, bruto, 'var(--text2)')}${row(`  − ya pagado`, descVal, 'var(--red)')}${row(label, neto, 'var(--green)')}`;
        }
        return row(label, neto, 'var(--green)');
      };
      html = `<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px">LIQUIDACIÓN CONTRATO</div>${hint}${brutoRow(`Cesantías (${r.diasCesan ?? r.diasTrab} días)`, r.cesanBruto ?? r.cesan, r.cesan, desc.cesantias)}${brutoRow('Intereses cesantías', r.intCesBruto ?? r.intCes, r.intCes, desc.intCes)}${brutoRow(`Prima (${r.diasPrima ?? '—'} días)`, r.primaBruto ?? r.prima, r.prima, desc.prima)}${brutoRow('Vacaciones proporcionales', r.vacBruto ?? r.vac, r.vac, desc.vacaciones)}${desc.diasVacDisfr > 0 ? row(`  (incl. ${desc.diasVacDisfr} días disfrutados)`, desc.diasVacDisfr, 'var(--text2)') : ''}<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:2px solid var(--accent);margin-top:4px"><span style="font-family:Syne;font-weight:800;font-size:14px">TOTAL LIQUIDACIÓN</span><span style="font-family:Syne;font-weight:800;font-size:16px;color:var(--accent)">${fmt(Math.round(r.neto))}</span></div>`;
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
    resolveParams,
    parseYmd,
    daysBetweenInclusive,
    inicioPeriodoCesantias,
    inicioPeriodoPrima,
    resumirPrestacionesPagadas,
    diasVacacionesDisfrutadas,
    calcLiquidacionContrato,
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
