-- ============================================================
-- 2026-10-17 — get_invite_letter: the inviter's first letter, for the
-- invitee's way in (Alborz's invitee-flow pass).
--
-- The invite email, the invite page, the account page, the You're-in card
-- and the confirmation email now lead with "Yalborz wrote you a letter about
-- Severance". This token-gated lookup says whether that letter exists and
-- where it's stamped — NEVER its title or words:
--   • the invite's room (people_group_invitations.auto_room_id, the room the
--     onboarding letter was written in), still open, the inviter still in it
--   • the inviter's EARLIEST live letter linked into that room
--   • its stamp (sealed for a brand-new invitee when past S0 E0) and the
--     inviter's current progress on the show
-- An invite with no room (a later "invite more friends" from the group) or
-- no letter returns NULL, and every surface keeps its old wording.
--
-- Token-gated + anon-callable, the trust model of get_invite_pool: holding
-- the invite link IS the permission, and only a show id/name and two stamps
-- come back.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_invite_letter(invite_token text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'show_id', fg.show_id,
    'show_name', s.name,
    'season', COALESCE(t.season, 0),
    'episode', COALESCE(t.episode, 0),
    'inviter_season', COALESCE(p.season, 0),
    'inviter_episode', COALESCE(p.episode, 0)
  )
  FROM public.people_group_invitations i
  JOIN public.friend_groups fg
    ON fg.id = i.auto_room_id AND fg.deleted_at IS NULL
  JOIN public.friend_group_members fgm
    ON fgm.group_id = fg.id AND fgm.user_id = i.created_by
  JOIN public.shows s ON s.id = fg.show_id
  JOIN public.group_threads gt ON gt.group_id = fg.id
  JOIN public.threads t
    ON t.id = gt.thread_id AND t.author_id = i.created_by AND COALESCE(t.is_deleted, false) = false
  LEFT JOIN public.progress p
    ON p.user_id = i.created_by AND p.show_id = fg.show_id
  WHERE i.token = invite_token
  ORDER BY t.created_at ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_invite_letter(text) TO anon, authenticated, service_role;

-- Verify (expect the newest invites' first letters; NULL for room-less ones):
-- SELECT i.created_at::date, public.get_invite_letter(i.token)
-- FROM public.people_group_invitations i ORDER BY i.created_at DESC LIMIT 5;
