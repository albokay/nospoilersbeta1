import React, { useState } from "react";

type Direction = "above" | "below" | "right" | "left";
type Align = "center" | "left" | "right"; // for above/below only

function getPositionStyle(direction: Direction, align: Align): React.CSSProperties {
  if (direction === "right") return { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" };
  if (direction === "left")  return { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" };
  const vert = direction === "above" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" };
  const horiz: React.CSSProperties =
    align === "right"  ? { right: 0 } :
    align === "left"   ? { left: 0 } :
                         { left: "50%", transform: "translateX(-50%)" };
  return { ...vert, ...horiz };
}

export default function Tooltip({
  text,
  children,
  direction = "above",
  align = "center",
  style,
}: {
  text: string;
  children: React.ReactNode;
  direction?: Direction;
  align?: Align;
  style?: React.CSSProperties;
}) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-block", ...style }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div
          style={{
            position: "absolute",
            ...getPositionStyle(direction, align),
            background: "var(--dos-bg)",
            color: "#fff",
            borderRadius: 18,
            padding: "9px 14px",
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.4,
            boxShadow: "0 4px 20px rgba(0,0,0,0.32)",
            width: 230,
            zIndex: 9999,
            pointerEvents: "none",
            textAlign: "center",
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
