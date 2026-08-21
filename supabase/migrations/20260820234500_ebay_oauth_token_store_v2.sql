-- eBay OAuth store: ciclo completo access/refresh, reauth, lock anti-carrera.
-- No sobrescribir refresh_token con "N/A"; refresh bajo demanda + preventivo cerca de vencer.

alter table public.ebay_oauth_tokens
  add column if not exists access_token_expires_at timestamptz,
  add column if not exists refresh_token_expires_at timestamptz,
  add column if not exists scopes text,
  add column if not exists environment text not null default 'production',
  add column if not exists ebay_user_id text,
  add column if not exists status text not null default 'active',
  add column if not exists last_refresh_at timestamptz,
  add column if not exists last_refresh_error text,
  add column if not exists reauth_required boolean not null default false,
  add column if not exists refresh_lock_until timestamptz;

comment on column public.ebay_oauth_tokens.expires_at is
  'Legacy alias de access_token_expires_at (se mantiene sincronizado).';
comment on column public.ebay_oauth_tokens.access_token_expires_at is
  'UTC cuando vence el access token (~2h).';
comment on column public.ebay_oauth_tokens.refresh_token_expires_at is
  'UTC cuando vence el refresh token (~18 meses desde el consent).';
comment on column public.ebay_oauth_tokens.status is
  'active | reauth_required | refresh_failed';
comment on column public.ebay_oauth_tokens.refresh_lock_until is
  'Mutex distribuido: solo un worker refresca a la vez.';

-- Backfill desde expires_at legacy
update public.ebay_oauth_tokens
set access_token_expires_at = coalesce(access_token_expires_at, expires_at)
where access_token_expires_at is null and expires_at is not null;

update public.ebay_oauth_tokens
set environment = 'production'
where coalesce(environment, '') = '';

-- Quitar keepalive agresivo cada hora (eBay: usar AT hasta que expire; refresh on demand).
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'ebay_oauth_keepalive_1h' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
exception
  when others then
    raise notice 'ebay_oauth_keepalive_1h unschedule skipped: %', sqlerrm;
end $$;

drop function if exists public.ebay_trigger_token_keepalive();

-- Health check diario: solo alerta (marca reauth si refresh cerca de vencer). No renueva access cada hora.
create or replace function public.ebay_oauth_health_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_days numeric;
  v_out jsonb;
begin
  select *
  into r
  from public.ebay_oauth_tokens
  where id = 'default';

  if not found then
    return jsonb_build_object('ok', false, 'event', 'EBAY_OAUTH_NO_TOKEN_ROW');
  end if;

  if coalesce(r.reauth_required, false) or r.status = 'reauth_required' then
    return jsonb_build_object(
      'ok', false,
      'event', 'EBAY_OAUTH_REAUTH_REQUIRED',
      'status', r.status,
      'last_refresh_error', r.last_refresh_error
    );
  end if;

  if r.refresh_token_expires_at is not null then
    v_days := extract(epoch from (r.refresh_token_expires_at - now())) / 86400.0;
    if v_days <= 30 then
      update public.ebay_oauth_tokens
      set status = case when v_days <= 7 then 'reauth_required' else status end,
          reauth_required = case when v_days <= 7 then true else reauth_required end,
          last_refresh_error = case
            when v_days <= 7 then 'Refresh token expira en <7 días — reautorizar pronto'
            else coalesce(last_refresh_error, 'Refresh token expira en <30 días')
          end,
          updated_at = now()
      where id = 'default';
      return jsonb_build_object(
        'ok', v_days > 7,
        'event', case when v_days <= 7 then 'EBAY_OAUTH_REAUTH_REQUIRED' else 'EBAY_OAUTH_REFRESH_EXPIRING' end,
        'days_until_refresh_expiry', round(v_days::numeric, 1)
      );
    end if;
  end if;

  v_out := jsonb_build_object(
    'ok', true,
    'event', 'EBAY_OAUTH_HEALTH_OK',
    'access_expires_at', r.access_token_expires_at,
    'refresh_expires_at', r.refresh_token_expires_at,
    'status', r.status
  );
  return v_out;
end;
$$;

revoke all on function public.ebay_oauth_health_check() from public;
grant execute on function public.ebay_oauth_health_check() to service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'ebay_oauth_health_daily' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'ebay_oauth_health_daily',
      '20 12 * * *',
      $cron$select public.ebay_oauth_health_check();$cron$
    );
  end if;
exception
  when others then
    raise notice 'ebay_oauth_health_daily not scheduled: %', sqlerrm;
end $$;
