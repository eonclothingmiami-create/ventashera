-- Permitir renombrar products.ref sin romper tablas hijas (search docs, IA, etc.).
-- Antes: solo ON DELETE CASCADE → UPDATE de ref fallaba al guardar (fotos/ficha).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.products'::regclass
      AND pg_get_constraintdef(c.oid) ILIKE '%REFERENCES products(ref)%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (ref) REFERENCES public.products(ref) ON DELETE CASCADE ON UPDATE CASCADE',
      r.tbl,
      r.conname
    );
  END LOOP;
END $$;

-- product_relations tiene from_ref / to_ref (no solo "ref")
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_relations_from_ref_fkey'
  ) THEN
    ALTER TABLE public.product_relations DROP CONSTRAINT product_relations_from_ref_fkey;
    ALTER TABLE public.product_relations
      ADD CONSTRAINT product_relations_from_ref_fkey
      FOREIGN KEY (from_ref) REFERENCES public.products(ref) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_relations_to_ref_fkey'
  ) THEN
    ALTER TABLE public.product_relations DROP CONSTRAINT product_relations_to_ref_fkey;
    ALTER TABLE public.product_relations
      ADD CONSTRAINT product_relations_to_ref_fkey
      FOREIGN KEY (to_ref) REFERENCES public.products(ref) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
