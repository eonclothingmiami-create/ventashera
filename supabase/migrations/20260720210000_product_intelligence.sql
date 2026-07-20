-- Product Intelligence MVP: entity + versioned AI artifacts + async jobs.
-- Does not alter products write path; AI suggests until accept RPCs apply side-effects.

CREATE TABLE IF NOT EXISTS public.product_intelligence (
  ref text PRIMARY KEY REFERENCES public.products (ref) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'empty'
    CHECK (status IN ('empty', 'generating', 'ready', 'partial', 'error')),
  modules jsonb NOT NULL DEFAULT '{
    "copy":{"status":"empty"},
    "seo":{"status":"empty"},
    "attributes":{"status":"empty"},
    "relations":{"status":"empty"},
    "knowledge":{"status":"empty"},
    "embedding":{"status":"empty"}
  }'::jsonb,
  active_provider text NOT NULL DEFAULT 'openai',
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_intelligence IS
  'Estado agregado de inteligencia por HERA-*. Source of truth operativa = products; esto orquesta copy/SEO/attrs/relations/knowledge.';

CREATE TABLE IF NOT EXISTS public.product_ai_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL REFERENCES public.products (ref) ON DELETE CASCADE,
  artifact_type text NOT NULL
    CHECK (artifact_type IN ('copy', 'seo', 'attributes', 'relations', 'knowledge_doc')),
  version int NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'accepted', 'rejected', 'superseded')),
  model text,
  prompt_version text,
  provider text NOT NULL DEFAULT 'openai',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  accepted_by uuid
);

CREATE INDEX IF NOT EXISTS product_ai_artifacts_ref_type_idx
  ON public.product_ai_artifacts (ref, artifact_type, created_at DESC);

CREATE INDEX IF NOT EXISTS product_ai_artifacts_suggested_idx
  ON public.product_ai_artifacts (ref, artifact_type)
  WHERE status = 'suggested';

COMMENT ON TABLE public.product_ai_artifacts IS
  'Versiones de contenido IA. suggested → accepted/rejected; accepted supersede previos del mismo tipo.';

CREATE TABLE IF NOT EXISTS public.product_ai_jobs (
  id bigserial PRIMARY KEY,
  ref text NOT NULL REFERENCES public.products (ref) ON DELETE CASCADE,
  module text NOT NULL
    CHECK (module IN ('copy', 'seo', 'attributes', 'relations', 'knowledge', 'embedding')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_ai_jobs_one_pending
  ON public.product_ai_jobs (ref, module)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS product_ai_jobs_pending_idx
  ON public.product_ai_jobs (created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.product_ai_jobs IS
  'Cola async por módulo (copy/seo/attributes/relations/knowledge/embedding). No bloquear saveArticulo.';

ALTER TABLE public.product_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_ai_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_ai_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_intelligence_auth_all ON public.product_intelligence;
CREATE POLICY product_intelligence_auth_all ON public.product_intelligence
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_ai_artifacts_auth_all ON public.product_ai_artifacts;
CREATE POLICY product_ai_artifacts_auth_all ON public.product_ai_artifacts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS product_ai_jobs_auth_all ON public.product_ai_jobs;
CREATE POLICY product_ai_jobs_auth_all ON public.product_ai_jobs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Auth write on product_attributes (approve attributes from ERP).
GRANT SELECT, INSERT, UPDATE ON public.product_attributes TO authenticated;
DROP POLICY IF EXISTS product_attributes_auth_write ON public.product_attributes;
CREATE POLICY product_attributes_auth_write ON public.product_attributes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.product_intelligence TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_ai_artifacts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_ai_jobs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.product_ai_jobs_id_seq TO authenticated;

-- Ensure intelligence row exists.
CREATE OR REPLACE FUNCTION public.ensure_product_intelligence(p_ref text)
RETURNS public.product_intelligence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.product_intelligence;
  clean text := upper(btrim(p_ref));
BEGIN
  IF clean IS NULL OR clean = '' THEN
    RAISE EXCEPTION 'ref required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE ref = clean) THEN
    RAISE EXCEPTION 'product ref % not found', clean;
  END IF;

  INSERT INTO product_intelligence (ref)
  VALUES (clean)
  ON CONFLICT (ref) DO NOTHING;

  SELECT * INTO r FROM product_intelligence WHERE ref = clean;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_product_ai_job(p_ref text, p_module text)
RETURNS public.product_ai_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean text := upper(btrim(p_ref));
  mod text := lower(btrim(p_module));
  uid uuid := auth.uid();
  job public.product_ai_jobs;
  mods jsonb;
BEGIN
  IF mod NOT IN ('copy', 'seo', 'attributes', 'relations', 'knowledge', 'embedding') THEN
    RAISE EXCEPTION 'invalid module %', p_module;
  END IF;

  PERFORM ensure_product_intelligence(clean);

  SELECT id, ref, module, status, attempts, last_error, requested_by, created_at, updated_at
  INTO job
  FROM product_ai_jobs
  WHERE ref = clean AND module = mod AND status = 'pending'
  LIMIT 1;

  IF FOUND THEN
    RETURN job;
  END IF;

  INSERT INTO product_ai_jobs (ref, module, status, requested_by)
  VALUES (clean, mod, 'pending', uid)
  RETURNING * INTO job;

  mods := coalesce(
    (SELECT modules FROM product_intelligence WHERE ref = clean),
    '{}'::jsonb
  );
  mods := jsonb_set(
    mods,
    ARRAY[mod],
    coalesce(mods->mod, '{}'::jsonb) || jsonb_build_object(
      'status', 'pending',
      'job_id', job.id,
      'updated_at', now()
    ),
    true
  );

  UPDATE product_intelligence
  SET
    status = 'generating',
    modules = mods,
    last_error = NULL,
    updated_at = now()
  WHERE ref = clean;

  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_product_ai_artifact(p_artifact_id uuid)
RETURNS public.product_ai_artifacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  art public.product_ai_artifacts;
BEGIN
  UPDATE product_ai_artifacts
  SET status = 'rejected'
  WHERE id = p_artifact_id AND status = 'suggested'
  RETURNING * INTO art;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'artifact % not found or not suggested', p_artifact_id;
  END IF;
  RETURN art;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_product_knowledge_doc(p_ref text, p_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  clean text := upper(btrim(p_ref));
  emb_text text := coalesce(p_text, '');
  new_hash text;
  old_hash text;
  enqueued boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE ref = clean) THEN
    RAISE EXCEPTION 'product ref % not found', clean;
  END IF;

  new_hash := encode(extensions.digest(emb_text, 'sha256'), 'hex');
  SELECT content_hash INTO old_hash FROM product_search_docs WHERE ref = clean;

  INSERT INTO product_search_docs AS sd (
    ref, locale, embedding_text, embedding_version, content_hash, updated_at
  )
  VALUES (clean, 'es-CO', emb_text, 1, new_hash, now())
  ON CONFLICT (ref) DO UPDATE SET
    embedding_text = EXCLUDED.embedding_text,
    content_hash = EXCLUDED.content_hash,
    updated_at = now(),
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
    VALUES (clean, 'knowledge_doc_accepted', 'pending');
    enqueued := true;
  END IF;

  RETURN jsonb_build_object(
    'ref', clean,
    'content_hash', new_hash,
    'embedding_enqueued', enqueued
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_product_ai_artifact(p_artifact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  art public.product_ai_artifacts;
  uid uuid := auth.uid();
  side jsonb := '{}'::jsonb;
  rel jsonb;
  rel_type text;
  to_ref text;
  sc numeric;
  reason text;
  applied int := 0;
  pid uuid;
  pa jsonb;
  mods jsonb;
  mod_key text;
BEGIN
  SELECT * INTO art FROM product_ai_artifacts WHERE id = p_artifact_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'artifact not found';
  END IF;
  IF art.status <> 'suggested' THEN
    RAISE EXCEPTION 'artifact status is %, expected suggested', art.status;
  END IF;

  UPDATE product_ai_artifacts
  SET status = 'superseded'
  WHERE ref = art.ref
    AND artifact_type = art.artifact_type
    AND status = 'accepted'
    AND id <> art.id;

  UPDATE product_ai_artifacts
  SET status = 'accepted', accepted_at = now(), accepted_by = uid
  WHERE id = art.id
  RETURNING * INTO art;

  IF art.artifact_type = 'copy' THEN
    UPDATE products
    SET
      name = coalesce(nullif(btrim(art.payload->>'name'), ''), name),
      description = coalesce(
        nullif(btrim(coalesce(art.payload->>'description_long', art.payload->>'description_short', art.payload->>'description')), ''),
        description
      ),
      updated_at = now()
    WHERE ref = art.ref;
    side := jsonb_build_object('applied', 'products.name_description');

  ELSIF art.artifact_type = 'seo' THEN
    side := jsonb_build_object('applied', 'seo_artifact_only');

  ELSIF art.artifact_type = 'attributes' THEN
    SELECT id INTO pid FROM products WHERE ref = art.ref;
    pa := art.payload;
    INSERT INTO product_attributes AS a (
      product_id, ref, product_type, style, occasions, fit_goals,
      silhouette, coverage, materials, season, collection_slugs, attrs, updated_at
    )
    VALUES (
      pid,
      art.ref,
      nullif(pa->>'product_type', ''),
      coalesce(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(pa->'style', '[]'::jsonb)) t(x)),
        '{}'
      ),
      coalesce(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(pa->'occasions', '[]'::jsonb)) t(x)),
        '{}'
      ),
      coalesce(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(pa->'fit_goals', '[]'::jsonb)) t(x)),
        '{}'
      ),
      nullif(pa->>'silhouette', ''),
      nullif(pa->>'coverage', ''),
      coalesce(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(pa->'materials', '[]'::jsonb)) t(x)),
        '{}'
      ),
      coalesce(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(pa->'season', '[]'::jsonb)) t(x)),
        '{}'
      ),
      coalesce(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(pa->'collection_slugs', '[]'::jsonb)) t(x)),
        '{}'
      ),
      coalesce(pa->'attrs', '{}'::jsonb),
      now()
    )
    ON CONFLICT (product_id) DO UPDATE SET
      product_type = coalesce(EXCLUDED.product_type, a.product_type),
      style = EXCLUDED.style,
      occasions = EXCLUDED.occasions,
      fit_goals = EXCLUDED.fit_goals,
      silhouette = coalesce(EXCLUDED.silhouette, a.silhouette),
      coverage = coalesce(EXCLUDED.coverage, a.coverage),
      materials = EXCLUDED.materials,
      season = EXCLUDED.season,
      collection_slugs = EXCLUDED.collection_slugs,
      attrs = a.attrs || EXCLUDED.attrs,
      updated_at = now();
    side := jsonb_build_object('applied', 'product_attributes');

  ELSIF art.artifact_type = 'relations' THEN
    FOR rel IN
      SELECT value FROM jsonb_array_elements(coalesce(art.payload->'candidates', '[]'::jsonb))
    LOOP
      IF coalesce((rel->>'approved')::boolean, true) IS NOT TRUE THEN
        CONTINUE;
      END IF;
      to_ref := upper(btrim(rel->>'to_ref'));
      rel_type := btrim(rel->>'relation_type');
      IF to_ref IS NULL OR to_ref = '' OR to_ref = art.ref THEN
        CONTINUE;
      END IF;
      IF rel_type NOT IN (
        'pairs_with', 'similar', 'upsell', 'completes_outfit', 'same_look', 'alternative'
      ) THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM products WHERE ref = to_ref) THEN
        CONTINUE;
      END IF;
      sc := least(100, greatest(0, coalesce((rel->>'score')::numeric, 50)));
      reason := left(coalesce(rel->>'reason', ''), 500);

      INSERT INTO product_relations AS pr (
        from_ref, to_ref, relation_type, score, source, active, meta, updated_at
      )
      VALUES (
        art.ref, to_ref, rel_type, sc, 'ai', true,
        jsonb_build_object('reason', reason, 'artifact_id', art.id),
        now()
      )
      ON CONFLICT (from_ref, to_ref, relation_type) DO UPDATE SET
        score = EXCLUDED.score,
        source = CASE WHEN pr.source = 'curated' THEN pr.source ELSE 'ai' END,
        active = true,
        meta = pr.meta || EXCLUDED.meta,
        updated_at = now()
      WHERE pr.source IS DISTINCT FROM 'curated';

      applied := applied + 1;
    END LOOP;
    side := jsonb_build_object('applied', 'product_relations', 'count', applied);

  ELSIF art.artifact_type = 'knowledge_doc' THEN
    side := apply_product_knowledge_doc(
      art.ref,
      coalesce(art.payload->>'document', art.payload->>'text', '')
    );
  END IF;

  PERFORM ensure_product_intelligence(art.ref);
  mod_key := CASE art.artifact_type
    WHEN 'knowledge_doc' THEN 'knowledge'
    ELSE art.artifact_type
  END;
  mods := coalesce((SELECT modules FROM product_intelligence WHERE ref = art.ref), '{}'::jsonb);
  mods := jsonb_set(
    mods,
    ARRAY[mod_key],
    coalesce(mods->mod_key, '{}'::jsonb) || jsonb_build_object(
      'status', 'accepted',
      'artifact_id', art.id,
      'accepted_at', now()
    ),
    true
  );
  UPDATE product_intelligence
  SET
    modules = mods,
    status = 'partial',
    updated_at = now()
  WHERE ref = art.ref;

  RETURN jsonb_build_object(
    'artifact', to_jsonb(art),
    'side_effects', side
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_product_intelligence(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_product_ai_job(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_product_ai_artifact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_product_ai_artifact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_product_knowledge_doc(text, text) TO authenticated;
