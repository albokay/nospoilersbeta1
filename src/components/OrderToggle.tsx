import React from "react";
import Tooltip from "./Tooltip";

/**
 * Vertical "order responses by:" toggle. Rotated +90deg so it reads
 * top-to-bottom (mounted to the RIGHT of the replies column). Pre-rotation
 * order is [episode][time] so after +90deg rotation "episode" sits on top.
 * Wrapper is sized to the post-rotation bounding box (rotate doesn't change
 * layout dims). Hover tooltip sits to the RIGHT of the pill so the cursor
 * never covers it (pill is now in the right margin, so the tooltip extends
 * into empty viewport space rather than back over the replies).
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
        transform: "translate(-50%, -50%) rotate(90deg)",
      }}>
        <Tooltip
          text="Order responses by:"
          direction="right"
          width={180}
          portal
          tooltipStyle={{ whiteSpace: "nowrap" }}
        >
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
            {/* Pre-rotation left → post-rotation top (with +90deg): "episode".
                When filled, a 1px outset box-shadow extends the fill so it
                meets the outer 2px outline cleanly (closes the hairline
                anti-aliasing gap). The button's overflow:hidden + 999
                borderRadius clips the shadow to the pill shape. */}
            <span style={{
              padding: "3px 10px",
              fontSize: 12,
              fontWeight: !isTime ? 700 : 400,
              background: isTime ? "var(--toggle-off-fill)" : "transparent",
              color: isTime ? "var(--dos-bg)" : "var(--toggle-on-text)",
              boxShadow: isTime ? "0 0 0 1px var(--toggle-off-fill)" : "none",
              whiteSpace: "nowrap",
            }}>
              episode
            </span>
            {/* Pre-rotation right → post-rotation bottom: "time" */}
            <span style={{
              padding: "3px 10px",
              fontSize: 12,
              fontWeight: isTime ? 700 : 400,
              background: !isTime ? "var(--toggle-off-fill)" : "transparent",
              color: !isTime ? "var(--dos-bg)" : "var(--toggle-on-text)",
              boxShadow: !isTime ? "0 0 0 1px var(--toggle-off-fill)" : "none",
              whiteSpace: "nowrap",
            }}>
              time
            </span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
