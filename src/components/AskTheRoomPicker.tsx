import React, { useEffect, useRef } from "react";
import { X, MessageCircleQuestionMark, ChartBar, ArrowRight } from "lucide-react";

// Anchored popover that opens when the user clicks "ask the room →"
// at the bottom of the right sticky. Two cards: poll composer +
// SIKW composer.

// Canon palette
const CREAM        = "#fef8ea";
const CANON_LIGHT  = "#adc8d7";
const CANON_NAVY   = "#1a3a4a";
const TEXT_MUTED   = "#5f5e5a";

interface Props {
  anchorRect: DOMRect;
  onClose: () => void;
  onSelectPoll: () => void;
  onSelectSikw: () => void;
  /** "from-page-bottom" (default, v1 FriendProgressPostIt) bottom-anchors
   *  at 96px from viewport bottom. "from-anchor" (V2 friend room map)
   *  places below the anchor, right-edge-aligned to the anchor. */
  anchorMode?: "from-page-bottom" | "from-anchor";
}

const POPOVER_WIDTH = 280;
const GAP_FROM_ANCHOR = 14;
const POPOVER_BOTTOM_PX = 96; // matches FriendProgressPostIt bottom — anchors popup bottom to the sticky

export default function AskTheRoomPicker({
  anchorRect,
  onClose,
  onSelectPoll,
  onSelectSikw,
  anchorMode = "from-page-bottom",
}: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // See NudgePopover for the two positioning modes.
  const positionStyle: React.CSSProperties =
    anchorMode === "from-anchor"
      ? {
          position: "fixed",
          top: anchorRect.bottom + GAP_FROM_ANCHOR,
          right: Math.max(14, window.innerWidth - anchorRect.right),
          width: POPOVER_WIDTH,
        }
      : {
          position: "fixed",
          bottom: POPOVER_BOTTOM_PX,
          left: Math.max(14, anchorRect.left - POPOVER_WIDTH - GAP_FROM_ANCHOR),
          width: POPOVER_WIDTH,
        };

  // Click-outside dismissal
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

  // Escape key dismissal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: CANON_NAVY,
            fontFamily: '"Lora", Georgia, serif',
          }}
        >
          Ask the room a question:
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

      <button onClick={onSelectPoll} style={cardButtonStyle}>
        <ChartBar size={20} color="#fff" strokeWidth={1.8} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#fff" }}>
          Start a poll
        </div>
        <ArrowRight size={14} color="#fff" />
      </button>

      <button onClick={onSelectSikw} style={{ ...cardButtonStyle, marginTop: 8 }}>
        <MessageCircleQuestionMark size={20} color="#fff" strokeWidth={1.8} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#fff" }}>
          Should I keep watching?
        </div>
        <ArrowRight size={14} color="#fff" />
      </button>
    </div>
  );
}

const cardButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: 12,
  border: "none",
  background: CANON_LIGHT,
  cursor: "pointer",
};
