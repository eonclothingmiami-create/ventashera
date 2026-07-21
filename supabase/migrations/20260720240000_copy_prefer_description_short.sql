-- Prefer description_short for public catalog copy (products.description).
-- Long detail belongs in Knowledge, not the PDP.

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
        nullif(btrim(coalesce(
          art.payload->>'description_short',
          art.payload->>'description',
          art.payload->>'description_long'
        )), ''),
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

GRANT EXECUTE ON FUNCTION public.accept_product_ai_artifact(uuid) TO authenticated;
