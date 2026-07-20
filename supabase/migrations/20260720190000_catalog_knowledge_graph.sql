-- Catalog Knowledge Graph v1: relations + external/internal knowledge links.
-- Goal: API returns commercial knowledge, not only SKU fields.

CREATE TABLE IF NOT EXISTS public.product_relations (
  id bigserial PRIMARY KEY,
  from_ref text NOT NULL REFERENCES public.products (ref) ON DELETE CASCADE,
  to_ref text NOT NULL REFERENCES public.products (ref) ON DELETE CASCADE,
  relation_type text NOT NULL
    CHECK (relation_type IN (
      'pairs_with',
      'similar',
      'upsell',
      'completes_outfit',
      'same_look',
      'alternative'
    )),
  score numeric NOT NULL DEFAULT 1
    CHECK (score >= 0 AND score <= 100),
  source text NOT NULL DEFAULT 'curated'
    CHECK (source IN ('curated', 'heuristic', 'ai')),
  active boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_relations_no_self CHECK (from_ref <> to_ref),
  CONSTRAINT product_relations_unique UNIQUE (from_ref, to_ref, relation_type)
);

CREATE INDEX IF NOT EXISTS product_relations_from_idx
  ON public.product_relations (from_ref)
  WHERE active;

CREATE INDEX IF NOT EXISTS product_relations_to_idx
  ON public.product_relations (to_ref)
  WHERE active;

CREATE INDEX IF NOT EXISTS product_relations_type_idx
  ON public.product_relations (relation_type)
  WHERE active;

COMMENT ON TABLE public.product_relations IS
  'Grafo comercial: qué combina / completa outfit / alternativa. Consumido por Catalog API knowledge.';

-- Links: blog, IG, TikTok, editorial, lookbook, external video
CREATE TABLE IF NOT EXISTS public.product_knowledge_links (
  id bigserial PRIMARY KEY,
  ref text REFERENCES public.products (ref) ON DELETE CASCADE,
  -- NULL ref = brand/category-level knowledge (scoped via applies_to)
  kind text NOT NULL
    CHECK (kind IN (
      'blog',
      'instagram',
      'tiktok',
      'editorial',
      'video',
      'lookbook',
      'guide'
    )),
  title text NOT NULL,
  url text NOT NULL,
  thumbnail_url text,
  external_id text,
  locale text NOT NULL DEFAULT 'es-CO',
  applies_to jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- e.g. {"product_types":["bikini"],"secciones":["Trajes de Baño"],"collections":["cartagena"]}
  active boolean NOT NULL DEFAULT true,
  published_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_knowledge_links_ref_idx
  ON public.product_knowledge_links (ref)
  WHERE active;

CREATE INDEX IF NOT EXISTS product_knowledge_links_kind_idx
  ON public.product_knowledge_links (kind)
  WHERE active;

CREATE INDEX IF NOT EXISTS product_knowledge_links_applies_gin
  ON public.product_knowledge_links USING gin (applies_to);

CREATE UNIQUE INDEX IF NOT EXISTS product_knowledge_links_unique_kind_url_ref
  ON public.product_knowledge_links (kind, url, (coalesce(ref, '')));

COMMENT ON TABLE public.product_knowledge_links IS
  'Conocimiento comercial enlazado a producto o a facetas (blog/IG/TT/guías). ref NULL = conocimiento de categoría/marca.';

ALTER TABLE public.product_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_knowledge_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_relations_public_read ON public.product_relations;
CREATE POLICY product_relations_public_read ON public.product_relations
  FOR SELECT TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS product_knowledge_links_public_read ON public.product_knowledge_links;
CREATE POLICY product_knowledge_links_public_read ON public.product_knowledge_links
  FOR SELECT TO anon, authenticated
  USING (active = true);

-- Seed SEO / brand guides as category knowledge (no SKU yet).
INSERT INTO public.product_knowledge_links
  (ref, kind, title, url, locale, applies_to, published_at, meta)
VALUES
  (
    NULL,
    'guide',
    'Vestidos de baño colombianos',
    'https://heraswimsuit.com/es/vestidos-de-bano-colombianos/',
    'es-CO',
    '{"product_types":["bikini","one_piece","tankini","cover_up","three_piece"],"secciones":["Trajes de Baño"]}'::jsonb,
    now(),
    '{"source":"seo_site","channel":"blog"}'::jsonb
  ),
  (
    NULL,
    'guide',
    'Vestidos de baño al por mayor Colombia',
    'https://heraswimsuit.com/es/vestidos-de-bano-al-por-mayor-colombia/',
    'es-CO',
    '{"secciones":["Trajes de Baño"],"channels":["wholesale"]}'::jsonb,
    now(),
    '{"source":"seo_site","channel":"blog"}'::jsonb
  ),
  (
    NULL,
    'guide',
    'Colombian swimwear',
    'https://heraswimsuit.com/colombian-swimwear/',
    'en',
    '{"product_types":["bikini","one_piece","tankini","cover_up"],"secciones":["Trajes de Baño"]}'::jsonb,
    now(),
    '{"source":"seo_site","channel":"blog","lang":"en"}'::jsonb
  ),
  (
    NULL,
    'guide',
    'Wholesale swimwear Colombia',
    'https://heraswimsuit.com/wholesale-swimwear-colombia/',
    'en',
    '{"secciones":["Trajes de Baño"],"channels":["wholesale"]}'::jsonb,
    now(),
    '{"source":"seo_site","channel":"blog","lang":"en"}'::jsonb
  ),
  (
    NULL,
    'guide',
    'Sobre Hera Swimwear',
    'https://heraswimsuit.com/es/sobre-hera-swimwear/',
    'es-CO',
    '{"brand":true}'::jsonb,
    now(),
    '{"source":"seo_site","channel":"brand"}'::jsonb
  ),
  (
    NULL,
    'instagram',
    'Instagram @hera_swimwear_',
    'https://www.instagram.com/hera_swimwear_/',
    'es-CO',
    '{"brand":true}'::jsonb,
    now(),
    '{"source":"brand","handle":"hera_swimwear_"}'::jsonb
  ),
  (
    NULL,
    'tiktok',
    'TikTok @hera_swimwear2',
    'https://www.tiktok.com/@hera_swimwear2',
    'es-CO',
    '{"brand":true}'::jsonb,
    now(),
    '{"source":"brand","handle":"hera_swimwear2"}'::jsonb
  )
ON CONFLICT DO NOTHING;

-- Heuristic outfit pairs: bikini/tankini/one_piece → cover_up (completes_outfit), bidirectional pairs_with sample.
-- Limit volume: top stock items only.
WITH swim AS (
  SELECT p.ref, pa.product_type, p.stock
  FROM products p
  JOIN product_attributes pa ON pa.product_id = p.id
  WHERE p.active AND p.visible AND p.stock > 0
    AND pa.product_type IN ('bikini', 'tankini', 'one_piece', 'three_piece')
  ORDER BY p.stock DESC
  LIMIT 40
),
covers AS (
  SELECT p.ref, p.stock
  FROM products p
  JOIN product_attributes pa ON pa.product_id = p.id
  WHERE p.active AND p.visible AND p.stock > 0
    AND pa.product_type = 'cover_up'
  ORDER BY p.stock DESC
  LIMIT 12
),
pairs AS (
  SELECT
    s.ref AS from_ref,
    c.ref AS to_ref,
    'completes_outfit'::text AS relation_type,
    LEAST(100, 40 + (s.stock / 10.0) + (c.stock / 10.0)) AS score
  FROM swim s
  CROSS JOIN LATERAL (
    SELECT ref, stock FROM covers ORDER BY stock DESC LIMIT 3
  ) c
)
INSERT INTO public.product_relations (from_ref, to_ref, relation_type, score, source, meta)
SELECT from_ref, to_ref, relation_type, score, 'heuristic',
  '{"reason":"swimwear_to_cover_up"}'::jsonb
FROM pairs
ON CONFLICT (from_ref, to_ref, relation_type) DO NOTHING;

-- Mirror weak pairs_with edges (cover → swim) for "qué bikini va con este kimono"
INSERT INTO public.product_relations (from_ref, to_ref, relation_type, score, source, meta)
SELECT to_ref, from_ref, 'pairs_with', GREATEST(1, score - 10), 'heuristic',
  '{"reason":"cover_up_to_swimwear"}'::jsonb
FROM product_relations
WHERE relation_type = 'completes_outfit'
  AND source = 'heuristic'
  AND meta->>'reason' = 'swimwear_to_cover_up'
ON CONFLICT (from_ref, to_ref, relation_type) DO NOTHING;

-- Attach published editorial posts as knowledge when CTA ref resolves to HERA-*.
INSERT INTO public.product_knowledge_links
  (ref, kind, title, url, thumbnail_url, external_id, applies_to, published_at, meta)
SELECT
  p.ref,
  'editorial',
  c.title,
  'https://heraswimsuit.com/catalogo/contenido.html?id=' || c.id::text,
  c.thumb_url,
  c.id::text,
  '{}'::jsonb,
  c.published_at,
  jsonb_build_object(
    'source', 'catalog_content_posts',
    'slug', c.slug,
    'media_type', c.media_type,
    'cta_raw', c.cta_product_ref
  )
FROM catalog_content_posts c
JOIN products p
  ON p.active AND p.visible
 AND (
   upper(p.ref) = upper(trim(c.cta_product_ref))
   OR upper(p.name) = upper(trim(c.cta_product_ref))
   OR p.name ILIKE '%' || trim(c.cta_product_ref) || '%'
 )
WHERE c.status = 'published'
  AND c.cta_product_ref IS NOT NULL
  AND length(trim(c.cta_product_ref)) > 0
ON CONFLICT DO NOTHING;
