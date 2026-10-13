import React from "react";
import { X } from "lucide-react";
import SidebarLogo from "../components/SidebarLogo";
import { CANON } from "../styles/canon";
import { useEditorial } from "../lib/skin";
import { E } from "../styles/editorial";
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
  // The editorial skin (Alborz's notes, item 7): the scroll on cream in ink —
  // the title and captions in Lora, the diagrams in ink frames with the
  // site's blocks, hairline dividers, Join Sidebar as the ink block.
  const editorial = useEditorial();
  const T = editorial ? ED : CL;
  return (
    <div style={editorial ? { ...sheet, background: E.color.cream, color: E.color.ink } : sheet}>
      <button style={closeX} onClick={onClose} aria-label="Close">
        <X size={20} color={editorial ? E.color.ink : CANON.cream} />
      </button>
      <div style={inner}>
        {panelSlots.map((slots, i) => {
          // Trim each card to its last occupied slot (desktop uses a fixed
          // 12-slot height; on a scroll that reads as dead space).
          const lastIdx = slots.reduce((acc, s, idx) => (s ? idx : acc), 0);
          return (
            <section key={i} style={{ marginBottom: 32 }}>
              {panelTitles[i] && <div style={T.title}>{panelTitles[i]}</div>}
              <div style={T.caption}>
                <span style={T.number}>{i + 1}. </span>
                {panelCaptionsMobile[i]}
              </div>
              <div style={T.card}>
                <div style={{ position: "relative", height: (lastIdx + 1) * SLOT_H }}>
                  {slots.map((slot, si) => slot && (
                    <div key={si} style={basePillStyle(slot.type, slot.align, si, editorial)}>
                      {pillLabel(slot.type)}
                    </div>
                  ))}
                </div>
              </div>
              {/* No divider after the last diagram — the join block follows. */}
              {i < panelSlots.length - 1 && <div style={T.divider} />}
            </section>
          );
        })}

        {/* ── Join step (desktop's fifth panel: logo + CTA) — centered in a
               tall block so, scrolled to the end, it rests around the middle
               of the screen rather than pinned to the bottom edge. ── */}
        <div style={{ minHeight: "55dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 32, marginTop: 24 }}>
          <SidebarLogo scale={0.9} {...(editorial ? { bg: "cream" as const } : {})} />
          <button onClick={onSignup} style={T.join}>Join Sidebar</button>
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
// Inline with the caption's first line, at the larger size.
const sectionNumber: React.CSSProperties = {
  fontSize: 22, fontWeight: 900, color: CANON.cream, marginRight: 4, lineHeight: 1,
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
// The two looks, picked once per render.
const CL = { title: titleStyle, caption: captionStyle, number: sectionNumber, card, divider, join: joinBtn };
const ED: typeof CL = {
  title: { ...E.type.question30, fontSize: 28, color: E.color.ink, marginBottom: 20, whiteSpace: "pre-line" },
  caption: { ...E.type.letterBody16, color: E.color.ink, whiteSpace: "pre-line", marginBottom: 16 },
  number: { fontFamily: E.font.display, fontWeight: 700, fontSize: 22, color: E.color.ink, marginRight: 4, lineHeight: 1 },
  card: { borderRadius: 0, background: E.color.cream, border: `1px solid ${E.color.ink}`, padding: "20px 16px", overflow: "hidden" },
  divider: { height: 1, width: "56%", margin: "32px auto 0", background: E.color.hairline },
  join: { ...E.type.button16, height: 56, padding: "0 48px", background: E.color.ink, color: E.color.cream, border: 0, borderRadius: 0, cursor: "pointer" },
};
