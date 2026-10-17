begin;

create extension if not exists pgcrypto;

alter table if exists public.daily_ads
  add column if not exists sync_source text,
  add column if not exists provider_synced_at timestamptz,
  add column if not exists last_sync_run_id uuid,
  add column if not exists synced_at timestamptz;

alter table if exists public.daily_ads_sync_runs
  add column if not exists trigger_source text not null default 'manual',
  add column if not exists status text not null default 'succeeded',
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists finished_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists error_message text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_ads_sync_runs_trigger_source_check'
      and conrelid = 'public.daily_ads_sync_runs'::regclass
  ) then
    alter table public.daily_ads_sync_runs
      add constraint daily_ads_sync_runs_trigger_source_check
      check (trigger_source in ('manual', 'scheduled', 'reconcile'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_ads_sync_runs_status_check'
      and conrelid = 'public.daily_ads_sync_runs'::regclass
  ) then
    alter table public.daily_ads_sync_runs
      add constraint daily_ads_sync_runs_status_check
      check (status in ('running', 'succeeded', 'partial', 'failed', 'skipped'));
  end if;
end $$;

create index if not exists daily_ads_sync_runs_status_created_idx
  on public.daily_ads_sync_runs(status, created_at desc);

create table if not exists public.ads_sync_runtime (
  id text primary key,
  lock_token uuid,
  lock_until timestamptz,
  last_run_id uuid,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_status text,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into public.ads_sync_runtime (id)
values ('daily-ads')
on conflict (id) do nothing;

create or replace function public.claim_ads_daily_sync_lock(
  p_run_id uuid,
  p_ttl_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_rows integer := 0;
begin
  insert into public.ads_sync_runtime (id)
  values ('daily-ads')
  on conflict (id) do nothing;

  update public.ads_sync_runtime
  set lock_token = p_run_id,
      lock_until = now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 600), 1800))),
      last_run_id = p_run_id,
      last_started_at = now(),
      last_status = 'running',
      last_error = null,
      updated_at = now()
  where id = 'daily-ads'
    and (lock_until is null or lock_until <= now() or lock_token = p_run_id);

  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create or replace function public.release_ads_daily_sync_lock(
  p_run_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ads_sync_runtime
  set lock_token = null,
      lock_until = null,
      last_finished_at = now(),
      last_success_at = case
        when p_status in ('succeeded', 'partial') then now()
        else last_success_at
      end,
      last_status = p_status,
      last_error = nullif(p_error, ''),
      updated_at = now()
  where id = 'daily-ads'
    and lock_token = p_run_id;
end;
$$;

revoke all on function public.claim_ads_daily_sync_lock(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_ads_daily_sync_lock(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_ads_daily_sync_lock(uuid, integer) to service_role;
grant execute on function public.release_ads_daily_sync_lock(uuid, text, text) to service_role;

alter table public.ads_sync_runtime enable row level security;
revoke all privileges on table public.ads_sync_runtime from public, anon, authenticated;
grant select on table public.ads_sync_runtime to authenticated;
grant select, insert, update, delete on table public.ads_sync_runtime to service_role;

drop policy if exists "Authenticated read ads sync runtime" on public.ads_sync_runtime;
create policy "Authenticated read ads sync runtime"
  on public.ads_sync_runtime for select to authenticated using (true);

drop policy if exists "Service role manages ads sync runtime" on public.ads_sync_runtime;
create policy "Service role manages ads sync runtime"
  on public.ads_sync_runtime for all to service_role using (true) with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'daily_ads_sync_runs'
  ) then
    alter publication supabase_realtime add table public.daily_ads_sync_runs;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
