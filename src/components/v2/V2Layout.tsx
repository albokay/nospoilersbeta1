import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { LogOut, ChevronDown } from "lucide-react";
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

  // Account dropdown — opened via the profile pill. Currently holds just
  // "sign out"; future entries (edit profile, settings, etc.) slot in here
  // when those flows land. Portaled to body + anchored via getBoundingClientRect
  // so the menu can't be clipped by ancestors with overflow:hidden.
  const accountBtnRef = useRef<HTMLButtonElement | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountMenuPos, setAccountMenuPos] = useState<{ top: number; right: number } | null>(null);

  function toggleAccountMenu() {
    if (accountMenuOpen) {
      setAccountMenuOpen(false);
      return;
    }
    const rect = accountBtnRef.current?.getBoundingClientRect();
    if (rect) {
      // Right-align dropdown to the pill's right edge.
      setAccountMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    setAccountMenuOpen(true);
  }

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

      {/* TOP-RIGHT — single profile pill that doubles as the account
          dropdown trigger. Dedicated sign-out icon removed; sign-out
          lives inside the dropdown alongside future account actions. */}
      <div
        style={{
          position: "fixed",
          top: 24,
          right: 32,
          zIndex: 20,
        }}
      >
        {user && profile ? (
          <button
            ref={accountBtnRef}
            onClick={toggleAccountMenu}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            style={{
              background: "var(--dos-user)",
              color: "#fff",
              border: "none",
              borderRadius: 9999,
              padding: "0 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              height: 32,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            you are {profile.username}
            <ChevronDown size={14} />
          </button>
        ) : (
          <button
            onClick={() => navigate("/")}
            style={{
              background: "var(--dos-bg)",
              color: "var(--dos-fg)",
              border: "2px solid var(--dos-border)",
              borderRadius: 9999,
              padding: "0 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              height: 32,
            }}
          >
            sign in
          </button>
        )}
      </div>

      {/* Account dropdown — portaled, right-aligned to the pill. Currently
          holds sign-out; future items (edit profile / settings / etc.) slot
          in as additional buttons in the same column. */}
      {accountMenuOpen && accountMenuPos && createPortal(
        <>
          <div
            onClick={() => setAccountMenuOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 60 }}
            aria-hidden
          />
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: accountMenuPos.top,
              right: accountMenuPos.right,
              minWidth: 200,
              background: "var(--dos-bg)",
              border: "2px solid #fff",
              padding: 8,
              zIndex: 61,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <button
              role="menuitem"
              onClick={() => {
                setAccountMenuOpen(false);
                signOut();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: "8px 12px",
                color: "var(--dos-fg)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                borderRadius: 0,
              }}
            >
              <LogOut size={14} /> sign out
            </button>
          </div>
        </>,
        document.body
      )}

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
