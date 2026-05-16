-- ============================================================
-- 2026-05-16 — episode_ratings: expand rating scale 1..5 → 1..6
-- ============================================================
-- Rating capture spec splits the old position 3 ("It was fine.")
-- into two new positions ("Solid." and "I'll keep going."), shifting
-- "Losing me." 4→5 and "Nope." 5→6. New full mapping:
--
--   1 = Woah!
--   2 = Things are cooking.
--   3 = Solid.            (new)
--   4 = I'll keep going.  (new)
--   5 = Losing me.        (was 4)
--   6 = Nope.             (was 5)
--
-- No data migration: rating capture UI has never shipped, so there
-- are zero rows in prod. Confirmed with user 2026-05-16. If this
-- assumption is ever wrong, the constraint swap below would fail
-- on any existing row at value 5 going beyond the new ceiling
-- (it won't — 5 is still in range) but downstream display would
-- show the wrong label. Re-check before re-running on an env that
-- might have data.
--
-- Idempotent: drops old constraint by exact name, adds new one.
-- ============================================================

ALTER TABLE public.episode_ratings
  DROP CONSTRAINT IF EXISTS episode_ratings_rating_check;

ALTER TABLE public.episode_ratings
  ADD CONSTRAINT episode_ratings_rating_check
  CHECK (rating BETWEEN 1 AND 6);
