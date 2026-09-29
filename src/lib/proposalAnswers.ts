/**
 * Proposal answers (Alborz 2026-09-29): a proposal takes one of three
 * answers — I'm in · sit this out · seen it — never a bare "no", so a
 * proposer can tell a pass from silence. "In" is the yes-vote as before;
 * the two passes live in group_show_passes. Untouched = hasn't looked yet.
 * The wording rules, shared by both platforms and the what's-next panel:
 * one line per answer, the others only (your own answer is the control).
 */
export type Stance = "in" | "out" | "seen";
export type PassKind = "out" | "seen";
export type AnswerNames = { in: string[]; out: string[]; seen: string[] };

const list = (n: string[]) => n.length === 1 ? n[0] : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;

/** "Sam and Alex are in." / "Adam's sitting this out." / "Yalborz has already seen it." */
export function answerLines(names: AnswerNames): string[] {
  const out: string[] = [];
  if (names.in.length) out.push(`${list(names.in)} ${names.in.length === 1 ? "is" : "are"} in.`);
  if (names.out.length) out.push(names.out.length === 1 ? `${names.out[0]}'s sitting this out.` : `${list(names.out)} are sitting this out.`);
  if (names.seen.length) out.push(`${list(names.seen)} ${names.seen.length === 1 ? "has" : "have"} already seen it.`);
  return out;
}

/** The /m shelf row's one line: names for who's in, counts for the passes. */
export function answerRowLine(names: AnswerNames): string | null {
  const parts: string[] = [];
  if (names.in.length) parts.push(`${list(names.in)} ${names.in.length === 1 ? "is" : "are"} in`);
  if (names.out.length) parts.push(`${names.out.length} sitting out`);
  if (names.seen.length) parts.push(`${names.seen.length} seen it`);
  return parts.length ? parts.join(" · ") : null;
}

/** Your own pass, in a pill's right slot / after the row line. */
export const passSlotLabel = (k: PassKind): string => (k === "seen" ? "seen it" : "sitting this out");
export const passSelfNote = (k: PassKind): string => (k === "seen" ? "you've seen it" : "you're sitting this out");

/** The end of what's aired — a "seen it" member's default progress. */
export function endOfShow(show?: { seasons?: number[] } | null): { s: number; e: number } {
  const seasons = show?.seasons ?? [];
  if (!seasons.length) return { s: 0, e: 0 };
  return { s: seasons.length, e: seasons[seasons.length - 1] || 0 };
}

/** showId → userId → kind, from the rows. */
export function indexPasses(rows: { showId: string; userId: string; kind: PassKind }[]): Record<string, Record<string, PassKind>> {
  const out: Record<string, Record<string, PassKind>> = {};
  for (const r of rows) (out[r.showId] ??= {})[r.userId] = r.kind;
  return out;
}
