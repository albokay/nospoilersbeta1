-- ============================================================
-- Restructure Phase 4 — group lifecycle (leave / rename / pending invites)
-- ============================================================
-- Three SECURITY DEFINER RPCs. ADDITIVE, idempotent, no schema change.
--   • leave_people_group       — §13 cascade: drop the caller's votes for this
--     group's shows, leave its (group×show) rooms, leave a termination dot in
--     rooms where they had map history (progress/ratings); friend-room entries
--     and private writing are untouched.
--   • rename_people_group      — set/clear the shared custom name.
--   • get_my_pending_group_invites — invites addressed to the caller's email
--     (drives the rail "*you're invited" state + in-app accept).
-- ============================================================

CREATE OR REPLACE FUNCTION public.leave_people_group(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    UUID;
  v_username  TEXT;
  r           RECORD;
  v_history   BOOLEAN;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.people_group_members WHERE group_id = p_group_id AND user_id = v_caller) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  SELECT username INTO v_username FROM public.profiles WHERE id = v_caller;

  -- Leave every (group × show) room under this group.
  FOR r IN
    SELECT id, show_id FROM public.friend_groups
    WHERE parent_group_id = p_group_id AND deleted_at IS NULL
  LOOP
    IF EXISTS (SELECT 1 FROM public.friend_group_members WHERE group_id = r.id AND user_id = v_caller) THEN
      -- Map history = watch progress (started) or any rating for this show.
      v_history :=
        EXISTS (SELECT 1 FROM public.progress WHERE user_id = v_caller AND show_id = r.show_id AND (season > 0 OR episode > 0))
        OR EXISTS (SELECT 1 FROM public.episode_ratings WHERE user_id = v_caller AND show_id = r.show_id);

      IF v_history AND NOT EXISTS (
        SELECT 1 FROM public.friend_group_departed_members WHERE group_id = r.id AND user_id = v_caller
      ) THEN
        INSERT INTO public.friend_group_departed_members (group_id, user_id, username, departed_at)
        VALUES (r.id, v_caller, COALESCE(v_username, '?'), now());
      END IF;

      DELETE FROM public.friend_group_members WHERE group_id = r.id AND user_id = v_caller;
    END IF;
  END LOOP;

  -- Drop the caller's votes for this group, then leave the people-group.
  DELETE FROM public.group_show_votes WHERE group_id = p_group_id AND user_id = v_caller;
  DELETE FROM public.people_group_members WHERE group_id = p_group_id AND user_id = v_caller;

  RETURN jsonb_build_object('ok', true);
END;
$$;


CREATE OR REPLACE FUNCTION public.rename_people_group(p_group_id UUID, p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_name   TEXT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.people_group_members WHERE group_id = p_group_id AND user_id = v_caller) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF v_name IS NOT NULL AND length(v_name) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name_too_long');
  END IF;

  UPDATE public.people_groups SET name = v_name WHERE id = p_group_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;


CREATE OR REPLACE FUNCTION public.get_my_pending_group_invites()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_email   TEXT;
  v_invites JSONB;
BEGIN
  v_email := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  IF v_email = '' THEN
    RETURN jsonb_build_object('ok', true, 'invites', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'token', i.token,
             'group_id', i.people_group_id,
             'inviter_name', COALESCE(p.username, 'someone'),
             'member_names', COALESCE((
               SELECT jsonb_agg(pp.username ORDER BY pp.username)
               FROM public.people_group_members m
               JOIN public.profiles pp ON pp.id = m.user_id
               WHERE m.group_id = i.people_group_id
             ), '[]'::jsonb)
           ) ORDER BY i.created_at DESC
         )
    INTO v_invites
    FROM public.people_group_invitations i
    LEFT JOIN public.profiles p ON p.id = i.created_by
    WHERE lower(i.invitee_email) = v_email
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
      -- Don't show an invite to a group you're already in.
      AND NOT EXISTS (
        SELECT 1 FROM public.people_group_members m
        WHERE m.group_id = i.people_group_id AND m.user_id = auth.uid()
      );

  RETURN jsonb_build_object('ok', true, 'invites', COALESCE(v_invites, '[]'::jsonb));
END;
$$;


REVOKE ALL ON FUNCTION public.leave_people_group(UUID)            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.leave_people_group(UUID)        TO authenticated;
REVOKE ALL ON FUNCTION public.rename_people_group(UUID, TEXT)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rename_people_group(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_pending_group_invites()      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_pending_group_invites()  TO authenticated;
