-- Estado despachado: pago recibido y pedido enviado.

ALTER TABLE public.ventas_catalogo
  DROP CONSTRAINT IF EXISTS ventas_catalogo_estado_pago_check;

ALTER TABLE public.ventas_catalogo
  ADD CONSTRAINT ventas_catalogo_estado_pago_check
  CHECK (
    estado_pago = ANY (
      ARRAY[
        'pendiente',
        'pago_exitoso',
        'despachado',
        'pago_fallido',
        'checkout_abandonado',
        'expirado',
        'cancelada'
      ]::text[]
    )
  );

COMMENT ON CONSTRAINT ventas_catalogo_estado_pago_check ON public.ventas_catalogo IS
  'pendiente → pago_exitoso → despachado (pagado y enviado).';

-- Pedidos ya marcados con envío OK pasan a despachado.
UPDATE public.ventas_catalogo
SET
  estado_pago = 'despachado',
  updated_at = now()
WHERE estado_pago = 'pago_exitoso'
  AND COALESCE(tracking_meta->>'despacho_revisado_at', '') <> '';
