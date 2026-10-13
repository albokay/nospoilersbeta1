-- ============================================================
-- Cancel pitch (Alborz's notes, round 5 — 2026-10-13)
-- ============================================================
-- The pitcher takes a pitch back that nobody else has joined: the show
-- leaves the group with no trace. Member-gated, SECURITY DEFINER like
-- set_show_vote / leave_show_room.
--
--   cancel_pitch(p_group_id, p_show_id)
--     • refuses ('others_in') when anyone else holds a vote on the show in
--       this group or sits in its room — the client treats that case as the
--       pitcher's own opt-out instead;
--     • deletes the caller's vote;
--     • soft-deletes the (group × show) room (deleted_at) when it exists —
--       by then the caller is its only member;
--     • deletes every answer (group_show_passes) and every per-person
--       dismissal (group_show_dismissals) on the show in this group, so a
--       later re-pitch starts clean.
--   Returns jsonb { ok, error? | removed }.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_pitch(p_group_id UUID, p_show_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_room   UUID;
  v_others INTEGER;
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

  SELECT id INTO v_room
  FROM public.friend_groups
  WHERE parent_group_id = p_group_id AND show_id = p_show_id AND deleted_at IS NULL
  LIMIT 1;

  SELECT count(*) INTO v_others FROM (
    SELECT user_id FROM public.group_show_votes
      WHERE group_id = p_group_id AND show_id = p_show_id AND user_id <> v_caller
    UNION
    SELECT user_id FROM public.friend_group_members
      WHERE v_room IS NOT NULL AND group_id = v_room AND user_id <> v_caller
  ) o;
  IF v_others > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'others_in');
  END IF;

  DELETE FROM public.group_show_votes
    WHERE group_id = p_group_id AND show_id = p_show_id AND user_id = v_caller;
  DELETE FROM public.group_show_passes
    WHERE group_id = p_group_id AND show_id = p_show_id;
  DELETE FROM public.group_show_dismissals
    WHERE group_id = p_group_id AND show_id = p_show_id;

  IF v_room IS NOT NULL THEN
    UPDATE public.friend_groups SET deleted_at = now() WHERE id = v_room;
  END IF;

  RETURN jsonb_build_object('ok', true, 'removed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_pitch(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_pitch(UUID, TEXT) TO authenticated;
