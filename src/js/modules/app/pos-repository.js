// POS persistence layer for DB sync and side effects.
(function initPosRepository(global) {
  /** Escritura hacia BD: siempre `qty` (canónico); opcional espejo `cantidad` durante transición schema. */
  function setStockMoveRowQty(row, value) {
    row.qty = value;
    if (global.STOCK_MOVES_DUAL_WRITE_QTY_CANTIDAD === true) {
      row.cantidad = value;
      return;
    }
    const col = typeof global.stockMovesQtyColumn === 'function' ? global.stockMovesQtyColumn() : 'qty';
    if (col !== 'qty') row[col] = value;
  }

  function insertedRowCantidadForState(row) {
    return typeof global.normalizeStockMoveQtyFromDbRow === 'function'
      ? global.normalizeStockMoveQtyFromDbRow(row)
      : Number(row.qty != null ? row.qty : row.cantidad ?? 0);
  }

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

  function isPosFacturaShape(f) {
    if (!f) return false;
    const t = String(f.tipo || '').toLowerCase();
    if (t === 'pos') return true;
    if (String(f.numero || '').toUpperCase().startsWith('POS-')) return true;
    return false;
  }

  /**
   * Antes de upsert a Supabase: items siempre como array de objetos (no string JSON);
   * ventas.invoice_id vía invoiceId = factura.id cuando es par POS (mismo id).
   */
  function preparePosSaleForPersist(factura, ventaRecord) {
    if (factura) {
      let raw = factura.items;
      if (typeof raw === 'string' && raw.trim()) {
        try {
          raw = JSON.parse(raw);
        } catch (_) {
          raw = [];
        }
      }
      if (!Array.isArray(raw)) raw = [];
      factura.items = raw.map((i) => {
        const o = i && typeof i === 'object' ? i : {};
        const q = o.qty != null ? o.qty : o.cantidad != null ? o.cantidad : 1;
        const p = o.precio != null ? o.precio : o.price != null ? o.price : 0;
        return {
          articuloId: o.articuloId || o.articulo_id || o.productId || o.product_id || o.id || '',
          nombre: o.nombre || o.name || '',
          talla: o.talla || '',
          qty: q,
          cantidad: o.cantidad != null ? o.cantidad : q,
          precio: p,
          price: o.price != null ? o.price : p,
        };
      });
    }
    if (
      factura &&
      ventaRecord &&
      String(factura.id) === String(ventaRecord.id) &&
      isPosFacturaShape(factura)
    ) {
      ventaRecord.invoiceId = String(factura.id).trim();
    }
  }

  /**
   * Transacción POS canónica V2: factura + venta + stock + caja + líneas en un solo RPC.
   * El consecutivo se reserva dentro de Postgres, por lo que dos terminales no pueden
   * reutilizar el mismo número. Si cualquier paso falla, Postgres revierte todo.
   */
  async function createPosSaleAtomicV2(ctx) {
    const o = ctx || {};
    const {
      state,
      cart,
      factura,
      ventaRecord,
      posFormState,
      supabaseClient,
      idGen,
    } = o;
    const nextId =
      typeof idGen === 'function'
        ? idGen
        : () => (global.AppId?.uuid ? global.AppId.uuid() : crypto.randomUUID());

    if (!supabaseClient || !factura || !ventaRecord || !Array.isArray(cart) || !cart.length) {
      return { ok: false, error: new Error('createPosSaleAtomicV2: contexto incompleto') };
    }

    if (String(factura.id) !== String(ventaRecord.id)) {
      return { ok: false, error: new Error('createPosSaleAtomicV2: factura y venta no comparten id') };
    }

    const bodegaId =
      posFormState?.bodegaId ||
      global.AppCajaLogic?.getPosBodegaId?.() ||
      'bodega_main';
    const cajaPreferida =
      posFormState?.cajaId ||
      global.AppCajaLogic?.getPosCajaId?.() ||
      '';
    const caja =
      global.AppCajaLogic?.resolveCajaForPos?.(state, bodegaId, cajaPreferida) ||
      (state.cajas || []).find((c) => c.estado === 'abierta');

    if (!caja) {
      return { ok: false, error: new Error('No hay una caja abierta enlazada a la bodega') };
    }

    global.AppCajaLogic?.normalizeCaja?.(caja);
    const total = Number(factura.total) || 0;
    const metodo = String(posFormState?.metodo || factura.metodo || 'efectivo');
    const movements = [];

    if (metodo === 'mixto') {
      const efectivo = Math.max(0, Number(posFormState?.mixtoEfectivo) || 0);
      const transferencia = Math.max(0, Number(posFormState?.mixtoTransferencia) || 0);
      if (efectivo > 0) {
        movements.push({
          id: nextId(),
          value: efectivo,
          bucket: 'efectivo',
          method: 'efectivo',
          concept: '',
        });
      }
      if (transferencia > 0) {
        movements.push({
          id: nextId(),
          value: transferencia,
          bucket: 'transferencia',
          method: 'transferencia',
          concept: '',
        });
      }
    } else {
      movements.push({
        id: nextId(),
        value: total,
        bucket:
          global.AppCajaLogic?.resolvePosSaleBucket?.(posFormState, state) ||
          'efectivo',
        method: metodo,
        // Vacío: el RPC compone el concepto con el consecutivo reservado en BD.
        concept: '',
      });
    }

    const operationId = nextId();
    const request = {
      operation_id: operationId,
      source_document_id: o.sourceDocumentId || null,
      invoice: {
        id: factura.id,
        fecha: factura.fecha,
        customer_name: factura.cliente || '',
        customer_phone: factura.telefono || '',
        subtotal: Number(factura.subtotal) || 0,
        iva: Number(factura.iva) || 0,
        flete: Number(factura.flete) || 0,
        total,
        canal: factura.canal || 'vitrina',
        metodo_pago: metodo,
        guia: factura.guia || '',
        empresa: factura.empresa || '',
        transportadora: factura.transportadora || '',
        ciudad: factura.ciudad || '',
        direccion: factura.direccion || '',
        cedula_cliente: factura.cedulaCliente || '',
        comprobante: factura.comprobante || '',
        es_separado: !!factura.esSeparado,
        tipo_pago: factura.tipoPago || ventaRecord.tipoPago || 'contado',
      },
      sale: {
        id: ventaRecord.id,
        invoice_id: factura.id,
        canal: ventaRecord.canal || factura.canal || 'vitrina',
        cliente: ventaRecord.cliente || '',
        telefono: ventaRecord.telefono || '',
        guia: ventaRecord.guia || '',
        empresa: ventaRecord.empresa || '',
        transportadora: ventaRecord.transportadora || '',
        ciudad: ventaRecord.ciudad || '',
        direccion: ventaRecord.direccion || '',
        cedula_cliente: ventaRecord.cedulaCliente || '',
        comprobante: ventaRecord.comprobante || '',
        liquidado: !!ventaRecord.liquidado,
        fecha_liquidacion: ventaRecord.fechaLiquidacion || null,
        es_separado: !!ventaRecord.esSeparado,
        estado_entrega: ventaRecord.estadoEntrega || 'Pendiente',
        metodo_pago: metodo,
        tipo_pago: ventaRecord.tipoPago || 'contado',
        es_contraentrega: !!ventaRecord.esContraEntrega,
      },
      lines: cart.map((item) => ({
        product_id: item.articuloId,
        name: item.nombre || '',
        size: item.talla || '',
        qty: Math.abs(parseInt(item.qty, 10) || 0),
        unit_price: Number(item.precio) || 0,
        bodega_id: bodegaId,
        move_id: nextId(),
        note: `${item.nombre || 'Ítem'} · Talla: ${item.talla || '—'}`,
      })),
      cash: {
        caja_id: caja.id,
        session_id: caja.sesionActivaId || null,
        movements,
      },
    };


    let data = null;
    let error = null;
    try {
      const result = await supabaseClient.rpc('create_pos_sale_v2', {
        p_request: request,
      });
      data = result.data;
      error = result.error;
    } catch (e) {
      error = e;
    }


    if (error || !data?.ok) {
      return { ok: false, error: error || new Error('La transacción POS no fue confirmada') };
    }

    return {
      ok: true,
      data,
      request,
      caja,
    };
  }

  /**
   * Anula una venta POS con `cancel_pos_sale_v2`: devuelve stock, revierte el
   * ingreso en caja y marca la factura como anulada en una sola transacción.
   * Si algo falla no queda nada aplicado a medias.
   */
  async function cancelPosSaleAtomicV2(ctx) {
    const o = ctx || {};
    const { factura, supabaseClient, idGen } = o;
    const nextId =
      typeof idGen === 'function'
        ? idGen
        : () => (global.AppId?.uuid ? global.AppId.uuid() : crypto.randomUUID());

    if (!supabaseClient || !factura || !factura.id) {
      return { ok: false, error: new Error('cancelPosSaleAtomicV2: contexto incompleto') };
    }

    const request = {
      operation_id: nextId(),
      invoice_id: String(factura.id),
      reason: String(o.reason || '').trim() || 'Anulación desde POS',
    };

    let data = null;
    let error = null;
    try {
      const result = await supabaseClient.rpc('cancel_pos_sale_v2', { p_request: request });
      data = result.data;
      error = result.error;
    } catch (e) {
      error = e;
    }

    if (error || !data?.ok) {
      return { ok: false, error: error || new Error('La anulación no fue confirmada') };
    }

    return { ok: true, data, request };
  }

  /**
   * Cobra una factura manual con `pay_manual_invoice_v1`: ingreso en caja ligado a la
   * factura, líneas de venta y estado 'pagada' en una sola transacción.
   */
  async function payManualInvoiceV1(ctx) {
    const o = ctx || {};
    const { state, factura, supabaseClient, idGen } = o;
    const nextId =
      typeof idGen === 'function'
        ? idGen
        : () => (global.AppId?.uuid ? global.AppId.uuid() : crypto.randomUUID());

    if (!supabaseClient || !factura || !factura.id) {
      return { ok: false, error: new Error('payManualInvoiceV1: contexto incompleto') };
    }

    const caja =
      (state?.cajas || []).find((c) => String(c.id) === String(o.cajaId)) ||
      global.AppCajaLogic?.resolveCajaForPos?.(state, 'bodega_main', '') ||
      (state?.cajas || []).find((c) => c.estado === 'abierta');
    if (!caja) {
      return { ok: false, error: new Error('No hay una caja abierta para registrar el cobro') };
    }

    const bucket = String(o.bucket || 'efectivo');
    const request = {
      operation_id: nextId(),
      invoice_id: String(factura.id),
      caja_id: caja.id,
      session_id: caja.sesionActivaId || null,
      bucket,
      method: String(o.metodo || bucket),
    };

    let data = null;
    let error = null;
    try {
      const result = await supabaseClient.rpc('pay_manual_invoice_v1', { p_request: request });
      data = result.data;
      error = result.error;
    } catch (e) {
      error = e;
    }

    if (error || !data?.ok) {
      return { ok: false, error: error || new Error('El cobro no fue confirmado') };
    }

    return { ok: true, data, caja };
  }

  /**
   * Descuenta stock en products solo para líneas que ya tienen movimiento registrado.
   * Usado por herramientas de reparación de stock pendiente.
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
    const col = typeof qtyCol === 'string' && qtyCol.trim() ? qtyCol.trim() : 'qty';
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
          cantidad: insertedRowCantidadForState(m),
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
   * Suma firmada en estado local (venta_pos) por factura + producto.
   * En memoria el campo numérico suele ser `cantidad` (relleno desde qty/cantidad BD vía normalize al cargar).
   */
  function netCantidadMovesDocProduct(state, documentoId, productId) {
    if (!documentoId || !productId) return 0;
    const norm =
      typeof global.normalizeStockMoveQtyFromDbRow === 'function'
        ? global.normalizeStockMoveQtyFromDbRow
        : (row) => parseFloat(row.cantidad != null ? row.cantidad : row.qty) || 0;
    return (state.stock_moves_ventas || [])
      .filter(
        (m) =>
          String(m.documentoId) === String(documentoId) && String(m.productId) === String(productId),
      )
      .reduce((s, m) => s + norm({ qty: m.qty, cantidad: m.cantidad, quantity: m.quantity }), 0);
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
      .select('*')
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
          const pid =
            typeof global.articuloIdFromInvoiceItem === 'function'
              ? global.articuloIdFromInvoiceItem(it)
              : String(it.articuloId || it.articulo_id || it.productId || it.product_id || it.id || '');
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
          setStockMoveRowQty(row, delta);
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
            cantidad: insertedRowCantidadForState(row),
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

  // ===========================================================================
  // sale_items — capa canónica de líneas de venta (NO descuenta stock ni caja).
  // Convive con invoices.items / ventas / stock_moves; solo para reportes.
  // ===========================================================================

  /** Normaliza un trozo de clave: trim + colapsa espacios + minúsculas. */
  function normLineKeyPart(v) {
    return String(v == null ? '' : v)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Clave determinista e idempotente de una línea de venta.
   * NO incluye `source`: así una línea escrita por POS no se duplica al hacer backfill.
   * Si falta product_id cae a product_name (filas históricas sin id).
   * Incluye `unitPrice` y `lineIndex` (posición dentro de la factura) para no fusionar
   * dos líneas del mismo producto+talla en una misma factura (precio distinto o repetidas).
   * Idempotente: POS y backfill recorren el mismo `invoices.items` en el mismo orden.
   */
  function computeSaleLineKey(parts) {
    const p = parts || {};
    const invoiceId = normLineKeyPart(p.invoiceId);
    const productId = normLineKeyPart(p.productId);
    const talla = normLineKeyPart(p.talla);
    const productName = normLineKeyPart(p.productName);
    const unitPrice = normLineKeyPart(p.unitPrice);
    const lineIndex = normLineKeyPart(p.lineIndex);
    return [invoiceId, productId || `name:${productName}`, talla, unitPrice, lineIndex].join('|');
  }

  /** ISO seguro a partir de una fecha `YYYY-MM-DD` (mediodía local, sin hora real). */
  function fechaToNoonIso(fecha) {
    const d = String(fecha || '').split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d}T12:00:00`;
    return new Date().toISOString();
  }

  /**
   * Construye filas para `sale_items` a partir de un encabezado (factura/venta)
   * y una lista de ítems (factura.items o invoices.items). Puro: no toca BD.
   * @returns {Array<object>} filas listas para upsert.
   */
  function buildSaleItemRows(ctx) {
    const o = ctx || {};
    const factura = o.factura || {};
    const ventaRecord = o.ventaRecord || {};
    const source = o.source || 'pos';
    const invoiceId = String(factura.id != null ? factura.id : (ventaRecord.invoiceId || ventaRecord.id || '')).trim();
    const saleId = String(ventaRecord.id != null ? ventaRecord.id : factura.id || '').trim();
    const fecha = (factura.fecha || ventaRecord.fecha || '').toString().split('T')[0] || null;
    // POS: hora exacta del evento; backfill/histórico: mediodía del día (sin hora real).
    const fechaHora = source === 'pos' ? new Date().toISOString() : fechaToNoonIso(fecha);

    let items = Array.isArray(o.items) ? o.items : factura.items;
    if (typeof items === 'string' && items.trim()) {
      try { items = JSON.parse(items); } catch (_) { items = []; }
    }
    if (!Array.isArray(items)) items = [];

    const idFromItem = typeof global.articuloIdFromInvoiceItem === 'function'
      ? global.articuloIdFromInvoiceItem
      : (it) => String((it && (it.articuloId || it.articulo_id || it.productId || it.product_id || it.id)) || '');

    const nextId = typeof o.idGen === 'function'
      ? o.idGen
      : () => (global.AppId?.uuid ? global.AppId.uuid() : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()));

    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] && typeof items[i] === 'object' ? items[i] : {};
      const productId = idFromItem(it);
      const productName = it.nombre || it.name || '';
      const talla = it.talla || '';
      const qty = Math.abs(Number(it.qty != null ? it.qty : (it.cantidad != null ? it.cantidad : 0))) || 0;
      const unitPrice = Number(it.precio != null ? it.precio : (it.price != null ? it.price : 0)) || 0;
      if (qty <= 0 && !productId && !productName) continue;
      const meta = {};
      if (!productId) meta.missing_product_id = true;
      rows.push({
        id: nextId(),
        sale_id: saleId || null,
        invoice_id: invoiceId || null,
        invoice_number: factura.numero || ventaRecord.desc || null,
        product_id: productId || null,
        product_ref: it.product_ref || it.ref || it.codigo || null,
        product_name: productName || null,
        talla: talla || null,
        qty,
        unit_price: unitPrice,
        subtotal: qty * unitPrice,
        canal: factura.canal || ventaRecord.canal || null,
        cliente_nombre: factura.cliente || ventaRecord.cliente || null,
        cliente_telefono: factura.telefono || ventaRecord.telefono || null,
        fecha: fecha || null,
        fecha_hora: fechaHora,
        source,
        line_key: computeSaleLineKey({ invoiceId, productId, talla, productName, unitPrice, lineIndex: i }),
        meta,
      });
    }
    return rows;
  }

  /**
   * Persiste líneas en `sale_items` (upsert idempotente por `line_key`).
   * NO debe bloquear la venta: el caller lo invoca en try/catch aislado.
   * @returns {{ok:boolean, inserted:number, error?:any}}
   */
  async function persistSaleItems(ctx) {
    const o = ctx || {};
    const supabaseClient = o.supabaseClient;
    if (!supabaseClient) return { ok: false, inserted: 0, error: new Error('persistSaleItems: sin supabaseClient') };
    const rows = Array.isArray(o.rows) ? o.rows : buildSaleItemRows(o);
    if (rows.length === 0) return { ok: true, inserted: 0 };
    try {
      const { error } = await supabaseClient
        .from('sale_items')
        .upsert(rows, { onConflict: 'line_key', ignoreDuplicates: true });
      if (error) return { ok: false, inserted: 0, error };
      return { ok: true, inserted: rows.length };
    } catch (e) {
      return { ok: false, inserted: 0, error: e };
    }
  }

  /**
   * Backfill idempotente: crea `sale_items` faltantes a partir de `invoices.items`.
   * No toca stock, caja, ventas ni invoices. Re-ejecutable sin duplicar (line_key).
   */
  async function backfillSaleItemsFromInvoices(ctx) {
    const o = ctx || {};
    const state = o.state || {};
    const supabaseClient = o.supabaseClient;
    const sbConnected = o.sbConnected;
    const notify = o.notify;
    const showLoadingOverlay = o.showLoadingOverlay;
    if (!sbConnected || !supabaseClient) {
      if (typeof notify === 'function') {
        notify('warning', '📡', 'Sin conexión', 'Conecta Supabase para rellenar sale_items.', { duration: 4000 });
      }
      return { inserted: 0 };
    }
    const facturas = Array.isArray(state.facturas) ? state.facturas : [];
    const ventasById = new Map((state.ventas || []).map((v) => [String(v.id), v]));
    let allRows = [];
    try {
      if (typeof showLoadingOverlay === 'function') showLoadingOverlay('connecting');
      for (let fi = 0; fi < facturas.length; fi++) {
        const f = facturas[fi];
        if (!f || f.estado === 'anulada') continue;
        // Tolera `items` como array o como string JSON (algunas facturas históricas lo guardan serializado).
        let items = f.items;
        if (typeof items === 'string' && items.trim()) {
          try { items = JSON.parse(items); } catch (_) { items = []; }
        }
        if (!Array.isArray(items)) items = [];
        if (items.length === 0) continue;
        const ventaRecord = ventasById.get(String(f.id)) || { id: f.id, invoiceId: f.id };
        const rows = buildSaleItemRows({
          factura: f,
          ventaRecord,
          items,
          source: 'backfill_invoices_items',
        });
        if (rows.length) allRows = allRows.concat(rows);
      }
      let inserted = 0;
      let lastError = '';
      // Lotes de 200 para no exceder límites de payload.
      for (let i = 0; i < allRows.length; i += 200) {
        const chunk = allRows.slice(i, i + 200);
        const res = await persistSaleItems({ supabaseClient, rows: chunk });
        if (res.ok) inserted += res.inserted;
        else lastError = res.error?.message || String(res.error);
      }
      if (typeof showLoadingOverlay === 'function') showLoadingOverlay('hide');
      if (typeof notify === 'function') {
        if (lastError && /row-level security|RLS|permission denied|42501|relation .* does not exist|sale_items/i.test(lastError) && inserted === 0) {
          notify('danger', '🧾', 'sale_items bloqueado', `No se pudieron insertar líneas: ${lastError}. Verifica que la migración 20260531_sales_items_canonical_v1.sql esté aplicada (tabla + RLS).`, { duration: 12000 });
        } else {
          notify('success', '🧾', 'sale_items', inserted ? `Se sincronizaron ${inserted} línea(s) en sale_items (idempotente; re-correr no duplica).` : 'No había líneas nuevas: sale_items ya estaba al día.', { duration: 6000 });
        }
      }
      if (typeof o.onDone === 'function') await o.onDone();
      return { inserted };
    } catch (e) {
      if (typeof showLoadingOverlay === 'function') showLoadingOverlay('hide');
      console.warn('[backfill sale_items]', e);
      if (typeof notify === 'function') notify('danger', '⚠️', 'Error', e?.message || String(e), { duration: 6000 });
      return { inserted: 0, error: e };
    }
  }

  // ===========================================================================
  // Helpers puros de reporte sobre sale_items (state.saleItems). Sin UI ni BD.
  // ===========================================================================

  /** Extrae el día `YYYY-MM-DD` de una fila (usa fecha; cae a fecha_hora). */
  function saleItemDay(row) {
    if (!row) return '';
    if (row.fecha) return String(row.fecha).split('T')[0];
    if (row.fechaHora) return String(row.fechaHora).split('T')[0];
    return '';
  }

  /** `HH:MM` desde fecha_hora (vacío si no hay). */
  function saleItemTime(row) {
    if (!row || !row.fechaHora) return '';
    const m = String(row.fechaHora).match(/T(\d{2}:\d{2})/);
    return m ? m[1] : '';
  }

  /** Filtra por rango de día inclusive [desde, hasta] (`YYYY-MM-DD`; cualquiera opcional). */
  function filterSaleItemsByFecha(rows, desde, hasta) {
    const list = Array.isArray(rows) ? rows : [];
    return list.filter((r) => {
      const d = saleItemDay(r);
      if (!d) return false;
      if (desde && d < desde) return false;
      if (hasta && d > hasta) return false;
      return true;
    });
  }

  /** Filtra por rango de hora inclusive [desde, hasta] (`HH:MM`); ignora filas sin fecha_hora. */
  function filterSaleItemsByHora(rows, desde, hasta) {
    const list = Array.isArray(rows) ? rows : [];
    return list.filter((r) => {
      const t = saleItemTime(r);
      if (!t) return false;
      if (desde && t < desde) return false;
      if (hasta && t > hasta) return false;
      return true;
    });
  }

  /** Filtra por cliente (subcadena en nombre o teléfono, case-insensitive). */
  function filterSaleItemsByCliente(rows, query) {
    const q = normLineKeyPart(query);
    const list = Array.isArray(rows) ? rows : [];
    if (!q) return list.slice();
    return list.filter((r) =>
      normLineKeyPart(r.clienteNombre).includes(q) || normLineKeyPart(r.clienteTelefono).includes(q),
    );
  }

  /** Filtra por artículo: product_id exacto o subcadena en nombre/ref. */
  function filterSaleItemsByProducto(rows, query) {
    const q = normLineKeyPart(query);
    const list = Array.isArray(rows) ? rows : [];
    if (!q) return list.slice();
    return list.filter((r) =>
      normLineKeyPart(r.productId) === q ||
      normLineKeyPart(r.productName).includes(q) ||
      normLineKeyPart(r.productRef).includes(q),
    );
  }

  /** Filtra por canal exacto (vitrina/local/inter). */
  function filterSaleItemsByCanal(rows, canal) {
    const c = normLineKeyPart(canal);
    const list = Array.isArray(rows) ? rows : [];
    if (!c) return list.slice();
    return list.filter((r) => normLineKeyPart(r.canal) === c);
  }

  /**
   * Excluye líneas cuyas facturas estén anuladas. Las filas `sale_items` se escriben
   * al vender y NO se eliminan ni compensan al anular; por eso TODO reporte sobre
   * `state.saleItems` debe cruzar contra `state.facturas` para no contar anuladas.
   * @param {Array<object>} rows  state.saleItems (cada fila con `invoiceId`)
   * @param {Array<object>} facturas  state.facturas (con `id` y `estado`)
   */
  function filterSaleItemsExcluyendoAnuladas(rows, facturas, opts) {
    const o = opts || {};
    const list = Array.isArray(rows) ? rows : [];
    const excluidas = new Set(
      (Array.isArray(facturas) ? facturas : [])
        .filter((f) => {
          if (!f) return false;
          if (f.estado === 'anulada' && o.includeAnuladas !== true) return true;
          // Una factura manual en borrador todavía no se cobró: contarla inflaba
          // Consolidado frente a Facturas y Trazabilidad.
          if (f.estado === 'borrador' && o.includeBorradores !== true) return true;
          return false;
        })
        .map((f) => String(f.id)),
    );
    if (excluidas.size === 0) return list.slice();
    return list.filter((r) => !excluidas.has(String(r && r.invoiceId)));
  }

  /**
   * Punto ÚNICO para obtener filas de reporte sobre sale_items.
   * IMPORTANTE: sale_items NO se borra al anular una factura; por eso, por defecto,
   * este helper EXCLUYE las líneas de facturas anuladas (cruza por `invoiceId` contra
   * `state.facturas`). Todo reporte futuro sobre sale_items debe pasar por aquí.
   * También excluye las facturas manuales en borrador, que aún no se han cobrado.
   * Usa `{ includeAnuladas: true }` o `{ includeBorradores: true }` para contarlas.
   * Tolera `state.saleItems` / `state.facturas` vacíos o inexistentes.
   * @param {object} state  estado global (usa state.saleItems y state.facturas)
   * @param {{includeAnuladas?:boolean, includeBorradores?:boolean}} [options]
   * @returns {Array<object>} copia de las filas (no muta el estado)
   */
  function getSaleItemsReportRows(state, options) {
    const o = options || {};
    const s = state || {};
    const rows = Array.isArray(s.saleItems) ? s.saleItems : [];
    if (o.includeAnuladas === true && o.includeBorradores === true) return rows.slice();
    return filterSaleItemsExcluyendoAnuladas(rows, Array.isArray(s.facturas) ? s.facturas : [], o);
  }

  global.AppSaleItemsReports = {
    saleItemDay,
    saleItemTime,
    filterByFecha: filterSaleItemsByFecha,
    filterByHora: filterSaleItemsByHora,
    filterByCliente: filterSaleItemsByCliente,
    filterByProducto: filterSaleItemsByProducto,
    filterByCanal: filterSaleItemsByCanal,
    excluirAnuladas: filterSaleItemsExcluyendoAnuladas,
    getReportRows: getSaleItemsReportRows,
  };

  global.AppPosRepository = {
    preparePosSaleForPersist,
    isPosFacturaShape,
    applyLocalInventoryMovement,
    createPosSaleAtomicV2,
    cancelPosSaleAtomicV2,
    payManualInvoiceV1,
    computeSaleLineKey,
    buildSaleItemRows,
    persistSaleItems,
    backfillSaleItemsFromInvoices,
    applyPosSaleStockLinesAtomic,
    applyStockDecrementForLine,
    refreshArticuloStockFromSupabase,
    removeStockProductsPendingLine,
    pushStockProductsPendingLine,
    autoRegisterCustomer,
    netCantidadMovesDocProduct,
    backfillStockMovesFromFacturas,
  };
})(window);
