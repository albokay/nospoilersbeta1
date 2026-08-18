/**
 * BrowseRows — the group room's poster shelves (browse-rows arc, 2026-08-17).
 *
 * Streaming-service-style rows of TVMaze posters (no captions — Alborz's
 * mock), under the group's own shelves. Order: "Popular right now:" →
 * "About to start up:" → the curated lists. Purely a REMEMBER-what-to-watch
 * surface — the group's OWN shows (open rooms + proposals) are already on the
 * shelves above, so every row hides them; a show appears in the FIRST row it
 * qualifies for and never twice on the page (Alborz 2026-08-17). Curated rows
 * draw a random pick per DAY (date-seeded — stable across reloads, fresh
 * tomorrow) so a long list stays lively without reshuffling under someone
 * who just proposed from it.
 *
 * Because rows are computed as "the first N candidates not in this group",
 * proposing a show from a row makes it drop out and the next candidate slide
 * in — no separate swap logic. Data: `fetchBrowseAutoRows` (nightly-built
 * table) + `fetchBrowseLists`; both tolerant, so an empty/missing table just
 * renders nothing. Poster-less shows (a brand-new premiere before TVMaze has
 * art) are skipped rather than shown as a blank card.
 *
 * Desktop only (v1). Click → the parent's yellow opt-in modal in its plain
 * "Do you want to watch?" form (see DashboardPage.pickBrowseShow).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CANON } from "../styles/canon";
import { fetchBrowseAutoRows, fetchBrowseLists, type BrowseShow, type BrowseList } from "../lib/db";

const ROW_LEN = 10;          // Alborz 2026-08-17: "start with 10 and see how it feels"
const CARD_W = 196;          // TVMaze medium posters are 210×295 (≈ 0.71)
const CARD_H = 277;
const GAP = 20;
// The WINDOW (Alborz's mock, 2026-08-17): every row scrolls inside one
// centered viewport of the same width, showing exactly 5½ posters at rest —
// the half-card is the cue that there's more. Sky page shows on either side
// (the "frame"), where the arrows sit; the row title's left edge = the
// window's left edge. Positions snap to card boundaries ("locked-in").
const VISIBLE = 5.5;
const WINDOW_W = Math.round(VISIBLE * CARD_W + Math.floor(VISIBLE) * GAP); // 1178
const ARROW_ZONE = 96;       // frame width reserved for each arrow at minimum

type Row = { key: string; title: string; shows: BrowseShow[] };

export default function BrowseRows({
  excludeTvmazeIds,
  onPick,
}: {
  /** TVMaze ids of the group's own shows (open rooms + proposals) — hidden everywhere. */
  excludeTvmazeIds: Set<number>;
  onPick: (show: BrowseShow) => void;
}) {
  const [auto, setAuto] = useState<{ startingUp: BrowseShow[]; popular: BrowseShow[] } | null>(null);
  const [lists, setLists] = useState<BrowseList[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBrowseAutoRows(), fetchBrowseLists()]).then(([a, l]) => {
      if (cancelled) return;
      setAuto(a);
      setLists(l);
    }).catch(() => { /* tolerant — rows just don't render */ });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (!auto) return [];
    const seen = new Set<number>();
    const take = (cands: BrowseShow[]): BrowseShow[] => {
      const out: BrowseShow[] = [];
      for (const s of cands) {
        if (out.length >= ROW_LEN) break;
        if (!s.imageUrl) continue;
        if (excludeTvmazeIds.has(s.tvmazeId) || seen.has(s.tvmazeId)) continue;
        seen.add(s.tvmazeId);
        out.push(s);
      }
      return out;
    };
    const today = new Date().toISOString().slice(0, 10);
    // Popular leads (Alborz 2026-08-17; was starting-up first).
    const built: Row[] = [
      { key: "popular", title: "Popular right now:", shows: take(auto.popular) },
      { key: "starting_up", title: "About to start up:", shows: take(auto.startingUp) },
      ...lists.map((l) => ({ key: l.id, title: l.title, shows: take(seededShuffle(l.shows, `${today}|${l.id}`)) })),
    ];
    return built.filter((r) => r.shows.length > 0);
  }, [auto, lists, excludeTvmazeIds]);

  if (rows.length === 0) return null;
  return (
    // 8px top (was 48 — Alborz 2026-08-17: 40px closer to the group's last button).
    <div style={{ padding: "8px 0 40px" }}>
      {rows.map((r) => <PosterRow key={r.key} row={r} onPick={onPick} />)}
    </div>
  );
}

function PosterRow({ row, onPick }: { row: Row; onPick: (s: BrowseShow) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  function measure() {
    const el = scroller.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }
  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.shows.length]);
  function nudge(dir: -1 | 1) {
    const el = scroller.current;
    if (!el) return;
    // One poster per press (Alborz 2026-08-17); snap keeps the landing
    // position on a card boundary.
    el.scrollBy({ left: dir * (CARD_W + GAP), behavior: "smooth" });
  }
  return (
    // Window centered on the page; the frame on either side holds the arrows.
    <div style={windowWrap}>
      <div style={rowTitle}>{row.title}</div>
      <div style={{ position: "relative" }}>
        <div ref={scroller} onScroll={measure} style={scrollerStyle} className="browse-scroller">
          {row.shows.map((s) => (
            <button key={s.tvmazeId} onClick={() => onPick(s)} title={s.name} aria-label={s.name} style={card}>
              <img src={s.imageUrl ?? undefined} alt="" loading="lazy" draggable={false} style={poster} />
            </button>
          ))}
        </div>
        {canLeft && (
          <button aria-label="scroll left" onClick={() => nudge(-1)} style={{ ...arrow, right: "100%", marginRight: 16 }}>
            <ChevronLeft size={64} strokeWidth={1.4} />
          </button>
        )}
        {canRight && (
          <button aria-label="scroll right" onClick={() => nudge(1)} style={{ ...arrow, left: "100%", marginLeft: 16 }}>
            <ChevronRight size={64} strokeWidth={1.4} />
          </button>
        )}
      </div>
      <style>{`.browse-scroller::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}

// ── Date-seeded shuffle (mulberry32 over a string hash) — the same list +
//    same day always yields the same order; tomorrow it's fresh. ────────────
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const rand = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The window: fixed width (5½ posters), centered, never wider than the page
// minus room for both arrows — on a narrower screen the window shrinks and
// simply shows fewer posters (cards keep their size).
const windowWrap: React.CSSProperties = {
  width: WINDOW_W, maxWidth: `calc(100vw - ${2 * ARROW_ZONE}px)`, margin: "0 auto 36px",
  position: "relative",
};
const rowTitle: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 17, color: CANON.cream,
  marginBottom: 12,
};
const scrollerStyle: React.CSSProperties = {
  display: "flex", gap: GAP, overflowX: "auto", scrollSnapType: "x mandatory",
  // Vertical breathing room only — the row's left edge IS the window's edge.
  padding: "4px 0 8px", scrollbarWidth: "none", msOverflowStyle: "none",
};
const card: React.CSSProperties = {
  flex: "0 0 auto", width: CARD_W, height: CARD_H, padding: 0, border: "none",
  borderRadius: 4, overflow: "hidden", cursor: "pointer", background: "rgba(253,248,236,0.12)",
  scrollSnapAlign: "start",
};
const poster: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" };
// Arrows live in the Sky frame OUTSIDE the window (positioned off the
// scroller's edges), vertically centered on the posters.
const arrow: React.CSSProperties = {
  position: "absolute", top: "50%", transform: "translateY(-50%)", zIndex: 2,
  border: "none", background: "transparent", color: CANON.cream, cursor: "pointer", padding: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
};
