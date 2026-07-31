-- Unifica contadores POS y evita que state_config.factura baje otra vez.
-- erp_consecutivos.valor = último número emitido.
-- state_config.consecutivos.factura = siguiente a emitir (getNextConsec).

insert into public.erp_consecutivos(clave, valor, updated_at)
select
  'factura',
  coalesce(max(substring(number from '^POS-([0-9]+)$')::bigint), 0),
  now()
from public.invoices
where number ~ '^POS-[0-9]+$'
on conflict (clave) do update
set valor = greatest(public.erp_consecutivos.valor, excluded.valor),
    updated_at = now();

update public.state_config
set value = jsonb_set(
      coalesce(value, '{}'::jsonb),
      '{factura}',
      to_jsonb((
        select greatest(
          coalesce((public.state_config.value->>'factura')::bigint, 0),
          (select valor from public.erp_consecutivos where clave = 'factura'),
          coalesce((select max(substring(number from '^POS-([0-9]+)$')::bigint) from public.invoices where number ~ '^POS-[0-9]+$'), 0)
        ) + 1
      ))
    ),
    updated_at = now()
where key = 'consecutivos';

create or replace function public.state_config_consecutivos_no_regress()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_min bigint;
  v_incoming bigint;
begin
  if new.key is distinct from 'consecutivos' then
    return new;
  end if;

  select greatest(
           coalesce((select valor from public.erp_consecutivos where clave = 'factura'), 0),
           coalesce((select max(substring(number from '^POS-([0-9]+)$')::bigint) from public.invoices where number ~ '^POS-[0-9]+$'), 0)
         ) + 1
    into v_min;

  begin
    v_incoming := coalesce((new.value->>'factura')::bigint, 0);
  exception when others then
    v_incoming := 0;
  end;

  if v_incoming < v_min then
    new.value := jsonb_set(coalesce(new.value, '{}'::jsonb), '{factura}', to_jsonb(v_min), true);
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists state_config_consecutivos_no_regress_trg on public.state_config;
create trigger state_config_consecutivos_no_regress_trg
before insert or update on public.state_config
for each row
execute function public.state_config_consecutivos_no_regress();
