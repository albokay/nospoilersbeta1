-- 2026-10-07 — Notes count as news (letters-only rooms arc, checkpoint 3).
--
-- A note left on your letter (or on a letter you wrote a response or a note
-- in), or on a response you wrote, now lights the room's envelope on the
-- dashboard and the group room the way a response does: BLUE when you can
-- read it and haven't opened that letter since, RED when the noter was
-- ahead of you. Yups don't count — a note is writing. Opening the letter
-- clears it, exactly as for responses (the same per-letter open stamp).
--
-- Also adds highlights to the realtime publication so the dots light up
-- live. Paste the whole file into the SQL editor. Safe to re-run.

CREATE OR REPLACE FUNCTION public.get_room_activity_visibility(
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
  -- Letters you've left a NOTE on (2026-10-07) — part of the letter the way
  -- a response makes you part of it.
  my_noted AS (
    SELECT DISTINCT h.group_id, h.target_id AS thread_id
    FROM highlights h
    WHERE h.author_id = p_user_id AND h.target_type = 'thread' AND h.kind = 'note'
  ),
  -- Others' NOTES on your writing (2026-10-07): on a letter you wrote or
  -- are part of, or on a response you wrote. Each row carries the letter
  -- it hangs under (the open stamp is per letter) and the noter's progress
  -- snapshot (its spoiler tag).
  notes_on_mine AS (
    SELECT h.group_id, t.id AS thread_id, h.created_at, h.author_season, h.author_episode
    FROM highlights h
    JOIN threads t ON t.id = h.target_id
    WHERE h.target_type = 'thread' AND h.kind = 'note'
      AND h.author_id <> p_user_id
      AND NOT t.is_deleted
      AND (t.author_id = p_user_id
           OR EXISTS (SELECT 1 FROM my_participation mp WHERE mp.group_id = h.group_id AND mp.thread_id = t.id)
           OR EXISTS (SELECT 1 FROM my_noted mn WHERE mn.group_id = h.group_id AND mn.thread_id = t.id))
    UNION ALL
    SELECT h.group_id, r.thread_id, h.created_at, h.author_season, h.author_episode
    FROM highlights h
    JOIN replies r ON r.id = h.target_id
    WHERE h.target_type = 'reply' AND h.kind = 'note'
      AND h.author_id <> p_user_id
      AND r.author_id = p_user_id
      AND NOT r.is_deleted
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
  -- BLUE bucket C (2026-10-07): others' readable NOTES on your writing,
  -- the same two arms as responses.
  unopened_notes AS (
    SELECT n.group_id, n.created_at AS activity_at
    FROM notes_on_mine n
    JOIN user_rooms ur ON ur.group_id = n.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    LEFT JOIN opened o ON o.group_id = n.group_id AND o.thread_id = n.thread_id
    WHERE (n.author_season < up.eff_season OR (n.author_season = up.eff_season AND n.author_episode <= up.eff_episode))
      AND (
        o.thread_id IS NULL
        OR n.created_at > o.opened_at
        OR (o.seen_season IS NOT NULL
            AND (n.author_season > o.seen_season OR (n.author_season = o.seen_season AND n.author_episode > o.seen_episode)))
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
  -- RED bucket C (2026-10-07): NOTES on your writing left from ahead of you.
  hidden_notes AS (
    SELECT n.group_id, n.created_at AS activity_at
    FROM notes_on_mine n
    JOIN user_rooms ur ON ur.group_id = n.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    WHERE (n.author_season > up.eff_season OR (n.author_season = up.eff_season AND n.author_episode > up.eff_episode))
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
    UNION ALL SELECT un.group_id, un.activity_at FROM unopened_notes un
  ),
  red AS (
    SELECT hr.group_id, hr.activity_at FROM hidden_responses hr
    UNION ALL SELECT he.group_id, he.activity_at FROM unopened_hidden_entries he
    UNION ALL SELECT hn.group_id, hn.activity_at FROM hidden_notes hn
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

-- Live dots: a new highlight reaches the dashboard without a reload.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'highlights'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.highlights;
  END IF;
END $$;
