import React from "react";

// Dice-face dot pattern for a rating value 1..6. Renders as small white
// circles inside a square box. Spec: sidebar_spec_rating_dice_display.md.
//
// Conceptual 3×3 grid inside the box (inset from edges by ~19% of size,
// matching the mockup's proportional weight):
//
//   TL   ·   TR
//   ML   C   MR
//   BL   ·   BR
//
// Per-rating dot positions:
//   1 (Nope.)             → C
//   2 (Losing me.)        → TR, BL                       (descending \)
//   3 (I'll keep going.)  → TR, C, BL                    (descending \)
//   4 (Solid.)            → TL, TR, BL, BR               (4 corners)
//   5 (Things are cooking.) → TL, TR, C, BL, BR          (4 corners + center)
//   6 (Woah!)             → TL, TR, ML, MR, BL, BR       (2 columns of 3)
//
// pointerEvents: "none" so the overlay doesn't block click handlers on
// the parent cell. Dots are always white — works on both the canon-green
// filled cell (state 2) and the outlined transparent cell (state 1).

export default function DiceFace({
  rating,
  size = 32,
}: {
  rating: number;
  size?: number;
}) {
  const dotSize = Math.max(2, Math.round(size * 0.1875));  // 6 at 32px
  const inset = Math.round(size * 0.25);                    // 8 at 32px — perimeter dots pulled in, dice footprint centered
  const center = size / 2;
  const far = size - inset;

  const TL: [number, number] = [inset, inset];
  const TR: [number, number] = [far, inset];
  const ML: [number, number] = [inset, center];
  const MR: [number, number] = [far, center];
  const BL: [number, number] = [inset, far];
  const BR: [number, number] = [far, far];
  const C: [number, number] = [center, center];

  const positionsByRating: Record<number, [number, number][]> = {
    1: [C],
    2: [TR, BL],
    3: [TR, C, BL],
    4: [TL, TR, BL, BR],
    5: [TL, TR, C, BL, BR],
    6: [TL, TR, ML, MR, BL, BR],
  };

  const positions = positionsByRating[rating] ?? [];

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        pointerEvents: "none",
      }}
    >
      {positions.map(([x, y], i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            background: "#FEF8EA",
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </div>
  );
}
