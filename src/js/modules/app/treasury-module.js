// Treasury module: pagos proveedores, cajas, movimientos y colecciones simples.
(function initTreasuryModule(global) {
  /** Contexto del modal de cargo CXP (líneas por artículo). */
  let _cargoModalCtx = null;
  /** Contexto del modal de compromiso / nota en libro (líneas por artículo). */
  let _compromisoModalCtx = null;
  let _tesDineroRango = { desde: null, hasta: null };
  let _lastTesDineroCtx = null;

  function normFechaMov(f) {
    if (f == null || f === '') return '';
    const s = String(f);
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  /**
   * Regla de negocio: en este módulo solo cuentan artículos marcados como mercancía a crédito
   * (`titulo_mercancia`) y vinculados al proveedor. Misma semántica que `esMercanciaCredito` en repository
   * (normalización de texto, sin relajar el criterio).
   */
  function esMercCreditoTitulo(tituloMercancia) {
    return typeof global.esMercanciaCredito === 'function'
      ? global.esMercanciaCredito(tituloMercancia)
      : String(tituloMercancia || '')
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') === 'credito';
  }

  /**
   * Marca en `tes_abonos_prov.nota` para deuda explícita por entrada de inventario a crédito.
   * `calcDeudaProveedor` resta el mismo monto de stock×costo para no duplicar con el abono negativo.
   */
  const CXPIV_ABONO_MARKER = '[cxp:inv_entrada]';

  function sumInvEntradaCreditoAbonosAbs(state, provId) {
    return (state.tes_abonos_prov || [])
      .filter(
        (ab) =>
          String(ab.proveedorId) === String(provId) &&
          parseFloat(ab.valor) < 0 &&
          String(ab.nota || '').includes(CXPIV_ABONO_MARKER)
      )
      .reduce((s, ab) => s + Math.abs(parseFloat(ab.valor) || 0), 0);
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

  /**
   * Venta asociada a un movimiento `stock_moves_ventas`: prioriza `documentoId` (factura/venta),
   * luego `referencia` (número POS). Así se leen canal, empresa (ej. sucursal) y cliente en Pagos proveedores.
   */
  function ventaFromStockMovePos(state, m) {
    if (!m) return null;
    if (m.documentoId) {
      const vid = String(m.documentoId);
      const direct = (state.ventas || []).find((x) => String(x.id) === vid);
      if (direct) return direct;
      const f = (state.facturas || []).find((x) => String(x.id) === vid);
      if (f) {
        const byFactId = (state.ventas || []).find((x) => String(x.id) === String(f.id));
        if (byFactId) return byFactId;
        const byNum = resolveVentaForPosRef(state, f.numero);
        if (byNum) return byNum;
      }
    }
    return resolveVentaForPosRef(state, m.referencia);
  }

  function ventaMetaFromStockMovePos(state, m) {
    const v = ventaFromStockMovePos(state, m);
    const refShow = v ? String(v.desc || m.referencia || '—') : String(m.referencia || '—');
    const canal = v && v.canal ? String(v.canal) : '';
    const empresa = v && v.empresa ? String(v.empresa) : '';
    const cliente = v && v.cliente ? String(v.cliente) : '';
    return { refShow, canal, empresa, cliente };
  }

  function canalVentaPos(state, m) {
    if (m.categoria !== 'venta_pos' || m.tipo !== 'ingreso') return null;
    const ref = parsePosRefFromConcepto(m.concepto);
    if (!ref) return null;
    const v = resolveVentaForPosRef(state, ref);
    return v && v.canal ? v.canal : null;
  }

  /** Libro CXP (cuenta por pagar): saldo oficial = sum(cargos) − sum(créditos). */
  function sumCxpProveedor(state, provId) {
    const rows = (state.tes_cxp_movimientos || []).filter((r) => String(r.proveedorId) === String(provId));
    let cargo = 0;
    let credito = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const m = parseFloat(r.monto) || 0;
      if (r.naturaleza === 'cargo') cargo += m;
      else credito += m;
    }
    const net = cargo - credito;
    return {
      cargo,
      credito,
      saldoOficial: Math.max(0, net),
      count: rows.length,
      hayCxp: rows.length > 0
    };
  }

  /** Solo movimientos ya cargados en `state.stock_moves_ventas` (tipo venta_pos en BD). */
  function articuloUnidadesVendidasPosMoves(state, artId) {
    let u = 0;
    (state.stock_moves_ventas || []).forEach((m) => {
      if (String(m.productId) !== String(artId)) return;
      u +=
        typeof global.unidadesVentaPosAbs === 'function'
          ? global.unidadesVentaPosAbs(m)
          : Math.abs(parseFloat(m.cantidad) || 0);
    });
    return u;
  }

  /**
   * Complemento de unidades desde facturas POS vs `stock_moves` en estado (misma idea que backfill «POS moves»).
   * - |net| ≈ 0 → cuenta toda la cantidad de la factura para ese producto.
   * - net &lt; 0 → suma solo lo que falta respecto al neto de movimientos: max(0, qtyNeed + net), para no quedar en 0
   *   cuando hay movimientos parciales o cantidad mal guardada en BD.
   * Las unidades ya reflejadas en movimientos siguen contando en `articuloUnidadesVendidasPosMoves`; aquí solo el hueco.
   */
  function unidadesFacturasPosSinStockMoveEnEstado(state, artId) {
    const netFn =
      global.AppPosRepository && typeof global.AppPosRepository.netCantidadMovesDocProduct === 'function'
        ? global.AppPosRepository.netCantidadMovesDocProduct
        : null;
    if (!netFn) return 0;
    const aid = String(artId);
    let sum = 0;
    const facturas = state.facturas || [];
    for (let fi = 0; fi < facturas.length; fi++) {
      const f = facturas[fi];
      if (!f || f.estado === 'anulada') continue;
      const tipo = (f.tipo || 'pos').toLowerCase();
      if (tipo !== 'pos') continue;
      const docId = f.id;
      if (!docId) continue;
      let items = f.items;
      if (typeof items === 'string' && items.trim()) {
        try {
          items = JSON.parse(items);
        } catch (_) {
          items = [];
        }
      }
      if (!Array.isArray(items)) items = [];
      let qtyNeed = 0;
      for (let ii = 0; ii < items.length; ii++) {
        const it = items[ii];
        const pid =
          typeof global.articuloIdFromInvoiceItem === 'function'
            ? global.articuloIdFromInvoiceItem(it)
            : String(it.articuloId ?? it.articulo_id ?? it.productId ?? it.product_id ?? it.id ?? '');
        if (!pid || String(pid) !== aid) continue;
        const q = Math.abs(parseInt(it.qty, 10) || parseFloat(it.cantidad) || 0);
        if (q > 0) qtyNeed += q;
      }
      if (qtyNeed <= 0) continue;
      const net = netFn(state, docId, aid);
      let add = 0;
      if (Math.abs(net) < 1e-5) add = qtyNeed;
      else if (net < 0) add = Math.max(0, qtyNeed + net);
      sum += add;
    }
    return sum;
  }

  /**
   * Deuda informativa (a costo) = stock a costo + vendido POS a costo + ajustes de unidades (solo este módulo).
   * Solo artículos con `tituloMercancia` = mercancía a crédito y `proveedorId` = este proveedor.
   * Las líneas `stock_moves` tipo venta_pos suman a «vendido» si el producto es crédito de este proveedor; **no se excluye vitrina** (canal local/inter/vitrina da igual mientras exista el movimiento en BD).
   * Si no hay movimientos en estado para una factura POS, se usan las líneas de `state.facturas` (misma lógica que el botón «POS moves»).
   * `tes_abonos_prov`: **positivos** = pagos; **negativos** = reconocimiento de deuda (ej. inventario a crédito, `CXPIV_ABONO_MARKER`). En pantalla se muestran aparte (pagos vs reg. créd.).
   * Devoluciones operativas = `tes_devoluciones_prov` + N/C en libro CXP que no sean el espejo de esas devoluciones (evita doble conteo).
   * Ese monto negativo ya está reflejado en stock×costo; se descuenta de la base inventario para no duplicar.
   * Saldo por pagar: si hay movimientos en libro CXP, usa ese saldo; si no, estimación operativa (inventario neto − suma(abonos) − devoluciones).
   */
  function calcDeudaProveedor(state, provId) {
    const articulos = (state.articulos || []).filter((a) => {
      if (!esMercCreditoTitulo(a.tituloMercancia)) return false;
      if (!a.proveedorId) return false;
      return String(a.proveedorId) === String(provId);
    });
    const valorInventarioCosto = articulos.reduce(
      (sum, a) => sum + ((a.precioCompra || 0) * (a.stock || 0)),
      0
    );
    const invEntradaCredAbonoAbs = sumInvEntradaCreditoAbonosAbs(state, provId);
    const valorInventarioCostoNeto = Math.max(0, valorInventarioCosto - invEntradaCredAbonoAbs);

    let costoVendidoHist = 0;
    let unidadesVendidasHist = 0;
    for (let ai = 0; ai < articulos.length; ai++) {
      const a = articulos[ai];
      const uM = articuloUnidadesVendidasPosMoves(state, a.id);
      const uI = unidadesFacturasPosSinStockMoveEnEstado(state, a.id);
      const uds = uM + uI;
      const cost = parseFloat(a.precioCompra) || 0;
      costoVendidoHist += uds * cost;
      unidadesVendidasHist += uds;
    }

    const costoVendidoNeto = Math.max(0, costoVendidoHist);
    const unidadesVendidasNetas = Math.max(0, unidadesVendidasHist);
    let ajustesSalidaCosto = 0;
    let ajustesSalidaUds = 0;
    let ajustesEntradaCosto = 0;
    let ajustesEntradaUds = 0;
    const ajustes = state.inv_ajustes || [];
    for (let j = 0; j < ajustes.length; j++) {
      const aj = ajustes[j];
      const artAj = (state.articulos || []).find((a) => String(a.id) === String(aj.articuloId));
      if (!artAj || !esMercCreditoTitulo(artAj.tituloMercancia) || !artAj.proveedorId) continue;
      if (String(artAj.proveedorId) !== String(provId)) continue;
      const cAj = parseFloat(artAj.precioCompra) || 0;
      const qAj = parseFloat(aj.cantidad) || 0;
      if (aj.tipo === 'salida') {
        ajustesSalidaUds += qAj;
        ajustesSalidaCosto += qAj * cAj;
      } else if (aj.tipo === 'entrada') {
        ajustesEntradaUds += qAj;
        ajustesEntradaCosto += qAj * cAj;
      }
    }
    let ajusteUnidadesCosto = 0;
    (state.tes_ajustes_unidades_prov || []).forEach((r) => {
      if (String(r.proveedorId) !== String(provId)) return;
      const artA = (state.articulos || []).find((a) => String(a.id) === String(r.articuloId));
      const cAj = artA ? parseFloat(artA.precioCompra) || 0 : 0;
      const du = parseFloat(r.deltaUnidades) || 0;
      ajusteUnidadesCosto += du * cAj;
    });
    const refOperativaTotal = valorInventarioCostoNeto + costoVendidoNeto + ajusteUnidadesCosto;
    const compromisoReconocido = (state.tes_compromisos_prov || [])
      .filter((c) => String(c.proveedorId) === String(provId))
      .reduce((sum, c) => sum + (c.valor || 0), 0);
    const abonosProvRows = (state.tes_abonos_prov || []).filter((ab) => String(ab.proveedorId) === String(provId));
    const abonos = abonosProvRows.reduce((sum, ab) => sum + (parseFloat(ab.valor) || 0), 0);
    const abonosPagados = abonosProvRows.reduce((sum, ab) => sum + Math.max(0, parseFloat(ab.valor) || 0), 0);
    const abonosRegistroNegativo = abonosProvRows.reduce((sum, ab) => sum + Math.min(0, parseFloat(ab.valor) || 0), 0);
    const devolucionesDeuda = (state.tes_devoluciones_prov || [])
      .filter((dv) => String(dv.proveedorId) === String(provId))
      .reduce((sum, dv) => sum + (parseFloat(dv.valorCosto) || 0), 0);
    const cxpIdsEspejoDevInv = new Set(
      (state.tes_devoluciones_prov || [])
        .filter((dv) => String(dv.proveedorId) === String(provId))
        .map((dv) => 'cxp-devolucion-' + String(dv.id)),
    );
    const devolucionesNcCxpSinEspejoInv = (state.tes_cxp_movimientos || [])
      .filter(
        (r) =>
          String(r.proveedorId) === String(provId) &&
          r.naturaleza === 'credito' &&
          r.tipo === 'nota_credito' &&
          !cxpIdsEspejoDevInv.has(String(r.id)),
      )
      .reduce((s, r) => s + (parseFloat(r.monto) || 0), 0);
    const devolucionesOperativa = devolucionesDeuda + devolucionesNcCxpSinEspejoInv;
    const saldoLibro = Math.max(0, compromisoReconocido - abonos);
    const saldoOperativoEstimado = Math.max(0, refOperativaTotal - abonos - devolucionesOperativa);
    const cxp = sumCxpProveedor(state, provId);
    const saldo = cxp.hayCxp ? cxp.saldoOficial : saldoOperativoEstimado;

    return {
      valorInventarioCosto,
      valorInventarioCostoNeto,
      invEntradaCredAbonoDedup: invEntradaCredAbonoAbs,
      costoVendidoHist: costoVendidoNeto,
      unidadesVendidasHist: unidadesVendidasNetas,
      refOperativaTotal,
      compromisoReconocido,
      compromisoTotal: compromisoReconocido,
      deudaBruta: refOperativaTotal,
      ajusteUnidadesCosto,
      abonos,
      abonosPagados,
      abonosRegistroNegativo,
      devolucionesDeuda,
      devolucionesNcCxpSinEspejoInv,
      devolucionesOperativa,
      saldo,
      saldoLibro,
      saldoOperativoEstimado,
      cxpCargo: cxp.cargo,
      cxpCredito: cxp.credito,
      saldoOficialCxp: cxp.saldoOficial,
      usaCxp: cxp.hayCxp,
      /* Comparar base inventario/POS (ref.) con saldo libro — no usar saldoOperativoEstimado (se anula si abonos > ref.) */
      difEstimVsCxp: cxp.hayCxp ? refOperativaTotal - cxp.saldoOficial : null,
      articulos,
      ajustesSalidaCosto,
      ajustesSalidaUds,
      ajustesEntradaCosto,
      ajustesEntradaUds
    };
  }

  function articuloUnidadesVendidas(state, artId) {
    return articuloUnidadesVendidasPosMoves(state, artId) + unidadesFacturasPosSinStockMoveEnEstado(state, artId);
  }

  function getLineasMovimiento(m) {
    if (!m) return [];
    if (Array.isArray(m.lineas) && m.lineas.length) return m.lineas;
    const meta = m.meta && typeof m.meta === 'object' ? m.meta : {};
    if (Array.isArray(meta.lineas)) return meta.lineas;
    return [];
  }

  /**
   * Atribuye unidades vendidas POS (FIFO por fecha de cargo) a líneas de compra con detalle.
   * Solo considera cargos `cargo_compra` que tengan `lineas` con artículo/cantidad/costo.
   */
  function fifoCostoVendidoPorProveedor(state, provId) {
    const cargos = (state.tes_cxp_movimientos || [])
      .filter((r) => String(r.proveedorId) === String(provId) && r.tipo === 'cargo_compra' && r.naturaleza === 'cargo')
      .sort((a, b) => String(a.fechaHora || '').localeCompare(String(b.fechaHora || '')));

    const hayDetalleCargos = cargos.some((m) => getLineasMovimiento(m).length > 0);
    if (!hayDetalleCargos) {
      return { totalCostoVendidoAtribuido: 0, hayDetalleCargos: false, detalles: [] };
    }

    const flat = [];
    cargos.forEach((m) => {
      const lineas = getLineasMovimiento(m);
      lineas.forEach((ln) => {
        const aid = ln.articulo_id || ln.articuloId;
        const cant = parseFloat(ln.cantidad) || 0;
        const cu = parseFloat(ln.costo_unitario ?? ln.costoUnitario) || 0;
        if (!aid || cant <= 0) return;
        flat.push({
          movId: m.id,
          articuloId: String(aid),
          cantidad: cant,
          costoUnitario: cu,
          fechaHora: m.fechaHora
        });
      });
    });

    const byArt = {};
    flat.forEach((f) => {
      const k = String(f.articuloId);
      if (!byArt[k]) byArt[k] = [];
      byArt[k].push(f);
    });

    let totalCosto = 0;
    const detalles = [];
    Object.keys(byArt).forEach((artId) => {
      const lineas = byArt[artId].sort((a, b) => String(a.fechaHora).localeCompare(String(b.fechaHora)));
      let remaining = articuloUnidadesVendidas(state, artId);
      lineas.forEach((ln) => {
        const take = Math.min(remaining, ln.cantidad);
        const costo = take * ln.costoUnitario;
        totalCosto += costo;
        remaining -= take;
        detalles.push({
          cargoId: ln.movId,
          articuloId: artId,
          qtyVendidaAtribuida: take,
          costoAtribuido: costo
        });
      });
    });

    return { totalCostoVendidoAtribuido: totalCosto, hayDetalleCargos: true, detalles };
  }

  function sumDeltaUnidadesModulo(state, provId, artId) {
    return (state.tes_ajustes_unidades_prov || [])
      .filter((r) => String(r.proveedorId) === String(provId) && String(r.articuloId) === String(artId))
      .reduce((s, r) => s + (parseFloat(r.deltaUnidades) || 0), 0);
  }

  function lineaRefDeudaArticulo(state, art, provId) {
    const pc = parseFloat(art.precioCompra) || 0;
    const st = parseFloat(art.stock) || 0;
    const vend = articuloUnidadesVendidas(state, art.id);
    const deltaU = provId != null && provId !== '' ? sumDeltaUnidadesModulo(state, provId, art.id) : 0;
    return pc * (st + vend + deltaU);
  }

  function fmtLineaHora(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
    } catch (_) {
      return '—';
    }
  }

  function ventasInformativasLista(state, provId) {
    const arts = (state.articulos || []).filter(
      (a) => esMercCreditoTitulo(a.tituloMercancia) && String(a.proveedorId) === String(provId)
    );
    const ids = new Set(arts.map((a) => String(a.id)));
    const lines = [];
    (state.stock_moves_ventas || []).forEach((m) => {
      if (!ids.has(String(m.productId))) return;
      const art = arts.find((x) => String(x.id) === String(m.productId));
      if (!art) return;
      const uds =
        typeof global.unidadesVentaPosAbs === 'function'
          ? global.unidadesVentaPosAbs(m)
          : Math.abs(parseFloat(m.cantidad) || 0);
      if (uds <= 0) return;
      const meta = ventaMetaFromStockMovePos(state, m);
      lines.push({
        fecha: m.fecha,
        referencia: meta.refShow,
        uds,
        art,
        canal: meta.canal,
        empresa: meta.empresa,
        cliente: meta.cliente,
      });
    });
    lines.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return lines.slice(0, 60);
  }

  function provTieneActividadCredito(state, d) {
    const cxp = sumCxpProveedor(state, d.id);
    return (
      cxp.count > 0 ||
      d.compromisoReconocido > 0 ||
      d.saldo > 0 ||
      Math.abs(d.abonos || 0) > 1e-9 ||
      (d.devolucionesOperativa || 0) > 0 ||
      d.valorInventarioCosto > 0 ||
      d.costoVendidoHist > 0 ||
      Math.abs(d.ajusteUnidadesCosto || 0) > 1e-9
    );
  }

  function renderTesPagosProv(ctx) {
    const { state, fmt, formatDate } = ctx;
    const el = document.getElementById('tes_pagos_prov-content');
    if (!el) return;
    const provConDeuda = (state.usu_proveedores || [])
      .map((p) => ({ ...p, ...calcDeudaProveedor(state, p.id) }))
      .filter((p) => provTieneActividadCredito(state, p));
    const totalDeudaOperativa = provConDeuda.reduce((s, p) => s + p.refOperativaTotal, 0);
    const totalAbonosPagados = provConDeuda.reduce((s, p) => s + (p.abonosPagados || 0), 0);
    const totalAbonosRegCredAbs = provConDeuda.reduce(
      (s, p) => s + Math.abs(Math.min(0, parseFloat(p.abonosRegistroNegativo) || 0)),
      0,
    );
    const totalSaldo = provConDeuda.reduce((s, p) => s + p.saldo, 0);
    const totalCxpCargo = provConDeuda.reduce((s, p) => s + (p.cxpCargo || 0), 0);
    const totalCxpCredito = provConDeuda.reduce((s, p) => s + (p.cxpCredito || 0), 0);
    const totalEstimacion = provConDeuda.reduce((s, p) => s + (p.saldoOperativoEstimado || 0), 0);
    const abonosRecientes = [...(state.tes_abonos_prov || [])].reverse().slice(0, 20);
    const compromisosRecientes = [...(state.tes_compromisos_prov || [])].reverse().slice(0, 20);
    const puedeImportar = (state.usu_proveedores || []).some((p) => {
      const d = calcDeudaProveedor(state, p.id);
      return d.compromisoReconocido === 0 && d.refOperativaTotal > 0;
    });

    el.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:center">
      <button type="button" class="btn btn-primary btn-sm" onclick="openCargoCxpModal()" title="Cargo compra CXP">＋ Cargo</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="openNotaCreditoCxpModal()" title="Nota crédito CXP">N/C</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="backfillStockMovesVentaPos()" title="Solo stock_moves desde facturas (sin tocar products.stock)">POS moves</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="repararStockProductosPosMasivo()" title="Sincronizar stock en artículos según facturas POS y pendientes">POS stock</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="sincronizarPosInventarioCompleto()" title="Moves + stock (recomendado si faltaba trazabilidad)">POS todo</button>
      <button class="btn btn-secondary btn-sm" onclick="openCompromisoProvModal()" title="Nota en libro">Nota</button>
      <button class="btn btn-secondary btn-sm" onclick="openAbonoProvModal()">Abono</button>
      ${
        puedeImportar
          ? `<button class="btn btn-sm btn-secondary" onclick="importarEstimacionCompromisosProv()" title="Copiar deuda estimada al libro">Copiar</button>`
          : ''
      }
    </div>
    <div class="card" style="margin:0 0 12px;padding:10px 12px;font-size:12px;line-height:1.5;border-color:rgba(255,255,255,.08)">
      <div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline">
        <span><b style="color:var(--yellow)">${fmt(totalSaldo)}</b> <span style="color:var(--text2)">saldo</span></span>
        <span style="color:var(--border)">|</span>
        <span><b style="color:var(--red)">${fmt(totalCxpCargo)}</b> <span style="color:var(--text2)">cargos</span></span>
        <span style="color:var(--border)">|</span>
        <span><b style="color:var(--green)">${fmt(totalCxpCredito)}</b> <span style="color:var(--text2)">abonos libro</span></span>
        <span style="color:var(--border)">|</span>
        <span><b>${fmt(totalDeudaOperativa)}</b> <span style="color:var(--text2)">ref. inv./POS</span></span>
        <span style="color:var(--border)">|</span>
        <span title="Solo valores &gt; 0 en tes_abonos_prov (pagos reales)"><b>${fmt(totalAbonosPagados)}</b> <span style="color:var(--text2)">pagos caja</span></span>${
          totalAbonosRegCredAbs > 0.5
            ? `<span style="color:var(--border)">|</span><span title="Valores negativos: reconocimiento de deuda (ej. inventario a crédito), no es pago en efectivo"><b style="color:var(--orange)">${fmt(totalAbonosRegCredAbs)}</b> <span style="color:var(--text2)">reg. créd.</span></span>`
            : ''
        }
        <span style="color:var(--border)">|</span>
        <span title="Suma de saldos operativos estimados por proveedor (sin CXP)"><b>${fmt(totalEstimacion)}</b> <span style="color:var(--text2)">pend. est.</span></span>
      </div>
    </div>
    ${
      provConDeuda.length === 0
        ? `<div class="empty-state"><div class="es-icon">🏭</div><div class="es-title">Sin deuda a crédito con proveedor</div><div class="es-text">Proveedor + artículo <b>mercancía a crédito</b>.</div></div>`
        : provConDeuda
            .map((p) => {
              const basePct = p.refOperativaTotal;
              const cubierto = (p.abonosPagados || 0) + (p.devolucionesOperativa || 0);
              const pct = basePct > 0 ? Math.min(100, (cubierto / basePct) * 100) : 0;
              const libroExtra =
                p.compromisoReconocido > 0
                  ? `<span style="color:var(--border)">|</span><span><b>${fmt(p.compromisoReconocido)}</b> <span style="color:var(--text2)">nota clás.</span></span>`
                  : '';
              const cxpLine = p.usaCxp
                ? `<span style="color:var(--accent)">c ${fmt(p.cxpCargo)} · a ${fmt(p.cxpCredito)}</span>`
                : `<span style="color:var(--orange)">sin CXP</span>`;
              const difLine =
                p.usaCxp && p.difEstimVsCxp != null && Math.abs(p.difEstimVsCxp) > 0.5
                  ? `<span style="color:var(--border)">|</span><span style="color:var(--text2)">Δ ${p.difEstimVsCxp > 0 ? '+' : ''}${fmt(p.difEstimVsCxp)}</span>`
                  : '';
              const ventasLines = ventasInformativasLista(state, p.id);
              const ventasHtml =
                ventasLines.length === 0
                  ? '<div style="font-size:11px;color:var(--text2)">Sin líneas <b>venta_pos</b> en BD para estos artículos (vitrina cuenta igual; revisa stock_moves o «Rellenar movimientos»).</div>'
                  : `<ul style="margin:0;padding-left:16px;font-size:11px;line-height:1.45;color:var(--text2);max-height:140px;overflow:auto">${ventasLines
                      .map((ln) => {
                        const cost = parseFloat(ln.art.precioCompra) || 0;
                        const sub = ln.uds * cost;
                        const refEsc = escCxp(ln.referencia || '—');
                        const extra = [ln.canal, ln.empresa, ln.cliente]
                          .filter((x) => x && String(x).trim())
                          .map((x) => escCxp(x))
                          .join(' · ');
                        const extraHtml = extra
                          ? ` · <span style="opacity:.88;font-size:10px">${extra}</span>`
                          : '';
                        return `<li>${formatDate(ln.fecha)} · ${escCxp(ln.art.nombre || ln.art.codigo || '')}: <b>${ln.uds}</b> uds × ${fmt(cost)} = <b>${fmt(sub)}</b> · ${refEsc}${extraHtml}</li>`;
                      })
                      .join('')}</ul>`;
              const artsRows = (p.articulos || [])
                .map((a) => {
                  const uv = articuloUnidadesVendidas(state, a.id);
                  const deltaU = sumDeltaUnidadesModulo(state, p.id, a.id);
                  const linea = lineaRefDeudaArticulo(state, a, p.id);
                  const deltaHint =
                    deltaU !== 0
                      ? `<div style="font-size:9px;font-weight:400;color:var(--text2)">ajuste mód. ${deltaU > 0 ? '+' : ''}${deltaU} uds</div>`
                      : '';
                  const artTit = String(a.nombre || '—').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
                  return `<tr>
                    <td class="tes-pp-ref">${a.codigo || '—'}</td>
                    <td class="tes-pp-art" style="font-weight:700" title="${artTit}">${a.nombre || '—'}</td>
                    <td class="tes-pp-num" style="font-size:15px;font-weight:800">${a.stock ?? 0}</td>
                    <td class="tes-pp-num" style="font-size:12px">${uv}</td>
                    <td class="tes-pp-num" style="font-size:15px;font-weight:800;color:var(--accent)">${fmt(a.precioCompra || 0)}</td>
                    <td class="tes-pp-num" style="color:var(--red);font-weight:700">${fmt(linea)}${deltaHint}</td>
                    <td class="tes-pp-actions">
                      <button type="button" class="btn btn-xs btn-secondary" onclick="openAjusteUnidadesProvModal('${p.id}','${a.id}')" title="Ajuste unidades (solo deuda)">±</button>
                      <button type="button" class="btn btn-xs btn-danger" onclick="quitarCreditoArticuloProveedorFromPagos('${a.id}')" title="Quitar crédito">⚠️</button>
                    </td>
                  </tr>`;
                })
                .join('');
              return `<div class="card" style="margin-bottom:10px;padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px"><div style="min-width:0"><div style="font-family:Syne;font-size:15px;font-weight:800;line-height:1.2">${p.nombre}</div><div style="font-size:10px;color:var(--text2);margin-top:2px">${[p.cedula, p.ciudad].filter(Boolean).join(' · ') || '—'}</div><div style="display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:6px;font-size:10px;align-items:center">${cxpLine}${difLine}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-family:Syne;font-size:20px;font-weight:800;color:${p.saldo > 0 ? 'var(--yellow)' : 'var(--green)'}">${fmt(p.saldo)}</div><div style="font-size:9px;color:var(--text2)">${p.usaCxp ? 'CXP' : 'estim.'}</div></div></div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:8px">
                <div style="border-left:3px solid var(--accent);padding:8px 10px;background:rgba(0,229,180,.07);border-radius:8px">
                  <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--accent);margin-bottom:2px">Inventarios</div>
                  <div style="font-family:Syne;font-size:22px;font-weight:800;line-height:1.1">${fmt(p.valorInventarioCosto)}</div>
                </div>
                <div style="border-left:3px solid rgba(251,191,36,.85);padding:8px 10px;background:rgba(251,191,36,.07);border-radius:8px">
                  <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--yellow);margin-bottom:2px">Vendido caja</div>
                  <div style="font-family:Syne;font-size:22px;font-weight:800;line-height:1.1">${fmt(p.costoVendidoHist)}</div>
                  <div style="font-size:12px;font-weight:700;margin-top:2px">${p.unidadesVendidasHist || 0} uds</div>
                  <div style="font-size:9px;color:var(--text2);margin-top:4px;line-height:1.35">Incluye vitrina y despachos (mismos movimientos venta_pos en BD).</div>
                </div>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px 10px;margin-bottom:8px;font-size:11px;line-height:1.4;padding:6px 8px;background:rgba(255,255,255,.04);border-radius:6px">
              <span title="Inventario neto a costo + vendido POS + ajustes unidades (base deuda operativa)"><b>${fmt(p.refOperativaTotal)}</b> <span style="color:var(--text2)">ref.</span></span><span style="color:var(--border)">|</span>
              <span title="max(0, ref. − suma(valores en abonos del prov.) − devoluciones operativas). Los negativos en abonos son registro de deuda, no pagos."><b style="color:var(--yellow)">${fmt(p.saldoOperativoEstimado)}</b> <span style="color:var(--text2)">pend. est.</span></span><span style="color:var(--border)">|</span>
              <span title="Solo abonos con valor &gt; 0"><b style="color:var(--green)">${fmt(p.abonosPagados || 0)}</b> <span style="color:var(--text2)">pagos</span></span>${
                Math.abs(p.abonosRegistroNegativo || 0) > 0.5
                  ? `<span style="color:var(--border)">|</span><span title="Valores negativos en tes_abonos_prov (ej. entrada inventario a crédito). No es dinero pagado."><b style="color:var(--orange)">${fmt(Math.abs(p.abonosRegistroNegativo || 0))}</b> <span style="color:var(--text2)">reg. créd.</span></span>`
                  : ''
              }<span style="color:var(--border)">|</span>
              <span title="Devoluciones en inventario + N/C CXP que no duplican el espejo de esas devoluciones"><b style="color:var(--accent)">${fmt(p.devolucionesOperativa || 0)}</b> <span style="color:var(--text2)">devol</span></span>${libroExtra}
              </div>
              <details style="margin-bottom:6px"><summary style="font-size:11px;color:var(--accent);cursor:pointer;font-weight:600">Ventas POS (vitrina + despachos)</summary><div style="margin-top:4px;font-size:10px;color:var(--text2);line-height:1.35;margin-bottom:6px">Todas las salidas registradas en <b>stock_moves</b> tipo venta_pos; el canal solo afecta la etiqueta de cada línea.</div><div>${ventasHtml}</div></details>
              <details open style="margin-bottom:8px"><summary style="font-size:12px;cursor:pointer;font-weight:700">Artículos</summary>
              <div class="table-wrap tes-pp-table-wrap" style="margin-top:6px"><table class="tes-pp-table"><thead><tr><th class="tes-pp-ref">Ref</th><th>Artículo</th><th class="tes-pp-num">Stock</th><th class="tes-pp-num">Vend.</th><th class="tes-pp-num">Costo u.</th><th class="tes-pp-num">Ref. deuda</th><th class="tes-pp-actions"></th></tr></thead><tbody>${artsRows || '<tr><td colspan="7" style="text-align:center;color:var(--text2)">—</td></tr>'}</tbody></table></div>
              </details>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div style="flex:1;background:rgba(255,255,255,.05);border-radius:6px;height:6px;overflow:hidden"><div style="height:100%;border-radius:6px;background:linear-gradient(90deg,var(--green),var(--accent));width:${pct}%;transition:width 1s ease"></div></div><span style="font-size:10px;color:var(--text2);white-space:nowrap">${pct.toFixed(0)}%</span></div>
              <div style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn btn-sm btn-primary" onclick="openCargoCxpModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">Cargo</button><button class="btn btn-sm btn-secondary" onclick="openNotaCreditoCxpModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">N/C</button><button class="btn btn-sm btn-secondary" onclick="alinearCxpEstimacionProv('${p.id}')">Alinear</button><button class="btn btn-sm btn-secondary" onclick="verLibroCxpModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">Libro</button><button class="btn btn-sm btn-secondary" onclick="openCompromisoProvModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">Nota</button><button class="btn btn-sm btn-secondary" onclick="openAbonoProvModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">Abono</button><button class="btn btn-sm btn-secondary" onclick="verLibroProveedorModal('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">Hist.</button><button class="btn btn-sm btn-secondary" onclick="verCompromisosProv('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">Comp.</button><button class="btn btn-sm btn-secondary" onclick="verAbonosProv('${p.id}','${String(p.nombre).replace(/'/g, "\\'")}')">Lista</button></div></div>`;
            })
            .join('')
    }
    ${
      abonosRecientes.length > 0
        ? `<div class="card"><div class="card-title" style="font-size:13px">Abonos recientes</div><div class="table-wrap tes-pp-table-wrap"><table class="tes-pp-table tes-pp-table--mini"><thead><tr><th>Fecha</th><th>Prov.</th><th class="tes-pp-num">$</th><th>Mét.</th><th>Nota</th><th class="tes-pp-actions"></th></tr></thead><tbody>${abonosRecientes
            .map(
              (ab) =>
                `<tr><td style="white-space:nowrap;font-size:11px">${fmtLineaHora(ab.fechaHora) || formatDate(ab.fecha)}</td><td style="font-weight:700">${ab.proveedorNombre || '—'}</td><td class="tes-pp-num" style="color:var(--green);font-weight:700">${fmt(ab.valor || 0)}</td><td>${ab.metodo || '—'}</td><td style="color:var(--text2);font-size:11px">${ab.nota || '—'}</td><td class="tes-pp-actions"><button class="btn btn-xs btn-danger" onclick="eliminarAbonoProv('${ab.id}')">✕</button></td></tr>`
            )
            .join('')}</tbody></table></div></div>`
        : ''
    }
    ${
      compromisosRecientes.length > 0
        ? `<div class="card"><div class="card-title" style="font-size:13px">Notas libro</div><div class="table-wrap tes-pp-table-wrap"><table class="tes-pp-table tes-pp-table--mini"><thead><tr><th>Fecha</th><th>Prov.</th><th class="tes-pp-num">$</th><th>Lín.</th><th>Ref.</th><th>Nota</th><th class="tes-pp-actions"></th></tr></thead><tbody>${compromisosRecientes
            .map(
              (c) => {
                const nl = getLineasMovimiento(c).length;
                const lineasBrief = nl > 0 ? `${nl} artículo(s)` : '—';
                return `<tr><td>${formatDate(c.fecha)}</td><td style="font-weight:700">${c.proveedorNombre || '—'}</td><td class="tes-pp-num" style="color:var(--accent);font-weight:700">${fmt(c.valor || 0)}</td><td style="font-size:11px;color:var(--text2)">${lineasBrief}</td><td style="color:var(--text2);font-size:11px">${c.referencia || '—'}</td><td style="color:var(--text2);font-size:11px">${c.nota || '—'}</td><td class="tes-pp-actions"><button class="btn btn-xs btn-danger" onclick="eliminarCompromisoProv('${c.id}')">✕</button></td></tr>`;
              }
            )
            .join('')}</tbody></table></div></div>`
        : ''
    }`;
  }

  function compromisoProveedorOptions(state) {
    return (state.usu_proveedores || []).map((p) => ({ id: p.id, nombre: p.nombre }));
  }

  function openCompromisoProvModal(ctx) {
    const { state, provId = '', provNombre = '', fmt, openModal, notify, today } = ctx;
    _compromisoModalCtx = { state, notify, fmt };
    const provs = compromisoProveedorOptions(state);
    if (provs.length === 0) {
      notify('warning', '⚠️', 'Sin proveedores', 'Registra proveedores o artículos a crédito primero.', { duration: 4000 });
      return;
    }
    const optHtml = provs
      .map((o) => {
        const sel = o.id === provId ? 'selected' : '';
        const nm = String(o.nombre).replace(/"/g, '&quot;');
        const d = calcDeudaProveedor(state, o.id);
        return `<option value="${o.id}" data-nombre="${nm}" ${sel}>${o.nombre} · Deuda op. ${fmt(d.refOperativaTotal)} · Libro ${fmt(d.compromisoReconocido)}</option>`;
      })
      .join('');
    openModal(`
    <div class="modal-title">📥 Nota en libro (opcional)<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">Registra una <b>factura o remisión</b>. Con <b>detalle por artículo</b> el sistema puede atribuir ventas POS (FIFO) igual que un cargo CXP. Se duplica en <b>libro CXP</b> como cargo. <b>No</b> mueve caja; el saldo baja con <b>abonos</b>.</p>
    <div class="form-group"><label class="form-label">PROVEEDOR *</label><select class="form-control" id="cp-prov-sel" onchange="AppTreasuryModule.cpCompOnProvChange()">${optHtml}</select></div>
    <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:12px;margin-bottom:10px;line-height:1.35">
      <input type="checkbox" id="cp-mod-detalle" checked onchange="AppTreasuryModule.cpCompToggleModo()" style="margin-top:2px">
      <span>Detalle por artículo (total = Σ cantidad × costo; se copia al libro CXP)</span>
    </label>
    <div id="cp-lineas-wrap">
      <div class="table-wrap" style="margin-bottom:8px"><table style="font-size:12px"><thead><tr><th>Artículo</th><th style="width:88px">Cant.</th><th style="width:110px">Costo u.</th><th style="width:100px">Subtotal</th><th></th></tr></thead><tbody id="cp-lineas-tbody"></tbody></table></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <button type="button" class="btn btn-sm btn-secondary" onclick="AppTreasuryModule.cpCompAddLinea()">＋ Línea</button>
        <span style="font-size:12px;color:var(--text2)">Total nota:</span> <span id="cp-total-monto" style="font-weight:700;color:var(--yellow)">—</span>
      </div>
    </div>
    <div id="cp-solo-wrap" style="display:none">
    <div class="form-group"><label class="form-label">VALOR (COSTO) *</label><input type="number" class="form-control" id="cp-valor" min="0" step="any" placeholder="0"></div>
    </div>
    <div class="form-row"><div class="form-group"><label class="form-label">FECHA</label><input type="date" class="form-control" id="cp-fecha" value="${today()}"></div></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">REFERENCIA</label><input class="form-control" id="cp-ref" placeholder="N° factura / remisión"></div>
      <div class="form-group"><label class="form-label">NOTA</label><input class="form-control" id="cp-nota" placeholder="Observación"></div>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarCompromisoProv()">📥 Guardar nota en libro</button>`);
    setTimeout(() => {
      const selEl = document.getElementById('cp-prov-sel');
      if (selEl && provId) selEl.value = provId;
      cpCompOnProvChange();
      cpCompToggleModo();
    }, 50);
  }

  async function guardarCompromisoProv(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, closeModal, renderTesPagosProv, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const sel = document.getElementById('cp-prov-sel');
    const opt = sel?.options[sel.selectedIndex];
    const provId = sel?.value;
    const provNombre = opt?.getAttribute('data-nombre') || opt?.text || '';
    const fecha = document.getElementById('cp-fecha')?.value || today();
    const referencia = document.getElementById('cp-ref')?.value.trim() || '';
    const nota = document.getElementById('cp-nota')?.value.trim() || '';
    const modoDetalle = document.getElementById('cp-mod-detalle')?.checked;
    let lineas = [];
    let valor = 0;
    if (modoDetalle) {
      const tb = document.getElementById('cp-lineas-tbody');
      tb?.querySelectorAll('tr[data-cp-line]').forEach((tr) => {
        const selArt = tr.querySelector('.cp-comp-art');
        const aid = selArt?.value;
        const qty = parseFloat(tr.querySelector('.cp-comp-qty')?.value) || 0;
        const cu = parseFloat(tr.querySelector('.cp-comp-cu')?.value) || 0;
        if (!aid || qty <= 0) return;
        const optArt = selArt.options[selArt.selectedIndex];
        const nombre = optArt?.getAttribute('data-nombre') || '';
        lineas.push({
          articulo_id: aid,
          articulo_nombre: nombre,
          cantidad: qty,
          costo_unitario: cu
        });
      });
      valor = lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0);
      if (!provId || !lineas.length || valor <= 0) {
        notify('warning', '⚠️', 'Datos', 'Proveedor y al menos una línea con artículo, cantidad y costo válidos.', { duration: 4000 });
        return;
      }
    } else {
      valor = parseFloat(document.getElementById('cp-valor')?.value || 0);
      lineas = [];
      if (!provId) {
        notify('warning', '⚠️', 'Proveedor', 'Selecciona proveedor.', { duration: 3000 });
        return;
      }
      if (valor <= 0) {
        notify('warning', '⚠️', 'Valor', 'Ingresa un valor mayor a 0.', { duration: 3000 });
        return;
      }
    }
    const row = {
      id: nextId(),
      proveedorId: provId,
      proveedorNombre: provNombre,
      valor,
      fecha,
      referencia,
      nota,
      lineas: lineas.length ? lineas : []
    };
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from('tes_compromisos_prov').upsert(
        {
          id: row.id,
          proveedor_id: provId,
          proveedor_nombre: provNombre,
          valor,
          fecha,
          referencia,
          nota,
          lineas: lineas.length ? lineas : []
        },
        { onConflict: 'id' }
      );
      if (error) throw error;
      if (!state.tes_compromisos_prov) state.tes_compromisos_prov = [];
      state.tes_compromisos_prov.push(row);
      const cxpCId = `cxp-comp-${row.id}`;
      const cxpRow = {
        id: cxpCId,
        proveedor_id: provId,
        proveedor_nombre: provNombre,
        tipo: 'cargo_compra',
        naturaleza: 'cargo',
        monto: valor,
        fecha,
        referencia: referencia || null,
        nota: nota || null,
        meta: { compromisoId: row.id, origen: 'compromiso_modal', lineas_detalle: lineas.length > 0 },
        lineas: lineas.length ? lineas : [],
        fecha_hora: new Date().toISOString()
      };
      const { error: eCxp } = await supabaseClient.from('tes_cxp_movimientos').upsert(cxpRow, { onConflict: 'id' });
      if (eCxp) console.warn('[CXP] mirror compromiso:', eCxp.message);
      else {
        if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
        state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => r.id !== cxpCId);
        state.tes_cxp_movimientos.push({
          id: cxpCId,
          proveedorId: provId,
          proveedorNombre: provNombre,
          tipo: 'cargo_compra',
          naturaleza: 'cargo',
          monto: valor,
          fecha,
          referencia: referencia || '',
          nota: nota || '',
          meta: cxpRow.meta,
          lineas: lineas.length ? lineas : [],
          fechaHora: cxpRow.fecha_hora
        });
      }
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      notify('success', '📒', 'Nota en libro guardada', `${fmt(valor)} · ${provNombre}`, { duration: 3000 });
    } catch (err) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', err.message || String(err), { duration: 6000 });
      console.error(err);
    }
  }

  async function eliminarCompromisoProv(ctx) {
    const { state, id, confirm, supabaseClient, renderTesPagosProv, notify } = ctx;
    if (!confirm('¿Eliminar este compromiso? El saldo pendiente se recalculará.')) return;
    try {
      const { error } = await supabaseClient.from('tes_compromisos_prov').delete().eq('id', id);
      if (error) throw error;
      state.tes_compromisos_prov = (state.tes_compromisos_prov || []).filter((c) => c.id !== id);
      const cxpIds = [`cxp-comp-${id}`, `cxp-leg-cp-${id}`];
      for (let i = 0; i < cxpIds.length; i++) {
        await supabaseClient.from('tes_cxp_movimientos').delete().eq('id', cxpIds[i]);
      }
      state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => !cxpIds.includes(r.id));
      renderTesPagosProv();
      notify('success', '🗑️', 'Compromiso eliminado', 'Saldo recalculado.', { duration: 2000 });
    } catch (e) {
      console.warn('Error eliminando compromiso:', e.message || e);
      notify('danger', '⚠️', 'No se pudo eliminar', e.message || 'Error en base de datos', { duration: 4500 });
    }
  }

  function verCompromisosProv(ctx) {
    const { state, provId, provNombre, fmt, formatDate, openModal } = ctx;
    const lines = (state.tes_compromisos_prov || []).filter((c) => c.proveedorId === provId);
    const d = calcDeudaProveedor(state, provId);
    openModal(`<div class="modal-title">📒 Notas en libro — ${provNombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;font-size:12px;line-height:1.45">
    <div><span style="color:var(--text2)">Deuda total (a costo):</span> <b>${fmt(d.refOperativaTotal)}</b></div>
    <div><span style="color:var(--text2)">Suma libro (opc.):</span> <b>${fmt(d.compromisoReconocido)}</b></div>
    <div><span style="color:var(--text2)">Abonado:</span> <b style="color:var(--green)">${fmt(d.abonos)}</b></div>
    <div><span style="color:var(--text2)">Saldo por pagar:</span> <b style="color:var(--yellow)">${fmt(d.saldo)}</b></div></div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Valor</th><th>Líneas</th><th>Ref.</th><th>Nota</th><th></th></tr></thead><tbody>${lines.length > 0 ? lines
      .slice()
      .reverse()
      .map(
        (c) => {
          const lns = getLineasMovimiento(c);
          const lineasCell =
            lns.length > 0
              ? `<div style="font-size:10px;line-height:1.35;max-width:220px;color:var(--text2)">${lns
                  .map((l) => `${escCxp(l.articulo_nombre || l.articulo_id || '—')} ×${l.cantidad}`)
                  .join('<br>')}</div>`
              : '—';
          return `<tr><td>${formatDate(c.fecha)}</td><td style="color:var(--accent);font-weight:700">${fmt(c.valor)}</td><td style="font-size:11px;vertical-align:top">${lineasCell}</td><td style="font-size:11px;color:var(--text2)">${c.referencia || '—'}</td><td style="font-size:11px;color:var(--text2)">${c.nota || '—'}</td><td><button class="btn btn-xs btn-danger" onclick="closeModal();eliminarCompromisoProv('${c.id}')">✕</button></td></tr>`;
        }
      )
      .join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:20px">Sin notas en libro</td></tr>'}</tbody></table></div>
    <button class="btn btn-primary btn-sm" style="margin-top:12px;width:100%" onclick="closeModal();openCompromisoProvModal('${provId}','${String(provNombre).replace(/'/g, "\\'")}')">+ Nueva nota en libro</button>`);
  }

  async function importarEstimacionCompromisosProv(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, renderTesPagosProv, notify, fmt, confirm } = ctx;
    if (
      !confirm(
        'Se creará una línea de compromiso por cada proveedor con estimación > 0 y sin compromisos en libro. Valor = misma base que la deuda operativa (stock + vendido a costo). ¿Continuar?'
      )
    )
      return;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const targets = [];
    (state.usu_proveedores || []).forEach((p) => {
      const d = calcDeudaProveedor(state, p.id);
      if (d.compromisoReconocido === 0 && d.refOperativaTotal > 0) targets.push({ provId: p.id, nombre: p.nombre, valor: d.refOperativaTotal });
    });
    if (targets.length === 0) {
      notify('warning', 'ℹ️', 'Nada que importar', 'Todos ya tienen compromiso en libro o la estimación es 0.', { duration: 4000 });
      return;
    }
    try {
      showLoadingOverlay('connecting');
      if (!state.tes_compromisos_prov) state.tes_compromisos_prov = [];
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const row = {
          id: nextId(),
          proveedorId: t.provId,
          proveedorNombre: t.nombre,
          valor: t.valor,
          fecha: today(),
          referencia: '',
          nota: 'Importación estimación (deuda a costo: stock+vendido)',
          lineas: []
        };
        const { error } = await supabaseClient.from('tes_compromisos_prov').upsert(
          {
            id: row.id,
            proveedor_id: t.provId,
            proveedor_nombre: t.nombre,
            valor: t.valor,
            fecha: row.fecha,
            referencia: row.referencia,
            nota: row.nota,
            lineas: []
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
        state.tes_compromisos_prov.push(row);
        const cxpCId = `cxp-comp-${row.id}`;
        const cxpIns = {
          id: cxpCId,
          proveedor_id: t.provId,
          proveedor_nombre: t.nombre,
          tipo: 'cargo_compra',
          naturaleza: 'cargo',
          monto: t.valor,
          fecha: row.fecha,
          referencia: '',
          nota: row.nota,
          meta: { compromisoId: row.id, origen: 'import_estimacion' },
          lineas: [],
          fecha_hora: new Date().toISOString()
        };
        const { error: ex } = await supabaseClient.from('tes_cxp_movimientos').upsert(cxpIns, { onConflict: 'id' });
        if (ex) console.warn('[CXP] import compromiso:', ex.message);
        else {
          if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
          state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => r.id !== cxpCId);
          state.tes_cxp_movimientos.push({
            id: cxpCId,
            proveedorId: t.provId,
            proveedorNombre: t.nombre,
            tipo: 'cargo_compra',
            naturaleza: 'cargo',
            monto: t.valor,
            fecha: row.fecha,
            referencia: '',
            nota: row.nota,
            meta: cxpIns.meta,
            lineas: [],
            fechaHora: cxpIns.fecha_hora
          });
        }
      }
      showLoadingOverlay('hide');
      renderTesPagosProv();
      notify('success', '📎', 'Compromisos importados', `${targets.length} línea(s). Revisa y ajusta en el libro si hace falta.`, { duration: 5000 });
    } catch (err) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error importando', err.message || String(err), { duration: 6000 });
      console.error(err);
    }
  }

  function abonoModalOptions(state) {
    const opts = [];
    (state.usu_proveedores || []).forEach((p) => {
      const d = calcDeudaProveedor(state, p.id);
      if (d.saldo > 0) opts.push({ id: p.id, nombre: p.nombre, saldo: d.saldo });
    });
    return opts;
  }

  function openAbonoProvModal(ctx) {
    const { state, provId = '', provNombre = '', fmt, openModal, notify, today } = ctx;
    const opts = abonoModalOptions(state);
    if (provId && !opts.find((o) => o.id === provId)) {
      const d = calcDeudaProveedor(state, provId);
      opts.push({
        id: provId,
        nombre: provNombre || 'Proveedor',
        saldo: d.saldo
      });
    }
    if (opts.length === 0 && !provId) {
      notify('warning', '⚠️', 'Sin saldo pendiente', 'No hay proveedores con saldo por pagar (deuda operativa − abonos).', {
        duration: 4000
      });
      return;
    }
    const optHtml = opts
      .map((o) => {
        const sel = o.id === provId ? 'selected' : '';
        const nm = String(o.nombre).replace(/"/g, '&quot;');
        return `<option value="${o.id}" data-saldo="${o.saldo}" data-nombre="${nm}" ${sel}>${o.nombre} · Saldo: ${fmt(o.saldo)}</option>`;
      })
      .join('');
    openModal(`
    <div class="modal-title">💳 Registrar Abono a Proveedor<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">PROVEEDOR *</label><select class="form-control" id="ab-prov-sel" onchange="updateSaldoPendiente()"><option value="">— Seleccionar —</option>${optHtml}</select></div>
    <div id="ab-saldo-info" style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;display:none"><span style="color:var(--text2)">Saldo pendiente (deuda operativa − abonos):</span> <span id="ab-saldo-val" style="font-weight:700;color:var(--yellow)"></span></div>
    <div id="ab-fifo-info" style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:10px;margin-bottom:12px;font-size:11px;display:none;line-height:1.45">
    <div><span style="color:var(--text2)">Costo vendido atribuido a cargos con líneas (FIFO vs ventas POS):</span> <span id="ab-fifo-val" style="font-weight:700;color:var(--green)"></span></div>
    <div id="ab-fifo-hint" style="font-size:10px;color:var(--text2);margin-top:6px"></div>
    <div id="ab-fifo-validate" style="font-size:10px;color:var(--accent);margin-top:6px;display:none"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">VALOR ABONO *</label><input type="number" class="form-control" id="ab-valor" min="0" placeholder="0" oninput="validateAbono()"></div>
      <div class="form-group"><label class="form-label">PAGO DEL ABONO * <span style="font-size:9px;color:var(--text2)">(define bucket en caja)</span></label><select class="form-control" id="ab-medio-caja"><option value="efectivo">💵 Efectivo → bucket efectivo</option><option value="transferencia">🏦 Transferencia → bucket transferencia</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">CAJA (egreso desde el bucket indicado)</label><select class="form-control" id="ab-caja-sel">${(state.cajas || [])
      .filter((c) => c.estado === 'abierta')
      .map((c) => `<option value="${c.id}">${c.nombre}</option>`)
      .join('') || '<option value="">— Sin caja abierta —</option>'}</select><div style="font-size:10px;color:var(--text2);margin-top:4px">Al anular o conciliar, el reintegro debe ir al mismo bucket (efectivo vs transferencia).</div></div>
    <div class="form-row"><div class="form-group"><label class="form-label">FECHA</label><input type="date" class="form-control" id="ab-fecha" value="${today()}"></div><div class="form-group"><label class="form-label">COMPROBANTE / NOTA</label><input class="form-control" id="ab-nota" placeholder="N° transferencia, observación..."></div></div>
    <div id="ab-warning" style="display:none;color:var(--red);font-size:11px;margin-bottom:8px"></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarAbonoProv()">💳 Guardar Abono</button>`);
    if (provId) {
      setTimeout(() => {
        const selEl = document.getElementById('ab-prov-sel');
        if (selEl) {
          selEl.value = provId;
          updateSaldoPendiente(ctx);
        }
      }, 50);
    }
  }

  function updateSaldoPendiente(ctx) {
    const { fmt, state } = ctx || {};
    const sel = document.getElementById('ab-prov-sel');
    const opt = sel?.options[sel.selectedIndex];
    const saldo = parseFloat(opt?.getAttribute('data-saldo') || 0);
    const info = document.getElementById('ab-saldo-info');
    const val = document.getElementById('ab-saldo-val');
    const fifoInfo = document.getElementById('ab-fifo-info');
    const fifoVal = document.getElementById('ab-fifo-val');
    const fifoHint = document.getElementById('ab-fifo-hint');
    const fifoValid = document.getElementById('ab-fifo-validate');
    if (fifoValid) {
      fifoValid.style.display = 'none';
      fifoValid.textContent = '';
    }
    if (saldo > 0) {
      info.style.display = 'block';
      val.textContent = fmt(saldo);
    } else {
      info.style.display = 'none';
    }
    const provId = sel?.value;
    if (fifoInfo && fifoVal && fifoHint && state && provId && provId !== '') {
      const fifo = fifoCostoVendidoPorProveedor(state, provId);
      fifoInfo.style.display = 'block';
      if (!fifo.hayDetalleCargos) {
        fifoVal.textContent = '—';
        fifoHint.textContent =
          'No hay cargos CXP con líneas de artículo. Registra un cargo CXP o una nota en libro con detalle por producto para atribuir ventas POS.';
      } else if (fifo.totalCostoVendidoAtribuido > 0) {
        fifoVal.textContent = fmt(fifo.totalCostoVendidoAtribuido);
        fifoHint.textContent = 'Referencia a costo de lo ya vendido (POS); útil para dimensionar abonos sin desfasar del efectivo recuperado.';
      } else {
        fifoVal.textContent = fmt(0);
        fifoHint.textContent =
          'Hay cargos con líneas, pero aún no hay ventas POS que consuman esas compras (FIFO), o las unidades vendidas no coinciden con esas líneas.';
      }
    } else if (fifoInfo) {
      fifoInfo.style.display = 'none';
    }
    validateAbono({ fmt, state });
  }

  function validateAbono(ctx) {
    const { fmt, state } = ctx || {};
    const sel = document.getElementById('ab-prov-sel');
    const opt = sel?.options[sel.selectedIndex];
    const saldo = parseFloat(opt?.getAttribute('data-saldo') || 0);
    const provId = sel?.value;
    const valor = parseFloat(document.getElementById('ab-valor')?.value || 0);
    const warn = document.getElementById('ab-warning');
    const fifoValid = document.getElementById('ab-fifo-validate');
    if (valor > saldo && saldo > 0) {
      warn.style.display = 'block';
      warn.textContent = `⚠️ El abono (${fmt(valor)}) supera el saldo (${fmt(saldo)}). Puedes registrar anticipo si tu política lo permite.`;
    } else {
      warn.style.display = 'none';
    }
    if (fifoValid && state && provId) {
      const fifo = fifoCostoVendidoPorProveedor(state, provId);
      if (fifo.hayDetalleCargos && fifo.totalCostoVendidoAtribuido > 0 && valor > fifo.totalCostoVendidoAtribuido + 1e-6) {
        fifoValid.style.display = 'block';
        fifoValid.textContent = `ℹ️ El abono supera el costo vendido referido (${fmt(fifo.totalCostoVendidoAtribuido)}); puede cubrir mercancía aún en inventario u otros cargos.`;
      } else {
        fifoValid.style.display = 'none';
        fifoValid.textContent = '';
      }
    } else if (fifoValid) {
      fifoValid.style.display = 'none';
    }
  }

  async function guardarAbonoProv(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, saveRecord, closeModal, renderTesPagosProv, notify, fmt, renderTesCajas } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const sel = document.getElementById('ab-prov-sel');
    const opt = sel?.options[sel.selectedIndex];
    const provId = sel?.value;
    const provNombre = opt?.getAttribute('data-nombre') || opt?.text || '';
    const valor = parseFloat(document.getElementById('ab-valor')?.value || 0);
    const metodo = document.getElementById('ab-medio-caja')?.value || 'efectivo';
    const fecha = document.getElementById('ab-fecha')?.value || today();
    const nota = document.getElementById('ab-nota')?.value.trim() || '';
    if (!provId) {
      notify('warning', '⚠️', 'Selecciona un proveedor', '', { duration: 3000 });
      return;
    }
    if (valor <= 0) {
      notify('warning', '⚠️', 'Ingresa un valor', '', { duration: 3000 });
      return;
    }
    const cajaSel = document.getElementById('ab-caja-sel')?.value;
    const cajaAbierta =
      (cajaSel && (state.cajas || []).find((c) => c.id === cajaSel && c.estado === 'abierta')) ||
      (state.cajas || []).find((c) => c.estado === 'abierta');
    if (cajaAbierta) {
      global.AppCajaLogic?.normalizeCaja?.(cajaAbierta);
      const bucket = global.AppCajaLogic?.bucketFromMetodoId?.(metodo, state.cfg_metodos_pago) || 'efectivo';
      const disp = global.AppCajaLogic?.saldoEnBucket?.(cajaAbierta, bucket) ?? 0;
      if (disp < valor) {
        notify('warning', '⚠️', 'Saldo en bucket', `En «${bucket}» solo hay ${fmt(disp)}. Elige otra caja o método.`, { duration: 6000 });
        return;
      }
    }

    const fechaHoraIso = new Date().toISOString();
    const abono = {
      id: nextId(),
      proveedorId: provId,
      proveedorNombre: provNombre,
      valor,
      metodo,
      fecha,
      nota,
      fechaCreacion: today(),
      fechaHora: fechaHoraIso
    };
    const cxpAbonoId = `cxp-abono-${abono.id}`;
    const cxpAbonoRow = {
      id: cxpAbonoId,
      proveedor_id: provId,
      proveedor_nombre: provNombre,
      tipo: 'abono',
      naturaleza: 'credito',
      monto: valor,
      fecha,
      referencia: metodo || null,
      nota: nota || null,
      meta: { abonoId: abono.id, origen: 'abono_modal' },
      lineas: [],
      fecha_hora: fechaHoraIso
    };

    const conceptoMov = `Abono proveedor: ${provNombre} · ref:${abono.id}`;
    let bucket = null;
    let mov = null;
    if (cajaAbierta) {
      bucket = global.AppCajaLogic?.bucketFromMetodoId?.(metodo, state.cfg_metodos_pago) || 'efectivo';
      mov = {
        id: nextId(),
        cajaId: cajaAbierta.id,
        tipo: 'egreso',
        valor,
        concepto: conceptoMov,
        fecha,
        metodo,
        categoria: 'abono_proveedor',
        bucket,
        refAbonoProvId: abono.id
      };
      global.AppCajaLogic?.enrichMovWithSesion?.(state, cajaAbierta.id, mov, nextId);
    }

    function aplicarCajaRespuestaRpc(cajaJson) {
      if (!cajaJson || !cajaAbierta) return;
      const c = (state.cajas || []).find((x) => x.id === cajaJson.id);
      if (!c) return;
      const sm = cajaJson.saldos_metodo;
      global.AppCajaLogic?.normalizeCaja?.(c);
      if (sm && typeof sm === 'object') {
        Object.keys(sm).forEach((k) => {
          c.saldosMetodo[k] = parseFloat(sm[k]) || 0;
        });
      }
      if (cajaJson.saldo != null) c.saldo = parseFloat(cajaJson.saldo) || 0;
    }

    try {
      showLoadingOverlay('connecting');
      const fechaDate = String(fecha || '').slice(0, 10);
      const rpcPayload = {
        p_abono_id: abono.id,
        p_proveedor_id: provId,
        p_proveedor_nombre: provNombre,
        p_valor: valor,
        p_metodo: metodo,
        p_fecha: fechaDate,
        p_nota: nota || null,
        p_fecha_hora: fechaHoraIso,
        p_caja_id: cajaAbierta ? cajaAbierta.id : null,
        p_mov_id: mov ? mov.id : null,
        p_bucket: bucket,
        p_concepto: conceptoMov,
        p_sesion_id: mov && mov.sesionId ? mov.sesionId : null,
        p_caja_sesion_activa_id: cajaAbierta && cajaAbierta.sesionActivaId ? cajaAbierta.sesionActivaId : null
      };
      const { data: rpcData, error: rpcErr } = await supabaseClient.rpc('tes_abono_proveedor_aplicar', rpcPayload);
      if (rpcErr) throw rpcErr;

      if (!state.tes_abonos_prov) state.tes_abonos_prov = [];
      state.tes_abonos_prov.push(abono);
      if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
      state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => r.id !== cxpAbonoId);
      state.tes_cxp_movimientos.push({
        id: cxpAbonoId,
        proveedorId: provId,
        proveedorNombre: provNombre,
        tipo: 'abono',
        naturaleza: 'credito',
        monto: valor,
        fecha,
        referencia: metodo || '',
        nota: nota || '',
        meta: cxpAbonoRow.meta,
        lineas: [],
        fechaHora: fechaHoraIso
      });

      if (cajaAbierta && mov) {
        aplicarCajaRespuestaRpc(rpcData && rpcData.caja);
        if (!Array.isArray(state.tes_movimientos)) state.tes_movimientos = [];
        state.tes_movimientos.push(mov);
      } else {
        notify('warning', '🏧', 'Sin caja', 'El abono quedó registrado; sin caja abierta no hubo egreso en caja.', { duration: 5000 });
      }
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      if (typeof renderTesCajas === 'function') renderTesCajas();
      notify('success', '💳', 'Abono registrado', `${fmt(valor)} a ${provNombre}`, { duration: 3000 });
    } catch (err) {
      showLoadingOverlay('hide');
      const msg =
        err?.message ||
        err?.error_description ||
        (typeof err === 'string' ? err : JSON.stringify(err));
      notify('danger', '⚠️', 'Error al guardar', msg, { duration: 5000 });
      console.error(err);
    }
  }

  function verAbonosProv(ctx) {
    const { state, provId, provNombre, fmt, formatDate, openModal } = ctx;
    const abonos = (state.tes_abonos_prov || []).filter((ab) => ab.proveedorId === provId);
    const d = calcDeudaProveedor(state, provId);
    openModal(`<div class="modal-title">📋 Abonos — ${provNombre}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;font-size:12px;line-height:1.45">
    <div><span style="color:var(--text2)">Deuda total (a costo):</span> <b>${fmt(d.refOperativaTotal)}</b></div>
    <div><span style="color:var(--text2)">Libro (opc.):</span> <b>${fmt(d.compromisoReconocido)}</b></div>
    <div><span style="color:var(--text2)">Abonos (neto en fórmula):</span> <b>${fmt(d.abonos)}</b> <span style="color:var(--text2);font-size:11px">· pagos ${fmt(d.abonosPagados || 0)}${
      Math.abs(d.abonosRegistroNegativo || 0) > 0.5
        ? ` · reg. créd. ${fmt(Math.abs(d.abonosRegistroNegativo || 0))}`
        : ''
    }</span></div>
    <div><span style="color:var(--text2)">Devoluciones (operativas):</span> <b style="color:var(--accent)">${fmt(d.devolucionesOperativa || 0)}</b>${
      (d.devolucionesNcCxpSinEspejoInv || 0) > 0.5
        ? ` <span style="color:var(--text2);font-size:11px">(inv. ${fmt(d.devolucionesDeuda || 0)} + N/C CXP ${fmt(d.devolucionesNcCxpSinEspejoInv)})</span>`
        : ''
    }</div>
    <div><span style="color:var(--text2)">Saldo por pagar:</span> <b style="color:var(--yellow)">${fmt(d.saldo)}</b></div></div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:12px;line-height:1.45">Desglose: en stock ${fmt(d.valorInventarioCosto)} · ya vendido (POS a costo, <b>incluye vitrina</b>) ${fmt(d.costoVendidoHist)} (${d.unidadesVendidasHist} uds) · ajustes salida (hist.) ${fmt(d.ajustesSalidaCosto || 0)} (${d.ajustesSalidaUds || 0} uds, ya en stock)${
      Math.abs(d.ajusteUnidadesCosto || 0) > 1e-9
        ? ` · ajuste unidades (mód. pagos) ${fmt(d.ajusteUnidadesCosto)}`
        : ''
    }</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha / hora</th><th>Valor</th><th>Método</th><th>Nota</th></tr></thead><tbody>${abonos.length > 0 ? abonos.reverse().map((ab) => `<tr><td style="white-space:nowrap;font-size:11px">${fmtLineaHora(ab.fechaHora) || formatDate(ab.fecha)}</td><td style="color:var(--green);font-weight:700">${fmt(ab.valor)}</td><td>${ab.metodo || '—'}</td><td style="color:var(--text2);font-size:11px">${ab.nota || '—'}</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:20px">Sin abonos registrados</td></tr>'}</tbody></table></div>
    <button class="btn btn-primary btn-sm" style="margin-top:12px;width:100%" onclick="closeModal();openAbonoProvModal('${provId}','${String(provNombre).replace(/'/g, "\\'")}')">+ Nuevo Abono</button>`);
  }

  function openAjusteUnidadesProvModal(ctx) {
    const { state, provId, artId, fmt, openModal, notify } = ctx;
    const art = (state.articulos || []).find((a) => String(a.id) === String(artId));
    if (!art || !esMercCreditoTitulo(art.tituloMercancia) || !art.proveedorId) {
      notify('warning', '⚠️', 'Artículo', 'Solo aplica a mercancía a crédito con proveedor.', { duration: 3500 });
      return;
    }
    if (String(art.proveedorId) !== String(provId)) {
      notify('warning', '⚠️', 'Proveedor', 'El artículo no corresponde a este proveedor.', { duration: 3500 });
      return;
    }
    const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(provId));
    const provNombre = prov?.nombre || '';
    const pc = parseFloat(art.precioCompra) || 0;
    const acum = sumDeltaUnidadesModulo(state, provId, artId);
    const historial = (state.tes_ajustes_unidades_prov || [])
      .filter((r) => String(r.proveedorId) === String(provId) && String(r.articuloId) === String(artId))
      .slice()
      .sort((a, b) => new Date(b.fechaHora || 0).getTime() - new Date(a.fechaHora || 0).getTime())
      .slice(0, 12);
    const histRows =
      historial.length === 0
        ? '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:12px;font-size:11px">Sin movimientos aún</td></tr>'
        : historial
            .map(
              (r) =>
                `<tr><td style="font-size:10px;white-space:nowrap">${fmtLineaHora(r.fechaHora)}</td><td style="font-weight:700">${(parseFloat(r.deltaUnidades) || 0) > 0 ? '+' : ''}${parseFloat(r.deltaUnidades) || 0}</td><td style="font-size:10px;color:var(--text2)">${String(r.nota || '—').replace(/</g, '&lt;')}</td><td><button type="button" class="btn btn-xs btn-danger" onclick="eliminarAjusteUnidadesProv('${r.id}','${provId}','${artId}')">✕</button></td></tr>`
            )
            .join('');
    const tituloArt = String(art.nombre || art.codigo || artId).replace(/</g, '&lt;');
    openModal(`<div class="modal-title">Ajuste de unidades (solo deuda)<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">No modifica <b>inventario</b>. Suma o resta unidades <b>virtuales</b> para este proveedor: el impacto en deuda es <b>unidades × costo actual</b> (${fmt(pc)}).</p>
    <div style="font-size:12px;margin-bottom:10px"><b>${tituloArt}</b><div style="font-size:10px;color:var(--text2);margin-top:4px">${provNombre} · acumulado ajuste: <b>${acum > 0 ? '+' : ''}${acum}</b> uds</div></div>
    <div class="form-group"><label class="form-label">UNIDADES (+ sumar deuda · − restar)</label><input type="number" class="form-control" id="apu-delta" step="1" placeholder="Ej: 2 o -1"></div>
    <div class="form-group"><label class="form-label">NOTA (opcional)</label><input class="form-control" id="apu-nota" placeholder="Motivo del ajuste"></div>
    <p style="font-size:11px;color:var(--accent);margin:0 0 12px" id="apu-preview">Impacto estimado: —</p>
    <button class="btn btn-primary" style="width:100%;margin-bottom:14px" onclick="guardarAjusteUnidadesProv('${provId}','${artId}')">Guardar ajuste</button>
    <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">Últimos movimientos (este artículo)</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Δ uds</th><th>Nota</th><th></th></tr></thead><tbody>${histRows}</tbody></table></div>`);
    setTimeout(() => {
      const inp = document.getElementById('apu-delta');
      const prev = document.getElementById('apu-preview');
      const recalc = () => {
        const d = parseFloat(inp?.value);
        if (!prev) return;
        if (!Number.isFinite(d) || d === 0) {
          prev.textContent = 'Impacto estimado: —';
          return;
        }
        prev.textContent = `Impacto estimado: ${d > 0 ? '+' : ''}${fmt(d * pc)} (${d > 0 ? '+' : ''}${d} uds × ${fmt(pc)})`;
      };
      if (inp) {
        inp.addEventListener('input', recalc);
        inp.focus();
      }
      recalc();
    }, 50);
  }

  async function guardarAjusteUnidadesProv(ctx) {
    const {
      state,
      provId,
      artId,
      uid,
      dbId,
      showLoadingOverlay,
      supabaseClient,
      closeModal,
      renderTesPagosProv,
      notify,
      fmt,
      saveRecord
    } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const delta = parseFloat(document.getElementById('apu-delta')?.value || '');
    const nota = (document.getElementById('apu-nota')?.value || '').trim();
    if (!Number.isFinite(delta) || delta === 0) {
      notify('warning', '⚠️', 'Unidades', 'Ingresa un número distinto de cero (entero recomendado).', { duration: 3500 });
      return;
    }
    const art = (state.articulos || []).find((a) => String(a.id) === String(artId));
    const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(provId));
    if (!art || !prov) {
      notify('warning', '⚠️', 'Datos', 'Artículo o proveedor no encontrado.', { duration: 3000 });
      return;
    }
    const row = {
      id: nextId(),
      proveedorId: provId,
      articuloId: artId,
      deltaUnidades: delta,
      nota,
      fechaHora: new Date().toISOString()
    };
    try {
      showLoadingOverlay('connecting');
      const useSave = typeof saveRecord === 'function';
      if (useSave) {
        const ok = await saveRecord('tes_ajustes_unidades_prov', row.id, row);
        if (!ok) throw new Error('No se pudo guardar el ajuste.');
      } else {
        const { error } = await supabaseClient.from('tes_ajustes_unidades_prov').upsert(
          {
            id: row.id,
            proveedor_id: provId,
            articulo_id: artId,
            delta_unidades: delta,
            nota: nota || null,
            fecha_hora: row.fechaHora
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
      }
      if (!state.tes_ajustes_unidades_prov) state.tes_ajustes_unidades_prov = [];
      state.tes_ajustes_unidades_prov.unshift(row);
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      const pc = parseFloat(art.precioCompra) || 0;
      notify('success', '±', 'Ajuste guardado', `${delta > 0 ? '+' : ''}${delta} uds · ${fmt(delta * pc)}`, { duration: 3500 });
    } catch (err) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', err.message || String(err), { duration: 6000 });
      console.error(err);
    }
  }

  async function eliminarAjusteUnidadesProv(ctx) {
    const { state, id, confirm, supabaseClient, renderTesPagosProv, notify, closeModal, reopen } = ctx;
    if (!confirm('¿Eliminar este ajuste de unidades? La deuda se recalculará.')) return;
    try {
      const { error } = await supabaseClient.from('tes_ajustes_unidades_prov').delete().eq('id', id);
      if (error) throw error;
      state.tes_ajustes_unidades_prov = (state.tes_ajustes_unidades_prov || []).filter((r) => r.id !== id);
      if (typeof closeModal === 'function') closeModal();
      renderTesPagosProv();
      notify('success', '🗑️', 'Ajuste eliminado', 'Deuda recalculada.', { duration: 2000 });
      if (typeof reopen === 'function') setTimeout(() => reopen(), 80);
    } catch (e) {
      console.warn('eliminarAjusteUnidadesProv:', e.message || e);
      notify('danger', '⚠️', 'No se pudo eliminar', e.message || 'Error en base de datos', { duration: 4500 });
    }
  }

  function findMovimientoAbonoProveedor(state, abonoId, ab) {
    const list = state.tes_movimientos || [];
    const byCol = list.find(
      (m) =>
        m.categoria === 'abono_proveedor' &&
        m.refAbonoProvId != null &&
        String(m.refAbonoProvId) === String(abonoId)
    );
    if (byCol) return byCol;
    const byRef = list.find(
      (m) => m.categoria === 'abono_proveedor' && String(m.concepto || '').includes(`ref:${abonoId}`)
    );
    if (byRef) return byRef;
    if (!ab) return null;
    const v = parseFloat(ab.valor) || 0;
    const met = String(ab.metodo || '');
    const f = String(ab.fecha || '');
    const candidates = list.filter(
      (m) =>
        m.categoria === 'abono_proveedor' &&
        m.tipo === 'egreso' &&
        Math.abs((parseFloat(m.valor) || 0) - v) < 0.01 &&
        String(m.metodo || '') === met &&
        String(m.fecha || '') === f
    );
    if (candidates.length === 1) return candidates[0];
    return null;
  }

  async function eliminarAbonoProv(ctx) {
    const { state, id, confirm, supabaseClient, saveRecord, renderTesPagosProv, notify, renderTesCajas } = ctx;
    if (!confirm('¿Eliminar este abono? El saldo pendiente se recalculará.')) return;
    const ab = (state.tes_abonos_prov || []).find((x) => String(x.id) === String(id));
    const mov = findMovimientoAbonoProveedor(state, id, ab);
    try {
      if (mov) {
        const caja = (state.cajas || []).find((c) => c.id === mov.cajaId);
        const bucket =
          (mov.bucket && String(mov.bucket)) ||
          global.AppCajaLogic?.bucketFromMetodoId?.(mov.metodo, state.cfg_metodos_pago) ||
          'efectivo';
        const valorMov = parseFloat(mov.valor) || 0;
        if (caja && typeof saveRecord === 'function') {
          global.AppCajaLogic?.normalizeCaja?.(caja);
          global.AppCajaLogic?.applyDeltaBucket?.(caja, bucket, valorMov);
          const okCaja = await saveRecord('cajas', caja.id, caja);
          if (!okCaja) {
            global.AppCajaLogic?.applyDeltaBucket?.(caja, bucket, -valorMov);
            throw new Error('No se pudo guardar la caja al revertir el egreso del abono.');
          }
        }
        const { error: delMovErr } = await supabaseClient.from('tes_movimientos').delete().eq('id', mov.id);
        if (delMovErr) {
          if (caja && typeof saveRecord === 'function') {
            global.AppCajaLogic?.applyDeltaBucket?.(caja, bucket, -valorMov);
            await saveRecord('cajas', caja.id, caja);
          }
          throw delMovErr;
        }
        state.tes_movimientos = (state.tes_movimientos || []).filter((m) => m.id !== mov.id);
      }

      const { error } = await supabaseClient.from('tes_abonos_prov').delete().eq('id', id);
      if (error) throw error;
      state.tes_abonos_prov = (state.tes_abonos_prov || []).filter((x) => String(x.id) !== String(id));
      const cxpIds = [`cxp-abono-${id}`, `cxp-leg-ab-${id}`];
      for (let i = 0; i < cxpIds.length; i++) {
        await supabaseClient.from('tes_cxp_movimientos').delete().eq('id', cxpIds[i]);
      }
      state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => !cxpIds.includes(r.id));
      renderTesPagosProv();
      if (typeof renderTesCajas === 'function') renderTesCajas();
      notify('success', '🗑️', 'Abono eliminado', 'Saldo recalculado.', { duration: 2000 });
    } catch (e) {
      console.warn('Error eliminando abono:', e.message || e);
      notify('danger', '⚠️', 'No se pudo eliminar', e.message || 'Error en base de datos', { duration: 4500 });
    }
  }

  function verLibroProveedorModal(ctx) {
    const { state, provId, provNombre, fmt, formatDate, openModal } = ctx;
    const rows = [];
    (state.tes_libro_proveedor || [])
      .filter((r) => String(r.proveedorId) === String(provId))
      .forEach((r) => {
        const label = r.tipo === 'correccion' ? 'Corrección de deuda' : 'Registro de deuda (artículo)';
        rows.push({
          sort: new Date(r.fechaHora || 0).getTime(),
          html: `<tr><td style="font-size:11px;white-space:nowrap">${fmtLineaHora(r.fechaHora)}</td><td><span class="badge badge-warn">${label}</span></td><td style="font-size:11px;color:var(--text2)">${(r.descripcion || '—').replace(/</g, '&lt;')}</td><td style="font-weight:700">${fmt(r.valor || 0)}</td></tr>`
        });
      });
    (state.tes_abonos_prov || [])
      .filter((a) => String(a.proveedorId) === String(provId))
      .forEach((a) => {
        const fh = a.fechaHora || a.fecha;
        rows.push({
          sort: new Date(fh || a.fecha || 0).getTime(),
          html: `<tr><td style="font-size:11px;white-space:nowrap">${fmtLineaHora(a.fechaHora || null) || formatDate(a.fecha)}</td><td><span class="badge badge-ok">Abono</span></td><td style="font-size:11px;color:var(--text2)">${(a.metodo || '') + (a.nota ? ' · ' + a.nota : '')}</td><td style="font-weight:700;color:var(--green)">${fmt(a.valor || 0)}</td></tr>`
        });
      });
    (state.tes_devoluciones_prov || [])
      .filter((dv) => String(dv.proveedorId) === String(provId))
      .forEach((dv) => {
        rows.push({
          sort: new Date(dv.fechaHora || 0).getTime(),
          html: `<tr><td style="font-size:11px;white-space:nowrap">${fmtLineaHora(dv.fechaHora)}</td><td><span class="badge badge-vitrina">Devolución</span></td><td style="font-size:11px;color:var(--text2)">${String(dv.nota || dv.articuloNombre || '—').replace(/</g, '&lt;')}</td><td style="font-weight:700;color:var(--accent)">−${fmt(dv.valorCosto || 0)}</td></tr>`
        });
      });
    (state.tes_ajustes_unidades_prov || [])
      .filter((r) => String(r.proveedorId) === String(provId))
      .forEach((r) => {
        const artA = (state.articulos || []).find((a) => String(a.id) === String(r.articuloId));
        const nm = artA ? artA.nombre || artA.codigo || r.articuloId : r.articuloId;
        const pc = artA ? parseFloat(artA.precioCompra) || 0 : 0;
        const du = parseFloat(r.deltaUnidades) || 0;
        const val = du * pc;
        const col = val >= 0 ? 'var(--red)' : 'var(--green)';
        const sign = val >= 0 ? '+' : '−';
        const absVal = Math.abs(val);
        rows.push({
          sort: new Date(r.fechaHora || 0).getTime(),
          html: `<tr><td style="font-size:11px;white-space:nowrap">${fmtLineaHora(r.fechaHora)}</td><td><span class="badge badge-pend">Ajuste uds (mód.)</span></td><td style="font-size:11px;color:var(--text2)">${String(nm).replace(/</g, '&lt;')}: ${du > 0 ? '+' : ''}${du} uds × ${fmt(pc)}${r.nota ? ' · ' + String(r.nota).replace(/</g, '&lt;') : ''}</td><td style="font-weight:700;color:${col}">${sign}${fmt(absVal)}</td></tr>`
        });
      });
    rows.sort((a, b) => b.sort - a.sort);
    const tbody = rows.length ? rows.map((r) => r.html).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:20px">Sin movimientos en libro</td></tr>';
    openModal(`<div class="modal-title">📔 Libro — ${provNombre.replace(/</g, '&lt;')}<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">Deuda, abonos, <b>devoluciones</b> y <b>ajustes de unidades</b> (solo módulo pagos) con fecha y hora.</p>
    <div class="table-wrap"><table><thead><tr><th>Fecha / hora</th><th>Tipo</th><th>Detalle</th><th>Valor</th></tr></thead><tbody>${tbody}</tbody></table></div>`);
  }

  async function quitarCreditoArticuloProveedor(ctx) {
    const {
      state,
      artId,
      confirm,
      supabaseClient,
      showLoadingOverlay,
      renderTesPagosProv,
      notify,
      fmt,
      dbId,
      uid,
      renderArticulosList,
      renderArticulos,
      updateNavBadges
    } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const art = (state.articulos || []).find((a) => String(a.id) === String(artId));
    if (!art || !esMercCreditoTitulo(art.tituloMercancia) || !art.proveedorId) {
      notify('warning', '⚠️', 'Sin crédito', 'Este artículo no está a crédito con proveedor.', { duration: 3000 });
      return;
    }
    const provId = art.proveedorId;
    const provNombre = art.proveedorNombre || (state.usu_proveedores || []).find((p) => String(p.id) === String(provId))?.nombre || '';
    const refAntes = lineaRefDeudaArticulo(state, art, provId);
    if (!confirm('¿Está seguro de editar esta deuda? Se quitará la mercancía a crédito de este artículo. El stock no se modifica desde este módulo.')) return;
    if (!confirm('Confirme que desea continuar con la corrección de la deuda.')) return;
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient
        .from('products')
        .update({
          titulo_mercancia: 'contado',
          proveedor_id: null,
          proveedor_nombre: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', artId);
      if (error) throw error;
      art.tituloMercancia = 'contado';
      art.proveedorId = null;
      art.proveedorNombre = '';
      const desc = `Corrección: quitado crédito · ${art.nombre || art.codigo || artId}`;
      const libroRow = {
        id: nextId(),
        proveedorId: provId,
        proveedorNombre: provNombre,
        tipo: 'correccion',
        articuloId: artId,
        descripcion: desc,
        valor: refAntes,
        fechaHora: new Date().toISOString()
      };
      const { error: e2 } = await supabaseClient.from('tes_libro_proveedor').insert({
        id: libroRow.id,
        proveedor_id: provId,
        proveedor_nombre: provNombre,
        tipo: 'correccion',
        articulo_id: artId,
        descripcion: desc,
        valor: refAntes,
        fecha_hora: libroRow.fechaHora
      });
      if (e2) console.warn('tes_libro_proveedor:', e2.message);
      else {
        if (!state.tes_libro_proveedor) state.tes_libro_proveedor = [];
        state.tes_libro_proveedor.unshift(libroRow);
      }
      showLoadingOverlay('hide');
      if (typeof renderArticulosList === 'function' && document.getElementById('art-tbody')) renderArticulosList();
      else if (typeof renderArticulos === 'function') renderArticulos();
      renderTesPagosProv();
      if (typeof updateNavBadges === 'function') updateNavBadges();
      notify('success', '✅', 'Deuda corregida', `Referencia anterior: ${fmt(refAntes)}`, { duration: 4000 });
    } catch (err) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', err.message || String(err), { duration: 5000 });
      console.error(err);
    }
  }

  async function logRegistroDeudaArticulo(ctx) {
    const { state, supabaseClient, dbId, uid, artLocal } = ctx;
    if (!artLocal || !esMercCreditoTitulo(artLocal.tituloMercancia) || !artLocal.proveedorId) return;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(artLocal.proveedorId));
    const provNombre = prov?.nombre || artLocal.proveedorNombre || '';
    const pc = parseFloat(artLocal.precioCompra) || 0;
    const st = parseFloat(artLocal.stock) || 0;
    const valor = pc * st;
    const descripcionSafe = `Alta deuda por artículo: ${artLocal.nombre || artLocal.codigo || ''} (${st} uds × costo ${pc})`;
    const fechaHora = new Date().toISOString();
    const row = {
      id: nextId(),
      proveedorId: artLocal.proveedorId,
      proveedorNombre: provNombre,
      tipo: 'registro_deuda',
      articuloId: artLocal.id,
      descripcion: descripcionSafe,
      valor,
      fechaHora
    };
    const { error } = await supabaseClient.from('tes_libro_proveedor').insert({
      id: row.id,
      proveedor_id: artLocal.proveedorId,
      proveedor_nombre: provNombre,
      tipo: 'registro_deuda',
      articulo_id: artLocal.id,
      descripcion: descripcionSafe,
      valor,
      fecha_hora: fechaHora
    });
    if (error) {
      console.warn('[libro proveedor]', error.message);
      return;
    }
    if (!state.tes_libro_proveedor) state.tes_libro_proveedor = [];
    state.tes_libro_proveedor.unshift(row);
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
    _lastTesDineroCtx = ctx;
    const { state, formatDate, fmt, today } = ctx;
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
        const da = normFechaMov(a.fecha);
        const db = normFechaMov(b.fecha);
        if (da !== db) return db.localeCompare(da);
        return String(b.id || '').localeCompare(String(a.id || ''));
      });

    let sumLocal = 0;
    let sumInter = 0;
    let sumVitrina = 0;
    let sumPosTotal = 0;
    for (let i = 0; i < movsFiltered.length; i++) {
      const m = movsFiltered[i];
      if (m.categoria !== 'venta_pos' || m.tipo !== 'ingreso') continue;
      const val = parseFloat(m.valor) || 0;
      sumPosTotal += val;
      const canal = canalVentaPos(state, m);
      if (canal === 'local') sumLocal += val;
      else if (canal === 'inter') sumInter += val;
      else if (canal === 'vitrina') sumVitrina += val;
    }

    const rows =
      movsFiltered
        .map((m) => {
          const caja = (state.cajas || []).find((c) => c.id === m.cajaId);
          return `<tr><td>${formatDate(m.fecha)}</td><td>${caja?.nombre || '—'}</td><td><span class="badge ${m.tipo === 'ingreso' ? 'badge-ok' : 'badge-pend'}">${m.tipo}</span></td><td style="color:${m.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)'};font-weight:700">${fmt(m.valor)}</td><td style="font-size:11px">${m.bucket || '—'}</td><td style="font-size:11px;color:var(--text2)">${m.categoria || '—'}</td><td>${m.concepto || '—'}</td><td>${m.metodo || '—'}</td></tr>`;
        })
        .join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:24px">Sin movimientos</td></tr>';

    document.getElementById('tes_dinero-content').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:12px">
      <div class="form-group" style="margin:0"><label class="form-label">Desde</label><input type="date" class="form-control" id="tes-dinero-desde" value="${desde}"></div>
      <div class="form-group" style="margin:0"><label class="form-label">Hasta</label><input type="date" class="form-control" id="tes-dinero-hasta" value="${hasta}"></div>
      <button type="button" class="btn btn-secondary" onclick="renderTesDinero()">Filtrar</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px">
      <div class="card" style="padding:10px 12px;margin:0"><div style="font-size:10px;color:var(--text2)">Mensajería local</div><div style="font-weight:800;color:var(--green)">${fmt(sumLocal)}</div></div>
      <div class="card" style="padding:10px 12px;margin:0"><div style="font-size:10px;color:var(--text2)">Mensajería intermunicipal</div><div style="font-weight:800;color:var(--green)">${fmt(sumInter)}</div></div>
      <div class="card" style="padding:10px 12px;margin:0"><div style="font-size:10px;color:var(--text2)">Vitrina</div><div style="font-weight:800;color:var(--green)">${fmt(sumVitrina)}</div></div>
      <div class="card" style="padding:10px 12px;margin:0;border:1px solid rgba(0,229,180,.35)"><div style="font-size:10px;color:var(--text2)">Total ventas POS (periodo)</div><div style="font-weight:800;color:var(--accent)">${fmt(sumPosTotal)}</div></div>
    </div>
    <div class="card"><div class="card-title">MOVIMIENTOS DE DINERO (${movsFiltered.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Caja</th><th>Tipo</th><th>Valor</th><th>Bucket</th><th>Clase</th><th>Concepto</th><th>Método</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
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

  function escCxp(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildArticulosCreditoProveedorOptions(state, provId) {
    const arts = (state.articulos || []).filter(
      (a) => esMercCreditoTitulo(a.tituloMercancia) && String(a.proveedorId) === String(provId)
    );
    if (arts.length === 0) {
      return `<option value="">— Sin artículos a crédito —</option>`;
    }
    return (
      '<option value="">— Artículo —</option>' +
      arts
        .map((a) => {
          const nm = escCxp(a.nombre || a.descripcion || a.id);
          const pc = parseFloat(a.precioCompra) || 0;
          return `<option value="${escCxp(a.id)}" data-nombre="${nm}" data-costo="${pc}">${nm}</option>`;
        })
        .join('')
    );
  }

  function buildCxpCargoLineaRow(state, provId) {
    const opts = buildArticulosCreditoProveedorOptions(state, provId);
    return `<tr data-cxp-line>
  <td><select class="form-control cxp-cargo-art" onchange="AppTreasuryModule.cxpCargoArticuloChange(this)">${opts}</select></td>
  <td><input type="number" class="form-control cxp-cargo-qty" min="1" step="1" value="1" oninput="AppTreasuryModule.cxpCargoRecalcTotal()"></td>
  <td><input type="number" class="form-control cxp-cargo-cu" min="0" step="any" value="0" oninput="AppTreasuryModule.cxpCargoRecalcTotal()"></td>
  <td style="font-size:11px" class="cxp-cargo-sub">—</td>
  <td><button type="button" class="btn btn-xs btn-secondary" onclick="AppTreasuryModule.cxpCargoRemoveLinea(this)">✕</button></td>
</tr>`;
  }

  function buildCpCompLineaRow(state, provId) {
    const opts = buildArticulosCreditoProveedorOptions(state, provId);
    return `<tr data-cp-line>
  <td><select class="form-control cp-comp-art" onchange="AppTreasuryModule.cpCompArticuloChange(this)">${opts}</select></td>
  <td><input type="number" class="form-control cp-comp-qty" min="1" step="1" value="1" oninput="AppTreasuryModule.cpCompRecalcTotal()"></td>
  <td><input type="number" class="form-control cp-comp-cu" min="0" step="any" value="0" oninput="AppTreasuryModule.cpCompRecalcTotal()"></td>
  <td style="font-size:11px" class="cp-comp-sub">—</td>
  <td><button type="button" class="btn btn-xs btn-secondary" onclick="AppTreasuryModule.cpCompRemoveLinea(this)">✕</button></td>
</tr>`;
  }

  function cpCompOnProvChange() {
    if (!_compromisoModalCtx) return;
    const { state } = _compromisoModalCtx;
    const sel = document.getElementById('cp-prov-sel');
    const provId = sel?.value;
    const tb = document.getElementById('cp-lineas-tbody');
    if (!tb || !provId) return;
    tb.innerHTML = buildCpCompLineaRow(state, provId);
    cpCompRecalcTotal();
  }

  function cpCompToggleModo() {
    const det = document.getElementById('cp-mod-detalle')?.checked;
    const wrapL = document.getElementById('cp-lineas-wrap');
    const wrapS = document.getElementById('cp-solo-wrap');
    if (wrapL) wrapL.style.display = det ? 'block' : 'none';
    if (wrapS) wrapS.style.display = det ? 'none' : 'block';
    cpCompRecalcTotal();
  }

  function cpCompAddLinea() {
    if (!_compromisoModalCtx) return;
    const { state, notify } = _compromisoModalCtx;
    const sel = document.getElementById('cp-prov-sel');
    const provId = sel?.value;
    const tb = document.getElementById('cp-lineas-tbody');
    if (!tb || !provId) {
      notify('warning', '⚠️', 'Proveedor', 'Selecciona un proveedor primero.', { duration: 2500 });
      return;
    }
    const wrap = document.createElement('tbody');
    wrap.innerHTML = buildCpCompLineaRow(state, provId);
    tb.appendChild(wrap.firstChild);
    cpCompRecalcTotal();
  }

  function cpCompRemoveLinea(btn) {
    const tr = btn.closest('tr');
    const tb = document.getElementById('cp-lineas-tbody');
    if (!tr || !tb) return;
    tr.remove();
    if (!tb.querySelectorAll('tr[data-cp-line]').length) {
      cpCompOnProvChange();
      return;
    }
    cpCompRecalcTotal();
  }

  function cpCompArticuloChange(sel) {
    const tr = sel.closest('tr');
    const opt = sel.options[sel.selectedIndex];
    const cu = parseFloat(opt?.getAttribute('data-costo')) || 0;
    const cuIn = tr?.querySelector('.cp-comp-cu');
    if (cuIn && sel.value) cuIn.value = cu;
    cpCompRecalcTotal();
  }

  function cpCompRecalcTotal() {
    const tb = document.getElementById('cp-lineas-tbody');
    const totalEl = document.getElementById('cp-total-monto');
    const fmt = _compromisoModalCtx?.fmt;
    if (!tb) return;
    let sum = 0;
    tb.querySelectorAll('tr[data-cp-line]').forEach((tr) => {
      const qty = parseFloat(tr.querySelector('.cp-comp-qty')?.value) || 0;
      const cu = parseFloat(tr.querySelector('.cp-comp-cu')?.value) || 0;
      const sub = qty * cu;
      sum += sub;
      const subEl = tr.querySelector('.cp-comp-sub');
      if (subEl) subEl.textContent = fmt ? fmt(sub) : String(sub);
    });
    if (totalEl) totalEl.textContent = fmt ? fmt(sum) : String(sum);
  }

  function cxpCargoOnProvChange() {
    if (!_cargoModalCtx) return;
    const { state } = _cargoModalCtx;
    const sel = document.getElementById('cxp-cargo-prov');
    const provId = sel?.value;
    const tb = document.getElementById('cxp-cargo-lineas-tbody');
    if (!tb || !provId) return;
    tb.innerHTML = buildCxpCargoLineaRow(state, provId);
    cxpCargoRecalcTotal();
  }

  function cxpCargoToggleModo() {
    const det = document.getElementById('cxp-cargo-mod-detalle')?.checked;
    const wrapL = document.getElementById('cxp-cargo-lineas-wrap');
    const wrapS = document.getElementById('cxp-cargo-solo-wrap');
    if (wrapL) wrapL.style.display = det ? 'block' : 'none';
    if (wrapS) wrapS.style.display = det ? 'none' : 'block';
    cxpCargoRecalcTotal();
  }

  function cxpCargoAddLinea() {
    if (!_cargoModalCtx) return;
    const { state, notify } = _cargoModalCtx;
    const sel = document.getElementById('cxp-cargo-prov');
    const provId = sel?.value;
    const tb = document.getElementById('cxp-cargo-lineas-tbody');
    if (!tb || !provId) {
      notify('warning', '⚠️', 'Proveedor', 'Selecciona un proveedor primero.', { duration: 2500 });
      return;
    }
    const wrap = document.createElement('tbody');
    wrap.innerHTML = buildCxpCargoLineaRow(state, provId);
    tb.appendChild(wrap.firstChild);
    cxpCargoRecalcTotal();
  }

  function cxpCargoRemoveLinea(btn) {
    const tr = btn.closest('tr');
    const tb = document.getElementById('cxp-cargo-lineas-tbody');
    if (!tr || !tb) return;
    tr.remove();
    if (!tb.querySelectorAll('tr[data-cxp-line]').length) {
      cxpCargoOnProvChange();
      return;
    }
    cxpCargoRecalcTotal();
  }

  function cxpCargoArticuloChange(sel) {
    const tr = sel.closest('tr');
    const opt = sel.options[sel.selectedIndex];
    const cu = parseFloat(opt?.getAttribute('data-costo')) || 0;
    const cuIn = tr?.querySelector('.cxp-cargo-cu');
    if (cuIn && sel.value) cuIn.value = cu;
    cxpCargoRecalcTotal();
  }

  function cxpCargoRecalcTotal() {
    const tb = document.getElementById('cxp-cargo-lineas-tbody');
    const totalEl = document.getElementById('cxp-cargo-total-monto');
    const fmt = _cargoModalCtx?.fmt;
    if (!tb) return;
    let sum = 0;
    tb.querySelectorAll('tr[data-cxp-line]').forEach((tr) => {
      const qty = parseFloat(tr.querySelector('.cxp-cargo-qty')?.value) || 0;
      const cu = parseFloat(tr.querySelector('.cxp-cargo-cu')?.value) || 0;
      const sub = qty * cu;
      sum += sub;
      const subEl = tr.querySelector('.cxp-cargo-sub');
      if (subEl) subEl.textContent = fmt ? fmt(sub) : String(sub);
    });
    if (totalEl) totalEl.textContent = fmt ? fmt(sum) : String(sum);
  }

  function openCargoCxpModal(ctx) {
    const { state, provId = '', provNombre = '', openModal, notify, today, fmt } = ctx;
    _cargoModalCtx = { state, notify, fmt };
    const provs = state.usu_proveedores || [];
    if (provs.length === 0) {
      notify('warning', '⚠️', 'Proveedores', 'Crea al menos un proveedor.', { duration: 3000 });
      return;
    }
    const optHtml = provs
      .map((o) => {
        const sel = o.id === provId ? 'selected' : '';
        const nm = escCxp(o.nombre);
        return `<option value="${escCxp(o.id)}" data-nombre="${nm}" ${sel}>${nm}</option>`;
      })
      .join('');
    openModal(`<div class="modal-title">＋ Cargo compra (libro CXP)<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">Aumenta la deuda reconocida con el proveedor (factura, remisión, compra a crédito). No modifica inventario. Con <b>detalle por artículo</b> el sistema puede atribuir ventas POS (FIFO) y sugerir abonos a costo.</p>
    <div class="form-group"><label class="form-label">Proveedor *</label><select class="form-control" id="cxp-cargo-prov" onchange="AppTreasuryModule.cxpCargoOnProvChange()">${optHtml}</select></div>
    <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:12px;margin-bottom:10px;line-height:1.35">
      <input type="checkbox" id="cxp-cargo-mod-detalle" checked onchange="AppTreasuryModule.cxpCargoToggleModo()" style="margin-top:2px">
      <span>Detalle por artículo (artículos a crédito del proveedor; total = Σ cantidad × costo)</span>
    </label>
    <div id="cxp-cargo-lineas-wrap">
      <div class="table-wrap" style="margin-bottom:8px"><table style="font-size:12px"><thead><tr><th>Artículo</th><th style="width:88px">Cant.</th><th style="width:110px">Costo u.</th><th style="width:100px">Subtotal</th><th></th></tr></thead><tbody id="cxp-cargo-lineas-tbody"></tbody></table></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <button type="button" class="btn btn-sm btn-secondary" onclick="AppTreasuryModule.cxpCargoAddLinea()">＋ Línea</button>
        <span style="font-size:12px;color:var(--text2)">Total cargo:</span> <span id="cxp-cargo-total-monto" style="font-weight:700;color:var(--yellow)">—</span>
      </div>
    </div>
    <div id="cxp-cargo-solo-wrap" style="display:none">
    <div class="form-group"><label class="form-label">Monto (COP) *</label><input type="number" class="form-control" id="cxp-cargo-valor" min="0" step="any" placeholder="0"></div>
    </div>
    <div class="form-row"><div class="form-group"><label class="form-label">Fecha</label><input type="date" class="form-control" id="cxp-cargo-fecha" value="${today()}"></div></div>
    <div class="form-group"><label class="form-label">Referencia</label><input class="form-control" id="cxp-cargo-ref" placeholder="N° factura / remisión"></div>
    <div class="form-group"><label class="form-label">Nota</label><input class="form-control" id="cxp-cargo-nota" placeholder="Observación"></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarCargoCxpMov()">Guardar cargo</button>`);
    setTimeout(() => {
      const s = document.getElementById('cxp-cargo-prov');
      if (s && provId) s.value = provId;
      cxpCargoOnProvChange();
      cxpCargoToggleModo();
    }, 50);
  }

  function openNotaCreditoCxpModal(ctx) {
    const { state, provId = '', openModal, notify, today } = ctx;
    const provs = state.usu_proveedores || [];
    if (provs.length === 0) {
      notify('warning', '⚠️', 'Proveedores', 'Crea al menos un proveedor.', { duration: 3000 });
      return;
    }
    const optHtml = provs
      .map((o) => {
        const sel = o.id === provId ? 'selected' : '';
        const nm = escCxp(o.nombre);
        return `<option value="${escCxp(o.id)}" data-nombre="${nm}" ${sel}>${nm}</option>`;
      })
      .join('');
    openModal(`<div class="modal-title">📄 Nota de crédito (libro CXP)<button class="modal-close" onclick="closeModal()">×</button></div>
    <p style="font-size:11px;color:var(--text2);line-height:1.45;margin:0 0 12px">Reduce el saldo por pagar (NC del proveedor, descuento acordado). No mueve caja sola.</p>
    <div class="form-group"><label class="form-label">Proveedor *</label><select class="form-control" id="cxp-nc-prov">${optHtml}</select></div>
    <div class="form-row"><div class="form-group"><label class="form-label">Monto (COP) *</label><input type="number" class="form-control" id="cxp-nc-valor" min="0" step="any"></div>
    <div class="form-group"><label class="form-label">Fecha</label><input type="date" class="form-control" id="cxp-nc-fecha" value="${today()}"></div></div>
    <div class="form-group"><label class="form-label">Referencia</label><input class="form-control" id="cxp-nc-ref" placeholder="N° nota crédito"></div>
    <div class="form-group"><label class="form-label">Nota</label><input class="form-control" id="cxp-nc-nota"></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarNotaCreditoCxpMov()">Guardar nota crédito</button>`);
    if (provId) {
      setTimeout(() => {
        const s = document.getElementById('cxp-nc-prov');
        if (s) s.value = provId;
      }, 50);
    }
  }

  async function guardarCargoCxpMov(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, closeModal, renderTesPagosProv, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const sel = document.getElementById('cxp-cargo-prov');
    const opt = sel?.options[sel.selectedIndex];
    const provId = sel?.value;
    const provNombre = opt?.getAttribute('data-nombre') || '';
    const fecha = document.getElementById('cxp-cargo-fecha')?.value || today();
    const referencia = document.getElementById('cxp-cargo-ref')?.value.trim() || '';
    const nota = document.getElementById('cxp-cargo-nota')?.value.trim() || '';
    const modoDetalle = document.getElementById('cxp-cargo-mod-detalle')?.checked;
    let lineas = [];
    let valor = 0;
    if (modoDetalle) {
      const tb = document.getElementById('cxp-cargo-lineas-tbody');
      tb?.querySelectorAll('tr[data-cxp-line]').forEach((tr) => {
        const selArt = tr.querySelector('.cxp-cargo-art');
        const aid = selArt?.value;
        const qty = parseFloat(tr.querySelector('.cxp-cargo-qty')?.value) || 0;
        const cu = parseFloat(tr.querySelector('.cxp-cargo-cu')?.value) || 0;
        if (!aid || qty <= 0) return;
        const optArt = selArt.options[selArt.selectedIndex];
        const nombre = optArt?.getAttribute('data-nombre') || '';
        lineas.push({
          articulo_id: aid,
          articulo_nombre: nombre,
          cantidad: qty,
          costo_unitario: cu
        });
      });
      valor = lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0);
      if (!provId || !lineas.length || valor <= 0) {
        notify('warning', '⚠️', 'Datos', 'Proveedor y al menos una línea con artículo, cantidad y costo válidos.', { duration: 4000 });
        return;
      }
    } else {
      valor = parseFloat(document.getElementById('cxp-cargo-valor')?.value || 0);
      lineas = [];
      if (!provId || valor <= 0) {
        notify('warning', '⚠️', 'Datos', 'Proveedor y monto válido requeridos.', { duration: 3000 });
        return;
      }
    }
    const id = nextId();
    const fechaHora = new Date().toISOString();
    const row = {
      id,
      proveedor_id: provId,
      proveedor_nombre: provNombre,
      tipo: 'cargo_compra',
      naturaleza: 'cargo',
      monto: valor,
      fecha,
      referencia: referencia || null,
      nota: nota || null,
      meta: { origen: 'manual_cargo', lineas_detalle: lineas.length > 0 },
      lineas: lineas.length ? lineas : [],
      fecha_hora: fechaHora
    };
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from('tes_cxp_movimientos').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
      state.tes_cxp_movimientos.unshift({
        id,
        proveedorId: provId,
        proveedorNombre: provNombre,
        tipo: 'cargo_compra',
        naturaleza: 'cargo',
        monto: valor,
        fecha,
        referencia,
        nota,
        meta: row.meta,
        lineas: lineas.length ? lineas : [],
        fechaHora: fechaHora
      });
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      notify('success', '📥', 'Cargo CXP', `${fmt(valor)} · ${provNombre}`, { duration: 3000 });
    } catch (e) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', e.message || String(e), { duration: 5000 });
    }
  }

  async function guardarNotaCreditoCxpMov(ctx) {
    const { state, uid, dbId, today, showLoadingOverlay, supabaseClient, closeModal, renderTesPagosProv, notify, fmt } = ctx;
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const sel = document.getElementById('cxp-nc-prov');
    const opt = sel?.options[sel.selectedIndex];
    const provId = sel?.value;
    const provNombre = opt?.getAttribute('data-nombre') || '';
    const valor = parseFloat(document.getElementById('cxp-nc-valor')?.value || 0);
    const fecha = document.getElementById('cxp-nc-fecha')?.value || today();
    const referencia = document.getElementById('cxp-nc-ref')?.value.trim() || '';
    const nota = document.getElementById('cxp-nc-nota')?.value.trim() || '';
    if (!provId || valor <= 0) {
      notify('warning', '⚠️', 'Datos', 'Proveedor y monto válido requeridos.', { duration: 3000 });
      return;
    }
    const id = nextId();
    const fechaHora = new Date().toISOString();
    const row = {
      id,
      proveedor_id: provId,
      proveedor_nombre: provNombre,
      tipo: 'nota_credito',
      naturaleza: 'credito',
      monto: valor,
      fecha,
      referencia: referencia || null,
      nota: nota || null,
      meta: { origen: 'manual_nc' },
      lineas: [],
      fecha_hora: fechaHora
    };
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from('tes_cxp_movimientos').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
      state.tes_cxp_movimientos.unshift({
        id,
        proveedorId: provId,
        proveedorNombre: provNombre,
        tipo: 'nota_credito',
        naturaleza: 'credito',
        monto: valor,
        fecha,
        referencia,
        nota,
        meta: row.meta,
        lineas: [],
        fechaHora: fechaHora
      });
      showLoadingOverlay('hide');
      closeModal();
      renderTesPagosProv();
      notify('success', '📄', 'Nota crédito CXP', `${fmt(valor)} · ${provNombre}`, { duration: 3000 });
    } catch (e) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', e.message || String(e), { duration: 5000 });
    }
  }

  function verLibroCxpModal(ctx) {
    const { state, provId, provNombre, fmt, formatDate, openModal } = ctx;
    const lines = (state.tes_cxp_movimientos || [])
      .filter((r) => String(r.proveedorId) === String(provId))
      .slice()
      .sort((a, b) => String(b.fechaHora || '').localeCompare(String(a.fechaHora || '')));
    const d = calcDeudaProveedor(state, provId);
    const rowsHtml =
      lines.length === 0
        ? '<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:20px">Sin movimientos en libro CXP</td></tr>'
        : lines
            .map((r) => {
              const sign = r.naturaleza === 'cargo' ? '+' : '−';
              const col = r.naturaleza === 'cargo' ? 'var(--red)' : 'var(--green)';
              const meta = r.meta && typeof r.meta === 'object' ? r.meta : {};
              const tipoLbl =
                meta.origen === 'devolucion_inventario'
                  ? 'Devolución'
                  : r.tipo === 'cargo_compra'
                    ? 'Cargo'
                    : r.tipo === 'abono'
                      ? 'Abono'
                      : r.tipo === 'nota_credito'
                        ? 'N/C'
                        : r.tipo === 'ajuste'
                          ? 'Ajuste'
                          : r.tipo;
              const lns = getLineasMovimiento(r);
              const lineasCell =
                lns.length > 0
                  ? `<div style="font-size:10px;line-height:1.35;max-width:220px;color:var(--text2)">${lns
                      .map((l) => `${escCxp(l.articulo_nombre || l.articulo_id || '—')} ×${l.cantidad}`)
                      .join('<br>')}</div>`
                  : '—';
              return `<tr><td style="font-size:11px;white-space:nowrap">${fmtLineaHora(r.fechaHora) || formatDate(r.fecha)}</td><td><span class="badge badge-warn" style="font-size:9px">${tipoLbl}</span></td><td style="font-size:11px;color:var(--text2)">${escCxp(r.referencia || '—')}</td><td style="font-size:11px;color:var(--text2)">${escCxp(r.nota || '—')}</td><td style="font-size:11px;vertical-align:top">${lineasCell}</td><td style="font-weight:700;color:${col}">${sign}${fmt(r.monto)}</td><td><button type="button" class="btn btn-xs btn-danger" onclick="eliminarCxpMovimiento('${escCxp(r.id)}')">✕</button></td></tr>`;
            })
            .join('');
    openModal(`<div class="modal-title">📒 Libro CXP — ${escCxp(provNombre)}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;font-size:12px;line-height:1.45">
    <div><span style="color:var(--text2)">Cargos:</span> <b style="color:var(--red)">${fmt(d.cxpCargo)}</b></div>
    <div><span style="color:var(--text2)">Abonos (libro):</span> <b style="color:var(--green)">${fmt(d.cxpCredito)}</b></div>
    <div><span style="color:var(--text2)">Saldo:</span> <b style="color:var(--yellow)">${fmt(d.saldo)}</b></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Ref.</th><th>Nota</th><th>Líneas</th><th>Monto</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`);
  }

  async function eliminarCxpMovimiento(ctx) {
    const { state, id, confirm, supabaseClient, renderTesPagosProv, notify, closeModal } = ctx;
    if (!confirm('¿Eliminar este movimiento del libro CXP?')) return;
    try {
      const { error } = await supabaseClient.from('tes_cxp_movimientos').delete().eq('id', id);
      if (error) throw error;
      state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => r.id !== id);
      if (typeof closeModal === 'function') closeModal();
      renderTesPagosProv();
      notify('success', '🗑️', 'Movimiento eliminado', 'Saldo recalculado.', { duration: 2000 });
    } catch (e) {
      notify('danger', '⚠️', 'Error', e.message || String(e), { duration: 4500 });
    }
  }

  /** Id estable: mismo id que `tes_devoluciones_prov.id` → crédito CXP vinculado. */
  function cxpIdForDevolucion(devolucionId) {
    return `cxp-devolucion-${devolucionId}`;
  }

  /**
   * Espejo en libro CXP: cada devolución a proveedor debe reducir el saldo oficial (crédito).
   * Sin esto, `saldoOficial` ignora `tes_devoluciones_prov`.
   */
  async function mirrorDevolucionToCxp(state, supabaseClient, payload) {
    const {
      devolucionId,
      proveedorId,
      proveedorNombre,
      valorCosto,
      fecha,
      nota,
      fechaHora,
      lineas
    } = payload;
    const monto = Math.max(0, parseFloat(valorCosto) || 0);
    if (!devolucionId || !proveedorId || monto <= 0) return { ok: false, error: 'Datos incompletos' };
    const id = cxpIdForDevolucion(devolucionId);
    const fh = fechaHora || new Date().toISOString();
    const row = {
      id,
      proveedor_id: proveedorId,
      proveedor_nombre: proveedorNombre || '',
      tipo: 'nota_credito',
      naturaleza: 'credito',
      monto,
      fecha: fecha || null,
      referencia: 'Devolución proveedor',
      nota: nota || null,
      meta: { origen: 'devolucion_inventario', devolucion_id: devolucionId },
      lineas: Array.isArray(lineas) ? lineas : [],
      fecha_hora: fh
    };
    const { error } = await supabaseClient.from('tes_cxp_movimientos').upsert(row, { onConflict: 'id' });
    if (error) return { ok: false, error: error.message };
    if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
    state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => r.id !== id);
    state.tes_cxp_movimientos.unshift({
      id,
      proveedorId,
      proveedorNombre: proveedorNombre || '',
      tipo: 'nota_credito',
      naturaleza: 'credito',
      monto,
      fecha: row.fecha,
      referencia: row.referencia,
      nota: row.nota,
      meta: row.meta,
      lineas: row.lineas,
      fechaHora: fh
    });
    return { ok: true };
  }

  async function deleteCxpMirrorDevolucion(state, supabaseClient, devolucionId) {
    if (!devolucionId) return;
    const id = cxpIdForDevolucion(devolucionId);
    const { error } = await supabaseClient.from('tes_cxp_movimientos').delete().eq('id', id);
    if (error) console.warn('[CXP] quitar espejo devolución:', error.message);
    state.tes_cxp_movimientos = (state.tes_cxp_movimientos || []).filter((r) => r.id !== id);
  }

  async function alinearCxpEstimacionProv(ctx) {
    const { state, provId, supabaseClient, dbId, uid, today, showLoadingOverlay, renderTesPagosProv, notify, fmt, confirm } = ctx;
    const d = calcDeudaProveedor(state, provId);
    if (!d.usaCxp) {
      notify('info', '📒', 'CXP', 'No hay movimientos en libro CXP para este proveedor. Registra cargos o sincroniza datos.', { duration: 4500 });
      return;
    }
    const cxp = sumCxpProveedor(state, provId);
    const net = cxp.cargo - cxp.credito;
    const target = d.saldoOperativoEstimado;
    const delta = target - net;
    if (Math.abs(delta) < 0.5) {
      notify('success', '✓', 'Alineado', 'El saldo CXP ya coincide con la estimación operativa.', { duration: 3500 });
      return;
    }
    if (
      !confirm(
        `Se creará un movimiento de ajuste de ${fmt(Math.abs(delta))} para acercar el neto CXP (${fmt(net)}) a la estimación operativa (${fmt(target)}). ¿Continuar?`,
      )
    ) {
      return;
    }
    const nextId = typeof dbId === 'function' ? dbId : uid;
    const prov = (state.usu_proveedores || []).find((p) => String(p.id) === String(provId));
    const provNombre = prov?.nombre || '';
    const id = nextId();
    const fechaHora = new Date().toISOString();
    const fecha = today();
    let row;
    if (delta > 0) {
      row = {
        id,
        proveedor_id: provId,
        proveedor_nombre: provNombre,
        tipo: 'ajuste',
        naturaleza: 'cargo',
        monto: delta,
        fecha,
        referencia: 'Alineación estimación',
        nota: 'Ajuste para igualar saldo CXP a estimación inventario/POS',
        meta: { origen: 'alinear_estimacion' },
        lineas: [],
        fecha_hora: fechaHora
      };
    } else {
      row = {
        id,
        proveedor_id: provId,
        proveedor_nombre: provNombre,
        tipo: 'ajuste',
        naturaleza: 'credito',
        monto: -delta,
        fecha,
        referencia: 'Alineación estimación',
        nota: 'Ajuste para igualar saldo CXP a estimación inventario/POS',
        meta: { origen: 'alinear_estimacion' },
        lineas: [],
        fecha_hora: fechaHora
      };
    }
    try {
      showLoadingOverlay('connecting');
      const { error } = await supabaseClient.from('tes_cxp_movimientos').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      if (!state.tes_cxp_movimientos) state.tes_cxp_movimientos = [];
      state.tes_cxp_movimientos.unshift({
        id: row.id,
        proveedorId: provId,
        proveedorNombre: provNombre,
        tipo: 'ajuste',
        naturaleza: row.naturaleza,
        monto: row.monto,
        fecha: row.fecha,
        referencia: row.referencia,
        nota: row.nota,
        meta: row.meta,
        lineas: [],
        fechaHora: fechaHora
      });
      showLoadingOverlay('hide');
      renderTesPagosProv();
      notify('success', '⚖️', 'Ajuste CXP', `Neto ajustado hacia estimación (${fmt(target)}).`, { duration: 4500 });
    } catch (e) {
      showLoadingOverlay('hide');
      notify('danger', '⚠️', 'Error', e.message || String(e), { duration: 5000 });
    }
  }

  global.AppTreasuryModule = {
    cxpIdForDevolucion,
    mirrorDevolucionToCxp,
    deleteCxpMirrorDevolucion,
    cpCompOnProvChange,
    cpCompToggleModo,
    cpCompAddLinea,
    cpCompRemoveLinea,
    cpCompArticuloChange,
    cpCompRecalcTotal,
    cxpCargoOnProvChange,
    cxpCargoToggleModo,
    cxpCargoAddLinea,
    cxpCargoRemoveLinea,
    cxpCargoArticuloChange,
    cxpCargoRecalcTotal,
    fifoCostoVendidoPorProveedor,
    getLineasMovimiento,
    sumCxpProveedor,
    CXPIV_ABONO_MARKER,
    calcDeudaProveedor,
    renderTesPagosProv,
    openAjusteUnidadesProvModal,
    guardarAjusteUnidadesProv,
    eliminarAjusteUnidadesProv,
    openCompromisoProvModal,
    guardarCompromisoProv,
    eliminarCompromisoProv,
    verCompromisosProv,
    importarEstimacionCompromisosProv,
    openCargoCxpModal,
    openNotaCreditoCxpModal,
    guardarCargoCxpMov,
    guardarNotaCreditoCxpMov,
    verLibroCxpModal,
    eliminarCxpMovimiento,
    alinearCxpEstimacionProv,
    verLibroProveedorModal,
    quitarCreditoArticuloProveedor,
    logRegistroDeudaArticulo,
    openAbonoProvModal,
    updateSaldoPendiente,
    validateAbono,
    guardarAbonoProv,
    verAbonosProv,
    eliminarAbonoProv,
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
    renderSimpleCollection
  };
})(window);
