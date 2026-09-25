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

export function computeRoomLetters(
  tags: RoomEntryTag[] | undefined,
  members: RoomMemberPos[],
  selfUserId: string,
  seasons: number[] | undefined,
): RoomLetters {
  const out: RoomLetters = { waiting: 0, waitingFrom: [], forThem: 0, forWhom: [] };
  if (!tags?.length) return out;
  const idx = (s: number, e: number) => linearIndex(s, e, seasons);
  const self = members.find((m) => m.userId === selfUserId);
  const selfIdx = self ? idx(self.s, self.e) : 0;
  const others = members
    .filter((m) => m.userId !== selfUserId && (m.s > 0 || m.e > 0))
    .map((m) => ({ userId: m.userId, idx: idx(m.s, m.e) }));
  const from = new Set<string>();
  const whom = new Set<string>();
  for (const t of tags) {
    const ti = idx(t.s, t.e);
    if (t.authorId === selfUserId) {
      const behind = others.filter((o) => o.idx < ti);
      if (behind.length) { out.forThem++; for (const o of behind) whom.add(o.userId); }
    } else if (ti > selfIdx) {
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

export function summarizeGap(selfIdx: number, others: { userId: string; idx: number }[]): GapSummary {
  if (!others.length) return { sync: null, nearestAhead: null, nearestBehind: null };
  const ahead = others.filter((o) => o.idx > selfIdx).sort((a, b) => a.idx - b.idx);
  const behind = others.filter((o) => o.idx < selfIdx).sort((a, b) => b.idx - a.idx);
  if (!ahead.length && !behind.length) return { sync: others.length === 1 ? "one" : "all", nearestAhead: null, nearestBehind: null };
  return {
    sync: null,
    nearestAhead: ahead[0] ? { userId: ahead[0].userId, gap: ahead[0].idx - selfIdx } : null,
    nearestBehind: behind[0] ? { userId: behind[0].userId, gap: selfIdx - behind[0].idx } : null,
  };
}

type NameOf = (userId: string) => string | undefined;

/** "3 behind Adam, 1 ahead of Sam" — the /m row's terse gap. */
export function gapPhrase(g: GapSummary, nameOf: NameOf): string | null {
  const parts: string[] = [];
  if (g.nearestAhead) parts.push(`${g.nearestAhead.gap} behind ${nameOf(g.nearestAhead.userId) ?? "a friend"}`);
  if (g.nearestBehind) parts.push(`${g.nearestBehind.gap} ahead of ${nameOf(g.nearestBehind.userId) ?? "a friend"}`);
  return parts.length ? parts.join(", ") : null;
}

/** "You and Adam are in sync!" / "Everyone is in sync!" */
export function syncLine(g: GapSummary, others: { userId: string }[], nameOf: NameOf): string | null {
  if (!g.sync) return null;
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
    return `There ${l.waiting === 1 ? "is 1 letter" : `are ${l.waiting} letters`} waiting for you from ${from ?? "your friends"}.`;
  }
  if (l.forThem > 0) {
    const who = l.forWhom.length === 1 ? nameOf(l.forWhom[0]) : undefined;
    return who ? `${who} has ${l.forThem} of your letters to open.` : `Your friends have ${l.forThem} of your letters to open.`;
  }
  return null;
}
