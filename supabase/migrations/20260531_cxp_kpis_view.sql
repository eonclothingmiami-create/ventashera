-- CXP KPIs: vista canónica v_cxp_kpis (cabecera en 1 consulta).
-- Mantiene v_cxp_kpis_globales como alias legacy.

drop view if exists public.v_cxp_kpis_globales;
drop view if exists public.v_cxp_kpis;

create or replace view public.v_cxp_kpis
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

create or replace view public.v_cxp_kpis_globales
with (security_invoker = true) as
select * from public.v_cxp_kpis;

grant select on public.v_cxp_kpis to anon, authenticated, service_role;
grant select on public.v_cxp_kpis_globales to anon, authenticated, service_role;
