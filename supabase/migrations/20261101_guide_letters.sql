-- ============================================================
-- 2026-11-01 — Open letters in the show guide, CP2: storage
-- ============================================================
-- A letter on an episode written FROM the show guide, outside any room.
-- Who can read one: the writer, and every friend (anyone sharing a live
-- group with the writer) whose own progress on the show is at or past the
-- episode it's stamped with. Everyone else can't see the row at all, so
-- the guide can't leak that it exists (the dashboard's "wrote about it"
-- note is a separate, episode-free signal — CP4).
--
-- Deleting your own letter = deleted_at (soft), via UPDATE; there is no
-- DELETE policy. The views table carries the per-episode "seen" stamp
-- that clears the guide's unread dot (letters created after seen_at are
-- unread), the way friend_group_thread_views does for rooms.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.guide_letters (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  show_id     TEXT         NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  season      INTEGER      NOT NULL CHECK (season  >= 1),
  episode     INTEGER      NOT NULL CHECK (episode >= 1),
  body        TEXT         NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS guide_letters_show_idx
  ON public.guide_letters (show_id, season, episode, created_at);
CREATE INDEX IF NOT EXISTS guide_letters_user_idx
  ON public.guide_letters (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.guide_letter_views (
  user_id     UUID         NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  show_id     TEXT         NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  season      INTEGER      NOT NULL,
  episode     INTEGER      NOT NULL,
  seen_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, show_id, season, episode)
);


-- ── Helpers (SECURITY DEFINER: the policies below need other users'
--    memberships, which friend_group_members' own RLS may hide) ──────────

-- Do I share a live (not soft-deleted) group with p_other?
CREATE OR REPLACE FUNCTION public.shares_group_with(p_other UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.friend_group_members a
      JOIN public.friend_group_members b ON b.group_id = a.group_id
      JOIN public.friend_groups g        ON g.id = a.group_id AND g.deleted_at IS NULL
     WHERE a.user_id = auth.uid()
       AND b.user_id = p_other
       AND p_other  <> auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.shares_group_with(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shares_group_with(UUID) TO authenticated;

-- Is MY effective progress on the show (the rewatch's high-water mark when
-- rewatching, as the client's effectiveProgress) at or past (season, episode)?
CREATE OR REPLACE FUNCTION public.viewer_past_episode(p_show_id TEXT, p_season INTEGER, p_episode INTEGER)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
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
  );
$$;
REVOKE ALL ON FUNCTION public.viewer_past_episode(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_past_episode(TEXT, INTEGER, INTEGER) TO authenticated;


-- ── guide_letters: RLS ──────────────────────────────────────────────────
ALTER TABLE public.guide_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guide_letters_select ON public.guide_letters;
CREATE POLICY guide_letters_select
  ON public.guide_letters FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      user_id = auth.uid()
      OR (
        public.shares_group_with(user_id)
        AND public.viewer_past_episode(show_id, season, episode)
      )
    )
  );

-- You can only write about an episode you're at or past.
DROP POLICY IF EXISTS guide_letters_insert ON public.guide_letters;
CREATE POLICY guide_letters_insert
  ON public.guide_letters FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.viewer_past_episode(show_id, season, episode)
  );

-- Your own rows only: the soft delete.
DROP POLICY IF EXISTS guide_letters_update ON public.guide_letters;
CREATE POLICY guide_letters_update
  ON public.guide_letters FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ── guide_letter_views: RLS (yours only) ────────────────────────────────
ALTER TABLE public.guide_letter_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guide_letter_views_all ON public.guide_letter_views;
CREATE POLICY guide_letter_views_all
  ON public.guide_letter_views FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.guide_letters      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.guide_letter_views TO authenticated;
