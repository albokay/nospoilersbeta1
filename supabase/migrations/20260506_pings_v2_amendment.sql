-- ============================================================
-- Round 1, v2 spec amendment — schema cleanup + restructure
-- ============================================================
-- Applies on top of phase 1a (already applied). Reflects the spec
-- amendment that:
--   - Cuts the binge / inactivity / banner system entirely
--     → drop the three progress columns added in 1a
--     → the phase 1b trigger file was deleted before applying, no
--       trigger-revert needed
--   - Splits ping vocabulary by sender↔recipient progress direction
--     → swap pings.ping_type CHECK to the three direction values
--   - Splits delivery channel by direction
--     → ahead = email; same / behind = in-room sticky only
--     → schema-side: add dismissed_at column for the sticky-dismissal
--       state, plus a partial index for the "next undismissed" query
--   - Scopes pings per-room, not per-show
--     → add group_id NOT NULL FK to friend_groups
--     → tighten the rate-limit index to use group_id instead of show_id
--     → membership validation (sender + recipient both current members
--       of THIS room) is enforced at the edge-function layer in phase 1c
--   - Adds a no-self-ping CHECK constraint as defensive belt-and-suspenders
--
-- Idempotent. Safe to apply on the live DB:
--   - pings table is empty (verified earlier; please re-verify count
--     before applying — see verification block in chat)
--   - All adds/drops are metadata-only on small/empty tables
--
-- Phase 1b (RLS policies + dismiss_ping RPC) and 1c (send-message edge
-- function) come in separate files after this lands.
--
-- Revert (if needed):
--   - Re-add the three progress columns (ALTER TABLE ADD COLUMN)
--   - Re-swap pings_ping_type_check back to old values
--   - DROP COLUMN dismissed_at, DROP COLUMN group_id, DROP CONSTRAINT
--     pings_no_self_ping_check
--   - Restore the old rate-limit index
-- ============================================================


-- ── progress: drop bolt-on columns from phase 1a ─────────────────────────
-- These were added for binge / inactivity detection. Both detection rules
-- cut from the spec; columns are dead weight. Safe — never written to,
-- no caller reads them.

ALTER TABLE public.progress
  DROP COLUMN IF EXISTS last_advanced_at,
  DROP COLUMN IF EXISTS last_jump_at,
  DROP COLUMN IF EXISTS last_jump_size;


-- ── pings: swap ping_type CHECK ──────────────────────────────────────────
-- Phase 1a created an inline column-level CHECK. PostgreSQL auto-named
-- it (typically pings_ping_type_check, but the exact name isn't
-- guaranteed across server versions). Find and drop it dynamically
-- before adding the new one keyed on the right name.

DO $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.pings'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%ping_type%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.pings DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE public.pings
  ADD CONSTRAINT pings_ping_type_check
  CHECK (ping_type IN ('nudge_ahead', 'nudge_same', 'nudge_behind'));


-- ── pings: add group_id (NOT NULL, FK to friend_groups) ──────────────────
-- Pings are now per-room, not per-show. group_id is set at send time
-- from the sender's currently-active room. Edge function validates both
-- sender and recipient are current members of this group before writing.
--
-- NOT NULL is safe because pings is empty. ON DELETE CASCADE: deleting
-- a friend room takes its pings with it (consistent with other FKs).

ALTER TABLE public.pings
  ADD COLUMN IF NOT EXISTS group_id UUID NOT NULL
    REFERENCES public.friend_groups(id) ON DELETE CASCADE;


-- ── pings: add dismissed_at (NULL = active, timestamp = dismissed) ───────
-- Recipient stamps via the dismiss_ping RPC (phase 1b). Once stamped,
-- the row falls out of the partial index below and out of the
-- recipient's "next undismissed" query.

ALTER TABLE public.pings
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;


-- ── pings: prevent self-pings ────────────────────────────────────────────
-- Defensive at the table layer. Edge function also checks; this is the
-- belt to that suspenders.

ALTER TABLE public.pings
  DROP CONSTRAINT IF EXISTS pings_no_self_ping_check;

ALTER TABLE public.pings
  ADD CONSTRAINT pings_no_self_ping_check
  CHECK (sender_id != recipient_id);


-- ── pings: replace rate-limit index ──────────────────────────────────────
-- Rate-limit is now per-room: "has @sender pinged @recipient in THIS
-- room in the last 7 days?" Old index keyed on show_id; new index
-- keys on group_id.

DROP INDEX IF EXISTS public.pings_rate_limit_idx;

CREATE INDEX IF NOT EXISTS pings_rate_limit_idx
  ON public.pings (sender_id, recipient_id, group_id, sent_at DESC);


-- ── pings: recipient undismissed partial index ───────────────────────────
-- Supports the in-room sticky's "next undismissed ping for me in this
-- room" query:
--   SELECT * FROM pings
--    WHERE recipient_id = $1 AND group_id = $2 AND dismissed_at IS NULL
--    ORDER BY sent_at ASC LIMIT 1;
-- Partial = only undismissed rows are indexed. Dismissing a ping makes
-- it disappear from the index automatically; no maintenance needed.

CREATE INDEX IF NOT EXISTS pings_recipient_undismissed_idx
  ON public.pings (recipient_id, group_id, sent_at ASC)
  WHERE dismissed_at IS NULL;
