import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, BarChart3, HelpCircle, ArrowRight } from "lucide-react";

// Anchored popover that opens when the user clicks "ask the room →"
// at the bottom of the right sticky. Two cards: poll composer +
// SIKW composer.

// Canon palette
const CREAM        = "#fef8ea";
const CANON_BLUE   = "#355eb8";
const CANON_LIGHT  = "#adc8d7";
const CANON_NAVY   = "#1a3a4a";
const TEXT_MUTED   = "#5f5e5a";

interface Props {
  anchorRect: DOMRect;
  onClose: () => void;
  onSelectPoll: () => void;
  onSelectSikw: () => void;
}

const POPOVER_WIDTH = 280;
const ARROW_SIZE = 7;
const GAP_FROM_ANCHOR = 14;
const POPOVER_BOTTOM_PX = 96; // matches FriendProgressPostIt bottom — anchors popup bottom to the sticky

export default function AskTheRoomPicker({ anchorRect, onClose, onSelectPoll, onSelectSikw }: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverHeight, setPopoverHeight] = useState<number | null>(null);

  // Sit to the LEFT of the anchor row, bottom-anchored to align with the
  // FriendProgressPostIt sticky (so the popup bottom always sits in frame).
  const popoverLeft = Math.max(14, anchorRect.left - POPOVER_WIDTH - GAP_FROM_ANCHOR);
  const popoverTopComputed =
    popoverHeight != null
      ? window.innerHeight - popoverHeight - POPOVER_BOTTOM_PX
      : null;
  const arrowTop =
    popoverHeight != null && popoverTopComputed != null
      ? Math.max(
          14,
          Math.min(
            popoverHeight - 14 - ARROW_SIZE,
            anchorRect.top + anchorRect.height / 2 - popoverTopComputed,
          ),
        )
      : null;

  useLayoutEffect(() => {
    if (popoverRef.current) {
      setPopoverHeight(popoverRef.current.offsetHeight);
    }
  }, []);

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
        position: "fixed",
        bottom: POPOVER_BOTTOM_PX,
        left: popoverLeft,
        width: POPOVER_WIDTH,
        background: CREAM,
        borderRadius: 24,
        padding: "16px 18px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 70,
      }}
    >
      {arrowTop != null && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: -ARROW_SIZE,
            top: arrowTop,
            width: 0,
            height: 0,
            borderTop: `${ARROW_SIZE}px solid transparent`,
            borderBottom: `${ARROW_SIZE}px solid transparent`,
            borderLeft: `${ARROW_SIZE}px solid ${CREAM}`,
          }}
        />
      )}

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
          Ask the room
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: TEXT_MUTED,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 10 }}>
        What kind of question?
      </div>

      <button onClick={onSelectPoll} style={cardButtonStyle}>
        <div style={iconChipStyle}>
          <BarChart3 size={16} color="#fff" strokeWidth={1.8} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: CANON_NAVY, marginBottom: 2 }}>
            Open a poll
          </div>
          <div style={{ fontSize: 11, color: TEXT_MUTED, lineHeight: 1.4 }}>
            Ask a question with set answer choices
          </div>
        </div>
        <ArrowRight size={14} color={CANON_BLUE} />
      </button>

      <button onClick={onSelectSikw} style={{ ...cardButtonStyle, marginTop: 8 }}>
        <div style={{ ...iconChipStyle, position: "relative" }}>
          {/* Two help-circle glyphs side by side, second slightly faded */}
          <HelpCircle
            size={13}
            color="#fff"
            strokeWidth={1.8}
            style={{ position: "absolute", left: 4, top: 8 }}
          />
          <HelpCircle
            size={13}
            color="#fff"
            strokeWidth={1.8}
            style={{ position: "absolute", right: 4, top: 8, opacity: 0.7 }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: CANON_NAVY, marginBottom: 2 }}>
            Should I keep watching?
          </div>
          <div style={{ fontSize: 11, color: TEXT_MUTED, lineHeight: 1.4 }}>
            Ask the room whether to stick with it
          </div>
        </div>
        <ArrowRight size={14} color={CANON_BLUE} />
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
  border: `2px solid ${CANON_LIGHT}`,
  background: "#fff",
  cursor: "pointer",
};

const iconChipStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 30,
  height: 30,
  borderRadius: 6,
  background: CANON_LIGHT,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
