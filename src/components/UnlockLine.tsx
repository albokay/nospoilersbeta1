import React from "react";
import { CANON } from "../styles/canon";
import LetterDisc from "./LetterDisc";

// The unlock line (letters in transit, Alborz 2026-09-25): one line at the
// top of the show room's feed after your progress moves, naming what just
// opened — "Caught up to S1 E6. Two of Adam's letters are open now." The
// open envelope on its Identity disc, the same mark the room rows carry for
// new-to-read. In-session only: it appears after the write, stays while
// you're in the room, and is gone the next time you come in.
export type UnlockNote = {
  s: number;
  e: number;
  /** Entries that were sealed stubs a moment ago. */
  entries: number;
  /** Their authors (usernames), unique — one author names the letters. */
  authors: string[];
  /** Responses that were hidden a moment ago. */
  responses: number;
};

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const num = (n: number) => (n < WORDS.length ? WORDS[n] : String(n));

export function describeUnlock(n: UnlockNote, nameOf: (username: string) => string): string {
  const parts: string[] = [];
  if (n.entries > 0) {
    parts.push(n.authors.length === 1
      ? `${num(n.entries)} of ${nameOf(n.authors[0])}’s letters`
      : `${num(n.entries)} letter${n.entries === 1 ? "" : "s"}`);
  }
  if (n.responses > 0) parts.push(`${num(n.responses)} response${n.responses === 1 ? "" : "s"}`);
  const what = parts.join(" and ");
  const total = n.entries + n.responses;
  return `Caught up to S${n.s} E${n.e}. ${what[0].toUpperCase()}${what.slice(1)} ${total === 1 ? "is" : "are"} open now.`;
}

export default function UnlockLine({ note, nameOf }: { note: UnlockNote; nameOf: (username: string) => string }) {
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8,
        color: CANON.cream, fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.45, opacity: 0.9,
        margin: "0 0 16px",
      }}
    >
      <LetterDisc kind="open" />
      <span>{describeUnlock(note, nameOf)}</span>
    </div>
  );
}
