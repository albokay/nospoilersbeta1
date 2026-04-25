import React from "react";
import { useNavigate } from "react-router-dom";

// S2 — Mobile auth screen. Phase 1 placeholder; full sign-in / create-account
// form (mirroring AuthModal flow with mobile-friendly UI) lands in the next
// commit.
export default function MobileAuth() {
  const navigate = useNavigate();
  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--dos-bg, #7abd8e)",
      color: "#fff",
      padding: "32px 20px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 24,
    }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, textAlign: "center" }}>Sign in</h1>
      <p style={{ fontSize: 14, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320 }}>
        Mobile auth screen — building next. The existing auth flow (Supabase signIn / signUp) is intact; only the UI is being rebuilt for mobile.
      </p>
      <button
        onClick={() => navigate("/m")}
        style={{
          background: "transparent", color: "#fff",
          border: "2px solid #fff",
          borderRadius: 9999, padding: "10px 24px",
          fontSize: 14, fontWeight: 700, cursor: "pointer",
        }}
      >
        Back
      </button>
    </div>
  );
}
