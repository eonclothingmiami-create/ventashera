create or replace function public.confirm_sales_order_v1(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_doc public.commercial_documents%rowtype;
  v_product record;
  v_reserved integer;
begin
  if coalesce(auth.role(),'') not in ('authenticated','service_role') then
    raise exception 'confirm_sales_order_v1: authentication required' using errcode='42501';
  end if;
  select * into v_doc from public.commercial_documents where id=p_document_id for update;
  if not found or v_doc.document_type<>'sales_order' or v_doc.status<>'draft' then
    raise exception 'Solo una orden en borrador puede confirmarse';
  end if;
  for v_product in
    select (coalesce(x->>'product_id',x->>'articuloId'))::uuid product_id,
           sum(coalesce(x->>'qty',x->>'cantidad')::integer)::integer qty
    from jsonb_array_elements(v_doc.items) x
    where coalesce(x->>'product_id',x->>'articuloId','') ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    group by 1 order by 1
  loop
    perform 1 from public.products where id=v_product.product_id for update;
    select coalesce(sum(qty),0) into v_reserved
    from public.inventory_reservations
    where product_id=v_product.product_id and status='active';
    if not exists (
      select 1 from public.products
      where id=v_product.product_id and stock-v_reserved >= v_product.qty
    ) then
      raise exception 'Stock disponible insuficiente para confirmar la orden';
    end if;
    insert into public.inventory_reservations(document_id,product_id,qty)
    values(v_doc.id,v_product.product_id,v_product.qty);
  end loop;
  update public.commercial_documents set status='confirmed',updated_at=now() where id=v_doc.id;
  return jsonb_build_object('ok',true,'id',v_doc.id,'number',v_doc.number,'action','confirm_order');
end;
$function$;
