-- ============================================================
-- `two-episodes` card copy update (Alborz, 2026-07-29)
-- ============================================================
-- "I'll give a show two episodes…" → "…only two episodes…".
-- Statement + all four restatement forms move in lockstep so the
-- findings lines keep matching the card. Safe to re-run.
-- ============================================================

UPDATE public.deck_cards
SET statement    = 'I''ll give a show only two episodes to keep me watching.',
    singular     = 'will give a show only two episodes to keep them watching',
    plural       = 'will give a show only two episodes to keep them watching',
    singular_neg = 'gives a show more than two episodes to keep them watching',
    plural_neg   = 'give a show more than two episodes to keep them watching'
WHERE id = 'two-episodes';
