import React, { useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";
import { CANON, withAlpha } from "../styles/canon";

// ============================================================================
// StickyNote — the shared shell for the app's cream/yellow sticky-notes.
// ----------------------------------------------------------------------------
// Collapses the paper + tilt + soft shadow + fade-and-rise entrance + dismiss-X
// that were copy-pasted across the simple stickies. Colors come from canon.ts.
//
// SCOPE: this shell models the SIMPLE stickies (GroupRoomSticky,
// IncomingPingSticky) — a single dismiss + one entrance animation. The amber
// question stickies (PollSticky / SIKWSticky) are intentionally NOT built on
// this: they're two-state (active/closed) with conditional dismiss logic, no
// entrance fade, and a heavier shadow — a different pattern. Don't force them
// onto this shell without accepting those visual/behavioral changes.
//
// The shell is presentational: the PARENT owns data fetching, the data/loading
// gate, and whether to render at all. Pass ignoreViewportGate to let the parent
// keep its own >=1160px check (the common case, since the gate is usually fused
// with the data gate).
// ============================================================================

// The sticky spec, centralized. These were re-declared in every sticky file.
export const STICKY = {
  ENTRY_TRANSITION_MS: 380,
  ENTRY_DELAY_MS: 600,
  ENTRY_RISE_PX: 18,
  MIN_VIEWPORT_PX: 1160, // below this the sticky layer hides
} as const;

type StickyTone = "cream" | "yellow";

interface StickyNoteProps {
  children: React.ReactNode;
  tone?: StickyTone;
  /** Text color on the paper. Defaults: cream → canon blue, yellow → white. */
  textColor?: string;
  /** Clockwise tilt in degrees. */
  tilt?: number;
  width?: number;
  /** GroupRoomSticky-style centering: transform centers on its anchor point. */
  centered?: boolean;
  padding?: string;
  fontSize?: number;
  lineHeight?: number;
  boxShadow?: string;
  /** Fixed-position anchor (right/bottom/top/left/zIndex). */
  style?: React.CSSProperties;
  onDismiss?: () => void;
  dismissColor?: string;
  dismissSize?: number;
  dismissDisabled?: boolean;
  dismissLabel?: string;
  ariaLabel?: string;
  /** Skip the >=1160px gate (parent owns it). Default false. */
  ignoreViewportGate?: boolean;
  /** Fade-and-rise on mount. Default true. */
  animateEntrance?: boolean;
}

export default function StickyNote({
  children,
  tone = "cream",
  textColor,
  tilt = 3,
  width = 260,
  centered = false,
  padding = "14px 16px",
  fontSize = 13,
  lineHeight = 1.4,
  boxShadow = "0 1px 0 rgba(0,0,0,0.06)",
  style,
  onDismiss,
  dismissColor,
  dismissSize = 15,
  dismissDisabled = false,
  dismissLabel = "Dismiss",
  ariaLabel,
  ignoreViewportGate = false,
  animateEntrance = true,
}: StickyNoteProps) {
  const [wide, setWide] = useState(
    () => ignoreViewportGate ||
      (typeof window !== "undefined" && window.innerWidth >= STICKY.MIN_VIEWPORT_PX),
  );
  useEffect(() => {
    if (ignoreViewportGate) return;
    const fn = () => setWide(window.innerWidth >= STICKY.MIN_VIEWPORT_PX);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, [ignoreViewportGate]);

  const [entered, setEntered] = useState(!animateEntrance);
  useLayoutEffect(() => {
    if (!animateEntrance) return;
    const t = window.setTimeout(() => setEntered(true), STICKY.ENTRY_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [animateEntrance]);

  if (!ignoreViewportGate && !wide) return null;

  const paper = tone === "yellow" ? CANON.accent : CANON.cream;
  const text = textColor ?? (tone === "yellow" ? CANON.cream : CANON.identity);
  const xColor = dismissColor ?? (text.startsWith("#") ? withAlpha(text, 0.5) : text);

  const rise = entered ? 0 : STICKY.ENTRY_RISE_PX;
  const transform = centered
    ? `translate(-50%, calc(-50% + ${rise}px)) rotate(${tilt}deg)`
    : `rotate(${tilt}deg) translateY(${rise}px)`;

  return (
    <div
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        zIndex: 60,
        width,
        transform,
        transformOrigin: "center",
        opacity: entered ? 1 : 0,
        transition: `opacity ${STICKY.ENTRY_TRANSITION_MS}ms ease-out, transform ${STICKY.ENTRY_TRANSITION_MS}ms ease-out`,
        background: paper,
        color: text,
        padding,
        borderRadius: 0,
        boxShadow,
        fontSize,
        lineHeight,
        ...style,
      }}
    >
      {onDismiss && (
        <button
          onClick={onDismiss}
          disabled={dismissDisabled}
          aria-label={dismissLabel}
          style={{
            position: "absolute",
            top: 2,
            right: 4,
            background: "transparent",
            border: "none",
            padding: 6,
            color: xColor,
            cursor: dismissDisabled ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={dismissSize} />
        </button>
      )}
      {children}
    </div>
  );
}
