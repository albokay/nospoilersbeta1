-- ============================================================
-- Help-system QA round 5 — `just-wait-ep4` card copy update
-- ============================================================
-- "just wait for episode 4" → "just wait till you see episode 4"
-- (Alborz, 2026-07-26). Statement + both restatement forms; the invite
-- email's hardcoded headline changes in lockstep (send-group-invite
-- redeploy). Safe to re-run.
-- ============================================================

UPDATE public.deck_cards
SET statement = 'Telling someone "just wait till you see episode 4" is a spoiler.',
    singular  = 'thinks "just wait till you see episode 4" is a spoiler',
    plural    = 'think "just wait till you see episode 4" is a spoiler'
WHERE id = 'just-wait-ep4';
