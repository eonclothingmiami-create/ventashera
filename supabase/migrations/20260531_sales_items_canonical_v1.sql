-- ============================================================================
-- sale_items_canonical_v1
-- Capa canónica NO destructiva de líneas de venta.
--
-- Reglas:
--   * NO altera ni borra `ventas`, `invoices`, `stock_moves`, `tes_movimientos`.
--   * NO descuenta stock ni mueve caja: es una tabla de lectura/reporte.
--   * 100% idempotente: re-ejecutar este script no rompe ni duplica nada.
--   * Relación LÓGICA (sin FKs físicas) con ventas/invoices/products para no
--     acoplar el ciclo de vida de esas tablas.
--
-- Idempotencia de filas: columna determinista `line_key` (NOT NULL) + índice
-- único. La clave NO incluye `source`, de modo que una línea ya escrita por el
-- POS no se duplica al correr el backfill.
-- ============================================================================

-- gen_random_uuid() — disponible en pg13+; pgcrypto cubre instalaciones viejas.
create extension if not exists pgcrypto;

create table if not exists public.sale_items (
  id                uuid primary key default gen_random_uuid(),
  sale_id           text,                       -- ventas.id (lógico)
  invoice_id        text,                       -- invoices.id (lógico)
  invoice_number    text,
  product_id        text,                       -- products.id (lógico)
  product_ref       text,
  product_name      text,
  talla             text,
  qty               numeric      not null default 0,
  unit_price        numeric      not null default 0,
  subtotal          numeric      not null default 0,
  canal             text,
  cliente_nombre    text,
  cliente_telefono  text,
  fecha             date,
  fecha_hora        timestamptz,
  source            text         not null default 'pos',
  line_key          text         not null,
  meta              jsonb        not null default '{}'::jsonb,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

-- ---------------------------------------------------------------------------
-- Índice único de idempotencia
-- ---------------------------------------------------------------------------
create unique index if not exists sale_items_line_key_uidx
  on public.sale_items (line_key);

-- ---------------------------------------------------------------------------
-- Índices de consulta (reportes por fecha, hora, artículo, cliente)
-- ---------------------------------------------------------------------------
create index if not exists sale_items_sale_id_idx     on public.sale_items (sale_id);
create index if not exists sale_items_invoice_id_idx  on public.sale_items (invoice_id);
create index if not exists sale_items_product_id_idx  on public.sale_items (product_id);
create index if not exists sale_items_fecha_idx       on public.sale_items (fecha);
create index if not exists sale_items_fecha_hora_idx  on public.sale_items (fecha_hora);
create index if not exists sale_items_cliente_idx     on public.sale_items (cliente_telefono);

-- ---------------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------------
create or replace function public.sale_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sale_items_set_updated_at_trg on public.sale_items;
create trigger sale_items_set_updated_at_trg
  before update on public.sale_items
  for each row
  execute function public.sale_items_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: la app usa la anon key (igual que stock_moves). Habilitamos políticas
-- permisivas para anon/authenticated. DROP previo => re-ejecución segura.
-- ---------------------------------------------------------------------------
alter table public.sale_items enable row level security;

drop policy if exists sale_items_select_anon on public.sale_items;
create policy sale_items_select_anon
  on public.sale_items for select
  to anon, authenticated
  using (true);

drop policy if exists sale_items_insert_anon on public.sale_items;
create policy sale_items_insert_anon
  on public.sale_items for insert
  to anon, authenticated
  with check (true);

drop policy if exists sale_items_update_anon on public.sale_items;
create policy sale_items_update_anon
  on public.sale_items for update
  to anon, authenticated
  using (true)
  with check (true);
