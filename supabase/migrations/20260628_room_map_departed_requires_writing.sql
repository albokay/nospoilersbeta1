-- 2026-06-28 — Room map: a DEPARTED member gets a column only if they
-- actually wrote in THIS room.
--
-- Behavior: when a user X's a show out of their dashboard they are recorded
-- in friend_group_departed_members and, until now, always kept a map column
-- ending in a termination dot. New rule: a departed member's column appears
-- ONLY if they authored at least one non-deleted ENTRY (a thread shared into
-- this room) OR one non-deleted RESPONSE (a reply in this room). Ratings and
-- progress alone do NOT keep a column. Evaluated per room, so the same person
-- can keep their column in one group's room (where they wrote) and lose it in
-- another (where they didn't).
--
-- This is objective (viewer-independent): writing that is ahead of the
-- viewer's progress still keeps the column — its cells just stay hidden, as
-- today. The only change is that a writing-free departer drops out entirely.
--
-- Current (non-departed) members are unaffected — they always get a column.
-- Applies retroactively: existing writing-free termination dots disappear on
-- the next map load (this is a read-time filter, no data migration needed).
--
-- Same return shape, same authz rule, idempotent CREATE OR REPLACE. The ONLY
-- change vs. 20260515_get_room_map_data_fix.sql is the added writing-existence
-- filter on the departed branch of member_set.

CREATE OR REPLACE FUNCTION public.get_room_map_data(p_group_id uuid)
RETURNS TABLE (
  user_id uuid,
  username text,
  is_departed boolean,
  departed_at timestamptz,
  progress_season int,
  progress_episode int,
  is_rewatching boolean,
  highest_season int,
  highest_episode int,
  ratings jsonb,
  entries jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_show_id text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.friend_group_members fgm
    WHERE fgm.group_id = p_group_id
      AND fgm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  SELECT fg.show_id INTO v_show_id
  FROM public.friend_groups fg
  WHERE fg.id = p_group_id;

  IF v_show_id IS NULL THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  RETURN QUERY
  WITH member_set AS (
    SELECT
      fgm.user_id          AS u_id,
      false                AS u_is_departed,
      NULL::timestamptz    AS u_departed_at
    FROM public.friend_group_members fgm
    WHERE fgm.group_id = p_group_id
    UNION ALL
    SELECT
      fgdm.user_id,
      true,
      fgdm.departed_at
    FROM public.friend_group_departed_members fgdm
    WHERE fgdm.group_id = p_group_id
      AND NOT EXISTS (
        SELECT 1 FROM public.friend_group_members fgm2
        WHERE fgm2.group_id = p_group_id AND fgm2.user_id = fgdm.user_id
      )
      -- NEW: keep a departed member only if they have writing in THIS room —
      -- a non-deleted entry (thread shared here) OR a non-deleted response.
      AND (
        EXISTS (
          SELECT 1
          FROM public.threads t
          JOIN public.group_threads gt ON gt.thread_id = t.id
          WHERE gt.group_id = p_group_id
            AND t.author_id = fgdm.user_id
            AND COALESCE(t.is_deleted, false) = false
        )
        OR EXISTS (
          SELECT 1
          FROM public.replies r
          WHERE r.group_id = p_group_id
            AND r.author_id = fgdm.user_id
            AND COALESCE(r.is_deleted, false) = false
        )
      )
  )
  SELECT
    ms.u_id                              AS user_id,
    p.username                           AS username,
    ms.u_is_departed                     AS is_departed,
    ms.u_departed_at                     AS departed_at,
    pr.season                            AS progress_season,
    pr.episode                           AS progress_episode,
    COALESCE(pr.is_rewatching, false)    AS is_rewatching,
    pr.highest_season                    AS highest_season,
    pr.highest_episode                   AS highest_episode,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          's', er.season_number,
          'e', er.episode_number,
          'r', er.rating
        )
        ORDER BY er.season_number, er.episode_number
      )
      FROM public.episode_ratings er
      WHERE er.user_id = ms.u_id
        AND er.show_id = v_show_id
    ), '[]'::jsonb) AS ratings,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'thread_id',  t.id,
          's',          t.season,
          'e',          t.episode,
          'title',      t.title,
          'created_at', t.created_at
        )
        ORDER BY t.season, t.episode, t.created_at
      )
      FROM public.threads t
      JOIN public.group_threads gt ON gt.thread_id = t.id
      WHERE gt.group_id = p_group_id
        AND t.author_id = ms.u_id
        AND COALESCE(t.is_deleted, false) = false
    ), '[]'::jsonb) AS entries
  FROM member_set ms
  LEFT JOIN public.profiles p ON p.id = ms.u_id
  LEFT JOIN public.progress pr
    ON pr.user_id = ms.u_id
   AND pr.show_id = v_show_id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_room_map_data(uuid) TO authenticated;
