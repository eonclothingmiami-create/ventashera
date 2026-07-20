-- Brand Voice Hera: shared identity for all PI modules (copy/seo/attributes/knowledge/relations).
-- Providers change; Brand Voice stays. No secrets here.

CREATE TABLE IF NOT EXISTS public.ai_brand_voice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  title text NOT NULL DEFAULT 'Hera Brand Voice',
  locale text NOT NULL DEFAULT 'es-CO',
  -- Structured fields for UI + composition
  tone text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT '',
  always_use text[] NOT NULL DEFAULT '{}',
  never_use text[] NOT NULL DEFAULT '{}',
  description_style text NOT NULL DEFAULT '',
  seo_structure text NOT NULL DEFAULT '',
  good_examples text NOT NULL DEFAULT '',
  bad_examples text NOT NULL DEFAULT '',
  -- Full guide injected into every module system prompt
  guide_markdown text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  created_by uuid,
  CONSTRAINT ai_brand_voice_version_unique UNIQUE (version)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_brand_voice_one_active
  ON public.ai_brand_voice ((true))
  WHERE status = 'active';

COMMENT ON TABLE public.ai_brand_voice IS
  'Identidad de marca versionada. Todos los módulos PI consumen la versión active.';

ALTER TABLE public.ai_brand_voice ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_brand_voice_auth_all ON public.ai_brand_voice;
CREATE POLICY ai_brand_voice_auth_all ON public.ai_brand_voice
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.ai_brand_voice TO authenticated;

CREATE OR REPLACE FUNCTION public.get_active_brand_voice()
RETURNS public.ai_brand_voice
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.ai_brand_voice;
BEGIN
  SELECT * INTO r FROM ai_brand_voice WHERE status = 'active' ORDER BY version DESC LIMIT 1;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_brand_voice(p_id uuid)
RETURNS public.ai_brand_voice
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.ai_brand_voice;
BEGIN
  UPDATE ai_brand_voice SET status = 'archived', updated_at = now()
  WHERE status = 'active' AND id <> p_id;

  UPDATE ai_brand_voice
  SET status = 'active', activated_at = now(), updated_at = now()
  WHERE id = p_id
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand voice % not found', p_id;
  END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.compose_brand_voice_guide(p_row public.ai_brand_voice)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_row.guide_markdown IS NOT NULL AND btrim(p_row.guide_markdown) <> '' THEN
    RETURN p_row.guide_markdown;
  END IF;
  RETURN concat_ws(
    E'\n\n',
    '# Brand Voice — ' || coalesce(p_row.title, 'Hera'),
    '## Tono' || E'\n' || coalesce(p_row.tone, ''),
    '## Público objetivo' || E'\n' || coalesce(p_row.audience, ''),
    '## Palabras / ideas a usar' || E'\n' || array_to_string(coalesce(p_row.always_use, '{}'), ', '),
    '## Nunca usar' || E'\n' || array_to_string(coalesce(p_row.never_use, '{}'), ', '),
    '## Estilo de descripciones' || E'\n' || coalesce(p_row.description_style, ''),
    '## Estructura SEO' || E'\n' || coalesce(p_row.seo_structure, ''),
    '## Ejemplos buenos' || E'\n' || coalesce(p_row.good_examples, ''),
    '## Ejemplos malos (evitar)' || E'\n' || coalesce(p_row.bad_examples, '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_brand_voice() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_brand_voice() TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_brand_voice(uuid) TO authenticated;

-- Seed v1 active
INSERT INTO public.ai_brand_voice (
  version, status, title, locale,
  tone, audience, always_use, never_use,
  description_style, seo_structure,
  good_examples, bad_examples,
  guide_markdown, activated_at
)
VALUES (
  1,
  'active',
  'Hera Brand Voice',
  'es-CO',
  'Quiet Luxury: elegante, sereno, seguro, femenino y contemporáneo. Aspiracional sin exagerar. Cálido pero contenido. Habla como una marca de traje de baño premium colombiana — nunca como un marketplace genérico.',
  'Mujeres (y en líneas kids, madres) que buscan vestidos de baño colombianos de calidad: viaje a Cartagena/Caribe, resort, luna de miel, pool days, look limpio y sofisticado. Mayoristas y clientas finales que valoran corte, tela y presencia.',
  ARRAY[
    'Quiet Luxury',
    'silueta limpia',
    'corte colombiano',
    'Cartagena',
    'resort',
    'Caribe',
    'femenino',
    'sofisticado',
    'confeccionado',
    'presencia',
    'elegancia serena'
  ],
  ARRAY[
    'bomba',
    'imprescindible!!!!',
    'lo más viral',
    'barato',
    'ofertón',
    'sexy hot',
    'reina de la playa',
    'must-have del momento',
    '100% garantizado',
    'tela milagrosa',
    'ideal para cualquier cuerpo'
  ],
  'Descripciones cortas: 1–2 frases con beneficio de silueta u ocasión. Descripciones largas: 2–4 párrafos breves — qué es, cómo se siente el fit, para qué momento (playa, resort, honeymoon), cierre sobrio. Español es-CO. No inventar materiales, precios, stock ni URLs. No inventar influencers ni posts sociales.',
  'Meta title ≤60: [Nombre] | Hera Swimwear (o beneficio corto). Meta description ≤155: ocasión + silueta + marca, sin clickbait. Slug kebab-case sin acentos. Keywords: producto + ocasión + colombia/cartagena/resort cuando aplique. No keyword stuffing.',
  $good$BIEN — Copy corto:
"Enterizo de líneas limpias y cintura marcada. Pensado para Cartagena y días de resort, con presencia quiet luxury."

BIEN — SEO meta:
"Enterizo Hera de silueta limpia para playa y resort | Hera Swimwear"$good$,
  $bad$MAL — Copy genérico IA:
"¡Este increíble traje de baño es perfecto para cualquier ocasión y te hará lucir espectacular en la playa! ¡No te lo pierdas!"

MAL — Overclaim:
"La mejor tela del mundo, viral en TikTok, ideal para todos los cuerpos y garantiza likes."$bad$,
  $guide$# Brand Voice — Hera Swimwear

## Identidad
Hera Swimwear es una marca colombiana de vestidos de baño y resortwear. El norte creativo es **Quiet Luxury**: elegancia serena, siluetas limpias, confianza femenina, sin gritos ni hype de marketplace.

## Tono
- Elegante, sereno, seguro, contemporáneo.
- Aspiracional **sin** exagerar.
- Cálido pero contenido.
- Español de Colombia (es-CO), claro y preciso.

## Público
Mujeres (y líneas kids vía madres) que buscan calidad y presencia: Cartagena/Caribe, resort, luna de miel, pool, look sofisticado. También mayoristas que necesitan copy comercial limpio.

## Siempre preferir
Quiet Luxury · silueta limpia · corte colombiano · Cartagena · resort · Caribe · femenino · sofisticado · presencia · elegancia serena

## Nunca usar
bomba · viral · ofertón · barato · sexy hot · reina de la playa · must-have del momento · 100% garantizado · tela milagrosa · clickbait · emojis excesivos · inventar materiales/precios/stock/URLs/redes

## Descripciones
- Corta: 1–2 frases (silueta + ocasión).
- Larga: 2–4 párrafos breves (qué es → fit → momento → cierre sobrio).
- No relleno genérico tipo “perfecto para cualquier ocasión”.

## SEO
- Title ≤60, description ≤155, slug kebab sin acentos.
- Beneficio + marca; sin keyword stuffing ni signos de exclamación en cadena.

## Reglas duras para cualquier módulo IA
1. Soná a Hera, no al estilo genérico del modelo.
2. No inventes hechos (materiales, precios, stock, posts, blogs).
3. Si falta dato, omití o usá lenguaje prudente.
4. Relations: solo refs reales del catálogo dado.
5. Attributes: Quiet Luxury / Cartagena / resort / honeymoon solo cuando el producto lo sostenga.

## Anti-ejemplos
Evitar: “¡Increíble! ¡Viral! ¡Para todos los cuerpos!”
Preferir: “Silueta limpia y presencia serena para playa y resort.”
$guide$,
  now()
)
ON CONFLICT (version) DO NOTHING;
