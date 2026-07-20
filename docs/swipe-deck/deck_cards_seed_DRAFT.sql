-- ============================================================================
-- SWIPE DECK — card seed (APPLIED to prod 2026-07-17; kept for env spin-up)
-- ⚠️ SUPERSEDED IN PART 2026-07-20 by onboarding_changeset_CP1.sql (same
-- folder): the onboarding 8 was re-selected (new card `just-wait-ep4`; new
-- wave/sort assignments; avoid-trailers / three-episodes / lied-caught-up /
-- fall-asleep / full-season demoted to drip). For a fresh env: apply THIS
-- file first, then the changeset. Prod truth = this file + the changeset.
-- ============================================================================
-- Apply AFTER the CP1 migration creates public.deck_cards.
-- Paste-ready for the SQL editor, per the onboarding-prompts precedent
-- (DB-only content rows; this file is a review artifact, not a migration).
--
-- HOW TO READ THIS FILE
--   • 59 cards total, transcribed verbatim from the spec §4 tables.
--     (Spec §2 says "~53 authored" — the §4 tables actually hold 59.)
--   • axis_x: -1 = "I'll watch anything"  /  +1 = "impress me"
--     axis_y: -1 = "NO spoilers"          /  +1 = "meh"
--     Pole assignments follow the spec's §4.2–4.5 section placement.
--   • ⚠️ FLAG 1 — the four §4.6 "both axes" cards (speed-15x, second-screen,
--     phone-during-tv, missed-plot-point) are seeded 0/0 (off-axis) because
--     ±1 can't express "both poles of the same axis" (§3's 1.5x example).
--     They still generate hot takes; they just don't move the map until you
--     assign signs. Decide before the map ships (≥1 drip away) — one UPDATE.
--   • ⚠️ FLAG 2 — card_type is an INITIAL GUESS on every row (the spec says
--     classification is empirical). Composition of guesses: 40 split /
--     13 confession / 6 consensus. Correct freely; one UPDATE per card.
--   • wave 1 / wave 2 = the fixed onboarding 8 (same for every user, forever).
--     Proposed composition per §12.8 — wave 1 fast + low-stakes (3 splits +
--     1 consensus; opens with phone-during-tv, the card in your mockup),
--     wave 2 the confessions (3 confessions + 1 split).
--   • Drip cards: wave NULL, released in batches of 4 (last batch = 3) every
--     2 weeks from v_launch. 13 batches ≈ 26 weeks of runway. Batches are
--     mixed across poles so no drip is single-topic. spite-watch (your
--     group-room drip mockup card) is in batch 2.
--   • cold (the §7.5.7 stranger-legible restatement) is NULL everywhere —
--     authoring task, only needed once the shareable/Findings quote a card
--     whose singular/plural reads too insider. Renderers fall back:
--     cold → singular/plural.
--   • sort_order = global serve/display order (grid rows render in this
--     order; the drip modal serves unanswered cards in this order).
--
-- EDIT v_launch BELOW before applying — it anchors wave availability (day 0)
-- and every drip date (launch + 2w, +4w, …).
-- ============================================================================

DO $$
DECLARE
  v_launch timestamptz := '2026-07-20 09:00:00-07';  -- ← EDIT ME: deck go-live
BEGIN

INSERT INTO public.deck_cards
  (id, statement, singular, plural, axis_x, axis_y, card_type, wave, released_at, sort_order)
VALUES

-- ─── WAVE 1 (onboarding, first 4) ────────────────────────────────────────────
('phone-during-tv',
 'I check my phone during television.',
 'checks their phone during television',
 'check their phone during television',
 0, 0, 'split', 1, v_launch, 1),                      -- ⚠️ both-axes, seeded 0/0
('avoid-trailers',
 'I proactively stay away from trailers.',
 'proactively stays away from trailers',
 'proactively stay away from trailers',
 0, -1, 'split', 1, v_launch, 2),
('three-episodes',
 'Three episodes is enough to judge a show.',
 'says three episodes is enough to judge a show',
 'say three episodes is enough to judge a show',
 1, 0, 'split', 1, v_launch, 3),
('spoiled-by-thumbnail',
 'I''ve been spoiled by a thumbnail.',
 'has been spoiled by a thumbnail',
 'have been spoiled by a thumbnail',
 0, -1, 'consensus', 1, v_launch, 4),

-- ─── WAVE 2 (onboarding, "a few more…") ──────────────────────────────────────
('lied-caught-up',
 'I''ve lied about being caught up with a show...for whatever reason.',  -- copy edit 2026-07-18
 'has lied about being caught up',
 'have lied about being caught up',
 0, 0, 'confession', 2, v_launch, 5),
('quietly-finished',
 'I''ve quietly finished a show I was supposed to be watching with someone.',
 'has quietly finished a show they were supposed to be watching with someone',
 'have quietly finished a show they were supposed to be watching with someone',
 0, 0, 'confession', 2, v_launch, 6),
('fall-asleep',
 'I fall asleep during television regularly.',
 'falls asleep during television, regularly',
 'fall asleep during television, regularly',
 1, 0, 'confession', 2, v_launch, 7),
('full-season',
 'I''ll give a show at least one full season.',
 'will give a show at least one full season',
 'will give a show at least one full season',
 -1, 0, 'split', 2, v_launch, 8),

-- ─── DRIP BATCH 1 (launch + 2 weeks) ─────────────────────────────────────────
('spoiled-never-watch',
 'Even if I know I''m not gonna watch a show, I still don''t want to be spoiled.',
 'doesn''t want to be spoiled — even for a show they''ll never watch',
 'don''t want to be spoiled — even for a show they''ll never watch',
 0, -1, 'split', NULL, v_launch + interval '2 weeks', 9),
('read-before-start',
 'I like to read about TV shows before I start them.',
 'likes to read about a show before starting it',
 'like to read about a show before starting it',
 0, 1, 'split', NULL, v_launch + interval '2 weeks', 10),
('two-episodes',
 'I''ll give a show two episodes to keep me watching.',
 'will give a show two episodes to keep them watching',
 'will give a show two episodes to keep them watching',
 1, 0, 'split', NULL, v_launch + interval '2 weeks', 11),
('lied-about-liking',
 'I''ve lied about liking a show a friend loves.',
 'has lied about liking a show a friend loves',
 'have lied about liking a show a friend loves',
 0, 0, 'confession', NULL, v_launch + interval '2 weeks', 12),

-- ─── DRIP BATCH 2 (launch + 4 weeks) ─────────────────────────────────────────
('reaction-videos',
 'Reaction videos count as spoilers.',
 'thinks reaction videos count as spoilers',
 'think reaction videos count as spoilers',
 0, -1, 'split', NULL, v_launch + interval '4 weeks', 13),
('knowing-doesnt-ruin',
 'Knowing what happens doesn''t ruin anything.',
 'thinks knowing what happens doesn''t ruin anything',
 'think knowing what happens doesn''t ruin anything',
 0, 1, 'split', NULL, v_launch + interval '4 weeks', 14),
('spite-watch',
 'I''ll watch a bad show to the end out of spite and/or morbid curiosity.',
 'will watch a bad show to the end out of spite',
 'will watch a bad show to the end out of spite',
 -1, 0, 'split', NULL, v_launch + interval '4 weeks', 15),
('hate-sad-endings',
 'I hate sad endings.',
 'hates sad endings',
 'hate sad endings',
 0, 0, 'split', NULL, v_launch + interval '4 weeks', 16),

-- ─── DRIP BATCH 3 (launch + 6 weeks) ─────────────────────────────────────────
('nothing-happens',
 'Saying "nothing happens in this one" is a spoiler.',
 'thinks "nothing happens in this one" is a spoiler',
 'think "nothing happens in this one" is a spoiler',
 0, -1, 'split', NULL, v_launch + interval '6 weeks', 17),
('survives-spoiling',
 'A good show survives being spoiled.',
 'says a good show survives being spoiled',
 'say a good show survives being spoiled',
 0, 1, 'split', NULL, v_launch + interval '6 weeks', 18),
('quit-counts-watched',
 'A show you quit still counts as watched.',
 'says a show you quit still counts as watched',
 'say a show you quit still counts as watched',
 1, 0, 'split', NULL, v_launch + interval '6 weeks', 19),
('subtitles-always',
 'Subtitles on, always.',
 'watches with subtitles on, always',
 'watch with subtitles on, always',
 0, 0, 'split', NULL, v_launch + interval '6 weeks', 20),

-- ─── DRIP BATCH 4 (launch + 8 weeks) ─────────────────────────────────────────
('episode-is-good',
 'If someone tells me an episode is good, that''s already too much.',
 'thinks "this one''s good" is already too much',
 'think "this one''s good" is already too much',
 0, -1, 'split', NULL, v_launch + interval '8 weeks', 21),
('reviews-before-watching',
 'I''ve read reviews of an episode before watching it.',
 'has read reviews of an episode before watching it',
 'have read reviews of an episode before watching it',
 0, 1, 'split', NULL, v_launch + interval '8 weeks', 22),
('too-many-seasons',
 'Most shows go on for too many seasons.',
 'thinks most shows go on too long',
 'think most shows go on too long',
 1, 0, 'consensus', NULL, v_launch + interval '8 weeks', 23),
('speed-15x',
 'Watching at 1.5x speed is fine.',
 'says watching at 1.5x speed is fine',
 'say watching at 1.5x speed is fine',
 0, 0, 'confession', NULL, v_launch + interval '8 weeks', 24),  -- ⚠️ both-axes, seeded 0/0

-- ─── DRIP BATCH 5 (launch + 10 weeks) ────────────────────────────────────────
('next-episode-teases',
 'The "next episode" teases after an episode are too spoiler-y.',
 'thinks the "next episode" teases are too spoiler-y',
 'think the "next episode" teases are too spoiler-y',
 0, -1, 'split', NULL, v_launch + interval '10 weeks', 25),
('ruined-watched-anyway',
 'I''ve had a show ruined for me and watched it anyway, happily.',
 'has had a show ruined and watched it anyway, happily',
 'have had a show ruined and watched it anyway, happily',
 0, 1, 'split', NULL, v_launch + interval '10 weeks', 26),
('quit-one-bad-episode',
 'I''ve quit a show because of one bad episode.',
 'has quit a show over one bad episode',
 'have quit a show over one bad episode',
 1, 0, 'confession', NULL, v_launch + interval '10 weeks', 27),
('watch-for-love',
 'I''ll watch a show I don''t like because someone I love loves it.',
 'will watch a show they don''t like because someone they love loves it',
 'will watch a show they don''t like because someone they love loves it',
 -1, 0, 'consensus', NULL, v_launch + interval '10 weeks', 28), -- ⭐ spec-flagged special card

-- ─── DRIP BATCH 6 (launch + 12 weeks) ────────────────────────────────────────
('text-no-spoilers',
 'I regularly text "no-spoilers" to my friends.',
 'regularly texts "no-spoilers" to their friends',
 'regularly text "no-spoilers" to their friends',
 0, -1, 'split', NULL, v_launch + interval '12 weeks', 29),
('worth-it-over-surprise',
 'I''d rather know it''s worth it than be surprised.',
 'would rather know it''s worth it than be surprised',
 'would rather know it''s worth it than be surprised',
 0, 1, 'split', NULL, v_launch + interval '12 weeks', 30),
('pilot-is-enough',
 'The pilot is all I need to know whether I''ll keep watching.',
 'says the pilot tells them everything they need to know',
 'say the pilot tells them everything they need to know',
 1, 0, 'split', NULL, v_launch + interval '12 weeks', 31),
('out-of-order',
 'I''ve watched a show out of order.',
 'has watched a show out of order',
 'have watched a show out of order',
 0, 0, 'confession', NULL, v_launch + interval '12 weeks', 32),

-- ─── DRIP BATCH 7 (launch + 14 weeks) ────────────────────────────────────────
('casting-news',
 'Casting news is a spoiler.',
 'says casting news is a spoiler',
 'say casting news is a spoiler',
 0, -1, 'split', NULL, v_launch + interval '14 weeks', 33),
('clips-before-start',
 'I''ve watched clips of a show I hadn''t started yet.',
 'has watched clips of a show they hadn''t started',
 'have watched clips of a show they hadn''t started',
 0, 1, 'split', NULL, v_launch + interval '14 weeks', 34),
('life-too-short',
 'Life''s too short for a show that''s just "fine".',
 'says life''s too short for a show that''s just "fine"',
 'say life''s too short for a show that''s just "fine"',
 1, 0, 'split', NULL, v_launch + interval '14 weeks', 35),
('second-screen',
 'I regularly "watch" while doing something else.',
 'regularly "watches" while doing something else',
 'regularly "watch" while doing something else',
 0, 0, 'split', NULL, v_launch + interval '14 weeks', 36),     -- ⚠️ both-axes, seeded 0/0

-- ─── DRIP BATCH 8 (launch + 16 weeks) ────────────────────────────────────────
('finale-knowledge',
 'Knowing an episode is the last of the season changes how I watch it.',
 'watches a finale differently just for knowing it''s a finale',
 'watch a finale differently just for knowing it''s a finale',
 0, -1, 'split', NULL, v_launch + interval '16 weeks', 37),
('better-second-time',
 'I''ve enjoyed a show more the second time, knowing everything.',
 'has enjoyed a show more the second time, knowing everything',
 'have enjoyed a show more the second time, knowing everything',
 0, 1, 'split', NULL, v_launch + interval '16 weeks', 38),
('recap-failed',
 'If I need a recap to keep going, the show has failed.',
 'thinks needing a recap means the show has failed',
 'think needing a recap means the show has failed',
 1, 0, 'split', NULL, v_launch + interval '16 weeks', 39),
('started-season-two',
 'I''ve started a series at season two.',
 'has started a series at season two',
 'have started a series at season two',
 0, 0, 'confession', NULL, v_launch + interval '16 weeks', 40),

-- ─── DRIP BATCH 9 (launch + 18 weeks) ────────────────────────────────────────
('does-it-get-better',
 'I''ve asked someone "does it get better" and regretted the answer.',
 'has asked "does it get better" and regretted the answer',
 'have asked "does it get better" and regretted the answer',
 0, -1, 'confession', NULL, v_launch + interval '18 weeks', 41),
('week-old-spoilers',
 'I don''t think spoiler warnings are necessary after a week.',
 'doesn''t think spoiler warnings are necessary after a week',
 'don''t think spoiler warnings are necessary after a week',
 0, 1, 'split', NULL, v_launch + interval '18 weeks', 42),
('bad-finale-great-season',
 'A great season with a bad finale is still a great season.',
 'says a bad finale doesn''t ruin a great season',
 'say a bad finale doesn''t ruin a great season',
 -1, 0, 'split', NULL, v_launch + interval '18 weeks', 43),
('cant-finish-loved',
 'There are shows I love so much I can''t bring myself to finish them.',
 'loves some shows too much to finish them',
 'love some shows too much to finish them',
 0, 0, 'confession', NULL, v_launch + interval '18 weeks', 44),

-- ─── DRIP BATCH 10 (launch + 20 weeks) ───────────────────────────────────────
('episode-count',
 'I check the episode count before I start a season.',
 'checks the episode count before starting a season',
 'check the episode count before starting a season',
 0, -1, 'split', NULL, v_launch + interval '20 weeks', 45),
('twist-whole-point',
 'If a twist is the whole point, it wasn''t a good show.',
 'says a show built on a twist wasn''t a good show',
 'say a show built on a twist wasn''t a good show',
 0, 1, 'split', NULL, v_launch + interval '20 weeks', 46),
('finale-ruins-series',
 'A finale can retroactively ruin a series.',
 'thinks a finale can retroactively ruin a series',
 'think a finale can retroactively ruin a series',
 1, 0, 'split', NULL, v_launch + interval '20 weeks', 47),
('defended-bad-show',
 'I''ve defended a show I know is bad.',
 'has defended a show they know is bad',
 'have defended a show they know is bad',
 0, 0, 'split', NULL, v_launch + interval '20 weeks', 48),

-- ─── DRIP BATCH 11 (launch + 22 weeks) ───────────────────────────────────────
('episode-title',
 'An episode title can be a spoiler.',
 'says an episode title can be a spoiler',
 'say an episode title can be a spoiler',
 0, -1, 'split', NULL, v_launch + interval '22 weeks', 49),
('abandoned-near-end',
 'I''ve abandoned a show one episode from the end.',
 'has abandoned a show one episode from the end',
 'have abandoned a show one episode from the end',
 1, 0, 'confession', NULL, v_launch + interval '22 weeks', 50),
('bad-pilot-ok',
 'It''s ok for the pilot to be bad — I''ll keep watching.',
 'forgives a bad pilot and keeps watching',
 'forgive a bad pilot and keep watching',
 -1, 0, 'split', NULL, v_launch + interval '22 weeks', 51),
('missed-plot-point',
 'I''ve missed a plot point and just kept going.',
 'has missed a plot point and just kept going',
 'have missed a plot point and just kept going',
 0, 0, 'consensus', NULL, v_launch + interval '22 weeks', 52), -- ⚠️ both-axes, seeded 0/0

-- ─── DRIP BATCH 12 (launch + 24 weeks) ───────────────────────────────────────
('finale-runtime',
 'Seeing the runtime of the finale tells you something you shouldn''t know.',
 'thinks a finale''s runtime tells you too much',
 'think a finale''s runtime tells you too much',
 0, -1, 'split', NULL, v_launch + interval '24 weeks', 53),
('prestige-boring',
 'Prestige TV is mostly boring.',
 'says prestige TV is mostly boring',
 'say prestige TV is mostly boring',
 1, 0, 'confession', NULL, v_launch + interval '24 weeks', 54),
('how-bad-it-gets',
 'I''ve kept watching purely to see how bad it gets.',
 'has kept watching purely to see how bad it gets',
 'have kept watching purely to see how bad it gets',
 -1, 0, 'confession', NULL, v_launch + interval '24 weeks', 55),
('bottle-episodes',
 'I like bottle episodes.',
 'likes bottle episodes',
 'like bottle episodes',
 0, 0, 'split', NULL, v_launch + interval '24 weeks', 56),

-- ─── DRIP BATCH 13 (launch + 26 weeks — final 3) ─────────────────────────────
('knowing-nothing',
 'I''d rather go in knowing nothing at all — not even the genre.',
 'would rather go in knowing nothing at all — not even the genre',
 'would rather go in knowing nothing at all — not even the genre',
 0, -1, 'split', NULL, v_launch + interval '26 weeks', 57),
('stay-off-internet',
 'I stay away from the Internet when I''m behind on a show I love.',
 'stays off the Internet when they''re behind on a show they love',
 'stay off the Internet when they''re behind on a show they love',
 0, -1, 'consensus', NULL, v_launch + interval '26 weeks', 58),
('win-me-back',
 'A show can win me back after I''ve written it off.',
 'thinks a show can win them back after they''ve written it off',
 'think a show can win them back after they''ve written it off',
 -1, 0, 'consensus', NULL, v_launch + interval '26 weeks', 59)

ON CONFLICT (id) DO NOTHING;

END $$;

-- ── Post-apply sanity check ──────────────────────────────────────────────────
-- SELECT count(*) FROM public.deck_cards;                          -- expect 59
-- SELECT wave, count(*) FROM public.deck_cards GROUP BY wave;      -- 4 / 4 / 51
-- SELECT card_type, count(*) FROM public.deck_cards GROUP BY 1;    -- 40/13/6

-- ── Admin yes-rate query (the §2 classification check — run anytime) ─────────
-- SELECT c.id, c.card_type, count(a.id) AS answers,
--        round(100.0 * avg(CASE WHEN a.answer THEN 1 ELSE 0 END), 0) AS yes_pct
-- FROM public.deck_cards c
-- LEFT JOIN public.deck_answers a ON a.card_id = c.id
-- GROUP BY c.id, c.card_type
-- ORDER BY answers DESC, c.sort_order;
