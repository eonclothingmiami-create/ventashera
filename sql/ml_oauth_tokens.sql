-- Tokens Mercado Libre renovables (la Edge Function actualiza esta fila al refrescar).
-- Ejecutar una vez en Supabase → SQL Editor.

CREATE TABLE IF NOT EXISTS public.ml_oauth_tokens (
  id text PRIMARY KEY DEFAULT 'default',
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.ml_oauth_tokens IS 'OAuth ML: access/refresh y expiración; solo service role / Edge Functions.';

ALTER TABLE public.ml_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Sin políticas para anon/authenticated: no lectura pública. El service role de Edge Functions ignora RLS.
