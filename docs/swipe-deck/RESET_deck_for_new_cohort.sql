-- ============================================================================
-- DECK RESET — wipe every answer, and put the whole deck in play
-- ============================================================================
-- Rewritten 2026-08-01 for the PERSONAL SCHEDULE model. NOT a migration to
-- apply blindly — a deliberate, destructive operation. Paste into the
-- Supabase SQL editor when you actually want the reset.
--
-- ── WHAT CHANGED ABOUT "RESETTING THE CLOCK" ────────────────────────────────
-- There is no longer a clock to reset. Pacing is now PER PERSON: everyone
-- walks the same ordered deck and receives their next 4 questions two weeks
-- after they last answered new ones. Release dates no longer pace anything —
-- `released_at` is only a live / not-yet-live flag on the question itself.
--
-- So a reset is now just two things:
--   1. Delete every answer. Everyone starts from the top of the deck.
--   2. Make the whole deck live, so each person's queue holds the full
--      runway instead of stopping at the old calendar's cut-off.
--
-- ── WHAT TO EXPECT AFTERWARD ────────────────────────────────────────────────
--   • EXISTING accounts (you + current testers): eligible immediately (their
--     pacing anchor falls back to signup, long past), so the next visit
--     serves 4 questions — then every two weeks, 4 at a time.
--   • NEW users: the onboarding questions at signup, then their first batch
--     two weeks later, and onward at their own pace regardless of when they
--     joined. This is the point of the model — the deck is a full-length
--     program for everyone who ever joins, not a calendar that expires.
--   • Anyone impatient can clear as many as they like via the answer grid's
--     edit pencil; those questions leave their queue automatically.
--   • The findings + answer grids read empty until people re-answer.
--   • The invite email's opening line (which quotes the inviter's own answer
--     to "just wait till you see episode 4") falls back to its generic
--     version until the inviter answers that question again.
--
-- (The old "four reserved questions get stranded" gap is CLOSED as of
-- 2026-08-01 — every question is drip-reachable now, so a wipe leaves
-- nothing that only the grid pencil could fix.)
--
-- NOT AFFECTED: the questions themselves, their wording, the negation forms,
-- group/room data, writing, invites, or anything outside the deck.
--
-- Browser-side leftovers, for completeness — neither needs action:
--   • ns_deck_drip_<userId> (sessionStorage) — the once-per-session flag;
--     clears itself when the tab/session ends.
--   • ns_deck_pending (localStorage) — pre-signup answers awaiting claim on
--     a specific browser. If someone signs in on that browser after the
--     reset, those parked answers get written. Clear the site's storage in
--     that browser if you want a truly spotless slate.
-- ============================================================================

BEGIN;

-- ── 1. Wipe every answer ────────────────────────────────────────────────────
DELETE FROM public.deck_answers;

-- ── 2. Put the whole deck in play ───────────────────────────────────────────
-- Under personal pacing every live question belongs in everyone's queue; the
-- old future-dated batches would otherwise stay unreachable. Order comes from
-- sort_order, so a shared timestamp here changes nothing about sequence.
UPDATE public.deck_cards
SET released_at = now() - interval '1 minute'
WHERE released_at > now();

COMMIT;

-- ── Holding questions back (optional) ───────────────────────────────────────
-- Anything you haven't finished writing can sit out of everyone's queue by
-- dating it forward. It joins the queue in sort_order position once live.
--
-- UPDATE public.deck_cards SET released_at = now() + interval '10 years'
--  WHERE id IN ('some-unfinished-card');

-- ── Verify (run after committing) ───────────────────────────────────────────
-- Expect: 0 answers, and every card live.
--
-- SELECT count(*) AS answers_remaining FROM public.deck_answers;
--
-- SELECT count(*) FILTER (WHERE released_at <= now()) AS live,
--        count(*) FILTER (WHERE released_at >  now()) AS held_back,
--        count(*) AS total
--   FROM public.deck_cards;
