# Answer-to-reveal — the deck gets the site's spoiler grammar

*Spec v0.1 — drafted 2026-08-01 from Alborz's brainstorm. No code yet.*

## 1. The idea in one line

A friend's answer to a "How I/We Watch TV" question is **hidden until you've
answered that question yourself** — you see THAT they answered, never WHICH
way, and answering is what reveals it.

This is the show-room mechanic in miniature, with the locus of control kept
where it belongs: content from your friends accumulates for you, your own
action reveals it, and the action (a five-second swipe) is always available
and pays off instantly with the comparison. It teaches the site's grammar —
*things wait here for you; you unlock them by participating* — before any
show room exists, and it turns friend activity into pull ("answers are
waiting for you") without ever blocking anyone's question supply.

**Explicitly rejected sibling** (from the same brainstorm, recorded so it
isn't re-proposed): gating the SUPPLY of questions on friends answering.
Inverts the locus of control (you wait on others), starves exactly the
low-activity-friends users the gap problem is about, re-couples pacing the
personal schedule just uncoupled, and is ill-defined across groups (the
deck is per-person; "your friends" isn't).

## 2. The three cell states (the whole visible design — rev 2, 2026-08-01)

For any question row in a group surface, a cell shows exactly one of:

| State | Look |
|---|---|
| Revealed (both of you answered) | today's answer mark, unchanged (desktop color band / mobile thumb) |
| Covered (they answered, **you haven't**) | **business (greyblue) fill + Sky "?"** |
| Unanswered | **plain empty — SAME meaning in every column, yours included** |

**Rev-2 simplification (Alborz):** the old unanswered marks are RETIRED —
no dashed own-cell box, no business "·" dot for friends. Empty means
unanswered, whoever's column it is. (Applies across deck surfaces: the
mobile answers sheet's per-member dot goes too; the grid edit mode's
dashed chip-on-blank stays, since edit mode is its own idiom.)

The covered mark reuses the map's hidden-writing grammar exactly (greyblue
cell, Sky "?") — one site-wide symbol for "something's here that your own
progress hasn't unlocked." Your own column is never covered.

Reveal is just data: the moment your answer lands (wave, drip, or the
grid's edit pencil — one answer record wherever it was given), the "?"s on
that row flip to their answer marks. No special animation in v1.

## 3. Where it applies (every consumer of friends' answers, traced)

- **Mobile answers sheet** ("How We Watch TV" rows) — covered slots per §2.
- **Full grid, both platforms** (incl. edit mode — covered cells stay
  covered while friends' columns are faded).
- **Desktop open group card** — same grid, same rule.
- **n=2 header line** — already computed on mutual answers only. No change.
- **Findings sticky + findings card** — see §4 (the one real decision).
- **Digest "answered more questions" line** — names only, no answers. No change.
- **Invitee flow** — the pre-wall wave and walls show no answers. No change.
- **⚠️ ONE DELIBERATE EXCEPTION:** the invite email leads with the
  inviter's own answer to `just-wait-ep4` ("Bill thinks … is a spoiler.
  Do you?"). That reveal IS the hook, spec'd and shipped — it stays. (The
  invitee answers that exact question first at the door anyway, so the
  "debt" clears in their first minute.)

## 4. Findings respect the gate — and get better for it

Today the findings engine reads ALL answers, so a headline can reveal a
friend's answer to a question the viewer never answered ("Zoe is the only
one who checks their phone…" — maybe you never got that card). Under
reveal-gating that's a leak.

**Rule: the findings engine only considers questions the VIEWER has
answered.** Ally/opposite/duo/unanimous lines already work this way
(mutual-only by construction); this extends it to the renegade pick, the
renegade's quotes, and the sharpest-split fallback.

The consequence is a feature, not a cost: **the more you answer, the more
the room tells you.** Findings deepen with your own participation —
thematically identical to catching up on a show to read the room.

## 5. Implementation shape (server-gated, like the rest of the site)

The site's spoiler precedent is server-side (gated entries return stubs,
not bodies). The deck should match — otherwise the "gate" is a devtools
curtain:

- **CP1 — one migration** (paste-ready for Alborz): `get_group_deck_answers`
  returns `answer = NULL` for rows on questions the CALLER hasn't answered
  (row presence kept — that's the "?"). The caller's own rows and mutual
  rows come back full. No table changes, no new RPC.
- **Frontend tolerance:** `null` answer renders as covered; the findings
  map-builder skips nulls. Pre-migration (full answers still arriving),
  the same frontend derives covered-ness from "viewer hasn't answered this
  card" client-side — so deploy order doesn't matter, and the migration
  upgrades the gate from cosmetic to real.
- **CP2 — the visuals**, both platforms: the three states of §2 in the
  sheet + both grids. Findings need no code of their own — the nulled data
  scopes them automatically.

Nothing touches: the personal drip schedule, waves, the reset script, the
digest, deck emails, `deck_answers` writes, or any RLS.

## 6. Alborz's calls — DECIDED 2026-08-01 (mockup: answer-to-reveal-preview.html)

1. **Pull signal: YES** — the site's standard blue new-activity dot
   whenever revealable answers exist (any covered cell); clears once the
   waiting questions are answered. **Placement (rev 2): hanging off /
   overlapping the docked card's top-left corner** — the show-pill
   notifDotButton grammar — never beside the title text.
2. **Tips line: NO** — the "?" is self-explanatory in context.
3. **Hover copy on covered desktop cells: YES**, per-row (any covered cell
   in the row), two lines split for even length:
   - singular (one friend's answer waiting):
     `Your friend has answered` ⏎ `this one. What do you think?`
   - plural (2+ friends' answers waiting):
     `Your friends have answered` ⏎ `this one. What do you think?`
   Mobile has no hover — the mark stands alone there.
4. **Invite-email exception CONFIRMED** — the inviter's `just-wait-ep4`
   answer keeps leading the invite email.

## 7. What this deliberately does NOT do

- No change to question pacing — the drip stays 14 days, per Alborz
  (2026-08-01: "I don't want to shorten the drip gap right now").
- No gating of question supply on anyone else's behavior, ever (§1).
- No server push/notifications — the covered cells and (optional) dot are
  the entire signal in v1.
