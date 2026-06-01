-- CXP Proveedores views v2 — canonical SQL (mirror of sql/cxp_proveedores_views.sql)
-- Replaces v1 column names with proveedor_id, saldo_0_30…, estado_relacion, etc.
-- Adds v_cxp_kpis_globales for module header KPIs.

drop view if exists public.v_cxp_kpis_globales;
drop view if exists public.v_cxp_proveedores_resumen;
drop view if exists public.v_cxp_aging_cargos;

create or replace view public.v_cxp_aging_cargos
with (security_invoker = true) as
with apl as (
  select movimiento_cargo_id, sum(monto_aplicado) as aplicado
  from public.proveedor_abono_aplicaciones
  where estado = 'active' or estado is null
  group by movimiento_cargo_id
)
select
  c.id as cargo_id,
  c.proveedor_id,
  c.proveedor_nombre,
  c.compra_id,
  c.referencia,
  c.fecha as fecha_cargo,
  c.monto as monto_cargo,
  coalesce(a.aplicado, 0) as abonado_al_cargo,
  (c.monto - coalesce(a.aplicado, 0)) as saldo_cargo,
  (current_date - c.fecha) as dias_antiguedad,
  case
    when current_date - c.fecha <= 30 then '0-30'
    when current_date - c.fecha <= 60 then '31-60'
    when current_date - c.fecha <= 90 then '61-90'
    else '90+'
  end as bucket
from public.proveedor_cxp_movimientos c
left join apl a on a.movimiento_cargo_id = c.id
where c.naturaleza = 'cargo'
  and c.estado = 'active'
  and (c.monto - coalesce(a.aplicado, 0)) > 0;

create or replace view public.v_cxp_proveedores_resumen
with (security_invoker = true) as
with mov as (
  select proveedor_id,
    sum(case when naturaleza = 'cargo' then monto else -monto end) filter (where estado = 'active') as saldo,
    sum(monto) filter (where naturaleza = 'cargo' and estado = 'active') as total_cargos,
    sum(monto) filter (where naturaleza = 'credito' and estado = 'active') as total_creditos,
    sum(monto) filter (where tipo = 'nota_credito' and estado = 'active') as total_notas_credito,
    sum(monto) filter (where tipo = 'devolucion' and estado = 'active') as total_devoluciones,
    min(fecha) filter (where naturaleza = 'cargo' and estado = 'active') as primer_cargo,
    max(fecha) filter (where naturaleza = 'cargo' and estado = 'active') as ultimo_cargo,
    count(*) filter (where naturaleza = 'cargo' and estado = 'active') as n_cargos
  from public.proveedor_cxp_movimientos
  group by proveedor_id
),
ab as (
  select proveedor_id,
    max(fecha) as ultimo_abono,
    sum(monto) as total_abonado,
    count(*) as n_abonos,
    mode() within group (order by metodo) as metodo_frecuente
  from public.proveedor_abonos
  where estado = 'active'
  group by proveedor_id
),
aging as (
  select proveedor_id,
    sum(saldo_cargo) as saldo_cargos_abiertos,
    sum(saldo_cargo) filter (where bucket = '0-30') as saldo_0_30,
    sum(saldo_cargo) filter (where bucket = '31-60') as saldo_31_60,
    sum(saldo_cargo) filter (where bucket = '61-90') as saldo_61_90,
    sum(saldo_cargo) filter (where bucket = '90+') as saldo_90_mas,
    count(*) as n_cargos_abiertos,
    max(dias_antiguedad) as antiguedad_deuda_dias
  from public.v_cxp_aging_cargos
  group by proveedor_id
),
dso as (
  select c.proveedor_id,
    round(sum((ap.created_at::date - c.fecha) * ap.monto_aplicado) / nullif(sum(ap.monto_aplicado), 0), 1) as dso_dias
  from public.proveedor_abono_aplicaciones ap
  join public.proveedor_cxp_movimientos c on c.id = ap.movimiento_cargo_id
  where ap.estado = 'active' or ap.estado is null
  group by c.proveedor_id
)
select
  p.id as proveedor_id,
  p.nombre,
  p.ciudad,
  p.whatsapp,
  p.celular,
  p.email,
  p.banco,
  p.cuenta_bancaria,
  p.contacto,
  coalesce(mov.saldo, 0) as saldo,
  coalesce(mov.total_cargos, 0) as total_cargos,
  coalesce(ab.total_abonado, 0) as total_abonado,
  coalesce(mov.total_notas_credito, 0) as total_notas_credito,
  coalesce(mov.total_devoluciones, 0) as total_devoluciones,
  greatest(coalesce(aging.saldo_cargos_abiertos, 0) - coalesce(mov.saldo, 0), 0) as creditos_sin_aplicar,
  coalesce(mov.n_cargos, 0) as n_cargos,
  coalesce(aging.n_cargos_abiertos, 0) as n_cargos_abiertos,
  coalesce(ab.n_abonos, 0) as n_abonos,
  mov.primer_cargo,
  mov.ultimo_cargo,
  ab.ultimo_abono,
  (current_date - mov.ultimo_cargo) as dias_desde_ultimo_cargo,
  (current_date - ab.ultimo_abono) as dias_desde_ultimo_abono,
  coalesce(aging.antiguedad_deuda_dias, 0) as antiguedad_deuda_dias,
  coalesce(aging.saldo_0_30, 0) as saldo_0_30,
  coalesce(aging.saldo_31_60, 0) as saldo_31_60,
  coalesce(aging.saldo_61_90, 0) as saldo_61_90,
  coalesce(aging.saldo_90_mas, 0) as saldo_90_mas,
  dso.dso_dias,
  ab.metodo_frecuente,
  case
    when coalesce(mov.saldo, 0) < 0 then 'a_favor'
    when coalesce(mov.saldo, 0) = 0 then 'al_dia'
    else 'con_deuda'
  end as estado_relacion,
  case
    when coalesce(mov.saldo, 0) <= 0 then 'sano'
    when coalesce(aging.antiguedad_deuda_dias, 0) <= 30 then 'verde'
    when coalesce(aging.antiguedad_deuda_dias, 0) <= 60 then 'ambar'
    else 'rojo'
  end as riesgo
from public.proveedores p
left join mov on mov.proveedor_id = p.id
left join ab on ab.proveedor_id = p.id
left join aging on aging.proveedor_id = p.id
left join dso on dso.proveedor_id = p.id;

create or replace view public.v_cxp_kpis_globales
with (security_invoker = true) as
select
  coalesce((select sum(monto) from public.proveedor_abonos where estado = 'active' and fecha >= date_trunc('month', current_date)::date), 0) as abonos_mes,
  coalesce((select sum(saldo) from public.v_cxp_proveedores_resumen where saldo > 0), 0) as cxp_total,
  coalesce((select count(*) from public.v_cxp_proveedores_resumen where saldo > 0), 0)::int as proveedores_con_deuda,
  coalesce((select count(*) from public.v_cxp_proveedores_resumen where estado_relacion = 'al_dia'), 0)::int as proveedores_al_dia,
  coalesce((select count(*) from public.v_cxp_proveedores_resumen where estado_relacion = 'a_favor'), 0)::int as proveedores_a_favor,
  coalesce((select sum(saldo_0_30) from public.v_cxp_proveedores_resumen), 0) as aging_0_30,
  coalesce((select sum(saldo_31_60) from public.v_cxp_proveedores_resumen), 0) as aging_31_60,
  coalesce((select sum(saldo_61_90) from public.v_cxp_proveedores_resumen), 0) as aging_61_90,
  coalesce((select sum(saldo_90_mas) from public.v_cxp_proveedores_resumen), 0) as aging_90_mas;

grant select on public.v_cxp_aging_cargos to anon, authenticated, service_role;
grant select on public.v_cxp_proveedores_resumen to anon, authenticated, service_role;
grant select on public.v_cxp_kpis_globales to anon, authenticated, service_role;
