-- ============================================================
-- 2026-11-02 — Open letters in the show guide, notes round 1: a letter
-- is sealed by where it was WRITTEN FROM (the rooms' rule)
-- ============================================================
-- His test: at E4 he wrote about E3; a friend at E3 could read it, with
-- no sealed row. The rooms stamp every letter with the writer's position
-- at the moment of writing and seal it until a friend gets there — the
-- guide now does the same. A guide letter keeps the episode it's ABOUT
-- (season / episode: where its link sits on the sheet) and gains the
-- position it was WRITTEN FROM (from_season / from_episode), stamped by a
-- trigger from the writer's effective progress at insert (the rewatch's
-- high-water mark when rewatching; never below the episode it's about),
-- so the client can't choose it. Reading, the dashboard's signal and the
-- digest all gate on the from position.
--
-- Existing rows are backfilled with their own episode as the from
-- position (nothing was stamped before this); delete the test letters if
-- that reading is wrong for them.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS.
-- ============================================================

ALTER TABLE public.guide_letters
  ADD COLUMN IF NOT EXISTS from_season  INTEGER,
  ADD COLUMN IF NOT EXISTS from_episode INTEGER;

UPDATE public.guide_letters
   SET from_season = season, from_episode = episode
 WHERE from_season IS NULL OR from_episode IS NULL;

ALTER TABLE public.guide_letters
  ALTER COLUMN from_season  SET NOT NULL,
  ALTER COLUMN from_episode SET NOT NULL;


-- ── The stamp: the writer's position at insert ──────────────────────────
CREATE OR REPLACE FUNCTION public.guide_letters_stamp_from()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
BEGIN
  SELECT season, episode, is_rewatching, highest_season, highest_episode
    INTO p
    FROM public.progress
   WHERE user_id = NEW.user_id AND show_id = NEW.show_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no position on this show';
  END IF;
  IF p.is_rewatching AND p.highest_season IS NOT NULL AND p.highest_episode IS NOT NULL THEN
    NEW.from_season  := p.highest_season;
    NEW.from_episode := p.highest_episode;
  ELSE
    NEW.from_season  := p.season;
    NEW.from_episode := p.episode;
  END IF;
  -- Never below the episode it's about.
  IF NEW.from_season < NEW.season OR (NEW.from_season = NEW.season AND NEW.from_episode < NEW.episode) THEN
    NEW.from_season  := NEW.season;
    NEW.from_episode := NEW.episode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guide_letters_stamp_from ON public.guide_letters;
CREATE TRIGGER guide_letters_stamp_from
  BEFORE INSERT ON public.guide_letters
  FOR EACH ROW EXECUTE FUNCTION public.guide_letters_stamp_from();


-- ── Reading gates on the from position ──────────────────────────────────
DROP POLICY IF EXISTS guide_letters_select ON public.guide_letters;
CREATE POLICY guide_letters_select
  ON public.guide_letters FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      user_id = auth.uid()
      OR (
        public.shares_group_with(user_id)
        AND public.viewer_past_episode(show_id, from_season, from_episode)
      )
    )
  );
-- (insert / update policies unchanged: you write about an episode you've
--  reached; the trigger stamps where you are.)


-- ── The signal: one row per (show, episode, written-from), the relation
--    on the from position ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_guide_letter_signals(TEXT);
CREATE OR REPLACE FUNCTION public.get_guide_letter_signals(p_show_id TEXT DEFAULT NULL)
RETURNS TABLE (
  show_id       TEXT,
  show_name     TEXT,
  season        INTEGER,
  episode       INTEGER,
  from_season   INTEGER,
  from_episode  INTEGER,
  writer_ids    UUID[],
  letter_count  INTEGER,
  latest_at     TIMESTAMPTZ,
  relation      TEXT,
  seen_at       TIMESTAMPTZ,
  hold_seen_at  TIMESTAMPTZ,
  not_for_me    BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH friends AS (
    SELECT DISTINCT b.user_id
      FROM public.friend_group_members a
      JOIN public.friend_group_members b ON b.group_id = a.group_id AND b.user_id <> a.user_id
      JOIN public.friend_groups g        ON g.id = a.group_id AND g.deleted_at IS NULL
     WHERE a.user_id = auth.uid()
  ),
  eff AS (
    SELECT p.show_id,
           CASE WHEN p.is_rewatching AND p.highest_season IS NOT NULL AND p.highest_episode IS NOT NULL
                THEN p.highest_season ELSE p.season END AS s,
           CASE WHEN p.is_rewatching AND p.highest_season IS NOT NULL AND p.highest_episode IS NOT NULL
                THEN p.highest_episode ELSE p.episode END AS e
      FROM public.progress p
     WHERE p.user_id = auth.uid()
  ),
  letters AS (
    SELECT l.show_id, l.season, l.episode, l.from_season, l.from_episode, l.user_id, l.created_at
      FROM public.guide_letters l
     WHERE l.deleted_at IS NULL
       AND l.user_id IN (SELECT user_id FROM friends)
       AND (p_show_id IS NULL OR l.show_id = p_show_id)
  )
  SELECT l.show_id,
         sh.name                                   AS show_name,
         l.season,
         l.episode,
         l.from_season,
         l.from_episode,
         array_agg(DISTINCT l.user_id)             AS writer_ids,
         count(*)::INTEGER                         AS letter_count,
         max(l.created_at)                         AS latest_at,
         CASE
           WHEN eff.s IS NULL OR eff.s = 0 THEN 'none'
           WHEN eff.s > l.from_season OR (eff.s = l.from_season AND eff.e >= l.from_episode) THEN 'past'
           ELSE 'behind'
         END                                       AS relation,
         v.seen_at,
         h.seen_at                                 AS hold_seen_at,
         COALESCE(h.not_for_me, false)             AS not_for_me
    FROM letters l
    JOIN public.shows sh ON sh.id = l.show_id
    LEFT JOIN eff ON eff.show_id = l.show_id
    LEFT JOIN public.guide_letter_views v
           ON v.user_id = auth.uid() AND v.show_id = l.show_id AND v.season = l.season AND v.episode = l.episode
    LEFT JOIN public.guide_letter_holds h
           ON h.user_id = auth.uid() AND h.show_id = l.show_id
   GROUP BY l.show_id, sh.name, l.season, l.episode, l.from_season, l.from_episode, eff.s, eff.e, v.seen_at, h.seen_at, h.not_for_me
   ORDER BY max(l.created_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_guide_letter_signals(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guide_letter_signals(TEXT) TO authenticated;
