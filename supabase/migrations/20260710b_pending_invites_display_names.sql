-- First-name identity arc — CP6 (2026-07-10)
-- The dashboard's received-invite cluster was the last live surface naming
-- people by @handle: get_my_pending_group_invites computed usernames in SQL.
-- Extend its payload (ADDITIVE — old keys kept, deployed frontends unaffected):
--   inviter_id           → lets the client apply the viewer's contact name
--   inviter_display_name → inviter's first name (profile, freshest) with the
--                          invite's carried name as fallback
--   members              → [{id, username, display_name}] so the client can
--                          chain contactName → display_name → username
-- Client chain lives in groupNames.ts pendingInvite* helpers; pre-migration
-- frontends fall back to the legacy handle keys.

CREATE OR REPLACE FUNCTION public.get_my_pending_group_invites()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email   TEXT;
  v_invites JSONB;
BEGIN
  v_email := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  IF v_email = '' THEN
    RETURN jsonb_build_object('ok', true, 'invites', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'token', i.token,
             'group_id', i.people_group_id,
             'group_name', g.name,
             'inviter_name', COALESCE(p.username, 'someone'),
             'inviter_id', i.created_by,
             'inviter_display_name', COALESCE(p.display_name, nullif(i.inviter_display_name, '')),
             'member_names', COALESCE((
               SELECT jsonb_agg(pp.username ORDER BY pp.username)
               FROM public.people_group_members m
               JOIN public.profiles pp ON pp.id = m.user_id
               WHERE m.group_id = i.people_group_id
             ), '[]'::jsonb),
             'members', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', pp.id,
                        'username', pp.username,
                        'display_name', pp.display_name
                      ) ORDER BY pp.username)
               FROM public.people_group_members m
               JOIN public.profiles pp ON pp.id = m.user_id
               WHERE m.group_id = i.people_group_id
             ), '[]'::jsonb)
           ) ORDER BY i.created_at DESC
         )
    INTO v_invites
    FROM public.people_group_invitations i
    LEFT JOIN public.profiles p ON p.id = i.created_by
    LEFT JOIN public.people_groups g ON g.id = i.people_group_id
    WHERE lower(i.invitee_email) = v_email
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
      AND NOT EXISTS (
        SELECT 1 FROM public.people_group_members m
        WHERE m.group_id = i.people_group_id AND m.user_id = auth.uid()
      );

  RETURN jsonb_build_object('ok', true, 'invites', COALESCE(v_invites, '[]'::jsonb));
END;
$function$;
