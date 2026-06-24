-- ============================================================
-- Restructure CP5b — enrich get_people_group_invitation with the
-- inviter's shows, for the pre-account welcome landing (spec §5).
-- ============================================================
-- A brand-new invitee (logged-out, no beta password) opens the invite
-- link and should see, BEFORE creating an account:
--   "@inviter wants to watch these shows: … and is already watching
--    these: …"
-- That data is the inviter's own pool, which a logged-out caller cannot
-- read under RLS. The existing lookup is already SECURITY DEFINER, token-
-- scoped, and granted to anon, so it is the safe place to surface it:
-- exposure is bounded to a holder of a valid, unexpired, unaccepted
-- invite token, and only show NAMES are returned (no ids, no progress
-- numbers).
--
-- Splits the inviter's IN-POOL shows (in_pool = true, i.e. not removed):
--   • already watching = started        (season > 0 OR episode > 0)
--   • wants to watch   = not started yet (season = 0 AND episode = 0)
-- Newest-touched first.
--
-- ADDITIVE + idempotent: CREATE OR REPLACE adds two JSON fields to the
-- return; every existing caller ignores them. No schema change.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_people_group_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_inv       public.people_group_invitations%ROWTYPE;
  v_inviter   TEXT;
  v_members   JSONB;
  v_watching  JSONB;
  v_wants     JSONB;
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
    'expires_at', v_inv.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_people_group_invitation(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_people_group_invitation(TEXT) TO anon, authenticated;
