-- Cron pg_net debe enviar JWT (Edge Function verify_jwt=true).

alter table public.faire_publish_config
  add column if not exists edge_invoke_bearer text;

comment on column public.faire_publish_config.edge_invoke_bearer is
  'Bearer anon/publishable para invocar Edge Functions desde pg_cron.';

update public.faire_publish_config
set edge_invoke_bearer = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paWxheGRlZXR1enV0eWN2ZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjc0NjIsImV4cCI6MjA4ODk0MzQ2Mn0.GI8E7vRzxi5NumN_f4T432Lx4BcmgGLZo81BR9h3h8c'
where id = 'default'
  and (edge_invoke_bearer is null or edge_invoke_bearer = '');

create or replace function public.faire_trigger_sync(p_action text default 'sync_inventory')
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_bearer text;
  v_enabled boolean;
  v_url text := 'https://niilaxdeetuzutycvdkz.supabase.co/functions/v1/faire-sync';
  v_request_id bigint;
begin
  select cron_secret, edge_invoke_bearer, auto_sync_enabled
  into v_secret, v_bearer, v_enabled
  from public.faire_publish_config
  where id = 'default';

  if not coalesce(v_enabled, false) then
    return null;
  end if;

  if coalesce(v_bearer, '') = '' then
    raise exception 'faire_publish_config.edge_invoke_bearer no configurado';
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_bearer,
      'apikey', v_bearer
    ),
    body := jsonb_build_object(
      'action', p_action,
      'cronSecret', v_secret
    ),
    timeout_milliseconds := 15000
  )
  into v_request_id;

  return v_request_id;
end;
$$;
