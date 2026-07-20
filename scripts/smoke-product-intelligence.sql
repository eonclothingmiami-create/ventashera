-- Smoke test Product Intelligence (no OpenAI required): suggest → accept SEO only.
-- Uses HERA-20141; SEO accept does not mutate products.name/description.

SELECT ensure_product_intelligence('HERA-20141');

INSERT INTO product_ai_artifacts (
  ref, artifact_type, version, payload, status, model, prompt_version, provider
)
VALUES (
  'HERA-20141',
  'seo',
  1,
  jsonb_build_object(
    'meta_title', 'Zuly bikini Hera Swimwear',
    'meta_description', 'Bikini Zuly de Hera Swimwear. Smoke test Product Intelligence.',
    'slug', 'zuly-bikini-hera',
    'keywords', jsonb_build_array('bikini', 'hera', 'zuly')
  ),
  'suggested',
  'smoke-test',
  'seo_v1',
  'openai'
)
RETURNING id;
