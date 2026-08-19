-- Dedupe IndexNow: 1 ping por REF de catálogo Hera cada 5 minutos.

create table if not exists public.indexnow_pings (
  product_ref text primary key,
  last_ping_at timestamptz not null default now(),
  last_status int,
  last_url text,
  updated_at timestamptz not null default now()
);

comment on table public.indexnow_pings is
  'Último ping IndexNow por products.ref (heraswimsuit.com/catalogo/?p=REF).';

alter table public.indexnow_pings enable row level security;
revoke all on public.indexnow_pings from anon, authenticated;
grant all on public.indexnow_pings to service_role;
