-- ============================================================
-- Room dots go EXACT (Alborz 2026-09-12, room-signals CP2)
-- ============================================================
-- The dashboard/group room dots stop keying off "when did you last enter
-- the room" (friend_group_members.last_seen_at) and start keying off the
-- per-entry open stamps (friend_group_thread_views, stamped on entry
-- expand since CP1 b3a8553). A room shows a dot only while it holds at
-- least one entry with an UNOPENED signal, and only opening that entry
-- clears it — walking into the room no longer does.
--
-- Buckets mirror the in-room signals exactly:
--   latest_visible_activity_at (blue) =
--     • an entry by someone else, readable at your progress, never opened
--       (the white outline), OR
--     • a readable response by someone else, on an entry you WROTE or
--       RESPONDED in, newer than your open stamp (the green circle).
--   latest_invisible_activity_at (red) =
--     • a hidden (ahead-of-progress) response by someone else on your OWN
--       entry, newer than your open stamp (the red circle), OR
--     • an entry by someone else still ahead of your progress, never
--       opened (the gated stub — flips to blue when you catch up).
--
-- Signature and return shape are UNCHANGED (callers keep working);
-- last_seen_at now returns NULL — the client treats "activity present +
-- no last_seen" as a dot, which is exactly the new contract.
-- p_exclude_own is kept for signature compatibility but no longer read:
-- the new rules exclude your own writing inherently.
--
-- Part 1 backfills the open stamps from each member's last room visit, so
-- history is grandfathered sensibly: anything that arrived BEFORE your
-- last visit counts as seen; anything newer keeps signaling. Real open
-- stamps (mobile's, CP1's) are never overwritten.
-- ============================================================

BEGIN;

-- ── 1. Backfill: approximate historical opens with the last room visit ──────
INSERT INTO public.friend_group_thread_views (user_id, group_id, thread_id, last_seen_at)
SELECT m.user_id, gt.group_id, gt.thread_id, m.last_seen_at
FROM public.friend_group_members m
JOIN public.group_threads gt ON gt.group_id = m.group_id
WHERE m.last_seen_at IS NOT NULL
ON CONFLICT (user_id, group_id, thread_id) DO NOTHING;

-- ── 2. The exact-dot function ───────────────────────────────────────────────
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
  -- RED bucket A: hidden responses on YOUR entries, newer than your open
  -- stamp (red circle).
  unopened_hidden_responses AS (
    SELECT r.group_id, r.created_at AS activity_at
    FROM replies r
    JOIN threads t ON t.id = r.thread_id
    JOIN user_rooms ur ON ur.group_id = r.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    LEFT JOIN opened o ON o.group_id = r.group_id AND o.thread_id = r.thread_id
    WHERE r.group_id IS NOT NULL AND NOT r.is_deleted
      AND r.author_id <> p_user_id
      AND NOT t.is_deleted
      AND t.author_id = p_user_id
      AND (r.season > up.eff_season OR (r.season = up.eff_season AND r.episode > up.eff_episode))
      AND (o.thread_id IS NULL OR r.created_at > o.opened_at)
  ),
  -- RED bucket B: others' entries still ahead of you, never opened (the
  -- gated stub; becomes BLUE bucket A once you catch up).
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
    SELECT hr.group_id, hr.activity_at FROM unopened_hidden_responses hr
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
