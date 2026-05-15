-- 2026-05-15 — V2 friend room: episode_ratings table + get_room_map_data RPC
-- (checkpoint 1 of the /v2/room/:groupId arc)
--
-- A new per-(user, show, season, episode) rating row. Drives the right-pane
-- "season map" on the V2 friend room: every cell shows whether a member
-- watched + rated + wrote about that episode. Rating capture UI ships in a
-- follow-up spec; this migration is the read side only.
--
-- Privacy model. Ratings are owner-only directly (RLS SELECT/INSERT/UPDATE/
-- DELETE = caller is row owner). Cross-member reads — needed to populate the
-- map for every member of a room — go through the SECURITY DEFINER RPC
-- `get_room_map_data(group_id)`, which gates on the caller being a current
-- member of the named group, then bundles every member's progress + ratings
-- + this-room's entries into a single round trip.
--
-- Departed members ride along in the same return shape (is_departed=true,
-- departed_at set) so the map can render the terminal spine-dot per-spec.
-- Rejoiners (departed-then-re-added) come back as current members, not
-- departed.
--
-- show_id FK. Deliberately omitted to match the existing `progress.show_id`
-- shape — adding it now would also import the admin-delete cascade failure
-- mode documented in HANDOFF §6 item 22.
--
-- search_path. Both the trigger function and the RPC pin `search_path =
-- public` per the post-2026-04-23 Supabase-advisor convention (HANDOFF §6
-- item 21).

CREATE TABLE IF NOT EXISTS public.episode_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  show_id text NOT NULL,
  season_number int NOT NULL CHECK (season_number >= 1),
  episode_number int NOT NULL CHECK (episode_number >= 1),
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, show_id, season_number, episode_number)
);

CREATE INDEX IF NOT EXISTS idx_episode_ratings_user_show
  ON public.episode_ratings (user_id, show_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_episode_ratings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_episode_ratings_touch_updated_at ON public.episode_ratings;
CREATE TRIGGER trg_episode_ratings_touch_updated_at
  BEFORE UPDATE ON public.episode_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_episode_ratings_updated_at();

-- RLS
ALTER TABLE public.episode_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS episode_ratings_select ON public.episode_ratings;
DROP POLICY IF EXISTS episode_ratings_insert ON public.episode_ratings;
DROP POLICY IF EXISTS episode_ratings_update ON public.episode_ratings;
DROP POLICY IF EXISTS episode_ratings_delete ON public.episode_ratings;

CREATE POLICY episode_ratings_select
  ON public.episode_ratings
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY episode_ratings_insert
  ON public.episode_ratings
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY episode_ratings_update
  ON public.episode_ratings
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY episode_ratings_delete
  ON public.episode_ratings
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Single-round-trip read for the V2 friend room map. Returns one row per
-- current member + one row per departed-and-not-rejoined member. Each row
-- carries that member's progress on the room's show, their full ratings
-- list for the show (as a jsonb array), and the room's entries authored by
-- that member (jsonb array, soft-deleted threads filtered out).
--
-- Authz: caller must be a current member of the named group; otherwise the
-- function raises and the RPC returns an error to the client.
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
DECLARE
  v_show_id text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.friend_group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  SELECT show_id INTO v_show_id
  FROM public.friend_groups WHERE id = p_group_id;

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
