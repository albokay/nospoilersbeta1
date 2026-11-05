/**
 * letters — the "letters in transit" arithmetic for a show room's row on the
 * group room (Alborz 2026-09-25). Pure functions over the group dashboard's
 * member positions + the room's entry tags (lib/db fetchRoomEntryTags), so
 * both platforms word the same facts the same way:
 *
 *   • the GAP, terse, nearest friend each way: "3 behind Adam, 1 ahead of Sam"
 *   • SYNC when nobody's ahead or behind: "You and Adam are in sync!"
 *   • the MAIL: "2 letters waiting for you" (entries you can't open yet), else
 *     "2 letters for Sam to open" (your entries a friend hasn't reached).
 *
 * Positions are the raw dashboard s/e (what the group room already shows).
 */
import { linearIndex } from "./groupPills";
import { placesForEntry } from "./standAlone";
import { canViewInSeason } from "./utils";

export type RoomEntryTag = { authorId: string; s: number; e: number };
export type RoomMemberPos = { userId: string; s: number; e: number };

export type RoomLetters = {
  /** Entries by others the viewer can't open yet. */
  waiting: number;
  /** Their authors, unique. */
  waitingFrom: string[];
  /** The viewer's entries that at least one watching friend hasn't reached. */
  forThem: number;
  /** Those friends, unique. */
  forWhom: string[];
};

/** Everyone else on the room's road (Alborz 2026-09-28): once ANYONE in the
 *  room has started, a friend who hasn't sits at index 0 — "3 ahead of Sam",
 *  "3 letters for Sam to open". Before anyone starts, nobody is on the road
 *  (no "in sync" at zero). Departed members never reach here. */
export function roadOthers(members: RoomMemberPos[], selfUserId: string, seasons: number[] | undefined, seasonal?: Seasonal | null): { userId: string; idx: number }[] {
  if (!members.some((m) => m.s > 0 || m.e > 0)) return [];
  return members
    .filter((m) => m.userId !== selfUserId && (!seasonal || m.s === seasonal.season))
    .map((m) => ({ userId: m.userId, idx: linearIndex(m.s, m.e, seasons) }));
}

/** Stand alone mode (2026-11-04, CP2; the logic is PINNED for a revisit once
 *  the arc is done): on a show in the mode the road and the mail count only
 *  between people on the viewer's season — a friend on another season is
 *  off the road (no gap, no sync claim), and the viewer's letters in a
 *  season a friend isn't on aren't "for them to open" (their places in
 *  other seasons aren't on the client yet). Letters "waiting for you" keep
 *  counting everything sealed for the viewer. null off the mode. */
export type Seasonal = { season: number; canSee: (s: number, e: number) => boolean };
export function seasonalFor(showId: string | undefined, self: { s: number; e: number } | null | undefined): Seasonal | null {
  if (!showId || !self) return null;
  const places = placesForEntry({ showId });
  if (!places) return null;
  return { season: self.s, canSee: (s, e) => canViewInSeason({ season: s, episode: e }, self, places) };
}
/** How many friends the seasonal road leaves off (0 off the mode). */
export function offSeason(members: RoomMemberPos[], selfUserId: string, seasonal?: Seasonal | null): number {
  if (!seasonal || !members.some((m) => m.s > 0 || m.e > 0)) return 0;
  return members.filter((m) => m.userId !== selfUserId && m.s !== seasonal.season).length;
}

export function computeRoomLetters(
  tags: RoomEntryTag[] | undefined,
  members: RoomMemberPos[],
  selfUserId: string,
  seasons: number[] | undefined,
  seasonal?: Seasonal | null,
): RoomLetters {
  const out: RoomLetters = { waiting: 0, waitingFrom: [], forThem: 0, forWhom: [] };
  if (!tags?.length) return out;
  const idx = (s: number, e: number) => linearIndex(s, e, seasons);
  const self = members.find((m) => m.userId === selfUserId);
  const selfIdx = self ? idx(self.s, self.e) : 0;
  const others = roadOthers(members, selfUserId, seasons, seasonal);
  const posOf = (userId: string) => members.find((m) => m.userId === userId);
  const from = new Set<string>();
  const whom = new Set<string>();
  for (const t of tags) {
    const ti = idx(t.s, t.e);
    if (t.authorId === selfUserId) {
      const behind = seasonal
        ? others.filter((o) => { const m = posOf(o.userId); return !!m && m.s === t.s && m.e < t.e; })
        : others.filter((o) => o.idx < ti);
      if (behind.length) { out.forThem++; for (const o of behind) whom.add(o.userId); }
    } else if (seasonal ? !seasonal.canSee(t.s, t.e) : ti > selfIdx) {
      out.waiting++;
      from.add(t.authorId);
    }
  }
  out.waitingFrom = [...from];
  out.forWhom = [...whom];
  return out;
}

export type GapSummary = {
  /** "one" = you and your one watching friend are level; "all" = everyone is. */
  sync: "one" | "all" | null;
  nearestAhead: { userId: string; gap: number } | null;
  nearestBehind: { userId: string; gap: number } | null;
};

export function summarizeGap(selfIdx: number, others: { userId: string; idx: number }[], offRoad = 0): GapSummary {
  if (!others.length) return { sync: null, nearestAhead: null, nearestBehind: null };
  const ahead = others.filter((o) => o.idx > selfIdx).sort((a, b) => a.idx - b.idx);
  const behind = others.filter((o) => o.idx < selfIdx).sort((a, b) => b.idx - a.idx);
  // No sync claim while a friend is off the road (stand alone mode, CP2).
  if (!ahead.length && !behind.length) return { sync: offRoad > 0 ? null : others.length === 1 ? "one" : "all", nearestAhead: null, nearestBehind: null };
  return {
    sync: null,
    nearestAhead: ahead[0] ? { userId: ahead[0].userId, gap: ahead[0].idx - selfIdx } : null,
    nearestBehind: behind[0] ? { userId: behind[0].userId, gap: selfIdx - behind[0].idx } : null,
  };
}

type NameOf = (userId: string) => string | undefined;

/** FINISHED (his note, 11-04): a position at — or past — the show's last
 *  catalog episode. The rule the finished shelves and "finished together"
 *  already use; when new episodes land the catalog grows and the same
 *  position reads as progress again. Unknown catalog = never finished. */
export function atShowEnd(s: number, e: number, seasons: number[] | undefined): boolean {
  if (!seasons?.length) return false;
  const ls = seasons.length, le = seasons[ls - 1] ?? 1;
  return s > ls || (s === ls && e >= le);
}

/** "3 behind Adam, 1 ahead of Sam" — the /m row's terse gap. A viewer at the
 *  show's end reads "you're finished" instead of "N ahead of …" (11-04). */
export function gapPhrase(g: GapSummary, nameOf: NameOf, selfAtEnd = false): string | null {
  const parts: string[] = [];
  if (g.nearestAhead) parts.push(`${g.nearestAhead.gap} behind ${nameOf(g.nearestAhead.userId) ?? "a friend"}`);
  if (g.nearestBehind) parts.push(selfAtEnd ? "you\u2019re finished" : `${g.nearestBehind.gap} ahead of ${nameOf(g.nearestBehind.userId) ?? "a friend"}`);
  return parts.length ? parts.join(", ") : null;
}

/** "You and Adam are in sync!" / "Everyone is in sync!" — or, level at the
 *  show's end (11-04), "You're both finished." / "You've all finished." */
export function syncLine(g: GapSummary, others: { userId: string }[], nameOf: NameOf, allAtEnd = false): string | null {
  if (!g.sync) return null;
  if (allAtEnd) return g.sync === "one" ? "You\u2019re both finished." : "You\u2019ve all finished.";
  if (g.sync === "one") return `You and ${nameOf(others[0]?.userId ?? "") ?? "your friend"} are in sync!`;
  return "Everyone is in sync!";
}

const letters = (n: number) => `${n} letter${n === 1 ? "" : "s"}`;

/** The /m row's mail segment: "2 letters waiting for you" / "2 letters for Sam to open". */
export function lettersSegment(l: RoomLetters, nameOf: NameOf): string | null {
  if (l.waiting > 0) return `${letters(l.waiting)} waiting for you`;
  if (l.forThem > 0) {
    const who = l.forWhom.length === 1 ? nameOf(l.forWhom[0]) ?? "them" : "them";
    return `${letters(l.forThem)} for ${who} to open`;
  }
  return null;
}

/** The desktop tooltip's mail sentence. */
export function lettersSentence(l: RoomLetters, nameOf: NameOf): string | null {
  if (l.waiting > 0) {
    const from = l.waitingFrom.length === 1 ? nameOf(l.waitingFrom[0]) : undefined;
    // Carries the catch-up sentiment itself (Alborz 2026-09-25), so the
    // room's "…for when you catch up" notif line can stand down.
    return `${letters(l.waiting)} waiting for you from ${from ?? "your friends"}\u2026for when you catch up.`;
  }
  if (l.forThem > 0) {
    const who = l.forWhom.length === 1 ? nameOf(l.forWhom[0]) : undefined;
    return who ? `${who} has ${l.forThem} of your letters to open.` : `Your friends have ${l.forThem} of your letters to open.`;
  }
  return null;
}
