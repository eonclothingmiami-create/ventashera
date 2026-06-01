-- ============================================================================
-- CXP Proveedores — capa de SOLO LECTURA para el panel ejecutivo de Cuentas por
-- Pagar. NO persiste saldos (siempre se calculan). NO toca lógica de
-- compra_guardar_v1 / abono_aplicar_v1 ni datos existentes.
--
-- Fuente de verdad del saldo (por proveedor):
--   saldo = Σ(monto) FILTER (naturaleza='cargo'   AND estado='active')
--         − Σ(monto) FILTER (naturaleza='credito' AND estado='active')
--
-- Zona horaria de negocio: Colombia (America/Bogota, UTC-5) para "días" y "mes".
-- Se excluyen SIEMPRE los movimientos con estado <> 'active'.
--
-- security_invoker = true  -> las vistas respetan la RLS del rol que consulta
-- (igual que leer las tablas base directamente).
-- ============================================================================

-- Idempotente: reemplaza versiones previas (permite reordenar/renombrar columnas).
drop view if exists public.v_cxp_proveedores_resumen;
drop view if exists public.v_cxp_aging_cargos;

-- ---------------------------------------------------------------------------
-- VISTA 1: una fila por CARGO ABIERTO (con saldo pendiente y antigüedad/bucket).
-- saldo_cargo = cargo.monto − Σ(aplicaciones FIFO del cargo).
-- ---------------------------------------------------------------------------
create or replace view public.v_cxp_aging_cargos
with (security_invoker = true) as
with apl as (
  select movimiento_cargo_id, sum(monto_aplicado) as aplicado
  from public.proveedor_abono_aplicaciones
  where estado = 'active' or estado is null
  group by movimiento_cargo_id
)
select
  c.id                                   as cargo_id,
  c.proveedor_id,
  c.proveedor_nombre,
  c.compra_id,
  c.referencia,
  c.fecha                                as fecha_cargo,
  c.created_at                           as created_cargo,
  c.monto                                as monto_cargo,
  coalesce(a.aplicado, 0)                as aplicado,
  (c.monto - coalesce(a.aplicado, 0))    as saldo_cargo,
  ((now() at time zone 'America/Bogota')::date - c.fecha) as dias_antiguedad,
  case
    when ((now() at time zone 'America/Bogota')::date - c.fecha) <= 30 then '0-30'
    when ((now() at time zone 'America/Bogota')::date - c.fecha) <= 60 then '31-60'
    when ((now() at time zone 'America/Bogota')::date - c.fecha) <= 90 then '61-90'
    else '90+'
  end                                    as bucket
from public.proveedor_cxp_movimientos c
left join apl a on a.movimiento_cargo_id = c.id
where c.naturaleza = 'cargo'
  and c.estado = 'active'
  and (c.monto - coalesce(a.aplicado, 0)) > 0
order by c.proveedor_nombre, c.fecha;

-- ---------------------------------------------------------------------------
-- VISTA 2: una fila por PROVEEDOR (resumen contable consolidado).
-- Incluye TODOS los proveedores (aunque no tengan movimientos -> saldo 0).
--
-- Reconciliación de créditos sin aplicar:
--   monto_pendiente (Σ cargos abiertos) − saldo_neto = créditos_sin_aplicar
--   (notas/devoluciones/abonos no ligados a un cargo específico).
--
-- Semáforo de riesgo (documentado):
--   sin_deuda : saldo <= 0 (al día o a favor)
--   rojo      : hay saldo en cubetas 61-90 o 90+ (deuda envejecida; sin abonos
--               recientes el cargo migra naturalmente a estas cubetas)
--   ambar     : hay saldo en cubeta 31-60
--   verde     : deuda joven (toda en 0-30)
-- ---------------------------------------------------------------------------
create or replace view public.v_cxp_proveedores_resumen
with (security_invoker = true) as
with mov as (
  select proveedor_id,
    sum(case when naturaleza = 'cargo' then monto else -monto end)
        filter (where estado = 'active')                              as saldo,
    sum(monto) filter (where naturaleza = 'cargo'   and estado = 'active') as total_cargos,
    sum(monto) filter (where naturaleza = 'credito' and estado = 'active') as total_creditos,
    sum(monto) filter (where naturaleza = 'credito' and estado = 'active'
                         and tipo ilike '%devol%')                     as total_devoluciones,
    max(fecha) filter (where naturaleza = 'cargo' and estado = 'active') as ult_cargo,
    min(fecha) filter (where naturaleza = 'cargo' and estado = 'active') as primer_cargo,
    count(*)   filter (where naturaleza = 'cargo' and estado = 'active') as n_cargos
  from public.proveedor_cxp_movimientos
  group by proveedor_id
),
ab as (
  select proveedor_id,
    max(fecha)  as ult_abono,
    sum(monto)  as total_abonado,
    count(*)    as n_abonos,
    mode() within group (order by metodo) as metodo_freq
  from public.proveedor_abonos
  where estado = 'active'
  group by proveedor_id
),
nc as (
  select proveedor_id,
    sum(monto) as total_notas_credito,
    count(*)   as n_notas
  from public.proveedor_notas_credito
  where estado = 'active'
  group by proveedor_id
),
aging as (
  select proveedor_id,
    count(*)        as n_cargos_abiertos,
    sum(saldo_cargo) as monto_pendiente,
    min(fecha_cargo) as cargo_abierto_mas_antiguo,
    sum(saldo_cargo) filter (where bucket = '0-30')  as aging_0_30,
    sum(saldo_cargo) filter (where bucket = '31-60') as aging_31_60,
    sum(saldo_cargo) filter (where bucket = '61-90') as aging_61_90,
    sum(saldo_cargo) filter (where bucket = '90+')   as aging_90_mas
  from public.v_cxp_aging_cargos
  group by proveedor_id
),
dso as (
  -- DSO: promedio ponderado por monto_aplicado de (aplicacion - cargo) en días.
  select c.proveedor_id,
    sum(ap.monto_aplicado * (ap.created_at::date - c.created_at::date))
      / nullif(sum(ap.monto_aplicado), 0) as dso_dias
  from public.proveedor_abono_aplicaciones ap
  join public.proveedor_cxp_movimientos c on c.id = ap.movimiento_cargo_id
  where (ap.estado = 'active' or ap.estado is null)
  group by c.proveedor_id
)
select
  p.id,
  p.nombre,
  p.banco,
  p.cuenta_bancaria,
  p.ciudad,
  p.departamento,
  p.whatsapp,
  p.celular,
  p.contacto,
  p.email,
  coalesce(m.saldo, 0)                as saldo,
  coalesce(m.total_cargos, 0)         as total_cargos,
  coalesce(m.total_creditos, 0)       as total_creditos,
  coalesce(m.total_devoluciones, 0)   as total_devoluciones,
  coalesce(ab.total_abonado, 0)       as total_abonado,
  coalesce(nc.total_notas_credito, 0) as total_notas_credito,
  coalesce(m.n_cargos, 0)             as n_cargos,
  coalesce(ag.n_cargos_abiertos, 0)   as n_cargos_abiertos,
  coalesce(ag.monto_pendiente, 0)     as monto_pendiente,
  coalesce(ab.n_abonos, 0)            as n_abonos,
  coalesce(nc.n_notas, 0)             as n_notas,
  m.primer_cargo,
  m.ult_cargo,
  ab.ult_abono,
  ag.cargo_abierto_mas_antiguo,
  ((now() at time zone 'America/Bogota')::date - m.ult_cargo)               as dias_desde_ult_cargo,
  ((now() at time zone 'America/Bogota')::date - ab.ult_abono)              as dias_desde_ult_abono,
  ((now() at time zone 'America/Bogota')::date - ag.cargo_abierto_mas_antiguo) as antiguedad_deuda,
  coalesce(ag.aging_0_30, 0)          as aging_0_30,
  coalesce(ag.aging_31_60, 0)         as aging_31_60,
  coalesce(ag.aging_61_90, 0)         as aging_61_90,
  coalesce(ag.aging_90_mas, 0)        as aging_90_mas,
  (coalesce(ag.monto_pendiente, 0) - coalesce(m.saldo, 0)) as creditos_sin_aplicar,
  ab.metodo_freq,
  round(dso.dso_dias, 1)              as dso_dias,
  case
    when coalesce(m.saldo, 0) <= 0 then 'sin_deuda'
    when coalesce(ag.aging_61_90, 0) + coalesce(ag.aging_90_mas, 0) > 0 then 'rojo'
    when coalesce(ag.aging_31_60, 0) > 0 then 'ambar'
    else 'verde'
  end                                 as riesgo
from public.proveedores p
left join mov   m  on m.proveedor_id  = p.id
left join ab       on ab.proveedor_id = p.id
left join nc       on nc.proveedor_id = p.id
left join aging ag on ag.proveedor_id = p.id
left join dso      on dso.proveedor_id = p.id;

grant select on public.v_cxp_aging_cargos       to anon, authenticated, service_role;
grant select on public.v_cxp_proveedores_resumen to anon, authenticated, service_role;
