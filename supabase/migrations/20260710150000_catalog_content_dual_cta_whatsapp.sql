-- Segundo CTA en publicaciones editoriales + opción WhatsApp configurable.

ALTER TABLE public.catalog_content_posts
  DROP CONSTRAINT IF EXISTS catalog_content_posts_cta_type_check;

ALTER TABLE public.catalog_content_posts
  ADD CONSTRAINT catalog_content_posts_cta_type_check
  CHECK (cta_type IN ('none', 'catalog', 'product', 'external', 'whatsapp'));

ALTER TABLE public.catalog_content_posts
  ADD COLUMN IF NOT EXISTS cta_whatsapp_number text NULL,
  ADD COLUMN IF NOT EXISTS cta_type_2 text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS cta_product_id_2 uuid NULL,
  ADD COLUMN IF NOT EXISTS cta_product_ref_2 text NULL,
  ADD COLUMN IF NOT EXISTS cta_external_link_2 text NULL,
  ADD COLUMN IF NOT EXISTS cta_whatsapp_number_2 text NULL;

ALTER TABLE public.catalog_content_posts
  DROP CONSTRAINT IF EXISTS catalog_content_posts_cta_type_2_check;

ALTER TABLE public.catalog_content_posts
  ADD CONSTRAINT catalog_content_posts_cta_type_2_check
  CHECK (cta_type_2 IN ('none', 'catalog', 'product', 'external', 'whatsapp'));
