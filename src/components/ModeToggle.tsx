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
    <button
      onClick={disabled ? undefined : onToggle}
      aria-label={`Toggle mode (currently ${isRisky ? "Risky" : "Standard"})`}
      aria-pressed={isRisky}
      title={isRisky ? "Risky: show redacted stubs (click to reveal)" : "Standard: hide newer comments"}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        overflow: "hidden",
        border: "2px solid var(--dos-border)",
        background: "transparent",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
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
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}>
        {compact ? "risk" : "risky"}
        {hiddenNewReplies > 0 && (
          <span style={{
            width: 16, height: 16, borderRadius: "50%",
            background: "var(--danger)", color: "#fff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 800, lineHeight: 1, flexShrink: 0,
          }}>
            {hiddenNewReplies}
          </span>
        )}
      </span>
    </button>
  );
}
