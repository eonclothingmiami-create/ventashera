-- Tope diario de notificaciones por dispositivo (anti-spam / Chrome compliance).

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
