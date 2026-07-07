-- ============================================================
-- Social-onboarding CP3 — 3-screen onboarding bootstrap (2026-07-06)
-- ============================================================
-- 1) profiles.social_onboarded_at: the durable once-only gate for the NEW
--    post-demo 3-screen onboarding (show → friend → seed entry). BACKFILLED
--    for every existing profile — only accounts created AFTER this migration
--    ever see the flow. (Invited signups are additionally stamped client-side
--    without seeing it.)
-- 2) people_group_invitations.auto_room_id: the bootstrap show room an
--    invite should auto-opt the accepter into, so the seed entry is reachable
--    the moment they land ("membership on accept"). NULL for ordinary invites.
-- 3) create_people_group_invitation: gains optional p_auto_room_id. All older
--    overloads DROPPED so 2-/3-param calls keep resolving via the defaults.
-- 4) accept_people_group_invitation: after joining the group (and attaching
--    the carried contact name), also enrolls the accepter into auto_room_id
--    when it is a live room of that group. 8-cap checks (phase8) preserved.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS social_onboarded_at TIMESTAMPTZ;

UPDATE public.profiles
  SET social_onboarded_at = now()
  WHERE social_onboarded_at IS NULL;

ALTER TABLE public.people_group_invitations
  ADD COLUMN IF NOT EXISTS auto_room_id UUID REFERENCES public.friend_groups(id) ON DELETE SET NULL;


-- ── create_people_group_invitation: + optional bootstrap room ───────────────
DROP FUNCTION IF EXISTS public.create_people_group_invitation(UUID, TEXT);
DROP FUNCTION IF EXISTS public.create_people_group_invitation(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_people_group_invitation(
  p_group_id              UUID,
  p_email                 TEXT,
  p_invitee_display_name  TEXT DEFAULT NULL,
  p_auto_room_id          UUID DEFAULT NULL
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
  v_name          TEXT;
  v_room          UUID;
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

  -- 8-member cap (phase8 — preserved).
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

  v_name := nullif(btrim(coalesce(p_invitee_display_name, '')), '');

  -- Only honor an auto-room that is a live room OF THIS GROUP.
  v_room := NULL;
  IF p_auto_room_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.friend_groups
    WHERE id = p_auto_room_id AND parent_group_id = p_group_id AND deleted_at IS NULL
  ) THEN
    v_room := p_auto_room_id;
  END IF;

  -- Reuse an existing live pending invite for this (group, email); provided
  -- name / auto-room freshen the carried values (not accepted yet).
  SELECT token INTO v_token
  FROM public.people_group_invitations
  WHERE people_group_id = p_group_id
    AND lower(invitee_email) = v_email
    AND accepted_at IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF v_token IS NOT NULL THEN
    UPDATE public.people_group_invitations
    SET invitee_display_name = COALESCE(v_name, invitee_display_name),
        auto_room_id         = COALESCE(v_room, auto_room_id)
    WHERE token = v_token;
  ELSE
    INSERT INTO public.people_group_invitations (people_group_id, created_by, invitee_email, invitee_display_name, auto_room_id)
    VALUES (p_group_id, v_caller, v_email, v_name, v_room)
    RETURNING token INTO v_token;
  END IF;

  RETURN jsonb_build_object('ok', true, 'token', v_token);
END;
$$;

REVOKE ALL ON FUNCTION public.create_people_group_invitation(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_people_group_invitation(UUID, TEXT, TEXT, UUID) TO authenticated;


-- ── accept_people_group_invitation: + auto-opt into the bootstrap room ──────
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
  v_room          UUID;
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

  -- 8-member cap (phase8 — preserved; allow if already a member — idempotent re-accept).
  IF NOT EXISTS (SELECT 1 FROM public.people_group_members WHERE group_id = v_inv.people_group_id AND user_id = v_caller)
     AND (SELECT count(*) FROM public.people_group_members WHERE group_id = v_inv.people_group_id) >= 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'group_full');
  END IF;

  UPDATE public.people_group_invitations SET accepted_at = now() WHERE id = v_inv.id;

  INSERT INTO public.people_group_members (group_id, user_id)
  VALUES (v_inv.people_group_id, v_caller)
  ON CONFLICT (group_id, user_id) DO NOTHING;

  -- Carry the typed name over to the real person, as the INVITER's private
  -- contact name. First name sticks: never overwrite an established one.
  IF v_inv.invitee_display_name IS NOT NULL AND btrim(v_inv.invitee_display_name) <> '' THEN
    INSERT INTO public.contact_names (owner_id, contact_id, name)
    VALUES (v_inv.created_by, v_caller, btrim(v_inv.invitee_display_name))
    ON CONFLICT (owner_id, contact_id) DO NOTHING;
  END IF;

  -- CP3 bootstrap: auto-opt the accepter into the invite's show room (when it
  -- is still a live room of this group) so the seed entry is reachable. The
  -- validated room id is returned so the client can land the accepter INSIDE
  -- the room.
  v_room := NULL;
  IF v_inv.auto_room_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.friend_groups
    WHERE id = v_inv.auto_room_id AND parent_group_id = v_inv.people_group_id AND deleted_at IS NULL
  ) THEN
    v_room := v_inv.auto_room_id;
    DELETE FROM public.friend_group_departed_members
    WHERE group_id = v_room AND user_id = v_caller;
    INSERT INTO public.friend_group_members (group_id, user_id)
    VALUES (v_room, v_caller)
    ON CONFLICT (group_id, user_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'group_id', v_inv.people_group_id, 'auto_room_id', v_room);
END;
$$;
