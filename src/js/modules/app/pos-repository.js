// POS persistence layer for DB sync and side effects.
(function initPosRepository(global) {
  function applyLocalInventoryMovement(state, cart, idGen, fechaActual, numFactura, bodegaId) {
    const next = typeof idGen === 'function' ? idGen : () => (global.AppId?.uuid ? global.AppId.uuid() : String(Date.now()));
    if (!Array.isArray(state.inv_movimientos)) state.inv_movimientos = [];
    const bid = bodegaId || 'bodega_main';
    cart.forEach((item) => {
      const mov = {
        id: next(),
        articuloId: item.articuloId,
        bodegaId: bid,
        cantidad: -item.qty,
        tipo: 'venta',
        fecha: fechaActual,
        referencia: numFactura,
        nota: `Talla: ${item.talla}`
      };
      state.inv_movimientos.push(mov);
    });
  }

  async function persistPosSale(saveRecord, factura, ventaRecord) {
    // Invariante POS: una sola venta por factura, mismo id (cobros, separados, guías).
    if (factura && ventaRecord && String(factura.id) !== String(ventaRecord.id)) {
      console.error('[POS] Invariante rota: factura.id !== ventaRecord.id', factura.id, ventaRecord.id);
      return false;
    }
    const facturaSaved = await saveRecord('facturas', factura.id, factura);
    const ventaSaved = await saveRecord('ventas', ventaRecord.id, ventaRecord);
    return facturaSaved && ventaSaved;
  }

  /**
   * Descuenta stock en products solo para líneas que ya tienen movimiento registrado.
   * (El flujo POS llama esto desde registerPosSaleSideEffects tras insert OK en stock_moves.)
   */
  async function applyStockDecrementForLine(state, supabaseClient, articuloId, qty) {
    const art = (state.articulos || []).find((a) => a.id === articuloId);
    if (!art) return;
    const q = Math.abs(parseInt(qty, 10) || 0);
    if (q <= 0) return;
    const { data, error } = await supabaseClient.rpc('decrement_stock', {
      p_product_id: articuloId,
      p_qty: q,
    });
    if (error) throw error;
    art.stock = parseFloat(data) || 0;
  }

  /**
   * RPC `apply_pos_sale_stock_lines`: inserta stock_moves + descuenta products.stock en una transacción.
   * @param {object} opts — pushMovesVentas, fechaRef, numFactura, documentoId
   */
  async function applyPosSaleStockLinesAtomic(state, supabaseClient, lines, qtyCol, opts) {
    const o = opts || {};
    if (!supabaseClient || !Array.isArray(lines) || lines.length === 0) {
      return { ok: false, error: new Error('applyPosSaleStockLinesAtomic: missing data') };
    }
    const col = typeof qtyCol === 'string' && qtyCol.trim() ? qtyCol.trim() : 'cantidad';
    const { data, error } = await supabaseClient.rpc('apply_pos_sale_stock_lines', {
      p_lines: lines,
      p_qty_column: col,
    });
    if (error) return { ok: false, error };
    const payload = data && typeof data === 'object' ? data : null;
    if (!payload || payload.ok !== true) {
      return { ok: false, error: new Error('apply_pos_sale_stock_lines: invalid response') };
    }
    const products = Array.isArray(payload.products) ? payload.products : [];
    for (let pi = 0; pi < products.length; pi++) {
      const p = products[pi];
      const art = (state.articulos || []).find((a) => String(a.id) === String(p.id));
      if (art) art.stock = parseFloat(p.stock) || 0;
    }
    if (o.pushMovesVentas) {
      const fecha = o.fechaRef || new Date().toISOString();
      const ref = o.numFactura || '';
      const docId = o.documentoId != null ? o.documentoId : null;
      if (!Array.isArray(state.stock_moves_ventas)) state.stock_moves_ventas = [];
      const moves = Array.isArray(payload.moves) ? payload.moves : [];
      for (let mi = 0; mi < moves.length; mi++) {
        const m = moves[mi];
        state.stock_moves_ventas.push({
          id: m.id,
          productId: m.product_id,
          cantidad: Number(m.qty),
          tipo: 'venta_pos',
          fecha,
          referencia: ref,
          documentoId: docId,
        });
      }
    }
    return { ok: true, payload };
  }

  /** Sincroniza `art.stock` en memoria con `products.stock` en Supabase (útil antes de reintentos). */
  async function refreshArticuloStockFromSupabase(state, supabaseClient, articuloId) {
    if (!supabaseClient || !articuloId) return;
    const { data, error } = await supabaseClient.from('products').select('stock').eq('id', articuloId).maybeSingle();
    if (error) throw error;
    const art = (state.articulos || []).find((a) => String(a.id) === String(articuloId));
    if (art && data) art.stock = parseFloat(data.stock) || 0;
  }

  function removeStockProductsPendingLine(ventaRecord, articuloId, qty) {
    if (!ventaRecord || !Array.isArray(ventaRecord.stockProductsPendingLines)) return;
    const q = Math.abs(parseInt(qty, 10) || 0);
    const idx = ventaRecord.stockProductsPendingLines.findIndex(
      (x) => String(x.articuloId) === String(articuloId) && Math.abs(parseInt(x.qty, 10) || 0) === q
    );
    if (idx !== -1) ventaRecord.stockProductsPendingLines.splice(idx, 1);
  }

  function pushStockProductsPendingLine(ventaRecord, articuloId, qty) {
    if (!ventaRecord) return;
    if (!Array.isArray(ventaRecord.stockProductsPendingLines)) ventaRecord.stockProductsPendingLines = [];
    ventaRecord.stockProductsPendingLines.push({ articuloId, qty: Math.abs(parseInt(qty, 10) || 0) });
  }

  /** @deprecated Usar solo registerPosSaleSideEffects (mueve stock tras stock_moves). */
  async function syncStockToSupabase(state, cart, supabaseClient, sbConnected) {
    if (!sbConnected || !supabaseClient) return;
    for (const item of cart) {
      const art = (state.articulos || []).find((a) => a.id === item.articuloId);
      if (!art) continue;
      const q = Math.abs(parseInt(item.qty, 10) || 0);
      if (q <= 0) continue;
      const { data, error } = await supabaseClient.rpc('decrement_stock', {
        p_product_id: item.articuloId,
        p_qty: q,
      });
      if (error) throw error;
      art.stock = parseFloat(data) || 0;
    }
  }

  /** Texto para movimiento de caja: factura + resumen de productos (misma fecha de la venta). */
  function buildPosIngresoConcepto(numFactura, cart) {
    const base = `Venta POS ${numFactura || ''}`.trim();
    if (!Array.isArray(cart) || cart.length === 0) return base;
    const parts = cart.slice(0, 4).map((i) => {
      const name = String(i.nombre || 'Ítem')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 22);
      const q = parseInt(i.qty, 10) || 1;
      return q > 1 ? `${name}×${q}` : name;
    });
    let extra = parts.join(', ');
    if (cart.length > 4) extra += ` +${cart.length - 4}`;
    const full = `${base} · ${extra}`;
    return full.length > 220 ? `${full.slice(0, 217)}…` : full;
  }

  /**
   * Tras venta POS: stock_moves + siempre ingreso en caja (si hay caja abierta).
   * Contra entrega: el ingreso queda con fecha de la venta; Cobros solo hace seguimiento (sin segundo ingreso al liquidar).
   */
  async function registerPosSaleSideEffects(ctx) {
    const {
      state,
      cart,
      factura,
      ventaRecord,
      numFactura,
      fechaActual,
      dbId,
      saveRecord,
      supabaseClient,
      sbConnected,
      posFormState,
      notify
    } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : () => (global.AppId?.uuid ? global.AppId.uuid() : String(Date.now()));

    const posBodega = (posFormState && posFormState.bodegaId) || global.AppCajaLogic?.getPosBodegaId?.() || 'bodega_main';

    if (sbConnected && supabaseClient && Array.isArray(cart)) {
      const qtyCol = typeof global.stockMovesQtyColumn === 'function'
        ? global.stockMovesQtyColumn()
        : 'cantidad';
      let stockPendingDirty = false;
      const lines = [];
      for (const item of cart) {
        const pid = item.articuloId;
        const qty = Math.abs(parseInt(item.qty, 10) || 0);
        if (!pid || qty <= 0) continue;
        lines.push({
          id: nextId(),
          product_id: pid,
          bodega_id: posBodega,
          qty,
          referencia: numFactura || '',
          documento_id: factura?.id || null,
          fecha: fechaActual,
          nota: `${item.nombre || 'Ítem'} · Talla: ${item.talla || '—'}`,
          tipo: 'venta_pos',
        });
      }
      if (lines.length > 0) {
        const rpcRes = await applyPosSaleStockLinesAtomic(state, supabaseClient, lines, qtyCol, {
          pushMovesVentas: true,
          fechaRef: fechaActual,
          numFactura: numFactura || '',
          documentoId: factura?.id || null,
        });
        if (!rpcRes.ok) {
          console.warn('[POS] apply_pos_sale_stock_lines:', rpcRes.error?.message || rpcRes.error, lines);
          if (typeof notify === 'function') {
            notify(
              'danger',
              '📦',
              'stock_moves',
              `No se registró inventario en BD: ${rpcRes.error?.message || rpcRes.error}. Reintenta la venta o usa «Rellenar movimientos POS» en Pagos a proveedores.`,
              { duration: 9000 }
            );
          }
          if (ventaRecord) {
            for (const item of cart) {
              const pid = item.articuloId;
              const qty = Math.abs(parseInt(item.qty, 10) || 0);
              if (!pid || qty <= 0) continue;
              pushStockProductsPendingLine(ventaRecord, pid, qty);
            }
            stockPendingDirty = true;
          }
        } else if (ventaRecord) {
          for (const item of cart) {
            const pid = item.articuloId;
            const qty = Math.abs(parseInt(item.qty, 10) || 0);
            if (!pid || qty <= 0) continue;
            const before = (ventaRecord.stockProductsPendingLines || []).length;
            removeStockProductsPendingLine(ventaRecord, pid, qty);
            if ((ventaRecord.stockProductsPendingLines || []).length < before) stockPendingDirty = true;
          }
        }
      }
      if (stockPendingDirty && ventaRecord && typeof saveRecord === 'function') {
        try {
          await saveRecord('ventas', ventaRecord.id, ventaRecord);
        } catch (_) { /* noop */ }
      }
    }

    const total = parseFloat(factura?.total) || 0;
    if (total <= 0) return;

    const bodegaId = posBodega;
    const prefCaja = (posFormState && posFormState.cajaId) || global.AppCajaLogic?.getPosCajaId?.() || '';
    const caja =
      global.AppCajaLogic?.resolveCajaForPos?.(state, bodegaId, prefCaja) ||
      (state.cajas || []).find((c) => c.estado === 'abierta');
    if (!caja) {
      console.warn('[POS] Sin caja abierta para bodega; no se registró ingreso en caja:', numFactura, bodegaId);
      if (typeof notify === 'function') {
        notify(
          'warning',
          '🏧',
          'Caja',
          `Venta ${numFactura} no sumó en caja (abre una caja enlazada a esta bodega en Tesorería / Configuración).`,
          { duration: 5000 }
        );
      }
      return;
    }

    if (global.AppCajaLogic?.normalizeCaja) global.AppCajaLogic.normalizeCaja(caja);
    const metodo = (posFormState && posFormState.metodo) ? posFormState.metodo : 'efectivo';
    const concepto = buildPosIngresoConcepto(numFactura, cart);
    const movsToPersist = [];
    if (metodo === 'mixto') {
      const mixEfe = parseFloat(posFormState?.mixtoEfectivo) || 0;
      const mixTrf = parseFloat(posFormState?.mixtoTransferencia) || 0;
      const eOk = Math.max(0, mixEfe);
      const tOk = Math.max(0, mixTrf);
      if (eOk > 0) {
        global.AppCajaLogic?.applyDeltaBucket?.(caja, 'efectivo', eOk);
        movsToPersist.push({
          id: nextId(),
          cajaId: caja.id,
          tipo: 'ingreso',
          valor: eOk,
          concepto: `${concepto} · pago mixto (efectivo)`,
          fecha: fechaActual,
          metodo: 'efectivo',
          categoria: 'venta_pos',
          bucket: 'efectivo'
        });
      }
      if (tOk > 0) {
        global.AppCajaLogic?.applyDeltaBucket?.(caja, 'transferencia', tOk);
        movsToPersist.push({
          id: nextId(),
          cajaId: caja.id,
          tipo: 'ingreso',
          valor: tOk,
          concepto: `${concepto} · pago mixto (transferencia)`,
          fecha: fechaActual,
          metodo: 'transferencia',
          categoria: 'venta_pos',
          bucket: 'transferencia'
        });
      }
    } else {
      const bucket = global.AppCajaLogic?.resolvePosSaleBucket?.(posFormState, state) || 'efectivo';
      if (global.AppCajaLogic?.applyDeltaBucket) global.AppCajaLogic.applyDeltaBucket(caja, bucket, total);
      else caja.saldo = (parseFloat(caja.saldo) || 0) + total;
      movsToPersist.push({
        id: nextId(),
        cajaId: caja.id,
        tipo: 'ingreso',
        valor: total,
        concepto,
        fecha: fechaActual,
        metodo,
        categoria: 'venta_pos',
        bucket
      });
    }
    movsToPersist.forEach((m) => global.AppCajaLogic?.enrichMovWithSesion?.(state, caja.id, m, nextId));
    if (!Array.isArray(state.tes_movimientos)) state.tes_movimientos = [];
    movsToPersist.forEach((m) => state.tes_movimientos.push(m));

    let okMov = true;
    const okCaja = await saveRecord('cajas', caja.id, caja);
    for (let i = 0; i < movsToPersist.length; i++) {
      const ok = await saveRecord('tes_movimientos', movsToPersist[i].id, movsToPersist[i]);
      if (!ok) okMov = false;
    }
    if (!okCaja || !okMov) {
      console.warn('[POS] No se pudo persistir caja/movimiento tras venta', numFactura);
      if (ventaRecord) {
        ventaRecord.syncPending = true;
        ventaRecord.syncError = 'caja_mov';
        try { await saveRecord('ventas', ventaRecord.id, ventaRecord); } catch (_) { /* noop */ }
      }
      if (typeof notify === 'function') {
        notify('warning', '⚠️', 'Sincronización pendiente', `Venta ${numFactura} quedó pendiente de sincronizar en caja/movimiento.`, { duration: 6000 });
      }
    }
  }

  /**
   * Devuelve stock al anular una venta POS (misma lógica inversa que syncStockToSupabase).
   */
  async function restoreStockAfterPosAnulacion(state, cart, supabaseClient, sbConnected) {
    if (!sbConnected || !supabaseClient || !Array.isArray(cart)) return;
    for (const item of cart) {
      const pid = item.articuloId;
      const qty = Math.abs(parseInt(item.qty, 10) || 0);
      if (!pid || qty <= 0) continue;
      const art = (state.articulos || []).find((a) => a.id === pid);
      if (!art) continue;
      const { data, error } = await supabaseClient.rpc('increment_stock', {
        p_product_id: pid,
        p_qty: qty,
      });
      if (error) console.warn('[POS] restore stock anulación:', error.message);
      else art.stock = parseFloat(data) || 0;
    }
  }

  /**
   * Líneas positivas en stock_moves (tipo venta_pos) netean la venta en calcDeudaProveedor (vendido POS).
   */
  async function registerPosAnulacionStockMoves(ctx) {
    const {
      state,
      cart,
      factura,
      facturaId,
      numFactura,
      fechaActual,
      dbId,
      supabaseClient,
      sbConnected,
      posFormState,
      notify
    } = ctx;
    const docId = (factura && factura.id) || facturaId;
    const posBodega = (posFormState && posFormState.bodegaId) || global.AppCajaLogic?.getPosBodegaId?.() || 'bodega_main';
    const nextId = typeof dbId === 'function' ? dbId : () => (global.AppId?.uuid ? global.AppId.uuid() : String(Date.now()));

    if (!sbConnected || !supabaseClient || !Array.isArray(cart) || !docId) return;

    for (const item of cart) {
      const pid = item.articuloId;
      const qty = Math.abs(parseInt(item.qty, 10) || 0);
      if (!pid || qty <= 0) continue;
      const qtyCol = typeof global.stockMovesQtyColumn === 'function'
        ? global.stockMovesQtyColumn()
        : 'cantidad';
      const row = {
        id: nextId(),
        product_id: pid,
        bodega_id: posBodega,
        tipo: 'venta_pos',
        referencia: numFactura || '',
        documento_id: docId,
        fecha: fechaActual,
        nota: `Anulación · ${item.nombre || 'Ítem'} · Talla: ${item.talla || '—'}`
      };
      row[qtyCol] = qty;
      const { error } = await supabaseClient.from('stock_moves').insert(row);
      if (error) {
        console.warn('[POS] stock_moves anulación:', error.message, row);
        if (typeof notify === 'function') {
          notify('warning', '📦', 'stock_moves', `Anulación no registrada: ${error.message}`, { duration: 5000 });
        }
      } else {
        if (!Array.isArray(state.stock_moves_ventas)) state.stock_moves_ventas = [];
        state.stock_moves_ventas.push({
          id: row.id,
          productId: pid,
          cantidad: Number(row[qtyCol]),
          tipo: 'venta_pos',
          fecha: fechaActual,
          referencia: numFactura || '',
          documentoId: docId
        });
      }
    }
  }

  function autoRegisterCustomer(state, posFormState, idGen, fechaActual, supabaseClient, sbConnected) {
    const next = typeof idGen === 'function' ? idGen : () => (global.AppId?.uuid ? global.AppId.uuid() : String(Date.now()));
    if (!posFormState.cliente) return;
    if (!Array.isArray(state.usu_clientes)) state.usu_clientes = [];
    const yaExiste = state.usu_clientes.some((u) =>
      (u.cedula && u.cedula === posFormState.cedula) ||
      (u.nombre && u.nombre.toLowerCase() === posFormState.cliente.toLowerCase())
    );
    if (yaExiste) return;

    const nc = {
      id: next(),
      tipo: 'cliente',
      tipoId: 'CC',
      cedula: posFormState.cedula || '',
      nombre: posFormState.cliente,
      celular: posFormState.telefono || '',
      whatsapp: posFormState.telefono || '',
      ciudad: posFormState.ciudad || '',
      direccion: posFormState.direccion || '',
      fechaCreacion: fechaActual
    };
    state.usu_clientes.push(nc);

    if (sbConnected && supabaseClient) {
      supabaseClient.from('customers').upsert({
        id: nc.id,
        nombre: nc.nombre,
        cedula: nc.cedula || null,
        celular: nc.celular || null,
        telefono: nc.celular || null,
        whatsapp: nc.whatsapp || null,
        ciudad: nc.ciudad || null,
        direccion: nc.direccion || null
      }, { onConflict: 'id' }).then(({ error }) => {
        if (error) console.warn('Auto-cliente error:', error.message);
      });
    }
  }

  /**
   * Suma de `cantidad` en stock_moves venta_pos para factura + producto (negativo = salida).
   */
  function netCantidadMovesDocProduct(state, documentoId, productId) {
    if (!documentoId || !productId) return 0;
    return (state.stock_moves_ventas || [])
      .filter(
        (m) =>
          String(m.documentoId) === String(documentoId) && String(m.productId) === String(productId),
      )
      .reduce((s, m) => s + (parseFloat(m.cantidad) || 0), 0);
  }

  /** Suma cantidades en BD (idempotente; no depende de state si RLS bloqueó la carga inicial). */
  async function netCantidadMovesDocProductDb(supabaseClient, documentoId, productId) {
    if (!supabaseClient || !documentoId || !productId) return 0;
    const normQty =
      typeof global.normalizeStockMoveQtyFromDbRow === 'function'
        ? global.normalizeStockMoveQtyFromDbRow
        : (r) => {
            const q = r.cantidad ?? r.quantity ?? r.qty ?? r.amount;
            return q != null ? Number(q) : 0;
          };
    const { data, error } = await supabaseClient
      .from('stock_moves')
      .select('cantidad, quantity')
      .eq('tipo', 'venta_pos')
      .eq('documento_id', documentoId)
      .eq('product_id', productId);
    if (error) {
      console.warn('[backfill] netCantidadMovesDocProductDb:', error.message);
      return 0;
    }
    let sum = 0;
    (data || []).forEach((r) => {
      sum += normQty(r);
    });
    return sum;
  }

  /**
   * Crea líneas stock_moves faltantes a partir de facturas POS ya guardadas (histórico sin trazabilidad).
   * No duplica: compara cantidad neta esperada vs movimientos existentes por factura+producto (lee BD).
   */
  async function backfillStockMovesFromFacturas(ctx) {
    const {
      state,
      supabaseClient,
      sbConnected,
      dbId,
      notify,
      showLoadingOverlay,
      onDone,
    } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : () => (global.AppId?.uuid ? global.AppId.uuid() : String(Date.now()));
    if (!sbConnected || !supabaseClient) {
      if (typeof notify === 'function') {
        notify('warning', '📡', 'Sin conexión', 'Conecta Supabase para rellenar movimientos.', { duration: 4000 });
      }
      return { inserted: 0 };
    }
    const facturas = state.facturas || [];
    const posBodega = global.AppCajaLogic?.getPosBodegaId?.() || 'bodega_main';
    const qtyCol = typeof global.stockMovesQtyColumn === 'function'
      ? global.stockMovesQtyColumn()
      : 'cantidad';
    let inserted = 0;
    let lastInsertError = '';
    try {
      if (typeof showLoadingOverlay === 'function') showLoadingOverlay('connecting');
      for (let fi = 0; fi < facturas.length; fi++) {
        const f = facturas[fi];
        if (!f || f.estado === 'anulada') continue;
        const tipo = (f.tipo || 'pos').toLowerCase();
        if (tipo !== 'pos') continue;
        const docId = f.id;
        const items = Array.isArray(f.items) ? f.items : [];
        if (items.length === 0) continue;
        const agg = new Map();
        for (let ii = 0; ii < items.length; ii++) {
          const it = items[ii];
          const pid = it.articuloId || it.id;
          if (!pid) continue;
          const q = Math.abs(parseInt(it.qty, 10) || parseFloat(it.cantidad) || 0);
          if (q <= 0) continue;
          agg.set(pid, (agg.get(pid) || 0) + q);
        }
        const fechaIso = f.fecha ? `${String(f.fecha).split('T')[0]}T12:00:00` : new Date().toISOString();
        const ref = f.numero || String(docId).slice(0, 8);
        for (const [pid, qtyNeed] of agg.entries()) {
          const net = await netCantidadMovesDocProductDb(supabaseClient, docId, pid);
          const target = -qtyNeed;
          const delta = target - net;
          if (delta >= 0) continue;
          const row = {
            id: nextId(),
            product_id: pid,
            bodega_id: posBodega,
            tipo: 'venta_pos',
            referencia: ref,
            documento_id: docId,
            fecha: fechaIso,
            nota: 'Relleno histórico · backfill desde factura POS',
          };
          row[qtyCol] = delta;
          const { error } = await supabaseClient.from('stock_moves').insert(row);
          if (error) {
            lastInsertError = error.message || String(error);
            console.warn('[backfill] stock_moves', lastInsertError, row);
            continue;
          }
          if (!Array.isArray(state.stock_moves_ventas)) state.stock_moves_ventas = [];
          state.stock_moves_ventas.push({
            id: row.id,
            productId: pid,
            cantidad: Number(row[qtyCol]),
            tipo: 'venta_pos',
            fecha: fechaIso,
            referencia: ref,
            documentoId: docId,
          });
          inserted += 1;
        }
      }
      if (typeof showLoadingOverlay === 'function') showLoadingOverlay('hide');
      if (typeof notify === 'function') {
        if (inserted === 0 && lastInsertError && /row-level security|RLS|permission denied|42501/i.test(lastInsertError)) {
          notify(
            'danger',
            '📦',
            'stock_moves bloqueado',
            'RLS o permisos impiden INSERT. Ejecuta en Supabase la migración `20260327240000_stock_moves_rls.sql` (políticas para anon/authenticated) y recarga.',
            { duration: 12000 },
          );
        } else {
          notify(
            'success',
            '📦',
            'Movimientos POS',
            inserted
              ? `Se crearon ${inserted} línea(s) en stock_moves. La columna «vendido» y pagos a proveedores usarán estos datos.`
              : 'No había líneas faltantes (o las facturas ya tenían movimientos).',
            { duration: 6000 },
          );
        }
      }
      if (typeof onDone === 'function') await onDone();
      return { inserted };
    } catch (e) {
      if (typeof showLoadingOverlay === 'function') showLoadingOverlay('hide');
      console.warn('[backfill]', e);
      if (typeof notify === 'function') {
        notify('danger', '⚠️', 'Error', e?.message || String(e), { duration: 6000 });
      }
      return { inserted: 0, error: e };
    }
  }

  global.AppPosRepository = {
    applyLocalInventoryMovement,
    persistPosSale,
    syncStockToSupabase,
    applyPosSaleStockLinesAtomic,
    applyStockDecrementForLine,
    refreshArticuloStockFromSupabase,
    removeStockProductsPendingLine,
    pushStockProductsPendingLine,
    registerPosSaleSideEffects,
    restoreStockAfterPosAnulacion,
    registerPosAnulacionStockMoves,
    autoRegisterCustomer,
    netCantidadMovesDocProduct,
    backfillStockMovesFromFacturas,
  };
})(window);
