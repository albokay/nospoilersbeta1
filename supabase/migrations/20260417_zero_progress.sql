-- ============================================================
-- Zero-progress support for friend rooms
-- 2026-04-17
-- ============================================================
-- Allows users to record a watch-progress state of (season=0, episode=0)
-- representing "haven't started the show yet". This is the pre-watch
-- state for a show, only selectable when creating or joining a friend
-- room for a show the user hasn't begun.
--
-- Rule: a user can enter zero and leave zero, but they can never
-- return to zero. Once you've watched anything, the pre-watch state
-- is gone forever for that show. This trigger enforces that rule at
-- the DB layer so it cannot be bypassed by future client code.
--
-- No schema changes needed — `progress.season` / `progress.episode`
-- are `integer not null` with no CHECK constraint, so 0/0 is already
-- a permissible value.
--
-- This migration must be applied manually in prod.
-- ============================================================

create or replace function prevent_progress_rollback_to_zero()
returns trigger
language plpgsql
as $$
begin
  if new.season = 0 and new.episode = 0
     and (old.season <> 0 or old.episode <> 0) then
    raise exception 'cannot roll back watch progress to zero once you have started the show'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists progress_no_rollback_to_zero on progress;

create trigger progress_no_rollback_to_zero
  before update on progress
  for each row
  execute function prevent_progress_rollback_to_zero();
