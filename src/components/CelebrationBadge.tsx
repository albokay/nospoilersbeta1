import React from "react";
import { CANON } from "../styles/canon";

// The finished-together celebration mark (Alborz 2026-09-23): a cream disc
// with a gold star — the rating cells' star grammar — sitting where a room
// row's blue dot would. A star, not a dot: this is a moment, not a
// notification. Positioned by the caller (absolute, on the pill's top-left
// curve, clear of the text).
const STAR = "50,10 60.58,35.44 88.04,37.64 67.12,55.56 73.51,82.36 50,68 26.49,82.36 32.88,55.56 11.96,37.64 39.42,35.44";

export default function CelebrationBadge({ size = 22, style }: { size?: number; style?: React.CSSProperties }) {
  const star = Math.round(size * 0.64);
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: "50%", background: CANON.cream, zIndex: 2,
        display: "inline-flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
        ...style,
      }}
    >
      <svg width={star} height={star} viewBox="0 0 100 100"><polygon points={STAR} fill={CANON.accent} /></svg>
    </span>
  );
}
