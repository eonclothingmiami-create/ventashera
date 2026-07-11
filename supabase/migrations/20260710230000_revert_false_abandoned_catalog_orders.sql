-- Revierte pedidos marcados automáticamente como checkout_abandonado sin confirmación de pasarela.
UPDATE public.ventas_catalogo
SET
  estado_pago = 'pendiente',
  payment_updated_at = now(),
  updated_at = now(),
  tracking_meta = COALESCE(tracking_meta, '{}'::jsonb)
    - 'auto_abandoned_at'
    - 'auto_abandoned_reason'
    || jsonb_build_object(
      'reverted_auto_abandon_at', now(),
      'reverted_auto_abandon_reason', 'sin payment_status_raw; requiere reconciliación pasarela'
    )
WHERE estado_pago = 'checkout_abandonado'
  AND tracking_meta->>'auto_abandoned_at' IS NOT NULL
  AND payment_status_raw IS NULL;

-- Ventana por defecto: 7 días (antes 24 h) para no marcar abandonados prematuramente.
CREATE OR REPLACE FUNCTION public.expire_stale_catalog_orders(p_hours int DEFAULT 168)
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
    AND created_at < now() - make_interval(hours => GREATEST(1, p_hours))
    AND payment_status_raw IS NULL
    AND proveedor_ref IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
