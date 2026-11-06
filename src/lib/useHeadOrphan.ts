// useHeadOrphan — a letter's bold head never leaves ONE regular word
// stranded beside it (Alborz 2026-11-05, his screenshot: "…episode! I'll"
// then the rest on the next line). No CSS can say that, so after layout the
// hook looks at the first two words after the head: when the first sits on
// the head's last line and the second has wrapped to the next, the host
// drops the rest onto a line of its own (a <br> after the head). Two or more
// words beside the head stay put.
//
// Measured only with the break absent: a change of text or width, or the
// webfont landing, resets it and measures again — all in layout effects, so
// nothing paints in between.

import { useLayoutEffect, useEffect, useState, type RefObject } from "react";

type Point = { node: Text; offset: number };

/** The first two whitespace-separated words in the text that follows `head`
 *  inside `root`, as [start, end] points (a word may cross text nodes). */
function wordsAfter(head: HTMLElement, root: HTMLElement): [Point, Point][] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const words: [Point, Point][] = [];
  let start: Point | null = null;
  let last: Point | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (head.contains(n)) continue;
    if (!(head.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const t = n.data;
    for (let i = 0; i < t.length; i++) {
      const space = /\s/.test(t[i]);
      if (!space && !start) start = { node: n, offset: i };
      if (space && start && last) { words.push([start, { node: last.node, offset: last.offset + 1 }]); start = null; if (words.length === 2) return words; }
      if (!space) last = { node: n, offset: i };
    }
  }
  if (start && last) words.push([start, { node: last.node, offset: last.offset + 1 }]);
  return words;
}

function rectOf([a, b]: [Point, Point]): DOMRect | null {
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r.getClientRects()[0] ?? null;
}

/** True when the first word after the head would sit alone beside it. */
export function headStrandsOneWord(head: HTMLElement): boolean {
  const root = head.parentElement;
  if (!root) return false;
  const lines = head.getClientRects();
  const headLast = lines[lines.length - 1];
  if (!headLast) return false;
  const words = wordsAfter(head, root);
  if (words.length < 2) return false;
  const w1 = rectOf(words[0]);
  const w2 = rectOf(words[1]);
  if (!w1 || !w2) return false;
  const besideHead = w1.top < headLast.bottom && w1.bottom > headLast.top;
  const secondWrapped = w2.top >= w1.bottom - 1;
  return besideHead && secondWrapped;
}

/** `key` changes whenever the letter's text does. Returns whether to drop
 *  the rest onto its own line. */
export function useHeadOrphan(headRef: RefObject<HTMLElement | null>, key: string, enabled = true): boolean {
  const [drop, setDrop] = useState(false);
  const [pass, setPass] = useState(0);
  // A new text, width or font: measure from scratch (the break comes out first).
  useLayoutEffect(() => { setDrop(false); }, [key, pass, enabled]);
  useLayoutEffect(() => {
    if (!enabled || drop) return;
    const h = headRef.current;
    if (h && headStrandsOneWord(h)) setDrop(true);
  }, [key, pass, enabled, drop, headRef]);
  useEffect(() => {
    const root = headRef.current?.parentElement;
    if (!enabled || !root) return;
    let w = root.clientWidth;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { if (root.clientWidth !== w) { w = root.clientWidth; setPass((p) => p + 1); } }) : null;
    ro?.observe(root);
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) setPass((p) => p + 1); }).catch(() => {});
    return () => { alive = false; ro?.disconnect(); };
  }, [enabled, headRef, key]);
  return enabled && drop;
}
