import React from "react";
import { CANON } from "../styles/canon";

// Canonical Sidebar radio: solid white circle with a colored inner dot
// when selected. Mirrors the established pattern from SearchShows.tsx
// (the "First time / Rewatching" picker). Use this in any place that
// previously rendered a native <input type="radio"> visually.
//
// Default size is 14/7 (compact — for sticky popovers / inline rows).
// Override `size`/`dotSize` for larger forms (modal-scale = 20/10).

interface Props {
  checked: boolean;
  /** Inner dot color when checked. Defaults to canon green. */
  color?: string;
  /** Outer circle background. Defaults to white. */
  bgColor?: string;
  /** Outer circle diameter. */
  size?: number;
  /** Inner dot diameter. */
  dotSize?: number;
  /** Aria-label for screen readers when used standalone. */
  "aria-label"?: string;
}

export default function CanonRadio({
  checked,
  color = CANON.green,
  bgColor = CANON.cream,
  size = 14,
  dotSize = 7,
  "aria-label": ariaLabel,
}: Props) {
  return (
    <span
      role="radio"
      aria-checked={checked}
      aria-label={ariaLabel}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bgColor,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {checked && (
        <span
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            background: color,
          }}
        />
      )}
    </span>
  );
}
