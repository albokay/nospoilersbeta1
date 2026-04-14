import React from "react";

export default function ModeToggle({ value, onToggle, disabled = false, hiddenNewReplies = 0, compact = false }: {
  value: "standard" | "risky";
  onToggle: () => void;
  disabled?: boolean;
  hiddenNewReplies?: number;
  compact?: boolean;
}) {
  const isRisky = value === "risky";
  return (
    // Outer wrapper is position:relative so the dot can overflow the button
    <div style={{ position: "relative", display: "inline-block", opacity: disabled ? 0.6 : 1 }}>
      <button
        onClick={disabled ? undefined : onToggle}
        aria-label={`Toggle mode (currently ${isRisky ? "Risky" : "Standard"})`}
        aria-pressed={isRisky}
        title={hiddenNewReplies > 0 ? "People have written to you from beyond your watch progress. Toggle to \u201crisky\u201d to see them." : isRisky ? "Risky: show redacted stubs (click to reveal)" : "Standard: hide newer comments"}
        disabled={disabled}
        style={{
          display: "inline-flex",
          alignItems: "center",
          borderRadius: 999,
          // box-shadow draws outside the border-box → fill reaches edge with no gap
          boxShadow: "0 0 0 2px var(--dos-border)",
          border: "none",
          overflow: "hidden",
          background: "transparent",
          padding: 0,
          cursor: disabled ? "default" : "pointer",
          gap: 0,
        }}
      >
        <span style={{
          padding: compact ? "3px 8px" : "3px 10px",
          fontSize: compact ? 11 : 12,
          fontWeight: !isRisky ? 700 : 400,
          background: !isRisky ? "var(--dos-border)" : "transparent",
          color: !isRisky ? "var(--dos-bg)" : "var(--dos-fg)",
          whiteSpace: "nowrap",
        }}>
          {compact ? "std" : "standard"}
        </span>
        <span style={{
          padding: compact ? "3px 8px" : "3px 10px",
          fontSize: compact ? 11 : 12,
          fontWeight: isRisky ? 700 : 400,
          background: isRisky ? "var(--dos-border)" : "transparent",
          color: isRisky ? "var(--dos-bg)" : "var(--dos-fg)",
          whiteSpace: "nowrap",
        }}>
          {compact ? "risk" : "risky"}
        </span>
      </button>

      {/* Red dot — lives outside the button so overflow:hidden doesn't clip it */}
      {hiddenNewReplies > 0 && (
        <div style={{
          position: "absolute",
          top: -10,
          right: -10,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "var(--danger)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1,
          pointerEvents: "none",
          zIndex: 1,
        }}>
          {hiddenNewReplies}
        </div>
      )}
    </div>
  );
}
