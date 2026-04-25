import React from "react";
import { useNavigate } from "react-router-dom";
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
export default function MobileNarrative() {
  const navigate = useNavigate();

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
      </div>
    </div>
  );
}
