/**
 * joinSession — "did this browser session just join a group?"
 *
 * Standing issue (b), closed 2026-08-01 (Alborz): an INVITEE used to answer
 * 4 questions at the door, sign up, and get 4 more the moment they landed in
 * the group room — 8 questions back-to-back as their introduction, with only
 * a signup in between. (The inviter's 8 are fine: their onboarding spreads
 * them across picking a show, naming a friend and writing a seed entry.)
 *
 * The fix: wave 2 does not fire in the session the invitee joined. Their
 * first visit is 4 questions + the actual room; wave 2 greets them on their
 * next visit to a group room.
 *
 * sessionStorage is deliberate — "next session" is exactly what it measures,
 * and it can't leak the deferral across devices. If wave 2 somehow never
 * fires (they never return to a group room), the drip now serves those cards
 * anyway once their interval comes up — the onboarding-reserved cards became
 * drippable in the same 2026-08-01 change, which is what makes this safe.
 */
const KEY = "ns_joined_this_session";

/** Called when an accepted invite lands the new member in their group. */
export function markJoinedThisSession(): void {
  try { sessionStorage.setItem(KEY, "1"); } catch { /* tolerate — wave 2 just fires as before */ }
}

export function joinedThisSession(): boolean {
  try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
}
