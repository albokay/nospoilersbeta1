-- ============================================================
-- Social-onboarding CP1 — group-scoped proposals (2026-07-06)
-- ============================================================
-- Idempotent (CREATE OR REPLACE both functions), no schema change.
--
-- MODEL CHANGE: a not-started show now lives inside a specific group as a
-- PROPOSAL — proposing it is the proposer's yes-vote, and the per-group vote
-- rows (group_show_votes) become the authoritative "who's in" state for
-- not-started shows. Watch progress stays global per (user, show); only the
-- want-to-watch/proposal state becomes per-group. The personal pool
-- (progress.in_pool) no longer drives what a group sees.
--
-- 1) get_group_dashboard: the group's shows = shows VOTED for in this group
--    UNION shows with a ROOM in this group. A member appears on a show iff
--    they voted for it here or are a current member of its room. Progress
--    (s/e) is read globally — no in_pool filter, and no member exclusion on
--    in_pool=false (removing a show from the personal dashboard no longer
--    erases you from group views by itself; leaving the room / withdrawing
--    the vote does). last_activity_at's progress leg is likewise scoped to
--    engaged (voter/room-member) members so an unrelated member's global
--    watching can't bump a group show.
--
-- 2) start_show_room: on creation, enrolls the caller + every CURRENT
--    yes-voter in this group (materialization on start). The old third leg —
--    auto-enrolling any group member who merely had global progress on the
--    show — is dropped: watching a show elsewhere is not engagement with
--    THIS group's room. Vote rows are read, never deleted: a started room
--    supersedes its proposal (the client shelves it by room existence) while
--    the who-voted record is preserved. Re-join behavior unchanged.
--
-- Room PERMANENCE needs no change: nothing here (or elsewhere) soft-deletes
-- a (group × show) room when votes flip or members leave.
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
  rooms AS (
    SELECT show_id, id AS room_id
      FROM public.friend_groups
      WHERE parent_group_id = p_group_id AND deleted_at IS NULL
  ),
  -- Group-scoped pool: proposals (votes in THIS group) + started rooms.
  pool AS (
    SELECT show_id FROM public.group_show_votes WHERE group_id = p_group_id
    UNION
    SELECT show_id FROM rooms
  ),
  room_members AS (
    SELECT r.show_id, fgm.user_id
      FROM rooms r
      JOIN public.friend_group_members fgm ON fgm.group_id = r.room_id
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
  -- "Read what … have written?" visibility check on the client.
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
  -- (show, user) pairs engaged in THIS group: yes-voters + current room members.
  engaged AS (
    SELECT show_id, user_id FROM public.group_show_votes WHERE group_id = p_group_id
    UNION
    SELECT show_id, user_id FROM room_members
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
        JOIN engaged en ON en.user_id = pr.user_id AND en.show_id = pr.show_id
        JOIN members m  ON m.user_id  = pr.user_id
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
    LEFT JOIN room_members rm
      ON rm.show_id = p.show_id AND rm.user_id = m.user_id
    LEFT JOIN public.progress pr
      ON pr.user_id = m.user_id AND pr.show_id = p.show_id
    LEFT JOIN writers w
      ON w.show_id = p.show_id AND w.user_id = m.user_id
    LEFT JOIN entry_writers ew
      ON ew.show_id = p.show_id AND ew.user_id = m.user_id
    WHERE (v.user_id IS NOT NULL OR rm.user_id IS NOT NULL)
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


CREATE OR REPLACE FUNCTION public.start_show_room(
  p_group_id  UUID,
  p_show_id   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_room_id  UUID;
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

  IF p_show_id IS NULL OR length(trim(p_show_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'show_required');
  END IF;

  SELECT id INTO v_room_id
  FROM public.friend_groups
  WHERE parent_group_id = p_group_id
    AND show_id = p_show_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    -- Re-join: clear any termination dot and re-add membership if missing.
    DELETE FROM public.friend_group_departed_members
    WHERE group_id = v_room_id AND user_id = v_caller;
    IF NOT EXISTS (
      SELECT 1 FROM public.friend_group_members WHERE group_id = v_room_id AND user_id = v_caller
    ) THEN
      INSERT INTO public.friend_group_members (group_id, user_id) VALUES (v_room_id, v_caller);
    END IF;
    RETURN jsonb_build_object('ok', true, 'room_id', v_room_id, 'created', false);
  END IF;

  -- Create the room (a parented friend_groups row).
  INSERT INTO public.friend_groups (show_id, name, created_by, parent_group_id)
  VALUES (p_show_id, p_show_id, v_caller, p_group_id)
  RETURNING id INTO v_room_id;

  -- Materialization on start: enroll the caller + every CURRENT yes-voter in
  -- this group. (Global watch progress alone no longer auto-enrolls anyone —
  -- group-scoped model, 2026-07-06.) Vote rows are preserved, not consumed.
  INSERT INTO public.friend_group_members (group_id, user_id)
  SELECT v_room_id, u.user_id
  FROM (
    SELECT v_caller AS user_id
    UNION
    SELECT gsv.user_id
      FROM public.group_show_votes gsv
      WHERE gsv.group_id = p_group_id AND gsv.show_id = p_show_id
  ) AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.friend_group_members fgm
    WHERE fgm.group_id = v_room_id AND fgm.user_id = u.user_id
  );

  RETURN jsonb_build_object('ok', true, 'room_id', v_room_id, 'created', true);
END;
$$;
