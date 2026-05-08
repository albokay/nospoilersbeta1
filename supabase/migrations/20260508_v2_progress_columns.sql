-- 2026-05-08 — v2 UI rethink, checkpoint 3.
--
-- Adds six new columns to `progress` for the new four-status show model
-- (want-to-watch / watching-now / finished-watching / stopped-watching),
-- the canon-pin curatorial subset on the public profile, and four
-- per-shelf blurbs that surface on the profile shelves.
--
-- All additive. All default NULL/false. Existing rows unaffected.
-- Existing read paths (live ProfilePage, ShowSection, mobile, etc.)
-- continue to ignore the new columns. Owner-only RLS inherits
-- automatically — no policy updates needed in this migration.
--
-- Public-read for canon_pin + blurb columns (needed by the v2 visitor
-- profile in checkpoint 5) is intentionally NOT wired here. The
-- existing get_public_progress RPC returns a fixed column projection
-- and will be updated alongside checkpoint 5 to surface the new
-- profile-public fields. Keeping migrations scoped to one logical
-- change each.
--
-- Column semantics:
--   stopped_watching  bool  — flips on via the journal-page chevron
--                              "close show / stop watching" action
--                              (lands in checkpoint 8, alongside the
--                              friend-room departure cascade).
--                              Resurrection (re-searching the show)
--                              flips it back off; existing entries +
--                              progress restored, but room
--                              memberships stay gone.
--   canon_pin         bool  — toggled per-show on the user's own
--                              profile, finished-watching shelf.
--                              Pinned shows surface above the
--                              "see all N shows" link with the
--                              orange italic "canon" label.
--   watching_quote    text  — pull-quote on the watching-now shelf.
--   want_reason       text  — reason on the want-to-watch shelf.
--   canon_take        text  — distilled take on a finished-watching
--                              shelf card (pinned or not).
--   stopped_reason    text  — reason on the stopped-watching shelf.
--
-- Length validation for the four text fields is enforced client-side
-- at write time, consistent with how thread/reply body lengths are
-- gated today. No DB-side check constraint here.

ALTER TABLE progress
  ADD COLUMN IF NOT EXISTS stopped_watching boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS canon_pin        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS watching_quote   text,
  ADD COLUMN IF NOT EXISTS want_reason      text,
  ADD COLUMN IF NOT EXISTS canon_take       text,
  ADD COLUMN IF NOT EXISTS stopped_reason   text;
