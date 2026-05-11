-- Shelf-override + shelf-position columns on `progress`
-- ---------------------------------------------------------------
-- Adds two optional per-(user, show) profile-display columns that let the
-- V2 profile page reorder + reshelf tickets without touching watch progress.
--
-- shelf_override: pins a (user, show) to a specific profile shelf regardless
--   of the underlying progress values. NULL = derive shelf from progress
--   (existing behavior). When set, takes priority over both `stopped_watching`
--   and the (s, e) derivation. The constraint enforces one of the four shelf
--   names the v2 profile UI knows about.
--
-- shelf_position: explicit ordering within whatever shelf the row resolves
--   to. NULL = no explicit position; falls back to existing alphabetical (+
--   canon-pin priority for Finished) sort. When set, sorted ascending. After
--   the first drag-reorder in a shelf, the v2 client writes positions for
--   ALL items in that shelf, so position-mode is consistent within a shelf.
--
-- Both columns are purely a profile-display layer. They never affect spoiler
-- filtering, post tagging, friend-room membership, journal-tab existence,
-- or any other behavior outside the V2 profile UI. The v3 journal and live
-- /show surfaces continue to operate on (s, e, stopped_watching) only.
--
-- RLS unchanged: progress's existing owner-write policy already gates these
-- columns. No new policy needed.

ALTER TABLE public.progress
  ADD COLUMN IF NOT EXISTS shelf_override TEXT NULL
    CHECK (shelf_override IS NULL OR shelf_override IN ('watching', 'want', 'finished', 'stopped'));

ALTER TABLE public.progress
  ADD COLUMN IF NOT EXISTS shelf_position INTEGER NULL;
