-- ============================================================
-- Restructure — tell the invite welcome screen whether the invited
-- address ALREADY has an account.
-- ============================================================
-- The pre-account welcome screen ("@inviter wants to watch.../JOIN IN")
-- is shown to any logged-out visitor of a valid invite link. Today JOIN IN
-- always pushes them into account CREATION — a dead-end for someone who
-- already has an account (e.g. an existing member who happens to be signed
-- out). To route those people into SIGN-IN instead, the screen needs to
-- know, before any account action, whether the invited email is registered.
--
-- That answer lives in auth.users, which a logged-out caller cannot read.
-- This lookup is already SECURITY DEFINER + token-scoped + granted to anon,
-- so it is the safe place to surface a single boolean: exposure is bounded
-- to a holder of a valid, unexpired, unaccepted invite token (sent to that
-- very address). No raw email of anyone else is revealed, so this is not
-- email enumeration.
--
-- ADDITIVE + idempotent: CREATE OR REPLACE adds one JSON field to the
-- return; every existing caller ignores it. No schema change.
-- ============================================================

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

  -- Inviter's in-pool shows they've started watching.
  SELECT jsonb_agg(s.name ORDER BY pr.updated_at DESC NULLS LAST)
    INTO v_watching
    FROM public.progress pr
    JOIN public.shows s ON s.id = pr.show_id
    WHERE pr.user_id = v_inv.created_by
      AND pr.in_pool = true
      AND (pr.season > 0 OR pr.episode > 0)
      AND s.name IS NOT NULL;

  -- Inviter's in-pool shows they want to watch but haven't started.
  SELECT jsonb_agg(s.name ORDER BY pr.updated_at DESC NULLS LAST)
    INTO v_wants
    FROM public.progress pr
    JOIN public.shows s ON s.id = pr.show_id
    WHERE pr.user_id = v_inv.created_by
      AND pr.in_pool = true
      AND pr.season = 0 AND pr.episode = 0
      AND s.name IS NOT NULL;

  -- Does the invited address already have an account? Drives sign-in vs
  -- create-account on the welcome screen's JOIN IN button.
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE lower(btrim(u.email)) = lower(btrim(v_inv.invitee_email))
  ) INTO v_has_account;

  RETURN jsonb_build_object(
    'ok', true,
    'group_id', v_inv.people_group_id,
    'inviter_name', coalesce(v_inviter, 'someone'),
    'member_names', coalesce(v_members, '[]'::jsonb),
    'inviter_watching', coalesce(v_watching, '[]'::jsonb),
    'inviter_wants', coalesce(v_wants, '[]'::jsonb),
    -- The address this token was sent to, so the new-account sign-up can
    -- pre-fill + lock it (the pending invite only surfaces in the rail when
    -- the account's email matches). Returned only to a holder of this valid
    -- token (sent to that very address), so it is not email enumeration.
    'invitee_email', v_inv.invitee_email,
    'invitee_has_account', coalesce(v_has_account, false),
    'expires_at', v_inv.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_people_group_invitation(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_people_group_invitation(TEXT) TO anon, authenticated;
