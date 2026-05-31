-- ============================================================================
-- sale_items_rls_min_v2
-- Endurecimiento NO destructivo del RLS de public.sale_items.
--
-- Contexto:
--   La migración 20260531_sales_items_canonical_v1.sql creó las políticas
--   SELECT, INSERT y UPDATE (anon, authenticated). El frontend usa la anon key.
--
-- Decisión:
--   El ÚNICO write que hace la app es:
--       .from('sale_items').upsert(rows, { onConflict:'line_key', ignoreDuplicates:true })
--   Con `ignoreDuplicates: true`, supabase-js envía `Prefer: resolution=ignore-duplicates`,
--   que PostgREST compila a  INSERT ... ON CONFLICT DO NOTHING.
--   Ese statement NO ejecuta ningún UPDATE de fila => solo requiere la política
--   de INSERT (with check). No existe ninguna llamada `.update()` sobre sale_items
--   en el código (verificado por grep). Por lo tanto la política de UPDATE es
--   innecesaria y se elimina para reducir superficie de escritura.
--
-- Reglas:
--   * NO borra la tabla ni datos.
--   * NO agrega DELETE.
--   * Mantiene SELECT (reportes) e INSERT (POS + backfill con anon key).
--   * Idempotente: re-ejecutar este script es seguro.
--
-- Nota sobre el trigger:
--   `sale_items_set_updated_at_trg` es un BEFORE UPDATE. Sin política de UPDATE
--   no se dispara vía PostgREST/anon; queda inerte (no se elimina para no perder
--   utilidad si en el futuro se habilita UPDATE mediante un rol de servicio/RPC).
--
-- Rollback (si algún día se necesita UPDATE, p.ej. para upsert con merge):
--   create policy sale_items_update_anon on public.sale_items for update
--     to anon, authenticated using (true) with check (true);
-- ============================================================================

alter table public.sale_items enable row level security;

-- Eliminar la política de UPDATE (no requerida por ON CONFLICT DO NOTHING).
drop policy if exists sale_items_update_anon on public.sale_items;

-- Reafirmar (idempotente) las políticas mínimas necesarias para el flujo actual.
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
