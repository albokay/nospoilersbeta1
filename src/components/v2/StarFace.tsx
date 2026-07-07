import React from "react";

// Star arrangement for a rating 1..6 — cream 5-point stars inside a circular
// rating cell (replaces the old DiceFace dot pattern, 2026-07-07). One uniform
// coordinate model, no SVG assets: positions are fractions of the box (0..1),
// rendered into a 100×100 viewBox scaled to `size`.
//
//   1 → center
//   2 → TL–BR diagonal
//   3 → pyramid (1 top, 2 bottom)
//   4 → 2×2 corners
//   5 → regular pentagon (top vertex up)
//   6 → pentagon + center star
//
// Cream fill works on every cell state (solid identity/personal/business fills
// AND the outlined transparent cells), matching the reference sheet.

const STAR_POSITIONS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.36, 0.34], [0.64, 0.66]],
  3: [[0.5, 0.28], [0.32, 0.7], [0.68, 0.7]],
  4: [[0.32, 0.32], [0.68, 0.32], [0.32, 0.68], [0.68, 0.68]],
  // Pentagon (top, upper-L, upper-R, lower-L, lower-R), nudged up ~1px so the
  // cluster sits centered in the circle rather than a touch low.
  5: [[0.5, 0.184], [0.215, 0.391], [0.785, 0.391], [0.324, 0.727], [0.676, 0.727]],
  6: [[0.5, 0.184], [0.215, 0.391], [0.785, 0.391], [0.324, 0.727], [0.676, 0.727], [0.5, 0.484]],
};

// One uniform star size across every rating (the smaller weight — keeps the
// dense 5/6 clusters from overlapping and reads consistently 1→6).
const STAR_RADIUS = 0.145;

// A chunky 5-point star centered at (cx,cy), outer radius ro. Inner ratio 0.45.
function starPath(cx: number, cy: number, ro: number): string {
  const ri = ro * 0.45;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

export default function StarFace({ rating, size = 32 }: { rating: number; size?: number }) {
  const positions = STAR_POSITIONS[rating] ?? [];
  const ro = STAR_RADIUS * 100;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ pointerEvents: "none", display: "block", overflow: "visible" }}
      aria-hidden
    >
      {positions.map(([x, y], i) => (
        <path key={i} d={starPath(x * 100, y * 100, ro)} fill="#FEF8EA" />
      ))}
    </svg>
  );
}
