-- ============================================================
-- 2026-08-14 — Security CP3: close the email→identity oracle (finding 5b).
-- get_group_pending_invites fell back to joining auth.users by email to
-- resolve a real name for a pending invite → any group member could learn
-- the display_name/handle attached to ANY email they put on an invite.
-- Fix: show ONLY the inviter-typed invitee_display_name (which the panel
-- already prefers); drop the email join. Function shape is otherwise
-- byte-identical — same args, same return jsonb, same membership gate.
-- Verified against the live definition before writing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_group_pending_invites(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- Inviter-typed name ONLY (2026-08-14). The removed fallback joined
      -- auth.users by email to fetch the recipient's real name — an
      -- email→identity oracle for any member. Empty was already a possible
      -- output, so the frontend tolerates it; in practice the invite flow
      -- always captures a typed name.
      COALESCE(NULLIF(btrim(i.invitee_display_name), ''), '') AS invitee_name,
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
$function$;
