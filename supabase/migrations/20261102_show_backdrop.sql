-- ============================================================================
-- 2026-11-02 — The phone room's banner: a show's LANDSCAPE art (the landing-rule
-- arc, CP5).
--
-- shows.backdrop_url — the full https URL of the show's TMDB backdrop at w1280
-- (hotlinked from TMDB's image host under the personal-use licence the
-- trailers already run on; nothing is stored in Supabase Storage). Filled by
-- the nightly `refresh-shows` run (service role; a pass over shows with no
-- backdrop yet, up to 100 a night, Ended shows included — so the whole
-- catalog fills itself the first night or two) through the trailers bridge:
-- tvmaze_id → TVMaze externals → TMDB /find → /tv/{id}.backdrop_path. A show
-- with no TMDB match keeps NULL and the phone shows the TVMaze original
-- poster cropped instead (CP2's banner).
--
-- Reads: authenticated already has SELECT on the table (every column).
-- Writes: authenticated UPDATE is column-locked (20260630) and this column is
-- NOT in the grant — only the service role fills it. Nothing else changes.
-- ============================================================================

ALTER TABLE public.shows ADD COLUMN IF NOT EXISTS backdrop_url text;

COMMENT ON COLUMN public.shows.backdrop_url IS
  'The show''s TMDB backdrop at w1280 (full https URL), for the phone room''s banner; filled by the nightly refresh-shows run, NULL when TMDB has no match.';
