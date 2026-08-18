-- eBay strategy V1: tablas aisladas del catálogo ERP (solo canal eBay).
-- Prioriza productos por vistas, lotes derivados, cron mensual.

-- ---------------------------------------------------------------------------
-- Configuración global eBay (no toca products salvo columnas ebay_* existentes)
-- ---------------------------------------------------------------------------
create table if not exists public.ebay_publish_config (
  id text primary key default 'default',
  monthly_top_n int not null default 90
    check (monthly_top_n > 0 and monthly_top_n <= 500),
  lot_top_n int not null default 40
    check (lot_top_n >= 0 and lot_top_n <= 500),
  lot_size int not null default 12
    check (lot_size > 0 and lot_size <= 999),
  wholesale_discount_pct numeric(5, 2) not null default 15
    check (wholesale_discount_pct >= 0 and wholesale_discount_pct < 100),
  best_offer_enabled boolean not null default true,
  auto_sync_enabled boolean not null default true,
  cron_secret text not null default encode(gen_random_bytes(24), 'hex'),
  edge_invoke_bearer text,
  sync_state jsonb,
  last_monthly_run_at timestamptz,
  last_monthly_run_summary jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.ebay_publish_config is
  'Parámetros de publicación automática eBay (vistas, lotes, Best Offer). Aislado del catálogo ERP.';

insert into public.ebay_publish_config (id)
values ('default')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Listings derivados eBay (lotes mayoristas) — NO son filas en products
-- ---------------------------------------------------------------------------
create table if not exists public.ebay_derived_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  listing_kind text not null default 'lot'
    check (listing_kind in ('lot')),
  lot_size int not null default 12 check (lot_size > 0),
  sku text not null,
  ebay_offer_id text,
  ebay_listing_id text,
  ebay_sync_status text,
  ebay_last_error text,
  ebay_last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, listing_kind, lot_size),
  unique (sku)
);

create index if not exists ebay_derived_listings_product_id_idx
  on public.ebay_derived_listings (product_id);

create index if not exists ebay_derived_listings_listing_id_idx
  on public.ebay_derived_listings (ebay_listing_id)
  where ebay_listing_id is not null and ebay_listing_id <> '';

comment on table public.ebay_derived_listings is
  'Anuncios eBay derivados (lotes mayoristas). Metadatos solo eBay; el producto base vive en products.';

-- ---------------------------------------------------------------------------
-- Ranking por vistas (solo lectura para Edge / cron)
-- ---------------------------------------------------------------------------
create or replace function public.ebay_top_viewed_products(p_limit int default 100)
returns table (
  product_id uuid,
  product_ref text,
  view_count int,
  stock int,
  rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.ref,
    coalesce(pv.view_count, 0)::int,
    coalesce(p.stock, 0)::int,
    row_number() over (
      order by coalesce(pv.view_count, 0) desc nulls last, p.ref asc nulls last
    ) as rank
  from public.products p
  left join public.product_views pv on pv.product_id = p.id
  where coalesce(p.active, false) = true
    and coalesce(p.stock, 0) > 0
  order by coalesce(pv.view_count, 0) desc nulls last, p.ref asc nulls last
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.ebay_top_viewed_products(int) from public;
grant execute on function public.ebay_top_viewed_products(int) to service_role;

-- ---------------------------------------------------------------------------
-- RLS: tablas eBay solo service_role (Edge Functions)
-- ---------------------------------------------------------------------------
alter table public.ebay_publish_config enable row level security;
alter table public.ebay_derived_listings enable row level security;

revoke all on public.ebay_publish_config from anon, authenticated;
revoke all on public.ebay_derived_listings from anon, authenticated;
grant all on public.ebay_publish_config to service_role;
grant all on public.ebay_derived_listings to service_role;

-- ---------------------------------------------------------------------------
-- Cron mensual (día 1, 08:00 UTC ≈ 03:00 Bogotá)
-- Requiere pg_cron + pg_net habilitados en el proyecto Supabase.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.ebay_trigger_monthly_sync()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_enabled boolean;
  v_url text := 'https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/ebay-sync-product';
  v_request_id bigint;
begin
  select cron_secret, auto_sync_enabled
  into v_secret, v_enabled
  from public.ebay_publish_config
  where id = 'default';

  if not coalesce(v_enabled, false) then
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'monthly_sync',
      'cronSecret', v_secret
    )
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.ebay_trigger_monthly_sync() from public;
grant execute on function public.ebay_trigger_monthly_sync() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'ebay-monthly-sync';

    perform cron.schedule(
      'ebay-monthly-sync',
      '0 8 1 * *',
      $cron$select public.ebay_trigger_monthly_sync();$cron$
    );
  end if;
exception
  when others then
    raise notice 'ebay-monthly-sync cron not scheduled: %', sqlerrm;
end;
$$;
