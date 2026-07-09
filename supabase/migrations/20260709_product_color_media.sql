-- Mapeo aditivo: foto portada por color (WooCommerce / Addi).
CREATE TABLE IF NOT EXISTS public.product_color_media (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  color_id   uuid NOT NULL REFERENCES public.colors(id) ON DELETE CASCADE,
  url        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, color_id)
);
CREATE INDEX IF NOT EXISTS idx_product_color_media_product ON public.product_color_media (product_id);
ALTER TABLE public.product_color_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY hera_pcm_anon_select ON public.product_color_media FOR SELECT TO anon USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_color_media.product_id AND COALESCE(p.active, true) = true AND COALESCE(p.visible, true) = true));
CREATE POLICY hera_pcm_auth_all ON public.product_color_media FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE OR REPLACE FUNCTION public.check_product_color_media_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.product_colors pc WHERE pc.product_id = NEW.product_id AND pc.color_id = NEW.color_id) THEN RAISE EXCEPTION 'color_id % not linked to product_id %', NEW.color_id, NEW.product_id; END IF; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_product_color_media_link ON public.product_color_media;
CREATE TRIGGER trg_product_color_media_link BEFORE INSERT OR UPDATE ON public.product_color_media FOR EACH ROW EXECUTE FUNCTION public.check_product_color_media_link();
