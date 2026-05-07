import React, { useEffect, useRef } from "react";
import { X, BarChart3 } from "lucide-react";

// Anchored popover that opens when the user clicks "ask the room →"
// at the bottom of the right sticky. Round 2 contains a single card
// (Open a poll). The "Should I keep watching?" card lands in round 3
// alongside its own composer.

interface Props {
  anchorRect: DOMRect;
  onClose: () => void;
  onSelectPoll: () => void;
}

const POPOVER_WIDTH = 280;
const ARROW_SIZE = 7;
const GAP_FROM_ANCHOR = 14;

export default function AskTheRoomPicker({ anchorRect, onClose, onSelectPoll }: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Sit to the LEFT of the anchor row, vertically centered. Clamp on-screen.
  const popoverTop = Math.max(
    14,
    Math.min(window.innerHeight - 220, anchorRect.top + anchorRect.height / 2 - 80),
  );
  const popoverLeft = Math.max(14, anchorRect.left - POPOVER_WIDTH - GAP_FROM_ANCHOR);
  const arrowTop = Math.max(
    20,
    Math.min(190, anchorRect.top + anchorRect.height / 2 - popoverTop),
  );

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
        top: popoverTop,
        left: popoverLeft,
        width: POPOVER_WIDTH,
        background: "#fff",
        borderRadius: 24,
        border: "0.5px solid rgba(0,0,0,0.12)",
        padding: "16px 18px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 70,
      }}
    >
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
          borderLeft: `${ARROW_SIZE}px solid #fff`,
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500, color: "#042c53" }}>Ask the room</div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: "#888780",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ fontSize: 11, color: "#5f5e5a", marginBottom: 10 }}>
        What kind of question?
      </div>

      <button
        onClick={onSelectPoll}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          textAlign: "left",
          padding: "10px 12px",
          borderRadius: 12,
          border: "0.5px solid rgba(0,0,0,0.12)",
          background: "#fff",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: 6,
            background: "#adc8d7",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <BarChart3 size={16} color="#fff" strokeWidth={1.8} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#042c53", marginBottom: 2 }}>
            Open a poll
          </div>
          <div style={{ fontSize: 11, color: "#5f5e5a", lineHeight: 1.4 }}>
            Ask a question with set answer choices
          </div>
        </div>
        <div style={{ color: "#185fa5", fontSize: 14 }}>→</div>
      </button>
    </div>
  );
}
