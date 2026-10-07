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
import { CANON } from "../../styles/canon";
import { ChevronDown, ChevronUp, Lock, Mail, Mails, MessageSquareText, Users, Sparkles, Flag } from "lucide-react";
import { isSidebarAuthor, sidebarStampLabel, SIDEBAR_STAMP_SPEC, SIDEBAR_DISPLAY_NAME, type SidebarLetterKind } from "../../lib/sidebarLetters";
import { effectiveProgress } from "../../lib/utils";
import EpisodeTag, { REWATCH_TOOLTIP } from "../EpisodeTag";
import Stamp, { stampSpecFor, stampBox } from "../Stamp";
import LikeBadge from "../LikeBadge";
import Username from "../Username";
import Tooltip from "../Tooltip";
import { timeAgo } from "../../lib/utils";
import { linearIndex } from "../../lib/groupPills";
import { D } from "../dashboardChrome";
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
// (`var(--canon-identity,#355eb8)`) for ~1.5s — the same visual signal `ShowSection.tsx` uses
// for newly-visible threads after a progress bump (its `isNew` branch on
// the card border). No keyframe animation; just a snap on/off of the
// border color, matching the live treatment exactly.

// A road marker (letters in transit, 2026-09-25) — "Sam is here · S1 E4"
// on the cream line. Wrap rule (Alborz 2026-09-28, /m with three friends
// ran off the screen): when the discs plus the caption don't fit the row,
// the discs stay on the line and the caption drops to a second line,
// centred, balanced. Measured with a hidden nowrap probe so the decision
// never depends on the layout it changes.
const ROAD_TEXT: React.CSSProperties = { fontFamily: '"Inter", sans-serif', fontSize: 13, fontWeight: 700, color: CANON.cream };
function RoadMarkerRow({ ariaLabel, people, text }: {
  ariaLabel: string;
  people: { key: string; initial: string }[];
  text: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [wrapped, setWrapped] = useState(false);
  // 24px discs overlapping by 6, plus the chip's gap (8) and side padding (20).
  const discsW = 24 + Math.max(0, people.length - 1) * 18;
  useEffect(() => {
    const measure = () => {
      const row = rowRef.current, probe = probeRef.current;
      if (!row || !probe) return;
      setWrapped(discsW + 8 + probe.offsetWidth + 20 > row.clientWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [discsW, text]);
  return (
    <div ref={rowRef} aria-label={ariaLabel} style={{ position: "relative", margin: "4px 0 16px" }}>
      <span ref={probeRef} aria-hidden style={{ ...ROAD_TEXT, position: "absolute", visibility: "hidden", whiteSpace: "nowrap", pointerEvents: "none" }}>{text}</span>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: CANON.cream, opacity: 0.6 }} />
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8, padding: "0 10px", background: "var(--dos-bg)" }}>
          <span style={{ display: "inline-flex" }}>
            {people.map((p, i) => (
              <span key={p.key} style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid var(--canon-friend,#adc8d7)", background: CANON.personal, color: CANON.cream, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", marginLeft: i ? -6 : 0 }}>
                {p.initial}
              </span>
            ))}
          </span>
          {!wrapped && <span style={{ ...ROAD_TEXT, whiteSpace: "nowrap" }}>{text}</span>}
        </div>
      </div>
      {wrapped && (
        <div style={{ marginTop: 6, display: "flex", justifyContent: "center", padding: "0 8px" }}>
          <span className="sb-balance" style={{ ...ROAD_TEXT, lineHeight: 1.35, textAlign: "center", maxWidth: "100%" }}>{text}</span>
        </div>
      )}
    </div>
  );
}

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
  /** Letters from Sidebar (2026-09-28): which planted letter this is, from
   *  the room's sidebar_letters rows; null for a regular letter (and for a
   *  Sidebar letter whose row hasn't landed — the explainer's stamp then). */
  sidebarKind?: SidebarLetterKind | null;
  /** CP4 (2026-07-06): a spoiler-gated entry, rendered as a non-interactive
      one-line placeholder ("X has watched … and written to …") instead of a
      ticket — the entry-level twin of RepliesList's ahead-of-progress reply
      stub. title/body/preview are unused on stubs. */
  gatedStub?: boolean;
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
  /** Naming arc (2026-07-07): username → the viewer's given name. Display-
   *  only (bylines/stubs/tombstones); ids, URLs, keys keep real handles.
   *  Forwarded to V2InlineThread → RepliesList so replies match. */
  displayNames?: Record<string, string>;
  /** Mobile rebuild (/m) idiom: hides the title-row star and (via
   *  V2InlineThread → RepliesList) the selection-based Highlight…/Quote…
   *  affordances + reply stars. Default false — desktop rendering unchanged. */
  mobileIdiom?: boolean;
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
  /** CP4 gated-entry stub audience — decided at DISPLAY time by the caller
   *  from how many OTHER people are currently in the room: exactly one →
   *  "you", two or more → "the room". Default "the room". */
  gatedStubAudience?: "you" | "the room";
  /** Season episode counts — lets the gated entry stub say "from N episodes
   *  ahead" instead of the raw tag (polish pass 2026-09-15). Optional; the
   *  stub falls back to the s/e tag without it. */
  seasons?: number[];
  /** The road (letters in transit, 2026-09-25): the other CURRENT members'
   *  reading positions — effective progress, the highest point each can
   *  read to. Drives two things: the "Sam is here · S1 E4" MARKER between
   *  entries (one per distinct position; people at the same spot share
   *  one), and the COUNTDOWN on the viewer's own entries ("Sam opens this
   *  in 2 episodes."). Everyone current is marked (Alborz 2026-09-28 —
   *  friends ahead of you and level with you included, reversing the
   *  09-25 behind-only rule); a friend who hasn't started is passed at
   *  s0 e0 and pools at the start of the letters as "Sam hasn't started
   *  watching". Departed members are never passed. Needs `seasons` for
   *  real distances; without it the tag order still holds. */
  positions?: { username: string; s: number; e: number }[];
  /** The viewer's own marker (Alborz 2026-09-28): pass their handle and the
   *  feed marks their own position too — "You are here · S1 E4", sharing a
   *  marker with friends at the same spot ("You and Sam are here"). The
   *  position is `viewerProgress` (effective); the handle only names the
   *  initial via `displayNames`. */
  viewerUsername?: string;
  /** Letters from Sidebar (2026-09-28): the room's parent group for the
   *  what's-next letter's proposals panel, and where "start the room" goes. */
  parentGroupId?: string | null;
  onOpenRoom?: (roomId: string, showId: string) => void;
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
      red = own-entry hidden responses). Only "blue" matters for the
      entry card — drives the A2 green-filled circle behind the expand
      chevron on collapsed cards. Yellow + red are map-only. */
  cellSignals?: Record<string, { kind: "blue" | "yellow" | "red"; redCount?: number }>;
  /** Per-thread red "hidden responses" dot on the entry card (public-rooms
      scope, 2026). Used by the single-user public room, which has no map to
      carry the friend-room red signal. count = responses hidden from the owner
      by progress gating; onDismiss snoozes it (X-click). */
  entryRedDots?: Record<string, { count: number; onDismiss: () => void }>;
  /** Mobile friend rooms (2026-08-21): render cellSignals' RED (hidden
      ahead-of-progress responses on the viewer's own entry) as the expand
      chevron in an Alert-red 32px circle — the green new-responses badge's
      exact grammar, red. No count, no X; expanding the entry clears it
      (the caller stamps the dismissal). Desktop leaves this off — its red
      lives on the season map. */
  entryRedChevron?: boolean;
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
  /** Letters-only room (the switch, 2026-10-07): no Write back, no Quote…,
      no composer — notes stand in for responses. */
  responsesOff?: boolean;
  /** Notes inside each letter (notes arc, 2026-10-07): threadId → how many
      notes sit on that letter's body, sealed ones included. A closed letter
      shows the count beside the chevron like its response count. */
  noteCounts?: Record<string, number>;
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

// TSP demo: keep the last N words of a title together (non-breaking spaces) so
// a title that wraps drops at least N words to the second row instead of
// orphaning a lone word/number (e.g. the "1" in "…watched Episode 1").
function keepTailTogether(text: string, n = 3): string {
  const words = text.split(" ");
  if (words.length <= n) return text;
  return words.slice(0, -n).join(" ") + " " + words.slice(-n).join(" ");
}

// TSP demo: read-only expanded entries get their own collapse affordance
// (V2InlineThread, which normally carries it, isn't mounted in demo mode).
// Matches the live friend-room collapse button exactly.
const demoCollapseBtn: React.CSSProperties = {
  background: "transparent", border: "none", color: CANON.cream, cursor: "pointer",
  fontSize: 13, padding: "4px 8px", display: "inline-flex", alignItems: "center",
  gap: 5, fontFamily: "inherit",
};

const V2RoomFeed = forwardRef<V2RoomFeedHandle, V2RoomFeedProps>(function V2RoomFeed(
  {
    entries,
    displayNames,
    mobileIdiom = false,
    sortOrder = "asc",
    groupId,
    gatedStubAudience = "the room",
    seasons,
    positions,
    viewerUsername,
    parentGroupId = null,
    onOpenRoom,
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
    // entryRedChevron retired 2026-09-13 (red pills render everywhere now);
    // the prop stays accepted so existing callers don't break.
    engagedThreadIds,
    initialExpandedThreadId,
    initialFocusReplyId,
    entryIcon,
    preserveOrder = false,
    publicRoomGate,
    responsesOff = false,
    noteCounts,
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
  const dn = (u: string) => displayNames?.[u] ?? u;
  const sorted = useMemo(() => {
    if (preserveOrder) return entries;
    const dir = sortOrder === "desc" ? -1 : 1;
    return [...entries].sort((a, b) => {
      // Letters from Sidebar lead in both orders (2026-09-28): tagged S0 E0
      // so everyone can read them, they'd otherwise sink to the bottom.
      const sa = isSidebarAuthor(a.authorUsername) ? 1 : 0, sb = isSidebarAuthor(b.authorUsername) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      if (a.s !== b.s) return dir * (a.s - b.s);
      if (a.e !== b.e) return dir * (a.e - b.e);
      return b.updatedAt - a.updatedAt;
    });
  }, [entries, sortOrder, preserveOrder]);

  // ── The road (letters in transit, 2026-09-25) ──────────────────────────
  // Where each person stands, expressed as the entry their marker sits
  // before. In episode-desc order (newest at the top) someone at S1E4 sits
  // above the first entry they can read, i.e. the first entry at or below
  // their position; in asc order, after the last one. People below every
  // entry pool at the end. Distinct positions get distinct markers; people
  // sharing a position share one. Everyone current is on the road (Alborz
  // 2026-09-28, reversing the 09-25 behind-only rule): the viewer ("You"),
  // friends level with or ahead of them — someone past every letter marks
  // the very top in desc order — and friends who haven't started (index 0,
  // no episode tag, pooled at the start of the letters).
  const idxOf = (s: number, e: number) => linearIndex(s, e, seasons);
  const viewerEff = effectiveProgress(viewerProgress);
  const viewerIdx = viewerEff ? idxOf(viewerEff.s, viewerEff.e) : 0;
  type RoadPerson = { username: string; s: number; e: number; idx: number; self: boolean };
  const roadPeople = useMemo(() => {
    const out: RoadPerson[] = (positions ?? []).map((p) => ({ ...p, idx: idxOf(p.s, p.e), self: false }));
    if (viewerUsername) out.push({ username: viewerUsername, s: viewerEff?.s ?? 0, e: viewerEff?.e ?? 0, idx: viewerIdx, self: true });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, seasons, viewerUsername, viewerIdx]);
  type RoadMarker = { s: number; e: number; idx: number; people: RoadPerson[] };
  const { markerBefore, endMarkers } = useMemo(() => {
    const before = new Map<string, RoadMarker[]>();
    const end: RoadMarker[] = [];
    if (!roadPeople.length) return { markerBefore: before, endMarkers: end };
    const desc = sortOrder === "desc";
    const slotOf = (idx: number): string | null => {
      for (const en of sorted) {
        // Pinned letters from Sidebar aren't on the road (S0 E0 at the top
        // would catch every marker).
        if (isSidebarAuthor(en.authorUsername)) continue;
        const ei = idxOf(en.s, en.e);
        if (desc ? ei <= idx : ei > idx) return en.threadId;
      }
      return null;
    };
    // Group by position first so co-located people share a marker — by
    // index, not tag: every not-started row is index 0 whatever it says.
    const byPos = new Map<number, RoadMarker>();
    for (const p of roadPeople) {
      const m = byPos.get(p.idx) ?? { s: p.s, e: p.e, idx: p.idx, people: [] };
      m.people.push(p);
      byPos.set(p.idx, m);
    }
    const order = [...byPos.values()].sort((a, b) => (desc ? b.idx - a.idx : a.idx - b.idx));
    for (const m of order) {
      // "You" leads a shared marker.
      m.people.sort((a, b) => Number(b.self) - Number(a.self));
      const slot = slotOf(m.idx);
      if (slot === null) end.push(m);
      else before.set(slot, [...(before.get(slot) ?? []), m]);
    }
    return { markerBefore: before, endMarkers: end };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadPeople, sorted, sortOrder, seasons]);
  // "Sam opens this in 2 episodes." — for the viewer's own entries, the
  // friends still short of it, nearest first. One friend: named. Exactly
  // two: both named. Three or more: the nearest only (Alborz 2026-09-25).
  // "open", not "read" — it's the anticipation that matters. A friend who
  // hasn't started is on the road but not in the countdown.
  const countdownFor = (entry: V2RoomFeedEntry): string | null => {
    if (!userId || entry.authorId !== userId || entry.gatedStub || entry.isDeleted || !positions?.length) return null;
    const ei = idxOf(entry.s, entry.e);
    const behind = positions
      .map((p) => ({ name: dn(p.username), idx: idxOf(p.s, p.e) }))
      .filter((p) => p.idx > 0)
      .map((p) => ({ name: p.name, n: ei - p.idx }))
      .filter((p) => p.n > 0)
      .sort((a, b) => a.n - b.n);
    if (!behind.length) return null;
    const eps = (n: number) => `${n} episode${n === 1 ? "" : "s"}`;
    if (behind.length === 2) return `${behind[0].name} opens this in ${eps(behind[0].n)}, ${behind[1].name} in ${behind[1].n}.`;
    return `${behind[0].name} opens this in ${eps(behind[0].n)}.`;
  };
  const renderMarkers = (items: RoadMarker[]) => items.map((m) => {
    const names = m.people.map((p) => (p.self ? "You" : dn(p.username)));
    const list = names.length === 1 ? names[0]
      : names.length === 2 ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const plural = names.length > 1 || m.people[0].self;
    const started = m.idx > 0;
    // "You are here" / "Sam is here" / "You and Sam are here";
    // "Sam hasn't started watching" / "You haven't started watching".
    const who = started
      ? `${list} ${plural ? "are" : "is"} here`
      : `${list} ${plural ? "haven't" : "hasn't"} started watching`;
    return (
      <RoadMarkerRow
        key={`road-${m.idx}`}
        ariaLabel={started ? `${who}, season ${m.s} episode ${m.e}` : who}
        people={m.people.map((p) => ({ key: p.username, initial: (dn(p.username)[0] ?? "?").toUpperCase() }))}
        text={started ? `${who} · S${m.s} E${m.e}` : who}
      />
    );
  });

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

  // Catch up WHILE an entry is open (2026-09-20). Advancing progress from the
  // room's picker re-runs load() without unmounting the feed, so
  // expandedThreadId never changes and the effect above doesn't re-fire. The
  // open entry's responses just became readable in place — re-stamp it so the
  // catch-up GREEN (and the server-side room BLUE, via markThreadSeen) clears
  // for writing the user is literally looking at, instead of lighting up
  // behind them and only settling on the next expand.
  const prevProgRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${viewerProgress?.s ?? 0}:${viewerProgress?.e ?? 0}`;
    const prev = prevProgRef.current;
    prevProgRef.current = key;
    if (prev === null || prev === key) return; // mount, or no actual move
    if (expandedThreadId) onEntryExpanded?.(expandedThreadId);
  }, [viewerProgress?.s, viewerProgress?.e, expandedThreadId, onEntryExpanded]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const ticketRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimer = useRef<number | null>(null);
  const scrollPollRaf = useRef<number | null>(null);

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
    if (scrollPollRaf.current) cancelAnimationFrame(scrollPollRaf.current);
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
    // Flash the ticket outline only AFTER the smooth scroll lands — otherwise a
    // long scroll can finish (or nearly) the 1.5s animation before the entry is
    // even in view. Poll the scroll position; trigger the highlight once it
    // settles (3 still frames) or after a safety cap. A position already in
    // view settles immediately, so a no-scroll click still flashes at once.
    if (highlightTimer.current) { window.clearTimeout(highlightTimer.current); highlightTimer.current = null; }
    if (scrollPollRaf.current) cancelAnimationFrame(scrollPollRaf.current);
    setHighlightedId(null);
    const readTop = () => (container ? container.scrollTop : window.scrollY);
    let lastTop = readTop();
    let stable = 0;
    const startedAt = performance.now();
    const poll = () => {
      const top = readTop();
      stable = Math.abs(top - lastTop) < 1 ? stable + 1 : 0;
      lastTop = top;
      if (stable >= 3 || performance.now() - startedAt > 1200) {
        scrollPollRaf.current = null;
        setHighlightedId(threadId);
        highlightTimer.current = window.setTimeout(() => {
          setHighlightedId(null);
          highlightTimer.current = null;
        }, HIGHLIGHT_MS);
        return;
      }
      scrollPollRaf.current = requestAnimationFrame(poll);
    };
    scrollPollRaf.current = requestAnimationFrame(poll);
  }, [scrollContainerRef]);

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
        const roadHere = markerBefore.get(entry.threadId);
        return (<React.Fragment key={`slot-${entry.threadId}`}>{roadHere ? renderMarkers(roadHere) : null}{(() => {
        // CP4: a spoiler-gated entry renders as a one-line non-interactive
        // stub — the entry-level twin of RepliesList's ahead-of-progress
        // reply stub (same `card redacted` shell). One stub per gated entry;
        // catching up replaces it with the real ticket on the next load.
        // No signals/outlines/expansion apply.
        if (entry.gatedStub) {
          // Gated-writing idiom (polish pass 2026-09-15): dashed cream, no
          // fill, lock glyph — "not yet" reads through the outline. The old
          // grey .redacted box retires here (solid identity stays reserved
          // for NEW visible entries, solid cream for read ones).
          const aheadBy = seasons
            ? linearIndex(entry.s, entry.e, seasons) - linearIndex(viewerProgress?.s ?? 0, viewerProgress?.e ?? 0, seasons)
            : null;
          return (
            <div
              key={entry.threadId}
              ref={(el) => { ticketRefs.current[entry.threadId] = el; }}
              data-thread-id={entry.threadId}
              style={{ position: "relative", margin: "0 0 12px 0", scrollMarginTop: 72 }}
            >
              {/* Sealed letter (2026-09-26): the live dashed idiom plus a faded
                  cream fill so it stands out a little; its stamp at the
                  top-right with the red lock riding the stamp's left edge; the
                  name alone in the byline — the tag lives on the stamp. */}
              {(() => {
                // The writer's own stamp (one per account), sealed.
                const sv = stampSpecFor(entry.authorId || entry.authorUsername);
                const sb = stampBox(sv);
                const sc = mobileIdiom ? 0.78 : 1;
                return (
                  <div style={{ ...D.gatedStub(24), display: "block", position: "relative", background: "rgba(254,248,234,0.2)", padding: mobileIdiom ? "16px 16px" : "16px 20px", cursor: "default" }}>
                    <div style={{ position: "absolute", top: 14, right: mobileIdiom ? 14 : 18 }}>
                      <Stamp spec={sv} label={`S${entry.s} E${entry.e}`} initial={dn(entry.authorUsername).trim().charAt(0).toUpperCase()} scale={sc} sealed />
                    </div>
                    <div style={{ paddingRight: Math.round(sb.w * sc) + 30, minHeight: Math.round(sb.h * sc), boxSizing: "border-box" }}>
                      <div className="muted" style={{ fontSize: 13, lineHeight: 1.45, color: CANON.cream, display: "flex", alignItems: "center", gap: 6 }}>
                        <Username
                          name={entry.authorUsername}
                          displayName={dn(entry.authorUsername)}
                          userId={entry.authorId}
                          onClickProfile={onClickProfile ?? (() => {})}
                          bold
                        />
                      </div>
                      <div style={{ fontWeight: 400, fontSize: 14, lineHeight: 1.45, opacity: 0.9, marginTop: 8 }}>
                        {aheadBy != null && aheadBy > 0
                          ? <>A letter to {gatedStubAudience} from {aheadBy} episode{aheadBy === 1 ? "" : "s"} ahead. It opens when you catch up.</>
                          : <>A letter to {gatedStubAudience} from s{entry.s} e{entry.e}. It opens when you catch up.</>}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        }
        const isExpanded = expandedThreadId === entry.threadId;
        const isHighlighted = highlightedId === entry.threadId;
        // Notification-signal lookups (computed by the host page).
        // isNew → A1 white card outline.
        // signal green/red → a PILL behind the envelope + count (Alborz
        //   2026-09-13; replaces the circled chevron). Red = responses to
        //   YOUR entry (readable, or hidden-with-count for when you catch
        //   up); green = responses in threads you're part of. Red no
        //   longer needs the old mobile-only entryRedChevron opt-in.
        // engagedThreadIds.has(...) → A4 dim to 50% opacity.
        const isNew = !!isNewMap?.[entry.threadId];
        const signal = cellSignals?.[entry.threadId] ?? null;
        const pillKind = signal?.kind === "blue" || signal?.kind === "red" ? signal.kind : null;
        const redDot = entryRedDots?.[entry.threadId] ?? null;
        const isEngaged = !!engagedThreadIds?.has(entry.threadId);
        // The stamp (letters, 2026-09-26): the episode tag as a postage stamp
        // at the ticket's top-right — the WRITER'S stamp, one per account,
        // generated from their id. A rewatch letter's stamp wears the rewatch
        // tag with the rewatch glyph and keeps the tag's hover explanation.
        // A letter from Sidebar (2026-09-28) wears the explainer's framed
        // stamp with the letter's own words ("What / next?", "next /
        // season"). Closed, it sits on cream paper with the stamp in Friend
        // blue and no preview; open, it looks like any ticket.
        const isSb = isSidebarAuthor(entry.authorUsername);
        const sbClosed = isSb && !isExpanded;
        const stampSpec = isSb ? SIDEBAR_STAMP_SPEC : stampSpecFor(entry.authorId || entry.authorUsername);
        const stampScale = mobileIdiom ? 0.78 : 1;
        const stampSize = stampBox(stampSpec);
        const stampInitial = isSb ? "" : dn(entry.authorUsername).trim().charAt(0).toUpperCase();
        const isRewatchTag = !isSb && !!entry.isRewatch && entry.rewatchS != null && entry.rewatchE != null;
        const stampLabel = isSb ? sidebarStampLabel(entry.sidebarKind) : isRewatchTag ? `S${entry.rewatchS} E${entry.rewatchE}` : `S${entry.s} E${entry.e}`;
        const stampEl = entry.isDeleted ? null : <Stamp spec={stampSpec} label={stampLabel} initial={stampInitial} scale={stampScale} rewatch={isRewatchTag} ink={sbClosed ? CANON.friend : undefined} />;
        const stamp = stampEl && isRewatchTag ? <Tooltip text={REWATCH_TOOLTIP} direction="below" portal>{stampEl}</Tooltip> : stampEl;
        const stampReserve = stampEl ? Math.round(stampSize.w * stampScale) + 12 : 0;
        const stampMinH = stampEl ? Math.round(stampSize.h * stampScale) : 0;
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
              className={`card threadCard${entry.isInstructional ? " tsp-guide" : ""}${isNew && !entry.isInstructional ? " ticket-new" : ""}`}
              style={{
                margin: 0,
                // A closed letter from Sidebar is cream paper (the explainer's
                // look) so it stands out; open, it's a ticket like the rest.
                background: sbClosed ? CANON.cream : undefined,
                // Pointer cursor + click-to-toggle are scoped to COLLAPSED
                // cards only. When expanded, clicks on the card body did
                // nothing (most inner content stops propagation) so the
                // pointer affordance was misleading. Users close expanded
                // threads via the explicit collapse buttons inside
                // V2InlineThread.
                cursor: isExpanded ? "default" : "pointer",
                position: "relative",
                // Polish pass 2026-09-15 (desktop): 16/20 collapsed, 20/24
                // expanded; mobile keeps its 16px sides from the /m pass.
                paddingTop: mobileIdiom ? 16 : (isExpanded ? 20 : 16),
                paddingBottom: sbClosed ? 16 : 36,
                ...(mobileIdiom
                  ? { paddingLeft: 16, paddingRight: 16 }
                  : { paddingLeft: isExpanded ? 24 : 20, paddingRight: isExpanded ? 24 : 20 }),
                // Map-cell-click highlight: the OUTLINE stays its normal color
                // (cream in rooms); the attention pulse is a midnight-blue
                // flashing dropshadow (`flash-glow`, box-shadow) so the lines
                // never change color. Border precedence otherwise:
                // blue-when-new, then default. Clears via HIGHLIGHT_MS = 1500.
                // (Guide-ticket yellow outline is applied via the .tsp-guide
                // class, since group-context forces the ticket border !important.)
                // Never-opened → Identity blue (2026-09-13; the cream
                // "white-when-new" was invisible against the room's cream
                // default border). Group-context enforces via .ticket-new.
                border: isNew
                  ? "4px solid var(--canon-identity,#355eb8)"
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
              {stamp && (
                <div style={{ position: "absolute", top: mobileIdiom ? 14 : 16, right: mobileIdiom ? 14 : 18 }}>
                  {stamp}
                </div>
              )}
              {/* The header block (byline + title) reserves the stamp's box so
                  nothing runs under it; the preview below runs full width. */}
              <div style={{ paddingRight: stampReserve, minHeight: stampMinH, boxSizing: "border-box" }}>
              {/* Byline ABOVE the title (polish pass 2026-09-15): one cream
                  caption line — author · time; the episode tag lives on the
                  stamp (2026-09-26). */}
              <div
                className="muted"
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: sbClosed ? CANON.dark : CANON.cream,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                  // Tombstone byline matches the title-row opacity so the
                  // entire entry header fades together.
                  opacity: entry.isDeleted ? 0.35 : sbClosed ? 0.8 : 0.9,
                }}
              >
                {isSb ? (
                  // A letter from Sidebar: the envelope disc stands in for the
                  // avatar (Identity on the cream paper, cream on the open
                  // ticket); nothing to click, no profile behind it.
                  <span className="username" style={{ display: "inline-flex", alignItems: "center", gap: 6, verticalAlign: "middle" }}>
                    <span aria-hidden style={{ width: 20, height: 20, borderRadius: "50%", background: sbClosed ? CANON.identity : CANON.cream, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Mail size={12} color={sbClosed ? CANON.cream : CANON.identity} strokeWidth={2.4} />
                    </span>
                    <b>{SIDEBAR_DISPLAY_NAME}</b>
                  </span>
                ) : entry.isInstructional ? (
                  // TSP demo: sparkles REPLACES the standard profile avatar for
                  // Alborz (no SidebarAvatar, not clickable).
                  <span className="username" style={{ display: "inline-flex", alignItems: "center", gap: 6, verticalAlign: "middle" }}>
                    <Sparkles size={16} color={CANON.cream} fill={CANON.cream} />
                    <b>{entry.authorUsername}</b>
                  </span>
                ) : (
                  <Username
                    name={entry.authorUsername}
                    displayName={dn(entry.authorUsername)}
                    userId={entry.authorId}
                    onClickProfile={onClickProfile ?? (() => {})}
                    bold
                  />
                )}
                {entry.isDeparted && (
                  <span style={{ fontStyle: "italic", fontSize: 12, opacity: 0.7 }}>has left the room</span>
                )}
                <span>• {timeAgo(entry.updatedAt)}</span>
                {!entry.isDeleted && entry.isEdited && (
                  <span style={{ fontStyle: "italic", opacity: 0.7 }}>(edited)</span>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 4,
                  // Tombstones de-emphasize the title row but leave any
                  // expanded V2InlineThread content (replies, collapse, etc.)
                  // at full opacity below.
                  opacity: entry.isDeleted ? 0.35 : 1,
                }}
              >
                <h2
                  className="title"
                  style={{
                    // Lora subtitle (polish pass 2026-09-15) — the one place
                    // a heading wasn't Lora.
                    margin: 0, ...D.type.subtitle,
                    // TSP demo: guide titles render blue. (Wrapping is handled by
                    // keepTailTogether on the title text, not text-wrap.)
                    ...(entry.isInstructional ? { color: CANON.identity } : null),
                  }}
                >
                  {resolvedEntryIcon && (
                    <span style={{ marginRight: 4, display: "inline-flex", alignItems: "center" }}>
                      {resolvedEntryIcon}
                    </span>
                  )}
                  {entry.isInstructional && (
                    // TSP demo: cream flag leads an instructional "Alborz" entry
                    // title (flag-driven, never literal title text).
                    <span style={{ marginRight: 6, display: "inline-flex", alignItems: "center", verticalAlign: "middle" }}>
                      <Flag size={18} color={CANON.cream} />
                    </span>
                  )}
                  {entry.isDeleted ? "(deleted letter)" : demoMode ? keepTailTogether(entry.title) : entry.title}
                </h2>
                {/* Entry star RETIRED (help-system QA round 7): the surface
                    starred entries populated is gone, so the button is too.
                    The like plumbing (expandedLikeState etc.) stays dormant
                    for a future revival. */}
              </div>
              </div>

              <div style={{ marginTop: 6 }}>
                {isExpanded && demoMode ? (
                  // TSP demo: read-only expanded view — full body + replies,
                  // gated per-reply: visible replies render fully, ahead-of-
                  // progress ones render as stubs (mirrors the live reply gate),
                  // no V2InlineThread (no fetch, no composer/likes).
                  <div onClick={(e) => e.stopPropagation()}>
                    <div style={{ whiteSpace: "pre-line", lineHeight: 1.5 }}>{entry.body}</div>
                    {(demoReplies?.[entry.threadId] ?? []).length > 0 && (
                      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                        {(demoReplies?.[entry.threadId] ?? []).map((r) => {
                          // Reply gating: visible iff its episode <= viewer's.
                          if (r.episode > (viewerProgress?.e ?? 0)) {
                            // Ahead-of-progress stub — same copy as the live site.
                            return (
                              <div key={r.id} style={{ ...D.gatedStub(16), padding: "12px 16px", cursor: "default" }}>
                                <Lock size={18} strokeWidth={2} color={CANON.alert} style={{ flexShrink: 0 }} />
                                <div style={{ fontWeight: 400, fontSize: 14, lineHeight: 1.45, opacity: 0.9 }}>
                                  <b>{r.author}</b> responded from s{r.season} e{r.episode}. It opens when you catch up.
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div key={r.id} style={{ border: "2px solid var(--dos-border)", borderRadius: 16, padding: "10px 14px" }}>
                              <div className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                <Username name={r.author} userId={r.author} onClickProfile={() => {}} bold />
                                <span style={{ color: CANON.cream, whiteSpace: "nowrap" }}>
                                  {" • "}<EpisodeTag season={r.season} episode={r.episode} naturalNumbers parens={false} />
                                </span>
                              </div>
                              <div style={{ whiteSpace: "pre-line", lineHeight: 1.5 }}>{r.body}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
                      <button style={demoCollapseBtn} onClick={() => handleCollapseTop(entry.threadId)}>
                        <ChevronUp size={13} color={CANON.cream} /> close
                      </button>
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
                      sidebarKind={entry.sidebarKind ?? null}
                      whatsNextGroupId={parentGroupId}
                      onOpenRoom={onOpenRoom}
                      displayNames={displayNames}
                      groupId={groupId}
                      mobileIdiom={mobileIdiom}
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
                      responsesOff={responsesOff}
                      onReplyAdded={onReplyAdded}
                    />
                  </div>
                ) : entry.isDeleted ? (
                  <div style={{ fontStyle: "italic", color: CANON.dark, opacity: 0.35 }}>
                    {dn(entry.authorUsername)} deleted their entry.
                  </div>
                ) : isSb ? null : (
                  <div className="clamp3">
                    {parsePromptTokens(entry.preview).map((part, i) => (
                      <React.Fragment key={`prev-${i}`}>{part}</React.Fragment>
                    ))}
                    {demoMode && " …"}
                  </div>
                )}
              </div>

              {/* Bottom-left (the road, 2026-09-25): on your own entries, how
                  far the nearest friends are from opening this letter — a
                  sealed envelope, the responses badge's mirror. */}
              {!isExpanded && !entry.isDeleted && (() => {
                const cd = countdownFor(entry);
                if (!cd) return null;
                return (
                  <div style={{ position: "absolute", left: mobileIdiom ? 16 : 20, bottom: 12, maxWidth: "calc(100% - 110px)", display: "inline-flex", alignItems: "center", gap: 6, color: CANON.cream, fontSize: 13, fontWeight: 500, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <Mail size={14} color={CANON.cream} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{cd}</span>
                  </div>
                );
              })()}
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
                  <button
                    onClick={(e) => toggleExpand(entry.threadId, e)}
                    aria-label="Expand"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: CANON.cream,
                      cursor: "pointer",
                      padding: 4,
                      display: "inline-flex",
                      alignItems: "center",
                      fontFamily: "inherit",
                    }}
                  >
                    <ChevronDown size={20} color={CANON.cream} />
                  </button>
                  {/* Mails glyph + reply count (the letters grammar, 2026-09-25:
                      responses are the two-envelope glyph, never open — letters
                      own the single envelope). With a signal the WHOLE glyph +
                      number gets a blue/red pill behind it (Alborz 2026-09-13 — restored from the
                      pre-circle design). Renders only with at least one
                      visible reply (count includes ahead-of-progress stubs,
                      so a hidden-response signal always has a number). */}
                  {entry.replyCount > 0 && (() => {
                    const countInner = (
                      <span
                        aria-label={`${entry.replyCount} response${entry.replyCount === 1 ? "" : "s"}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          color: CANON.cream,
                          fontSize: 13,
                          fontWeight: 500,
                          userSelect: "none",
                          // Tightened (Alborz 2026-09-25): 3/9 padding, 14px
                          // glyph, 13px count — the pill sat against the
                          // preview's last line.
                          ...(pillKind
                            ? { background: pillKind === "blue" ? CANON.identity : CANON.alert, borderRadius: 65, padding: "3px 9px" }
                            : {}),
                        }}
                      >
                        <Mails size={14} color={CANON.cream} />
                        {entry.replyCount}
                      </span>
                    );
                    if (!pillKind) return countInner;
                    return (
                      <Tooltip
                        text={pillKind === "blue"
                          ? "New responses in here for you."
                          : signal?.redCount
                            ? "Responses in here for when you catch up."
                            : "Someone responded to your letter."}
                        direction="above"
                        align="right"
                        width={180}
                        portal
                      >
                        {countInner}
                      </Tooltip>
                    );
                  })()}
                  {/* Notes inside (his 10-07 note): the same grammar as the
                      response count — glyph + number, and with a signal the
                      blue/red pill behind it. When the letter also has
                      responses, the response pill carries the colour. */}
                  {(noteCounts?.[entry.threadId] ?? 0) > 0 && (() => {
                    const n = noteCounts![entry.threadId];
                    const noteKind = entry.replyCount > 0 ? null : pillKind;
                    const inner = (
                      <span
                        aria-label={`${n} note${n === 1 ? "" : "s"}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          color: CANON.cream,
                          fontSize: 13,
                          fontWeight: 500,
                          userSelect: "none",
                          ...(noteKind
                            ? { background: noteKind === "blue" ? CANON.identity : CANON.alert, borderRadius: 65, padding: "3px 9px" }
                            : {}),
                        }}
                      >
                        <MessageSquareText size={14} color={CANON.cream} />
                        {n}
                      </span>
                    );
                    if (!noteKind) return inner;
                    return (
                      <Tooltip
                        text={noteKind === "blue"
                          ? "New notes in here for you."
                          : signal?.redCount
                            ? "Notes in here for when you catch up."
                            : "Someone left a note on your letter."}
                        direction="above"
                        align="right"
                        width={180}
                        portal
                      >
                        {inner}
                      </Tooltip>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        );
        })()}</React.Fragment>);
      })}
      {endMarkers.length > 0 && renderMarkers(endMarkers)}

      {/* Discard-draft confirm — gates collapse and cross-thread expansion
          when the current composer has unsaved text. Same modal for both
          triggers per spec. */}
      {pendingCollapseTarget !== null && (
        // Cream dialog (polish pass 2026-09-15): a typing-loss hint, not a
        // room action.
        <Modal onClose={cancelDiscardDraft} width="min(360px, 92vw)" cardStyle={{ borderRadius: 24, padding: 32, background: CANON.cream, color: "var(--canon-dark,#1a3a4a)", animation: "dCardRise 180ms ease-out" }}>
          <div>
            <h3 style={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 700, fontSize: 22, lineHeight: 1.3, margin: "0 0 10px" }}>Discard your reply?</h3>
            <p style={{ fontSize: 15, lineHeight: 1.5, opacity: 0.9, margin: "0 0 18px" }}>
              If you open another thread, you will lose what you've been writing. Are you sure?
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={confirmDiscardDraft}
                style={{ fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 700, padding: "12px 28px", minHeight: 44, borderRadius: 9999, boxSizing: "border-box", cursor: "pointer", flex: 1, background: "var(--danger)", border: "none", color: CANON.cream, whiteSpace: "nowrap" }}
              >
                Yes, I'm sure
              </button>
              <button
                onClick={cancelDiscardDraft}
                style={{ fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 700, padding: "12px 28px", minHeight: 44, borderRadius: 9999, boxSizing: "border-box", cursor: "pointer", flex: 1, background: "transparent", border: "2px solid var(--canon-dark,#1a3a4a)", color: "var(--canon-dark,#1a3a4a)" }}
              >
                Cancel
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
      text={<>Responses in here<br />for when you catch up.</>}
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
          color: CANON.cream,
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
