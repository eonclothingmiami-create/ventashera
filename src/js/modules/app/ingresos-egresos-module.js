// Manual Ingresos / Egresos (no vive en Tesorería->Cajas)
(function initIngresosEgresosModule(global) {
  let _ctx = null;

  function getOpenCajas(state) {
    return (state.cajas || []).filter((c) => c.estado === 'abierta');
  }

  function bucketFromMetodoId(metodoId, state) {
    return global.AppCajaLogic?.bucketFromMetodoId?.(metodoId, state.cfg_metodos_pago) || 'efectivo';
  }

  function renderList(ctx) {
    const { state, fmt, formatDate } = ctx;
    const el = document.getElementById('ingresos_egresos-content');
    if (!el) return;

    const last = (state.tes_movimientos || []).filter((m) => {
      // Solo manual/ventas conectadas a cajas (no POS por defecto, para que sea "otro modulo")
      if (m.tipo !== 'ingreso' && m.tipo !== 'egreso') return false;
      // POS usa categoria 'venta_pos'; nosotros usamos 'otro_ingreso' y 'gasto'
      if (m.tipo === 'ingreso') return m.categoria === 'otro_ingreso';
      return m.categoria === 'gasto';
    });

    const items = [...last].reverse().slice(0, 80);
    const mkRow = (m) => {
      const caja = (state.cajas || []).find((c) => c.id === m.cajaId);
      const signColor = m.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)';
      const tipoBadge = m.tipo === 'ingreso' ? 'badge-ok' : 'badge-pend';
      return `<tr>
        <td>${formatDate(m.fecha)}</td>
        <td>${caja?.nombre || '—'}</td>
        <td><span class="badge ${tipoBadge}">${m.tipo}</span></td>
        <td style="font-weight:800;color:${signColor}">${fmt(m.valor || 0)}</td>
        <td style="font-size:11px">${m.bucket || '—'}</td>
        <td style="font-size:11px">${m.metodo || '—'}</td>
        <td>${m.concepto || '—'}</td>
      </tr>`;
    };

    el.innerHTML = `
      <div style="font-size:11px;color:var(--text2);line-height:1.5;margin-bottom:12px">
        Registra <b>Ingresos</b> (suman a la caja) y <b>Egresos</b> (restan a la caja).
        Al guardar, se crean <code>tes_movimientos</code> y se ajustan los buckets de la caja activa (sesión).
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <button class="btn btn-primary" onclick="AppIngresosEgresosModule.openIngresoModal()">+ Ingreso</button>
        <button class="btn btn-secondary" onclick="AppIngresosEgresosModule.openEgresoModal()">+ Egreso</button>
        <button class="btn btn-sm btn-secondary" onclick="AppIngresosEgresosModule.refresh()" style="align-self:center">Actualizar</button>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="card-title">Últimos Ingresos/Egresos (${items.length})</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Caja</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Bucket</th>
                <th>Método</th>
                <th>Concepto</th>
              </tr>
            </thead>
            <tbody>
              ${items.length ? items.map(mkRow).join('') : `<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:20px">Sin registros</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderIngresoEgresoModal(ctx, tipo) {
    const { state, openModal, today, notify } = ctx;
    const openCajas = getOpenCajas(state);
    const methods = (state.cfg_metodos_pago || []).filter((m) => m.activo !== false);
    if (openCajas.length === 0) {
      notify('warning', '🏧', 'Sin caja abierta', 'Abre un turno en Tesorería -> Cajas antes de registrar ingresos/egresos.', { duration: 5000 });
      return;
    }

    const defCajaId = openCajas.length === 1 ? openCajas[0].id : openCajas[0].id;
    const defMetodoId =
      methods.find((m) => (m.tipo || '').toLowerCase() === (tipo === 'ingreso' ? 'efectivo' : 'efectivo'))?.id || methods[0]?.id || 'efectivo';

    const optionsCajas = openCajas
      .map((c) => `<option value="${c.id}">${String(c.nombre || c.id)}</option>`)
      .join('');
    const optionsMetodos = methods.map((m) => `<option value="${m.id}">${String(m.nombre || m.id)}</option>`).join('');

    openModal(`
      <div class="modal-title">${tipo === 'ingreso' ? '📥 Ingreso' : '📤 Egreso'} manual<button class="modal-close" onclick="closeModal()">×</button></div>
      <input type="hidden" id="ie-tipo" value="${tipo}">

      <div class="form-group">
        <label class="form-label">CAJA (turno abierto)</label>
        <select class="form-control" id="ie-caja-sel">${optionsCajas}</select>
      </div>

      <div class="form-group">
        <label class="form-label">MÉTODO</label>
        <select class="form-control" id="ie-metodo-sel">${optionsMetodos}</select>
      </div>

      <div class="form-group">
        <label class="form-label">VALOR</label>
        <input type="number" class="form-control" id="ie-valor" value="0" step="any">
      </div>

      <div class="form-group">
        <label class="form-label">CONCEPTO</label>
        <input class="form-control" id="ie-concepto" placeholder="Ej: Anticipo, compra, gasto menor, etc.">
      </div>

      <div class="form-group">
        <label class="form-label">FECHA</label>
        <input type="date" class="form-control" id="ie-fecha" value="${today()}">
      </div>

      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" style="flex:1" onclick="AppIngresosEgresosModule.guardar(${JSON.stringify({ tipo })})">Guardar</button>
      </div>
    `);

    // Defaults
    const cajaSel = document.getElementById('ie-caja-sel');
    if (cajaSel) cajaSel.value = defCajaId;
    const metodoSel = document.getElementById('ie-metodo-sel');
    if (metodoSel) metodoSel.value = defMetodoId;
  }

  function resolveValorYConcepto(state) {
    const valor = parseFloat(document.getElementById('ie-valor')?.value) || 0;
    const concepto = document.getElementById('ie-concepto')?.value.trim() || '';
    return { valor, concepto };
  }

  function guardarMovimientoManual(ctx, tipo) {
    const { state, uid, dbId, saveRecord, closeModal, notify, today, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;

    const cajaId = document.getElementById('ie-caja-sel')?.value;
    const metodoId = document.getElementById('ie-metodo-sel')?.value;
    const fecha = document.getElementById('ie-fecha')?.value || today();
    const { valor, concepto } = resolveValorYConcepto(state);

    if (!cajaId) {
      notify('warning', '⚠️', 'Caja', 'Selecciona una caja.', { duration: 3000 });
      return Promise.resolve(false);
    }
    if (valor <= 0) {
      notify('warning', '⚠️', 'Valor', 'Ingresa un valor mayor a 0.', { duration: 3000 });
      return Promise.resolve(false);
    }
    if (!concepto) {
      notify('warning', '⚠️', 'Concepto', 'Ingresa un concepto.', { duration: 3000 });
      return Promise.resolve(false);
    }

    const caja = (state.cajas || []).find((c) => c.id === cajaId);
    if (!caja || caja.estado !== 'abierta') {
      notify('warning', '🏧', 'Caja', 'La caja seleccionada no está abierta.', { duration: 4500 });
      return Promise.resolve(false);
    }
    global.AppCajaLogic?.normalizeCaja?.(caja);

    const bucket = bucketFromMetodoId(metodoId, state);
    // Validación de saldo para egreso
    if (tipo === 'egreso') {
      const disp = global.AppCajaLogic?.saldoEnBucket?.(caja, bucket) ?? 0;
      if (disp < valor) {
        notify('warning', '⚠️', 'Saldo insuficiente', `En «${bucket}» hay ${fmt(disp)}.`, { duration: 5000 });
        return Promise.resolve(false);
      }
    }

    const mov = {
      id: nextId(),
      cajaId,
      tipo,
      valor,
      concepto,
      fecha,
      metodo: metodoId,
      categoria: tipo === 'egreso' ? 'gasto' : 'otro_ingreso',
      bucket
    };

    // Conecta sesión activa del turno
    global.AppCajaLogic?.enrichMovWithSesion?.(state, cajaId, mov, nextId);

    // Ajusta caja: ingreso suma, egreso resta
    if (tipo === 'ingreso') global.AppCajaLogic?.applyDeltaBucket?.(caja, bucket, valor);
    else global.AppCajaLogic?.applyDeltaBucket?.(caja, bucket, -valor);

    if (!Array.isArray(state.tes_movimientos)) state.tes_movimientos = [];
    state.tes_movimientos.push(mov);

    return (async () => {
      await saveRecord('cajas', caja.id, caja);
      await saveRecord('tes_movimientos', mov.id, mov);
      closeModal();
      renderList(_ctx || ctx);
      notify('success', tipo === 'ingreso' ? '📥' : '📤', tipo === 'ingreso' ? 'Ingreso guardado' : 'Egreso guardado', `${concepto} · ${fmt(valor)}`, { duration: 3500 });
      return true;
    })();
  }

  function renderPage(ctx) {
    _ctx = ctx;
    renderList(_ctx);
  }

  global.AppIngresosEgresosModule = {
    renderPage: renderPage,
    refresh: function () {
      if (_ctx) renderList(_ctx);
    },
    openIngresoModal: function () {
      if (_ctx) return renderIngresoEgresoModal(_ctx, 'ingreso');
      renderIngresoEgresoModal({ state: global.state || {}, openModal: global.openModal, today: global.today, notify: global.notify }, 'ingreso');
    },
    openEgresoModal: function () {
      if (_ctx) return renderIngresoEgresoModal(_ctx, 'egreso');
      renderIngresoEgresoModal({ state: global.state || {}, openModal: global.openModal, today: global.today, notify: global.notify }, 'egreso');
    },
    guardar: function (p) {
      // Este método se llama desde el modal con {tipo}. El core.js ya expone state/ctx dentro del window.
      // Para mantener consistencia con el resto del sistema, el core delega el guardado con el ctx correcto.
      if (typeof global.__IE_GUARDAR__ === 'function') return global.__IE_GUARDAR__(p);
    }
  };

  // Exponer hooks para que el core pueda pasar ctx completo
  global.__IE_SETUP__ = function setup(ctx) {
    _ctx = ctx;
    global.__IE_GUARDAR__ = function (p) {
      return guardarMovimientoManual(ctx, p.tipo);
    };
    global.AppIngresosEgresosModule.openIngresoModal = function () {
      return renderIngresoEgresoModal(ctx, 'ingreso');
    };
    global.AppIngresosEgresosModule.openEgresoModal = function () {
      return renderIngresoEgresoModal(ctx, 'egreso');
    };
  };
})(window);

