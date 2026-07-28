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
export type GroupRoomTipSticky = Tip & { tilt: number; top: string; left: string };
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
  {
    body: "“How We Watch TV” is a conversation starter for you and your friends. It grows as you all answer — you'll get more questions periodically.",
    aside: "(Missing answers in your column? Open the grid and tap the pencil to fill them in.)",
    tilt: 2, top: "80%", left: "71%",
  },
  // Chat is LAST (QA rounds 3–4) — it doubles as the send-off. The caveat
  // sits mid-body ("("-paragraphs render italic); no trailing aside.
  {
    body: "You can use this 💬 button to discuss what you want to watch with your friends.\n\n(Careful, unlike the show rooms, the chat box isn't spoiler-gated!)\n\nSidebar is for you and your friends! If they're not here yet, nudge them so you can all get going!",
    tilt: -2, top: "48%", left: "min(84vw, calc(100vw - 175px))",
  },
];

export function tipsFor(page: TipsPage, _idiom: "desktop" | "mobile"): Tip[] {
  if (page === "dashboard") {
    // QA round 3 copy (same on both platforms).
    return [
      { body: "This is your home dashboard. When you have more than one friend group, this is where you access them." },
      { body: "Yellow circles represent invited friends who haven't joined yet. Sidebar has emailed them their invite and if you're getting impatient, you can nudge them again from inside the group." },
      { body: "While you wait for friends to join, you can still go inside to add shows or start writing. Everything you write will be waiting for them the moment they catch up." },
    ];
  }
  return GROUP_ROOM_TIPS.map(({ body, aside }) => ({ body, aside }));
}

export function tipsSeenKey(page: TipsPage): string {
  return `ns_tips_seen_${page}`;
}

export function markTipsSeen(page: TipsPage): void {
  try { localStorage.setItem(tipsSeenKey(page), "1"); } catch { /* tolerate */ }
}

/** First-visit auto-open: never-dismissed AND the account postdates launch. */
export function tipsDefaultOpen(page: TipsPage, createdAtIso: string | null | undefined): boolean {
  try { if (localStorage.getItem(tipsSeenKey(page))) return false; } catch { /* tolerate */ }
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
export const ROOM_TIP_KEY = "ns_tip_room_progress";
