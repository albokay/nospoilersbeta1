-- ============================================================
-- Phase 6: Two-instance thread model
-- ============================================================
-- When a user posts to both a friend room AND public, two separate
-- thread records are created. Replies are fully isolated.
--
-- source_thread_id:
--   On the PUBLIC clone, points back to the friend-room original.
--   On the friend-room original, NULL.
--   Used to: prevent showing clones in group view, link the two
--   instances together for profile display.
--
-- is_moved (already exists from phase1):
--   Set to true on the friend-room thread when the user "moves"
--   (not just "shares") the post to public. Shows a stub in the
--   friend room so group members see it was removed.
-- ============================================================

-- Add the source_thread_id column (links public clone → original)
ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS source_thread_id text REFERENCES threads(id) ON DELETE SET NULL;

-- Index for clone lookups (e.g. "does a public clone of this thread exist?")
CREATE INDEX IF NOT EXISTS idx_threads_source_thread_id
  ON threads(source_thread_id)
  WHERE source_thread_id IS NOT NULL;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'threads'
--   AND column_name IN ('source_thread_id', 'is_moved', 'moved_context');
-- → should return 3 rows
