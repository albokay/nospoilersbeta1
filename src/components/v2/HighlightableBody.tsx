import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HighlightHoverPopup, HighlightNotePaper } from "./HighlightNotePaper";
import { HighlightNoteSheet } from "./HighlightSheets";
import { splitSentences, type Range } from "../../lib/sentences";
import { linkifyText } from "../../lib/linkify";
import type { Highlight } from "../../lib/db";
import { CANON } from "../../styles/canon";

// Same regex as src/lib/promptTokens.ts — keep in sync if that ever changes.
const PROMPT_TOKEN_RE = /\[PROMPT:([\s\S]*?)\]/g;

// One fill everywhere (Alborz 2026-10-07): yellow on letters AND on
// responses — Friend blue now means SEALED: a stretch whose notes you can't
// read yet. The hovered or open stretch turns cream (his 10-07 note).
const DEFAULT_HIGHLIGHT_COLOR = CANON.accent;
const SEALED_COLOR = CANON.friend;

/** A shade darker (multiply by 0.86) for the hovered / open stretch. */
export function darken(hex: string, f = 0.86): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const c = [0, 2, 4].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(m.slice(i, i + 2), 16) * f))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Internal tokenization shape. `text` segments carry the rendered text plus
// the raw-body offset where that rendered text starts (after any whitespace
// trim). `prompt` tokens render as non-highlightable blockquotes and don't
// participate in offset tracking — Q7 guarantees highlights never span them.
type BodyToken =
  | { kind: "text"; text: string; bodyStart: number }
  | { kind: "prompt"; text: string };

/**
 * Tokenize a raw body string into ordered render-ready pieces. Mirrors the
 * trim behavior of `parsePromptTokens` (trailing whitespace stripped before
 * each prompt; leading whitespace stripped on the final segment) so the
 * rendered output matches the legacy renderer pixel-for-pixel — while
 * preserving each segment's raw-body offset for highlight mapping.
 *
 * Returns segments with `text === ""` skipped (an all-whitespace segment
 * between two prompts contributes nothing visible).
 */
function tokenizeBody(body: string, bodyStartOffset: number = 0): BodyToken[] {
  const out: BodyToken[] = [];
  const re = new RegExp(PROMPT_TOKEN_RE.source, "g");
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > cursor) {
      const raw = body.slice(cursor, m.index);
      const trimmed = raw.replace(/\s+$/, "");
      if (trimmed.length > 0) {
        out.push({ kind: "text", text: trimmed, bodyStart: cursor + bodyStartOffset });
      }
    }
    out.push({ kind: "prompt", text: m[1].trim() });
    cursor = m.index + m[0].length;
  }
  if (cursor < body.length) {
    const raw = body.slice(cursor);
    const leading = raw.match(/^\s+/);
    const leadingLen = leading ? leading[0].length : 0;
    const trimmed = raw.slice(leadingLen);
    if (trimmed.length > 0) {
      out.push({ kind: "text", text: trimmed, bodyStart: cursor + leadingLen + bodyStartOffset });
    }
  }
  return out;
}

/** The stretch under the cursor (or the open one): the piece's range in
 *  raw-body offsets plus its element, for anchoring. */
type Active = { a: number; b: number; el: HTMLElement };

/** One run of text with the highlights that cover ALL of it. Highlights may
 *  overlap now (notes stack on a stretch, 2026-10-07), so a segment is cut
 *  at every highlight boundary and each piece carries its covering set. */
type Piece = { a: number; b: number; covering: Highlight[] };

function piecesFor(bodyStart: number, bodyEnd: number, highlights: Highlight[]): Piece[] | null {
  const inSeg = highlights.filter((h) => h.startOffset < bodyEnd && h.endOffset > bodyStart);
  if (inSeg.length === 0) return null;
  const cuts = new Set<number>([bodyStart, bodyEnd]);
  for (const h of inSeg) {
    cuts.add(Math.max(bodyStart, Math.min(bodyEnd, h.startOffset)));
    cuts.add(Math.max(bodyStart, Math.min(bodyEnd, h.endOffset)));
  }
  const xs = Array.from(cuts).sort((p, q) => p - q);
  const out: Piece[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b <= a) continue;
    out.push({ a, b, covering: inSeg.filter((h) => h.startOffset <= a && h.endOffset >= b) });
  }
  return out;
}

const covering = (highlights: Highlight[], r: { a: number; b: number }) =>
  highlights.filter((h) => h.startOffset <= r.a && h.endOffset >= r.b);

/**
 * Render a single plain-text segment with its highlight pieces. The outer
 * span carries `data-body-start` so the selection-to-offset mapping
 * (selectionToBodyOffsets, below) can read it.
 */
function HighlightableSegment({
  text,
  bodyStart,
  highlights,
  activeIds,
  linkify = false,
  color = DEFAULT_HIGHLIGHT_COLOR,
  onEnter,
  onLeave,
  onPick,
}: {
  text: string;
  bodyStart: number;
  highlights: Highlight[];
  /** Ids of the highlights covering the hovered / open piece — every piece
   *  sharing one of them darkens (the whole stretch, overlaps included). */
  activeIds: Set<string> | null;
  linkify?: boolean;
  color?: string;
  onEnter: (active: Active) => void;
  onLeave: () => void;
  onPick: (active: Active, hasReadableNote: boolean) => void;
}) {
  const renderText = (s: string): React.ReactNode => (linkify ? linkifyText(s) : s);
  const bodyEnd = bodyStart + text.length;
  const pieces = piecesFor(bodyStart, bodyEnd, highlights);
  if (!pieces) return <span data-body-start={bodyStart}>{renderText(text)}</span>;
  return (
    <span data-body-start={bodyStart}>
      {pieces.map((p) => {
        const slice = text.slice(p.a - bodyStart, p.b - bodyStart);
        if (p.covering.length === 0) return <React.Fragment key={`t-${p.a}`}>{renderText(slice)}</React.Fragment>;
        const readable = p.covering.some((h) => !h.sealed);
        const hasReadableNote = p.covering.some((h) => h.kind === "note");
        const active = !!activeIds && p.covering.some((h) => activeIds.has(h.id));
        const base = readable ? color : SEALED_COLOR;
        return (
          <span
            key={`h-${p.a}`}
            onMouseEnter={(e) => onEnter({ a: p.a, b: p.b, el: e.currentTarget })}
            onMouseLeave={onLeave}
            onClick={(e) => onPick({ a: p.a, b: p.b, el: e.currentTarget }, hasReadableNote)}
            style={{ background: active ? CANON.cream : base, padding: "2px 0", borderRadius: 3, cursor: hasReadableNote ? "pointer" : "default", transition: "background 120ms ease" }}
          >
            {renderText(slice)}
          </span>
        );
      })}
    </span>
  );
}

/** Pick mode (the phone, notes arc 2026-10-07): the run is drawn sentence
 *  by sentence; a tap toggles a sentence into one continuous pick. Existing
 *  highlights aren't drawn while picking — a note on an existing stretch is
 *  added from its sheet instead. */
const PICK_FILL = "rgba(222,168,56,0.45)";
function PickSegment({ text, bodyStart, range, all, onToggle }: {
  text: string;
  bodyStart: number;
  range: Range | null;
  all: Range[];
  onToggle: (s: Range, all: Range[]) => void;
}) {
  const sentences = splitSentences(text, bodyStart);
  const nodes: React.ReactNode[] = [];
  let cursor = bodyStart;
  for (const sn of sentences) {
    if (sn.a > cursor) nodes.push(<React.Fragment key={`g-${cursor}`}>{text.slice(cursor - bodyStart, sn.a - bodyStart)}</React.Fragment>);
    const picked = !!range && sn.a >= range.a && sn.b <= range.b;
    nodes.push(
      <span
        key={`s-${sn.a}`}
        role="button"
        tabIndex={0}
        aria-pressed={picked}
        onClick={(e) => { e.stopPropagation(); onToggle(sn, all); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(sn, all); } }}
        style={{ background: picked ? PICK_FILL : "transparent", padding: "2px 0", borderRadius: 3, cursor: "pointer", boxShadow: picked ? `0 0 0 1px ${CANON.accent}` : "none", transition: "background 120ms ease" }}
      >
        {text.slice(sn.a - bodyStart, sn.b - bodyStart)}
      </span>,
    );
    cursor = sn.b;
  }
  if (cursor < bodyStart + text.length) nodes.push(<React.Fragment key={`g-${cursor}`}>{text.slice(cursor - bodyStart)}</React.Fragment>);
  return <span data-body-start={bodyStart}>{nodes}</span>;
}

/**
 * Top-level renderer for an entry body. Handles PROMPT tokens (rendered as
 * non-highlightable `prompt-ref` blockquotes) and plain-text segments
 * (highlightable, with overlays per-highlight). Owns the rollover popup and
 * the open note paper for the whole body, so a stretch that crosses two
 * segments still reads as one.
 *
 * Drop-in replacement for `parsePromptTokens(body).map(...)` in V2InlineThread
 * (entry body). Reply bodies have a separate token type ([QUOTE: ...]); they
 * render their slices through this same component.
 */
export default function HighlightableBody({
  body,
  highlights,
  currentUserId,
  onDeleteHighlight,
  onAddNote,
  bodyStart = 0,
  linkify = false,
  color = DEFAULT_HIGHLIGHT_COLOR,
  displayNames,
  mobile = false,
  pick,
}: {
  body: string;
  highlights: Highlight[];
  currentUserId: string | null;
  onDeleteHighlight?: (id: string) => void;
  /** The phone (notes arc, 2026-10-07): no rollover popup; a tap on a
   *  stretch opens the notes SHEET instead of the paper. */
  mobile?: boolean;
  /** Pick mode (the phone): sentences become tappable and build one
   *  continuous pick; `range` is the current pick in raw-body offsets. */
  pick?: { range: Range | null; onToggle: (s: Range, all: Range[]) => void };
  /** "Add note" on the open paper: writes another note onto the same
   *  stretch as `base`. Omit on surfaces that can't write. */
  onAddNote?: (base: Highlight, note: string) => Promise<void>;
  /** Raw-body offset where THIS slice starts in the source body string.
   *  Default 0 — set when this renders only a sub-slice (e.g. the "before"
   *  or "after" segment of a reply body that's been split around a QUOTE
   *  token). */
  bodyStart?: number;
  /** When true, plain-text slices are auto-linked via linkifyText. Used by
   *  reply bodies. */
  linkify?: boolean;
  /** Highlight fill. Default canon-yellow — the one fill for letters and
   *  responses alike (2026-10-07). */
  color?: string;
  /** Naming arc (2026-07-07): username → the viewer's given name (popup and
   *  paper attribution only). */
  displayNames?: Record<string, string>;
}) {
  const tokens = tokenizeBody(body, bodyStart);
  const allSentences = pick ? tokens.flatMap((t) => (t.kind === "text" ? splitSentences(t.text, t.bodyStart) : [])) : [];
  const [hover, setHover] = useState<Active | null>(null);
  const [open, setOpen] = useState<Active | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  // Grace period so the cursor can travel from the stretch into the popup.
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 500); };
  useEffect(() => () => cancelClose(), []);

  // Tap-anywhere-else closes the popup (on touch a tap fires mouseenter but
  // mouseleave never reliably follows).
  useEffect(() => {
    if (!hover) return;
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (hover.el.contains(t)) return;
      if ((t as HTMLElement).closest?.("[data-hl-popup]")) return;
      cancelClose();
      setHover(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [hover]);

  // The open / hovered stretch, re-derived from the CURRENT highlights so a
  // note added or removed while the paper is open shows up at once.
  const openSet = open ? covering(highlights, open) : [];
  // Every note on the stretch, sealed ones included: each is its own page.
  const openNotes = openSet.filter((h) => h.kind === "note").sort((x, y) => x.createdAt - y.createdAt);
  const openSealed = openSet.filter((h) => h.sealed);
  const hoverSet = hover ? covering(highlights, hover) : [];
  const activeIds = open ? new Set(openSet.map((h) => h.id)) : hover ? new Set(hoverSet.map((h) => h.id)) : null;

  // Nothing left to read (last note deleted): the paper closes itself; on
  // the phone the sheet stays until the stretch itself is gone.
  useEffect(() => {
    if (!open) return;
    if (mobile ? openSet.length === 0 : openNotes.length === 0) setOpen(null);
  }, [open, mobile, openSet.length, openNotes.length]);

  const onEnter = (a: Active) => { if (mobile) return; cancelClose(); if (!open) setHover(a); };
  const onLeave = () => { if (!mobile) scheduleClose(); };
  const onPick = (a: Active, hasReadableNote: boolean) => {
    if (mobile) { setHover(null); setOpen(a); return; }
    if (hasReadableNote) { cancelClose(); setHover(null); setOpen(a); return; }
    // Yups and sealed notes only: a click shows the popup.
    if (!hover) { cancelClose(); setHover(a); }
  };

  const baseForAdd = openNotes[openNotes.length - 1] ?? openSet[0];
  void openSealed;

  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.kind === "prompt") {
          return (
            <blockquote key={`prompt-${i}`} className="prompt-ref">
              {tok.text}
            </blockquote>
          );
        }
        if (pick) {
          return (
            <PickSegment
              key={`pick-${tok.bodyStart}`}
              text={tok.text}
              bodyStart={tok.bodyStart}
              range={pick.range}
              all={allSentences}
              onToggle={pick.onToggle}
            />
          );
        }
        return (
          <HighlightableSegment
            key={`seg-${tok.bodyStart}`}
            text={tok.text}
            bodyStart={tok.bodyStart}
            highlights={highlights}
            activeIds={activeIds}
            linkify={linkify}
            color={color}
            onEnter={onEnter}
            onLeave={onLeave}
            onPick={onPick}
          />
        );
      })}
      {!mobile && hover && !open && hoverSet.length > 0 && createPortal(
        <HighlightHoverPopup
          anchorEl={hover.el}
          readable={hoverSet.filter((h) => !h.sealed)}
          sealed={hoverSet.filter((h) => h.sealed)}
          currentUserId={currentUserId}
          displayNames={displayNames}
          onDelete={onDeleteHighlight ? (id) => { onDeleteHighlight(id); setHover(null); } : undefined}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />,
        document.body,
      )}
      {mobile && open && openSet.length > 0 && createPortal(
        <HighlightNoteSheet
          quoted={openSet[0].quotedText}
          readable={openSet.filter((h) => !h.sealed)}
          sealed={openSealed}
          currentUserId={currentUserId}
          displayNames={displayNames}
          onClose={() => setOpen(null)}
          onDelete={onDeleteHighlight}
          onAddNote={onAddNote && baseForAdd ? (note) => onAddNote(baseForAdd, note) : undefined}
        />,
        document.body,
      )}
      {!mobile && open && openNotes.length > 0 && createPortal(
        <HighlightNotePaper
          anchorEl={open.el}
          notes={openNotes}
          currentUserId={currentUserId}
          displayNames={displayNames}
          onClose={() => setOpen(null)}
          onDelete={onDeleteHighlight}
          onAddNote={onAddNote && baseForAdd ? (note) => onAddNote(baseForAdd, note) : undefined}
        />,
        document.body,
      )}
    </>
  );
}

/**
 * Read window.getSelection() and translate it into a {start, end, text} tuple
 * in the raw-body coordinate system. Returns null when the selection is not
 * usable for highlighting:
 *   - no active selection / selection collapsed
 *   - selection crosses out of a `[data-body-start]` segment (e.g. into a
 *     prompt-ref or quote blockquote)
 *   - selection spans multiple segments
 *   - (when `scopeEl` is provided) selection endpoints aren't inside scopeEl
 *
 * The `scopeEl` argument is critical for the per-reply Highlight button case:
 * without it, a selection inside reply X plus a click on reply Y's Highlight
 * button would attach Y's highlight to X's text offsets (the bug class).
 *
 * Must be called synchronously from the same event tick as the user's click
 * — once focus shifts into the picker, the selection is gone.
 */
export function selectionToBodyOffsets(scopeEl?: HTMLElement | null):
  | { start: number; end: number; text: string }
  | null
{
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;

  // Scope check: if the caller supplied a DOM element, both endpoints of
  // the selection must be inside it. Without this, a Highlight button on
  // one card can pick up a selection from a different card.
  if (scopeEl) {
    if (!scopeEl.contains(range.startContainer) || !scopeEl.contains(range.endContainer)) {
      return null;
    }
  }

  const findSeg = (node: Node | null): HTMLElement | null => {
    let cur: Node | null = node;
    while (cur && cur !== document.body) {
      if (cur.nodeType === 1 && (cur as HTMLElement).hasAttribute("data-body-start")) {
        return cur as HTMLElement;
      }
      cur = cur.parentNode;
    }
    return null;
  };

  const startSeg = findSeg(range.startContainer);
  const endSeg = findSeg(range.endContainer);
  if (!startSeg || !endSeg) return null;
  if (startSeg !== endSeg) return null;

  const segStart = parseInt(startSeg.getAttribute("data-body-start") ?? "", 10);
  if (Number.isNaN(segStart)) return null;

  // Compute the local offset (within the segment's textContent) of a given
  // range endpoint. Walks the segment subtree in document order, summing
  // textContent lengths until we reach the endpoint's container, then adds
  // the in-node offset.
  const localOffsetOf = (container: Node, offsetInContainer: number): number => {
    if (container === startSeg) {
      let total = 0;
      for (let i = 0; i < offsetInContainer; i++) {
        total += startSeg.childNodes[i]?.textContent?.length ?? 0;
      }
      return total;
    }
    let total = 0;
    let done = false;
    const walk = (node: Node) => {
      if (done) return;
      if (node === container) {
        if (node.nodeType === 3) {
          total += offsetInContainer;
        } else {
          for (let i = 0; i < offsetInContainer; i++) {
            total += (node as Element).childNodes[i]?.textContent?.length ?? 0;
          }
        }
        done = true;
        return;
      }
      if (node.nodeType === 3) {
        total += node.textContent?.length ?? 0;
        return;
      }
      const el = node as Element;
      for (let i = 0; i < el.childNodes.length; i++) {
        walk(el.childNodes[i]);
        if (done) return;
      }
    };
    walk(startSeg);
    return total;
  };

  const startLocal = localOffsetOf(range.startContainer, range.startOffset);
  const endLocal = localOffsetOf(range.endContainer, range.endOffset);
  if (endLocal <= startLocal) return null;

  const text = sel.toString();
  if (!text.length) return null;

  return {
    start: segStart + startLocal,
    end:   segStart + endLocal,
    text,
  };
}
