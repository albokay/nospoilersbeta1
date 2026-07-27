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
 *  (Alborz's screenshot markup, QA round 1). Stickies 1+4 tilt left,
 *  2+3 tilt right; positions are viewport-relative anchors for the
 *  centered StickyNote transform. */
export type GroupRoomTipSticky = Tip & { tilt: number; top: string; left: string };
export const GROUP_ROOM_TIPS: GroupRoomTipSticky[] = [
  {
    body: "Welcome to your group room. Shows you and your friends add accumulate here — you can propose more shows, vote on each others' picks, add more friends, and start a show room from this page.",
    aside: "(The show room is where writing happens.)",
    tilt: -2, top: "44%", left: "24%",
  },
  {
    body: "Invited friends who haven't joined yet are listed in the ⚙️ — open it to see who's pending and nudge the ones you invited.",
    tilt: 2, top: "14%", left: "54%",
  },
  {
    body: "“How We Watch TV” is just a conversation start for you and your friends. It grows as you all answer — you'll get more questions periodically.",
    aside: "(Missing any answer in your column? Open the grid and tap the pencil to fill them in.)",
    tilt: 2, top: "80%", left: "71%",
  },
  {
    body: "Use this 💬 button to chat about what you want to watch.",
    aside: "(Careful, the chat box isn't spoiler-gated!)",
    tilt: -2, top: "48%", left: "min(84vw, calc(100vw - 175px))",
  },
];

export function tipsFor(page: TipsPage, idiom: "desktop" | "mobile"): Tip[] {
  if (page === "dashboard") {
    return [
      {
        body: idiom === "desktop"
          ? "Your watch groups live here. Click a cluster to go inside."
          : "Your watch groups live here. Tap a group to go inside.",
      },
      { body: "Yellow circles are invited friends who haven't joined yet. Sidebar has emailed them their invite — a nudge from the group's ⚙️ can remind them." },
      { body: "While you wait for friends to join, keep watching and writing. Everything you write will be waiting for them the moment they catch up." },
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

/** The show room's zero-progress pointer (copy locked by Alborz). */
export const ZERO_PROGRESS_TIP =
  "When you're caught up, update how far you've watched to unlock what your friend(s) wrote.";
export const ZERO_TIP_KEY = "ns_tip_zeroprog";
