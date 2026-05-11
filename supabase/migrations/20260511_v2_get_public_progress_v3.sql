-- 2026-05-11 — extends get_public_progress to return the new
-- profile-display columns (shelf_override + shelf_position) from
-- 20260511_shelf_override_and_position.sql.
--
-- Visitors of a /v2/u/:username profile need these so the owner's
-- chosen shelf assignments + within-shelf ordering render the same
-- on the visitor view as on the owner's self view.
--
-- Privacy posture unchanged: the v2 visitor profile is the public
-- presentation of the user's shelves. shelf_override + shelf_position
-- are organizational metadata; they don't reveal anything not already
-- displayed by the shelf the row appears on.
--
-- Same DROP + CREATE pattern as 20260508_v2_get_public_progress_extended.sql
-- (Postgres rejects CREATE OR REPLACE when RETURNS TABLE shape changes).
-- The live caller (`fetchPublicProgressForUser`) is column-name-keyed, so
-- adding fields is non-breaking.

BEGIN;

DROP FUNCTION IF EXISTS public.get_public_progress(uuid);

CREATE FUNCTION public.get_public_progress(target_user_id uuid)
RETURNS TABLE (
  show_id          text,
  season           int,
  episode          int,
  is_rewatching    boolean,
  rewatch_season   int,
  rewatch_episode  int,
  highest_season   int,
  highest_episode  int,
  stopped_watching boolean,
  canon_pin        boolean,
  watching_quote   text,
  want_reason      text,
  canon_take       text,
  stopped_reason   text,
  shelf_override   text,
  shelf_position   int
)
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT
    p.show_id,
    p.season,
    p.episode,
    p.is_rewatching,
    p.rewatch_season,
    p.rewatch_episode,
    p.highest_season,
    p.highest_episode,
    p.stopped_watching,
    p.canon_pin,
    p.watching_quote,
    p.want_reason,
    p.canon_take,
    p.stopped_reason,
    p.shelf_override,
    p.shelf_position
  FROM public.progress p
  WHERE p.user_id = target_user_id;
$$;

COMMIT;
