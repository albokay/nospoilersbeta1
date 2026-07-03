import type { ElementType } from "react";
import { UsersRound, ListChecks, Road, Eye, MessageSquareText, ShieldCheck } from "lucide-react";

// ── Homepage copy — single source of truth ──────────────────────────────
//
// Desktop (App.tsx homepage) and mobile (src/mobile/MobileNarrative.tsx)
// both read the homepage WORDS from here, so the two surfaces can never
// drift apart. The mobile rebuild spec requires mobile's homepage copy to
// be identical to desktop's; before this file existed the mobile narrative
// carried its own hand-copied duplicate, which silently went stale when
// the desktop copy was rewritten (2026-07-01 how-it-works + beta letter).
//
// COPY ONLY lives here — no layout, sizes, or colors. Each surface lays
// the text out in its own idiom. Icons ride along with the step copy
// because the 2026-07-01 rewrite treats copy + icon as one unit.
//
// Editing a string here changes BOTH surfaces. That is the point.

// Hero headline — three lines; the last is emphasized (<em>).
export const HERO_LINES = [
  "Watching TV with friends usually",
  "means spoilers or keeping quiet.",
] as const;
export const HERO_EMPHASIS = "Not on Sidebar.";

export const HOW_IT_WORKS_TITLE = "Here’s how it works:";

export const HOW_IT_WORKS_STEPS: { Icon: ElementType; text: string }[] = [
  { Icon: UsersRound,        text: "Start a group with the friends you love talking to." },
  { Icon: ListChecks,        text: "Each friend lists what they’re watching or wants to watch." },
  { Icon: Road,              text: "Decide what you want to watch together. Or binge ahead… your writing will become breadcrumbs for your friends as they catch up." },
  { Icon: Eye,               text: "Everyone logs how far they’ve watched, and keeps it current as they go." },
  { Icon: MessageSquareText, text: "Post your thoughts without worrying about spoilers. Write as if everyone’s caught up to exactly where you are." },
  { Icon: ShieldCheck,       text: "Sidebar filters every room to each person’s progress. Nothing you read is ever ahead of where you are." },
];

export const CTA_JOIN_LABEL = "Join / sign in";
export const CTA_DETAILS_LABEL = "Want more details?";

// Beta-tester pill (two-state toggle) + the letter it reveals.
export const BETA_PILL_CLOSED = "*click here beta tester!";
// Mobile variant — touch verb, same pill (Alborz 2026-07-02). Kept beside the
// desktop line so a future rewording changes both together.
export const BETA_PILL_CLOSED_MOBILE = "*tap here beta tester!";
export const BETA_PILL_OPEN = "Hello!";

// Rendered as paragraphs separated by blank lines on both surfaces.
export const BETA_LETTER_PARAGRAPHS: string[] = [
  "Thank you for your time and mind.",
  "I’m making this site because I love stories and I love thinking and talking about them. If you’re reading this right now, you’re probably the same way. That’s the whole point here: to make it easier to have ongoing conversations about the TV shows we love (or love to hate) with our friends.",
  "Sidebar is built around the handful of people you actually want to talk to. And because everyone’s writing is tied to their own progress, it doesn’t matter whether you’re all watching in step, one of you is racing ahead, or someone’s a whole season behind. If you’re ahead, you write letters from the future, waiting to be opened when your friends unlock your writing episode by episode. If you’re behind, you have gifts waiting for you at each episode. Nobody gets spoiled, and nobody has to stay quiet.",
  "I think the mechanics will inspire you to slow down and think more deeply about what you’re watching. More time to sit with a show, more reason to feel close to your friends through it. But that’s just me. It might inspire your watching in some way I’d never expect, and I’m eager to find out about that.",
  "Use the ‘feedback’ tab on the left to send your thoughts as they come. Your gut reactions are as important as your more considered thoughts.",
  "Excited to see how you use the site.",
  "— Alborz",
];
