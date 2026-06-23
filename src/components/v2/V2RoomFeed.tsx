import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, Mail, Users, Sparkles, Flag } from "lucide-react";
import EpisodeTag from "../EpisodeTag";
import LikeBadge from "../LikeBadge";
import Username from "../Username";
import Tooltip from "../Tooltip";
import { timeAgo } from "../../lib/utils";
import { parsePromptTokens } from "../../lib/promptTokens";
import V2InlineThread from "./V2InlineThread";
import type { PendingReference } from "../ResponseComposer";
import Modal from "../Modal";
import {
  likeThread as dbLikeThread,
  unlikeThread as dbUnlikeThread,
} from "../../lib/db";
import type { ProgressEntry, Thread, Reply } from "../../types";

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
  /** TSP onboarding demo only: instructional "Alborz" entry — gets a distinct
      treatment and no map cell. Undefined/false everywhere in live rooms. */
  isInstructional?: boolean;
};

export type V2RoomFeedHandle = {
  scrollToEntry: (threadId: string) => void;
  /** Programmatically expand an entry (no scroll, no flash). Used by
   *  V2FriendRoomPage after a same-room publish so the freshly-written
   *  entry lands expanded without the user having to find it + click. */
  expandEntry: (threadId: string) => void;
};

export type V2RoomFeedProps = {
  entries: V2RoomFeedEntry[];
  /** Episode-tag sort direction. Default "asc". */
  sortOrder?: "asc" | "desc";
  /** When true, render entries in the order provided (no internal episode
   *  sort). Used by callers that already apply their own sort upstream —
   *  e.g. the public show page, which keeps its relevance/post/episode
   *  sort controls. Default false (episode-asc, friend-room behavior). */
  preserveOrder?: boolean;
  /** Friend-room group id. When undefined the feed is in public-conversation
   *  mode: V2InlineThread fetches replies from the public channel,
   *  highlights are suppressed, and the entry-row Users icon is replaced
   *  with whatever `entryIcon` provides (default: no icon for public). */
  groupId?: string;
  viewerProgress: ProgressEntry | null;
  /** Caller's user id. May be null for logged-out visitors viewing
   *  public threads; interactive controls route through onAuthRequired. */
  userId: string | null;
  onAuthRequired?: () => void;
  /** Optional icon rendered to the left of the entry title. Defaults to
   *  the friend-room Users icon when groupId is present; null in public
   *  mode (no icon). Callers can override with any ReactNode. */
  entryIcon?: ReactNode | null;
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
      yellow = unseen highlight on viewer's writing in this entry;
      red = own-entry hidden responses). Only "green" matters for the
      entry card — drives the A2 green-filled circle behind the expand
      chevron on collapsed cards. Yellow + red are map-only. */
  cellSignals?: Record<string, { kind: "green" | "yellow" | "red"; redCount?: number }>;
  /** Per-thread red "hidden responses" dot on the entry card (public-rooms
      scope, 2026). Used by the single-user public room, which has no map to
      carry the friend-room red signal. count = responses hidden from the owner
      by progress gating; onDismiss snoozes it (X-click). */
  entryRedDots?: Record<string, { count: number; onDismiss: () => void }>;
  /** Set of threadIds the user has expanded-and-collapsed at least once
      this session. Drives A4 (entry card dim to opacity 0.5). */
  engagedThreadIds?: Set<string>;
  /** Thread to auto-expand on mount. Used by the V3 journal → V2 friend
      room nav path: clicking a friend-room entry in V3 journal lands here
      with this prop set, and the room mounts with the entry already
      expanded + scrolled into view. Read once via useState initializer;
      subsequent prop changes are ignored (so the user can collapse and
      stay collapsed without the auto-expand re-firing on re-render). */
  initialExpandedThreadId?: string;
  /** Reply id to focus inside the auto-expanded thread. Used when the V3
      journal click was on a reply row (responses to you / your responses /
      your starred responses) rather than the entry itself. Forwarded to
      V2InlineThread → RepliesList's existing focusReplyId (which scrolls
      + flashes the matching reply). Only meaningful when
      initialExpandedThreadId is also set. */
  initialFocusReplyId?: string;
  /** Public-room response gate (public-rooms scope, 2026). Only passed by the
      single-user public room (V2UserAggregatePage), where every entry is by
      the same owner. When present and canRespondDirect is false, the response
      composer switches to "request to respond" — the response is held for the
      owner's approval rather than published. Omitted everywhere else, so the
      friend room / general aggregate are unaffected. */
  publicRoomGate?: PublicRoomResponseGate;
  /** Fires after a reply is published from any entry's composer, so the parent
      can bump that entry's reply count without a refetch. */
  onReplyAdded?: (threadId: string) => void;
  /** Optional scroll container. When provided, scrollToEntry scrolls THIS
      element instead of the window — needed when the room lives inside a
      fixed/overflow:auto wrapper (the restructure ShowRoomPage) rather than
      the normal document flow (live V2FriendRoomPage). */
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  /** TSP onboarding demo only. When true, the feed is read-only: expanding an
      entry renders its full body + the supplied (already-gated) replies inline
      instead of mounting V2InlineThread (no DB fetch, no composer/likes). */
  demoMode?: boolean;
  /** Demo mode: read-only replies per threadId, already gated to the viewer's
      selected episode by the caller. */
  demoReplies?: Record<string, Reply[]>;
};

export interface PublicRoomResponseGate {
  ownerUsername: string;
  /** owner / friend / approved → respond directly. false → request mode. */
  canRespondDirect: boolean;
  /** thread ids the viewer already has a pending request on */
  pendingThreadIds: Set<string>;
  /** park a held response for the owner to approve (CP3 publishes it) */
  onSubmitRequest: (threadId: string, payload: {
    body: string;
    message: string;
    season: number;
    episode: number;
    reference: PendingReference | null;
  }) => Promise<void>;
}

const HIGHLIGHT_MS = 1500;

// TSP demo: read-only expanded entries get their own collapse affordance
// (V2InlineThread, which normally carries it, isn't mounted in demo mode).
const demoCollapseBtn: React.CSSProperties = {
  background: "transparent", border: "2px solid var(--dos-border)", color: "var(--dos-fg)",
  borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
};

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
    entryRedDots,
    engagedThreadIds,
    initialExpandedThreadId,
    initialFocusReplyId,
    entryIcon,
    preserveOrder = false,
    publicRoomGate,
    onReplyAdded,
    scrollContainerRef,
    demoMode = false,
    demoReplies,
  },
  ref,
) {
  // Default icon: Users in friend rooms (room identity), nothing on public
  // surfaces. Callers can override with any node, or pass null to suppress.
  const resolvedEntryIcon: ReactNode | null =
    entryIcon === undefined
      ? (groupId ? <Users size={14} color="var(--icon-color)" /> : null)
      : entryIcon;
  // Episode sort. Within an episode, reverse-chronological by the entry's
  // room-arrival time (the `updatedAt` field carries group_threads.shared_at;
  // see V2FriendRoomPage) — newest arrival floats to the top within its
  // episode bucket. Across episodes, asc/desc controlled by sortOrder (desc
  // puts the newest episode tag at the top).
  const sorted = useMemo(() => {
    if (preserveOrder) return entries;
    const dir = sortOrder === "desc" ? -1 : 1;
    return [...entries].sort((a, b) => {
      if (a.s !== b.s) return dir * (a.s - b.s);
      if (a.e !== b.e) return dir * (a.e - b.e);
      return b.updatedAt - a.updatedAt;
    });
  }, [entries, sortOrder, preserveOrder]);

  // Single-expansion: at most one thread expanded at a time. Expanding
  // another quietly collapses the previously-open one (no scroll-jump —
  // the page layout reflows naturally; the user's viewport scroll position
  // stays where it was).
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(
    () => initialExpandedThreadId ?? null,
  );
  // Sync expansion state to the prop on later changes too. The friend-room
  // caller passes initialExpandedThreadId once (from a useState-initialized
  // location.state value) and never updates it, so this is a no-op there.
  // The public show-page caller drives it from the URL so deep-links and
  // browser back/forward keep the open card in sync with /show/:id/thread/:tid.
  useEffect(() => {
    setExpandedThreadId(initialExpandedThreadId ?? null);
  }, [initialExpandedThreadId]);
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

  // Reply-focus pending state. Seeded from initialFocusReplyId so the
  // initially-expanded thread's RepliesList runs its scroll-to-reply
  // effect on first render. Cleared the moment the user collapses (or
  // navigates away from) the initially-expanded thread — collapse +
  // re-expand should NOT re-fire the scroll. A timer-based clear was
  // tried first but races with RepliesList's up-to-3s DOM poll for the
  // reply element when replies are still loading.
  const [pendingFocusReplyId, setPendingFocusReplyId] = useState<string | undefined>(
    () => initialFocusReplyId,
  );
  useEffect(() => {
    if (!pendingFocusReplyId) return;
    // Clear once the initially-expanded thread is no longer expanded.
    if (expandedThreadId !== initialExpandedThreadId) {
      setPendingFocusReplyId(undefined);
    }
  }, [expandedThreadId, initialExpandedThreadId, pendingFocusReplyId]);

  // When mounting with an auto-expanded entry (from the V3 journal → V2
  // friend room nav path), scroll that entry's ticket into view after
  // refs populate. Fires once per mount.
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    if (!initialExpandedThreadId) return;
    // Defer to let ticketRefs populate after the first render of entries.
    const t = setTimeout(() => {
      const el = ticketRefs.current[initialExpandedThreadId];
      if (!el) return;
      el.scrollIntoView({ behavior: "auto", block: "start" });
      initialScrollDoneRef.current = true;
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

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
    // Use explicit scroll (not el.scrollIntoView) so we ONLY scroll the intended
    // scroller — never the map's internal overflow:auto sibling, which would
    // knock the clicked cell out from under the cursor.
    // 72px offset matches the existing scroll-margin-top:72 on tickets.
    const container = scrollContainerRef?.current;
    if (container) {
      // Room lives inside a fixed/overflow:auto wrapper (ShowRoomPage): scroll
      // THAT element, since the window doesn't scroll there.
      const cRect = container.getBoundingClientRect();
      const targetTop = container.scrollTop + (el.getBoundingClientRect().top - cRect.top) - 72;
      container.scrollTo({ top: targetTop, behavior: "smooth" });
    } else {
      const targetY = el.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top: targetY, behavior: "smooth" });
    }
    setHighlightedId(threadId);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlightedId(null);
      highlightTimer.current = null;
    }, HIGHLIGHT_MS);
  }, []);

  const expandEntry = useCallback((threadId: string) => {
    setExpandedThreadId(threadId);
  }, []);

  useImperativeHandle(ref, () => ({ scrollToEntry, expandEntry }), [scrollToEntry, expandEntry]);

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
        const redDot = entryRedDots?.[entry.threadId] ?? null;
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
                // Map-cell-click highlight: the OUTLINE stays its normal color
                // (cream in rooms); the attention pulse is a midnight-blue
                // flashing dropshadow (`flash-glow`, box-shadow) so the lines
                // never change color. Border precedence otherwise:
                // white-when-new, then default. Clears via HIGHLIGHT_MS = 1500.
                border: entry.isInstructional
                  ? "4px solid #355eb8"            // TSP demo: guide tickets get a blue outline
                  : isNew
                  ? "4px solid #fff"
                  : "4px solid var(--dos-border)",
                animation: isHighlighted
                  ? "flash-glow 1.2s ease forwards"
                  : undefined,
                // A4 dim: 50% opacity once the user has expanded-and-
                // collapsed this entry at least once this session.
                // Suppressed on the currently-expanded card so the open
                // content reads at full intensity.
                opacity: isEngaged && !isExpanded ? 0.5 : 1,
              }}
              onClick={isExpanded ? undefined : (e) => toggleExpand(entry.threadId, e)}
            >
              {redDot && <EntryRedDot count={redDot.count} onDismiss={redDot.onDismiss} />}
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
                  {resolvedEntryIcon && (
                    <span style={{ marginRight: 4, display: "inline-flex", alignItems: "center" }}>
                      {resolvedEntryIcon}
                    </span>
                  )}
                  {entry.isInstructional && (
                    // TSP demo: distinct leading glyph marks an instructional
                    // "Alborz" entry (flag-driven, never literal title text).
                    <span style={{ marginRight: 6, display: "inline-flex", alignItems: "center", verticalAlign: "middle" }}>
                      <Sparkles size={18} color="#fef8ea" fill="#fef8ea" />
                    </span>
                  )}
                  {entry.isDeleted ? "(deleted entry)" : entry.title}
                  {!entry.isDeleted && (
                    // SE tag rendered inline AFTER the title with a " • "
                    // separator (matches the bullet glyph used in bylines
                    // elsewhere). Same size / weight / family as the title
                    // (inherits from the h2 .title class) but white — the
                    // tag reads as title-level chrome, not body text.
                    <span style={{ color: "#fff", whiteSpace: "nowrap", marginLeft: 8 }}>
                      {" • "}
                      <EpisodeTag
                        season={entry.s}
                        episode={entry.e}
                        isRewatch={entry.isRewatch}
                        rewatchS={entry.rewatchS}
                        rewatchE={entry.rewatchE}
                        naturalNumbers
                        parens={false}
                      />
                    </span>
                  )}
                  {!entry.isDeleted && entry.isEdited && (
                    <span style={{ fontStyle: "italic", fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 6 }}>(edited)</span>
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
                    {entry.isInstructional ? (
                      // TSP demo: guide entries get a cream flag, not a star.
                      <Flag size={20} color="#fef8ea" />
                    ) : isExpanded && expandedLikeState ? (
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
                {isExpanded && demoMode ? (
                  // TSP demo: read-only expanded view — full body + the
                  // already-gated replies, no V2InlineThread (no fetch, no
                  // composer/likes). Reuses the entry colors of the room.
                  <div onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                      <button style={demoCollapseBtn} onClick={() => handleCollapseTop(entry.threadId)}>collapse ▲</button>
                    </div>
                    <div style={{ whiteSpace: "pre-line", lineHeight: 1.5 }}>{entry.body}</div>
                    {(demoReplies?.[entry.threadId] ?? []).length > 0 && (
                      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                        {(demoReplies?.[entry.threadId] ?? []).map((r) => (
                          <div key={r.id} style={{ border: "2px solid var(--dos-border)", borderRadius: 16, padding: "10px 14px" }}>
                            <div className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <Username name={r.author} userId={r.author} onClickProfile={() => {}} bold />
                              <span style={{ color: "#fff", whiteSpace: "nowrap" }}>
                                {" • "}<EpisodeTag season={r.season} episode={r.episode} naturalNumbers parens={false} />
                              </span>
                            </div>
                            <div style={{ whiteSpace: "pre-line", lineHeight: 1.5 }}>{r.body}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
                      <button style={demoCollapseBtn} onClick={() => handleCollapseTop(entry.threadId)}>collapse ▲</button>
                    </div>
                  </div>
                ) : isExpanded ? (
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
                      focusReplyId={
                        entry.threadId === initialExpandedThreadId
                          ? pendingFocusReplyId
                          : undefined
                      }
                      publicRoomGate={publicRoomGate}
                      onReplyAdded={onReplyAdded}
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
                    {demoMode && " …"}
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
                  {/* Mail icon + reply count to the right of the chevron.
                      Renders only when the entry has at least one visible
                      reply (count includes ahead-of-progress stubs per
                      fetchGroupThreads.aheadCounts plumbing — same number
                      V2InlineThread sees). Coexists with the chevron's
                      green-circle "new since last visit" signal; the green
                      circle is lifecycle-scoped, this count is all-time. */}
                  {entry.replyCount > 0 && (
                    <span
                      aria-label={`${entry.replyCount} response${entry.replyCount === 1 ? "" : "s"}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 500,
                        userSelect: "none",
                      }}
                    >
                      <Mail size={16} color="#fff" />
                      {entry.replyCount}
                    </span>
                  )}
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

// Red "hidden responses" dot for the public room entry card. Mirrors the
// friend-room map dot (canon-red, count, X-to-dismiss on hover) but rides the
// card corner since the public room has no map. Self-contained hover state.
function EntryRedDot({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <Tooltip
      text={<>There is new writing in here<br />for when you catch up.</>}
      direction="above"
      align="right"
      width="auto"
      portal
      tooltipStyle={{ whiteSpace: "nowrap", padding: "6px 10px" }}
      style={{ position: "absolute", top: -8, right: -8, zIndex: 3 }}
    >
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        style={{
          minWidth: 20,
          height: 20,
          padding: "0 5px",
          borderRadius: 999,
          background: "var(--danger)",
          color: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1,
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        {hover ? "✕" : count}
      </div>
    </Tooltip>
  );
}

export default V2RoomFeed;
