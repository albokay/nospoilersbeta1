-- ============================================================
-- Phase 4 fix: resolve RLS infinite recursion on friend_group_members
-- ============================================================
-- Root cause: the SELECT policy on friend_group_members checked
-- "group_id IN (SELECT group_id FROM friend_group_members WHERE user_id = auth.uid())"
-- — a self-referential subquery that causes Postgres to recurse infinitely.
--
-- The same cascading recursion breaks friend_groups SELECT (which also
-- queries friend_group_members) and every policy that depends on it.
--
-- Fix: replace all self-referential lookups with a SECURITY DEFINER function
-- that queries friend_group_members without triggering RLS evaluation.
-- ============================================================

-- ── 1. Create the security-definer membership helper ──────────────────────────

CREATE OR REPLACE FUNCTION auth_is_group_member(gid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER        -- runs as the function owner, bypasses RLS
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

-- ── 2. Recreate friend_group_members SELECT policy ────────────────────────────

DROP POLICY IF EXISTS "members can view group membership" ON friend_group_members;

CREATE POLICY "members can view group membership"
  ON friend_group_members FOR SELECT
  USING (auth_is_group_member(group_id));

-- ── 3. Recreate friend_groups SELECT policy ───────────────────────────────────

DROP POLICY IF EXISTS "members can view their groups" ON friend_groups;

CREATE POLICY "members can view their groups"
  ON friend_groups FOR SELECT
  USING (auth_is_group_member(id));

-- ── 4. Recreate group_threads SELECT + INSERT policies ────────────────────────

DROP POLICY IF EXISTS "group members can view group threads"    ON group_threads;
DROP POLICY IF EXISTS "group members can share threads to group" ON group_threads;

CREATE POLICY "group members can view group threads"
  ON group_threads FOR SELECT
  USING (auth_is_group_member(group_id));

CREATE POLICY "group members can share threads to group"
  ON group_threads FOR INSERT
  WITH CHECK (auth_is_group_member(group_id));

-- ── Done ─────────────────────────────────────────────────────────────────────
-- Verify with:
--   SELECT proname FROM pg_proc WHERE proname = 'auth_is_group_member';
-- Then try creating a friend group from the UI — should succeed.
