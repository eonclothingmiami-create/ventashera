-- Migra altas de FAC manual + NC/ND/REM/DEV/ANT fuera de legacy_docs/getNextConsec.
-- - FAC: create_manual_invoice_v1 → invoices (borrador; cobro sigue en pay_manual_invoice_v1)
-- - NC/ND/REM/DEV/ANT: create_commercial_document_v1 ampliado → commercial_documents
-- No mueve caja ni stock en el alta (igual que el camino legacy actual).

-- 1) Tipos comerciales ampliados
alter table public.commercial_documents
  drop constraint if exists commercial_documents_document_type_check;

alter table public.commercial_documents
  add constraint commercial_documents_document_type_check
  check (document_type = any (array[
    'quotation'::text,
    'sales_order'::text,
    'proforma'::text,
    'credit_note'::text,
    'debit_note'::text,
    'remittance'::text,
    'return_doc'::text,
    'customer_advance'::text
  ]));

-- 2) Consecutivos: seed sin regresiones (valor = último usado)
insert into public.erp_consecutivos (clave, valor)
values
  ('nc', greatest(coalesce((select (value->>'nc')::bigint - 1 from public.state_config where key = 'consecutivos'), 0), 0)),
  ('nd', greatest(coalesce((select (value->>'nd')::bigint - 1 from public.state_config where key = 'consecutivos'), 0), 0)),
  ('remision', greatest(coalesce((select (value->>'remision')::bigint - 1 from public.state_config where key = 'consecutivos'), 0), 0)),
  ('devolucion', greatest(coalesce((select (value->>'devolucion')::bigint - 1 from public.state_config where key = 'consecutivos'), 0), 0)),
  ('anticipo', greatest(coalesce((select (value->>'anticipo')::bigint - 1 from public.state_config where key = 'consecutivos'), 0), 0)),
  (
    'factura_manual',
    coalesce((select max(substring(number from '^FAC-([0-9]+)$')::bigint) from public.invoices where number ~ '^FAC-[0-9]+$'), 0)
  )
on conflict (clave) do update
set valor = greatest(public.erp_consecutivos.valor, excluded.valor),
    updated_at = now();

-- 3) create_commercial_document_v1 con tipos nuevos
create or replace function public.create_commercial_document_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_type text := p_request->>'document_type';
  v_status text := coalesce(nullif(p_request->>'status',''),'draft');
  v_items jsonb := coalesce(p_request->'items','[]'::jsonb);
  v_id uuid := coalesce(nullif(p_request->>'id','')::uuid, gen_random_uuid());
  v_number text;
  v_prefix text;
  v_counter_key text;
  v_subtotal numeric;
  v_tax numeric := greatest(coalesce((p_request->>'tax')::numeric,0),0);
  v_shipping numeric := greatest(coalesce((p_request->>'shipping')::numeric,0),0);
  v_total numeric;
begin
  if coalesce(auth.role(),'') not in ('anon','authenticated','service_role') then
    raise exception 'create_commercial_document_v1: authentication required' using errcode='42501';
  end if;
  if v_type not in (
    'quotation','sales_order','proforma',
    'credit_note','debit_note','remittance','return_doc','customer_advance'
  ) then
    raise exception 'Tipo de documento comercial inválido';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items)=0 then
    raise exception 'El documento requiere al menos una línea';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) x
    where coalesce(x->>'name',x->>'nombre','')=''
       or coalesce(x->>'qty',x->>'cantidad','') !~ '^[1-9][0-9]*$'
       or coalesce(x->>'unit_price',x->>'precio','') !~ '^[0-9]+([.][0-9]+)?$'
  ) then
    raise exception 'Hay líneas con descripción, cantidad o precio inválido';
  end if;

  select coalesce(sum(
    coalesce(x->>'qty',x->>'cantidad')::numeric *
    coalesce(x->>'unit_price',x->>'precio')::numeric
  ),0) into v_subtotal
  from jsonb_array_elements(v_items) x;
  v_total := v_subtotal + v_tax + v_shipping;

  v_prefix := case v_type
    when 'quotation' then 'COT'
    when 'sales_order' then 'OV'
    when 'proforma' then 'PRO'
    when 'credit_note' then 'NC'
    when 'debit_note' then 'ND'
    when 'remittance' then 'REM'
    when 'return_doc' then 'DEV'
    else 'ANT'
  end;
  v_counter_key := case v_type
    when 'quotation' then 'cotizacion'
    when 'sales_order' then 'orden'
    when 'proforma' then 'prefactura'
    when 'credit_note' then 'nc'
    when 'debit_note' then 'nd'
    when 'remittance' then 'remision'
    when 'return_doc' then 'devolucion'
    else 'anticipo'
  end;
  v_number := v_prefix || '-' || lpad(public.increment_erp_consecutivo(v_counter_key)::text,5,'0');

  insert into public.commercial_documents(
    id,number,document_type,status,parent_id,document_date,valid_until,
    customer_name,customer_phone,customer_document,customer_address,channel,notes,
    items,subtotal,tax,shipping,total,metadata,created_by
  ) values (
    v_id,v_number,v_type,v_status,nullif(p_request->>'parent_id','')::uuid,
    coalesce(nullif(p_request->>'document_date','')::date,current_date),
    nullif(p_request->>'valid_until','')::date,
    coalesce(p_request->>'customer_name',''),coalesce(p_request->>'customer_phone',''),
    coalesce(p_request->>'customer_document',''),coalesce(p_request->>'customer_address',''),
    coalesce(nullif(p_request->>'channel',''),'vitrina'),coalesce(p_request->>'notes',''),
    v_items,v_subtotal,v_tax,v_shipping,v_total,
    coalesce(p_request->'metadata','{}'::jsonb) || jsonb_build_object(
      'factura_ref', coalesce(p_request->>'factura_ref','')
    ),
    auth.uid()
  );
  return jsonb_build_object('ok',true,'id',v_id,'number',v_number,'document_type',v_type,'status',v_status,'total',v_total);
end;
$function$;

-- 4) Alta atómica de factura manual (borrador; sin caja/stock)
create or replace function public.create_manual_invoice_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_items jsonb := coalesce(p_request->'items','[]'::jsonb);
  v_id uuid := coalesce(nullif(p_request->>'id','')::uuid, gen_random_uuid());
  v_number text;
  v_subtotal numeric;
  v_tax numeric := greatest(coalesce((p_request->>'tax')::numeric,0),0);
  v_shipping numeric := greatest(coalesce((p_request->>'shipping')::numeric,0),0);
  v_total numeric;
  v_fecha date := coalesce(nullif(p_request->>'document_date','')::date, current_date);
begin
  if coalesce(auth.role(),'') not in ('anon','authenticated','service_role') then
    raise exception 'create_manual_invoice_v1: authentication required' using errcode='42501';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items)=0 then
    raise exception 'La factura requiere al menos una línea';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) x
    where coalesce(x->>'name',x->>'nombre','')=''
       or coalesce(x->>'qty',x->>'cantidad','') !~ '^[1-9][0-9]*$'
       or coalesce(x->>'unit_price',x->>'precio','') !~ '^[0-9]+([.][0-9]+)?$'
  ) then
    raise exception 'Hay líneas con descripción, cantidad o precio inválido';
  end if;

  select coalesce(sum(
    coalesce(x->>'qty',x->>'cantidad')::numeric *
    coalesce(x->>'unit_price',x->>'precio')::numeric
  ),0) into v_subtotal
  from jsonb_array_elements(v_items) x;
  v_total := v_subtotal + v_tax + v_shipping;

  v_number := 'FAC-' || lpad(public.increment_erp_consecutivo('factura_manual')::text,5,'0');

  insert into public.invoices(
    id, number, customer_name, customer_phone, total, subtotal, iva, flete, fecha,
    canal, metodo_pago, estado, tipo, items, direccion, cedula_cliente, comprobante
  ) values (
    v_id,
    v_number,
    coalesce(p_request->>'customer_name',''),
    coalesce(p_request->>'customer_phone',''),
    v_total,
    v_subtotal,
    v_tax,
    v_shipping,
    v_fecha,
    coalesce(nullif(p_request->>'channel',''),'vitrina'),
    coalesce(nullif(p_request->>'method',''),'efectivo'),
    'borrador',
    'manual',
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'articuloId', coalesce(x->>'product_id', x->>'articuloId', ''),
          'nombre', coalesce(x->>'name', x->>'nombre', ''),
          'talla', coalesce(x->>'size', x->>'talla', ''),
          'qty', coalesce(x->>'qty', x->>'cantidad')::numeric,
          'cantidad', coalesce(x->>'qty', x->>'cantidad')::numeric,
          'precio', coalesce(x->>'unit_price', x->>'precio')::numeric,
          'price', coalesce(x->>'unit_price', x->>'precio')::numeric
        )
      ), '[]'::jsonb)
      from jsonb_array_elements(v_items) x
    ),
    coalesce(p_request->>'customer_address',''),
    coalesce(p_request->>'customer_document',''),
    coalesce(p_request->>'comprobante','')
  );

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'number', v_number,
    'document_type', 'manual_invoice',
    'status', 'borrador',
    'total', v_total,
    'notes', coalesce(p_request->>'notes','')
  );
end;
$function$;

revoke all on function public.create_manual_invoice_v1(jsonb) from public;
grant execute on function public.create_manual_invoice_v1(jsonb) to anon, authenticated, service_role;
grant execute on function public.create_commercial_document_v1(jsonb) to anon, authenticated, service_role;
