-- Refresh preventivo eBay: cada 90 min llama ensure (sin force).
-- Solo renueva access si está cerca de vencer; no quema límites; detecta invalid_grant a tiempo.

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
  -- Si ya requiere reauth, no spamear eBay (el status lo muestra el health check).
  if exists (
    select 1 from public.ebay_oauth_tokens
    where id = 'default'
      and (coalesce(reauth_required, false) or status = 'reauth_required')
  ) then
    return null;
  end if;

  select edge_invoke_bearer into v_bearer
  from public.ebay_publish_config
  where id = 'default';

  if coalesce(v_bearer, '') = '' then
    raise exception 'ebay_publish_config.edge_invoke_bearer no configurado';
  end if;

  -- action=keepalive sin force → solo refresh si access próximo a vencer
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_bearer,
      'apikey', v_bearer
    ),
    body := jsonb_build_object('action', 'keepalive'),
    timeout_milliseconds := 25000
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
  -- quitar cron agresivo horario si quedó
  select jobid into v_jobid from cron.job where jobname = 'ebay_oauth_keepalive_1h' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  select jobid into v_jobid from cron.job where jobname = 'ebay_oauth_keepalive_90m' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- cada 90 minutos (minuto 20 de horas pares/impares alternando vía */90 no es válido en cron std)
    -- usamos :20 y :50 → ~cada 30 min pero cheap porque solo refresca si AT < 5 min de vencer
    perform cron.schedule(
      'ebay_oauth_keepalive_90m',
      '20,50 * * * *',
      $cron$select public.ebay_trigger_token_keepalive();$cron$
    );
  end if;
exception
  when others then
    raise notice 'ebay_oauth_keepalive_90m not scheduled: %', sqlerrm;
end $$;
