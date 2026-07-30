-- Cobro de facturas manuales: cierra la última fuente de descuadre entre módulos.
--
-- Las facturas manuales ("+ Factura") nacen como borrador y solo escribían el
-- encabezado en invoices. Al marcarlas pagadas no generaban ingreso en caja ni líneas,
-- así que aparecían en Facturas pero nunca en Trazabilidad ni en Consolidado.
--
-- Esta función hace el cobro completo en una sola transacción: ingreso en caja ligado a
-- la factura, líneas de venta y cambio de estado a pagada. Reutiliza pos_operations,
-- cuyo UNIQUE (kind, invoice_id) impide cobrar dos veces la misma factura.
--
-- No toca stock: las facturas manuales nunca descontaron inventario y hacerlo aquí
-- descuadraría el conteo físico.

alter table public.pos_operations drop constraint if exists pos_operations_kind_check;
alter table public.pos_operations
  add constraint pos_operations_kind_check
  check (kind = any (array['sale'::text, 'cancel'::text, 'pay_manual'::text]));

create or replace function public.pay_manual_invoice_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_operation_id uuid; v_invoice_id uuid; v_hash text; v_existing public.pos_operations%rowtype;
  v_invoice public.invoices%rowtype; v_caja public.cajas%rowtype; v_saldos jsonb;
  v_caja_id text; v_session_id text; v_bucket text; v_method text; v_total numeric;
  v_move_id text; v_response jsonb; v_lines integer := 0;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    raise exception 'pay_manual_invoice_v1: authentication required' using errcode = '42501';
  end if;

  begin
    v_operation_id := (p_request->>'operation_id')::uuid;
    v_invoice_id := (p_request->>'invoice_id')::uuid;
  exception when others then
    raise exception 'pay_manual_invoice_v1: operation_id and invoice_id must be UUID';
  end;

  v_hash := md5(p_request::text);
  select * into v_existing from public.pos_operations where operation_id = v_operation_id for update;
  if found then
    if v_existing.request_hash <> v_hash or v_existing.kind <> 'pay_manual' then
      raise exception 'pay_manual_invoice_v1: operation_id conflict';
    end if;
    return v_existing.response;
  end if;

  select * into v_invoice from public.invoices where id = v_invoice_id for update;
  if not found then raise exception 'pay_manual_invoice_v1: factura no encontrada'; end if;
  if v_invoice.tipo = 'pos' or v_invoice.number ~ '^POS-' then
    raise exception 'pay_manual_invoice_v1: las ventas POS se cobran desde el POS';
  end if;
  if v_invoice.estado <> 'borrador' then
    raise exception 'pay_manual_invoice_v1: la factura ya está en estado %', v_invoice.estado;
  end if;

  v_total := coalesce(v_invoice.total, 0);
  if v_total <= 0 then raise exception 'pay_manual_invoice_v1: el total debe ser mayor que cero'; end if;

  v_caja_id := nullif(p_request->>'caja_id', '');
  v_session_id := nullif(p_request->>'session_id', '');
  v_bucket := coalesce(nullif(p_request->>'bucket', ''), 'efectivo');
  v_method := coalesce(nullif(p_request->>'method', ''), v_bucket);
  if v_bucket not in ('efectivo','transferencia','addi','contraentrega','tarjeta','digital','otro') then
    raise exception 'pay_manual_invoice_v1: método de pago inválido (%)', v_bucket;
  end if;
  if v_caja_id is null then raise exception 'pay_manual_invoice_v1: caja_id requerido'; end if;

  select * into v_caja from public.cajas where id = v_caja_id for update;
  if not found or v_caja.estado <> 'abierta' then
    raise exception 'pay_manual_invoice_v1: la caja no está abierta';
  end if;
  if v_caja.sesion_activa_id is not null and v_session_id is distinct from v_caja.sesion_activa_id then
    raise exception 'pay_manual_invoice_v1: sesión de caja distinta a la activa';
  end if;

  insert into public.pos_operations(operation_id, kind, invoice_id, request_hash, created_by)
  values (v_operation_id, 'pay_manual', v_invoice_id, v_hash, auth.uid());

  v_saldos := coalesce(v_caja.saldos_metodo, '{}'::jsonb);
  v_saldos := jsonb_set(v_saldos, array[v_bucket], to_jsonb(coalesce((v_saldos->>v_bucket)::numeric, 0) + v_total), true);
  update public.cajas
  set saldos_metodo = v_saldos,
      saldo = coalesce(saldo, 0) + case when v_bucket = 'efectivo' then v_total else 0 end
  where id = v_caja_id;

  v_move_id := gen_random_uuid()::text;
  insert into public.tes_movimientos(id, caja_id, tipo, valor, concepto, fecha, metodo, sesion_id, categoria, bucket, invoice_id, operation_id)
  values (v_move_id, v_caja_id, 'ingreso', v_total,
          'Cobro factura ' || v_invoice.number || coalesce(' · ' || nullif(v_invoice.customer_name, ''), ''),
          coalesce(v_invoice.fecha, current_date), v_method, v_session_id, 'venta_pos', v_bucket, v_invoice_id, v_operation_id);

  -- Las líneas pueden existir ya (backfill histórico); line_key evita duplicarlas.
  if jsonb_typeof(v_invoice.items) = 'array' and jsonb_array_length(v_invoice.items) > 0 then
    insert into public.sale_items(
      sale_id, invoice_id, invoice_number, product_id, product_name, talla, qty, unit_price,
      subtotal, canal, cliente_nombre, cliente_telefono, fecha, fecha_hora, source, line_key, meta
    )
    select
      v_invoice_id::text, v_invoice_id, v_invoice.number,
      nullif(coalesce(line->>'articuloId', line->>'id', ''), ''),
      coalesce(nullif(line->>'nombre', ''), 'Ítem'),
      nullif(line->>'talla', ''),
      coalesce((line->>'qty')::numeric, (line->>'cantidad')::numeric, 1),
      coalesce((line->>'precio')::numeric, (line->>'price')::numeric, 0),
      coalesce((line->>'qty')::numeric, (line->>'cantidad')::numeric, 1)
        * coalesce((line->>'precio')::numeric, (line->>'price')::numeric, 0),
      coalesce(nullif(v_invoice.canal, ''), 'vitrina'),
      nullif(v_invoice.customer_name, ''), nullif(v_invoice.customer_phone, ''),
      coalesce(v_invoice.fecha, current_date), now(), 'manual',
      lower(concat_ws('|', v_invoice_id::text, coalesce(line->>'articuloId', line->>'id', ''),
                      coalesce(line->>'talla', ''),
                      coalesce(line->>'precio', line->>'price', '0'), (ord - 1)::text)),
      jsonb_build_object('operation_id', v_operation_id)
    from jsonb_array_elements(v_invoice.items) with ordinality as x(line, ord)
    on conflict (line_key) do nothing;
    get diagnostics v_lines = row_count;
  end if;

  update public.invoices set estado = 'pagada' where id = v_invoice_id;

  v_response := jsonb_build_object(
    'ok', true,
    'operation_id', v_operation_id,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice.number,
    'total', v_total,
    'lines_created', v_lines,
    'cash', jsonb_build_object(
      'id', v_caja_id,
      'saldo', coalesce(v_caja.saldo, 0) + case when v_bucket = 'efectivo' then v_total else 0 end,
      'saldos_metodo', v_saldos,
      'movement_id', v_move_id
    )
  );

  update public.pos_operations set response = v_response where operation_id = v_operation_id;
  return v_response;
end;
$function$;
