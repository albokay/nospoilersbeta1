import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import MobileNarrative from "./MobileNarrative";
import MobileAuth from "./MobileAuth";
import MobileRooms from "./MobileRooms";

// Mobile entry point. Mounts on any path under /m/* via the top-level <App>
// router in src/App.tsx. Bypasses the desktop mobile lockout automatically
// because <App>'s early-return block fires before <AppShell> (where the
// lockout gate lives) is ever reached.
//
// Sub-routes (parsed off the /m prefix):
//   /m                              → narrative + sign-in CTA (signed out)
//                                     | redirect to /m/rooms (signed in)
//   /m/auth                         → full-screen sign-in / create-account
//   /m/rooms                        → room list (S3)
//   /m/rooms/:groupId/progress      → progress gate (S5 — placeholder)
//   /m/rooms/:groupId               → room view (S6 — placeholder)
//
// Auto-redirect rule: signed-in users on bare /m get bounced to /m/rooms so
// they don't have to scroll past the narrative pitch every time. Mirrors the
// desktop redirect rule for signed-in non-admins on / → /profile.
export default function MobileApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const subPath = location.pathname.replace(/^\/m/, "") || "/";
  const subParts = subPath.split("/").filter(Boolean);

  useEffect(() => {
    if (authLoading) return;
    if (user && subPath === "/") navigate("/m/rooms", { replace: true });
  }, [user, authLoading, subPath, navigate]);

  if (subParts[0] === "auth") return <MobileAuth />;
  if (subParts[0] === "rooms" && subParts[1] && subParts[2] === "progress") {
    return <RoomSubrouteStub groupId={subParts[1]} variant="progress" />;
  }
  if (subParts[0] === "rooms" && subParts[1]) {
    return <RoomSubrouteStub groupId={subParts[1]} variant="room" />;
  }
  if (subParts[0] === "rooms") return <MobileRooms />;
  return <MobileNarrative />;
}

// Inline placeholder for /m/rooms/:groupId{/progress}. Real components
// (MobileProgressGate, MobileRoom) replace these when chunks 4 and 5 land.
// Kept inline rather than as separate files because it's transient
// scaffolding — moving it earns nothing and adds two files we'd just
// delete in the next chunks.
function RoomSubrouteStub({ groupId, variant }: { groupId: string; variant: "progress" | "room" }) {
  const navigate = useNavigate();
  const label = variant === "progress" ? "Progress gate" : "Room view";
  const next = variant === "progress" ? "MobileProgressGate (S5)" : "MobileRoom (S6, read-only)";
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
      gap: 16,
    }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, textAlign: "center" }}>{label}</h1>
      <p style={{ fontSize: 13, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
        Routing works — {next} lands in a later commit.
      </p>
      <p style={{ fontSize: 11, opacity: 0.55, margin: 0, fontFamily: "monospace" }}>
        groupId: {groupId}
      </p>
      <button
        onClick={() => navigate("/m/rooms")}
        style={{
          marginTop: 8,
          background: "transparent",
          color: "#fff",
          border: "2px solid #fff",
          borderRadius: 9999,
          padding: "10px 24px",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        ← Back to rooms
      </button>
    </div>
  );
}
