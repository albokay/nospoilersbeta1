/**
 * MobileBrowseRows — the mobile group room's poster shelves (browse-rows
 * arc, mobile mirror 2026-08-17). SAME rows and rules as desktop — order,
 * hide-the-group's-shows, one appearance per show page-wide, date-seeded
 * curated picks, 10 per row — via the shared `useBrowseRows` hook in
 * src/components/BrowseRows.tsx. Only the physical rendering differs:
 * touch-swipe strips (no arrows), posters flush with the page's 16px content
 * edge and running off the right screen edge (~2½ visible on an iPhone, a
 * bit more on wider phones — the cut-off card is the "there's more" cue),
 * snapping to card boundaries. Tap → the room's yellow sheet in its plain
 * "Do you want to watch?" form (MobileGroupRoom.pickBrowseShow); a yes
 * proposes + closes and the poster drops out of its row.
 */
import React from "react";
import { CANON } from "../styles/canon";
import { useBrowseRows } from "../components/BrowseRows";
import type { BrowseShow } from "../lib/db";

const CARD_W = 128;          // ≈ 0.71 poster ratio, like desktop's 196×277
const CARD_H = 181;
const GAP = 12;
const EDGE = 16;             // = the mobile page's content padding

export default function MobileBrowseRows({
  excludeTvmazeIds,
  onPick,
}: {
  excludeTvmazeIds: Set<number>;
  onPick: (show: BrowseShow) => void;
}) {
  const rows = useBrowseRows(excludeTvmazeIds);
  if (rows.length === 0) return null;
  return (
    <div style={{ padding: "8px 0 24px" }}>
      {rows.map((r) => (
        <div key={r.key} style={{ marginBottom: 26 }}>
          <div style={rowTitle}>{r.title}</div>
          <div style={strip} className="m-browse-strip">
            {r.shows.map((s) => (
              <button key={s.tvmazeId} onClick={() => onPick(s)} title={s.name} aria-label={s.name} style={card}>
                <img src={s.imageUrl ?? undefined} alt="" loading="lazy" draggable={false} style={poster} />
              </button>
            ))}
          </div>
        </div>
      ))}
      <style>{`.m-browse-strip::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}

const rowTitle: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 15, color: CANON.cream,
  padding: `0 ${EDGE}px`, marginBottom: 10,
};
// Full-bleed strip: the first poster sits on the content edge, the last one
// gets the same edge as trailing room; snap lands each poster on that edge.
const strip: React.CSSProperties = {
  display: "flex", gap: GAP, overflowX: "auto", WebkitOverflowScrolling: "touch",
  scrollSnapType: "x mandatory", scrollPaddingLeft: EDGE,
  padding: `2px ${EDGE}px 6px`, scrollbarWidth: "none", msOverflowStyle: "none",
  overscrollBehaviorX: "contain",
};
const card: React.CSSProperties = {
  flex: "0 0 auto", width: CARD_W, height: CARD_H, padding: 0, border: "none",
  borderRadius: 4, overflow: "hidden", cursor: "pointer", background: "rgba(253,248,236,0.12)",
  scrollSnapAlign: "start", WebkitTapHighlightColor: "transparent",
};
const poster: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" };
