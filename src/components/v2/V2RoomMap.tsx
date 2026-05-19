import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DoorClosed, DoorOpen } from "lucide-react";
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
}: V2RoomMapProps) {
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
      const entryByKey = new Map<string, V2RoomMapEntry>();
      for (const e of m.entries) entryByKey.set(`${e.s}-${e.e}`, e);
      return { lastReachedIdx, ratingByKey, entryByKey };
    });
  }, [members, rows]);

  const viewerEff = effectiveProgress(viewerProgress);

  return (
    <div
      ref={scrollRef}
      style={{
        overflowY: "auto",
        maxHeight: `calc(100vh - var(--site-header-h) - 100px)`,
        position: "relative",
        // 6px right padding so the rightmost cell's click bounce
        // (scale 1.12 = ~2px overflow each side) doesn't get clipped
        // against the container edge. overflowY:auto implicitly enables
        // overflowX clipping per CSS spec, so adding padding is the
        // cleanest fix that doesn't restructure the scroll container.
        paddingRight: 6,
        WebkitMaskImage:
          "linear-gradient(to bottom, #000 calc(100% - 136px), transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, #000 calc(100% - 136px), transparent 100%)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${SEASON_LABEL_W}px ${EPISODE_LABEL_W}px repeat(${members.length}, ${CELL}px)`,
          columnGap: COL_GAP,
          alignItems: "start",
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
          }}
        >
          {/* Season-label column slot (col 1, 80px wide). Hosts the
              "ask the room" door icon in the sticky header; body rows
              put the Season N label in this same column. */}
          <div
            style={{
              width: SEASON_LABEL_W,
              height: HEADER_HEIGHT,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-start",
              paddingBottom: 8,
              paddingLeft: 8,
            }}
          >
            {launcherMode && (
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
              height: HEADER_HEIGHT,
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
            const isClickable = launcherMode && !isSelfCol && !m.isDeparted;
            return (
              <div
                key={m.userId}
                style={{
                  width: CELL,
                  height: HEADER_HEIGHT,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  title={`@${m.username}`}
                  role={isClickable ? "button" : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                  onClick={
                    isClickable
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
                    isClickable
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
                  style={{
                    // transformOrigin: left bottom — the pivot sits at the
                    // element's pre-rotation bottom-left, which after CCW
                    // rotation becomes the rotated bottom. Anchoring the "@"
                    // there keeps the beginning of the username visible at
                    // the column's bottom; long usernames truncate with
                    // ellipsis at the rotated TOP (the pre-rotation right
                    // edge clipped by maxWidth).
                    position: "absolute",
                    left: CELL / 2 + 8,
                    bottom: 8,
                    transform: "rotate(-90deg)",
                    transformOrigin: "left bottom",
                    whiteSpace: "nowrap",
                    maxWidth: HEADER_HEIGHT - 16,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontSize: 13,
                    fontWeight: 400,
                    color: "#fff",
                    // Clickable headers get the v1 nudge-launcher styling:
                    // italic + dotted underline + pointer. Self + departed
                    // stay plain.
                    fontStyle: isClickable ? "italic" : undefined,
                    borderBottom: isClickable ? "1px dotted #fff" : undefined,
                    cursor: isClickable ? "pointer" : undefined,
                  }}
                >
                  @{m.username}
                </div>
              </div>
            );
          })}
        </div>

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
                      fontStyle: "italic",
                      fontSize: 14,
                      opacity: 0.7,
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
                  opacity: 0.6,
                  fontStyle: "italic",
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
                const entry = mMap.entryByKey.get(rowKey);
                const rating = mMap.ratingByKey.get(rowKey);
                const isSelf = !!viewerUserId && m.userId === viewerUserId;

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

                let clickAction: (() => void) | null = null;
                let showInstruction = false;
                if (isReached) {
                  if (isSelf) {
                    if (entry && !entryVisible) {
                      clickAction = () => onEntryClick(entry.threadId);
                    } else if (onRateOwnCell) {
                      const target = nextRatingTarget(rating);
                      clickAction = () => {
                        onRateOwnCell(row.season, row.episode, target);
                        triggerBounce(cellKey);
                      };
                      showInstruction = true;
                    } else if (entry) {
                      clickAction = () => onEntryClick(entry.threadId);
                    }
                  } else if (entry) {
                    clickAction = () => onEntryClick(entry.threadId);
                  }
                }

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
                    <span style={{ fontStyle: "italic", opacity: 0.85 }}>
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

                let instructionLine: React.ReactNode = null;
                if (showInstruction) {
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

                const tooltipText = (
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
                    {instructionLine}
                  </span>
                );

                return (
                  <div
                    key={m.userId}
                    style={{
                      width: CELL,
                      height: ROW_HEIGHT,
                      position: "relative",
                    }}
                  >
                    {!renderEmpty && (() => {
                      const cellInner = (
                        <div
                          onClick={clickAction ?? undefined}
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
                            ...cellShapeStyle(isReached, !!entry, isSelf),
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
                      // hasn't reached.
                      if (!isReached) {
                        return cellInner;
                      }
                      return (
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
                    })()}

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

// Cell shape per state:
//   - reached + entry → filled rounded square (canon green for others;
//     canon dark-blue for the viewer's own column)
//   - reached + no entry → 2px outlined rounded square, transparent
//     (canon-dark-blue outline for the viewer; --dos-border for others)
//   - not reached → 2px dashed circular outline (unchanged regardless of self)
function cellShapeStyle(isReached: boolean, hasEntry: boolean, isSelf: boolean): React.CSSProperties {
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
