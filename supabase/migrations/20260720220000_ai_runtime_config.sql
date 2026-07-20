-- AI runtime config (singleton). No API keys here — only toggles + model prefs + last ping.

CREATE TABLE IF NOT EXISTS public.ai_runtime_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_provider text NOT NULL DEFAULT 'openai',
  chat_model text NOT NULL DEFAULT 'gpt-4o-mini',
  embed_model text NOT NULL DEFAULT 'text-embedding-3-small',
  -- Module gates: true = IA puede generar; false = manual / skip worker
  modules jsonb NOT NULL DEFAULT '{
    "copy": true,
    "seo": true,
    "attributes": true,
    "relations": false,
    "knowledge": true,
    "embedding": true
  }'::jsonb,
  last_ping_at timestamptz,
  last_ping_ok boolean,
  last_ping_latency_ms int,
  last_ping_message text,
  last_ping_model text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE public.ai_runtime_config IS
  'Config runtime IA (proveedor activo, modelos, gates). Secrets viven en Edge env, no aquí.';

INSERT INTO public.ai_runtime_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ai_runtime_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_runtime_config_auth_all ON public.ai_runtime_config;
CREATE POLICY ai_runtime_config_auth_all ON public.ai_runtime_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, UPDATE ON public.ai_runtime_config TO authenticated;

CREATE OR REPLACE FUNCTION public.get_ai_runtime_config()
RETURNS public.ai_runtime_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.ai_runtime_config;
BEGIN
  INSERT INTO ai_runtime_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO r FROM ai_runtime_config WHERE id = 1;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_ai_runtime_modules(p_modules jsonb)
RETURNS public.ai_runtime_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.ai_runtime_config;
  allowed text[] := ARRAY['copy','seo','attributes','relations','knowledge','embedding'];
  k text;
  cleaned jsonb := '{}'::jsonb;
BEGIN
  INSERT INTO ai_runtime_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

  FOREACH k IN ARRAY allowed LOOP
    cleaned := cleaned || jsonb_build_object(
      k,
      coalesce((p_modules->>k)::boolean, (SELECT (modules->>k)::boolean FROM ai_runtime_config WHERE id = 1), true)
    );
  END LOOP;

  UPDATE ai_runtime_config
  SET
    modules = cleaned,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO r;

  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_ai_runtime_models(p_chat_model text, p_embed_model text)
RETURNS public.ai_runtime_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.ai_runtime_config;
  chat text := nullif(btrim(p_chat_model), '');
  emb text := nullif(btrim(p_embed_model), '');
BEGIN
  INSERT INTO ai_runtime_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

  -- Guardrail: keep 1536-dim compatible default family unless explicitly overridden
  IF emb IS NOT NULL AND emb NOT IN (
    'text-embedding-3-small',
    'text-embedding-ada-002'
  ) THEN
    RAISE EXCEPTION 'embed_model % incompatible with vector(1536); use text-embedding-3-small', emb;
  END IF;

  UPDATE ai_runtime_config
  SET
    chat_model = coalesce(chat, chat_model),
    embed_model = coalesce(emb, embed_model),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO r;

  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_ai_provider_ping(
  p_ok boolean,
  p_latency_ms int,
  p_message text,
  p_model text DEFAULT NULL
)
RETURNS public.ai_runtime_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.ai_runtime_config;
BEGIN
  INSERT INTO ai_runtime_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

  UPDATE ai_runtime_config
  SET
    last_ping_at = now(),
    last_ping_ok = p_ok,
    last_ping_latency_ms = p_latency_ms,
    last_ping_message = left(coalesce(p_message, ''), 500),
    last_ping_model = nullif(btrim(coalesce(p_model, '')), ''),
    updated_at = now()
  WHERE id = 1
  RETURNING * INTO r;

  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_runtime_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_ai_runtime_modules(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_ai_runtime_models(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_provider_ping(boolean, int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_provider_ping(boolean, int, text, text) TO service_role;
