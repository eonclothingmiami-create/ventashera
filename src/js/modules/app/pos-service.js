// POS domain service layer with pure operations.
(function initPosService(global) {
  function ensurePosCart(state) {
    if (!Array.isArray(state.pos_cart)) state.pos_cart = [];
    return state.pos_cart;
  }

  function addToCart(ctx) {
    const { state, artId, talla = 'Única', getArticuloStock, notify } = ctx;
    const art = (state.articulos || []).find((a) => a.id === artId);
    if (!art) return { ok: false, reason: 'not_found' };

    const stock = getArticuloStock(artId);
    const cart = ensurePosCart(state);
    const inCart = cart.find((c) => c.articuloId === artId && c.talla === talla);
    const currentQty = inCart ? inCart.qty : 0;
    if (currentQty >= stock) {
      notify('warning', '⚠️', 'Sin stock', 'No hay suficiente inventario.', { duration: 3000 });
      return { ok: false, reason: 'no_stock' };
    }

    if (inCart) inCart.qty += 1;
    else {
      cart.push({
        articuloId: artId,
        nombre: art.nombre,
        precio: art.precioVenta,
        qty: 1,
        categoria: art.categoria,
        talla
      });
    }
    return { ok: true };
  }

  function updateCartQty(state, idx, delta) {
    const cart = ensurePosCart(state);
    if (!cart[idx]) return false;
    cart[idx].qty += delta;
    if (cart[idx].qty <= 0) cart.splice(idx, 1);
    return true;
  }

  function removeCartItem(state, idx) {
    const cart = ensurePosCart(state);
    if (!cart[idx]) return false;
    cart.splice(idx, 1);
    return true;
  }

  function clearCart(state) {
    state.pos_cart = [];
  }

  function buildPosDocuments(ctx) {
    const {
      state,
      posFormState,
      today,
      getNextConsec,
      uid,
      dbId,
      addBusinessDays,
      esSeparado
    } = ctx;
    const cart = ensurePosCart(state);
    const canal = posFormState.canal;
    const subtotal = cart.reduce((a, item) => a + (item.precio * item.qty), 0);
    const iva = posFormState.applyIva ? subtotal * 0.19 : 0;
    const flete =
      canal === 'local'
        ? parseFloat(posFormState.flete) || 0
        : posFormState.applyFlete && canal === 'inter'
          ? parseFloat(posFormState.flete) || 0
          : 0;
    const total = subtotal + iva + flete;
    const numFactura = 'POS-' + getNextConsec('factura');
    const fechaActual = today();
    const nextUuid =
      (typeof dbId === 'function' && dbId) ||
      (global.AppId && typeof global.AppId.uuid === 'function' ? () => global.AppId.uuid() : null) ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? () => crypto.randomUUID() : null) ||
      uid;
    const posDocId = nextUuid();

    const factura = {
      id: posDocId,
      numero: numFactura,
      fecha: fechaActual,
      cliente: posFormState.cliente,
      telefono: posFormState.telefono,
      items: cart.map((c) => ({ ...c })),
      subtotal,
      iva,
      flete,
      total,
      metodo: posFormState.metodo,
      estado: 'pagada',
      tipo: 'pos',
      canal,
      guia: posFormState.guia,
      empresa: posFormState.empresa,
      transportadora: posFormState.transportadora,
      ciudad: posFormState.ciudad,
      direccion: posFormState.direccion || '',
      cedulaCliente: posFormState.cedula || '',
      comprobante: posFormState.comprobante || '',
      esSeparado
    };

    const tipoPago = (canal === 'vitrina') ? 'contado' : (posFormState.tipoPago || 'contado');
    const esContraEntrega = tipoPago === 'contraentrega';
    const liquidadoInicial = canal === 'vitrina' || tipoPago === 'contado';
    const fechaLiq = liquidadoInicial ? fechaActual : addBusinessDays(fechaActual, canal === 'local' ? (state.diasLocal || 1) : (state.diasInter || 5));

    const ventaRecord = {
      id: factura.id,
      fecha: fechaActual,
      canal,
      valor: total,
      cliente: posFormState.cliente,
      telefono: posFormState.telefono,
      guia: posFormState.guia,
      empresa: posFormState.empresa,
      transportadora: posFormState.transportadora,
      ciudad: posFormState.ciudad,
      direccion: posFormState.direccion || '',
      cedulaCliente: posFormState.cedula || '',
      comprobante: posFormState.comprobante || '',
      liquidado: liquidadoInicial,
      fechaLiquidacion: fechaLiq,
      esContraEntrega,
      tipoPago,
      esSeparado,
      estadoEntrega: 'Pendiente',
      fechaHoraEntrega: null,
      desc: numFactura,
      metodoPago: posFormState.metodo
    };

    return { cart, canal, subtotal, iva, flete, total, numFactura, fechaActual, factura, ventaRecord };
  }

  global.AppPosService = {
    addToCart,
    updateCartQty,
    removeCartItem,
    clearCart,
    buildPosDocuments
  };
})(window);
