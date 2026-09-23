import React from "react";
import { CANON } from "../styles/canon";

// The finished-together celebration mark (Alborz 2026-09-23): an accent
// disc with a cream star — the rating cells' star grammar — sitting where a
// room row's blue dot would. A star, not a dot: this is a moment, not a
// notification. Positioned by the caller (absolute, on the pill's top-left
// curve, clear of the text). Inverted the same day with the row (cream row,
// accent ink): the accent disc is what stands out on cream.
const STAR = "50,10 60.58,35.44 88.04,37.64 67.12,55.56 73.51,82.36 50,68 26.49,82.36 32.88,55.56 11.96,37.64 39.42,35.44";

/** The star alone — the finished-together pill's icon (accent), keeping a
 *  hint of the celebration once a show has folded in (Alborz 2026-09-23). */
export function CelebrationStar({ size = 16, color = CANON.accent, style }: { size?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ flexShrink: 0, ...style }}>
      <polygon points={STAR} fill={color} />
    </svg>
  );
}

export default function CelebrationBadge({ size = 22, style }: { size?: number; style?: React.CSSProperties }) {
  const star = Math.round(size * 0.64);
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: "50%", background: CANON.accent, zIndex: 2,
        display: "inline-flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
        ...style,
      }}
    >
      <CelebrationStar size={star} color={CANON.cream} />
    </span>
  );
}
