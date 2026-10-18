begin;

create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

alter table public.ads_sync_runtime
  add column if not exists scheduler_token_hash text;

create or replace function public.configure_ads_daily_sync_cron(
  p_project_url text,
  p_publishable_key text,
  p_scheduler_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault, pg_catalog
as $function$
declare
  project_url_secret_id uuid;
  publishable_key_secret_id uuid;
  scheduler_token_secret_id uuid;
  existing_job record;
  incremental_job_id bigint;
  reconcile_job_id bigint;
begin
  if nullif(trim(p_project_url), '') is null
    or p_project_url !~ '^https://[a-z0-9]+[.]supabase[.]co$' then
    raise exception 'Supabase project URL is invalid.';
  end if;
  if nullif(trim(p_publishable_key), '') is null then
    raise exception 'Supabase publishable key is required.';
  end if;
  if length(coalesce(p_scheduler_token, '')) < 32 then
    raise exception 'Scheduler token must contain at least 32 characters.';
  end if;

  select id into project_url_secret_id
  from vault.secrets
  where name = 'ads_sync_project_url'
  limit 1;
  if project_url_secret_id is null then
    perform vault.create_secret(trim(p_project_url), 'ads_sync_project_url', 'Ads sync Edge Function project URL');
  else
    perform vault.update_secret(
      project_url_secret_id,
      trim(p_project_url),
      'ads_sync_project_url',
      'Ads sync Edge Function project URL'
    );
  end if;

  select id into publishable_key_secret_id
  from vault.secrets
  where name = 'ads_sync_publishable_key'
  limit 1;
  if publishable_key_secret_id is null then
    perform vault.create_secret(p_publishable_key, 'ads_sync_publishable_key', 'Ads sync Edge Function publishable key');
  else
    perform vault.update_secret(
      publishable_key_secret_id,
      p_publishable_key,
      'ads_sync_publishable_key',
      'Ads sync Edge Function publishable key'
    );
  end if;

  select id into scheduler_token_secret_id
  from vault.secrets
  where name = 'ads_sync_scheduler_token'
  limit 1;
  if scheduler_token_secret_id is null then
    perform vault.create_secret(p_scheduler_token, 'ads_sync_scheduler_token', 'Ads sync cron authentication token');
  else
    perform vault.update_secret(
      scheduler_token_secret_id,
      p_scheduler_token,
      'ads_sync_scheduler_token',
      'Ads sync cron authentication token'
    );
  end if;

  update public.ads_sync_runtime
  set scheduler_token_hash = encode(digest(p_scheduler_token, 'sha256'), 'hex'),
      updated_at = now()
  where id = 'daily-ads';

  for existing_job in
    select jobid
    from cron.job
    where jobname in ('ads-daily-auto-sync', 'ads-daily-seven-day-reconcile')
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  incremental_job_id := cron.schedule(
    'ads-daily-auto-sync',
    '*/15 * * * *',
    $command$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'ads_sync_project_url')
          || '/functions/v1/make-server-f781cd00/ads/sync-run',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'ads_sync_publishable_key'),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ads_sync_publishable_key'),
          'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ads_sync_scheduler_token')
        ),
        body := '{"triggerSource":"scheduled","forceProviders":false}'::jsonb,
        timeout_milliseconds := 300000
      ) as request_id;
    $command$
  );

  reconcile_job_id := cron.schedule(
    'ads-daily-seven-day-reconcile',
    '17 19 * * *',
    $command$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'ads_sync_project_url')
          || '/functions/v1/make-server-f781cd00/ads/sync-run',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'ads_sync_publishable_key'),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ads_sync_publishable_key'),
          'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ads_sync_scheduler_token')
        ),
        body := '{"triggerSource":"reconcile","forceProviders":true}'::jsonb,
        timeout_milliseconds := 300000
      ) as request_id;
    $command$
  );

  return jsonb_build_object(
    'configured', true,
    'incrementalJobId', incremental_job_id,
    'reconcileJobId', reconcile_job_id,
    'incrementalSchedule', '*/15 * * * *',
    'reconcileSchedule', '17 19 * * *'
  );
end;
$function$;

revoke all on function public.configure_ads_daily_sync_cron(text, text, text) from public, anon, authenticated;
grant execute on function public.configure_ads_daily_sync_cron(text, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
