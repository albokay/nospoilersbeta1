-- ============================================================
-- Restructure Phase 3 — people-group invitations (create / get / accept)
-- ============================================================
-- A self-contained invite path for people-groups, parallel to the existing
-- friend_groups `invitations` flow (which is left entirely untouched). New
-- table + three SECURITY DEFINER RPCs. ADDITIVE, idempotent, safe on live DB.
--
-- Email DELIVERY is intentionally NOT here — the inviter gets a shareable link
-- in-app (CP5a). Wiring Resend send rides in CP5b; the token/accept plumbing is
-- identical regardless of how the link reaches the invitee.
--
-- Recipient binding mirrors accept_invitation: the accepting user's auth email
-- must match the invited email (case-insensitive), returning a masked address
-- on mismatch — no email enumeration.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.people_group_invitations (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  people_group_id  UUID         NOT NULL REFERENCES public.people_groups(id) ON DELETE CASCADE,
  created_by       UUID         NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  invitee_email    TEXT         NOT NULL,
  token            TEXT         NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  expires_at       TIMESTAMPTZ  NOT NULL DEFAULT (now() + interval '48 hours'),
  accepted_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pg_invitations_token_idx    ON public.people_group_invitations (token);
CREATE INDEX IF NOT EXISTS pg_invitations_group_idx    ON public.people_group_invitations (people_group_id);
CREATE INDEX IF NOT EXISTS pg_invitations_email_idx    ON public.people_group_invitations (lower(invitee_email));

-- RLS: the inviter sees invites they sent; the invitee sees invites addressed
-- to their email (drives the "*you're invited" rail state). Writes via RPC only.
ALTER TABLE public.people_group_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pg_invitations_select ON public.people_group_invitations;
CREATE POLICY pg_invitations_select
  ON public.people_group_invitations
  FOR SELECT
  USING (
    created_by = auth.uid()
    OR lower(invitee_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );


-- ── RPC: create_people_group_invitation ────────────────────────────────────
-- Member-gated. Blocks self-invite. Reuses an existing pending invite for the
-- same (group, email) so the link is stable. Returns the token.
CREATE OR REPLACE FUNCTION public.create_people_group_invitation(
  p_group_id  UUID,
  p_email     TEXT
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

  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  SELECT lower(btrim(email)) INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email = v_email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_invite');
  END IF;

  -- Reuse an existing live pending invite for this (group, email).
  SELECT token INTO v_token
  FROM public.people_group_invitations
  WHERE people_group_id = p_group_id
    AND lower(invitee_email) = v_email
    AND accepted_at IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF v_token IS NULL THEN
    INSERT INTO public.people_group_invitations (people_group_id, created_by, invitee_email)
    VALUES (p_group_id, v_caller, v_email)
    RETURNING token INTO v_token;
  END IF;

  RETURN jsonb_build_object('ok', true, 'token', v_token);
END;
$$;


-- ── RPC: get_people_group_invitation ───────────────────────────────────────
-- Token lookup for the accept page. Returns inviter + current member usernames
-- (for the "Join a group with @X and @Y?" copy). Never exposes invitee_email.
-- Callable while signed-out (pre-account landing).
CREATE OR REPLACE FUNCTION public.get_people_group_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_inv      public.people_group_invitations%ROWTYPE;
  v_inviter  TEXT;
  v_members  JSONB;
BEGIN
  SELECT * INTO v_inv FROM public.people_group_invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_accepted');
  END IF;
  IF v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  SELECT username INTO v_inviter FROM public.profiles WHERE id = v_inv.created_by;

  SELECT jsonb_agg(p.username ORDER BY p.username)
    INTO v_members
    FROM public.people_group_members m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.group_id = v_inv.people_group_id;

  RETURN jsonb_build_object(
    'ok', true,
    'group_id', v_inv.people_group_id,
    'inviter_name', coalesce(v_inviter, 'someone'),
    'member_names', coalesce(v_members, '[]'::jsonb),
    'expires_at', v_inv.expires_at
  );
END;
$$;


-- ── RPC: accept_people_group_invitation ────────────────────────────────────
-- Recipient-bound, single-use. Adds the caller to the people-group.
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

  UPDATE public.people_group_invitations SET accepted_at = now() WHERE id = v_inv.id;

  INSERT INTO public.people_group_members (group_id, user_id)
  VALUES (v_inv.people_group_id, v_caller)
  ON CONFLICT (group_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'group_id', v_inv.people_group_id);
END;
$$;


-- ── permissions ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.create_people_group_invitation(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_people_group_invitation(UUID, TEXT) TO authenticated;

-- get is callable signed-out (pre-account landing in CP5b).
REVOKE ALL ON FUNCTION public.get_people_group_invitation(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_people_group_invitation(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.accept_people_group_invitation(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.accept_people_group_invitation(TEXT) TO authenticated;
