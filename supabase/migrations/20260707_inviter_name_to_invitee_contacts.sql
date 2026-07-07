-- ============================================================
-- Contact-naming — the "hi, it's…" name seeds the INVITEE's contacts (2026-07-07)
-- ============================================================
-- The invite form's "hi, it's…" field (stored on the invitation as
-- inviter_display_name since 20260701, written best-effort by the
-- send-group-invite edge function) now ALSO becomes the accepter's contact
-- name for the inviter — the mirror of the existing carry (the typed
-- invitee name becomes the inviter's contact for the accepter). First name
-- sticks in both directions; if the field was left blank the invitee simply
-- sees the inviter's handle until they rename them via the gear.
--
-- Full CREATE OR REPLACE of accept_people_group_invitation, byte-identical
-- to 20260706b_accept_ensures_progress.sql apart from the one new insert.
-- ============================================================

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

  -- NEW: the mirror — the inviter's "hi, it's…" name becomes the ACCEPTER's
  -- contact name for the inviter (first name sticks here too).
  IF v_inv.inviter_display_name IS NOT NULL AND btrim(v_inv.inviter_display_name) <> '' THEN
    INSERT INTO public.contact_names (owner_id, contact_id, name)
    VALUES (v_caller, v_inv.created_by, btrim(v_inv.inviter_display_name))
    ON CONFLICT (owner_id, contact_id) DO NOTHING;
  END IF;

  -- CP3 bootstrap: auto-opt the accepter into the invite's show room (when it
  -- is still a live room of this group) so the seed entry is reachable. The
  -- validated room id is returned so the client can act on it if wanted.
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

    INSERT INTO public.progress (user_id, show_id, season, episode, highest_season, highest_episode, in_pool)
    SELECT v_caller, fg.show_id, 0, 0, 0, 0, false
    FROM public.friend_groups fg
    WHERE fg.id = v_room
    ON CONFLICT (user_id, show_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'group_id', v_inv.people_group_id, 'auto_room_id', v_room);
END;
$$;
