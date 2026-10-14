import React, { useEffect, useRef, useState } from "react";
import { useEditorialScope } from "../lib/skin";
import { E } from "../styles/editorial";
import { NOTE_FIELD, MONO_WORD, INK_SMALL } from "./editorial/MapNotes";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { CANON } from "../styles/canon";

// The note box shown after the user selects text and clicks "Add a note"
// (was a two-radio picker with "Yup." — retired 2026-10-07). Mirrors NudgePopover / AskTheRoomPicker visually:
// cream card, canon-light-blue radio rows, click-outside + Escape to
// dismiss, anchored below the trigger button (above it when the screen
// runs out below — notes arc, 2026-10-07).
//
// One of two payload shapes returns via onConfirm:
//   { kind: "yup" }
//   { kind: "note", note: "<1..1000 char trimmed string>" } — a real note
//   now (was a 50-char line): notes stand in for responses.
//
// The parent owns selection capture, server submit, and any error display.
// The picker itself stays simple: pick → OK → onConfirm → parent unmounts.

const CREAM        = CANON.cream;
const CANON_NAVY   = CANON.dark;
const CANON_YELLOW = CANON.accent;
const TEXT_MUTED   = "#5f5e5a";

const POPOVER_WIDTH    = 280;
const GAP_FROM_ANCHOR  = 10;
const NOTE_MAX         = 1000;

interface Props {
  /** Bounding rect of the Highlight button, used to anchor the popover. */
  anchorRect: DOMRect;
  /** The button the picker hangs from. When given, the picker re-reads its
   *  rect on every scroll (any scroller — the room pages scroll inside a
   *  fixed container, not the window) and resize, so it travels with the
   *  page instead of staying pinned to where it opened. */
  anchorEl?: HTMLElement | null;
  /** The selection's end (2026-10-13): when the box opens from a selection
   *  rather than the button, this re-reads the stretch's last line box on
   *  scroll and resize so the box travels with the words. */
  anchorRectFn?: () => DOMRect | null;
  /** Off when the box opens from a selection: the selection stays lit as the
   *  cue of what the note sits on until the writer clicks into the box. */
  autoFocus?: boolean;
  onClose: () => void;
  onConfirm: (payload: { kind: "yup" } | { kind: "note"; note: string }) => void | Promise<void>;
  /** Color for the radio dot AND the `ok` button — defaults to canon-yellow
   *  (entry-body context). Reply-body context passes canon-light-blue to
   *  visually associate the picker with the reply's light-blue highlight. */
  color?: string;
}

export default function HighlightPicker({ anchorRect, anchorEl, anchorRectFn, autoFocus = true, onClose, onConfirm, color = CANON_YELLOW }: Props) {
  const editorialScope = useEditorialScope();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<DOMRect>(anchorRect);
  useEffect(() => {
    if (!anchorEl && !anchorRectFn) return;
    let raf = 0;
    const follow = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setRect((prev) => anchorEl ? anchorEl.getBoundingClientRect() : (anchorRectFn?.() ?? prev)));
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [anchorEl, anchorRectFn]);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);

  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Position: directly below the anchor, right-edge aligned (matches
  // NudgePopover's "from-anchor" mode). Min 14px from the viewport's
  // right edge so the popover doesn't kiss the screen edge. With the
  // taller note field it flips ABOVE the button when the room below runs
  // out, and scrolls inside as a last resort — never off screen.
  const vh = window.innerHeight;
  const spaceBelow = vh - rect.bottom - GAP_FROM_ANCHOR - 12;
  const flipUp = spaceBelow < 320 && rect.top - GAP_FROM_ANCHOR - 12 > spaceBelow;
  const positionStyle: React.CSSProperties = {
    position: "fixed",
    right: Math.max(14, window.innerWidth - rect.right),
    width: POPOVER_WIDTH,
    ...(flipUp
      ? { bottom: vh - rect.top + GAP_FROM_ANCHOR, maxHeight: rect.top - GAP_FROM_ANCHOR - 12 }
      : { top: rect.bottom + GAP_FROM_ANCHOR, maxHeight: spaceBelow }),
    overflowY: "auto",
  };

  // Click-outside dismissal — defer the listener install by one tick so the
  // opening click itself doesn't immediately close the popover.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    }
    const t = setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [onClose]);

  // Escape dismissal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Straight into writing: focus the box as soon as it opens (from the
  // button; a box opened from a selection waits for the click).
  useEffect(() => { if (autoFocus) setTimeout(() => noteInputRef.current?.focus(), 0); }, [autoFocus]);
  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Hard cap at NOTE_MAX even if the browser somehow lets a paste through.
    setNote(e.target.value.slice(0, NOTE_MAX));
  };

  const canSubmit = !submitting && note.trim().length > 0;

  async function handleOk() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm({ kind: "note", note: note.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  // Portal to document.body so `position: fixed` is relative to the viewport,
  // not whichever ancestor in V2FriendRoomPage / V2RoomFeed creates a
  // stacking context (transform / filter / will-change). Without the portal
  // the picker lands in the wrong spot (observed during C5 testing).
  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      style={{
        ...positionStyle,
        background: CREAM,
        borderRadius: editorialScope ? 0 : 24,
        width: 320,
        boxSizing: "border-box",
        padding: editorialScope ? "16px 18px 18px" : 16,
        boxShadow: editorialScope ? "0 1px 0 rgba(26,58,74,0.35)" : "0 8px 24px rgba(0,0,0,0.18)",
        border: editorialScope ? `1px solid ${E.color.ink}` : undefined,
        zIndex: 70,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={editorialScope ? { ...E.type.letterTitle22, color: E.color.ink } : { fontSize: 14, fontWeight: 700, color: CANON_NAVY, fontFamily: '"Inter", sans-serif' }}>
          Add a note
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            width: 36,
            height: 36,
            padding: 0,
            margin: "-10px -10px 0 0",
            color: TEXT_MUTED,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* The composition box (his 10-07 note: no "Yup." to pick any more —
          Add a note opens straight into writing). */}
      <div style={{ marginBottom: 12 }}>
        <textarea
          ref={noteInputRef}
          value={note}
          onChange={handleNoteChange}
          maxLength={NOTE_MAX}
          rows={5}
          placeholder="Write your note…"
          style={editorialScope ? NOTE_FIELD : {
            width: "100%",
            fontSize: 14,
            lineHeight: 1.5,
            fontFamily: '"Inter", sans-serif',
            padding: "10px 14px",
            borderRadius: 12,
            border: "none",
            background: CREAM,
            boxShadow: "inset 0 0 0 2px rgba(26,58,74,0.15)",
            boxSizing: "border-box",
            color: CANON_NAVY,
            outline: "none",
            resize: "vertical",
          }}
        />
        <div style={{ textAlign: "right", marginTop: 4, fontSize: 11, color: TEXT_MUTED }}>{note.length}/{NOTE_MAX}</div>
      </div>

      {/* Footer: Cancel / Save, bottom-right (his 10-07 note) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexDirection: "row-reverse", justifyContent: "flex-start" }}>
        <button
          onClick={handleOk}
          disabled={!canSubmit}
          style={editorialScope ? { ...INK_SMALL, opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? "pointer" : "not-allowed" } : {
            background: color,
            color: CANON.cream,
            border: `2px solid ${color}`,
            padding: "8px 16px",
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 700,
            minHeight: 36,
            boxSizing: "border-box",
            opacity: canSubmit ? 1 : 0.6,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onClose}
          style={editorialScope ? { ...MONO_WORD, padding: "0 10px", height: 34 } : {
            background: "transparent",
            color: TEXT_MUTED,
            border: `2px solid ${TEXT_MUTED}`,
            padding: "8px 16px",
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 700,
            minHeight: 36,
            boxSizing: "border-box",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}
