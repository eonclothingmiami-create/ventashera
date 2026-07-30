-- Cierra estructuralmente el hueco que producía facturas faltantes en Consolidado.
--
-- Hasta hoy nada impedía escribir una línea de venta o un ingreso de caja POS sin su
-- factura. Cuando el insert en invoices fallaba (número duplicado desde una pestaña
-- vieja con el consecutivo desactualizado), el resto de la venta sí quedaba grabado y
-- Facturas mostraba menos dinero que Trazabilidad y Consolidado.
--
-- Con estas dos reglas la base rechaza esa escritura parcial en vez de aceptarla:
--   1. sale_items.invoice_id pasa de text a uuid y apunta a invoices(id).
--   2. tes_movimientos exige invoice_id en los ingresos nuevos de categoría venta_pos.
--
-- La segunda se crea NOT VALID a propósito: 90 movimientos de mar–may 2026 son
-- anteriores al enlace y deben conservarse tal como están. La regla solo aplica a
-- filas nuevas o modificadas.

do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans
  from public.sale_items s
  where s.invoice_id is null
     or s.invoice_id = ''
     or not exists (select 1 from public.invoices i where i.id::text = s.invoice_id);
  if v_orphans > 0 then
    raise exception 'No se puede crear la FK: quedan % líneas sin factura. Repáralas primero.', v_orphans;
  end if;
end $$;

alter table public.sale_items
  alter column invoice_id type uuid using invoice_id::uuid;

alter table public.sale_items
  alter column invoice_id set not null;

alter table public.sale_items
  add constraint sale_items_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete cascade;

create index if not exists sale_items_invoice_id_idx on public.sale_items(invoice_id);

alter table public.tes_movimientos
  add constraint tes_movimientos_venta_pos_requires_invoice
  check (categoria is distinct from 'venta_pos' or tipo is distinct from 'ingreso' or invoice_id is not null)
  not valid;
