-- Alinea el contador transaccional con el mayor POS existente antes de activar
-- create_pos_sale_v2 en el frontend. Nunca reduce el contador.
insert into public.erp_consecutivos(clave, valor, updated_at)
select
  'factura',
  coalesce(max(substring(number from '^POS-([0-9]+)$')::bigint), 0),
  now()
from public.invoices
where number ~ '^POS-[0-9]+$'
on conflict (clave) do update
set valor = greatest(
      public.erp_consecutivos.valor,
      excluded.valor
    ),
    updated_at = now();
