import React, { useEffect, useState, useMemo, useRef } from "react";
import { MessageSquare, Hand, LockKeyhole, Globe, Users } from "lucide-react";
import type { Thread, Reply, ProgressEntry } from "../types";
import type { FriendGroup } from "../types";
import { timeAgo, canView, effectiveProgress } from "../lib/utils";
import EpisodeTag from "./EpisodeTag";
import { useAuth } from "../lib/auth";
import { editThread as dbEditThread, deleteThread as dbDeleteThread, setThreadPublic as dbSetThreadPublic, addThreadToGroup } from "../lib/db";
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
  groupId: groupIdProp,
  userGroups,
  onThreadMovedToGroup,
  departedUsernames,
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
  onThreadDelete?: () => void;
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
  groupId?: string | null;
  userGroups?: FriendGroup[];
  onThreadMovedToGroup?: (groupId: string) => void;
  departedUsernames?: Set<string>;
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

  const [showMoveOptions, setShowMoveOptions] = useState(false);
  const moveOptionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMoveOptions) return;
    const handler = (e: MouseEvent) => {
      if (moveOptionsRef.current && !moveOptionsRef.current.contains(e.target as Node)) {
        setShowMoveOptions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMoveOptions]);

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

  // The season/episode this edit will be tagged with — writer's current
  // *effective* progress (highest for rewatchers, raw .s/.e otherwise).
  // Rewatchers must re-tag at highest because that's their spoiler context;
  // tagging at the rewatch position would expose hindsight-informed content
  // to readers who were supposed to be protected.
  const editTag = effectiveProgress(progressForShow);
  const editTagS = editTag?.s ?? thread.season;
  const editTagE = editTag?.e ?? thread.episode;
  const progressHasAdvanced =
    editTag != null &&
    (editTag.s > thread.season ||
      (editTag.s === thread.season && editTag.e > thread.episode));

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
      onThreadDelete?.();
    } catch {
      alert("Failed to delete. Please try again.");
    }
  };

  const handleMakePublic = async () => {
    try {
      await dbSetThreadPublic(thread.id, true);
      setShowMoveOptions(false);
      onThreadMakePublic?.();
    } catch (err: any) {
      alert("Failed: " + (err?.message ?? JSON.stringify(err)));
    }
  };

  const handleMoveToGroup = async (groupId: string) => {
    try {
      await addThreadToGroup(thread.id, groupId);
      setShowMoveOptions(false);
      onThreadMovedToGroup?.(groupId);
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

      {showThreadIntro && (
        <Modal
          onClose={dismissThreadIntro}
          width="min(520px,92vw)"
          cardClassName="explanation-card"
        >
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 24px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              <Hand size={14} color="currentColor" /> Sidebar's response threads are deliberately different from typical forums. Every response goes to the bottom of the thread in the order it was written. This encourages you to react to each thread as a cohesive conversation. No indentation. No branching comment trees. No sub-heads. One conversation.
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
              <div className="retag-warning" style={{ background: "var(--dos-bg)", border: "1px solid var(--dos-border)", borderRadius: 6, padding: "12px 14px", marginTop: 10, fontSize: 13 }}>
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
                {!thread.isPublic && <span><LockKeyhole size={14} color="var(--icon-color)" /></span>}
                <span>{thread.titleBase}</span>
                {thread.showId !== "simshow" && (
                  <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7 }}>
                    <EpisodeTag
                      season={thread.season}
                      episode={thread.episode}
                      isRewatch={thread.isRewatch}
                      rewatchS={thread.rewatchS}
                      rewatchE={thread.rewatchE}
                    />
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
              Started by <Username name={thread.author} onClickProfile={onClickProfile ?? (() => {})} />
              {inGroupContext && departedUsernames?.has(thread.author) && (
                <span style={{ fontStyle: "italic", fontSize: 12, opacity: 0.6, marginLeft: 4 }}>has left the room</span>
              )}
              {" "}• {timeAgo(thread.updatedAt)}
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
                    {loadedReplies.length > 0 ? (
                      <Tooltip
                        text="This entry can't be edited because others have responded to it."
                        direction="above"
                        align="right"
                        useAbsolute={true}
                        width={220}
                      >
                        <button className="btn" style={{ fontSize: 13, opacity: 0.45, pointerEvents: "none" }} disabled>Edit</button>
                      </Tooltip>
                    ) : (
                      <button className="btn" style={{ fontSize: 13 }} onClick={handleStartEdit}>Edit</button>
                    )}
                    <button className="btn btn-danger" style={{ fontSize: 13 }} onClick={handleDelete}>Delete</button>
                    {/* Private posts (non-group context) can be moved to public or a friend room */}
                    {!thread.isPublic && !inGroupContext && (
                      <div ref={moveOptionsRef} style={{ position: "relative" }}>
                        <button
                          className="btn"
                          style={{
                            fontSize: 13,
                            ...(showMoveOptions ? { background: "rgba(255,255,255,0.25)", borderColor: "rgba(255,255,255,0.8)" } : {})
                          }}
                          onClick={() => setShowMoveOptions(v => !v)}
                        >
                          Move to →
                        </button>
                        {showMoveOptions && (
                          <div className="move-to-dropdown" style={{
                            position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                            display: "flex", flexDirection: "column", gap: 6,
                            background: "var(--dos-bg)", border: "none",
                            borderRadius: 10, padding: "8px", zIndex: 10,
                            boxShadow: "0 2px 10px rgba(0,0,0,0.18)"
                          }}>
                            <button className="btn" style={{ fontSize: 13, whiteSpace: "nowrap" }} onClick={handleMakePublic}><Globe size={14} color="var(--icon-color)" /> Public Room</button>
                            {(userGroups ?? []).map(g => (
                              <button key={g.id} className="btn" style={{ fontSize: 13, whiteSpace: "nowrap" }} onClick={() => handleMoveToGroup(g.id)}>
                                <Users size={14} color="var(--icon-color)" /> {g.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
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
          groupId={groupIdProp}
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
          departedUsernames={departedUsernames}
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
        rewatchSnapshotSeason={progressForShow?.isRewatching ? (progressForShow.rewatchS ?? progressForShow.s) : undefined}
        rewatchSnapshotEpisode={progressForShow?.isRewatching ? (progressForShow.rewatchE ?? progressForShow.e) : undefined}
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
        groupId={groupIdProp}
      />}
    </section>
  );
}
