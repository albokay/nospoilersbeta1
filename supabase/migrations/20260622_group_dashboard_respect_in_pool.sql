-- ============================================================
-- Restructure — get_group_dashboard: respect progress.in_pool (§4)
-- ============================================================
-- ADDITIVE, idempotent (CREATE OR REPLACE), no schema change.
--
-- BUG: remove-a-show-from-your-pool (phase 6) keeps the user's progress row
-- (so it can be restored later) but flips progress.in_pool = false. The group
-- dashboard, however, decided a show's pool + which members are "in" a show
-- from votes OR ANY leftover progress, ignoring in_pool. So a user who removed
-- a show from their pool kept re-appearing on the group's "currently watching"
-- shelf via their retained progress — even though their vote was deleted and
-- they'd left the show's rooms.
--
-- FIX: out-of-pool progress (in_pool = false) no longer counts toward the
-- group pool, and a member who has removed a show is excluded from that show's
-- member list entirely (even if they had written in the room — remove-from-pool
-- is the definitive opt-out). The show itself stays in the pool if anyone else
-- still votes/watches it. The map's termination dot (friend_group_departed_
-- members) is unaffected. Only the two marked spots changed vs the prior
-- definition (20260621_restructure_group_dashboard_activity.sql).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_group_dashboard(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_shows  JSONB;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.people_group_members
    WHERE group_id = p_group_id AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  WITH members AS (
    SELECT user_id FROM public.people_group_members WHERE group_id = p_group_id
  ),
  -- The group's pool: shows voted-for here, plus shows any member has IN-POOL
  -- progress on. Out-of-pool (removed) progress is ignored. [in_pool fix]
  pool AS (
    SELECT show_id FROM public.group_show_votes WHERE group_id = p_group_id
    UNION
    SELECT pr.show_id
      FROM public.progress pr
      JOIN members m ON m.user_id = pr.user_id
      WHERE pr.in_pool = true
  ),
  -- The (group × show) room, if started.
  rooms AS (
    SELECT show_id, id AS room_id
      FROM public.friend_groups
      WHERE parent_group_id = p_group_id AND deleted_at IS NULL
  ),
  -- Distinct authors who have written in each room (entry or non-deleted reply).
  writers AS (
    SELECT r.show_id, t.author_id AS user_id
      FROM rooms r
      JOIN public.group_threads gt ON gt.group_id = r.room_id
      JOIN public.threads t        ON t.id = gt.thread_id AND t.is_deleted = false
    UNION
    SELECT r.show_id, rp.author_id AS user_id
      FROM rooms r
      JOIN public.replies rp ON rp.group_id = r.room_id AND rp.is_deleted = false
  ),
  -- Newest activity per show: room writing (entries + replies) + member progress.
  activity AS (
    SELECT show_id, MAX(at) AS last_at FROM (
      SELECT r.show_id, gt.shared_at AS at
        FROM rooms r
        JOIN public.group_threads gt ON gt.group_id = r.room_id
        JOIN public.threads t        ON t.id = gt.thread_id AND t.is_deleted = false
      UNION ALL
      SELECT r.show_id, rp.created_at AS at
        FROM rooms r
        JOIN public.replies rp ON rp.group_id = r.room_id AND rp.is_deleted = false
      UNION ALL
      SELECT pr.show_id, pr.updated_at AS at
        FROM public.progress pr
        JOIN members m ON m.user_id = pr.user_id
    ) src
    GROUP BY show_id
  ),
  -- One row per (show, member) with that member's vote / progress / wrote flags.
  member_show AS (
    SELECT
      p.show_id,
      m.user_id,
      (v.user_id IS NOT NULL)  AS voted,
      pr.season                AS s,
      pr.episode               AS e,
      (w.user_id IS NOT NULL)  AS wrote
    FROM pool p
    CROSS JOIN members m
    LEFT JOIN public.group_show_votes v
      ON v.group_id = p_group_id AND v.user_id = m.user_id AND v.show_id = p.show_id
    -- Only IN-POOL progress contributes the member's s/e (and counts them
    -- as opted-in). [in_pool fix]
    LEFT JOIN public.progress pr
      ON pr.user_id = m.user_id AND pr.show_id = p.show_id AND pr.in_pool = true
    LEFT JOIN writers w
      ON w.show_id = p.show_id AND w.user_id = m.user_id
    -- Keep only members who are actually opted into this show (voted, watching,
    -- or wrote) — not every member is in every pooled show. AND drop anyone who
    -- has removed this show from their pool, regardless of leftover writing —
    -- remove-from-pool is the definitive opt-out. [in_pool fix]
    WHERE (v.user_id IS NOT NULL OR pr.user_id IS NOT NULL OR w.user_id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.progress o
        WHERE o.user_id = m.user_id AND o.show_id = p.show_id AND o.in_pool = false
      )
  ),
  per_show AS (
    SELECT
      ms.show_id,
      jsonb_agg(
        jsonb_build_object(
          'user_id', ms.user_id,
          'voted',   ms.voted,
          's',       ms.s,
          'e',       ms.e,
          'wrote',   ms.wrote
        ) ORDER BY ms.user_id
      ) AS members_json
    FROM member_show ms
    GROUP BY ms.show_id
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'show_id', ps.show_id,
             'room_id', rm.room_id,
             'in_room', (rm.room_id IS NOT NULL AND EXISTS (
                          SELECT 1 FROM public.friend_group_members fgm
                          WHERE fgm.group_id = rm.room_id AND fgm.user_id = v_caller
                        )),
             'last_activity_at', a.last_at,
             'members', ps.members_json
           ) ORDER BY ps.show_id
         )
    INTO v_shows
    FROM per_show ps
    LEFT JOIN rooms rm    ON rm.show_id = ps.show_id
    LEFT JOIN activity a  ON a.show_id  = ps.show_id;

  RETURN jsonb_build_object('ok', true, 'shows', COALESCE(v_shows, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_dashboard(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_group_dashboard(UUID) TO authenticated;
