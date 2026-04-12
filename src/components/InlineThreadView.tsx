import React, { useEffect, useState, useMemo } from "react";
import type { Thread, Reply, ProgressEntry } from "../types";
import { timeAgo, canView } from "../lib/utils";
import { useAuth } from "../lib/auth";
import { editThread as dbEditThread, deleteThread as dbDeleteThread, setThreadPublic as dbSetThreadPublic, cloneThreadToPublic as dbCloneThreadToPublic, hasPublicClone as dbHasPublicClone } from "../lib/db";
import type { CitationEntry } from "../lib/db";
import LikeBadge from "./LikeBadge";
import Modal from "./Modal";
import RepliesList from "./RepliesList";
import Username from "./Username";
import ResponseComposer from "./ResponseComposer";
import type { PendingReference } from "./ResponseComposer";
import { useScrollHighlight } from "../hooks/useScrollHighlight";
import Tooltip from "./Tooltip";
import { annotateTextWithSups, UnmatchedSups } from "../lib/citationUtils";
import type { SupEntry } from "../lib/citationUtils";

// Matches [PROMPT: any text including newlines]
const PROMPT_TOKEN_RE_INLINE = /\[PROMPT:([\s\S]*?)\]/g;

function parsePromptTokensInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(PROMPT_TOKEN_RE_INLINE.source, "g");
  let keyIdx = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index).trimEnd());
    }
    const promptText = match[1].trim();
    parts.push(
      <blockquote key={`prompt-${keyIdx++}`} className="prompt-ref">
        {promptText}
      </blockquote>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last).trimStart());
  return parts;
}

export default function InlineThreadView({
  thread, show, onBack, progressForShow, onMountAlignTop,
  likeThread, likedByUser, likesCount,
  likeReply, unlikeReply, likesReplies, likedByUserReplies,
  mode, focusReplyId, onAuthRequired, hiddenNewReplies = 0, onRiskyReveal,
  onThreadUpdate, onThreadDelete, onThreadMakePrivate, onThreadMakePublic,
  onThreadSharedToPublic,
  hasExternalReplies = false, onExternalReplyAdded, onReplyDeleted, freshReplyIds, onClickProfile,
  // New reference-system props
  pendingReference, onSetPendingReference, composerRef, onScrollToComposer,
  citations, threadCitations, onRepliesLoaded,
  inGroupContext,
}: {
  thread: Thread;
  show: any;
  onBack: () => void;
  progressForShow?: ProgressEntry;
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
  onThreadDelete?: (loadedReplyCount: number) => void;
  onThreadMakePrivate?: () => void;
  onThreadMakePublic?: () => void;
  onThreadSharedToPublic?: (clone: Thread) => void;
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
  inGroupContext?: boolean;
}) {
  const { user, profile } = useAuth();
  const isOwn = !!profile && thread.author === profile.username;
  const { scrollTo: scrollHighlight } = useScrollHighlight();

  // ── Share-to-public state ─────────────────────────────────
  // Tracks whether a public clone already exists for this friend-room thread.
  // Initialized from the DB so the button stays disabled even after a refresh.
  const [sharedToPublic, setSharedToPublic] = useState(false);
  useEffect(() => {
    if (!inGroupContext || !isOwn) return;
    dbHasPublicClone(thread.id).then(setSharedToPublic).catch(() => {});
  }, [thread.id, inGroupContext, isOwn]);

  // ── Edit state ────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(thread.titleBase);
  const [editBody, setEditBody] = useState(thread.body);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Retag warning: shown when user's progress has advanced beyond the post's original tag
  const [showRetagWarning, setShowRetagWarning] = useState(false);

  // Store full loaded replies so we can build inline sups for the thread entry body
  const [loadedReplies, setLoadedReplies] = useState<Reply[]>([]);

  // Build inline citation sups for the original thread entry body
  const threadQuoteSups: SupEntry[] = useMemo(() => {
    if (!threadCitations || !loadedReplies.length) return [];
    const byId: Record<string, Reply> = {};
    for (const r of loadedReplies) byId[r.id] = r;
    return threadCitations
      .filter(c => {
        const cr = byId[c.citingReplyId];
        return cr && !cr.isDeleted && cr.referenceType === 'quote' && !!cr.quotedText &&
          (!progressForShow || canView({ season: cr.season, episode: cr.episode }, progressForShow));
      })
      .map((c, i) => ({
        index: i + 1,
        citedText: (byId[c.citingReplyId].quotedText ?? "").replace(/…$/, "").trim(),
        onScrollTo: () => scrollHighlight(`reply-${c.citingReplyId}`),
      }))
      .filter(s => s.citedText.length >= 4);
  }, [threadCitations, loadedReplies, progressForShow]);

  // Increment to force RepliesList to re-fetch after a new reply is submitted
  const [repliesKey, setRepliesKey] = useState(0);

  // Composer is hidden until the user explicitly opens it
  const [composerOpen, setComposerOpen] = useState(false);

  // Quote hint popup on the thread entry Quote button
  const [threadQuoteHint, setThreadQuoteHint] = useState(false);

  // One-time thread intro popup — shown the first time a user opens any thread.
  const [showThreadIntro, setShowThreadIntro] = useState(
    () => !localStorage.getItem("ns_thread_intro_seen")
  );
  const [showTurnPrivateTooltip] = useState(() => !localStorage.getItem("ns_turn_private_seen"));
  const dismissThreadIntro = () => {
    localStorage.setItem("ns_thread_intro_seen", "1");
    setShowThreadIntro(false);
  };

  // Open the composer then scroll to it (needs one RAF to let the DOM render first)
  const openComposer = () => {
    setComposerOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => onScrollToComposer?.()));
  };

  // Also open automatically when a pending reference (Quote/Link) is set from a reply
  useEffect(() => {
    if (pendingReference) openComposer();
  }, [pendingReference]);

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
    const selectedText = sel?.toString().trim() ?? "";
    if (!selectedText) {
      setThreadQuoteHint(h => !h);
      return;
    }
    setThreadQuoteHint(false);
    onSetPendingReference?.({
      type: "quote",
      threadId: thread.id,
      authorName: thread.author,
      quotedText: selectedText,
    });
    openComposer();
  };

  const handleStartEdit = () => {
    setEditTitle(thread.titleBase);
    setEditBody(thread.body);
    setEditError(null);
    setEditing(true);
  };

  // The season/episode this edit will be tagged with (always writer's current progress)
  const editTagS = progressForShow?.s ?? thread.season;
  const editTagE = progressForShow?.e ?? thread.episode;
  const progressHasAdvanced =
    progressForShow != null &&
    (progressForShow.s > thread.season ||
      (progressForShow.s === thread.season && progressForShow.e > thread.episode));

  const handleSaveEdit = async () => {
    // If progress has advanced, show confirmation before saving
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
      onThreadUpdate?.({ ...thread, titleBase: title, body, preview, season: editTagS, episode: editTagE, isEdited: true });
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
      // Pass the count of replies InlineThreadView actually loaded — more reliable
      // than ShowSection's potentially-stale replyCounts state.
      onThreadDelete?.(loadedReplies.length);
    } catch {
      alert("Failed to delete. Please try again.");
    }
  };

  const handleMakePrivate = async () => {
    try {
      await dbSetThreadPublic(thread.id, false);
      onThreadMakePrivate?.();
    } catch {
      alert("Failed. Please try again.");
    }
  };

  const handleMakePublic = async () => {
    try {
      if (inGroupContext) {
        // Two-instance model: create a public clone; replies stay isolated
        const clone = await dbCloneThreadToPublic(thread.id);
        setSharedToPublic(true);
        onThreadSharedToPublic?.(clone);
      } else {
        await dbSetThreadPublic(thread.id, true);
        onThreadMakePublic?.();
      }
    } catch (err: any) {
      alert("Failed: " + (err?.message ?? JSON.stringify(err)));
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
      {threadQuoteHint && (
        <Modal onClose={() => setThreadQuoteHint(false)} width="min(520px,92vw)" cardClassName="explanation-card">
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              🗣️ Highlight the portion of any entry that you'd like to respond to, then click the Quote button. This will open a new response where you can add your thoughts — your quotation will link back to this entry and vice-versa.
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

      {showThreadIntro && (
        <Modal
          onClose={dismissThreadIntro}
          width="min(520px,92vw)"
          cardClassName="explanation-card"
        >
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 24px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              👋 Sidebar's response threads are deliberately different from typical forums. Every response goes to the bottom of the thread in the order it was written. This encourages you to react to each thread as a cohesive conversation. No indentation. No branching comment trees. No sub-heads. One conversation.
            </p>
            <p style={{ margin: "0 0 32px", fontSize: 15, lineHeight: 1.6, opacity: 0.65, fontStyle: "italic" }}>
              (But you'll see a couple unexpected ways to interact when you look around…)
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn" style={{ fontSize: 15, padding: "8px 24px" }} onClick={dismissThreadIntro}>
                Got it
              </button>
            </div>
          </div>
        </Modal>
      )}
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
            {showRetagWarning && (
              <div style={{ background: "var(--dos-bg)", border: "1px solid var(--dos-border)", borderRadius: 6, padding: "12px 14px", marginTop: 10, fontSize: 13 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Heads up — this post will be retagged</div>
                <div style={{ opacity: 0.85, marginBottom: 10 }}>
                  Your progress has moved to{" "}
                  <strong>S{String(editTagS).padStart(2,"0")} E{String(editTagE).padStart(2,"0")}</strong>.
                  {" "}Saving will retag this post to your current progress — readers below that point who could see it before will no longer see it.
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn" onClick={() => setShowRetagWarning(false)} disabled={editSubmitting}>Go back</button>
                  <button className="btn primary" onClick={handleSaveEdit} disabled={editSubmitting}>
                    {editSubmitting ? "Saving…" : "Save & retag"}
                  </button>
                </div>
              </div>
            )}
            {!showRetagWarning && (
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
            )}
          </div>
        ) : (
          /* ── Normal view ── */
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 22, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }} className="title">
                {!thread.isPublic && <span>📝</span>}
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
              <div style={{ marginTop: 12 }} className="thread-entry-body">
                {(() => {
                  const promptParts = parsePromptTokensInline(thread.body);
                  const renderedParts: React.ReactNode[] = [];
                  let remainingSups: SupEntry[] = [];
                  let pkIdx = 0;
                  for (const part of promptParts) {
                    if (typeof part === "string") {
                      const { nodes, matchedIndices } = annotateTextWithSups(part, remainingSups);
                      remainingSups = remainingSups.filter(s => !matchedIndices.has(s.index));
                      renderedParts.push(...nodes.map((n, i) => <React.Fragment key={`tp-${pkIdx}-${i}`}>{n}</React.Fragment>));
                    } else {
                      renderedParts.push(<React.Fragment key={`tf-${pkIdx}`}>{part}</React.Fragment>);
                    }
                    pkIdx++;
                  }
                  return (
                    <div style={{ whiteSpace: "pre-wrap" }}>
                      {renderedParts}
                      <UnmatchedSups sups={remainingSups} />
                    </div>
                  );
                })()}
              </div>
            )}

            {!thread.isDeleted && (
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {isOwn && (
                  <>
                    <button className="btn" style={{ fontSize: 13 }} onClick={handleStartEdit}>Edit</button>
                    <button className="btn btn-danger" style={{ fontSize: 13 }} onClick={handleDelete}>Delete</button>
                    {thread.isPublic && !hasExternalReplies && (
                      <Tooltip
                        text="As long as no one has responded to your entry yet, you can move it to your private journal."
                        direction="above"
                        align="center"
                        width={240}
                        tooltipStyle={{ background: "#bdd4de", color: "#000", textAlign: "left", borderRadius: 10, fontSize: 13, fontWeight: 400, lineHeight: 1.5 }}
                        disabled={!showTurnPrivateTooltip}
                      >
                        <button
                          className="btn"
                          style={{ fontSize: 13 }}
                          onClick={handleMakePrivate}
                          onMouseEnter={() => localStorage.setItem("ns_turn_private_seen", "1")}
                        >Turn Private</button>
                      </Tooltip>
                    )}
                    {!thread.isPublic && (
                      inGroupContext ? (
                        <button
                          className="btn"
                          style={{ fontSize: 13, opacity: sharedToPublic ? 0.55 : 1, cursor: sharedToPublic ? "default" : "pointer", pointerEvents: sharedToPublic ? "none" : "auto" }}
                          onClick={sharedToPublic ? undefined : handleMakePublic}
                          disabled={sharedToPublic}
                        >
                          {sharedToPublic ? "✓ Shared to Public" : "Share to Public"}
                        </button>
                      ) : (
                        <button className="btn" style={{ fontSize: 13 }} onClick={handleMakePublic}>Turn Public</button>
                      )
                    )}
                  </>
                )}
                <button className="btn" style={{ fontSize: 13 }} onClick={handleQuoteThread}>Quote</button>
                <button className="btn" onClick={openComposer}>Write a response</button>
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
          onScrollToComposer={openComposer}
          refreshKey={repliesKey}
          onRepliesLoaded={(replies) => {
            setLoadedReplies(replies);
            onRepliesLoaded?.(replies.map(r => r.id));
          }}
        />
      </div>

      {/* Composer — only rendered after the user opens it */}
      {composerOpen && <ResponseComposer
        threadId={thread.id}
        showId={thread.showId}
        viewerSeason={progressForShow?.s ?? thread.season}
        viewerEpisode={progressForShow?.e ?? thread.episode}
        postTagSeason={progressForShow?.isRewatching && progressForShow.highestS ? progressForShow.highestS : (progressForShow?.s ?? thread.season)}
        postTagEpisode={progressForShow?.isRewatching && progressForShow.highestE ? progressForShow.highestE : (progressForShow?.e ?? thread.episode)}
        isRewatch={progressForShow?.isRewatching ?? false}
        onSubmitted={handleComposerSubmitted}
        onCancel={() => setComposerOpen(false)}
        pendingReference={pendingReference ?? null}
        onClearReference={() => onSetPendingReference?.(null)}
        composerRef={composerRef ?? { current: null }}
        onAuthRequired={onAuthRequired}
        threadAuthor={thread.author}
        onExternalReplyAdded={onExternalReplyAdded ? () => onExternalReplyAdded(thread.id) : undefined}
        show={show}
        progress={progressForShow}
        inGroupContext={inGroupContext}
      />}
    </section>
  );
}
