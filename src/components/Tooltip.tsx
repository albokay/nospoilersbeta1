import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";

type Direction = "above" | "below" | "right" | "left";
type Align = "center" | "left" | "right";

const TW = 230;  // tooltip width
const GAP = 10;  // gap between element and tooltip bubble

export default function Tooltip({
  text,
  children,
  direction = "above",
  align = "center",
  style,
  gap = GAP,
  useAbsolute = false,
  width = TW,
  tooltipStyle,
  disabled = false,
  portal = false,
}: {
  text: React.ReactNode;
  children: React.ReactNode;
  direction?: Direction;
  align?: Align;
  style?: React.CSSProperties;
  gap?: number;
  useAbsolute?: boolean;
  // Number = fixed pixel width. "auto" = bubble sizes to content
  // (uses CSS `max-content`). For direction="left" + "auto", positioning
  // switches to right-anchored so the bubble grows leftward from the
  // element's left edge instead of being placed assuming a fixed width.
  width?: number | "auto";
  tooltipStyle?: React.CSSProperties;
  disabled?: boolean;
  // When true, render the bubble into document.body so it escapes any
  // ancestor that creates a stacking context (opacity, transform, filter).
  // Only valid when useAbsolute is false (fixed positioning).
  portal?: boolean;
}) {
  // Hooks must always be called unconditionally — early return comes after
  const [show, setShow] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = () => {
    if (wrapperRef.current) setRect(wrapperRef.current.getBoundingClientRect());
    setShow(true);
  };

  if (disabled) return <span style={{ position: "relative", display: "inline-block", ...style }}>{children}</span>;

  const getAbsoluteStyle = (): React.CSSProperties => {
    const vert: React.CSSProperties = direction === "above"
      ? { bottom: `calc(100% + ${gap}px)` }
      : { top: `calc(100% + ${gap}px)` };
    const horiz: React.CSSProperties =
      align === "right"  ? { right: 0 } :
      align === "left"   ? { left: 0 } :
                           { left: "50%", transform: "translateX(-50%)" };
    return { position: "absolute", ...vert, ...horiz };
  };

  const getFixedStyle = (): React.CSSProperties => {
    if (!rect) return { display: "none" };
    if (direction === "left") {
      // Auto-width: anchor the bubble's RIGHT edge to the element's left
      // edge (minus gap) so the bubble can grow leftward as content
      // lengthens, without needing a numeric width upfront.
      if (width === "auto") {
        return {
          position: "fixed",
          top: rect.top + rect.height / 2,
          right: window.innerWidth - rect.left + gap,
          transform: "translateY(-50%)",
        };
      }
      return {
        position: "fixed",
        top: rect.top + rect.height / 2,
        left: rect.left - width - gap,
        transform: "translateY(-50%)",
      };
    }
    if (direction === "right") return {
      position: "fixed",
      top: rect.top + rect.height / 2,
      left: rect.left + rect.width + gap,
      transform: "translateY(-50%)",
    };
    const vert: React.CSSProperties = direction === "above"
      ? { bottom: window.innerHeight - rect.top + gap }
      : { top: rect.top + rect.height + gap };
    const horiz: React.CSSProperties =
      align === "right"  ? { right: window.innerWidth - rect.left - rect.width } :
      align === "left"   ? { left: rect.left } :
                           { left: rect.left + rect.width / 2, transform: "translateX(-50%)" };
    return { position: "fixed", ...vert, ...horiz };
  };

  return (
    <span
      ref={wrapperRef}
      style={{ position: "relative", display: "inline-block", ...style }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (useAbsolute || rect) && (() => {
        const bubble = (
          <div style={{
            ...(useAbsolute ? getAbsoluteStyle() : getFixedStyle()),
            background: "var(--dos-bg)",
            color: "#FEF8EA",
            borderRadius: 18,
            padding: "9px 14px",
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.4,
            boxShadow: "0 4px 20px rgba(0,0,0,0.32)",
            // "auto" → CSS max-content shrinks the bubble to its widest
            // inline run. Callers should pair with whiteSpace: nowrap on
            // line spans and an optional maxWidth in tooltipStyle.
            width: width === "auto" ? "max-content" : width,
            zIndex: 9999,
            pointerEvents: "none",
            textAlign: "center",
            ...tooltipStyle,
          }}>
            {text}
          </div>
        );
        return portal && !useAbsolute ? createPortal(bubble, document.body) : bubble;
      })()}
    </span>
  );
}
