import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Pencil, Quote, Trash2 } from "lucide-react";
import LikeBadge from "../LikeBadge";
import Modal from "../Modal";
import RepliesList from "../RepliesList";
import ResponseComposer, { type PendingReference } from "../ResponseComposer";
import { useAuth } from "../../lib/auth";
import {
  deleteThread as dbDeleteThread,
  editThread as dbEditThread,
  fetchV2ThreadDetail,
  likeReply as dbLikeReply,
  likeThread as dbLikeThread,
  unlikeReply as dbUnlikeReply,
  unlikeThread as dbUnlikeThread,
  type CitationEntry,
} from "../../lib/db";
import { effectiveProgress } from "../../lib/utils";
import type { ProgressEntry, Thread } from "../../types";

// V2 friend-room inline thread view.
//
// Mounted inside V2RoomFeed's expanded ticket state. Renders body + action
// row (star / edit / delete / quote) + RepliesList + a bottom collapse
// button. Reply composer + quote-into-composer wiring lands in checkpoint 4.
//
// Tombstone (deleted entry with replies still on it): gravestone body
// replaces the entry body, the action row is hidden, replies still render.

export type V2InlineThreadProps = {
  thread: Thread;
  groupId: string;
  viewerProgress: ProgressEntry | null;
  userId: string;
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
};

export default function V2InlineThread({
  thread,
  groupId,
  viewerProgress,
  userId,
  onCollapseTop,
  onAuthRequired,
  onThreadEdited,
  onThreadDeleted,
  onDraftChange,
}: V2InlineThreadProps) {
  const { profile } = useAuth();
  const isOwn = !!profile && thread.author === profile.username;
  const isTombstone = !!thread.isDeleted;

  // Composer + pending-reference + draft-tracking state
  const composerWrapperRef = useRef<HTMLDivElement>(null);
  const composerInnerRef = useRef<HTMLDivElement>(null);
  const [pendingReference, setPendingReference] = useState<PendingReference | null>(null);
  // composerKey lets us remount the composer to clear its internal body
  // state when the user clicks Cancel (the live ResponseComposer's body is
  // uncontrolled — remount is the cheapest reset path).
  const [composerKey, setComposerKey] = useState(0);
  // refreshKey forces RepliesList to refetch when a new reply lands.
  const [repliesKey, setRepliesKey] = useState(0);

  // ── Fetched state ───────────────────────────────────────────────────────
  const [loadError, setLoadError] = useState<string | null>(null);
  const [threadLikes, setThreadLikes] = useState<number>(thread.likes ?? 0);
  const [threadLikedByMe, setThreadLikedByMe] = useState<boolean>(false);
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

  // Keep edit field defaults in sync with the source thread (e.g. after an
  // edit succeeds and the parent re-renders with updated content).
  useEffect(() => {
    setEditTitle(thread.titleBase);
    setEditBody(thread.body);
    setThreadLikes(thread.likes ?? 0);
  }, [thread.id, thread.titleBase, thread.body, thread.likes]);

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
        setThreadLikedByMe(detail.threadLikedByMe);
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
  }, [thread.id, groupId, userId]);

  // ── Thread-level star (like/unlike) ─────────────────────────────────────
  const handleToggleLike = useCallback(() => {
    if (!userId) {
      onAuthRequired?.();
      return;
    }
    if (threadLikedByMe) {
      setThreadLikedByMe(false);
      setThreadLikes((n) => Math.max(0, n - 1));
      dbUnlikeThread(userId, thread.id).catch(() => {
        setThreadLikedByMe(true);
        setThreadLikes((n) => n + 1);
      });
    } else {
      setThreadLikedByMe(true);
      setThreadLikes((n) => n + 1);
      dbLikeThread(userId, thread.id).catch(() => {
        setThreadLikedByMe(false);
        setThreadLikes((n) => Math.max(0, n - 1));
      });
    }
  }, [userId, threadLikedByMe, thread.id, onAuthRequired]);

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
  // Re-tag at the writer's effective progress (highest for rewatchers).
  // Matches the v1 InlineThreadView retag rule — the "spoiler ceiling"
  // determines what others can see.
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

  // ── Quote — stages a pendingReference into the composer. Same pattern
  // as the live thread view: clicking quote on the entry sets the ref so
  // the composer renders the quoted body and includes it on submit.
  const handleQuote = () => {
    setPendingReference({
      type: "quote",
      threadId: thread.id,
      authorName: thread.author,
      quotedText: thread.body,
    });
    // Best-effort scroll the composer into view so the user sees the
    // staged quote without hunting for it.
    composerInnerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // ── Draft tracking — listen to input events bubbling from the composer
  // textarea. Set hasDraft based on textarea value. ResponseComposer's body
  // state is uncontrolled internally; intercepting via the DOM event
  // avoids touching the live component.
  const handleComposerInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== "TEXTAREA") return;
      const val = (target as HTMLTextAreaElement).value;
      onDraftChange?.(val.trim().length > 0);
    },
    [onDraftChange],
  );

  // After a successful submit, ResponseComposer clears its body
  // programmatically (no input event fires on programmatic state changes
  // in React). Signal the parent that the draft is empty + bump the
  // replies key so RepliesList refetches.
  const handleComposerSubmitted = useCallback(() => {
    onDraftChange?.(false);
    setRepliesKey((k) => k + 1);
  }, [onDraftChange]);

  // Cancel inside the composer — remount to clear the body and notify
  // the parent that the draft is gone.
  const handleComposerCancel = useCallback(() => {
    setComposerKey((k) => k + 1);
    setPendingReference(null);
    onDraftChange?.(false);
  }, [onDraftChange]);

  if (loadError) {
    return (
      <div className="muted" style={{ fontSize: 14, padding: "16px 0" }}>
        {loadError}
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* Body — gravestone if tombstone; edit form if editing; plain body otherwise */}
      {isTombstone ? (
        <div style={{ marginTop: 8, fontStyle: "italic", color: "#1a3a4a", opacity: 0.7 }}>
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

      {/* Action row — star + edit/delete (owner) + quote (everyone). Hidden
          on tombstones and while editing. */}
      {!isTombstone && !editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", marginTop: 8 }}>
          <LikeBadge
            count={threadLikes}
            userLiked={threadLikedByMe}
            onClick={handleToggleLike}
            title={threadLikedByMe ? "Unstar" : "Star this entry"}
          />
          <div style={{ flex: 1 }} />
          {isOwn && (
            <>
              <button
                className="btn"
                onClick={openEdit}
                style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Pencil size={13} /> edit
              </button>
              <button
                className="btn btn-danger"
                onClick={openDelete}
                style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Trash2 size={13} /> delete
              </button>
            </>
          )}
          <button
            className="btn"
            onClick={handleQuote}
            style={{ fontSize: 12, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}
            title="Quote this entry in a reply (composer lands in checkpoint 4)"
          >
            <Quote size={13} /> quote
          </button>
        </div>
      )}

      {/* Replies list — chain-visibility filter built into RepliesList. */}
      <div style={{ marginTop: 16 }}>
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
          onScrollToComposer={() =>
            composerInnerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
          }
          refreshKey={repliesKey}
        />
      </div>

      {/* Reply composer — always-on at the bottom of the inline view. The
          wrapper captures bubbling input events from the textarea so the
          parent can gate collapse / cross-thread expansion when there's
          unsaved draft text. composerKey forces remount on cancel to
          clear the (uncontrolled) body state. */}
      {!isTombstone && (
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
            onClearReference={() => setPendingReference(null)}
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
          <ChevronDown size={13} /> collapse
        </button>
      </div>

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
