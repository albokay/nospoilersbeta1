-- Friend profile (2026-09-08): the /pool/:username page now renders the
-- owner's "Your shows" world, so the public progress RPC carries the shelf
-- columns too (essential_eps, wanted_at, shelf_hidden_at, updated_at).
-- Client tolerates their absence, so this can land before or after the push.
-- Postgres can't change a function's return shape in place (42P13) — drop
-- first; both statements run in one transaction so live traffic never sees
-- the gap.
DROP FUNCTION public.get_public_progress(uuid);
CREATE FUNCTION public.get_public_progress(target_user_id uuid)
 RETURNS TABLE(show_id text, season integer, episode integer, is_rewatching boolean, rewatch_season integer, rewatch_episode integer, highest_season integer, highest_episode integer, stopped_watching boolean, canon_pin boolean, watching_quote text, want_reason text, canon_take text, stopped_reason text, shelf_override text, shelf_position integer, essential_eps integer[], wanted_at timestamptz, shelf_hidden_at timestamptz, updated_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    p.show_id, p.season, p.episode, p.is_rewatching, p.rewatch_season,
    p.rewatch_episode, p.highest_season, p.highest_episode,
    p.stopped_watching, p.canon_pin, p.watching_quote, p.want_reason,
    p.canon_take, p.stopped_reason, p.shelf_override, p.shelf_position,
    p.essential_eps, p.wanted_at, p.shelf_hidden_at, p.updated_at
  FROM public.progress p
  WHERE p.user_id = target_user_id;
$function$
