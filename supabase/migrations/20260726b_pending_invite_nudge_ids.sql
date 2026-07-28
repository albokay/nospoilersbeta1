-- ============================================================
-- Help-system QA round 6 — member nudges: invite ids in the pending payload
-- ============================================================
-- Any group member may now NUDGE a pending invite (rescind stays
-- creator-only). Members reference the invite by its ROW ID — the accept
-- token stays creator-only (it's the join link). This adds `invite_id` to
-- get_group_pending_invites' `invites` payload; everything else is the
-- 20260726 body unchanged. Pairs with the send-group-invite redeploy
-- (nudge-by-id + member gate). Safe to re-run.
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
  v_invites  JSONB;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.people_group_members WHERE group_id = p_group_id AND user_id = v_caller) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  WITH pend AS (
    SELECT
      i.id AS invite_id,
      COALESCE(
        NULLIF(btrim(i.invitee_display_name), ''),
        (SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), pr.username)
           FROM auth.users au
           JOIN public.profiles pr ON pr.id = au.id
          WHERE lower(au.email) = lower(i.invitee_email)
          LIMIT 1),
        ''
      ) AS invitee_name,
      i.created_by,
      COALESCE(NULLIF(btrim(ip.display_name), ''), ip.username, '') AS inviter_name,
      i.created_at
    FROM public.people_group_invitations i
    LEFT JOIN public.profiles ip ON ip.id = i.created_by
    WHERE i.people_group_id = p_group_id
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
  )
  SELECT
    jsonb_agg(pend.invitee_name ORDER BY pend.created_at),
    jsonb_agg(jsonb_build_object(
      'invite_id',   pend.invite_id,
      'name',        pend.invitee_name,
      'inviter_id',  pend.created_by,
      'inviter_name', pend.inviter_name,
      'created_at',  pend.created_at
    ) ORDER BY pend.created_at)
  INTO v_handles, v_invites
  FROM pend;

  RETURN jsonb_build_object(
    'ok', true,
    'handles', COALESCE(v_handles, '[]'::jsonb),
    'invites', COALESCE(v_invites, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_pending_invites(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_group_pending_invites(UUID) TO authenticated;
