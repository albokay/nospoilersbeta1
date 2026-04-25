import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Tv } from "lucide-react";

// /m/rooms/new — shown after tapping a search result. Receives the chosen
// show via router state.
//
// Phase 1 (3b/N): placeholder. Renders the chosen show + a stub for the
// "Create a room" flow. The actual creation (createShow + createFriendGroup
// + upsertProgress + markTabCreated → enter the new room) lands in chunk 4
// alongside MobileProgressGate (S5), because progress is part of the
// creation step per spec ("Tapping it immediately leads to a watch
// progress updater. The user cannot proceed without setting their
// progress.").
//
// If the user lands here without router state (e.g. refresh), we route
// them back to /m/rooms — there's nothing to act on.
export default function MobileRoomCreate() {
  const navigate = useNavigate();
  const location = useLocation();
  const selected = (location.state as any)?.selectedShow as
    | { name: string; tvmazeId?: number; networkLabel?: string }
    | undefined;

  if (!selected) {
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
        <p style={{ fontSize: 14, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320 }}>
          No show selected. Search for a show to start a room.
        </p>
        <button
          onClick={() => navigate("/m/rooms", { replace: true })}
          style={{
            background: "transparent", color: "#fff",
            border: "2px solid #fff",
            borderRadius: 9999, padding: "10px 24px",
            fontSize: 14, fontWeight: 700, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ← Back to rooms
        </button>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--dos-bg, #7abd8e)",
      color: "#fff",
      padding: "24px 20px 48px",
      boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <button
          onClick={() => navigate("/m/rooms")}
          style={{
            background: "transparent", color: "#fff",
            border: "none",
            fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit", opacity: 0.85,
            padding: "8px 0", marginBottom: 16,
          }}
        >
          ← Back
        </button>

        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>Create a room</h1>
        <p style={{ fontSize: 14, opacity: 0.85, margin: "0 0 24px" }}>
          A new friend room about:
        </p>

        {/* ── Selected show card ── */}
        <div style={{
          background: "rgba(255,255,255,0.95)",
          color: "var(--dos-bg, #2a4a36)",
          borderRadius: 12,
          padding: "16px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 24,
        }}>
          <div style={{
            flexShrink: 0,
            width: 44, height: 44,
            borderRadius: 10,
            background: "rgba(0,0,0,0.06)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Tv size={22} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>
              {selected.name}
            </div>
            {selected.networkLabel && (
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                {selected.networkLabel}
              </div>
            )}
          </div>
        </div>

        {/* ── Stub: progress gate is the next chunk ── */}
        <div style={{
          background: "rgba(255,255,255,0.10)",
          border: "2px dashed rgba(255,255,255,0.4)",
          borderRadius: 12,
          padding: "20px 16px",
          textAlign: "center",
        }}>
          <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 6px" }}>
            Set your watch progress
          </p>
          <p style={{ fontSize: 13, opacity: 0.85, margin: 0, lineHeight: 1.5 }}>
            The progress picker (S5) lands in the next commit. Once it's in place,
            confirming progress here will create the show + room and drop you
            inside.
          </p>
        </div>
      </div>
    </div>
  );
}
