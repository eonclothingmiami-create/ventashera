-- eBay V1: IDs de listing en products + tokens OAuth (espejo de ml_oauth_tokens).
-- El ERP no guarda App ID / Cert / refresh token en el navegador.

alter table public.products
  add column if not exists ebay_listing_id text,
  add column if not exists ebay_offer_id text,
  add column if not exists ebay_sku text,
  add column if not exists ebay_sync_status text,
  add column if not exists ebay_last_error text,
  add column if not exists ebay_last_sync_at timestamptz;

comment on column public.products.ebay_listing_id is 'listingId de eBay Inventory API (anuncio publicado).';
comment on column public.products.ebay_offer_id is 'offerId de eBay Inventory API.';
comment on column public.products.ebay_sku is 'SKU enviado a PUT /sell/inventory/v1/inventory_item/{sku}.';

create table if not exists public.ebay_oauth_tokens (
  id text primary key default 'default',
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.ebay_oauth_tokens enable row level security;
revoke all on public.ebay_oauth_tokens from anon, authenticated;
grant all on public.ebay_oauth_tokens to service_role;

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
        or nullif(meta_commerce_retailer_id, '') is not null
        or nullif(google_merchant_offer_id, '') is not null
        or nullif(pinterest_catalog_item_id, '') is not null
        or nullif(ebay_listing_id, '') is not null
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
