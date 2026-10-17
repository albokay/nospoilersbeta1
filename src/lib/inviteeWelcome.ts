/**
 * inviteeWelcome — the invited friend's first tips (Alborz's invitee-flow
 * pass, 2026-10-17).
 *
 * Joining from an invite whose inviter left a letter stamps who invited them
 * and which show the letter is about. The FIRST-VISIT tips on the dashboard
 * and in that group room then speak to them ("The letter Yalborz wrote you
 * about Severance is inside your watch group with them."); once a page's
 * tips are dismissed (the usual seen flag), the "?" brings back the standard
 * set. Per account and per browser, like the tips' own seen flags.
 */
export type InviteeWelcome = { groupId: string; inviter: string; showId: string; showName: string };

const key = (userId: string) => `ns_invitee_welcome_${userId}`;

export function setInviteeWelcome(userId: string, w: InviteeWelcome): void {
  try { localStorage.setItem(key(userId), JSON.stringify(w)); } catch { /* tolerate — the standard tips show */ }
}

export function readInviteeWelcome(userId: string | null | undefined): InviteeWelcome | null {
  if (!userId) return null;
  try {
    const w = JSON.parse(localStorage.getItem(key(userId)) ?? "null");
    return w && w.groupId && w.inviter && w.showName ? (w as InviteeWelcome) : null;
  } catch { return null; }
}
