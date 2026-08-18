-- Faire wholesale — integración aislada (API propia, sin columnas en products).
-- Auth: FAIRE_ACCESS_TOKEN en secrets Edge + opcional espejo en faire_auth.

create table if not exists public.faire_publish_config (
  id text primary key default 'default',
  moq int not null default 12 check (moq > 0 and moq <= 999),
  cop_per_usd numeric(10, 2) not null default 4000 check (cop_per_usd > 0),
  retail_markup_cop numeric(12, 2) not null default 15000 check (retail_markup_cop >= 0),
  default_taxonomy_type_id text,
  made_in_country text not null default 'COL',
  auto_sync_enabled boolean not null default true,
  cron_secret text not null default encode(gen_random_bytes(24), 'hex'),
  last_inventory_sync_at timestamptz,
  last_order_pull_at timestamptz,
  last_order_id text,
  sync_state jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.faire_publish_config is
  'Parámetros Faire wholesale (MOQ, FX, taxonomía). Canal aislado del catálogo ERP.';

insert into public.faire_publish_config (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.faire_auth (
  id text primary key default 'default',
  access_token text,
  application_id text,
  application_secret text,
  auth_mode text not null default 'api_key'
    check (auth_mode in ('api_key', 'oauth')),
  updated_at timestamptz not null default now()
);

comment on table public.faire_auth is
  'Espejo opcional de credenciales Faire. Preferir secrets Deno (FAIRE_ACCESS_TOKEN).';

insert into public.faire_auth (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.faire_product_map (
  product_id uuid primary key references public.products (id) on delete cascade,
  faire_product_id text,
  variant_map jsonb not null default '{}'::jsonb,
  sync_status text,
  last_error text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faire_product_map_faire_product_id_idx
  on public.faire_product_map (faire_product_id)
  where faire_product_id is not null and faire_product_id <> '';

comment on table public.faire_product_map is
  'Mapeo ERP product_id ↔ Faire product/variants. No modifica products.';

create table if not exists public.faire_orders (
  id uuid primary key default gen_random_uuid(),
  faire_order_id text not null unique,
  state text,
  retailer_name text,
  payload jsonb not null default '{}'::jsonb,
  erp_document_id uuid,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faire_orders_state_idx on public.faire_orders (state);

comment on table public.faire_orders is
  'Pedidos importados desde Faire External API v2 (staging antes de OV ERP).';

alter table public.faire_publish_config enable row level security;
alter table public.faire_auth enable row level security;
alter table public.faire_product_map enable row level security;
alter table public.faire_orders enable row level security;

revoke all on public.faire_publish_config from anon, authenticated;
revoke all on public.faire_auth from anon, authenticated;
revoke all on public.faire_product_map from anon, authenticated;
revoke all on public.faire_orders from anon, authenticated;

grant all on public.faire_publish_config to service_role;
grant all on public.faire_auth to service_role;
grant all on public.faire_product_map to service_role;
grant all on public.faire_orders to service_role;

-- Archivar productos publicados en Faire (no borrar si hay mapa activo).
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
    union all
    select 1
    from public.faire_product_map fpm
    where fpm.product_id = p_product_id
      and nullif(fpm.faire_product_id, '') is not null
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
  delete from public.faire_product_map where product_id = p_product_id;
  delete from public.products where id = p_product_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'deleted',
    'ref', v_ref,
    'message', 'Artículo eliminado (sin historial operativo ni publicaciones)'
  );
end;
$function$;

-- Cron: inventario cada 4 h + pedidos cada 30 min (si auto_sync_enabled).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.faire_trigger_sync(p_action text default 'sync_inventory')
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_enabled boolean;
  v_url text := 'https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/faire-sync';
  v_request_id bigint;
begin
  select cron_secret, auto_sync_enabled
  into v_secret, v_enabled
  from public.faire_publish_config
  where id = 'default';

  if not coalesce(v_enabled, false) then
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', p_action,
      'cronSecret', v_secret
    )
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.faire_trigger_sync(text) from public;
grant execute on function public.faire_trigger_sync(text) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in ('faire-inventory-sync', 'faire-order-pull');

    perform cron.schedule(
      'faire-inventory-sync',
      '0 */4 * * *',
      $cron$select public.faire_trigger_sync('sync_inventory');$cron$
    );

    perform cron.schedule(
      'faire-order-pull',
      '*/30 * * * *',
      $cron$select public.faire_trigger_sync('pull_orders');$cron$
    );
  end if;
exception
  when others then
    raise notice 'faire cron not scheduled: %', sqlerrm;
end;
$$;
