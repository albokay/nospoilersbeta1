import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { LogOut } from "lucide-react";
import FeedbackWidget from "../FeedbackWidget";

type Palette = "journal" | "profile" | "compose";

type V2LayoutProps = {
  palette: Palette;
  pairedHeader?: { left: string; rightLabel: string; rightTo: string };
  // When true, V2Layout skips its centered max-width <main> and renders
  // children directly. Used by surfaces that manage their own page
  // geometry — e.g. V2JournalPage's fixed left rail + flowing main column.
  bareMain?: boolean;
  children: React.ReactNode;
};

// V2 palette strategy:
//  - "journal"   → default body palette (green via --dos-bg, set in theme.ts).
//                  No body class, no inline bg override.
//  - "profile"   → toggle body.public-context (mustard) — the existing class
//                  used by the live public space, so all theme tokens flip.
//  - "compose"   → cream paint, applied as body bg via a v2-only class.
export default function V2Layout({ palette, pairedHeader, bareMain, children }: V2LayoutProps) {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();

  useEffect(() => {
    const cls =
      palette === "profile" ? "public-context"
      : palette === "compose" ? "v2-compose-context"
      : null;
    if (cls) document.body.classList.add(cls);
    // has-header flips the body gradient so the lighter band sits at the
    // bottom — the live site toggles this in AppShell for every non-
    // homepage route. v2 sits outside AppShell, so we toggle it here.
    document.body.classList.add("has-header");
    return () => {
      if (cls) document.body.classList.remove(cls);
      document.body.classList.remove("has-header");
    };
  }, [palette]);

  return (
    <div style={{ minHeight: "100vh", position: "relative" }}>
      {/* Compose-palette bg paint — kept inline so we don't grow theme.ts */}
      {palette === "compose" && (
        <style>{`body.v2-compose-context{background:#fef8ea !important}`}</style>
      )}

      {/* TOP-RIGHT CLUSTER — minimal v2 mirror of the live header.
          2px borders to match site convention. */}
      <div
        style={{
          position: "fixed",
          top: 28,
          right: 36,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {user && profile ? (
          <button
            onClick={() => navigate("/v2/journal")}
            style={{
              background: "var(--dos-user)",
              color: "#fff",
              border: "none",
              borderRadius: 9999,
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              height: 34,
            }}
          >
            you are {profile.username}
          </button>
        ) : (
          <button
            onClick={() => navigate("/")}
            style={{
              background: "var(--dos-bg)",
              color: "var(--dos-fg)",
              border: "2px solid var(--dos-border)",
              borderRadius: 9999,
              padding: "6px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              height: 34,
            }}
          >
            sign in
          </button>
        )}
        {user && (
          <button
            onClick={() => signOut()}
            title="Sign out"
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "2px solid var(--dos-border)",
              background: "transparent",
              color: "var(--dos-fg)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LogOut size={15} />
          </button>
        )}
      </div>

      {bareMain ? (
        children
      ) : (
        <main
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "100px 48px 120px",
          }}
        >
          {pairedHeader && (
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 18,
                marginBottom: 24,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  color: "var(--dos-fg)",
                  letterSpacing: "-0.005em",
                }}
              >
                {pairedHeader.left}
              </div>
              <a
                href={pairedHeader.rightTo}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(pairedHeader.rightTo);
                }}
                style={{
                  fontFamily: "Lora, Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 16,
                  color: "var(--dos-gray)",
                  textDecoration: "none",
                  borderBottom: "1px dotted var(--dos-gray)",
                  paddingBottom: 1,
                  cursor: "pointer",
                }}
              >
                → {pairedHeader.rightLabel}
              </a>
            </div>
          )}

          {children}
        </main>
      )}

      {/* feedback tab — always available across v2 surfaces. Same component
          + same backing store as live; isMobile=false because v2 is
          desktop-only (mobile lockout still routes <768px to /m). */}
      <FeedbackWidget isMobile={false} />
    </div>
  );
}
