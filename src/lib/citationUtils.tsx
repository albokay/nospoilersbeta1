import React from "react";

export function superscriptNum(n: number): string {
  const supers = ["¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
  return supers[n - 1] ?? `(${n})`;
}

/** A pending inline citation superscript to be placed next to quoted text. */
export type SupEntry = { citedText: string; index: number; onScrollTo: () => void };

/**
 * Nudge a match end-position so the sup lands after trailing punctuation
 * or at the end of a partially-matched word.
 */
export function adjustEndForSup(text: string, endPos: number): number {
  if (endPos >= text.length) return endPos;
  while (endPos < text.length && /\w/.test(text[endPos])) endPos++;
  while (endPos < text.length && /[.,!?;:'"'"…\-)\]]/.test(text[endPos])) endPos++;
  return endPos;
}

/** Strip Unicode superscript digit characters that may have been captured in a text selection. */
export function stripSupChars(text: string): string {
  return text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, "");
}

/**
 * Annotate a plain-text string with inline citation superscripts.
 * Returns annotated nodes and the set of sup indices that were matched.
 */
export function annotateTextWithSups(
  text: string,
  sups: SupEntry[]
): { nodes: React.ReactNode[]; matchedIndices: Set<number> } {
  type Marker = { pos: number; endPos: number; index: number; onScrollTo: () => void };
  const markers: Marker[] = [];
  for (const s of sups) {
    const t = (s.citedText ?? "").replace(/…$/, "").trim();
    if (t.length < 4) continue;
    const idx = text.indexOf(t);
    if (idx !== -1) {
      const rawEnd = idx + t.length;
      const adjustedEnd = adjustEndForSup(text, rawEnd);
      markers.push({ pos: idx, endPos: adjustedEnd, index: s.index, onScrollTo: s.onScrollTo });
    }
  }
  const matchedIndices = new Set(markers.map(m => m.index));
  if (!markers.length) return { nodes: [text], matchedIndices };
  markers.sort((a, b) => a.endPos - b.endPos);
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const m of markers) {
    if (m.endPos <= last) continue;
    const pos = Math.max(m.pos, last);
    if (pos > last) nodes.push(text.slice(last, pos));
    nodes.push(
      <span
        key={`qt-${m.index}`}
        className="quoted-passage"
        onClick={m.onScrollTo}
        title="Jump to citing response"
      >
        {text.slice(pos, m.endPos)}
      </span>
    );
    nodes.push(
      <sup key={`sup-${m.index}`} className="cite-sup">
        <button className="cite-sup-btn" onClick={m.onScrollTo} title="Jump to citing response">
          {superscriptNum(m.index)}
        </button>
      </sup>
    );
    last = m.endPos;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return { nodes, matchedIndices };
}

/** Fallback sups for quotes whose text couldn't be matched in the body. */
export function UnmatchedSups({ sups }: { sups: Array<{ index: number; onScrollTo: () => void }> }) {
  if (!sups.length) return null;
  return (
    <span style={{ letterSpacing: 0 }}>
      {sups.map((s, i) => (
        <React.Fragment key={`usup-${s.index}`}>
          {i > 0 && <sup className="cite-sup"><span className="cite-sup-btn" style={{ cursor: "default" }}>,</span></sup>}
          <sup className="cite-sup">
            <button className="cite-sup-btn" onClick={s.onScrollTo} title="Jump to citing response">
              {superscriptNum(s.index)}
            </button>
          </sup>
        </React.Fragment>
      ))}
    </span>
  );
}
