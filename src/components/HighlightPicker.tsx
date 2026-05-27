import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import CanonRadio from "./CanonRadio";

// Two-radio picker shown after the user selects text and clicks the
// "Highlight…" button. Mirrors NudgePopover / AskTheRoomPicker visually:
// cream card, canon-light-blue radio rows, click-outside + Escape to
// dismiss, anchored below the trigger button.
//
// One of two payload shapes returns via onConfirm:
//   { kind: "yup" }
//   { kind: "note", note: "<1..50 char trimmed string>" }
//
// The parent owns selection capture, server submit, and any error display.
// The picker itself stays simple: pick → OK → onConfirm → parent unmounts.

const CREAM        = "#fef8ea";
const CANON_LIGHT  = "#adc8d7";
const CANON_NAVY   = "#1a3a4a";
const CANON_YELLOW = "#dea838";
const TEXT_MUTED   = "#5f5e5a";

const POPOVER_WIDTH    = 280;
const GAP_FROM_ANCHOR  = 10;
const NOTE_MAX         = 50;

interface Props {
  /** Bounding rect of the Highlight button, used to anchor the popover. */
  anchorRect: DOMRect;
  onClose: () => void;
  onConfirm: (payload: { kind: "yup" } | { kind: "note"; note: string }) => void | Promise<void>;
}

export default function HighlightPicker({ anchorRect, onClose, onConfirm }: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const noteInputRef = useRef<HTMLInputElement | null>(null);

  const [selected, setSelected] = useState<"yup" | "note" | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Position: directly below the anchor, right-edge aligned (matches
  // NudgePopover's "from-anchor" mode). Min 14px from the viewport's
  // right edge so the popover doesn't kiss the screen edge.
  const positionStyle: React.CSSProperties = {
    position: "fixed",
    top:   anchorRect.bottom + GAP_FROM_ANCHOR,
    right: Math.max(14, window.innerWidth - anchorRect.right),
    width: POPOVER_WIDTH,
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

  const handleSelectYup = () => setSelected("yup");
  const handleSelectNote = () => {
    setSelected("note");
    // Defer focus so the input is in the DOM by the time we focus it.
    setTimeout(() => noteInputRef.current?.focus(), 0);
  };
  const handleNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Hard cap at NOTE_MAX even if the browser somehow lets a paste through.
    setNote(e.target.value.slice(0, NOTE_MAX));
  };

  const canSubmit =
    !submitting &&
    (selected === "yup" || (selected === "note" && note.trim().length > 0));

  async function handleOk() {
    if (!canSubmit || !selected) return;
    setSubmitting(true);
    try {
      if (selected === "yup") {
        await onConfirm({ kind: "yup" });
      } else {
        await onConfirm({ kind: "note", note: note.trim() });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      style={{
        ...positionStyle,
        background: CREAM,
        borderRadius: 24,
        padding: "16px 18px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 70,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: CANON_NAVY, fontFamily: '"Lora", Georgia, serif' }}>
          React to this:
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            padding: 6,
            margin: -6,
            color: TEXT_MUTED,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Options */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {/* Yup */}
        <label
          onClick={handleSelectYup}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            borderRadius: 12,
            background: CANON_LIGHT,
            fontSize: 13,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          <CanonRadio checked={selected === "yup"} color={CANON_YELLOW} />
          <span>Yup.</span>
        </label>

        {/* Note */}
        <div style={{ padding: "7px 10px", borderRadius: 12, background: CANON_LIGHT }}>
          <label
            onClick={handleSelectNote}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "#fff",
              marginBottom: selected === "note" ? 6 : 0,
              cursor: "pointer",
            }}
          >
            <CanonRadio checked={selected === "note"} color={CANON_YELLOW} />
            <span>(write a short note)</span>
          </label>
          {selected === "note" && (
            <input
              ref={noteInputRef}
              type="text"
              value={note}
              onChange={handleNoteChange}
              maxLength={NOTE_MAX}
              placeholder="write a short note"
              style={{
                width: "100%",
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 9999,
                border: "none",
                background: "rgba(255,255,255,0.7)",
                height: 26,
                boxSizing: "border-box",
                color: CANON_NAVY,
                outline: "none",
              }}
            />
          )}
        </div>
      </div>

      {/* Footer: ok / Cancel */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={handleOk}
          disabled={!canSubmit}
          style={{
            background: canSubmit ? CANON_YELLOW : "rgba(222,168,56,0.45)",
            color: "#fff",
            border: canSubmit ? `2px solid ${CANON_YELLOW}` : "none",
            padding: "6px 16px",
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 500,
            cursor: canSubmit ? "pointer" : "not-allowed",
            minHeight: 28,
          }}
        >
          {submitting ? "Saving…" : "ok"}
        </button>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            color: TEXT_MUTED,
            border: `2px solid ${TEXT_MUTED}`,
            padding: "6px 12px",
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
