import React, { useEffect, useMemo, useRef } from "react";
import Tooltip from "../Tooltip";
import { effectiveProgress } from "../../lib/utils";
import type { ProgressEntry } from "../../types";

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

// Rating phrase copy — per spec §"The rating system"
const RATING_PHRASES: Record<number, string> = {
  1: "Woah!",
  2: "Things are cooking.",
  3: "It was fine.",
  4: "Losing me.",
  5: "Nope.",
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
  /** Fires when a cell with an entry is clicked. */
  onEntryClick: (threadId: string) => void;
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
  onEntryClick,
}: V2RoomMapProps) {
  const rows = useMemo(() => flattenSeasons(seasons), [seasons]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Initial scroll: center the viewer's effective-progress row in the scroll
  // container on first mount. No animation.
  useEffect(() => {
    const eff = effectiveProgress(viewerProgress);
    if (!eff || !scrollRef.current) return;
    const targetIdx = rows.findIndex((r) => r.season === eff.s && r.episode === eff.e);
    if (targetIdx < 0) return;
    const el = scrollRef.current;
    const targetY = targetIdx * ROW_HEIGHT;
    const center = targetY - (el.clientHeight - HEADER_HEIGHT) / 2 + CELL / 2;
    el.scrollTop = Math.max(0, center);
    // Run once on mount only — viewer doesn't expect a re-scroll on every
    // progress change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        WebkitMaskImage:
          "linear-gradient(to bottom, #000 calc(100% - 136px), transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, #000 calc(100% - 136px), transparent 100%)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${SEASON_LABEL_W}px repeat(${members.length}, ${CELL}px) ${EPISODE_LABEL_W}px`,
          columnGap: COL_GAP,
          alignItems: "start",
        }}
      >
        {/* ── Sticky username header row ───────────────────────────────── */}
        <div
          style={{
            gridColumn: "1 / -1",
            display: "grid",
            gridTemplateColumns: `${SEASON_LABEL_W}px repeat(${members.length}, ${CELL}px) ${EPISODE_LABEL_W}px`,
            columnGap: COL_GAP,
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: "var(--dos-bg)",
            paddingBottom: 8,
          }}
        >
          <div />
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
                  {/* Season-break spacer: GAP_BELOW of extra space before a
                      new season so cells from different seasons read as
                      visually separated. Spine continues through the break
                      for members reached on both sides. */}
                  <div style={{ height: GAP_BELOW }} />
                  {members.map((m, mIdx) => {
                    const mMap = memberMaps[mIdx];
                    const prevReached = rowIdx - 1 <= mMap.lastReachedIdx;
                    const thisReached = rowIdx <= mMap.lastReachedIdx;
                    const drawSpine = prevReached && thisReached;
                    return (
                      <div
                        key={m.userId}
                        style={{ width: CELL, height: GAP_BELOW, position: "relative" }}
                      >
                        {drawSpine && (
                          <div
                            style={{
                              position: "absolute",
                              left: CELL / 2 - 1,
                              top: 0,
                              width: 2,
                              height: GAP_BELOW,
                              background: "var(--dos-border)",
                              opacity: 0.55,
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                  <div style={{ height: GAP_BELOW }} />
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

              {/* One cell per member */}
              {members.map((m, mIdx) => {
                const mMap = memberMaps[mIdx];
                const isReached = rowIdx <= mMap.lastReachedIdx;
                const isLastReached = rowIdx === mMap.lastReachedIdx;
                const entry = mMap.entryByKey.get(rowKey);
                const rating = mMap.ratingByKey.get(rowKey);

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

                let entryLine: React.ReactNode = null;
                if (entry) {
                  entryLine = aboveViewer ? (
                    <span style={{ display: "block", fontStyle: "italic", marginTop: 4, opacity: 0.85 }}>
                      (title revealed once you catch up)
                    </span>
                  ) : (
                    <span
                      className="editorial"
                      style={{ display: "block", fontStyle: "italic", marginTop: 4 }}
                    >
                      &ldquo;{entry.title}&rdquo;
                    </span>
                  );
                }

                const tooltipText = (
                  <span>
                    S
                    {String(row.season).padStart(2, "0")} E
                    {String(row.episode).padStart(2, "0")} · @{m.username}
                    {ratingPhrase && <> — {ratingPhrase}</>}
                    {entryLine}
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
                    {!renderEmpty && (
                      <Tooltip
                        text={tooltipText}
                        direction="left"
                        width={260}
                        portal
                      >
                        <div
                          onClick={() => {
                            if (entry) onEntryClick(entry.threadId);
                          }}
                          style={{
                            width: CELL,
                            height: CELL,
                            cursor: entry ? "pointer" : "default",
                            ...cellShapeStyle(isReached, !!entry),
                          }}
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

              {/* Episode label on the right */}
              <div
                style={{
                  height: ROW_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  paddingLeft: 4,
                  fontSize: 12,
                  opacity: 0.6,
                  fontStyle: "italic",
                  color: "#fff",
                }}
              >
                e{row.episode}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Cell shape per state:
//   - reached + entry → filled green rounded square (canon green #7abd8e)
//   - reached + no entry → 2px outlined rounded square, transparent
//   - not reached → 2px dashed circular outline
function cellShapeStyle(isReached: boolean, hasEntry: boolean): React.CSSProperties {
  if (isReached && hasEntry) {
    return {
      background: "#7abd8e",
      border: "2px solid #7abd8e",
      borderRadius: CELL_RADIUS,
    };
  }
  if (isReached) {
    return {
      background: "transparent",
      border: "2px solid var(--dos-border)",
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
