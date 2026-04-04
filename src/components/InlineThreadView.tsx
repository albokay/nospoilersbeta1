import React, { useEffect, useState } from "react";
import type { Thread } from "../types";
import { timeAgo } from "../lib/utils";
import { useAuth } from "../lib/auth";
import { editThread as dbEditThread, deleteThread as dbDeleteThread, makeThreadPrivate as dbMakeThreadPrivate, makeThreadPublic as dbMakeThreadPublic } from "../lib/db";
import type { CitationEntry } from "../lib/db";
import LikeBadge from "./LikeBadge";
import RepliesList from "./RepliesList";
import Username from "./Username";
import ResponseComposer from "./ResponseComposer";
import type { PendingReference } from "./ResponseComposer";
import { useScrollHighlight } from "../hooks/useScrollHighlight";

function superscriptNum(n: number): string {
  const supers = ["¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
  return supers[n - 1] ?? `(${n})`;
}

function FootnoteSups({
  citations,
  onScrollTo,
}: {
  citations: CitationEntry[];
  onScrollTo: (id: string) => void;
}) {
  if (!citations.length) return null;
  return (
    <div className="footnote-sups">
      {citations.map((c) => (
        <sup key={c.citingReplyId}>
          <button
            onClick={() => onScrollTo(`reply-${c.citingReplyId}`)}
            title="Jump to citing response"
          >
            {superscriptNum(c.index)}
          </button>
        </sup>
      ))}
    </div>
  );
}

export default function InlineThreadView({
  thread, show, onBack, progressForShow, onMountAlignTop,
  likeThread, likedByUser, likesCount,
  likeReply, unlikeReply, likesReplies, likedByUserReplies,
  mode, focusReplyId, onAuthRequired, hiddenNewReplies = 0, onRiskyReveal,
  onThreadUpdate, onThreadDelete, onThreadMakePrivate, onThreadMakePublic,
  hasExternalReplies = false, onExternalReplyAdded, onReplyDeleted, freshReplyIds, onClickProfile,
  // New reference-system props
  pendingReference, onSetPendingReference, composerRef, onScrollToComposer,
  citations, threadCitations, onRepliesLoaded,
}: {
  thread: Thread;
  show: any;
  onBack: () => void;
  progressForShow?: { s: number; e: number };
  onMountAlignTop?: () => void;
  likeThread: () => void;
  likedByUser: boolean;
  likesCount: number;
  likeReply: (rid: string) => void;
  unlikeReply: (rid: string) => void;
  likesReplies: Record<string, number>;
  likedByUserReplies: Record<string, boolean>;
  mode: "standard" | "risky";
  focusReplyId?: string | null;
  onAuthRequired: () => void;
  hiddenNewReplies?: number;
  onRiskyReveal?: (rid: string) => void;
  onThreadUpdate?: (updated: Thread) => void;
  onThreadDelete?: () => void;
  onThreadMakePrivate?: () => void;
  onThreadMakePublic?: () => void;
  hasExternalReplies?: boolean;
  onExternalReplyAdded?: (threadId: string) => void;
  onReplyDeleted?: (rid: string) => void;
  freshReplyIds?: Record<string, true>;
  onClickProfile?: (username: string) => void;
  // Reference system
  pendingReference?: PendingReference | null;
  onSetPendingReference?: (ref: PendingReference | null) => void;
  composerRef?: React.RefObject<HTMLDivElement>;
  onScrollToComposer?: () => void;
  citations?: Map<string, CitationEntry[]>;
  threadCitations?: CitationEntry[];
  onRepliesLoaded?: (replyIds: string[]) => void;
}) {
  const { user, profile } = useAuth();
  const isOwn = !!profile && thread.author === profile.username;
  const { scrollTo: scrollHighlight } = useScrollHighlight();

  // ── Edit state ────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(thread.titleBase);
  const [editBody, setEditBody] = useState(thread.body);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Track loaded replies count to show "Write a response" on entry when >= 5
  const [loadedRepliesCount, setLoadedRepliesCount] = useState(0);

  // Increment to force RepliesList to re-fetch after a new reply is submitted
  const [repliesKey, setRepliesKey] = useState(0);

  // Reset edit fields whenever thread changes
  useEffect(() => {
    setEditTitle(thread.titleBase);
    setEditBody(thread.body);
    setEditing(false);
    setEditError(null);
  }, [thread.id]);

  useEffect(() => { onMountAlignTop?.(); }, []);

  const handleQuoteThread = () => {
    if (!user) { onAuthRequired(); return; }
    const sel = window.getSelection();
    let quotedText = "";
    if (sel && sel.toString().trim()) {
      quotedText = sel.toString().trim();
    } else {
      quotedText = thread.body.slice(0, 300) + (thread.body.length > 300 ? "…" : "");
    }
    onSetPendingReference?.({
      type: "quote",
      threadId: thread.id,
      authorName: thread.author,
      quotedText,
    });
    onScrollToComposer?.();
  };

  const handleStartEdit = () => {
    setEditTitle(thread.titleBase);
    setEditBody(thread.body);
    setEditError(null);
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    const title = editTitle.trim() || "Untitled note";
    const body = editBody.trim() || "(blank)";
    setEditSubmitting(true);
    setEditError(null);
    try {
      await dbEditThread(thread.id, title, body);
      const preview = body.slice(0, 240) + (body.length > 240 ? "…" : "");
      onThreadUpdate?.({ ...thread, titleBase: title, body, preview, isEdited: true });
      setEditing(false);
    } catch (e: any) {
      setEditError(e?.message ?? "Failed to save. Please try again.");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this post? It will turn into a stub visible to others.")) return;
    try {
      await dbDeleteThread(thread.id);
      onThreadDelete?.();
    } catch {
      alert("Failed to delete. Please try again.");
    }
  };

  const handleMakePrivate = async () => {
    try {
      await dbMakeThreadPrivate(thread.id);
      onThreadMakePrivate?.();
    } catch {
      alert("Failed. Please try again.");
    }
  };

  const handleMakePublic = async () => {
    try {
      await dbMakeThreadPublic(thread.id);
      onThreadMakePublic?.();
    } catch {
      alert("Failed. Please try again.");
    }
  };

  const handleComposerSubmitted = () => {
    // Increment key to force RepliesList to re-fetch (also re-runs onRepliesLoaded → citations refresh)
    setRepliesKey(k => k + 1);
    // Notify parent
    if (profile && profile.username !== thread.author) {
      onExternalReplyAdded?.(thread.id);
    }
  };

  return (
    <section className="container" style={{ padding: "16px 0 24px" }}>
      <div id="thread-entry" className="card" style={{ marginTop: 12 }}>
        {editing ? (
          /* ── Edit form ── */
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: "var(--dos-gray)" }}>
              Editing post
            </div>
            <input
              className="badge"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              placeholder="Title"
              style={{ width: "100%", height: 40, fontWeight: 700, marginBottom: 10 }}
            />
            <textarea
              className="card"
              value={editBody}
              onChange={e => setEditBody(e.target.value)}
              style={{ width: "100%", height: 220, resize: "vertical", fontFamily: "inherit", fontSize: 14 }}
            />
            {editError && (
              <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 4 }}>{editError}</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={() => setEditing(false)} disabled={editSubmitting}>Cancel</button>
              <button
                className="btn primary"
                onClick={handleSaveEdit}
                disabled={editSubmitting || !editTitle.trim()}
              >
                {editSubmitting ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          /* ── Normal view ── */
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 22, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }} className="title">
                {thread.isPrivate && <span>📝</span>}
                <span>{thread.titleBase}</span>
                {thread.showId !== "simshow" && (
                  <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7 }}>
                    {`(S${String(thread.season).padStart(2, "0")} E${String(thread.episode).padStart(2, "0")})`}
                  </span>
                )}
                {thread.isEdited && (
                  <span style={{ fontStyle: "italic", fontSize: 14, fontWeight: 400, opacity: 0.7 }}>(edited)</span>
                )}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <LikeBadge
                  count={likesCount}
                  userLiked={likedByUser}
                  onClick={(e) => { e.stopPropagation(); likeThread(); }}
                  title="this post!"
                />
              </div>
            </div>

            <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>
              Started by <Username name={thread.author} onClickProfile={onClickProfile ?? (() => {})} /> • {timeAgo(thread.updatedAt)}
            </div>

            {thread.isDeleted ? (
              <div className="muted" style={{ marginTop: 12, fontSize: 14, fontStyle: "italic" }}>
                (@{thread.author}) deleted their post.
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div style={{ whiteSpace: "pre-wrap" }}>{thread.body}</div>
              </div>
            )}

            {/* Footnote superscripts for original entry */}
            {threadCitations && threadCitations.length > 0 && (
              <FootnoteSups citations={threadCitations} onScrollTo={scrollHighlight} />
            )}

            {!thread.isDeleted && (
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {isOwn && (
                  <>
                    <button className="btn" style={{ fontSize: 13 }} onClick={handleStartEdit}>Edit</button>
                    <button className="btn btn-danger" style={{ fontSize: 13 }} onClick={handleDelete}>Delete</button>
                    {!thread.isPrivate && !hasExternalReplies && (
                      <button className="btn" style={{ fontSize: 13 }} onClick={handleMakePrivate}>Turn Private</button>
                    )}
                    {thread.isPrivate && (
                      <button className="btn" style={{ fontSize: 13 }} onClick={handleMakePublic}>Turn Public</button>
                    )}
                  </>
                )}
                <button className="btn" style={{ fontSize: 13 }} onClick={handleQuoteThread}>Quote</button>
                {/* Show "Write a response" on original entry when >= 5 replies */}
                {loadedRepliesCount >= 5 && (
                  <button className="btn" onClick={onScrollToComposer}>Write a response</button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <RepliesList
          thread={thread}
          progressForShow={progressForShow}
          riskyMode={mode === "risky"}
          likeReply={likeReply}
          unlikeReply={unlikeReply}
          likesReplies={likesReplies}
          likedByUserReplies={likedByUserReplies}
          focusReplyId={focusReplyId}
          onAuthRequired={onAuthRequired}
          onRiskyReveal={onRiskyReveal}
          onExternalReplyAdded={onExternalReplyAdded ? () => onExternalReplyAdded(thread.id) : undefined}
          onReplyDeleted={onReplyDeleted}
          freshReplyIds={freshReplyIds}
          onClickProfile={onClickProfile}
          onSetPendingReference={onSetPendingReference}
          pendingReference={pendingReference}
          citations={citations}
          threadCitations={threadCitations}
          composerRef={composerRef}
          onScrollToComposer={onScrollToComposer}
          refreshKey={repliesKey}
          onRepliesLoaded={(replies) => {
            setLoadedRepliesCount(replies.filter(r => !r.isDeleted).length);
            onRepliesLoaded?.(replies.map(r => r.id));
          }}
        />
      </div>

      {/* Composer always at bottom */}
      <ResponseComposer
        threadId={thread.id}
        showId={thread.showId}
        viewerSeason={progressForShow?.s ?? thread.season}
        viewerEpisode={progressForShow?.e ?? thread.episode}
        onSubmitted={handleComposerSubmitted}
        pendingReference={pendingReference ?? null}
        onClearReference={() => onSetPendingReference?.(null)}
        composerRef={composerRef ?? { current: null }}
        onAuthRequired={onAuthRequired}
        threadAuthor={thread.author}
        onExternalReplyAdded={onExternalReplyAdded ? () => onExternalReplyAdded(thread.id) : undefined}
      />
    </section>
  );
}
