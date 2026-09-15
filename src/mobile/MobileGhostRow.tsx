/**
 * MobileGhostRow — cold-open skeleton for the dashboard's group rows and the
 * group room's show rows (polish pass 2026-09-14). Static, no shimmer — in
 * the spirit of the pressable plates: the ghost holds the row's exact shape
 * (64px pill, avatar circle, name bar) so the real rows land in place instead
 * of pushing the page down when the fetch resolves. Tints are translucent
 * cream so the same component reads on green and sky.
 */
import React from "react";
import { CANON, withAlpha } from "../styles/canon";

export default function MobileGhostRow({ barWidth }: { barWidth: number }) {
  return (
    <div style={{
      minHeight: 64, borderRadius: 9999, border: `2px solid ${withAlpha(CANON.cream, 0.35)}`,
      display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", boxSizing: "border-box",
    }}>
      <span style={{ width: 32, height: 32, borderRadius: "50%", background: withAlpha(CANON.cream, 0.25), flexShrink: 0 }} />
      <span style={{ width: barWidth, height: 12, borderRadius: 6, background: withAlpha(CANON.cream, 0.25) }} />
    </div>
  );
}
