-- Cotización / OV / Prefactura usan create_commercial_document_v1 con la clave anon
-- del ERP (igual que POS). El gate autenticado bloqueaba el flujo comercial.

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
        'create_commercial_document_v1',
        'transition_commercial_document_v1',
        'confirm_sales_order_v1'
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

grant execute on function public.create_commercial_document_v1(jsonb) to anon, authenticated, service_role;
grant execute on function public.transition_commercial_document_v1(uuid, text) to anon, authenticated, service_role;
grant execute on function public.confirm_sales_order_v1(uuid) to anon, authenticated, service_role;
