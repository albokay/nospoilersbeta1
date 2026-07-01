-- ============================================================================
-- 2026-07-01 — Invite flow: inviter display name.
--
-- Lets the inviter attach a recognizable name (e.g. "Johnny") so the invitee
-- sees "Johnny (@jjny3221)" instead of a bare handle they might not recognize.
-- The name is written by the send-group-invite edge function (service role) and
-- returned here so the welcome screen can show it. Falls back to the @username
-- when absent.
-- ============================================================================

ALTER TABLE public.people_group_invitations
  ADD COLUMN IF NOT EXISTS inviter_display_name text;

-- Re-declare get_people_group_invitation to also return inviter_display_name.
-- (Same body as 20260624_restructure_invite_has_account.sql + one field.)
CREATE OR REPLACE FUNCTION public.get_people_group_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_inv          public.people_group_invitations%ROWTYPE;
  v_inviter      TEXT;
  v_members      JSONB;
  v_watching     JSONB;
  v_wants        JSONB;
  v_has_account  BOOLEAN;
BEGIN
  SELECT * INTO v_inv FROM public.people_group_invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_accepted');
  END IF;
  IF v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  SELECT username INTO v_inviter FROM public.profiles WHERE id = v_inv.created_by;

  SELECT jsonb_agg(p.username ORDER BY p.username)
    INTO v_members
    FROM public.people_group_members m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.group_id = v_inv.people_group_id;

  SELECT jsonb_agg(s.name ORDER BY pr.updated_at DESC NULLS LAST)
    INTO v_watching
    FROM public.progress pr
    JOIN public.shows s ON s.id = pr.show_id
    WHERE pr.user_id = v_inv.created_by
      AND pr.in_pool = true
      AND (pr.season > 0 OR pr.episode > 0)
      AND s.name IS NOT NULL;

  SELECT jsonb_agg(s.name ORDER BY pr.updated_at DESC NULLS LAST)
    INTO v_wants
    FROM public.progress pr
    JOIN public.shows s ON s.id = pr.show_id
    WHERE pr.user_id = v_inv.created_by
      AND pr.in_pool = true
      AND pr.season = 0 AND pr.episode = 0
      AND s.name IS NOT NULL;

  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE lower(btrim(u.email)) = lower(btrim(v_inv.invitee_email))
  ) INTO v_has_account;

  RETURN jsonb_build_object(
    'ok', true,
    'group_id', v_inv.people_group_id,
    'inviter_name', coalesce(v_inviter, 'someone'),
    'inviter_display_name', v_inv.inviter_display_name,
    'member_names', coalesce(v_members, '[]'::jsonb),
    'inviter_watching', coalesce(v_watching, '[]'::jsonb),
    'inviter_wants', coalesce(v_wants, '[]'::jsonb),
    'invitee_email', v_inv.invitee_email,
    'invitee_has_account', coalesce(v_has_account, false),
    'expires_at', v_inv.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_people_group_invitation(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_people_group_invitation(TEXT) TO anon, authenticated;
