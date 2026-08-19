-- Ventas por canal: orígenes Faire y eBay (ML ya existía).

alter table public.ventas_catalogo
  drop constraint if exists ventas_catalogo_origen_check;

alter table public.ventas_catalogo
  add constraint ventas_catalogo_origen_check
  check (
    origen_canal = any (
      array[
        'catalogo_web',
        'woocommerce',
        'mercadolibre',
        'falabella',
        'meta_commerce',
        'google_merchant',
        'pinterest',
        'dropi',
        'rappi',
        'instagram',
        'tiktok',
        'faire',
        'ebay',
        'otro'
      ]::text[]
    )
  );

comment on constraint ventas_catalogo_origen_check on public.ventas_catalogo is
  'Origen del pedido: catálogo, Woo, ML, Faire, eBay y otros canales.';
