/**
 * finishedCelebration — the "You all finished it!" moment in a group room
 * (Alborz 2026-09-23, mockup B). When every current member of a show room
 * reaches the end, the room leaves the shelf and, on the viewer's next
 * visit, a CELEBRATION ROW takes its place at the top of "Open show rooms":
 * accent fill, a star badge, the door to the finished-together drawer (the
 * way people learn the drawer exists).
 *
 * It stays until BOTH have happened — the viewer opened the drawer AND then
 * left the group room; either alone keeps it. Then it folds into the plain
 * "N finished together" pill's count. Per user + room, per device
 * (localStorage, like the drawer's seen list): no key → fresh (celebrating);
 * "opened" → drawer seen, still shown; "done" → folded in. Storage that
 * can't be read counts as done, so a broken store never celebrates forever.
 */
export type CelebrationState = "fresh" | "opened" | "done";

const key = (userId: string, roomId: string) => `ns_fin_celebrate_${userId}_${roomId}`;

export function celebrationState(userId: string, roomId: string): CelebrationState {
  try {
    const v = localStorage.getItem(key(userId, roomId));
    return v === "opened" || v === "done" ? v : "fresh";
  } catch {
    return "done";
  }
}

/** The drawer opened while this room was celebrating. */
export function markCelebrationOpened(userId: string, roomId: string): void {
  try {
    if (celebrationState(userId, roomId) === "fresh") localStorage.setItem(key(userId, roomId), "opened");
  } catch { /* ignore */ }
}

/** Fold a room in outright (the pre-rule migration: rooms already seen in the drawer). */
export function markCelebrationDone(userId: string, roomId: string): void {
  try { localStorage.setItem(key(userId, roomId), "done"); } catch { /* ignore */ }
}

/** On leaving the group room: every celebration whose drawer was opened folds in. */
export function settleCelebrations(userId: string, roomIds: string[]): void {
  for (const roomId of roomIds) {
    try {
      if (celebrationState(userId, roomId) === "opened") localStorage.setItem(key(userId, roomId), "done");
    } catch { /* ignore */ }
  }
}
