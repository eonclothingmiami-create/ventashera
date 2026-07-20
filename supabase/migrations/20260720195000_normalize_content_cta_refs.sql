-- Normalize content CTAs to HERA-* and rebuild editorial knowledge links.

CREATE OR REPLACE FUNCTION public.resolve_cta_to_product(p_raw text)
RETURNS TABLE (product_id uuid, product_ref text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  raw text := btrim(coalesce(p_raw, ''));
  resolved text;
BEGIN
  IF raw = '' THEN
    RETURN;
  END IF;

  -- Already a ref / alias
  SELECT resolve_product_ref(raw) INTO resolved;
  IF resolved IS NOT NULL AND resolved <> '' THEN
    RETURN QUERY
      SELECT p.id, p.ref
      FROM products p
      WHERE p.ref = resolved AND coalesce(p.active, false) AND coalesce(p.visible, false)
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Exact name match (case-insensitive)
  RETURN QUERY
    SELECT p.id, p.ref
    FROM products p
    WHERE coalesce(p.active, false) AND coalesce(p.visible, false)
      AND lower(p.name) = lower(raw)
    ORDER BY p.updated_at DESC NULLS LAST
    LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Fuzzy contains
  RETURN QUERY
    SELECT p.id, p.ref
    FROM products p
    WHERE coalesce(p.active, false) AND coalesce(p.visible, false)
      AND p.name ILIKE '%' || raw || '%'
    ORDER BY length(p.name) ASC, p.updated_at DESC NULLS LAST
    LIMIT 1;
END;
$$;

-- Backfill CTA 1
UPDATE catalog_content_posts c
SET
  cta_product_id = sub.product_id,
  cta_product_ref = sub.product_ref,
  updated_at = now()
FROM (
  SELECT c2.id, m.product_id, m.product_ref
  FROM catalog_content_posts c2
  CROSS JOIN LATERAL resolve_cta_to_product(c2.cta_product_ref) AS m
  WHERE c2.cta_type = 'product'
    AND c2.cta_product_ref IS NOT NULL
    AND btrim(c2.cta_product_ref) <> ''
) AS sub
WHERE c.id = sub.id
  AND sub.product_ref IS NOT NULL
  AND (
    c.cta_product_ref !~ '^HERA-'
    OR c.cta_product_id IS NULL
    OR c.cta_product_id IS DISTINCT FROM sub.product_id
  );

-- Backfill CTA 2
UPDATE catalog_content_posts c
SET
  cta_product_id_2 = sub.product_id,
  cta_product_ref_2 = sub.product_ref,
  updated_at = now()
FROM (
  SELECT c2.id, m.product_id, m.product_ref
  FROM catalog_content_posts c2
  CROSS JOIN LATERAL resolve_cta_to_product(c2.cta_product_ref_2) AS m
  WHERE c2.cta_type_2 = 'product'
    AND c2.cta_product_ref_2 IS NOT NULL
    AND btrim(c2.cta_product_ref_2) <> ''
) AS sub
WHERE c.id = sub.id
  AND sub.product_ref IS NOT NULL
  AND (
    c.cta_product_ref_2 !~ '^HERA-'
    OR c.cta_product_id_2 IS NULL
    OR c.cta_product_id_2 IS DISTINCT FROM sub.product_id
  );

-- Rebuild editorial knowledge links from published posts with HERA CTA
DELETE FROM product_knowledge_links
WHERE kind = 'editorial'
  AND meta->>'source' = 'catalog_content_posts';

INSERT INTO product_knowledge_links
  (ref, kind, title, url, thumbnail_url, external_id, applies_to, published_at, meta)
SELECT
  c.cta_product_ref,
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
    'cta_slot', 1
  )
FROM catalog_content_posts c
WHERE c.status = 'published'
  AND c.cta_type = 'product'
  AND c.cta_product_ref ~ '^HERA-'
ON CONFLICT (kind, url, (coalesce(ref, ''))) DO UPDATE SET
  title = EXCLUDED.title,
  thumbnail_url = EXCLUDED.thumbnail_url,
  published_at = EXCLUDED.published_at,
  meta = EXCLUDED.meta,
  updated_at = now(),
  active = true;

INSERT INTO product_knowledge_links
  (ref, kind, title, url, thumbnail_url, external_id, applies_to, published_at, meta)
SELECT
  c.cta_product_ref_2,
  'editorial',
  c.title || ' (CTA 2)',
  'https://heraswimsuit.com/catalogo/contenido.html?id=' || c.id::text || '&cta=2',
  c.thumb_url,
  c.id::text || ':2',
  '{}'::jsonb,
  c.published_at,
  jsonb_build_object(
    'source', 'catalog_content_posts',
    'slug', c.slug,
    'media_type', c.media_type,
    'cta_slot', 2
  )
FROM catalog_content_posts c
WHERE c.status = 'published'
  AND c.cta_type_2 = 'product'
  AND c.cta_product_ref_2 ~ '^HERA-'
ON CONFLICT (kind, url, (coalesce(ref, ''))) DO UPDATE SET
  title = EXCLUDED.title,
  thumbnail_url = EXCLUDED.thumbnail_url,
  published_at = EXCLUDED.published_at,
  meta = EXCLUDED.meta,
  updated_at = now(),
  active = true;

-- Helper for ERP / future jobs
CREATE OR REPLACE FUNCTION public.sync_editorial_knowledge_links()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int := 0;
BEGIN
  DELETE FROM product_knowledge_links
  WHERE kind = 'editorial' AND meta->>'source' = 'catalog_content_posts';

  INSERT INTO product_knowledge_links
    (ref, kind, title, url, thumbnail_url, external_id, applies_to, published_at, meta)
  SELECT
    c.cta_product_ref,
    'editorial',
    c.title,
    'https://heraswimsuit.com/catalogo/contenido.html?id=' || c.id::text,
    c.thumb_url,
    c.id::text,
    '{}'::jsonb,
    c.published_at,
    jsonb_build_object('source', 'catalog_content_posts', 'slug', c.slug, 'cta_slot', 1)
  FROM catalog_content_posts c
  WHERE c.status = 'published'
    AND c.cta_type = 'product'
    AND c.cta_product_ref ~ '^HERA-'
  ON CONFLICT (kind, url, (coalesce(ref, ''))) DO UPDATE SET
    title = EXCLUDED.title,
    thumbnail_url = EXCLUDED.thumbnail_url,
    published_at = EXCLUDED.published_at,
    meta = EXCLUDED.meta,
    updated_at = now(),
    active = true;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_editorial_knowledge_links() TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_cta_to_product(text) TO authenticated;
