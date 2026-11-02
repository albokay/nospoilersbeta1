-- ============================================================
-- 2026-11-02 — Open letters in the show guide, notes round 2: a friend
-- is anyone in one of your WATCH GROUPS (people_groups), not a show room
-- ============================================================
-- His test: Yalborz and Salborz share a watch group but no room for The
-- Americans, and the guide showed no sealed row. The 11-01 helpers read
-- friend_group_members — the show ROOMS inside a watch group — so two
-- people in a watch group with no room for that show counted as
-- strangers. The site's "friends" are the dashboard's watch groups:
-- people_group_members, in a group that isn't deleted. Same signatures,
-- same callers; only the friends test changes.
--
-- Idempotent: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.shares_group_with(p_other UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.people_group_members a
      JOIN public.people_group_members b ON b.group_id = a.group_id
      JOIN public.people_groups g        ON g.id = a.group_id AND g.deleted_at IS NULL
     WHERE a.user_id = auth.uid()
       AND b.user_id = p_other
       AND p_other  <> auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.shares_group_with(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shares_group_with(UUID) TO authenticated;


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
      FROM public.people_group_members a
      JOIN public.people_group_members b ON b.group_id = a.group_id AND b.user_id <> a.user_id
      JOIN public.people_groups g        ON g.id = a.group_id AND g.deleted_at IS NULL
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
