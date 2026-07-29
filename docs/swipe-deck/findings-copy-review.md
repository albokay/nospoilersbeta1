# Findings copy — the full language inventory (for Alborz's line-by-line pass, 2026-07-29)

Every user-facing sentence the findings system can emit, grouped by artifact.
All of it lives in ONE file — `src/lib/deckFindings.ts` (search `T_`) — so each
decision here is a one-line edit.

**Status key:**
- **YOURS** — you wrote or explicitly approved this wording (deck-arc CP3 pass, the 07-26 tie copy, or the 07-28 "says NOPE" call)
- **SPEC** — verbatim from the swipe-deck spec (your document, but never re-read as shipping copy)
- **NEW** — written for the findings card mockup (rev 3); approved as layout, never as a wording pass

Example names/numbers below are the spec's worked example (Al's 6-person group, 16 questions).

---

## A. The n=2 header — grid card, BOTH platforms (exactly one friend in the group)

One line, chosen by agreement level, shown above the two-person answer grid.

| # | Fires when | Language | Example | Status |
|---|---|---|---|---|
| A1 | You agree on ≥75% (of ≥4 shared) | You and {name} are practically the same viewer — you agree on {n} of {t}. | You and Christine are practically the same viewer — you agree on 13 of 16. | SPEC |
| A2 | You agree on ≤25% (of ≥8 shared — kept rare) | You and {name} expect different things from TV — you agree on {n} of {t}. But opposites attract… | You and Zoe expect different things from TV — you agree on 3 of 16. But opposites attract… | SPEC |
| A3 | Everything in between | You and {name} agree on {n} of {t} questions: | You and Matt agree on 9 of 16 questions: | SPEC |

---

## B. The Findings sticky — DESKTOP, groups of 3+

Appears beside the opened "How We Watch TV" grid. Shape: one headline (B1–B5),
then your personal lines (B6–B12).

### Headline slot (first that applies)

| # | Fires when | Language | Example | Status |
|---|---|---|---|---|
| B1 | One person has strictly the most hot takes | Your group's renegade is {name} — they have the most hot-takes between you. | Your group's renegade is Zoe — they have the most hot-takes between you. | YOURS |
| B2 | Under B1: the renegade's takes, up to 3, quoted | · "{statement}" | · "Three episodes is enough to judge a show." | YOURS (spec §9.1 quote-don't-inflect) |
| B3 | …when the take is a solo NO | · "{statement}" — {name} says NOPE. | · "I proactively stay away from trailers." — Zoe says NOPE. | YOURS (07-28) |
| B4 | No renegade, nobody has takes, every pair agrees ≥70% | Nobody here has a hot take. ⏎ Friends, aligned. Go forth and watch. | — | SPEC |
| B5a | No renegade, but a card everyone said YES to | All {n} of you {plural}. | All 6 of you think reaction videos count as spoilers. | YOURS |
| B5b | …or a card everyone said NO to (new, 07-28) | All {n} of you {plural_neg}. | All 6 of you don't think casting news is a spoiler. | YOURS template, NEW pairing with the negated forms |
| B5c | None of the above: the most even split | No two of you watch TV the same way. The liveliest split: "{statement}" | No two of you watch TV the same way. The liveliest split: "I hate sad endings." | YOURS |

### Personal lines (below the headline)

| # | Fires when | Language | Example | Status |
|---|---|---|---|---|
| B6 | Your closest match (the pair line) | You and {name} are TV soulmates — you agree on {a} out of {t} questions. | You and Christine are TV soulmates — you agree on 13 out of 16 questions. | YOURS (07-29) |
| B7 | …plus a concrete answer only you two share (appended) | You're the only two who {form}. | You're the only two who regularly text "no-spoilers" to their friends. | YOURS |
| B8 | Exact tie for closest match | You have {two/three} soulmates: {names}. You agree on {n} questions. | You have two soulmates: Christine and Jill. You agree on 13 questions. | YOURS (07-26) |
| B9 | You're the common-ground person (replaces B6) | You're the backbone of the group. You have the most in common with everyone else in the group. | — | SPEC |
| B10 | Your furthest-apart friend | You and {name} are the furthest apart — you only agree on {a} out of {t}. But opposites attract… | You and Zoe are the furthest apart — you only agree on 5 out of 16. But opposites attract… | YOURS (07-29) |
| B11 | Exact tie for furthest apart | You're furthest apart from {names} — you only agree on {a} out of {t} with each. But opposites attract… | You're furthest apart from Zoe and Matt — you only agree on 5 out of 16 with each. But opposites attract… | YOURS (07-29) |
| B12 | Your closing line: solo take → duo → trio | You're the only one who {form}. / Only you and {name} {form}. / Only you, {a} and {b} {form}. | You're the only one who falls asleep during television. / Only you and Al have lied about being caught up. | SPEC |

---

## C. The findings card — MOBILE, groups of 4+ ("see findings →")

The screenshot-shareable object. Chrome (title, "Al, with …" names line,
"16 questions answered", beta.sidebar.watch) is already yours — decided in the
mockup notes. The body lines:

### Headline (first that applies)

| # | Fires when | Language | Example | Status |
|---|---|---|---|---|
| C1 | You have a solo take — it leads | You're the only one who {form}. | You're the only one who falls asleep during television. | SPEC template, NEW promotion to headline (your Q-call: strongest finding leads until the map's quadrant headline exists) |
| C2 | No solo take → shared headline | B1 / B4 / B5a–c reused verbatim (renegade stays third person; no quotes block on the card) | Your group's renegade is Zoe — they have the most hot-takes between you. | as above |

### Body lines

| # | Fires when | Language | Example | Status |
|---|---|---|---|---|
| C3 | You have a SECOND solo take (YES takes only) | "{statement}" — you, and only you. | "I've lied about liking a show a friend loves." — you, and only you. | NEW |
| C4 | Your closest match | Your closest ally: {name} — you agree on {a} of {t}. | Your closest ally: Christine — you agree on 13 of 16. | NEW (from spec §7.2's skeleton "Your closest ally: {name} ({n} of {total})") |
| C5 | …plus the only-you-two proof (appended) | You're the only two who {form}. | You're the only two who regularly text "no-spoilers" to their friends. | NEW on the card (same sentence as your B7) |
| C6 | Your furthest-apart friend | Your opposite is {name} — you only agree on {a} out of {t}. But opposites attract… | Your opposite is Zoe — you only agree on 5 out of 16. But opposites attract… | YOURS (07-29) |
| C7 | Ties / backbone / no-solo closing line | B8, B11, B9, B12 reused verbatim | You have two soulmates: Christine and Jill. You agree on 13 questions. | as above |

---

## Copy pass CLOSED — Alborz 2026-07-29

Everything not edited above is approved as-is. The three riding questions, decided:

1. **Sticky vs card phrasing of the same fact** — KEEP the differences ("some random variety is nice").
2. **The "{n} of {t}" convention** — KEEP the existing per-line variety.
3. **The between-state** — SILENT ABSENCE (no copy; the "see findings →" link simply doesn't appear until the math has something).
