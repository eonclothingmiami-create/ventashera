// Treasury module: cajas, trazabilidad de dinero y colecciones simples.
// El subsistema CXP Proveedores / Compras fue retirado del frontend (la base de datos queda intacta).
(function initTreasuryModule(global) {
  let _tesDineroRango = { desde: null, hasta: null };
  let _lastTesDineroCtx = null;

  function normFechaMov(f) {
    if (f == null || f === '') return '';
    const s = String(f);
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  function parsePosRefFromConcepto(concepto) {
    const m = String(concepto || '').match(/Venta POS\s+([^\s·]+)/i);
    return m ? m[1].trim() : '';
  }

  /**
   * Resuelve la fila `state.ventas` a partir del número POS (referencia / factura.number).
   * Usa comparación estricta de ids (uuid texto) al enlazar factura ↔ venta.
   */
  function resolveVentaForPosRef(state, ref) {
    const r = String(ref || '').trim();
    if (!r) return null;
    const ventas = state.ventas || [];
    let v = ventas.find((x) => String((x.desc || '').trim()) === r);
    if (v) return v;
    v = ventas.find((x) => String(x.desc || '').includes(r));
    if (v) return v;
    const f = (state.facturas || []).find((x) => String((x.numero || '').trim()) === r);
    if (f) {
      v = ventas.find((x) => String(x.id) === String(f.id));
      if (v) return v;
    }
    return null;
  }

  /** Escapa HTML para modales de tesorería. */
  function escTesHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escTesAttr(s) {
    return String(s ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
  }

  /** Fecha + hora para movimientos de caja (created_at de Supabase o ISO en fecha). */
  function formatTesMovFechaHora(m, formatDate) {
    const raw = m.createdAt || m.created_at || m.fecha;
    if (raw == null || raw === '') return '—';
    const s = String(raw);
    const datePart = normFechaMov(s);
    const fd = typeof formatDate === 'function' ? formatDate(datePart) : datePart;
    const hasTime = !!(m.createdAt || m.created_at) || s.includes('T');
    if (!hasTime) return fd;
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const hora = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
        return hora ? `${fd} ${hora}` : fd;
      }
    } catch (_) { /* noop */ }
    return fd;
  }

  /**
   * Enlaza un movimiento `venta_pos` con su factura POS (solo lectura; no crea registros).
   */
  function resolveFacturaFromTesMovimiento(state, mov) {
    if (!mov || mov.categoria !== 'venta_pos' || mov.tipo !== 'ingreso') return null;
    const facturas = state.facturas || [];
    const ventas = state.ventas || [];
    const idKeys = ['facturaId', 'invoiceId', 'documentoId', 'factura_id', 'invoice_id', 'documento_id'];
    for (let i = 0; i < idKeys.length; i++) {
      const fid = mov[idKeys[i]];
      if (fid == null || String(fid).trim() === '') continue;
      const sid = String(fid).trim();
      const byId = facturas.find((f) => String(f.id) === sid);
      if (byId) return byId;
      const ventaByInv = ventas.find((v) => String(v.invoiceId || '') === sid);
      if (ventaByInv && ventaByInv.invoiceId) {
        const fInv = facturas.find((f) => String(f.id) === String(ventaByInv.invoiceId));
        if (fInv) return fInv;
      }
      const ventaById = ventas.find((v) => String(v.id) === sid);
      if (ventaById) {
        if (ventaById.invoiceId) {
          const f2 = facturas.find((f) => String(f.id) === String(ventaById.invoiceId));
          if (f2) return f2;
        }
        const f3 = facturas.find((f) => String(f.id) === String(ventaById.id));
        if (f3) return f3;
      }
    }
    const ref = parsePosRefFromConcepto(mov.concepto);
    if (!ref) return null;
    const byNum = facturas.find((f) => String((f.numero || '').trim()) === ref);
    if (byNum) return byNum;
    const venta = resolveVentaForPosRef(state, ref);
    if (!venta) return null;
    if (venta.invoiceId) {
      const fInv = facturas.find((f) => String(f.id) === String(venta.invoiceId));
      if (fInv) return fInv;
    }
    return facturas.find((f) => String(f.id) === String(venta.id)) || null;
  }

  function canalLabelFactura(f) {
    const c = String(f?.canal || '').toLowerCase();
    if (c === 'vitrina') return 'Vitrina';
    if (c === 'local') return 'Local';
    if (c === 'inter') return 'Inter';
    return f?.canal || '—';
  }

  /** Modal solo lectura; no llama a printReceipt ni printDoc. */
  function openFacturaReadonlyModal(ctx, factura) {
    const openModalFn = ctx.openModal || global.openModal;
    if (!openModalFn || !factura) return;
    const fmt = ctx.fmt || global.fmt;
    const formatDate = ctx.formatDate || global.formatDate;
    const itemsHtml = (factura.items || [])
      .map((i) => {
        const q = parseFloat(i.qty ?? i.cantidad) || 1;
        const p = parseFloat(i.precio ?? i.price) || 0;
        const talla = i.talla ? ` · ${escTesHtml(i.talla)}` : '';
        return `<tr>
          <td>${escTesHtml(i.nombre || i.name || '—')}${talla}</td>
          <td style="text-align:center">${q}</td>
          <td style="text-align:right">${fmt(p)}</td>
          <td style="text-align:right;font-weight:700;color:var(--accent)">${fmt(q * p)}</td>
        </tr>`;
      })
      .join('');
    const metodo = factura.metodo || factura.metodoPago || '—';
    openModalFn(
      `<div class="modal-title">${escTesHtml(factura.numero || 'Factura')}<span class="badge badge-info" style="margin-left:8px;font-size:10px">Solo lectura</span><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="grid-2" style="margin-bottom:12px;gap:8px">
        <div><span style="color:var(--text2);font-size:12px">Fecha:</span> ${escTesHtml(typeof formatDate === 'function' ? formatDate(factura.fecha) : factura.fecha || '—')}</div>
        <div><span style="color:var(--text2);font-size:12px">Estado:</span> ${escTesHtml(factura.estado || '—')}</div>
        <div><span style="color:var(--text2);font-size:12px">Cliente:</span> ${escTesHtml(factura.cliente || '—')}</div>
        <div><span style="color:var(--text2);font-size:12px">Teléfono:</span> ${escTesHtml(factura.telefono || '—')}</div>
        <div><span style="color:var(--text2);font-size:12px">Canal:</span> ${escTesHtml(canalLabelFactura(factura))}</div>
        <div><span style="color:var(--text2);font-size:12px">Método de pago:</span> ${escTesHtml(metodo)}</div>
      </div>
      <div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>Artículo</th><th>Cant</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>
      ${itemsHtml || '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px">Sin ítems</td></tr>'}
      </tbody></table></div>
      <div style="text-align:right;margin-bottom:6px"><span style="color:var(--text2)">Subtotal:</span> ${fmt(factura.subtotal || 0)}</div>
      ${parseFloat(factura.iva) > 0 ? `<div style="text-align:right;margin-bottom:6px"><span style="color:var(--text2)">IVA:</span> ${fmt(factura.iva)}</div>` : ''}
      ${parseFloat(factura.flete) > 0 ? `<div style="text-align:right;margin-bottom:6px"><span style="color:var(--text2)">Flete:</span> ${fmt(factura.flete)}</div>` : ''}
      <div style="text-align:right;font-family:Syne;font-size:20px;font-weight:800;color:var(--accent)">${fmt(factura.total || 0)}</div>
      <div style="margin-top:16px;text-align:right"><button type="button" class="btn btn-secondary" onclick="closeModal()">Cerrar</button></div>`,
      true
    );
  }

  function verFacturaTesMovimiento(movId) {
    const ctx = _lastTesDineroCtx;
    if (!ctx || !ctx.state) return;
    const mov = (ctx.state.tes_movimientos || []).find((m) => String(m.id) === String(movId));
    if (!mov) return;
    const factura = resolveFacturaFromTesMovimiento(ctx.state, mov);
    if (!factura) return;
    openFacturaReadonlyModal(ctx, factura);
  }

  /**
   * Agrupa movimientos de caja por riel de dinero (no por canal de venta).
   * Usa método y bucket como referencia; normaliza aliases (nequi, daviplata, etc. → transferencia).
   */
  function paymentRailForTesMov(m) {
    const parts = [m && m.metodo, m && m.bucket]
      .filter((x) => x != null && String(x).trim() !== '')
      .map((x) =>
        String(x)
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
      );
    const raw = parts.join(' ');
    if (!raw) return 'otro';
    if (
      /transfer|transf|nequi|daviplata|bancolombia|davivienda|bbva|pse|spei|ach|bancario|ahorr|corrient|app\b|llave|clave/i.test(
        raw
      )
    ) {
      return 'transferencia';
    }
    if (/^efectivo$|^cash$|efectivo|billete|moneda/.test(raw)) {
      return 'efectivo';
    }
    return 'otro';
  }

  function renderTesCajas(ctx) {
    const { state, fmt } = ctx;
    const cajas = state.cajas || [];
    if (global.AppCajaLogic?.normalizeAllCajas) global.AppCajaLogic.normalizeAllCajas(state);
    const miniSaldos = (c) => {
      global.AppCajaLogic?.normalizeCaja?.(c);
      const s = c.saldosMetodo || {};
      const keys = ['transferencia', 'addi', 'contraentrega', 'tarjeta', 'digital', 'otro'];
      const bits = keys.map((k) => {
        const v = parseFloat(s[k]);
        if (!Number.isFinite(v) || v === 0) return '';
        const col = v < 0 ? '#f87171' : 'var(--text2)';
        return `<span style="color:var(--text2)">${k}:</span> <b style="color:${col}">${fmt(v)}</b>`;
      }).filter(Boolean);
      return bits.length ? `<div style="font-size:10px;line-height:1.5;margin:8px 0;color:var(--text2)">${bits.join(' · ')}</div>` : '';
    };
    document.getElementById('tes_cajas-content').innerHTML = `<div style="font-size:11px;color:var(--text2);margin-bottom:12px;line-height:1.45">💵 <b>Turno</b>: con la caja <b>cerrada</b> usa <b>Abrir turno</b> (arrastra lo del último cierre). Con la caja <b>abierta</b> cobras en POS; al terminar <b>Cerrar turno</b> hace arqueo (efectivo contado vs libro, bancos declarados, sobrante/faltante). El número grande es efectivo en libro.</div><button class="btn btn-primary" style="margin-bottom:16px" onclick="openCajaModal()">+ Nueva Caja</button><div class="grid-2">${cajas
      .map(
        (c) =>
          `<div class="card" style="margin:0;border-color:${c.estado === 'abierta' ? 'rgba(0,229,180,.3)' : 'var(--border)'}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-family:Syne;font-weight:800;font-size:16px">${c.nombre}</div><span class="badge ${c.estado === 'abierta' ? 'badge-ok' : 'badge-pend'}">${c.estado === 'abierta' ? 'turno abierto' : 'cerrada'}</span></div><div style="font-size:10px;color:var(--text2);margin-bottom:4px">Efectivo en caja (libro)</div>${(() => {
            global.AppCajaLogic?.normalizeCaja?.(c);
            const efe = Number(c.saldosMetodo?.efectivo ?? c.saldo ?? 0);
            const col = efe < 0 ? '#f87171' : 'var(--accent)';
            return '<div style="font-family:Syne;font-size:28px;font-weight:800;color:' + col + ';margin-bottom:4px">' + fmt(efe) + '</div>';
          })()}${miniSaldos(c)}<div class="btn-group" style="flex-wrap:wrap">${c.estado === 'abierta' ? `<button class="btn btn-sm btn-danger" onclick="cerrarCaja('${c.id}')">🔒 Cerrar turno</button>` : `<button class="btn btn-sm btn-primary" onclick="abrirCaja('${c.id}')">🔓 Abrir turno</button>`}<button class="btn btn-sm btn-secondary" onclick="verCierresCajaModal('${c.id}')">📋 Cierres</button></div></div>`
      )
      .join('')}</div>`;
  }

  function openCajaModal(ctx) {
    ctx.openModal(
      `<div class="modal-title">Nueva Caja<button class="modal-close" onclick="closeModal()">×</button></div><div class="form-group"><label class="form-label">NOMBRE</label><input class="form-control" id="m-caja-nombre" placeholder="Ej: Caja 2"></div><div class="form-group"><label class="form-label">SALDO INICIAL</label><input type="number" class="form-control" id="m-caja-saldo" value="0"></div><button class="btn btn-primary" style="width:100%" onclick="saveCaja()">Crear Caja</button>`
    );
  }

  async function saveCaja(ctx) {
    const { state, uid, dbId, saveRecord, closeModal, renderTesCajas } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const nombre = document.getElementById('m-caja-nombre').value.trim();
    if (!nombre) return;
    const inicial = parseFloat(document.getElementById('m-caja-saldo').value) || 0;
    const saldos = global.AppCajaLogic?.emptySaldos ? global.AppCajaLogic.emptySaldos() : { efectivo: 0, transferencia: 0, addi: 0, contraentrega: 0, tarjeta: 0, digital: 0, otro: 0 };
    saldos.efectivo = inicial;
    const caja = {
      id: nextId(),
      nombre,
      saldo: inicial,
      estado: 'abierta',
      apertura: ctx.today(),
      bodegaIds: [],
      saldosMetodo: saldos
    };
    global.AppCajaLogic?.normalizeCaja?.(caja);
    caja.sesionActivaId = nextId();
    state.cajas.push(caja);
    const ok = await saveRecord('cajas', caja.id, caja);
    if (!ok) {
      state.cajas = (state.cajas || []).filter((x) => x.id !== caja.id);
      if (typeof ctx.notify === 'function') {
        ctx.notify('danger', '⚠️', 'No se pudo crear caja', 'Error al persistir en base de datos.', { duration: 4500 });
      }
      return;
    }
    closeModal();
    renderTesCajas();
  }

  function openAbrirCajaModal(ctx) {
    const { state, id, openModal, fmt, today, notify } = ctx;
    const c = (state.cajas || []).find((x) => x.id === id);
    if (!c) return;
    if (c.estado === 'abierta') {
      notify('warning', '🏧', 'Caja abierta', 'Esta caja ya tiene turno abierto.', { duration: 3000 });
      return;
    }
    global.AppCajaLogic?.normalizeCaja?.(c);
    const sug = global.AppCajaLogic?.saldosSugeridosApertura?.(c) || { efectivo: 0, transferencia: 0 };
    const sk = global.AppCajaLogic?.BUCKET_KEYS || [];
    const rows = sk
      .map(
        (k) =>
          `<div class="form-group"><label class="form-label">${k.toUpperCase()} (apertura)</label><input type="number" class="form-control ap-saldo-bucket" data-bucket="${k}" value="${sug[k] ?? 0}" step="any"></div>`
      )
      .join('');
    openModal(`<div class="modal-title">🔓 Abrir turno — ${c.nombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <input type="hidden" id="ap-caja-id" value="${c.id}">
    <p style="font-size:11px;color:var(--text2);line-height:1.5;margin:0 0 12px">Los valores por defecto vienen del <b>último cierre</b> (efectivo contado y bancos declarados). Puedes corregirlos si hace falta. Luego se abre una <b>nueva sesión</b> para amarrar movimientos.</p>
    <div class="form-group"><label class="form-label">FECHA APERTURA</label><input type="date" class="form-control" id="ap-fecha" value="${today()}"></div>
    ${rows}
    <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="guardarAbrirCaja()">✅ Abrir caja y comenzar turno</button>`);
  }

  async function guardarAbrirCaja(ctx) {
    const { state, dbId, uid, saveRecord, closeModal, renderTesCajas, notify, today } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const id = document.getElementById('ap-caja-id')?.value;
    const c = (state.cajas || []).find((x) => x.id === id);
    if (!c) return;
    const fecha = document.getElementById('ap-fecha')?.value || today();
    const saldos = global.AppCajaLogic?.emptySaldos ? global.AppCajaLogic.emptySaldos() : {};
    document.querySelectorAll('.ap-saldo-bucket').forEach((el) => {
      const k = el.getAttribute('data-bucket');
      if (k) saldos[k] = parseFloat(el.value) || 0;
    });
    global.AppCajaLogic?.normalizeCaja?.(c);
    c.saldosMetodo = saldos;
    c.saldo = saldos.efectivo || 0;
    c.estado = 'abierta';
    c.apertura = fecha;
    c.sesionActivaId = nextId();
    c.proximaAperturaSaldos = null;
    await saveRecord('cajas', c.id, c);
    closeModal();
    renderTesCajas();
    notify('success', '🔓', 'Turno abierto', `${c.nombre} · Sesión nueva · Efectivo inicial ${ctx.fmt(saldos.efectivo || 0)}`, { duration: 4000 });
  }

  function openCerrarCajaModal(ctx) {
    const { state, id, openModal, fmt, today } = ctx;
    const c = (state.cajas || []).find((x) => x.id === id);
    if (!c || c.estado !== 'abierta') return;
    global.AppCajaLogic?.normalizeCaja?.(c);
    const libroEfe = global.AppCajaLogic?.saldoEnBucket?.(c, 'efectivo') ?? c.saldo ?? 0;
    const libroTrans = global.AppCajaLogic?.saldoEnBucket?.(c, 'transferencia') ?? 0;
    const ses = global.AppCajaLogic?.resumenSesionCaja?.(state, c.id, c.sesionActivaId) || { movsCount: 0, efectivoNeto: 0, transferNeto: 0 };
    global._cierreLibroEfe = libroEfe;
    global._cierreLibroTrans = libroTrans;
    global._cierreCajaId = c.id;
    openModal(`<div class="modal-title">🔒 Cierre y arqueo — ${c.nombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <input type="hidden" id="cc-caja-id" value="${c.id}">
    <div style="font-size:11px;color:var(--text2);line-height:1.55;margin-bottom:12px;padding:10px;background:rgba(0,229,180,.08);border-radius:8px;border:1px solid rgba(0,229,180,.25)">
      <b>Libro (ingresos − egresos en buckets)</b><br>
      Efectivo en libro: <b style="color:var(--accent)">${fmt(libroEfe)}</b> · Transferencias/bancos en libro: <b>${fmt(libroTrans)}</b><br>
      <span style="font-size:10px">Movimientos esta sesión: ${ses.movsCount} · Neto efectivo mov.: ${fmt(ses.efectivoNeto)} · Neto transf. mov.: ${fmt(ses.transferNeto)}</span>
    </div>
    <div class="form-group"><label class="form-label">💵 EFECTIVO CONTADO (físico en caja)</label><input type="number" class="form-control" id="cc-contado-efe" value="${Math.round(libroEfe)}" step="any" oninput="recalcCierreArqueo()"></div>
    <div class="form-group"><label class="form-label">🏦 SALDO EN CUENTAS / BANCOS (declarado)</label><input type="number" class="form-control" id="cc-decl-banco" value="${Math.round(libroTrans)}" step="any" oninput="recalcCierreArqueo()"></div>
    <div id="cc-arqueo-box" style="margin:12px 0;padding:12px;border-radius:8px;border:1px solid var(--border);background:var(--bg3)">
      <div style="font-size:11px;font-weight:800;margin-bottom:6px">ARQUEO EFECTIVO (contado − libro)</div>
      <div id="cc-diff-efe" style="font-size:13px;font-weight:700;color:var(--green)">${fmt(0)} · CUADRA</div>
      <div style="font-size:11px;font-weight:800;margin:10px 0 6px">ARQUEO BANCOS (declarado − libro)</div>
      <div id="cc-diff-trans" style="font-size:13px;font-weight:700;color:var(--green)">${fmt(0)} · CUADRA</div>
    </div>
    <div class="form-group"><label class="form-label">NOTA DEL CIERRE</label><input class="form-control" id="cc-nota" placeholder="Observaciones"></div>
    <p style="font-size:10px;color:var(--text2);line-height:1.45">Al confirmar se <b>ajusta el libro</b> a lo contado (movimientos de arqueo) y se guarda el histórico. Al <b>abrir</b> el próximo turno se sugerirán estos montos como arrastre.</p>
    <button class="btn btn-danger" style="width:100%" onclick="guardarCierreCaja()">🔒 Confirmar cierre</button>`);
  }

  async function guardarCierreCaja(ctx) {
    const { state, dbId, uid, today, saveRecord, closeModal, renderTesCajas, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const id = document.getElementById('cc-caja-id')?.value;
    const c = (state.cajas || []).find((x) => x.id === id);
    if (!c || c.estado !== 'abierta') return;
    global.AppCajaLogic?.normalizeCaja?.(c);
    const libroEfe = global.AppCajaLogic?.saldoEnBucket?.(c, 'efectivo') ?? 0;
    const libroTrans = global.AppCajaLogic?.saldoEnBucket?.(c, 'transferencia') ?? 0;
    const contado = parseFloat(document.getElementById('cc-contado-efe')?.value) || 0;
    const declBanco = parseFloat(document.getElementById('cc-decl-banco')?.value) || 0;
    const nota = document.getElementById('cc-nota')?.value.trim() || '';
    const difE = contado - libroEfe;
    const difT = declBanco - libroTrans;
    const resE = Math.abs(difE) < 0.5 ? 'cuadra' : difE > 0 ? 'sobrante' : 'faltante';

    const arqueoMovs = [];
    const pushArqueoMov = (bucket, delta, label) => {
      if (Math.abs(delta) < 0.005) return;
      const tipo = delta > 0 ? 'ingreso' : 'egreso';
      const valor = Math.abs(delta);
      const mov = {
        id: nextId(),
        cajaId: c.id,
        tipo,
        valor,
        concepto: label,
        fecha: today(),
        metodo: bucket === 'efectivo' ? 'efectivo' : 'transferencia',
        categoria: 'arqueo_cierre',
        bucket
      };
      const { cajaPatched } = global.AppCajaLogic?.enrichMovWithSesion?.(state, c.id, mov, nextId) || {};
      if (cajaPatched) {
        /* sesión ya existía normalmente */
      }
      global.AppCajaLogic?.applyDeltaBucket?.(c, bucket, tipo === 'ingreso' ? valor : -valor);
      if (!state.tes_movimientos) state.tes_movimientos = [];
      state.tes_movimientos.push(mov);
      arqueoMovs.push(mov);
    };

    pushArqueoMov('efectivo', difE, `Arqueo cierre efectivo (${resE === 'cuadra' ? 'cuadre' : resE})`);
    pushArqueoMov('transferencia', difT, 'Arqueo cierre bancos / transferencias');

    const saldosFin = { ...(c.saldosMetodo || {}) };
    const cierre = {
      id: nextId(),
      cajaId: c.id,
      cajaNombre: c.nombre,
      fechaCierre: today(),
      libroEfectivo: libroEfe,
      libroTransferencia: libroTrans,
      contadoEfectivo: contado,
      declaradoBancos: declBanco,
      difEfectivo: difE,
      difTransferencia: difT,
      resultadoEfectivo: resE,
      nota,
      saldosLibroJson: saldosFin
    };
    if (!state.tes_cierres_caja) state.tes_cierres_caja = [];
    state.tes_cierres_caja.push(cierre);

    const empty = global.AppCajaLogic?.emptySaldos ? global.AppCajaLogic.emptySaldos() : {};
    c.proximaAperturaSaldos = { ...empty };
    (global.AppCajaLogic?.BUCKET_KEYS || []).forEach((k) => {
      c.proximaAperturaSaldos[k] = parseFloat(c.saldosMetodo[k]) || 0;
    });
    c.proximaAperturaSaldos.efectivo = contado;
    c.proximaAperturaSaldos.transferencia = declBanco;

    c.estado = 'cerrada';
    c.sesionActivaId = null;

    for (let i = 0; i < arqueoMovs.length; i++) {
      await saveRecord('tes_movimientos', arqueoMovs[i].id, arqueoMovs[i]);
    }
    await saveRecord('tes_cierres_caja', cierre.id, cierre);
    await saveRecord('cajas', c.id, c);

    closeModal();
    renderTesCajas();
    const msg =
      resE === 'cuadra'
        ? 'Efectivo cuadra.'
        : resE === 'sobrante'
          ? `Sobrante efectivo ${fmt(difE)}.`
          : `Faltante efectivo ${fmt(Math.abs(difE))}.`;
    notify('success', '🔒', 'Cierre registrado', msg + ' · Bancos Δ ' + fmt(difT), { duration: 5000 });
  }

  function verCierresCajaModal(ctx) {
    const { state, id, openModal, fmt, formatDate } = ctx;
    const c = (state.cajas || []).find((x) => x.id === id);
    if (!c) return;
    const hist = (state.tes_cierres_caja || []).filter((x) => x.cajaId === id).slice(0, 15);
    openModal(`<div class="modal-title">📋 Cierres — ${c.nombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Libro Efe.</th><th>Contado</th><th>Δ Efe.</th><th>Bancos decl.</th><th>Resultado</th></tr></thead><tbody>${
      hist.length
        ? hist
            .map(
              (h) =>
                `<tr><td>${formatDate(h.fechaCierre)}</td><td>${fmt(h.libroEfectivo)}</td><td>${fmt(h.contadoEfectivo)}</td><td style="color:${h.difEfectivo >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(h.difEfectivo)}</td><td>${fmt(h.declaradoBancos)}</td><td>${h.resultadoEfectivo || '—'}</td></tr>`
            )
            .join('')
        : '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:16px">Sin cierres guardados</td></tr>'
    }</tbody></table></div>`);
  }

  function cerrarCaja(ctx) {
    openCerrarCajaModal(ctx);
  }

  function abrirCaja(ctx) {
    openAbrirCajaModal(ctx);
  }

  async function saveMovCaja(ctx) {
    const { state, cajaId, tipo, uid, dbId, today, saveRecord, closeModal, renderTesCajas, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const valor = parseFloat(document.getElementById('m-mov-valor').value) || 0;
    if (valor <= 0) return;
    const concepto = document.getElementById('m-mov-concepto').value.trim();
    if (!concepto) {
      notify('warning', '⚠️', 'Concepto', 'Describe el movimiento.', { duration: 3000 });
      return;
    }
    const metodo = document.getElementById('m-mov-metodo').value;
    const catEl = document.getElementById('m-mov-categoria');
    const categoria = catEl ? catEl.value : tipo === 'egreso' ? 'gasto' : 'otro_ingreso';
    const caja = (state.cajas || []).find((c) => c.id === cajaId);
    if (!caja) return;
    global.AppCajaLogic?.normalizeCaja?.(caja);
    const bucket =
      (document.getElementById('m-mov-bucket') && document.getElementById('m-mov-bucket').value) ||
      global.AppCajaLogic?.bucketFromMetodoId?.(metodo, state.cfg_metodos_pago) ||
      'efectivo';

    if (tipo === 'ingreso') {
      global.AppCajaLogic?.applyDeltaBucket?.(caja, bucket, valor);
    } else {
      const disp = global.AppCajaLogic?.saldoEnBucket?.(caja, bucket) ?? caja.saldo ?? 0;
      if (disp < valor) {
        notify('warning', '⚠️', 'Saldo insuficiente', `En bucket «${bucket}» hay ${fmt(disp)}.`, { duration: 5000 });
        return;
      }
      global.AppCajaLogic?.applyDeltaBucket?.(caja, bucket, -valor);
    }

    const mov = {
      id: nextId(),
      cajaId,
      tipo,
      valor,
      concepto,
      fecha: today(),
      metodo,
      categoria,
      bucket
    };
    global.AppCajaLogic?.enrichMovWithSesion?.(state, cajaId, mov, nextId);
    state.tes_movimientos.push(mov);
    await saveRecord('cajas', caja.id, caja);
    await saveRecord('tes_movimientos', mov.id, mov);
    closeModal();
    renderTesCajas();
    notify('success', '✅', tipo === 'ingreso' ? 'Ingreso' : 'Egreso', fmt(valor) + ' · ' + bucket + ' · ' + concepto, { duration: 3000 });
  }

  function openMovCajaModal(ctx) {
    const { state, cajaId, tipo, openModal, fmt, notify } = ctx;
    const caja = (state.cajas || []).find((c) => c.id === cajaId);
    if (!caja) return;
    if (caja.estado !== 'abierta') {
      if (typeof notify === 'function') notify('warning', '🔒', 'Caja cerrada', 'Abre la caja antes de registrar movimientos.', { duration: 4000 });
      return;
    }
    global.AppCajaLogic?.normalizeCaja?.(caja);
    const metodosOpts = (
      state.cfg_metodos_pago && state.cfg_metodos_pago.filter((m) => m.activo !== false).length > 0
        ? state.cfg_metodos_pago.filter((m) => m.activo !== false)
        : [
            { id: 'efectivo', nombre: '💵 Efectivo' },
            { id: 'transferencia', nombre: '📱 Transferencia' },
            { id: 'addi', nombre: '💜 Addi' },
            { id: 'tarjeta', nombre: '💳 Tarjeta' }
          ]
    )
      .map((m) => `<option value="${m.id}">${m.nombre}</option>`)
      .join('');
    const bucketOpts = (global.AppCajaLogic?.BUCKET_KEYS || ['efectivo', 'transferencia', 'addi', 'contraentrega', 'tarjeta', 'digital', 'otro'])
      .map((k) => `<option value="${k}">${k}</option>`)
      .join('');
    const catIngreso = `<select class="form-control" id="m-mov-categoria"><option value="base_caja">📥 Base / arrastre efectivo</option><option value="otro_ingreso">Otro ingreso</option></select>`;
    const catEgreso = `<select class="form-control" id="m-mov-categoria"><option value="gasto">📤 Gasto operativo</option><option value="otro_egreso">Otro egreso</option></select>`;
    openModal(`<div class="modal-title">${tipo === 'ingreso' ? '📥 Ingreso' : '📤 Egreso / Gasto'} — ${caja.nombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45">Efectivo: <b>${fmt(caja.saldosMetodo?.efectivo ?? caja.saldo ?? 0)}</b> · Registra en qué <b>bucket</b> entra o sale el dinero.</p>
    <div class="form-group"><label class="form-label">VALOR</label><input type="number" class="form-control" id="m-mov-valor" min="0" step="any" placeholder="0"></div>
    <div class="form-group"><label class="form-label">CONCEPTO</label><input class="form-control" id="m-mov-concepto" placeholder="Ej: Papelería, base día, etc."></div>
    <div class="form-row"><div class="form-group"><label class="form-label">MÉTODO (referencia)</label><select class="form-control" id="m-mov-metodo">${metodosOpts}</select></div>
    <div class="form-group"><label class="form-label">BUCKET</label><select class="form-control" id="m-mov-bucket">${bucketOpts}</select></div></div>
    <div class="form-group"><label class="form-label">CLASIFICACIÓN</label>${tipo === 'ingreso' ? catIngreso : catEgreso}</div>
    <button class="btn btn-primary" style="width:100%" onclick="saveMovCaja('${cajaId}','${tipo}')">Guardar</button>`);
  }

  function renderTesDinero(ctx) {
    _lastTesDineroCtx = {
      ...ctx,
      openModal: ctx.openModal || global.openModal
    };
    const { state, formatDate, fmt, today } = _lastTesDineroCtx;
    const t = typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10);
    const desdeEl = document.getElementById('tes-dinero-desde');
    const hastaEl = document.getElementById('tes-dinero-hasta');
    if (desdeEl && desdeEl.value) _tesDineroRango.desde = desdeEl.value;
    if (hastaEl && hastaEl.value) _tesDineroRango.hasta = hastaEl.value;
    if (_tesDineroRango.desde == null) _tesDineroRango.desde = t;
    if (_tesDineroRango.hasta == null) _tesDineroRango.hasta = t;
    let desde = _tesDineroRango.desde;
    let hasta = _tesDineroRango.hasta;
    if (desde > hasta) {
      const x = desde;
      desde = hasta;
      hasta = x;
      _tesDineroRango.desde = desde;
      _tesDineroRango.hasta = hasta;
    }

    const movsFiltered = [...(state.tes_movimientos || [])]
      .filter((m) => {
        const d = normFechaMov(m.fecha);
        return d >= desde && d <= hasta;
      })
      .sort((a, b) => {
        const ta = String(a.createdAt || a.created_at || a.fecha || '');
        const tb = String(b.createdAt || b.created_at || b.fecha || '');
        if (ta !== tb) return tb.localeCompare(ta);
        const da = normFechaMov(a.fecha);
        const db = normFechaMov(b.fecha);
        if (da !== db) return db.localeCompare(da);
        return String(b.id || '').localeCompare(String(a.id || ''));
      });

    let sumEfectivo = 0;
    let sumTransferencia = 0;
    let sumTotalPeriodo = 0;
    let sumVentaPosIng = 0;
    let lineasVentaPos = 0;
    for (let i = 0; i < movsFiltered.length; i++) {
      const m = movsFiltered[i];
      const val = parseFloat(m.valor) || 0;
      const signed = m.tipo === 'egreso' ? -val : val;
      sumTotalPeriodo += signed;
      const rail = paymentRailForTesMov(m);
      if (rail === 'efectivo') sumEfectivo += signed;
      else if (rail === 'transferencia') sumTransferencia += signed;
      if (m.tipo === 'ingreso' && m.categoria === 'venta_pos') {
        sumVentaPosIng += val;
        lineasVentaPos++;
      }
    }

    const rows =
      movsFiltered
        .map((m) => {
          const caja = (state.cajas || []).find((c) => c.id === m.cajaId);
          const factura = resolveFacturaFromTesMovimiento(state, m);
          const verBtn = factura
            ? `<button type="button" class="btn btn-xs btn-secondary" title="Ver factura ${escTesAttr(factura.numero || '')}" onclick="verFacturaTesMovimiento('${escTesAttr(m.id)}')">Ver</button>`
            : '';
          return `<tr><td style="white-space:nowrap;font-size:12px">${formatTesMovFechaHora(m, formatDate)}</td><td>${escTesHtml(caja?.nombre || '—')}</td><td><span class="badge ${m.tipo === 'ingreso' ? 'badge-ok' : 'badge-pend'}">${escTesHtml(m.tipo)}</span></td><td style="color:${m.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)'};font-weight:700">${fmt(m.valor)}</td><td style="font-size:11px">${escTesHtml(m.bucket || '—')}</td><td style="font-size:11px;color:var(--text2)">${escTesHtml(m.categoria || '—')}</td><td>${escTesHtml(m.concepto || '—')}</td><td>${escTesHtml(m.metodo || '—')}</td><td style="text-align:right;white-space:nowrap">${verBtn}</td></tr>`;
        })
        .join('') || '<tr><td colspan="9" style="text-align:center;color:var(--text2);padding:24px">Sin movimientos</td></tr>';

    document.getElementById('tes_dinero-content').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:12px">
      <div class="form-group" style="margin:0"><label class="form-label">Desde</label><input type="date" class="form-control" id="tes-dinero-desde" value="${desde}"></div>
      <div class="form-group" style="margin:0"><label class="form-label">Hasta</label><input type="date" class="form-control" id="tes-dinero-hasta" value="${hasta}"></div>
      <button type="button" class="btn btn-secondary" onclick="renderTesDinero()">Filtrar</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px">
      <div class="card" style="padding:10px 12px;margin:0"><div style="font-size:10px;color:var(--text2)">Efectivo</div><div style="font-weight:800;color:${sumEfectivo >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(sumEfectivo)}</div><div style="font-size:9px;color:var(--text2);margin-top:2px;opacity:.85">Neto período</div></div>
      <div class="card" style="padding:10px 12px;margin:0"><div style="font-size:10px;color:var(--text2)">Transferencia</div><div style="font-weight:800;color:${sumTransferencia >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(sumTransferencia)}</div><div style="font-size:9px;color:var(--text2);margin-top:2px;opacity:.85">Neto período</div></div>
      <div class="card" style="padding:10px 12px;margin:0;border:1px solid rgba(0,229,180,.35)"><div style="font-size:10px;color:var(--text2)">Total período</div><div style="font-weight:800;color:${sumTotalPeriodo >= 0 ? 'var(--accent)' : 'var(--red)'}">${fmt(sumTotalPeriodo)}</div><div style="font-size:9px;color:var(--text2);margin-top:2px;opacity:.85">Ingresos − egresos (todos los movimientos)</div></div>
    </div>
    <div class="card"><div class="card-title">MOVIMIENTOS DE DINERO (${movsFiltered.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha / hora</th><th>Caja</th><th>Tipo</th><th>Valor</th><th>Bucket</th><th>Clase</th><th>Concepto</th><th>Método</th><th style="text-align:right">Acciones</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  function renderSimpleCollection(ctx) {
    const { state, pageId, title, collection, columns, fmt } = ctx;
    const items = [...(state[collection] || [])].reverse();
    const el = document.getElementById(pageId + '-content');
    if (!el) return;
    el.innerHTML = `<button class="btn btn-primary" style="margin-bottom:16px" onclick="openSimpleFormModal('${collection}','${title}',${JSON.stringify(columns).replace(/"/g, "'")})">+ Nuevo</button><div class="card"><div class="card-title">${title.toUpperCase()} (${items.length})</div><div class="table-wrap"><table><thead><tr>${columns.map((c) => '<th>' + c.split(':')[2] + '</th>').join('')}<th></th></tr></thead><tbody>${items
      .map(
        (item) =>
          `<tr>${columns
            .map((c) => {
              const key = c.split(':')[0];
              const type = c.split(':')[1];
              const val = item[key];
              return type === 'number' ? `<td style="font-weight:700;color:var(--accent)">${fmt(val || 0)}</td>` : `<td>${val || '—'}</td>`;
            })
            .join('')}<td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('${collection}','${item.id}','${pageId}')">✕</button></td></tr>`
      )
      .join('') || `<tr><td colspan="${columns.length + 1}" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>`}</tbody></table></div></div>`;
  }

  const treasuryModuleSelf = {
    renderTesCajas,
    openCajaModal,
    saveCaja,
    cerrarCaja,
    abrirCaja,
    guardarAbrirCaja,
    guardarCierreCaja,
    verCierresCajaModal,
    openMovCajaModal,
    saveMovCaja,
    renderTesDinero,
    verFacturaTesMovimiento,
    resolveFacturaFromTesMovimiento,
    renderSimpleCollection
  };
  global.AppTreasuryModule = treasuryModuleSelf;
  global.verFacturaTesMovimiento = verFacturaTesMovimiento;
})(window);
