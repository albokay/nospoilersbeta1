-- ============================================================
-- Social-onboarding CP5 — leave a show room (2026-07-06)
-- ============================================================
-- The X on an active-room button leaves ONLY that room in that group — never
-- a global removal, never the room itself (permanence), never anyone's votes.
--
-- 1) leave_show_room(p_room_id): removes the caller's room membership and
--    records a departed marker. The marker does double duty:
--      • per-viewer shelf hiding — "removes this button from view" is about
--        the LEAVER's own view; other members' shelves are untouched. A
--        deliberate leave must be distinguishable from never-having-joined
--        (never-joined rooms stay visible for discovery), and the marker is
--        that distinction.
--      • the map's "has left" tag — but get_room_map_data ONLY surfaces a
--        departed column for someone with WRITING in that room (2026-06-28
--        rule), so a non-writer's leave shows NOWHERE: a clean, traceless
--        exit. A writer keeps their column + the neutral marker; their
--        writing stays readable.
--    Votes are untouched (who-voted history preserved; nothing un-proposes).
--    Rejoining goes through start_show_room, which already clears the marker
--    and re-adds membership — the "left then returned" transition.
--
-- 2) get_group_dashboard: (a) member display for a ROOMED show = current
--    room members only (votes keep driving proposals) — so a leaver's avatar
--    drops off the button for everyone without their vote history being
--    deleted; (b) new per-show `viewer_left` = the CALLER has a departed
--    marker on the show's room — drives hiding the button from their shelf.
-- ============================================================

CREATE OR REPLACE FUNCTION public.leave_show_room(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    UUID;
  v_group_id  UUID;
  v_username  TEXT;
  v_wrote     BOOLEAN;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT parent_group_id INTO v_group_id
  FROM public.friend_groups
  WHERE id = p_room_id AND parent_group_id IS NOT NULL AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = p_room_id AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  -- Writer fork (informational — the marker is written either way; the map
  -- surfaces it only for writers).
  v_wrote :=
    EXISTS (
      SELECT 1 FROM public.group_threads gt
      JOIN public.threads t ON t.id = gt.thread_id AND t.is_deleted = false
      WHERE gt.group_id = p_room_id AND t.author_id = v_caller
    )
    OR EXISTS (
      SELECT 1 FROM public.replies
      WHERE group_id = p_room_id AND author_id = v_caller AND is_deleted = false
    );

  SELECT username INTO v_username FROM public.profiles WHERE id = v_caller;

  INSERT INTO public.friend_group_departed_members (group_id, user_id, username, departed_at)
  VALUES (p_room_id, v_caller, COALESCE(v_username, '?'), now())
  ON CONFLICT (group_id, user_id) DO NOTHING;

  DELETE FROM public.friend_group_members
  WHERE group_id = p_room_id AND user_id = v_caller;

  RETURN jsonb_build_object('ok', true, 'wrote', v_wrote);
END;
$$;

REVOKE ALL ON FUNCTION public.leave_show_room(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.leave_show_room(UUID) TO authenticated;


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
  -- CP5: member display — a ROOMED show lists current room members only
  -- (a leaver's avatar drops for everyone; their vote row stays as history);
  -- a proposal (no room) lists its yes-voters.
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
    LEFT JOIN rooms r
      ON r.show_id = p.show_id
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
    WHERE (rm.user_id IS NOT NULL OR (v.user_id IS NOT NULL AND r.room_id IS NULL))
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
             -- CP5: the caller deliberately left this show's room (departed
             -- marker present) — the client hides the button from THEIR view.
             'viewer_left', (rm.room_id IS NOT NULL AND EXISTS (
                          SELECT 1 FROM public.friend_group_departed_members d
                          WHERE d.group_id = rm.room_id AND d.user_id = v_caller
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
