-- Catalog API v1 foundation: attributes, search docs (pgvector), embedding jobs.
-- Embeddings are nullable until a worker fills them; keyword/hybrid search works first.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Facetas tipadas de moda (complementan seccion/categoria del ERP).
CREATE TABLE IF NOT EXISTS public.product_attributes (
  product_id uuid PRIMARY KEY REFERENCES public.products (id) ON DELETE CASCADE,
  ref text NOT NULL UNIQUE,
  product_type text,
  style text[] NOT NULL DEFAULT '{}',
  occasions text[] NOT NULL DEFAULT '{}',
  fit_goals text[] NOT NULL DEFAULT '{}',
  silhouette text,
  coverage text,
  materials text[] NOT NULL DEFAULT '{}',
  season text[] NOT NULL DEFAULT '{}',
  collection_slugs text[] NOT NULL DEFAULT '{}',
  attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_attributes_ref_format CHECK (ref ~ '^[A-Z0-9][A-Z0-9_-]*$')
);

CREATE INDEX IF NOT EXISTS product_attributes_style_gin ON public.product_attributes USING gin (style);
CREATE INDEX IF NOT EXISTS product_attributes_occasions_gin ON public.product_attributes USING gin (occasions);
CREATE INDEX IF NOT EXISTS product_attributes_fit_goals_gin ON public.product_attributes USING gin (fit_goals);
CREATE INDEX IF NOT EXISTS product_attributes_collections_gin ON public.product_attributes USING gin (collection_slugs);
CREATE INDEX IF NOT EXISTS product_attributes_product_type_idx ON public.product_attributes (product_type);

COMMENT ON TABLE public.product_attributes IS
  'Metadatos tipados para Catalog API v1 / búsqueda semántica. Source of truth operativa = products; esto enriquece discovery.';

-- Documento de búsqueda (+ embedding opcional).
CREATE TABLE IF NOT EXISTS public.product_search_docs (
  ref text PRIMARY KEY REFERENCES public.products (ref) ON DELETE CASCADE,
  locale text NOT NULL DEFAULT 'es-CO',
  embedding_text text NOT NULL DEFAULT '',
  embedding extensions.vector(1536),
  embedding_model text,
  embedding_version int NOT NULL DEFAULT 1,
  content_hash text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_search_docs_trgm_idx
  ON public.product_search_docs USING gin (embedding_text extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS product_search_docs_embedding_hnsw
  ON public.product_search_docs
  USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE public.product_search_docs IS
  'Texto canónico + vector para search. Regenerar embedding solo si cambia content_hash.';

-- Cola de embeddings (worker asíncrono; no bloquear writes del ERP).
CREATE TABLE IF NOT EXISTS public.embedding_jobs (
  id bigserial PRIMARY KEY,
  ref text NOT NULL,
  reason text NOT NULL DEFAULT 'upsert',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS embedding_jobs_pending_idx
  ON public.embedding_jobs (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS embedding_jobs_ref_idx ON public.embedding_jobs (ref);

-- Colecciones editoriales (Quiet Luxury, Cartagena, etc.).
CREATE TABLE IF NOT EXISTS public.catalog_collections (
  slug text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  query jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.catalog_collections (slug, title, description, query, sort_order)
VALUES
  (
    'quiet-luxury',
    'Quiet Luxury',
    'Siluetas limpias, neutros y acabados premium.',
    '{"style":["quiet_luxury","minimal","elegant"]}'::jsonb,
    10
  ),
  (
    'cartagena',
    'Cartagena',
    'Looks de resort y playa para el Caribe colombiano.',
    '{"occasions":["cartagena","beach","resort"]}'::jsonb,
    20
  ),
  (
    'luna-de-miel',
    'Luna de miel',
    'Propuestas elegantes para viaje y celebración.',
    '{"occasions":["honeymoon","resort","elegant_evening"]}'::jsonb,
    30
  ),
  (
    'estiliza-cintura',
    'Estiliza la cintura',
    'Cortes y siluetas que marcan cintura.',
    '{"fit_goals":["cinch_waist"]}'::jsonb,
    40
  )
ON CONFLICT (slug) DO NOTHING;

-- Heurística inicial de product_type / ocasiones desde categoria ERP.
CREATE OR REPLACE FUNCTION public.infer_product_attributes_from_row(
  p_seccion text,
  p_categoria text,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cat text := lower(coalesce(p_categoria, ''));
  sec text := lower(coalesce(p_seccion, ''));
  nm text := lower(coalesce(p_name, ''));
  product_type text := 'apparel';
  style text[] := '{}';
  occasions text[] := '{}';
  fit_goals text[] := '{}';
  silhouette text := null;
  coverage text := null;
  collection_slugs text[] := '{}';
BEGIN
  IF cat LIKE '%bikini%' THEN
    product_type := 'bikini';
    occasions := array['beach', 'cartagena', 'pool'];
  ELSIF cat LIKE '%enteriz%' OR cat LIKE '%one piece%' THEN
    product_type := 'one_piece';
    occasions := array['beach', 'resort'];
  ELSIF cat LIKE '%tankini%' THEN
    product_type := 'tankini';
    occasions := array['beach', 'pool'];
  ELSIF cat LIKE '%salida%' OR cat LIKE '%kimono%' OR cat LIKE '%bata%' THEN
    product_type := 'cover_up';
    occasions := array['beach', 'resort', 'pool'];
  ELSIF cat LIKE '%3 pieza%' OR cat LIKE '%tres pieza%' THEN
    product_type := 'three_piece';
    occasions := array['beach', 'resort'];
  ELSIF cat LIKE '%asoleador%' THEN
    product_type := 'sun_dress';
    occasions := array['beach', 'resort'];
  ELSIF cat LIKE '%vestido%' THEN
    product_type := 'dress';
    occasions := array['casual', 'resort'];
  ELSIF cat LIKE '%pijama%' THEN
    product_type := 'pajama';
    occasions := array['lounge', 'honeymoon'];
  ELSIF cat LIKE '%legging%' THEN
    product_type := 'legging';
    occasions := array['sport', 'active'];
  ELSIF cat LIKE '%conjunto%' OR sec LIKE '%active%' OR sec LIKE '%deport%' THEN
    product_type := 'active_set';
    occasions := array['sport', 'active'];
  ELSIF cat LIKE '%pantal%' THEN
    product_type := 'pant';
    occasions := array['casual', 'resort'];
  ELSIF cat LIKE '%infantil%' THEN
    product_type := 'kids_swim';
    occasions := array['beach', 'pool'];
  ELSIF cat LIKE '%body%' THEN
    product_type := 'bodysuit';
    occasions := array['casual'];
  END IF;

  IF nm ~ '(elegante|luxury|luxe|minimal|quiet)' THEN
    style := array['elegant', 'quiet_luxury', 'minimal'];
    collection_slugs := array_append(collection_slugs, 'quiet-luxury');
  END IF;
  IF nm ~ '(cartagena|caribe|resort|playa)' OR cat LIKE '%salida%' THEN
    occasions := array(SELECT DISTINCT unnest(occasions || array['cartagena', 'resort']));
    collection_slugs := array_append(collection_slugs, 'cartagena');
  END IF;
  IF nm ~ '(luna|honeymoon|bridal|novia)' THEN
    occasions := array(SELECT DISTINCT unnest(occasions || array['honeymoon']));
    collection_slugs := array_append(collection_slugs, 'luna-de-miel');
  END IF;
  IF nm ~ '(cintur|faja|high.?waist|tiro alto|mark)' OR cat LIKE '%enteriz%' THEN
    fit_goals := array['cinch_waist'];
    silhouette := coalesce(silhouette, 'waist_defining');
    collection_slugs := array_append(collection_slugs, 'estiliza-cintura');
  END IF;

  RETURN jsonb_build_object(
    'product_type', product_type,
    'style', to_jsonb(style),
    'occasions', to_jsonb(occasions),
    'fit_goals', to_jsonb(fit_goals),
    'silhouette', silhouette,
    'coverage', coverage,
    'collection_slugs', to_jsonb(
      (SELECT coalesce(array_agg(DISTINCT x), '{}') FROM unnest(collection_slugs) AS t(x))
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.build_product_embedding_text(
  p_ref text,
  p_name text,
  p_description text,
  p_seccion text,
  p_categoria text,
  p_attrs jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both ' ' FROM concat_ws(
    ' | ',
    nullif(trim(p_ref), ''),
    nullif(trim(p_name), ''),
    nullif(trim(p_seccion), ''),
    nullif(trim(p_categoria), ''),
    nullif(trim(p_description), ''),
    nullif(p_attrs->>'product_type', ''),
    nullif(array_to_string(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_attrs->'style', '[]'::jsonb))), ' '), ''),
    nullif(array_to_string(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_attrs->'occasions', '[]'::jsonb))), ' '), ''),
    nullif(array_to_string(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_attrs->'fit_goals', '[]'::jsonb))), ' '), ''),
    nullif(p_attrs->>'silhouette', ''),
    nullif(array_to_string(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_attrs->'collection_slugs', '[]'::jsonb))), ' '), '')
  ));
$$;

CREATE OR REPLACE FUNCTION public.refresh_product_search_doc(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r record;
  inferred jsonb;
  attr_payload jsonb;
  emb_text text;
  new_hash text;
  old_hash text;
BEGIN
  SELECT p.id, p.ref, p.name, p.description, p.seccion, p.categoria, p.active, p.visible
  INTO r
  FROM products p
  WHERE p.id = p_product_id;

  IF NOT FOUND OR r.ref IS NULL OR btrim(r.ref) = '' THEN
    RETURN;
  END IF;

  IF NOT coalesce(r.active, false) OR NOT coalesce(r.visible, false) THEN
    DELETE FROM product_search_docs WHERE ref = r.ref;
    DELETE FROM product_attributes WHERE product_id = r.id;
    RETURN;
  END IF;

  inferred := infer_product_attributes_from_row(r.seccion, r.categoria, r.name);

  INSERT INTO product_attributes AS pa (
    product_id, ref, product_type, style, occasions, fit_goals,
    silhouette, coverage, collection_slugs, updated_at
  )
  VALUES (
    r.id,
    r.ref,
    inferred->>'product_type',
    coalesce(
      (SELECT array_agg(x) FROM jsonb_array_elements_text(inferred->'style') AS t(x)),
      '{}'
    ),
    coalesce(
      (SELECT array_agg(x) FROM jsonb_array_elements_text(inferred->'occasions') AS t(x)),
      '{}'
    ),
    coalesce(
      (SELECT array_agg(x) FROM jsonb_array_elements_text(inferred->'fit_goals') AS t(x)),
      '{}'
    ),
    inferred->>'silhouette',
    inferred->>'coverage',
    coalesce(
      (SELECT array_agg(x) FROM jsonb_array_elements_text(inferred->'collection_slugs') AS t(x)),
      '{}'
    ),
    now()
  )
  ON CONFLICT (product_id) DO UPDATE SET
    ref = EXCLUDED.ref,
    -- Solo rellena huecos; no pisa curación manual no vacía
    product_type = coalesce(nullif(pa.product_type, ''), EXCLUDED.product_type),
    style = CASE WHEN coalesce(cardinality(pa.style), 0) = 0 THEN EXCLUDED.style ELSE pa.style END,
    occasions = CASE WHEN coalesce(cardinality(pa.occasions), 0) = 0 THEN EXCLUDED.occasions ELSE pa.occasions END,
    fit_goals = CASE WHEN coalesce(cardinality(pa.fit_goals), 0) = 0 THEN EXCLUDED.fit_goals ELSE pa.fit_goals END,
    silhouette = coalesce(nullif(pa.silhouette, ''), EXCLUDED.silhouette),
    coverage = coalesce(nullif(pa.coverage, ''), EXCLUDED.coverage),
    collection_slugs = CASE
      WHEN coalesce(cardinality(pa.collection_slugs), 0) = 0 THEN EXCLUDED.collection_slugs
      ELSE pa.collection_slugs
    END,
    updated_at = now();

  SELECT jsonb_build_object(
    'product_type', pa.product_type,
    'style', to_jsonb(pa.style),
    'occasions', to_jsonb(pa.occasions),
    'fit_goals', to_jsonb(pa.fit_goals),
    'silhouette', pa.silhouette,
    'collection_slugs', to_jsonb(pa.collection_slugs)
  )
  INTO attr_payload
  FROM product_attributes pa
  WHERE pa.product_id = r.id;

  emb_text := build_product_embedding_text(
    r.ref, r.name, r.description, r.seccion, r.categoria, attr_payload
  );
  new_hash := encode(extensions.digest(emb_text, 'sha256'), 'hex');

  SELECT content_hash INTO old_hash FROM product_search_docs WHERE ref = r.ref;

  INSERT INTO product_search_docs AS sd (
    ref, locale, embedding_text, embedding_version, content_hash, updated_at
  )
  VALUES (r.ref, 'es-CO', emb_text, 1, new_hash, now())
  ON CONFLICT (ref) DO UPDATE SET
    embedding_text = EXCLUDED.embedding_text,
    content_hash = EXCLUDED.content_hash,
    updated_at = now(),
    -- Invalida vector si cambió el texto semántico
    embedding = CASE
      WHEN sd.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN NULL
      ELSE sd.embedding
    END,
    embedding_model = CASE
      WHEN sd.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN NULL
      ELSE sd.embedding_model
    END;

  IF old_hash IS DISTINCT FROM new_hash THEN
    INSERT INTO embedding_jobs (ref, reason, status)
    VALUES (r.ref, 'content_changed', 'pending');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_products_refresh_search_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_product_search_doc(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_refresh_search_doc ON public.products;
CREATE TRIGGER products_refresh_search_doc
AFTER INSERT OR UPDATE OF ref, name, description, seccion, categoria, active, visible, price, stock
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.trg_products_refresh_search_doc();

-- Bootstrap: atributos + docs para catálogo activo/visible.
DO $$
DECLARE
  pid uuid;
BEGIN
  FOR pid IN
    SELECT id FROM products WHERE coalesce(active, false) AND coalesce(visible, false)
  LOOP
    PERFORM refresh_product_search_doc(pid);
  END LOOP;
END;
$$;

-- RLS: lectura pública de proyección/atributos/colecciones; jobs solo service role.
ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_search_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embedding_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_attributes_public_read ON public.product_attributes;
CREATE POLICY product_attributes_public_read ON public.product_attributes
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS product_search_docs_public_read ON public.product_search_docs;
CREATE POLICY product_search_docs_public_read ON public.product_search_docs
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS catalog_collections_public_read ON public.catalog_collections;
CREATE POLICY catalog_collections_public_read ON public.catalog_collections
  FOR SELECT TO anon, authenticated
  USING (active = true);

-- embedding_jobs: sin policies de lectura pública (solo service role / bypass RLS).
