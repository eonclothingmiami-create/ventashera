-- Cola solo eBay; ML y Faire sincronizan directo al guardar.

comment on table public.channel_publish_queue is
  'Cola de sync eBay (top vistas). ML y Faire sincronizan directo al guardar.';

comment on function public.enqueue_channel_sync(uuid, text[]) is
  'Encola sync eBay al guardar producto. Idempotente.';

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
  v_ch text;
  v_enqueued int := 0;
  v_reset int := 0;
  v_touch int := 0;
begin
  if p_product_id is null then
    return jsonb_build_object('ok', false, 'error', 'product_id_required');
  end if;

  select coalesce(active, false), coalesce(stock, 0)::int
  into v_active, v_stock
  from public.products
  where id = p_product_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  if not v_active or v_stock <= 0 then
    return jsonb_build_object('ok', true, 'enqueued', 0, 'skipped', true, 'reason', 'inactive_or_no_stock');
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
