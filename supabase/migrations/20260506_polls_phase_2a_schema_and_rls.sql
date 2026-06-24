-- ============================================================
-- Round 2, Phase 2a — polls schema + RLS + core RPCs
-- ============================================================
-- Adds the four poll-related tables, RLS policies, and three
-- SECURITY DEFINER RPCs (open_poll, vote_on_poll, dismiss_closed_poll).
--
-- Privacy / integrity property worth pinning here:
--   Pre-close, individual responses are visible ONLY to the responder.
--   The asker reads aggregate counts via a separate SECURITY DEFINER
--   path (added in 2b alongside the email send), NEVER by direct
--   read of poll_responses. RLS on poll_responses enforces this.
--
-- Idempotent. Safe to apply on the live DB:
--   - All four tables are brand-new — no data to migrate
--   - RLS enabled with explicit policies (no "open by default" risk)
--   - RPCs are CREATE OR REPLACE; re-applying is safe
--
-- Phase 2b: edge function templates (poll-invite + poll-close emails)
-- Phase 2c+: frontend (composer, sticky, bloom)
-- ============================================================


-- ── polls ────────────────────────────────────────────────────────────────
-- One row per poll. Open polls: closed_at IS NULL. Closed polls: stamped.
-- Asker on cascade delete of user — when the asker leaves the platform
-- their open polls disappear (and their responses cascade from
-- poll_responses' FK).

CREATE TABLE IF NOT EXISTS public.polls (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  asker_id        UUID         NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  group_id        UUID         NOT NULL REFERENCES public.friend_groups(id) ON DELETE CASCADE,
  question        TEXT         NOT NULL,
  allow_write_in  BOOLEAN      NOT NULL DEFAULT FALSE,
  duration        TEXT         NOT NULL CHECK (duration IN ('24h', '3d', '1w')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS polls_group_id_open_idx
  ON public.polls (group_id, closed_at);


-- ── poll_options ─────────────────────────────────────────────────────────
-- 2-5 options per poll. display_order keeps render stable (composer
-- numbers them 1..5). Cascade from polls.

CREATE TABLE IF NOT EXISTS public.poll_options (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id        UUID         NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  option_text    TEXT         NOT NULL,
  display_order  INTEGER      NOT NULL
);

CREATE INDEX IF NOT EXISTS poll_options_poll_id_order_idx
  ON public.poll_options (poll_id, display_order);


-- ── poll_responses ───────────────────────────────────────────────────────
-- One response per (poll, voter). UNIQUE constraint locks the vote at
-- submit time — can't change after sending (per the round-1 amendment).
-- Either option_id is set (chose a preset) OR write_in_text is set
-- (chose write-in). The XOR-style CHECK enforces this structurally.

CREATE TABLE IF NOT EXISTS public.poll_responses (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id         UUID         NOT NULL REFERENCES public.polls(id)         ON DELETE CASCADE,
  responder_id    UUID         NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  option_id       UUID                  REFERENCES public.poll_options(id)  ON DELETE CASCADE,
  write_in_text   TEXT,
  responded_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT poll_responses_one_choice CHECK (
    (option_id IS NOT NULL AND write_in_text IS NULL)
    OR
    (option_id IS NULL AND write_in_text IS NOT NULL)
  ),
  UNIQUE (poll_id, responder_id)
);

CREATE INDEX IF NOT EXISTS poll_responses_poll_id_idx
  ON public.poll_responses (poll_id);


-- ── poll_dismissals ──────────────────────────────────────────────────────
-- Per-viewer dismissal of CLOSED polls during the 48h post-close window.
-- Composite PK = (poll_id, user_id). Pre-close, the sticky has no
-- dismiss × — these rows only get written for closed polls.

CREATE TABLE IF NOT EXISTS public.poll_dismissals (
  poll_id        UUID         NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id        UUID         NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  dismissed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);


-- ── RLS: polls ───────────────────────────────────────────────────────────
-- Members of the group can SELECT all polls in the group (open or closed).
-- INSERT/UPDATE/DELETE: no policies → all writes via the SECURITY DEFINER
-- RPCs below.

ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS polls_select_member ON public.polls;
CREATE POLICY polls_select_member
  ON public.polls
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.friend_group_members m
      WHERE m.group_id = polls.group_id AND m.user_id = auth.uid()
    )
  );


-- ── RLS: poll_options ────────────────────────────────────────────────────
-- Visible iff parent poll is visible. Same group-membership gate via join.

ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poll_options_select_member ON public.poll_options;
CREATE POLICY poll_options_select_member
  ON public.poll_options
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.polls p
      JOIN public.friend_group_members m
        ON m.group_id = p.group_id AND m.user_id = auth.uid()
      WHERE p.id = poll_options.poll_id
    )
  );


-- ── RLS: poll_responses (the privacy-sensitive one) ──────────────────────
-- Pre-close: caller sees their OWN response only.
-- Post-close: caller sees ALL responses if they're a group member.
-- Asker reads pre-close counts via a SECURITY DEFINER aggregate path
-- (added in 2b), never via direct SELECT — this policy enforces that.
--
-- Specificity note: the OR makes this a "either" check. If both
-- branches match (caller voted AND poll is closed AND caller is
-- member), Postgres union-OR returns the row once, no double-count.

ALTER TABLE public.poll_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poll_responses_select_visibility ON public.poll_responses;
CREATE POLICY poll_responses_select_visibility
  ON public.poll_responses
  FOR SELECT
  USING (
    auth.uid() = responder_id
    OR EXISTS (
      SELECT 1
      FROM public.polls p
      JOIN public.friend_group_members m
        ON m.group_id = p.group_id AND m.user_id = auth.uid()
      WHERE p.id = poll_responses.poll_id
        AND p.closed_at IS NOT NULL
    )
  );


-- ── RLS: poll_dismissals ─────────────────────────────────────────────────
-- Caller's own rows only.

ALTER TABLE public.poll_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poll_dismissals_select_self ON public.poll_dismissals;
CREATE POLICY poll_dismissals_select_self
  ON public.poll_dismissals
  FOR SELECT
  USING (auth.uid() = user_id);


-- ── RPC: open_poll ───────────────────────────────────────────────────────
-- Called by the composer's submit. Validates membership, enforces
-- one-active-poll-per-asker, inserts the poll + options atomically.
--
-- Replacement-with-confirmation:
--   p_replace_existing = false → if asker has an active poll in this
--     room, returns 'has_active_poll' so the frontend can prompt.
--   p_replace_existing = true  → existing active poll closed first,
--     then new poll opens.
--
-- Returns: jsonb { ok, error?, poll_id?, replaced_poll_id? }

CREATE OR REPLACE FUNCTION public.open_poll(
  p_group_id        UUID,
  p_question        TEXT,
  p_allow_write_in  BOOLEAN,
  p_duration        TEXT,
  p_options         TEXT[],
  p_replace_existing BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller         UUID;
  v_existing_poll  UUID;
  v_replaced_id    UUID := NULL;
  v_poll_id        UUID;
  v_option_text    TEXT;
  v_idx            INTEGER := 0;
  v_options_clean  TEXT[];
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  -- Membership check
  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = p_group_id AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  -- Validate inputs
  IF p_question IS NULL OR length(trim(p_question)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'question_empty');
  END IF;
  IF p_duration NOT IN ('24h', '3d', '1w') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_duration');
  END IF;

  -- Trim and drop empty options. Need at least 2 non-empty.
  SELECT array_agg(trim(o)) INTO v_options_clean
  FROM unnest(p_options) AS o
  WHERE o IS NOT NULL AND length(trim(o)) > 0;

  IF v_options_clean IS NULL OR array_length(v_options_clean, 1) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_few_options');
  END IF;
  IF array_length(v_options_clean, 1) > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_many_options');
  END IF;

  -- Existing-active-poll check
  SELECT id INTO v_existing_poll
  FROM public.polls
  WHERE asker_id = v_caller
    AND group_id = p_group_id
    AND closed_at IS NULL
  LIMIT 1;

  IF v_existing_poll IS NOT NULL THEN
    IF NOT p_replace_existing THEN
      RETURN jsonb_build_object('ok', false, 'error', 'has_active_poll', 'existing_poll_id', v_existing_poll);
    END IF;
    -- Close the existing one
    UPDATE public.polls SET closed_at = now() WHERE id = v_existing_poll;
    v_replaced_id := v_existing_poll;
  END IF;

  -- Insert the new poll
  INSERT INTO public.polls (asker_id, group_id, question, allow_write_in, duration)
  VALUES (v_caller, p_group_id, trim(p_question), COALESCE(p_allow_write_in, false), p_duration)
  RETURNING id INTO v_poll_id;

  -- Insert options
  FOREACH v_option_text IN ARRAY v_options_clean LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.poll_options (poll_id, option_text, display_order)
    VALUES (v_poll_id, v_option_text, v_idx);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'poll_id', v_poll_id,
    'replaced_poll_id', v_replaced_id
  );
END;
$$;


-- ── RPC: vote_on_poll ────────────────────────────────────────────────────
-- Records a single vote, enforces one-vote-per-voter (UNIQUE handles
-- this), and lazy-checks the all-voted close condition. If the new
-- vote means everyone in the room has now responded, marks the poll
-- closed and returns did_close=true so the frontend can fire the
-- close email.
--
-- Either p_option_id OR p_write_in is provided, never both. The CHECK
-- on poll_responses also enforces this; the RPC validates first for a
-- cleaner error.
--
-- Returns: jsonb { ok, error?, response_id?, did_close?, response_count?, eligible_count? }

CREATE OR REPLACE FUNCTION public.vote_on_poll(
  p_poll_id    UUID,
  p_option_id  UUID,
  p_write_in   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller          UUID;
  v_poll            RECORD;
  v_response_id     UUID;
  v_did_close       BOOLEAN := FALSE;
  v_response_count  INTEGER;
  v_eligible_count  INTEGER;
  v_write_in_clean  TEXT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT id, group_id, asker_id, allow_write_in, closed_at
  INTO v_poll
  FROM public.polls
  WHERE id = p_poll_id;

  IF v_poll IS NULL OR v_poll.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_poll.closed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'closed');
  END IF;

  -- Membership check
  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = v_poll.group_id AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  -- Validate exactly one of (option_id, write_in)
  IF (p_option_id IS NOT NULL AND p_write_in IS NOT NULL)
     OR (p_option_id IS NULL AND p_write_in IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_vote');
  END IF;

  -- write-in must be allowed on this poll
  IF p_write_in IS NOT NULL THEN
    IF NOT v_poll.allow_write_in THEN
      RETURN jsonb_build_object('ok', false, 'error', 'write_in_not_allowed');
    END IF;
    v_write_in_clean := trim(p_write_in);
    IF length(v_write_in_clean) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'write_in_empty');
    END IF;
  END IF;

  -- option_id (if provided) must belong to this poll
  IF p_option_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.poll_options WHERE id = p_option_id AND poll_id = p_poll_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_option');
    END IF;
  END IF;

  -- Insert (UNIQUE on (poll_id, responder_id) enforces lock)
  BEGIN
    INSERT INTO public.poll_responses (poll_id, responder_id, option_id, write_in_text)
    VALUES (p_poll_id, v_caller, p_option_id, v_write_in_clean)
    RETURNING id INTO v_response_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_voted');
  END;

  -- All-voted close check
  SELECT count(*) INTO v_eligible_count
  FROM public.friend_group_members
  WHERE group_id = v_poll.group_id;

  SELECT count(*) INTO v_response_count
  FROM public.poll_responses
  WHERE poll_id = p_poll_id;

  IF v_response_count >= v_eligible_count THEN
    UPDATE public.polls SET closed_at = now() WHERE id = p_poll_id AND closed_at IS NULL;
    -- The closed_at IS NULL guard handles the race where two parallel
    -- final votes both pass the count check; only one wins the UPDATE.
    GET DIAGNOSTICS v_did_close = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'response_id', v_response_id,
    'did_close', v_did_close,
    'response_count', v_response_count,
    'eligible_count', v_eligible_count
  );
END;
$$;


-- ── RPC: dismiss_closed_poll ─────────────────────────────────────────────
-- Per-viewer dismissal during the 48h post-close window. Idempotent:
-- already-dismissed → returns false; already dismissed within the same
-- call → DO NOTHING. Only meaningful for closed polls (pre-close has
-- no dismiss × in the UI; the RPC is permissive but pointless if open).

CREATE OR REPLACE FUNCTION public.dismiss_closed_poll(p_poll_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_rows   INTEGER;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Caller must be a current member of the poll's group
  IF NOT EXISTS (
    SELECT 1
    FROM public.polls p
    JOIN public.friend_group_members m
      ON m.group_id = p.group_id AND m.user_id = v_caller
    WHERE p.id = p_poll_id
  ) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.poll_dismissals (poll_id, user_id)
  VALUES (p_poll_id, v_caller)
  ON CONFLICT (poll_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;


-- ── execute permissions ──────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.open_poll(UUID, TEXT, BOOLEAN, TEXT, TEXT[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_poll(UUID, TEXT, BOOLEAN, TEXT, TEXT[], BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.open_poll(UUID, TEXT, BOOLEAN, TEXT, TEXT[], BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.vote_on_poll(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vote_on_poll(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.vote_on_poll(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.dismiss_closed_poll(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dismiss_closed_poll(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dismiss_closed_poll(UUID) TO authenticated;
