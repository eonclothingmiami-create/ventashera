-- ============================================================================
-- sales_consolidation_cleanup_audit.sql
-- AUDITORÍA NO DESTRUCTIVA post-consolidación `sale_items`.
--
-- REGLAS:
--   * Este archivo SOLO contiene SELECT. No hay DELETE, UPDATE ni DDL.
--   * No modifica datos, no toca caja ni stock. Es seguro ejecutarlo en prod.
--   * Ejecutar consulta por consulta en el SQL Editor de Supabase y revisar.
--
-- ESQUEMA REAL VERIFICADO (no asumir columnas que no existen):
--   ventas(id text, fecha, canal, valor, cliente, telefono, referencia,
--          invoice_id, liquidado, es_contraentrega, tipo_pago, estado_entrega,
--          archived, ...)  -- OJO: no existe columna `anulada` (la anulación
--                             vive en invoices.estado='anulada').
--   invoices(id, number, customer_name, customer_phone, total, subtotal, iva,
--            flete, fecha, canal, metodo_pago, estado, tipo, items jsonb, ...)
--   stock_moves(id, product_id, bodega_id, tipo, referencia, documento_id,
--               fecha, nota, qty [+ legacy cantidad/quantity])
--   tes_movimientos(id, caja_id, tipo, valor, concepto, fecha, metodo,
--                   categoria, bucket, sesion_id, ref_abono_prov_id)
--                   -- OJO: NO existe `meta` ni `facturaId`. La relación con la
--                   -- venta es por `concepto` (texto "Venta POS POS-####").
--   sale_items(... invoice_id, sale_id, product_id, talla, qty, unit_price,
--              source, line_key)  -- la clave de dedupe es `line_key` (no `line_hash`).
-- ============================================================================


-- ###########################################################################
-- FASE 1.1 — VENTAS DUPLICADAS / HUÉRFANAS
-- ###########################################################################

-- 1.1.a Ventas con la misma `referencia` (consecutivo repetido = sospecha de duplicado).
select referencia, count(*) as n, array_agg(id) as venta_ids
from public.ventas
where referencia is not null and referencia <> ''
group by referencia
having count(*) > 1
order by n desc;

-- 1.1.b Ventas que comparten el mismo `invoice_id` (debería ser 1:1 con la factura).
select invoice_id, count(*) as n, array_agg(id) as venta_ids
from public.ventas
where invoice_id is not null
group by invoice_id
having count(*) > 1
order by n desc;

-- 1.1.c Posible duplicado lógico: mismo cliente + fecha + total(valor) + canal.
select cliente, fecha, valor, canal, count(*) as n, array_agg(id) as venta_ids
from public.ventas
group by cliente, fecha, valor, canal
having count(*) > 1
order by n desc, fecha desc;

-- 1.1.d Ventas SIN factura correspondiente (no hay invoices con ese id ni invoice_id).
--       En POS el invariante es ventas.id = invoices.id; revisamos ambos caminos.
select v.id as venta_id, v.referencia, v.invoice_id, v.fecha, v.valor
from public.ventas v
left join public.invoices i
  on i.id::text = v.id::text
  or (v.invoice_id is not null and i.id::text = v.invoice_id::text)
where i.id is null
order by v.fecha desc;

-- 1.1.e Facturas SIN venta correspondiente (factura POS sin fila en ventas).
select i.id as invoice_id, i.number, i.tipo, i.fecha, i.total
from public.invoices i
left join public.ventas v
  on v.id::text = i.id::text or v.invoice_id::text = i.id::text
where v.id is null
  and (i.tipo = 'pos' or i.number ilike 'POS-%')   -- las manuales legítimamente no tienen venta
order by i.fecha desc;


-- ###########################################################################
-- FASE 1.2 — FACTURAS DUPLICADAS
-- ###########################################################################

-- 1.2.a Mismo `number` (consecutivo de factura repetido).
select number, count(*) as n, array_agg(id) as invoice_ids
from public.invoices
where number is not null and number <> ''
group by number
having count(*) > 1
order by n desc;

-- 1.2.b Mismo `id` físico (sólo posible si hubo carga manual mal hecha; PK debería impedirlo).
--       Se deja como verificación defensiva.
select id, count(*) as n
from public.invoices
group by id
having count(*) > 1;

-- 1.2.c Duplicado lógico: mismo cliente + fecha + total.
select customer_name, fecha, total, count(*) as n, array_agg(id) as invoice_ids
from public.invoices
group by customer_name, fecha, total
having count(*) > 1
order by n desc, fecha desc;

-- 1.2.d Facturas POS SIN items (no se puede reconstruir líneas / sale_items).
--       Tolera items en jsonb array o ausente.
select id, number, fecha, total
from public.invoices
where (tipo = 'pos' or number ilike 'POS-%')
  and (
    items is null
    or jsonb_typeof(items) <> 'array'
    or jsonb_array_length(items) = 0
  )
order by fecha desc;

-- 1.2.e Facturas POS sin relación con `ventas`. (Igual que 1.1.e; se repite por
--       claridad del bloque "facturas". El resultado debe coincidir.)
select i.id, i.number, i.fecha, i.total
from public.invoices i
left join public.ventas v
  on v.id::text = i.id::text or v.invoice_id::text = i.id::text
where (i.tipo = 'pos' or i.number ilike 'POS-%')
  and v.id is null
order by i.fecha desc;


-- ###########################################################################
-- FASE 1.3 — LÍNEAS DUPLICADAS EN sale_items
-- ###########################################################################

-- 1.3.a Duplicado de negocio: mismo invoice_id + product_id + talla + qty + unit_price.
--       (El índice único sobre line_key debería evitarlo; esto detecta filas previas
--        a la migración o inserciones por fuera del flujo canónico.)
select invoice_id, product_id, talla, qty, unit_price,
       count(*) as n, array_agg(id) as sale_item_ids
from public.sale_items
group by invoice_id, product_id, talla, qty, unit_price
having count(*) > 1
order by n desc;

-- 1.3.b Duplicado por `line_key` (clave canónica de idempotencia; equivalente al
--       "line_hash" mencionado). Con el índice único debería dar 0 filas.
select line_key, count(*) as n, array_agg(id) as sale_item_ids
from public.sale_items
group by line_key
having count(*) > 1
order by n desc;

-- 1.3.c Líneas sin sale_id.
select count(*) as lineas_sin_sale_id
from public.sale_items
where sale_id is null or sale_id::text = '';

-- 1.3.d Líneas sin invoice_id.
select count(*) as lineas_sin_invoice_id
from public.sale_items
where invoice_id is null or invoice_id::text = '';

-- 1.3.e Líneas sin product_id (esperado en históricos; deberían venir con meta.missing_product_id=true).
select count(*) filter (where product_id is null or product_id::text = '') as lineas_sin_product_id,
       count(*) filter (where (product_id is null or product_id::text = '')
                          and coalesce((meta->>'missing_product_id')::boolean, false) = true) as marcadas_ok
from public.sale_items;


-- ###########################################################################
-- FASE 1.4 — INVENTARIO DUPLICADO (stock_moves)
-- ###########################################################################

-- 1.4.a stock_moves repetidos por documento_id + product_id + tipo + qty + referencia + nota.
--       OJO: `stock_moves` NO tiene columna `talla`; la talla va dentro de `nota`
--       ("... · Talla: SM"). Un mismo product_id vendido en dos tallas distintas en la
--       misma factura genera DOS líneas legítimas. Por eso se DEBE incluir `nota` en el
--       group by; si no, se reportan falsos positivos (mismo artículo, distinta talla).
select documento_id, product_id, tipo, qty, referencia, nota,
       count(*) as n, array_agg(id) as move_ids
from public.stock_moves
where tipo = 'venta_pos'
group by documento_id, product_id, tipo, qty, referencia, nota
having count(*) > 1
order by n desc;

-- 1.4.b Ventas POS con factura pero SIN stock_moves (no descontaron inventario).
select i.id as invoice_id, i.number, i.fecha
from public.invoices i
where (i.tipo = 'pos' or i.number ilike 'POS-%')
  and i.estado <> 'anulada'
  and not exists (
    select 1 from public.stock_moves sm
    where sm.documento_id::text = i.id::text and sm.tipo = 'venta_pos'
  )
order by i.fecha desc;

-- 1.4.c Ventas anuladas que TODAVÍA descuentan stock neto (la anulación debe netear a 0
--       o positivo por producto). Cantidad neta < 0 = aún resta inventario.
select sm.documento_id, sm.product_id,
       sum(coalesce(sm.qty, sm.cantidad, sm.quantity, 0)) as neto
from public.stock_moves sm
join public.invoices i on i.id::text = sm.documento_id::text
where i.estado = 'anulada' and sm.tipo = 'venta_pos'
group by sm.documento_id, sm.product_id
having sum(coalesce(sm.qty, sm.cantidad, sm.quantity, 0)) < 0
order by neto asc;

-- 1.4.d Movimientos que no netean correctamente por documento+producto en ventas NO anuladas:
--       una venta POS normal debe tener neto negativo (= -unidades vendidas). Neto >= 0 es anomalía
--       (p. ej. anulación parcial duplicada o reingreso indebido).
select sm.documento_id, sm.product_id,
       sum(coalesce(sm.qty, sm.cantidad, sm.quantity, 0)) as neto,
       count(*) as movimientos
from public.stock_moves sm
join public.invoices i on i.id::text = sm.documento_id::text
where i.estado <> 'anulada' and sm.tipo = 'venta_pos'
group by sm.documento_id, sm.product_id
having sum(coalesce(sm.qty, sm.cantidad, sm.quantity, 0)) >= 0
order by neto desc;


-- ###########################################################################
-- FASE 1.5 — CAJA DUPLICADA (tes_movimientos)
-- ###########################################################################
-- NOTA: tes_movimientos NO tiene columna `meta` ni `facturaId`. La relación con
-- la venta POS es por `concepto` ("Venta POS POS-####") + categoria='venta_pos'.
-- Por eso la dedupe se hace por concepto/fecha/valor/categoria.
-- CAVEAT VERIFICADO (2026-05-31): los números de factura (POS-####) se han REUTILIZADO
-- en este proyecto. Un movimiento de caja cuyo concepto cita "POS-00607" puede no
-- corresponder al invoice que HOY tiene number='POS-00607' (producto/valor distintos).
-- Por eso 1.5.b/1.5.c (que cruzan por substring del número) SOBRE-REPORTAN; usar 1.5.a
-- (coincidencia exacta concepto+fecha+valor+metodo) como única señal fuerte de duplicado,
-- y aun así revisar a mano antes de tocar caja.

-- 1.5.a Ingresos POS repetidos: mismo concepto + fecha + valor + categoria venta_pos.
--       (Para pago mixto se esperan 2 movimientos con concepto distinto "(efectivo)"/
--        "(transferencia)"; por eso incluimos `metodo` para no marcar el mixto como duplicado.)
select concepto, fecha, valor, categoria, metodo,
       count(*) as n, array_agg(id) as mov_ids
from public.tes_movimientos
where categoria = 'venta_pos' and tipo = 'ingreso'
group by concepto, fecha, valor, categoria, metodo
having count(*) > 1
order by n desc, fecha desc;

-- 1.5.b Ventas POS (no anuladas, con total > 0) SIN movimiento de caja venta_pos.
--       Se cruza por número de factura embebido en el concepto.
select i.id as invoice_id, i.number, i.fecha, i.total
from public.invoices i
where (i.tipo = 'pos' or i.number ilike 'POS-%')
  and i.estado <> 'anulada'
  and coalesce(i.total, 0) > 0
  and not exists (
    select 1 from public.tes_movimientos tm
    where tm.categoria = 'venta_pos'
      and tm.tipo = 'ingreso'
      and tm.concepto ilike '%' || i.number || '%'
  )
order by i.fecha desc;

-- 1.5.c Contraentrega liquidada con posible DOBLE ingreso: ventas contraentrega
--       liquidadas que tienen más de un ingreso venta_pos cuyo concepto referencia su factura.
select v.id as venta_id, v.referencia, i.number,
       count(tm.id) as ingresos_pos
from public.ventas v
join public.invoices i on i.id::text = v.id::text
left join public.tes_movimientos tm
  on tm.categoria = 'venta_pos' and tm.tipo = 'ingreso'
 and tm.concepto ilike '%' || i.number || '%'
where v.es_contraentrega = true and v.liquidado = true
group by v.id, v.referencia, i.number
having count(tm.id) > 1
order by ingresos_pos desc;
