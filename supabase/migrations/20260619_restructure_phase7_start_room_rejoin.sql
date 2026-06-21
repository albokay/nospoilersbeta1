-- ============================================================
-- Restructure Phase 7 — start_show_room re-joins an existing room
-- ============================================================
-- Bug: after leaving a (group×show) room (via leave-group or remove-from-pool),
-- the room still exists but the user is no longer a member. Opening it again
-- (§9 "Open show room") returned the room id WITHOUT re-adding the caller — so
-- they entered a room the membership-gated map RPC then rejected, and the click
-- model offered "Start a solo show room?" instead of re-opening.
--
-- Fix: when an existing room is found, ensure the caller is a member again and
-- clear their termination dot (§13 "re-joining removes the dots"). On first
-- creation the auto-enroll already covers this. CREATE OR REPLACE, idempotent.
-- ============================================================

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

  -- Auto-enroll opted-in members of THIS group: voters OR watchers, plus the
  -- caller.
  INSERT INTO public.friend_group_members (group_id, user_id)
  SELECT v_room_id, u.user_id
  FROM (
    SELECT v_caller AS user_id
    UNION
    SELECT gsv.user_id
      FROM public.group_show_votes gsv
      WHERE gsv.group_id = p_group_id AND gsv.show_id = p_show_id
    UNION
    SELECT pgm.user_id
      FROM public.people_group_members pgm
      JOIN public.progress pr
        ON pr.user_id = pgm.user_id AND pr.show_id = p_show_id
      WHERE pgm.group_id = p_group_id
  ) AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.friend_group_members fgm
    WHERE fgm.group_id = v_room_id AND fgm.user_id = u.user_id
  );

  RETURN jsonb_build_object('ok', true, 'room_id', v_room_id, 'created', true);
END;
$$;
