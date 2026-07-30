-- cancel_pos_sale_v2: no bloquear la anulación cuando ya no queda stock que devolver.
--
-- Contexto: 200 de las 1.455 facturas POS activas venden productos que después se
-- borraron del catálogo. No tienen stock_moves ligados y sus líneas apuntan a ids que
-- ya no existen en products, así que no hay inventario al que sumar. Aun así 190 de
-- ellas sí tienen ingreso en caja pendiente de revertir. Abortar dejaba ese dinero
-- imposible de corregir desde el ERP.
--
-- Ahora, si ninguna de las tres fuentes resuelve productos, la anulación sigue
-- adelante: revierte caja, marca la factura anulada y devuelve stock_source='ninguna'
-- con stock_manual_required=true para que la interfaz avise.

create or replace function public.cancel_pos_sale_v2(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_operation_id uuid; v_invoice_id uuid; v_hash text; v_existing public.pos_operations%rowtype; v_invoice public.invoices%rowtype;
  v_stock record; v_cash record; v_caja public.cajas%rowtype; v_saldos jsonb; v_bucket text; v_response jsonb;
  v_manual boolean := false; v_has_stock boolean := false; v_stock_source text; v_reason text;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    raise exception 'cancel_pos_sale_v2: authentication required' using errcode = '42501';
  end if;

  begin
    v_operation_id := (p_request->>'operation_id')::uuid;
    v_invoice_id := (p_request->>'invoice_id')::uuid;
  exception when others then
    raise exception 'cancel_pos_sale_v2: operation_id and invoice_id must be UUID';
  end;

  v_hash := md5(p_request::text);
  select * into v_existing from public.pos_operations where operation_id = v_operation_id for update;
  if found then
    if v_existing.request_hash <> v_hash or v_existing.kind <> 'cancel' then
      raise exception 'cancel_pos_sale_v2: operation_id conflict';
    end if;
    return v_existing.response;
  end if;

  select * into v_invoice from public.invoices where id = v_invoice_id for update;
  if not found or (v_invoice.tipo <> 'pos' and v_invoice.number !~ '^POS-') then
    raise exception 'cancel_pos_sale_v2: POS invoice not found';
  end if;
  if v_invoice.estado = 'anulada' then
    raise exception 'cancel_pos_sale_v2: invoice already cancelled';
  end if;

  v_reason := coalesce(nullif(p_request->>'reason', ''), 'Sin motivo');

  insert into public.pos_operations(operation_id, kind, invoice_id, request_hash, created_by)
  values (v_operation_id, 'cancel', v_invoice_id, v_hash, auth.uid());

  if exists (
    select 1 from public.stock_moves
    where documento_id = v_invoice_id and tipo = 'venta_pos'
    group by product_id having sum(qty) < 0
  ) then
    v_stock_source := 'documento';
  elsif exists (
    select 1 from public.stock_moves
    where referencia = v_invoice.number and tipo = 'venta_pos' and documento_id is null
    group by product_id having sum(qty) < 0
  ) then
    v_stock_source := 'referencia';
  elsif jsonb_typeof(v_invoice.items) = 'array' and jsonb_array_length(v_invoice.items) > 0 then
    v_stock_source := 'items';
  else
    v_stock_source := 'ninguna';
  end if;

  for v_stock in
    select product_id, qty_to_restore, bodega_id from (
      select product_id, -sum(qty)::integer as qty_to_restore, min(coalesce(bodega_id, 'bodega_main')) as bodega_id
      from public.stock_moves
      where v_stock_source = 'documento' and documento_id = v_invoice_id and tipo = 'venta_pos'
      group by product_id having sum(qty) < 0
      union all
      select product_id, -sum(qty)::integer, min(coalesce(bodega_id, 'bodega_main'))
      from public.stock_moves
      where v_stock_source = 'referencia' and referencia = v_invoice.number and tipo = 'venta_pos' and documento_id is null
      group by product_id having sum(qty) < 0
      union all
      select p.id, sum(abs(coalesce((line->>'qty')::numeric, (line->>'cantidad')::numeric, 0)))::integer, 'bodega_main'
      from jsonb_array_elements(case when v_stock_source = 'items' then v_invoice.items else '[]'::jsonb end) line
      join public.products p on p.id::text = coalesce(line->>'articuloId', line->>'id', '')
      group by p.id having sum(abs(coalesce((line->>'qty')::numeric, (line->>'cantidad')::numeric, 0))) > 0
    ) src
    order by product_id
  loop
    v_has_stock := true;
    perform 1 from public.products where id = v_stock.product_id for update;
    update public.products set stock = stock + v_stock.qty_to_restore, updated_at = now() where id = v_stock.product_id;
    insert into public.stock_moves(id, product_id, qty, cantidad, reason, tipo, bodega_id, referencia, documento_id, fecha, nota)
    values (gen_random_uuid(), v_stock.product_id, v_stock.qty_to_restore, v_stock.qty_to_restore, 'anulacion_pos', 'venta_pos',
            v_stock.bodega_id, v_invoice.number, v_invoice_id, now(),
            'Anulacion POS (' || v_stock_source || ') - ' || v_reason);
  end loop;

  -- La fuente elegida puede no resolver ningún producto vivo (catálogo depurado).
  if not v_has_stock then v_stock_source := 'ninguna'; end if;

  if not exists (
    select 1 from public.tes_movimientos where invoice_id = v_invoice_id and categoria = 'venta_pos' and tipo = 'ingreso'
  ) then
    v_manual := true;
  else
    for v_cash in
      select * from public.tes_movimientos
      where invoice_id = v_invoice_id and categoria = 'venta_pos' and tipo = 'ingreso'
      order by caja_id, id for update
    loop
      if exists (select 1 from public.tes_movimientos where reversal_of_id = v_cash.id) then continue; end if;
      select * into v_caja from public.cajas where id = v_cash.caja_id for update;
      if not found then raise exception 'cancel_pos_sale_v2: cash register % not found', v_cash.caja_id; end if;
      v_bucket := coalesce(nullif(v_cash.bucket, ''), 'efectivo');
      v_saldos := coalesce(v_caja.saldos_metodo, '{}'::jsonb);
      v_saldos := jsonb_set(v_saldos, array[v_bucket], to_jsonb(coalesce((v_saldos->>v_bucket)::numeric, 0) - v_cash.valor), true);
      update public.cajas
      set saldos_metodo = v_saldos,
          saldo = coalesce(saldo, 0) - case when v_bucket = 'efectivo' then v_cash.valor else 0 end
      where id = v_cash.caja_id;
      insert into public.tes_movimientos(id, caja_id, tipo, valor, concepto, fecha, metodo, sesion_id, categoria, bucket, invoice_id, operation_id, reversal_of_id)
      values (gen_random_uuid()::text, v_cash.caja_id, 'egreso', v_cash.valor,
              'Anulacion ' || v_invoice.number || ' - ' || v_reason,
              current_date, v_cash.metodo, v_cash.sesion_id, 'anulacion_pos', v_bucket, v_invoice_id, v_operation_id, v_cash.id);
    end loop;
  end if;

  update public.invoices set estado = 'anulada' where id = v_invoice_id;

  v_response := jsonb_build_object(
    'ok', true,
    'operation_id', v_operation_id,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice.number,
    'cash_manual_required', v_manual,
    'stock_manual_required', v_stock_source = 'ninguna',
    'stock_source', v_stock_source,
    'stocks', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'stock', p.stock)), '[]'::jsonb)
      from public.products p
      where p.id in (select sm.product_id from public.stock_moves sm where sm.documento_id = v_invoice_id and sm.tipo = 'venta_pos')
    )
  );

  update public.pos_operations set response = v_response where operation_id = v_operation_id;
  return v_response;
end;
$function$;
