-- ============================================================
-- 2026-09-20 — CATCH-UP turns RED into GREEN/BLUE, regardless of timing
-- (Alborz: "once a user advances their progress so that that response
--  becomes visible to them, the notification becomes green — this happens
--  regardless of when the user first checked the entry's responses or when
--  a friend wrote a response.")
--
-- THE GAP THIS CLOSES. Both the in-room green and the room-level blue asked
-- a TIMESTAMP question: "is there a readable response NEWER than your open
-- stamp?" That can't express catch-up. A response written BEFORE you opened
-- the entry is older than your open stamp forever, so when you finally watch
-- far enough to read it, red correctly drops and nothing lights. The signal
-- dies silently at exactly the moment it should be inviting you in.
-- It only worked if the response happened to arrive AFTER your last open —
-- i.e. it broke precisely when you acted on the red and went to look.
--
-- THE FIX. Remember WHERE YOU WERE, not just WHEN you were here:
--   friend_group_thread_views gains seen_season / seen_episode — your
--   effective progress at the moment you opened that entry. Then the
--   question becomes "is there a response I can read now that I could NOT
--   read last time I was here?", which is timing-independent.
--
-- Applies to: 1) mark_thread_seen (stamp progress; signature UNCHANGED —
-- it derives progress itself), 2) get_thread_view_state (returns the two
-- new columns; DROP+CREATE, return shape changes), 3)
-- get_room_activity_visibility (BLUE bucket B gains the catch-up arm;
-- supersedes 20260919_room_dots_red_persists.sql, whose RED rules are
-- carried over verbatim).
--
-- Backfill: existing rows get seen_season/seen_episode = NULL, treated as
-- "unknown" = no catch-up claim, so history stays quiet rather than lighting
-- every old thread green at once. New opens stamp it from then on.
-- ============================================================

BEGIN;

-- ── 1. Where you were when you opened it ────────────────────────────────────
ALTER TABLE public.friend_group_thread_views
  ADD COLUMN IF NOT EXISTS seen_season  INTEGER,
  ADD COLUMN IF NOT EXISTS seen_episode INTEGER;

-- Backfill every pre-existing row with the owner's CURRENT effective progress.
-- Without this, legacy rows stay NULL, make no catch-up claim, and the very
-- first thing tested — an entry opened BEFORE the migration — would go from red
-- straight to nothing, i.e. look exactly like the bug this migration fixes.
-- Current progress is the right floor, not the entry's own tag: both catch-up
-- arms ALSO require the reply to be readable now (<= current progress), which is
-- mutually exclusive with "> seen" when seen = current progress. So this lights
-- NOTHING at migration time and every future advance fires correctly. Backfilling
-- to the entry's tag instead would falsely green every thread whose discussion
-- already ran deeper than the entry (the common case).
UPDATE public.friend_group_thread_views v
   SET seen_season  = CASE WHEN p.is_rewatching AND p.highest_season  IS NOT NULL THEN p.highest_season  ELSE p.season  END,
       seen_episode = CASE WHEN p.is_rewatching AND p.highest_episode IS NOT NULL THEN p.highest_episode ELSE p.episode END
  FROM public.friend_groups fg
  JOIN public.progress p ON p.show_id = fg.show_id
 WHERE fg.id = v.group_id
   AND p.user_id = v.user_id
   AND v.seen_season IS NULL;

-- ── 2. mark_thread_seen also stamps progress (same signature) ───────────────
CREATE OR REPLACE FUNCTION public.mark_thread_seen(
  p_group_id  UUID,
  p_thread_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season  INTEGER;
  v_episode INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM friend_group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Effective progress = the rewatch ceiling when rewatching, else current.
  -- Same rule as effectiveProgress() in src/lib/utils.ts and the CTE below.
  SELECT
    CASE WHEN p.is_rewatching AND p.highest_season  IS NOT NULL THEN p.highest_season  ELSE p.season  END,
    CASE WHEN p.is_rewatching AND p.highest_episode IS NOT NULL THEN p.highest_episode ELSE p.episode END
  INTO v_season, v_episode
  FROM progress p
  JOIN friend_groups fg ON fg.show_id = p.show_id
  WHERE p.user_id = auth.uid() AND fg.id = p_group_id;

  INSERT INTO friend_group_thread_views (user_id, group_id, thread_id, last_seen_at, seen_season, seen_episode)
  VALUES (auth.uid(), p_group_id, p_thread_id, NOW(), v_season, v_episode)
  ON CONFLICT (user_id, group_id, thread_id)
  DO UPDATE SET
    last_seen_at = NOW(),
    -- Never downgrade a good stamp to NULL: if the caller somehow has no
    -- progress row for this show, keep whatever was there (a NULL stamp
    -- silently disables catch-up green for that entry forever).
    seen_season  = COALESCE(v_season,  friend_group_thread_views.seen_season),
    seen_episode = COALESCE(v_episode, friend_group_thread_views.seen_episode);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_thread_seen(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_thread_seen(UUID, UUID) TO authenticated;

-- ── 3. get_thread_view_state returns the progress stamp too ─────────────────
-- ⚠️ ALSO FIXES A LIVE PROD BUG (found 2026-09-20, verified read-only against
-- prod): the 2026-04-28 version declared `thread_id UUID`, but the column is
-- TEXT (threads.id is TEXT because seed ids like 'tsp-seed-a' aren't UUIDs —
-- see 20260428_thread_views.sql:32-40, which says so and then declares UUID
-- anyway). plpgsql compares tuple descriptors at executor startup, so
-- RETURN QUERY raised 42804 "Returned type text does not match expected type
-- uuid in column 1" on EVERY call, for every user, even with zero rows.
-- Both callers swallow it (`.catch(() => {})`), so it failed silently — which
-- means the 2026-09-12 CROSS-DEVICE open-stamp merge has never actually worked;
-- opens have been per-device localStorage only. The sibling
-- get_thread_public_view_state (20260429) declares TEXT correctly.
DROP FUNCTION IF EXISTS public.get_thread_view_state(UUID);

CREATE FUNCTION public.get_thread_view_state(p_group_id UUID)
RETURNS TABLE (
  thread_id    TEXT,
  last_seen_at TIMESTAMPTZ,
  seen_season  INTEGER,
  seen_episode INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT v.thread_id, v.last_seen_at, v.seen_season, v.seen_episode
  FROM friend_group_thread_views v
  WHERE v.user_id = auth.uid()
    AND v.group_id = p_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_thread_view_state(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_thread_view_state(UUID) TO authenticated;

-- ── 4. Room dots: BLUE gains the catch-up arm ───────────────────────────────
-- RED rules carried over verbatim from 20260919_room_dots_red_persists.sql.
DROP FUNCTION IF EXISTS public.get_room_activity_visibility(UUID, BOOLEAN);

CREATE FUNCTION public.get_room_activity_visibility(
  p_user_id     UUID    DEFAULT auth.uid(),
  p_exclude_own BOOLEAN DEFAULT false
)
RETURNS TABLE (
  group_id UUID,
  parent_group_id UUID,
  last_seen_at TIMESTAMPTZ,
  latest_visible_activity_at TIMESTAMPTZ,
  latest_invisible_activity_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  WITH user_rooms AS (
    SELECT m.group_id, fg.show_id, fg.parent_group_id
    FROM friend_group_members m
    JOIN friend_groups fg ON fg.id = m.group_id
    WHERE m.user_id = p_user_id
      AND fg.deleted_at IS NULL
  ),
  user_progress AS (
    SELECT
      p.show_id,
      CASE WHEN p.is_rewatching AND p.highest_season  IS NOT NULL THEN p.highest_season  ELSE p.season  END AS eff_season,
      CASE WHEN p.is_rewatching AND p.highest_episode IS NOT NULL THEN p.highest_episode ELSE p.episode END AS eff_episode
    FROM progress p
    WHERE p.user_id = p_user_id
  ),
  opened AS (
    SELECT v.group_id, v.thread_id, v.last_seen_at AS opened_at, v.seen_season, v.seen_episode
    FROM friend_group_thread_views v
    WHERE v.user_id = p_user_id
  ),
  my_participation AS (
    SELECT DISTINCT r.group_id, r.thread_id
    FROM replies r
    WHERE r.group_id IS NOT NULL AND r.author_id = p_user_id AND NOT r.is_deleted
  ),
  -- BLUE bucket A: others' readable entries, never opened (white outline).
  unopened_entries AS (
    SELECT gt.group_id, gt.shared_at AS activity_at
    FROM group_threads gt
    JOIN threads t ON t.id = gt.thread_id
    JOIN user_rooms ur ON ur.group_id = gt.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    LEFT JOIN opened o ON o.group_id = gt.group_id AND o.thread_id = gt.thread_id
    WHERE NOT t.is_deleted
      AND t.author_id <> p_user_id
      AND (t.season < up.eff_season OR (t.season = up.eff_season AND t.episode <= up.eff_episode))
      AND o.thread_id IS NULL
  ),
  -- BLUE bucket B: others' readable responses on threads you wrote or
  -- responded in. TWO arms (2026-09-20):
  --   (i)  arrived since your open stamp  — the original "new response" case;
  --   (ii) readable NOW but above your progress WHEN YOU LAST OPENED — the
  --        catch-up case, independent of when it was written. NULL seen_*
  --        (pre-migration rows) makes no catch-up claim.
  unopened_responses AS (
    SELECT r.group_id, r.created_at AS activity_at
    FROM replies r
    JOIN threads t ON t.id = r.thread_id
    JOIN user_rooms ur ON ur.group_id = r.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    LEFT JOIN opened o ON o.group_id = r.group_id AND o.thread_id = r.thread_id
    WHERE r.group_id IS NOT NULL AND NOT r.is_deleted
      AND r.author_id <> p_user_id
      AND NOT t.is_deleted
      AND (t.author_id = p_user_id
           OR EXISTS (SELECT 1 FROM my_participation mp WHERE mp.group_id = r.group_id AND mp.thread_id = r.thread_id))
      AND (r.season < up.eff_season OR (r.season = up.eff_season AND r.episode <= up.eff_episode))
      AND (
        o.thread_id IS NULL
        OR r.created_at > o.opened_at
        OR (o.seen_season IS NOT NULL
            AND (r.season > o.seen_season OR (r.season = o.seen_season AND r.episode > o.seen_episode)))
      )
  ),
  -- RED bucket A (2026-09-19): hidden responses on threads you wrote OR
  -- responded in. NO open-stamp gate — hidden is hidden until you catch up.
  hidden_responses AS (
    SELECT r.group_id, r.created_at AS activity_at
    FROM replies r
    JOIN threads t ON t.id = r.thread_id
    JOIN user_rooms ur ON ur.group_id = r.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    WHERE r.group_id IS NOT NULL AND NOT r.is_deleted
      AND r.author_id <> p_user_id
      AND NOT t.is_deleted
      AND (t.author_id = p_user_id
           OR EXISTS (SELECT 1 FROM my_participation mp WHERE mp.group_id = r.group_id AND mp.thread_id = r.thread_id))
      AND (r.season > up.eff_season OR (r.season = up.eff_season AND r.episode > up.eff_episode))
  ),
  -- RED bucket B: others' entries still ahead of you, never opened.
  unopened_hidden_entries AS (
    SELECT gt.group_id, gt.shared_at AS activity_at
    FROM group_threads gt
    JOIN threads t ON t.id = gt.thread_id
    JOIN user_rooms ur ON ur.group_id = gt.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    LEFT JOIN opened o ON o.group_id = gt.group_id AND o.thread_id = gt.thread_id
    WHERE NOT t.is_deleted
      AND t.author_id <> p_user_id
      AND (t.season > up.eff_season OR (t.season = up.eff_season AND t.episode > up.eff_episode))
      AND o.thread_id IS NULL
  ),
  blue AS (
    SELECT ue.group_id, ue.activity_at FROM unopened_entries ue
    UNION ALL SELECT ur2.group_id, ur2.activity_at FROM unopened_responses ur2
  ),
  red AS (
    SELECT hr.group_id, hr.activity_at FROM hidden_responses hr
    UNION ALL SELECT he.group_id, he.activity_at FROM unopened_hidden_entries he
  )
  SELECT
    ur.group_id,
    ur.parent_group_id,
    NULL::timestamptz,
    (SELECT MAX(b.activity_at) FROM blue b WHERE b.group_id = ur.group_id),
    (SELECT MAX(x.activity_at) FROM red x  WHERE x.group_id = ur.group_id)
  FROM user_rooms ur;
END;
$$;

REVOKE ALL ON FUNCTION public.get_room_activity_visibility(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_room_activity_visibility(UUID, BOOLEAN) TO authenticated;

COMMIT;

-- Verification (run after):
-- 1) Columns exist:
--    SELECT column_name FROM information_schema.columns
--     WHERE table_name='friend_group_thread_views' AND column_name LIKE 'seen_%';
-- 2) Open an entry in the app, then confirm your progress was stamped:
--    SELECT thread_id, last_seen_at, seen_season, seen_episode
--      FROM friend_group_thread_views WHERE user_id = auth.uid()
--      ORDER BY last_seen_at DESC LIMIT 5;
-- 3) Dots still resolve:
--    SELECT * FROM public.get_room_activity_visibility();
