-- ============================================================
-- Phase 1: Sidebar Restructure — Schema Foundation
-- Run this in Supabase SQL Editor (project dashboard > SQL Editor)
-- ============================================================

-- ── 1. threads: replace is_private with is_public ────────────────────────────

ALTER TABLE threads ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- Migrate existing data: public posts (is_private=false) become is_public=true
UPDATE threads SET is_public = NOT COALESCE(is_private, false);

-- Add is_moved for tombstone support (Phase 3: move vs share)
ALTER TABLE threads ADD COLUMN IF NOT EXISTS is_moved boolean NOT NULL DEFAULT false;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS moved_context text;  -- e.g. 'public' or group name

-- Index for aggregated show page query
CREATE INDEX IF NOT EXISTS idx_threads_is_public ON threads(show_id, is_public)
  WHERE is_public = true AND is_deleted = false;

-- ── 2. friend_groups table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS friend_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id    text NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_friend_groups_show_id    ON friend_groups(show_id);
CREATE INDEX IF NOT EXISTS idx_friend_groups_created_by ON friend_groups(created_by);

-- ── 3. friend_group_members table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS friend_group_members (
  group_id  uuid NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES profiles(id)      ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_group_members_user_id  ON friend_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_friend_group_members_group_id ON friend_group_members(group_id);

-- ── 4. group_threads table ────────────────────────────────────────────────────
-- Tracks which threads have been shared to which friend groups.
-- A thread can be in multiple groups and also be public simultaneously.

CREATE TABLE IF NOT EXISTS group_threads (
  group_id  uuid NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES threads(id)       ON DELETE CASCADE,
  shared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_group_threads_group_id  ON group_threads(group_id);
CREATE INDEX IF NOT EXISTS idx_group_threads_thread_id ON group_threads(thread_id);

-- ── 5. replies: add group_id for group-scoped reply chains ───────────────────
-- null = public thread reply; non-null = reply made in a specific group's context

ALTER TABLE replies ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES friend_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_replies_group_id ON replies(group_id)
  WHERE group_id IS NOT NULL;

-- ── 6. invitations table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES profiles(id)      ON DELETE CASCADE,
  invitee_email text NOT NULL,
  token         text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token     ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_group_id  ON invitations(group_id);
CREATE INDEX IF NOT EXISTS idx_invitations_created_by ON invitations(created_by);

-- ── 7. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE friend_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_threads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations          ENABLE ROW LEVEL SECURITY;

-- friend_groups policies -------------------------------------------------------

CREATE POLICY "members can view their groups"
  ON friend_groups FOR SELECT
  USING (
    id IN (SELECT group_id FROM friend_group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "authenticated users can create groups"
  ON friend_groups FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());

CREATE POLICY "creator can update group"
  ON friend_groups FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY "creator can delete group"
  ON friend_groups FOR DELETE
  USING (created_by = auth.uid());

-- friend_group_members policies ------------------------------------------------

CREATE POLICY "members can view group membership"
  ON friend_group_members FOR SELECT
  USING (
    group_id IN (SELECT group_id FROM friend_group_members WHERE user_id = auth.uid())
  );

-- INSERT is handled by the invite acceptance edge function (service role).
-- Direct inserts are only allowed by the group creator (for adding themselves on creation).
CREATE POLICY "group creator can add members"
  ON friend_group_members FOR INSERT
  WITH CHECK (
    group_id IN (SELECT id FROM friend_groups WHERE created_by = auth.uid())
  );

CREATE POLICY "user can leave group, or creator can remove member"
  ON friend_group_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR group_id IN (SELECT id FROM friend_groups WHERE created_by = auth.uid())
  );

-- group_threads policies -------------------------------------------------------

CREATE POLICY "group members can view group threads"
  ON group_threads FOR SELECT
  USING (
    group_id IN (SELECT group_id FROM friend_group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "group members can share threads to group"
  ON group_threads FOR INSERT
  WITH CHECK (
    group_id IN (SELECT group_id FROM friend_group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "thread author or group creator can remove from group"
  ON group_threads FOR DELETE
  USING (
    group_id IN (SELECT id FROM friend_groups WHERE created_by = auth.uid())
    OR thread_id IN (SELECT id FROM threads WHERE author_id = auth.uid())
  );

-- invitations policies ---------------------------------------------------------

CREATE POLICY "creator can insert invitations"
  ON invitations FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND group_id IN (SELECT id FROM friend_groups WHERE created_by = auth.uid())
  );

CREATE POLICY "creator can view their sent invitations"
  ON invitations FOR SELECT
  USING (created_by = auth.uid());

-- Accept page: fetching an invitation by token is done via a Supabase Edge Function
-- (service role key) so no additional SELECT policy needed here for anonymous users.

-- ── 8. Optional: keep is_private column for rollback safety ──────────────────
-- The is_private column is now deprecated. After confirming Phase 1 works
-- correctly in production for a few days, drop it with:
--
--   ALTER TABLE threads DROP COLUMN IF EXISTS is_private;
--
-- Do NOT drop it yet — it provides a rollback path if needed.

-- ── Done ─────────────────────────────────────────────────────────────────────
-- After running this migration:
-- 1. Verify thread counts: SELECT count(*) FROM threads WHERE is_public = true;
--    should match: SELECT count(*) FROM threads WHERE is_private = false;
-- 2. Check a few rows manually to confirm is_public = NOT is_private
-- 3. Deploy the updated app code (db.ts, types.ts, components)
