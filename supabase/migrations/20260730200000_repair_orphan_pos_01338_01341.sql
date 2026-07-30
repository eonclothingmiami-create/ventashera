-- Reparación de las dos ventas huérfanas del 2026-07-30 ($123.000 y $18.000).
--
-- Misma causa que POS-01340: una pestaña con el bundle viejo del POS numera la factura
-- desde state_config.consecutivos.factura (quedó en 1339) en vez del contador atómico
-- erp_consecutivos (va en 1511). POS-01338 ya era de la venta de las 14:45 UTC de hoy y
-- POS-01341 de una factura del 1 de junio, así que el insert en invoices se rechazó por
-- número duplicado. Ese camino no es transaccional: el descuento de inventario sí quedó.
--
-- Estado antes de esta migración (inventario descontado, cero rastro contable):
--   17:54:45 UTC · doc 17216996… · Tankini Blusa Esqueleto (M) $55.000
--                                + TRAJE DE BAÑO KIMONO (M)   $68.000 = $123.000 · transferencia
--   18:39:16 UTC · doc 83f4d760… · Bikini Asoleador Sublimado (UNICA)  $18.000 · efectivo
--
-- Se reconstruye factura + venta + líneas + ingreso de caja reutilizando el id de documento
-- que ya traen los stock_moves, así que el inventario NO se vuelve a tocar. products.stock
-- quedó descontado el 2026-07-30 17:54:45 y 18:39:16 y se deja tal cual.

do $$
declare
  v_docs jsonb := jsonb_build_array(
    jsonb_build_object(
      'invoice_id', '17216996-f293-40dd-bf74-83d69607a662',
      'fecha_hora', '2026-07-30T17:54:45.874292+00:00',
      'metodo', 'transferencia',
      'bucket', 'transferencia',
      'lines', jsonb_build_array(
        jsonb_build_object('product_id', '6efd80c7-68f2-46d0-ad5e-ac8a482d9a82',
                           'name', 'Tankini Blusa Esqueleto', 'talla', 'M', 'qty', 1, 'price', 55000),
        jsonb_build_object('product_id', 'e0909099-38a6-44ee-a20e-ffc78bbe3f16',
                           'name', 'TRAJE DE BAÑO KIMONO', 'talla', 'M', 'qty', 1, 'price', 68000)
      )
    ),
    jsonb_build_object(
      'invoice_id', '83f4d760-3877-462d-82bd-33f3350e88e9',
      'fecha_hora', '2026-07-30T18:39:16.038909+00:00',
      'metodo', 'efectivo',
      'bucket', 'efectivo',
      'lines', jsonb_build_array(
        jsonb_build_object('product_id', '7c967854-d190-4f73-8c5f-8e44f09cef34',
                           'name', 'Bikini Asoleador Sublimado', 'talla', 'UNICA', 'qty', 1, 'price', 18000)
      )
    )
  );
  v_caja public.cajas%rowtype;
  v_doc jsonb;
  v_line jsonb;
  v_invoice_id uuid;
  v_fecha_hora timestamptz;
  v_fecha date;
  v_number text;
  v_total numeric;
  v_items jsonb;
  v_nombres text;
  v_idx integer;
  v_deltas jsonb := '{}'::jsonb;
  v_bucket text;
  v_saldos jsonb;
  v_reparadas integer := 0;
begin
  select * into v_caja from public.cajas where estado = 'abierta' order by created_at limit 1;
  if not found then
    raise exception 'No hay caja abierta: el ingreso de las ventas reconstruidas quedaría sin destino.';
  end if;

  for v_doc in select * from jsonb_array_elements(v_docs) loop
    v_invoice_id := (v_doc->>'invoice_id')::uuid;

    if exists (select 1 from public.invoices where id = v_invoice_id) then
      raise notice 'Documento % ya fue reconstruido; se omite.', v_invoice_id;
      continue;
    end if;

    if not exists (
      select 1 from public.stock_moves
      where documento_id = v_invoice_id and tipo = 'venta_pos'
    ) then
      raise exception 'No hay movimientos de inventario para %; el diagnóstico no aplica.', v_invoice_id;
    end if;

    v_fecha_hora := (v_doc->>'fecha_hora')::timestamptz;
    v_fecha := v_fecha_hora::date;

    select
      sum((l->>'qty')::numeric * (l->>'price')::numeric),
      jsonb_agg(jsonb_build_object(
        'articuloId', l->>'product_id',
        'id', l->>'product_id',
        'nombre', l->>'name',
        'talla', l->>'talla',
        'qty', (l->>'qty')::numeric,
        'cantidad', (l->>'qty')::numeric,
        'precio', (l->>'price')::numeric,
        'price', (l->>'price')::numeric
      )),
      string_agg(l->>'name', ', ')
    into v_total, v_items, v_nombres
    from jsonb_array_elements(v_doc->'lines') l;

    v_number := 'POS-' || lpad(public.increment_erp_consecutivo('factura')::text, 5, '0');

    insert into public.invoices(
      id, number, customer_name, customer_phone, total, subtotal, iva, flete, fecha,
      canal, metodo_pago, estado, tipo, guia, empresa, transportadora, ciudad,
      es_separado, tipo_pago, items, created_at
    ) values (
      v_invoice_id, v_number, '', '', v_total, v_total, 0, 0, v_fecha,
      'vitrina', v_doc->>'metodo', 'pagada', 'pos', '', '', '', '',
      false, 'contado', v_items, v_fecha_hora
    );

    insert into public.ventas(
      id, fecha, canal, valor, cliente, telefono, guia, empresa, transportadora, ciudad,
      liquidado, es_separado, estado_entrega, referencia, metodo_pago, archived,
      tipo_pago, es_contraentrega, stock_products_pending, invoice_id, created_at
    ) values (
      v_invoice_id::text, v_fecha, 'vitrina', v_total, '', '', '', '', '', '',
      false, false, 'Pendiente', v_number, v_doc->>'metodo', false,
      'contado', false, '[]'::jsonb, v_invoice_id, v_fecha_hora
    );

    v_idx := 0;
    for v_line in select * from jsonb_array_elements(v_doc->'lines') loop
      insert into public.sale_items(
        sale_id, invoice_id, invoice_number, product_id, product_ref, product_name,
        talla, qty, unit_price, subtotal, canal, cliente_nombre, cliente_telefono,
        fecha, fecha_hora, source, line_key, created_at, updated_at
      ) values (
        v_invoice_id::text, v_invoice_id, v_number, v_line->>'product_id',
        (select ref from public.products where id::text = v_line->>'product_id'),
        v_line->>'name', v_line->>'talla',
        (v_line->>'qty')::numeric, (v_line->>'price')::numeric,
        (v_line->>'qty')::numeric * (v_line->>'price')::numeric,
        'vitrina', '', '',
        v_fecha, v_fecha_hora, 'pos',
        v_invoice_id::text || '|' || (v_line->>'product_id') || '|' ||
          lower(v_line->>'talla') || '|' || (v_line->>'price') || '|' || v_idx::text,
        v_fecha_hora, v_fecha_hora
      );
      v_idx := v_idx + 1;
    end loop;

    insert into public.tes_movimientos(
      id, caja_id, tipo, valor, concepto, fecha, metodo, categoria, bucket,
      sesion_id, invoice_id, created_at
    ) values (
      gen_random_uuid()::text, v_caja.id, 'ingreso', v_total,
      'Venta POS ' || v_number || ' · ' || v_nombres,
      v_fecha, v_doc->>'metodo', 'venta_pos', v_doc->>'bucket',
      v_caja.sesion_activa_id, v_invoice_id, v_fecha_hora
    );

    update public.stock_moves
    set referencia = v_number
    where documento_id = v_invoice_id and tipo = 'venta_pos';

    v_bucket := v_doc->>'bucket';
    v_deltas := jsonb_set(
      v_deltas, array[v_bucket],
      to_jsonb(coalesce((v_deltas->>v_bucket)::numeric, 0) + v_total)
    );
    v_reparadas := v_reparadas + 1;
    raise notice 'Reconstruida % por % (%).', v_number, v_total, v_doc->>'metodo';
  end loop;

  if v_reparadas = 0 then
    raise notice 'Nada por reparar.';
    return;
  end if;

  -- La caja se ajusta por bucket con el mismo delta que acaba de entrar a tes_movimientos.
  select coalesce(saldos_metodo, '{}'::jsonb) into v_saldos from public.cajas where id = v_caja.id;
  for v_bucket in select jsonb_object_keys(v_deltas) loop
    v_saldos := jsonb_set(
      v_saldos, array[v_bucket],
      to_jsonb(coalesce((v_saldos->>v_bucket)::numeric, 0) + (v_deltas->>v_bucket)::numeric)
    );
  end loop;

  update public.cajas
  set saldos_metodo = v_saldos,
      saldo = coalesce((v_saldos->>'efectivo')::numeric, saldo)
  where id = v_caja.id;

  -- El contador legacy del cliente quedó 172 números atrás y es lo que provoca los choques.
  -- Se sincroniza con el contador atómico del servidor para que una pestaña vieja que aún
  -- lo lea no vuelva a reciclar números ya emitidos.
  update public.state_config
  set value = jsonb_set(
        value, '{factura}',
        to_jsonb((select valor from public.erp_consecutivos where clave = 'factura'))
      ),
      updated_at = now()
  where key = 'consecutivos';

  raise notice '% venta(s) reconstruida(s).', v_reparadas;
end $$;
