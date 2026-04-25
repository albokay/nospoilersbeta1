import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Users, UserPlus, LogOut, ClipboardList } from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  fetchAllFriendGroupsWithActivity,
  fetchShows,
  fetchRoomActivityVisibility,
  roomHasNewVisibleActivity,
} from "../lib/db";
import type { Show, RoomVisibility } from "../lib/db";
import type { FriendGroup } from "../types";
import LoadingDots from "../components/LoadingDots";
import MobileShowSearch, { networkLabel, type TVmazeShow } from "./MobileShowSearch";

type RoomRow = FriendGroup & { lastActivityAt: number };

// S7 — Fullscreen room dropdown. Triggered by the chevron next to the
// room name on <MobileRoom />.
//
// Section order (top → bottom):
//   1. Invite a friend — opens MobileInvite for the current room. Top
//      placement since it's the most action-y of the three sections;
//      a user opening the menu often does so to invite someone. The
//      empty-room invite button on <MobileRoom /> still covers the
//      "alone" case prominently; this is the universal entry point.
//   2. Find a show — same TVMaze search as the room list's bottom
//      search. Tap result → /m/rooms/new (progress gate, new mode).
//   3. Switch rooms — list of OTHER rooms the user is in (current
//      room excluded; TSP filtered same as MobileRooms). Tap →
//      progress gate for that room → enter.
//   4. Sign out — bottom anchor, mirrors the rooms-list top-right
//      sign-out as a redundant entry point. Both surfaces remain
//      because signout is critical and never bad to have multiple
//      paths to.
//
// Routed (not modal) so the back button closes the menu cleanly without
// popstate gymnastics. Same pattern as the rest of /m's screens.
export default function MobileRoomMenu({ groupId }: { groupId: string }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [currentRoom, setCurrentRoom] = useState<RoomRow | null>(null);
  const [otherRooms, setOtherRooms] = useState<RoomRow[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [visibilityByGroup, setVisibilityByGroup] = useState<Record<string, RoomVisibility>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetchAllFriendGroupsWithActivity(user.id),
      fetchShows(),
    ])
      .then(([rooms, fetchedShows]) => {
        if (cancelled) return;
        const cur = rooms.find(r => r.id === groupId);
        if (!cur) { setLoadError("not_member"); return; }
        // Same exclusion rules as MobileRooms: current room out, TSP out.
        const others = rooms.filter(r => r.id !== groupId && r.showId !== "tsp");
        setCurrentRoom(cur);
        setOtherRooms(others);
        setShows(fetchedShows);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("MobileRoomMenu fetch failed:", err);
        setLoadError("fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Visibility fetch in parallel; failure is silent (no indicators) per
    // the same graceful-degradation pattern used in MobileRooms.
    fetchRoomActivityVisibility(user.id)
      .then(rows => {
        if (cancelled) return;
        const map: Record<string, RoomVisibility> = {};
        for (const r of rows) map[r.groupId] = r;
        setVisibilityByGroup(map);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("Room visibility fetch failed (migration may not be applied):", err);
      });

    return () => { cancelled = true; };
  }, [groupId, user?.id]);

  const showName = (showId: string) => shows.find(s => s.id === showId)?.name ?? showId;

  const onPickSearchResult = (tv: TVmazeShow) => {
    navigate("/m/rooms/new", {
      state: {
        selectedShow: {
          name: tv.name,
          tvmazeId: tv.id,
          networkLabel: networkLabel(tv),
        },
      },
    });
  };

  const close = () => navigate(`/m/rooms/${groupId}`);

  // ── Render ──

  const wrapper: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--dos-bg, #7abd8e)",
    color: "#fff",
    padding: "20px 20px 48px",
    boxSizing: "border-box",
  };

  if (loading) {
    return (
      <div style={{ ...wrapper, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 14, opacity: 0.85 }}>Loading<LoadingDots /></span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ ...wrapper, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ fontSize: 14, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320 }}>
          {loadError === "not_member"  && "You're not in this room."}
          {loadError === "fetch_failed" && "Couldn't load. Try again."}
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
    <div style={wrapper}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {/* ── Header (close + current room name) ── */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
          gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              opacity: 0.7,
              marginBottom: 2,
            }}>
              Currently in
            </div>
            <div style={{
              fontSize: 18,
              fontWeight: 800,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {currentRoom?.name}
            </div>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            style={{
              flexShrink: 0,
              width: 40, height: 40,
              borderRadius: 9999,
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "inherit",
            }}
          >
            <X size={22} strokeWidth={2.4} />
          </button>
        </div>

        {/* ── Section 1: Update progress ── */}
        {/* Routes to MobileProgressGate in `existing` mode for the
            current room. Top-of-menu placement because watch progress
            is the most-changed user state — easy to bump from here
            without leaving the room context. */}
        <h2 style={sectionLabelStyle}>Update progress</h2>
        <button
          onClick={() => navigate(`/m/rooms/${groupId}/progress`)}
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 15,
            fontWeight: 800,
            fontFamily: "inherit",
            background: "#fff",
            color: "var(--dos-bg, #2a4a36)",
            border: "none",
            borderRadius: 9999,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginBottom: 32,
          }}
        >
          <ClipboardList size={18} strokeWidth={2.2} />
          Update your watch progress
        </button>

        {/* ── Section 2: Invite friends to current room ── */}
        <h2 style={sectionLabelStyle}>Invite</h2>
        <button
          onClick={() => navigate(`/m/rooms/${groupId}/invite`)}
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 15,
            fontWeight: 800,
            fontFamily: "inherit",
            background: "#fff",
            color: "var(--dos-bg, #2a4a36)",
            border: "none",
            borderRadius: 9999,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginBottom: 32,
          }}
        >
          <UserPlus size={18} strokeWidth={2.2} />
          Invite a friend to {currentRoom?.name}
        </button>

        {/* ── Section 2: Find a show ── */}
        <h2 style={sectionLabelStyle}>Find a show</h2>
        <div style={{ marginBottom: 32 }}>
          <MobileShowSearch onPickResult={onPickSearchResult} />
        </div>

        {/* ── Section 3: Switch rooms ── */}
        <h2 style={sectionLabelStyle}>Switch rooms</h2>
        {otherRooms.length === 0 ? (
          <div style={{
            background: "rgba(255,255,255,0.08)",
            border: "2px dashed rgba(255,255,255,0.3)",
            borderRadius: 12,
            padding: "16px",
            fontSize: 13,
            opacity: 0.85,
            textAlign: "center",
            marginBottom: 32,
          }}>
            You don&rsquo;t have any other rooms yet. Find a show above to start one.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
            {otherRooms.map(r => (
              <button
                key={r.id}
                onClick={() => navigate(`/m/rooms/${r.id}/progress`)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "rgba(255,255,255,0.95)",
                  color: "var(--dos-bg, #2a4a36)",
                  border: "none",
                  borderRadius: 12,
                  padding: "12px 14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontFamily: "inherit",
                }}
              >
                <div style={{
                  flexShrink: 0,
                  width: 32, height: 32,
                  borderRadius: 999,
                  background: "rgba(0,0,0,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Users size={16} strokeWidth={2} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14,
                    fontWeight: 700,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {r.name}
                  </div>
                  <div style={{
                    fontSize: 12,
                    opacity: 0.7,
                    marginTop: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {showName(r.showId)}
                  </div>
                </div>
                {visibilityByGroup[r.id] && roomHasNewVisibleActivity(visibilityByGroup[r.id]) && (
                  <span
                    aria-label="New activity"
                    style={{
                      flexShrink: 0,
                      width: 10, height: 10,
                      borderRadius: 999,
                      background: "#dea838",
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Section 4: Sign out ── */}
        {/* Anchored at the bottom of the menu. Mirrors the rooms-list */}
        {/* top-right sign-out — both surfaces coexist as redundant     */}
        {/* entry points per user spec.                                  */}
        <button
          onClick={async () => {
            await signOut();
            navigate("/m");
          }}
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "inherit",
            background: "transparent",
            color: "#fff",
            border: "2px solid rgba(255,255,255,0.4)",
            borderRadius: 9999,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            opacity: 0.9,
          }}
        >
          <LogOut size={16} strokeWidth={2.2} />
          Sign out
        </button>
      </div>
    </div>
  );
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  opacity: 0.85,
  margin: "0 0 10px",
};
