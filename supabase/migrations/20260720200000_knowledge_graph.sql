-- Hera Knowledge Graph: nodes + edges.
-- /products/{ref}/knowledge is a VIEW over this graph, not the source of truth.

CREATE TABLE IF NOT EXISTS public.knowledge_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_type text NOT NULL
    CHECK (node_type IN (
      'product',
      'blog',
      'guide',
      'instagram',
      'tiktok',
      'pinterest',
      'editorial',
      'collection',
      'video',
      'customer_photo',
      'lookbook',
      'brand'
    )),
  -- Stable business key, e.g. product:HERA-20132, ig:post/ABC, collection:quiet-luxury
  external_key text NOT NULL,
  title text NOT NULL DEFAULT '',
  url text,
  thumbnail_url text,
  locale text NOT NULL DEFAULT 'es-CO',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_nodes_key_unique UNIQUE (node_type, external_key)
);

CREATE INDEX IF NOT EXISTS knowledge_nodes_type_idx
  ON public.knowledge_nodes (node_type)
  WHERE active;

CREATE INDEX IF NOT EXISTS knowledge_nodes_external_key_idx
  ON public.knowledge_nodes (external_key);

CREATE TABLE IF NOT EXISTS public.knowledge_edges (
  id bigserial PRIMARY KEY,
  from_node_id uuid NOT NULL REFERENCES public.knowledge_nodes (id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES public.knowledge_nodes (id) ON DELETE CASCADE,
  relation_type text NOT NULL
    CHECK (relation_type IN (
      'related_to',
      'similar_to',
      'pairs_with',
      'completes',
      'upsell',
      'same_look',
      'alternative',
      'appears_in',
      'mentioned_in',
      'belongs_to',
      'recommended_for',
      'has_media'
    )),
  score numeric NOT NULL DEFAULT 1 CHECK (score >= 0 AND score <= 100),
  source text NOT NULL DEFAULT 'curated'
    CHECK (source IN ('curated', 'heuristic', 'ai', 'system')),
  active boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_edges_no_self CHECK (from_node_id <> to_node_id),
  CONSTRAINT knowledge_edges_unique UNIQUE (from_node_id, to_node_id, relation_type)
);

CREATE INDEX IF NOT EXISTS knowledge_edges_from_idx
  ON public.knowledge_edges (from_node_id)
  WHERE active;

CREATE INDEX IF NOT EXISTS knowledge_edges_to_idx
  ON public.knowledge_edges (to_node_id)
  WHERE active;

CREATE INDEX IF NOT EXISTS knowledge_edges_rel_idx
  ON public.knowledge_edges (relation_type)
  WHERE active;

COMMENT ON TABLE public.knowledge_nodes IS
  'Nodos del knowledge graph comercial Hera (productos, social, blog, colecciones, …).';
COMMENT ON TABLE public.knowledge_edges IS
  'Relaciones tipadas entre nodos. /knowledge es una proyección de este grafo.';

ALTER TABLE public.knowledge_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_nodes_public_read ON public.knowledge_nodes;
CREATE POLICY knowledge_nodes_public_read ON public.knowledge_nodes
  FOR SELECT TO anon, authenticated USING (active = true);

DROP POLICY IF EXISTS knowledge_edges_public_read ON public.knowledge_edges;
CREATE POLICY knowledge_edges_public_read ON public.knowledge_edges
  FOR SELECT TO anon, authenticated USING (active = true);

DROP POLICY IF EXISTS knowledge_nodes_auth_write ON public.knowledge_nodes;
CREATE POLICY knowledge_nodes_auth_write ON public.knowledge_nodes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS knowledge_edges_auth_write ON public.knowledge_edges;
CREATE POLICY knowledge_edges_auth_write ON public.knowledge_edges
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT ON public.knowledge_nodes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_nodes TO authenticated;
GRANT SELECT ON public.knowledge_edges TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_edges TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.knowledge_edges_id_seq TO authenticated;

-- Upsert helper
CREATE OR REPLACE FUNCTION public.upsert_knowledge_node(
  p_node_type text,
  p_external_key text,
  p_title text DEFAULT '',
  p_url text DEFAULT NULL,
  p_thumbnail_url text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb,
  p_locale text DEFAULT 'es-CO',
  p_published_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nid uuid;
BEGIN
  INSERT INTO knowledge_nodes AS kn (
    node_type, external_key, title, url, thumbnail_url, meta, locale, published_at, updated_at
  )
  VALUES (
    p_node_type,
    p_external_key,
    coalesce(nullif(p_title, ''), p_external_key),
    p_url,
    p_thumbnail_url,
    coalesce(p_meta, '{}'::jsonb),
    coalesce(p_locale, 'es-CO'),
    p_published_at,
    now()
  )
  ON CONFLICT (node_type, external_key) DO UPDATE SET
    title = CASE
      WHEN EXCLUDED.title IS NOT NULL AND EXCLUDED.title <> '' THEN EXCLUDED.title
      ELSE kn.title
    END,
    url = coalesce(EXCLUDED.url, kn.url),
    thumbnail_url = coalesce(EXCLUDED.thumbnail_url, kn.thumbnail_url),
    meta = kn.meta || EXCLUDED.meta,
    locale = coalesce(EXCLUDED.locale, kn.locale),
    published_at = coalesce(EXCLUDED.published_at, kn.published_at),
    active = true,
    updated_at = now()
  RETURNING id INTO nid;
  RETURN nid;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_knowledge_edge(
  p_from_id uuid,
  p_to_id uuid,
  p_relation_type text,
  p_score numeric DEFAULT 1,
  p_source text DEFAULT 'curated',
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eid bigint;
BEGIN
  IF p_from_id IS NULL OR p_to_id IS NULL OR p_from_id = p_to_id THEN
    RETURN NULL;
  END IF;
  INSERT INTO knowledge_edges AS ke (
    from_node_id, to_node_id, relation_type, score, source, meta, updated_at
  )
  VALUES (
    p_from_id, p_to_id, p_relation_type,
    coalesce(p_score, 1), coalesce(p_source, 'curated'), coalesce(p_meta, '{}'::jsonb), now()
  )
  ON CONFLICT (from_node_id, to_node_id, relation_type) DO UPDATE SET
    score = EXCLUDED.score,
    source = EXCLUDED.source,
    meta = ke.meta || EXCLUDED.meta,
    active = true,
    updated_at = now()
  RETURNING id INTO eid;
  RETURN eid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_knowledge_node(text, text, text, text, text, jsonb, text, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_knowledge_edge(uuid, uuid, text, numeric, text, jsonb)
  TO authenticated;

-- Rebuild graph from existing sources (idempotent).
CREATE OR REPLACE FUNCTION public.rebuild_knowledge_graph()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_products int := 0;
  n_links int := 0;
  n_rels int := 0;
  n_cols int := 0;
  from_id uuid;
  to_id uuid;
  r record;
  product_key text;
  link_key text;
  col_key text;
BEGIN
  -- Products
  FOR r IN
    SELECT p.ref, p.name, p.updated_at
    FROM products p
    WHERE coalesce(p.active, false) AND coalesce(p.visible, false)
      AND p.ref IS NOT NULL AND btrim(p.ref) <> ''
  LOOP
    PERFORM upsert_knowledge_node(
      'product',
      'product:' || r.ref,
      r.name,
      'https://heraswimsuit.com/catalogo/?p=' || r.ref,
      NULL,
      jsonb_build_object('ref', r.ref),
      'es-CO',
      r.updated_at
    );
    n_products := n_products + 1;
  END LOOP;

  -- Collections
  FOR r IN
    SELECT slug, title, description FROM catalog_collections WHERE active
  LOOP
    PERFORM upsert_knowledge_node(
      'collection',
      'collection:' || r.slug,
      r.title,
      'https://heraswimsuit.com/api/v1/collections/' || r.slug,
      NULL,
      jsonb_build_object('slug', r.slug, 'description', r.description),
      'es-CO',
      now()
    );
    n_cols := n_cols + 1;
  END LOOP;

  -- belongs_to from product_attributes.collection_slugs
  FOR r IN
    SELECT pa.ref, unnest(pa.collection_slugs) AS slug
    FROM product_attributes pa
    WHERE cardinality(pa.collection_slugs) > 0
  LOOP
    from_id := (
      SELECT id FROM knowledge_nodes
      WHERE node_type = 'product' AND external_key = 'product:' || r.ref
    );
    to_id := (
      SELECT id FROM knowledge_nodes
      WHERE node_type = 'collection' AND external_key = 'collection:' || r.slug
    );
    IF from_id IS NOT NULL AND to_id IS NOT NULL THEN
      PERFORM upsert_knowledge_edge(from_id, to_id, 'belongs_to', 80, 'system', '{}'::jsonb);
    END IF;
  END LOOP;

  -- Knowledge links → nodes + appears_in / mentioned_in
  FOR r IN
    SELECT * FROM product_knowledge_links WHERE active
  LOOP
    link_key := r.kind || ':' || md5(coalesce(r.url, '') || '|' || coalesce(r.external_id, '') || '|' || coalesce(r.ref, ''));
    to_id := upsert_knowledge_node(
      CASE
        WHEN r.kind IN (
          'blog', 'guide', 'instagram', 'tiktok', 'pinterest',
          'editorial', 'video', 'lookbook', 'customer_photo'
        ) THEN r.kind
        ELSE 'guide'
      END,
      link_key,
      r.title,
      r.url,
      r.thumbnail_url,
      coalesce(r.meta, '{}'::jsonb) || jsonb_build_object('applies_to', r.applies_to),
      coalesce(r.locale, 'es-CO'),
      r.published_at
    );
    n_links := n_links + 1;

    IF r.ref IS NOT NULL AND r.ref ~ '^HERA-' THEN
      from_id := (
        SELECT id FROM knowledge_nodes
        WHERE node_type = 'product' AND external_key = 'product:' || r.ref
      );
      IF from_id IS NOT NULL THEN
        PERFORM upsert_knowledge_edge(
          from_id,
          to_id,
          CASE
            WHEN r.kind IN ('instagram', 'tiktok', 'pinterest', 'video', 'customer_photo', 'editorial', 'lookbook')
              THEN 'appears_in'
            ELSE 'mentioned_in'
          END,
          70,
          'system',
          jsonb_build_object('link_id', r.id)
        );
      END IF;
    ELSIF r.applies_to ? 'product_types' OR r.applies_to ? 'secciones' OR r.applies_to ? 'brand' THEN
      -- Facet-scoped guides: connect to matching product nodes
      FOR product_key IN
        SELECT kn.external_key
        FROM knowledge_nodes kn
        JOIN products p ON kn.node_type = 'product' AND kn.external_key = 'product:' || p.ref
        LEFT JOIN product_attributes pa ON pa.ref = p.ref
        WHERE kn.active
          AND (
            (r.applies_to ? 'brand' AND (r.applies_to->>'brand')::boolean IS TRUE)
            OR (
              r.applies_to ? 'product_types'
              AND pa.product_type = ANY (
                ARRAY(SELECT jsonb_array_elements_text(r.applies_to->'product_types'))
              )
            )
            OR (
              r.applies_to ? 'secciones'
              AND lower(p.seccion) = ANY (
                SELECT lower(x) FROM jsonb_array_elements_text(r.applies_to->'secciones') AS t(x)
              )
            )
          )
        LIMIT 80
      LOOP
        from_id := (
          SELECT id FROM knowledge_nodes WHERE external_key = product_key AND node_type = 'product'
        );
        IF from_id IS NOT NULL THEN
          PERFORM upsert_knowledge_edge(from_id, to_id, 'mentioned_in', 40, 'heuristic', '{}'::jsonb);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Product relations → edges
  FOR r IN
    SELECT * FROM product_relations WHERE active
  LOOP
    from_id := (
      SELECT id FROM knowledge_nodes
      WHERE node_type = 'product' AND external_key = 'product:' || r.from_ref
    );
    to_id := (
      SELECT id FROM knowledge_nodes
      WHERE node_type = 'product' AND external_key = 'product:' || r.to_ref
    );
    IF from_id IS NOT NULL AND to_id IS NOT NULL THEN
      PERFORM upsert_knowledge_edge(
        from_id,
        to_id,
        CASE r.relation_type
          WHEN 'completes_outfit' THEN 'completes'
          WHEN 'pairs_with' THEN 'pairs_with'
          WHEN 'similar' THEN 'similar_to'
          WHEN 'upsell' THEN 'upsell'
          WHEN 'same_look' THEN 'same_look'
          WHEN 'alternative' THEN 'alternative'
          ELSE 'related_to'
        END,
        r.score,
        r.source,
        coalesce(r.meta, '{}'::jsonb)
      );
      n_rels := n_rels + 1;
    END IF;
  END LOOP;

  -- Collection → recommended_for (occasion collections)
  FOR r IN
    SELECT slug FROM catalog_collections WHERE active AND slug IN ('luna-de-miel', 'cartagena')
  LOOP
    to_id := (
      SELECT id FROM knowledge_nodes
      WHERE node_type = 'collection' AND external_key = 'collection:' || r.slug
    );
    FOR from_id IN
      SELECT kn.id
      FROM knowledge_nodes kn
      JOIN product_attributes pa ON kn.external_key = 'product:' || pa.ref
      WHERE kn.node_type = 'product'
        AND r.slug = ANY (pa.collection_slugs)
    LOOP
      PERFORM upsert_knowledge_edge(from_id, to_id, 'recommended_for', 60, 'system', '{}'::jsonb);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'products', n_products,
    'collections', n_cols,
    'links', n_links,
    'relation_edges', n_rels,
    'nodes', (SELECT count(*) FROM knowledge_nodes WHERE active),
    'edges', (SELECT count(*) FROM knowledge_edges WHERE active)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_knowledge_graph() TO authenticated;

SELECT rebuild_knowledge_graph();
