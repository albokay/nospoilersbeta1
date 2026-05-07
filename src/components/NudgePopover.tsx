import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

// ── Direction maps to which picker the popover renders ────────────────────
// Sender-relative: "ahead" means the sender is ahead of the recipient
// (recipient is behind). For round 1 / chunk B, this is the wireframe —
// the popover opens, anchors, and dismisses cleanly. The picker bodies
// land in chunk C.

export type NudgeDirection = "ahead" | "same" | "behind" | "not-started";

interface Props {
  recipientUsername: string;
  recipientId: string;
  groupId: string;
  direction: NudgeDirection;
  /** Episodes ahead/behind, when computable. null when seasons[] is incomplete. */
  count: number | null;
  /** Bounding rect of the row that was clicked, used to anchor the popover. */
  anchorRect: DOMRect;
  onClose: () => void;
}

const POPOVER_WIDTH = 300;
const ARROW_SIZE = 7;
const GAP_FROM_ANCHOR = 14;

function relativePositionLabel(direction: NudgeDirection, count: number | null): string {
  if (direction === "same") return "caught up with you";
  if (direction === "not-started") return "hasn't started watching";
  const word = direction === "ahead" ? "ahead" : "behind";
  if (count == null) return word;
  return `${count} episode${count === 1 ? "" : "s"} ${word}`;
}

export default function NudgePopover({
  recipientUsername,
  direction,
  count,
  anchorRect,
  onClose,
}: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Position: sit to the LEFT of the anchor row (the post-it lives on the
  // right of the screen), vertically centered on the row. Clamp to keep
  // the popover on-screen.
  const popoverTop = Math.max(
    14,
    Math.min(
      window.innerHeight - 200,
      anchorRect.top + anchorRect.height / 2 - 60,
    ),
  );
  const popoverLeft = Math.max(
    14,
    anchorRect.left - POPOVER_WIDTH - GAP_FROM_ANCHOR,
  );

  // Click-outside dismissal
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    }
    // Defer one tick so the click that opened us doesn't immediately close us
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

  // Arrow vertical position (relative to popover top)
  const arrowTop = Math.max(
    20,
    Math.min(
      170,
      anchorRect.top + anchorRect.height / 2 - popoverTop,
    ),
  );

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
        borderRadius: 10,
        border: "0.5px solid rgba(0,0,0,0.12)",
        padding: "14px 14px 12px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 70,
      }}
    >
      {/* Arrow pointing right (toward the anchor row) */}
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

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#042c53" }}>
            @{recipientUsername}
          </div>
          <div style={{ fontSize: 11, color: "#5f5e5a", marginTop: 1 }}>
            {relativePositionLabel(direction, count)}
          </div>
        </div>
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

      {/* Body — picker lands in chunk C */}
      <div style={{ marginTop: 12, fontSize: 11, color: "#888780", fontStyle: "italic" }}>
        Picker coming in next chunk.
      </div>
    </div>
  );
}
