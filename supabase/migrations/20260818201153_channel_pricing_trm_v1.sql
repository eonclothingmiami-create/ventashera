-- Precio unitario normal + envío USA + TRM live (fallback en cop_per_usd / env).

alter table public.ebay_publish_config
  add column if not exists retail_markup_cop numeric(12, 2) not null default 15000
    check (retail_markup_cop >= 0),
  add column if not exists shipping_cop_per_kg_us numeric(12, 2) not null default 250000
    check (shipping_cop_per_kg_us >= 0),
  add column if not exists units_per_kg int not null default 12
    check (units_per_kg > 0 and units_per_kg <= 999),
  add column if not exists trm_fallback numeric(10, 2) not null default 4000
    check (trm_fallback > 0);

comment on column public.ebay_publish_config.retail_markup_cop is
  'Markup público sobre products.price (unitario). Default +15000 COP.';
comment on column public.ebay_publish_config.shipping_cop_per_kg_us is
  'Costo envío 1 kg CO→USA en COP (12 trajes ≈ 1 kg).';
comment on column public.ebay_publish_config.trm_fallback is
  'TRM fallback si falla API FX (no es el valor fijo de sync).';

alter table public.faire_publish_config
  add column if not exists shipping_cop_per_kg_us numeric(12, 2) not null default 250000
    check (shipping_cop_per_kg_us >= 0),
  add column if not exists units_per_kg int not null default 12
    check (units_per_kg > 0 and units_per_kg <= 999);

comment on column public.faire_publish_config.cop_per_usd is
  'TRM fallback si falla API FX en tiempo real.';
comment on column public.faire_publish_config.shipping_cop_per_kg_us is
  'Costo envío 1 kg CO→USA en COP; se prorratea por unidad (÷ units_per_kg).';
