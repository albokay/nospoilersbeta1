-- Mobile Phase 4 backend — last_seen_at on friend_group_members + RPCs for the
-- new-activity indicator on the mobile rooms list / S7 dropdown.
--
-- The mobile spec requires that indicators *never* show counts/dots for content
-- the user can't see yet (HANDOFF mobile arc — "load-bearing principle, not a
-- v1 simplification"). To honor that without N round-trips per list render, the
-- visibility query does the canView join server-side via the user's per-show
-- effective progress (highestS/E for rewatchers, s/e otherwise — same rule as
-- src/lib/utils.ts effectiveProgress).
--
-- Migration is fully additive: nullable column + two new RPCs. Existing reads
-- and writes against friend_group_members are unaffected. Mobile code degrades
-- gracefully if this hasn't been applied yet — the RPC calls fail and the UI
-- just renders no indicators, no broken state.

-- ── 1. Column ────────────────────────────────────────────────────────────────

ALTER TABLE friend_group_members
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- ── 2. mark_room_seen — stamp the caller's last_seen_at for a room ───────────
--
-- SECURITY DEFINER because the existing friend_group_members RLS doesn't have
-- an UPDATE policy (only SELECT / INSERT-by-creator / DELETE). Adding an
-- UPDATE policy scoped to the user's own row would also work, but a focused
-- RPC makes the intent explicit and keeps the surface small.

CREATE OR REPLACE FUNCTION public.mark_room_seen(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE friend_group_members
  SET last_seen_at = NOW()
  WHERE group_id = p_group_id
    AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_room_seen(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_room_seen(UUID) TO authenticated;

-- ── 3. get_room_activity_visibility — per-room canView-aware activity ────────
--
-- Returns one row per room the calling user is a member of, with:
--   group_id                  — the room
--   last_seen_at              — when the user last entered the room (NULL = never)
--   latest_visible_activity_at — the most recent thread/reply timestamp in this
--                               room that's visible at the user's effective
--                               progress for the room's show. NULL = nothing
--                               visible (or no activity at all).
--
-- The client compares latest_visible_activity_at against last_seen_at to decide
-- whether to render a "new" dot. NULL last_seen_at + non-NULL latest activity
-- → indicator (the user has never visited and there's visible content).
--
-- Effective progress: highestS/E when is_rewatching AND highest_* set,
-- otherwise raw season/episode. Mirrors src/lib/utils.ts effectiveProgress.
-- For users with NO progress row for a show, the room contributes no visible
-- activity — INNER JOIN against user_progress in the visible CTEs takes care
-- of that, while the outer LEFT JOIN keeps the room itself in the result.
--
-- Authorization: SECURITY DEFINER + explicit auth.uid() identity check so a
-- caller can't pass another user's id and read their visibility state.
-- Function defaults p_user_id to auth.uid() so callers don't need to thread
-- the id through.

CREATE OR REPLACE FUNCTION public.get_room_activity_visibility(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (
  group_id UUID,
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
    SELECT m.group_id, m.last_seen_at, fg.show_id
    FROM friend_group_members m
    JOIN friend_groups fg ON fg.id = m.group_id
    WHERE m.user_id = p_user_id
      AND fg.deleted_at IS NULL
  ),
  user_progress AS (
    SELECT
      p.show_id,
      CASE
        WHEN p.is_rewatching AND p.highest_season IS NOT NULL THEN p.highest_season
        ELSE p.season
      END AS eff_season,
      CASE
        WHEN p.is_rewatching AND p.highest_episode IS NOT NULL THEN p.highest_episode
        ELSE p.episode
      END AS eff_episode
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
      AND (t.season < up.eff_season
           OR (t.season = up.eff_season AND t.episode <= up.eff_episode))
  ),
  visible_reply_activity AS (
    SELECT r.group_id, r.created_at AS activity_at
    FROM replies r
    JOIN user_rooms ur ON ur.group_id = r.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    WHERE r.group_id IS NOT NULL
      AND NOT r.is_deleted
      AND (r.season < up.eff_season
           OR (r.season = up.eff_season AND r.episode <= up.eff_episode))
  ),
  combined_activity AS (
    -- Aliased + qualified because the function's RETURNS TABLE column
    -- `group_id` is in scope as a PL/pgSQL OUT variable, and an
    -- unqualified `group_id` here would be ambiguous (Postgres
    -- raises 42702). Same applies if more OUT names ever overlap
    -- with column names down the chain.
    SELECT vta.group_id, vta.activity_at FROM visible_thread_activity vta
    UNION ALL
    SELECT vra.group_id, vra.activity_at FROM visible_reply_activity vra
  )
  SELECT
    ur.group_id,
    ur.last_seen_at,
    MAX(ca.activity_at) AS latest_visible_activity_at
  FROM user_rooms ur
  LEFT JOIN combined_activity ca ON ca.group_id = ur.group_id
  GROUP BY ur.group_id, ur.last_seen_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_room_activity_visibility(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_activity_visibility(UUID) TO authenticated;
