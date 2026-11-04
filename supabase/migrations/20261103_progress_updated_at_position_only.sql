-- 2026-11-03 — progress.updated_at means "the position moved" (Alborz's catch:
-- two long-finished Furious rooms got "You all finished … What's next?" letters
-- on 11-03's digest run). Opening a show's guide / look-up card writes
-- progress.last_looked_up_at (lib/reference.ts), and this trigger bumped
-- updated_at on EVERY update — the digest's what's-next rule reads a
-- progress row touched within 7 days as "just reached the end" (send-digests
-- recentProgress), so any no-op touch re-armed it for a room never planted.
-- Now the stamp moves only when the watching position itself changes.
create or replace function public.set_progress_updated_at()
returns trigger
language plpgsql
as $function$
begin
  if (new.season, new.episode, new.is_rewatching, new.rewatch_season, new.rewatch_episode, new.highest_season, new.highest_episode)
     is distinct from
     (old.season, old.episode, old.is_rewatching, old.rewatch_season, old.rewatch_episode, old.highest_season, old.highest_episode)
  then
    new.updated_at := now();
  end if;
  return new;
end;
$function$;
