-- Cron: reconcilia pagos pendientes Wompi/Addi en ventas_catalogo cada 15 min.

create or replace function public.channel_trigger_catalog_payment_reconcile()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bearer text;
  v_url text := 'https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/catalog-order-status';
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
    body := jsonb_build_object(
      'action', 'reconcile_pending_payments',
      'limit', 25,
      'days', 30
    ),
    timeout_milliseconds := 55000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.channel_trigger_catalog_payment_reconcile() is
  'Reconcilia pedidos catálogo pendientes (Wompi/Addi/Sistecredito) vía catalog-order-status.';

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'catalog_payment_reconcile_15m' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'catalog_payment_reconcile_15m',
  '*/15 * * * *',
  $$select public.channel_trigger_catalog_payment_reconcile();$$
);
