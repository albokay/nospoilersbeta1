-- ============================================================================
-- PENDING INVITES: NUDGE & RESCIND — data layer (CP1;
-- spec ~/Downloads/sidebar_pending_invites_changeset.md)
-- ============================================================================
-- • last_nudged_at — the invite's silence clock. The stale signal (gear dot
--   + panel line) fires at 3 days past max(created_at, last_nudged_at),
--   computed client-side; a nudge resets it (set by the send-group-invite
--   edge fn, service role, on a successfully-sent nudge — which also renews
--   expires_at to now()+7d so the nudged link always works).
-- • rescind_people_group_invitation — the inviter deletes their own pending
--   invite (same end-state as the invitee's decline: row gone, link → the
--   "no longer active" screen). Creator-gated: only YOUR invites (Alborz).
-- Reads need no new surface: pg_invitations_select already lets the creator
-- SELECT their own invites, and the new column rides that policy.
-- ============================================================================

ALTER TABLE public.people_group_invitations
  ADD COLUMN IF NOT EXISTS last_nudged_at timestamptz;

CREATE OR REPLACE FUNCTION public.rescind_people_group_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_inv    RECORD;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT id, created_by, accepted_at INTO v_inv
  FROM public.people_group_invitations
  WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_inv.created_by <> v_caller THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_yours');
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_accepted');
  END IF;

  DELETE FROM public.people_group_invitations WHERE id = v_inv.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rescind_people_group_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rescind_people_group_invitation(TEXT) TO authenticated;
