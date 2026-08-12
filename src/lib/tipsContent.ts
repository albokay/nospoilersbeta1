/**
 * Help-system arc CP4 — pointer-tip content + open/seen gating.
 *
 * One source for both platforms' tip surfaces (desktop TipsNote stickies,
 * MobileTipsSheet). Copy approved by Alborz 2026-07-26 (QA round 1 rewrote
 * the group-room set and split it into four placed stickies, absorbing the
 * old GroupRoomSticky's text) — locked; edit only with sign-off.
 *
 * Behavior (locked): accounts created AFTER the feature shipped see a
 * page's tips OPEN on their first visit; dismissing closes them; the "?"
 * affordance reopens them anytime. Pre-existing accounts start closed. The
 * show room has NO tips toggle — its help affordance is the "how does this
 * room work?" tour button; the contextual zero-progress tip below is its
 * one pointer (renders at "haven't started" until dismissed).
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
export type GroupRoomTipSticky = Tip & { tilt: number; top: string; left: string; mobileOmit?: boolean };
export const GROUP_ROOM_TIPS: GroupRoomTipSticky[] = [
  {
    body: "Welcome to your group room. Shows you and your friends add accumulate here — you can propose more shows, vote on each others' picks, add more friends, and start a show room from this page.",
    aside: "(The show room is where writing happens.)",
    tilt: -2, top: "44%", left: "24%",
  },
  {
    body: "Invited friends who haven't joined yet are listed in the ⚙️ — open it to see who's pending, nudge friends who need reminders, and do other group room maintenance.",
    tilt: 2, top: "14%", left: "54%",
  },
  // DESKTOP-ONLY as of 2026-08-11 (Alborz sign-off): the mobile sheet drops
  // this tip entirely — self-explanatory there, and it made the sheet too
  // long. The desktop sticky is unchanged.
  {
    body: "“How We Watch TV” is a conversation starter for you and your friends. It grows as you all answer — you'll get more questions periodically.",
    aside: "(Missing answers in your column? Open the grid and tap the pencil to fill them in.)",
    tilt: 2, top: "80%", left: "71%", mobileOmit: true,
  },
  // Chat is LAST (QA rounds 3–4) — it doubles as the send-off. The caveat
  // sits mid-body ("("-paragraphs render italic); no trailing aside.
  {
    body: "You can use this 💬 button to discuss what you want to watch with your friends.\n\n(Careful, unlike the show rooms, the chat box isn't spoiler-gated!)\n\nSidebar is for you and your friends! If they're not here yet, nudge them so you can all get going!",
    tilt: -2, top: "48%", left: "min(84vw, calc(100vw - 175px))",
  },
];

export function tipsFor(page: TipsPage, idiom: "desktop" | "mobile"): Tip[] {
  if (page === "dashboard") {
    // Alborz's 2026-08-01 rewrite (replaces the QA round 3 copy; same on
    // both platforms).
    return [
      { body: "This is your home dashboard \u2014 where you access your friend groups." },
      { body: "Yellow circles represent invited friends who haven't joined yet. Sidebar has emailed their invite. If you're getting impatient, you can nudge anyone from inside the group." },
      { body: "While you wait for friends to join, you can still go inside to add more shows or start writing. Everything you write will be waiting for them the moment they catch up." },
    ];
  }
  // Mobile's sheet doesn't POINT at the chat button the way the placed
  // desktop sticky does, so "this 💬 button" reads as "the 💬 button"
  // there (QA round 8).
  return GROUP_ROOM_TIPS
    .filter((t) => !(idiom === "mobile" && t.mobileOmit))
    .map(({ body, aside }) => ({
      body: idiom === "mobile" ? body.replace("use this 💬 button", "use the 💬 button") : body,
      aside,
    }));
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

/** The show room's progress-picker sticky (QA round 3 — replaced the
 *  zero-progress ticket; shows on first room entrance regardless of
 *  progress, until X'd). The desktop sticky leads with a ← icon pointing
 *  at the picker (rendered by RoomProgressTip, not part of the string). */
export const ROOM_PROGRESS_TIP: Tip = {
  body: "This progress picker is the most important part of this room. Every time you enter the show room, make sure this matches your watch progress so that you can read any new writing your friends left you.",
  aside: "(And so that you don't accidentally spoil them with your own writing!)",
};
/** Per-user, same 2026-08-01 reasoning as tipsSeenKey. */
export function roomTipKey(userId: string): string {
  return `ns_tip_room_progress_${userId}`;
}
