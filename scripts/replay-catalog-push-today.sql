-- Reencolar push para productos visibles actualizados en un día (America/Bogota).
-- Ejecutar en Supabase SQL Editor, luego llamar catalog-push-dispatch.
-- Cambia la fecha si necesitas otro día:

-- INSERT ... (genera eventos pending)
INSERT INTO catalog_push_events (
  event_id, product_id, product_ref, event_type, status, title, body, link, payload, attempts, sent, invalid
)
SELECT
  'replay-20260707-' || substr(replace(p.id::text, '-', ''), 1, 8),
  p.id,
  p.ref,
  'media_added',
  'pending',
  '🔥 Nuevo en Hera — ¡te lo vas a querer!',
  format('%s acaba de llegar. Es de esos que se agotan rápido… ¿lo ves antes que se acabe?', coalesce(p.name, p.ref)),
  'https://eonclothingonline.com/mayoristas/',
  jsonb_build_object('replay', true, 'replay_date', '2026-07-07', 'product_ref', p.ref),
  0, 0, 0
FROM products p
WHERE p.visible = true
  AND (p.updated_at AT TIME ZONE 'America/Bogota')::date = DATE '2026-07-07'
ON CONFLICT (event_id) DO UPDATE SET
  status = 'pending',
  error = NULL,
  last_error = NULL,
  attempts = 0,
  sent = 0,
  invalid = 0,
  updated_at = now();

-- Verificar cola:
-- SELECT event_id, product_ref, status FROM catalog_push_events WHERE event_id LIKE 'replay-20260707-%';

-- Después ejecutar en terminal o Postman:
-- POST https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/catalog-push-dispatch
-- Body: {}
