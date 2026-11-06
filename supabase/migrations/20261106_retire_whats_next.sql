-- ============================================================
-- 2026-11-06 — Sidebar's "what's next" letters retire after a week
-- ============================================================
-- His note: "You're almost done with X. What's next?" (and its sibling,
-- "You all finished X. What's next?") should leave the room a week after
-- it lands. Both are kind 'whats_next' in sidebar_letters. The returning-
-- season letter (kind 'returning') stays.
--
-- Retiring = the letter's soft delete (threads.is_deleted), the same flag a
-- deleted letter uses: the room skips a deleted letter with no responses
-- entirely (fetchGroupThreads), so it reads as if it was never there, and
-- the what's-next panel under it goes with it. The sidebar_letters row
-- stays, so the digest never plants the same letter again.
--
-- Nightly at 10:30 UTC (2:30am PST / 3:30am PDT), after the shows refresh.
-- On its first run it retires the four already older than a week (11-06).
--
-- Re-applying is safe: cron.schedule upserts a job by name.
-- ============================================================

create or replace function public.retire_whats_next_letters()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    update public.threads t
       set is_deleted = true
     where t.author_id = '00000000-0000-4000-8000-000000000001'
       and t.is_deleted = false
       and t.created_at < now() - interval '7 days'
       and exists (
         select 1 from public.sidebar_letters sl
          where sl.thread_id = t.id and sl.kind = 'whats_next'
       )
    returning 1
  )
  select count(*)::int from gone;
$$;

-- Cron and the SQL editor only.
revoke all on function public.retire_whats_next_letters() from public, anon, authenticated;

select cron.schedule('retire-whats-next', '30 10 * * *', $$ select public.retire_whats_next_letters(); $$);
