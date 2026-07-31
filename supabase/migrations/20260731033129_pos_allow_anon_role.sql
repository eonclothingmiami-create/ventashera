-- El ERP POS opera con la clave anon (sin login de usuario).
-- Las migraciones de hoy exigían authenticated/service_role y bloqueaban
-- todas las ventas: create_pos_sale_v2 fallaba antes de escribir nada.
-- Se restaura anon en las RPCs operativas del POS/caja.

do $$
declare
  r record;
  def text;
  old1 text;
  old2 text;
  new1 text;
  new2 text;
begin
  old1 := 'if coalesce(auth.role(),'''') not in (''authenticated'',''service_role'')';
  new1 := 'if coalesce(auth.role(),'''') not in (''anon'',''authenticated'',''service_role'')';
  old2 := 'if coalesce(auth.role(), '''') not in (''authenticated'', ''service_role'')';
  new2 := 'if coalesce(auth.role(), '''') not in (''anon'', ''authenticated'', ''service_role'')';

  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_pos_sale_v2',
        'create_pos_sale_v2_impl',
        'cancel_pos_sale_v2',
        'pay_manual_invoice_v1'
      )
  loop
    def := pg_get_functiondef(r.oid);
    if position(old1 in def) > 0 then
      def := replace(def, old1, new1);
    elsif position(old2 in def) > 0 then
      def := replace(def, old2, new2);
    else
      raise notice 'sin gate auth típico en %', r.proname;
      continue;
    end if;
    execute def;
    raise notice 'anon habilitado en %', r.proname;
  end loop;
end $$;

grant execute on function public.create_pos_sale_v2(jsonb) to anon, authenticated, service_role;
grant execute on function public.create_pos_sale_v2_impl(jsonb) to anon, authenticated, service_role;
grant execute on function public.cancel_pos_sale_v2(jsonb) to anon, authenticated, service_role;
grant execute on function public.pay_manual_invoice_v1(jsonb) to anon, authenticated, service_role;
