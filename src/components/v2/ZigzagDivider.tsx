import React from "react";

// Shared zigzag (sawtooth) divider. Drawn as a SINGLE continuous polyline
// + fill polygon spanning a wide canvas (clipped by the SVG box to whatever
// the actual container width is). Using a single continuous polyline (vs
// SVG <pattern> tiles) makes every peak AND every valley an interior
// linejoin (sharp miter). Linecaps only happen at the off-screen far ends
// of the polyline, never at visible corners.
//
// Geometry: tooth period 18px, amplitude 7px (peak y=6, valley y=13 in a
// 20px strip). Slope ~37.9° from horizontal. The 6/7px buffer at the
// strip top/bottom gives the stroke's miter overshoot room to render
// without the SVG clipping the corners.
//
// Use cases:
//   - V2 friend room map sticky-header bottom edge: pass fill="var(--dos-bg)"
//     so the polygon above the zigzag obscures scrolling cells passing
//     underneath. The zigzag's bottom contour becomes the visible top
//     edge of the scroll area.
//   - V2 profile pages (between "Thoughts on…" and watch stats),
//     V3 journal (between entries and "responses to you"): default
//     fill="transparent" — there's no scrolling content to obscure, so
//     the polygon is invisible and only the white zigzag line shows.
const ZZ_TOOTH_W = 18;
const ZZ_PEAK_Y = 6;
const ZZ_VALLEY_Y = 13;
const ZZ_STRIP_H = 20;
const ZZ_CANVAS_W = 4000;
const ZZ_HALF = ZZ_TOOTH_W / 2;
const ZZ_SEGMENTS = Math.ceil(ZZ_CANVAS_W / ZZ_HALF);
const ZZ_TOTAL_W = ZZ_SEGMENTS * ZZ_HALF;

const ZZ_LINE_POINTS = ((): string => {
  const pts: string[] = [];
  for (let i = 0; i <= ZZ_SEGMENTS; i++) {
    const x = i * ZZ_HALF;
    const y = i % 2 === 0 ? ZZ_VALLEY_Y : ZZ_PEAK_Y;
    pts.push(`${x},${y}`);
  }
  return pts.join(" ");
})();

const ZZ_FILL_POINTS = ((): string => {
  // Top-left → top-right → trace zigzag right-to-left → close.
  const pts: string[] = [`0,0`, `${ZZ_TOTAL_W},0`];
  for (let i = ZZ_SEGMENTS; i >= 0; i--) {
    const x = i * ZZ_HALF;
    const y = i % 2 === 0 ? ZZ_VALLEY_Y : ZZ_PEAK_Y;
    pts.push(`${x},${y}`);
  }
  return pts.join(" ");
})();

type Props = {
  /** Fill for the polygon above the zigzag line.
   *  - "transparent" (default): inline section divider; page bg shows
   *    through everywhere except the white stroke.
   *  - "var(--dos-bg)": obscures content underneath; for use as sticky
   *    chrome top edge. */
  fill?: string;
};

export default function ZigzagDivider({ fill = "transparent" }: Props) {
  return (
    <svg
      aria-hidden
      width="100%"
      height={ZZ_STRIP_H}
      preserveAspectRatio="xMinYMin slice"
      style={{ display: "block", pointerEvents: "none" }}
    >
      <polygon points={ZZ_FILL_POINTS} fill={fill} />
      <polyline
        points={ZZ_LINE_POINTS}
        fill="none"
        stroke="#FEF8EA"
        strokeWidth={2}
        strokeLinejoin="miter"
      />
    </svg>
  );
}
