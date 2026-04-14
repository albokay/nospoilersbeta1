-- Migration: Leave room feature
-- Adds soft-delete support for friend groups and tracks departed members

-- 1. Add deleted_at column for soft-deleting rooms (last member leaves)
ALTER TABLE friend_groups ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- 2. Track departed members so we can show "has left the room" on their entries
--    and remember their watch progress for potential rejoin
CREATE TABLE IF NOT EXISTS friend_group_departed_members (
  group_id    uuid NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id)      ON DELETE CASCADE,
  username    text NOT NULL,
  departed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_fgdm_group_id ON friend_group_departed_members(group_id);
CREATE INDEX IF NOT EXISTS idx_fgdm_user_id  ON friend_group_departed_members(user_id);

-- RLS for departed members table
ALTER TABLE friend_group_departed_members ENABLE ROW LEVEL SECURITY;

-- Members of a group can see who has departed
CREATE POLICY "group members can view departed members"
  ON friend_group_departed_members FOR SELECT
  USING (
    group_id IN (
      SELECT group_id FROM friend_group_members WHERE user_id = auth.uid()
    )
    OR user_id = auth.uid()
  );

-- Users can insert their own departure record
CREATE POLICY "user can record own departure"
  ON friend_group_departed_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own departure record (on rejoin)
CREATE POLICY "user can remove own departure on rejoin"
  ON friend_group_departed_members FOR DELETE
  USING (user_id = auth.uid());

-- 3. Update friend_groups RLS to exclude soft-deleted groups from normal queries
--    (Admin can still see them via service role / dashboard)
-- Drop and recreate the select policy to add deleted_at filter
DROP POLICY IF EXISTS "member can see groups" ON friend_groups;
CREATE POLICY "member can see active groups"
  ON friend_groups FOR SELECT
  USING (
    deleted_at IS NULL
    AND id IN (
      SELECT group_id FROM friend_group_members WHERE user_id = auth.uid()
    )
  );

-- 4. Allow group owner to update created_by (for ownership transfer)
DROP POLICY IF EXISTS "creator can update group" ON friend_groups;
CREATE POLICY "creator can update group"
  ON friend_groups FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (true);

-- 5. Allow any member to soft-delete their own group (set deleted_at) when they're the last member
--    This uses the existing update policy since we transfer ownership before soft-deleting
