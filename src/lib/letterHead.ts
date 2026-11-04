/**
 * letterHead — the first words of a letter, bold and in Lora, in place of a
 * written title (his note on titles as busy work, 2026-11-03).
 *
 * Counts characters, not words: the head should fill roughly half to two
 * thirds of the first line. His mockup's head ("I think this episode was
 * kind of bad") is 36 characters.
 *
 *  1. A first sentence of up to SENTENCE_MAX characters is the head whole,
 *     its end mark included. A very short one ("Nicholas Cage?") takes the
 *     sentences after it while the whole stays under SENTENCE_MAX. "1." at
 *     the top of a list is not a sentence.
 *  2. Otherwise, past MIN characters, the first clause break (comma, dash,
 *     colon, semicolon) before BREAK_MAX ends the head; the mark is dropped.
 *  3. Otherwise whole words up to CUT, then trailing stop words come off
 *     (articles, prepositions, conjunctions, auxiliaries and their
 *     contractions, subject pronouns, intensifiers, the openers of fixed pairs like
 *     "kind of"). If that leaves fewer than three words, the head grows
 *     forward to the next content word instead, capped at HARD_MAX.
 *  4. A head never ends inside an open quote or bracket: it grows to the
 *     closing mark when that stays under HARD_MAX, else stops before the
 *     opening one.
 *  5. The writer's casing stays. A one-line letter with no end mark is all
 *     head.
 *
 * Deck prompts ([PROMPT:…]) at the top of a letter are skipped: the head is
 * the writer's own words. Used wherever a title stood in for the letter:
 * the letter itself, rows, the guide, the daily email.
 *
 * LETTER_HEADS is the site switch (his 11-03 ask to be able to change his
 * mind): false puts every written title back on its own line, exactly as
 * before; the titles themselves are never touched.
 */
import type { CSSProperties } from "react";

export const LETTER_HEADS = true;

/** The head's type: Lora bold at the letter-title size, run into the body's
 *  line (lineHeight 1 so the first line box stays the body's). */
export const LETTER_HEAD_STYLE: CSSProperties = { fontFamily: '"Lora", Georgia, serif', fontWeight: 700, fontSize: 22, lineHeight: 1 };

/** What stands in for a letter wherever its title did: the head when the
 *  switch is on (the written title only if the body gives nothing). */
export function letterTitle(title: string | null | undefined, body: string | null | undefined): string {
  if (!LETTER_HEADS) return title ?? "";
  return letterHead(body ?? "") || title || "";
}

const MIN = 22;
const CUT = 40;
const SENTENCE_MAX = 48;
const BREAK_MAX = 48;
const HARD_MAX = 56;

const STOP = new Set([
  // articles + determiners
  "a", "an", "the", "this", "that", "these", "those", "some", "any", "each", "every", "no", "my", "your", "his", "her", "its", "our", "their", "whose",
  // pronouns
  "i", "you", "he", "she", "it", "we", "they", "who", "whom", "which", "what",
  // prepositions
  "in", "on", "at", "of", "to", "for", "with", "from", "by", "about", "into", "onto", "over", "after", "before", "between", "through", "under", "up", "out", "off", "than", "as", "like", "until", "till", "without", "within", "around", "across", "toward", "towards", "against", "during", "per",
  // conjunctions
  "and", "but", "or", "so", "nor", "yet", "because", "if", "when", "while", "whether", "though", "although", "since", "unless", "where", "whereas", "once",
  // auxiliaries / copulas
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "has", "have", "had", "will", "would", "can", "could", "should", "may", "might", "must", "shall", "ought",
  "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "hasn't", "haven't", "hadn't", "won't", "wouldn't", "can't", "couldn't", "shouldn't", "mustn't", "ain't",
  "i'm", "i've", "i'd", "i'll", "you're", "you've", "you'd", "you'll", "he's", "she's", "it's", "we're", "we've", "we'd", "we'll", "they're", "they've", "they'd", "they'll", "that's", "there's", "here's", "what's", "who's", "let's",
  // intensifiers, hedges, openers of fixed pairs
  "very", "really", "too", "not", "just", "quite", "pretty", "rather", "kind", "sort", "lot", "lots", "bit", "couple", "bunch", "kinda", "sorta", "also", "even", "still", "only", "almost", "such", "how", "why", "then", "there", "little", "few",
]);

const PROMPT_RE = /^\s*(?:\[PROMPT:[\s\S]*?\]\s*)+/;
const SENTENCE_END = /[.!?]["'”’)\]]*(?=\s|$)/g;
const SHORT_SENTENCE = 16;
const OPENERS: Record<string, string> = { '"': '"', "“": "”", "(": ")", "[": "]", "‘": "’" };

function wordKey(w: string): string {
  return w.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, "").replace(/[’]/g, "'");
}

function isStop(w: string): boolean {
  const k = wordKey(w);
  return k === "" || STOP.has(k);
}

/** The first line of a letter: its head, computed from the writer's body. */
export function letterHead(body: string): string {
  const text = (body ?? "").replace(PROMPT_RE, "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  // 1. the first sentence, whole; a very short one takes the next while it fits
  const ends = sentenceEnds(text);
  if (ends.length && ends[0] <= SENTENCE_MAX) {
    let at = ends[0];
    if (at < SHORT_SENTENCE) for (const e of ends.slice(1)) { if (e <= SENTENCE_MAX) at = e; else break; }
    return text.slice(0, at);
  }

  const words = text.split(" ");
  const upTo = (n: number) => words.slice(0, n).join(" ");

  // 2. a clause break past MIN and before BREAK_MAX
  for (let n = 1; n <= words.length; n++) {
    const s = upTo(n);
    if (s.length > BREAK_MAX) break;
    if (s.length >= MIN && /[,;:]["'”’)\]]*$|—$|–$|\s-$/.test(s)) return finish(stripTrailingMark(s), text);
    if (s.length >= MIN && n < words.length && /^[—–-]$/.test(words[n])) return finish(s, text);
  }

  // 3. whole words up to CUT, then back off stop words
  let n = 0;
  while (n < words.length && upTo(n + 1).length <= CUT) n++;
  if (n === 0) n = 1;
  let k = n;
  while (k > 0 && isStop(words[k - 1])) k--;
  if (k < 3) {
    // too little left: grow forward to the next content word instead
    k = n;
    while (k < words.length && isStop(words[k]) && upTo(k + 1).length <= HARD_MAX) k++;
    if (k < words.length && upTo(k + 1).length <= HARD_MAX) k++;
  }
  k = keepNameRun(words, k);
  return finish(stripTrailingMark(upTo(k)), text);
}

/** Where each sentence ends (the index after its mark); "1." and "Dr." don't count. */
function sentenceEnds(text: string): number[] {
  const out: number[] = [];
  const re = new RegExp(SENTENCE_END.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    const lastWord = before.slice(before.lastIndexOf(" ") + 1);
    if (/^\d+$/.test(lastWord) && m[0].startsWith(".")) continue;   // "1." opening a list
    if (/^[A-Z][a-z]{0,2}$/.test(lastWord) && m[0].startsWith(".")) continue; // "Dr.", "Mr.", "St."
    out.push(m.index + m[0].length);
  }
  return out;
}

/** A head never splits a run of capitalised words ("Sky Captain"). */
function keepNameRun(words: string[], k: number): number {
  const cap = (w: string) => /^[A-Z][a-z]/.test(w);
  while (k > 0 && k < words.length && cap(words[k - 1]) && cap(words[k]) && words.slice(0, k + 1).join(" ").length <= HARD_MAX) k++;
  return k;
}

function stripTrailingMark(s: string): string {
  return s.replace(/[,;:]+$/, "").replace(/\s*[—–-]$/, "").trim();
}

/** 4. never end inside an open quote or bracket. */
function finish(head: string, text: string): string {
  for (const [open, close] of Object.entries(OPENERS)) {
    const opens = countChar(head, open), closes = open === close ? 0 : countChar(head, close);
    const unbalanced = open === close ? opens % 2 === 1 : opens > closes;
    if (!unbalanced) continue;
    const closeAt = text.indexOf(close, head.length);
    if (closeAt !== -1 && closeAt + 1 <= HARD_MAX) {
      // grow to the closing mark (and a sentence end right after it)
      let grown = text.slice(0, closeAt + 1);
      const tail = /^[.!?]/.exec(text.slice(closeAt + 1));
      if (tail) grown += tail[0];
      return grown;
    }
    const openAt = head.lastIndexOf(open);
    return stripTrailingMark(head.slice(0, openAt)).trim() || head;
  }
  return head;
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (const ch of s) if (ch === c) n++;
  return n;
}

/** The head's place in the RAW body: [start, end) offsets, so a letter's
 *  highlights and notes (anchored to body offsets) stay where they are
 *  when the head is drawn bold. `start` is past any leading prompt token
 *  and whitespace; `restAt` is where the body continues (a comma or dash
 *  the head dropped, and the space after it, skipped). */
export function letterHeadSpan(body: string): { start: number; end: number; restAt: number } {
  const raw = body ?? "";
  const lead = PROMPT_RE.exec(raw);
  const start = lead ? lead[0].length : (raw.length - raw.replace(/^\s+/, "").length);
  const head = letterHead(raw);
  if (!head) return { start, end: start, restAt: start };
  // walk the head over the raw text: a space in the head may be any run of whitespace
  let i = 0, j = start;
  while (i < head.length && j < raw.length) {
    if (head[i] === " " && /\s/.test(raw[j])) { while (j < raw.length && /\s/.test(raw[j])) j++; i++; continue; }
    if (head[i] !== raw[j]) break;
    i++; j++;
  }
  const end = i === head.length ? j : start + head.length;
  let restAt = end;
  const after = raw.slice(end);
  const skip = /^[,;:]?[ \t]*(?:[—–-][ \t]+)?[ \t]*/.exec(after);
  if (skip) restAt = end + skip[0].length;
  return { start, end, restAt };
}

/** The body after its head, for the run-in rendering: the head and the rest
 *  share a line, so the rest starts where the head stopped. */
export function letterRest(body: string): string {
  const raw = (body ?? "").replace(PROMPT_RE, "");
  const { restAt } = letterHeadSpan(raw);
  return raw.slice(restAt);
}
