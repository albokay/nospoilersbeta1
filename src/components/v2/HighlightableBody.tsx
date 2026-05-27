import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, ThumbsUp } from "lucide-react";
import { linkifyText } from "../../lib/linkify";
import type { Highlight } from "../../lib/db";

// Same regex as src/lib/promptTokens.ts — keep in sync if that ever changes.
const PROMPT_TOKEN_RE = /\[PROMPT:([\s\S]*?)\]/g;

// Canon palette.
const CANON_YELLOW = "#dea838";
const CANON_NAVY   = "#1a3a4a";
const CREAM        = "#fef8ea";

// Default highlight fill — used for entry bodies. Reply bodies pass a
// light-blue override via the `color` prop (canon-light-blue per spec).
const DEFAULT_HIGHLIGHT_COLOR = CANON_YELLOW;

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

/**
 * Render a single plain-text segment with any highlight overlays. The outer
 * span carries `data-body-start` so the selection-to-offset mapping
 * (selectionToBodyOffsets, below) can read it.
 *
 * Per Q7, a highlight is always fully contained in one segment, so a simple
 * "filter to segment range, sort, walk" produces the correct overlay shape.
 */
function HighlightableSegment({
  text,
  bodyStart,
  highlights,
  currentUserId,
  onDeleteHighlight,
  linkify = false,
  color = DEFAULT_HIGHLIGHT_COLOR,
}: {
  text: string;
  bodyStart: number;
  highlights: Highlight[];
  currentUserId: string | null;
  onDeleteHighlight?: (id: string) => void;
  /** When true, plain-text slices are run through linkifyText so URL-shaped
   *  substrings render as <a> auto-links. Used by reply-body rendering;
   *  entry bodies (V2InlineThread) pass linkify={false} matching the
   *  pre-highlight behavior. */
  linkify?: boolean;
  /** Highlight span fill color. Default canon-yellow for entry bodies;
   *  reply bodies pass canon-light-blue. */
  color?: string;
}) {
  const renderText = (s: string): React.ReactNode => (linkify ? linkifyText(s) : s);

  const bodyEnd = bodyStart + text.length;
  const inSegment = highlights
    .filter(h => h.startOffset >= bodyStart && h.endOffset <= bodyEnd)
    .sort((a, b) => a.startOffset - b.startOffset);

  if (inSegment.length === 0) {
    return <span data-body-start={bodyStart}>{renderText(text)}</span>;
  }

  const nodes: React.ReactNode[] = [];
  let cursor = bodyStart;
  let runKey = 0;
  for (const h of inSegment) {
    if (h.startOffset > cursor) {
      const slice = text.slice(cursor - bodyStart, h.startOffset - bodyStart);
      nodes.push(<React.Fragment key={`r-${runKey++}`}>{renderText(slice)}</React.Fragment>);
    }
    const segText = text.slice(h.startOffset - bodyStart, h.endOffset - bodyStart);
    nodes.push(
      <HighlightSpan
        key={h.id}
        highlight={h}
        isOwn={!!currentUserId && h.authorId === currentUserId}
        onDelete={onDeleteHighlight ? () => onDeleteHighlight(h.id) : undefined}
        color={color}
      >
        {renderText(segText)}
      </HighlightSpan>
    );
    cursor = h.endOffset;
  }
  if (cursor < bodyEnd) {
    const slice = text.slice(cursor - bodyStart);
    nodes.push(<React.Fragment key={`r-${runKey++}`}>{renderText(slice)}</React.Fragment>);
  }
  return <span data-body-start={bodyStart}>{nodes}</span>;
}

/**
 * A single highlighted span with hover tooltip. Custom tooltip (not the
 * shared `Tooltip` component) because the bubble needs `pointer-events:
 * auto` for the owner's × delete button — the shared Tooltip pins
 * pointer-events: none.
 */
function HighlightSpan({
  highlight,
  children,
  isOwn,
  onDelete,
  color = DEFAULT_HIGHLIGHT_COLOR,
}: {
  highlight: Highlight;
  children: React.ReactNode;
  isOwn: boolean;
  onDelete?: () => void;
  color?: string;
}) {
  const [hovered, setHovered] = useState(false);
  // Cursor position captured on mouseenter — the tooltip anchors here so
  // it always lands near the cursor, regardless of where the highlighted
  // span's bounding-box center happens to be (relevant when a highlight
  // wraps across multiple lines).
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Grace period so the cursor can travel from the highlighted span into
  // the (portaled) tooltip without it closing en route. 500ms is generous
  // enough that the cursor can land on the × delete button without the
  // tooltip vanishing mid-trip.
  const enterSpan = (e: React.MouseEvent) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setAnchor({ x: e.clientX, y: e.clientY });
    setHovered(true);
  };
  const enterTooltip = () => {
    // Don't reposition when the cursor enters the tooltip itself — just
    // cancel the pending close so the bubble stays open.
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const leave = () => {
    closeTimer.current = setTimeout(() => setHovered(false), 500);
  };

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setHovered(false);
    onDelete?.();
  };

  return (
    <span
      onMouseEnter={enterSpan}
      onMouseLeave={leave}
      style={{ background: color, padding: "2px 2px", borderRadius: 3 }}
    >
      {children}
      {hovered && anchor && createPortal(
        <span
          onMouseEnter={enterTooltip}
          onMouseLeave={leave}
          style={{
            position: "fixed",
            top:  anchor.y - 16,
            left: anchor.x,
            // Center horizontally on cursor, lift fully above cursor, then
            // tilt 6° clockwise. transformOrigin pins the rotation to the
            // bottom-center so the bubble appears to lean, not pivot.
            transform: "translate(-50%, -100%) rotate(6deg)",
            transformOrigin: "bottom center",
            background: CREAM,
            color: CANON_NAVY,
            borderRadius: 12,
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: "nowrap",
            boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            zIndex: 9999,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            pointerEvents: "auto",
          }}
        >
          <span>@{highlight.authorUsername}:</span>
          {highlight.kind === "yup" ? (
            <ThumbsUp size={12} color={CANON_NAVY} strokeWidth={2} />
          ) : (
            <span>{highlight.note}</span>
          )}
          {isOwn && onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Remove highlight"
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                marginLeft: 4,
                color: CANON_NAVY,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <X size={12} />
            </button>
          )}
        </span>,
        document.body,
      )}
    </span>
  );
}

/**
 * Top-level renderer for an entry body. Handles PROMPT tokens (rendered as
 * non-highlightable `prompt-ref` blockquotes) and plain-text segments
 * (highlightable, with overlays per-highlight).
 *
 * Drop-in replacement for `parsePromptTokens(body).map(...)` in V2InlineThread
 * (entry body). Reply bodies have a separate token type ([QUOTE: ...]); they
 * use a different renderer wired in C6.
 */
export default function HighlightableBody({
  body,
  highlights,
  currentUserId,
  onDeleteHighlight,
  bodyStart = 0,
  linkify = false,
  color = DEFAULT_HIGHLIGHT_COLOR,
}: {
  body: string;
  highlights: Highlight[];
  currentUserId: string | null;
  onDeleteHighlight?: (id: string) => void;
  /** Raw-body offset where THIS slice starts in the source body string.
   *  Default 0 — set when this renders only a sub-slice (e.g. the "before"
   *  or "after" segment of a reply body that's been split around a QUOTE
   *  token). */
  bodyStart?: number;
  /** Forwarded to HighlightableSegment. When true, plain-text slices are
   *  auto-linked via linkifyText. Used by reply bodies (which previously
   *  ran linkify via annotateTextWithSups + linkifyNodes). */
  linkify?: boolean;
  /** Highlight fill color. Default canon-yellow (entries). Reply bodies
   *  pass canon-light-blue (`#adc8d7`) to distinguish reaction context. */
  color?: string;
}) {
  const tokens = tokenizeBody(body, bodyStart);
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
        return (
          <HighlightableSegment
            key={`seg-${tok.bodyStart}`}
            text={tok.text}
            bodyStart={tok.bodyStart}
            highlights={highlights}
            currentUserId={currentUserId}
            onDeleteHighlight={onDeleteHighlight}
            linkify={linkify}
            color={color}
          />
        );
      })}
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
