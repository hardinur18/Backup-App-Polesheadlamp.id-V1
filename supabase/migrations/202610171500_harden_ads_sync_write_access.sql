begin;

-- UI mutations already pass through the permission-checked app-data server.
-- Direct authenticated REST writes are removed after the new sync backend is live.
revoke insert, update, delete on table public.daily_ads from authenticated;
grant select on table public.daily_ads to authenticated;
drop policy if exists "Authenticated access daily_ads" on public.daily_ads;
drop policy if exists "Authenticated read daily_ads" on public.daily_ads;
create policy "Authenticated read daily_ads"
  on public.daily_ads for select to authenticated using (true);

-- Sync history is authored by the backend; clients only read its latest result.
revoke insert, update, delete on table public.daily_ads_sync_runs from authenticated;
grant select on table public.daily_ads_sync_runs to authenticated;
drop policy if exists "Authenticated access daily_ads_sync_runs" on public.daily_ads_sync_runs;
drop policy if exists "Authenticated create daily ads sync runs" on public.daily_ads_sync_runs;
drop policy if exists "Authenticated read daily ads sync runs" on public.daily_ads_sync_runs;
create policy "Authenticated read daily ads sync runs"
  on public.daily_ads_sync_runs for select to authenticated using (true);

notify pgrst, 'reload schema';

commit;
