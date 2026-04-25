import React from "react";
import { useAuth } from "../lib/auth";

// S3 — Mobile post-signin landing (room list + new-room search).
// Phase 1 placeholder; real list/search lands in subsequent commits.
export default function MobileRooms() {
  const { user, profile } = useAuth();
  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--dos-bg, #7abd8e)",
      color: "#fff",
      padding: "32px 20px",
      boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>Your rooms</h1>
        <p style={{ fontSize: 14, opacity: 0.85, margin: "0 0 24px" }}>
          {user
            ? `Signed in${profile?.username ? ` as ${profile.username}` : ""}. Room list + show search land in the next commit.`
            : "Not signed in."}
        </p>
      </div>
    </div>
  );
}
