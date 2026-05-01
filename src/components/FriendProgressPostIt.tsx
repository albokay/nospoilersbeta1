import React, { useEffect, useState } from "react";
import { fetchPublicProgressForUser } from "../lib/db";
import type { FriendGroupMember } from "../types";

// ── Visual constants (canon palette + post-it accent green) ───────────────
const POST_IT_BG    = "#7abd8e";  // canon green (write-button green inside friend rooms)
const HANDLE_COLOR  = "#fffaf0";  // canon white — handles + neutral copy
const AHEAD_COLOR   = "#f45028";  // canon red — "[N] episodes ahead"
const BEHIND_COLOR  = "#355eb8";  // canon dark blue — "[N] episodes behind"
const TILT_DEG      = 8;           // clockwise tilt (was 10; nudged down by request)
const MIN_VIEWPORT_PX = 1280;     // hide on narrow viewports (mobile separate spec)
const SCROLL_THRESHOLD_LINES = 20; // internal scroll if more than this many lines

interface Props {
  members: FriendGroupMember[];
  currentUserId: string;
  showId: string;
  seasons: number[];
  userProgress: { s: number; e: number } | undefined;
}

type Status =
  | { kind: "ahead"; count: number | null; username: string }
  | { kind: "same"; username: string }
  | { kind: "behind"; count: number | null; username: string }
  | { kind: "not-started"; username: string };

// Convert (season, episode) into an absolute episode index from S1E1 = 1.
// Returns null when the seasons array can't accommodate the input — caller
// uses null to suppress the count and fall back to direction-only copy.
function episodeIndex(seasons: number[], s: number, e: number): number | null {
  if (s < 1 || e < 1) return 0;        // hasn't started → idx 0
  if (!seasons.length) return null;     // no season data
  if (s > seasons.length) return null;  // season out of bounds
  let idx = 0;
  for (let i = 0; i < s - 1; i++) idx += seasons[i] ?? 0;
  idx += e;
  return idx;
}

function isNotStarted(p: { s: number; e: number } | "no-row" | undefined): boolean {
  if (p === "no-row") return true;
  if (!p) return false;  // undefined = still loading; not "not-started"
  return p.s < 1 || p.e < 1;
}

export default function FriendProgressPostIt({
  members,
  currentUserId,
  showId,
  seasons,
  userProgress,
}: Props) {
  // Hide entirely if viewport is too narrow (mobile gets separate treatment).
  const [wide, setWide] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= MIN_VIEWPORT_PX
  );
  useEffect(() => {
    const fn = () => setWide(window.innerWidth >= MIN_VIEWPORT_PX);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const others = members.filter(m => m.userId !== currentUserId);

  // Per-member progress map. Keyed by userId. Values:
  //   undefined → not loaded yet (don't render that line yet)
  //   "error"   → fetch failed (per spec: hide that member silently)
  //   "no-row"  → no progress row (treat as hasn't started)
  //   {s,e}     → loaded progress
  type Loaded = { s: number; e: number } | "no-row" | "error";
  const [progressByUserId, setProgressByUserId] = useState<Record<string, Loaded | undefined>>({});

  useEffect(() => {
    if (!others.length) return;
    let cancelled = false;
    Promise.all(others.map(async m => {
      try {
        const map = await fetchPublicProgressForUser(m.userId);
        return { userId: m.userId, p: (map[showId] ?? "no-row") as Loaded };
      } catch {
        return { userId: m.userId, p: "error" as Loaded };
      }
    })).then(results => {
      if (cancelled) return;
      const next: Record<string, Loaded> = {};
      for (const r of results) next[r.userId] = r.p;
      setProgressByUserId(next);
    });
    return () => { cancelled = true; };
    // Members signature: stable when same userIds, regardless of array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others.map(m => m.userId).sort().join(","), showId]);

  // Solo room (no others) → hide entirely per spec.
  if (!others.length) return null;
  if (!wide) return null;

  // Build status lines for members with loaded progress (excluding errored).
  const userIdx = userProgress ? episodeIndex(seasons, userProgress.s, userProgress.e) : 0;
  const statuses: Status[] = [];
  for (const m of others) {
    const p = progressByUserId[m.userId];
    if (p === undefined) continue;       // still loading → omit (will appear next render)
    if (p === "error") continue;          // fetch failed → hide silently per spec

    if (isNotStarted(p)) {
      statuses.push({ kind: "not-started", username: m.username });
      continue;
    }
    // p is a {s,e} progress object from here.
    const fp = p as { s: number; e: number };

    // Caught up = exactly the same episode as the user.
    if (userProgress && fp.s === userProgress.s && fp.e === userProgress.e) {
      statuses.push({ kind: "same", username: m.username });
      continue;
    }

    // Compute episode delta when seasons data supports it.
    const fIdx = episodeIndex(seasons, fp.s, fp.e);
    if (fIdx != null && userIdx != null) {
      const delta = fIdx - userIdx;
      if (delta > 0) statuses.push({ kind: "ahead", count: delta, username: m.username });
      else if (delta < 0) statuses.push({ kind: "behind", count: -delta, username: m.username });
      else statuses.push({ kind: "same", username: m.username });
      continue;
    }

    // Fallback: incomplete season data → suppress count, give direction only.
    if (!userProgress) {
      statuses.push({ kind: "ahead", count: null, username: m.username });
      continue;
    }
    if (fp.s > userProgress.s || (fp.s === userProgress.s && fp.e > userProgress.e)) {
      statuses.push({ kind: "ahead", count: null, username: m.username });
    } else if (fp.s < userProgress.s || (fp.s === userProgress.s && fp.e < userProgress.e)) {
      statuses.push({ kind: "behind", count: null, username: m.username });
    } else {
      statuses.push({ kind: "same", username: m.username });
    }
  }

  if (!statuses.length) return null;

  // Sort: ahead (most→least) → caught up → behind (least→most) → not-started.
  // Within each group, secondary sort = alphabetical for stability.
  const groupRank = (s: Status): number =>
    s.kind === "ahead" ? 0 : s.kind === "same" ? 1 : s.kind === "behind" ? 2 : 3;
  statuses.sort((a, b) => {
    const ga = groupRank(a), gb = groupRank(b);
    if (ga !== gb) return ga - gb;
    if (a.kind === "ahead" && b.kind === "ahead") {
      // null counts sort after numeric counts within "ahead"
      if (a.count == null && b.count == null) return a.username.localeCompare(b.username);
      if (a.count == null) return 1;
      if (b.count == null) return -1;
      return b.count - a.count;
    }
    if (a.kind === "behind" && b.kind === "behind") {
      if (a.count == null && b.count == null) return a.username.localeCompare(b.username);
      if (a.count == null) return 1;
      if (b.count == null) return -1;
      return a.count - b.count;
    }
    return a.username.localeCompare(b.username);
  });

  const overflow = statuses.length > SCROLL_THRESHOLD_LINES;

  return (
    <div
      aria-label="Friend progress"
      style={{
        position: "fixed",
        // Box extends past the viewport's right edge so the right edge
        // is never visible. Text content stays in the original on-screen
        // location: paddingRight matches the off-screen extension so the
        // off-screen portion is pure green padding, no text. Width sized
        // so the visible portion extends 50px further into the center
        // column than the prior fit (per request).
        right: -130,
        bottom: 96,
        zIndex: 50,
        transform: `rotate(${TILT_DEG}deg)`,
        transformOrigin: "center",
        background: POST_IT_BG,
        color: HANDLE_COLOR,
        // Top/bottom 16, left 22, right 22 + 80 (off-screen amount).
        padding: "16px 102px 16px 22px",
        borderRadius: 0,             // sharp corners
        boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
        width: 450,
        fontSize: 14,
        lineHeight: 1.5,
        // Internal scroll only when post-it grows past the threshold.
        maxHeight: overflow ? 360 : "none",
        overflowY: overflow ? "auto" : "visible",
        // Don't intercept hover on adjacent elements through the rotated bbox.
        pointerEvents: "auto",
      }}
    >
      {statuses.map((s, i) => {
        const handle = (
          <span style={{ fontStyle: "italic", color: HANDLE_COLOR }}>@{s.username}</span>
        );
        const lineStyle: React.CSSProperties = { whiteSpace: "nowrap" };
        if (s.kind === "ahead") {
          return (
            <div key={i} style={lineStyle}>
              {handle}{" is "}
              <span style={{ color: AHEAD_COLOR }}>
                {s.count != null ? `${s.count} episode${s.count === 1 ? "" : "s"} ` : ""}ahead
              </span>
            </div>
          );
        }
        if (s.kind === "same") {
          return (
            <div key={i} style={lineStyle}>
              {handle}{" "}
              <span style={{ color: HANDLE_COLOR }}>and you are caught up!</span>
            </div>
          );
        }
        if (s.kind === "behind") {
          return (
            <div key={i} style={lineStyle}>
              {handle}{" is "}
              <span style={{ color: BEHIND_COLOR }}>
                {s.count != null ? `${s.count} episode${s.count === 1 ? "" : "s"} ` : ""}behind
              </span>
            </div>
          );
        }
        // not-started
        return (
          <div key={i} style={lineStyle}>
            {handle}{" "}
            <span style={{ color: HANDLE_COLOR }}>hasn't started watching</span>
          </div>
        );
      })}
    </div>
  );
}
