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
export type AnswerNames = {
  in: string[]; out: string[]; seen: string[];
  /** Stand alone mode (2026-11-04): the season each "in" friend is on, by
   *  name — the sheet says which season the pitcher picked. */
  inSeason?: Record<string, number>;
};

const list = (n: string[]) => n.length === 1 ? n[0] : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;

/** "Sam and Alex are in." / "Adam's sitting this out." / "Yalborz has already seen it." */
export function answerLines(names: AnswerNames): string[] {
  const out: string[] = [];
  if (names.in.length && names.inSeason) {
    // "Aalborz is in, on season 51." — one line per season; friends with no
    // season yet keep the plain line.
    const bySeason = new Map<number, string[]>();
    for (const n of names.in) { const s = names.inSeason[n] ?? 0; bySeason.set(s, [...(bySeason.get(s) ?? []), n]); }
    for (const [s, ns] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
      out.push(s > 0 ? `${list(ns)} ${ns.length === 1 ? "is" : "are"} in, on season ${s}.` : `${list(ns)} ${ns.length === 1 ? "is" : "are"} in.`);
    }
  } else if (names.in.length) out.push(`${list(names.in)} ${names.in.length === 1 ? "is" : "are"} in.`);
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

/** The tally (Alborz 2026-11-05): every current group member in one of four
 *  buckets — in · out · seen it · ? (hasn't answered yet) — "you" included,
 *  first in your bucket. The rows draw it (`TallyLine`), the answer sheet
 *  stacks it. Someone invited but not yet in the group isn't counted: they
 *  can't answer. */
export type Tally = { in: string[]; out: string[]; seen: string[]; waiting: string[] };
export type TallyKey = keyof Tally;
export const TALLY_LABEL: Record<TallyKey, string> = { in: "in", out: "out", seen: "seen it", waiting: "?" };

export function tallyFor(args: { memberIds: string[]; selfId: string; inIds: string[]; passes: Record<string, PassKind> | undefined; name: (id: string) => string }): Tally {
  const t: Tally = { in: [], out: [], seen: [], waiting: [] };
  // Nothing until the group's members have loaded — never a lone "in: you".
  if (args.memberIds.length === 0) return t;
  const ids = [args.selfId, ...args.memberIds.filter((id) => id !== args.selfId)];
  for (const id of ids) {
    const k: TallyKey = args.inIds.includes(id) ? "in" : args.passes?.[id] === "out" ? "out" : args.passes?.[id] === "seen" ? "seen" : "waiting";
    t[k].push(id === args.selfId ? "you" : args.name(id));
  }
  return t;
}

/** The buckets with people in them, in order. `outstandingOnly` drops "in"
 *  — a started room's rows, where the room already holds who's in. */
export function tallyBuckets(t: Tally, outstandingOnly = false): { key: TallyKey; label: string; names: string[] }[] {
  const keys: TallyKey[] = outstandingOnly ? ["out", "seen", "waiting"] : ["in", "out", "seen", "waiting"];
  return keys.filter((k) => t[k].length > 0).map((k) => ({ key: k, label: TALLY_LABEL[k], names: t[k] }));
}

/** The tally without you — the answer sheet's stack, where your answer is the control, never a line. */
export function tallyOthers(t: Tally): Tally {
  const drop = (n: string[]) => n.filter((x) => x !== "you");
  return { in: drop(t.in), out: drop(t.out), seen: drop(t.seen), waiting: drop(t.waiting) };
}

/** Someone is out, has seen it, or hasn't answered — the tally has something to say on a started room. */
export const tallySplit = (t: Tally): boolean => t.out.length + t.seen.length + t.waiting.length > 0;

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
