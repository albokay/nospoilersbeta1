-- ============================================================
-- 2026-04-23: invite-recipient binding on accept_invitation
-- ============================================================
-- Before: accept_invitation(p_token) validated the token (exists,
-- not expired, not already accepted) and then added auth.uid() to
-- the friend group, regardless of whether the caller's auth email
-- matched the invitation's invitee_email. Any authenticated user
-- holding a valid token could accept an invitation addressed to
-- someone else.
--
-- After: the caller's auth.users.email must match invitee_email
-- (case-insensitive, trimmed). Mismatches return a `wrong_recipient`
-- error, along with a MASKED invitee email so the legitimate
-- recipient can recognize which of their addresses received the
-- invite without the full string being exposed on the wire.
--
-- Masking rationale: Supabase Auth's "Confirm email" is currently
-- off in this project. Revealing the full invitee_email to anyone
-- holding the token would hand an attacker the exact string they'd
-- need to sign up fresh as the recipient and bypass this check.
-- The mask (b***@e***.com) keeps the UX benefit (recipient
-- recognizes their other email at a glance) without that leak.
--
-- Revert: re-run the CREATE OR REPLACE from phase5-invitations.sql
-- to drop the recipient check back out.
-- ============================================================

CREATE OR REPLACE FUNCTION accept_invitation(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv           invitations%ROWTYPE;
  grp           friend_groups%ROWTYPE;
  caller_email  text;
  local_part    text;
  domain_parts  text[];
  masked_email  text;
BEGIN
  -- Lock the row to prevent double-accept races
  SELECT * INTO inv FROM invitations WHERE token = p_token FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'already_accepted');
  END IF;
  IF inv.expires_at < now() THEN
    RETURN json_build_object('ok', false, 'error', 'expired');
  END IF;

  -- Recipient check: caller's auth email must match invitee_email
  -- (case-insensitive, trimmed). auth.users lookup used instead of
  -- auth.jwt() ->> 'email' for reliability across auth flows.
  SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();
  IF caller_email IS NULL
     OR lower(btrim(caller_email)) <> lower(btrim(inv.invitee_email))
  THEN
    -- Mask: first char of local part, first char of first domain
    -- label, full last TLD segment. "bob@example.com" -> "b***@e***.com"
    local_part   := split_part(inv.invitee_email, '@', 1);
    domain_parts := string_to_array(split_part(inv.invitee_email, '@', 2), '.');
    masked_email :=
      left(local_part, 1) || '***@' ||
      left(domain_parts[1], 1) || '***.' ||
      domain_parts[array_length(domain_parts, 1)];
    RETURN json_build_object(
      'ok', false,
      'error', 'wrong_recipient',
      'invitee_email_masked', masked_email
    );
  END IF;

  -- Mark accepted
  UPDATE invitations SET accepted_at = now() WHERE id = inv.id;

  -- Add the calling user as a member (idempotent)
  INSERT INTO friend_group_members (group_id, user_id)
  VALUES (inv.group_id, auth.uid())
  ON CONFLICT DO NOTHING;

  SELECT * INTO grp FROM friend_groups WHERE id = inv.group_id;

  RETURN json_build_object(
    'ok',       true,
    'group_id', inv.group_id,
    'show_id',  grp.show_id
  );
END;
$$;
