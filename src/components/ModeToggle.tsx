import React from "react";

export default function ModeToggle({ value, onToggle, disabled = false }: {
  value: "standard" | "risky";
  onToggle: () => void;
  disabled?: boolean;
}) {
  const isRisky = value === "risky";
  return (
    <button
      onClick={disabled ? undefined : onToggle}
      aria-label={`Toggle mode (currently ${isRisky ? "Risky" : "Standard"})`}
      aria-pressed={isRisky}
      className="btn modeToggle"
      style={{
        position: "relative", display: "inline-flex", alignItems: "center", gap: 0, borderRadius: 0, padding: 0,
        border: "1px solid var(--dos-border)", background: "transparent", overflow: "hidden", opacity: disabled ? .6 : 1
      }}
      title={isRisky ? "Risky: show redacted stubs (click to reveal)" : "Standard: hide newer comments"}
      disabled={disabled}
    >
      <span style={{ flex: "1 1 0", textAlign: "center", fontWeight: 700, fontSize: 13, color: isRisky ? "var(--dos-gray)" : "var(--dos-light)", zIndex: 2, padding: "0 8px" }}>Standard</span>
      <span style={{ flex: "1 1 0", textAlign: "center", fontWeight: 700, fontSize: 13, color: isRisky ? "var(--dos-light)" : "var(--dos-gray)", zIndex: 2, padding: "0 8px" }}>Risky</span>
      <span className="modeKnob" style={{ position: "absolute", top: 2, bottom: 2, left: isRisky ? "calc(50% + 2px)" : "2px", width: "calc(50% - 4px)", background: "var(--dos-blue)", border: "1px solid var(--dos-border)" }} />
    </button>
  );
}
