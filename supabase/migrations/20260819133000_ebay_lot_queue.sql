-- Cola eBay mayorista: encola solo altas de lote x12 sin listing activo.

comment on table public.channel_publish_queue is
  'Cola de publicación eBay (lotes mayoristas). Updates de lotes ya listados van directo al guardar.';

comment on function public.enqueue_channel_sync(uuid, text[]) is
  'Encola publicación de lote eBay si stock >= lot_size y no hay listing activo. Idempotente.';

create or replace function public.enqueue_channel_sync(
  p_product_id uuid,
  p_channels text[] default array['ebay']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active boolean;
  v_stock int;
  v_lot_size int;
  v_ch text;
  v_enqueued int := 0;
  v_reset int := 0;
  v_touch int := 0;
  v_has_live_lot boolean;
begin
  if p_product_id is null then
    return jsonb_build_object('ok', false, 'error', 'product_id_required');
  end if;

  select coalesce(lot_size, 12)
  into v_lot_size
  from public.ebay_publish_config
  where id = 'default';

  if v_lot_size is null or v_lot_size < 1 then
    v_lot_size := 12;
  end if;

  select coalesce(active, false), coalesce(stock, 0)::int
  into v_active, v_stock
  from public.products
  where id = p_product_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  if not v_active or v_stock < v_lot_size then
    return jsonb_build_object(
      'ok', true,
      'enqueued', 0,
      'skipped', true,
      'reason', case
        when not v_active then 'inactive'
        else 'insufficient_stock_for_lot'
      end
    );
  end if;

  select exists (
    select 1
    from public.ebay_derived_listings d
    where d.product_id = p_product_id
      and d.listing_kind = 'lot'
      and coalesce(d.ebay_listing_id, '') <> ''
  )
  into v_has_live_lot;

  if v_has_live_lot then
    return jsonb_build_object(
      'ok', true,
      'enqueued', 0,
      'skipped', true,
      'reason', 'already_listed'
    );
  end if;

  foreach v_ch in array p_channels loop
    if v_ch <> 'ebay' then
      continue;
    end if;

    if exists (
      select 1 from public.channel_publish_queue
      where product_id = p_product_id
        and channel = v_ch
        and status in ('pending', 'processing')
    ) then
      update public.channel_publish_queue
      set updated_at = now()
      where product_id = p_product_id
        and channel = v_ch
        and status in ('pending', 'processing');
      v_touch := v_touch + 1;
    elsif exists (
      select 1 from public.channel_publish_queue
      where product_id = p_product_id and channel = v_ch
    ) then
      update public.channel_publish_queue
      set status = 'pending',
          action = 'sync',
          attempts = 0,
          last_error = null,
          result = null,
          updated_at = now()
      where product_id = p_product_id and channel = v_ch;
      v_reset := v_reset + 1;
    else
      insert into public.channel_publish_queue (product_id, channel, action, status)
      values (p_product_id, v_ch, 'sync', 'pending');
      v_enqueued := v_enqueued + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'enqueued', v_enqueued + v_reset,
    'touched', v_touch
  );
end;
$$;

-- Encola elegibles sin listing activo (backfill / cron manual).
create or replace function public.enqueue_ebay_lot_backlog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot_size int;
  v_row record;
  v_enqueued int := 0;
  v_touched int := 0;
  v_result jsonb;
begin
  select coalesce(lot_size, 12)
  into v_lot_size
  from public.ebay_publish_config
  where id = 'default';

  if v_lot_size is null or v_lot_size < 1 then
    v_lot_size := 12;
  end if;

  for v_row in
    select p.id
    from public.products p
    where coalesce(p.active, false)
      and coalesce(p.stock, 0) >= v_lot_size
      and not exists (
        select 1
        from public.ebay_derived_listings d
        where d.product_id = p.id
          and d.listing_kind = 'lot'
          and coalesce(d.ebay_listing_id, '') <> ''
      )
    order by p.stock desc, p.ref asc
  loop
    v_result := public.enqueue_channel_sync(v_row.id, array['ebay']::text[]);
    if coalesce((v_result->>'enqueued')::int, 0) > 0 then
      v_enqueued := v_enqueued + 1;
    elsif coalesce((v_result->>'touched')::int, 0) > 0 then
      v_touched := v_touched + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'enqueued', v_enqueued,
    'touched', v_touched
  );
end;
$$;

grant execute on function public.enqueue_ebay_lot_backlog() to service_role;

-- Índice para despacho por stock (join products en edge; útil para filtros).
create index if not exists channel_publish_queue_ebay_pending_idx
  on public.channel_publish_queue (updated_at)
  where channel = 'ebay' and status = 'pending';

-- Backfill inicial: elegibles sin listing activo.
select public.enqueue_ebay_lot_backlog();
