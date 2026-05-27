import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, DoorClosed, DoorOpen, SquarePen } from "lucide-react";
import Tooltip from "../Tooltip";
import { effectiveProgress } from "../../lib/utils";
import type { ProgressEntry } from "../../types";
import DiceFace from "./DiceFace";
import NudgePopover, { type NudgeDirection } from "../NudgePopover";
import AskTheRoomPicker from "../AskTheRoomPicker";
import PollComposer from "../PollComposer";
import SIKWComposer from "../SIKWComposer";

// V2 friend room — right-pane "season map".
//
// Per-friend × per-episode grid. Columns = friend members (current + departed,
// capped at 8 per spec). Rows = episodes grouped by season. Cells render one
// of four states for active members (wrote entry / watched-and-rated /
// watched-no-rating / not-reached); for departed members, cells beyond their
// last-reached episode disappear entirely and the column terminates with a
// solid dot just below their last cell.
//
// Spine line: vertical thread connecting reached cells in a column, stops at
// last-reached for active members. For departed members, ends with the
// terminal dot.
//
// Scroll: the map scrolls independently from the feed. On mount, the row
// matching the viewer's effective progress is centered in view. Username
// headers stay sticky at the top of the scroll container.

const CELL = 32;          // 32px cell — 8px grid
const CELL_RADIUS = 8;
const GAP_BELOW = 16;     // spine + dot live in this strip
const HELPER_W = 140;     // helper-text column ("click a name to nudge a friend")
const DOOR_W = 48;        // door-icon column (ask the room launcher)
const ROW_HEIGHT = CELL + GAP_BELOW; // 48px
const COL_GAP = 16;
const SEASON_LABEL_W = 80;
const EPISODE_LABEL_W = 24;
const HEADER_HEIGHT = 120;

// Module-scoped canvas for one-shot text measurement. Used by the
// dynamic header-height calculation so the rating-edit icon at the top
// of the self column always sits clear of the rotated username
// regardless of its length.
let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (_measureCtx) return _measureCtx;
  const canvas = document.createElement("canvas");
  _measureCtx = canvas.getContext("2d");
  return _measureCtx;
}
function measureUsernameWidth(displayed: string): number {
  const ctx = getMeasureCtx();
  if (!ctx) return 0;
  // Match the rendered username style: fontSize 13, fontWeight 400,
  // family inherits site default (Inter). Self column is never italic
  // (italic only applies to clickable non-self columns), so non-italic
  // measurement is correct for sizing the icon clearance.
  ctx.font = "400 13px Inter, sans-serif";
  return ctx.measureText(displayed).width;
}

// Rating phrase copy — per spec §"The rating system" and the dice-display
// spec (sidebar_spec_rating_dice_display.md). Integer scale ASCENDS with
// goodness: 1 = worst (Nope. / 1 dot), 6 = best (Woah! / 6 dots). Inverted
// from the original mapping on 2026-05-16.
const RATING_PHRASES: Record<number, string> = {
  1: "Nope.",
  2: "Losing me.",
  3: "I'll keep going.",
  4: "Solid.",
  5: "Things are cooking.",
  6: "Woah!",
};

export type V2RoomMapEntry = {
  threadId: string;
  s: number;
  e: number;
  title: string;
};

export type V2RoomMapRating = {
  s: number;
  e: number;
  rating: number;
};

export type V2RoomMapMember = {
  userId: string;
  username: string;
  isDeparted: boolean;
  progress: ProgressEntry | null;
  ratings: V2RoomMapRating[];
  entries: V2RoomMapEntry[];
};

export type V2RoomMapProps = {
  members: V2RoomMapMember[];
  /** Per-season episode counts — comes from shows.seasons. */
  seasons: number[];
  /** Viewer's progress — drives initial scroll + above-progress title masking. */
  viewerProgress: ProgressEntry | null;
  /** Viewer's user id — drives the canon-dark-blue self-column treatment. */
  viewerUserId?: string;
  /** Set of entry threadIds currently intersecting the viewport in the feed.
      Drives click-to-adjust on self-column state-2 cells: when the cell's
      entry is visible, click rotates rating; when off-screen, click scrolls. */
  visibleEntryIds?: Set<string>;
  /** Friend room id. Required for the pings/polls/SIKW launcher mode —
      header click opens NudgePopover for that recipient; door icon opens
      AskTheRoomPicker → PollComposer / SIKWComposer. Without groupId,
      launcher mode is suppressed (names render as plain non-clickable). */
  groupId?: string;
  /** Fires when a cell with an entry is clicked. */
  onEntryClick: (threadId: string) => void;
  /** Fires when the viewer clicks one of their own cells in a way that
      changes the rating. Caller persists + updates state. State 3 first
      click sends rating=1; state 1 and state 2 (when entry visible) send
      the next cycle value (current+1, OR null to clear when current=6,
      OR 1 after a clear). null means delete the row from episode_ratings. */
  onRateOwnCell?: (season: number, episode: number, newRating: number | null) => void;
  /** Fires after the asker successfully opens a poll. Parent bumps
      PollSticky's refreshKey so the asker sees their poll immediately. */
  onPollOpened?: () => void;
  /** Per-thread notification dot lookup. Green = new visible response(s);
      Red = own entry with hidden responses (number shown). Green beats red;
      only one dot per cell. Dot sits half-overlapping the LEFT edge of the
      cell, vertically centered, 16px diameter, NO drop shadow. */
  cellSignals?: Record<string, { kind: "green" | "red"; redCount?: number }>;
  /** Manual X-click dismissal of the red dot on a cell. */
  onDismissRedDot?: (threadId: string) => void;
  /** Per-thread "this entry is new since your last room visit" flag. Drives
      the white outline on the cell. Same flag drives the entry-card's
      white outline (handled in V2RoomFeed). */
  isNewMap?: Record<string, boolean>;
  /** Per-thread "user has clicked this cell at least once this session"
      flag. Drives spec #2: a self-column cell with a notification AND not
      in this set routes click → onEntryClick (highlight ticket, no rate).
      Once a threadId is in this set, subsequent self-cell clicks fall
      through to the existing rate-change path. */
  firstHighlightedSet?: Set<string>;
  /** Batch-commit handler for the rating edit mode. Called when the user
      clicks the list-check icon to confirm pending changes. Each change
      is `{ s, e, rating }` where rating=null means delete. Returns
      `{ ok: false }` on any failure so the map can revert + surface an
      error message. */
  onCommitRatings?: (
    changes: { s: number; e: number; rating: number | null }[],
  ) => Promise<{ ok: boolean }>;
  /** When set, all member columns EXCEPT this user's get dimmed
      (opacity 0.35) and non-interactive (no tooltip, no click, no
      notification dots). Drives the V2 friend-room user-filter mode —
      the feed is also filtered to this user's entries by the page-
      level component. Null/undefined = no filter. */
  filteredUserId?: string | null;
};

// Direction + count of a member's progress relative to the viewer. Ported
// from V1 FriendProgressPostIt's episodeIndex/direction logic. Used for
// the NudgePopover preset selection (different copy per direction).
function episodeIndex(seasons: number[], s: number, e: number): number | null {
  if (s < 1 || e < 1) return 0;        // hasn't started → idx 0
  if (!seasons.length) return null;
  if (s > seasons.length) return null;
  let idx = 0;
  for (let i = 0; i < s - 1; i++) idx += seasons[i] ?? 0;
  idx += e;
  return idx;
}

function nudgeStatusFor(
  memberProgress: ProgressEntry | null,
  viewerProgress: ProgressEntry | null,
  seasons: number[],
): { direction: NudgeDirection; count: number | null } {
  const m = effectiveProgress(memberProgress);
  const v = effectiveProgress(viewerProgress);
  // Not-started = member has no progress row OR is at (0,0)
  if (!m || (m.s < 1 || m.e < 1)) {
    return { direction: "not-started", count: null };
  }
  if (!v) {
    // Viewer has no progress — every member counts as "ahead" of viewer
    return { direction: "ahead", count: null };
  }
  if (m.s === v.s && m.e === v.e) {
    return { direction: "same", count: null };
  }
  const memberIdx = episodeIndex(seasons, m.s, m.e);
  const viewerIdx = episodeIndex(seasons, v.s, v.e);
  if (m.s > v.s || (m.s === v.s && m.e > v.e)) {
    const count = memberIdx != null && viewerIdx != null ? memberIdx - viewerIdx : null;
    return { direction: "ahead", count };
  }
  const count = memberIdx != null && viewerIdx != null ? viewerIdx - memberIdx : null;
  return { direction: "behind", count };
}

type RowKey = { season: number; episode: number; isFirstOfSeason: boolean };

function flattenSeasons(seasons: number[]): RowKey[] {
  const rows: RowKey[] = [];
  seasons.forEach((epCount, sIdx) => {
    const season = sIdx + 1;
    for (let ep = 1; ep <= epCount; ep++) {
      rows.push({ season, episode: ep, isFirstOfSeason: ep === 1 });
    }
  });
  return rows;
}

// Episode index is greater than effective progress = above viewer's reach.
function isAbove(
  effS: number,
  effE: number,
  s: number,
  e: number,
): boolean {
  if (s > effS) return true;
  if (s < effS) return false;
  return e > effE;
}

export default function V2RoomMap({
  members,
  seasons,
  viewerProgress,
  viewerUserId,
  visibleEntryIds,
  groupId,
  onEntryClick,
  onRateOwnCell,
  onPollOpened,
  cellSignals,
  onDismissRedDot,
  isNewMap,
  firstHighlightedSet,
  onCommitRatings,
  filteredUserId,
}: V2RoomMapProps) {
  // Predicate for the user-filter dim treatment. When a filter is
  // active, columns belonging to other members render at opacity 0.35
  // with pointer-events: none — no tooltips, no clicks, no dot hover.
  // The filtered user's column stays full-color and fully interactive.
  const isDimmed = (userId: string): boolean =>
    !!filteredUserId && filteredUserId !== userId;
  // Dynamic header height: grow the column-header zone so the rating-
  // edit icon at the top of the self column always sits ABOVE the rotated
  // username, even for long names. The icon is at `top: 4` with height 24,
  // and we want ~8px of breathing room below it before the rotated
  // username starts — so column_height needs to be at least:
  //   4 (icon top) + 24 (icon height) + 8 (gap) + username_width + 8
  //     (username bottom padding) = 44 + username_width.
  // Plus an 8px safety margin in case the canvas measurement drifts from
  // the actual rendered width (subpixel layout, font metrics edge cases).
  // Other columns inherit the same height (uniform grid); they have no
  // icon, so the extra room above their usernames is just empty space.
  const ICON_CLEARANCE = 52;
  // Re-measure username width once Inter has loaded. Without this, the
  // first measurement on a cold cache uses whatever fallback font the
  // browser substitutes (typically narrower than Inter), undersizing
  // dynamicHeaderHeight by ~10-15% and causing the rating-edit icon to
  // overlap the rotated username. Triggered via fontsReady → useMemo
  // dep so the recompute happens automatically.
  const [fontsReady, setFontsReady] = useState<boolean>(() => {
    if (typeof document === "undefined") return true;
    return (document as Document & { fonts?: FontFaceSet }).fonts?.status === "loaded";
  });
  useEffect(() => {
    if (fontsReady) return;
    if (typeof document === "undefined") return;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) { setFontsReady(true); return; }
    let cancelled = false;
    fonts.ready.then(() => { if (!cancelled) setFontsReady(true); });
    return () => { cancelled = true; };
  }, [fontsReady]);
  const selfMember = useMemo(
    () => (viewerUserId ? members.find((m) => m.userId === viewerUserId) : undefined),
    [members, viewerUserId],
  );
  const selfUsernameWidth = useMemo(
    () => (selfMember ? measureUsernameWidth(`@${selfMember.username}`) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selfMember?.username, fontsReady],
  );
  const dynamicHeaderHeight = Math.max(
    HEADER_HEIGHT,
    Math.ceil(selfUsernameWidth) + ICON_CLEARANCE,
  );

  // ── Launcher state (pings / polls / SIKW). Only meaningful when
  // groupId is provided — V2FriendRoomPage always supplies it; other
  // hypothetical callers without a room context get plain headers.
  const launcherMode = !!groupId;
  const [nudgeOpenFor, setNudgeOpenFor] = useState<{
    recipientId: string;
    recipientUsername: string;
    direction: NudgeDirection;
    count: number | null;
    anchorRect: DOMRect;
  } | null>(null);
  const [askPickerRect, setAskPickerRect] = useState<DOMRect | null>(null);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [sikwComposerOpen, setSikwComposerOpen] = useState(false);
  const [doorHover, setDoorHover] = useState(false);
  // Bounce animation — two-phase. Phase 'up' = INSTANT pop to scale(1.12)
  // with no transition; phase 'down' = animate back to scale(1) over 150ms
  // ease-out. Two requestAnimationFrames between phases guarantee the 'up'
  // state actually renders (otherwise React would batch the state updates
  // and the user would only ever see the down-animation). After ~200ms
  // (enough buffer past the 150ms down-animation), state clears back to
  // null so the cell has NO transform property at all — important because
  // an unconditional transform (even identity scale(1)) promotes the cell
  // to its own compositing layer, which causes sub-pixel rendering
  // differences that mis-align the spine below the cell ("broken line").
  const [bouncingState, setBouncingState] = useState<{ cellKey: string; phase: "up" | "down" } | null>(null);
  // Receding-layer click cycle state for multi-entry cells. Keyed by
  // `${m.userId}-${s}-${e}` (= fullCellKey). Each entry stores the
  // current cycle index + the threadId we most recently highlighted on
  // this cell. On a click: if the last-highlighted thread is still in
  // the viewport (via visibleEntryIds), advance to (idx + 1) % N; else
  // reset to idx 0. Per Q3 = Option B, ANY cell click resets every
  // OTHER cell's cycle (we replace the whole map on each click), so
  // only one cell's cycle is in flight at a time.
  const [cycleStateByCellKey, setCycleStateByCellKey] = useState<
    Record<string, { idx: number; lastHighlightedThreadId: string }>
  >({});

  // Hover tracking for notification dots (spec #4).
  // hoveredCellKey = full per-cell key currently hovered (cellInner or dot).
  // hoveredDotKey  = full per-cell key whose dot specifically is hovered.
  // Single value at a time — only one cell can be under the cursor.
  // Driven by mouseEnter/Leave on the cell wrapper + the dot.
  const [hoveredCellKey, setHoveredCellKey] = useState<string | null>(null);
  const [hoveredDotKey, setHoveredDotKey] = useState<string | null>(null);

  // ── Rating-edit mode ──────────────────────────────────────────────────
  // editMode: when true, the viewer's own column-header shows a list-check
  // icon, cells in the viewer's column turn canon-red fill, and clicks on
  // self cells rotate rating (held in pendingRatings, NOT persisted).
  // When false, cell clicks ONLY navigate (scroll-to-entry / highlight).
  // pendingRatings: per-cell-key (`${s}-${e}`) → number (1..6) | null (clear).
  // Cleared on confirm (after successful commit) OR on entering edit mode.
  // saveError: brief text shown below the icon when commit fails; auto-
  // clears after 4s. Pending changes are discarded on failure.
  const [editMode, setEditMode] = useState(false);
  const [pendingRatings, setPendingRatings] = useState<Record<string, number | null>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const saveErrorTimerRef = useRef<number | null>(null);
  const triggerBounce = (cellKey: string) => {
    setBouncingState({ cellKey, phase: "up" });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setBouncingState((prev) =>
          prev && prev.cellKey === cellKey ? { cellKey, phase: "down" } : prev,
        );
      });
    });
    window.setTimeout(() => {
      setBouncingState((prev) =>
        prev && prev.cellKey === cellKey && prev.phase === "down" ? null : prev,
      );
    }, 200);
  };

  // Toggle edit mode. Entering: clear any stale pending state. Confirming
  // (exiting via the icon click): if there are pending changes, batch-
  // commit them via onCommitRatings. On any commit failure, revert (clear
  // pendingRatings → server state wins on next render) and surface the
  // brief inline error message for 4s.
  const handleToggleEditMode = async () => {
    if (committing) return;
    if (editMode) {
      // Confirm path: batch commit pending changes, then exit.
      const changes = Object.entries(pendingRatings).map(([key, rating]) => {
        const [s, e] = key.split("-").map(Number);
        return { s, e, rating };
      });
      if (changes.length === 0 || !onCommitRatings) {
        setEditMode(false);
        setPendingRatings({});
        return;
      }
      setCommitting(true);
      const result = await onCommitRatings(changes);
      setCommitting(false);
      setPendingRatings({});
      setEditMode(false);
      if (!result.ok) {
        setSaveError("Couldn't save ratings. Try again.");
        if (saveErrorTimerRef.current) window.clearTimeout(saveErrorTimerRef.current);
        saveErrorTimerRef.current = window.setTimeout(() => {
          setSaveError(null);
          saveErrorTimerRef.current = null;
        }, 4000);
      }
    } else {
      // Entering edit mode — start with a clean slate.
      setPendingRatings({});
      setSaveError(null);
      setEditMode(true);
    }
  };

  // Click-cycle target for a self-column cell. The cycle includes a
  // "no rating" position between 6 and 1, so a click on a 6-rated cell
  // clears the rating (cell reverts to state 3). Subsequent click sets
  // to 1 again. Sequence: undefined → 1 → 2 → 3 → 4 → 5 → 6 → undefined → 1 …
  const nextRatingTarget = (cur: number | undefined): number | null => {
    if (cur === undefined) return 1;   // no rating → 1
    if (cur >= 6) return null;          // 6 → clear
    return cur + 1;                     // 1..5 → +1
  };
  // Filter seasons to those any member has reached AT LEAST episode 1 in.
  // A member at S2E0 ("haven't started season 2") hasn't reached any S2
  // episode, so S2 stays hidden until someone actually watches S2E1+.
  // Rewatcher-aware via effectiveProgress (highest for rewatchers).
  const touchedSeasons = useMemo(() => {
    let maxSeasonReached = 0;
    for (const m of members) {
      const eff = effectiveProgress(m.progress);
      if (!eff) continue;
      const reachedSeason = eff.e >= 1 ? eff.s : eff.s - 1;
      if (reachedSeason > maxSeasonReached) maxSeasonReached = reachedSeason;
    }
    if (maxSeasonReached <= 0) return [];
    return seasons.slice(0, maxSeasonReached);
  }, [members, seasons]);

  const rows = useMemo(() => flattenSeasons(touchedSeasons), [touchedSeasons]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Per-season ref map (key = season number) populated as season-label rows
  // render. Used by the on-mount scroll-to-viewer-season effect below.
  const seasonStartRefs = useRef<Record<number, HTMLDivElement | null>>({});
  // Guard so the initial scroll fires once per V2RoomMap mount — subsequent
  // re-renders from data refreshes / state changes shouldn't yank the
  // user's scroll position back to where they started.
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    const container = scrollRef.current;
    if (!container || !viewerProgress) return;
    // Skip the scroll when viewer hasn't started (0,0) — top of map is fine.
    if (viewerProgress.s < 1 || viewerProgress.e < 1) return;
    // Use the viewer's RAW progress (.s) for the scroll target — that's the
    // viewer's CURRENT watching position (= rewatch position for rewatchers),
    // which matches their mental model of "where I am right now." Reading
    // ceiling is highestS/E; that's not what we want for this scroll.
    const targetSeason = viewerProgress.s;
    // Row-aligned scrollTop with 16px breathing room above the target's
    // cell so the spine segment connecting the target to the previous row
    // is visible just below the sticky header — a visual cue that there's
    // more content to scroll up to. ROW_HEIGHT = CELL (32) + GAP_BELOW
    // (16). Subtracting GAP_BELOW from the row-aligned position reveals
    // exactly the spine area while keeping every visible row below the
    // header row-aligned.
    let targetRowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].season === targetSeason && rows[i].episode === 1) {
        targetRowIdx = i;
        break;
      }
    }
    if (targetRowIdx < 0) return;
    container.scrollTop = Math.max(0, targetRowIdx * ROW_HEIGHT - GAP_BELOW);
    initialScrollDoneRef.current = true;
  }, [viewerProgress, rows]);

  // Pre-compute per-member: last reached row index (-1 if none), and a map
  // from `${s}-${e}` → entry / rating, for O(1) cell lookups.
  const memberMaps = useMemo(() => {
    return members.map((m) => {
      const eff = effectiveProgress(m.progress);
      let lastReachedIdx = -1;
      if (eff) {
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (r.season < eff.s || (r.season === eff.s && r.episode <= eff.e)) {
            lastReachedIdx = i;
          } else {
            break;
          }
        }
      }
      const ratingByKey = new Map<string, number>();
      for (const r of m.ratings) ratingByKey.set(`${r.s}-${r.e}`, r.rating);
      // entryByKey holds a LIST of entries per cell — multiple entries on
      // the same (s, e) render as a receding layer stack and the click
      // cycles through them (see receding-layers spec). RPC orders ASC by
      // created_at, so we .unshift() to keep the list newest-first
      // (entries[0] = most recent, [last] = oldest).
      const entryByKey = new Map<string, V2RoomMapEntry[]>();
      for (const e of m.entries) {
        const k = `${e.s}-${e.e}`;
        const list = entryByKey.get(k);
        if (list) list.unshift(e);
        else entryByKey.set(k, [e]);
      }
      return { lastReachedIdx, ratingByKey, entryByKey };
    });
  }, [members, rows]);

  const viewerEff = effectiveProgress(viewerProgress);

  return (
    <div
      ref={scrollRef}
      style={{
        overflowY: "auto",
        // Extend to the bottom edge of the viewport: viewport height minus
        // the sticky-top offset (--site-header-h + 60px from V2FriendRoom-
        // Page's inner sticky). Was -100px (40px shy of the bottom).
        maxHeight: `calc(100vh - var(--site-header-h) - 60px)`,
        position: "relative",
        // Right padding on the scrollable container — keeps the browser's
        // vertical scrollbar from overlapping the rightmost member column.
        // Was 6px (just enough for the click-bounce overflow); bumped to
        // 24px so the scrollbar sits clear of the @<rightmost> cells.
        paddingRight: 24,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${SEASON_LABEL_W}px ${EPISODE_LABEL_W}px repeat(${members.length}, ${CELL}px)`,
          columnGap: COL_GAP,
          alignItems: "start",
          // 24px of trailing padding on the grid so the sticky-header
          // divider can extend that far past the column tracks. Body rows
          // continue to sit within the column tracks; this padding is
          // dead space on the right of every body row, picked up only by
          // the sticky header (via width: calc(100% + 24px) below).
          paddingRight: 24,
        }}
      >
        {/* ── Sticky username header row ───────────────────────────────── */}
        <div
          style={{
            gridColumn: "1 / -1",
            display: "grid",
            gridTemplateColumns: `${SEASON_LABEL_W}px ${EPISODE_LABEL_W}px repeat(${members.length}, ${CELL}px)`,
            columnGap: COL_GAP,
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: "var(--dos-bg)",
            paddingBottom: 8,
            // 2px white divider at the top edge of the scrollable cell
            // area — visual cue that the sticky header ends here and the
            // scrollable grid begins. Sits at the bottom of the sticky
            // header's box (after the 8px paddingBottom).
            borderBottom: "2px solid #fff",
            // Extend the box 24px past the grid column tracks so the
            // divider line reaches further right than the rightmost cell
            // column. The outer grid's paddingRight: 24 above provides
            // the room for this overflow (without it, overflowX clipping
            // would hide the extension).
            width: "calc(100% + 24px)",
          }}
        >
          {/* Season-label column slot (col 1, 80px wide). Hosts the
              "ask the room" door icon in the sticky header; body rows
              put the Season N label in this same column. */}
          <div
            style={{
              width: SEASON_LABEL_W,
              height: dynamicHeaderHeight,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-start",
              paddingBottom: 8,
              paddingLeft: 8,
            }}
          >
            {launcherMode && (
              <Tooltip
                text="Question for the room?"
                direction="above"
                align="left"
                width={180}
                portal
              >
                <button
                  aria-label="Ask the room"
                  onMouseEnter={() => setDoorHover(true)}
                  onMouseLeave={() => setDoorHover(false)}
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setAskPickerRect(rect);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  {doorHover ? <DoorOpen size={24} /> : <DoorClosed size={24} />}
                </button>
              </Tooltip>
            )}
          </div>
          {/* Episode-label column slot (col 2, 24px wide). Hosts the
              rotated helper text "click a name to / nudge a friend" in
              the sticky header; body rows put the e# marker here. The
              rotated text is ~32px wide visually, so it overflows ~8px
              into the column-gap area to the right (overflow visible
              to allow this). */}
          <div
            style={{
              width: EPISODE_LABEL_W,
              height: dynamicHeaderHeight,
              position: "relative",
              overflow: "visible",
            }}
          >
            {launcherMode && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 8,
                  transform: "rotate(-90deg)",
                  transformOrigin: "left bottom",
                  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                  fontStyle: "italic",
                  fontSize: 13,
                  color: "var(--dos-border)",
                  lineHeight: 1.25,
                  whiteSpace: "nowrap",
                }}
              >
                click a name to<br />nudge a friend
              </div>
            )}
          </div>
          {members.map((m) => {
            const isSelfCol = !!viewerUserId && m.userId === viewerUserId;
            const dimmed = isDimmed(m.userId);
            // Filter mode disables nudges + edit-mode toggles for other
            // members. The filtered user's own column (and the self
            // column, when self isn't the filtered one but isn't dimmed
            // either) keep their normal interactivity.
            const isClickable = launcherMode && !isSelfCol && !m.isDeparted && !dimmed;
            // Self-column username + the rating-edit icon BOTH toggle
            // edit mode (per spec). Tooltip + cursor + click handlers
            // are applied to both elements so either one is a working
            // affordance.
            const usernameTooltipText: React.ReactNode | null = isSelfCol
              ? (
                  <>
                    <span style={{ display: "block" }}>Adjust your</span>
                    <span style={{ display: "block" }}>episode ratings.</span>
                  </>
                )
              : isClickable
              ? (
                  <>
                    <span style={{ display: "block" }}>Give @{m.username}</span>
                    <span style={{ display: "block", fontStyle: "italic" }}>a nudge.</span>
                  </>
                )
              : null;
            return (
              <div
                key={m.userId}
                style={{
                  width: CELL,
                  height: dynamicHeaderHeight,
                  position: "relative",
                  // Self column needs overflow visible so the edit-mode
                  // icon + error message (which extend past the 32px
                  // column width) aren't clipped. Other columns stay
                  // clipped so their rotated usernames don't bleed.
                  overflow: isSelfCol ? "visible" : "hidden",
                  // User-filter dim: non-filtered columns fade out and
                  // disable all child interaction (tooltips / clicks /
                  // dot hover). Pointer-events: none on the column
                  // wrapper is enough — every interactive descendant
                  // becomes non-receptive in one go.
                  opacity: dimmed ? 0.35 : undefined,
                  pointerEvents: dimmed ? "none" : undefined,
                  transition: "opacity 180ms ease-out",
                }}
              >
                {/* ── Rating-edit icon (self column only) ───────────────
                    Square-pen toggles to list-check while editing. White
                    when idle, canon-red while editing. Click toggles
                    edit mode + commits on exit. */}
                {isSelfCol && (
                  <>
                    <Tooltip
                      text={
                        editMode
                          ? "Click the episode boxes in the map to adjust episode ratings. Click here again to confirm your choices."
                          : "Adjust episode ratings."
                      }
                      direction="above"
                      align="center"
                      width={editMode ? 240 : 160}
                      portal
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={editMode ? "Confirm rating changes" : "Adjust episode ratings"}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleToggleEditMode();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void handleToggleEditMode();
                          }
                        }}
                        style={{
                          position: "absolute",
                          top: 4,
                          left: CELL / 2 - 12,
                          width: 24,
                          height: 24,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: committing ? "wait" : "pointer",
                          color: "#f45028",
                          zIndex: 3,
                        }}
                      >
                        {editMode ? <CircleCheck size={16} /> : <SquarePen size={16} />}
                      </div>
                    </Tooltip>
                    {saveError && (
                      <div
                        style={{
                          position: "absolute",
                          top: 32,
                          left: CELL / 2 - 120,
                          width: 240,
                          fontFamily: "Inter, sans-serif",
                          fontSize: 11,
                          color: "#f45028",
                          textAlign: "center",
                          lineHeight: 1.3,
                          zIndex: 3,
                          pointerEvents: "none",
                        }}
                      >
                        {saveError}
                      </div>
                    )}
                  </>
                )}
                {(() => {
                  // Positioning styles: applied to the OUTER element
                  // (Tooltip wrapper when a tooltip is present, otherwise
                  // the username div itself). The Tooltip wrapper sets
                  // position:relative + display:inline-block by default;
                  // we override with the absolute rotation so the click
                  // target sits where the username text rendered before
                  // the tooltip was added.
                  const positioningStyle: React.CSSProperties = {
                    // transformOrigin: left bottom — pre-rotation pivot
                    // at the element's bottom-left, which becomes the
                    // rotated bottom anchor; "@" sits at the column
                    // bottom; long usernames truncate at the rotated top.
                    position: "absolute",
                    left: CELL / 2 + 8,
                    bottom: 8,
                    transform: "rotate(-90deg)",
                    transformOrigin: "left bottom",
                    whiteSpace: "nowrap",
                    // Per-column rotated-text length cap. Self column
                    // leaves room for the rating-edit icon (4 top + 24
                    // height + 8 gap = 36, plus 8 bottom padding); non-
                    // self columns have no icon and can use almost the
                    // full column height. dynamicHeaderHeight grows to
                    // fit the self username when it's longer than the
                    // default HEADER_HEIGHT - 36, so for the self column
                    // this cap should match the actual text width with a
                    // small visual gap (8 px).
                    maxWidth: isSelfCol ? dynamicHeaderHeight - 36 : dynamicHeaderHeight - 8,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontSize: 13,
                    fontWeight: 400,
                    color: "#fff",
                    fontStyle: isClickable ? "italic" : undefined,
                    borderBottom: isClickable ? "1px dotted #fff" : undefined,
                    cursor: (isClickable || isSelfCol) ? "pointer" : undefined,
                  };
                  const usernameDiv = (
                    <div
                      role={isClickable || isSelfCol ? "button" : undefined}
                      tabIndex={isClickable || isSelfCol ? 0 : undefined}
                      onClick={
                        isSelfCol
                          ? (e) => {
                              e.stopPropagation();
                              void handleToggleEditMode();
                            }
                          : isClickable
                          ? (e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const status = nudgeStatusFor(m.progress, viewerProgress, seasons);
                              setNudgeOpenFor({
                                recipientId: m.userId,
                                recipientUsername: m.username,
                                direction: status.direction,
                                count: status.count,
                                anchorRect: rect,
                              });
                            }
                          : undefined
                      }
                      onKeyDown={
                        isSelfCol
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                void handleToggleEditMode();
                              }
                            }
                          : isClickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                const status = nudgeStatusFor(m.progress, viewerProgress, seasons);
                                setNudgeOpenFor({
                                  recipientId: m.userId,
                                  recipientUsername: m.username,
                                  direction: status.direction,
                                  count: status.count,
                                  anchorRect: rect,
                                });
                              }
                            }
                          : undefined
                      }
                    >
                      @{m.username}
                    </div>
                  );
                  if (usernameTooltipText == null) {
                    // No tooltip: positioning style on the div itself.
                    return React.cloneElement(usernameDiv, { style: positioningStyle });
                  }
                  // Tooltip wrapper takes the positioning; the inner div
                  // sits at default position within the rotated wrapper.
                  return (
                    <Tooltip
                      text={usernameTooltipText}
                      direction="left"
                      width="auto"
                      portal
                      tooltipStyle={{ textAlign: "center" }}
                      style={positioningStyle}
                    >
                      {usernameDiv}
                    </Tooltip>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* ── 16px breathing spacer between sticky header and body rows.
            Non-sticky — sits in the grid's flow at content position
            HEADER_HEIGHT to HEADER_HEIGHT+16, then scrolls with the rest
            of the body. Effect on initial load: target row's first cell
            sits 16px lower than it would without this spacer. Above the
            target cell, body content scrolls naturally (showing the
            previous row's cell + spine when target is deeper than row
            0). No sticky overlay obscuring scrolling content. */}
        <div aria-hidden style={{ gridColumn: "1 / -1", height: 16 }} />

        {/* ── Body rows ────────────────────────────────────────────────── */}
        {rows.map((row, rowIdx) => {
          const rowKey = `${row.season}-${row.episode}`;
          const showSeasonBreak = row.isFirstOfSeason && rowIdx > 0;
          return (
            <React.Fragment key={rowKey}>
              {showSeasonBreak && (
                <>
                  {/* Season-break spacer: 2x GAP_BELOW of extra space before
                      a new season — combined with the previous row's regular
                      GAP_BELOW, the total inter-season gap is 48px. Spine
                      continues through the break for members reached on
                      both sides.

                      Grid alignment: this Fragment emits one child per
                      grid column (7 total: season placeholder, episode
                      placeholder, then N member spines). Without the
                      episode placeholder, every member spine would
                      auto-place one column LEFT — self's spine would
                      land in the episode-label column and the last
                      member's spine would be dropped entirely. */}
                  <div style={{ height: GAP_BELOW * 2 }} />
                  <div /> {/* episode-label column placeholder */}
                  {members.map((m, mIdx) => {
                    const mMap = memberMaps[mIdx];
                    const prevReached = rowIdx - 1 <= mMap.lastReachedIdx;
                    const thisReached = rowIdx <= mMap.lastReachedIdx;
                    const drawSpine = prevReached && thisReached;
                    return (
                      <div
                        key={m.userId}
                        style={{ width: CELL, height: GAP_BELOW * 2, position: "relative" }}
                      >
                        {drawSpine && (
                          <div
                            style={{
                              position: "absolute",
                              left: CELL / 2 - 1,
                              top: 0,
                              width: 2,
                              height: GAP_BELOW * 2,
                              background: "var(--dos-border)",
                              opacity: 0.55,
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {/* Season label — only on the first row of each season */}
              <div
                ref={(el) => {
                  if (row.isFirstOfSeason) seasonStartRefs.current[row.season] = el;
                }}
                style={{
                  height: ROW_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingRight: 8,
                }}
              >
                {row.isFirstOfSeason && (
                  <span
                    style={{
                      fontSize: 14,
                      whiteSpace: "nowrap",
                      color: "#fff",
                    }}
                  >
                    Season {row.season}
                  </span>
                )}
              </div>

              {/* Episode label — sits between the season label and the
                  first cell column. Right-aligned within its column so
                  it visually hugs the cell. */}
              <div
                style={{
                  height: ROW_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingRight: 4,
                  fontSize: 12,
                  color: "#fff",
                }}
              >
                e{row.episode}
              </div>

              {/* One cell per member */}
              {members.map((m, mIdx) => {
                const mMap = memberMaps[mIdx];
                const isReached = rowIdx <= mMap.lastReachedIdx;
                const isLastReached = rowIdx === mMap.lastReachedIdx;
                // entries[0] is the newest; [last] is the oldest. `entry`
                // (top-most / front-most layer) drives notification anchor,
                // dice, and the single-entry tooltip — receding layers are
                // pure visual decoration behind it.
                const cellEntries = mMap.entryByKey.get(rowKey) ?? [];
                const entry = cellEntries[0];
                const isMultiEntry = cellEntries.length > 1;
                const persistedRating = mMap.ratingByKey.get(rowKey);
                const isSelf = !!viewerUserId && m.userId === viewerUserId;
                // In edit mode, the viewer's own cells reflect pending
                // rating changes overlaid on top of the server state. For
                // other members' cells (and outside edit mode), always
                // use the server state.
                const pendingHas = isSelf && rowKey in pendingRatings;
                const pendingValue = pendingHas ? pendingRatings[rowKey] : undefined;
                const rating: number | undefined =
                  pendingHas
                    ? (pendingValue ?? undefined)
                    : persistedRating;

                // Departed-and-beyond-reach: render nothing (cell disappears).
                const renderEmpty = m.isDeparted && !isReached;

                // Spine below: drawn when this cell AND the next row's cell
                // (same column) are both reached. For departed at terminal,
                // the dot lives in this gap instead.
                const nextReached =
                  rowIdx + 1 <= mMap.lastReachedIdx; // next row also reached
                const showSpineBelow = isReached && nextReached;
                const showTerminalDot = m.isDeparted && isLastReached;

                // Build tooltip body
                const ratingPhrase = rating ? RATING_PHRASES[rating] : null;
                const aboveViewer =
                  !!viewerEff && isAbove(viewerEff.s, viewerEff.e, row.season, row.episode);

                // Tooltip line shape per sidebar_spec_rating_dice_display.md:
                //   - State 1 (reached + rated, no entry) → 2 lines:
                //       SE · @user
                //       rated: <phrase>
                //   - State 2 (reached + entry, with or without rating) → 2-3 lines:
                //       SE · @user
                //       wrote: "Title"
                //       rated: <phrase>  ← only if rated
                //   - State 3 (reached, no rating, no entry) → 1 line:
                //       watched: SE · @user
                //   - State 4 (not reached) → no tooltip at all (wrapper skipped below).
                const hasEntry = !!entry;
                const isStateThree = isReached && !hasEntry && !ratingPhrase;

                // Click-to-adjust-ratings (self column only; viewport-aware).
                // Spec: sidebar_spec_click_to_adjust_ratings.md
                //
                // For self cells:
                //   - state 3 (no rating, no entry):    click → set rating = 1
                //   - state 1 (rating, no entry):       click → rotate rating
                //   - state 2 (rating + entry visible): click → rotate rating
                //   - state 2 (rating + entry off-screen): click → scroll to entry
                //
                // Rating-changing clicks also trigger the bounce + show the
                // canon-red instruction line in the tooltip. Off-screen-entry
                // clicks go to scroll and skip both. Other users' cells keep
                // the existing scroll-to-entry behavior; no instruction line.
                const cellKey = `${row.season}-${row.episode}`;
                const entryVisible = !!entry && !!visibleEntryIds?.has(entry.threadId);
                // Bounce is self-only — gating prevents the row-wide
                // resize bug where every cell in the same (season, episode)
                // row matched the bouncing key and animated together.
                const isBouncingHere = isSelf && bouncingState?.cellKey === cellKey;
                const bouncePhase: "up" | "down" | null = isBouncingHere ? bouncingState!.phase : null;

                // Spec #2: self-column cells with a notification need a
                // first-click-highlights gate. Once the threadId is in
                // firstHighlightedSet (added by V2FriendRoomPage's
                // handleCellClick on the previous click), subsequent clicks
                // fall through to the existing rate-change path, regardless
                // of whether the notification is still present.
                const hasSignal = entry ? !!cellSignals?.[entry.threadId] : false;
                const alreadyHighlighted = entry ? !!firstHighlightedSet?.has(entry.threadId) : false;
                const inHighlightGate = hasSignal && !alreadyHighlighted;

                // Cell click behavior:
                //   - Edit mode + self + reached → rotate rating into
                //     pendingRatings. Bounce. No navigation.
                //   - Edit mode + other cells → navigate as usual (other
                //     members' cells aren't editable).
                //   - Outside edit mode → navigation ONLY. Self cells
                //     route through firstHighlightedSet gate (highlight
                //     first, then continue to highlight on subsequent
                //     clicks). NO rating side effects.
                //
                // The "Click to change this episode's rating." instruction
                // tooltip line shows on every reached cell while edit mode
                // is on (per spec — added in addition to standard tooltip
                // text). Outside edit mode it never shows.
                let clickAction: (() => void) | null = null;
                if (isReached) {
                  if (editMode && isSelf) {
                    // Rating edits are per-episode and don't move the
                    // viewer's attention to a specific entry, so they do
                    // NOT participate in (or reset) the receding-layers
                    // cycle. Click cycles on other cells survive.
                    const target = nextRatingTarget(rating);
                    clickAction = () => {
                      setPendingRatings((prev) => ({ ...prev, [cellKey]: target }));
                      triggerBounce(cellKey);
                    };
                  } else if (isMultiEntry) {
                    // Multi-entry cell: receding-layer cycle. On click,
                    // if the last-highlighted thread is still in the
                    // feed viewport (visibleEntryIds), advance the
                    // cycle by one; else reset to the newest (idx 0).
                    // Per Q3 = Option B, this cell's click resets every
                    // OTHER cell's cycle (we replace the whole map on
                    // each click).
                    clickAction = () => {
                      const prev = cycleStateByCellKey[fullCellKey];
                      const stillVisible =
                        !!prev &&
                        !!visibleEntryIds?.has(prev.lastHighlightedThreadId);
                      const nextIdx = stillVisible
                        ? (prev.idx + 1) % cellEntries.length
                        : 0;
                      const targetThreadId = cellEntries[nextIdx].threadId;
                      setCycleStateByCellKey({
                        [fullCellKey]: { idx: nextIdx, lastHighlightedThreadId: targetThreadId },
                      });
                      onEntryClick(targetThreadId);
                    };
                  } else if (entry) {
                    // Single-entry cell (self or other column): navigate
                    // to the entry. Resets every multi-entry cycle on
                    // the map (Option B) since attention has shifted.
                    clickAction = () => {
                      setCycleStateByCellKey({});
                      onEntryClick(entry.threadId);
                    };
                  }
                }
                // Suppress unused-var warnings for vars only relevant to
                // the old rate-on-click path (still imported for future
                // wiring).
                void inHighlightGate; void entryVisible; void onRateOwnCell;

                // Title truncation: 45 chars + ellipsis. Guarantees the
                // "wrote:" line stays on one visual line regardless of
                // how long the real entry title is.
                const MAX_TITLE = 45;
                const displayTitle =
                  entry && entry.title.length > MAX_TITLE
                    ? entry.title.slice(0, MAX_TITLE) + "…"
                    : entry?.title;

                let entryLine: React.ReactNode = null;
                if (entry) {
                  const titlePart = aboveViewer ? (
                    <span style={{ fontStyle: "italic", color: "#f45028" }}>
                      (title revealed once you catch up)
                    </span>
                  ) : (
                    <span className="editorial" style={{ fontStyle: "italic" }}>
                      &ldquo;{displayTitle}&rdquo;
                    </span>
                  );
                  entryLine = (
                    <span style={{ display: "block", marginTop: 2, whiteSpace: "nowrap" }}>
                      wrote: {titlePart}
                    </span>
                  );
                }

                let ratedLine: React.ReactNode = null;
                if (ratingPhrase) {
                  ratedLine = (
                    <span style={{ display: "block", marginTop: 2, whiteSpace: "nowrap" }}>
                      rated:{" "}
                      <span className="editorial" style={{ fontStyle: "italic" }}>
                        {ratingPhrase}
                      </span>
                    </span>
                  );
                }

                // "Click to change this episode's rating." instruction
                // line — shows on EVERY reached cell while edit mode is
                // on (not just self-column). For non-self cells in edit
                // mode the line still appears even though the cell click
                // navigates rather than rates — the user is in rating-
                // edit mode contextually, and the line is a reminder of
                // what edit mode does. Outside edit mode this line
                // never shows.
                let instructionLine: React.ReactNode = null;
                if (editMode && isReached) {
                  instructionLine = (
                    <span style={{
                      display: "block",
                      marginTop: 6,
                      fontSize: 11,
                      color: "#f45028",
                      whiteSpace: "nowrap",
                    }}>
                      Click to change this episode's rating.
                    </span>
                  );
                }

                // Notification signal for THIS cell's entry (green-over-red,
                // computed by V2FriendRoomPage). Drives the dot + a canon-
                // red tooltip line. Only one signal per cell at a time.
                const signal = entry ? cellSignals?.[entry.threadId] ?? null : null;
                const cellIsNew = entry ? !!isNewMap?.[entry.threadId] : false;
                // Per-cell unique key for hover tracking (spec #4). Cell key
                // alone (season-episode) collides across members; need to
                // include member id for hover uniqueness.
                const fullCellKey = `${m.userId}-${cellKey}`;
                const cellHovered = hoveredCellKey === fullCellKey || hoveredDotKey === fullCellKey;
                let signalLine: React.ReactNode = null;
                if (signal) {
                  const text =
                    signal.kind === "green"
                      ? "There is new writing for you."
                      : "There is new writing in here for you… for when you catch up.";
                  signalLine = (
                    <span style={{
                      display: "block",
                      marginTop: 6,
                      fontSize: 11,
                      color: "#f45028",
                      whiteSpace: "nowrap",
                    }}>
                      {text}
                    </span>
                  );
                }

                const tooltipText = isMultiEntry ? (
                  // Multi-entry receding-layers tooltip (Q1 = option C).
                  // Replaces the standard episode + entry-title lines with
                  // a count + cycle hint. Auxiliary lines (rated, signal,
                  // edit-mode instruction) stay below so notification
                  // context still surfaces.
                  <span>
                    <span style={{ display: "block", whiteSpace: "nowrap" }}>
                      @{m.username} wrote {cellEntries.length} entries on
                      {" "}S{row.season} E{row.episode}.
                    </span>
                    <span style={{ display: "block", marginTop: 2, fontStyle: "italic", whiteSpace: "nowrap" }}>
                      Click to cycle through them.
                    </span>
                    {ratedLine}
                    {signalLine}
                    {instructionLine}
                  </span>
                ) : (
                  <span>
                    <span style={{ display: "block", whiteSpace: "nowrap" }}>
                      {isStateThree && (
                        <span className="editorial" style={{ fontStyle: "italic" }}>
                          watched:{" "}
                        </span>
                      )}
                      S{String(row.season).padStart(2, "0")} E
                      {String(row.episode).padStart(2, "0")} / @{m.username}
                    </span>
                    {entryLine}
                    {ratedLine}
                    {signalLine}
                    {instructionLine}
                  </span>
                );

                const cellDimmed = isDimmed(m.userId);
                return (
                  <div
                    key={m.userId}
                    style={{
                      width: CELL,
                      height: ROW_HEIGHT,
                      position: "relative",
                      // User-filter dim: cells in non-filtered columns
                      // fade out and disable interaction. Matches the
                      // header column treatment so the whole column reads
                      // as one inactive surface.
                      opacity: cellDimmed ? 0.35 : undefined,
                      pointerEvents: cellDimmed ? "none" : undefined,
                      transition: "opacity 180ms ease-out",
                    }}
                  >
                    {!renderEmpty && (() => {
                      // A1 white outline for cells whose entry is new since
                      // the viewer's last room visit. Overrides the default
                      // cell border color; thickness stays 2px to match the
                      // existing cell shape.
                      const cellShape = cellShapeStyle(isReached, !!entry, isSelf, editMode);
                      const newOutlineOverride: React.CSSProperties = cellIsNew && isReached && !!entry
                        ? { border: "2px solid #fff" }
                        : {};

                      // Receding back layers (multi-entry cells only). Each
                      // non-top entry gets a translated, 30%-opacity copy of
                      // the cell shape behind the top layer. Rendered BEFORE
                      // cellInner in DOM order so it stacks underneath
                      // (same z-index, later sibling wins). pointer-events:
                      // none so only the top layer is clickable (Q5).
                      const backLayers = isMultiEntry
                        ? Array.from({ length: cellEntries.length - 1 }).map((_, j) => {
                            // Render from furthest-back (largest offset) to
                            // closest-behind-front, so the deepest layer
                            // paints first.
                            const layerIdx = cellEntries.length - 1 - j;
                            const offset = layerIdx * 4;
                            return (
                              <div
                                key={`back-${layerIdx}`}
                                aria-hidden
                                style={{
                                  ...cellShape,
                                  ...newOutlineOverride,
                                  width: CELL,
                                  height: CELL,
                                  position: "absolute",
                                  left: 0,
                                  top: 0,
                                  transform: `translate(${offset}px, ${offset}px)`,
                                  opacity: 0.3,
                                  pointerEvents: "none",
                                }}
                              />
                            );
                          })
                        : null;
                      const cellInner = (
                        <div
                          onClick={clickAction ?? undefined}
                          onMouseEnter={() => setHoveredCellKey(fullCellKey)}
                          onMouseLeave={() => setHoveredCellKey((prev) => (prev === fullCellKey ? null : prev))}
                          data-rating={rating ?? undefined}
                          style={{
                            width: CELL,
                            height: CELL,
                            cursor: clickAction ? "pointer" : "default",
                            // Transform is applied ONLY during the bounce
                            // (phase 'up' = instant pop; phase 'down' =
                            // animate back). Idle cells have NO transform
                            // property — an unconditional scale(1) would
                            // promote every cell to its own compositing
                            // layer and mis-align the spine below it.
                            ...(bouncePhase === "up"
                              ? { transform: "scale(1.12)", transition: "none" }
                              : bouncePhase === "down"
                              ? { transform: "scale(1)", transition: "transform 150ms ease-out" }
                              : {}),
                            ...cellShape,
                            ...newOutlineOverride,
                          }}
                        >
                          {isReached && rating && (
                            // Pass the CONTENT area size, not the cell's
                            // declared width. theme.ts sets a global
                            // box-sizing: border-box, so the cell's 2px
                            // border eats 4px from the content area
                            // (32 - 2*2 = 28). Without this adjustment,
                            // a size=32 DiceFace overflows the content
                            // area by 2px right + 2px down, visibly
                            // shifting the dice off-center toward the
                            // bottom-right of the visual cell.
                            <DiceFace rating={rating} size={CELL - 4} />
                          )}
                        </div>
                      );
                      // State 4 (not reached, non-departed) renders the cell
                      // shape but skips the tooltip wrap entirely — there's
                      // nothing meaningful to show for an episode the friend
                      // hasn't reached. (Multi-entry implies the author has
                      // reached the episode they wrote on, so isMultiEntry
                      // and !isReached are mutually exclusive — backLayers
                      // are null here.)
                      if (!isReached) {
                        return cellInner;
                      }
                      const front = (
                        <Tooltip
                          text={tooltipText}
                          direction="left"
                          width="auto"
                          portal
                          tooltipStyle={{
                            background: "#fff",
                            color: "#1a3a4a",
                            textAlign: "left",
                            lineHeight: 1.25,
                          }}
                        >
                          {cellInner}
                        </Tooltip>
                      );
                      return (
                        <>
                          {backLayers}
                          {front}
                        </>
                      );
                    })()}

                    {/* Notification dot for this cell's entry, if any.
                        Sits half-overlapping the LEFT edge of the cell,
                        vertically centered. Green-over-red precedence is
                        handled upstream — only one signal per cell.
                        Wrapped in its own Tooltip so hovering the dot
                        directly shows "Turn this notification off." (red
                        only); the cell's standard tooltip continues to show
                        when the user hovers cellInner. */}
                    {signal && entry && (
                      <Tooltip
                        text="Turn this notification off."
                        direction="left"
                        width="auto"
                        portal
                        disabled={signal.kind !== "red"}
                        // Anchor the Tooltip wrapper at the outer cell's
                        // top-left with 0 footprint so the inner dot's
                        // absolute positioning (left:-8, top:CELL/2-8)
                        // still resolves to the cell-relative position.
                        style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}
                        tooltipStyle={{
                          background: "#fff",
                          color: "#f45028",
                          fontSize: 11,
                          fontWeight: 500,
                          textAlign: "left",
                          lineHeight: 1.25,
                        }}
                      >
                        <MapCellDot
                          kind={signal.kind}
                          redCount={signal.redCount}
                          showX={cellHovered && signal.kind === "red"}
                          onDotMouseEnter={() => setHoveredDotKey(fullCellKey)}
                          onDotMouseLeave={() => setHoveredDotKey((prev) => (prev === fullCellKey ? null : prev))}
                          onDismiss={
                            signal.kind === "red" && onDismissRedDot
                              ? () => onDismissRedDot(entry.threadId)
                              : undefined
                          }
                        />
                      </Tooltip>
                    )}

                    {/* Spine segment below the cell — only when both this
                        and the next row's cell are reached. */}
                    {showSpineBelow && (
                      <div
                        style={{
                          position: "absolute",
                          left: CELL / 2 - 1,
                          top: CELL,
                          width: 2,
                          height: GAP_BELOW,
                          background: "var(--dos-border)",
                          opacity: 0.55,
                        }}
                      />
                    )}

                    {/* Terminal dot for departed members — sits in the gap
                        just below their last-reached cell. */}
                    {showTerminalDot && (
                      <Tooltip
                        text={`@${m.username} left the room`}
                        direction="left"
                        portal
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: CELL / 2 - 3,
                            top: CELL + 5,
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "var(--dos-border)",
                            opacity: 0.85,
                          }}
                        />
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>

      {/* All four launchers are portaled to document.body because V2RoomMap
          is mounted inside V2FriendRoomPage's transform: translateX(-144px)
          wrapper. CSS rule: any ancestor with a transform becomes the
          containing block for position:fixed descendants — so without
          portaling, the popovers' fixed-position math (which assumes
          viewport coordinates) gets applied relative to the transformed
          wrapper and lands off-screen. */}
      {launcherMode && nudgeOpenFor && groupId && viewerUserId &&
        createPortal(
          <NudgePopover
            recipientUsername={nudgeOpenFor.recipientUsername}
            recipientId={nudgeOpenFor.recipientId}
            groupId={groupId}
            currentUserId={viewerUserId}
            direction={nudgeOpenFor.direction}
            count={nudgeOpenFor.count}
            anchorRect={nudgeOpenFor.anchorRect}
            anchorMode="from-anchor"
            onClose={() => setNudgeOpenFor(null)}
          />,
          document.body,
        )}

      {launcherMode && askPickerRect && groupId &&
        createPortal(
          <AskTheRoomPicker
            anchorRect={askPickerRect}
            anchorMode="from-anchor"
            onClose={() => setAskPickerRect(null)}
            onSelectPoll={() => {
              setAskPickerRect(null);
              setPollComposerOpen(true);
            }}
            onSelectSikw={() => {
              setAskPickerRect(null);
              setSikwComposerOpen(true);
            }}
          />,
          document.body,
        )}

      {launcherMode && pollComposerOpen && groupId &&
        createPortal(
          <PollComposer
            groupId={groupId}
            onClose={() => setPollComposerOpen(false)}
            onOpened={() => onPollOpened?.()}
          />,
          document.body,
        )}

      {launcherMode && sikwComposerOpen && groupId &&
        createPortal(
          <SIKWComposer
            groupId={groupId}
            progressSeason={viewerProgress?.s ?? 0}
            progressEpisode={viewerProgress?.e ?? 0}
            onClose={() => setSikwComposerOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}

// MapCellDot — 16px circular notification dot that sits half-overlapping
// the left edge of a map cell. Green = visible-new responses (no count,
// pointerEvents: none); Red = own-entry hidden responses (numeric count,
// click dismisses). No drop shadow per spec.
//
// X-on-cell-hover (spec #4): the number→X swap is now driven by the OUTER
// `showX` prop (parent owns cell-hover state) rather than the dot's own
// hover. Dot-specific hover is reported up via onDotMouseEnter/Leave so the
// parent can swap the tooltip text to "Turn this notification off."
function MapCellDot({
  kind,
  redCount,
  onDismiss,
  showX = false,
  onDotMouseEnter,
  onDotMouseLeave,
}: {
  kind: "green" | "red";
  redCount?: number;
  onDismiss?: () => void;
  showX?: boolean;
  onDotMouseEnter?: () => void;
  onDotMouseLeave?: () => void;
}) {
  const isRed = kind === "red";
  const bg = isRed ? "var(--danger)" : "var(--green)";
  return (
    <div
      style={{
        position: "absolute",
        left: -8,
        top: CELL / 2 - 8,
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 800,
        lineHeight: 1,
        cursor: isRed ? "pointer" : "default",
        zIndex: 3,
        pointerEvents: isRed ? "auto" : "none",
      }}
      onMouseEnter={isRed ? onDotMouseEnter : undefined}
      onMouseLeave={isRed ? onDotMouseLeave : undefined}
      onClick={(e) => {
        if (!isRed || !onDismiss) return;
        e.stopPropagation();
        onDismiss();
      }}
    >
      {isRed ? (showX ? "✕" : redCount) : null}
    </div>
  );
}

// Cell shape per state:
//   - reached + entry → filled rounded square (canon green for others;
//     canon dark-blue for the viewer's own column)
//   - reached + no entry → 2px outlined rounded square, transparent
//     (canon-dark-blue outline for the viewer; --dos-border for others)
//   - not reached → 2px dashed circular outline (unchanged regardless of self)
//
// Edit-mode override: when `editMode && isSelf && isReached`, the cell
// goes canon-red fill (regardless of entry/rating state). White dice
// dots on top still render normally for rated cells. Not-reached self
// cells stay dashed-circle (can't rate them).
function cellShapeStyle(isReached: boolean, hasEntry: boolean, isSelf: boolean, editMode: boolean): React.CSSProperties {
  if (editMode && isSelf && isReached) {
    return {
      background: "#f45028",
      border: "2px solid #f45028",
      borderRadius: CELL_RADIUS,
    };
  }
  const filledBg = isSelf ? "#355eb8" : "#7abd8e";
  const outlineColor = isSelf ? "#355eb8" : "var(--dos-border)";
  if (isReached && hasEntry) {
    return {
      background: filledBg,
      border: `2px solid ${filledBg}`,
      borderRadius: CELL_RADIUS,
    };
  }
  if (isReached) {
    return {
      background: "transparent",
      border: `2px solid ${outlineColor}`,
      borderRadius: CELL_RADIUS,
      opacity: 0.7,
    };
  }
  return {
    background: "transparent",
    border: "2px dashed #fff",
    borderRadius: "50%",
    opacity: 0.5,
  };
}
