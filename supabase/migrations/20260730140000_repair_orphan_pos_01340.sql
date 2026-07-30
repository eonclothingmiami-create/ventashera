-- Reparación de la venta huérfana del 2026-07-30 17:19 UTC ($28.000, "Bikini colors").
--
-- Una pestaña antigua del ERP (con el consecutivo local desactualizado en 1340) intentó
-- registrar la venta como POS-01340, número que ya pertenecía a una factura del 1 de junio.
-- El insert en invoices falló por número duplicado, pero sale_items, stock_moves y
-- tes_movimientos sí quedaron escritos. Resultado: Trazabilidad y Consolidado mostraban
-- $281.000 y Facturas solo $253.000.
--
-- Se reconstruye la factura y la venta con un consecutivo nuevo y se enlaza todo.

do $$
declare
  v_invoice_id uuid := '4f41f48b-ecb7-492f-b858-93d4c550b653';
  v_line public.sale_items%rowtype;
  v_counter bigint;
  v_number text;
begin
  select * into v_line from public.sale_items where id = '73af2a29-91b0-4913-8c13-77f842cec1d0';
  if not found then
    raise notice 'La línea huérfana ya no existe; nada que reparar.';
    return;
  end if;
  if exists (select 1 from public.invoices where id = v_invoice_id) then
    raise notice 'La factura ya fue reconstruida; nada que reparar.';
    return;
  end if;

  v_counter := public.increment_erp_consecutivo('factura');
  v_number := 'POS-' || lpad(v_counter::text, 5, '0');

  insert into public.invoices(
    id, number, customer_name, customer_phone, total, subtotal, iva, flete, fecha,
    canal, metodo_pago, estado, tipo, guia, empresa, transportadora, ciudad,
    es_separado, tipo_pago, items
  ) values (
    v_invoice_id, v_number, v_line.cliente_nombre, v_line.cliente_telefono,
    v_line.subtotal, v_line.subtotal, 0, 0, v_line.fecha,
    coalesce(v_line.canal, 'vitrina'), 'efectivo', 'pagada', 'pos', '', '', '', '',
    false, 'contado',
    jsonb_build_array(jsonb_build_object(
      'articuloId', v_line.product_id, 'id', v_line.product_id,
      'nombre', v_line.product_name, 'talla', v_line.talla,
      'qty', v_line.qty, 'cantidad', v_line.qty,
      'precio', v_line.unit_price, 'price', v_line.unit_price
    ))
  );

  insert into public.ventas(
    id, fecha, canal, valor, cliente, telefono, guia, empresa, transportadora, ciudad,
    liquidado, es_separado, estado_entrega, referencia, metodo_pago, archived,
    tipo_pago, es_contraentrega, stock_products_pending, invoice_id
  ) values (
    v_invoice_id::text, v_line.fecha, coalesce(v_line.canal, 'vitrina'), v_line.subtotal,
    coalesce(v_line.cliente_nombre, ''), coalesce(v_line.cliente_telefono, ''), '', '', '', '',
    false, false, 'Pendiente', v_number, 'efectivo', false,
    'contado', false, '[]'::jsonb, v_invoice_id
  );

  update public.sale_items set invoice_number = v_number where id = v_line.id;
  update public.stock_moves set referencia = v_number where documento_id = v_invoice_id and tipo = 'venta_pos';
  update public.tes_movimientos
  set invoice_id = v_invoice_id,
      concepto = 'Venta POS ' || v_number || ' · ' || coalesce(v_line.product_name, '')
  where id = '772f3700-4f84-4e13-a243-ad92e704f505' and invoice_id is null;

  raise notice 'Factura reconstruida como %', v_number;
end $$;
