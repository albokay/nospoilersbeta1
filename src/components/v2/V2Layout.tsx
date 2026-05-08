import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";

type Palette = "journal" | "profile" | "compose";

type V2LayoutProps = {
  palette: Palette;
  pairedHeader?: { left: string; rightLabel: string; rightTo: string };
  children: React.ReactNode;
};

const PALETTE_BG: Record<Palette, string> = {
  journal: "#7abd8e",
  profile: "#dea838",
  compose: "#fef8ea",
};

const PALETTE_INK: Record<Palette, string> = {
  journal: "#ffffff",
  profile: "#ffffff",
  compose: "#1a3a4a",
};

export default function V2Layout({ palette, pairedHeader, children }: V2LayoutProps) {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();

  useEffect(() => {
    const cls = `v2-${palette}-context`;
    document.body.classList.add(cls, "v2-context");
    return () => {
      document.body.classList.remove(cls, "v2-context");
    };
  }, [palette]);

  const ink = PALETTE_INK[palette];
  const inkSoft = palette === "compose" ? "rgba(26,58,74,0.7)" : "rgba(255,255,255,0.85)";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: PALETTE_BG[palette],
        color: ink,
        fontFamily: "Inter, system-ui, sans-serif",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      {/* TOP-RIGHT CLUSTER — mirrors live site (you-pill + sign-out + settings).
          v2-only minimal version; production cluster stays put on non-v2 routes. */}
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
              background: "#355eb8",
              color: "#fff",
              border: "none",
              borderRadius: 999,
              padding: "11px 20px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(53,94,184,0.3)",
            }}
          >
            you are {profile.username}
          </button>
        ) : (
          <button
            onClick={() => navigate("/")}
            style={{
              background: "rgba(255,255,255,0.85)",
              color: "#1a3a4a",
              border: "none",
              borderRadius: 999,
              padding: "11px 20px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
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
              width: 38,
              height: 38,
              borderRadius: "50%",
              border: `1.5px solid ${palette === "compose" ? "rgba(26,58,74,0.4)" : "rgba(255,255,255,0.6)"}`,
              background: "transparent",
              color: ink,
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ⏻
          </button>
        )}
      </div>

      {/* MAIN STAGE */}
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
              marginBottom: 28,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: ink,
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
                color: inkSoft,
                textDecoration: "none",
                borderBottom: `1px dotted ${palette === "compose" ? "rgba(26,58,74,0.4)" : "rgba(255,255,255,0.55)"}`,
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
    </div>
  );
}
