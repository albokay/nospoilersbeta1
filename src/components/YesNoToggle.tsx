import React from "react";
import { CANON } from "../styles/canon";

// The yellow show card's yes/no toggle, shared (2026-09-28: the invite
// landing's browse card needed a third copy — DashboardPage and
// MobileGroupRoom still carry their identical local versions). A coloured
// sliding knob carries the active label only: "no" = yellow knob left,
// "yes" = green knob right; 96×40 so the knob is a real target.
export default function YesNoToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      style={{
        border: "none", cursor: "pointer", borderRadius: 9999, padding: 4, width: 96, height: 40,
        background: CANON.cream, position: "relative", display: "flex", alignItems: "center",
      }}
    >
      <span style={{
        position: "absolute", left: value ? 50 : 4, top: 4, width: 42, height: 32, borderRadius: 9999,
        background: value ? CANON.personal : CANON.accent, transition: "left 120ms, background 120ms",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 700, color: CANON.cream,
      }}>{value ? "yes" : "no"}</span>
    </button>
  );
}
