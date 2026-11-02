-- ============================================================
-- 2026-11-02 — The nightly episode-list refresh (pg_cron → refresh-shows)
-- ============================================================
-- His Survivor catch: a show nobody held in a pool went stale for weeks
-- (synced 09-28; season 51 showed one episode with six aired). The client
-- refreshes only what a page touches; this refreshes every show that can
-- still change, every night, so the counts are fresh before anyone opens
-- anything. Same shape as run_build_browse_rows: the shared secret from
-- Vault, POSTed to the function. 10:15 UTC = 3:15am PDT / 2:15am PST,
-- after the browse rows at 10:00. About 70 shows a night.
--
-- Re-applying is safe: cron.schedule upserts a job by name.
-- ============================================================

create or replace function public.run_refresh_shows()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'digest_cron_secret'
   limit 1;
  if v_secret is null then
    raise warning 'digest_cron_secret missing from Vault; skipping the shows refresh';
    return;
  end if;

  perform net.http_post(
    url     := 'https://haepqyykmwnyyijkbvci.supabase.co/functions/v1/refresh-shows',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-digest-secret', v_secret
    ),
    body    := '{}'::jsonb
  );
end;
$$;

-- Cron-only, like run_build_browse_rows.
revoke all on function public.run_refresh_shows() from public, anon, authenticated;

select cron.schedule('refresh-shows', '15 10 * * *', $$ select public.run_refresh_shows(); $$);
