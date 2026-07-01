import React from "react";

// Inline season/episode <select>. Extracted verbatim from SearchShows.tsx
// (2026-06-08, onboarding arc) so the new first-login OnboardingModal and the
// existing SearchShows flow share one implementation. Behavior unchanged.
export default function EpisodeSelectInline({
  seasons,
  value,
  onChange,
  allowZero = false,
  disableAtOrAbove,
  disableAtOrBelow,
  style,
}: {
  seasons: number[];
  value: { s: number; e: number };
  onChange: (v: { s: number; e: number }) => void;
  allowZero?: boolean;
  /** Optional style overrides merged onto the <select> (e.g. radii/no-outline
   *  for the onboarding modal). Callers that omit it keep the default look. */
  style?: React.CSSProperties;
  // Rewatch pairing: options that are (s,e) >= this bound are disabled.
  // Used on the rewatch-position selector when highest is set — rewatch
  // must be strictly less than highest.
  disableAtOrAbove?: { s: number; e: number };
  // Options that are (s,e) <= this bound are disabled. Used on the
  // highest selector — highest must be strictly greater than rewatch.
  disableAtOrBelow?: { s: number; e: number };
}) {
  const val = `s${value.s}e${value.e}`;
  const isDisabled = (s: number, e: number) => {
    if (disableAtOrAbove) {
      const a = disableAtOrAbove;
      if (s > a.s || (s === a.s && e >= a.e)) return true;
    }
    if (disableAtOrBelow) {
      const b = disableAtOrBelow;
      if (s < b.s || (s === b.s && e <= b.e)) return true;
    }
    return false;
  };
  return (
    <select
      value={val}
      onChange={(ev) => {
        const m = ev.target.value.match(/^s(\d+)e(\d+)$/);
        if (m) onChange({ s: Number(m[1]), e: Number(m[2]) });
      }}
      style={{
        background: "#FEF8EA", color: "#000",
        border: "1px solid var(--dos-border)", borderRadius: 6,
        padding: "4px 8px", fontSize: 13, width: "100%",
        ...style,
      }}
    >
      {allowZero && (
        <option value="s0e0">Haven't started</option>
      )}
      {seasons.map((epCount, idx) => {
        const s = idx + 1;
        const eps = Array.from({ length: epCount }, (_, i) => i + 1);
        return (
          <optgroup key={s} label={`Season ${s}`}>
            {eps.map(e => (
              <option key={e} value={`s${s}e${e}`} disabled={isDisabled(s, e)}>
                Season {s} Episode {e}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
