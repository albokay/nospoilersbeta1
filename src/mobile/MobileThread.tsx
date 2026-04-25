import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import {
  fetchThreadById,
  fetchRepliesForThread,
  fetchProgress,
  fetchAllFriendGroupsWithActivity,
} from "../lib/db";
import type { Thread, Reply, ProgressEntry } from "../types";
import { canView } from "../lib/utils";
import LoadingDots from "../components/LoadingDots";

// /m/rooms/:groupId/thread/:threadId — single-thread view (read-only).
//
// Shows the full thread body + the chain-visible response stream filtered
// against the viewer's effective progress. Mirrors the visibility model
// used by fetchGroupThreads's reply count: a reply is visible iff the
// reply itself is canView'able AND every ancestor (walked via
// referenced_reply_id, with replyToId fallback for legacy/seed) is also
// canView'able. Orphan replies (visible self, hidden parent) stay hidden,
// so the in-thread stream is consistent with the room-card response
// counter on the previous screen.
//
// Phase 1 chunk 6: read-only. No respond affordance — that lands in
// Phase 2 alongside compose. Empty-state copy is honest about what's
// coming so the user isn't confused by a missing input field.
//
// The thread is fetched by id rather than re-queried via fetchGroupThreads
// because we want the full body (preview is truncated at 240 chars by the
// rooms-list path) and we already know the threadId from the URL.
export default function MobileThread({ groupId, threadId }: { groupId: string; threadId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [thread, setThread] = useState<Thread | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [progress, setProgress] = useState<ProgressEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetchThreadById(threadId),
      fetchRepliesForThread(threadId, groupId),
      fetchProgress(user.id),
      fetchAllFriendGroupsWithActivity(user.id),
    ])
      .then(([t, rs, progressMap, rooms]) => {
        if (cancelled) return;
        if (!t) { setLoadError("not_found"); return; }

        // Membership check: the user must be in the room they're trying to
        // read a thread from. fetchAllFriendGroupsWithActivity already
        // filters to the user's rooms via friend_group_members, so absence
        // from that list = not a member.
        const room = rooms.find(r => r.id === groupId);
        if (!room) { setLoadError("not_member"); return; }

        // Server-side RLS would also block the data fetch, but the explicit
        // membership check + clearer error message is the better UX.
        // (Defense-in-depth: even if RLS missed an edge case, the check
        // here gives a graceful fallback rather than a half-rendered view.)

        setThread(t);
        setReplies(rs);
        setProgress(progressMap[t.showId] ?? null);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("MobileThread fetch failed:", err);
        setLoadError("fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
    // location.key included so navigating back from
    // /m/rooms/:id/thread/:tid/respond → /m/rooms/:id/thread/:tid (with
    // replace:true) refetches the reply list and the new response shows up.
    // Same trick will handle any future "edit reply" return path.
  }, [groupId, threadId, user?.id, location.key]);

  // Realtime: while viewing this thread, subscribe to reply inserts/
  // updates filtered to thread_id=eq.${threadId}. Peers' replies appear
  // without a manual refresh. Narrowed per spec ("mobile bandwidth /
  // battery sensitivity matters more than on desktop") — only events for
  // this specific thread reach the client.
  //
  // refetch pulls the full reply list group-scoped to the room. The
  // canView + chainVisible filter is applied client-side in
  // visibleReplies, so a peer's spoiler-tagged reply that the viewer
  // can't see will fetch but not render — same shape as the initial
  // load. No leaked spoiler.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const refetch = () => {
      fetchRepliesForThread(threadId, groupId)
        .then(rs => {
          if (cancelled) return;
          setReplies(rs);
        })
        .catch(() => { /* transient — next interaction will refetch */ });
    };

    const channel = supabase
      .channel(`mobile-thread-${user.id}-${threadId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "replies", filter: `thread_id=eq.${threadId}` },
        refetch
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [groupId, threadId, user?.id]);

  // Filter replies through canView + chain-visibility. Same shape as
  // utils.visibleRepliesCount (and as fetchGroupThreads's chainVisible),
  // but returning the list rather than the count. Walks both replyToId
  // (legacy/seed) and referencedReplyId (current composer); fetchGroupThreads
  // does the same dual walk via DB-side referenced_reply_id only. Mobile
  // does it client-side here because we already have the full reply list
  // in memory.
  const visibleReplies = useMemo(() => {
    if (!thread) return [];
    const byId: Record<string, Reply> = {};
    replies.forEach(r => (byId[r.id] = r));
    const getParent = (r: Reply): Reply | null =>
      (r.replyToId && byId[r.replyToId]) ||
      (r.referencedReplyId && byId[r.referencedReplyId]) ||
      null;
    const chainVisible = (r: Reply): boolean => {
      if (r.isDeleted) return false;
      if (!canView({ season: r.season, episode: r.episode }, progress)) return false;
      let cur = getParent(r);
      while (cur) {
        if (!canView({ season: cur.season, episode: cur.episode }, progress)) return false;
        cur = getParent(cur);
      }
      return true;
    };
    return replies.filter(chainVisible);
  }, [replies, progress, thread]);

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
          {loadError === "not_found"   && "This entry doesn't exist or has been removed."}
          {loadError === "not_member"  && "You're not in this room."}
          {loadError === "fetch_failed" && "Couldn't load the thread. Try again."}
        </p>
        <button
          onClick={() => navigate(`/m/rooms/${groupId}`, { replace: true })}
          style={pillButtonStyle()}
        >
          ← Back to room
        </button>
      </div>
    );
  }

  if (!thread) return null;

  const tag = `S${String(thread.season).padStart(2, "0")} E${String(thread.episode).padStart(2, "0")}`;
  const ts = formatRelativeShort(thread.updatedAt || thread.createdAt);
  const threadDeleted = !!thread.isDeleted;

  return (
    <div style={wrapper}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {/* ── Back link ── */}
        <button
          onClick={() => navigate(`/m/rooms/${groupId}`)}
          style={{
            background: "transparent", color: "#fff",
            border: "none",
            fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit", opacity: 0.85,
            padding: "8px 0", marginBottom: 12,
          }}
        >
          ← Back to room
        </button>

        {/* ── Thread card ── */}
        <article style={{
          background: "rgba(255,255,255,0.95)",
          color: "var(--dos-bg, #2a4a36)",
          borderRadius: 12,
          padding: "18px 18px",
          marginBottom: 24,
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            opacity: 0.65,
            marginBottom: 8,
          }}>
            <span>{thread.author}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{tag}</span>
          </div>

          <h1 style={{
            fontSize: 20,
            fontWeight: 800,
            margin: "0 0 12px",
            lineHeight: 1.25,
            overflowWrap: "break-word",
          }}>
            {thread.titleBase || "Untitled"}
          </h1>

          <div style={{
            fontSize: 15,
            lineHeight: 1.55,
            opacity: threadDeleted ? 0.55 : 1,
            fontStyle: threadDeleted ? "italic" : "normal",
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
          }}>
            {threadDeleted ? "[deleted by author]" : (thread.body || "")}
          </div>

          <div style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: "1px solid rgba(0,0,0,0.06)",
            fontSize: 12,
            opacity: 0.65,
            display: "flex",
            justifyContent: "space-between",
            fontVariantNumeric: "tabular-nums",
          }}>
            <span>{thread.isEdited ? "edited" : ""}</span>
            <span>{ts}</span>
          </div>
        </article>

        {/* ── Responses ── */}
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          opacity: 0.85,
          marginBottom: 10,
        }}>
          {visibleReplies.length === 0 ? "Responses" : `Responses (${visibleReplies.length})`}
        </div>

        {visibleReplies.length === 0 ? (
          <div style={{
            background: "rgba(255,255,255,0.10)",
            border: "2px dashed rgba(255,255,255,0.35)",
            borderRadius: 12,
            padding: "20px 16px",
            textAlign: "center",
            fontSize: 13,
            opacity: 0.85,
            lineHeight: 1.5,
          }}>
            No responses yet. Tap the + to start the thread.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleReplies.map(r => (
              <ReplyCard key={r.id} reply={r} />
            ))}
          </div>
        )}
      </div>

      {/* ── Floating respond button ── */}
      <button
        onClick={() => navigate(`/m/rooms/${groupId}/thread/${threadId}/respond`)}
        aria-label="Respond"
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

function ReplyCard({ reply }: { reply: Reply }) {
  const tag = `S${String(reply.season).padStart(2, "0")} E${String(reply.episode).padStart(2, "0")}`;
  const ts = formatRelativeShort(reply.updatedAt);
  return (
    <div style={{
      background: "rgba(255,255,255,0.95)",
      color: "var(--dos-bg, #2a4a36)",
      borderRadius: 10,
      padding: "12px 14px",
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        opacity: 0.65,
        marginBottom: 6,
      }}>
        <span>{reply.author}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{tag}</span>
      </div>
      <div style={{
        fontSize: 14,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
      }}>
        {reply.body}
      </div>
      <div style={{
        marginTop: 8,
        fontSize: 11,
        opacity: 0.55,
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
      }}>
        {reply.isEdited ? "edited · " : ""}{ts}
      </div>
    </div>
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

function pillButtonStyle(): React.CSSProperties {
  return {
    background: "transparent", color: "#fff",
    border: "2px solid #fff",
    borderRadius: 9999, padding: "10px 24px",
    fontSize: 14, fontWeight: 700, cursor: "pointer",
    fontFamily: "inherit",
  };
}
