-- ============================================================
-- Deck negation forms (negations CP3, 2026-07-28)
-- ============================================================
-- Two nullable wording columns — each card's "NO form" — unlocking the
-- findings engine's NO-based lines: solo-NO hot takes ("You're the only
-- one who has never…"), all-NO unanimity, duo/trio-NO lines, and their
-- findings-card flavors. A NULL form = the engine never fires a NO-based
-- line for that card (the safety valve).
--
-- Wording: drafts approved-for-now by Alborz 2026-07-28
-- (docs/swipe-deck/negation-drafts.md). Adjust wording anytime by editing
-- the UPDATEs — the whole script is safe to re-run.
-- NOTE win-me-back uses the drafts doc's who-form alternative ("never lets
-- a show back in…") because the primary draft didn't fit the
-- "the only one who…" sentence frame.
-- ============================================================

ALTER TABLE public.deck_cards
  ADD COLUMN IF NOT EXISTS singular_neg text,
  ADD COLUMN IF NOT EXISTS plural_neg   text;

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t check their phone during television',
  plural_neg   = 'don''t check their phone during television'
WHERE id = 'phone-during-tv';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think "just wait till you see episode 4" is a spoiler',
  plural_neg   = 'don''t think "just wait till you see episode 4" is a spoiler'
WHERE id = 'just-wait-ep4';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t mind spoilers for a show they''ll never watch',
  plural_neg   = 'don''t mind spoilers for shows they''ll never watch'
WHERE id = 'spoiled-never-watch';

UPDATE public.deck_cards SET
  singular_neg = 'won''t finish a bad show out of spite',
  plural_neg   = 'won''t finish a bad show out of spite'
WHERE id = 'spite-watch';

UPDATE public.deck_cards SET
  singular_neg = 'has never been spoiled by a thumbnail',
  plural_neg   = 'have never been spoiled by a thumbnail'
WHERE id = 'spoiled-by-thumbnail';

UPDATE public.deck_cards SET
  singular_neg = 'has never quietly finished a show they were supposed to be watching with someone',
  plural_neg   = 'have never quietly finished a show they were supposed to be watching with someone'
WHERE id = 'quietly-finished';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t have a show they love too much to finish',
  plural_neg   = 'don''t have a show they love too much to finish'
WHERE id = 'cant-finish-loved';

UPDATE public.deck_cards SET
  singular_neg = 'has never lied about liking a show a friend loves',
  plural_neg   = 'have never lied about liking a show a friend loves'
WHERE id = 'lied-about-liking';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t avoid trailers',
  plural_neg   = 'don''t avoid trailers'
WHERE id = 'avoid-trailers';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t read about a show before starting it',
  plural_neg   = 'don''t read about a show before starting it'
WHERE id = 'read-before-start';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t give shows a two-episode deadline',
  plural_neg   = 'don''t give shows a two-episode deadline'
WHERE id = 'two-episodes';

UPDATE public.deck_cards SET
  singular_neg = 'has never lied about being caught up',
  plural_neg   = 'have never lied about being caught up'
WHERE id = 'lied-caught-up';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think reaction videos count as spoilers',
  plural_neg   = 'don''t think reaction videos count as spoilers'
WHERE id = 'reaction-videos';

UPDATE public.deck_cards SET
  singular_neg = 'thinks knowing what happens can ruin a show',
  plural_neg   = 'think knowing what happens can ruin a show'
WHERE id = 'knowing-doesnt-ruin';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t hate sad endings',
  plural_neg   = 'don''t hate sad endings'
WHERE id = 'hate-sad-endings';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think three episodes is enough to judge a show',
  plural_neg   = 'don''t think three episodes is enough to judge a show'
WHERE id = 'three-episodes';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think "nothing happens in this one" is a spoiler',
  plural_neg   = 'don''t think "nothing happens in this one" is a spoiler'
WHERE id = 'nothing-happens';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think a good show survives being spoiled',
  plural_neg   = 'don''t think a good show survives being spoiled'
WHERE id = 'survives-spoiling';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t count a quit show as watched',
  plural_neg   = 'don''t count a quit show as watched'
WHERE id = 'quit-counts-watched';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t always watch with subtitles on',
  plural_neg   = 'don''t always watch with subtitles on'
WHERE id = 'subtitles-always';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t mind hearing "this one''s good"',
  plural_neg   = 'don''t mind hearing "this one''s good"'
WHERE id = 'episode-is-good';

UPDATE public.deck_cards SET
  singular_neg = 'has never read reviews of an episode before watching it',
  plural_neg   = 'have never read reviews of an episode before watching it'
WHERE id = 'reviews-before-watching';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think most shows go on too long',
  plural_neg   = 'don''t think most shows go on too long'
WHERE id = 'too-many-seasons';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think watching at 1.5x speed is fine',
  plural_neg   = 'don''t think watching at 1.5x speed is fine'
WHERE id = 'speed-15x';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think the "next episode" teases are too spoiler-y',
  plural_neg   = 'don''t think the "next episode" teases are too spoiler-y'
WHERE id = 'next-episode-teases';

UPDATE public.deck_cards SET
  singular_neg = 'has never happily watched a show that was ruined for them',
  plural_neg   = 'have never happily watched a show that was ruined for them'
WHERE id = 'ruined-watched-anyway';

UPDATE public.deck_cards SET
  singular_neg = 'has never quit a show over one bad episode',
  plural_neg   = 'have never quit a show over one bad episode'
WHERE id = 'quit-one-bad-episode';

UPDATE public.deck_cards SET
  singular_neg = 'won''t watch a show they don''t like just because someone they love loves it',
  plural_neg   = 'won''t watch a show they don''t like just because someone they love loves it'
WHERE id = 'watch-for-love';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t text "no-spoilers" to their friends',
  plural_neg   = 'don''t text "no-spoilers" to their friends'
WHERE id = 'text-no-spoilers';

UPDATE public.deck_cards SET
  singular_neg = 'would rather be surprised than know it''s worth it',
  plural_neg   = 'would rather be surprised than know it''s worth it'
WHERE id = 'worth-it-over-surprise';

UPDATE public.deck_cards SET
  singular_neg = 'needs more than the pilot to decide',
  plural_neg   = 'need more than the pilot to decide'
WHERE id = 'pilot-is-enough';

UPDATE public.deck_cards SET
  singular_neg = 'has never watched a show out of order',
  plural_neg   = 'have never watched a show out of order'
WHERE id = 'out-of-order';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think casting news is a spoiler',
  plural_neg   = 'don''t think casting news is a spoiler'
WHERE id = 'casting-news';

UPDATE public.deck_cards SET
  singular_neg = 'has never watched clips of a show they hadn''t started',
  plural_neg   = 'have never watched clips of a show they hadn''t started'
WHERE id = 'clips-before-start';

UPDATE public.deck_cards SET
  singular_neg = 'is fine with a show that''s just "fine"',
  plural_neg   = 'are fine with a show that''s just "fine"'
WHERE id = 'life-too-short';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t "watch" while doing something else',
  plural_neg   = 'don''t "watch" while doing something else'
WHERE id = 'second-screen';

UPDATE public.deck_cards SET
  singular_neg = 'watches a finale like any other episode',
  plural_neg   = 'watch a finale like any other episode'
WHERE id = 'finale-knowledge';

UPDATE public.deck_cards SET
  singular_neg = 'has never enjoyed a show more the second time around',
  plural_neg   = 'have never enjoyed a show more the second time around'
WHERE id = 'better-second-time';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think needing a recap means the show has failed',
  plural_neg   = 'don''t think needing a recap means the show has failed'
WHERE id = 'recap-failed';

UPDATE public.deck_cards SET
  singular_neg = 'has never started a series at season two',
  plural_neg   = 'have never started a series at season two'
WHERE id = 'started-season-two';

UPDATE public.deck_cards SET
  singular_neg = 'has never asked "does it get better" and regretted it',
  plural_neg   = 'have never asked "does it get better" and regretted it'
WHERE id = 'does-it-get-better';

UPDATE public.deck_cards SET
  singular_neg = 'thinks spoiler warnings are still necessary after a week',
  plural_neg   = 'think spoiler warnings are still necessary after a week'
WHERE id = 'week-old-spoilers';

UPDATE public.deck_cards SET
  singular_neg = 'thinks a bad finale can ruin a great season',
  plural_neg   = 'think a bad finale can ruin a great season'
WHERE id = 'bad-finale-great-season';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t fall asleep during television',
  plural_neg   = 'don''t fall asleep during television'
WHERE id = 'fall-asleep';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t check the episode count before starting a season',
  plural_neg   = 'don''t check the episode count before starting a season'
WHERE id = 'episode-count';

UPDATE public.deck_cards SET
  singular_neg = 'thinks a show built on a twist can still be a great show',
  plural_neg   = 'think a show built on a twist can still be a great show'
WHERE id = 'twist-whole-point';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think a finale can retroactively ruin a series',
  plural_neg   = 'don''t think a finale can retroactively ruin a series'
WHERE id = 'finale-ruins-series';

UPDATE public.deck_cards SET
  singular_neg = 'has never defended a show they know is bad',
  plural_neg   = 'have never defended a show they know is bad'
WHERE id = 'defended-bad-show';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think an episode title can be a spoiler',
  plural_neg   = 'don''t think an episode title can be a spoiler'
WHERE id = 'episode-title';

UPDATE public.deck_cards SET
  singular_neg = 'has never abandoned a show one episode from the end',
  plural_neg   = 'have never abandoned a show one episode from the end'
WHERE id = 'abandoned-near-end';

UPDATE public.deck_cards SET
  singular_neg = 'won''t forgive a bad pilot',
  plural_neg   = 'won''t forgive a bad pilot'
WHERE id = 'bad-pilot-ok';

UPDATE public.deck_cards SET
  singular_neg = 'has never missed a plot point and just kept going',
  plural_neg   = 'have never missed a plot point and just kept going'
WHERE id = 'missed-plot-point';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think a finale''s runtime tells you too much',
  plural_neg   = 'don''t think a finale''s runtime tells you too much'
WHERE id = 'finale-runtime';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t think prestige TV is mostly boring',
  plural_neg   = 'don''t think prestige TV is mostly boring'
WHERE id = 'prestige-boring';

UPDATE public.deck_cards SET
  singular_neg = 'has never kept watching just to see how bad it gets',
  plural_neg   = 'have never kept watching just to see how bad it gets'
WHERE id = 'how-bad-it-gets';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t like bottle episodes',
  plural_neg   = 'don''t like bottle episodes'
WHERE id = 'bottle-episodes';

UPDATE public.deck_cards SET
  singular_neg = 'wants to know at least a little going in',
  plural_neg   = 'want to know at least a little going in'
WHERE id = 'knowing-nothing';

UPDATE public.deck_cards SET
  singular_neg = 'braves the Internet even when they''re behind on a show they love',
  plural_neg   = 'brave the Internet even when they''re behind on a show they love'
WHERE id = 'stay-off-internet';

UPDATE public.deck_cards SET
  singular_neg = 'never lets a show back in after writing it off',
  plural_neg   = 'never let a show back in after writing it off'
WHERE id = 'win-me-back';

UPDATE public.deck_cards SET
  singular_neg = 'doesn''t give every show a full season',
  plural_neg   = 'don''t give every show a full season'
WHERE id = 'full-season';
