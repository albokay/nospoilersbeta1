/**
 * TSP onboarding demo modal (spec §2–§8). A once-only guided tour of a sample
 * show room, shown after signup, before the search dashboard. Fully in-memory:
 * everything comes from the §6/§7 fixture and all mutations live in local
 * state — no DB. Reuses the real room components (V2RoomFeed, V2RoomMap,
 * OneSelectProgress) in demo/controlled mode. The parent owns the once-only
 * flag; this component just renders + calls onClose on dismiss.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import V2RoomFeed, { type V2RoomFeedHandle } from "./v2/V2RoomFeed";
import V2RoomMap, { type V2RoomMapMember, type V2RoomMapRating } from "./v2/V2RoomMap";
import OneSelectProgress from "./OneSelectProgress";
import type { ProgressEntry, Reply } from "../types";
import {
  TSP_DEMO_SHOW, TSP_EPISODE_COUNT,
  tspDemoFeedEntries, tspDemoReplies, tspDemoSeedMembers,
} from "../lib/tspDemoFixture";

const CREAM_BG = "#fef8ea";
const INK_SOFT = "#5a4d3a";
const RULE = "rgba(43, 36, 24, 0.32)";
const LORA = '"Lora", Georgia, serif';
const C = { green: "#7abd8e", sky: "#adc8d7", cream: "#fef8ea", midnight: "#1a3a4a" };

export default function TSPDemoModal({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const feedRef = useRef<V2RoomFeedHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Local state — discarded on close (spec §8).
  const [selectedEpisode, setSelectedEpisode] = useState(0); // 0 = haven't started
  const [reachedE6, setReachedE6] = useState(false);
  const [userRatings, setUserRatings] = useState<V2RoomMapRating[]>([]);

  // The reused feed/map expect the group-context (sky) palette.
  useEffect(() => {
    document.body.classList.add("group-context");
    return () => { document.body.classList.remove("group-context"); };
  }, []);

  // Gate (spec §5): visible iff episode <= selectedEpisode (episode 0 always
  // visible). Evaluated on local state — never the live spoiler engine.
  const gatedEntries = useMemo(
    () => tspDemoFeedEntries.filter((e) => e.e <= selectedEpisode),
    [selectedEpisode],
  );
  const gatedReplies = useMemo(() => {
    const out: Record<string, Reply[]> = {};
    for (const [tid, list] of Object.entries(tspDemoReplies)) {
      out[tid] = list.filter((r) => r.episode <= selectedEpisode);
    }
    return out;
  }, [selectedEpisode]);

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

  return (
    <div role="dialog" aria-modal="true" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      {/* Card: fixed header + footer, only the feed/map scroll between them so
          the map and the exit control stay put (sticky), spec tweak. */}
      <div style={{
        position: "relative", width: "85vw", height: "90vh", background: CREAM_BG,
        borderRadius: 24, boxShadow: "0 12px 36px rgba(0,0,0,0.25)", overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header chrome — centered eyebrow + Lora title (no dropdown here, §2). */}
        <div style={{ flex: "0 0 auto", padding: "28px 36px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: INK_SOFT }}>
            a quick tour of a show room
          </div>
          <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 38, color: C.midnight, margin: "6px 0 0" }}>
            The Sidebar Protocol
          </h1>
        </div>

        {/* Room surface — sky panel, fills the middle. Dropdown pinned at its
            top (real in-room position, §2/§5); only the feed/map scroll. */}
        <div style={{ flex: "1 1 auto", minHeight: 0, margin: "0 24px", background: C.sky, borderRadius: 16, padding: "16px 20px 0", display: "flex", flexDirection: "column" }}>
          <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <OneSelectProgress
              show={TSP_DEMO_SHOW}
              value={selectedEpisode > 0 ? { s: 1, e: selectedEpisode } : { s: 0, e: 0 }}
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
                demoReplies={gatedReplies}
                scrollContainerRef={scrollRef}
              />
            </div>
            <div style={{ flex: "0 0 auto", position: "sticky", top: 0, alignSelf: "flex-start" }}>
              <V2RoomMap
                members={mapMembers}
                seasons={TSP_DEMO_SHOW.seasons}
                viewerProgress={userProgress}
                viewerUserId={user?.id ?? "tsp-demo-you"}
                onEntryClick={(tid) => feedRef.current?.scrollToEntry(tid)}
                onRateOwnCell={applyRating}
                onCommitRatings={async (changes) => { changes.forEach((c) => applyRating(c.s, c.e, c.rating)); return { ok: true }; }}
              />
            </div>
          </div>
        </div>

        {/* Footer: single exit control, fixed (doesn't scroll). Forward-framed,
            two-state by whether E6 has been reached (§2). */}
        <div style={{ flex: "0 0 auto", padding: "14px 28px", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: reachedE6 ? C.green : "transparent",
              color: reachedE6 ? "#fff" : INK_SOFT,
              border: reachedE6 ? `2px solid ${C.green}` : `2px solid ${RULE}`,
              borderRadius: 999, padding: "11px 22px", fontWeight: 700, fontSize: 14,
              cursor: "pointer", fontFamily: '"Inter", sans-serif',
            }}
          >
            {reachedE6 ? "start finding shows →" : "skip the tour"}
          </button>
        </div>
      </div>
    </div>
  );
}
