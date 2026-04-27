import React from "react";
import Tooltip from "./Tooltip";

/**
 * Vertical "order responses by:" toggle. Rotated -90deg so it reads
 * bottom-to-top. Pre-rotation order is [time][episode] so after rotation
 * "episode" sits on top. Wrapper is sized to the post-rotation bounding box
 * (rotate doesn't change layout dims). Hover tooltip ("order responses by:")
 * sits to the LEFT of the pill so the cursor never covers it.
 *
 * Fill convention: SELECTED = transparent (page bg shows through), DE-SELECTED
 * = filled with --toggle-off-fill (white in default/public, navy in friend
 * room).
 */
export default function OrderToggle({ value, onToggle }: {
  value: "episode" | "time";
  onToggle: () => void;
}) {
  const isTime = value === "time";

  return (
    <div style={{ width: 24, height: 110, position: "relative" }}>
      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%) rotate(-90deg)",
      }}>
        <Tooltip text="order responses by:" direction="left" width={150} portal>
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
            {/* Pre-rotation left → post-rotation bottom: "time" */}
            <span style={{
              padding: "3px 10px",
              fontSize: 12,
              fontWeight: isTime ? 700 : 400,
              background: !isTime ? "var(--toggle-off-fill)" : "transparent",
              color: !isTime ? "var(--dos-bg)" : "var(--dos-fg)",
              whiteSpace: "nowrap",
            }}>
              time
            </span>
            {/* Pre-rotation right → post-rotation top: "episode" */}
            <span style={{
              padding: "3px 10px",
              fontSize: 12,
              fontWeight: !isTime ? 700 : 400,
              background: isTime ? "var(--toggle-off-fill)" : "transparent",
              color: isTime ? "var(--dos-bg)" : "var(--dos-fg)",
              whiteSpace: "nowrap",
            }}>
              episode
            </span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
