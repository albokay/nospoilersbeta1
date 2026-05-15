import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, Settings, SquarePen, Users } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabaseClient";
import {
  fetchGroupThreads,
  fetchProgress,
  fetchRoomMapData,
  fetchShows,
  type RoomMapMember,
  type Show,
} from "../../lib/db";
import type { FriendGroup, Thread } from "../../types";
import type { ProgressEntry } from "../../types";
import { effectiveProgress } from "../../lib/utils";
import V2Layout from "./V2Layout";
import V2RoomFeed, {
  type V2RoomFeedEntry,
  type V2RoomFeedHandle,
} from "./V2RoomFeed";
import V2RoomMap, { type V2RoomMapMember } from "./V2RoomMap";
import V2GroupSettingsModal from "./V2GroupSettingsModal";
import LoadingDots from "../LoadingDots";
import OneSelectProgress from "../OneSelectProgress";
import { navigateToShow } from "./v2nav";

// V2 friend room page at /v2/room/:groupId. Two-pane layout: feed of entry
// tickets on the left/center, season map on the right. Coordinated by
// click — map cell → feed scrolls to ticket + flashes the highlight.
//
// Header is a port of the live friend-room banner in ShowSection.tsx (room
// name + Users icon + Settings gear, "to public conversation" link, write
// button, watch-progress pill). Cross-side chrome (logo, sign-out, identity
// pill) comes from V2Layout — palette="room" flips the body to
// group-context and toggles the identity pill into "go to your journal"
// navigation mode.
//
// Settings gear opens a placeholder modal for now; the real
// V2GroupSettingsModal lands in checkpoint 5b (members list, rename,
// invite-by-email, leave room).

export default function V2FriendRoomPage({ groupId }: { groupId: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [room, setRoom] = useState<FriendGroup | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [progressForShow, setProgressForShow] = useState<ProgressEntry | null>(null);
  const [feedEntries, setFeedEntries] = useState<V2RoomFeedEntry[]>([]);
  const [mapMembers, setMapMembers] = useState<V2RoomMapMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const feedRef = useRef<V2RoomFeedHandle>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Default to descending — newest episode tag at the top of the feed.
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Bootstrap — fetch room, show, progress, group threads (feed), and the
  // RPC-backed map data (members + ratings + entries) in one effect.
  useEffect(() => {
    if (!user?.id || !groupId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        // 1) Room row first — we need show_id before we can fan out.
        const { data: roomRow, error: roomErr } = await supabase
          .from("friend_groups")
          .select("id, show_id, name, created_by, created_at, deleted_at")
          .eq("id", groupId)
          .maybeSingle();
        if (roomErr) throw roomErr;
        if (!roomRow) throw new Error("room not found");
        if (roomRow.deleted_at) throw new Error("this room no longer exists");
        const fg: FriendGroup = {
          id: roomRow.id,
          showId: roomRow.show_id,
          name: roomRow.name,
          createdBy: roomRow.created_by,
          createdAt: new Date(roomRow.created_at).getTime(),
        };

        // 2) Parallel: show catalog, viewer's progress, map RPC.
        const [allShows, progressMap, roomMapData] = await Promise.all([
          fetchShows(),
          fetchProgress(user.id),
          fetchRoomMapData(groupId),
        ]);
        const showRow = allShows.find((s) => s.id === fg.showId) ?? null;
        const progress = progressMap[fg.showId] ?? null;
        const eff = effectiveProgress(progress);

        // 3) Feed — spoiler-filtered against viewer's effective progress.
        const groupResult = eff
          ? await fetchGroupThreads(groupId, eff.s, eff.e, user.id)
          : { threads: [] as Thread[], replyCounts: {} as Record<string, number>, latestVisibleReplyAt: {} };

        const departedUsernames = new Set(
          roomMapData.filter((m) => m.isDeparted).map((m) => m.username ?? "").filter(Boolean),
        );

        const entries: V2RoomFeedEntry[] = groupResult.threads
          .filter((t) => !t.isDeleted)
          .map((t) => ({
            threadId: t.id,
            s: t.season,
            e: t.episode,
            title: t.titleBase,
            body: t.body,
            preview: t.preview,
            // Thread doesn't expose author_id today; SidebarAvatar seeds by
            // username so the empty string is harmless.
            authorId: "",
            authorUsername: t.author,
            isRewatch: t.isRewatch,
            rewatchS: t.rewatchS,
            rewatchE: t.rewatchE,
            isEdited: t.isEdited,
            isDeparted: departedUsernames.has(t.author),
            updatedAt: t.updatedAt,
            replyCount: groupResult.replyCounts[t.id] ?? 0,
            // Full thread object — V2InlineThread mounts on expand and
            // expects the Thread shape (not the lean entry projection).
            thread: t,
          }));

        const mapMembersOut: V2RoomMapMember[] = roomMapData.map((m: RoomMapMember) => ({
          userId: m.userId,
          username: m.username ?? "?",
          isDeparted: m.isDeparted,
          progress: m.progress,
          ratings: m.ratings,
          entries: m.entries.map((e) => ({
            threadId: e.threadId,
            s: e.s,
            e: e.e,
            title: e.title,
          })),
        }));

        if (cancelled) return;
        setRoom(fg);
        setShow(showRow);
        setProgressForShow(progress);
        setFeedEntries(entries);
        setMapMembers(mapMembersOut);
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg =
          (err as { message?: string })?.message ??
          "couldn't load this room";
        console.warn("V2FriendRoomPage bootstrap failed:", err);
        setLoadError(msg);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, user?.id]);

  // Ticket open → live thread inside this room's context.
  const handleOpenThread = useCallback(
    (threadId: string) => {
      if (!show) return;
      navigateToShow(navigate, show.id, { threadId, activeGroupId: groupId });
    },
    [navigate, show, groupId],
  );

  // Map cell click → scroll the feed to the ticket and flash highlight.
  const handleCellClick = useCallback((threadId: string) => {
    feedRef.current?.scrollToEntry(threadId);
  }, []);

  const handleWrite = useCallback(() => {
    if (!show) return;
    navigate(`/v2/compose/${show.id}`);
  }, [navigate, show]);

  const handleToPublic = useCallback(() => {
    if (!show) return;
    navigateToShow(navigate, show.id);
  }, [navigate, show]);

  // Progress update from the watch-progress pill.
  const handleProgressConfirm = useCallback(
    (val: { s: number; e: number }) => {
      if (!user?.id || !show) return;
      // Use raw supabase update for now — same shape as upsertProgress in
      // db.ts. Full update flow with rewatch transitions lives in App.tsx;
      // for a friend-room page the simple case is enough since this surface
      // is constrained to in-show progress moves.
      supabase
        .from("progress")
        .upsert(
          { user_id: user.id, show_id: show.id, season: val.s, episode: val.e },
          { onConflict: "user_id,show_id" },
        )
        .then(() => {
          // Update local state so the map's spine + masked tooltips refresh
          // without a full reload.
          setProgressForShow((prev) =>
            prev ? { ...prev, s: val.s, e: val.e } : { s: val.s, e: val.e },
          );
        });
    },
    [user?.id, show],
  );

  // Geometry constants — keep banner column aligned with the feed pane's
  // left edge so the visual rhythm reads as one column.
  const FEED_MAX_W = 672;
  const GAP = 32;

  const eff = useMemo(() => effectiveProgress(progressForShow), [progressForShow]);

  if (loadError) {
    return (
      <V2Layout palette="room">
        <div className="muted" style={{ padding: 32, textAlign: "center" }}>
          {loadError}
        </div>
      </V2Layout>
    );
  }

  if (loading || !room || !show) {
    return (
      <V2Layout palette="room">
        <div className="muted" style={{ padding: 32, textAlign: "center" }}>
          Loading
          <LoadingDots />
        </div>
      </V2Layout>
    );
  }

  return (
    <V2Layout palette="room" bareMain>
      <div
        style={{
          minHeight: "100vh",
          padding: "calc(var(--site-header-h) + 12px) 24px 120px",
        }}
      >
        {/* ── Two-pane wrapper ─────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: GAP,
            alignItems: "flex-start",
            maxWidth: 1400,
            margin: "0 auto",
          }}
        >
          {/* ── LEFT/CENTER pane: banner + feed ────────────────────────── */}
          <div style={{ flex: `0 1 ${FEED_MAX_W}px`, minWidth: 0, marginLeft: "auto", transform: "translateX(-176px)" }}>
            {/* Banner row 1 — eyebrow + room name + settings gear + "to public" */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16,
                padding: "8px 0",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", flex: "0 1 auto", minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    lineHeight: 1.2,
                    color: "var(--dos-light)",
                    marginLeft: 28,
                  }}
                >
                  your friend room:
                </div>
                <div style={{ display: "inline-flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
                  <span
                    className="bannerTitle editorial"
                    style={{
                      fontSize: 34,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      lineHeight: 1.05,
                      color: "var(--dos-light)",
                      userSelect: "none",
                      minWidth: 0,
                      overflowWrap: "break-word",
                      display: "inline-flex",
                      alignItems: "flex-start",
                      gap: 6,
                    }}
                  >
                    <Users size={22} color="var(--dos-light)" style={{ flexShrink: 0, marginTop: 7 }} />
                    {room.name.toUpperCase()}
                  </span>
                  <span
                    onClick={() => setSettingsOpen(true)}
                    title="Room settings"
                    style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", marginTop: 8, flexShrink: 0 }}
                  >
                    <Settings size={20} color="#fff" />
                  </span>
                </div>
              </div>
              <button
                className="btn"
                onClick={handleToPublic}
                style={{
                  whiteSpace: "nowrap",
                  fontSize: 13,
                  flexShrink: 0,
                  padding: "3px 12px",
                  background: "transparent",
                  border: "2px solid #fff",
                  color: "#fff",
                }}
              >
                to public conversation <ArrowRight size={14} color="#fff" style={{ verticalAlign: "middle" }} />
              </button>
            </div>

            {/* Banner row 2 — write button + watch-progress pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "8px 0 16px",
              }}
            >
              <button
                className="btn post"
                onClick={handleWrite}
                style={{ lineHeight: 1.2, display: "inline-flex", alignItems: "center", gap: 5 }}
                title="Start a new post"
              >
                <SquarePen size={15} /> write
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  <select
                    className="badge h40"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      paddingRight: 28,
                      appearance: "none",
                      WebkitAppearance: "none",
                      cursor: "pointer",
                      color: "var(--dos-border)",
                    }}
                  >
                    <option value="desc">newest first</option>
                    <option value="asc">oldest first</option>
                  </select>
                  <ChevronDown
                    size={14}
                    color="var(--dos-border)"
                    style={{ position: "absolute", right: 10, pointerEvents: "none" }}
                  />
                </div>
                <OneSelectProgress
                  show={show}
                  value={eff || { s: 1, e: 1 }}
                  onConfirm={handleProgressConfirm}
                  requireConfirm={true}
                  allowZero={eff?.s === 0}
                  rewatchHighest={
                    progressForShow?.isRewatching &&
                    progressForShow.highestS != null &&
                    progressForShow.highestE != null
                      ? { s: progressForShow.highestS, e: progressForShow.highestE }
                      : null
                  }
                />
              </div>
            </div>

            {/* ── Feed ─────────────────────────────────────────────── */}
            {feedEntries.length === 0 ? (
              <div className="muted" style={{ fontSize: 14, padding: "48px 0", textAlign: "center" }}>
                Nothing visible at your progress yet.
              </div>
            ) : (
              <V2RoomFeed
                ref={feedRef}
                entries={feedEntries}
                onOpenThread={handleOpenThread}
                sortOrder={sortOrder}
                groupId={groupId}
                viewerProgress={progressForShow}
                userId={user?.id ?? ""}
              />
            )}
          </div>

          {/* ── RIGHT pane: map ──────────────────────────────────────── */}
          <div
            style={{
              flex: "0 0 auto",
              position: "sticky",
              top: "calc(var(--site-header-h) + 60px)",
              alignSelf: "flex-start",
              transform: "translateX(-144px)",
            }}
          >
            <V2RoomMap
              members={mapMembers}
              seasons={show.seasons}
              viewerProgress={progressForShow}
              onEntryClick={handleCellClick}
            />
          </div>
        </div>
      </div>

      {settingsOpen && (
        <V2GroupSettingsModal
          room={room}
          onClose={() => setSettingsOpen(false)}
          onLeft={() => {
            setSettingsOpen(false);
            navigate("/v3/journal");
          }}
          onRenamed={(newName) => {
            setRoom((prev) => (prev ? { ...prev, name: newName } : prev));
          }}
        />
      )}
    </V2Layout>
  );
}
