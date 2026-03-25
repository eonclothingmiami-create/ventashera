// Shared state factory extracted from core runtime.
(function initAppState(global) {
  function createInitialState() {
    return {
      meta: 34000000,
      diasLocal: 1,
      diasInter: 5,
      empleados: [],
      usu_empleados: [],
      nomina_pagos: [],
      ventas: [],
      currentMonth: null,
      game: { xp: 0, streakMax: 0, earnedBadges: [], claimedSnacks: {} },
      rewards: {},
      notifEnabled: false,
      notifHour: 21,
      articulos: [],
      bodegas: [{ id: 'bodega_main', name: 'Bodega Principal', ubicacion: 'Local' }, { id: 'bodega_vitrina', name: 'Vitrina', ubicacion: 'Vitrina' }],
      inv_movimientos: [],
      inv_ajustes: [],
      inv_traslados: [],
      cotizaciones: [],
      ordenes_venta: [],
      facturas: [],
      notas_credito: [],
      notas_debito: [],
      remisiones: [],
      devoluciones: [],
      anticipos_clientes: [],
      nom_ausencias: [],
      nom_anticipos: [],
      nom_conceptos: [
        { id: 'c1', nombre: 'Salario Básico', tipo: 'devengo', formula: 'fijo', valor: 0 },
        { id: 'c2', nombre: 'Auxilio Transporte', tipo: 'devengo', formula: 'fijo', valor: 210000 },
        { id: 'c3', nombre: 'Salud (4%)', tipo: 'deduccion', formula: 'porcentaje', valor: 4 },
        { id: 'c4', nombre: 'Pensión (4%)', tipo: 'deduccion', formula: 'porcentaje', valor: 4 }
      ],
      nom_nominas: [],
      cajas: [
        {
          id: 'caja_principal',
          nombre: 'Caja Principal',
          saldo: 0,
          estado: 'abierta',
          apertura: null,
          bodegaIds: [],
          saldosMetodo: { efectivo: 0, transferencia: 0, addi: 0, contraentrega: 0, tarjeta: 0, digital: 0, otro: 0 }
        }
      ],
      tes_movimientos: [],
      tes_cierres_caja: [],
      tes_impuestos: [],
      tes_retenciones: [],
      tes_comp_retencion: [],
      tes_comp_ingreso: [],
      tes_comp_egreso: [],
      tes_transferencias: [],
      empresa: { nombre: 'Hera Swimwear', nit: '', direccion: '', telefono: '', ciudad: '' },
      consecutivos: { factura: 1, cotizacion: 1, orden: 1, nc: 1, nd: 1, remision: 1, devolucion: 1, ingreso: 1, egreso: 1, retencion: 1 },
      pos_cart: [],
      tes_abonos_prov: [],
      /** Compromisos reconocidos (ingreso a crédito); saldo = sum(compromisos) − abonos */
      tes_compromisos_prov: [],
      tes_libro_proveedor: [],
      tes_devoluciones_prov: [],
      /** Líneas stock_moves tipo venta_pos (carga desde BD) — costo vendido histórico por proveedor */
      stock_moves_ventas: [],
      cfg_categorias: [
        { id: 'cat1', seccion: 'Trajes de Baño', nombre: 'Enterizos' },
        { id: 'cat2', seccion: 'Trajes de Baño', nombre: 'Bikinis' },
        { id: 'cat3', seccion: 'Trajes de Baño', nombre: 'Tankinis' },
        { id: 'cat4', seccion: 'Trajes de Baño', nombre: 'Asoleadores' },
        { id: 'cat5', seccion: 'Trajes de Baño', nombre: 'Salidas de Baño' },
        { id: 'cat6', seccion: 'Trajes de Baño', nombre: '3 Piezas' },
        { id: 'cat7', seccion: 'Resort & Pijamas', nombre: 'Batas' },
        { id: 'cat8', seccion: 'Resort & Pijamas', nombre: 'Sets 2 Piezas' },
        { id: 'cat9', seccion: 'Activewear', nombre: 'Leggings' },
        { id: 'cat10', seccion: 'Activewear', nombre: 'Conjuntos' },
        { id: 'cat11', seccion: 'Casual', nombre: 'Vestidos' }
      ],
      cfg_secciones: [
        { id: 'sec1', nombre: 'Trajes de Baño' },
        { id: 'sec2', nombre: 'Resort & Pijamas' },
        { id: 'sec3', nombre: 'Activewear' },
        { id: 'sec4', nombre: 'Casual' }
      ],
      cfg_transportadoras: [
        { id: 't1', nombre: 'TCC', activa: true },
        { id: 't2', nombre: 'Coordinadora', activa: true },
        { id: 't3', nombre: 'Envía', activa: true },
        { id: 't4', nombre: 'Interrapidísimo', activa: true },
        { id: 't5', nombre: 'Servientrega', activa: true }
      ],
      cfg_metodos_pago: [
        { id: 'mp1', nombre: 'Nequi', tipo: 'digital', activo: true },
        { id: 'mp2', nombre: 'Bancolombia', tipo: 'banco', activo: true },
        { id: 'mp3', nombre: 'Daviplata', tipo: 'digital', activo: true },
        { id: 'mp4', nombre: 'Bancolombia 2', tipo: 'banco', activo: true },
        { id: 'mp5', nombre: 'Efectivo', tipo: 'efectivo', activo: true },
        { id: 'mp6', nombre: 'Tarjeta', tipo: 'tarjeta', activo: true }
      ],
      cfg_tarifas: [
        { id: 'tar1', nombre: 'Precio Mayorista', porcentaje: 0, descripcion: 'Precio base' },
        { id: 'tar2', nombre: 'Precio Público', porcentaje: 15, descripcion: 'Mayorista + 15k' },
        { id: 'tar3', nombre: 'Precio Especial', porcentaje: -10, descripcion: '10% descuento' }
      ],
      cfg_impuestos: [
        { id: 'imp1', nombre: 'IVA', porcentaje: 19, tipo: 'venta', activo: true },
        { id: 'imp2', nombre: 'ReteFuente', porcentaje: 3.5, tipo: 'retencion', activo: false },
        { id: 'imp3', nombre: 'ReteICA', porcentaje: 0.966, tipo: 'retencion', activo: false }
      ],
      cfg_game: {
        meta_mensual: 34000000,
        xp_por_venta_vitrina: 150000,
        xp_por_venta_local: 25000,
        xp_por_venta_inter: 20000,
        xp_liquidar: 20,
        dias_local: 1,
        dias_inter: 5
      }
    };
  }

  global.AppState = { createInitialState };
})(window);
