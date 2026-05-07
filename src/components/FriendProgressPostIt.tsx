import React, { useEffect, useState } from "react";
import { fetchPublicProgressForUser } from "../lib/db";
import { FEATURE_PINGS_POLLS } from "../lib/featureFlags";
import NudgePopover, { type NudgeDirection } from "./NudgePopover";
import AskTheRoomPicker from "./AskTheRoomPicker";
import PollComposer from "./PollComposer";
import SIKWComposer from "./SIKWComposer";
import type { FriendGroupMember } from "../types";

// ── Visual constants (canon palette + post-it accent green) ───────────────
const POST_IT_BG    = "#7abd8e";  // canon green (write-button green inside friend rooms)
const HANDLE_COLOR  = "#fffaf0";  // canon white — handles + neutral copy
const AHEAD_COLOR   = "#f45028";  // canon red — "[N] episodes ahead"
const BEHIND_COLOR  = "#355eb8";  // canon dark blue — "[N] episodes behind"
const TILT_DEG      = 8;           // clockwise tilt (was 10; nudged down by request)
const MIN_VIEWPORT_PX = 1230;     // hide on narrow viewports (mobile separate spec)
const SCROLL_THRESHOLD_LINES = 20; // internal scroll if more than this many lines

interface Props {
  members: FriendGroupMember[];
  currentUserId: string;
  showId: string;
  seasons: number[];
  userProgress: { s: number; e: number } | undefined;
  /** Active friend room id; required for ping-launcher mode (passed to NudgePopover for sends). */
  groupId?: string;
}

type Status =
  | { kind: "ahead"; count: number | null; username: string; userId: string }
  | { kind: "same"; username: string; userId: string }
  | { kind: "behind"; count: number | null; username: string; userId: string }
  | { kind: "not-started"; username: string; userId: string };

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

function statusToDirection(s: Status): NudgeDirection {
  if (s.kind === "ahead") return "ahead";
  if (s.kind === "same") return "same";
  if (s.kind === "behind") return "behind";
  return "not-started";
}

function statusToCount(s: Status): number | null {
  if (s.kind === "ahead" || s.kind === "behind") return s.count;
  return null;
}

export default function FriendProgressPostIt({
  members,
  currentUserId,
  showId,
  seasons,
  userProgress,
  groupId,
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

  // Popover anchor state (ping-launcher mode only).
  const [openFor, setOpenFor] = useState<{ status: Status; rect: DOMRect } | null>(null);
  const [askPickerRect, setAskPickerRect] = useState<DOMRect | null>(null);
  const [pollComposerOpen, setPollComposerOpen] = useState<boolean>(false);
  const [sikwComposerOpen, setSikwComposerOpen] = useState<boolean>(false);

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
      statuses.push({ kind: "not-started", username: m.username, userId: m.userId });
      continue;
    }
    // p is a {s,e} progress object from here.
    const fp = p as { s: number; e: number };

    // Caught up = exactly the same episode as the user.
    if (userProgress && fp.s === userProgress.s && fp.e === userProgress.e) {
      statuses.push({ kind: "same", username: m.username, userId: m.userId });
      continue;
    }

    // Compute episode delta when seasons data supports it.
    const fIdx = episodeIndex(seasons, fp.s, fp.e);
    if (fIdx != null && userIdx != null) {
      const delta = fIdx - userIdx;
      if (delta > 0) statuses.push({ kind: "ahead", count: delta, username: m.username, userId: m.userId });
      else if (delta < 0) statuses.push({ kind: "behind", count: -delta, username: m.username, userId: m.userId });
      else statuses.push({ kind: "same", username: m.username, userId: m.userId });
      continue;
    }

    // Fallback: incomplete season data → suppress count, give direction only.
    if (!userProgress) {
      statuses.push({ kind: "ahead", count: null, username: m.username, userId: m.userId });
      continue;
    }
    if (fp.s > userProgress.s || (fp.s === userProgress.s && fp.e > userProgress.e)) {
      statuses.push({ kind: "ahead", count: null, username: m.username, userId: m.userId });
    } else if (fp.s < userProgress.s || (fp.s === userProgress.s && fp.e < userProgress.e)) {
      statuses.push({ kind: "behind", count: null, username: m.username, userId: m.userId });
    } else {
      statuses.push({ kind: "same", username: m.username, userId: m.userId });
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

  // Ping-launcher mode renders helper text + clickable names + divider +
  // "ask the room →" line. When the feature flag is off, the post-it
  // renders identically to its previous static form.
  const launcherMode = FEATURE_PINGS_POLLS && !!groupId;

  function handleNameClick(e: React.MouseEvent<HTMLSpanElement>, status: Status) {
    if (!launcherMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenFor({ status, rect });
  }

  return (
    <>
      <div
        aria-label="Friend progress"
        style={{
          position: "fixed",
          right: -96,
          bottom: 96,
          zIndex: 50,
          transform: `rotate(${TILT_DEG}deg)`,
          transformOrigin: "center",
          background: POST_IT_BG,
          color: HANDLE_COLOR,
          padding: "16px 102px 16px 22px",
          borderRadius: 0,
          boxShadow: "none",
          width: 450,
          fontSize: 14,
          lineHeight: 1.5,
          maxHeight: overflow ? 360 : "none",
          overflowY: overflow ? "auto" : "visible",
          pointerEvents: "auto",
        }}
      >
        {launcherMode && (
          <div
            style={{
              fontStyle: "italic",
              fontSize: 11,
              opacity: 0.85,
              marginBottom: 8,
            }}
          >
            click a name to nudge a friend
          </div>
        )}

        {statuses.map((s, i) => {
          const handleStyle: React.CSSProperties = launcherMode
            ? {
                fontStyle: "italic",
                color: HANDLE_COLOR,
                borderBottom: `1px dotted ${HANDLE_COLOR}`,
                cursor: "pointer",
                padding: "0 1px",
              }
            : { fontStyle: "italic", color: HANDLE_COLOR };

          const handle = (
            <span
              role={launcherMode ? "button" : undefined}
              tabIndex={launcherMode ? 0 : undefined}
              onClick={launcherMode ? (e) => handleNameClick(e, s) : undefined}
              onKeyDown={
                launcherMode
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setOpenFor({ status: s, rect });
                      }
                    }
                  : undefined
              }
              style={handleStyle}
            >
              @{s.username}
            </span>
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

        {launcherMode && (
          <>
            <div
              style={{
                borderTop: `0.5px dashed rgba(23,52,4,0.4)`,
                margin: "10px 0 8px",
              }}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setAskPickerRect(rect);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setAskPickerRect(rect);
                }
              }}
              style={{
                fontStyle: "italic",
                fontSize: 12,
                color: HANDLE_COLOR,
                cursor: "pointer",
                opacity: 0.85,
              }}
            >
              ask the room →
            </div>
          </>
        )}
      </div>

      {launcherMode && openFor && groupId && (
        <NudgePopover
          recipientUsername={openFor.status.username}
          recipientId={openFor.status.userId}
          groupId={groupId}
          currentUserId={currentUserId}
          direction={statusToDirection(openFor.status)}
          count={statusToCount(openFor.status)}
          anchorRect={openFor.rect}
          onClose={() => setOpenFor(null)}
        />
      )}

      {launcherMode && askPickerRect && groupId && (
        <AskTheRoomPicker
          anchorRect={askPickerRect}
          onClose={() => setAskPickerRect(null)}
          onSelectPoll={() => {
            setAskPickerRect(null);
            setPollComposerOpen(true);
          }}
          onSelectSikw={() => {
            setAskPickerRect(null);
            setSikwComposerOpen(true);
          }}
        />
      )}

      {launcherMode && pollComposerOpen && groupId && (
        <PollComposer
          groupId={groupId}
          onClose={() => setPollComposerOpen(false)}
        />
      )}

      {launcherMode && sikwComposerOpen && groupId && (
        <SIKWComposer
          groupId={groupId}
          progressSeason={userProgress?.s ?? 0}
          progressEpisode={userProgress?.e ?? 0}
          onClose={() => setSikwComposerOpen(false)}
        />
      )}
    </>
  );
}
