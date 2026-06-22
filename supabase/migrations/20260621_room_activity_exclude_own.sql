-- ============================================================
-- get_room_activity_visibility — add own-exclusion + parent_group_id
-- ============================================================
-- Extends the shared room-activity engine (used by the desktop journal/show
-- page/profile AND mobile) for the restructure's new-activity dots:
--   • p_exclude_own (default FALSE) — when TRUE, the caller's own entries/
--     replies don't count as activity (you're not notified of your own writing).
--     Defaulting FALSE keeps every existing caller's behaviour identical.
--   • parent_group_id added to the result so the dashboard can roll room
--     activity up to its people-group cluster. Existing callers ignore the
--     extra column.
--
-- Signature changes (new param + new return column), so DROP + CREATE rather
-- than REPLACE. Additive in effect; existing rpc("get_room_activity_visibility",
-- { p_user_id }) calls resolve to the new function with p_exclude_own=false.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_room_activity_visibility(UUID);

CREATE OR REPLACE FUNCTION public.get_room_activity_visibility(
  p_user_id     UUID    DEFAULT auth.uid(),
  p_exclude_own BOOLEAN DEFAULT false
)
RETURNS TABLE (
  group_id UUID,
  parent_group_id UUID,
  last_seen_at TIMESTAMPTZ,
  latest_visible_activity_at TIMESTAMPTZ
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
    SELECT m.group_id, m.last_seen_at, fg.show_id, fg.parent_group_id
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
  visible_thread_activity AS (
    SELECT gt.group_id, gt.shared_at AS activity_at
    FROM group_threads gt
    JOIN threads t ON t.id = gt.thread_id
    JOIN user_rooms ur ON ur.group_id = gt.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    WHERE NOT t.is_deleted
      AND (NOT p_exclude_own OR t.author_id <> p_user_id)
      AND (t.season < up.eff_season OR (t.season = up.eff_season AND t.episode <= up.eff_episode))
  ),
  visible_reply_activity AS (
    SELECT r.group_id, r.created_at AS activity_at
    FROM replies r
    JOIN user_rooms ur ON ur.group_id = r.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    WHERE r.group_id IS NOT NULL
      AND NOT r.is_deleted
      AND (NOT p_exclude_own OR r.author_id <> p_user_id)
      AND (r.season < up.eff_season OR (r.season = up.eff_season AND r.episode <= up.eff_episode))
  ),
  combined_activity AS (
    SELECT vta.group_id, vta.activity_at FROM visible_thread_activity vta
    UNION ALL
    SELECT vra.group_id, vra.activity_at FROM visible_reply_activity vra
  )
  SELECT
    ur.group_id,
    ur.parent_group_id,
    ur.last_seen_at,
    MAX(ca.activity_at) AS latest_visible_activity_at
  FROM user_rooms ur
  LEFT JOIN combined_activity ca ON ca.group_id = ur.group_id
  GROUP BY ur.group_id, ur.parent_group_id, ur.last_seen_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_room_activity_visibility(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_room_activity_visibility(UUID, BOOLEAN) TO authenticated;
