/**
 * TSP onboarding demo modal (spec §2–§8). A once-only guided tour of a sample
 * show room, shown after signup, before the search dashboard. Fully in-memory:
 * everything comes from the §6/§7 fixture and all mutations live in local
 * state — no DB. Reuses the real room components (V2RoomFeed, V2RoomMap,
 * OneSelectProgress) in demo/controlled mode. The parent owns the once-only
 * flag; this component just renders + calls onClose on dismiss.
 *
 * Under the editorial skin (Alborz 2026-10-13) the sample room inside IS the
 * editorial room: the folder tab and the band with the numbers picker, the
 * letters as the feed's editorial entries (Sidebar's guide letters always
 * open on its paper), the season map in ink with its legend. Letters only, as the rooms are now — the fixture's
 * responses stay in the fixture for a possible return (his call); the
 * classic tour still shows them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../lib/auth";
import V2RoomFeed, { type V2RoomFeedHandle, type V2RoomFeedEntry } from "./v2/V2RoomFeed";
import V2RoomMap, { type V2RoomMapMember, type V2RoomMapRating } from "./v2/V2RoomMap";
import OneSelectProgress from "./OneSelectProgress";
import type { ProgressEntry } from "../types";
import {
  TSP_DEMO_SHOW, TSP_EPISODE_COUNT,
  tspDemoFeedEntries, tspDemoFeedEntriesMobile, tspDemoReplies, tspDemoSeedMembers,
} from "../lib/tspDemoFixture";
import { CANON } from "../styles/canon";
import { useEditorial } from "../lib/skin";
import { E } from "../styles/editorial";
import { INK_BLOCK_M, MapLegend } from "./editorial/MapNotes";
import { SectionHead } from "./editorial/Chrome";
import { FolderTabs, RoomBand, MapButton } from "./editorial/ShowRoom";
import { NumbersPicker } from "./editorial/GroupRoom";
import { CornerTab } from "./editorial/Chrome";
import { BottomSheet } from "./editorial/Overlays";
import { Block } from "./editorial/Onboarding";

const CREAM_BG = CANON.cream;
const INK_SOFT = "#5a4d3a";
const LORA = '"Lora", Georgia, serif';
const C = { green: CANON.personal, sky: CANON.friend, cream: CANON.cream, midnight: CANON.dark };

export default function TSPDemoModal({ onClose, reentry, mobile = false }: {
  onClose: () => void;
  /** The phone's tour (Alborz 2026-10-24; the mockups on the canvas): a
   *  full-screen page in the phone room's idiom inside an alert-red frame
   *  pinned to the screen — the identity corner is the way out, "A quick
   *  tour" in Lora over "of The Sidebar Protocol" in mono, the green band
   *  with the numbers picker, Season map as the phone's sheet, the letters
   *  column, "back to your room →" docked at the foot. Editorial only. */
  mobile?: boolean;
  /** Help-system arc CP3: opened from the show room's "how does this room
   *  work?" button (vs the original post-signup flow) — the exit button
   *  sends the reader back to their room instead of "find a show". The
   *  tour's letters are the same either way (Alborz 2026-10-13). */
  reentry?: boolean;
}) {
  const { user, profile } = useAuth();
  // The editorial skin: the tour's card as the bible's dialog — square with
  // the stack shadow, the eyebrow in mono, the title in Lora ink, the exit as
  // the ink block — and the editorial room inside (2026-10-13).
  const editorial = useEditorial();
  const feedRef = useRef<V2RoomFeedHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Local state — discarded on close (spec §8).
  const [selectedEpisode, setSelectedEpisode] = useState(0); // 0 = haven't started
  const [reachedE6, setReachedE6] = useState(false);
  const [userRatings, setUserRatings] = useState<V2RoomMapRating[]>([]);

  // The reused feed/map expect the group-context (sky) palette. Restore-aware:
  // the show room (re-entry host) sets this class itself — only remove on
  // close if WE added it, or closing the tour would strip the host page's
  // palette out from under it.
  useEffect(() => {
    const had = document.body.classList.contains("group-context");
    document.body.classList.add("group-context");
    return () => { if (!had) document.body.classList.remove("group-context"); };
  }, []);
  // The phone: the strip under the page (the home-indicator band in the
  // home-screen app, the ground behind Safari's bar) is the document's own
  // background, so while the tour is up it takes the frame's red (Alborz
  // 2026-10-24); the page's colour returns on close.
  useEffect(() => {
    if (!mobile) return;
    const root = document.documentElement, body = document.body;
    const prev = [root.style.backgroundColor, body.style.backgroundColor];
    root.style.backgroundColor = E.color.alert;
    body.style.backgroundColor = E.color.alert;
    return () => { root.style.backgroundColor = prev[0]; body.style.backgroundColor = prev[1]; };
  }, [mobile]);

  // Guide posts appear EXPANDED the first time their episode is reached (still
  // collapsible afterward; single-expansion quietly collapses the prior card).
  // Episode 0's guide opens via initialExpandedThreadId, so seed the set with 0.
  const autoExpandedGuidesRef = useRef<Set<number>>(new Set([0]));

  // On a progress change, scroll the feed back to the top so the newly-revealed
  // guide entry (newest in its episode) is noticed even if the user had scrolled
  // down — and auto-expand that episode's guide on its first appearance.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    if (!autoExpandedGuidesRef.current.has(selectedEpisode)) {
      autoExpandedGuidesRef.current.add(selectedEpisode);
      feedRef.current?.expandEntry(`tsp-gate-${selectedEpisode}`);
    }
    // The feed's expansion scrolls its container to the letter a beat
    // later; on the phone that pushed the head off the top at open
    // (Alborz 2026-10-24). Come back to the top once it has.
    if (!mobile) return;
    const t = window.setTimeout(() => scrollRef.current?.scrollTo({ top: 0 }), 120);
    return () => window.clearTimeout(t);
  }, [selectedEpisode]); // eslint-disable-line react-hooks/exhaustive-deps

  const allEntries = mobile ? tspDemoFeedEntriesMobile : tspDemoFeedEntries;
  const [mapOpen, setMapOpen] = useState(false);

  // Gate (spec §5): visible iff episode <= selectedEpisode (episode 0 always
  // visible). Evaluated on local state — never the live spoiler engine.
  const gatedEntries = useMemo(
    () => allEntries.filter((e) => e.e <= selectedEpisode),
    [allEntries, selectedEpisode],
  );
  // Pass the FULL reply set; V2RoomFeed's demo render gates per-reply against
  // viewerProgress, showing ahead-of-progress replies as stubs (reply gating).

  // The editorial tour's stream (2026-10-13): the same gate as the classic
  // tour — a letter appears once you reach its episode (his call: a first
  // cut showed the letters ahead as sealed lines; the tour's sequence of
  // letters being published as you advance is the point) — newest episode
  // first with Sidebar's guide letter leading its episode (the feed's own
  // order). Response counts are zeroed: letters only.
  const editorialEntries = useMemo<V2RoomFeedEntry[]>(() => gatedEntries
    .slice()
    .sort((a, b) => (b.e - a.e) || (b.updatedAt - a.updatedAt))
    .map((e) => ({ ...e, replyCount: 0 })), [gatedEntries]);

  const userProgress: ProgressEntry = selectedEpisode > 0
    ? { s: 1, e: selectedEpisode, highestS: 1, highestE: selectedEpisode }
    : { s: 0, e: 0 };

  // Map: three fixed seed columns + the viewer's own growing column (spec §7).
  const mapMembers: V2RoomMapMember[] = useMemo(() => [
    ...tspDemoSeedMembers,
    {
      userId: user?.id ?? "tsp-demo-you",
      username: profile?.username ?? "you",
      isDeparted: false,
      progress: userProgress,
      ratings: userRatings,
      entries: [],
    },
  ], [user?.id, profile?.username, selectedEpisode, userRatings]);

  function pickEpisode(v: { s: number; e: number }) {
    const ep = v.s === 0 ? 0 : v.e;
    setSelectedEpisode(ep);
    if (ep >= TSP_EPISODE_COUNT) setReachedE6(true);
  }

  // Map rating edits → local state only (no DB, no rating-capture modal, §8).
  function applyRating(s: number, e: number, rating: number | null) {
    setUserRatings((prev) => {
      const rest = prev.filter((r) => !(r.s === s && r.e === e));
      return rating === null ? rest : [...rest, { s, e, rating }];
    });
  }

  const pickerValue = selectedEpisode > 0 ? { s: 1, e: selectedEpisode } : { s: 0, e: 0 };
  const map = (
    <V2RoomMap
      editorial={editorial}
      mobile={mobile}
      members={mapMembers}
      seasons={TSP_DEMO_SHOW.seasons}
      viewerProgress={userProgress}
      viewerUserId={user?.id ?? "tsp-demo-you"}
      onEntryClick={(tid) => { if (mobile) setMapOpen(false); feedRef.current?.scrollToEntry(tid); }}
      onRateOwnCell={applyRating}
      onCommitRatings={async (changes) => { changes.forEach((c) => applyRating(c.s, c.e, c.rating)); return { ok: true }; }}
    />
  );

  if (editorial && mobile) {
    const FRAME = 8;
    // The frame's inner corners follow the phone's screen (his note): on a
    // rounded screen (a safe-area inset at the top) the cream page takes a
    // radius just inside the device's own; a square screen or a browser
    // tab (inset 0) stays square.
    const corner = `min(40px, env(safe-area-inset-top, 0px))`;
    return createPortal(
      <div role="dialog" aria-modal="true" aria-label="A quick tour of The Sidebar Protocol" style={{ position: "fixed", inset: 0, zIndex: 1000, background: E.color.alert }}>
        {/* The page stops ABOVE the home-indicator band (the screen's bottom
            inset), so that band is the frame's red, not the page's cream
            (Alborz 2026-10-24: it stayed cream — the page ran under it). */}
        <div style={{ position: "absolute", top: FRAME, left: FRAME, right: FRAME, bottom: `calc(${FRAME}px + ${E.safe.bottom})`, background: E.color.cream, color: E.color.ink, fontFamily: E.font.interface, overflow: "hidden", borderRadius: corner }}>
          <div ref={scrollRef} style={{ position: "absolute", inset: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overflowX: "clip" }}>
            <CornerTab kind="back" label="Back to your room" title="Back to your room" onClick={onClose} />
            <div style={{ padding: `${E.safe.plus(E.measure.phone.titleTop)} ${E.space.gutter}px 0` }}>
              <h1 style={{ margin: 0, fontFamily: E.font.display, fontWeight: 700, fontSize: 34, lineHeight: 1.05, letterSpacing: "-0.01em" }}>A quick tour</h1>
              <div style={{ ...E.type.label11, color: E.color.inkMuted, marginTop: 8 }}>of The Sidebar Protocol</div>
            </div>
            <div style={{ marginTop: 18 }}>
              <RoomBand tab="friend">
                <NumbersPicker show={TSP_DEMO_SHOW} value={pickerValue} onChange={pickEpisode} />
              </RoomBand>
            </div>
            <div style={{ padding: `14px ${E.space.gutter}px 0` }}><MapButton onClick={() => setMapOpen(true)} /></div>
            <div style={{ padding: `8px ${E.space.gutter}px 120px` }}>
              <V2RoomFeed
                ref={feedRef}
                entries={editorialEntries}
                seasons={TSP_DEMO_SHOW.seasons}
                viewerProgress={userProgress}
                userId={user?.id ?? null}
                sortOrder="desc"
                preserveOrder
                editorial
                mobileIdiom
                demoMode
                responsesOff
                scrollContainerRef={scrollRef}
                initialExpandedThreadId="tsp-gate-0"
              />
            </div>
          </div>
          {/* The exit, docked at the foot inside the frame. */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: `12px ${E.space.gutter}px 20px`, background: `linear-gradient(to bottom, rgba(254,248,234,0), ${E.color.cream} 30%)` }}>
            <Block onClick={onClose} style={{ height: 54 }}>{reentry ? "back to your room →" : "start finding shows →"}</Block>
          </div>
        </div>
        {mapOpen && (
          <BottomSheet onClose={() => setMapOpen(false)} title="Season map">
            <div style={{ ...E.type.note13, color: E.color.inkMuted }}>A row is an episode, a column is a friend. Tap a cell to open its letter.</div>
            <div style={{ marginTop: 14 }}>{map}</div>
            <div style={{ marginTop: 14 }}><MapLegend /></div>
          </BottomSheet>
        )}
      </div>,
      document.body,
    );
  }

  return (
    // Clicking the dim outside the tour card exits, same as the button
    // (Alborz 2026-08-14).
    <div role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, background: editorial ? E.color.veil : "rgba(0,0,0,0.2)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      {/* Card: fixed header + footer, only the feed/map scroll between them so
          the map and the exit control stay put (sticky), spec tweak. */}
      <div style={{
        position: "relative", width: "85vw", height: "90vh", background: CREAM_BG,
        borderRadius: editorial ? 0 : 24, boxShadow: editorial ? E.shadow.cardStack : "0 12px 36px rgba(0,0,0,0.25)", border: editorial ? `1px solid ${E.color.ink}` : undefined, overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header chrome — centered eyebrow + Lora title (no dropdown here, §2). */}
        <div style={{ flex: "0 0 auto", padding: "28px 36px 16px", textAlign: "center" }}>
          <div style={editorial ? { ...E.type.label11, color: E.color.inkMuted } : { fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: INK_SOFT }}>
            a quick tour of a show room
          </div>
          <h1 style={editorial ? { ...E.type.hero36, color: E.color.ink, margin: "8px 0 0" } : { fontFamily: LORA, fontWeight: 700, fontSize: 38, color: C.midnight, margin: "6px 0 0" }}>
            The Sidebar Protocol
          </h1>
        </div>

        {editorial ? (
          // ── The editorial room (2026-10-13): the folder tab and the green
          //    band with the numbers picker pinned at the top (the tour's one
          //    control; the band runs from the letters column's left edge to
          //    the card's right edge, as it runs off the window in a real
          //    room), then the letters column and the map rail scrolling
          //    together, the map sticky. ──
          <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", color: E.color.ink }}>
            <div style={{ flex: "0 0 auto", marginLeft: `max(24px, calc(50% - ${E.measure.desktop.wide / 2}px))`, marginTop: 8 }}>
              <FolderTabs width={E.measure.desktop.letters} tabs={["friend"]} active="friend" onChange={() => {}} />
              <RoomBand tab="friend">
                <NumbersPicker show={TSP_DEMO_SHOW} value={pickerValue} onChange={pickEpisode} />
              </RoomBand>
            </div>
            <div ref={scrollRef} style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
              <div style={{ maxWidth: E.measure.desktop.wide, boxSizing: "content-box", margin: "24px auto 0", padding: "0 24px", display: "flex", gap: E.measure.desktop.railGap, alignItems: "flex-start" }}>
                <div style={{ flex: `0 1 ${E.measure.desktop.letters}px`, minWidth: 0, paddingBottom: 48 }}>
                  <V2RoomFeed
                    ref={feedRef}
                    entries={editorialEntries}
                    seasons={TSP_DEMO_SHOW.seasons}
                    viewerProgress={userProgress}
                    userId={user?.id ?? null}
                    sortOrder="desc"
                    preserveOrder
                    editorial
                    demoMode
                    responsesOff
                    scrollContainerRef={scrollRef}
                    // Expand the first ("haven't started") guide letter on open so
                    // people read the full welcome + instructions.
                    initialExpandedThreadId="tsp-gate-0"
                  />
                </div>
                <div style={{ flex: `0 0 ${E.measure.desktop.rail}px`, position: "sticky", top: 0, alignSelf: "flex-start", display: "flex", flexDirection: "column", paddingBottom: 24 }}>
                  <SectionHead right={<span style={{ color: E.color.inkMuted }}>Click a cell to open its letter</span>}>Season map</SectionHead>
                  {map}
                  <MapLegend />
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Room surface — sky panel, fills the middle. Dropdown pinned at its
          // top (real in-room position, §2/§5); only the feed/map scroll.
          <div style={{ flex: "1 1 auto", minHeight: 0, margin: "0 64px", background: C.sky, borderRadius: 16, padding: "16px 20px 0", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <OneSelectProgress
                show={TSP_DEMO_SHOW}
                value={pickerValue}
                allowZero
                forceZeroOption
                requireConfirm={false}
                onChangeSelected={pickEpisode}
                onConfirm={() => {}}
              />
            </div>

            {/* Scroll area: the feed scrolls; the map sticks to the top. */}
            <div ref={scrollRef} style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", display: "flex", gap: 48, justifyContent: "center", alignItems: "flex-start", paddingBottom: 24 }}>
              <div style={{ flex: "1 1 672px", maxWidth: 672 }}>
                <V2RoomFeed
                  ref={feedRef}
                  entries={gatedEntries}
                  viewerProgress={userProgress}
                  userId={user?.id ?? null}
                  sortOrder="desc"
                  demoMode
                  demoReplies={tspDemoReplies}
                  scrollContainerRef={scrollRef}
                  // Expand the first ("haven't started") guide entry on open so
                  // people read the full welcome + instructions.
                  initialExpandedThreadId="tsp-gate-0"
                />
              </div>
              <div style={{ flex: "0 0 auto", position: "sticky", top: 0, alignSelf: "flex-start" }}>
                {map}
              </div>
            </div>
          </div>
        )}

        {/* Footer: single exit control, fixed (doesn't scroll). One state
            (Alborz 2026-08-01): the tour is an opt-in room feature now, so
            the pre-E6 "skip the tour" ghost state is retired — the exit is
            always the green forward-framed button. (reachedE6 still tracks
            scroll for the fixture; only the button stopped reading it.) The
            room's entry is the only live one (2026-10-13), so "back to your
            room" is the label people see; ?tspdemo=1 keeps the old one. */}
        <div style={{ flex: "0 0 auto", padding: "14px 28px", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={editorial ? INK_BLOCK_M : {
              background: C.green,
              color: CANON.cream,
              border: `2px solid ${C.green}`,
              borderRadius: 999, padding: "11px 22px", fontWeight: 700, fontSize: 14,
              cursor: "pointer", fontFamily: '"Inter", sans-serif',
            }}
          >
            {reentry ? "back to your room →" : "start finding shows →"}
          </button>
        </div>
      </div>
    </div>
  );
}
