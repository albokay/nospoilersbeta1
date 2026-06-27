-- ============================================================
-- Restructure — get_group_dashboard: per-member earliest-written ENTRY episode
-- ============================================================
-- ADDITIVE, idempotent (CREATE OR REPLACE), no schema change.
--
-- WHY: the group-context click modal wants to show "Read what your friends have
-- written?" only when there is writing the viewer can actually SEE at their
-- (live, in-modal) progress. The payload already exposes a boolean `wrote`, but
-- not WHICH episode each person wrote at, so the client can't tell visible from
-- spoiler-gated. This adds, per (show, member), the EARLIEST episode at which
-- they posted a non-deleted ENTRY (top-level thread) in that show's room:
-- `wrote_entry_min_s` / `wrote_entry_min_e` (null if they have no entries).
--
-- Entries only (not replies): a reply can't be visible unless its parent entry
-- is visible, so the earliest visible entry is sufficient — the client treats a
-- member as a "visible writer at progress P" iff their earliest entry <= P.
--
-- Everything else is byte-identical to 20260622_group_dashboard_respect_in_pool
-- (the `entry_writers` CTE + two new member fields are the only additions).
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
  pool AS (
    SELECT show_id FROM public.group_show_votes WHERE group_id = p_group_id
    UNION
    SELECT pr.show_id
      FROM public.progress pr
      JOIN members m ON m.user_id = pr.user_id
      WHERE pr.in_pool = true
  ),
  rooms AS (
    SELECT show_id, id AS room_id
      FROM public.friend_groups
      WHERE parent_group_id = p_group_id AND deleted_at IS NULL
  ),
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
  -- Earliest non-deleted ENTRY (thread) episode per (show, author) — drives the
  -- "Read what … have written?" visibility check on the client. [entry-min add]
  entry_writers AS (
    SELECT DISTINCT ON (r.show_id, t.author_id)
           r.show_id,
           t.author_id AS user_id,
           t.season    AS min_s,
           t.episode   AS min_e
      FROM rooms r
      JOIN public.group_threads gt ON gt.group_id = r.room_id
      JOIN public.threads t        ON t.id = gt.thread_id AND t.is_deleted = false
     ORDER BY r.show_id, t.author_id, t.season, t.episode
  ),
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
  member_show AS (
    SELECT
      p.show_id,
      m.user_id,
      (v.user_id IS NOT NULL)  AS voted,
      pr.season                AS s,
      pr.episode               AS e,
      (w.user_id IS NOT NULL)  AS wrote,
      ew.min_s                 AS wrote_entry_min_s,
      ew.min_e                 AS wrote_entry_min_e
    FROM pool p
    CROSS JOIN members m
    LEFT JOIN public.group_show_votes v
      ON v.group_id = p_group_id AND v.user_id = m.user_id AND v.show_id = p.show_id
    LEFT JOIN public.progress pr
      ON pr.user_id = m.user_id AND pr.show_id = p.show_id AND pr.in_pool = true
    LEFT JOIN writers w
      ON w.show_id = p.show_id AND w.user_id = m.user_id
    LEFT JOIN entry_writers ew
      ON ew.show_id = p.show_id AND ew.user_id = m.user_id
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
          'wrote',   ms.wrote,
          'wrote_entry_min_s', ms.wrote_entry_min_s,
          'wrote_entry_min_e', ms.wrote_entry_min_e
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
