-- ============================================================
-- Social-onboarding CP2 — per-viewer contact names (2026-07-06)
-- ============================================================
-- Dual-mode group naming: when a group has NO custom name, each viewer sees it
-- named by the names THEY gave its members (phone-contacts model). The name is
-- typed in the invite form, carried on the invitation row, and attached to the
-- real person for the INVITER once the invite is accepted. A custom group name
-- (already existing) stays a global override for everyone.
--
-- 1) contact_names: per-viewer "the name I gave this person". Owner-only RLS —
--    strictly private to the viewer who typed it.
-- 2) people_group_invitations.invitee_display_name: the typed name in flight.
-- 3) create_people_group_invitation: gains optional p_invitee_display_name
--    (old 2-arg overload DROPPED so 2-param calls resolve via the DEFAULT —
--    pre-deploy frontends keep working).
-- 4) accept_people_group_invitation: on accept, attaches the carried name to
--    the accepter as the inviter's contact name (first name sticks — a later
--    re-invite never overwrites an established contact name).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contact_names (
  owner_id    UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id  UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT         NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_id)
);

ALTER TABLE public.contact_names ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_names_owner ON public.contact_names;
CREATE POLICY contact_names_owner
  ON public.contact_names
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

ALTER TABLE public.people_group_invitations
  ADD COLUMN IF NOT EXISTS invitee_display_name TEXT;


-- ── create_people_group_invitation: + optional invitee display name ─────────
DROP FUNCTION IF EXISTS public.create_people_group_invitation(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.create_people_group_invitation(
  p_group_id              UUID,
  p_email                 TEXT,
  p_invitee_display_name  TEXT DEFAULT NULL
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

  -- Reuse an existing live pending invite for this (group, email); a provided
  -- name freshens the carried one (the invite hasn't been accepted yet).
  SELECT token INTO v_token
  FROM public.people_group_invitations
  WHERE people_group_id = p_group_id
    AND lower(invitee_email) = v_email
    AND accepted_at IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF v_token IS NOT NULL THEN
    IF v_name IS NOT NULL THEN
      UPDATE public.people_group_invitations
      SET invitee_display_name = v_name
      WHERE token = v_token;
    END IF;
  ELSE
    INSERT INTO public.people_group_invitations (people_group_id, created_by, invitee_email, invitee_display_name)
    VALUES (p_group_id, v_caller, v_email, v_name)
    RETURNING token INTO v_token;
  END IF;

  RETURN jsonb_build_object('ok', true, 'token', v_token);
END;
$$;

REVOKE ALL ON FUNCTION public.create_people_group_invitation(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_people_group_invitation(UUID, TEXT, TEXT) TO authenticated;


-- ── accept_people_group_invitation: attach the carried contact name ─────────
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

  RETURN jsonb_build_object('ok', true, 'group_id', v_inv.people_group_id);
END;
$$;
