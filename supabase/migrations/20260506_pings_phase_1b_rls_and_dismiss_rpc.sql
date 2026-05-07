-- ============================================================
-- Round 1, Phase 1b — RLS policies on pings + dismiss_ping RPC
-- ============================================================
-- pings table has RLS enabled (since phase 1a) with zero policies,
-- meaning all access is denied. This phase opens it up for the read
-- and dismissal patterns the round-1 frontend needs.
--
-- Three things land here:
--
--   1. SELECT policy. Caller can read rows where they're sender OR
--      recipient. Covers the recipient's "next undismissed ping for me
--      in this room" sticky read AND any future sender-side surface
--      (none in round 1, but harmless to allow given the structural
--      symmetry — sender already knows what they sent).
--
--   2. No INSERT / UPDATE / DELETE policies. Means: regular users have
--      no path to write pings rows directly via the REST API. All
--      writes go through SECURITY DEFINER paths:
--        - INSERT via the send-message edge function (service role)
--        - UPDATE via the dismiss_ping RPC below
--        - DELETE never — rows are append-only + dismissal-stamped
--
--   3. dismiss_ping(p_ping_id uuid) SECURITY DEFINER RPC. The frontend
--      calls this when the recipient clicks × on the in-room sticky.
--      Returns boolean: TRUE if this call dismissed the row, FALSE
--      otherwise (uniform across "not found" / "not yours" / "already
--      dismissed" so the caller can't probe ping IDs).
--
-- Idempotent: DROP POLICY IF EXISTS / CREATE OR REPLACE FUNCTION on the
-- RPC. Re-applying replaces cleanly.
--
-- Revert (one-line rollback if needed):
--   DROP POLICY IF EXISTS pings_select_self ON public.pings;
--   DROP FUNCTION IF EXISTS public.dismiss_ping(uuid);
-- ============================================================


-- ── pings: SELECT policy (sender OR recipient) ───────────────────────────

DROP POLICY IF EXISTS pings_select_self ON public.pings;

CREATE POLICY pings_select_self
  ON public.pings
  FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);


-- ── dismiss_ping RPC ─────────────────────────────────────────────────────
-- Recipient stamps dismissed_at on an active ping. Bypasses RLS via
-- SECURITY DEFINER (the function owner has implicit BYPASSRLS).
--
-- WHERE clause inside the UPDATE is the entire authorization gate:
--   id = p_ping_id          → the specific ping
--   recipient_id = caller   → caller must be the recipient
--   dismissed_at IS NULL    → the ping must currently be active
-- Any condition failing produces a 0-row UPDATE → returns FALSE.
--
-- This means the function is uniformly silent: a caller passing a
-- random UUID, a UUID belonging to someone else's ping, or a UUID for
-- an already-dismissed ping all get the same FALSE response. No
-- existence oracle, no privilege oracle.

CREATE OR REPLACE FUNCTION public.dismiss_ping(p_ping_id UUID)
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
    RETURN FALSE;  -- unauthenticated; defensive (REVOKE below also blocks)
  END IF;

  UPDATE public.pings
     SET dismissed_at = now()
   WHERE id            = p_ping_id
     AND recipient_id  = v_caller
     AND dismissed_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;


-- ── execute permissions ──────────────────────────────────────────────────
-- Lock down so anonymous role can't call. Standard pattern for SECURITY
-- DEFINER RPCs in this codebase.

REVOKE ALL ON FUNCTION public.dismiss_ping(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dismiss_ping(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dismiss_ping(UUID) TO authenticated;
