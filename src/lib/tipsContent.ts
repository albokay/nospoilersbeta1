/**
 * Help-system arc CP4 — pointer-tip content + open/seen gating.
 *
 * One source for both platforms' tip surfaces (desktop TipsNote sticky,
 * MobileTipsSheet). Copy approved by Alborz 2026-07-26 — locked; edit only
 * with sign-off.
 *
 * Behavior (locked): accounts created AFTER the feature shipped see a
 * page's tips OPEN on their first visit; dismissing closes them; the "?" /
 * "tips" affordance reopens them anytime. Pre-existing accounts start
 * closed. The show room has NO tips toggle — its help affordance is the
 * "how does this room work?" tour button; the contextual zero-progress tip
 * below is its one pointer (renders at "haven't started" until dismissed).
 */

export type TipsPage = "dashboard" | "groupRoom";

/** Accounts created at/after this instant get first-visit auto-open.
 *  (Pulled back to 07-26 so same-day test accounts exercise the auto-open —
 *  every real pre-arc account predates this anyway.) */
export const TIPS_LAUNCH_MS = Date.parse("2026-07-26T00:00:00Z");

export function tipsFor(page: TipsPage, idiom: "desktop" | "mobile"): string[] {
  if (page === "dashboard") {
    return [
      idiom === "desktop"
        ? "Your watch groups live here. Click a cluster to go inside."
        : "Your watch groups live here. Tap a group to go inside.",
      "Yellow circles are invited friends who haven't joined yet. Sidebar has emailed them their invite — a nudge from the group's ⚙️ can remind them.",
      "While you wait for friends to join, keep watching and writing. Everything you write will be waiting for them the moment they catch up.",
    ];
  }
  return [
    "Propose shows, vote on each other's picks, and start a show room for anything with votes. A show room is where the writing happens. You can begin writing at any time so that your friends have your thoughts waiting for them when they catch up.",
    "Invited friends who haven't joined yet are listed in the ⚙️ — open it to see who's pending and nudge the ones you invited.",
    "How We Watch TV grows as your friends answer. Missing answers in your column? Open the grid and tap the pencil to fill them in.",
    "(The 💬 chat isn't spoiler-gated — the show rooms are.)",
  ];
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
