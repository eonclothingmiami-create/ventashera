-- Aliases de REF legacy → HERA-XXXXX (URLs indexadas, pedidos históricos, TikTok).
CREATE TABLE IF NOT EXISTS public.product_ref_aliases (
  old_ref text PRIMARY KEY,
  new_ref text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_ref_aliases_new_ref_idx ON public.product_ref_aliases (new_ref);
CREATE INDEX IF NOT EXISTS product_ref_aliases_product_id_idx ON public.product_ref_aliases (product_id);

ALTER TABLE public.product_ref_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_ref_aliases_anon_select ON public.product_ref_aliases;
CREATE POLICY product_ref_aliases_anon_select
  ON public.product_ref_aliases
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.product_ref_aliases TO anon, authenticated;
GRANT ALL ON public.product_ref_aliases TO service_role;
