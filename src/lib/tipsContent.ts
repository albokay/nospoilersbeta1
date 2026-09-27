/**
 * Help-system arc CP4 — pointer-tip content + open/seen gating.
 *
 * One source for both platforms' tip surfaces (desktop TipsNote stickies,
 * MobileTipsSheet). Copy approved by Alborz 2026-07-26 (QA round 1 rewrote
 * the group-room set and split it into four placed stickies, absorbing the
 * old GroupRoomSticky's text) — locked; edit only with sign-off.
 * 2026-09-25 letters pass (Alborz's sign-off, his wording). 2026-09-27 (his
 * wording): the welcome aside says "write to your friends", the gear tip
 * drops "(sad)", dashboard tip 3 ends at "start writing."
 *
 * Behavior (locked): accounts created AFTER the feature shipped see a
 * page's tips OPEN on their first visit; dismissing closes them; the "?"
 * affordance reopens them anytime. Pre-existing accounts start closed. The
 * show room's help is the "how does this room work?" tour button; its one
 * pointer is the LETTER FROM SIDEBAR (ROOM_LETTER below, 2026-09-26 — it
 * replaced the progress-picker sticky): leads the feed on entrance until
 * "got it"; the desktop "?" brings it back.
 */

export type TipsPage = "dashboard" | "groupRoom";

/** A tip: main copy + optional parenthetical aside (rendered italic). */
export type Tip = { body: string; aside?: string };

/** Accounts created at/after this instant get first-visit auto-open.
 *  (Pulled back to 07-26 so same-day test accounts exercise the auto-open —
 *  every real pre-arc account predates this anyway.) */
export const TIPS_LAUNCH_MS = Date.parse("2026-07-26T00:00:00Z");

/** Desktop group room: one sticky per tip, placed by what it points at
 *  (Alborz's screenshot markup, QA round 1). QA round 2: shown ONE at a
 *  time, stepped with < > in THIS array order (welcome → gear → chat →
 *  deck) — all four at once was overwhelming. Positions are
 *  viewport-relative anchors for the centered StickyNote transform. */
/** `anchor` (2026-09-16): tips about a VIEWPORT-FIXED control (the docked
 *  deck tab, the chat edge tab) pin to that control's on-screen rect and
 *  stay fixed with it — in the page's scroll frame they drifted away as
 *  the page scrolled. `top`/`left` remain the fallback placement. */
export type GroupRoomTipSticky = Tip & { tilt: number; top: string; left: string; mobileOmit?: boolean; anchor?: "deck-dock" | "chat-tab" };
export const GROUP_ROOM_TIPS: GroupRoomTipSticky[] = [
  {
    body: "Welcome to your group room. Shows you and your friends add accumulate here — you can propose more shows, vote on each others' picks, add more friends, and start a show room from this page.",
    aside: "(The show room is where you write to your friends.)",
    tilt: -2, top: "44%", left: "24%",
  },
  {
    body: "Use the ⚙️ for general group maintenance. You can change your group name, nudge whoever hasn't joined yet, or leave the room from here.",
    // 2026-09-27 (Alborz, rev 2): the note's ⚙ sits DIRECTLY UNDER the
    // header's gear, tuned for the default "Group 1" title. Geometry: the
    // title row (Display 40 "Group 1" + 4 + the 44px gear) is centred in
    // the 96px bar, so the gear glyph is at x ≈ 50%+73, y ≈ 38, and the
    // "with …" caption ends at y ≈ 81. The note is 300×~167 (border-box),
    // tilted 2°, and `top`/`left` are its CENTER: its ⚙ lands ≈ 61px left
    // of centre on the first line (≈ 60px above centre), and its top-left
    // corner ≈ 147 left / 89 above. So centre x = 50%+134 puts the ⚙ under
    // the gear, and centre y = 178 clears the caption by ~8px (⚙ ≈ 80px
    // below the gear). While open it sits over the right half of "Open
    // show rooms" and the first show. Re-derive if the header changes; a
    // longer group name moves the gear right of the note's ⚙.
    tilt: 2, top: "178px", left: "min(calc(50% + 134px), calc(100vw - 180px))",
  },
  // DESKTOP-ONLY as of 2026-08-11 (Alborz sign-off): the mobile sheet drops
  // this tip entirely — self-explanatory there, and it made the sheet too
  // long. The desktop sticky is unchanged.
  {
    body: "“How We Watch TV” is a conversation starter for you and your friends. It grows as you all answer — you'll get more questions periodically.",
    aside: "(Missing answers in your column? Open the grid and tap the pencil to fill them in.)",
    tilt: 2, top: "80%", left: "71%", mobileOmit: true, anchor: "deck-dock",
  },
  // Chat is LAST (QA rounds 3–4) — it doubles as the send-off. The caveat
  // sits mid-body ("("-paragraphs render italic); no trailing aside.
  {
    body: "You can use this 💬 button for non-show-specific conversations.\n\n(Careful, unlike the show rooms, the chat box isn't spoiler-gated!)\n\nYou can also use it to discuss what you want to watch next. Sidebar is for you and your friends.",
    tilt: -2, top: "48%", left: "min(84vw, calc(100vw - 175px))", anchor: "chat-tab",
  },
];

export function tipsFor(page: TipsPage, idiom: "desktop" | "mobile"): Tip[] {
  if (page === "dashboard") {
    // Alborz's 2026-08-01 rewrite (replaces the QA round 3 copy; same on
    // both platforms).
    return [
      { body: "This is your home dashboard \u2014 where you access your friend groups." },
      { body: "Outlined circles represent invited friends who haven't joined yet. Sidebar has emailed their invite. If you're getting impatient, you can nudge anyone from inside the group." },
      { body: "While you wait for friends to join, you can still go inside to add more shows or start writing." },
    ];
  }
  // Mobile's sheet doesn't POINT at the chat button the way the placed
  // desktop sticky does, so "this 💬 button" reads as "the 💬 button"
  // there (QA round 8).
  const tips: Tip[] = GROUP_ROOM_TIPS
    .filter((t) => !(idiom === "mobile" && t.mobileOmit))
    .map(({ body, aside }) => ({
      body: idiom === "mobile" ? body.replace("use this 💬 button", "use the 💬 button") : body,
      aside,
    }));
  // MOBILE-ONLY (Alborz 2026-09-13): long-press is mobile's show-button
  // organizing gesture (desktop has the hover x); slots in after the
  // welcome tip. Desktop's placed stickies are untouched.
  if (idiom === "mobile") {
    tips.splice(1, 0, { body: "Press and hold a show button for more options." });
  }
  return tips;
}

// Seen flags are PER USER as of 2026-08-01 (Alborz's invitee-flow catch):
// the old unscoped keys meant a browser that had ever dismissed tips
// suppressed the auto-open for every LATER account created there — exactly
// the invitee-testing case. Legacy unscoped keys are deliberately ignored:
// honoring them would preserve the bug; the cost is post-launch accounts
// seeing their tips auto-open once more.
export function tipsSeenKey(page: TipsPage, userId: string): string {
  return `ns_tips_seen_${page}_${userId}`;
}

export function markTipsSeen(page: TipsPage, userId: string | null | undefined): void {
  if (!userId) return;
  try { localStorage.setItem(tipsSeenKey(page, userId), "1"); } catch { /* tolerate */ }
}

/** First-visit auto-open: never-dismissed BY THIS ACCOUNT and the account
 *  postdates launch. */
export function tipsDefaultOpen(page: TipsPage, userId: string | null | undefined, createdAtIso: string | null | undefined): boolean {
  if (!userId) return false;
  try { if (localStorage.getItem(tipsSeenKey(page, userId))) return false; } catch { /* tolerate */ }
  if (!createdAtIso) return false;
  return new Date(createdAtIso).getTime() >= TIPS_LAUNCH_MS;
}

/** The letter from Sidebar (Alborz 2026-09-26, copy from the letters
 *  canvas): the show room's explainer, leading the feed. It says the
 *  letters framing out loud and folds in what the progress-picker sticky
 *  used to say (the sticky and its copy retired with it). Rendered by
 *  SidebarLetter; "Dear {first name}," is the component's. */
export const ROOM_LETTER = {
  headline: "On Sidebar, you write your friends letters.",
  p1: "Every letter in this room wears a stamp: the episode it was written from. A letter stamped ahead of you stays sealed until you get there, and yours stay sealed for friends who are behind. Write as if everyone’s right where you are.",
  p2: "The progress picker up top is the most important part of this room. Every time you come in, make sure it matches how far you’ve watched, so the letters your friends leave you can open in time (and so your own writing doesn’t spoil them).",
  /** /m: the letter sits above the control card, so the picker is beneath it. */
  p2Mobile: "The progress picker just below is the most important part of this room. Every time you come in, make sure it matches how far you’ve watched, so the letters your friends leave you can open in time (and so your own writing doesn’t spoil them).",
  signoff: "— Sidebar",
  cta: "got it",
};
/** Per-user, same 2026-08-01 reasoning as tipsSeenKey. A NEW key (not the
 *  old sticky's), so everyone — testers who dismissed the sticky included —
 *  meets the letter once. */
export function roomLetterKey(userId: string): string {
  return `ns_letter_room_${userId}`;
}
