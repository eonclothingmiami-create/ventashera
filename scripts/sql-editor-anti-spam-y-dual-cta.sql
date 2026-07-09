-- =============================================================================
-- EJECUTAR EN SUPABASE SQL EDITOR (en este orden, todo de una vez está bien)
-- https://supabase.com/dashboard/project/niilaxdeetuzutycvdkz/sql/new
-- =============================================================================

-- ─── 1) Anti-spam: tope 3 pushes/día por dispositivo ───────────────────────
-- (Cap en edge function fcm_broadcast + contador por token)

ALTER TABLE public.fcm_tokens
  ADD COLUMN IF NOT EXISTS push_day date NULL,
  ADD COLUMN IF NOT EXISTS push_day_count int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.fcm_tokens.push_day IS 'Último día (America/Bogota) en que se contó push_day_count.';
COMMENT ON COLUMN public.fcm_tokens.push_day_count IS 'Notificaciones enviadas ese push_day a este token.';

CREATE OR REPLACE FUNCTION public.increment_fcm_push_counts(p_tokens text[], p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_tokens IS NULL OR array_length(p_tokens, 1) IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.fcm_tokens AS t
  SET
    push_day = p_day,
    push_day_count = CASE
      WHEN t.push_day = p_day THEN t.push_day_count + 1
      ELSE 1
    END,
    updated_at = now()
  WHERE t.token = ANY (p_tokens);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_fcm_push_counts(text[], date) TO service_role;


-- ─── 2) Contenido editorial: 2 CTAs + WhatsApp configurable ────────────────

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


-- ─── Verificación rápida ───────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'fcm_tokens' AND column_name IN ('push_day', 'push_day_count');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'catalog_content_posts' AND column_name LIKE 'cta_%';
