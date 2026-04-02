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
      className={compact ? "btn" : "btn modeToggle"}
      style={{
        position: "relative", display: "inline-flex", alignItems: "center", gap: 0, borderRadius: 0, padding: 0,
        border: "1px solid var(--dos-border)", background: "transparent", overflow: "hidden", opacity: disabled ? .6 : 1,
        ...(compact ? { width: "auto", minWidth: 88, height: 38, borderRadius: 0 } : {}),
      }}
      title={isRisky ? "Risky: show redacted stubs (click to reveal)" : "Standard: hide newer comments"}
      disabled={disabled}
    >
      <span style={{ flex: "1 1 0", textAlign: "center", fontWeight: 700, fontSize: compact ? 12 : 13, color: isRisky ? "var(--dos-gray)" : "var(--dos-light)", zIndex: 2, padding: compact ? "0 6px" : "0 8px", whiteSpace: "nowrap" }}>
        {compact ? "Std" : "Standard"}
      </span>
      <span style={{ flex: "1 1 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, fontWeight: 700, fontSize: compact ? 12 : 13, color: isRisky ? "var(--dos-light)" : "var(--dos-gray)", zIndex: 2, padding: compact ? "0 6px" : "0 8px", whiteSpace: "nowrap" }}>
        {compact ? "Risk" : "Risky"}
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
      <span className="modeKnob" style={{ position: "absolute", top: 2, bottom: 2, left: isRisky ? "calc(50% + 2px)" : "2px", width: "calc(50% - 4px)", background: "var(--dos-blue)", border: "1px solid var(--dos-border)" }} />
    </button>
  );
}
