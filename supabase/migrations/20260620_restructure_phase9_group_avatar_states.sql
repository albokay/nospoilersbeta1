-- ============================================================
-- Restructure Phase 9 — group avatar states (top-of-dashboard clusters)
-- ============================================================
-- Supports the rail-less dashboard: each group cluster shows accepted members
-- (resolved client-side) PLUS pending invitees (yellow). Pending invitees come
-- from people_group_invitations, which members who didn't send the invite
-- can't read under RLS — so a member-gated DEFINER lookup is needed.
--
-- Also re-adds group_name to get_my_pending_group_invites so "invited-to-you"
-- clusters can show the group's name.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_group_pending_invites(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_handles  JSONB;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.people_group_members WHERE group_id = p_group_id AND user_id = v_caller) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  -- Email handle (part before @) as the display label; first letter = avatar.
  -- If the invitee already has an account, prefer their username.
  SELECT jsonb_agg(
           COALESCE(
             (SELECT pr.username FROM auth.users au JOIN public.profiles pr ON pr.id = au.id
              WHERE lower(au.email) = lower(i.invitee_email) LIMIT 1),
             split_part(i.invitee_email, '@', 1)
           ) ORDER BY i.created_at
         )
    INTO v_handles
    FROM public.people_group_invitations i
    WHERE i.people_group_id = p_group_id
      AND i.accepted_at IS NULL
      AND i.expires_at > now();

  RETURN jsonb_build_object('ok', true, 'handles', COALESCE(v_handles, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_pending_invites(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_group_pending_invites(UUID) TO authenticated;


-- Re-add group_name to the pending-invites-to-me payload.
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
             'group_name', g.name,
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
    LEFT JOIN public.people_groups g ON g.id = i.people_group_id
    WHERE lower(i.invitee_email) = v_email
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
      AND NOT EXISTS (
        SELECT 1 FROM public.people_group_members m
        WHERE m.group_id = i.people_group_id AND m.user_id = auth.uid()
      );

  RETURN jsonb_build_object('ok', true, 'invites', COALESCE(v_invites, '[]'::jsonb));
END;
$$;
