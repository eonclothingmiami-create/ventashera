-- Si public.stock_moves tiene la columna "quantity" (inglés) y no "cantidad" (ERP),
-- ejecuta esto en Supabase → SQL Editor.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stock_moves' AND column_name = 'quantity'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stock_moves' AND column_name = 'cantidad'
  ) THEN
    ALTER TABLE public.stock_moves RENAME COLUMN quantity TO cantidad;
  END IF;
END $$;
