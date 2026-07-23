-- Alias escaneable de bodega (pistola POS). No reemplaza products.ref (HERA-*).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS scan_alias text;

COMMENT ON COLUMN public.products.scan_alias IS
  'Código corto editable para pistola/bodega. Independiente de ref HERA-*.';

CREATE UNIQUE INDEX IF NOT EXISTS products_scan_alias_unique_ci
  ON public.products (lower(scan_alias))
  WHERE scan_alias IS NOT NULL AND btrim(scan_alias) <> '';
