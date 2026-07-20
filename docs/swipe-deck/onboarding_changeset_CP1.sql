-- ============================================================================
-- ONBOARDING CHANGESET — CP1 (spec ~/Downloads/sidebar_onboarding_changeset.md)
-- Paste-ready for the SQL editor. Self-anchoring: reads the live launch date
-- from the existing rows, so nothing needs editing.
--
-- What it does:
--   1. Adds the ONE new card, `just-wait-ep4` (spoiler-ethics; the invite
--      email's quoted card).
--   2. Re-selects the onboarding 8 (3 spoiler-ethics + 5 confessions — the
--      §2 deliberate reversal of "confessions wait"). DB sort = the INVITER
--      serve order (phone-during-tv leads); the invitee path pins
--      just-wait-ep4 first client-side (CP2).
--        wave 1: phone-during-tv, just-wait-ep4, spoiled-never-watch, spite-watch
--        wave 2: spoiled-by-thumbnail, quietly-finished, cant-finish-loved,
--                lied-about-liking
--   3. Demotes the displaced 5 to drip, ONE per upcoming batch (+2w…+10w):
--      avoid-trailers, three-episodes, lied-caught-up, fall-asleep, full-season.
--   4. Renumbers sort_order cleanly by (release date, prior order) so the
--      grid and the drip serve order stay coherent.
--
-- Safe to apply ahead of the CP2/CP3 code — the live frontend reads waves
-- from these columns, so new onboardings serve the new 8 immediately.
-- ============================================================================

DO $$
DECLARE
  v_launch timestamptz;
BEGIN
  SELECT min(released_at) INTO v_launch FROM public.deck_cards;

  -- 1 · the new card (wave 1, slot 2 in the inviter order)
  INSERT INTO public.deck_cards
    (id, statement, singular, plural, axis_x, axis_y, card_type, wave, released_at, sort_order)
  VALUES
    ('just-wait-ep4',
     'Telling someone "just wait for episode 4" is a spoiler.',
     'thinks "just wait for episode 4" is a spoiler',
     'think "just wait for episode 4" is a spoiler',
     0, -1, 'split', 1, v_launch, 2)
  ON CONFLICT (id) DO NOTHING;

  -- 2 · the new first-8
  UPDATE public.deck_cards SET wave = 1, released_at = v_launch, sort_order = 1 WHERE id = 'phone-during-tv';
  UPDATE public.deck_cards SET wave = 1, released_at = v_launch, sort_order = 3 WHERE id = 'spoiled-never-watch';
  UPDATE public.deck_cards SET wave = 1, released_at = v_launch, sort_order = 4 WHERE id = 'spite-watch';
  UPDATE public.deck_cards SET wave = 2, released_at = v_launch, sort_order = 5 WHERE id = 'spoiled-by-thumbnail';
  UPDATE public.deck_cards SET wave = 2, released_at = v_launch, sort_order = 6 WHERE id = 'quietly-finished';
  UPDATE public.deck_cards SET wave = 2, released_at = v_launch, sort_order = 7 WHERE id = 'cant-finish-loved';
  UPDATE public.deck_cards SET wave = 2, released_at = v_launch, sort_order = 8 WHERE id = 'lied-about-liking';

  -- 3 · displaced from the waves → drip, one per upcoming batch
  UPDATE public.deck_cards SET wave = NULL, released_at = v_launch + interval '2 weeks'  WHERE id = 'avoid-trailers';
  UPDATE public.deck_cards SET wave = NULL, released_at = v_launch + interval '4 weeks'  WHERE id = 'three-episodes';
  UPDATE public.deck_cards SET wave = NULL, released_at = v_launch + interval '6 weeks'  WHERE id = 'lied-caught-up';
  UPDATE public.deck_cards SET wave = NULL, released_at = v_launch + interval '8 weeks'  WHERE id = 'fall-asleep';
  UPDATE public.deck_cards SET wave = NULL, released_at = v_launch + interval '10 weeks' WHERE id = 'full-season';

  -- 4 · clean renumber (relative order preserved within each release date)
  UPDATE public.deck_cards c
  SET sort_order = r.rn
  FROM (
    SELECT id, row_number() OVER (ORDER BY released_at, sort_order, id) AS rn
    FROM public.deck_cards
  ) r
  WHERE c.id = r.id;
END $$;

-- ── Sanity checks ────────────────────────────────────────────────────────────
-- The onboarding 8, in inviter serve order (expect sorts 1..8, wave 1/1/1/1/2/2/2/2):
-- SELECT sort_order, wave, id FROM public.deck_cards WHERE wave IS NOT NULL ORDER BY sort_order;
-- Totals (expect 60 cards; 4 in each wave):
-- SELECT count(*) AS total, count(*) FILTER (WHERE wave = 1) AS w1, count(*) FILTER (WHERE wave = 2) AS w2 FROM public.deck_cards;
-- The displaced 5 (expect future dates, one per batch, wave NULL):
-- SELECT id, released_at FROM public.deck_cards WHERE id IN ('avoid-trailers','three-episodes','lied-caught-up','fall-asleep','full-season') ORDER BY released_at;
