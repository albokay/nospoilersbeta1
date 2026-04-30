-- Per-thread read tracking for public-context threads.
--
-- Companion to friend_group_thread_views (20260428_thread_views.sql), which
-- handles the friend-room context. This table covers the public context:
-- per-(user, thread) last_seen timestamp for any thread where the
-- non-friend-room view is what's being read.
--
-- Drives the new desktop relevance comparator (Tier 1 = visible-new,
-- Tier 2a/2b = hidden-new, Tier 3 = rest), the green "new replies" badge
-- on thread cards, and the per-(user, show) freshness boundary used to
-- decide whether a reply counts as "new."
--
-- Treat absence of row as "never seen" (timestamp 0). New threads / new
-- replies count as new until the user opens AND scrolls within the thread,
-- at which point the client calls mark_thread_public_seen.
--
-- Backfill: for every existing user × public thread pair without a row,
-- stamp last_seen_at = NOW() so existing users don't see a wave of green
-- badges on threads they've already actually read. Same backfill is
-- applied to friend_group_thread_views to keep the two contexts aligned.
--
-- Migration is fully additive: new table, new RPCs, owner-only RLS. The
-- desktop client falls back to the current localStorage lastOpenedAt
-- system if either RPC fails (gracefully-degrade pattern matching the
-- friend_group_thread_views client wiring).

-- ── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_thread_public_views (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id    TEXT NOT NULL REFERENCES threads(id)    ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, thread_id)
);

-- Per-user lookup index. The PK already covers user_id-prefix lookups,
-- but an explicit index documents the intended access pattern (per-show
-- fetch joins through threads on show_id).
CREATE INDEX IF NOT EXISTS idx_user_thread_public_views_user
  ON user_thread_public_views (user_id);

-- ── 2. Row-level security ────────────────────────────────────────────────────

ALTER TABLE user_thread_public_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_thread_public_views_owner_select ON user_thread_public_views;
CREATE POLICY user_thread_public_views_owner_select ON user_thread_public_views
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_thread_public_views_owner_insert ON user_thread_public_views;
CREATE POLICY user_thread_public_views_owner_insert ON user_thread_public_views
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_thread_public_views_owner_update ON user_thread_public_views;
CREATE POLICY user_thread_public_views_owner_update ON user_thread_public_views
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_thread_public_views_owner_delete ON user_thread_public_views;
CREATE POLICY user_thread_public_views_owner_delete ON user_thread_public_views
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ── 3. mark_thread_public_seen — stamp the caller's view of one public thread ─
--
-- Called on InlineThreadView / MobileThread first-scroll, fire-and-forget.
-- The thread must exist and be public; otherwise the caller has no
-- legitimate reason to be reading it via the public surface.

CREATE OR REPLACE FUNCTION public.mark_thread_public_seen(
  p_thread_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM threads
    WHERE id = p_thread_id AND is_public = TRUE
  ) THEN
    RAISE EXCEPTION 'thread not found or not public';
  END IF;

  INSERT INTO user_thread_public_views (user_id, thread_id, last_seen_at)
  VALUES (auth.uid(), p_thread_id, NOW())
  ON CONFLICT (user_id, thread_id)
  DO UPDATE SET last_seen_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_thread_public_seen(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_thread_public_seen(TEXT) TO authenticated;

-- ── 4. get_thread_public_view_state — caller's last_seen per thread on a show ─
--
-- Show-scoped to keep the response small (one show's threads). Returns
-- one row per public thread the caller has ever seen on this show. Threads
-- the caller has never opened simply don't appear; the client treats
-- absence as "never seen."

CREATE OR REPLACE FUNCTION public.get_thread_public_view_state(p_show_id TEXT)
RETURNS TABLE (
  thread_id    TEXT,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT v.thread_id, v.last_seen_at
  FROM user_thread_public_views v
  JOIN threads t ON t.id = v.thread_id
  WHERE v.user_id = auth.uid()
    AND t.show_id = p_show_id
    AND t.is_public = TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_thread_public_view_state(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_thread_public_view_state(TEXT) TO authenticated;

-- ── 5. Backfill ──────────────────────────────────────────────────────────────
--
-- Stamp last_seen_at = NOW() for every existing user × public thread pair
-- that doesn't already have a row. Avoids the wave of green badges that
-- would otherwise appear for existing users on first deploy.
--
-- Same treatment applied to friend_group_thread_views to keep friend-room
-- and public contexts behaviorally aligned at deploy time. friend-room
-- backfill only covers (user, group, thread) triples where the user is a
-- current member of the group AND the thread is currently linked to the
-- group via group_threads.

INSERT INTO user_thread_public_views (user_id, thread_id, last_seen_at)
SELECT u.id, t.id, NOW()
FROM auth.users u
CROSS JOIN threads t
WHERE t.is_public = TRUE
ON CONFLICT (user_id, thread_id) DO NOTHING;

INSERT INTO friend_group_thread_views (user_id, group_id, thread_id, last_seen_at)
SELECT m.user_id, gt.group_id, gt.thread_id, NOW()
FROM friend_group_members m
JOIN group_threads gt ON gt.group_id = m.group_id
ON CONFLICT (user_id, group_id, thread_id) DO NOTHING;
