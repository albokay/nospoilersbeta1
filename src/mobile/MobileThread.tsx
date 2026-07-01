import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import {
  fetchThreadById,
  fetchRepliesForThread,
  fetchProgress,
  fetchAllFriendGroupsWithActivity,
  deleteThread,
  deleteReply,
  markThreadSeen,
} from "../lib/db";
import { linkifyText } from "../lib/linkify";
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
  const { user, profile } = useAuth();

  const [thread, setThread] = useState<Thread | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [progress, setProgress] = useState<ProgressEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Kebab + delete state.
  // kebabOpenFor: which post id has its action menu open (null = none).
  //   Threaded id is thread.id; replies use reply.id. Either-or, only one
  //   menu can be open at a time.
  // confirmDelete: which post is being confirmed for deletion.
  //   { type, id } so the confirm modal can dispatch the right delete call.
  // deleting: locks the confirm button while the request is in flight.
  const [kebabFor, setKebabFor] = useState<{ type: "thread" | "reply"; id: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "thread" | "reply"; id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  // Stamp the per-thread last_seen_at on first scroll within the thread.
  //
  // Changed from on-mount to scroll-required (2026-04-29) to match desktop
  // and to honor user spec: "opening a THREAD should clear the new reply
  // that has triggered a notification." Opening alone isn't enough — scroll
  // demonstrates the user actually engaged with the replies.
  //
  // 500ms grace ignores programmatic scrolls during initial layout. First
  // real user scroll fires mark-seen and detaches. Fire-and-forget — a
  // failure just leaves the dot to clear on the next visit.
  useEffect(() => {
    if (!user) return;
    let detached = false;
    let attachTimer: number | null = null;
    const onScroll = () => {
      if (detached) return;
      detached = true;
      window.removeEventListener("scroll", onScroll);
      markThreadSeen(groupId, threadId).catch(err => {
        console.warn("markThreadSeen failed:", err);
      });
    };
    attachTimer = window.setTimeout(() => {
      window.addEventListener("scroll", onScroll, { passive: true });
    }, 500);
    return () => {
      if (attachTimer != null) window.clearTimeout(attachTimer);
      window.removeEventListener("scroll", onScroll);
      detached = true;
    };
  }, [groupId, threadId, user?.id]);

  // Filter replies through canView + chain-visibility. Same shape as
  // utils.visibleRepliesCount (and as fetchGroupThreads's chainVisible),
  // but returning the list rather than the count. Walks both replyToId
  // (legacy/seed) and referencedReplyId (current composer); fetchGroupThreads
  // does the same dual walk via DB-side referenced_reply_id only. Mobile
  // does it client-side here because we already have the full reply list
  // in memory.
  //
  // Soft-deleted reply rule (per user spec 2026-04-25):
  //   - Has been responded to → keep as a tombstone so the chain remains
  //     readable (rendered with "(@author) deleted their response.")
  //   - Has NOT been responded to → filter entirely; on the next refetch
  //     it stays gone.
  // "Responded to" means another non-deleted reply in this thread has
  // replyToId or referencedReplyId pointing at this one. Excluding deleted
  // replies from the responder set prevents cascading-delete chains from
  // leaving orphan tombstones.
  const visibleReplies = useMemo(() => {
    if (!thread) return [];
    const byId: Record<string, Reply> = {};
    replies.forEach(r => (byId[r.id] = r));

    const respondedToIds = new Set<string>();
    for (const r of replies) {
      if (r.isDeleted) continue;
      if (r.replyToId) respondedToIds.add(r.replyToId);
      if (r.referencedReplyId) respondedToIds.add(r.referencedReplyId);
    }

    const getParent = (r: Reply): Reply | null =>
      (r.replyToId && byId[r.replyToId]) ||
      (r.referencedReplyId && byId[r.referencedReplyId]) ||
      null;
    const chainVisible = (r: Reply): boolean => {
      if (r.isDeleted && !respondedToIds.has(r.id)) return false;
      if (!canView({ season: r.season, episode: r.episode }, progress)) return false;
      let cur = getParent(r);
      while (cur) {
        if (!canView({ season: cur.season, episode: cur.episode }, progress)) return false;
        cur = getParent(cur);
      }
      return true;
    };
    // Mobile thread view has no order toggle — always sort by episode tag
    // ascending (season → episode), with createdAt as the tiebreaker. Mirrors
    // desktop's default order (RepliesList.tsx orderMode="episode").
    return replies.filter(chainVisible).sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      if (a.episode !== b.episode) return a.episode - b.episode;
      return a.createdAt - b.createdAt;
    });
  }, [replies, progress, thread]);

  // ── Render ──

  const wrapper: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--dos-bg, #7abd8e)",
    color: "#FEF8EA",
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
            background: "transparent", color: "#FEF8EA",
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
          background: "rgba(253,248,236,0.95)",
          color: "var(--dos-bg, #2a4a36)",
          borderRadius: 12,
          padding: "18px 18px",
          marginBottom: 24,
          position: "relative",
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
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{tag}</span>
              {profile?.username && thread.author === profile.username && !threadDeleted && (
                <button
                  onClick={() => setKebabFor({ type: "thread", id: thread.id })}
                  aria-label="More actions"
                  style={kebabButtonStyle}
                >
                  <MoreVertical size={18} strokeWidth={2.2} />
                </button>
              )}
            </span>
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
            {threadDeleted ? "[deleted by author]" : linkifyText(thread.body || "")}
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
            background: "rgba(253,248,236,0.10)",
            border: "2px dashed rgba(253,248,236,0.35)",
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
              <ReplyCard
                key={r.id}
                reply={r}
                isAuthor={!!profile?.username && r.author === profile.username && !r.isDeleted}
                onKebab={() => setKebabFor({ type: "reply", id: r.id })}
              />
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
          background: "#FEF8EA",
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

      {/* ── Action sheet (kebab → Edit / Delete) ── */}
      {/* Top-level overlay rendered once. Tapping the dim backdrop closes;  */}
      {/* the sheet sits above it. Same shape regardless of whether the    */}
      {/* kebab fired from the parent thread or one of the reply cards —    */}
      {/* dispatch happens at the button click using kebabFor.type.         */}
      {kebabFor && (
        <>
          <div
            onClick={() => setKebabFor(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.42)",
              zIndex: 100,
            }}
          />
          <div style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: 24,
            zIndex: 101,
            background: "#FEF8EA",
            color: "var(--dos-bg, #2a4a36)",
            borderRadius: 14,
            padding: 6,
            boxShadow: "0 -6px 24px rgba(0,0,0,0.35)",
            maxWidth: 480,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}>
            <button
              onClick={() => {
                const target = kebabFor;
                setKebabFor(null);
                if (target.type === "thread") {
                  navigate(`/m/rooms/${groupId}/thread/${threadId}/edit`);
                } else {
                  navigate(`/m/rooms/${groupId}/thread/${threadId}/reply/${target.id}/edit`);
                }
              }}
              style={sheetItemStyle()}
            >
              <Pencil size={17} strokeWidth={2} />
              Edit
            </button>
            <button
              onClick={() => {
                const target = kebabFor;
                setKebabFor(null);
                setConfirmDelete(target);
              }}
              style={sheetItemStyle({ danger: true })}
            >
              <Trash2 size={17} strokeWidth={2} />
              Delete
            </button>
            <div style={{ height: 4 }} />
            <button
              onClick={() => setKebabFor(null)}
              style={sheetItemStyle({ subtle: true })}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* ── Delete confirmation modal ── */}
      {/* Two-step flow: kebab → action sheet → tap Delete → THIS modal.    */}
      {/* Confirms before the destructive call lands. Cancel returns to    */}
      {/* the thread view with no DB write.                                  */}
      {confirmDelete && (
        <>
          <div
            onClick={deleting ? undefined : () => { setConfirmDelete(null); setDeleteError(null); }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              zIndex: 110,
            }}
          />
          <div style={{
            position: "fixed",
            top: "50%",
            left: 16,
            right: 16,
            transform: "translateY(-50%)",
            zIndex: 111,
            background: "#FEF8EA",
            color: "var(--dos-bg, #2a4a36)",
            borderRadius: 14,
            padding: "20px 18px",
            boxShadow: "0 12px 36px rgba(0,0,0,0.35)",
            maxWidth: 360,
            margin: "0 auto",
          }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 8px" }}>
              {confirmDelete.type === "thread" ? "Delete this entry?" : "Delete this response?"}
            </h2>
            <p style={{ fontSize: 13, opacity: 0.75, margin: "0 0 18px", lineHeight: 1.45 }}>
              {confirmDelete.type === "thread"
                ? "This entry will be removed from the room. If anyone has responded, the thread will stay as a tombstone so the conversation chain remains readable."
                : "If anyone has responded to it, it'll stay as a stub so the chain remains readable. Otherwise it'll vanish entirely."}
            </p>
            {deleteError && (
              <div style={{
                color: "#FEF8EA",
                background: "#f45028",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 14,
              }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => { setConfirmDelete(null); setDeleteError(null); }}
                disabled={deleting}
                style={{
                  background: "transparent",
                  color: "var(--dos-bg, #2a4a36)",
                  border: "2px solid rgba(0,0,0,0.18)",
                  borderRadius: 9999,
                  padding: "9px 18px",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: deleting ? "default" : "pointer",
                  fontFamily: "inherit",
                  opacity: deleting ? 0.55 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!confirmDelete) return;
                  setDeleting(true);
                  setDeleteError(null);
                  try {
                    if (confirmDelete.type === "thread") {
                      await deleteThread(confirmDelete.id);
                      // Soft-delete leaves a tombstone if there are replies, vanishes
                      // if not. Either way, route back to the room so the user isn't
                      // staring at the entry they just deleted.
                      navigate(`/m/rooms/${groupId}`, { replace: true });
                    } else {
                      await deleteReply(confirmDelete.id);
                      // Optimistically flag isDeleted=true (NOT filter from
                      // state) so the visibleReplies useMemo runs the same
                      // respondedToIds logic against the optimistic state.
                      // Without this, a responded-to reply would vanish
                      // immediately then a tombstone would reappear on the
                      // next refetch — jarring. With this, the optimistic
                      // state matches the eventual fetched state.
                      setReplies(prev => prev.map(x =>
                        x.id === confirmDelete.id ? { ...x, isDeleted: true } : x
                      ));
                      setConfirmDelete(null);
                    }
                  } catch (err) {
                    console.warn("Delete failed:", err);
                    setDeleteError(err instanceof Error ? err.message : "Delete failed. Try again.");
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
                style={{
                  background: "#f45028",
                  color: "#FEF8EA",
                  border: "none",
                  borderRadius: 9999,
                  padding: "9px 18px",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: deleting ? "default" : "pointer",
                  fontFamily: "inherit",
                  opacity: deleting ? 0.85 : 1,
                  minWidth: 90,
                }}
              >
                {deleting ? <LoadingDots /> : "Delete"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const kebabButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--dos-bg, #2a4a36)",
  border: "none",
  padding: 2,
  margin: 0,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: 0.7,
  fontFamily: "inherit",
};

function sheetItemStyle(opts?: { danger?: boolean; subtle?: boolean }): React.CSSProperties {
  const danger = opts?.danger;
  const subtle = opts?.subtle;
  return {
    width: "100%",
    background: "transparent",
    color: danger ? "#f45028" : "var(--dos-bg, #2a4a36)",
    border: "none",
    borderRadius: 10,
    padding: "14px 16px",
    fontSize: 16,
    fontWeight: subtle ? 600 : 700,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: subtle ? "center" : "flex-start",
    gap: 12,
    opacity: subtle ? 0.7 : 1,
  };
}

function ReplyCard({ reply, isAuthor, onKebab }: { reply: Reply; isAuthor: boolean; onKebab: () => void }) {
  const tag = `S${String(reply.season).padStart(2, "0")} E${String(reply.episode).padStart(2, "0")}`;
  const ts = formatRelativeShort(reply.updatedAt);

  // Tombstone rendering for soft-deleted replies that survived the
  // chainVisible filter (i.e. someone responded to them — chain
  // preservation). Minimal card, faded, italic, single-line — uses
  // the same flipped styling axis as the live response card (transparent
  // fill on the canon-green page, white outline) but with a dashed
  // border + lower-alpha text so it reads as the deleted state.
  if (reply.isDeleted) {
    return (
      <div style={{
        background: "transparent",
        border: "2px dashed rgba(253,248,236,0.4)",
        color: "rgba(253,248,236,0.6)",
        borderRadius: 10,
        padding: "10px 14px",
        fontStyle: "italic",
        fontSize: 13,
      }}>
        @{reply.author} deleted their response.
      </div>
    );
  }

  // Live response card. Flipped from the previous white-fill / dark-text
  // shape: transparent fill (canon-green page shows through), white
  // outline, white text. Visually demarks responses as part of the page
  // surface itself, not as separate "white cards" — the parent thread
  // article remains the only filled white card on the screen, anchoring
  // it as the headline event while the responses feel like the
  // conversation happening around it on the same green ground.
  return (
    <div style={{
      background: "transparent",
      border: "2px solid #FEF8EA",
      color: "#FEF8EA",
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
        opacity: 0.85,
        marginBottom: 6,
      }}>
        <span>{reply.author}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{tag}</span>
          {isAuthor && (
            <button onClick={onKebab} aria-label="More actions" style={{ ...kebabButtonStyle, color: "#FEF8EA" }}>
              <MoreVertical size={16} strokeWidth={2.2} />
            </button>
          )}
        </span>
      </div>
      <div style={{
        fontSize: 14,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
      }}>
        {linkifyText(reply.body)}
      </div>
      <div style={{
        marginTop: 8,
        fontSize: 11,
        opacity: 0.7,
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
    background: "transparent", color: "#FEF8EA",
    border: "2px solid #FEF8EA",
    borderRadius: 9999, padding: "10px 24px",
    fontSize: 14, fontWeight: 700, cursor: "pointer",
    fontFamily: "inherit",
  };
}
