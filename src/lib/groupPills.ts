/**
 * Pill-state computation for the group-context dashboard (§7 of the
 * restructure spec). Pure functions over the get_group_dashboard payload, kept
 * separate from rendering so the rules are testable in isolation.
 *
 * Per pooled show:
 *   • count   = watchers + wanters (everyone opted in)
 *   • fill    = cream (want-only) / outlined (≥1 watching) / green (2+ writers)
 *   • pencil  at exactly 1 writer; people icon (replaces number) at 2+ writers
 *   • ▲N/▼N   your progress vs the room: ▲ when you're the furthest along, ▼ for
 *             how far behind the furthest watcher you are (incl. when you haven't
 *             started — effectively s0 e0). Only shows s/e (no arrow) when you ARE
 *             watching and everyone's at the same point; a written-but-unwatched
 *             room (no watchers) shows "s0 e0" with no arrow
 *   • shelf   = currentlyWatching once anyone watches OR anyone has written
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

  const fill: PillFill = writerCount >= 2 ? "green" : watchers.length >= 1 ? "outlined" : "cream";
  const people = writerCount >= 2;
  const pencil = writerCount === 1;
  const showCount = count >= 2 && !people;
  const shelf = watchers.length >= 1 || writerCount >= 1 ? "watching" : "notStarted";

  const self = members.find((m) => m.userId === selfUserId);
  const selfWatching = !!self && self.s != null && ((self.s ?? 0) > 0 || (self.e ?? 0) > 0);

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
      // You haven't started but others have → red ▼ for how far behind the
      // furthest-along watcher you are (your progress is effectively s0 e0).
      // Previously this showed the watcher's raw s/e, which read like it was
      // YOUR progress on your own button.
      const selfIdx = linearIndex(self?.s ?? 0, self?.e ?? 0, seasons);
      right = { kind: "arrow", dir: "down", n: maxIdx - selfIdx };
    } else {
      // You're watching and everyone (incl. you) is at the same point → that progress.
      right = { kind: "progress", s: idxs[0].s, e: idxs[0].e };
    }
  }

  return { showId: show.showId, count, showCount, fill, writerCount, pencil, people, right, shelf, roomId: show.roomId, inRoom: show.inRoom };
}
