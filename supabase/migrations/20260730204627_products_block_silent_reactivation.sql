-- Un producto archivado no debe "revivir" por un sync externo.
-- `catalog-sync-product` hace upsert con active/visible del payload, así que
-- una app del catálogo o una pestaña vieja podía reactivarlo sin que nadie lo pidiera.
-- Reactivar exige pasar por reactivate_product().

create or replace function public.products_block_silent_reactivation()
returns trigger
language plpgsql
as $$
begin
  if old.active = false and new.active = true
     and coalesce(current_setting('app.allow_product_reactivation', true), '') <> 'on' then
    raise exception 'El artículo % está archivado: use reactivate_product() para volver a activarlo', old.ref
      using hint = 'Se archivó al eliminarlo para conservar su historial de ventas e inventario.';
  end if;
  return new;
end $$;

drop trigger if exists products_block_silent_reactivation_trg on public.products;

create trigger products_block_silent_reactivation_trg
  before update of active on public.products
  for each row execute function public.products_block_silent_reactivation();

create or replace function public.reactivate_product(p_product_id uuid, p_visible boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ref text;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'service_role') then
    raise exception 'reactivate_product: authentication required' using errcode = '42501';
  end if;

  select ref into v_ref from public.products where id = p_product_id for update;
  if v_ref is null then
    return jsonb_build_object('ok', false, 'message', 'Producto no existe');
  end if;

  perform set_config('app.allow_product_reactivation', 'on', true);

  update public.products
  set active = true,
      visible = coalesce(p_visible, false),
      updated_at = now()
  where id = p_product_id;

  perform set_config('app.allow_product_reactivation', '', true);

  return jsonb_build_object('ok', true, 'ref', v_ref, 'visible', coalesce(p_visible, false));
end $$;

revoke all on function public.reactivate_product(uuid, boolean) from public, anon;
grant execute on function public.reactivate_product(uuid, boolean) to authenticated, service_role;
