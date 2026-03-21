-- Opcional: acelera Pagos proveedores al leer ventas POS desde stock_moves.
-- Ejecutar en Supabase → SQL Editor como superusuario/proyecto.
--
-- Si falla "column tipo does not exist", primero alinea la tabla con el ERP:
--
-- alter table public.stock_moves
--   add column if not exists tipo text not null default 'venta_pos';
-- -- Si ya tenías solo movimientos de venta POS, el default basta. Si mezclas
-- -- otros tipos, marca cada fila según corresponda (p. ej. 'ajuste', 'compra').

ALTER TABLE public.stock_moves
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'venta_pos';

CREATE INDEX IF NOT EXISTS idx_stock_moves_venta_pos_product
ON public.stock_moves (tipo, product_id)
WHERE tipo = 'venta_pos';

-- Si RLS está activo en stock_moves, asegurar política SELECT para roles que usan el ERP.
-- (Ajusta según tu política; ejemplo solo lectura autenticados:)
-- CREATE POLICY "read stock_moves ventas" ON public.stock_moves FOR SELECT ...
