-- Blindaje: no destruir historial de inventario al "borrar" un producto.
-- Si el artículo tuvo movimientos/ventas/compras → se archiva (active=false).
-- Solo se elimina de verdad si nunca tuvo historial operativo.

-- 1) stock_moves: CASCADE → RESTRICT (igual que inventory_reservations)
alter table public.stock_moves
  drop constraint if exists stock_moves_product_id_fkey;

alter table public.stock_moves
  add constraint stock_moves_product_id_fkey
  foreign key (product_id) references public.products(id)
  on delete restrict;

-- 2) delete_product_full: archivar si hay historial; borrar solo si está limpio
create or replace function public.delete_product_full(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ref text;
  v_has_history boolean := false;
begin
  select ref into v_ref
  from public.products
  where id = p_product_id
  for update;

  if v_ref is null then
    return jsonb_build_object('ok', false, 'action', 'missing', 'message', 'Producto no existe');
  end if;

  select exists (
    select 1 from public.stock_moves where product_id = p_product_id
    union all
    select 1 from public.sale_items where product_id = p_product_id::text
    union all
    select 1 from public.invoice_items where product_id = p_product_id
    union all
    select 1 from public.inv_ajustes where articulo_id = p_product_id
    union all
    select 1 from public.inv_traslados where articulo_id = p_product_id
    union all
    select 1 from public.remision_items where product_id = p_product_id
    union all
    select 1 from public.inventory_reservations where product_id = p_product_id
    union all
    select 1 from public.compra_items where articulo_id = p_product_id
  ) into v_has_history;

  if v_has_history then
    update public.products
    set
      active = false,
      visible = false,
      updated_at = now()
    where id = p_product_id;

    return jsonb_build_object(
      'ok', true,
      'action', 'archived',
      'ref', v_ref,
      'message', 'Artículo archivado: conserva historial de inventario y ventas'
    );
  end if;

  -- Sin historial: borrado real de accesorios + producto
  delete from public.product_views  where product_id = p_product_id;
  delete from public.product_colors where product_id = p_product_id;
  delete from public.product_sizes  where product_id = p_product_id;
  delete from public.product_media  where product_id = p_product_id;
  delete from public.product_color_media where product_id = p_product_id;
  delete from public.product_attributes where product_id = p_product_id;
  delete from public.product_ref_aliases where product_id = p_product_id;

  delete from public.products where id = p_product_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'deleted',
    'ref', v_ref,
    'message', 'Artículo eliminado (sin historial operativo)'
  );
end;
$function$;
