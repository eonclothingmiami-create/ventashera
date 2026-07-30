-- Un producto publicado externamente se archiva siempre, aunque todavía no tenga
-- movimientos. Así permanece disponible para que las Edge Functions den de baja
-- la publicación después de que el ERP marque active=false.

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
    union all
    select 1
    from public.products
    where id = p_product_id
      and (
        woocommerce_product_id is not null
        or nullif(mercadolibre_item_id, '') is not null
        or nullif(falabella_seller_sku, '') is not null
        or nullif(meta_commerce_retailer_id, '') is not null
        or nullif(google_merchant_offer_id, '') is not null
        or nullif(pinterest_catalog_item_id, '') is not null
      )
  ) into v_has_history;

  if v_has_history then
    update public.products
    set active = false, visible = false, updated_at = now()
    where id = p_product_id;

    return jsonb_build_object(
      'ok', true,
      'action', 'archived',
      'ref', v_ref,
      'message', 'Artículo archivado: conserva historial y referencias de canales'
    );
  end if;

  delete from public.product_views where product_id = p_product_id;
  delete from public.product_colors where product_id = p_product_id;
  delete from public.product_sizes where product_id = p_product_id;
  delete from public.product_media where product_id = p_product_id;
  delete from public.product_color_media where product_id = p_product_id;
  delete from public.product_attributes where product_id = p_product_id;
  delete from public.product_ref_aliases where product_id = p_product_id;
  delete from public.products where id = p_product_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'deleted',
    'ref', v_ref,
    'message', 'Artículo eliminado (sin historial operativo ni publicaciones)'
  );
end;
$function$;
