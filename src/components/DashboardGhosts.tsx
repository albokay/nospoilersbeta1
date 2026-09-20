/**
 * DashboardGhosts — desktop cold-open skeletons (odds-and-ends 2026-09-19,
 * item 10: the /m dashboard + group room got MobileGhostRow on 09-14; this is
 * the desktop twin). Same spirit: STATIC, no shimmer — the ghost holds the
 * real element's exact footprint so the loaded content lands in place
 * instead of pushing the page around. Tints are translucent cream so they
 * read on the green dashboard and the sky group room alike.
 *
 *  • GhostCluster  — a dashboard group cluster: the 56px avatar pyramid
 *                    (1-over-2, 6px gaps — pyramidRows(3)) + the name caption
 *                    bar 12px below (clusterName geometry).
 *  • GhostShowPill — a group-room show button: 48px pill (GroupPill's base —
 *                    padding 12/20, radius 9999) holding a 24px circle + bar.
 */
import React from "react";
import { CANON, withAlpha } from "../styles/canon";

const RING = withAlpha(CANON.cream, 0.35);
const FILL = withAlpha(CANON.cream, 0.25);

function Circle({ size }: { size: number }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", background: FILL, flexShrink: 0, display: "inline-block" }} />;
}

export function GhostCluster({ barWidth }: { barWidth: number }) {
  return (
    <div style={{ padding: 0 }} aria-hidden="true">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}><Circle size={56} /></div>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 6 }}><Circle size={56} /><Circle size={56} /></div>
      </div>
      <div style={{ marginTop: 12, height: 19, display: "flex", alignItems: "center", justifyContent: "center", maxWidth: 168, marginLeft: "auto", marginRight: "auto" }}>
        <span style={{ width: barWidth, height: 12, borderRadius: 6, background: FILL }} />
      </div>
    </div>
  );
}

export function GhostShowPill({ barWidth }: { barWidth: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        minHeight: 48, borderRadius: 9999, border: `2px solid ${RING}`,
        display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", boxSizing: "border-box",
      }}
    >
      <Circle size={24} />
      <span style={{ width: barWidth, height: 12, borderRadius: 6, background: FILL }} />
    </div>
  );
}
