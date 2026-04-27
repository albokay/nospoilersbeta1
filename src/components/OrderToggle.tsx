import React from "react";

/**
 * Vertical "order responses by:" toggle. Each rotated element lives in a
 * fixed-size wrapper sized to its post-rotation bounding box so siblings
 * don't overlap (transform: rotate doesn't change layout dimensions).
 * Label sits above the pill; both rotated -90deg so they read bottom-to-top.
 */
export default function OrderToggle({ value, onToggle }: {
  value: "episode" | "time";
  onToggle: () => void;
}) {
  const isTime = value === "time";

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 10,
    }}>
      {/* Label — wrapper height ≈ rotated text width so it occupies real space */}
      <div style={{ width: 14, height: 132, position: "relative" }}>
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%) rotate(-90deg)",
          whiteSpace: "nowrap",
          fontSize: 12,
          color: "var(--dos-fg)",
          opacity: 0.7,
          letterSpacing: 0.2,
        }}>
          order responses by:
        </div>
      </div>

      {/* Pill — wrapper height ≈ rotated pill width */}
      <div style={{ width: 24, height: 110, position: "relative" }}>
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%) rotate(-90deg)",
        }}>
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
    </div>
  );
}
