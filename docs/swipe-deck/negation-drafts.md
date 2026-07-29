# Deck negation drafts — for Alborz's review (CP0, 2026-07-28)

**What this unlocks.** Today the findings engine can only say things about YES answers.
Once each card has an approved "NO form," three new kinds of lines switch on:

- **Solo-NO hot take** — *"You're the only one who **has never lied about being caught up**."*
- **All-NO unanimity** — *"All five of you **don't think casting news is a spoiler**."*
- **Duo/trio-NO lines** — *"Only you and Christine **don't check their phone during television**."*
- The renegade's quoted takes: a NO-based take renders as its NO form instead of quoting
  the card statement verbatim (quoting *"I check my phone during television."* would claim
  the opposite of what they answered).

**How the forms slot in** (same grammar conventions as the existing YES forms — third
person, "their," lowercase start, no trailing period):

- `singular_neg` → *"…the only one who {singular_neg}."*
- `plural_neg` → *"All {n} of you {plural_neg}." / "Only you and {name} {plural_neg}."*

**Storage:** two new nullable columns on the cards table (`singular_neg`, `plural_neg`).
**A blank form is a safety valve** — any card you leave blank (or mark SKIP) simply never
fires a NO-based line; everything else about it is unchanged.

**The caution I drafted under:** a NO only means the person didn't affirm the statement —
it doesn't always license claiming the opposite. Where the honest reading was ambiguous
I drafted the cautious form and flagged it with ⚠️ so you can decide how far to push.

**How to review:** edit any line in place, or write SKIP next to a card. Nothing ships
until you say so; after sign-off I'll turn this into one paste-ready SQL script.

---

*(Grouping below is approximate — the invitee-funnel changeset reshuffled some cards
between batches. Only the wording matters for this review; all 60 live cards are here.)*

## Onboarding cards

**phone-during-tv** — *I check my phone during television.*
- singular_neg: `doesn't check their phone during television`
- plural_neg: `don't check their phone during television`

**just-wait-ep4** — *Telling someone "just wait till you see episode 4" is a spoiler.*
- singular_neg: `doesn't think "just wait till you see episode 4" is a spoiler`
- plural_neg: `don't think "just wait till you see episode 4" is a spoiler`

**spoiled-never-watch** — *Even if I know I'm not gonna watch a show, I still don't want to be spoiled.*
- singular_neg: `doesn't mind spoilers for a show they'll never watch`
- plural_neg: `don't mind spoilers for shows they'll never watch`

**spite-watch** — *I'll watch a bad show to the end out of spite and/or morbid curiosity.*
- singular_neg: `won't finish a bad show out of spite`
- plural_neg: `won't finish a bad show out of spite`

**spoiled-by-thumbnail** — *I've been spoiled by a thumbnail.*
- singular_neg: `has never been spoiled by a thumbnail`
- plural_neg: `have never been spoiled by a thumbnail`

**quietly-finished** — *I've quietly finished a show I was supposed to be watching with someone.*
- singular_neg: `has never quietly finished a show they were supposed to be watching with someone`
- plural_neg: `have never quietly finished a show they were supposed to be watching with someone`

**cant-finish-loved** — *There are shows I love so much I can't bring myself to finish them.*
- singular_neg: `doesn't have a show they love too much to finish`
- plural_neg: `don't have a show they love too much to finish`

**lied-about-liking** — *I've lied about liking a show a friend loves.*
- singular_neg: `has never lied about liking a show a friend loves`
- plural_neg: `have never lied about liking a show a friend loves`

## Drip batch 1 (+2w)

**avoid-trailers** — *I proactively stay away from trailers.*
- singular_neg: `doesn't avoid trailers` *(the spec's own worked example used this form)*
- plural_neg: `don't avoid trailers`

**read-before-start** — *I like to read about TV shows before I start them.*
- singular_neg: `doesn't read about a show before starting it`
- plural_neg: `don't read about a show before starting it`

**two-episodes** — *I'll give a show two episodes to keep me watching.*
- singular_neg: `doesn't give shows a two-episode deadline` ⚠️ *a NO here is direction-ambiguous (more patient OR less) — this draft stays neutral about which*
- plural_neg: `don't give shows a two-episode deadline`

**lied-caught-up** — *I've lied about being caught up with a show...for whatever reason.*
- singular_neg: `has never lied about being caught up`
- plural_neg: `have never lied about being caught up`

## Drip batch 2 (+4w)

**reaction-videos** — *Reaction videos count as spoilers.*
- singular_neg: `doesn't think reaction videos count as spoilers`
- plural_neg: `don't think reaction videos count as spoilers`

**knowing-doesnt-ruin** — *Knowing what happens doesn't ruin anything.*
- singular_neg: `thinks knowing what happens can ruin a show` ⚠️ *the statement is itself negative, so the NO form flips positive*
- plural_neg: `think knowing what happens can ruin a show`

**hate-sad-endings** — *I hate sad endings.*
- singular_neg: `doesn't hate sad endings`
- plural_neg: `don't hate sad endings`

**three-episodes** — *Three episodes is enough to judge a show.*
- singular_neg: `doesn't think three episodes is enough to judge a show`
- plural_neg: `don't think three episodes is enough to judge a show`

## Drip batch 3 (+6w)

**nothing-happens** — *Saying "nothing happens in this one" is a spoiler.*
- singular_neg: `doesn't think "nothing happens in this one" is a spoiler`
- plural_neg: `don't think "nothing happens in this one" is a spoiler`

**survives-spoiling** — *A good show survives being spoiled.*
- singular_neg: `doesn't think a good show survives being spoiled`
- plural_neg: `don't think a good show survives being spoiled`

**quit-counts-watched** — *A show you quit still counts as watched.*
- singular_neg: `doesn't count a quit show as watched`
- plural_neg: `don't count a quit show as watched`

**subtitles-always** — *Subtitles on, always.*
- singular_neg: `doesn't always watch with subtitles on`
- plural_neg: `don't always watch with subtitles on`

## Drip batch 4 (+8w)

**episode-is-good** — *If someone tells me an episode is good, that's already too much.*
- singular_neg: `doesn't mind hearing "this one's good"`
- plural_neg: `don't mind hearing "this one's good"`

**reviews-before-watching** — *I've read reviews of an episode before watching it.*
- singular_neg: `has never read reviews of an episode before watching it`
- plural_neg: `have never read reviews of an episode before watching it`

**too-many-seasons** — *Most shows go on for too many seasons.*
- singular_neg: `doesn't think most shows go on too long`
- plural_neg: `don't think most shows go on too long`

**speed-15x** — *Watching at 1.5x speed is fine.*
- singular_neg: `doesn't think watching at 1.5x speed is fine`
- plural_neg: `don't think watching at 1.5x speed is fine`

## Drip batch 5 (+10w)

**next-episode-teases** — *The "next episode" teases after an episode are too spoiler-y.*
- singular_neg: `doesn't think the "next episode" teases are too spoiler-y`
- plural_neg: `don't think the "next episode" teases are too spoiler-y`

**ruined-watched-anyway** — *I've had a show ruined for me and watched it anyway, happily.*
- singular_neg: `has never happily watched a show that was ruined for them` ⚠️ *a NO could mean "never had one ruined" or "had one ruined and bailed" — draft covers both*
- plural_neg: `have never happily watched a show that was ruined for them`

**quit-one-bad-episode** — *I've quit a show because of one bad episode.*
- singular_neg: `has never quit a show over one bad episode`
- plural_neg: `have never quit a show over one bad episode`

**watch-for-love** — *I'll watch a show I don't like because someone I love loves it.*
- singular_neg: `won't watch a show they don't like just because someone they love loves it`
- plural_neg: `won't watch a show they don't like just because someone they love loves it`

## Drip batch 6 (+12w)

**text-no-spoilers** — *I regularly text "no-spoilers" to my friends.*
- singular_neg: `doesn't text "no-spoilers" to their friends`
- plural_neg: `don't text "no-spoilers" to their friends`

**worth-it-over-surprise** — *I'd rather know it's worth it than be surprised.*
- singular_neg: `would rather be surprised than know it's worth it` *(true either/or — inversion is fair here)*
- plural_neg: `would rather be surprised than know it's worth it`

**pilot-is-enough** — *The pilot is all I need to know whether I'll keep watching.*
- singular_neg: `needs more than the pilot to decide`
- plural_neg: `need more than the pilot to decide`

**out-of-order** — *I've watched a show out of order.*
- singular_neg: `has never watched a show out of order`
- plural_neg: `have never watched a show out of order`

## Drip batch 7 (+14w)

**casting-news** — *Casting news is a spoiler.*
- singular_neg: `doesn't think casting news is a spoiler`
- plural_neg: `don't think casting news is a spoiler`

**clips-before-start** — *I've watched clips of a show I hadn't started yet.*
- singular_neg: `has never watched clips of a show they hadn't started`
- plural_neg: `have never watched clips of a show they hadn't started`

**life-too-short** — *Life's too short for a show that's just "fine".*
- singular_neg: `is fine with a show that's just "fine"`
- plural_neg: `are fine with a show that's just "fine"`

**second-screen** — *I regularly "watch" while doing something else.*
- singular_neg: `doesn't "watch" while doing something else` ⚠️ *statement says "regularly" — strictly a NO only rules out "regularly"*
- plural_neg: `don't "watch" while doing something else`

## Drip batch 8 (+16w)

**finale-knowledge** — *Knowing an episode is the last of the season changes how I watch it.*
- singular_neg: `watches a finale like any other episode`
- plural_neg: `watch a finale like any other episode`

**better-second-time** — *I've enjoyed a show more the second time, knowing everything.*
- singular_neg: `has never enjoyed a show more the second time around`
- plural_neg: `have never enjoyed a show more the second time around`

**recap-failed** — *If I need a recap to keep going, the show has failed.*
- singular_neg: `doesn't think needing a recap means the show has failed`
- plural_neg: `don't think needing a recap means the show has failed`

**started-season-two** — *I've started a series at season two.*
- singular_neg: `has never started a series at season two`
- plural_neg: `have never started a series at season two`

## Drip batch 9 (+18w)

**does-it-get-better** — *I've asked someone "does it get better" and regretted the answer.*
- singular_neg: `has never asked "does it get better" and regretted it`
- plural_neg: `have never asked "does it get better" and regretted it`

**week-old-spoilers** — *I don't think spoiler warnings are necessary after a week.*
- singular_neg: `thinks spoiler warnings are still necessary after a week` ⚠️ *statement is itself negative, so the NO form flips positive*
- plural_neg: `think spoiler warnings are still necessary after a week`

**bad-finale-great-season** — *A great season with a bad finale is still a great season.*
- singular_neg: `thinks a bad finale can ruin a great season`
- plural_neg: `think a bad finale can ruin a great season`

**fall-asleep** — *I fall asleep during television regularly.*
- singular_neg: `doesn't fall asleep during television` ⚠️ *statement says "regularly" — strictly a NO only rules out "regularly"*
- plural_neg: `don't fall asleep during television`

## Drip batch 10 (+20w)

**episode-count** — *I check the episode count before I start a season.*
- singular_neg: `doesn't check the episode count before starting a season`
- plural_neg: `don't check the episode count before starting a season`

**twist-whole-point** — *If a twist is the whole point, it wasn't a good show.*
- singular_neg: `thinks a show built on a twist can still be a great show`
- plural_neg: `think a show built on a twist can still be a great show`

**finale-ruins-series** — *A finale can retroactively ruin a series.*
- singular_neg: `doesn't think a finale can retroactively ruin a series`
- plural_neg: `don't think a finale can retroactively ruin a series`

**defended-bad-show** — *I've defended a show I know is bad.*
- singular_neg: `has never defended a show they know is bad`
- plural_neg: `have never defended a show they know is bad`

## Drip batch 11 (+22w)

**episode-title** — *An episode title can be a spoiler.*
- singular_neg: `doesn't think an episode title can be a spoiler`
- plural_neg: `don't think an episode title can be a spoiler`

**abandoned-near-end** — *I've abandoned a show one episode from the end.*
- singular_neg: `has never abandoned a show one episode from the end`
- plural_neg: `have never abandoned a show one episode from the end`

**bad-pilot-ok** — *It's ok for the pilot to be bad — I'll keep watching.*
- singular_neg: `won't forgive a bad pilot`
- plural_neg: `won't forgive a bad pilot`

**missed-plot-point** — *I've missed a plot point and just kept going.*
- singular_neg: `has never missed a plot point and just kept going`
- plural_neg: `have never missed a plot point and just kept going`

## Drip batch 12 (+24w)

**finale-runtime** — *Seeing the runtime of the finale tells you something you shouldn't know.*
- singular_neg: `doesn't think a finale's runtime tells you too much`
- plural_neg: `don't think a finale's runtime tells you too much`

**prestige-boring** — *Prestige TV is mostly boring.*
- singular_neg: `doesn't think prestige TV is mostly boring`
- plural_neg: `don't think prestige TV is mostly boring`

**how-bad-it-gets** — *I've kept watching purely to see how bad it gets.*
- singular_neg: `has never kept watching just to see how bad it gets`
- plural_neg: `have never kept watching just to see how bad it gets`

**bottle-episodes** — *I like bottle episodes.*
- singular_neg: `doesn't like bottle episodes`
- plural_neg: `don't like bottle episodes`

## Drip batch 13 (+26w)

**knowing-nothing** — *I'd rather go in knowing nothing at all — not even the genre.*
- singular_neg: `wants to know at least a little going in`
- plural_neg: `want to know at least a little going in`

**stay-off-internet** — *I stay away from the Internet when I'm behind on a show I love.*
- singular_neg: `braves the Internet even when they're behind on a show they love`
- plural_neg: `brave the Internet even when they're behind on a show they love`

**win-me-back** — *A show can win me back after I've written it off.*
- singular_neg: `once they write a show off, it stays written off` ⚠️ *doesn't fit the "the only one who…" sentence frame — if kept, the code renders it as its own sentence: "You're the only one for whom a written-off show stays written off."… or edit to a who-form, e.g. `never lets a show back in after writing it off`*
- plural_neg: `never let a show back in after writing it off`

## Rescheduled by the invitee changeset

**full-season** — *I'll give a show at least one full season.*
- singular_neg: `doesn't give every show a full season`
- plural_neg: `don't give every show a full season`
