-- ============================================================
-- Round 3, Phase 3a — SIKW asks schema + RLS + RPCs
-- ============================================================
-- Adds three new tables (sikw_asks, sikw_replies, sikw_dismissals),
-- RLS policies, four new SECURITY DEFINER RPCs, and updates the
-- open_poll RPC to share the one-active-item slot with SIKW asks
-- per spec.
--
-- Privacy property worth pinning here:
--   sikw_replies are PRIVATE TO ASKER FOREVER. Unlike poll_responses
--   which open up to all room members on close, sikw_replies stay
--   asker-only even post-close. RLS enforces this — there is NO path
--   in this file or in any RPC that exposes one replier's content
--   to any other member (asker excepted, who sees all).
--
-- Idempotent. Safe to apply on the live DB:
--   - All three tables are brand-new
--   - open_poll is updated via CREATE OR REPLACE; PollComposer
--     frontend update lands in the same arc
--
-- Phase 3b: edge function templates (sikw_ask + sikw_reply emails)
-- Phase 3c+: frontend (composer, sticky)
-- ============================================================


-- ── sikw_asks ────────────────────────────────────────────────────────────
-- One row per "should I keep watching?" ask. Auto-closes at 1 week.
-- The asker's progress at send time is stored so friends responding
-- can pick episode targets in the right context.

CREATE TABLE IF NOT EXISTS public.sikw_asks (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  asker_id                 UUID         NOT NULL REFERENCES auth.users(id)            ON DELETE CASCADE,
  group_id                 UUID         NOT NULL REFERENCES public.friend_groups(id)  ON DELETE CASCADE,
  message                  TEXT         NOT NULL,
  asker_progress_season    INTEGER      NOT NULL,
  asker_progress_episode   INTEGER      NOT NULL,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  closed_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sikw_asks_group_id_open_idx
  ON public.sikw_asks (group_id, closed_at);


-- ── sikw_replies ─────────────────────────────────────────────────────────
-- One reply per (ask, replier). UNIQUE locks at submit time.
-- reply_type drives the shape constraint:
--   stick_with_it    → episode_target_* required, message NULL
--   give_until       → episode_target_* required, message NULL
--   dropping_is_fair → both NULL
--   custom           → episode_target_* NULL, message required

CREATE TABLE IF NOT EXISTS public.sikw_replies (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id                   UUID         NOT NULL REFERENCES public.sikw_asks(id) ON DELETE CASCADE,
  replier_id               UUID         NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
  reply_type               TEXT         NOT NULL CHECK (reply_type IN ('stick_with_it', 'give_until', 'dropping_is_fair', 'custom')),
  episode_target_season    INTEGER,
  episode_target_episode   INTEGER,
  message                  TEXT,
  replied_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT sikw_replies_shape_check CHECK (
    (reply_type = 'stick_with_it'    AND episode_target_season IS NOT NULL AND episode_target_episode IS NOT NULL AND message IS NULL)
    OR
    (reply_type = 'give_until'       AND episode_target_season IS NOT NULL AND episode_target_episode IS NOT NULL AND message IS NULL)
    OR
    (reply_type = 'dropping_is_fair' AND episode_target_season IS NULL     AND episode_target_episode IS NULL     AND message IS NULL)
    OR
    (reply_type = 'custom'           AND episode_target_season IS NULL     AND episode_target_episode IS NULL     AND message IS NOT NULL)
  ),
  UNIQUE (ask_id, replier_id)
);

CREATE INDEX IF NOT EXISTS sikw_replies_ask_id_idx
  ON public.sikw_replies (ask_id);


-- ── sikw_dismissals ──────────────────────────────────────────────────────
-- Per-viewer dismissal of CLOSED asks during the 1-week post-close
-- window. Same shape as poll_dismissals.

CREATE TABLE IF NOT EXISTS public.sikw_dismissals (
  ask_id        UUID         NOT NULL REFERENCES public.sikw_asks(id) ON DELETE CASCADE,
  user_id       UUID         NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
  dismissed_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (ask_id, user_id)
);


-- ── RLS: sikw_asks ───────────────────────────────────────────────────────
-- Members of the group can SELECT. INSERT/UPDATE/DELETE via RPCs.

ALTER TABLE public.sikw_asks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sikw_asks_select_member ON public.sikw_asks;
CREATE POLICY sikw_asks_select_member
  ON public.sikw_asks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.friend_group_members m
      WHERE m.group_id = sikw_asks.group_id AND m.user_id = auth.uid()
    )
  );


-- ── RLS: sikw_replies (the privacy-sensitive one) ────────────────────────
-- replier sees own reply. asker of the ask sees ALL replies. NOBODY
-- else, ever — no post-close opening.

ALTER TABLE public.sikw_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sikw_replies_select_visibility ON public.sikw_replies;
CREATE POLICY sikw_replies_select_visibility
  ON public.sikw_replies
  FOR SELECT
  USING (
    auth.uid() = replier_id
    OR EXISTS (
      SELECT 1 FROM public.sikw_asks a
      WHERE a.id = sikw_replies.ask_id
        AND a.asker_id = auth.uid()
    )
  );


-- ── RLS: sikw_dismissals ─────────────────────────────────────────────────

ALTER TABLE public.sikw_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sikw_dismissals_select_self ON public.sikw_dismissals;
CREATE POLICY sikw_dismissals_select_self
  ON public.sikw_dismissals
  FOR SELECT
  USING (auth.uid() = user_id);


-- ── open_poll: updated to share the one-active-item slot ─────────────────
-- Now also checks for active SIKW asks by the same caller in the room.
-- On conflict, returns 'has_active_item' with existing_type indicating
-- which kind of item is active (poll | ask). On replace_existing=true,
-- closes whichever exists.
--
-- Frontend change required: PollComposer (and SIKWComposer in 3c)
-- handle the new error shape.

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
  v_existing_ask   UUID;
  v_replaced_id    UUID := NULL;
  v_replaced_type  TEXT := NULL;
  v_poll_id        UUID;
  v_option_text    TEXT;
  v_idx            INTEGER := 0;
  v_options_clean  TEXT[];
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = p_group_id AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  IF p_question IS NULL OR length(trim(p_question)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'question_empty');
  END IF;
  IF p_duration NOT IN ('24h', '3d', '1w') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_duration');
  END IF;

  SELECT array_agg(trim(o)) INTO v_options_clean
  FROM unnest(p_options) AS o
  WHERE o IS NOT NULL AND length(trim(o)) > 0;

  IF v_options_clean IS NULL OR array_length(v_options_clean, 1) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_few_options');
  END IF;
  IF array_length(v_options_clean, 1) > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_many_options');
  END IF;

  -- Existing-active check (poll OR ask).
  SELECT id INTO v_existing_poll
  FROM public.polls
  WHERE asker_id = v_caller AND group_id = p_group_id AND closed_at IS NULL
  LIMIT 1;

  SELECT id INTO v_existing_ask
  FROM public.sikw_asks
  WHERE asker_id = v_caller AND group_id = p_group_id AND closed_at IS NULL
  LIMIT 1;

  IF v_existing_poll IS NOT NULL OR v_existing_ask IS NOT NULL THEN
    IF NOT p_replace_existing THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'has_active_item',
        'existing_type', CASE WHEN v_existing_poll IS NOT NULL THEN 'poll' ELSE 'ask' END,
        'existing_id',   COALESCE(v_existing_poll, v_existing_ask)
      );
    END IF;
    IF v_existing_poll IS NOT NULL THEN
      UPDATE public.polls     SET closed_at = now() WHERE id = v_existing_poll;
      v_replaced_id := v_existing_poll;
      v_replaced_type := 'poll';
    END IF;
    IF v_existing_ask IS NOT NULL THEN
      UPDATE public.sikw_asks SET closed_at = now() WHERE id = v_existing_ask;
      v_replaced_id := v_existing_ask;
      v_replaced_type := 'ask';
    END IF;
  END IF;

  INSERT INTO public.polls (asker_id, group_id, question, allow_write_in, duration)
  VALUES (v_caller, p_group_id, trim(p_question), COALESCE(p_allow_write_in, false), p_duration)
  RETURNING id INTO v_poll_id;

  FOREACH v_option_text IN ARRAY v_options_clean LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.poll_options (poll_id, option_text, display_order)
    VALUES (v_poll_id, v_option_text, v_idx);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'poll_id', v_poll_id,
    'replaced_id',   v_replaced_id,
    'replaced_type', v_replaced_type
  );
END;
$$;


-- ── RPC: open_ask ────────────────────────────────────────────────────────
-- Mirrors open_poll's shape. Validates membership, enforces shared
-- one-active-item slot (poll OR ask), atomically inserts the ask.

CREATE OR REPLACE FUNCTION public.open_ask(
  p_group_id          UUID,
  p_message           TEXT,
  p_progress_season   INTEGER,
  p_progress_episode  INTEGER,
  p_replace_existing  BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller         UUID;
  v_existing_poll  UUID;
  v_existing_ask   UUID;
  v_replaced_id    UUID := NULL;
  v_replaced_type  TEXT := NULL;
  v_ask_id         UUID;
  v_message_clean  TEXT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = p_group_id AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  v_message_clean := trim(coalesce(p_message, ''));
  IF length(v_message_clean) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'message_empty');
  END IF;
  IF length(v_message_clean) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'message_too_long');
  END IF;

  IF p_progress_season IS NULL OR p_progress_episode IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'progress_required');
  END IF;
  IF p_progress_season < 0 OR p_progress_episode < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'progress_invalid');
  END IF;

  -- Shared one-active-item check.
  SELECT id INTO v_existing_poll
  FROM public.polls
  WHERE asker_id = v_caller AND group_id = p_group_id AND closed_at IS NULL
  LIMIT 1;

  SELECT id INTO v_existing_ask
  FROM public.sikw_asks
  WHERE asker_id = v_caller AND group_id = p_group_id AND closed_at IS NULL
  LIMIT 1;

  IF v_existing_poll IS NOT NULL OR v_existing_ask IS NOT NULL THEN
    IF NOT p_replace_existing THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'has_active_item',
        'existing_type', CASE WHEN v_existing_poll IS NOT NULL THEN 'poll' ELSE 'ask' END,
        'existing_id',   COALESCE(v_existing_poll, v_existing_ask)
      );
    END IF;
    IF v_existing_poll IS NOT NULL THEN
      UPDATE public.polls     SET closed_at = now() WHERE id = v_existing_poll;
      v_replaced_id := v_existing_poll;
      v_replaced_type := 'poll';
    END IF;
    IF v_existing_ask IS NOT NULL THEN
      UPDATE public.sikw_asks SET closed_at = now() WHERE id = v_existing_ask;
      v_replaced_id := v_existing_ask;
      v_replaced_type := 'ask';
    END IF;
  END IF;

  INSERT INTO public.sikw_asks (asker_id, group_id, message, asker_progress_season, asker_progress_episode)
  VALUES (v_caller, p_group_id, v_message_clean, p_progress_season, p_progress_episode)
  RETURNING id INTO v_ask_id;

  RETURN jsonb_build_object(
    'ok', true,
    'ask_id', v_ask_id,
    'replaced_id',   v_replaced_id,
    'replaced_type', v_replaced_type
  );
END;
$$;


-- ── RPC: reply_to_ask ────────────────────────────────────────────────────
-- Records a single reply, validates shape per reply_type, locks at
-- submit (UNIQUE), checks all-replied close (responses >= members - 1
-- since asker doesn't reply to own ask).
--
-- Returns: { ok, error?, reply_id?, did_close?, reply_count?, eligible_count? }

CREATE OR REPLACE FUNCTION public.reply_to_ask(
  p_ask_id                  UUID,
  p_reply_type              TEXT,
  p_episode_target_season   INTEGER,
  p_episode_target_episode  INTEGER,
  p_message                 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller          UUID;
  v_ask             RECORD;
  v_reply_id        UUID;
  v_did_close       BOOLEAN := FALSE;
  v_reply_count     INTEGER;
  v_eligible_count  INTEGER;
  v_message_clean   TEXT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT id, group_id, asker_id, closed_at INTO v_ask
  FROM public.sikw_asks WHERE id = p_ask_id;
  IF v_ask IS NULL OR v_ask.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_ask.closed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'closed');
  END IF;
  IF v_ask.asker_id = v_caller THEN
    RETURN jsonb_build_object('ok', false, 'error', 'asker_cannot_reply');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = v_ask.group_id AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  IF p_reply_type NOT IN ('stick_with_it', 'give_until', 'dropping_is_fair', 'custom') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_reply_type');
  END IF;

  -- Shape validation per reply_type
  IF p_reply_type IN ('stick_with_it', 'give_until') THEN
    IF p_episode_target_season IS NULL OR p_episode_target_episode IS NULL
       OR p_episode_target_season < 1 OR p_episode_target_episode < 1 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'episode_target_required');
    END IF;
    IF p_message IS NOT NULL AND length(trim(p_message)) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'message_not_allowed');
    END IF;
    v_message_clean := NULL;
  ELSIF p_reply_type = 'dropping_is_fair' THEN
    IF p_episode_target_season IS NOT NULL OR p_episode_target_episode IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'episode_target_not_allowed');
    END IF;
    IF p_message IS NOT NULL AND length(trim(p_message)) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'message_not_allowed');
    END IF;
    v_message_clean := NULL;
  ELSE -- custom
    IF p_episode_target_season IS NOT NULL OR p_episode_target_episode IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'episode_target_not_allowed');
    END IF;
    v_message_clean := trim(coalesce(p_message, ''));
    IF length(v_message_clean) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'message_empty');
    END IF;
    IF length(v_message_clean) > 80 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'message_too_long');
    END IF;
  END IF;

  -- Insert (UNIQUE handles double-reply)
  BEGIN
    INSERT INTO public.sikw_replies (ask_id, replier_id, reply_type, episode_target_season, episode_target_episode, message)
    VALUES (
      p_ask_id, v_caller, p_reply_type,
      CASE WHEN p_reply_type IN ('stick_with_it','give_until') THEN p_episode_target_season ELSE NULL END,
      CASE WHEN p_reply_type IN ('stick_with_it','give_until') THEN p_episode_target_episode ELSE NULL END,
      v_message_clean
    )
    RETURNING id INTO v_reply_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_replied');
  END;

  -- Eligible count = members minus asker (asker doesn't reply).
  SELECT count(*) INTO v_eligible_count
  FROM public.friend_group_members
  WHERE group_id = v_ask.group_id
    AND user_id != v_ask.asker_id;

  SELECT count(*) INTO v_reply_count
  FROM public.sikw_replies
  WHERE ask_id = p_ask_id;

  IF v_reply_count >= v_eligible_count THEN
    UPDATE public.sikw_asks SET closed_at = now() WHERE id = p_ask_id AND closed_at IS NULL;
    GET DIAGNOSTICS v_did_close = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reply_id', v_reply_id,
    'did_close', v_did_close,
    'reply_count', v_reply_count,
    'eligible_count', v_eligible_count
  );
END;
$$;


-- ── RPC: dismiss_closed_ask ──────────────────────────────────────────────
-- Same shape as dismiss_closed_poll. Per-viewer dismissal during the
-- 1-week post-close window.

CREATE OR REPLACE FUNCTION public.dismiss_closed_ask(p_ask_id UUID)
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

  -- Caller must be a current member of the ask's group, OR the asker
  -- (asker keeps access to dismiss even if they leave; not a real
  -- concern in v1 since auto-close-on-asker-leave handles departures).
  IF NOT EXISTS (
    SELECT 1
    FROM public.sikw_asks a
    JOIN public.friend_group_members m
      ON m.group_id = a.group_id AND m.user_id = v_caller
    WHERE a.id = p_ask_id
  ) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.sikw_dismissals (ask_id, user_id)
  VALUES (p_ask_id, v_caller)
  ON CONFLICT (ask_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;


-- ── RPC: lazy_close_room_asks ────────────────────────────────────────────
-- Mirror of lazy_close_room_polls. Fixed 1-week duration for SIKW.
-- Race-safe via the closed_at IS NULL guard.

CREATE OR REPLACE FUNCTION public.lazy_close_room_asks(p_group_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_closed UUID[];
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN ARRAY[]::UUID[];
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = p_group_id AND user_id = v_caller
  ) THEN
    RETURN ARRAY[]::UUID[];
  END IF;

  WITH closed_now AS (
    UPDATE public.sikw_asks
       SET closed_at = now()
     WHERE group_id  = p_group_id
       AND closed_at IS NULL
       AND now() > created_at + interval '7 days'
    RETURNING id
  )
  SELECT array_agg(id) INTO v_closed FROM closed_now;

  RETURN COALESCE(v_closed, ARRAY[]::UUID[]);
END;
$$;


-- ── execute permissions ──────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.open_ask(UUID, TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_ask(UUID, TEXT, INTEGER, INTEGER, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.open_ask(UUID, TEXT, INTEGER, INTEGER, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.reply_to_ask(UUID, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reply_to_ask(UUID, TEXT, INTEGER, INTEGER, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reply_to_ask(UUID, TEXT, INTEGER, INTEGER, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.dismiss_closed_ask(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dismiss_closed_ask(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dismiss_closed_ask(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.lazy_close_room_asks(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lazy_close_room_asks(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.lazy_close_room_asks(UUID) TO authenticated;
