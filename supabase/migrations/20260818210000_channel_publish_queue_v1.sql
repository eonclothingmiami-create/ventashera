-- Cola de sincronización ML / eBay / Faire — encola en alta/edición, procesa vía cron.

create table if not exists public.channel_publish_queue (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  channel text not null check (channel in ('mercadolibre', 'ebay', 'faire')),
  action text not null default 'sync'
    check (action in ('sync', 'deactivate')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'skipped', 'error')),
  attempts int not null default 0 check (attempts >= 0),
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists channel_publish_queue_status_idx
  on public.channel_publish_queue (status, updated_at);

create unique index if not exists channel_publish_queue_pending_uq
  on public.channel_publish_queue (product_id, channel)
  where status in ('pending', 'processing');

comment on table public.channel_publish_queue is
  'Cola de sync eBay (top vistas). ML y Faire sincronizan directo al guardar.';

alter table public.channel_publish_queue enable row level security;
revoke all on public.channel_publish_queue from anon, authenticated;
grant all on public.channel_publish_queue to service_role;

-- Encola sync para canales activos del producto (idempotente si ya hay pending).
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
    if v_ch not in ('mercadolibre', 'ebay', 'faire') then
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

comment on function public.enqueue_channel_sync(uuid, text[]) is
  'Encola sync eBay al guardar producto. Idempotente.';

grant execute on function public.enqueue_channel_sync(uuid, text[]) to authenticated;
grant execute on function public.enqueue_channel_sync(uuid, text[]) to service_role;

-- Cron: despacha cola cada 5 min (reutiliza bearer de ebay_publish_config).
create or replace function public.channel_trigger_queue_dispatch()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bearer text;
  v_url text := 'https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/channel-queue-dispatch';
  v_request_id bigint;
begin
  select edge_invoke_bearer into v_bearer
  from public.ebay_publish_config
  where id = 'default';

  if coalesce(v_bearer, '') = '' then
    raise exception 'ebay_publish_config.edge_invoke_bearer no configurado';
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_bearer,
      'apikey', v_bearer
    ),
    body := jsonb_build_object('action', 'dispatch'),
    timeout_milliseconds := 55000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'channel_queue_dispatch_5m' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'channel_queue_dispatch_5m',
  '*/5 * * * *',
  $$select public.channel_trigger_queue_dispatch();$$
);
