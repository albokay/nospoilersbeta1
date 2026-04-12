-- ============================================================
-- Phase 5: invitation helper functions (SECURITY DEFINER)
-- ============================================================
-- Two functions that allow non-owners to interact with the
-- invitations table safely:
--
--   get_invitation_by_token(p_token)
--     — Returns minimal invite metadata for the /invite/:token
--       landing page. Safe to call without auth. Returns NULL
--       for invalid / expired / already-accepted tokens. Never
--       exposes the invitee's email to the caller.
--
--   accept_invitation(p_token)
--     — Atomically validates, marks the invite accepted, and
--       adds auth.uid() as a group member. Returns JSON with
--       { ok, group_id, show_id } or { ok: false, error }.
--       Requires the caller to be authenticated.
-- ============================================================

-- ── 1. get_invitation_by_token ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_invitation_by_token(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  inv  invitations%ROWTYPE;
  grp  friend_groups%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM invitations WHERE token = p_token;
  IF NOT FOUND                   THEN RETURN NULL; END IF;
  IF inv.accepted_at IS NOT NULL THEN RETURN NULL; END IF;
  IF inv.expires_at  < now()     THEN RETURN NULL; END IF;

  SELECT * INTO grp FROM friend_groups WHERE id = inv.group_id;

  RETURN json_build_object(
    'id',         inv.id,
    'group_id',   inv.group_id,
    'group_name', grp.name,
    'show_id',    grp.show_id,
    'expires_at', inv.expires_at
  );
END;
$$;

-- ── 2. accept_invitation ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION accept_invitation(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv  invitations%ROWTYPE;
  grp  friend_groups%ROWTYPE;
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

-- ── Done ─────────────────────────────────────────────────────────────────────
-- Verify:
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('get_invitation_by_token', 'accept_invitation');
-- → should return 2 rows.
