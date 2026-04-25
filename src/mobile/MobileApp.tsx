import React from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

// Mobile entry point. Mounts on any path under /m/* via the top-level <App>
// router in src/App.tsx. Bypasses the desktop mobile lockout automatically
// because <App>'s early-return block fires before <AppShell> (where the
// lockout gate lives) is ever reached.
//
// Phase 0 skeleton: proves /m/* routing, shared auth context, and lockout
// bypass. Real mobile flows (S1–S8 from the design proposal) build on top
// of this in subsequent phases.
export default function MobileApp() {
  const location = useLocation();
  const { user, profile, loading: authLoading } = useAuth();

  // Strip the /m prefix to derive the mobile-internal path. Sub-routes
  // (auth, rooms, rooms/:id, invite/:token) parse off this string in later
  // phases. For Phase 0 we only echo it back.
  const mobilePath = location.pathname.replace(/^\/m/, "") || "/";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0e0e10",
        color: "#fff",
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
        padding: "32px 20px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
          Sidebar Mobile
        </h1>
        <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 24 }}>
          Phase 0 preview — build in progress.
        </p>
        <div
          style={{
            background: "#1a1a1d",
            border: "1px solid #2a2a2e",
            borderRadius: 8,
            padding: 16,
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <div>
            <strong style={{ opacity: 0.6 }}>path:</strong>{" "}
            <code>{mobilePath}</code>
          </div>
          <div>
            <strong style={{ opacity: 0.6 }}>auth:</strong>{" "}
            {authLoading
              ? "loading…"
              : user
                ? `signed in${profile?.username ? ` as ${profile.username}` : ""}`
                : "signed out"}
          </div>
          <div>
            <strong style={{ opacity: 0.6 }}>viewport:</strong>{" "}
            {window.innerWidth} × {window.innerHeight}
          </div>
        </div>
      </div>
    </div>
  );
}
