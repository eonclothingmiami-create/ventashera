-- Referencia para alinear la tabla public.stock_moves con el ERP (venta POS).
-- Si la tabla ya existe, ajusta columnas / nombres y adapta pos-repository.js si hace falta.

-- Ejemplo de tabla compatible con el insert del ERP:
/*
create table if not exists public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  bodega_id text,
  cantidad integer not null,
  tipo text not null default 'venta_pos',
  referencia text,
  documento_id uuid,
  fecha date not null default (timezone('utc', now()))::date,
  nota text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_stock_moves_product on public.stock_moves (product_id);
create index if not exists idx_stock_moves_fecha on public.stock_moves (fecha desc);

alter table public.stock_moves enable row level security;
-- Policies según tu modelo (anon / authenticated).
*/
