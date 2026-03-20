-- Extensión cajas: bodegas vinculadas + saldos por medio (JSON).
-- Ejecutar en Supabase SQL editor si aún no existen las columnas.

ALTER TABLE cajas ADD COLUMN IF NOT EXISTS bodega_ids jsonb DEFAULT '[]'::jsonb;
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS saldos_metodo jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN cajas.bodega_ids IS 'IDs de bodegas atendidas por esta caja; [] = todas';
COMMENT ON COLUMN cajas.saldos_metodo IS 'Saldos por bucket: efectivo, transferencia, addi, contraentrega, tarjeta, digital, otro';
COMMENT ON COLUMN cajas.saldo IS 'Compat: se sincroniza con saldos_metodo->efectivo desde la app';

-- Movimientos de tesorería: trazabilidad opcional
ALTER TABLE tes_movimientos ADD COLUMN IF NOT EXISTS categoria text;
ALTER TABLE tes_movimientos ADD COLUMN IF NOT EXISTS bucket text;

COMMENT ON COLUMN tes_movimientos.categoria IS 'Ej: gasto, abono_proveedor, venta_pos, nomina, otro';
COMMENT ON COLUMN tes_movimientos.bucket IS 'Bucket afectado: efectivo, transferencia, addi, contraentrega, …';
