-- ============================================================
-- Decline a people-group invitation (recipient-bound, deletes the row).
-- ============================================================
-- The invitee's "Join a group with @X?" prompt only had Yes / close — with no
-- way to get an awaiting invite OFF the dashboard short of joining. "no" now
-- declines: this RPC verifies the caller is the addressed recipient (same
-- masking as accept, so no enumeration) and DELETEs the invitation, which
-- clears it from the invitee's rail AND the inviter's pending-avatar lookup.
-- The inviter can always re-send (createPeopleGroupInvite mints a fresh row).
-- ADDITIVE + idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.decline_people_group_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller        UUID;
  v_caller_email  TEXT;
  v_inv           public.people_group_invitations%ROWTYPE;
  v_local         TEXT;
  v_domain        TEXT[];
  v_masked        TEXT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO v_inv FROM public.people_group_invitations WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    -- Already gone (declined/expired/cleaned up) → treat as success (idempotent).
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_accepted');
  END IF;

  -- Recipient binding (identical masking to accept_people_group_invitation).
  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL
     OR lower(btrim(v_caller_email)) <> lower(btrim(v_inv.invitee_email)) THEN
    v_local  := split_part(v_inv.invitee_email, '@', 1);
    v_domain := string_to_array(split_part(v_inv.invitee_email, '@', 2), '.');
    v_masked := left(v_local, 1) || '***@' || left(v_domain[1], 1) || '***.' ||
                v_domain[array_length(v_domain, 1)];
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_recipient', 'invitee_email_masked', v_masked);
  END IF;

  DELETE FROM public.people_group_invitations WHERE id = v_inv.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.decline_people_group_invitation(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.decline_people_group_invitation(TEXT) TO authenticated;
