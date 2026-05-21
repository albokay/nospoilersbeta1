import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, Users } from "lucide-react";
import EpisodeTag from "../EpisodeTag";
import LikeBadge from "../LikeBadge";
import Username from "../Username";
import Tooltip from "../Tooltip";
import { timeAgo } from "../../lib/utils";
import { parsePromptTokens } from "../../lib/promptTokens";
import V2InlineThread from "./V2InlineThread";
import Modal from "../Modal";
import {
  likeThread as dbLikeThread,
  unlikeThread as dbUnlikeThread,
} from "../../lib/db";
import type { ProgressEntry, Thread } from "../../types";

// V2 friend room feed — episode-ascending list of entry tickets.
//
// Each ticket has two inline display states (collapsed / expanded) plus a
// "navigate out" action when the card body itself is clicked. The body→
// thread click and the expand→toggle click are two separate hit targets
// on the same card; expand stops propagation so it doesn't also navigate.
//
// External scroll-and-highlight (used by the map's cell-click): callers
// pass a ref and invoke `scrollToEntry(threadId)`. The component scrolls
// the ticket into view and flips the ticket's outer border to canon blue
// (`#355eb8`) for ~1.5s — the same visual signal `ShowSection.tsx` uses
// for newly-visible threads after a progress bump (its `isNew` branch on
// the card border). No keyframe animation; just a snap on/off of the
// border color, matching the live treatment exactly.

export type V2RoomFeedEntry = {
  threadId: string;
  s: number;
  e: number;
  title: string;
  body: string;
  preview: string;
  authorId: string;
  authorUsername: string;
  isRewatch?: boolean;
  rewatchS?: number;
  rewatchE?: number;
  isEdited?: boolean;
  /** Author has departed this room. Adds the inline "has left the room" tag. */
  isDeparted?: boolean;
  /** Soft-deleted but kept in the feed because the thread has replies. Renders
      as a tombstone (gravestone copy in place of title/body; no star). */
  isDeleted?: boolean;
  updatedAt: number;
  replyCount: number;
  /** Full Thread object — needed when the ticket expands and mounts
      V2InlineThread, which expects the Thread shape (not the lean entry
      projection). Built from the raw fetchGroupThreads result. */
  thread: Thread;
};

export type V2RoomFeedHandle = {
  scrollToEntry: (threadId: string) => void;
};

export type V2RoomFeedProps = {
  entries: V2RoomFeedEntry[];
  /** Episode-tag sort direction. Default "asc". */
  sortOrder?: "asc" | "desc";
  /** Room context — required so the inline thread mount can scope its
      data fetch (replies + likes + citations) to the right group. */
  groupId: string;
  viewerProgress: ProgressEntry | null;
  userId: string;
  onAuthRequired?: () => void;
  /** Forwarded from V2InlineThread — parent decides how to update the feed. */
  onThreadEdited?: (updated: Thread) => void;
  onThreadDeleted?: (threadId: string) => void;
  /** Fires whenever the set of entries currently intersecting the viewport
      changes. Drives V2RoomMap's click-to-adjust-ratings flow — a self-cell
      whose entry IS visible rotates rating on click; one whose entry is OFF-
      screen scrolls to it instead. */
  onVisibleEntriesChange?: (visibleIds: Set<string>) => void;
  /** Click handler for username bylines (entry author + reply authors).
      Forwarded to V2InlineThread → RepliesList. Used by V2RoomFeed itself
      for the entry byline. Routes to /v2/u/<username>. */
  onClickProfile?: (username: string) => void;
  /** Fires when an entry transitions from collapsed → expanded. Used by
      V2FriendRoomPage to update lastOpenedAt + dismiss the green signal
      for this thread in the current session. */
  onEntryExpanded?: (threadId: string) => void;
  /** Fires when an entry transitions from expanded → collapsed (either via
      the inline collapse button or by expanding a different entry). Used
      by V2FriendRoomPage to mark the entry as engaged-this-session, which
      dismisses the A1 white outline. */
  onEntryCollapsed?: (threadId: string) => void;
  /** Per-thread "new since last room visit" flag. Drives the A1 white
      outline on the entry card (4px). Same lookup the map uses for the
      cell's white outline. */
  isNewMap?: Record<string, boolean>;
  /** Per-thread notification signal (green = visible-new responses;
      red = own-entry hidden responses). Only "green" matters for the
      entry card — drives the A2 green-filled circle behind the expand
      chevron on collapsed cards. Red is map-only. */
  cellSignals?: Record<string, { kind: "green" | "red"; redCount?: number }>;
  /** Set of threadIds the user has expanded-and-collapsed at least once
      this session. Drives A4 (entry card dim to opacity 0.5). */
  engagedThreadIds?: Set<string>;
};

const HIGHLIGHT_MS = 1500;

const V2RoomFeed = forwardRef<V2RoomFeedHandle, V2RoomFeedProps>(function V2RoomFeed(
  {
    entries,
    sortOrder = "asc",
    groupId,
    viewerProgress,
    userId,
    onAuthRequired,
    onThreadEdited,
    onThreadDeleted,
    onVisibleEntriesChange,
    onClickProfile,
    onEntryExpanded,
    onEntryCollapsed,
    isNewMap,
    cellSignals,
    engagedThreadIds,
  },
  ref,
) {
  // Episode sort. Within an episode, chronological by updatedAt always
  // (oldest first). Across episodes, asc/desc controlled by sortOrder
  // (desc puts the newest episode tag at the top).
  const sorted = useMemo(() => {
    const dir = sortOrder === "desc" ? -1 : 1;
    return [...entries].sort((a, b) => {
      if (a.s !== b.s) return dir * (a.s - b.s);
      if (a.e !== b.e) return dir * (a.e - b.e);
      return a.updatedAt - b.updatedAt;
    });
  }, [entries, sortOrder]);

  // Single-expansion: at most one thread expanded at a time. Expanding
  // another quietly collapses the previously-open one (no scroll-jump —
  // the page layout reflows naturally; the user's viewport scroll position
  // stays where it was).
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  // Detect expand/collapse transitions and forward to parent callbacks so
  // V2FriendRoomPage can update its notification-signal state (lastOpenedAt,
  // greenDismissedSet, engagedSet). prevExpandedRef tracks the previous
  // expandedThreadId; on each change, fire onEntryCollapsed for the previous
  // (if it existed) and onEntryExpanded for the new (if it exists).
  const prevExpandedRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevExpandedRef.current;
    if (prev && prev !== expandedThreadId) {
      onEntryCollapsed?.(prev);
    }
    if (expandedThreadId && expandedThreadId !== prev) {
      onEntryExpanded?.(expandedThreadId);
    }
    prevExpandedRef.current = expandedThreadId;
  }, [expandedThreadId, onEntryExpanded, onEntryCollapsed]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const ticketRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimer = useRef<number | null>(null);

  // Draft-guard: the currently-expanded thread's composer reports its draft
  // state via onDraftChange. If it has unsaved text, intercept the next
  // expansion-state change (collapse OR cross-thread expand) with a confirm
  // modal. `pendingCollapseTarget` holds the user-intended next state:
  //   - "self" → collapse the currently-expanded thread
  //   - <threadId> → expand a different thread (auto-collapsing current)
  //   - null → no pending change
  const [hasDraft, setHasDraft] = useState(false);
  const [pendingCollapseTarget, setPendingCollapseTarget] = useState<
    string | "self" | null
  >(null);

  // Title-row star state for the currently-expanded thread. The star stays
  // in the title row across collapsed (readOnly) → expanded (interactive)
  // transitions; this avoids the "star moves when I open a thread" jump.
  // Initialized from entry.thread.likes when expansion starts; likedByMe
  // arrives via onThreadLikeStateChange after V2InlineThread's fetch.
  const [expandedLikeState, setExpandedLikeState] = useState<
    { likedByMe: boolean; count: number } | null
  >(null);

  // Reset star state when expansion changes. Initialize count from the
  // entry's already-known thread.likes so the star doesn't show a stale
  // zero between expansion and fetch.
  useEffect(() => {
    if (!expandedThreadId) {
      setExpandedLikeState(null);
      return;
    }
    const entry = entries.find((e) => e.threadId === expandedThreadId);
    setExpandedLikeState({
      likedByMe: false,
      count: entry?.thread.likes ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedThreadId]);

  const handleToggleExpandedLike = useCallback(() => {
    if (!expandedThreadId || !userId || !expandedLikeState) {
      onAuthRequired?.();
      return;
    }
    const wasLiked = expandedLikeState.likedByMe;
    // Optimistic toggle
    setExpandedLikeState({
      likedByMe: !wasLiked,
      count: wasLiked
        ? Math.max(0, expandedLikeState.count - 1)
        : expandedLikeState.count + 1,
    });
    const fail = () => {
      setExpandedLikeState({
        likedByMe: wasLiked,
        count: expandedLikeState.count,
      });
    };
    if (wasLiked) {
      dbUnlikeThread(userId, expandedThreadId).catch(fail);
    } else {
      dbLikeThread(userId, expandedThreadId).catch(fail);
    }
  }, [expandedThreadId, userId, expandedLikeState, onAuthRequired]);

  useEffect(() => () => {
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
  }, []);

  // Viewport-visibility observer. Tracks which entry tickets are currently
  // intersecting the viewport and emits the set whenever it changes. Drives
  // V2RoomMap's click-to-adjust-ratings flow: a self-cell whose entry is
  // visible rotates rating on click; one whose entry is off-screen scrolls
  // to it instead. Re-created when the set of mounted tickets changes
  // (entries-list reshuffle / item add or remove).
  const entryIdsKey = useMemo(
    () => sorted.map((e) => e.threadId).join(","),
    [sorted],
  );
  const onVisibleEntriesChangeRef = useRef(onVisibleEntriesChange);
  useEffect(() => {
    onVisibleEntriesChangeRef.current = onVisibleEntriesChange;
  }, [onVisibleEntriesChange]);
  useEffect(() => {
    if (!onVisibleEntriesChangeRef.current) return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (records) => {
        let changed = false;
        for (const rec of records) {
          const id = (rec.target as HTMLElement).dataset.threadId;
          if (!id) continue;
          if (rec.isIntersecting) {
            if (!visible.has(id)) {
              visible.add(id);
              changed = true;
            }
          } else if (visible.has(id)) {
            visible.delete(id);
            changed = true;
          }
        }
        if (changed) onVisibleEntriesChangeRef.current?.(new Set(visible));
      },
      { threshold: 0 },
    );
    for (const id of Object.keys(ticketRefs.current)) {
      const el = ticketRefs.current[id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [entryIdsKey]);

  const scrollToEntry = useCallback((threadId: string) => {
    const el = ticketRefs.current[threadId];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightedId(threadId);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlightedId(null);
      highlightTimer.current = null;
    }, HIGHLIGHT_MS);
  }, []);

  useImperativeHandle(ref, () => ({ scrollToEntry }), [scrollToEntry]);

  // Scroll the ticket's top into view INSTANTLY. Used by both collapse
  // paths (bottom button and the inline collapse buttons in V2InlineThread)
  // and by the expand path so the new thread lands at the top of the
  // viewport. The map-cell highlight scroll still uses smooth (via
  // scrollToEntry below).
  const scrollTicketTop = useCallback((threadId: string) => {
    const el = ticketRefs.current[threadId];
    if (!el) return;
    el.scrollIntoView({ behavior: "auto", block: "start" });
  }, []);

  // Apply the actual collapse without any draft-guard gating. Called from
  // the draft-guard confirmation path and from the no-draft direct path.
  const applyCollapse = useCallback(
    (threadId: string) => {
      setExpandedThreadId(null);
      // Defer so the layout reflows before we scroll to the (now shorter)
      // ticket's top edge.
      setTimeout(() => scrollTicketTop(threadId), 0);
    },
    [scrollTicketTop],
  );

  const handleCollapseTop = useCallback(
    (threadId: string) => {
      if (hasDraft) {
        setPendingCollapseTarget("self");
        return;
      }
      applyCollapse(threadId);
    },
    [hasDraft, applyCollapse],
  );

  const toggleExpand = (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (expandedThreadId === threadId) {
      // Collapsing the currently-expanded ticket — same path as the inline
      // collapse buttons. Draft-guard applies.
      handleCollapseTop(threadId);
    } else {
      // Expanding a different ticket. If the current thread has unsaved
      // draft text, gate with the confirm modal; otherwise just swap.
      if (hasDraft && expandedThreadId) {
        setPendingCollapseTarget(threadId);
        return;
      }
      setExpandedThreadId(threadId);
      // V2InlineThread for the new thread will fire onDraftChange(false)
      // once its composer mounts; reset proactively so stale state doesn't
      // gate the very next change.
      setHasDraft(false);
      // Instantly scroll the newly-expanded ticket's top into view so the
      // entry sits at the top of the viewport.
      setTimeout(() => scrollTicketTop(threadId), 0);
    }
  };

  const confirmDiscardDraft = useCallback(() => {
    const target = pendingCollapseTarget;
    setPendingCollapseTarget(null);
    setHasDraft(false);
    if (target === "self" && expandedThreadId) {
      applyCollapse(expandedThreadId);
    } else if (target && target !== "self") {
      setExpandedThreadId(target);
      // Scroll the newly-expanded ticket's top into view instantly.
      setTimeout(() => scrollTicketTop(target), 0);
    }
  }, [pendingCollapseTarget, expandedThreadId, applyCollapse, scrollTicketTop]);

  const cancelDiscardDraft = useCallback(() => {
    setPendingCollapseTarget(null);
  }, []);

  return (
    <div>
      {sorted.map((entry) => {
        const isExpanded = expandedThreadId === entry.threadId;
        const isHighlighted = highlightedId === entry.threadId;
        // Notification-signal lookups (computed in V2FriendRoomPage).
        // isNew → A1 white card outline.
        // signal.kind === "green" → A2 canon-green circle behind chevron.
        // engagedThreadIds.has(...) → A4 dim to 50% opacity.
        const isNew = !!isNewMap?.[entry.threadId];
        const signal = cellSignals?.[entry.threadId] ?? null;
        const showGreenChevron = signal?.kind === "green";
        const isEngaged = !!engagedThreadIds?.has(entry.threadId);
        return (
          <div
            key={entry.threadId}
            ref={(el) => {
              ticketRefs.current[entry.threadId] = el;
            }}
            data-thread-id={entry.threadId}
            style={{
              position: "relative",
              margin: "0 0 12px 0",
              // 72px breathing room from the viewport top when scrollIntoView
              // anchors this ticket (on expand, collapse, and map-cell click).
              scrollMarginTop: 72,
            }}
          >
            <div
              className="card threadCard"
              style={{
                margin: 0,
                // Pointer cursor + click-to-toggle are scoped to COLLAPSED
                // cards only. When expanded, clicks on the card body did
                // nothing (most inner content stops propagation) so the
                // pointer affordance was misleading. Users close expanded
                // threads via the explicit collapse buttons inside
                // V2InlineThread.
                cursor: isExpanded ? "default" : "pointer",
                position: "relative",
                paddingTop: 12,
                paddingBottom: 36,
                // Border precedence: blue flash (map-cell click) wins
                // briefly, then falls back to white-when-new, then default.
                border: isHighlighted
                  ? "4px solid #355eb8"
                  : isNew
                  ? "4px solid #fff"
                  : "4px solid var(--dos-border)",
                // A4 dim: 50% opacity once the user has expanded-and-
                // collapsed this entry at least once this session.
                // Suppressed on the currently-expanded card so the open
                // content reads at full intensity.
                opacity: isEngaged && !isExpanded ? 0.5 : 1,
              }}
              onClick={isExpanded ? undefined : (e) => toggleExpand(entry.threadId, e)}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  // Tombstones de-emphasize the title row but leave any
                  // expanded V2InlineThread content (replies, collapse, etc.)
                  // at full opacity below.
                  opacity: entry.isDeleted ? 0.35 : 1,
                }}
              >
                <h2 style={{ margin: 0, fontSize: 22 }} className="title">
                  <span style={{ marginRight: 4, display: "inline-flex", alignItems: "center" }}>
                    <Users size={14} color="var(--icon-color)" />
                  </span>
                  {entry.isDeleted ? "(deleted entry)" : entry.title}
                  {!entry.isDeleted && (
                    <>
                      <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 7, whiteSpace: "nowrap" }}>
                        <EpisodeTag
                          season={entry.s}
                          episode={entry.e}
                          isRewatch={entry.isRewatch}
                          rewatchS={entry.rewatchS}
                          rewatchE={entry.rewatchE}
                        />
                      </span>
                      {entry.isEdited && (
                        <span style={{ fontStyle: "italic", fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 6 }}>(edited)</span>
                      )}
                    </>
                  )}
                </h2>
                {/* Star: in the title row across both states. Read-only when
                    the ticket is collapsed; interactive (uses expandedLikeState)
                    when expanded. Hidden on tombstones. The like state lives
                    in V2RoomFeed so the star doesn't move between collapsed
                    and expanded — V2InlineThread reports the caller's
                    likedByMe via onThreadLikeStateChange after its fetch. */}
                {!entry.isDeleted && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {isExpanded && expandedLikeState ? (
                      <LikeBadge
                        count={expandedLikeState.count}
                        userLiked={expandedLikeState.likedByMe}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleToggleExpandedLike();
                        }}
                        title={expandedLikeState.likedByMe ? "Unstar" : "Star this entry"}
                      />
                    ) : (
                      <LikeBadge
                        count={0}
                        readOnly
                        title="open post to vote"
                      />
                    )}
                  </div>
                )}
              </div>

              <div
                className="muted"
                style={{
                  marginTop: 4,
                  fontSize: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                  // Tombstone byline matches the title-row opacity so the
                  // entire entry header fades together.
                  opacity: entry.isDeleted ? 0.35 : undefined,
                }}
              >
                Started by{" "}
                <Username
                  name={entry.authorUsername}
                  userId={entry.authorId}
                  onClickProfile={onClickProfile ?? (() => {})}
                  bold
                />
                {entry.isDeparted && (
                  <span style={{ fontStyle: "italic", fontSize: 12, opacity: 0.6 }}>has left the room</span>
                )}
                {" "}• {timeAgo(entry.updatedAt)}
              </div>

              <div style={{ marginTop: 6 }}>
                {isExpanded ? (
                  // Stop click propagation so interactive elements inside
                  // the expanded view (action buttons, composer textarea,
                  // edit form) don't bubble to the card's whole-card
                  // toggle-expand handler.
                  <div onClick={(e) => e.stopPropagation()}>
                    <V2InlineThread
                      thread={entry.thread}
                      groupId={groupId}
                      viewerProgress={viewerProgress}
                      userId={userId}
                      replyCount={entry.replyCount}
                      onClickProfile={onClickProfile}
                      onCollapseTop={() => handleCollapseTop(entry.threadId)}
                      onAuthRequired={onAuthRequired}
                      onThreadEdited={onThreadEdited}
                      onThreadDeleted={(tid) => {
                        // Auto-collapse the deleted thread so the user sees
                        // the post-delete state of the feed (drop or
                        // tombstone) without it still being expanded.
                        setExpandedThreadId(null);
                        setHasDraft(false);
                        onThreadDeleted?.(tid);
                      }}
                      onDraftChange={setHasDraft}
                      onThreadLikeStateChange={(likedByMe) =>
                        setExpandedLikeState((prev) =>
                          prev ? { ...prev, likedByMe } : prev,
                        )
                      }
                    />
                  </div>
                ) : entry.isDeleted ? (
                  <div style={{ fontStyle: "italic", color: "#1a3a4a", opacity: 0.35 }}>
                    @{entry.authorUsername} deleted their entry.
                  </div>
                ) : (
                  <div className="clamp3">
                    {parsePromptTokens(entry.preview).map((part, i) => (
                      <React.Fragment key={`prev-${i}`}>{part}</React.Fragment>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom-right: expand indicator on collapsed cards only.
                  The whole card is clickable to expand, so this is a
                  subtle affordance — just a white down chevron, no button
                  styling. When expanded, V2InlineThread renders the
                  collapse buttons. */}
              {!isExpanded && !entry.isDeleted && (
                <div
                  style={{
                    position: "absolute",
                    right: 12,
                    bottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  {(() => {
                    // A2 — when there are new visible responses, the
                    // chevron sits inside a 32px canon-green perfect
                    // circle. Tooltip on hover with V1 copy.
                    const chevronButton = (
                      <button
                        onClick={(e) => toggleExpand(entry.threadId, e)}
                        aria-label="Expand"
                        style={
                          showGreenChevron
                            ? {
                                background: "#7abd8e",
                                border: "none",
                                color: "#fff",
                                cursor: "pointer",
                                width: 32,
                                height: 32,
                                borderRadius: "50%",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontFamily: "inherit",
                                padding: 0,
                              }
                            : {
                                background: "transparent",
                                border: "none",
                                color: "#fff",
                                cursor: "pointer",
                                padding: 4,
                                display: "inline-flex",
                                alignItems: "center",
                                fontFamily: "inherit",
                              }
                        }
                      >
                        <ChevronDown size={20} color="#fff" />
                      </button>
                    );
                    if (showGreenChevron) {
                      return (
                        <Tooltip
                          text="There is new writing in here for you."
                          direction="above"
                          align="right"
                          width={180}
                          portal
                        >
                          {chevronButton}
                        </Tooltip>
                      );
                    }
                    return chevronButton;
                  })()}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Discard-draft confirm — gates collapse and cross-thread expansion
          when the current composer has unsaved text. Same modal for both
          triggers per spec. */}
      {pendingCollapseTarget !== null && (
        <Modal onClose={cancelDiscardDraft} width="min(440px,90vw)">
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <h3 className="title" style={{ margin: "0 0 16px", fontSize: 18 }}>Discard your reply?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, margin: "0 0 24px" }}>
              If you open another thread, you will lose what you've been writing. Are you sure?
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
              <button
                className="btn"
                onClick={cancelDiscardDraft}
                style={{ background: "transparent", border: "2px solid #fff", color: "#fff" }}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={confirmDiscardDraft}
                style={{ background: "var(--danger)", border: "none", color: "#fff" }}
              >
                Yes, I'm sure
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
});

export default V2RoomFeed;
