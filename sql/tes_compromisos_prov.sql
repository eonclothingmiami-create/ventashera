-- Libro de compromisos con proveedor (ingresos de mercancía a crédito reconocidos).
-- El saldo oficial en la app = SUM(compromisos) − SUM(abonos tes_abonos_prov).
-- Ejecutar en Supabase → SQL Editor.

create table if not exists public.tes_compromisos_prov (
  id uuid primary key default gen_random_uuid(),
  proveedor_id text not null,
  proveedor_nombre text,
  valor numeric not null default 0,
  fecha date not null default (timezone('utc', now()))::date,
  nota text,
  referencia text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_tes_compromisos_prov_proveedor
  on public.tes_compromisos_prov (proveedor_id);

alter table public.tes_compromisos_prov enable row level security;

-- Ajusta políticas a tu modelo (ejemplo autenticados):
-- create policy "tes_compromisos_prov_all" on public.tes_compromisos_prov
--   for all to authenticated using (true) with check (true);
