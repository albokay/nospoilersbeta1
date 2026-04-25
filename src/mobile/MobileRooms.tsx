import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, LogOut } from "lucide-react";
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
import SidebarLogo from "../components/SidebarLogo";
import MobileShowSearch, { networkLabel, type TVmazeShow } from "./MobileShowSearch";

type RoomRow = FriendGroup & { lastActivityAt: number };

// Compact relative-time formatter for mobile room list.
function formatRelative(ts: number): string {
  const now = Date.now();
  const delta = Math.max(0, now - ts);
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  const week = 7 * day;
  if (delta < min) return "just now";
  if (delta < hr) return `${Math.floor(delta / min)}m`;
  if (delta < day) return `${Math.floor(delta / hr)}h`;
  if (delta < week) return `${Math.floor(delta / day)}d`;
  if (delta < 30 * day) return `${Math.floor(delta / week)}w`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// S3 — Mobile post-signin landing. Lists the user's friend rooms in
// activity-sorted order (matching desktop ordering via
// fetchAllFriendGroupsWithActivity). TSP demo rooms (show_id = "tsp")
// are filtered out — TSP is the desktop onboarding fixture and doesn't
// belong in the mobile rooms-only experience.
//
// Show search lives at the bottom of the screen, visible whether the user
// has rooms or not. Tapping a result navigates to /m/rooms/new with the
// chosen show in router state. The actual show + room creation happens
// in MobileRoomCreate / the progress gate (S5) — this screen only does
// list + search, no DB writes.
export default function MobileRooms() {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  // Visibility map keyed by groupId. Empty when not yet loaded OR when the
  // migration isn't applied yet — both produce the same render (no indicators).
  const [visibilityByGroup, setVisibilityByGroup] = useState<Record<string, RoomVisibility>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchAllFriendGroupsWithActivity(user.id),
      fetchShows(),
    ])
      .then(([fetchedRooms, fetchedShows]) => {
        if (cancelled) return;
        setRooms(fetchedRooms.filter(r => r.showId !== "tsp"));
        setShows(fetchedShows);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("MobileRooms fetch failed:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Visibility fetch is independent of the rooms list — kicked off in
    // parallel, doesn't gate the list render. If it fails (migration not
    // applied), the map stays empty and no indicators show. Best-effort.
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
  }, [user?.id]);

  const showName = (showId: string) => shows.find(s => s.id === showId)?.name ?? showId;

  const onPickResult = (tv: TVmazeShow) => {
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

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--dos-bg, #7abd8e)",
      color: "#fff",
      padding: "24px 20px 48px",
      boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {/* ── Dynamic logo (block-scatter animation on mount) ── */}
        {/* Scale 0.6 → 168×89 fits comfortably at any mobile width.    */}
        {/* Replays on every mount of MobileRooms (i.e. every entry to  */}
        {/* the rooms list); same behavior as desktop's homepage logo.   */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <SidebarLogo scale={0.6} />
        </div>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 2px" }}>Your rooms</h1>
            {profile?.username && (
              <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>signed in as {profile.username}</p>
            )}
          </div>
          <button
            onClick={async () => { await signOut(); navigate("/m"); }}
            style={{
              background: "transparent",
              color: "#fff",
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              padding: "8px",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "inherit",
              opacity: 0.85,
            }}
            aria-label="Sign out"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>

        {/* ── Room list ── */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "48px 0", fontSize: 14, opacity: 0.85 }}>
            Loading<LoadingDots />
          </div>
        ) : rooms.length === 0 ? (
          <div style={{
            background: "rgba(255,255,255,0.10)",
            border: "2px dashed rgba(255,255,255,0.4)",
            borderRadius: 12,
            padding: "24px 20px",
            textAlign: "center",
            marginBottom: 28,
          }}>
            <p style={{ fontSize: 15, fontWeight: 700, margin: "0 0 6px" }}>No rooms yet</p>
            <p style={{ fontSize: 13, opacity: 0.85, margin: 0, lineHeight: 1.5 }}>
              Find a show below to start your first friend room.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
            {rooms.map(r => (
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
                  padding: "14px 16px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontFamily: "inherit",
                }}
              >
                <div style={{
                  flexShrink: 0,
                  width: 36, height: 36,
                  borderRadius: 999,
                  background: "rgba(0,0,0,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Users size={18} strokeWidth={2} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 15,
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
                <div style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  opacity: 0.6,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {visibilityByGroup[r.id] && roomHasNewVisibleActivity(visibilityByGroup[r.id]) && (
                    <span
                      aria-label="New activity"
                      style={{
                        width: 10, height: 10,
                        borderRadius: 999,
                        background: "#dea838",
                        flexShrink: 0,
                        opacity: 1,
                      }}
                    />
                  )}
                  {formatRelative(r.lastActivityAt)}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Show search ── */}
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.85 }}>
            {rooms.length === 0 ? "Find a show" : "Start another room"}
          </h2>
          <MobileShowSearch onPickResult={onPickResult} />
        </div>
      </div>
    </div>
  );
}
