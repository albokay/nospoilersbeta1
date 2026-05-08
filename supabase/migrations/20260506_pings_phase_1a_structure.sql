-- ============================================================
-- Round 1, Phase 1a — additive structure for pings + progress columns
-- ============================================================
-- Adds three nullable columns to `progress` for binge / inactivity
-- detection, and creates the `pings` table for one-way friend nudges.
--
-- Phase 1a is STRUCTURE ONLY — no triggers, no RLS policies, no callers.
--   Phase 1b will add the trigger that maintains the new progress cols.
--   Phase 1c will add RLS policies on pings (SELECT-for-sender-only).
--   Phase 1d will deploy the edge function that writes pings + sends mail.
--
-- This phase is safe to apply in production:
--   - Nullable column adds with no defaults are non-blocking and affect
--     no existing reads or writes.
--   - The new pings table has RLS enabled with zero policies, so it is
--     locked from every non-service-role caller until phase 1c.
--   - No client code calls any of this yet — the new UI is gated behind
--     a Netlify branch deploy + VITE_FEATURE_PINGS_POLLS flag.
--
-- Idempotent: every statement uses IF NOT EXISTS so re-applying is safe.
-- ============================================================


-- ── progress: bolt-on columns for advance-tracking ───────────────────────
-- last_advanced_at: stamped when the user makes a real forward advance
--   (forward movement of highest_season/episode in absolute episode index
--   terms). Maintained by the trigger added in phase 1b. Nullable because
--   existing rows have no recorded advance time and first-time INSERTs
--   have no prior position to compare against.
-- last_jump_at: same value as last_advanced_at for round 1. Kept as a
--   separate column so the semantics can later evolve independently
--   (e.g. only stamp on jumps >= 3 episodes) without renaming.
-- last_jump_size: episode count of the advance in absolute episode index,
--   computed by the trigger via shows.seasons[].

ALTER TABLE public.progress
  ADD COLUMN IF NOT EXISTS last_advanced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_jump_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_jump_size   INTEGER;


-- ── pings: minimal row per ping for rate limiting + dedup ────────────────
-- No message content is stored. The email body is constructed at send time
-- and not persisted. Rows exist purely to support the 7-day rate-limit
-- check ("has @sender pinged @recipient about @show in the last 7 days?").
--
-- Cascade deletes from auth.users / shows: pings are ephemeral signals,
-- not historical records — losing them when the underlying entities go
-- away is correct.

CREATE TABLE IF NOT EXISTS public.pings (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id     UUID         NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  recipient_id  UUID         NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  show_id       TEXT         NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  ping_type     TEXT         NOT NULL CHECK (ping_type IN ('nudge','quiet_check_in','binge_response')),
  sent_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ── pings: rate-limit lookup index ───────────────────────────────────────
-- Supports the edge function's pre-insert check (phase 1d):
--   SELECT 1 FROM pings
--    WHERE sender_id = $1 AND recipient_id = $2 AND show_id = $3
--      AND sent_at > now() - interval '7 days'
--    LIMIT 1;
-- Three exact-match columns first, sent_at DESC last for the range scan.

CREATE INDEX IF NOT EXISTS pings_rate_limit_idx
  ON public.pings (sender_id, recipient_id, show_id, sent_at DESC);


-- ── pings: RLS enabled, no policies → locked down ────────────────────────
-- With RLS enabled and zero policies, all REST access is denied for any
-- non-service-role caller. This is the deliberate phase-1a state: the
-- table exists, the edge function (phase 1d) writes via service role
-- (bypasses RLS), and regular users can't read or write anything yet.
-- Phase 1c adds the SELECT-for-sender-only policy.

ALTER TABLE public.pings ENABLE ROW LEVEL SECURITY;
