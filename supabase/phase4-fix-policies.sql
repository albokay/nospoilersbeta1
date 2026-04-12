-- ============================================================
-- Phase 4: full policy reset for all friend-group tables
-- ============================================================
-- Run this if you hit either of:
--   "infinite recursion detected in policy for relation friend_group_members"
--   "new row violates row-level security policy for table friend_groups"
--
-- The phase1 migration may have aborted mid-run (on the show_id FK error)
-- before the policy section executed, leaving tables with RLS enabled but
-- no policies — which silently blocks all operations.
-- This script is idempotent: safe to run multiple times.
-- ============================================================

-- ── 0. Security-definer membership helper (recreate idempotently) ─────────────

CREATE OR REPLACE FUNCTION auth_is_group_member(gid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM friend_group_members
    WHERE group_id = gid
      AND user_id = auth.uid()
  );
END;
$$;

-- ── 1. friend_groups policies ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "members can view their groups"          ON friend_groups;
DROP POLICY IF EXISTS "authenticated users can create groups"  ON friend_groups;
DROP POLICY IF EXISTS "creator can update group"               ON friend_groups;
DROP POLICY IF EXISTS "creator can delete group"               ON friend_groups;

-- Any authenticated user can see groups they belong to
CREATE POLICY "members can view their groups"
  ON friend_groups FOR SELECT
  USING (auth_is_group_member(id));

-- Any authenticated user can create a group (created_by must equal their uid)
CREATE POLICY "authenticated users can create groups"
  ON friend_groups FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());

-- Only the creator can rename the group
CREATE POLICY "creator can update group"
  ON friend_groups FOR UPDATE
  USING (created_by = auth.uid());

-- Only the creator can delete the group
CREATE POLICY "creator can delete group"
  ON friend_groups FOR DELETE
  USING (created_by = auth.uid());

-- ── 2. friend_group_members policies ─────────────────────────────────────────

DROP POLICY IF EXISTS "members can view group membership"              ON friend_group_members;
DROP POLICY IF EXISTS "group creator can add members"                  ON friend_group_members;
DROP POLICY IF EXISTS "user can leave group, or creator can remove member" ON friend_group_members;

-- Members can see the full member list for any group they belong to
CREATE POLICY "members can view group membership"
  ON friend_group_members FOR SELECT
  USING (auth_is_group_member(group_id));

-- Only the group creator can add members (self-insert on creation uses service role or creator check)
CREATE POLICY "group creator can add members"
  ON friend_group_members FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      user_id = auth.uid()   -- creator inserting themselves on group creation
      OR group_id IN (SELECT id FROM friend_groups WHERE created_by = auth.uid())
    )
  );

-- A member can remove themselves; the creator can remove anyone
CREATE POLICY "user can leave group, or creator can remove member"
  ON friend_group_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR group_id IN (SELECT id FROM friend_groups WHERE created_by = auth.uid())
  );

-- ── 3. group_threads policies ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "group members can view group threads"           ON group_threads;
DROP POLICY IF EXISTS "group members can share threads to group"       ON group_threads;
DROP POLICY IF EXISTS "thread author or group creator can remove from group" ON group_threads;

CREATE POLICY "group members can view group threads"
  ON group_threads FOR SELECT
  USING (auth_is_group_member(group_id));

CREATE POLICY "group members can share threads to group"
  ON group_threads FOR INSERT
  WITH CHECK (auth_is_group_member(group_id));

CREATE POLICY "thread author or group creator can remove from group"
  ON group_threads FOR DELETE
  USING (
    group_id IN (SELECT id FROM friend_groups WHERE created_by = auth.uid())
    OR thread_id IN (SELECT id FROM threads WHERE author_id = auth.uid())
  );

-- ── 4. invitations policies ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "creator can insert invitations"          ON invitations;
DROP POLICY IF EXISTS "creator can view their sent invitations" ON invitations;

CREATE POLICY "creator can insert invitations"
  ON invitations FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND group_id IN (SELECT id FROM friend_groups WHERE created_by = auth.uid())
  );

CREATE POLICY "creator can view their sent invitations"
  ON invitations FOR SELECT
  USING (created_by = auth.uid());

-- ── Done ─────────────────────────────────────────────────────────────────────
-- Verify:
--   SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('friend_groups','friend_group_members','group_threads','invitations')
--   ORDER BY tablename, policyname;
-- Should return 4 + 3 + 3 + 2 = 12 rows.
