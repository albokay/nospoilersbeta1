-- ============================================================
-- Phase 4 fix: drop show_id FK on friend_groups
-- ============================================================
-- The original phase1 migration added a FK: friend_groups.show_id → shows(id)
-- This breaks group creation for shows that only exist as seeds in the app
-- (not as rows in the `shows` table).  Since show_id is just used as a filter
-- string (no cascading behaviour needed from our side), the FK is unnecessary.
-- ============================================================

ALTER TABLE friend_groups
  DROP CONSTRAINT IF EXISTS friend_groups_show_id_fkey;

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'friend_groups'::regclass AND contype = 'f';
-- → should return 2 rows (created_by FK only), not 3.
