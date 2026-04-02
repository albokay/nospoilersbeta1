import React, { useState } from "react";

export default function Tooltip({
  text,
  children,
  direction = "above",
  style,
}: {
  text: string;
  children: React.ReactNode;
  direction?: "above" | "below";
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
            ...(direction === "above" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }),
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--dos-bg)",
            color: "#fff",
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            width: 240,
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
