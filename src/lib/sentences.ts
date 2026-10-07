/**
 * Sentence ranges of a run of text (notes arc, 2026-10-07): on a phone a
 * highlight is picked by TAPPING SENTENCES, not by selecting text.
 *
 * Returns [a, b) offsets into the body — absolute, `offset` being where the
 * run starts in the body string. A sentence ends at a run of . ! ? … plus
 * any closing quotes or brackets, when a space or the end follows (so
 * "3.5" and "e.g." don't split); a line break always ends one. Whitespace
 * is trimmed off both ends and empty runs are skipped; a fragment shorter
 * than three characters joins the sentence before it, so a stray "…" or
 * ")" never stands alone. Abbreviations ("Mr. Smith") do split — tunable.
 */
export type Range = { a: number; b: number };

const ENDERS = ".!?…";
const CLOSERS = "\"”’')]";

export function splitSentences(text: string, offset = 0): Range[] {
  const local: Range[] = [];
  const push = (a: number, b: number) => {
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b <= a) return;
    const last = local[local.length - 1];
    if (last && b - a < 3) { last.b = b; return; }
    local.push({ a, b });
  };
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") { push(start, i); start = i + 1; continue; }
    if (ENDERS.includes(ch)) {
      let j = i + 1;
      while (j < text.length && ENDERS.includes(text[j])) j++;
      while (j < text.length && CLOSERS.includes(text[j])) j++;
      if (j >= text.length || /\s/.test(text[j])) { push(start, j); start = j; }
      i = j - 1;
    }
  }
  push(start, text.length);
  return local.map((r) => ({ a: r.a + offset, b: r.b + offset }));
}

/** Tapping sentence `s` against the current pick: nothing picked → just
 *  `s`; `s` outside → the pick grows to a continuous stretch covering both
 *  (tap 1 then 4 picks 1–4); `s` at either end → it is let go; `s` in the
 *  middle → unchanged. `all` is the body's sentence list in order. */
export function togglePick(range: Range | null, s: Range, all: Range[]): Range | null {
  if (!range) return { ...s };
  const inside = s.a >= range.a && s.b <= range.b;
  if (!inside) return { a: Math.min(range.a, s.a), b: Math.max(range.b, s.b) };
  const picked = all.filter((x) => x.a >= range.a && x.b <= range.b);
  if (picked.length <= 1) return null;
  if (s.a === picked[0].a) return { a: picked[1].a, b: range.b };
  if (s.b === picked[picked.length - 1].b) return { a: range.a, b: picked[picked.length - 2].b };
  return range;
}
