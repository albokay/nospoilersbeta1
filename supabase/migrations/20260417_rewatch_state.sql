-- ============================================================
-- Rewatch post persistence + monotonic rewatch rule
-- 2026-04-17
-- ============================================================
-- Part 1: Add columns to threads/replies so rewatch posts can
--         carry the frozen at-time-of-writing state the display
--         spec requires: the rewatch position (display) and the
--         is_rewatch flag (badge). The filter tag remains
--         season/episode — unchanged.
--
-- Part 2: Monotonic trigger on progress.rewatch_season/episode
--         while is_rewatching = true. Cannot move backward on a
--         rewatch once started. Hard line, matching the zero
--         rollback rule.
--
-- Apply manually in the Supabase SQL editor.
-- ============================================================

-- ── Part 1: schema additions ────────────────────────────────

alter table public.threads
  add column if not exists is_rewatch boolean not null default false,
  add column if not exists rewatch_season integer,
  add column if not exists rewatch_episode integer;

alter table public.replies
  add column if not exists is_rewatch boolean not null default false,
  add column if not exists rewatch_season integer,
  add column if not exists rewatch_episode integer;

-- ── Part 2: monotonic rewatch trigger ──────────────────────

create or replace function prevent_rewatch_rollback()
returns trigger
language plpgsql
as $$
begin
  -- Only enforce when the row *is* a rewatch after the update.
  -- If is_rewatching is flipping to false (transition complete)
  -- we allow rewatch_season/episode to be nulled out by the app.
  if coalesce(new.is_rewatching, false) = true then
    if coalesce(new.rewatch_season, 0) < coalesce(old.rewatch_season, 0)
       or (coalesce(new.rewatch_season, 0) = coalesce(old.rewatch_season, 0)
           and coalesce(new.rewatch_episode, 0) < coalesce(old.rewatch_episode, 0)) then
      raise exception 'cannot move rewatch progress backward'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists progress_no_rewatch_rollback on progress;

create trigger progress_no_rewatch_rollback
  before update on progress
  for each row
  execute function prevent_rewatch_rollback();
