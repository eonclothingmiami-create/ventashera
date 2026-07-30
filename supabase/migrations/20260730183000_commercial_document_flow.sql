-- Flujo comercial canónico:
-- cotización -> orden confirmada (reserva) -> proforma -> factura POS (venta real).
-- Ningún documento comercial mueve caja ni descuenta stock.

create table if not exists public.commercial_documents (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  document_type text not null check (document_type in ('quotation','sales_order','proforma')),
  status text not null default 'draft'
    check (status in ('draft','sent','accepted','confirmed','issued','converted','cancelled','expired')),
  parent_id uuid references public.commercial_documents(id) on delete set null,
  converted_invoice_id uuid references public.invoices(id) on delete set null,
  document_date date not null default current_date,
  valid_until date,
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_document text not null default '',
  customer_address text not null default '',
  channel text not null default 'vitrina',
  notes text not null default '',
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  subtotal numeric not null default 0 check (subtotal >= 0),
  tax numeric not null default 0 check (tax >= 0),
  shipping numeric not null default 0 check (shipping >= 0),
  total numeric not null default 0 check (total >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commercial_documents_type_date_idx
  on public.commercial_documents(document_type, document_date desc, created_at desc);
create index if not exists commercial_documents_parent_idx
  on public.commercial_documents(parent_id);
create unique index if not exists commercial_documents_one_live_conversion_idx
  on public.commercial_documents(parent_id, document_type)
  where parent_id is not null and status <> 'cancelled';

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.commercial_documents(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty integer not null check (qty > 0),
  status text not null default 'active' check (status in ('active','released','consumed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_id, product_id)
);

create index if not exists inventory_reservations_active_product_idx
  on public.inventory_reservations(product_id)
  where status = 'active';

alter table public.commercial_documents enable row level security;
alter table public.inventory_reservations enable row level security;

drop policy if exists commercial_documents_authenticated_all on public.commercial_documents;
create policy commercial_documents_authenticated_all
  on public.commercial_documents for all to authenticated
  using (true) with check (true);

drop policy if exists inventory_reservations_authenticated_read on public.inventory_reservations;
create policy inventory_reservations_authenticated_read
  on public.inventory_reservations for select to authenticated using (true);

-- Conserva cotizaciones y órdenes antiguas. Las "factura" de legacy_docs no se
-- migran: no son proformas y varias duplican registros de invoices.
with legacy_source as (
  select
    l.*,
    coalesce(
      nullif(l.numero,''),
      case when l.tipo='cotizacion' then 'COT-' else 'OV-' end || l.id::text
    ) as base_number,
    row_number() over (
      partition by coalesce(
        nullif(l.numero,''),
        case when l.tipo='cotizacion' then 'COT-' else 'OV-' end || l.id::text
      )
      order by l.created_at, l.id
    ) as duplicate_ordinal
  from public.legacy_docs l
  where l.tipo in ('cotizacion','orden')
)
insert into public.commercial_documents (
  id, number, document_type, status, document_date, customer_name, notes, items,
  subtotal, tax, shipping, total, created_at, updated_at, metadata
)
select
  l.id,
  case
    when l.duplicate_ordinal = 1 then l.base_number
    else l.base_number || '-MIG-' || left(l.id::text,8)
  end,
  case when l.tipo='cotizacion' then 'quotation' else 'sales_order' end,
  case
    when l.data->>'estado' in ('anulada','cancelled') then 'cancelled'
    when l.data->>'estado' in ('aprobada','accepted') then 'accepted'
    when l.data->>'estado' in ('confirmada','confirmed') then 'confirmed'
    else 'draft'
  end,
  coalesce(nullif(l.data->>'fecha','')::date, l.created_at::date),
  coalesce(l.data->>'cliente',''),
  coalesce(l.data->>'observaciones',''),
  case when jsonb_typeof(l.data->'items')='array' then l.data->'items' else '[]'::jsonb end,
  coalesce((l.data->>'subtotal')::numeric,0),
  coalesce((l.data->>'iva')::numeric,0),
  coalesce((l.data->>'flete')::numeric,0),
  coalesce((l.data->>'total')::numeric,0),
  l.created_at,
  l.created_at,
  jsonb_build_object('migrated_from','legacy_docs')
from legacy_source l
on conflict (id) do nothing;

create or replace function public.create_commercial_document_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
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
  if coalesce(auth.role(),'') not in ('authenticated','service_role') then
    raise exception 'create_commercial_document_v1: authentication required' using errcode='42501';
  end if;
  if v_type not in ('quotation','sales_order','proforma') then
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

  v_prefix := case v_type when 'quotation' then 'COT' when 'sales_order' then 'OV' else 'PRO' end;
  v_counter_key := case v_type when 'quotation' then 'cotizacion' when 'sales_order' then 'orden' else 'prefactura' end;
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
    v_items,v_subtotal,v_tax,v_shipping,v_total,coalesce(p_request->'metadata','{}'::jsonb),auth.uid()
  );
  return jsonb_build_object('ok',true,'id',v_id,'number',v_number,'document_type',v_type,'status',v_status,'total',v_total);
end;
$function$;

create or replace function public.transition_commercial_document_v1(p_document_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_doc public.commercial_documents%rowtype;
  v_child_id uuid;
  v_child_number text;
  v_product record;
  v_reserved integer;
begin
  if coalesce(auth.role(),'') not in ('authenticated','service_role') then
    raise exception 'transition_commercial_document_v1: authentication required' using errcode='42501';
  end if;
  select * into v_doc from public.commercial_documents where id=p_document_id for update;
  if not found then raise exception 'Documento comercial no encontrado'; end if;

  if p_action='quote_to_order' then
    if v_doc.document_type<>'quotation' or v_doc.status in ('cancelled','expired','converted') then
      raise exception 'La cotización no puede convertirse a orden';
    end if;
    v_child_id := gen_random_uuid();
    v_child_number := 'OV-' || lpad(public.increment_erp_consecutivo('orden')::text,5,'0');
    insert into public.commercial_documents(
      id,number,document_type,status,parent_id,document_date,valid_until,
      customer_name,customer_phone,customer_document,customer_address,channel,notes,
      items,subtotal,tax,shipping,total,metadata,created_by
    ) select
      v_child_id,v_child_number,'sales_order','confirmed',id,current_date,valid_until,
      customer_name,customer_phone,customer_document,customer_address,channel,notes,
      items,subtotal,tax,shipping,total,metadata,auth.uid()
    from public.commercial_documents where id=v_doc.id;

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
      from public.inventory_reservations where product_id=v_product.product_id and status='active';
      if not exists (
        select 1 from public.products
        where id=v_product.product_id and stock-v_reserved >= v_product.qty
      ) then
        raise exception 'Stock disponible insuficiente para reservar el producto %',v_product.product_id;
      end if;
      insert into public.inventory_reservations(document_id,product_id,qty)
      values(v_child_id,v_product.product_id,v_product.qty);
    end loop;
    update public.commercial_documents set status='accepted',updated_at=now() where id=v_doc.id;

  elsif p_action='order_to_proforma' then
    if v_doc.document_type<>'sales_order' or v_doc.status<>'confirmed' then
      raise exception 'Solo una orden confirmada puede generar proforma';
    end if;
    v_child_id := gen_random_uuid();
    v_child_number := 'PRO-' || lpad(public.increment_erp_consecutivo('prefactura')::text,5,'0');
    insert into public.commercial_documents(
      id,number,document_type,status,parent_id,document_date,valid_until,
      customer_name,customer_phone,customer_document,customer_address,channel,notes,
      items,subtotal,tax,shipping,total,metadata,created_by
    ) select
      v_child_id,v_child_number,'proforma','issued',id,current_date,valid_until,
      customer_name,customer_phone,customer_document,customer_address,channel,notes,
      items,subtotal,tax,shipping,total,metadata,auth.uid()
    from public.commercial_documents where id=v_doc.id;

  elsif p_action='cancel' then
    if v_doc.status in ('converted','cancelled') then raise exception 'El documento ya está cerrado'; end if;
    update public.commercial_documents set status='cancelled',updated_at=now() where id=v_doc.id;
    if v_doc.document_type='sales_order' then
      update public.inventory_reservations set status='released',updated_at=now()
      where document_id=v_doc.id and status='active';
    end if;
    v_child_id := v_doc.id;
    v_child_number := v_doc.number;
  else
    raise exception 'Transición comercial inválida';
  end if;

  return jsonb_build_object('ok',true,'id',v_child_id,'number',v_child_number,'action',p_action);
end;
$function$;
