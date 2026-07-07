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
 *             how far behind the furthest watcher you are. Shown only once YOU'VE
 *             opted into the show — either by watching (progress past s0 e0) or by
 *             writing in its room; a show another member pooled that you haven't
 *             engaged with shows a blank right side (no arrow). Shows s/e (no
 *             arrow) when you ARE watching and everyone's at the same point; a
 *             written-but-unwatched room (no watchers) shows "s0 e0" with no arrow
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
  const watchers = members.filter((m) => m.s != null && ((m.s ?? 0) > 0 || (m.e ?? 0) > 0));
  const writerCount = members.filter((m) => m.wrote).length;
  const count = members.length;

  const self = members.find((m) => m.userId === selfUserId);
  const selfWatching = !!self && self.s != null && ((self.s ?? 0) > 0 || (self.e ?? 0) > 0);

  // Fill = your relationship to the show (2026-07-07): an OPEN room is green;
  // a proposal you've voted yes on is cream-filled; a proposal you haven't
  // opted into (someone else's) is outline-only. On a proposal, `members`
  // holds only the yes-voters, so self-present-and-voted = you're in.
  const fill: PillFill = show.roomId ? "green" : self?.voted ? "cream" : "outlined";
  const people = writerCount >= 2;
  const pencil = writerCount === 1;
  const showCount = count >= 2 && !people;
  const shelf = show.roomId ? "watching" : "notStarted";

  let right: PillRight = { kind: "none" };

  if (watchers.length === 0) {
    // Want-only → nothing; written-but-unwatched → "s0 e0".
    right = writerCount > 0 ? { kind: "progress", s: 0, e: 0 } : { kind: "none" };
  } else {
    const idxs = watchers.map((w) => ({
      id: w.userId,
      idx: linearIndex(w.s ?? 0, w.e ?? 0, seasons),
      s: w.s ?? 0,
      e: w.e ?? 0,
    }));
    const maxIdx = Math.max(...idxs.map((x) => x.idx));
    const minIdx = Math.min(...idxs.map((x) => x.idx));
    const spread = maxIdx !== minIdx;

    if (selfWatching && spread) {
      const selfIdx = linearIndex(self!.s ?? 0, self!.e ?? 0, seasons);
      if (selfIdx >= maxIdx) {
        // You are most-advanced (or tied at the furthest): ahead of next-most by N.
        const below = idxs.map((x) => x.idx).filter((i) => i < maxIdx);
        const nextMost = below.length ? Math.max(...below) : maxIdx;
        right = { kind: "arrow", dir: "up", n: maxIdx - nextMost };
      } else {
        right = { kind: "arrow", dir: "down", n: maxIdx - selfIdx };
      }
    } else if (!selfWatching) {
      // You haven't watched yet (s0 e0). Show the gap ONLY if you've opted into
      // this show by WRITING in its room — otherwise a show another member
      // pooled (that you haven't engaged with) leaves the pill's right side
      // blank, so an invitee's group doesn't read as a wall of red gaps.
      // (Moving your progress past s0 e0 is the other opt-in, but that makes you
      // a watcher and is handled by the branch above.)
      if (self?.wrote) {
        const selfIdx = linearIndex(self?.s ?? 0, self?.e ?? 0, seasons);
        right = { kind: "arrow", dir: "down", n: maxIdx - selfIdx };
      }
      // else: not opted in → leave right = { kind: "none" } (blank).
    } else {
      // You're watching and everyone (incl. you) is at the same point → that progress.
      right = { kind: "progress", s: idxs[0].s, e: idxs[0].e };
    }
  }

  return { showId: show.showId, count, showCount, fill, writerCount, pencil, people, selfWatching, right, shelf, roomId: show.roomId, inRoom: show.inRoom };
}
