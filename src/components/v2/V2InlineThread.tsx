import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronUp, MessageSquare } from "lucide-react";
import Modal from "../Modal";
import RepliesList from "../RepliesList";
import ResponseComposer, { type PendingReference } from "../ResponseComposer";
import { useAuth } from "../../lib/auth";
import {
  deleteThread as dbDeleteThread,
  editThread as dbEditThread,
  fetchV2ThreadDetail,
  likeReply as dbLikeReply,
  unlikeReply as dbUnlikeReply,
  type CitationEntry,
} from "../../lib/db";
import { effectiveProgress } from "../../lib/utils";
import type { ProgressEntry, Thread } from "../../types";

// V2 friend-room inline thread view.
//
// Mounted inside V2RoomFeed's expanded ticket state. Renders body + entry
// action row (edit / delete / quote / write-a-response) + reply count +
// replies + composer (when opened) + a "collapse" button above the replies
// and a second "collapse" button at the very end of the thread. The
// title-row star is OWNED BY V2RoomFeed (so it doesn't move between
// collapsed/expanded states); this component reports the caller's like
// state up via onThreadLikeStateChange after fetch.
//
// Composer is hidden by default — user clicks "Write a response" to open
// it. Cancel and submit both close it. Quote also opens it.

export type V2InlineThreadProps = {
  thread: Thread;
  groupId: string;
  viewerProgress: ProgressEntry | null;
  userId: string;
  /** Visible reply count from the parent's fetchGroupThreads result. */
  replyCount: number;
  /** Caller scrolls the ticket top into view and clears expansion. */
  onCollapseTop: () => void;
  onAuthRequired?: () => void;
  /** Fired after the author edits the thread; parent updates the feed entry. */
  onThreadEdited?: (updated: Thread) => void;
  /** Fired after the author soft-deletes the thread. Parent decides whether
   *  to drop the entry (no replies) or convert it to a tombstone. */
  onThreadDeleted?: (threadId: string) => void;
  /** Fires whenever the composer's draft state changes (non-empty / empty).
   *  Parent uses this to gate collapse / cross-thread-expansion with a
   *  "you will lose what you've been writing" confirm modal. */
  onDraftChange?: (hasDraft: boolean) => void;
  /** Fires after fetchV2ThreadDetail resolves so the parent's title-row
   *  LikeBadge can reflect the caller's like state. */
  onThreadLikeStateChange?: (likedByMe: boolean) => void;
};

export default function V2InlineThread({
  thread,
  groupId,
  viewerProgress,
  userId,
  replyCount,
  onCollapseTop,
  onAuthRequired,
  onThreadEdited,
  onThreadDeleted,
  onDraftChange,
  onThreadLikeStateChange,
}: V2InlineThreadProps) {
  const { profile } = useAuth();
  const isOwn = !!profile && thread.author === profile.username;
  const isTombstone = !!thread.isDeleted;

  // ── Fetched state ───────────────────────────────────────────────────────
  const [loadError, setLoadError] = useState<string | null>(null);
  const [likesReplies, setLikesReplies] = useState<Record<string, number>>({});
  const [likedByUserReplies, setLikedByUserReplies] = useState<Record<string, boolean>>({});
  const [citations, setCitations] = useState<Map<string, CitationEntry[]>>(new Map());
  const [threadCitations, setThreadCitations] = useState<CitationEntry[]>([]);

  // ── Edit state ──────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(thread.titleBase);
  const [editBody, setEditBody] = useState(thread.body);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [showRetagWarning, setShowRetagWarning] = useState(false);

  // ── Delete state ────────────────────────────────────────────────────────
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // ── Composer + pending-reference + draft-tracking state ─────────────────
  const composerWrapperRef = useRef<HTMLDivElement>(null);
  const composerInnerRef = useRef<HTMLDivElement>(null);
  const [pendingReference, setPendingReferenceRaw] = useState<PendingReference | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerKey, setComposerKey] = useState(0);
  const [repliesKey, setRepliesKey] = useState(0);
  const [threadQuoteHint, setThreadQuoteHint] = useState(false);

  // Setting a pending reference (from the entry's Quote button OR from
  // RepliesList's per-reply quote affordance) auto-opens the composer so
  // the user immediately sees the staged quote.
  const setPendingReference = useCallback(
    (ref: PendingReference | null) => {
      setPendingReferenceRaw(ref);
      if (ref) setComposerOpen(true);
    },
    [],
  );

  // Keep edit field defaults in sync with the source thread.
  useEffect(() => {
    setEditTitle(thread.titleBase);
    setEditBody(thread.body);
  }, [thread.id, thread.titleBase, thread.body]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchV2ThreadDetail(thread.id, groupId, userId)
      .then((detail) => {
        if (cancelled) return;
        if (!detail) {
          setLoadError("thread not found");
          return;
        }
        onThreadLikeStateChange?.(detail.threadLikedByMe);
        const likes: Record<string, number> = {};
        const likedByMe: Record<string, boolean> = {};
        for (const r of detail.replies) {
          likes[r.id] = r.likes;
          likedByMe[r.id] = detail.replyLikedByMe.has(r.id);
        }
        setLikesReplies(likes);
        setLikedByUserReplies(likedByMe);
        setCitations(detail.replyCitations);
        setThreadCitations(detail.threadCitations);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2InlineThread fetch failed:", err);
        setLoadError("couldn't load this thread");
      });
    return () => {
      cancelled = true;
    };
  }, [thread.id, groupId, userId, onThreadLikeStateChange]);

  // ── Reply-level like / unlike ───────────────────────────────────────────
  const handleLikeReply = useCallback(
    (rid: string, baseCount?: number) => {
      if (!userId) {
        onAuthRequired?.();
        return;
      }
      setLikedByUserReplies((prev) => ({ ...prev, [rid]: true }));
      setLikesReplies((prev) => ({
        ...prev,
        [rid]: (baseCount ?? prev[rid] ?? 0) + 1,
      }));
      dbLikeReply(userId, rid).catch(() => {
        setLikedByUserReplies((prev) => ({ ...prev, [rid]: false }));
        setLikesReplies((prev) => ({
          ...prev,
          [rid]: Math.max(0, (prev[rid] ?? 1) - 1),
        }));
      });
    },
    [userId, onAuthRequired],
  );

  const handleUnlikeReply = useCallback(
    (rid: string) => {
      if (!userId) return;
      setLikedByUserReplies((prev) => ({ ...prev, [rid]: false }));
      setLikesReplies((prev) => ({
        ...prev,
        [rid]: Math.max(0, (prev[rid] ?? 1) - 1),
      }));
      dbUnlikeReply(userId, rid).catch(() => {
        setLikedByUserReplies((prev) => ({ ...prev, [rid]: true }));
        setLikesReplies((prev) => ({
          ...prev,
          [rid]: (prev[rid] ?? 0) + 1,
        }));
      });
    },
    [userId],
  );

  // ── Edit flow ───────────────────────────────────────────────────────────
  const editEff = effectiveProgress(viewerProgress);
  const editTagS = editEff?.s ?? thread.season;
  const editTagE = editEff?.e ?? thread.episode;
  const progressHasAdvanced =
    !!editEff &&
    (editEff.s > thread.season ||
      (editEff.s === thread.season && editEff.e > thread.episode));

  const openEdit = () => {
    setEditTitle(thread.titleBase);
    setEditBody(thread.body);
    setEditError(null);
    setShowRetagWarning(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setShowRetagWarning(false);
  };

  const handleSaveEdit = async () => {
    if (progressHasAdvanced && !showRetagWarning) {
      setShowRetagWarning(true);
      return;
    }
    setShowRetagWarning(false);
    const title = editTitle.trim() || "Untitled note";
    const body = editBody.trim() || "(blank)";
    setEditSubmitting(true);
    setEditError(null);
    try {
      await dbEditThread(thread.id, title, body, editTagS, editTagE);
      const preview = body.slice(0, 240) + (body.length > 240 ? "…" : "");
      onThreadEdited?.({
        ...thread,
        titleBase: title,
        body,
        preview,
        season: editTagS,
        episode: editTagE,
        isEdited: true,
      });
      setEditing(false);
    } catch (e) {
      const msg =
        (e as { message?: string })?.message ?? "Failed to save. Please try again.";
      setEditError(msg);
    } finally {
      setEditSubmitting(false);
    }
  };

  // ── Delete flow ─────────────────────────────────────────────────────────
  const openDelete = () => setShowDeleteModal(true);
  const cancelDelete = () => setShowDeleteModal(false);
  const handleDelete = async () => {
    setDeleteSubmitting(true);
    try {
      await dbDeleteThread(thread.id);
      setShowDeleteModal(false);
      onThreadDeleted?.(thread.id);
    } catch (e) {
      console.warn("Delete failed:", e);
      alert("Failed to delete. Please try again.");
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // ── Quote — v1 InlineThreadView's handleQuoteThread ported verbatim.
  // Uses window.getSelection() to capture the user's highlighted text. If
  // nothing's highlighted, toggle the hint modal explaining how. If text
  // IS highlighted, stage the pending reference with only that selection
  // and open the composer.
  const handleQuoteThread = () => {
    if (!userId) {
      onAuthRequired?.();
      return;
    }
    const sel = window.getSelection();
    const selectedText = sel?.toString().trim() ?? "";
    if (!selectedText) {
      setThreadQuoteHint((h) => !h);
      return;
    }
    setThreadQuoteHint(false);
    setPendingReference({
      type: "quote",
      threadId: thread.id,
      authorName: thread.author,
      quotedText: selectedText,
    });
  };

  // ── Composer open / cancel / submit ─────────────────────────────────────
  const openComposer = () => {
    setComposerOpen(true);
    // Defer the scroll so the composer's mount completes first.
    setTimeout(() => {
      composerInnerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  };

  // After a successful submit, ResponseComposer clears its body
  // programmatically; signal parent + bump replies key + close composer.
  const handleComposerSubmitted = useCallback(() => {
    onDraftChange?.(false);
    setRepliesKey((k) => k + 1);
    setComposerOpen(false);
    setPendingReferenceRaw(null);
  }, [onDraftChange]);

  // Cancel inside the composer — close the composer entirely (not just
  // clear text). composerKey bump ensures the next open mounts a fresh
  // ResponseComposer with empty body.
  const handleComposerCancel = useCallback(() => {
    setComposerOpen(false);
    setComposerKey((k) => k + 1);
    setPendingReferenceRaw(null);
    onDraftChange?.(false);
  }, [onDraftChange]);

  // Wrapper input listener — tracks draft state via bubbling textarea
  // input events. Programmatic state clears (e.g. post-submit) don't fire
  // input events; handleComposerSubmitted explicitly clears the flag.
  const handleComposerInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== "TEXTAREA") return;
      const val = (target as HTMLTextAreaElement).value;
      onDraftChange?.(val.trim().length > 0);
    },
    [onDraftChange],
  );

  if (loadError) {
    return (
      <div className="muted" style={{ fontSize: 14, padding: "16px 0" }}>
        {loadError}
      </div>
    );
  }

  // The two collapse buttons (above-replies and end-of-thread) share the
  // same call path — onCollapseTop is wired in V2RoomFeed to clear
  // expansion + scroll the ticket top into view (instantly).
  const collapseButton = (
    <button
      className="btn"
      onClick={onCollapseTop}
      style={{
        fontSize: 13,
        padding: "4px 12px",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <ChevronUp size={13} /> collapse
    </button>
  );

  return (
    <>
      {/* Body — gravestone if tombstone; edit form if editing; plain body otherwise */}
      {isTombstone ? (
        <div style={{ marginTop: 8, fontStyle: "italic", color: "#1a3a4a", opacity: 0.5 }}>
          @{thread.author} deleted their entry.
        </div>
      ) : editing ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            className="badge"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title"
            style={{ fontSize: 16, fontWeight: 600 }}
          />
          <textarea
            className="badge"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            placeholder="Body"
            rows={6}
            style={{ fontSize: 14, lineHeight: 1.5, resize: "vertical" }}
          />
          {showRetagWarning && (
            <div style={{ fontSize: 13, padding: 12, background: "rgba(0,0,0,0.06)", borderRadius: 8, color: "#1a3a4a" }}>
              Your progress has advanced since you wrote this. Saving will re-tag it to S{String(editTagS).padStart(2, "0")} E{String(editTagE).padStart(2, "0")}.
            </div>
          )}
          {editError && (
            <div style={{ fontSize: 13, color: "var(--danger)" }}>{editError}</div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={cancelEdit} disabled={editSubmitting}>
              Cancel
            </button>
            <button
              className="btn"
              onClick={handleSaveEdit}
              disabled={editSubmitting || !editTitle.trim() || !editBody.trim()}
              style={{ background: "var(--green)", border: "none", color: "#fff" }}
            >
              {editSubmitting ? "Saving…" : showRetagWarning ? "Confirm and save" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, marginTop: 8 }}>
          {thread.body}
        </div>
      )}

      {/* Action row — edit/delete (owner) + Quote…
          The "Write a response" trigger moved below the replies. Star
          lives in the title row (owned by V2RoomFeed). Hidden on
          tombstones and while editing. */}
      {!isTombstone && !editing && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 0", marginTop: 8, flexWrap: "wrap" }}>
          {isOwn && (
            <>
              <button
                className="btn"
                onClick={openEdit}
                style={{ fontSize: 13 }}
              >
                Edit
              </button>
              <button
                className="btn btn-danger"
                onClick={openDelete}
                style={{ fontSize: 13 }}
              >
                Delete
              </button>
            </>
          )}
          <button
            className="btn"
            onClick={handleQuoteThread}
            style={{ fontSize: 13 }}
          >
            Quote…
          </button>
        </div>
      )}

      {/* First collapse button — above the replies. Only rendered when
          there are replies to skip past; with replyCount === 0 the second
          collapse button at the end of the thread is sufficient. */}
      {replyCount > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          {collapseButton}
        </div>
      )}

      {/* Reply count indicator — under entry, above replies. */}
      {replyCount > 0 && (
        <div className="muted" style={{ fontSize: 14, marginTop: 16, color: "#1a3a4a", opacity: 0.7 }}>
          {replyCount} {replyCount === 1 ? "response" : "responses"}
        </div>
      )}

      {/* Replies list — chain-visibility filter built into RepliesList. */}
      <div style={{ marginTop: 8 }}>
        <RepliesList
          thread={thread}
          groupId={groupId}
          progressForShow={viewerProgress ?? undefined}
          likeReply={handleLikeReply}
          unlikeReply={handleUnlikeReply}
          likesReplies={likesReplies}
          likedByUserReplies={likedByUserReplies}
          onAuthRequired={onAuthRequired ?? (() => {})}
          citations={citations}
          threadCitations={threadCitations}
          onSetPendingReference={setPendingReference}
          pendingReference={pendingReference}
          composerRef={composerInnerRef}
          onScrollToComposer={openComposer}
          refreshKey={repliesKey}
        />
      </div>

      {/* "Write a response" trigger — bottom of the replies area. Clicking
          opens the composer, which replaces this button in place. Hidden
          on tombstones (you can't reply to a deleted entry, though existing
          replies remain readable). */}
      {!isTombstone && !composerOpen && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn" onClick={openComposer}>
            Write a response
          </button>
        </div>
      )}

      {/* Reply composer — hidden by default. Opens on "Write a response"
          or when a Quote pending-reference is staged. */}
      {!isTombstone && composerOpen && (
        <div
          ref={composerWrapperRef}
          onInput={handleComposerInput}
          style={{ marginTop: 24 }}
        >
          <ResponseComposer
            key={composerKey}
            threadId={thread.id}
            showId={thread.showId}
            viewerSeason={viewerProgress?.s ?? thread.season}
            viewerEpisode={viewerProgress?.e ?? thread.episode}
            postTagSeason={
              viewerProgress?.isRewatching && viewerProgress.highestS != null
                ? viewerProgress.highestS
                : viewerProgress?.s ?? thread.season
            }
            postTagEpisode={
              viewerProgress?.isRewatching && viewerProgress.highestE != null
                ? viewerProgress.highestE
                : viewerProgress?.e ?? thread.episode
            }
            isRewatch={viewerProgress?.isRewatching ?? false}
            rewatchSnapshotSeason={
              viewerProgress?.isRewatching
                ? viewerProgress.rewatchS ?? viewerProgress.s
                : undefined
            }
            rewatchSnapshotEpisode={
              viewerProgress?.isRewatching
                ? viewerProgress.rewatchE ?? viewerProgress.e
                : undefined
            }
            onSubmitted={handleComposerSubmitted}
            onCancel={handleComposerCancel}
            pendingReference={pendingReference}
            onClearReference={() => setPendingReferenceRaw(null)}
            composerRef={composerInnerRef}
            onAuthRequired={onAuthRequired ?? (() => {})}
            threadAuthor={thread.author}
            progress={viewerProgress ? { s: viewerProgress.s, e: viewerProgress.e } : undefined}
            inGroupContext={true}
            groupId={groupId}
            threadIsPublic={!!thread.isPublic}
          />
        </div>
      )}

      {/* Second collapse button — at the end of the thread per spec. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        {collapseButton}
      </div>

      {/* Quote hint modal — v1's copy ported verbatim. Shown when the user
          clicks Quote with no text highlighted. */}
      {threadQuoteHint && (
        <Modal onClose={() => setThreadQuoteHint(false)} width="min(520px,92vw)" cardClassName="explanation-card">
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              <MessageSquare size={14} color="currentColor" /> Highlight the portion of any entry that you'd like to respond to, then click the Quote button. This will open a new response where you can add your thoughts — your quotation will link back to this entry and vice-versa.
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              The thread stays linear, but the connections between ideas are visible.
            </p>
            <p style={{ margin: "0 0 32px", fontSize: 15, lineHeight: 1.6, opacity: 0.65, fontStyle: "italic" }}>
              This might feel confusing, but try it out! You can always edit your response after you post it.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn" style={{ fontSize: 15, padding: "8px 24px" }} onClick={() => setThreadQuoteHint(false)}>Got it</button>
            </div>
          </div>
        </Modal>
      )}

      {showDeleteModal && (
        <Modal onClose={cancelDelete} width="min(420px,90vw)">
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <h3 className="title" style={{ margin: "0 0 16px", fontSize: 18 }}>Delete this entry?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, margin: "0 0 24px" }}>
              If it has responses, they'll stay visible in the room as a tombstone. Otherwise the entry disappears from the feed.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
              <button
                className="btn"
                onClick={handleDelete}
                disabled={deleteSubmitting}
                style={{ background: "var(--danger)", border: "none", color: "#fff" }}
              >
                {deleteSubmitting ? "Deleting…" : "Delete"}
              </button>
              <button
                className="btn"
                onClick={cancelDelete}
                style={{ background: "transparent", border: "2px solid #fff", color: "#fff" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
