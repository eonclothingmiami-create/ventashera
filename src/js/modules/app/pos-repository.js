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

  async function syncStockToSupabase(state, cart, supabaseClient, sbConnected) {
    if (!sbConnected || !supabaseClient) return;
    for (const item of cart) {
      const art = (state.articulos || []).find((a) => a.id === item.articuloId);
      if (!art) continue;
      const ns = Math.max(0, (art.stock || 0) - item.qty);
      const { error } = await supabaseClient.from('products').update({ stock: ns }).eq('id', item.articuloId);
      if (error) throw error;
      art.stock = ns;
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
          documento_id: factura?.id || null,
          fecha: fechaActual,
          nota: `${item.nombre || 'Ítem'} · Talla: ${item.talla || '—'}`
        };
        row[qtyCol] = -qty;
        const { error } = await supabaseClient.from('stock_moves').insert(row);
        if (error) {
          console.warn('[POS] stock_moves insert:', error.message, row);
          if (typeof notify === 'function') {
            notify('warning', '📦', 'stock_moves', `Línea no registrada: ${error.message}`, { duration: 5000 });
          }
        } else {
          // Misma forma que loadState → calcDeudaProveedor (vendido POS) sin recargar página.
          if (!Array.isArray(state.stock_moves_ventas)) state.stock_moves_ventas = [];
          state.stock_moves_ventas.push({
            id: row.id,
            productId: pid,
            cantidad: Number(row[qtyCol]),
            tipo: 'venta_pos',
            fecha: fechaActual,
            referencia: numFactura || '',
            documentoId: factura?.id || null
          });
        }
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
    const bucket = global.AppCajaLogic?.resolvePosSaleBucket?.(posFormState, state) || 'efectivo';
    if (global.AppCajaLogic?.applyDeltaBucket) global.AppCajaLogic.applyDeltaBucket(caja, bucket, total);
    else caja.saldo = (parseFloat(caja.saldo) || 0) + total;

    const metodo = (posFormState && posFormState.metodo) ? posFormState.metodo : 'efectivo';
    const concepto = buildPosIngresoConcepto(numFactura, cart);
    const mov = {
      id: nextId(),
      cajaId: caja.id,
      tipo: 'ingreso',
      valor: total,
      concepto,
      fecha: fechaActual,
      metodo,
      categoria: 'venta_pos',
      bucket
    };
    global.AppCajaLogic?.enrichMovWithSesion?.(state, caja.id, mov, nextId);
    if (!Array.isArray(state.tes_movimientos)) state.tes_movimientos = [];
    state.tes_movimientos.push(mov);

    const okCaja = await saveRecord('cajas', caja.id, caja);
    const okMov = await saveRecord('tes_movimientos', mov.id, mov);
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
      const ns = (art.stock || 0) + qty;
      const { error } = await supabaseClient.from('products').update({ stock: ns }).eq('id', pid);
      if (error) console.warn('[POS] restore stock anulación:', error.message);
      else art.stock = ns;
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

  global.AppPosRepository = {
    applyLocalInventoryMovement,
    persistPosSale,
    syncStockToSupabase,
    registerPosSaleSideEffects,
    restoreStockAfterPosAnulacion,
    registerPosAnulacionStockMoves,
    autoRegisterCustomer
  };
})(window);
