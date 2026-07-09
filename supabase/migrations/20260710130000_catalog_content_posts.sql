-- Publicaciones editoriales (Redes sociales → Contenido) + cola push separada de productos.

CREATE TABLE IF NOT EXISTS public.catalog_content_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,

  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  excerpt text NOT NULL DEFAULT '',
  body_html text NULL,

  media_type text NOT NULL DEFAULT 'text'
    CHECK (media_type IN ('text', 'image', 'video', 'link')),
  media_url text NULL,
  thumb_url text NULL,
  external_link text NULL,

  cta_type text NOT NULL DEFAULT 'none'
    CHECK (cta_type IN ('none', 'catalog', 'product', 'external')),
  cta_product_id uuid NULL,
  cta_product_ref text NULL,

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  push_status text NOT NULL DEFAULT 'none'
    CHECK (push_status IN ('none', 'pending', 'sent', 'error')),
  push_sent_at timestamptz NULL,
  push_sent_count int NOT NULL DEFAULT 0,
  push_error text NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_content_posts_status
  ON public.catalog_content_posts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_content_posts_push_day
  ON public.catalog_content_posts (push_sent_at DESC)
  WHERE push_status = 'sent';

CREATE TABLE IF NOT EXISTS public.content_push_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.catalog_content_posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'error')),
  sent int NOT NULL DEFAULT 0,
  invalid int NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}',
  error text NULL
);

CREATE INDEX IF NOT EXISTS idx_content_push_events_status
  ON public.content_push_events (status, created_at ASC);

ALTER TABLE public.catalog_content_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_push_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_content_posts_select_published ON public.catalog_content_posts;
CREATE POLICY catalog_content_posts_select_published
  ON public.catalog_content_posts FOR SELECT TO anon
  USING (status = 'published');

DROP POLICY IF EXISTS catalog_content_posts_auth_all ON public.catalog_content_posts;
CREATE POLICY catalog_content_posts_auth_all
  ON public.catalog_content_posts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS content_push_events_auth_select ON public.content_push_events;
CREATE POLICY content_push_events_auth_select
  ON public.content_push_events FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.catalog_content_posts TO anon;
GRANT ALL ON public.catalog_content_posts TO authenticated;
GRANT SELECT ON public.content_push_events TO authenticated;

-- Evento de vista en landing de contenido
ALTER TABLE public.catalog_interaction_events
  DROP CONSTRAINT IF EXISTS catalog_interaction_events_event_type_check;

ALTER TABLE public.catalog_interaction_events
  ADD CONSTRAINT catalog_interaction_events_event_type_check
  CHECK (
    event_type IN (
      'add_to_cart',
      'whatsapp_product_consult',
      'vip_join_click',
      'push_notification_click',
      'push_notification_received',
      'push_landing',
      'pwa_installed',
      'notification_permission_granted',
      'notification_permission_denied',
      'content_view'
    )
  );
