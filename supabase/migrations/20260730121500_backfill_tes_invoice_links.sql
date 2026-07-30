-- Enlaza movimientos POS históricos con invoices usando el número exacto
-- extraído del concepto y la misma fecha. invoices.number es UNIQUE.

create table if not exists public._bak_tes_invoice_link_20260730 (
  movement_id text primary key,
  captured_at timestamptz not null default now(),
  previous_row jsonb not null
);

alter table public._bak_tes_invoice_link_20260730 enable row level security;
revoke all on public._bak_tes_invoice_link_20260730 from anon, authenticated;

create temporary table _tes_invoice_links on commit drop as
select
  t.id movement_id,
  i.id invoice_id,
  count(*) over (partition by t.id) matches
from public.tes_movimientos t
join public.invoices i
  on i.number = substring(t.concepto from 'POS-[0-9]+')
 and i.fecha = t.fecha
where t.invoice_id is null
  and t.tipo = 'ingreso'
  and t.categoria = 'venta_pos';

do $$
declare
  v_rows integer;
  v_distinct integer;
  v_ambiguous integer;
  v_backup integer;
begin
  select count(*), count(distinct movement_id),
         count(*) filter (where matches <> 1)
    into v_rows, v_distinct, v_ambiguous
  from _tes_invoice_links;

  select count(*) into v_backup
  from public._bak_tes_invoice_link_20260730;

  if v_rows = 0 and v_backup = 1549 then
    raise notice 'Los 1549 movimientos ya están enlazados.';
    return;
  end if;

  if v_rows <> 1549 or v_distinct <> 1549 or v_ambiguous <> 0 then
    raise exception
      'tes invoice link guard failed: rows %, distinct %, ambiguous %',
      v_rows, v_distinct, v_ambiguous;
  end if;
end $$;

insert into public._bak_tes_invoice_link_20260730(movement_id, previous_row)
select l.movement_id, to_jsonb(t)
from _tes_invoice_links l
join public.tes_movimientos t on t.id=l.movement_id
on conflict (movement_id) do nothing;

update public.tes_movimientos t
set invoice_id=l.invoice_id
from _tes_invoice_links l
where t.id=l.movement_id;

do $$
declare
  v_backup integer;
  v_unlinked integer;
begin
  select count(*) into v_backup
  from public._bak_tes_invoice_link_20260730;

  select count(*) into v_unlinked
  from public.tes_movimientos t
  join public._bak_tes_invoice_link_20260730 b on b.movement_id=t.id
  where t.invoice_id is null;

  if v_backup <> 1549 or v_unlinked <> 0 then
    raise exception
      'tes invoice link verification failed: backup %, unlinked %',
      v_backup, v_unlinked;
  end if;
end $$;
