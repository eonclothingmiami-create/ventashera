-- Envuelve el RPC POS existente para respetar reservas y cerrar una proforma
-- dentro de la MISMA transacción que crea la factura, descuenta stock y mueve caja.

alter function public.create_pos_sale_v2(jsonb) rename to create_pos_sale_v2_impl;

create or replace function public.create_pos_sale_v2(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_line record;
  v_reserved integer;
  v_source_id uuid;
  v_source public.commercial_documents%rowtype;
  v_order_id uuid;
  v_response jsonb;
  v_invoice_id uuid;
begin
  if coalesce(auth.role(),'') not in ('authenticated','service_role') then
    raise exception 'create_pos_sale_v2: authentication required' using errcode='42501';
  end if;

  begin
    v_source_id := nullif(p_request->>'source_document_id','')::uuid;
  exception when others then
    raise exception 'create_pos_sale_v2: source_document_id inválido';
  end;

  if v_source_id is not null then
    select * into v_source from public.commercial_documents where id=v_source_id for update;
    if not found or v_source.document_type<>'proforma' or v_source.status<>'issued' then
      raise exception 'La prefactura no existe o ya fue procesada';
    end if;
    if exists (
      select 1 from public.commercial_documents
      where id=v_source.parent_id and document_type='sales_order'
    ) then
      v_order_id := v_source.parent_id;
    end if;
  end if;

  -- Bloqueo determinista + disponible = físico - reservas de otras órdenes.
  for v_line in
    select (x->>'product_id')::uuid product_id, sum((x->>'qty')::integer)::integer qty
    from jsonb_array_elements(coalesce(p_request->'lines','[]'::jsonb)) x
    group by 1 order by 1
  loop
    perform 1 from public.products where id=v_line.product_id for update;
    select coalesce(sum(qty),0) into v_reserved
    from public.inventory_reservations
    where product_id=v_line.product_id
      and status='active'
      and (v_order_id is null or document_id<>v_order_id);
    if not exists (
      select 1 from public.products
      where id=v_line.product_id and stock-v_reserved >= v_line.qty
    ) then
      raise exception 'Stock disponible insuficiente: hay unidades reservadas para otras órdenes';
    end if;
  end loop;

  v_response := public.create_pos_sale_v2_impl(p_request);

  if v_source_id is not null then
    v_invoice_id := (v_response->>'invoice_id')::uuid;
    update public.commercial_documents
    set status='converted',converted_invoice_id=v_invoice_id,updated_at=now()
    where id=v_source_id;
    if v_order_id is not null then
      update public.commercial_documents
      set status='converted',converted_invoice_id=v_invoice_id,updated_at=now()
      where id=v_order_id;
      update public.inventory_reservations
      set status='consumed',updated_at=now()
      where document_id=v_order_id and status='active';
    end if;
  end if;
  return v_response;
end;
$function$;
