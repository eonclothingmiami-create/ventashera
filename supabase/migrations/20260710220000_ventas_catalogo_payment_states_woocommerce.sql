-- Estados de pago ampliados + canal WooCommerce + metadatos de transacción.

ALTER TABLE public.ventas_catalogo
  DROP CONSTRAINT IF EXISTS ventas_catalogo_estado_pago_check;

ALTER TABLE public.ventas_catalogo
  ADD CONSTRAINT ventas_catalogo_estado_pago_check
  CHECK (
    estado_pago = ANY (
      ARRAY[
        'pendiente',
        'pago_exitoso',
        'pago_fallido',
        'checkout_abandonado',
        'expirado',
        'cancelada'
      ]::text[]
    )
  );

ALTER TABLE public.ventas_catalogo
  DROP CONSTRAINT IF EXISTS ventas_catalogo_origen_check;

ALTER TABLE public.ventas_catalogo
  ADD CONSTRAINT ventas_catalogo_origen_check
  CHECK (
    origen_canal = ANY (
      ARRAY[
        'catalogo_web',
        'woocommerce',
        'mercadolibre',
        'falabella',
        'meta_commerce',
        'google_merchant',
        'pinterest',
        'dropi',
        'rappi',
        'instagram',
        'tiktok',
        'otro'
      ]::text[]
    )
  );

ALTER TABLE public.ventas_catalogo
  ADD COLUMN IF NOT EXISTS session_id text NULL,
  ADD COLUMN IF NOT EXISTS payment_status_raw text NULL,
  ADD COLUMN IF NOT EXISTS payment_updated_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_catalogo_reference
  ON public.ventas_catalogo (reference);

CREATE INDEX IF NOT EXISTS idx_ventas_catalogo_external_order
  ON public.ventas_catalogo (external_order_id)
  WHERE external_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_catalogo_estado_created
  ON public.ventas_catalogo (estado_pago, created_at DESC);

COMMENT ON COLUMN public.ventas_catalogo.session_id IS 'Sesión catálogo (catalog_cart_snapshots) al crear pedido.';
COMMENT ON COLUMN public.ventas_catalogo.payment_status_raw IS 'Estado crudo pasarela (Wompi/Addi/WC).';

-- Marca pedidos pendientes antiguos como checkout abandonado (cron o ERP).
CREATE OR REPLACE FUNCTION public.expire_stale_catalog_orders(p_hours int DEFAULT 24)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE public.ventas_catalogo
  SET
    estado_pago = 'checkout_abandonado',
    payment_updated_at = now(),
    updated_at = now(),
    tracking_meta = COALESCE(tracking_meta, '{}'::jsonb) || jsonb_build_object(
      'auto_abandoned_at', now(),
      'auto_abandoned_reason', format('pendiente > %s h', p_hours)
    )
  WHERE estado_pago = 'pendiente'
    AND created_at < now() - make_interval(hours => GREATEST(1, p_hours));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_catalog_orders(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_catalog_orders(int) TO service_role, authenticated;

-- ERP autenticado puede leer carritos abandonados (solo lectura).
DROP POLICY IF EXISTS catalog_cart_snapshots_read_auth ON public.catalog_cart_snapshots;
CREATE POLICY catalog_cart_snapshots_read_auth
  ON public.catalog_cart_snapshots FOR SELECT TO authenticated USING (true);
