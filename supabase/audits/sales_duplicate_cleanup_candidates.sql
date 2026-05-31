-- ============================================================================
-- sales_duplicate_cleanup_candidates.sql
-- CANDIDATOS a limpieza de duplicados — SOLO LECTURA / ETIQUETADO.
--
-- REGLAS DURAS (Fase 4):
--   * NO hay DELETE. NO hay UPDATE. NO hay DDL que toque tablas críticas.
--   * Sólo SELECT que CLASIFICA cada fila duplicada como KEEP o ARCHIVE_CANDIDATE.
--   * No toca caja ni stock. No archiva nada: sólo propone.
--   * La decisión de archivar se hace en una migración futura (ver plantilla al final,
--     que está COMENTADA y NO se ejecuta).
--
-- Criterio de conservación (KEEP) por defecto, conservador:
--   - Se conserva la fila "más completa / más antigua" del grupo duplicado.
--   - El resto del grupo se marca ARCHIVE_CANDIDATE (nunca se borra).
--   - Si hay dudas (dinero/inventario), queda como REQUIERE_VALIDACION_MANUAL.
-- ============================================================================


-- ###########################################################################
-- 4.1 — sale_items duplicados por line_key (los más seguros de archivar:
--       sale_items es tabla SECUNDARIA, no afecta dinero ni stock).
--       KEEP = el de created_at más antiguo; resto = ARCHIVE_CANDIDATE.
-- ###########################################################################
with ranked as (
  select
    si.*,
    row_number() over (
      partition by line_key
      order by created_at asc, id asc
    ) as rn,
    count(*) over (partition by line_key) as grupo_n
  from public.sale_items si
)
select
  id, line_key, invoice_id, product_id, talla, qty, unit_price, source, created_at,
  grupo_n,
  case when rn = 1 then 'KEEP' else 'ARCHIVE_CANDIDATE' end as decision
from ranked
where grupo_n > 1
order by line_key, rn;


-- ###########################################################################
-- 4.2 — sale_items duplicados "de negocio" (mismo invoice+product+talla+qty+precio)
--       aunque tengan line_key distinto (p. ej. mezcla de source pos/backfill con
--       normalización diferente). KEEP = source='pos' primero, luego más antiguo.
-- ###########################################################################
with ranked as (
  select
    si.*,
    row_number() over (
      partition by invoice_id, product_id, talla, qty, unit_price
      order by (case when source = 'pos' then 0 else 1 end), created_at asc, id asc
    ) as rn,
    count(*) over (partition by invoice_id, product_id, talla, qty, unit_price) as grupo_n
  from public.sale_items si
)
select
  id, invoice_id, product_id, talla, qty, unit_price, source, line_key, created_at,
  grupo_n,
  case when rn = 1 then 'KEEP' else 'ARCHIVE_CANDIDATE' end as decision
from ranked
where grupo_n > 1
order by invoice_id, product_id, talla, rn;


-- ###########################################################################
-- 4.3 — invoices con `number` repetido. Factura = documento crítico (dinero).
--       NO se propone archivar automáticamente: se etiqueta para validación manual.
-- ###########################################################################
with ranked as (
  select
    i.*,
    row_number() over (
      partition by number
      order by fecha asc, id asc
    ) as rn,
    count(*) over (partition by number) as grupo_n
  from public.invoices i
  where number is not null and number <> ''
)
select
  id, number, customer_name, fecha, total, estado, tipo,
  grupo_n,
  case when rn = 1 then 'KEEP (revisar)' else 'REQUIERE_VALIDACION_MANUAL' end as decision
from ranked
where grupo_n > 1
order by number, rn;


-- ###########################################################################
-- 4.4 — ventas con `invoice_id` repetido (debería ser 1:1). Crítico (dinero).
--       Sólo etiqueta para validación manual; NO se archiva automáticamente.
-- ###########################################################################
with ranked as (
  select
    v.*,
    row_number() over (
      partition by invoice_id
      order by fecha asc, id asc
    ) as rn,
    count(*) over (partition by invoice_id) as grupo_n
  from public.ventas v
  where invoice_id is not null
)
select
  id, invoice_id, referencia, cliente, fecha, valor, canal, liquidado,
  grupo_n,
  case when rn = 1 then 'KEEP (revisar)' else 'REQUIERE_VALIDACION_MANUAL' end as decision
from ranked
where grupo_n > 1
order by invoice_id, rn;


-- ###########################################################################
-- 4.5 — stock_moves venta_pos exactamente repetidos (doble descuento de inventario).
--       CRÍTICO: afecta stock. NO se archiva aquí; sólo se identifica el sobrante.
--       KEEP = el de menor id; el resto = REQUIERE_VALIDACION_MANUAL (revisar a mano,
--       porque borrar un movimiento cambia el inventario neto).
--       IMPRESCINDIBLE: incluir `nota` en la partición. `stock_moves` guarda la TALLA
--       dentro de `nota` ("... · Talla: SM"). Sin `nota`, el mismo artículo vendido en
--       dos tallas se ve como "duplicado" y NO lo es (verificado 2026-05-31: los 8
--       grupos detectados sin `nota` eran multi-talla legítimos, 0 duplicados reales).
-- ###########################################################################
with ranked as (
  select
    sm.*,
    row_number() over (
      partition by documento_id, product_id, tipo, qty, referencia, nota
      order by id asc
    ) as rn,
    count(*) over (partition by documento_id, product_id, tipo, qty, referencia, nota) as grupo_n
  from public.stock_moves sm
  where tipo = 'venta_pos'
)
select
  id, documento_id, product_id, tipo, qty, referencia, fecha,
  grupo_n,
  case when rn = 1 then 'KEEP' else 'REQUIERE_VALIDACION_MANUAL' end as decision
from ranked
where grupo_n > 1
order by documento_id, product_id, rn;


-- ###########################################################################
-- 4.6 — tes_movimientos venta_pos potencialmente repetidos (doble ingreso en caja).
--       CRÍTICO: afecta dinero. Sólo etiqueta; NO se archiva automáticamente.
--       Se excluye el caso legítimo de pago mixto incluyendo `metodo` en la partición.
-- ###########################################################################
with ranked as (
  select
    tm.*,
    row_number() over (
      partition by concepto, fecha, valor, categoria, metodo
      order by id asc
    ) as rn,
    count(*) over (partition by concepto, fecha, valor, categoria, metodo) as grupo_n
  from public.tes_movimientos tm
  where categoria = 'venta_pos' and tipo = 'ingreso'
)
select
  id, caja_id, concepto, fecha, valor, metodo, bucket,
  grupo_n,
  case when rn = 1 then 'KEEP (revisar)' else 'REQUIERE_VALIDACION_MANUAL' end as decision
from ranked
where grupo_n > 1
order by fecha desc, concepto, rn;


-- ###########################################################################
-- PLANTILLA DE MIGRACIÓN FUTURA (NO EJECUTAR AQUÍ) — sólo para sale_items,
-- que es la única tabla segura de archivar de forma automática.
-- Requisitos antes de ejecutar en una migración aparte:
--   1) Backup previo de la tabla.
--   2) Tabla de auditoría con las filas archivadas.
--   3) Marcar `archived=true` en vez de DELETE (requiere añadir la columna primero).
--   4) Rollback documentado.
-- ###########################################################################
/*
-- (FUTURO, requiere revisión y backup; comentado a propósito)

-- a) Backup completo de la tabla secundaria.
create table if not exists public.sale_items_backup_pre_dedupe as
  select * from public.sale_items;

-- b) Columna de archivado (no destructiva).
alter table public.sale_items add column if not exists archived boolean not null default false;

-- c) Tabla de auditoría de la limpieza.
create table if not exists public.sale_items_dedupe_audit (
  audited_at   timestamptz not null default now(),
  kept_id      uuid,
  archived_id  uuid,
  line_key     text,
  reason       text
);

-- d) Registrar y marcar (NO borrar) los duplicados por line_key, conservando el más antiguo.
with ranked as (
  select id, line_key,
         row_number() over (partition by line_key order by created_at asc, id asc) as rn
  from public.sale_items
),
dups as ( select id, line_key from ranked where rn > 1 ),
keepers as ( select id, line_key from ranked where rn = 1 )
insert into public.sale_items_dedupe_audit (kept_id, archived_id, line_key, reason)
select k.id, d.id, d.line_key, 'dedupe by line_key'
from dups d join keepers k on k.line_key = d.line_key;

update public.sale_items s
set archived = true
where s.id in (select archived_id from public.sale_items_dedupe_audit);

-- ROLLBACK documentado:
--   update public.sale_items set archived = false
--   where id in (select archived_id from public.sale_items_dedupe_audit);
--   -- o restaurar desde public.sale_items_backup_pre_dedupe
*/
