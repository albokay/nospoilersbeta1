/**
 * journal.ts — the journal handover's words and dates (2026-10-26).
 *
 * A journal = the viewer's private entries for a show (threads with no room
 * link). Handing it to a group copies the picked entries into the group's
 * show room (`hand_over_journal`); each copy keeps the original's write time
 * in `written_at`, and the room dates the journal by its latest entry:
 * "finished spring 2024" when that entry sits at the show's last aired
 * episode, "last written spring 2024" otherwise (his rule, 10-26).
 */
import type { Thread } from "../types";
import { endOfShow } from "./proposalAnswers";

/** "spring 2024" from a time: Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov fall. */
export function seasonWord(ms: number): string {
  const d = new Date(ms);
  const m = d.getMonth();
  const word = m <= 1 || m === 11 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "fall";
  return `${word} ${d.getFullYear()}`;
}

/** "Jan 2024" — the picker's row date. */
export function monthYear(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** The journal's date line from its entries (any shape with the stamp and a
 *  write time): finished vs last written, and when. Null without entries. */
export function journalDate(
  entries: { s: number; e: number; at: number }[],
  show: { seasons?: number[] } | null | undefined,
): { finished: boolean; when: string; latestAt: number } | null {
  if (!entries.length) return null;
  let top = entries[0];
  let latestAt = entries[0].at;
  for (const x of entries) {
    if (x.s > top.s || (x.s === top.s && x.e > top.e)) top = x;
    if (x.at > latestAt) latestAt = x.at;
  }
  const end = endOfShow(show);
  const finished = end.s > 0 && top.s === end.s && top.e === end.e;
  return { finished, when: seasonWord(latestAt), latestAt };
}

/** "Finished spring 2024" / "Last written spring 2024" (the panel's and card's line). */
export function journalDateLabel(d: { finished: boolean; when: string }): string {
  return `${d.finished ? "Finished" : "Last written"} ${d.when}`;
}

/** The FROM line's tag: "Yalborz's journal · finished spring 2024". */
export function journalFromTag(name: string, d: { finished: boolean; when: string }): string {
  return `${name}’s journal · ${d.finished ? "finished" : "last written"} ${d.when}`;
}

/** The one-time card's "written …" phrase (his variants): within six weeks
 *  "a few weeks ago", this year "earlier this year", else "in 2024". */
export function writtenPhrase(latestAt: number, now = Date.now()): string {
  const sixWeeks = 42 * 24 * 60 * 60 * 1000;
  if (now - latestAt <= sixWeeks) return "a few weeks ago";
  const y = new Date(latestAt).getFullYear();
  return y === new Date(now).getFullYear() ? "earlier this year" : `in ${y}`;
}

/** Threads → the date helper's shape (a copy carries `writtenAt`; a journal
 *  entry its own `createdAt`). */
export function journalPoints(threads: Thread[]): { s: number; e: number; at: number }[] {
  return threads.map((t) => ({ s: t.season, e: t.episode, at: t.writtenAt ?? t.createdAt }));
}

/** Journal entries in episode order, earliest first. */
export function sortJournal(threads: Thread[]): Thread[] {
  return [...threads].sort((a, b) => a.season - b.season || a.episode - b.episode || a.createdAt - b.createdAt);
}

/** The one-time card's per-device close (like the letter from Sidebar). */
export function journalCardKey(viewerId: string, roomId: string, authorId: string): string {
  return `ns_journal_card_${viewerId}_${roomId}_${authorId}`;
}
