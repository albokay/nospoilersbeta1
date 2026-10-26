-- ============================================================
-- 2026-10-25 — Letters after a binge, CP1: the range on a letter.
--
-- When someone marks progress two or more episodes past a real earlier
-- position (never from "haven't started", never on a rewatch), the letter
-- written in the compose that opens right after remembers the FIRST NEW
-- episode of that stretch. The letter is still stamped — and sealed — at
-- the episode it was written from (season/episode, unchanged); the range
-- is display only: the stamp reads "S1 / E4-7", the sealed row says the
-- friend wrote it "after watching four in a row", and the daily email
-- names it the same way. Letters written from the Write button, or after
-- a single-episode advance, leave both columns null.
-- ============================================================

ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS from_season  integer,
  ADD COLUMN IF NOT EXISTS from_episode integer;

-- Both or neither.
ALTER TABLE public.threads DROP CONSTRAINT IF EXISTS threads_from_pair_check;
ALTER TABLE public.threads
  ADD CONSTRAINT threads_from_pair_check
  CHECK ((from_season IS NULL) = (from_episode IS NULL));

COMMENT ON COLUMN public.threads.from_season  IS 'Letters after a binge (2026-10-25): the first new episode of the stretch this letter was written after; null for a letter written after a single-episode advance or from the Write button. Display only — season/episode stay the stamp and the seal.';
COMMENT ON COLUMN public.threads.from_episode IS 'See from_season.';
