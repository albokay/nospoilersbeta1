import React, { useState, useRef } from "react";

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
}: {
  text: React.ReactNode;
  children: React.ReactNode;
  direction?: Direction;
  align?: Align;
  style?: React.CSSProperties;
  gap?: number;
  useAbsolute?: boolean;
  width?: number;
  tooltipStyle?: React.CSSProperties;
  disabled?: boolean;
}) {
  if (disabled) return <span style={{ position: "relative", display: "inline-block", ...style }}>{children}</span>;

  const [show, setShow] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = () => {
    if (wrapperRef.current) setRect(wrapperRef.current.getBoundingClientRect());
    setShow(true);
  };

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
    if (direction === "left") return {
      position: "fixed",
      top: rect.top + rect.height / 2,
      left: rect.left - width - gap,
      transform: "translateY(-50%)",
    };
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
      {show && (useAbsolute || rect) && (
        <div style={{
          ...(useAbsolute ? getAbsoluteStyle() : getFixedStyle()),
          background: "var(--dos-bg)",
          color: "#fff",
          borderRadius: 18,
          padding: "9px 14px",
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.4,
          boxShadow: "0 4px 20px rgba(0,0,0,0.32)",
          width,
          zIndex: 9999,
          pointerEvents: "none",
          textAlign: "center",
          ...tooltipStyle,
        }}>
          {text}
        </div>
      )}
    </span>
  );
}
