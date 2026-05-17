// Compras + CXP proveedor V1 — lógica ERP (tablas nuevas; no escribe tes_* legacy).
(function initComprasCxpService(global) {
  const TIPOS_COMPRA = ['contado', 'credito', 'consignacion'];
  const ESTADOS_COMPRA = ['draft', 'pending', 'partial_paid', 'paid', 'partial_returned', 'returned', 'cancelled'];

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function n(v) {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : 0;
  }

  function ensureStateArrays(state) {
    if (!state.compras) state.compras = [];
    if (!state.compra_items) state.compra_items = [];
    if (!state.proveedor_cxp_movimientos) state.proveedor_cxp_movimientos = [];
    if (!state.proveedor_abonos) state.proveedor_abonos = [];
    if (!state.proveedor_abono_aplicaciones) state.proveedor_abono_aplicaciones = [];
    if (!state.proveedor_notas_credito) state.proveedor_notas_credito = [];
    if (!state.inv_movimientos) state.inv_movimientos = [];
  }

  function mapCompraRow(r) {
    return {
      id: r.id,
      numero: r.numero || '',
      proveedorId: r.proveedor_id,
      proveedorNombre: r.proveedor_nombre || '',
      fecha: r.fecha,
      facturaProveedor: r.factura_proveedor || '',
      tipoCompra: r.tipo_compra || 'credito',
      estado: r.estado || 'pending',
      subtotal: n(r.subtotal),
      total: n(r.total),
      nota: r.nota || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      cancelledAt: r.cancelled_at,
    };
  }

  function mapCompraItemRow(r) {
    return {
      id: r.id,
      compraId: r.compra_id,
      articuloId: r.articulo_id,
      articuloNombre: r.articulo_nombre || '',
      cantidad: n(r.cantidad),
      costoUnitario: n(r.costo_unitario),
      subtotal: n(r.subtotal),
      bodegaId: r.bodega_id || 'bodega_main',
    };
  }

  function mapCxpRow(r) {
    return {
      id: r.id,
      proveedorId: r.proveedor_id,
      proveedorNombre: r.proveedor_nombre || '',
      tipo: r.tipo,
      naturaleza: r.naturaleza,
      compraId: r.compra_id,
      abonoId: r.abono_id,
      notaCreditoId: r.nota_credito_id,
      cajaMovimientoId: r.caja_movimiento_id,
      fecha: r.fecha,
      fechaHora: r.fecha_hora,
      monto: n(r.monto),
      estado: r.estado || 'active',
      referencia: r.referencia || '',
      nota: r.nota || '',
      origen: r.origen || '',
      meta: r.meta && typeof r.meta === 'object' ? r.meta : {},
    };
  }

  function mapAbonoRow(r) {
    return {
      id: r.id,
      proveedorId: r.proveedor_id,
      proveedorNombre: r.proveedor_nombre || '',
      fecha: r.fecha,
      fechaHora: r.fecha_hora,
      monto: n(r.monto),
      metodo: r.metodo || 'efectivo',
      estado: r.estado || 'active',
      referencia: r.referencia || '',
      nota: r.nota || '',
      cajaMovimientoId: r.caja_movimiento_id,
    };
  }

  function mapAbonoAppRow(r) {
    return {
      id: r.id,
      abonoId: r.abono_id,
      movimientoCargoId: r.movimiento_cargo_id,
      compraId: r.compra_id,
      montoAplicado: n(r.monto_aplicado),
      estado: r.estado || 'active',
    };
  }

  function mapNotaCreditoRow(r) {
    return {
      id: r.id,
      proveedorId: r.proveedor_id,
      proveedorNombre: r.proveedor_nombre || '',
      compraId: r.compra_id,
      fecha: r.fecha,
      monto: n(r.monto),
      estado: r.estado || 'draft',
      motivo: r.motivo || '',
    };
  }

  /** Saldo oficial: cargos activos − créditos activos (equivalente a cargos+abonos-nc-devoluciones con signos). */
  function calcSaldoProveedor(state, proveedorId) {
    ensureStateArrays(state);
    const pid = String(proveedorId);
    let cargos = 0;
    let creditos = 0;
    let totalComprado = 0;
    let totalAbonado = 0;
    let totalNotasCredito = 0;
    (state.proveedor_cxp_movimientos || []).forEach((m) => {
      if (String(m.proveedorId) !== pid || m.estado === 'cancelled') return;
      if (m.naturaleza === 'cargo') {
        cargos += n(m.monto);
        if (m.tipo === 'cargo' && m.compraId) totalComprado += n(m.monto);
      } else {
        creditos += n(m.monto);
        if (m.tipo === 'abono') totalAbonado += n(m.monto);
        if (m.tipo === 'nota_credito' || m.tipo === 'devolucion') totalNotasCredito += n(m.monto);
      }
    });
    const saldo = Math.max(0, cargos - creditos);
    const saldoAFavor = Math.max(0, creditos - cargos);
    return {
      saldo,
      saldoAFavor,
      cargos,
      creditos,
      totalComprado,
      totalAbonado,
      totalNotasCredito,
    };
  }

  function itemsDeCompra(state, compraId) {
    return (state.compra_items || []).filter((i) => String(i.compraId) === String(compraId));
  }

  function comprasDeProveedor(state, proveedorId) {
    return (state.compras || [])
      .filter((c) => String(c.proveedorId) === String(proveedorId) && c.estado !== 'cancelled')
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  /** Inventario restante a costo: productos del proveedor × stock × costo. */
  function calcInventarioCostoProveedor(state, proveedorId) {
    const arts = (state.articulos || []).filter((a) => String(a.proveedorId) === String(proveedorId));
    let total = 0;
    arts.forEach((a) => {
      const stk = n(a.stock);
      const costo = n(a.precioCompra || a.cost);
      total += stk * costo;
    });
    return total;
  }

  /**
   * FIFO informativo (POS no modifica CXP): capas por compra_items fecha asc;
   * consume unidades desde stock_moves_ventas del proveedor.
   */
  function calcFifoVendidoInformative(state, proveedorId) {
    const layers = [];
    comprasDeProveedor(state, proveedorId).forEach((c) => {
      const asc = itemsDeCompra(state, c.id);
      asc.forEach((it) => {
        layers.push({
          compraId: c.id,
          fecha: c.fecha,
          articuloId: it.articuloId,
          qty: n(it.cantidad),
          costo: n(it.costoUnitario),
        });
      });
    });
    layers.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const ventas = (state.stock_moves_ventas || []).filter((sm) => {
      const art = (state.articulos || []).find((a) => String(a.id) === String(sm.articuloId || sm.product_id));
      return art && String(art.proveedorId) === String(proveedorId);
    });
    let unidadesVendidas = 0;
    let costoVendido = 0;
    ventas.forEach((sm) => {
      const q = Math.abs(n(sm.cantidad || sm.qty));
      const costo = n(sm.costo || sm.cost);
      unidadesVendidas += q;
      costoVendido += q * (costo || 0);
    });
    let totalCompradoQty = 0;
    layers.forEach((l) => {
      totalCompradoQty += l.qty;
    });
    const pct = totalCompradoQty > 0 ? Math.min(100, (unidadesVendidas / totalCompradoQty) * 100) : 0;
    return {
      unidadesVendidas,
      costoVendido,
      totalCompradoQty,
      porcentajeVendido: pct,
    };
  }

  function metricasProveedor(state, proveedorId) {
    const fin = calcSaldoProveedor(state, proveedorId);
    const inv = calcInventarioCostoProveedor(state, proveedorId);
    const fifo = calcFifoVendidoInformative(state, proveedorId);
    return { ...fin, inventarioCosto: inv, ...fifo };
  }

  function cargosPendientesProveedor(state, proveedorId) {
    const pid = String(proveedorId);
    const apps = state.proveedor_abono_aplicaciones || [];
    const cargos = (state.proveedor_cxp_movimientos || [])
      .filter((m) => String(m.proveedorId) === pid && m.estado === 'active' && m.naturaleza === 'cargo')
      .sort((a, b) => String(a.fechaHora || a.fecha).localeCompare(String(b.fechaHora || b.fecha)));
    return cargos.map((c) => {
      const aplicado = apps
        .filter((a) => a.estado === 'active' && String(a.movimientoCargoId) === String(c.id))
        .reduce((s, a) => s + n(a.montoAplicado), 0);
      const pendiente = Math.max(0, n(c.monto) - aplicado);
      return { ...c, aplicado, pendiente };
    });
  }

  async function syncStockLine(supabaseClient, articuloId, delta) {
    if (!global.AppInventoryModule?.syncStockViaRpc) {
      const abs = Math.abs(parseInt(delta, 10) || 0);
      if (abs === 0) return null;
      if (delta > 0) {
        const { data, error } = await supabaseClient.rpc('increment_stock', { p_product_id: articuloId, p_qty: abs });
        if (error) throw error;
        return parseFloat(data) || 0;
      }
      const { data, error } = await supabaseClient.rpc('decrement_stock', { p_product_id: articuloId, p_qty: abs });
      if (error) throw error;
      return parseFloat(data) || 0;
    }
    return global.AppInventoryModule.syncStockViaRpc(supabaseClient, articuloId, delta);
  }

  async function nextNumeroCompra(supabaseClient, state) {
    if (!state.consecutivos) state.consecutivos = {};
    let seq = parseInt(state.consecutivos.compra, 10) || 0;
    try {
      const { data, error } = await supabaseClient.rpc('increment_erp_consecutivo', { p_clave: 'compra' });
      if (!error && data != null) seq = parseInt(data, 10) || seq + 1;
      else {
        const { data: rows } = await supabaseClient.from('erp_consecutivos').select('valor').eq('clave', 'compra').maybeSingle();
        seq = (parseInt(rows?.valor, 10) || 0) + 1;
        await supabaseClient.from('erp_consecutivos').upsert({ clave: 'compra', valor: seq, updated_at: new Date().toISOString() }, { onConflict: 'clave' });
      }
    } catch (_) {
      seq += 1;
    }
    state.consecutivos.compra = seq;
    return `COMP-${String(seq).padStart(6, '0')}`;
  }

  /** Egreso en caja al abonar (bucket + sesión). */
  function registrarEgresoCajaV1(state, supabaseClient, dbId, { caja, valor, metodo, fechaDoc, proveedorNombre, abonoId }) {
    const cajaLogic = global.AppCajaLogic;
    if (!cajaLogic?.normalizeCaja) throw new Error('Módulo de caja no disponible');
    cajaLogic.normalizeCaja(caja);
    const bucket = cajaLogic.bucketFromMetodoId?.(metodo, state.cfg_metodos_pago) || 'efectivo';
    const disp = cajaLogic.saldoEnBucket?.(caja, bucket) ?? 0;
    if (disp < valor - 0.01) {
      throw new Error(`Saldo insuficiente en «${bucket}» (${disp}). Elige otro método o caja.`);
    }
    const movId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const movState = {
      id: movId,
      cajaId: caja.id,
      tipo: 'egreso',
      valor,
      concepto: `Abono proveedor: ${proveedorNombre}`,
      fecha: fechaDoc,
      metodo,
      categoria: 'proveedor_abono_v1',
      bucket,
      refAbonoProvId: abonoId,
    };
    cajaLogic.enrichMovWithSesion?.(state, caja.id, movState, dbId);
    const movRow = {
      id: movId,
      caja_id: caja.id,
      tipo: 'egreso',
      valor,
      concepto: movState.concepto,
      fecha: fechaDoc,
      metodo,
      categoria: movState.categoria,
      bucket,
      ref_abono_prov_id: abonoId,
      sesion_id: movState.sesionId || null,
    };
    cajaLogic.applyDeltaBucket(caja, bucket, -valor);
    return { movId, movState, movRow, bucket, caja };
  }

  /** Revierte egreso de caja al anular abono (sin borrar movimiento). */
  async function revertirEgresoCajaV1(state, supabaseClient, abono) {
    if (!abono?.cajaMovimientoId) return;
    const mov = (state.tes_movimientos || []).find((t) => String(t.id) === String(abono.cajaMovimientoId));
    if (!mov) return;
    const now = new Date().toISOString();
    await supabaseClient
      .from('tes_movimientos')
      .update({ concepto: `${mov.concepto || ''} [ANULADO ${now.slice(0, 10)}]` })
      .eq('id', abono.cajaMovimientoId);
    mov.concepto = `${mov.concepto || ''} [ANULADO ${now.slice(0, 10)}]`;
    const caja = (state.cajas || []).find((c) => c.id === mov.cajaId);
    if (caja && global.AppCajaLogic?.applyDeltaBucket) {
      global.AppCajaLogic.normalizeCaja(caja);
      const bucket = mov.bucket || global.AppCajaLogic.bucketFromMetodoId?.(mov.metodo, state.cfg_metodos_pago) || 'efectivo';
      global.AppCajaLogic.applyDeltaBucket(caja, bucket, n(mov.valor));
    }
  }

  function validarPayloadCompra(state, payload) {
    const { proveedorId, tipoCompra, lineas } = payload || {};
    if (!TIPOS_COMPRA.includes(tipoCompra)) {
      return { ok: false, message: 'Tipo de compra no válido.' };
    }
    if (!proveedorId) {
      return { ok: false, message: 'Selecciona un proveedor.' };
    }
    const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(proveedorId));
    if (!prov) {
      return { ok: false, message: 'El proveedor seleccionado no existe en el catálogo.' };
    }
    if (!lineas?.length) {
      return { ok: false, message: 'Agrega al menos un producto con cantidad.' };
    }
    let subtotalCalc = 0;
    for (let i = 0; i < lineas.length; i++) {
      const ln = lineas[i];
      const cant = n(ln.cantidad);
      const costo = n(ln.costoUnitario);
      if (!ln.articuloId) {
        return { ok: false, message: `Línea ${i + 1}: falta el artículo.` };
      }
      const art = (state.articulos || []).find((a) => String(a.id) === String(ln.articuloId));
      if (!art) {
        return { ok: false, message: `Línea ${i + 1}: artículo no encontrado.` };
      }
      if (cant <= 0 || !Number.isInteger(cant)) {
        return { ok: false, message: `Línea ${i + 1}: la cantidad debe ser un entero mayor a cero.` };
      }
      if (costo < 0) {
        return { ok: false, message: `Línea ${i + 1}: el costo no puede ser negativo.` };
      }
      subtotalCalc += cant * costo;
    }
    if (subtotalCalc <= 0) {
      return { ok: false, message: 'El total de la compra debe ser mayor a cero.' };
    }
    return { ok: true, proveedor: prov, subtotalCalc };
  }

  function validarMontoAbono(state, proveedorId, monto, fmt) {
    const valor = n(monto);
    if (valor <= 0) {
      return { ok: false, message: 'El monto del abono debe ser mayor a cero.' };
    }
    const { saldo } = calcSaldoProveedor(state, proveedorId);
    if (valor > saldo + 0.01) {
      const saldoTxt = typeof fmt === 'function' ? fmt(saldo) : saldo;
      return { ok: false, message: `El abono supera la deuda pendiente (${saldoTxt}).` };
    }
    const { plan, restante } = planificarAplicacionFifo(state, proveedorId, valor);
    if (restante > 0.01) {
      return {
        ok: false,
        message:
          'No hay cargos pendientes suficientes para aplicar este abono. Verifica que existan compras a crédito o consignación sin pagar.',
      };
    }
    if (!plan.length) {
      return { ok: false, message: 'No hay deuda pendiente que pueda cubrir este abono.' };
    }
    return { ok: true, saldo, plan };
  }

  function assertIntegridadAplicacion(state, movimientoCargoId, montoAplicado) {
    const cargo = (state.proveedor_cxp_movimientos || []).find((m) => String(m.id) === String(movimientoCargoId));
    if (!cargo || cargo.estado !== 'active' || cargo.naturaleza !== 'cargo') {
      throw new Error('Cargo asociado no válido para aplicar el abono.');
    }
    const apps = (state.proveedor_abono_aplicaciones || []).filter(
      (a) => a.estado === 'active' && String(a.movimientoCargoId) === String(movimientoCargoId),
    );
    const aplicado = apps.reduce((s, a) => s + n(a.montoAplicado), 0);
    const pendiente = n(cargo.monto) - aplicado;
    if (n(montoAplicado) > pendiente + 0.01) {
      throw new Error('La aplicación supera el saldo pendiente del cargo.');
    }
  }

  function pushInvMovimiento(state, { articuloId, bodegaId, cantidad, tipo, fecha, referencia, nota }) {
    ensureStateArrays(state);
    state.inv_movimientos.push({
      id: `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      articuloId,
      bodegaId: bodegaId || 'bodega_main',
      cantidad,
      tipo,
      fecha,
      referencia,
      nota,
    });
  }

  async function guardarCompra(ctx, payload) {
    const { state, supabaseClient, dbId, notify, today } = ctx;
    ensureStateArrays(state);
    const {
      proveedorId,
      proveedorNombre,
      tipoCompra,
      facturaProveedor,
      fecha,
      nota,
      lineas,
    } = payload;
    const val = validarPayloadCompra(state, payload);
    if (!val.ok) throw new Error(val.message);
    const prov = val.proveedor;
    const proveedorNombreFinal = proveedorNombre || prov.nombre || '';

    const id = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const numero = await nextNumeroCompra(supabaseClient, state);
    const fechaDoc = fecha || (typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10));
    let subtotal = 0;
    const itemsRows = lineas.map((ln) => {
      const cant = parseInt(ln.cantidad, 10) || 0;
      const costo = n(ln.costoUnitario);
      const st = cant * costo;
      subtotal += st;
      return {
        id: typeof dbId === 'function' ? dbId() : crypto.randomUUID(),
        compra_id: id,
        articulo_id: ln.articuloId,
        articulo_nombre: ln.articuloNombre || '',
        cantidad: cant,
        costo_unitario: costo,
        subtotal: st,
        bodega_id: ln.bodegaId || 'bodega_main',
      };
    });
    const total = subtotal;
    const estadoInicial = tipoCompra === 'contado' ? 'paid' : 'pending';
    const compraRow = {
      id,
      numero,
      proveedor_id: proveedorId,
      proveedor_nombre: proveedorNombreFinal,
      fecha: fechaDoc,
      factura_proveedor: facturaProveedor || null,
      tipo_compra: tipoCompra,
      estado: estadoInicial,
      subtotal,
      total,
      nota: nota || null,
    };

    if (Math.abs(subtotal - val.subtotalCalc) > 0.02) {
      throw new Error('El total no coincide con la suma de las líneas. Revise cantidades y costos.');
    }

    const { error: cErr } = await supabaseClient.from('compras').insert(compraRow);
    if (cErr) throw cErr;
    const { error: iErr } = await supabaseClient.from('compra_items').insert(itemsRows);
    if (iErr) throw iErr;

    for (const ln of itemsRows) {
      if (!ln.articulo_id) continue;
      const newStock = await syncStockLine(supabaseClient, ln.articulo_id, ln.cantidad);
      const art = (state.articulos || []).find((a) => String(a.id) === String(ln.articulo_id));
      if (art) {
        if (newStock != null) art.stock = newStock;
        else art.stock = n(art.stock) + ln.cantidad;
        art.precioCompra = ln.costo_unitario;
        await supabaseClient.from('products').update({ cost: ln.costo_unitario, stock: art.stock }).eq('id', ln.articulo_id);
      }
      const tipoMov =
        tipoCompra === 'contado' ? 'compra_contado' : tipoCompra === 'consignacion' ? 'compra_consignacion' : 'compra_credito';
      pushInvMovimiento(state, {
        articuloId: ln.articulo_id,
        bodegaId: ln.bodega_id,
        cantidad: ln.cantidad,
        tipo: tipoMov,
        fecha: fechaDoc,
        referencia: numero,
        nota: `Compra ${tipoCompra} · ${proveedorNombreFinal}`,
      });
    }

    let cxpCargo = null;
    if (tipoCompra === 'credito' || tipoCompra === 'consignacion') {
      const cxpId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
      const fechaHoraIso = new Date().toISOString();
      cxpCargo = {
        id: cxpId,
        proveedor_id: proveedorId,
        proveedor_nombre: proveedorNombreFinal,
        tipo: 'cargo',
        naturaleza: 'cargo',
        compra_id: id,
        fecha: fechaDoc,
        fecha_hora: fechaHoraIso,
        monto: total,
        estado: 'active',
        referencia: facturaProveedor || numero,
        nota: `Cargo compra ${numero} (${tipoCompra})`,
        origen: 'compra',
        meta: { tipoCompra, numero },
      };
      const { error: cxpErr } = await supabaseClient.from('proveedor_cxp_movimientos').insert(cxpCargo);
      if (cxpErr) throw cxpErr;
      state.proveedor_cxp_movimientos.push(mapCxpRow(cxpCargo));
    }

    state.compras.push(mapCompraRow(compraRow));
    itemsRows.forEach((r) => state.compra_items.push(mapCompraItemRow(r)));

    return { compra: mapCompraRow(compraRow), items: itemsRows.map(mapCompraItemRow) };
  }

  /** FIFO financiero: aplica abono a cargos más antiguos con saldo pendiente. */
  function planificarAplicacionFifo(state, proveedorId, montoAbono) {
    const pendientes = cargosPendientesProveedor(state, proveedorId).filter((c) => c.pendiente > 0.009);
    let restante = n(montoAbono);
    const plan = [];
    for (const c of pendientes) {
      if (restante <= 0) break;
      const aplicar = Math.min(restante, c.pendiente);
      plan.push({ movimientoCargoId: c.id, compraId: c.compraId, monto: aplicar });
      restante -= aplicar;
    }
    return { plan, restante };
  }

  function actualizarEstadoCompraPorPagos(state, compraId) {
    const compra = (state.compras || []).find((c) => String(c.id) === String(compraId));
    if (!compra || compra.tipoCompra === 'contado') return;
    const cargo = (state.proveedor_cxp_movimientos || []).find(
      (m) => String(m.compraId) === String(compraId) && m.naturaleza === 'cargo' && m.estado === 'active',
    );
    if (!cargo) return;
    const apps = (state.proveedor_abono_aplicaciones || []).filter(
      (a) => a.estado === 'active' && String(a.compraId) === String(compraId),
    );
    const pagado = apps.reduce((s, a) => s + n(a.montoAplicado), 0);
    const total = n(cargo.monto);
    let nuevo = 'pending';
    if (pagado >= total - 0.01) nuevo = 'paid';
    else if (pagado > 0) nuevo = 'partial_paid';
    compra.estado = nuevo;
  }

  async function guardarAbono(ctx, { proveedorId, proveedorNombre, monto, metodo, fecha, nota, crearEgresoCaja, cajaId }) {
    const { state, supabaseClient, dbId, fmt, today } = ctx;
    ensureStateArrays(state);
    const valAb = validarMontoAbono(state, proveedorId, monto, fmt);
    if (!valAb.ok) throw new Error(valAb.message);
    const valor = n(monto);
    const plan = valAb.plan;

    const abonoId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const fechaDoc = fecha || (typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10));
    const fechaHoraIso = new Date().toISOString();
    let cajaMovId = null;

    if (crearEgresoCaja) {
      const caja =
        (cajaId && (state.cajas || []).find((c) => c.id === cajaId && c.estado === 'abierta')) ||
        (state.cajas || []).find((c) => c.estado === 'abierta');
      if (!caja) throw new Error('No hay caja abierta. Abre una caja en Tesorería o desmarca el egreso en caja.');
      const eg = registrarEgresoCajaV1(state, supabaseClient, dbId, {
        caja,
        valor,
        metodo,
        fechaDoc,
        proveedorNombre,
        abonoId,
      });
      const { error: tmErr } = await supabaseClient.from('tes_movimientos').insert(eg.movRow);
      if (tmErr) throw tmErr;
      cajaMovId = eg.movId;
      if (!state.tes_movimientos) state.tes_movimientos = [];
      state.tes_movimientos.push(eg.movState);
    }

    const abonoRow = {
      id: abonoId,
      proveedor_id: proveedorId,
      proveedor_nombre: proveedorNombre,
      fecha: fechaDoc,
      fecha_hora: fechaHoraIso,
      monto: valor,
      metodo: metodo || 'efectivo',
      estado: 'active',
      nota: nota || null,
      caja_movimiento_id: cajaMovId,
    };
    const { error: abErr } = await supabaseClient.from('proveedor_abonos').insert(abonoRow);
    if (abErr) throw abErr;

    const cxpCreditoId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const cxpCredito = {
      id: cxpCreditoId,
      proveedor_id: proveedorId,
      proveedor_nombre: proveedorNombre,
      tipo: 'abono',
      naturaleza: 'credito',
      abono_id: abonoId,
      fecha: fechaDoc,
      fecha_hora: fechaHoraIso,
      monto: valor,
      estado: 'active',
      origen: 'abono',
      nota: nota || '',
      caja_movimiento_id: cajaMovId,
    };
    const { error: cxpErr } = await supabaseClient.from('proveedor_cxp_movimientos').insert(cxpCredito);
    if (cxpErr) throw cxpErr;

    const appRows = [];
    for (const p of plan) {
      assertIntegridadAplicacion(state, p.movimientoCargoId, p.monto);
      const appId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
      const row = {
        id: appId,
        abono_id: abonoId,
        movimiento_cargo_id: p.movimientoCargoId,
        compra_id: p.compraId,
        monto_aplicado: p.monto,
        estado: 'active',
      };
      const { error: appErr } = await supabaseClient.from('proveedor_abono_aplicaciones').insert(row);
      if (appErr) throw appErr;
      appRows.push(mapAbonoAppRow(row));
      if (p.compraId) actualizarEstadoCompraPorPagos(state, p.compraId);
    }

    state.proveedor_abonos.push(mapAbonoRow(abonoRow));
    state.proveedor_cxp_movimientos.push(mapCxpRow(cxpCredito));
    state.proveedor_abono_aplicaciones.push(...appRows);
    plan.forEach((p) => {
      if (p.compraId) {
        const c = state.compras.find((x) => String(x.id) === String(p.compraId));
        if (c) actualizarEstadoCompraPorPagos(state, p.compraId);
        supabaseClient.from('compras').update({ estado: c?.estado, updated_at: new Date().toISOString() }).eq('id', p.compraId).then(() => {});
      }
    });

    return { abono: mapAbonoRow(abonoRow), aplicaciones: appRows };
  }

  async function anularAbono(ctx, abonoId) {
    const { state, supabaseClient } = ctx;
    const abono = (state.proveedor_abonos || []).find((a) => String(a.id) === String(abonoId));
    if (!abono || abono.estado === 'cancelled') throw new Error('Abono no encontrado o ya anulado');
    const now = new Date().toISOString();
    await supabaseClient.from('proveedor_abonos').update({ estado: 'cancelled', cancelled_at: now }).eq('id', abonoId);
    abono.estado = 'cancelled';

    const apps = (state.proveedor_abono_aplicaciones || []).filter((a) => String(a.abonoId) === String(abonoId));
    for (const a of apps) {
      await supabaseClient.from('proveedor_abono_aplicaciones').update({ estado: 'cancelled' }).eq('id', a.id);
      a.estado = 'cancelled';
      if (a.compraId) actualizarEstadoCompraPorPagos(state, a.compraId);
    }

    const movs = (state.proveedor_cxp_movimientos || []).filter((m) => String(m.abonoId) === String(abonoId));
    for (const m of movs) {
      await supabaseClient.from('proveedor_cxp_movimientos').update({ estado: 'cancelled', cancelled_at: now }).eq('id', m.id);
      m.estado = 'cancelled';
    }

    await revertirEgresoCajaV1(state, supabaseClient, abono);
    return true;
  }

  async function registrarDevolucion(ctx, payload) {
    const { state, supabaseClient, dbId, today } = ctx;
    const { proveedorId, proveedorNombre, compraId, lineas, motivo, fecha } = payload;
    if (!lineas?.length) throw new Error('Líneas de devolución requeridas');
    let montoNc = 0;
    const fechaDoc = fecha || (typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10));
    for (const ln of lineas) {
      const cant = n(ln.cantidad);
      const costo = n(ln.costoUnitario);
      montoNc += cant * costo;
      if (ln.articuloId) {
        await syncStockLine(supabaseClient, ln.articuloId, -cant);
        const art = (state.articulos || []).find((a) => String(a.id) === String(ln.articuloId));
        if (art) art.stock = Math.max(0, n(art.stock) - cant);
        pushInvMovimiento(state, {
          articuloId: ln.articuloId,
          bodegaId: ln.bodegaId || 'bodega_main',
          cantidad: -cant,
          tipo: 'devolucion_proveedor',
          fecha: fechaDoc,
          referencia: compraId ? `NC compra` : 'NC general',
          nota: motivo || 'Devolución proveedor',
        });
      }
    }
    const ncId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const ncRow = {
      id: ncId,
      proveedor_id: proveedorId,
      proveedor_nombre: proveedorNombre,
      compra_id: compraId || null,
      fecha: fechaDoc,
      monto: montoNc,
      estado: 'applied',
      motivo: motivo || 'devolucion',
    };
    await supabaseClient.from('proveedor_notas_credito').insert(ncRow);
    const cxpId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const cxpNc = {
      id: cxpId,
      proveedor_id: proveedorId,
      proveedor_nombre: proveedorNombre,
      tipo: 'devolucion',
      naturaleza: 'credito',
      compra_id: compraId || null,
      nota_credito_id: ncId,
      fecha: fechaDoc,
      fecha_hora: new Date().toISOString(),
      monto: montoNc,
      estado: 'active',
      origen: 'devolucion',
      nota: motivo || '',
    };
    await supabaseClient.from('proveedor_cxp_movimientos').insert(cxpNc);
    state.proveedor_notas_credito.push(mapNotaCreditoRow(ncRow));
    state.proveedor_cxp_movimientos.push(mapCxpRow(cxpNc));
    if (compraId) {
      const c = state.compras.find((x) => String(x.id) === String(compraId));
      if (c) c.estado = 'partial_returned';
      await supabaseClient.from('compras').update({ estado: 'partial_returned', updated_at: new Date().toISOString() }).eq('id', compraId);
    }
    return { notaCredito: mapNotaCreditoRow(ncRow) };
  }

  async function ajusteCostoProveedor(ctx, { proveedorId, proveedorNombre, articuloId, unidades, costoAnterior, costoNuevo, compraId }) {
    const delta = (n(costoNuevo) - n(costoAnterior)) * n(unidades);
    if (Math.abs(delta) < 0.01) return null;
    const { state, supabaseClient, dbId, today } = ctx;
    const fechaDoc = typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10);
    if (delta > 0) {
      const cxpId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
      const row = {
        id: cxpId,
        proveedor_id: proveedorId,
        proveedor_nombre: proveedorNombre,
        tipo: 'ajuste',
        naturaleza: 'cargo',
        compra_id: compraId || null,
        fecha: fechaDoc,
        fecha_hora: new Date().toISOString(),
        monto: delta,
        estado: 'active',
        origen: 'ajuste_precio',
        nota: `Ajuste costo artículo ${articuloId}: ${costoAnterior} → ${costoNuevo} × ${unidades}`,
        meta: { articuloId, costoAnterior, costoNuevo, unidades },
      };
      await supabaseClient.from('proveedor_cxp_movimientos').insert(row);
      state.proveedor_cxp_movimientos.push(mapCxpRow(row));
      return { tipo: 'cargo', monto: delta };
    }
    const ncId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const montoNc = Math.abs(delta);
    const ncRow = {
      id: ncId,
      proveedor_id: proveedorId,
      proveedor_nombre: proveedorNombre,
      compra_id: compraId || null,
      fecha: fechaDoc,
      monto: montoNc,
      estado: 'applied',
      motivo: `Ajuste costo: ${costoAnterior} → ${costoNuevo} × ${unidades}`,
    };
    await supabaseClient.from('proveedor_notas_credito').insert(ncRow);
    const cxpId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const cxpNc = {
      id: cxpId,
      proveedor_id: proveedorId,
      proveedor_nombre: proveedorNombre,
      tipo: 'nota_credito',
      naturaleza: 'credito',
      compra_id: compraId || null,
      nota_credito_id: ncId,
      fecha: fechaDoc,
      fecha_hora: new Date().toISOString(),
      monto: montoNc,
      estado: 'active',
      origen: 'ajuste_precio',
      nota: ncRow.motivo,
      meta: { articuloId, costoAnterior, costoNuevo, unidades },
    };
    await supabaseClient.from('proveedor_cxp_movimientos').insert(cxpNc);
    state.proveedor_notas_credito.push(mapNotaCreditoRow(ncRow));
    state.proveedor_cxp_movimientos.push(mapCxpRow(cxpNc));
    return { tipo: 'nota_credito', monto: montoNc };
  }

  async function loadComprasCxpFromDb(supabaseClient, state) {
    ensureStateArrays(state);
    const specs = [
      ['compras', mapCompraRow, 'compras', 'fecha'],
      ['compra_items', mapCompraItemRow, 'compra_items', 'created_at'],
      ['proveedor_cxp_movimientos', mapCxpRow, 'proveedor_cxp_movimientos', 'fecha_hora'],
      ['proveedor_abonos', mapAbonoRow, 'proveedor_abonos', 'fecha_hora'],
      ['proveedor_abono_aplicaciones', mapAbonoAppRow, 'proveedor_abono_aplicaciones', 'created_at'],
      ['proveedor_notas_credito', mapNotaCreditoRow, 'proveedor_notas_credito', 'fecha'],
    ];
    for (const [table, mapper, key, orderCol] of specs) {
      try {
        let rows = [];
        if (typeof global.fetchAllRows === 'function') {
          rows = await global.fetchAllRows(table);
        } else if (supabaseClient) {
          const { data, error } = await supabaseClient.from(table).select('*').order(orderCol, { ascending: false }).limit(5000);
          if (error) throw error;
          rows = data || [];
        }
        state[key] = (rows || []).map(mapper);
      } catch (e) {
        console.warn(`[ComprasCxp] ${table}:`, e.message);
        state[key] = state[key] || [];
      }
    }
  }

  function exportCsvProveedores(state, fmt) {
    const rows = [['Proveedor', 'Deuda', 'Comprado', 'Abonado', 'Inv. costo', '% vendido']];
    (state.usu_proveedores || []).forEach((p) => {
      const m = metricasProveedor(state, p.id);
      rows.push([
        p.nombre,
        fmt(m.saldo),
        fmt(m.totalComprado),
        fmt(m.totalAbonado),
        fmt(m.inventarioCosto),
        `${m.porcentajeVendido.toFixed(1)}%`,
      ]);
    });
    return rows.map((r) => r.join(';')).join('\n');
  }

  function imprimirComprobanteAbono(abono, proveedorNombre, fmt) {
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Comprobante abono</title>
      <style>body{font-family:system-ui;padding:24px}h1{font-size:18px}</style></head><body>
      <h1>Comprobante de pago a proveedor</h1>
      <p><b>Proveedor:</b> ${esc(proveedorNombre)}</p>
      <p><b>Fecha:</b> ${esc(abono.fecha)}</p>
      <p><b>Monto:</b> ${esc(fmt(abono.monto))}</p>
      <p><b>Método:</b> ${esc(abono.metodo)}</p>
      <p><b>Ref:</b> ${esc(abono.id)}</p>
      <p style="font-size:11px;color:#666">V1 — almacenamiento PDF en historial: pendiente V2</p>
      <script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  global.AppComprasCxp = {
    TIPOS_COMPRA,
    ESTADOS_COMPRA,
    esc,
    calcSaldoProveedor,
    metricasProveedor,
    cargosPendientesProveedor,
    planificarAplicacionFifo,
    validarPayloadCompra,
    validarMontoAbono,
    guardarCompra,
    guardarAbono,
    anularAbono,
    registrarDevolucion,
    ajusteCostoProveedor,
    loadComprasCxpFromDb,
    exportCsvProveedores,
    imprimirComprobanteAbono,
    comprasDeProveedor,
    itemsDeCompra,
  };
})(window);
