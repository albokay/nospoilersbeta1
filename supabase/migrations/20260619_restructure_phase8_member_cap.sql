-- ============================================================
-- Restructure Phase 8 — 8-member cap on people-groups
-- ============================================================
-- Enforces a max of 8 members per group, server-side (the old friend-room cap
-- was UI-only). CREATE OR REPLACE on the two invite/accept RPCs from phase3,
-- adding a count guard. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_people_group_invitation(
  p_group_id  UUID,
  p_email     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller        UUID;
  v_caller_email  TEXT;
  v_email         TEXT;
  v_token         TEXT;
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

  -- 8-member cap.
  IF (SELECT count(*) FROM public.people_group_members WHERE group_id = p_group_id) >= 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'group_full');
  END IF;

  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  SELECT lower(btrim(email)) INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email = v_email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_invite');
  END IF;

  SELECT token INTO v_token
  FROM public.people_group_invitations
  WHERE people_group_id = p_group_id
    AND lower(invitee_email) = v_email
    AND accepted_at IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF v_token IS NULL THEN
    INSERT INTO public.people_group_invitations (people_group_id, created_by, invitee_email)
    VALUES (p_group_id, v_caller, v_email)
    RETURNING token INTO v_token;
  END IF;

  RETURN jsonb_build_object('ok', true, 'token', v_token);
END;
$$;


CREATE OR REPLACE FUNCTION public.accept_people_group_invitation(p_token TEXT)
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
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_accepted');
  END IF;
  IF v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL
     OR lower(btrim(v_caller_email)) <> lower(btrim(v_inv.invitee_email)) THEN
    v_local  := split_part(v_inv.invitee_email, '@', 1);
    v_domain := string_to_array(split_part(v_inv.invitee_email, '@', 2), '.');
    v_masked := left(v_local, 1) || '***@' || left(v_domain[1], 1) || '***.' ||
                v_domain[array_length(v_domain, 1)];
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_recipient', 'invitee_email_masked', v_masked);
  END IF;

  -- 8-member cap (allow if already a member — idempotent re-accept).
  IF NOT EXISTS (SELECT 1 FROM public.people_group_members WHERE group_id = v_inv.people_group_id AND user_id = v_caller)
     AND (SELECT count(*) FROM public.people_group_members WHERE group_id = v_inv.people_group_id) >= 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'group_full');
  END IF;

  UPDATE public.people_group_invitations SET accepted_at = now() WHERE id = v_inv.id;

  INSERT INTO public.people_group_members (group_id, user_id)
  VALUES (v_inv.people_group_id, v_caller)
  ON CONFLICT (group_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'group_id', v_inv.people_group_id);
END;
$$;
