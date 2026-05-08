-- ============================================================
-- Round 1, message column on pings (between phase 1b and 1c)
-- ============================================================
-- The v2 amendment added an in-room sticky surface for nudge_same and
-- nudge_behind pings. The sticky renders "the vocabulary line the
-- sender picked" — which must be persisted somewhere, since (a) the
-- preset lines are picker-specific and pings.ping_type alone can't
-- distinguish among the multiple options within a picker, and (b)
-- "write your own" custom lines aren't reconstructible from any enum.
--
-- Adding `message TEXT NULL` to pings. The application layer (edge
-- function in phase 1c) owns the rule:
--   - nudge_ahead → message stays NULL (the actual content goes in
--                   the Resend email body; not persisted)
--   - nudge_same / nudge_behind → message is populated; the in-room
--                                 sticky reads it
--
-- No CHECK constraint enforcing this split. If the product ever
-- evolves to persist email-ping messages as a fallback, it's a
-- single edge-function change rather than a migration.
--
-- Idempotent. Safe — column add on a small table, no defaults firing.
-- ============================================================

ALTER TABLE public.pings
  ADD COLUMN IF NOT EXISTS message TEXT;
