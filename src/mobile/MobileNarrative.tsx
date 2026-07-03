import { CANON } from "../styles/canon";
import React, { useState, Suspense, lazy } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import HomepageNarrative from "../components/HomepageNarrative";
import { preventLastWordOrphan } from "../lib/utils";
import {
  HERO_LINES,
  HERO_EMPHASIS,
  HOW_IT_WORKS_TITLE,
  HOW_IT_WORKS_STEPS,
  CTA_JOIN_LABEL,
  CTA_DETAILS_LABEL,
  BETA_PILL_CLOSED_MOBILE,
  BETA_PILL_OPEN,
  BETA_LETTER_PARAGRAPHS,
} from "../lib/homepageCopy";

const HowItWorksV2 = lazy(() => import("../components/HowItWorksV2"));

// Mobile homepage narrative scroll for signed-out users (CP1 of the mobile
// rebuild). The desktop homepage is the source of truth; this surface renders
// the SAME live content in the mobile idiom:
//
// - Parallax bubble pitch: reuses <HomepageNarrative /> directly (already
//   responsive via vw units), headerHeight=0.
// - Hero + how-it-works steps + CTA labels + beta-tester letter: words come
//   from src/lib/homepageCopy.ts — the shared copy source both surfaces read —
//   so mobile can never drift from desktop again (the previous mobile build
//   carried a hand-copied duplicate that went stale).
// - "Want more details?" opens HowItWorksV2 as a FULL-SCREEN scrollable
//   surface (mobile idiom) instead of desktop's centered overlay card. Its
//   internals are still desktop-proportioned — flagged for a follow-up pass.
// - "Join / sign in" routes to /m/auth (full-screen mobile auth), the mobile
//   idiom for desktop's auth modal.
//
// The old mobile-only red callout ("full experience is on desktop") is gone —
// mobile is becoming the full app, and the spec forbids copy desktop lacks.
export default function MobileNarrative() {
  const navigate = useNavigate();
  const location = useLocation();
  const [betaOpen, setBetaOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Preserve invite context on the auth shortcut: /m/invite/:token currently
  // falls through to this narrative (the mobile invite flow is rebuilt in
  // CP7), and MobileAuth validates returnTo to /m/* paths. Harmless when not
  // on an invite path.
  const onInvitePath = location.pathname.startsWith("/m/invite/");
  const signInTarget = onInvitePath
    ? `/m/auth?returnTo=${encodeURIComponent(location.pathname)}`
    : "/m/auth";
  // Join CTAs open the auth screen in create-account mode — desktop parity
  // (the homepage "Join / sign in" opens AuthModal with initialMode="signup").
  const joinTarget = onInvitePath
    ? `/m/auth?mode=signup&returnTo=${encodeURIComponent(location.pathname)}`
    : "/m/auth?mode=signup";

  return (
    <div style={{ minHeight: "100dvh", background: "var(--dos-bg, var(--canon-personal,#7abd8e))", color: CANON.cream }}>
      {/* ── Fixed top-right sign-in shortcut ── */}
      {/* z-index 100 keeps it above the parallax narrative's fixed-position */}
      {/* AnimatedLogo (z-index 96 in HomepageNarrative). */}
      <button
        onClick={() => navigate(signInTarget)}
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 14px)",
          right: 14,
          zIndex: 100,
          background: "var(--canon-accent,#dea838)",
          color: CANON.cream,
          border: "none",
          borderRadius: 9999,
          padding: "8px 18px",
          minHeight: 44,
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
          letterSpacing: "0.02em",
        }}
      >
        Sign in
      </button>

      {/* ── Parallax narrative scroll (reused from desktop, headerHeight=0) ── */}
      <HomepageNarrative headerHeight={0} />

      {/* ── Hero headline (shared copy; desktop's isMobile line-break shape) ── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 0, paddingBottom: 24 }}>
        <p style={{
          maxWidth: 560, textAlign: "center",
          margin: "80px 16px 40px",
          fontSize: 20, fontWeight: 800,
          color: CANON.cream, lineHeight: 1.3,
        }}>
          {HERO_LINES[0]}<br />
          {HERO_LINES[1]}<br />
          <em>{HERO_EMPHASIS}</em>
        </p>

        <p style={{
          fontSize: 20, fontWeight: 800,
          color: CANON.cream, margin: "8px 16px 40px", textAlign: "center",
        }}>
          {HOW_IT_WORKS_TITLE}
        </p>

        {/* ── 6-step grid (single column; same card treatment as desktop's
               narrow branch: row layout, orphan-protected full-width text) ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 8,
          width: "min(288px, 90vw)",
          margin: "0 0 0",
          padding: 0,
          boxSizing: "border-box",
        }}>
          {HOW_IT_WORKS_STEPS.map(({ Icon, text }, idx) => (
            <div key={idx} style={{
              borderRadius: 16,
              padding: "12px 14px",
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              background: "rgba(253,248,236,0.92)",
            }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: "var(--dos-bg)", lineHeight: 1 }}>
                  {idx + 1}.
                </span>
                <Icon size={18} color="var(--dos-bg)" strokeWidth={1.5} />
              </div>
              <span style={{
                width: "auto",
                fontSize: 12,
                color: "var(--dos-bg)",
                fontWeight: 600,
                lineHeight: 1.4,
                textAlign: "left",
              }}>{preventLastWordOrphan(text)}</span>
            </div>
          ))}
        </div>

        {/* ── CTAs: join + details (desktop parity, mobile targets) ── */}
        <div style={{ marginTop: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "min(288px, 90vw)" }}>
          <button
            onClick={() => navigate(joinTarget)}
            style={{
              width: "100%", maxWidth: 420,
              background: CANON.cream, color: "var(--dos-bg)", border: "none",
              borderRadius: 9999, padding: "14px 0",
              fontSize: 18, fontWeight: 800, cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {CTA_JOIN_LABEL}
          </button>
          <button
            onClick={() => setShowDetails(true)}
            style={{
              width: "100%", maxWidth: 420,
              background: "transparent", color: CANON.cream,
              border: "2px solid var(--canon-cream,#fef8ea)",
              borderRadius: 9999, padding: "12px 0",
              fontSize: 18, fontWeight: 800, cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {CTA_DETAILS_LABEL}
          </button>
        </div>

        {/* ── Beta-tester pill + letter (desktop parity, shared copy) ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 48, paddingBottom: 96, width: "100%" }}>
          <button
            onClick={() => setBetaOpen(o => !o)}
            style={{
              display: "inline-flex",
              // Stretch the two label spans to the button's full height so the
              // cream fill reaches the pill outline (was a floating stripe).
              alignItems: "stretch",
              borderRadius: 999,
              boxShadow: "0 0 0 2px var(--canon-cream,#fef8ea)",
              border: "none",
              overflow: "hidden",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              gap: 0,
              minHeight: 44,
            }}
          >
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: !betaOpen ? 700 : 400,
              background: !betaOpen ? "var(--dos-border)" : "transparent",
              color: !betaOpen ? "var(--dos-bg)" : "transparent",
              whiteSpace: "nowrap",
            }}>
              {BETA_PILL_CLOSED_MOBILE}
            </span>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: betaOpen ? 700 : 400,
              background: betaOpen ? "var(--dos-border)" : "transparent",
              color: betaOpen ? "var(--dos-bg)" : "transparent",
              whiteSpace: "nowrap",
            }}>
              {BETA_PILL_OPEN}
            </span>
          </button>

          {betaOpen && (
            <div style={{ maxWidth: 690, width: "100%", padding: "0 16px", marginTop: 28, marginBottom: 60, boxSizing: "border-box" }}>
              <div style={{
                background: CANON.cream,
                borderRadius: 12,
                padding: "20px 24px",
                color: "var(--dos-bg)",
                fontSize: 15,
                lineHeight: 1.6,
                fontWeight: 700,
              }}>
                {BETA_LETTER_PARAGRAPHS.map((p, i) => (
                  <React.Fragment key={i}>
                    {p}
                    {i < BETA_LETTER_PARAGRAPHS.length - 1 && <><br /><br /></>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── "Want more details?" — full-screen scrollable surface (mobile
             idiom for desktop's centered overlay card) ── */}
      {showDetails && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 2000,
          background: CANON.personal,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
        }}>
          <Suspense fallback={null}>
            <HowItWorksV2
              onClose={() => setShowDetails(false)}
              onSignup={() => { setShowDetails(false); navigate(joinTarget); }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
