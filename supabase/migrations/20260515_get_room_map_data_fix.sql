-- 2026-05-15 — fix: get_room_map_data raised "column reference 'user_id'
-- is ambiguous" on every call.
--
-- Cause: the membership-check subquery near the top of the function had
-- `WHERE user_id = auth.uid()` (unqualified). `user_id` is also the name
-- of a RETURNS TABLE OUT parameter on this function, so plpgsql couldn't
-- decide whether the reference meant the OUT variable or the column on
-- friend_group_members, and raised at execution time.
--
-- Fix: alias the table in the membership check and qualify both column
-- references. Also pin `#variable_conflict use_column` at the top of the
-- plpgsql block so any future unqualified column reference inside this
-- function prefers the table column over the same-named OUT param.
-- Same return shape; same authz rule; idempotent CREATE OR REPLACE.

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
