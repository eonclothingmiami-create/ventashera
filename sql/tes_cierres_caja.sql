-- Cierres de caja (arqueo) + sesión activa + arrastre a la siguiente apertura.
-- Ejecutar en Supabase si usas sincronización de cajas.

ALTER TABLE cajas ADD COLUMN IF NOT EXISTS sesion_activa_id uuid;
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS proxima_apertura_saldos jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN cajas.sesion_activa_id IS 'ID de turno/sesión actual (movimientos lo referencian); null si caja cerrada';
COMMENT ON COLUMN cajas.proxima_apertura_saldos IS 'Saldos sugeridos al abrir (efectivo, transferencia, …) tras el último cierre';

ALTER TABLE tes_movimientos ADD COLUMN IF NOT EXISTS sesion_id uuid;

COMMENT ON COLUMN tes_movimientos.sesion_id IS 'Sesión de caja a la que pertenece el movimiento';

CREATE TABLE IF NOT EXISTS tes_cierres_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caja_id uuid NOT NULL,
  caja_nombre text,
  fecha_cierre date NOT NULL DEFAULT (CURRENT_DATE),
  libro_efectivo numeric NOT NULL DEFAULT 0,
  libro_transferencia numeric NOT NULL DEFAULT 0,
  contado_efectivo numeric NOT NULL DEFAULT 0,
  declarado_bancos numeric NOT NULL DEFAULT 0,
  dif_efectivo numeric NOT NULL DEFAULT 0,
  dif_transferencia numeric NOT NULL DEFAULT 0,
  resultado_efectivo text,
  nota text,
  saldos_libro_json jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tes_cierres_caja_caja ON tes_cierres_caja (caja_id);
CREATE INDEX IF NOT EXISTS idx_tes_movimientos_sesion ON tes_movimientos (sesion_id);
