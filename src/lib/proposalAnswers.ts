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

/** The shelf row's one line (both platforms): names for who's in, and the
 *  passes by name up to two, counts past that (Alborz, 10-14: a pitcher must
 *  see WHO answered WHAT — "Rodrigo has seen it", not "1 seen it"). */
export function answerRowLine(names: AnswerNames): string | null {
  const parts = answerRowParts(names);
  return parts.length ? parts.map((p) => p.text).join(" · ") : null;
}

/** The same line as parts, each pass marked — on your own pitch's row the
 *  passes draw in alert (his note, 10-27), so a friend's "seen it" can't hide
 *  in the grey. */
export function answerRowParts(names: AnswerNames): { text: string; pass: boolean }[] {
  const parts: { text: string; pass: boolean }[] = [];
  if (names.in.length) parts.push({ text: `${list(names.in)} ${names.in.length === 1 ? "is" : "are"} in`, pass: false });
  if (names.out.length) parts.push({ text: names.out.length <= 2 ? `${list(names.out)} ${names.out.length === 1 ? "is" : "are"} sitting this out` : `${names.out.length} sitting out`, pass: true });
  if (names.seen.length) parts.push({ text: names.seen.length <= 2 ? `${list(names.seen)} ${names.seen.length === 1 ? "has" : "have"} seen it` : `${names.seen.length} seen it`, pass: true });
  return parts;
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
