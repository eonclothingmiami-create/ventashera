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
      comprobanteUrl: r.comprobante_url || '',
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
      cancelledAt: r.cancelled_at,
    };
  }

  function isRpcMissingError(err) {
    const c = err?.code;
    const m = String(err?.message || err?.error_description || err?.details || '');
    return (
      c === '42883' ||
      c === 'PGRST202' ||
      /does not exist|function.*not found|no existe la funci/i.test(m)
    );
  }

  function parseRpcError(err) {
    if (!err) return 'Error desconocido';
    return err.message || err.details || err.hint || String(err);
  }

  function syncConsecutivoFromNumero(state, numero) {
    const m = /COMP-(\d+)/i.exec(String(numero || ''));
    if (!m) return;
    const seq = parseInt(m[1], 10);
    if (!state.consecutivos) state.consecutivos = {};
    if (seq > (parseInt(state.consecutivos.compra, 10) || 0)) {
      state.consecutivos.compra = seq;
    }
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
    const totalCompradoCompras = comprasDeProveedor(state, proveedorId).reduce((s, c) => s + n(c.total), 0);
    return {
      saldo,
      saldoAFavor,
      cargos,
      creditos,
      totalComprado: Math.max(totalComprado, totalCompradoCompras),
      totalAbonado,
      totalNotasCredito,
    };
  }

  /** Tras compra crédito/consignación: asegura cargo CXP en memoria (RPC a veces no devuelve cxp_cargo_id). */
  async function syncCxpCargoTrasCompra(ctx, proveedorId, compraId) {
    const { supabaseClient, state } = ctx || {};
    if (!supabaseClient?.from || !proveedorId || !compraId) return;
    ensureStateArrays(state);
    const ya = (state.proveedor_cxp_movimientos || []).some(
      (m) => String(m.compraId) === String(compraId) && m.naturaleza === 'cargo' && m.estado === 'active',
    );
    if (ya) return;
    try {
      const { data, error } = await supabaseClient
        .from('proveedor_cxp_movimientos')
        .select('*')
        .eq('compra_id', compraId)
        .eq('naturaleza', 'cargo')
        .eq('estado', 'active')
        .limit(5);
      if (error) throw error;
      (data || []).forEach((r) => {
        const mapped = mapCxpRow(r);
        if (!(state.proveedor_cxp_movimientos || []).some((m) => String(m.id) === String(mapped.id))) {
          state.proveedor_cxp_movimientos.push(mapped);
        }
      });
    } catch (e) {
      console.warn('[ComprasCxp] syncCxpCargoTrasCompra:', e.message);
    }
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
   * FIFO informativo (POS no modifica CXP): colas por artículo desde compra_items;
   * ventas POS consumen capas más antiguas por compra_id.
   */
  function calcFifoVendidoInformative(state, proveedorId) {
    const pid = String(proveedorId);
    const comprasMap = {};
    comprasDeProveedor(state, proveedorId).forEach((c) => {
      comprasMap[String(c.id)] = c;
    });
    const queues = {};
    comprasDeProveedor(state, proveedorId)
      .slice()
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      .forEach((c) => {
        itemsDeCompra(state, c.id).forEach((it) => {
          const aid = String(it.articuloId || '');
          if (!aid) return;
          if (!queues[aid]) queues[aid] = [];
          const qtyComprada = Math.max(0, Math.floor(n(it.cantidad)));
          queues[aid].push({
            compraId: c.id,
            compraNumero: c.numero,
            articuloId: aid,
            articuloNombre: it.articuloNombre || '',
            qtyComprada,
            qtyRestante: qtyComprada,
            costoUnitario: n(it.costoUnitario),
          });
        });
      });
    let totalCompradoQty = 0;
    Object.values(queues).forEach((q) => {
      q.forEach((layer) => {
        totalCompradoQty += layer.qtyRestante;
      });
    });
    const ventas = (state.stock_moves_ventas || [])
      .filter((sm) => {
        const aid = String(sm.articuloId || sm.product_id || sm.articulo_id || '');
        const art = (state.articulos || []).find((a) => String(a.id) === aid);
        return art && String(art.proveedorId) === pid;
      })
      .slice()
      .sort((a, b) => String(a.fecha || a.created_at || '').localeCompare(String(b.fecha || b.created_at || '')));
    const capasAgg = {};
    let unidadesVendidas = 0;
    let costoVendido = 0;
    let sinCapa = 0;
    ventas.forEach((sm) => {
      let qRest = Math.abs(Math.floor(n(sm.cantidad || sm.qty)));
      if (qRest <= 0) return;
      const aid = String(sm.articuloId || sm.product_id || sm.articulo_id || '');
      const cola = queues[aid] || [];
      const costoFallback = n(sm.costo || sm.cost);
      while (qRest > 0) {
        const layer = cola.find((l) => l.qtyRestante > 0);
        if (!layer) {
          unidadesVendidas += qRest;
          costoVendido += qRest * costoFallback;
          sinCapa += qRest;
          qRest = 0;
          break;
        }
        const take = Math.min(qRest, layer.qtyRestante);
        layer.qtyRestante -= take;
        qRest -= take;
        unidadesVendidas += take;
        const costoU = layer.costoUnitario || costoFallback;
        costoVendido += take * costoU;
        const key = `${layer.compraId}|${layer.articuloId}`;
        if (!capasAgg[key]) {
          capasAgg[key] = {
            compraId: layer.compraId,
            compraNumero: layer.compraNumero || comprasMap[String(layer.compraId)]?.numero || '',
            articuloId: layer.articuloId,
            articuloNombre: layer.articuloNombre,
            qtyComprada: layer.qtyComprada || 0,
            unidadesConsumidas: 0,
            costoVendido: 0,
          };
        }
        capasAgg[key].unidadesConsumidas += take;
        capasAgg[key].costoVendido += take * costoU;
      }
    });
    const capas = Object.values(capasAgg)
      .map((cap) => ({
        ...cap,
        porcentajeDeCompra:
          cap.qtyComprada > 0 ? Math.min(100, (cap.unidadesConsumidas / cap.qtyComprada) * 100) : 0,
      }))
      .sort((a, b) => String(a.compraNumero).localeCompare(String(b.compraNumero)));
    const pct = totalCompradoQty > 0 ? Math.min(100, (unidadesVendidas / totalCompradoQty) * 100) : 0;
    return {
      unidadesVendidas,
      costoVendido,
      totalCompradoQty,
      porcentajeVendido: pct,
      capas,
      sinCapa,
    };
  }

  function metricasProveedor(state, proveedorId) {
    const fin = calcSaldoProveedor(state, proveedorId);
    const inv = calcInventarioCostoProveedor(state, proveedorId);
    const fifo = calcFifoVendidoInformative(state, proveedorId);
    const compras = comprasDeProveedor(state, proveedorId);
    const pctVendidoPendiente =
      compras.length > 0 && fifo.totalCompradoQty <= 0 && !(state.stock_moves_ventas || []).length;
    return { ...fin, inventarioCosto: inv, ...fifo, pctVendidoPendiente };
  }

  function etiquetaPctVendido(m) {
    if (m?.pctVendidoPendiente) return 'pendiente';
    if (!(m?.totalCompradoQty > 0)) return '0.0%';
    return `${(m.porcentajeVendido || 0).toFixed(1)}%`;
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
    const { proveedorId, tipoCompra, lineas, fecha } = payload || {};
    if (!TIPOS_COMPRA.includes(tipoCompra)) {
      return { ok: false, message: 'Tipo de compra no válido.' };
    }
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) {
      return { ok: false, message: 'Indica una fecha válida (AAAA-MM-DD).' };
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

  async function aplicarStockPostCompra(ctx, { itemsRows, tipoCompra, fechaDoc, numero, proveedorNombreFinal, omitirAjusteStock }) {
    if (omitirAjusteStock) return [];
    const { state, supabaseClient } = ctx;
    const erroresStock = [];
    for (const ln of itemsRows) {
      if (!ln.articulo_id) continue;
      try {
        const newStock = await syncStockLine(supabaseClient, ln.articulo_id, ln.cantidad);
        const art = (state.articulos || []).find((a) => String(a.id) === String(ln.articulo_id));
        if (art) {
          if (newStock != null) art.stock = newStock;
          else art.stock = n(art.stock) + ln.cantidad;
          art.precioCompra = ln.costo_unitario;
          await supabaseClient
            .from('products')
            .update({ cost: ln.costo_unitario, stock: art.stock })
            .eq('id', ln.articulo_id);
        }
        const tipoMov =
          tipoCompra === 'contado'
            ? 'compra_contado'
            : tipoCompra === 'consignacion'
              ? 'compra_consignacion'
              : 'compra_credito';
        pushInvMovimiento(state, {
          articuloId: ln.articulo_id,
          bodegaId: ln.bodega_id,
          cantidad: ln.cantidad,
          tipo: tipoMov,
          fecha: fechaDoc,
          referencia: numero,
          nota: `Compra ${tipoCompra} · ${proveedorNombreFinal}`,
        });
      } catch (e) {
        erroresStock.push(`${ln.articulo_nombre || ln.articulo_id}: ${e.message || e}`);
      }
    }
    return erroresStock;
  }

  async function guardarCompraLegacy(ctx, payload, val) {
    const { state, supabaseClient, dbId, today } = ctx;
    const {
      proveedorId,
      proveedorNombre,
      tipoCompra,
      facturaProveedor,
      fecha,
      nota,
      lineas,
    } = payload;
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
    const { error: cErr } = await supabaseClient.from('compras').insert(compraRow);
    if (cErr) throw cErr;
    const { error: iErr } = await supabaseClient.from('compra_items').insert(itemsRows);
    if (iErr) throw iErr;
    if (tipoCompra === 'credito' || tipoCompra === 'consignacion') {
      const cxpId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
      const cxpCargo = {
        id: cxpId,
        proveedor_id: proveedorId,
        proveedor_nombre: proveedorNombreFinal,
        tipo: 'cargo',
        naturaleza: 'cargo',
        compra_id: id,
        fecha: fechaDoc,
        fecha_hora: new Date().toISOString(),
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
    const erroresStock = await aplicarStockPostCompra(ctx, {
      itemsRows,
      tipoCompra,
      fechaDoc,
      numero,
      proveedorNombreFinal,
      omitirAjusteStock: !!payload.omitirAjusteStock,
    });
    return { compra: mapCompraRow(compraRow), items: itemsRows.map(mapCompraItemRow), erroresStock };
  }

  async function guardarCompra(ctx, payload) {
    const { state, supabaseClient, dbId, today } = ctx;
    ensureStateArrays(state);
    const val = validarPayloadCompra(state, payload);
    if (!val.ok) throw new Error(val.message);
    const prov = val.proveedor;
    const proveedorNombreFinal = payload.proveedorNombre || prov.nombre || '';
    const {
      proveedorId,
      tipoCompra,
      facturaProveedor,
      fecha,
      nota,
      lineas,
      omitirAjusteStock,
    } = payload;
    const fechaDoc = fecha || (typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10));
    const compraId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const rpcLineas = lineas.map((ln) => {
      const cant = parseInt(ln.cantidad, 10) || 0;
      const costo = n(ln.costoUnitario);
      return {
        id: typeof dbId === 'function' ? dbId() : crypto.randomUUID(),
        articulo_id: ln.articuloId,
        articulo_nombre: ln.articuloNombre || '',
        cantidad: cant,
        costo_unitario: costo,
        subtotal: cant * costo,
        bodega_id: ln.bodegaId || 'bodega_main',
      };
    });

    let numero;
    let usarRpc = true;
    try {
      const { data, error } = await supabaseClient.rpc('compra_guardar_v1', {
        p_payload: {
          compra_id: compraId,
          proveedor_id: proveedorId,
          proveedor_nombre: proveedorNombreFinal,
          fecha: fechaDoc,
          factura_proveedor: facturaProveedor || null,
          tipo_compra: tipoCompra,
          nota: nota || null,
          lineas: rpcLineas,
        },
      });
      if (error) throw error;
      numero = data?.numero;
      syncConsecutivoFromNumero(state, numero);
      const compraRow = {
        id: compraId,
        numero,
        proveedor_id: proveedorId,
        proveedor_nombre: proveedorNombreFinal,
        fecha: fechaDoc,
        factura_proveedor: facturaProveedor || null,
        tipo_compra: tipoCompra,
        estado: data?.estado || (tipoCompra === 'contado' ? 'paid' : 'pending'),
        subtotal: n(data?.total),
        total: n(data?.total),
        nota: nota || null,
      };
      state.compras.push(mapCompraRow(compraRow));
      rpcLineas.forEach((r) => state.compra_items.push(mapCompraItemRow(r)));
      if (data?.cxp_cargo_id) {
        const { data: cxpRow } = await supabaseClient
          .from('proveedor_cxp_movimientos')
          .select('*')
          .eq('id', data.cxp_cargo_id)
          .maybeSingle();
        if (cxpRow) state.proveedor_cxp_movimientos.push(mapCxpRow(cxpRow));
      } else if (tipoCompra === 'credito' || tipoCompra === 'consignacion') {
        await syncCxpCargoTrasCompra(ctx, proveedorId, compraId);
      }
      const erroresStock = await aplicarStockPostCompra(ctx, {
        itemsRows: rpcLineas,
        tipoCompra,
        fechaDoc,
        numero,
        proveedorNombreFinal,
        omitirAjusteStock: !!omitirAjusteStock,
      });
      if (erroresStock.length) {
        console.warn('[ComprasCxp] Stock parcial tras compra', numero, erroresStock);
      }
      return {
        compra: mapCompraRow(compraRow),
        items: rpcLineas.map(mapCompraItemRow),
        erroresStock,
        advertenciaStock: erroresStock.length
          ? `Compra ${numero} guardada, pero hubo problemas al actualizar inventario: ${erroresStock.join('; ')}`
          : null,
      };
    } catch (e) {
      if (!isRpcMissingError(e)) throw new Error(parseRpcError(e));
      console.warn('[ComprasCxp] compra_guardar_v1 no disponible; usando inserts legacy.');
      usarRpc = false;
    }
    if (!usarRpc) {
      return guardarCompraLegacy(ctx, payload, val);
    }
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

  async function guardarAbonoLegacy(ctx, params, valAb) {
    const { proveedorId, proveedorNombre, monto, metodo, fecha, nota, referencia, crearEgresoCaja, cajaId } = params;
    const { state, supabaseClient, dbId, today } = ctx;
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
      referencia: referencia || null,
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
    for (const p of plan) {
      if (p.compraId) {
        const c = state.compras.find((x) => String(x.id) === String(p.compraId));
        if (c) {
          actualizarEstadoCompraPorPagos(state, p.compraId);
          await supabaseClient
            .from('compras')
            .update({ estado: c.estado, updated_at: new Date().toISOString() })
            .eq('id', p.compraId);
        }
      }
    }
    const legacyOut = { abono: mapAbonoRow(abonoRow), aplicaciones: appRows };
    return enriquecerAbonoConComprobante(ctx, legacyOut, proveedorNombre);
  }

  async function guardarAbono(ctx, params) {
    const { proveedorId, proveedorNombre, monto, metodo, fecha, nota, referencia, crearEgresoCaja, cajaId } = params;
    const { state, supabaseClient, dbId, fmt, today } = ctx;
    ensureStateArrays(state);
    const valAb = validarMontoAbono(state, proveedorId, monto, fmt);
    if (!valAb.ok) throw new Error(valAb.message);
    const valor = n(monto);
    const plan = valAb.plan;
    const abonoId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const fechaDoc = fecha || (typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10));
    const rpcPlan = plan.map((p) => ({
      movimiento_cargo_id: p.movimientoCargoId,
      compra_id: p.compraId || null,
      monto: p.monto,
    }));

    try {
      const { data, error } = await supabaseClient.rpc('abono_aplicar_v1', {
        p_payload: {
          abono_id: abonoId,
          proveedor_id: proveedorId,
          proveedor_nombre: proveedorNombre,
          monto: valor,
          metodo: metodo || 'efectivo',
          fecha: fechaDoc,
          nota: nota || '',
          plan: rpcPlan,
        },
      });
      if (error) throw error;

      let cajaMovId = null;
      let advertenciaCaja = null;
      if (crearEgresoCaja) {
        try {
          const caja =
            (cajaId && (state.cajas || []).find((c) => c.id === cajaId && c.estado === 'abierta')) ||
            (state.cajas || []).find((c) => c.estado === 'abierta');
          if (!caja) throw new Error('No hay caja abierta.');
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
          const { error: abCajaErr } = await supabaseClient
            .from('proveedor_abonos')
            .update({ caja_movimiento_id: cajaMovId })
            .eq('id', abonoId);
          if (abCajaErr) throw new Error('Egreso en caja creado pero no se pudo vincular al abono (RLS/permisos): ' + abCajaErr.message);
          const cxpMov = (state.proveedor_cxp_movimientos || []).find((m) => String(m.abonoId) === String(abonoId));
          if (cxpMov) {
            const { error: cxpCajaErr } = await supabaseClient
              .from('proveedor_cxp_movimientos')
              .update({ caja_movimiento_id: cajaMovId })
              .eq('id', cxpMov.id);
            if (cxpCajaErr) throw new Error('No se pudo vincular caja_movimiento_id al movimiento CXP: ' + cxpCajaErr.message);
            cxpMov.cajaMovimientoId = cajaMovId;
          }
        } catch (cajaErr) {
          advertenciaCaja =
            'Abono registrado en cuentas por pagar, pero no se pudo registrar el egreso en caja: ' +
            (cajaErr.message || cajaErr);
        }
      }

      if (referencia) {
        await supabaseClient.from('proveedor_abonos').update({ referencia }).eq('id', abonoId);
      }
      const { data: abonoDb } = await supabaseClient.from('proveedor_abonos').select('*').eq('id', abonoId).maybeSingle();
      const abonoRow = mapAbonoRow(
        abonoDb || {
          id: abonoId,
          proveedor_id: proveedorId,
          proveedor_nombre: proveedorNombre,
          fecha: fechaDoc,
          fecha_hora: new Date().toISOString(),
          monto: valor,
          metodo,
          estado: 'active',
          referencia: referencia || '',
          nota,
          caja_movimiento_id: cajaMovId,
        },
      );
      if (!(state.proveedor_abonos || []).some((a) => String(a.id) === String(abonoRow.id))) {
        state.proveedor_abonos.push(abonoRow);
      }

      const { data: cxpRows } = await supabaseClient
        .from('proveedor_cxp_movimientos')
        .select('*')
        .eq('abono_id', abonoId);
      (cxpRows || []).forEach((r) => {
        const mapped = mapCxpRow(r);
        if (!(state.proveedor_cxp_movimientos || []).some((m) => String(m.id) === String(mapped.id))) {
          state.proveedor_cxp_movimientos.push(mapped);
        }
      });

      const { data: appDb } = await supabaseClient.from('proveedor_abono_aplicaciones').select('*').eq('abono_id', abonoId);
      const appRows = (appDb || []).map(mapAbonoAppRow);
      appRows.forEach((a) => {
        if (!(state.proveedor_abono_aplicaciones || []).some((x) => String(x.id) === String(a.id))) {
          state.proveedor_abono_aplicaciones.push(a);
        }
        if (a.compraId) actualizarEstadoCompraPorPagos(state, a.compraId);
      });

      const compraIdsUpd = [...new Set(appRows.map((a) => a.compraId).filter(Boolean))];
      if (compraIdsUpd.length) {
        const { data: comprasUpd } = await supabaseClient.from('compras').select('id, estado').in('id', compraIdsUpd);
        (comprasUpd || []).forEach((c) => {
          const local = state.compras.find((x) => String(x.id) === String(c.id));
          if (local) local.estado = c.estado;
        });
      }

      const out = { abono: abonoRow, aplicaciones: appRows, advertenciaCaja };
      return enriquecerAbonoConComprobante(ctx, out, proveedorNombre);
    } catch (e) {
      if (!isRpcMissingError(e)) throw new Error(parseRpcError(e));
      console.warn('[ComprasCxp] abono_aplicar_v1 no disponible; usando inserts legacy.');
      return guardarAbonoLegacy(ctx, params, valAb);
    }
  }

  async function anularAbono(ctx, abonoId) {
    const { state, supabaseClient } = ctx;
    const abono = (state.proveedor_abonos || []).find((a) => String(a.id) === String(abonoId));
    if (!abono || abono.estado === 'cancelled') throw new Error('Abono no encontrado o ya anulado');
    const now = new Date().toISOString();
    await supabaseClient.from('proveedor_abonos').update({ estado: 'cancelled', cancelled_at: now }).eq('id', abonoId);
    abono.estado = 'cancelled';

    const apps = (state.proveedor_abono_aplicaciones || []).filter((a) => String(a.abonoId) === String(abonoId));
    const comprasAfectadas = new Set();
    for (const a of apps) {
      await supabaseClient.from('proveedor_abono_aplicaciones').update({ estado: 'cancelled' }).eq('id', a.id);
      a.estado = 'cancelled';
      if (a.compraId) {
        actualizarEstadoCompraPorPagos(state, a.compraId);
        comprasAfectadas.add(String(a.compraId));
      }
    }
    for (const compraId of comprasAfectadas) {
      const c = (state.compras || []).find((x) => String(x.id) === compraId);
      if (c) {
        await supabaseClient
          .from('compras')
          .update({ estado: c.estado, updated_at: now })
          .eq('id', compraId);
      }
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
    const {
      proveedorId,
      proveedorNombre,
      compraId,
      lineas,
      motivo,
      fecha,
      invAjusteId,
      omitirAjusteStock,
    } = payload;
    if (!proveedorId) throw new Error('Proveedor requerido para la devolución.');
    if (!lineas?.length) throw new Error('Líneas de devolución requeridas');
    let montoNc = 0;
    const fechaDoc = fecha || (typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10));
    for (const ln of lineas) {
      const cant = Math.abs(parseInt(ln.cantidad, 10) || 0);
      const costo = n(ln.costoUnitario);
      if (cant <= 0) throw new Error('Cantidad de devolución inválida.');
      montoNc += cant * costo;
      if (ln.articuloId && !omitirAjusteStock) {
        const art = (state.articulos || []).find((a) => String(a.id) === String(ln.articuloId));
        const stk = n(art?.stock);
        if (stk < cant - 0.001) {
          throw new Error(`Stock insuficiente para devolver «${art?.nombre || ln.articuloId}» (disponible: ${stk}).`);
        }
        await syncStockLine(supabaseClient, ln.articuloId, -cant);
        if (art) art.stock = Math.max(0, stk - cant);
        pushInvMovimiento(state, {
          articuloId: ln.articuloId,
          bodegaId: ln.bodegaId || 'bodega_main',
          cantidad: -cant,
          tipo: 'devolucion_proveedor',
          fecha: fechaDoc,
          referencia: compraId ? 'NC compra' : 'NC general',
          nota: motivo || 'Devolución proveedor',
        });
      }
    }
    const { saldo } = calcSaldoProveedor(state, proveedorId);
    if (montoNc > saldo + 0.02) {
      throw new Error(
        `El valor de la devolución (${montoNc}) supera la deuda pendiente del proveedor. Registra una nota crédito manual o ajusta las cantidades.`,
      );
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
    const { error: ncErr } = await supabaseClient.from('proveedor_notas_credito').insert(ncRow);
    if (ncErr) throw ncErr;
    const cxpId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const meta = invAjusteId ? { inv_ajuste_id: String(invAjusteId) } : {};
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
      meta,
    };
    const { error: cxpErr } = await supabaseClient.from('proveedor_cxp_movimientos').insert(cxpNc);
    if (cxpErr) throw cxpErr;
    state.proveedor_notas_credito.push(mapNotaCreditoRow(ncRow));
    state.proveedor_cxp_movimientos.push(mapCxpRow(cxpNc));
    if (compraId) {
      const items = itemsDeCompra(state, compraId);
      const totalItems = items.reduce((s, i) => s + n(i.cantidad) * n(i.costoUnitario), 0);
      const nuevoEstado = montoNc >= totalItems - 0.02 ? 'returned' : 'partial_returned';
      const c = state.compras.find((x) => String(x.id) === String(compraId));
      if (c) c.estado = nuevoEstado;
      await supabaseClient
        .from('compras')
        .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
        .eq('id', compraId);
    }
    return { notaCredito: mapNotaCreditoRow(ncRow), movimientoId: cxpId };
  }

  async function crearNotaCreditoManual(ctx, { proveedorId, proveedorNombre, compraId, monto, motivo, fecha }) {
    const { state, supabaseClient, dbId, today } = ctx;
    const valor = n(monto);
    if (valor <= 0) throw new Error('El monto debe ser mayor a cero.');
    if (!proveedorId) throw new Error('Proveedor requerido.');
    const fechaDoc = fecha || (typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10));
    const ncId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const ncRow = {
      id: ncId,
      proveedor_id: proveedorId,
      proveedor_nombre: proveedorNombre || '',
      compra_id: compraId || null,
      fecha: fechaDoc,
      monto: valor,
      estado: 'draft',
      motivo: motivo || 'Nota crédito manual',
    };
    const { error } = await supabaseClient.from('proveedor_notas_credito').insert(ncRow);
    if (error) throw error;
    state.proveedor_notas_credito.push(mapNotaCreditoRow(ncRow));
    return mapNotaCreditoRow(ncRow);
  }

  async function aplicarNotaCredito(ctx, notaCreditoId) {
    const { state, supabaseClient, dbId } = ctx;
    const nc = (state.proveedor_notas_credito || []).find((n) => String(n.id) === String(notaCreditoId));
    if (!nc || nc.estado !== 'draft') throw new Error('Nota crédito no encontrada o ya aplicada.');
    const { saldo } = calcSaldoProveedor(state, nc.proveedorId);
    if (n(nc.monto) > saldo + 0.02) {
      throw new Error('El monto de la nota supera la deuda pendiente del proveedor.');
    }
    const cxpId = typeof dbId === 'function' ? dbId() : crypto.randomUUID();
    const cxpNc = {
      id: cxpId,
      proveedor_id: nc.proveedorId,
      proveedor_nombre: nc.proveedorNombre,
      tipo: 'nota_credito',
      naturaleza: 'credito',
      compra_id: nc.compraId || null,
      nota_credito_id: nc.id,
      fecha: nc.fecha,
      fecha_hora: new Date().toISOString(),
      monto: n(nc.monto),
      estado: 'active',
      origen: 'nota_credito',
      nota: nc.motivo || '',
    };
    const { error: cxpErr } = await supabaseClient.from('proveedor_cxp_movimientos').insert(cxpNc);
    if (cxpErr) throw cxpErr;
    await supabaseClient.from('proveedor_notas_credito').update({ estado: 'applied' }).eq('id', nc.id);
    nc.estado = 'applied';
    state.proveedor_cxp_movimientos.push(mapCxpRow(cxpNc));
    return { notaCredito: nc, movimientoId: cxpId };
  }

  async function anularNotaCredito(ctx, notaCreditoId) {
    const { state, supabaseClient } = ctx;
    const nc = (state.proveedor_notas_credito || []).find((n) => String(n.id) === String(notaCreditoId));
    if (!nc || nc.estado === 'cancelled') throw new Error('Nota crédito no encontrada o ya anulada.');
    const now = new Date().toISOString();
    await supabaseClient
      .from('proveedor_notas_credito')
      .update({ estado: 'cancelled', cancelled_at: now })
      .eq('id', notaCreditoId);
    nc.estado = 'cancelled';
    const movs = (state.proveedor_cxp_movimientos || []).filter(
      (m) => String(m.notaCreditoId) === String(notaCreditoId) && m.estado === 'active',
    );
    for (const m of movs) {
      await supabaseClient
        .from('proveedor_cxp_movimientos')
        .update({ estado: 'cancelled', cancelled_at: now })
        .eq('id', m.id);
      m.estado = 'cancelled';
    }
    return true;
  }

  async function anularDevolucionPorAjuste(ctx, invAjusteId) {
    const { state, supabaseClient } = ctx;
    if (!invAjusteId) return false;
    const aid = String(invAjusteId);
    const movs = (state.proveedor_cxp_movimientos || []).filter(
      (m) =>
        m.estado === 'active' &&
        (m.origen === 'devolucion' || m.tipo === 'devolucion') &&
        String(m.meta?.inv_ajuste_id || '') === aid,
    );
    if (!movs.length) return false;
    const now = new Date().toISOString();
    for (const m of movs) {
      await supabaseClient
        .from('proveedor_cxp_movimientos')
        .update({ estado: 'cancelled', cancelled_at: now })
        .eq('id', m.id);
      m.estado = 'cancelled';
      if (m.notaCreditoId) await anularNotaCredito(ctx, m.notaCreditoId);
    }
    return true;
  }

  function compraTieneAbonosActivos(state, compraId) {
    const cargo = (state.proveedor_cxp_movimientos || []).find(
      (m) => String(m.compraId) === String(compraId) && m.naturaleza === 'cargo' && m.estado === 'active',
    );
    if (!cargo) return false;
    return (state.proveedor_abono_aplicaciones || []).some(
      (a) => a.estado === 'active' && String(a.movimientoCargoId) === String(cargo.id),
    );
  }

  async function anularCompra(ctx, compraId) {
    const { state, supabaseClient } = ctx;
    const compra = (state.compras || []).find((c) => String(c.id) === String(compraId));
    if (!compra || compra.estado === 'cancelled') throw new Error('Compra no encontrada o ya anulada.');
    if (compraTieneAbonosActivos(state, compraId)) {
      throw new Error('No se puede anular: hay abonos aplicados a esta compra. Anule los abonos primero.');
    }
    const now = new Date().toISOString();
    await supabaseClient
      .from('compras')
      .update({ estado: 'cancelled', cancelled_at: now, updated_at: now })
      .eq('id', compraId);
    compra.estado = 'cancelled';
    const cargos = (state.proveedor_cxp_movimientos || []).filter(
      (m) => String(m.compraId) === String(compraId) && m.naturaleza === 'cargo' && m.estado === 'active',
    );
    for (const m of cargos) {
      await supabaseClient
        .from('proveedor_cxp_movimientos')
        .update({ estado: 'cancelled', cancelled_at: now })
        .eq('id', m.id);
      m.estado = 'cancelled';
    }
    return true;
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

  function pushGoLiveCheck(checks, id, ok, message, detail, severity) {
    checks.push({ id, ok, message, detail: detail || '', severity: severity || (ok ? 'ok' : 'error') });
  }

  async function goLiveSmokeCheck(ctx) {
    const { state, supabaseClient } = ctx || {};
    const checks = [];
    const counts = {
      compras: (state?.compras || []).length,
      compra_items: (state?.compra_items || []).length,
      proveedor_cxp_movimientos: (state?.proveedor_cxp_movimientos || []).length,
      proveedor_abonos: (state?.proveedor_abonos || []).length,
      proveedor_abono_aplicaciones: (state?.proveedor_abono_aplicaciones || []).length,
      proveedor_notas_credito: (state?.proveedor_notas_credito || []).length,
    };
    const tableNames = [
      'compras',
      'compra_items',
      'proveedor_cxp_movimientos',
      'proveedor_abonos',
      'proveedor_abono_aplicaciones',
      'proveedor_notas_credito',
    ];

    if (!supabaseClient) {
      pushGoLiveCheck(checks, 'session', false, 'Cliente Supabase no disponible', '', 'error');
    } else {
      try {
        const { data: sessData, error: sessErr } = await supabaseClient.auth.getSession();
        if (sessErr) {
          pushGoLiveCheck(checks, 'session', false, 'Error de sesión', sessErr.message, 'error');
        } else if (!sessData?.session) {
          pushGoLiveCheck(checks, 'session', false, 'Sin sesión activa (inicia sesión en el ERP)', '', 'error');
        } else {
          pushGoLiveCheck(
            checks,
            'session',
            true,
            'Sesión activa',
            sessData.session.user?.email || 'authenticated',
            'ok',
          );
        }
      } catch (e) {
        pushGoLiveCheck(checks, 'session', false, 'No se pudo leer sesión', e.message, 'error');
      }
    }

    if (supabaseClient) {
      const rlsFails = [];
      for (const table of tableNames) {
        try {
          const { error } = await supabaseClient.from(table).select('id').limit(1);
          if (error) {
            const msg = error.message || String(error);
            if (/row-level security|42501|permission denied/i.test(msg)) {
              rlsFails.push(`${table}: RLS`);
            } else {
              rlsFails.push(`${table}: ${msg}`);
            }
          }
        } catch (e) {
          rlsFails.push(`${table}: ${e.message}`);
        }
      }
      if (rlsFails.length) {
        pushGoLiveCheck(checks, 'load_tables', false, 'Fallo lectura tablas CXP', rlsFails.join('; '), 'error');
      } else {
        pushGoLiveCheck(checks, 'load_tables', true, 'Lectura RLS OK en 6 tablas', '', 'ok');
      }
    }

    if (supabaseClient?.rpc) {
      const { error: rpcCompraErr } = await supabaseClient.rpc('compra_guardar_v1', { p_payload: null });
      if (isRpcMissingError(rpcCompraErr)) {
        pushGoLiveCheck(
          checks,
          'rpc_compra',
          false,
          'RPC compra_guardar_v1 no desplegado',
          parseRpcError(rpcCompraErr),
          'error',
        );
      } else {
        pushGoLiveCheck(
          checks,
          'rpc_compra',
          true,
          'RPC compra_guardar_v1 disponible',
          rpcCompraErr ? parseRpcError(rpcCompraErr) : '',
          'ok',
        );
      }

      const { error: rpcAbonoErr } = await supabaseClient.rpc('abono_aplicar_v1', { p_payload: null });
      if (isRpcMissingError(rpcAbonoErr)) {
        pushGoLiveCheck(
          checks,
          'rpc_abono',
          false,
          'RPC abono_aplicar_v1 no desplegado',
          parseRpcError(rpcAbonoErr),
          'error',
        );
      } else {
        pushGoLiveCheck(
          checks,
          'rpc_abono',
          true,
          'RPC abono_aplicar_v1 disponible',
          rpcAbonoErr ? parseRpcError(rpcAbonoErr) : '',
          'ok',
        );
      }
    }

    const provCount = (state?.usu_proveedores || []).length;
    if (provCount > 0) {
      pushGoLiveCheck(checks, 'proveedores', true, `${provCount} proveedor(es) en catálogo`, '', 'ok');
    } else {
      pushGoLiveCheck(
        checks,
        'proveedores',
        false,
        'Sin proveedores en catálogo',
        'Usuarios → Proveedores',
        'error',
      );
    }

    const cajaAbierta = (state?.cajas || []).some((c) => c.estado === 'abierta');
    if (cajaAbierta) {
      pushGoLiveCheck(checks, 'caja_abierta', true, 'Hay caja abierta', '', 'ok');
    } else {
      pushGoLiveCheck(
        checks,
        'caja_abierta',
        true,
        'Sin caja abierta (opcional para abono con egreso)',
        'Abre caja en Tesorería antes de probar abono con egreso',
        'warn',
      );
    }

    const hasJsPdf = !!(global.jspdf?.jsPDF || global.jsPDF);
    if (hasJsPdf) {
      pushGoLiveCheck(checks, 'jsPDF', true, 'jsPDF cargado (PDF abonos)', '', 'ok');
    } else {
      pushGoLiveCheck(
        checks,
        'jsPDF',
        true,
        'jsPDF no detectado (PDF abono usará fallback HTML)',
        '',
        'warn',
      );
    }

    const ok = checks.every((c) => c.ok || c.severity === 'warn');
    return { ok, checks, counts };
  }

  function logGoLiveSmokeCheck(result) {
    const r = result || { ok: false, checks: [], counts: {} };
    console.group('[CXP Go-live] Smoke check');
    console.table(
      (r.checks || []).map((c) => ({
        id: c.id,
        ok: c.ok,
        severity: c.severity,
        message: c.message,
        detail: c.detail,
      })),
    );
    console.log('Conteos en memoria:', r.counts);
    console.log(r.ok ? 'RESULTADO: OK (listo para go-live)' : 'RESULTADO: REVISAR errores arriba');
    console.groupEnd();
    return r;
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

  function csvCell(v) {
    const s = String(v ?? '');
    if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function rowsToCsv(rows) {
    return rows.map((r) => r.map(csvCell).join(';')).join('\n');
  }

  function withCsvBom(csv) {
    return `\ufeff${csv}`;
  }

  function downloadCsv(filename, csvString) {
    const blob = new Blob([withCsvBom(csvString)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportCsvProveedores(state, fmt) {
    const fmtFn = typeof fmt === 'function' ? fmt : (v) => String(v);
    const rows = [['Proveedor', 'Deuda', 'Comprado', 'Abonado', 'Inv. costo', '% vendido']];
    (state.usu_proveedores || []).forEach((p) => {
      const m = metricasProveedor(state, p.id);
      rows.push([
        p.nombre,
        fmtFn(m.saldo),
        fmtFn(m.totalComprado),
        fmtFn(m.totalAbonado),
        fmtFn(m.inventarioCosto),
        `${m.porcentajeVendido.toFixed(1)}%`,
      ]);
    });
    return withCsvBom(rowsToCsv(rows));
  }

  function exportCsvComprasDetalle(state, filtros) {
    const fmtPlain = (v) => String(v ?? '');
    const f = filtros || {};
    let compras = [...(state.compras || [])];
    if (f.provId) compras = compras.filter((c) => String(c.proveedorId) === String(f.provId));
    if (f.estado) compras = compras.filter((c) => c.estado === f.estado);
    if (f.tipo) compras = compras.filter((c) => c.tipoCompra === f.tipo);
    if (f.desde) compras = compras.filter((c) => String(c.fecha) >= f.desde);
    if (f.hasta) compras = compras.filter((c) => String(c.fecha) <= f.hasta);
    const rows = [
      [
        'Numero',
        'Proveedor',
        'Fecha',
        'Tipo',
        'Estado compra',
        'Articulo',
        'Cantidad',
        'Costo unit.',
        'Subtotal linea',
        'Total compra',
      ],
    ];
    compras.forEach((c) => {
      const items = itemsDeCompra(state, c.id);
      if (!items.length) {
        rows.push([c.numero, c.proveedorNombre, c.fecha, c.tipoCompra, c.estado, '', '', '', '', c.total]);
        return;
      }
      items.forEach((it, idx) => {
        rows.push([
          c.numero,
          c.proveedorNombre,
          c.fecha,
          c.tipoCompra,
          c.estado,
          it.articuloNombre || it.articuloId,
          it.cantidad,
          it.costoUnitario,
          it.subtotal ?? it.cantidad * it.costoUnitario,
          idx === 0 ? c.total : '',
        ]);
      });
    });
    return withCsvBom(rowsToCsv(rows));
  }

  function exportCsvCxpMovimientos(state, proveedorId) {
    let movs = [...(state.proveedor_cxp_movimientos || [])];
    if (proveedorId) movs = movs.filter((m) => String(m.proveedorId) === String(proveedorId));
    movs.sort((a, b) => String(b.fechaHora || b.fecha).localeCompare(String(a.fechaHora || a.fecha)));
    const rows = [
      ['Proveedor', 'Fecha', 'Tipo', 'Naturaleza', 'Estado', 'Monto', 'Compra', 'Origen', 'Nota', 'Ref abono/NC'],
    ];
    movs.forEach((m) => {
      const compra = (state.compras || []).find((c) => String(c.id) === String(m.compraId));
      rows.push([
        m.proveedorNombre,
        m.fecha,
        m.tipo,
        m.naturaleza,
        m.estado,
        m.monto,
        compra?.numero || m.compraId || '',
        m.origen,
        m.nota,
        m.abonoId || m.notaCreditoId || '',
      ]);
    });
    return withCsvBom(rowsToCsv(rows));
  }

  function exportCsvAbonosProveedor(state, proveedorId) {
    let abonos = (state.proveedor_abonos || []).filter((a) => a.estado === 'active');
    if (proveedorId) abonos = abonos.filter((a) => String(a.proveedorId) === String(proveedorId));
    abonos.sort((a, b) => String(b.fechaHora || b.fecha).localeCompare(String(a.fechaHora || a.fecha)));
    const rows = [['Proveedor', 'Fecha', 'Monto', 'Metodo', 'Estado', 'Compras aplicadas', 'Detalle aplicacion', 'Comprobante URL']];
    abonos.forEach((a) => {
      const apps = (state.proveedor_abono_aplicaciones || []).filter(
        (ap) => ap.estado === 'active' && String(ap.abonoId) === String(a.id),
      );
      const detalle = apps
        .map((ap) => {
          const c = (state.compras || []).find((x) => String(x.id) === String(ap.compraId));
          return `${c?.numero || ap.compraId}:${ap.montoAplicado}`;
        })
        .join(' | ');
      const comprasNums = [...new Set(apps.map((ap) => (state.compras || []).find((c) => String(c.id) === String(ap.compraId))?.numero).filter(Boolean))].join(', ');
      rows.push([
        a.proveedorNombre,
        a.fecha,
        a.monto,
        a.metodo,
        a.estado,
        comprasNums,
        detalle,
        a.comprobanteUrl || '',
      ]);
    });
    return withCsvBom(rowsToCsv(rows));
  }

  function buildComprobanteAbonoHtml(abono, proveedorNombre, aplicaciones, state, fmt) {
    const fmtFn = typeof fmt === 'function' ? fmt : (v) => String(v);
    const filasApp = (aplicaciones || [])
      .map((app) => {
        const c = (state.compras || []).find((x) => String(x.id) === String(app.compraId));
        return `<tr><td>${esc(c?.numero || app.compraId || '—')}</td><td style="text-align:right">${esc(fmtFn(app.montoAplicado))}</td></tr>`;
      })
      .join('');
    return `<!DOCTYPE html><html><head><title>Comprobante abono</title>
      <style>body{font-family:system-ui;padding:24px;max-width:520px}h1{font-size:18px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ddd;padding:6px;font-size:13px}th{background:#f5f5f5}</style></head><body>
      <h1>Comprobante de pago a proveedor</h1>
      <p><b>Proveedor:</b> ${esc(proveedorNombre)}</p>
      <p><b>Fecha:</b> ${esc(abono.fecha)}</p>
      <p><b>Monto:</b> ${esc(fmtFn(abono.monto))}</p>
      <p><b>Método:</b> ${esc(abono.metodo)}</p>
      <p><b>Ref. abono:</b> ${esc(abono.id)}</p>
      ${abono.nota ? `<p><b>Nota:</b> ${esc(abono.nota)}</p>` : ''}
      ${filasApp ? `<h2 style="font-size:14px;margin-top:16px">Aplicación a compras (FIFO)</h2><table><thead><tr><th>Compra</th><th style="text-align:right">Monto</th></tr></thead><tbody>${filasApp}</tbody></table>` : ''}
      <script>window.onload=function(){window.print()}</script></body></html>`;
  }

  function generarComprobanteAbonoPdfBlob(abono, proveedorNombre, aplicaciones, state, fmt) {
    const JsPdfCtor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (typeof JsPdfCtor !== 'function') return null;
    const fmtFn = typeof fmt === 'function' ? fmt : (v) => String(v);
    const emp = (state && state.empresa) || {};
    const pdf = new JsPdfCtor({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const margin = 14;
    let y = margin;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text('Comprobante de pago a proveedor', margin, y);
    y += 8;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(String(emp.nombre || 'Empresa').slice(0, 60), margin, y);
    y += 6;
    pdf.text(`Proveedor: ${String(proveedorNombre || '').slice(0, 70)}`, margin, y);
    y += 5;
    pdf.text(`Fecha: ${abono.fecha || ''}  ·  Método: ${abono.metodo || ''}`, margin, y);
    y += 5;
    pdf.text(`Monto: ${fmtFn(abono.monto)}  ·  Ref: ${String(abono.id || '').slice(0, 36)}`, margin, y);
    if (abono.nota) {
      y += 5;
      pdf.text(`Nota: ${String(abono.nota).slice(0, 90)}`, margin, y);
    }
    y += 6;
    const body = (aplicaciones || []).map((app) => {
      const c = (state.compras || []).find((x) => String(x.id) === String(app.compraId));
      return [String(c?.numero || app.compraId || '—').slice(0, 24), fmtFn(app.montoAplicado)];
    });
    if (body.length && typeof pdf.autoTable === 'function') {
      pdf.autoTable({
        head: [['Compra', 'Aplicado']],
        body,
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9 },
        headStyles: { fillColor: [0, 120, 100] },
      });
    } else if (body.length) {
      body.forEach((row) => {
        pdf.text(`${row[0]} — ${row[1]}`, margin, y);
        y += 5;
      });
    }
    return pdf.output('blob');
  }

  async function subirComprobanteAbono(ctx, abonoId, proveedorId, pdfBlob) {
    const { supabaseClient } = ctx;
    if (!supabaseClient || !pdfBlob) return null;
    const path = `cxp-abonos/${String(proveedorId || 'sin-prov')}/${String(abonoId)}.pdf`;
    const { error: upErr } = await supabaseClient.storage.from('Catalog-media').upload(path, pdfBlob, {
      upsert: true,
      contentType: 'application/pdf',
    });
    if (upErr) throw upErr;
    const { data: pub } = supabaseClient.storage.from('Catalog-media').getPublicUrl(path);
    const url = pub?.publicUrl || null;
    if (!url) throw new Error('No se obtuvo URL pública del comprobante.');
    const { error: dbErr } = await supabaseClient
      .from('proveedor_abonos')
      .update({ comprobante_url: url })
      .eq('id', abonoId);
    if (dbErr) throw dbErr;
    return url;
  }

  async function guardarComprobanteAbonoPostAbono(ctx, abono, aplicaciones, proveedorNombre) {
    const { state, fmt } = ctx;
    if (!abono?.id || !abono.proveedorId) return null;
    const blob = generarComprobanteAbonoPdfBlob(abono, proveedorNombre, aplicaciones, state, fmt);
    if (!blob) return null;
    return subirComprobanteAbono(ctx, abono.id, abono.proveedorId, blob);
  }

  async function enriquecerAbonoConComprobante(ctx, result, proveedorNombre) {
    if (!result?.abono) return result;
    try {
      const url = await guardarComprobanteAbonoPostAbono(ctx, result.abono, result.aplicaciones || [], proveedorNombre);
      if (url) {
        result.abono.comprobanteUrl = url;
        const local = (ctx.state.proveedor_abonos || []).find((a) => String(a.id) === String(result.abono.id));
        if (local) local.comprobanteUrl = url;
        result.comprobanteUrl = url;
      }
    } catch (e) {
      console.warn('[ComprasCxp] comprobante PDF:', e.message || e);
      result.advertenciaComprobante =
        'Abono guardado, pero no se pudo generar o subir el PDF: ' + (e.message || String(e));
    }
    return result;
  }

  function imprimirComprobanteAbono(abono, proveedorNombre, fmt, aplicaciones, state) {
    if (abono?.comprobanteUrl) {
      window.open(abono.comprobanteUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const st = state || global.state || {};
    const apps =
      aplicaciones ||
      (st.proveedor_abono_aplicaciones || []).filter(
        (a) => a.estado === 'active' && String(a.abonoId) === String(abono?.id),
      );
    const w = window.open('', '_blank', 'width=520,height=720');
    if (!w) return;
    w.document.write(buildComprobanteAbonoHtml(abono, proveedorNombre, apps, st, fmt));
    w.document.close();
  }

  function evalConciliacionCajaAbono(state, abono) {
    const tes = state.tes_movimientos || [];
    const cajaMovId = abono?.cajaMovimientoId ? String(abono.cajaMovimientoId) : '';
    const montoAbono = n(abono?.monto);
    const base = {
      abonoId: abono?.id,
      proveedorId: abono?.proveedorId,
      fecha: abono?.fecha,
      cajaMovId: cajaMovId || null,
      montoAbono,
      montoTes: null,
      tesId: null,
    };
    if (!abono?.id) return { ...base, ok: false, motivo: 'abono_invalido' };
    if (!cajaMovId) {
      const tesSinVinculo = tes.find(
        (t) =>
          String(t.refAbonoProvId || '') === String(abono.id) &&
          (t.categoria === 'proveedor_abono_v1' || !t.categoria),
      );
      if (tesSinVinculo) {
        return {
          ...base,
          ok: false,
          motivo: 'tes_sin_vinculo_abono',
          tesId: tesSinVinculo.id,
          montoTes: n(tesSinVinculo.valor),
        };
      }
      return { ...base, ok: true, motivo: 'sin_caja' };
    }
    const mov = tes.find((t) => String(t.id) === cajaMovId);
    if (!mov) {
      return { ...base, ok: false, motivo: 'sin_movimiento_tes' };
    }
    base.tesId = mov.id;
    base.montoTes = n(mov.valor);
    if (mov.refAbonoProvId && String(mov.refAbonoProvId) !== String(abono.id)) {
      return { ...base, ok: false, motivo: 'ref_cruzada' };
    }
    if (Math.abs(base.montoTes - montoAbono) > 0.02) {
      return { ...base, ok: false, motivo: 'monto_distinto' };
    }
    return { ...base, ok: true, motivo: 'ok' };
  }

  function auditarConciliacionCajaAbono(state, abonoId) {
    let abonos = state.proveedor_abonos || [];
    if (abonoId) {
      abonos = abonos.filter((a) => String(a.id) === String(abonoId));
    } else {
      abonos = abonos.filter((a) => a.estado === 'active');
    }
    const results = abonos.map((a) => evalConciliacionCajaAbono(state, a));
    if (!abonoId) {
      const activeIds = new Set(abonos.map((a) => String(a.id)));
      (state.tes_movimientos || []).forEach((t) => {
        const isProvAbono =
          t.categoria === 'proveedor_abono_v1' ||
          (t.refAbonoProvId && String(t.refAbonoProvId).trim() !== '');
        if (!isProvAbono) return;
        const ref = t.refAbonoProvId ? String(t.refAbonoProvId) : '';
        if (ref && activeIds.has(ref)) return;
        results.push({
          abonoId: ref || null,
          proveedorId: null,
          fecha: t.fecha,
          ok: false,
          motivo: 'tes_huerfano',
          cajaMovId: t.id,
          tesId: t.id,
          montoAbono: null,
          montoTes: n(t.valor),
        });
      });
    }
    return results;
  }

  function conciliacionResumenProveedor(state, proveedorId) {
    const pid = String(proveedorId);
    const audits = auditarConciliacionCajaAbono(state).filter((r) => {
      if (r.proveedorId && String(r.proveedorId) === pid) return true;
      if (r.abonoId) {
        const a = (state.proveedor_abonos || []).find((x) => String(x.id) === String(r.abonoId));
        return a && String(a.proveedorId) === pid;
      }
      return false;
    });
    audits.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    const conCaja = audits.filter((r) => r.motivo !== 'sin_caja');
    return {
      total: audits.length,
      ok: audits.filter((r) => r.ok).length,
      rotos: audits.filter((r) => !r.ok).length,
      conCaja: conCaja.length,
      items: audits.slice(0, 25),
    };
  }

  function etiquetaConciliacion(motivo) {
    const map = {
      ok: 'OK',
      sin_caja: 'Sin egreso caja',
      sin_movimiento_tes: 'Sin mov. tesorería',
      ref_cruzada: 'Ref. cruzada',
      monto_distinto: 'Monto distinto',
      tes_sin_vinculo_abono: 'Tes. sin vínculo',
      tes_huerfano: 'Tes. huérfano',
      abono_invalido: 'Abono inválido',
    };
    return map[motivo] || motivo || '—';
  }

  async function regenerarComprobanteAbono(ctx, abonoId, proveedorNombre) {
    const { state } = ctx;
    const abono = (state.proveedor_abonos || []).find((a) => String(a.id) === String(abonoId));
    if (!abono) throw new Error('Abono no encontrado.');
    const apps = (state.proveedor_abono_aplicaciones || []).filter(
      (a) => a.estado === 'active' && String(a.abonoId) === String(abonoId),
    );
    const url = await guardarComprobanteAbonoPostAbono(ctx, abono, apps, proveedorNombre || abono.proveedorNombre);
    if (url) {
      abono.comprobanteUrl = url;
    }
    return url;
  }

  global.AppComprasCxp = {
    TIPOS_COMPRA,
    ESTADOS_COMPRA,
    esc,
    calcSaldoProveedor,
    metricasProveedor,
    etiquetaPctVendido,
    cargosPendientesProveedor,
    planificarAplicacionFifo,
    validarPayloadCompra,
    validarMontoAbono,
    guardarCompra,
    guardarAbono,
    anularAbono,
    registrarDevolucion,
    crearNotaCreditoManual,
    aplicarNotaCredito,
    anularNotaCredito,
    anularDevolucionPorAjuste,
    anularCompra,
    compraTieneAbonosActivos,
    ajusteCostoProveedor,
    loadComprasCxpFromDb,
    goLiveSmokeCheck,
    logGoLiveSmokeCheck,
    exportCsvProveedores,
    exportCsvComprasDetalle,
    exportCsvCxpMovimientos,
    exportCsvAbonosProveedor,
    downloadCsv,
    imprimirComprobanteAbono,
    regenerarComprobanteAbono,
    guardarComprobanteAbonoPostAbono,
    calcFifoVendidoInformative,
    auditarConciliacionCajaAbono,
    conciliacionResumenProveedor,
    etiquetaConciliacion,
    comprasDeProveedor,
    itemsDeCompra,
    actualizarEstadoCompraPorPagos,
  };
})(window);
