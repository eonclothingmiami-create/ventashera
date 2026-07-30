-- Reconstruye las 2 ventas de abril 2026 que se perdieron por completo.
--
-- Salieron en la auditoría de los 346 movimientos venta_pos sin factura: son las únicas
-- dos donde no hay rastro en ninguna tabla. Las otras 344 son enlaces roto (la factura
-- existe con otro id) o el esquema viejo de ventas, no dinero perdido.
--
--   2026-04-01 20:11 UTC · doc e9ce516a… · POS-00188 · ASOLEADOR SIRENA (UNICA)              $18.000
--   2026-04-09 16:32 UTC · doc 94624028… · POS-00237 · TRAJE DE BAÑO STRAPLE TIRO ALTO (M)   $45.000
--
-- Mismo patrón que POS-01512/01513 de hoy: inventario descontado, sin factura, sin venta,
-- sin líneas y sin ingreso de caja. Nunca se repararon.
--
-- Decisiones de esta reparación:
--   * Se reutilizan los números originales, que están libres (POS-00187 y POS-00189 existen,
--     POS-00188 no). Así se tapa el hueco de la numeración, no se renumera nada y la
--     referencia que ya traen los stock_moves sigue siendo válida.
--   * Se reutiliza el id de documento de los stock_moves, así que el inventario NO se vuelve
--     a descontar.
--   * Precios verificados contra sale_items de mar–may 2026: $18.000 y $45.000, estables.
--     Tallas tomadas de la nota del movimiento de inventario.
--   * Método transferencia, confirmado por el usuario.
--   * El ingreso de caja queda con fecha de abril pero NO se toca cajas.saldos_metodo: esa
--     plata entró hace cuatro meses y la caja ya se cerró muchas veces. Sumarla al saldo de
--     hoy descuadraría el conteo físico actual.

do $$
declare
  v_docs jsonb := jsonb_build_array(
    jsonb_build_object(
      'invoice_id', 'e9ce516a-5ab8-4524-a360-a0a380d9a445',
      'number', 'POS-00188',
      'fecha_hora', '2026-04-01T20:11:31.521168+00:00',
      'product_id', '376ec427-4985-4b42-aaf1-5cca5831b9b3',
      'name', 'ASOLEADOR SIRENA',
      'talla', 'UNICA',
      'price', 18000
    ),
    jsonb_build_object(
      'invoice_id', '94624028-242a-4bd9-8818-3a896a787c4f',
      'number', 'POS-00237',
      'fecha_hora', '2026-04-09T16:32:03.367718+00:00',
      'product_id', 'a9a7e732-8192-4f92-9dcb-4488c3b28d51',
      'name', 'TRAJE DE BAÑO STRAPLE TIRO ALTO',
      'talla', 'M',
      'price', 45000
    )
  );
  v_caja public.cajas%rowtype;
  v_doc jsonb;
  v_invoice_id uuid;
  v_number text;
  v_fecha_hora timestamptz;
  v_fecha date;
  v_total numeric;
  v_reparadas integer := 0;
begin
  select * into v_caja from public.cajas where estado = 'abierta' order by created_at limit 1;
  if not found then
    raise exception 'No hay caja abierta a la cual asociar el ingreso histórico.';
  end if;

  for v_doc in select * from jsonb_array_elements(v_docs) loop
    v_invoice_id := (v_doc->>'invoice_id')::uuid;
    v_number := v_doc->>'number';

    if exists (select 1 from public.invoices where id = v_invoice_id or number = v_number) then
      raise notice '% ya existe; se omite.', v_number;
      continue;
    end if;

    if not exists (
      select 1 from public.stock_moves
      where documento_id = v_invoice_id and tipo = 'venta_pos'
    ) then
      raise exception 'No hay movimiento de inventario para %; el diagnóstico no aplica.', v_number;
    end if;

    v_fecha_hora := (v_doc->>'fecha_hora')::timestamptz;
    v_fecha := v_fecha_hora::date;
    v_total := (v_doc->>'price')::numeric;

    insert into public.invoices(
      id, number, customer_name, customer_phone, total, subtotal, iva, flete, fecha,
      canal, metodo_pago, estado, tipo, guia, empresa, transportadora, ciudad,
      es_separado, tipo_pago, items, created_at
    ) values (
      v_invoice_id, v_number, '', '', v_total, v_total, 0, 0, v_fecha,
      'vitrina', 'transferencia', 'pagada', 'pos', '', '', '', '',
      false, 'contado',
      jsonb_build_array(jsonb_build_object(
        'articuloId', v_doc->>'product_id', 'id', v_doc->>'product_id',
        'nombre', v_doc->>'name', 'talla', v_doc->>'talla',
        'qty', 1, 'cantidad', 1,
        'precio', v_total, 'price', v_total
      )),
      v_fecha_hora
    );

    insert into public.ventas(
      id, fecha, canal, valor, cliente, telefono, guia, empresa, transportadora, ciudad,
      liquidado, es_separado, estado_entrega, referencia, metodo_pago, archived,
      tipo_pago, es_contraentrega, stock_products_pending, invoice_id, created_at
    ) values (
      v_invoice_id::text, v_fecha, 'vitrina', v_total, '', '', '', '', '', '',
      false, false, 'Pendiente', v_number, 'transferencia', false,
      'contado', false, '[]'::jsonb, v_invoice_id, v_fecha_hora
    );

    insert into public.sale_items(
      sale_id, invoice_id, invoice_number, product_id, product_ref, product_name,
      talla, qty, unit_price, subtotal, canal, cliente_nombre, cliente_telefono,
      fecha, fecha_hora, source, line_key, created_at, updated_at
    ) values (
      v_invoice_id::text, v_invoice_id, v_number, v_doc->>'product_id',
      (select ref from public.products where id::text = v_doc->>'product_id'),
      v_doc->>'name', v_doc->>'talla',
      1, v_total, v_total,
      'vitrina', '', '',
      v_fecha, v_fecha_hora, 'pos',
      v_invoice_id::text || '|' || (v_doc->>'product_id') || '|' ||
        lower(v_doc->>'talla') || '|' || v_total::text || '|0',
      v_fecha_hora, v_fecha_hora
    );

    insert into public.tes_movimientos(
      id, caja_id, tipo, valor, concepto, fecha, metodo, categoria, bucket,
      sesion_id, invoice_id, created_at
    ) values (
      gen_random_uuid()::text, v_caja.id, 'ingreso', v_total,
      'Venta POS ' || v_number || ' · ' || (v_doc->>'name'),
      v_fecha, 'transferencia', 'venta_pos', 'transferencia',
      v_caja.sesion_activa_id, v_invoice_id, v_fecha_hora
    );

    v_reparadas := v_reparadas + 1;
    raise notice 'Reconstruida % por % (transferencia, %).', v_number, v_total, v_fecha;
  end loop;

  raise notice '% venta(s) de abril reconstruida(s). cajas.saldos_metodo intacto a propósito.', v_reparadas;
end $$;
