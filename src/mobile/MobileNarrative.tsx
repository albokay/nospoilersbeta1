import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DoorOpen, UserPlus, ClipboardList, MessageSquareText, Blend, ShieldCheck } from "lucide-react";
import HomepageNarrative from "../components/HomepageNarrative";

// S1 — Mobile homepage narrative scroll for signed-out users.
//
// Reuses the existing <HomepageNarrative /> for the parallax bubble pitch
// (already responsive via vw units). Below it, mirrors the desktop hero
// headline + 6-step feature grid + sign-in CTA — minus the "Want more
// details?" button (dropped per spec) and plus a mobile-only callout
// ("full experience is on desktop") right before the CTA.
//
// Sign-in CTA routes to /m/auth (full-screen mobile auth, S2). Existing
// auth flow is unchanged; only the UI is mobile-friendly.
//
// hideBottom: drops the "desktop-only" callout + the "Join / sign in"
// CTA. Used by MobileInviteAccept to wrap the narrative pitch with its
// own invite-specific accept flow at the bottom (per spec: invitees see
// "a version of the homepage narrative scroll, with an 'accept invite'
// button and flow at the bottom"). Default behavior — `hideBottom`
// omitted — is the standard signed-out homepage.
export default function MobileNarrative({ hideBottom = false }: { hideBottom?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();

  // The fixed top-left "Sign in" button routes to /m/auth, with returnTo
  // preserved when the narrative is wrapped inside the invite-accept flow.
  // Without the dynamic returnTo, an invitee tapping the top-left button
  // would lose the invite context (auth success → /m/rooms instead of
  // back to /m/invite/:token where they can hit Join). The bottom invite
  // CTA remains the primary entry point on the invite path; the top-left
  // button is a redundant shortcut that still works correctly.
  const onInvitePath = location.pathname.startsWith("/m/invite/");
  const signInTarget = onInvitePath
    ? `/m/auth?returnTo=${encodeURIComponent(location.pathname)}`
    : "/m/auth";

  const items: { Icon: React.ElementType; text: React.ReactNode }[] = [
    { Icon: DoorOpen,          text: "Find the show you\u2019re watching and create a room." },
    { Icon: UserPlus,          text: "Invite friends you love talking to." },
    { Icon: ClipboardList,     text: "Everyone logs their watch progress every time they sign in. Sidebar tags all writing to each user\u2019s logged progress." },
    { Icon: MessageSquareText, text: "Post your thoughts without worrying about spoilers \u2014 as if your friends have watched just as far as you have." },
    { Icon: Blend,             text: (<>Sidebar filters everything according to<br />everyone&rsquo;s unique watch progress.</>) },
    { Icon: ShieldCheck,       text: "Nothing you read is ever ahead of where you are." },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--dos-bg, #7abd8e)", color: "#fff" }}>
      {/* ── Fixed top-left sign-in shortcut ── */}
      {/* z-index 100 keeps it above the parallax narrative's fixed-position */}
      {/* AnimatedLogo (z-index 96 in HomepageNarrative). */}
      <button
        onClick={() => navigate(signInTarget)}
        style={{
          position: "fixed",
          top: 14,
          left: 14,
          zIndex: 100,
          background: "transparent",
          color: "#fff",
          border: "2px solid #fff",
          borderRadius: 9999,
          padding: "8px 18px",
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

      {/* ── Hero headline ── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 0, paddingBottom: 24 }}>
        <p style={{
          maxWidth: 560, textAlign: "center",
          margin: "80px 16px 40px",
          fontSize: 20, fontWeight: 800,
          color: "#fff", lineHeight: 1.3,
        }}>
          Watching TV with friends usually<br />
          means spoilers or keeping quiet.<br />
          <em>Not on Sidebar.</em>
        </p>

        <p style={{
          fontSize: 20, fontWeight: 800,
          color: "#fff", margin: "8px 16px 40px", textAlign: "center",
        }}>
          Here&rsquo;s how it works:
        </p>

        {/* ── 6-item feature grid (mobile single-column) ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 8,
          width: "min(288px, 90vw)",
          margin: "0 0 0",
          padding: 0,
          boxSizing: "border-box",
        }}>
          {items.map(({ Icon, text }, idx) => (
            <div key={idx} style={{
              borderRadius: 16,
              padding: "12px 14px",
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              background: "rgba(255,255,255,0.92)",
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
                textWrap: "balance" as React.CSSProperties["textWrap"],
              }}>{text}</span>
            </div>
          ))}
        </div>

        {!hideBottom && (
          <>
            {/* ── Mobile-only callout ── */}
            <div style={{
              marginTop: 32,
              width: "min(288px, 90vw)",
              padding: "14px 16px",
              borderRadius: 12,
              border: "2px solid #fff",
              background: "transparent",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.5,
              textAlign: "center",
              textWrap: "balance" as React.CSSProperties["textWrap"],
            }}>
              Sidebar&rsquo;s full experience is on desktop —<br />
              mobile is for your friend rooms only.
            </div>

            {/* ── CTA: sign in / create account (single button — auth screen toggles modes) ── */}
            <div style={{ marginTop: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "min(288px, 90vw)" }}>
              <button
                onClick={() => navigate("/m/auth")}
                style={{
                  width: "100%", maxWidth: 420,
                  background: "#fff", color: "var(--dos-bg)", border: "none",
                  borderRadius: 9999, padding: "14px 0",
                  fontSize: 18, fontWeight: 800, cursor: "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                Join / sign in
              </button>
            </div>

            <div style={{ height: 64 }} />
          </>
        )}
      </div>
    </div>
  );
}
