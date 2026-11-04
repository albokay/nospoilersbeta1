-- ============================================================================
-- 2026-11-04 — Stand alone mode, CP3: the server reads the per-season rule.
--
-- CP2 taught the client: on a show in the mode (shows.stand_alone, else its
-- TVMaze type — show_stand_alone()), writing opens only if the viewer has
-- PICKED its season and reached its episode there (progress_seasons; the
-- one position row counts for the season it's in); season 0 is open to
-- anyone with a position. This migration gives every server mirror of the
-- rule the same branch — taken ONLY when show_stand_alone() is true; off the
-- mode each function's one-position expression is left exactly as it was.
-- The definitions below were taken from prod on 2026-11-04 (not the repo).
--
--   can_see_in_season()            the rule, by user — SECURITY INVOKER, so
--                                  called directly it sees only your own
--                                  places (RLS); inside the DEFINER functions
--                                  below it runs as their owner.
--   get_room_activity_visibility   the dashboard / room dots (blue = readable
--                                  and new, red = sealed), six comparisons.
--   viewer_past_episode            guide_letters row security (read a friend's
--                                  letter when past where it was written FROM;
--                                  write one at an episode you've reached).
--   get_guide_letter_signals       the guide's past / behind per letter.
--   record_letter_watchers         "reached your letter": a watcher only for a
--                                  member on the letter's season, 3+ behind it
--                                  there (his yes 4).
--   get_room_map_data              + places (each member's place per season)
--                                  for CP4's map; the function is dropped and
--                                  recreated because its row type grows.
--   mark_thread_seen               unchanged: the stamp is the position row,
--                                  which in the mode is the season you're in.
--
-- Apply in the SQL editor as ONE paste: it runs in a transaction, so a
-- failure anywhere leaves prod exactly as it was (get_room_map_data is
-- dropped and recreated inside it). Read-only verification at the foot.
-- ============================================================================

begin;

create or replace function public.can_see_in_season(p_user_id uuid, p_show_id text, p_season integer, p_episode integer)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(p_season, 0) <= 0
      or greatest(
           coalesce((select ps.episode from public.progress_seasons ps
                      where ps.user_id = p_user_id and ps.show_id = p_show_id and ps.season = p_season), -1),
           coalesce((select case when p.season = p_season then p.episode end from public.progress p
                      where p.user_id = p_user_id and p.show_id = p_show_id), -1)
         ) >= coalesce(p_episode, 0);
$$;
grant execute on function public.can_see_in_season(uuid, text, integer, integer) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_room_activity_visibility(p_user_id uuid DEFAULT auth.uid(), p_exclude_own boolean DEFAULT false)
 RETURNS TABLE(group_id uuid, parent_group_id uuid, last_seen_at timestamp with time zone, latest_visible_activity_at timestamp with time zone, latest_invisible_activity_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  WITH user_rooms AS (
    SELECT m.group_id, fg.show_id, fg.parent_group_id,
           public.show_stand_alone(fg.show_id) AS stand_alone
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
      AND (CASE WHEN ur.stand_alone THEN public.can_see_in_season(p_user_id, ur.show_id, t.season, t.episode) ELSE (t.season < up.eff_season OR (t.season = up.eff_season AND t.episode <= up.eff_episode)) END)
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
      AND (CASE WHEN ur.stand_alone THEN public.can_see_in_season(p_user_id, ur.show_id, r.season, r.episode) ELSE (r.season < up.eff_season OR (r.season = up.eff_season AND r.episode <= up.eff_episode)) END)
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
    WHERE (CASE WHEN ur.stand_alone THEN public.can_see_in_season(p_user_id, ur.show_id, n.author_season, n.author_episode) ELSE (n.author_season < up.eff_season OR (n.author_season = up.eff_season AND n.author_episode <= up.eff_episode)) END)
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
      AND (CASE WHEN ur.stand_alone THEN NOT public.can_see_in_season(p_user_id, ur.show_id, r.season, r.episode) ELSE (r.season > up.eff_season OR (r.season = up.eff_season AND r.episode > up.eff_episode)) END)
  ),
  -- RED bucket C (2026-10-07): NOTES on your writing left from ahead of you.
  hidden_notes AS (
    SELECT n.group_id, n.created_at AS activity_at
    FROM notes_on_mine n
    JOIN user_rooms ur ON ur.group_id = n.group_id
    JOIN user_progress up ON up.show_id = ur.show_id
    WHERE (CASE WHEN ur.stand_alone THEN NOT public.can_see_in_season(p_user_id, ur.show_id, n.author_season, n.author_episode) ELSE (n.author_season > up.eff_season OR (n.author_season = up.eff_season AND n.author_episode > up.eff_episode)) END)
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
      AND (CASE WHEN ur.stand_alone THEN NOT public.can_see_in_season(p_user_id, ur.show_id, t.season, t.episode) ELSE (t.season > up.eff_season OR (t.season = up.eff_season AND t.episode > up.eff_episode)) END)
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
$function$
;

CREATE OR REPLACE FUNCTION public.viewer_past_episode(p_show_id text, p_season integer, p_episode integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Stand alone mode (2026-11-04, CP3): on a show in the mode, past = within
  -- the viewer's place in that season; otherwise the one position as ever.
  SELECT CASE WHEN public.show_stand_alone(p_show_id)
    THEN public.can_see_in_season(auth.uid(), p_show_id, p_season, p_episode)
    ELSE EXISTS (
    SELECT 1
      FROM public.progress p
     WHERE p.user_id = auth.uid()
       AND p.show_id = p_show_id
       AND (
             (CASE WHEN p.is_rewatching AND p.highest_season IS NOT NULL AND p.highest_episode IS NOT NULL
                   THEN p.highest_season ELSE p.season END) > p_season
          OR (
             (CASE WHEN p.is_rewatching AND p.highest_season IS NOT NULL AND p.highest_episode IS NOT NULL
                   THEN p.highest_season ELSE p.season END) = p_season
             AND
             (CASE WHEN p.is_rewatching AND p.highest_season IS NOT NULL AND p.highest_episode IS NOT NULL
                   THEN p.highest_episode ELSE p.episode END) >= p_episode
             )
           )
  ) END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_guide_letter_signals(p_show_id text DEFAULT NULL::text)
 RETURNS TABLE(show_id text, show_name text, season integer, episode integer, from_season integer, from_episode integer, writer_ids uuid[], letter_count integer, latest_at timestamp with time zone, relation text, seen_at timestamp with time zone, hold_seen_at timestamp with time zone, not_for_me boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH friends AS (
    SELECT DISTINCT b.user_id
      FROM public.people_group_members a
      JOIN public.people_group_members b ON b.group_id = a.group_id AND b.user_id <> a.user_id
      JOIN public.people_groups g        ON g.id = a.group_id AND g.deleted_at IS NULL
     WHERE a.user_id = auth.uid()
  ),
  eff AS (
    SELECT p.show_id,
           CASE WHEN p.is_rewatching AND p.highest_season IS NOT NULL AND p.highest_episode IS NOT NULL
                THEN p.highest_season ELSE p.season END AS s,
           CASE WHEN p.is_rewatching AND p.highest_season IS NOT NULL AND p.highest_episode IS NOT NULL
                THEN p.highest_episode ELSE p.episode END AS e
      FROM public.progress p
     WHERE p.user_id = auth.uid()
  ),
  letters AS (
    SELECT l.show_id, l.season, l.episode, l.from_season, l.from_episode, l.user_id, l.created_at
      FROM public.guide_letters l
     WHERE l.deleted_at IS NULL
       AND l.user_id IN (SELECT user_id FROM friends)
       AND (p_show_id IS NULL OR l.show_id = p_show_id)
  )
  SELECT l.show_id,
         sh.name                                   AS show_name,
         l.season,
         l.episode,
         l.from_season,
         l.from_episode,
         array_agg(DISTINCT l.user_id)             AS writer_ids,
         count(*)::INTEGER                         AS letter_count,
         max(l.created_at)                         AS latest_at,
         CASE
           WHEN eff.s IS NULL OR eff.s = 0 THEN 'none'
           -- Stand alone mode (2026-11-04, CP3): past = within the viewer's
           -- place in the season it was written FROM.
           WHEN public.show_stand_alone(l.show_id) THEN
             CASE WHEN public.can_see_in_season(auth.uid(), l.show_id, l.from_season, l.from_episode) THEN 'past' ELSE 'behind' END
           WHEN eff.s > l.from_season OR (eff.s = l.from_season AND eff.e >= l.from_episode) THEN 'past'
           ELSE 'behind'
         END                                       AS relation,
         v.seen_at,
         h.seen_at                                 AS hold_seen_at,
         COALESCE(h.not_for_me, false)             AS not_for_me
    FROM letters l
    JOIN public.shows sh ON sh.id = l.show_id
    LEFT JOIN eff ON eff.show_id = l.show_id
    LEFT JOIN public.guide_letter_views v
           ON v.user_id = auth.uid() AND v.show_id = l.show_id AND v.season = l.season AND v.episode = l.episode
    LEFT JOIN public.guide_letter_holds h
           ON h.user_id = auth.uid() AND h.show_id = l.show_id
   GROUP BY l.show_id, sh.name, l.season, l.episode, l.from_season, l.from_episode, eff.s, eff.e, v.seen_at, h.seen_at, h.not_for_me
   ORDER BY max(l.created_at) DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.record_letter_watchers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_author  uuid;
  v_season  integer;
  v_episode integer;
  v_show    text;
  v_seasons integer[];
  v_stamp   integer;
  v_sa      boolean;
BEGIN
  SELECT t.author_id, t.season, t.episode INTO v_author, v_season, v_episode
    FROM public.threads t WHERE t.id = NEW.thread_id;
  IF v_author IS NULL OR v_author = '00000000-0000-4000-8000-000000000001'::uuid THEN RETURN NEW; END IF;
  SELECT fg.show_id, s.seasons INTO v_show, v_seasons
    FROM public.friend_groups fg JOIN public.shows s ON s.id = fg.show_id
   WHERE fg.id = NEW.group_id AND fg.parent_group_id IS NOT NULL;
  IF v_show IS NULL THEN RETURN NEW; END IF;
  v_stamp := public.episode_index(v_season, v_episode, coalesce(v_seasons, '{}'));
  -- Stand alone mode (2026-11-04, CP3; his yes 4): a watcher only for a
  -- member on the letter's season, 3+ behind it there.
  v_sa := public.show_stand_alone(v_show);
  IF (v_sa AND coalesce(v_episode, 0) < 3) OR (NOT v_sa AND v_stamp < 3) THEN RETURN NEW; END IF;

  INSERT INTO public.letter_watchers (thread_id, behind_id, author_id, group_id, stamp_season, stamp_episode)
  SELECT NEW.thread_id, m.user_id, v_author, NEW.group_id, coalesce(v_season, 0), coalesce(v_episode, 0)
    FROM public.friend_group_members m
    LEFT JOIN public.progress p ON p.user_id = m.user_id AND p.show_id = v_show
   WHERE m.group_id = NEW.group_id
     AND m.user_id <> v_author
     AND CASE WHEN v_sa
           THEN coalesce(p.season, 0) = v_season AND v_episode - coalesce(p.episode, 0) >= 3
           ELSE v_stamp - public.episode_index(
             CASE WHEN p.is_rewatching THEN greatest(coalesce(p.highest_season, 0), coalesce(p.season, 0)) ELSE coalesce(p.season, 0) END,
             CASE WHEN p.is_rewatching THEN greatest(coalesce(p.highest_episode, 0), coalesce(p.episode, 0)) ELSE coalesce(p.episode, 0) END,
             coalesce(v_seasons, '{}')) >= 3
         END
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$
;

drop function if exists public.get_room_map_data(uuid);
CREATE OR REPLACE FUNCTION public.get_room_map_data(p_group_id uuid)
 RETURNS TABLE(user_id uuid, username text, is_departed boolean, departed_at timestamp with time zone, progress_season integer, progress_episode integer, is_rewatching boolean, highest_season integer, highest_episode integer, ratings jsonb, entries jsonb, places jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    ), '[]'::jsonb) AS entries,
    -- Stand alone mode (2026-11-04, CP3, for CP4's map): each member's place
    -- per season, so the map can draw the picked seasons and seal by them.
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('s', ps.season, 'e', ps.episode) ORDER BY ps.season)
      FROM public.progress_seasons ps
      WHERE ps.user_id = ms.u_id
        AND ps.show_id = v_show_id
    ), '[]'::jsonb) AS places
  FROM member_set ms
  LEFT JOIN public.profiles p ON p.id = ms.u_id
  LEFT JOIN public.progress pr
    ON pr.user_id = ms.u_id
   AND pr.show_id = v_show_id;
END $function$
;
grant execute on function public.get_room_map_data(uuid) to anon, authenticated, service_role;

commit;

-- Verification (read-only):
-- select public.can_see_in_season(auth.uid(), 'survivor', 51, 3);
-- select relation, count(*) from public.get_guide_letter_signals() group by 1;
-- select user_id, places from public.get_room_map_data('<a room id>');
