-- ============================================================
-- Round 2, Phase 2b — count RPC + vote-notification batching column
-- ============================================================
-- Two small additions on top of phase 2a:
--
--   1. polls.last_vote_notification_at — used by send-message's
--      poll_vote_notification template to enforce a 5-minute batch
--      window per poll. The edge function stamps this on each send
--      and skips sends that fall within 5 minutes of the prior stamp.
--
--   2. get_poll_count(p_poll_id) — returns aggregate response count
--      and eligible count for the asker's "X of N weighed in" footer
--      and any other count-display surface. SECURITY DEFINER so it
--      can read poll_responses without violating the pre-close RLS
--      restriction (which restricts content reads to the responder).
--      Returns counts ONLY, never row content. No content leak.
--
-- Idempotent. Safe to apply: nullable column add + CREATE OR REPLACE.
-- ============================================================


-- ── polls: add last_vote_notification_at column ──────────────────────────

ALTER TABLE public.polls
  ADD COLUMN IF NOT EXISTS last_vote_notification_at TIMESTAMPTZ;


-- ── RPC: get_poll_count ──────────────────────────────────────────────────
-- Returns:
--   { ok: true,  response_count: int, eligible_count: int, closed: bool }
--   { ok: false, error: 'unauthenticated' | 'not_found' | 'not_member' }
--
-- Only group members can call. The asker reads this pre-close to
-- render "X of N weighed in" without ever seeing individual vote rows.

CREATE OR REPLACE FUNCTION public.get_poll_count(p_poll_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller         UUID;
  v_poll           RECORD;
  v_response_count INTEGER;
  v_eligible_count INTEGER;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT id, group_id, closed_at INTO v_poll
  FROM public.polls
  WHERE id = p_poll_id;

  IF v_poll IS NULL OR v_poll.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = v_poll.group_id AND user_id = v_caller
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  SELECT count(*) INTO v_response_count
  FROM public.poll_responses
  WHERE poll_id = p_poll_id;

  SELECT count(*) INTO v_eligible_count
  FROM public.friend_group_members
  WHERE group_id = v_poll.group_id;

  RETURN jsonb_build_object(
    'ok', true,
    'response_count', v_response_count,
    'eligible_count', v_eligible_count,
    'closed', v_poll.closed_at IS NOT NULL
  );
END;
$$;


-- ── execute permissions ──────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.get_poll_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_poll_count(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_poll_count(UUID) TO authenticated;
