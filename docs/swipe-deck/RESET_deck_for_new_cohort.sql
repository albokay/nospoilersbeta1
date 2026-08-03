-- ============================================================================
-- DECK RESET — put the whole deck in play, and (optionally) wipe answers
-- ============================================================================
-- Revised 2026-08-01 (second pass, after the personal-schedule + grid changes
-- landed). NOT a migration to apply blindly. Paste into the Supabase SQL
-- editor when you actually want this.
--
-- ── READ THIS FIRST: THE WIPE IS NOW OPTIONAL ───────────────────────────────
-- Under the personal schedule there is no calendar to re-anchor, and NEW
-- USERS ALREADY START FROM ZERO — they have no answers, so they walk the deck
-- from question 1 whenever they join. Wiping answers therefore does nothing
-- for the incoming cohort; it only resets YOU and the current testers.
--
--   STEP 1 (do this — it's the one that matters) ....... release the deck
--   STEP 2 (only if you want existing testers reset) ... wipe answers
--
-- ⚠️ BEFORE RUNNING STEP 2, know what it costs (this changed on 2026-08-01):
-- the answer grid now shows only questions SOMEBODY IN THE GROUP has
-- answered. After a full wipe nobody has answered anything, so the deck card
-- disappears entirely and the edit pencil — the old "let me just fill these
-- in" shortcut — has nothing to reach. The ONLY way back is the drip: 4
-- questions, then 4 more two weeks later, for everyone including you. A full
-- 60-question grid would take ~7 months to rebuild.
--   • Testing before beta? Either skip Step 2, or temporarily lower
--     DRIP_INTERVAL_DAYS in src/components/deck/DeckWave.tsx (deploy, fill up,
--     put it back to 14).
--   • Want new users to see a lively grid on arrival? SKIP Step 2 — existing
--     testers' answers are exactly what makes the group grid worth looking at
--     on day one.
--
-- ── WHAT TO EXPECT ──────────────────────────────────────────────────────────
--   • NEW users (either way): onboarding questions at signup, then their
--     first batch two weeks later, then onward at their own pace regardless
--     of when they joined. The deck is a full-length program for everyone who
--     ever joins, not a calendar that expires.
--   • EXISTING accounts after Step 1 only: they keep their answers and simply
--     become eligible for whatever they haven't answered yet.
--   • EXISTING accounts after Step 2: pacing anchor falls back to signup
--     (long past), so the next visit serves 4 — then every two weeks.
--   • Step 2 also blanks the findings, and the invite email's opening line
--     (which quotes the inviter's own answer to "just wait till you see
--     episode 4") falls back to its generic version until the inviter
--     answers that question again.
--
-- NOT AFFECTED: the questions themselves, their wording, the negation forms,
-- group/room data, writing, invites, or anything outside the deck.
--
-- Browser-side leftovers, for completeness — none need action:
--   • ns_deck_drip_<userId> (sessionStorage) — once-per-session drip flag.
--   • ns_joined_this_session (sessionStorage) — defers an invitee's second
--     wave to their next visit; matters only mid-invite.
--   • ns_deck_pending (localStorage) — pre-signup answers awaiting claim on a
--     specific browser. If someone signs in there after a wipe, those parked
--     answers get written. Clear that browser's site storage for a spotless
--     slate.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1 — RELEASE THE WHOLE DECK  (the one that actually matters)
-- ════════════════════════════════════════════════════════════════════════════
-- The seeded batches run out to January 2027. Under personal pacing those
-- dates no longer schedule anything — they just keep the later questions
-- invisible, capping everyone at the first few. This puts all of them in
-- play. Order comes from sort_order, so a shared timestamp changes nothing
-- about sequence.

UPDATE public.deck_cards
SET released_at = now() - interval '1 minute'
WHERE released_at > now();


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2 — WIPE EVERY ANSWER  (OPTIONAL — read the warning at the top)
-- ════════════════════════════════════════════════════════════════════════════
-- Uncomment only if you want existing testers to start over. New users are
-- unaffected either way — they already start from zero.
--
-- DELETE FROM public.deck_answers;


-- ── Holding questions back (optional) ───────────────────────────────────────
-- Anything you haven't finished writing can sit out of everyone's queue by
-- dating it forward. It joins the queue in sort_order position once live.
--
-- UPDATE public.deck_cards SET released_at = now() + interval '10 years'
--  WHERE id IN ('some-unfinished-card');


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Every card live, and (if you ran Step 2) zero answers.
--
-- SELECT count(*) FILTER (WHERE released_at <= now()) AS live,
--        count(*) FILTER (WHERE released_at >  now()) AS held_back,
--        count(*) AS total
--   FROM public.deck_cards;
--
-- SELECT count(*) AS answers_remaining FROM public.deck_answers;
