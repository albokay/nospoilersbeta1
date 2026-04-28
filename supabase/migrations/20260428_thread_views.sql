-- Per-thread read tracking for the mobile new-activity dots.
--
-- Today, mobile thread-card "new" dots are computed by comparing each
-- thread's latestVisibleReplyAt against a single per-room snapshot of
-- friend_group_members.last_seen_at, captured at MobileRoom mount. The
-- mount-time markRoomSeen advance means navigating thread → back-to-room
-- re-snapshots NOW(), which clears every dot whether or not the user
-- actually opened those threads. Reported regression — see HANDOFF
-- 2026-04-27 follow-up.
--
-- This migration adds per-(user, group, thread) read tracking. The
-- existing friend_group_members.last_seen_at + mark_room_seen path is
-- left intact and continues to drive the rooms-list room-button dot via
-- get_room_activity_visibility (20260425_room_last_seen.sql). The two
-- systems are independent: room-level entry stamps the member row,
-- per-thread reads stamp the new views table.
--
-- Migration is fully additive: new table, new RPCs, owner-only RLS. No
-- changes to existing schema, RLS, or RPCs. Mobile code degrades
-- gracefully if this hasn't been applied — the new RPC calls fail and
-- the per-thread dot logic falls back to "no dots" rather than breaking
-- the room view.

-- ── 1. Table ─────────────────────────────────────────────────────────────────
--
-- group_id is in the PK on purpose: a thread can be shared to multiple
-- rooms via group_threads. Reading it in room A must not clear it in
-- room B. ON DELETE CASCADE on all three FKs keeps the table self-cleaning
-- on hard deletes (account / group / thread). Soft deletes leave inert
-- rows behind, which is fine — invisible threads are filtered upstream.

-- threads.id is TEXT (not UUID) — seed thread ids like 'tsp-seed-a'
-- aren't UUID-shaped, and the get_admin_user_activity RPC declares its
-- thread_id return column as text. Match that here. friend_groups.id and
-- auth.users.id are both UUID.

CREATE TABLE IF NOT EXISTS friend_group_thread_views (
  user_id      UUID NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  group_id     UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  thread_id    TEXT NOT NULL REFERENCES threads(id)       ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, group_id, thread_id)
);

-- Per-user-per-room lookup index. The (user_id, group_id, thread_id) PK
-- already covers (user_id, group_id) lookups via prefix, but an explicit
-- index documents the intended access pattern and survives any future
-- PK reorganization.
CREATE INDEX IF NOT EXISTS idx_thread_views_user_group
  ON friend_group_thread_views (user_id, group_id);

-- ── 2. Row-level security ────────────────────────────────────────────────────
--
-- Owner-only reads + writes. The RPCs below are SECURITY DEFINER and
-- gate on auth.uid() explicitly, so they bypass these policies, but the
-- policies still matter for any direct table access (e.g. PostgREST
-- generic endpoints). Same shape as the policies on `progress` and
-- `likes_threads`.

ALTER TABLE friend_group_thread_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS thread_views_owner_select ON friend_group_thread_views;
CREATE POLICY thread_views_owner_select ON friend_group_thread_views
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS thread_views_owner_insert ON friend_group_thread_views;
CREATE POLICY thread_views_owner_insert ON friend_group_thread_views
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS thread_views_owner_update ON friend_group_thread_views;
CREATE POLICY thread_views_owner_update ON friend_group_thread_views
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS thread_views_owner_delete ON friend_group_thread_views;
CREATE POLICY thread_views_owner_delete ON friend_group_thread_views
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ── 3. mark_thread_seen — stamp the caller's view of one thread ──────────────
--
-- Called on MobileThread mount, fire-and-forget. Membership check
-- prevents arbitrary group_id values from accumulating dead rows; the
-- caller must be a member of the group. SECURITY DEFINER because the
-- function inserts via auth.uid() (matches the owner RLS) but we want a
-- single-statement upsert path that doesn't depend on the policy
-- evaluation context.

CREATE OR REPLACE FUNCTION public.mark_thread_seen(
  p_group_id  UUID,
  p_thread_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM friend_group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO friend_group_thread_views (user_id, group_id, thread_id, last_seen_at)
  VALUES (auth.uid(), p_group_id, p_thread_id, NOW())
  ON CONFLICT (user_id, group_id, thread_id)
  DO UPDATE SET last_seen_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_thread_seen(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_thread_seen(UUID, UUID) TO authenticated;

-- ── 4. get_thread_view_state — caller's last_seen_at per thread in a room ────
--
-- Returns one row per thread the caller has ever opened in this group.
-- Threads the caller has never opened simply don't appear; the client
-- treats absence as "never seen" (NULL) and shows the dot if there's any
-- visible activity, matching today's first-visit behavior.
--
-- Membership check is omitted here intentionally: the function only
-- returns the caller's own rows, leaking no data about other users.
-- Confirming "you are a member" is already implicit in the existing
-- friend_group_members RLS (members can see each other), so adding a
-- membership gate here would be redundant.

CREATE OR REPLACE FUNCTION public.get_thread_view_state(p_group_id UUID)
RETURNS TABLE (
  thread_id    UUID,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT v.thread_id, v.last_seen_at
  FROM friend_group_thread_views v
  WHERE v.user_id = auth.uid()
    AND v.group_id = p_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_thread_view_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_thread_view_state(UUID) TO authenticated;
