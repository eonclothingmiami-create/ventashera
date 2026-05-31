-- ============================================================================
-- AUDITORÍA NO DESTRUCTIVA — facturas manuales con líneas SIN nombre de producto.
--
-- Motivo: el formulario "+ Factura" (factura manual) permitía guardar líneas con
-- precio pero sin descripción (nombre/talla vacíos) cuando no se seleccionaba un
-- artículo del catálogo. En el PDF se ven como "una sola prenda sin nombre".
-- Caso real detectado: FAC-00413 (18 × 35.000 = 630.000), tipo=manual, borrador.
--
-- Reglas:
--   * SOLO LECTURA. No ejecuta UPDATE/DELETE/INSERT. No modifica ninguna factura.
--   * Los totales de estas facturas SÍ cuadran (qty × precio = total); el problema
--     es de calidad de captura, no contable. Cualquier corrección es decisión
--     manual del negocio (son borradores de bajo valor).
-- ============================================================================

-- 1) Resumen: cuántas facturas tienen ≥1 línea sin nombre y su impacto.
select
  count(*) filter (where items_sin_nombre > 0)                              as facturas_con_lineas_sin_nombre,
  count(*)                                                                  as total_facturas_con_items,
  round(100.0 * count(*) filter (where items_sin_nombre > 0)
        / nullif(count(*), 0), 1)                                          as pct,
  max(total) filter (where items_sin_nombre > 0)                           as max_total_afectada
from (
  select
    i.id,
    i.total::numeric as total,
    (select count(*)
       from jsonb_array_elements(i.items) it
      where coalesce(trim(it->>'nombre'), '') = '')                        as items_sin_nombre
  from public.invoices i
  where i.items is not null
) e;

-- 2) Detalle: facturas afectadas (para revisión manual; ordenadas por monto).
select
  i.id,
  i.number,
  i.customer_name,
  i.total::numeric                      as total,
  i.tipo,
  i.estado,
  i.canal,
  (i.created_at)::date                  as fecha,
  jsonb_array_length(i.items)           as n_items,
  (select count(*)
     from jsonb_array_elements(i.items) it
    where coalesce(trim(it->>'nombre'), '') = '')   as lineas_sin_nombre,
  i.items
from public.invoices i
where i.items is not null
  and (select count(*)
         from jsonb_array_elements(i.items) it
        where coalesce(trim(it->>'nombre'), '') = '') > 0
order by i.total::numeric desc;

-- 3) (Opcional) Sanidad: confirmar que en estas facturas el total = suma(qty×precio),
--    es decir que NO hay descuadre contable (más allá del flete).
select
  i.number,
  i.total::numeric                                  as total,
  i.flete::numeric                                  as flete,
  (select coalesce(sum(
            (coalesce((it->>'cantidad'), (it->>'qty'), '0'))::numeric
          * (coalesce((it->>'precio'),   (it->>'price'), '0'))::numeric), 0)
     from jsonb_array_elements(i.items) it)         as suma_items,
  i.total::numeric
    - i.flete::numeric
    - (select coalesce(sum(
            (coalesce((it->>'cantidad'), (it->>'qty'), '0'))::numeric
          * (coalesce((it->>'precio'),   (it->>'price'), '0'))::numeric), 0)
         from jsonb_array_elements(i.items) it)     as diff_sin_flete
from public.invoices i
where i.items is not null
  and (select count(*)
         from jsonb_array_elements(i.items) it
        where coalesce(trim(it->>'nombre'), '') = '') > 0
order by abs(
  i.total::numeric - i.flete::numeric
  - (select coalesce(sum(
        (coalesce((it->>'cantidad'), (it->>'qty'), '0'))::numeric
      * (coalesce((it->>'precio'),   (it->>'price'), '0'))::numeric), 0)
     from jsonb_array_elements(i.items) it)
) desc;
