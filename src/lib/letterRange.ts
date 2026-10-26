/**
 * letterRange — letters after a binge (Alborz 2026-10-25). When progress
 * moves two or more episodes past a real earlier position, the letter
 * written in the compose that opens right after carries the stretch it
 * was written after: its stamp reads the range ("S1" over "E4-7"), the
 * sealed row says the friend wrote it "after watching four in a row", the
 * daily email names it the same way. The letter is still stamped and
 * sealed at the episode it was written from — the range is display only.
 *
 * A jump counts only from a REAL earlier position: never from "haven't
 * started" (a first declaration, a "seen it" entry landing at the end),
 * never on a rewatch, never a move of one.
 */
import { linearIndex } from "./groupPills";

/** The first new episode of the stretch. */
export type LetterRange = { s: number; e: number };

/** The range a progress advance from `prev` to `next` opens, or null when
 *  the move isn't a jump worth marking. */
export function jumpRange(
  prev: { s: number; e: number; isRewatching?: boolean } | null | undefined,
  next: { s: number; e: number },
  seasons: number[] | undefined,
): LetterRange | null {
  if (!prev || prev.isRewatching || !seasons?.length) return null;
  const prevIdx = linearIndex(prev.s, prev.e, seasons);
  const nextIdx = linearIndex(next.s, next.e, seasons);
  if (prevIdx <= 0 || nextIdx - prevIdx < 2) return null;
  // The episode after `prev`: the next one in its season, else the first of the next.
  const inSeason = seasons[prev.s - 1] ?? 0;
  return prev.e < inSeason ? { s: prev.s, e: prev.e + 1 } : { s: prev.s + 1, e: 1 };
}

/** How many episodes the stretch holds, first new one to the landing one. */
export function rangeCount(from: LetterRange, to: { s: number; e: number }, seasons: number[] | undefined): number {
  if (!seasons?.length) return 0;
  return Math.max(0, linearIndex(to.s, to.e, seasons) - linearIndex(from.s, from.e, seasons) + 1);
}

/** The stamp's tag: "S1 E7" for a plain letter; a range STACKS on two lines
 *  (a one-line "S1 E4-7" runs into the ornament on the narrower families) —
 *  "S1" over "E4-7", and across a season "S1 E20 -" over "S2 E3" (the
 *  letters repeat only when the season changes; Alborz's format rule). */
export function stampLabelFor(s: number, e: number, from?: LetterRange | null): string {
  if (!from) return `S${s} E${e}`;
  if (from.s === s) return `S${s}\nE${from.e}-${e}`;
  return `S${from.s} E${from.e} -\nS${s} E${e}`;
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "four in a row" — word numbers to nine, numerals past that. */
export function inARow(count: number): string {
  return `${count <= 9 ? WORDS[count] : String(count)} in a row`;
}
