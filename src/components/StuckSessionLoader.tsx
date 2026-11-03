import { useEffect, useState } from "react";
import LoadingDots from "./LoadingDots";
import { useEditorial } from "../lib/skin";
import { E } from "../styles/editorial";
import SidebarLogo from "./SidebarLogo";
import { EditorialColumn, EditorialTitle } from "./editorial/Chrome";
import { GhostCluster } from "./DashboardGhosts";

/**
 * The homepage "loading" overlay for a signed-in user whose profile / redirect
 * hasn't resolved yet. The "sign out" escape hatch is for a GENUINELY STUCK
 * session (profile never loads — HANDOFF §6 item 15), so it only appears after
 * a delay: during a normal sign-in the redirect fires in well under a second
 * and this component unmounts before the timer, so the escape never flashes
 * (Alborz 2026-08-15 — the "sign out" text was appearing mid-sign-in).
 *
 * Under the editorial look (his notes, 10-14) the bridge paints the
 * dashboard's own cold-open state — the centred logo, "Your watch groups",
 * the two ghost clusters, the loading line — so the way in reads as one load
 * instead of the old green screen followed by the new one.
 */
export default function StuckSessionLoader({ onSignOut }: { onSignOut: () => void }) {
  const editorial = useEditorial();
  const [showEscape, setShowEscape] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShowEscape(true), 4000);
    return () => window.clearTimeout(t);
  }, []);
  const escape = showEscape && (
    <button
      onClick={onSignOut}
      style={{ border: "none", background: "transparent", color: "var(--canon-cream,#FEF8EA)", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 12, opacity: 0.7, cursor: "pointer" }}
    >
      sign out
    </button>
  );
  if (editorial) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 300, background: E.color.personal, color: E.color.ink, fontFamily: E.font.interface, display: "flex", flexDirection: "column", overflowY: "auto" }} aria-busy="true">
        <EditorialColumn style={{ height: E.measure.desktop.dashboardTitleTop }}>
          <div style={{ position: "absolute", left: "50%", top: E.measure.desktop.logoTop, marginLeft: -70 }}>
            <SidebarLogo scale={0.5} blocksOpacity={1} bg="cream" betaBadge />
          </div>
        </EditorialColumn>
        <EditorialColumn><EditorialTitle desktop>Your watch groups</EditorialTitle></EditorialColumn>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", flexWrap: "wrap", gap: 56, padding: "16px 80px 36px" }}>
          <GhostCluster barWidth={96} />
          <GhostCluster barWidth={128} />
        </div>
        <div style={{ textAlign: "center", padding: "0 0 48px", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: E.color.cream }}>loading<LoadingDots /></span>
          {escape}
        </div>
        <div style={{ flex: 1 }} />
      </div>
    );
  }
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "var(--canon-personal,#7abd8e)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
      <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: "var(--canon-cream,#FEF8EA)" }}>loading<LoadingDots /></span>
      {escape}
    </div>
  );
}
