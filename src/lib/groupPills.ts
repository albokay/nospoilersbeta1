/**
 * Pill-state computation for the group-context dashboard (§7 of the
 * restructure spec). Pure functions over the get_group_dashboard payload, kept
 * separate from rendering so the rules are testable in isolation.
 *
 * Per pooled show:
 *   • count   = watchers + wanters (everyone opted in)
 *   • fill    = YOUR relationship to the show (2026-07-07, group-scoped model):
 *             green = there's an OPEN show room; cream = a PROPOSAL you've
 *             voted yes on; outlined = a proposal by others you haven't opted
 *             into. (The old writer/watcher-count tiering + self-watching
 *             override are gone — the fill now mirrors the shelf + your vote,
 *             not who-wrote, which the avatars already show.)
 *   • pencil  at exactly 1 writer; people icon (replaces number) at 2+ writers
 *   • ▲N/▼N   your progress vs the room: ▲ when you're the furthest along, ▼ for
 *             how far behind the furthest watcher you are. Shown to every ROOM
 *             MEMBER once anyone has started (Alborz 2026-09-28): a member who
 *             hasn't started sits at index 0, so a friend at zero reads ▼N
 *             behind the furthest and you read ▲N ahead of a friend at zero.
 *             A show you're not a member of (pooled by others) shows a blank
 *             right side (no arrow). Shows s/e (no arrow) when everyone's at
 *             the same point; a written-but-unwatched room (no watchers)
 *             shows "s0 e0" with no arrow
 *   • shelf   = the room decides (group-scoped model, 2026-07-06): a show with
 *             a started room is "watching" (the active-rooms shelf); a show
 *             without one is a PROPOSAL on "notStarted", no matter how far
 *             along individual voters are. Starting a room is what promotes a
 *             show off the proposed shelf — for everyone.
 */
import type { GroupDashboardShow } from "./db";

export type PillFill = "cream" | "outlined" | "green";

export type PillRight =
  | { kind: "none" }
  | { kind: "progress"; s: number; e: number }
  | { kind: "arrow"; dir: "up" | "down"; n: number };

export type PillData = {
  showId: string;
  count: number;
  showCount: boolean;     // render the count number (count ≥ 2 and not people-icon)
  fill: PillFill;
  writerCount: number;
  pencil: boolean;        // exactly 1 writer
  people: boolean;        // 2+ writers
  selfWatching: boolean;  // the viewer themselves has started this show (progress past s0 e0)
  right: PillRight;
  shelf: "watching" | "notStarted";
  roomId: string | null;
  inRoom: boolean;
};

/** Linear episode index so "N episodes ahead/behind" spans seasons correctly. */
export function linearIndex(s: number, e: number, seasons: number[] | undefined): number {
  if (s <= 0) return 0;
  let idx = 0;
  if (seasons && seasons.length) {
    for (let i = 0; i < s - 1 && i < seasons.length; i++) idx += seasons[i] || 0;
  } else {
    // No catalog season data — fall back to a monotonic surrogate.
    idx = (s - 1) * 1000;
  }
  return idx + e;
}

export function computePill(
  show: GroupDashboardShow,
  seasons: number[] | undefined,
  selfUserId: string
): PillData {
  const members = show.members;
  const started = (m: { s: number | null; e: number | null }) => m.s != null && ((m.s ?? 0) > 0 || (m.e ?? 0) > 0);
  const watchers = members.filter(started);
  const writerCount = members.filter((m) => m.wrote).length;
  const count = members.length;

  const self = members.find((m) => m.userId === selfUserId);
  const selfWatching = !!self && self.s != null && ((self.s ?? 0) > 0 || (self.e ?? 0) > 0);

  // Fill = your relationship to the show (2026-07-07): an OPEN room is green;
  // a proposal you've voted yes on is cream-filled; a proposal you haven't
  // opted into (someone else's) is outline-only. On a proposal, `members`
  // holds only the yes-voters, so self-present-and-voted = you're in.
  // The shelves (Alborz 2026-10-08, "I'm in" opens the room): a show is
  // WATCHING only when its room has at least two members and you're one of
  // them — green. Everything else is PROPOSED: your own room nobody has
  // joined yet (cream, "just you so far"), a room friends opened that you
  // haven't joined (outlined), a plain proposal (cream if you're in).
  const shared = !!show.roomId && show.inRoom && count >= 2;
  const fill: PillFill = shared ? "green" : self ? "cream" : "outlined";
  const people = writerCount >= 2;
  const pencil = writerCount === 1;
  const showCount = count >= 2 && !people;
  const shelf = shared ? "watching" : "notStarted";

  let right: PillRight = { kind: "none" };

  if (watchers.length === 0) {
    // Want-only → nothing; written-but-unwatched → "s0 e0".
    right = writerCount > 0 ? { kind: "progress", s: 0, e: 0 } : { kind: "none" };
  } else {
    // Once anyone has started, EVERY member is on the road (Alborz
    // 2026-09-28): a member who hasn't started sits at index 0. So a friend
    // at zero reads ▼N behind the furthest, and you read ▲N ahead of a
    // friend at zero — the same facts the show room's markers show.
    const idxs = members.map((w) => ({
      id: w.userId,
      idx: started(w) ? linearIndex(w.s ?? 0, w.e ?? 0, seasons) : 0,
      s: started(w) ? w.s ?? 0 : 0,
      e: started(w) ? w.e ?? 0 : 0,
    }));
    const maxIdx = Math.max(...idxs.map((x) => x.idx));
    const minIdx = Math.min(...idxs.map((x) => x.idx));
    const spread = maxIdx !== minIdx;

    if (self && spread) {
      const selfIdx = selfWatching ? linearIndex(self.s ?? 0, self.e ?? 0, seasons) : 0;
      if (selfIdx >= maxIdx) {
        // You are most-advanced (or tied at the furthest): ahead of next-most by N.
        const below = idxs.map((x) => x.idx).filter((i) => i < maxIdx);
        const nextMost = below.length ? Math.max(...below) : maxIdx;
        right = { kind: "arrow", dir: "up", n: maxIdx - nextMost };
      } else {
        right = { kind: "arrow", dir: "down", n: maxIdx - selfIdx };
      }
    } else if (!self) {
      // Not a member of this room (a show others pooled that you haven't
      // joined) → blank, so a new invitee's group doesn't read as a wall of
      // red gaps.
      right = { kind: "none" };
    } else {
      // Everyone (incl. you) is at the same point → that progress.
      right = { kind: "progress", s: idxs[0].s, e: idxs[0].e };
    }
  }

  return { showId: show.showId, count, showCount, fill, writerCount, pencil, people, selfWatching, right, shelf, roomId: show.roomId, inRoom: show.inRoom };
}
