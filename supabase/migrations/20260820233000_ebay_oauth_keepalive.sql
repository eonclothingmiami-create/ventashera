-- Keepalive eBay OAuth: renueva access token cada hora para que el refresh no se “oxiden”
-- y fallos de refresh se detecten antes de publicar.

create or replace function public.ebay_trigger_token_keepalive()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bearer text;
  v_url text := 'https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/ebay-oauth-exchange';
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
    body := jsonb_build_object('action', 'refresh'),
    timeout_milliseconds := 20000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.ebay_trigger_token_keepalive() from public;
grant execute on function public.ebay_trigger_token_keepalive() to service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'ebay_oauth_keepalive_1h' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'ebay_oauth_keepalive_1h',
  '15 * * * *',
  $cron$select public.ebay_trigger_token_keepalive();$cron$
);
