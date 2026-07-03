import React from "react";
import { X } from "lucide-react";
import SidebarLogo from "../components/SidebarLogo";
import { CANON } from "../styles/canon";
import {
  panelSlots,
  panelTitles,
  panelCaptionsMobile,
  pillLabel,
  basePillStyle,
  SLOT_H,
  BOX_BG,
} from "../components/HowItWorksV2";

/**
 * MobileHowItWorks — the "Want more details?" walkthrough as a single
 * vertical scroll (per the mobile walkthrough spec): caption, then its
 * diagram, straight down the page. No side-by-side panels, no position
 * dots, no prev/next.
 *
 * The diagrams are the SAME data desktop animates (panelSlots end-states,
 * imported from HowItWorksV2) rendered STATIC at their final resting
 * state — the spec prefers a settled diagram over a fragile animation
 * port. Each diagram card is full-width; the ~200px pill column centers
 * inside it. Cards are trimmed to their last occupied slot so early
 * panels don't carry dead whitespace.
 *
 * Ends with the Join step (logo + "Join Sidebar" → create-account), same
 * payoff as desktop's fifth step.
 */
export default function MobileHowItWorks({ onClose, onSignup }: { onClose: () => void; onSignup: () => void }) {
  return (
    <div style={sheet}>
      <button style={closeX} onClick={onClose} aria-label="Close">
        <X size={20} color={CANON.cream} />
      </button>
      <div style={inner}>
        {panelSlots.map((slots, i) => {
          // Trim each card to its last occupied slot (desktop uses a fixed
          // 12-slot height; on a scroll that reads as dead space).
          const lastIdx = slots.reduce((acc, s, idx) => (s ? idx : acc), 0);
          return (
            <section key={i} style={{ marginBottom: 32 }}>
              {panelTitles[i] && <div style={titleStyle}>{panelTitles[i]}</div>}
              <div style={sectionNumber}>{i + 1}.</div>
              <div style={captionStyle}>{panelCaptionsMobile[i]}</div>
              <div style={card}>
                <div style={{ position: "relative", height: (lastIdx + 1) * SLOT_H }}>
                  {slots.map((slot, si) => slot && (
                    <div key={si} style={basePillStyle(slot.type, slot.align, si)}>
                      {pillLabel(slot.type)}
                    </div>
                  ))}
                </div>
              </div>
              <div style={divider} />
            </section>
          );
        })}

        {/* ── Join step (desktop's fifth panel: logo + CTA) ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, padding: "16px 0 24px" }}>
          <SidebarLogo scale={0.9} />
          <button onClick={onSignup} style={joinBtn}>Join Sidebar</button>
        </div>
      </div>
    </div>
  );
}

const sheet: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 2000, overflowY: "auto",
  WebkitOverflowScrolling: "touch", background: CANON.personal,
  fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  paddingTop: "calc(env(safe-area-inset-top, 0px) + 64px)",
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
  boxSizing: "border-box",
};
const closeX: React.CSSProperties = {
  position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: 12,
  width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center", zIndex: 2001,
};
const inner: React.CSSProperties = { maxWidth: 480, margin: "0 auto", padding: "0 20px" };
// Desktop caption/title typography, single column.
const titleStyle: React.CSSProperties = {
  fontSize: 24, fontWeight: 900, lineHeight: 1.2, color: CANON.cream,
  marginBottom: 24, whiteSpace: "pre-line",
};
const captionStyle: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, lineHeight: 1.6, color: CANON.cream,
  whiteSpace: "pre-line", marginBottom: 16,
};
const sectionNumber: React.CSSProperties = {
  fontSize: 22, fontWeight: 900, color: CANON.cream, marginBottom: 8,
};
// Post-illustration divider — narrower than the diagram card, centered.
const divider: React.CSSProperties = {
  height: 2, width: "56%", margin: "32px auto 0",
  background: "rgba(253,248,236,0.5)", borderRadius: 2,
};
const card: React.CSSProperties = {
  borderRadius: 16, background: BOX_BG, padding: "20px 16px", overflow: "hidden",
};
const joinBtn: React.CSSProperties = {
  background: CANON.cream, color: CANON.personal, border: "none", borderRadius: 9999,
  padding: "16px 48px", fontSize: 20, fontWeight: 800, cursor: "pointer", minHeight: 56,
  letterSpacing: "0.02em",
};
