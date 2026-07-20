-- Vista con nombres alineados al asesor (legacy_ref / current_ref).
CREATE OR REPLACE VIEW public.product_ref_aliases_v AS
SELECT
  upper(old_ref) AS legacy_ref,
  new_ref AS current_ref,
  product_id,
  created_at
FROM public.product_ref_aliases;

GRANT SELECT ON public.product_ref_aliases_v TO anon, authenticated;

-- Resuelve ref legacy → HERA-* (o ref directo si ya es canónico).
CREATE OR REPLACE FUNCTION public.resolve_product_ref(p_legacy text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT new_ref
      FROM public.product_ref_aliases
      WHERE upper(old_ref) = upper(trim(p_legacy))
      LIMIT 1
    ),
    (
      SELECT ref
      FROM public.products
      WHERE upper(ref) = upper(trim(p_legacy))
        AND COALESCE(active, true) = true
      LIMIT 1
    ),
    upper(trim(p_legacy))
  );
$$;

GRANT EXECUTE ON FUNCTION public.resolve_product_ref(text) TO anon, authenticated, service_role;
