import React from "react";
import { CANON } from "../styles/canon";
import type { Stance } from "../lib/proposalAnswers";

/**
 * StanceToggle (Alborz 2026-09-29): the proposal's three answers in one
 * segmented pill — I'm in · sit this out · seen it — all visible, one
 * active, changeable later; nothing selected = hasn't looked yet. Green
 * for in (the old yes), the toggle's accent yellow for the two passes.
 * Replaces the yes/no toggle on the group room's card and the what's-next
 * panel; the invite landing keeps yes/no (nothing to pass on yet).
 */
const SEGMENTS: { value: Stance; label: string }[] = [
  { value: "in", label: "I'm in" },
  { value: "out", label: "sit this out" },
  { value: "seen", label: "seen it" },
];

export default function StanceToggle({ value, onChange, disabled = false, compact = false }: {
  value: Stance | null;
  onChange: (v: Stance) => void;
  disabled?: boolean;
  /** Tighter segment padding for narrow rows (/m panel rows). */
  compact?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Your answer" style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: 4, height: 40, boxSizing: "border-box", borderRadius: 9999, background: CANON.cream, opacity: disabled ? 0.6 : 1 }}>
      {SEGMENTS.map((seg) => {
        const on = value === seg.value;
        return (
          <button
            key={seg.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={(e) => { e.stopPropagation(); if (!on) onChange(seg.value); }}
            style={{
              height: 32, padding: compact ? "0 11px" : "0 14px", borderRadius: 9999, border: "none", cursor: disabled ? "default" : "pointer",
              background: on ? (seg.value === "in" ? CANON.personal : CANON.accent) : "transparent",
              color: on ? CANON.cream : "rgba(26,58,74,0.55)",
              fontFamily: '"Inter", sans-serif', fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
              transition: "background 120ms, color 120ms",
            }}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
