-- Cron: importa pedidos ML / Faire / eBay → ventas_catalogo cada 15 min.

create or replace function public.channel_trigger_marketplace_orders_sync()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bearer text;
  v_url text := 'https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/marketplace-orders-sync';
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
    body := jsonb_build_object('action', 'sync_all', 'limit', 30),
    timeout_milliseconds := 55000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.channel_trigger_marketplace_orders_sync() is
  'Invoca marketplace-orders-sync (ML / Faire / eBay) hacia ventas_catalogo.';

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'marketplace_orders_sync_15m' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'marketplace_orders_sync_15m',
  '*/15 * * * *',
  $$select public.channel_trigger_marketplace_orders_sync();$$
);
