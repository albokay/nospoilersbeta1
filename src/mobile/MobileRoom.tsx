import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, MessageSquareText, Plus, UserPlus, ChevronDown } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import {
  fetchAllFriendGroupsWithActivity,
  fetchShows,
  fetchProgress,
  fetchFriendGroupMembers,
  fetchGroupThreads,
  fetchRoomLastSeen,
  markRoomSeen,
} from "../lib/db";
import type { Show } from "../lib/db";
import type { FriendGroup, Thread, ProgressEntry } from "../types";
import { effectiveProgress } from "../lib/utils";
import LoadingDots from "../components/LoadingDots";

// S6 — Mobile room view (read-only, Phase 1).
//
// Renders the friend room's entry stream filtered by the viewer's effective
// progress. Reuses fetchGroupThreads which already does the canView filter
// server-side via the maxS/maxE arguments and computes chain-visible reply
// counts (so orphan replies — visible self, hidden parent — don't inflate
// the count). Same data path the desktop friend-room view uses, with the
// same visibility guarantees.
//
// Phase 1 read-only: no compose, no respond, no invite. Compose + respond
// land in Phase 2; the invite-friends button (empty-room prominence per
// spec) and the S7 chevron-dropdown land in their own focused chunks.
// The empty-state copy below is honest about what's coming so the user
// isn't left wondering why there's no input field.
//
// Tapping an entry routes to /m/rooms/:groupId/thread/:threadId, a
// placeholder this chunk. The dedicated route (rather than inline
// expansion) was the user's pick for back-button predictability.
export default function MobileRoom({ groupId }: { groupId: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [room, setRoom] = useState<FriendGroup | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [progress, setProgress] = useState<ProgressEntry | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [latestVisibleReplyAt, setLatestVisibleReplyAt] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // At-mount snapshot of last_seen_at — captured BEFORE markRoomSeen stamps
  // it forward, then used as the threshold for thread-card "new" indicators
  // throughout this visit. Three states:
  //   loading — fetch in progress (suppress dots)
  //   ready   — snapshot is the value (or null = "never visited this room")
  //   error   — column doesn't exist yet (graceful degrade: no dots)
  const [snapshotStatus, setSnapshotStatus] = useState<"loading" | "ready" | "error">("loading");
  const [snapshot, setSnapshot] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetchAllFriendGroupsWithActivity(user.id),
      fetchShows(),
      fetchProgress(user.id),
      fetchFriendGroupMembers(groupId),
    ])
      .then(([rooms, shows, progressMap, members]) => {
        if (cancelled) return null;
        const r = rooms.find(x => x.id === groupId);
        if (!r) { setLoadError("room_not_found"); return null; }
        const s = shows.find(x => x.id === r.showId);
        if (!s) { setLoadError("show_not_found"); return null; }
        const p = progressMap[r.showId] ?? null;
        setRoom(r);
        setShow(s);
        setProgress(p);
        setMemberCount(members.length);

        // Fetch threads filtered through effective progress. effectiveProgress
        // returns highestS/E for rewatchers, otherwise s/e — matches the
        // desktop visibility model. Falling back to (0,0) means nothing is
        // visible for users who never set progress, which is the correct
        // safe default (the gate should always populate before this view).
        const eff = effectiveProgress(p) ?? { s: 0, e: 0 };
        return fetchGroupThreads(groupId, eff.s, eff.e, user?.id);
      })
      .then(result => {
        if (cancelled || !result) return;
        setThreads(result.threads);
        setReplyCounts(result.replyCounts);
        setLatestVisibleReplyAt(result.latestVisibleReplyAt);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("MobileRoom fetch failed:", err);
        setLoadError("fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [groupId, user?.id]);

  // Snapshot last_seen_at, then stamp it forward.
  //
  // Order of operations matters: the snapshot must be captured BEFORE
  // markRoomSeen updates last_seen_at to NOW(), otherwise every thread-
  // card indicator would resolve to "older than now" = never fires.
  // Sequencing them in a single async block guarantees the right order.
  //
  // Graceful degradation:
  //   - fetchRoomLastSeen throws (migration not applied / column missing)
  //     → snapshotStatus="error" → indicators don't render. Mobile UI
  //     otherwise unaffected.
  //   - markRoomSeen throws → log + move on. Snapshot still set so dots
  //     work for this visit; only the room-button dot won't clear next
  //     time, which the user can fix by re-entering.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const ts = await fetchRoomLastSeen(user.id, groupId);
        if (cancelled) return;
        setSnapshot(ts);
        setSnapshotStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.warn("fetchRoomLastSeen failed (column may not exist yet):", err);
        setSnapshotStatus("error");
      }
      if (!cancelled) {
        markRoomSeen(groupId).catch(err => {
          console.warn("markRoomSeen failed:", err);
        });
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, user?.id]);

  // Realtime: while the user is viewing this room, subscribe to inserts
  // and updates on replies + group_threads scoped to this group_id. On any
  // event, refetch the thread list (and therefore reply counts) so peers'
  // posts and replies appear without a manual refresh.
  //
  // Narrowed via filter=`group_id=eq.${groupId}` to keep mobile bandwidth
  // / battery cost minimal — only events for this room reach the client,
  // not the full replies firehose. Filter syntax mirrors Supabase's
  // postgres_changes spec.
  //
  // The handler closure captures `progress` from the render where the
  // subscription was created. progress is included in the effect deps so
  // the subscription re-creates when it changes — which is rare in
  // practice (progress is set at the gate before entering, and not edited
  // from inside the room view), but the safety is cheap.
  useEffect(() => {
    if (!user) return;
    const eff = effectiveProgress(progress) ?? { s: 0, e: 0 };
    let cancelled = false;

    const refetch = () => {
      fetchGroupThreads(groupId, eff.s, eff.e, user.id)
        .then(result => {
          if (cancelled) return;
          setThreads(result.threads);
          setReplyCounts(result.replyCounts);
          setLatestVisibleReplyAt(result.latestVisibleReplyAt);
        })
        .catch(() => { /* transient — next interaction will refetch */ });
    };

    const channel = supabase
      .channel(`mobile-room-${user.id}-${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "replies", filter: `group_id=eq.${groupId}` },
        refetch
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_threads", filter: `group_id=eq.${groupId}` },
        refetch
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [groupId, user?.id, progress]);

  const sortedThreads = useMemo(() => {
    // fetchGroupThreads already orders by shared_at descending (newest
    // first). Match desktop ordering per user spec; no client-side resort
    // needed.
    return threads;
  }, [threads]);

  // ── Render ──

  const wrapper: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--dos-bg, #7abd8e)",
    color: "#fff",
    padding: "24px 20px 48px",
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
          {loadError === "room_not_found" && "This room doesn't exist or you're not in it."}
          {loadError === "show_not_found" && "Couldn't find the show for this room."}
          {loadError === "fetch_failed" && "Couldn't load the room. Try again."}
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

  if (!room || !show) return null;

  return (
    <div style={wrapper}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {/* ── Static sidebar logotype mark (no animation) ── */}
        {/* Smaller and quieter than MobileRooms' dynamic logo —  */}
        {/* this is a per-room screen, the logo's just a brand    */}
        {/* anchor, not a finale animation worth replaying.       */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <img
            src="/sidebar-logo.png"
            alt="sidebar"
            style={{ height: 32, width: "auto", display: "block", opacity: 0.95 }}
          />
        </div>

        {/* ── Back link ── */}
        <button
          onClick={() => navigate("/m/rooms")}
          style={{
            background: "transparent", color: "#fff",
            border: "none",
            fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit", opacity: 0.85,
            padding: "8px 0", marginBottom: 12,
          }}
        >
          ← Rooms
        </button>

        {/* ── Header (room name + chevron-to-menu, show + member count) ── */}
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => navigate(`/m/rooms/${groupId}/menu`)}
            aria-label="Open room menu"
            style={{
              background: "transparent",
              color: "#fff",
              border: "none",
              padding: 0,
              margin: "0 0 4px",
              cursor: "pointer",
              fontFamily: "inherit",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              maxWidth: "100%",
            }}
          >
            <h1 style={{
              fontSize: 24, fontWeight: 800, margin: 0,
              lineHeight: 1.2,
              overflowWrap: "break-word",
              textAlign: "left",
            }}>
              {room.name}
            </h1>
            <ChevronDown size={22} strokeWidth={2.4} style={{ flexShrink: 0, opacity: 0.85 }} />
          </button>
          <div style={{ fontSize: 13, opacity: 0.85, display: "flex", alignItems: "center", gap: 8 }}>
            <span>{show.name}</span>
            <span style={{ opacity: 0.6 }}>·</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Users size={13} />
              {memberCount} {memberCount === 1 ? "member" : "members"}
            </span>
          </div>
        </div>

        {/* ── Prominent invite button (only when alone in the room) ── */}
        {/* Per spec: "'Invite friends' button — prominent if room is empty */}
        {/* (no other members yet), otherwise lives in S7." S7 (chevron      */}
        {/* dropdown) hasn't shipped yet, so for memberCount > 1 the invite */}
        {/* affordance is temporarily unavailable on mobile — that lands     */}
        {/* with the dropdown chunk. Users with multi-member rooms can      */}
        {/* invite from desktop in the meantime.                            */}
        {memberCount <= 1 && (
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
              marginBottom: 24,
            }}
          >
            <UserPlus size={18} strokeWidth={2.2} />
            Invite a friend
          </button>
        )}

        {/* ── Entries ── */}
        {sortedThreads.length === 0 ? (
          <div style={{
            background: "rgba(255,255,255,0.10)",
            border: "2px dashed rgba(255,255,255,0.4)",
            borderRadius: 12,
            padding: "28px 20px",
            textAlign: "center",
          }}>
            <p style={{ fontSize: 15, fontWeight: 700, margin: "0 0 6px" }}>No entries yet</p>
            <p style={{ fontSize: 13, opacity: 0.85, margin: 0, lineHeight: 1.5 }}>
              {memberCount <= 1
                ? "You're alone in here. Invite friends above, or tap the + to post your first entry while you wait."
                : "Nothing visible at your current progress yet, or no one has posted. Tap the + to start the conversation."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sortedThreads.map(t => {
              // hasNewActivity: thread or any chain-visible reply newer
              // than the at-mount snapshot. Suppressed entirely when the
              // snapshot fetch is loading (avoid flicker) or errored
              // (graceful degradation when the migration isn't applied).
              const replyTs = latestVisibleReplyAt[t.id] ?? 0;
              const latest = Math.max(t.updatedAt, replyTs);
              const hasNewActivity =
                snapshotStatus === "ready" &&
                latest > 0 &&
                (snapshot === null || latest > snapshot);
              return (
                <ThreadCard
                  key={t.id}
                  thread={t}
                  replyCount={replyCounts[t.id] ?? 0}
                  hasNewActivity={hasNewActivity}
                  onTap={() => navigate(`/m/rooms/${groupId}/thread/${t.id}`)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Floating compose button ── */}
      <button
        onClick={() => navigate(`/m/rooms/${groupId}/compose`)}
        aria-label="New entry"
        style={{
          position: "fixed",
          right: 20,
          bottom: 24,
          width: 56,
          height: 56,
          borderRadius: 9999,
          background: "#fff",
          color: "var(--dos-bg, #2a4a36)",
          border: "none",
          boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "inherit",
          zIndex: 50,
        }}
      >
        <Plus size={28} strokeWidth={2.5} />
      </button>
    </div>
  );
}

// Single entry card. Renders title + preview + author + episode tag +
// reply count + relative timestamp. Tombstones soft-deleted-with-replies
// threads with a "[deleted]" body so the conversation chain remains
// readable when chunk 6 lands the thread view.
function ThreadCard({ thread, replyCount, hasNewActivity, onTap }: { thread: Thread; replyCount: number; hasNewActivity: boolean; onTap: () => void }) {
  const tag = `S${String(thread.season).padStart(2, "0")} E${String(thread.episode).padStart(2, "0")}`;
  const ts = formatRelativeShort(thread.updatedAt || thread.createdAt);
  const deleted = !!thread.isDeleted;

  return (
    <button
      onClick={onTap}
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
        flexDirection: "column",
        gap: 6,
        fontFamily: "inherit",
      }}
    >
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        opacity: 0.65,
      }}>
        <span>{thread.author}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{tag}</span>
      </div>

      <div style={{
        fontSize: 16,
        fontWeight: 800,
        lineHeight: 1.25,
        overflowWrap: "break-word",
      }}>
        {thread.titleBase || "Untitled"}
      </div>

      <div style={{
        fontSize: 13,
        lineHeight: 1.45,
        opacity: deleted ? 0.55 : 0.85,
        fontStyle: deleted ? "italic" : "normal",
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}>
        {deleted ? "[deleted]" : thread.preview || ""}
      </div>

      <div style={{
        marginTop: 4,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 12,
        opacity: 0.7,
        fontVariantNumeric: "tabular-nums",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <MessageSquareText size={12} />
          {replyCount} {replyCount === 1 ? "response" : "responses"}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {hasNewActivity && (
            <span
              aria-label="New activity"
              style={{
                width: 10, height: 10,
                borderRadius: 999,
                background: "#dea838",
                opacity: 1,
              }}
            />
          )}
          {ts}
        </span>
      </div>
    </button>
  );
}

function formatRelativeShort(ts: number): string {
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
