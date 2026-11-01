-- ============================================================
-- 2026-11-01 — Open letters in the show guide, CP4: the dashboard's
-- signal + the holds
-- ============================================================
-- A friend who is BEHIND a guide letter's episode (or has no position on
-- the show) can't see the letter row at all (guide_letters RLS), yet the
-- dashboard must tell them a friend wrote, and the guide must end with a
-- sealed row for a letter ahead. So one SECURITY DEFINER function returns,
-- for the caller, every episode where a FRIEND (anyone sharing a live
-- group) has guide letters — who, how many, when the newest landed, and the
-- caller's relation to the episode (past / behind / none) — never a body.
-- Naming the episode of a sealed letter is the room's own convention (its
-- SealedEntry row says "Sealed until S7 E14").
--
-- The holds table is per (viewer, show): seen_at = the note was tapped
-- (any outcome) — a letter newer than it raises the note again; not_for_me
-- = never note this show again (touches no shelf).
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.guide_letter_holds (
  user_id     UUID         NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  show_id     TEXT         NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  seen_at     TIMESTAMPTZ,
  not_for_me  BOOLEAN      NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, show_id)
);

ALTER TABLE public.guide_letter_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guide_letter_holds_all ON public.guide_letter_holds;
CREATE POLICY guide_letter_holds_all
  ON public.guide_letter_holds FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.guide_letter_holds TO authenticated;


-- ── The signal ──────────────────────────────────────────────────────────
-- p_show_id NULL = every show (the dashboard); a show id = that show (the
-- guide's sealed row). One row per (show, season, episode) with friends'
-- letters. relation: 'past' = the caller's effective progress is at or past
-- the episode (the letters themselves are readable); 'behind' = a position
-- below it; 'none' = no position (no progress row, or "haven't started").
-- seen_at = the caller's guide_letter_views stamp for the episode (null =
-- never opened); hold_seen_at / not_for_me = the show's holds row.

DROP FUNCTION IF EXISTS public.get_guide_letter_signals(TEXT);
CREATE OR REPLACE FUNCTION public.get_guide_letter_signals(p_show_id TEXT DEFAULT NULL)
RETURNS TABLE (
  show_id       TEXT,
  show_name     TEXT,
  season        INTEGER,
  episode       INTEGER,
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
    SELECT l.show_id, l.season, l.episode, l.user_id, l.created_at
      FROM public.guide_letters l
     WHERE l.deleted_at IS NULL
       AND l.user_id IN (SELECT user_id FROM friends)
       AND (p_show_id IS NULL OR l.show_id = p_show_id)
  )
  SELECT l.show_id,
         sh.name                                   AS show_name,
         l.season,
         l.episode,
         array_agg(DISTINCT l.user_id)             AS writer_ids,
         count(*)::INTEGER                         AS letter_count,
         max(l.created_at)                         AS latest_at,
         CASE
           WHEN eff.s IS NULL OR eff.s = 0 THEN 'none'
           WHEN eff.s > l.season OR (eff.s = l.season AND eff.e >= l.episode) THEN 'past'
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
   GROUP BY l.show_id, sh.name, l.season, l.episode, eff.s, eff.e, v.seen_at, h.seen_at, h.not_for_me
   ORDER BY max(l.created_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_guide_letter_signals(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guide_letter_signals(TEXT) TO authenticated;
