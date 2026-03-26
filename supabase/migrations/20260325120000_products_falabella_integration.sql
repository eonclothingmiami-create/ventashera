-- Integración Falabella Seller Center: estado por producto y atributos opcionales (JSON).
-- Ejecutar en Supabase SQL Editor o con: supabase db push

alter table public.products
  add column if not exists falabella_seller_sku text,
  add column if not exists falabella_feed_request_id text,
  add column if not exists falabella_sync_status text,
  add column if not exists falabella_last_error text,
  add column if not exists falabella_last_sync_at timestamptz,
  add column if not exists falabella_primary_category_id text,
  add column if not exists falabella_product_data_json jsonb default '{}'::jsonb;

comment on column public.products.falabella_sync_status is 'null | pending | synced | error';
comment on column public.products.falabella_product_data_json is 'Atributos ProductData extra (FeedName -> valor), fusionados en falabella-sync-product';

create index if not exists products_falabella_sync_status_idx
  on public.products (falabella_sync_status)
  where falabella_sync_status is not null;
