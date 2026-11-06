-- ============================================================
-- Push notifications CP2 (2026-11-05): the batches.
--
-- push_state remembers, per person, where their last batch left off
-- (covered_until), so a batch covers exactly what's new since and nothing is
-- ever pushed twice. Only the send-pushes function (service role) touches it:
-- row-level security on, no policies, no grants to the app's roles.
--
-- run_push_batches() POSTs to send-pushes with the shared secret, the same
-- shape as run_refresh_shows. The cron fires at :05 every hour; the
-- function decides who's due (8am, 11am, 2pm, 5pm, 8pm in each person's own
-- time zone). A test call takes a body, e.g. a dry run for everyone:
--   select public.run_push_batches('{"batch":true,"dry_run":true,"force":true}');
-- and the answer lands in net._http_response a few seconds later.
--
-- Re-applying is safe: cron.schedule upserts a job by name.
-- ============================================================

create table if not exists public.push_state (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  covered_until  timestamptz,
  last_sent_at   timestamptz,
  updated_at     timestamptz not null default now()
);

alter table public.push_state enable row level security;
revoke all on public.push_state from anon, authenticated;

create or replace function public.run_push_batches(p_body jsonb default '{"batch": true}'::jsonb)
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
    raise warning 'digest_cron_secret missing from Vault; skipping the push batches';
    return;
  end if;

  perform net.http_post(
    url     := 'https://haepqyykmwnyyijkbvci.supabase.co/functions/v1/send-pushes',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-digest-secret', v_secret
    ),
    body    := p_body
  );
end;
$$;

-- Cron and the SQL editor only.
revoke all on function public.run_push_batches(jsonb) from public, anon, authenticated;

select cron.schedule('push-batches', '5 * * * *', $$ select public.run_push_batches(); $$);
