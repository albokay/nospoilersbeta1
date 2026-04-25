import React from "react";
import { useNavigate } from "react-router-dom";

// /m/rooms/:groupId/thread/:threadId — single-thread view.
// Phase 1 chunk 5: placeholder. Real component (full thread body + visible
// responses + respond affordance in Phase 2) lands in chunk 6.
export default function MobileThread({ groupId, threadId }: { groupId: string; threadId: string }) {
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
      gap: 16,
    }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, textAlign: "center" }}>Thread view</h1>
      <p style={{ fontSize: 13, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
        Routing works — full thread body + responses land in the next commit.
      </p>
      <p style={{ fontSize: 11, opacity: 0.55, margin: 0, fontFamily: "monospace" }}>
        thread: {threadId}
      </p>
      <button
        onClick={() => navigate(`/m/rooms/${groupId}`)}
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
        ← Back to room
      </button>
    </div>
  );
}
