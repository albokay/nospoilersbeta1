-- Friend-room daily digest emails — CP5: the schedule.
-- Spec: sidebar_spec_friend_room_digest_emails.md
--
-- Fires the send-digests edge function once a day at 5:30pm Pacific wall-clock
-- (DST-aware). pg_cron schedules are interpreted in UTC, and 5:30pm Pacific is
-- a different UTC instant in summer (PDT, UTC-7) vs winter (PST, UTC-8). So we
-- schedule TWO daily jobs — 00:30 and 01:30 UTC — and the wrapper function
-- only actually runs when the current Pacific hour is 17. Exactly one of the
-- two lands on 17:00 Pacific each day, year-round:
--     PDT (summer): 00:30 UTC = 17:30 PDT (run) · 01:30 UTC = 18:30 PDT (skip)
--     PST (winter): 00:30 UTC = 16:30 PST (skip) · 01:30 UTC = 17:30 PST (run)
--
-- ── PREREQUISITES (do these BEFORE applying this file) ───────────────────────
-- 1. Test the engine first: deploy send-digests and confirm a dry_run / test
--    email looks right (see HANDOFF "Edge function deploy notes").
-- 2. Enable the pg_cron and pg_net extensions for the project
--    (Supabase Dashboard → Database → Extensions). The CREATE EXTENSION lines
--    below are idempotent but some projects require the dashboard toggle.
-- 3. Store the digest secret in Vault so it is NOT committed to git. Run once
--    in the SQL editor, using the SAME value set as DIGEST_CRON_SECRET on the
--    send-digests function:
--        select vault.create_secret('YOUR_SECRET_VALUE', 'digest_cron_secret');
-- 4. Confirm cron.timezone is UTC (Supabase default). If your project differs,
--    the two schedule times below need adjusting.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.run_friend_room_digest()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  -- DST-aware gate: only the scheduled run that maps to 17:00 Pacific proceeds.
  if extract(hour from (now() at time zone 'America/Los_Angeles'))::int <> 17 then
    return;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'digest_cron_secret'
   limit 1;
  if v_secret is null then
    raise warning 'digest_cron_secret missing from Vault; skipping digest run';
    return;
  end if;

  perform net.http_post(
    url     := 'https://haepqyykmwnyyijkbvci.supabase.co/functions/v1/send-digests',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-digest-secret', v_secret
    ),
    body    := '{}'::jsonb
  );
end;
$$;

-- Re-applying is safe: cron.schedule upserts a job by name.
select cron.schedule('friend-room-digest-a', '30 0 * * *', $$ select public.run_friend_room_digest(); $$);
select cron.schedule('friend-room-digest-b', '30 1 * * *', $$ select public.run_friend_room_digest(); $$);

-- To turn the digest OFF later:
--   select cron.unschedule('friend-room-digest-a');
--   select cron.unschedule('friend-room-digest-b');
