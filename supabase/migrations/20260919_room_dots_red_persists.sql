-- ============================================================
-- 2026-09-19 — Room-level RED persists until you catch up
-- (odds-and-ends item 2, Alborz).
--
-- Replaces get_room_activity_visibility from 20260912_room_dots_exact.sql.
-- Signature, return shape, grants: UNCHANGED. Part 1 (the open-stamp
-- backfill) is NOT repeated — it ran once on 09-12.
--
-- What changes — the RED bucket A (hidden responses) only:
--   1. The open-stamp gate is GONE. A hidden (ahead-of-progress) response
--      signals red for as long as it stays hidden; opening the entry no
--      longer clears it (you saw a gated stub, not the writing). It leaves
--      the bucket only when your progress reaches it — at which point it
--      flows into BLUE bucket B (green) if it's newer than your open stamp.
--   2. Scope widened to threads you WROTE or RESPONDED in — matching BLUE
--      bucket B and the in-room rule of 2026-09-16 (fetchGroupThreads /
--      cellSignals), which the 09-12 RPC predated. The room dot and the
--      in-room dot now agree.
--
-- Everything else is byte-identical to the 09-12 function.
--
-- Known edge (documented, accepted for now): if you opened an entry WHILE
-- its response was still hidden (saw the stub), your open stamp is newer
-- than that response; when you later catch up it turns readable but does
-- not go green (the same edge the in-room green rule has today). A strict
-- "always green after catch-up" would need a progress-at-open stamp.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_room_activity_visibility(UUID, BOOLEAN);

CREATE FUNCTION public.get_room_activity_visibility(
  p_user_id     UUID    DEFAULT auth.uid(),
  p_exclude_own BOOLEAN DEFAULT false
)
RETURNS TABLE (
  group_id UUID,
  parent_group_id UUID,
  last_seen_at TIMESTAMPTZ,
  latest_visible_activity_at TIMESTAMPTZ,
  latest_invisible_activity_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  WITH user_rooms AS (
    SELECT m.group_id, fg.show_id, fg.parent_group_id
    FROM friend_group_members m
    JOIN friend_groups fg ON fg.id = m.group_id
    WHERE m.user_id = p_user_id
      AND fg.deleted_at IS NULL
  ),
  user_progress AS (
    SELECT
      p.show_id,
      CASE WHEN p.is_rewatching AND p.highest_season IS NOT NULL THEN p.highest_season ELSE p.season END AS eff_season,
      CASE WHEN p.is_rewatching AND p.highest_episode IS NOT NULL THEN p.highest_episode ELSE p.episode END AS eff_episode
    FROM progress p
    WHERE p.user_id = p_user_id
  ),
  opened AS (
    SELECT v.group_id, v.thread_id, v.last_seen_at AS opened_at
    FROM friend_group_thread_views v
    WHERE v.user_id = p_user_id
  ),
  my_participation AS (
    SELECT DISTINCT r.group_id, r.thread_id
    FROM replies r
    WHERE r.group_id IS NOT NULL AND r.author_id = p_user_id AND NOT r.is_deleted
  ),
  -- BLUE bucket A: others' readable entries, never opened (white outline).
  unopened_entries AS (
    SELECT gt.group_id, gt.shared_at AS activity_at
    FROM group_threads gt
    JOIN threads t ON t.id = gt.thread_id
    JOIN user_rooms ur ON ur.group_id = gt.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    LEFT JOIN opened o ON o.group_id = gt.group_id AND o.thread_id = gt.thread_id
    WHERE NOT t.is_deleted
      AND t.author_id <> p_user_id
      AND (t.season < up.eff_season OR (t.season = up.eff_season AND t.episode <= up.eff_episode))
      AND o.thread_id IS NULL
  ),
  -- BLUE bucket B: others' readable responses on entries you wrote or
  -- responded in, newer than your open stamp (green circle).
  unopened_responses AS (
    SELECT r.group_id, r.created_at AS activity_at
    FROM replies r
    JOIN threads t ON t.id = r.thread_id
    JOIN user_rooms ur ON ur.group_id = r.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    LEFT JOIN opened o ON o.group_id = r.group_id AND o.thread_id = r.thread_id
    WHERE r.group_id IS NOT NULL AND NOT r.is_deleted
      AND r.author_id <> p_user_id
      AND NOT t.is_deleted
      AND (t.author_id = p_user_id
           OR EXISTS (SELECT 1 FROM my_participation mp WHERE mp.group_id = r.group_id AND mp.thread_id = r.thread_id))
      AND (r.season < up.eff_season OR (r.season = up.eff_season AND r.episode <= up.eff_episode))
      AND (o.thread_id IS NULL OR r.created_at > o.opened_at)
  ),
  -- RED bucket A (2026-09-19): hidden responses on entries you wrote OR
  -- responded in. NO open-stamp gate — hidden is hidden until you catch up.
  hidden_responses AS (
    SELECT r.group_id, r.created_at AS activity_at
    FROM replies r
    JOIN threads t ON t.id = r.thread_id
    JOIN user_rooms ur ON ur.group_id = r.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    WHERE r.group_id IS NOT NULL AND NOT r.is_deleted
      AND r.author_id <> p_user_id
      AND NOT t.is_deleted
      AND (t.author_id = p_user_id
           OR EXISTS (SELECT 1 FROM my_participation mp WHERE mp.group_id = r.group_id AND mp.thread_id = r.thread_id))
      AND (r.season > up.eff_season OR (r.season = up.eff_season AND r.episode > up.eff_episode))
  ),
  -- RED bucket B: others' entries still ahead of you, never opened (the
  -- gated stub; becomes BLUE bucket A once you catch up). Unchanged.
  unopened_hidden_entries AS (
    SELECT gt.group_id, gt.shared_at AS activity_at
    FROM group_threads gt
    JOIN threads t ON t.id = gt.thread_id
    JOIN user_rooms ur ON ur.group_id = gt.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    LEFT JOIN opened o ON o.group_id = gt.group_id AND o.thread_id = gt.thread_id
    WHERE NOT t.is_deleted
      AND t.author_id <> p_user_id
      AND (t.season > up.eff_season OR (t.season = up.eff_season AND t.episode > up.eff_episode))
      AND o.thread_id IS NULL
  ),
  blue AS (
    SELECT ue.group_id, ue.activity_at FROM unopened_entries ue
    UNION ALL SELECT ur2.group_id, ur2.activity_at FROM unopened_responses ur2
  ),
  red AS (
    SELECT hr.group_id, hr.activity_at FROM hidden_responses hr
    UNION ALL SELECT he.group_id, he.activity_at FROM unopened_hidden_entries he
  )
  SELECT
    ur.group_id,
    ur.parent_group_id,
    NULL::timestamptz,
    (SELECT MAX(b.activity_at) FROM blue b WHERE b.group_id = ur.group_id),
    (SELECT MAX(x.activity_at) FROM red x  WHERE x.group_id = ur.group_id)
  FROM user_rooms ur;
END;
$$;

REVOKE ALL ON FUNCTION public.get_room_activity_visibility(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_room_activity_visibility(UUID, BOOLEAN) TO authenticated;

COMMIT;

-- Verification (run after): should return one row per room you're in, and
-- any room where a friend replied AHEAD of your progress in a thread you're
-- part of shows a non-null latest_invisible_activity_at even after you've
-- opened that entry.
-- SELECT * FROM public.get_room_activity_visibility();
