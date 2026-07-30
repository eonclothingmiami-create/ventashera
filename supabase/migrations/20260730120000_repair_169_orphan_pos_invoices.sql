-- Reconstruye 169 facturas POS legítimas cuyo INSERT falló por colisión del
-- consecutivo local. sale_items, dinero y stock sí quedaron persistidos.
-- La unión movimiento↔venta está probada por número, fecha y <=10 s.

create table if not exists public._bak_pos_orphan_repair_20260730 (
  invoice_id uuid primary key,
  old_invoice_number text not null,
  repaired_invoice_number text,
  captured_at timestamptz not null default now(),
  payload jsonb not null
);

alter table public._bak_pos_orphan_repair_20260730 enable row level security;
revoke all on public._bak_pos_orphan_repair_20260730 from anon, authenticated;

create temporary table _orphan_repair on commit drop as
select
  s.invoice_id::uuid invoice_id,
  min(s.invoice_number) old_number,
  s.fecha,
  sum(s.subtotal) total,
  min(s.created_at) created_at,
  min(s.canal) canal,
  min(nullif(s.cliente_nombre, '')) cliente_nombre,
  min(nullif(s.cliente_telefono, '')) cliente_telefono,
  null::text new_number
from public.sale_items s
left join public.invoices i on i.id::text = s.invoice_id
where i.id is null
  and s.source = 'pos'
group by s.invoice_id, s.fecha;

create temporary table _orphan_money on commit drop as
select
  o.invoice_id,
  t.id movement_id,
  t.valor,
  t.metodo,
  t.bucket,
  t.created_at
from _orphan_repair o
join public.tes_movimientos t
  on t.invoice_id is null
 and t.fecha = o.fecha
 and t.concepto ilike '%' || o.old_number || '%'
 and abs(extract(epoch from (t.created_at - o.created_at))) < 10;

do $$
declare
  v_orphans integer;
  v_matched integer;
  v_money_rows integer;
  v_distinct_money integer;
  v_orphan_total numeric;
  v_money_total numeric;
  v_backup integer;
begin
  select count(*), coalesce(sum(total), 0)
    into v_orphans, v_orphan_total
  from _orphan_repair;

  select count(distinct invoice_id), count(*), count(distinct movement_id),
         coalesce(sum(valor), 0)
    into v_matched, v_money_rows, v_distinct_money, v_money_total
  from _orphan_money;

  select count(*) into v_backup
  from public._bak_pos_orphan_repair_20260730;

  if v_orphans = 0 and v_backup = 169 then
    raise notice 'Las 169 facturas huérfanas ya fueron reparadas.';
    return;
  end if;

  if v_orphans <> 169
     or v_matched <> 169
     or v_money_rows <> 170
     or v_distinct_money <> 170
     or v_orphan_total <> 18176950
     or v_money_total <> 18176950 then
    raise exception
      'orphan repair guard failed: orphans %, matched %, money rows %/%, totals %/%',
      v_orphans, v_matched, v_money_rows, v_distinct_money,
      v_orphan_total, v_money_total;
  end if;
end $$;

do $$
declare
  r record;
  v_counter bigint;
begin
  for r in
    select invoice_id
    from _orphan_repair
    order by created_at, invoice_id
  loop
    v_counter := public.increment_erp_consecutivo('factura');
    update _orphan_repair
    set new_number = 'POS-' || lpad(v_counter::text, 5, '0')
    where invoice_id = r.invoice_id;
  end loop;
end $$;

insert into public._bak_pos_orphan_repair_20260730(
  invoice_id,
  old_invoice_number,
  repaired_invoice_number,
  payload
)
select
  o.invoice_id,
  o.old_number,
  o.new_number,
  jsonb_build_object(
    'reason', 'invoice_insert_failed_due_to_duplicate_number',
    'fecha', o.fecha,
    'total', o.total,
    'sale_items', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at, s.id)
      from public.sale_items s
      where s.invoice_id = o.invoice_id::text
    ), '[]'::jsonb),
    'money_movements', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at, t.id)
      from _orphan_money om
      join public.tes_movimientos t on t.id = om.movement_id
      where om.invoice_id = o.invoice_id
    ), '[]'::jsonb),
    'stock_moves', coalesce((
      select jsonb_agg(to_jsonb(sm) order by sm.created_at, sm.id)
      from public.stock_moves sm
      where sm.documento_id = o.invoice_id
    ), '[]'::jsonb)
  )
from _orphan_repair o
on conflict (invoice_id) do nothing;

insert into public.invoices(
  id,
  number,
  customer_name,
  customer_phone,
  total,
  created_at,
  subtotal,
  iva,
  flete,
  fecha,
  canal,
  metodo_pago,
  estado,
  tipo,
  items,
  es_separado,
  tipo_pago
)
select
  o.invoice_id,
  o.new_number,
  o.cliente_nombre,
  o.cliente_telefono,
  o.total,
  o.created_at,
  o.total,
  0,
  0,
  o.fecha,
  coalesce(nullif(o.canal, ''), 'vitrina'),
  case
    when (select count(*) from _orphan_money om where om.invoice_id=o.invoice_id) > 1
      then 'mixto'
    else coalesce((
      select min(nullif(om.metodo, ''))
      from _orphan_money om
      where om.invoice_id=o.invoice_id
    ), 'efectivo')
  end,
  'pagada',
  'pos',
  (
    select jsonb_agg(
      jsonb_build_object(
        'articuloId', s.product_id,
        'nombre', s.product_name,
        'talla', coalesce(s.talla, ''),
        'qty', s.qty,
        'cantidad', s.qty,
        'precio', s.unit_price,
        'price', s.unit_price
      )
      order by s.created_at, s.id
    )
    from public.sale_items s
    where s.invoice_id=o.invoice_id::text
  ),
  false,
  'contado'
from _orphan_repair o;

insert into public.ventas(
  id,
  fecha,
  canal,
  valor,
  cliente,
  telefono,
  liquidado,
  es_separado,
  estado_entrega,
  referencia,
  metodo_pago,
  archived,
  tipo_pago,
  es_contraentrega,
  stock_products_pending,
  invoice_id
)
select
  o.invoice_id::text,
  o.fecha,
  coalesce(nullif(o.canal, ''), 'vitrina'),
  o.total,
  coalesce(o.cliente_nombre, ''),
  coalesce(o.cliente_telefono, ''),
  true,
  false,
  'Pendiente',
  o.new_number,
  case
    when (select count(*) from _orphan_money om where om.invoice_id=o.invoice_id) > 1
      then 'mixto'
    else coalesce((
      select min(nullif(om.metodo, ''))
      from _orphan_money om
      where om.invoice_id=o.invoice_id
    ), 'efectivo')
  end,
  false,
  'contado',
  false,
  '[]'::jsonb,
  o.invoice_id
from _orphan_repair o
on conflict (id) do update
set invoice_id = excluded.invoice_id,
    referencia = excluded.referencia;

update public.sale_items s
set invoice_number = o.new_number,
    updated_at = now()
from _orphan_repair o
where s.invoice_id = o.invoice_id::text;

update public.stock_moves sm
set referencia = o.new_number
from _orphan_repair o
where sm.documento_id = o.invoice_id;

update public.tes_movimientos t
set invoice_id = o.invoice_id,
    concepto = replace(t.concepto, o.old_number, o.new_number)
from _orphan_money om
join _orphan_repair o on o.invoice_id = om.invoice_id
where t.id = om.movement_id;

do $$
declare
  v_backup integer;
  v_invoices integer;
  v_orphans integer;
  v_linked_money integer;
begin
  select count(*) into v_backup
  from public._bak_pos_orphan_repair_20260730;

  select count(*) into v_invoices
  from public.invoices i
  join public._bak_pos_orphan_repair_20260730 b on b.invoice_id=i.id;

  select count(distinct s.invoice_id) into v_orphans
  from public.sale_items s
  left join public.invoices i on i.id::text=s.invoice_id
  where i.id is null and s.source='pos';

  select count(*) into v_linked_money
  from public.tes_movimientos t
  join public._bak_pos_orphan_repair_20260730 b on b.invoice_id=t.invoice_id;

  if v_backup <> 169
     or v_invoices <> 169
     or v_orphans <> 0
     or v_linked_money <> 170 then
    raise exception
      'orphan repair verification failed: backup %, invoices %, orphans %, money %',
      v_backup, v_invoices, v_orphans, v_linked_money;
  end if;
end $$;
