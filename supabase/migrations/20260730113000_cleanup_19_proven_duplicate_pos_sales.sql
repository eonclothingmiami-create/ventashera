-- Limpieza correctiva de 19 ventas POS duplicadas por reentrada (<5 s).
-- Conserva un respaldo JSON completo y revierte caja/stock antes de borrar.
-- Idempotente: si el respaldo ya contiene 19 filas y no quedan candidatos, no repite.

create table if not exists public._bak_pos_duplicates_20260730 (
  duplicate_id uuid primary key,
  invoice_number text not null,
  captured_at timestamptz not null default now(),
  payload jsonb not null
);

alter table public._bak_pos_duplicates_20260730 enable row level security;
revoke all on public._bak_pos_duplicates_20260730 from anon, authenticated;

create temporary table _dup_cleanup on commit drop as
with pos as (
  select id, number, total, fecha, created_at, estado, items, metodo_pago, canal
  from public.invoices
  where tipo = 'pos' or number like 'POS-%'
), pairs as (
  select
    b.id duplicate_id,
    b.number duplicate_number,
    a.id original_id,
    a.number original_number,
    row_number() over (partition by b.id order by a.created_at asc) rn
  from pos a
  join pos b
    on a.fecha = b.fecha
   and a.items::text = b.items::text
   and a.canal is not distinct from b.canal
   and a.metodo_pago is not distinct from b.metodo_pago
   and a.created_at < b.created_at
   and extract(epoch from (b.created_at - a.created_at)) < 5
  where b.estado <> 'anulada'
)
select duplicate_id, duplicate_number, original_id, original_number
from pairs
where rn = 1;

create temporary table _money_cleanup on commit drop as
with candidates as (
  select
    d.duplicate_id,
    t.id movement_id,
    t.caja_id,
    coalesce(nullif(t.bucket, ''), 'efectivo') bucket,
    t.valor,
    row_number() over (
      partition by d.duplicate_id
      order by
        case when t.invoice_id = d.duplicate_id then 0 else 1 end,
        abs(extract(epoch from (t.created_at - i.created_at)))
    ) rn,
    count(*) over (partition by d.duplicate_id) candidate_count
  from _dup_cleanup d
  join public.invoices i on i.id = d.duplicate_id
  join public.tes_movimientos t
    on t.invoice_id = d.duplicate_id
    or (
      t.invoice_id is null
      and t.fecha = i.fecha
      and t.valor = i.total
      and t.concepto ilike '%' || d.duplicate_number || '%'
    )
)
select duplicate_id, movement_id, caja_id, bucket, valor, candidate_count
from candidates
where rn = 1;

do $$
declare
  v_count integer;
  v_total numeric;
  v_money integer;
  v_money_total numeric;
  v_ambiguous integer;
  v_backup integer;
begin
  select count(*), coalesce(sum(i.total), 0)
    into v_count, v_total
  from _dup_cleanup d
  join public.invoices i on i.id = d.duplicate_id;

  select count(*), coalesce(sum(valor), 0),
         count(*) filter (where candidate_count <> 1)
    into v_money, v_money_total, v_ambiguous
  from _money_cleanup;

  select count(*) into v_backup
  from public._bak_pos_duplicates_20260730;

  if v_count = 0 and v_backup = 19 then
    raise notice 'Las 19 ventas duplicadas ya fueron limpiadas.';
    return;
  end if;

  if v_count <> 19 or v_total <> 1385000 then
    raise exception
      'duplicate cleanup guard failed: invoices %, total %',
      v_count, v_total;
  end if;

  if v_money <> 19 or v_money_total <> 1385000 or v_ambiguous <> 0 then
    raise exception
      'duplicate cleanup money guard failed: rows %, total %, ambiguous %',
      v_money, v_money_total, v_ambiguous;
  end if;
end $$;

insert into public._bak_pos_duplicates_20260730(
  duplicate_id,
  invoice_number,
  payload
)
select
  d.duplicate_id,
  d.duplicate_number,
  jsonb_build_object(
    'reason', 'proven_reentrant_duplicate_under_5_seconds',
    'original_id', d.original_id,
    'original_number', d.original_number,
    'invoice', to_jsonb(i),
    'ventas', coalesce((
      select jsonb_agg(to_jsonb(v))
      from public.ventas v
      where v.id = d.duplicate_id::text
         or v.invoice_id = d.duplicate_id
    ), '[]'::jsonb),
    'sale_items', coalesce((
      select jsonb_agg(to_jsonb(s))
      from public.sale_items s
      where s.invoice_id = d.duplicate_id::text
    ), '[]'::jsonb),
    'stock_moves', coalesce((
      select jsonb_agg(to_jsonb(sm))
      from public.stock_moves sm
      where sm.documento_id = d.duplicate_id
    ), '[]'::jsonb),
    'money_movements', coalesce((
      select jsonb_agg(to_jsonb(tm))
      from _money_cleanup mc
      join public.tes_movimientos tm on tm.id = mc.movement_id
      where mc.duplicate_id = d.duplicate_id
    ), '[]'::jsonb)
  )
from _dup_cleanup d
join public.invoices i on i.id = d.duplicate_id
on conflict (duplicate_id) do nothing;

do $$
declare
  r record;
begin
  for r in
    select caja_id, bucket, sum(valor) amount
    from _money_cleanup
    group by caja_id, bucket
  loop
    update public.cajas
    set
      saldos_metodo = jsonb_set(
        coalesce(saldos_metodo, '{}'::jsonb),
        array[r.bucket],
        to_jsonb(
          coalesce((saldos_metodo ->> r.bucket)::numeric, 0) - r.amount
        ),
        true
      ),
      saldo = coalesce(saldo, 0)
        - case when r.bucket = 'efectivo' then r.amount else 0 end
    where id = r.caja_id;
  end loop;
end $$;

with restore as (
  select
    sm.product_id,
    greatest(0, -sum(coalesce(sm.qty, sm.cantidad, 0)))::integer qty
  from public.stock_moves sm
  join _dup_cleanup d on d.duplicate_id = sm.documento_id
  group by sm.product_id
  having sum(coalesce(sm.qty, sm.cantidad, 0)) < 0
)
update public.products p
set stock = p.stock + r.qty,
    updated_at = now()
from restore r
where p.id = r.product_id;

delete from public.tes_movimientos t
using _money_cleanup m
where t.id = m.movement_id;

delete from public.stock_moves sm
using _dup_cleanup d
where sm.documento_id = d.duplicate_id;

delete from public.sale_items s
using _dup_cleanup d
where s.invoice_id = d.duplicate_id::text;

delete from public.ventas v
using _dup_cleanup d
where v.id = d.duplicate_id::text
   or v.invoice_id = d.duplicate_id;

delete from public.pos_operations p
using _dup_cleanup d
where p.invoice_id = d.duplicate_id;

delete from public.invoices i
using _dup_cleanup d
where i.id = d.duplicate_id;

do $$
declare
  v_remaining integer;
  v_backup integer;
begin
  select count(*) into v_remaining
  from public.invoices i
  join _dup_cleanup d on d.duplicate_id = i.id;

  select count(*) into v_backup
  from public._bak_pos_duplicates_20260730;

  if v_remaining <> 0 or v_backup <> 19 then
    raise exception
      'duplicate cleanup verification failed: remaining %, backup %',
      v_remaining, v_backup;
  end if;
end $$;
