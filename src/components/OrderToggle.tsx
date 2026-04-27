import React from "react";

/**
 * Vertical sibling of ModeToggle. Two-segment pill rotated -90deg, with a
 * vertical "order responses by:" label rendered alongside. Lives in the
 * left margin of the reply list (sticky on scroll). Desktop only — caller
 * is responsible for hiding it on narrow viewports.
 */
export default function OrderToggle({ value, onToggle }: {
  value: "episode" | "time";
  onToggle: () => void;
}) {
  const isTime = value === "time";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      {/* Label: rotated so it reads bottom-to-top */}
      <div style={{
        transform: "rotate(-90deg)",
        whiteSpace: "nowrap",
        fontSize: 12,
        color: "var(--dos-fg)",
        opacity: 0.7,
        letterSpacing: 0.2,
        // Reserve a square box so the rotated text doesn't push siblings around
        height: 14,
        lineHeight: "14px",
      }}>
        order responses by:
      </div>

      {/* Pill — same chrome as ModeToggle, rotated -90deg so the segments stack vertically */}
      <div style={{ transform: "rotate(-90deg)" }}>
        <button
          onClick={onToggle}
          aria-label={`Order responses by ${isTime ? "time" : "episode"}`}
          aria-pressed={isTime}
          style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 999,
            boxShadow: "0 0 0 2px var(--dos-border)",
            border: "none",
            overflow: "hidden",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            gap: 0,
          }}
        >
          <span style={{
            padding: "3px 10px",
            fontSize: 12,
            fontWeight: !isTime ? 700 : 400,
            background: !isTime ? "var(--dos-border)" : "transparent",
            color: !isTime ? "var(--dos-bg)" : "var(--dos-fg)",
            whiteSpace: "nowrap",
          }}>
            episode
          </span>
          <span style={{
            padding: "3px 10px",
            fontSize: 12,
            fontWeight: isTime ? 700 : 400,
            background: isTime ? "var(--dos-border)" : "transparent",
            color: isTime ? "var(--dos-bg)" : "var(--dos-fg)",
            whiteSpace: "nowrap",
          }}>
            time
          </span>
        </button>
      </div>
    </div>
  );
}
