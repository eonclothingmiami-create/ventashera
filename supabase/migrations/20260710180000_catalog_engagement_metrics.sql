-- Métricas de engagement: duración de sesión, fichas de producto, embudo push, opt-in.

ALTER TABLE public.catalog_interaction_events
  ADD COLUMN IF NOT EXISTS visit_id text NULL,
  ADD COLUMN IF NOT EXISTS duration_sec integer NULL;

ALTER TABLE public.catalog_interaction_events
  DROP CONSTRAINT IF EXISTS catalog_interaction_events_duration_sec_check;

ALTER TABLE public.catalog_interaction_events
  ADD CONSTRAINT catalog_interaction_events_duration_sec_check
  CHECK (duration_sec IS NULL OR (duration_sec >= 0 AND duration_sec <= 86400));

CREATE INDEX IF NOT EXISTS idx_catalog_interaction_events_visit_created
  ON public.catalog_interaction_events (visit_id, created_at DESC)
  WHERE visit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_interaction_events_session_end_dur
  ON public.catalog_interaction_events (created_at DESC, duration_sec)
  WHERE event_type = 'session_end' AND duration_sec IS NOT NULL;

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
      'content_view',
      'session_start',
      'session_end',
      'product_modal_open',
      'product_modal_close'
    )
  );

CREATE OR REPLACE FUNCTION public.catalog_engagement_window_stats(
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT p_start AS s, p_end AS e
  ),
  session_durations AS (
    SELECT e.duration_sec::numeric AS dur
    FROM public.catalog_interaction_events e, bounds b
    WHERE e.event_type = 'session_end'
      AND e.created_at >= b.s
      AND e.created_at < b.e
      AND e.duration_sec IS NOT NULL
      AND e.duration_sec BETWEEN 3 AND 7200
  ),
  unique_visits AS (
    SELECT COUNT(DISTINCT COALESCE(NULLIF(e.visit_id, ''), e.session_id))::bigint AS n
    FROM public.catalog_interaction_events e, bounds b
    WHERE e.created_at >= b.s
      AND e.created_at < b.e
      AND e.event_type IN ('session_start', 'session_end')
      AND COALESCE(NULLIF(e.visit_id, ''), e.session_id) IS NOT NULL
  ),
  unique_visits_fallback AS (
    SELECT COUNT(DISTINCT e.session_id)::bigint AS n
    FROM public.catalog_interaction_events e, bounds b
    WHERE e.created_at >= b.s
      AND e.created_at < b.e
      AND e.session_id IS NOT NULL
  ),
  unique_clients AS (
    SELECT COUNT(DISTINCT e.session_id)::bigint AS n
    FROM public.catalog_interaction_events e, bounds b
    WHERE e.created_at >= b.s
      AND e.created_at < b.e
      AND e.session_id IS NOT NULL
  ),
  push_perm AS (
    SELECT
      COUNT(*) FILTER (WHERE e.event_type = 'notification_permission_granted')::bigint AS granted,
      COUNT(*) FILTER (WHERE e.event_type = 'notification_permission_denied')::bigint AS denied
    FROM public.catalog_interaction_events e, bounds b
    WHERE e.created_at >= b.s
      AND e.created_at < b.e
      AND e.event_type IN ('notification_permission_granted', 'notification_permission_denied')
  ),
  content_views AS (
    SELECT COUNT(*)::bigint AS n
    FROM public.catalog_interaction_events e, bounds b
    WHERE e.event_type = 'content_view'
      AND e.created_at >= b.s
      AND e.created_at < b.e
  ),
  push_landings AS (
    SELECT COUNT(*)::bigint AS n
    FROM public.catalog_interaction_events e, bounds b
    WHERE e.event_type = 'push_landing'
      AND e.created_at >= b.s
      AND e.created_at < b.e
  ),
  landing_keys AS (
    SELECT DISTINCT COALESCE(NULLIF(e.visit_id, ''), e.session_id) AS k
    FROM public.catalog_interaction_events e, bounds b
    WHERE e.event_type = 'push_landing'
      AND e.created_at >= b.s
      AND e.created_at < b.e
      AND COALESCE(NULLIF(e.visit_id, ''), e.session_id) IS NOT NULL
  ),
  funnel_cart AS (
    SELECT COUNT(DISTINCT lk.k)::bigint AS n
    FROM landing_keys lk
    JOIN public.catalog_interaction_events e
      ON COALESCE(NULLIF(e.visit_id, ''), e.session_id) = lk.k
    JOIN bounds b ON true
    WHERE e.event_type = 'add_to_cart'
      AND e.created_at >= b.s
      AND e.created_at < b.e
  ),
  funnel_wa AS (
    SELECT COUNT(DISTINCT lk.k)::bigint AS n
    FROM landing_keys lk
    JOIN public.catalog_interaction_events e
      ON COALESCE(NULLIF(e.visit_id, ''), e.session_id) = lk.k
    JOIN bounds b ON true
    WHERE e.event_type = 'whatsapp_product_consult'
      AND e.created_at >= b.s
      AND e.created_at < b.e
  ),
  funnel_any AS (
    SELECT COUNT(DISTINCT lk.k)::bigint AS n
    FROM landing_keys lk
    JOIN public.catalog_interaction_events e
      ON COALESCE(NULLIF(e.visit_id, ''), e.session_id) = lk.k
    JOIN bounds b ON true
    WHERE e.event_type IN ('add_to_cart', 'whatsapp_product_consult')
      AND e.created_at >= b.s
      AND e.created_at < b.e
  ),
  modal_stats AS (
    SELECT
      COALESCE(AVG(e.duration_sec) FILTER (
        WHERE e.duration_sec BETWEEN 2 AND 1800
      ), 0)::numeric AS avg_modal_sec,
      COUNT(*) FILTER (WHERE e.event_type = 'product_modal_close')::bigint AS modal_closes
    FROM public.catalog_interaction_events e, bounds b
    WHERE e.event_type = 'product_modal_close'
      AND e.created_at >= b.s
      AND e.created_at < b.e
  )
  SELECT jsonb_build_object(
    'unique_visits', COALESCE((SELECT n FROM unique_visits), 0),
    'unique_visits_fallback', COALESCE((SELECT n FROM unique_visits_fallback), 0),
    'unique_clients', COALESCE((SELECT n FROM unique_clients), 0),
    'session_end_count', (SELECT COUNT(*)::bigint FROM session_durations),
    'avg_session_sec', COALESCE((SELECT ROUND(AVG(dur)) FROM session_durations), 0),
    'median_session_sec', COALESCE((
      SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dur))
      FROM session_durations
    ), 0),
    'push_optin_granted', COALESCE((SELECT granted FROM push_perm), 0),
    'push_optin_denied', COALESCE((SELECT denied FROM push_perm), 0),
    'content_views', COALESCE((SELECT n FROM content_views), 0),
    'push_landings', COALESCE((SELECT n FROM push_landings), 0),
    'funnel_cart', COALESCE((SELECT n FROM funnel_cart), 0),
    'funnel_wa', COALESCE((SELECT n FROM funnel_wa), 0),
    'funnel_converted', COALESCE((SELECT n FROM funnel_any), 0),
    'avg_modal_sec', COALESCE((SELECT avg_modal_sec FROM modal_stats), 0),
    'modal_closes', COALESCE((SELECT modal_closes FROM modal_stats), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.catalog_engagement_top_modal_products(
  p_start timestamptz,
  p_end timestamptz,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  product_id uuid,
  product_ref text,
  product_name text,
  avg_duration_sec numeric,
  close_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.product_id,
    MAX(e.product_ref) AS product_ref,
    MAX(e.product_name) AS product_name,
    ROUND(AVG(e.duration_sec) FILTER (WHERE e.duration_sec BETWEEN 2 AND 1800), 1) AS avg_duration_sec,
    COUNT(*)::bigint AS close_count
  FROM public.catalog_interaction_events e
  WHERE e.event_type = 'product_modal_close'
    AND e.created_at >= p_start
    AND e.created_at < p_end
    AND e.product_id IS NOT NULL
    AND e.duration_sec IS NOT NULL
  GROUP BY e.product_id
  HAVING COUNT(*) >= 1
  ORDER BY avg_duration_sec DESC NULLS LAST, close_count DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 25));
$$;

CREATE OR REPLACE FUNCTION public.catalog_engagement_dashboard(
  p_day_start timestamptz,
  p_day_end timestamptz,
  p_month_start timestamptz,
  p_month_end timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'day', public.catalog_engagement_window_stats(p_day_start, p_day_end),
    'month', public.catalog_engagement_window_stats(p_month_start, p_month_end),
    'top_modal_month', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', t.product_id,
        'product_ref', t.product_ref,
        'product_name', t.product_name,
        'avg_duration_sec', t.avg_duration_sec,
        'close_count', t.close_count
      ))
      FROM public.catalog_engagement_top_modal_products(p_month_start, p_month_end, 10) t
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.catalog_engagement_window_stats(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catalog_engagement_top_modal_products(timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catalog_engagement_dashboard(timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.catalog_engagement_window_stats(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_engagement_top_modal_products(timestamptz, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_engagement_dashboard(timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.catalog_engagement_dashboard(timestamptz, timestamptz, timestamptz, timestamptz) IS
  'Panel admin catálogo: duración sesión, visitas únicas, opt-in push, embudo push, tiempo en ficha.';
