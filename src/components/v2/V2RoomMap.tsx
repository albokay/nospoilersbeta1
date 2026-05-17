import React, { useEffect, useMemo, useRef, useState } from "react";
import Tooltip from "../Tooltip";
import { effectiveProgress } from "../../lib/utils";
import type { ProgressEntry } from "../../types";
import DiceFace from "./DiceFace";

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
  /** Fires when a cell with an entry is clicked. */
  onEntryClick: (threadId: string) => void;
  /** Fires when the viewer clicks one of their own cells in a way that
      changes the rating. Caller persists + updates state. State 3 first
      click sends rating=1; state 1 and state 2 (when entry visible) send
      the next rotation value (current+1, wrapping 6→1). */
  onRateOwnCell?: (season: number, episode: number, newRating: number) => void;
};

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
  onEntryClick,
  onRateOwnCell,
}: V2RoomMapProps) {
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

  // Next rating in the 1..6 rotation with wrap.
  const nextRating = (cur: number): number => (cur >= 6 ? 1 : cur + 1);
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
          <div />
          <div /> {/* episode-label column placeholder */}
          {members.map((m) => (
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
                }}
              >
                @{m.username}
              </div>
            </div>
          ))}
          <div />
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
                      both sides. */}
                  <div style={{ height: GAP_BELOW * 2 }} />
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
                  <div style={{ height: GAP_BELOW * 2 }} />
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
                      const target = rating ? nextRating(rating) : 1;
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
