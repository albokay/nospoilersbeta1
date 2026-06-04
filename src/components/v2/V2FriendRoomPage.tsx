import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, Settings, SquarePen, Users } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabaseClient";
import {
  fetchGroupThreads,
  fetchProgress,
  fetchRoomMapData,
  fetchShows,
  persistProgressUpdate,
  upsertEpisodeRating,
  deleteEpisodeRating,
  fetchHighlights as dbFetchHighlights,
  type RoomMapMember,
  type Show,
} from "../../lib/db";
import type { FriendGroup, Thread } from "../../types";
import type { ProgressEntry } from "../../types";
import { effectiveProgress } from "../../lib/utils";
import V2Layout from "./V2Layout";
import { useComposeModal } from "./ComposeModal";
import V2RoomFeed, {
  type V2RoomFeedEntry,
  type V2RoomFeedHandle,
} from "./V2RoomFeed";
import V2RoomMap, { type V2RoomMapMember } from "./V2RoomMap";
import V2GroupSettingsModal from "./V2GroupSettingsModal";
import LoadingDots from "../LoadingDots";
import OneSelectProgress from "../OneSelectProgress";
import RatingCaptureModal from "../RatingCaptureModal";
import IncomingPingSticky from "../IncomingPingSticky";
import PollSticky from "../PollSticky";
import SIKWSticky from "../SIKWSticky";

// V2 friend room page at /v2/room/:groupId. Two-pane layout: feed of entry
// tickets on the left/center, season map on the right. Coordinated by
// click — map cell → feed scrolls to ticket + flashes the highlight.
//
// Header is a port of the live friend-room banner in ShowSection.tsx (room
// name + Users icon + Settings gear, "to public conversation" link, write
// button, watch-progress pill). Cross-side chrome (logo, sign-out, identity
// pill) comes from V2Layout — palette="room" flips the body to
// group-context and toggles the identity pill into "go to your journal"
// navigation mode.
//
// Settings gear opens a placeholder modal for now; the real
// V2GroupSettingsModal lands in checkpoint 5b (members list, rename,
// invite-by-email, leave room).

export default function V2FriendRoomPage({ groupId }: { groupId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const composeModal = useComposeModal();
  const { user, profile } = useAuth();

  // V3 journal's friend-room entry-card click navigates here with
  // `state.expandThreadId` — V2RoomFeed reads this on mount and auto-
  // expands that entry. Captured once at mount via useState initializer so
  // we don't re-trigger on subsequent location changes within the room.
  // `state.focusReplyId` (optional) names a specific reply inside the
  // expanded thread to scroll to + flash — used when the V3 click was on
  // a reply (responses to you / your responses / your starred responses)
  // rather than the entry itself. Plumbed through V2RoomFeed →
  // V2InlineThread → RepliesList's existing focusReplyId support.
  //
  // EXTERNAL deep-link: the daily digest email links to a specific entry as
  // `/room/<id>?entry=<threadId>`. Plain URLs can't carry React Router state,
  // so we also read the `entry` query param here. In-app `state` wins when
  // both are present (SPA nav is more specific than a shared link).
  const [initialExpandThreadId] = useState<string | null>(
    () =>
      (location.state as { expandThreadId?: string } | null)?.expandThreadId ??
      new URLSearchParams(location.search).get("entry") ??
      null,
  );
  const [initialFocusReplyId] = useState<string | null>(
    () => (location.state as { focusReplyId?: string } | null)?.focusReplyId ?? null,
  );

  const [room, setRoom] = useState<FriendGroup | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [progressForShow, setProgressForShow] = useState<ProgressEntry | null>(null);
  const [feedEntries, setFeedEntries] = useState<V2RoomFeedEntry[]>([]);
  const [mapMembers, setMapMembers] = useState<V2RoomMapMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Rating-capture flow: forward picks on the watch-progress dropdown open
  // RatingCaptureModal instead of OneSelectProgress's internal confirm.
  // pendingRating holds the destination episode while the modal is open.
  // See sidebar_spec_rating_capture.md.
  const [pendingRating, setPendingRating] = useState<{ s: number; e: number } | null>(null);

  // Click-to-adjust ratings on the map: which entries are currently
  // intersecting the viewport (driven by V2RoomFeed's IntersectionObserver).
  // V2RoomMap consumes this — self-column state-2 cells whose entry is
  // visible rotate rating on click; cells whose entry is off-screen scroll
  // to it instead. See sidebar_spec_click_to_adjust_ratings.md.
  const [visibleEntryIds, setVisibleEntryIds] = useState<Set<string>>(new Set());

  // ── Notification-signal state (A1 white outline, A2 green chevron,
  //    A3 red map dot, A3b green map dot, A4 visited fade) ───────────
  //
  // lastRoomVisitedSnapshot: ms timestamp captured ONCE at mount from
  //   localStorage `ns_room_visited_<userId>_<groupId>`. Used to decide
  //   "this entry is new since you last visited this room." Fresh value
  //   is written to localStorage AFTER the snapshot is captured, so the
  //   user re-entering the room in a different session sees the latest
  //   stamp on their NEXT visit.
  //
  // lastOpenedAt: map of threadId → ms timestamp of last expand. Mirrors
  //   V1's `ns_last_opened` localStorage key (same shape, same semantics).
  //   Used to compute "has new visible reply since you opened this thread."
  //
  // perThreadLatestReply / perThreadHiddenCount: per-thread freshness data
  //   from fetchGroupThreads. Hidden count is populated only for threads
  //   the viewer authored.
  //
  // engagedSet: in-memory set of threadIds that have been expanded AND
  //   collapsed at least once this session. A1 white outline shows ONLY
  //   when the threadId is NOT in this set. Clears on page reload.
  //
  // greenDismissedSet: in-memory set of threadIds whose green signal
  //   (A2 + A3b) was dismissed this session (via expand). Used to suppress
  //   the red dot from appearing in the same session when green clears —
  //   per spec, red only re-appears on next page load.
  //
  // redDismissedAt: per-thread ms timestamp of manual X-click dismissal.
  //   Mirrors V1's `ns_tdot_dismiss_<threadId>` localStorage key.
  const lastRoomVisitedSnapshotRef = useRef<number>(0);
  // Snapshot of thread IDs that were visible to the viewer at the START
  // of their last room visit. Drives the A1 "new" outline so newly-
  // visible entries (post-progress-advance, NOT just newly-created
  // entries) get flagged the next time the viewer enters the room.
  const prevVisibleThreadIdsRef = useRef<Set<string>>(new Set());
  const [lastOpenedAt, setLastOpenedAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_last_opened") || "{}"); } catch { return {}; }
  });
  const [perThreadLatestReply, setPerThreadLatestReply] = useState<Record<string, number>>({});
  const [perThreadHiddenCount, setPerThreadHiddenCount] = useState<Record<string, number>>({});
  // Latest hidden-reply createdAt per thread — paired with redDismissedAt so
  // a NEW hidden reply landing after a user X'd the red dot will re-fire
  // the dot (matches green's "new since last seen" semantic). Without this,
  // X'd dots stayed dismissed forever, even for fresh hidden replies.
  const [perThreadLatestHidden, setPerThreadLatestHidden] = useState<Record<string, number>>({});
  const [engagedSet, setEngagedSet] = useState<Set<string>>(new Set());
  const [greenDismissedSet, setGreenDismissedSet] = useState<Set<string>>(new Set());
  const [redDismissedAt, setRedDismissedAt] = useState<Record<string, number>>({});
  // firstHighlightedSet: per spec #2 — a self-column map cell with a
  // notification (red OR green) has TWO click states. First click highlights
  // the entry ticket (scroll + blue flash) without changing rating. Once a
  // threadId is in this set, subsequent self-cell clicks fall through to the
  // existing rate-change behavior (regardless of whether the notification
  // has cleared). Sticky for the session; cleared on page reload.
  const [firstHighlightedSet, setFirstHighlightedSet] = useState<Set<string>>(new Set());

  // ── Yellow highlight notification dot tracking (C10) ──────────────────
  // Per-thread MAX created_at of any highlight on viewer's writing in that
  // thread (by a non-self author). Computed from the bulk highlight fetch.
  // 0 = no relevant highlight.
  const [latestHighlightOnViewerWriting, setLatestHighlightOnViewerWriting] =
    useState<Record<string, number>>({});
  // Per-thread last time the VIEWER expanded that entry — compared against
  // latestHighlightOnViewerWriting to decide if the yellow dot shows.
  // localStorage-persisted under `ns_highlight_seen` (single global JSON
  // object keyed by threadId — small, doesn't grow per-room).
  const [lastHighlightSeenAt, setLastHighlightSeenAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_highlight_seen") || "{}"); } catch { return {}; }
  });

  // Capture the last-room-visited snapshot ONCE per mount and write the
  // fresh stamp afterward. Skipping the rewrite would cause the snapshot
  // to drift further into the past on every render; capturing AFTER
  // setting would defeat the "what's new since last visit" purpose.
  // ALSO captures the previous visit's visible-thread-IDs set; the new
  // set is written by a separate effect once feedEntries loads (so the
  // ref still holds the OLD set when isNewMap recomputes).
  useEffect(() => {
    if (!user?.id || !groupId) return;
    const tKey = `ns_room_visited_${user.id}_${groupId}`;
    const stored = localStorage.getItem(tKey);
    lastRoomVisitedSnapshotRef.current = stored ? parseInt(stored, 10) : 0;
    localStorage.setItem(tKey, String(Date.now()));
    const vKey = `ns_room_visible_threads_${user.id}_${groupId}`;
    try {
      const v = localStorage.getItem(vKey);
      prevVisibleThreadIdsRef.current = v ? new Set(JSON.parse(v)) : new Set();
    } catch {
      prevVisibleThreadIdsRef.current = new Set();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, groupId]);

  // Bumped when the asker opens a poll via the map's door-icon launcher
  // (PollComposer's onOpened callback). PollSticky watches this key and
  // refreshes so the asker sees their just-opened poll without waiting
  // for the realtime subscription. Same pattern as V1 ShowSection.
  const [pollRefreshKey, setPollRefreshKey] = useState(0);

  // Debounce timers per (season, episode) — each click optimistically
  // updates local state and schedules a 500ms-deferred UPSERT. A repeat
  // click for the same cell cancels its prior timer and reschedules with
  // the new value, so only the LATEST rating gets written. Trade-off:
  // navigating away within 500ms of clicking loses the pending write
  // (rare; user can re-click on next visit).
  const ratingTimersRef = useRef<Record<string, number>>({});
  useEffect(() => {
    return () => {
      for (const t of Object.values(ratingTimersRef.current)) {
        window.clearTimeout(t);
      }
    };
  }, []);

  const feedRef = useRef<V2RoomFeedHandle>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Same-room publish refetch + expand signal ───────────────────────
  // When the user publishes from the compose modal to the room they're
  // already in, the modal navigates to /v2/room/<groupId> with
  // state.publishedThreadId set. The page doesn't unmount (same URL), so
  // the existing bootstrap effect's [groupId, user.id] deps don't fire
  // and the new entry never lands in feedEntries until the user manually
  // refreshes. To handle this, we use a refetch counter as a third
  // bootstrap dep, and a ref to carry the thread id from publish→fetch→
  // expand without re-triggering on every render. Cleared once consumed.
  const [refetchCounter, setRefetchCounter] = useState(0);
  const pendingExpandAfterRefetchRef = useRef<string | null>(null);
  useEffect(() => {
    const id = (location.state as { publishedThreadId?: string } | null)?.publishedThreadId;
    if (id && pendingExpandAfterRefetchRef.current !== id) {
      pendingExpandAfterRefetchRef.current = id;
      setRefetchCounter((c) => c + 1);
    }
  }, [location.state]);
  // Default to descending — newest episode tag at the top of the feed.
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  // User filter — null = show everyone. When non-null, restricts the feed
  // to entries authored by that userId AND dims other members' columns in
  // the map (non-interactive). Sort is forced to "desc" (newest episode
  // first) while the filter is active per spec.
  const [userFilter, setUserFilter] = useState<string | null>(null);

  // Bootstrap — fetch room, show, progress, group threads (feed), and the
  // RPC-backed map data (members + ratings + entries) in one effect.
  useEffect(() => {
    if (!user?.id || !groupId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        // 1) Room row first — we need show_id before we can fan out.
        const { data: roomRow, error: roomErr } = await supabase
          .from("friend_groups")
          .select("id, show_id, name, created_by, created_at, deleted_at")
          .eq("id", groupId)
          .maybeSingle();
        if (roomErr) throw roomErr;
        if (!roomRow) throw new Error("room not found");
        if (roomRow.deleted_at) throw new Error("this room no longer exists");
        const fg: FriendGroup = {
          id: roomRow.id,
          showId: roomRow.show_id,
          name: roomRow.name,
          createdBy: roomRow.created_by,
          createdAt: new Date(roomRow.created_at).getTime(),
        };

        // 2) Parallel: show catalog, viewer's progress, map RPC.
        const [allShows, progressMap, roomMapData] = await Promise.all([
          fetchShows(),
          fetchProgress(user.id),
          fetchRoomMapData(groupId),
        ]);
        const showRow = allShows.find((s) => s.id === fg.showId) ?? null;
        const progress = progressMap[fg.showId] ?? null;
        const eff = effectiveProgress(progress);

        // 3) Feed — spoiler-filtered against viewer's effective progress.
        const groupResult = eff
          ? await fetchGroupThreads(groupId, eff.s, eff.e, user.id)
          : {
              threads: [] as Thread[],
              replyCounts: {} as Record<string, number>,
              latestVisibleReplyAt: {} as Record<string, number>,
              hiddenCounts: {} as Record<string, number>,
              latestHiddenReplyAt: {} as Record<string, number>,
              aheadCounts: {} as Record<string, number>,
              sharedAt: {} as Record<string, number>,
            };

        const departedUsernames = new Set(
          roomMapData.filter((m) => m.isDeparted).map((m) => m.username ?? "").filter(Boolean),
        );

        // fetchGroupThreads already drops no-reply tombstones — anything
        // soft-deleted that arrives here had visible replies and should
        // render as a tombstone (gravestone copy in the feed).
        //
        // Thread doesn't carry author_id through rowToThread, so we
        // resolve authorId via a username→userId map built from
        // roomMapData (which DOES carry both). Used by the user-filter
        // feature so feed clicks match the dropdown's userId-keyed
        // selection. Departed members are still in roomMapData, so
        // their entries also resolve correctly.
        const usernameToUserId: Record<string, string> = {};
        for (const m of roomMapData) {
          if (m.username) usernameToUserId[m.username] = m.userId;
        }
        const entries: V2RoomFeedEntry[] = groupResult.threads.map((t) => ({
          threadId: t.id,
          s: t.season,
          e: t.episode,
          title: t.titleBase,
          body: t.body,
          preview: t.preview,
          authorId: usernameToUserId[t.author] ?? "",
          authorUsername: t.author,
          isRewatch: t.isRewatch,
          rewatchS: t.rewatchS,
          rewatchE: t.rewatchE,
          isEdited: t.isEdited,
          isDeparted: departedUsernames.has(t.author),
          isDeleted: t.isDeleted ?? false,
          // Room-relevant timestamp = when the entry ARRIVED in this room
          // (group_threads.shared_at), not when it was written/edited. Drives
          // the entry-card "time ago" + within-episode ordering, and keeps the
          // room consistent with the digest (which also keys on shared_at). A
          // privately-written post converted in reads as freshly arrived.
          // Falls back to updatedAt if shared_at is somehow missing.
          updatedAt: groupResult.sharedAt?.[t.id] || t.updatedAt,
          // V2 reply count = visible chain-visible replies + ahead-of-progress
          // stubs (RepliesList renders these via showAheadStubs). Matches the
          // user-facing "responses" total the entry card displays.
          replyCount: (groupResult.replyCounts[t.id] ?? 0) + (groupResult.aheadCounts?.[t.id] ?? 0),
          // Full thread object — V2InlineThread mounts on expand and
          // expects the Thread shape (not the lean entry projection).
          thread: t,
        }));

        const mapMembersOut: V2RoomMapMember[] = roomMapData.map((m: RoomMapMember) => ({
          userId: m.userId,
          username: m.username ?? "?",
          isDeparted: m.isDeparted,
          progress: m.progress,
          ratings: m.ratings,
          entries: m.entries.map((e) => ({
            threadId: e.threadId,
            s: e.s,
            e: e.e,
            title: e.title,
          })),
        }));

        if (cancelled) return;
        setRoom(fg);
        setShow(showRow);
        setProgressForShow(progress);
        setFeedEntries(entries);
        setMapMembers(mapMembersOut);
        setPerThreadLatestReply(groupResult.latestVisibleReplyAt);
        setPerThreadHiddenCount(groupResult.hiddenCounts ?? {});
        setPerThreadLatestHidden(groupResult.latestHiddenReplyAt ?? {});
        // Same-room publish flow: if the modal navigated here with a
        // publishedThreadId, expand that entry now that feedEntries is
        // populated. Defer one tick so V2RoomFeed has the new entries +
        // its refs in the DOM. Ref-cleared so subsequent renders don't
        // re-expand.
        if (pendingExpandAfterRefetchRef.current) {
          const targetId = pendingExpandAfterRefetchRef.current;
          if (entries.some((e) => e.threadId === targetId)) {
            setTimeout(() => feedRef.current?.expandEntry(targetId), 0);
          }
          pendingExpandAfterRefetchRef.current = null;
        }
        // Seed manual-dismiss timestamps for any visible thread that has a
        // stored localStorage flag — read once at load so render-time
        // predicates can stay synchronous.
        const dismisses: Record<string, number> = {};
        for (const t of groupResult.threads) {
          const v = localStorage.getItem(`ns_tdot_dismiss_${t.id}`);
          if (v) dismisses[t.id] = parseInt(v, 10);
        }
        setRedDismissedAt(dismisses);
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg =
          (err as { message?: string })?.message ??
          "couldn't load this room";
        console.warn("V2FriendRoomPage bootstrap failed:", err);
        setLoadError(msg);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // refetchCounter is bumped by the publishedThreadId watcher above so a
    // same-room compose modal publish forces a fresh fetch (the new entry
    // wouldn't otherwise land in feedEntries until next manual refresh).
  }, [groupId, user?.id, refetchCounter]);

  // Keep the viewer's OWN map column in sync with their live progress. The map
  // derives each column's reach from mapMembers[].progress (fetched once at
  // bootstrap), so an in-room progress advance wouldn't move the viewer's
  // column until a refetch/refresh. Mirror progressForShow into the viewer's
  // mapMembers entry whenever it changes (guarded so it doesn't loop).
  useEffect(() => {
    if (!user?.id || !progressForShow) return;
    setMapMembers((prev) => {
      const idx = prev.findIndex((m) => m.userId === user.id);
      if (idx < 0) return prev;
      const cur = prev[idx].progress;
      if (
        cur &&
        cur.s === progressForShow.s &&
        cur.e === progressForShow.e &&
        (cur.isRewatching ?? false) === (progressForShow.isRewatching ?? false) &&
        cur.highestS === progressForShow.highestS &&
        cur.highestE === progressForShow.highestE
      ) {
        return prev;
      }
      const next = [...prev];
      next[idx] = { ...next[idx], progress: progressForShow };
      return next;
    });
  }, [progressForShow, user?.id]);

  // ── Yellow highlight notification dot data (C10) ─────────────────────
  // After feedEntries arrives, fetch:
  //   - highlights on each entry (target_type='thread')
  //   - viewer's reply IDs in this room (one supabase query)
  //   - highlights on those reply IDs (target_type='reply')
  // Then compute per-thread `latestHighlightOnViewerWriting`: the max
  // created_at of any highlight on a piece of writing the viewer authored
  // (entry or reply) where the highlight's author is NOT the viewer.
  // fetchHighlights applies the C9 spoiler filter (viewerProgress) so we
  // never see ahead-of-progress highlights through this signal either.
  useEffect(() => {
    if (!user?.id || !groupId || feedEntries.length === 0) {
      setLatestHighlightOnViewerWriting({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const entryIds = feedEntries.map((e) => e.threadId);

        // 1) Viewer's reply IDs in this room. Direct query — replies RLS
        //    is `USING (true)` for authenticated, so this returns
        //    everything matching the WHERE clause.
        const { data: viewerReplyRows } = await supabase
          .from("replies")
          .select("id, thread_id")
          .eq("group_id", groupId)
          .eq("author_id", user.id);
        const viewerReplyByThread: Record<string, string[]> = {};
        const allViewerReplyIds: string[] = [];
        for (const r of viewerReplyRows ?? []) {
          (viewerReplyByThread[r.thread_id] ??= []).push(r.id);
          allViewerReplyIds.push(r.id);
        }

        // 2) Highlights on entries (any author) + highlights on viewer's
        //    replies (any author). Spoiler filter via viewerProgress so
        //    rows authored past viewer progress are dropped server-side.
        const [entryHL, replyHL] = await Promise.all([
          dbFetchHighlights({
            targetType: "thread",
            targetIds: entryIds,
            viewerProgress: progressForShow ?? undefined,
          }),
          allViewerReplyIds.length > 0
            ? dbFetchHighlights({
                targetType: "reply",
                targetIds: allViewerReplyIds,
                viewerProgress: progressForShow ?? undefined,
              })
            : Promise.resolve([]),
        ]);

        // 3) Compute per-thread latest relevant highlight timestamp.
        //    Relevant = on viewer's writing AND author != viewer.
        const latest: Record<string, number> = {};
        const viewerUsername = profile?.username ?? null;

        // For entry highlights: relevant only if viewer is the entry author.
        // We look up via feedEntries (which has authorUsername).
        const isViewerEntry: Record<string, boolean> = {};
        for (const e of feedEntries) {
          isViewerEntry[e.threadId] = !!viewerUsername && e.authorUsername === viewerUsername;
        }
        for (const h of entryHL) {
          if (!isViewerEntry[h.targetId]) continue;
          if (h.authorId === user.id) continue; // skip self
          if (h.createdAt > (latest[h.targetId] ?? 0)) {
            latest[h.targetId] = h.createdAt;
          }
        }

        // For reply highlights: each reply maps back to one thread. The
        // highlight counts toward THAT thread's signal.
        const replyToThread: Record<string, string> = {};
        for (const r of viewerReplyRows ?? []) {
          replyToThread[r.id] = r.thread_id;
        }
        for (const h of replyHL) {
          if (h.authorId === user.id) continue;
          const tid = replyToThread[h.targetId];
          if (!tid) continue;
          if (h.createdAt > (latest[tid] ?? 0)) {
            latest[tid] = h.createdAt;
          }
        }

        if (cancelled) return;
        setLatestHighlightOnViewerWriting(latest);
      } catch (err) {
        console.warn("highlight-signal fetch failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, groupId, feedEntries, progressForShow, profile?.username]);

  // Map cell click → scroll the feed to the ticket and flash highlight.
  // Also adds the threadId to firstHighlightedSet (per spec #2). For cells
  // with no notification, the set membership has no behavioral effect.
  const handleCellClick = useCallback((threadId: string) => {
    feedRef.current?.scrollToEntry(threadId);
    setFirstHighlightedSet(prev => {
      if (prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });
  }, []);

  const handleWrite = useCallback(() => {
    if (!show) return;
    // Open compose as an overlay modal on top of this friend room. returnTo
    // is the friend-room pathname so a discard from the modal lands back
    // here (which is where the user already is — modal just closes; no
    // extra navigation fires when the target matches the current path).
    composeModal.open({ showId: show.id, returnTo: location.pathname });
  }, [composeModal, show, location.pathname]);

  // Edit succeeded — patch the matching entry's content in feedEntries so
  // the card re-renders with the new title / body / preview / tag / edited
  // flag, no refetch needed.
  const handleThreadEdited = useCallback((updated: Thread) => {
    setFeedEntries((prev) =>
      prev.map((e) =>
        e.threadId === updated.id
          ? {
              ...e,
              title: updated.titleBase,
              body: updated.body,
              preview: updated.preview,
              s: updated.season,
              e: updated.episode,
              isEdited: updated.isEdited,
              thread: updated,
            }
          : e,
      ),
    );
  }, []);

  // Delete succeeded — if the entry had any replies, leave it in the feed
  // as a tombstone (gravestone copy renders in V2RoomFeed when isDeleted);
  // otherwise drop it from the feed entirely. V2InlineThread.onThreadDeleted
  // also signals V2RoomFeed to auto-collapse, so the user lands on the
  // post-delete feed state without anything still expanded.
  const handleThreadDeleted = useCallback((threadId: string) => {
    setFeedEntries((prev) => {
      const entry = prev.find((e) => e.threadId === threadId);
      if (!entry) return prev;
      if (entry.replyCount === 0) {
        return prev.filter((e) => e.threadId !== threadId);
      }
      return prev.map((e) =>
        e.threadId === threadId
          ? {
              ...e,
              isDeleted: true,
              thread: { ...e.thread, isDeleted: true },
            }
          : e,
      );
    });
  }, []);

  // Progress update from the watch-progress pill.
  const handleProgressConfirm = useCallback(
    (val: { s: number; e: number }) => {
      if (!user?.id || !show) return;
      // Use raw supabase update for now — same shape as upsertProgress in
      // db.ts. Full update flow with rewatch transitions lives in App.tsx;
      // for a friend-room page the simple case is enough since this surface
      // is constrained to in-show progress moves.
      supabase
        .from("progress")
        .upsert(
          { user_id: user.id, show_id: show.id, season: val.s, episode: val.e },
          { onConflict: "user_id,show_id" },
        )
        .then(() => {
          // Update local state so the map's spine + masked tooltips refresh
          // without a full reload.
          setProgressForShow((prev) =>
            prev ? { ...prev, s: val.s, e: val.e } : { s: val.s, e: val.e },
          );
        });
    },
    [user?.id, show],
  );

  // Rating-capture handoff: forward pick on the progress dropdown opens
  // RatingCaptureModal. The modal manages its own tap → 150ms → commit
  // animation; on commit we save the rating, advance progress, and navigate
  // to /v2/compose with returnTo set so the user lands back here on discard.
  const handleForwardPick = useCallback((val: { s: number; e: number }) => {
    setPendingRating(val);
  }, []);

  const handleRatingCommit = useCallback(
    async (rating: number) => {
      if (!pendingRating || !user?.id || !show) return;
      const target = pendingRating;
      // Fire-and-forget rating upsert. Failure is non-fatal — the user
      // still advances progress and reaches the compose page; only the
      // map cell goes unrated.
      upsertEpisodeRating({
        userId: user.id,
        showId: show.id,
        season: target.s,
        episode: target.e,
        rating,
      }).catch((err) => console.warn("upsertEpisodeRating failed:", err));
      // Persist + AWAIT the progress write so V2ComposePage's fetchProgress
      // on mount doesn't race. persistProgressUpdate handles rewatcher
      // transitions correctly.
      try {
        const updated = await persistProgressUpdate(
          user.id,
          show.id,
          progressForShow ?? undefined,
          target,
        );
        setProgressForShow(updated);
      } catch (err) {
        console.warn("rating-flow progress write failed:", err);
        // Surface nothing to the user — fall through to navigate anyway so
        // the rating they just gave isn't visually lost. Worst case the
        // compose page reads stale progress; user re-picks if needed.
      }
      setPendingRating(null);
      // Rating-flow → open compose modal (was navigate to /v2/compose).
      // fromRating drives the intro-copy variant inside the form;
      // returnTo lets a discard land back on the friend room.
      composeModal.open({
        showId: show.id,
        fromRating: true,
        returnTo: location.pathname,
      });
    },
    [pendingRating, user?.id, show, progressForShow, composeModal, location.pathname],
  );

  const handleRatingCancel = useCallback(() => {
    setPendingRating(null);
  }, []);

  // Click-to-adjust rating on a self-column map cell. Optimistic local
  // state update + debounced write (500ms). Caller (V2RoomMap) is
  // responsible for computing the new value: a number 1..6 to set, OR
  // null to clear the rating entirely (cycle position between 6 and 1).
  const handleRateOwnCell = useCallback(
    (season: number, episode: number, newRating: number | null) => {
      if (!user?.id || !show) return;
      const cellKey = `${season}-${episode}`;

      // Optimistic state update. null = remove the entry from ratings.
      // Otherwise splice in (overwrite if present, add if absent).
      setMapMembers((prev) =>
        prev.map((m) => {
          if (m.userId !== user.id) return m;
          if (newRating === null) {
            return {
              ...m,
              ratings: m.ratings.filter((r) => !(r.s === season && r.e === episode)),
            };
          }
          const idx = m.ratings.findIndex((r) => r.s === season && r.e === episode);
          const newRatings =
            idx >= 0
              ? m.ratings.map((r, i) => (i === idx ? { ...r, rating: newRating } : r))
              : [...m.ratings, { s: season, e: episode, rating: newRating }];
          return { ...m, ratings: newRatings };
        }),
      );

      // Debounced DB write — UPSERT or DELETE depending on newRating.
      // Rapid clicks coalesce to one write at the end of the burst.
      const existing = ratingTimersRef.current[cellKey];
      if (existing) window.clearTimeout(existing);
      ratingTimersRef.current[cellKey] = window.setTimeout(() => {
        const op =
          newRating === null
            ? deleteEpisodeRating({ userId: user.id, showId: show.id, season, episode })
            : upsertEpisodeRating({ userId: user.id, showId: show.id, season, episode, rating: newRating });
        op.catch((err) =>
          console.warn(`Rating write (click-to-adjust) failed s${season}e${episode}:`, err),
        );
        delete ratingTimersRef.current[cellKey];
      }, 500);
    },
    [user?.id, show],
  );

  // Batch-commit handler for V2RoomMap's rating-edit mode. Called when
  // the user clicks the list-check icon to confirm a session of pending
  // changes. Persists each change in parallel via UPSERT or DELETE; on
  // any failure returns { ok: false } so the map can revert + surface
  // an inline error message. On success, mirrors the changes into local
  // mapMembers state so subsequent renders reflect the committed values.
  const handleCommitRatings = useCallback(
    async (changes: { s: number; e: number; rating: number | null }[]): Promise<{ ok: boolean }> => {
      if (!user?.id || !show) return { ok: false };
      if (changes.length === 0) return { ok: true };
      try {
        await Promise.all(
          changes.map((c) =>
            c.rating === null
              ? deleteEpisodeRating({ userId: user.id, showId: show.id, season: c.s, episode: c.e })
              : upsertEpisodeRating({ userId: user.id, showId: show.id, season: c.s, episode: c.e, rating: c.rating }),
          ),
        );
        // Mirror committed values into local state.
        setMapMembers((prev) =>
          prev.map((m) => {
            if (m.userId !== user.id) return m;
            let newRatings = m.ratings;
            for (const c of changes) {
              if (c.rating === null) {
                newRatings = newRatings.filter((r) => !(r.s === c.s && r.e === c.e));
              } else {
                const idx = newRatings.findIndex((r) => r.s === c.s && r.e === c.e);
                if (idx >= 0) {
                  newRatings = newRatings.map((r, i) =>
                    i === idx ? { ...r, rating: c.rating as number } : r,
                  );
                } else {
                  newRatings = [...newRatings, { s: c.s, e: c.e, rating: c.rating as number }];
                }
              }
            }
            return { ...m, ratings: newRatings };
          }),
        );
        return { ok: true };
      } catch (err) {
        console.warn("Batch rating commit failed:", err);
        return { ok: false };
      }
    },
    [user?.id, show],
  );

  // Geometry constants — keep banner column aligned with the feed pane's
  // left edge so the visual rhythm reads as one column.
  const FEED_MAX_W = 672;
  const GAP = 64;

  const eff = useMemo(() => effectiveProgress(progressForShow), [progressForShow]);

  // Click handler for username bylines (entry author + reply authors). Routes
  // to the V2 public profile route at /v2/u/<username>. Used by V2RoomFeed
  // for the entry byline and forwarded to V2InlineThread → RepliesList for
  // reply bylines.
  const handleClickProfile = useCallback(
    (username: string) => {
      navigate(`/u/${encodeURIComponent(username)}`);
    },
    [navigate],
  );

  // Persist the current visible-thread-IDs snapshot once the bootstrap
  // fetch lands feedEntries. Subsequent feed mutations (sort changes,
  // expansions) re-stamp; the ref read at mount above already captured
  // the OLD snapshot, so isNewMap below still compares against the
  // previous visit's set.
  useEffect(() => {
    if (!user?.id || !groupId) return;
    if (feedEntries.length === 0) return;
    const vKey = `ns_room_visible_threads_${user.id}_${groupId}`;
    const ids = feedEntries.filter((e) => !e.isDeleted).map((e) => e.threadId);
    try {
      localStorage.setItem(vKey, JSON.stringify(ids));
    } catch {
      /* ignore quota errors */
    }
  }, [user?.id, groupId, feedEntries]);

  // Notification-signal handlers — see state-bucket comments above.
  // Per spec #3: greenDismissedSet should ONLY be updated when green was
  // actually the active signal at the moment of expand. If the user expands
  // a red-notification entry (or a no-notification entry), the dismiss-set
  // is unchanged so red survives the expand. Compute wasGreen BEFORE the
  // lastOpenedAt update.
  //
  // 2026-05-26: lastOpenedAt[tid] now stores the LATEST VISIBLE REPLY
  // TIMESTAMP at expand time, NOT Date.now(). Reason: a previously-
  // ahead-of-progress reply that becomes visible AFTER the viewer
  // advances progress has a created_at in the past — using Date.now()
  // would set the comparison ceiling above every possible past reply,
  // permanently suppressing the green signal for catch-up replies.
  // Capturing the visibility frontier at expand time means future
  // newly-visible replies (with their original past created_at) still
  // satisfy `latest > opened` and fire green correctly.
  const handleEntryExpanded = useCallback((threadId: string) => {
    const latestSeenAt = perThreadLatestReply[threadId] ?? 0;
    const wasGreen = latestSeenAt > (lastOpenedAt[threadId] ?? 0);
    setLastOpenedAt(prev => {
      const next = { ...prev, [threadId]: latestSeenAt };
      try { localStorage.setItem("ns_last_opened", JSON.stringify(next)); } catch { /* ignore quota errors */ }
      return next;
    });
    // C10 yellow-dot: mark "I've now seen all highlights up to this moment
    // on this entry." Date.now() is the right value here because the
    // comparison is against highlight.createdAt (also a Date.now()-shaped
    // wall-clock timestamp). Persisted to localStorage so the dot stays
    // dismissed across refresh / navigation / sign-out-in.
    const nowMs = Date.now();
    setLastHighlightSeenAt(prev => {
      const next = { ...prev, [threadId]: nowMs };
      try { localStorage.setItem("ns_highlight_seen", JSON.stringify(next)); } catch { /* ignore quota errors */ }
      return next;
    });
    if (wasGreen) {
      setGreenDismissedSet(prev => {
        if (prev.has(threadId)) return prev;
        const next = new Set(prev);
        next.add(threadId);
        return next;
      });
    }
    // The A1 white "new" outline clears on FIRST EXPAND (not on collapse
    // as it did originally). Add to engagedSet here too — isNewMap reads
    // this set to gate the outline.
    setEngagedSet(prev => {
      if (prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });
  }, [perThreadLatestReply, lastOpenedAt]);

  const handleEntryCollapsed = useCallback((threadId: string) => {
    setEngagedSet(prev => {
      if (prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });
  }, []);

  const handleDismissRedDot = useCallback((threadId: string) => {
    const now = Date.now();
    try { localStorage.setItem(`ns_tdot_dismiss_${threadId}`, String(now)); } catch { /* ignore */ }
    setRedDismissedAt(prev => ({ ...prev, [threadId]: now }));
  }, []);

  // Per-thread notification signals for the map. Precedence (per Q4):
  // GREEN > YELLOW > RED. One signal per cell at a time.
  //   - green: visible-new responses on this entry (cleared on expand)
  //   - yellow (C10): viewer has writing in this entry (own entry, or
  //     authored a visible reply inside) AND there's a highlight on that
  //     writing by another user that the viewer hasn't seen yet
  //   - red: own-entry hidden responses (numbered, X-dismissable, persists
  //     via localStorage)
  // When green is dismissed in-session, red doesn't fill in until next
  // load (greenDismissedSet check). Yellow doesn't have a parallel
  // dismissal — it clears via expand → lastHighlightSeenAt bump.
  const cellSignals = useMemo(() => {
    const out: Record<string, { kind: "green" | "yellow" | "red"; redCount?: number } > = {};
    for (const entry of feedEntries) {
      if (entry.isDeleted) continue;
      const tid = entry.threadId;
      const latest = perThreadLatestReply[tid] ?? 0;
      const opened = lastOpenedAt[tid] ?? 0;
      const hasVisibleNew = latest > opened;
      if (hasVisibleNew) {
        out[tid] = { kind: "green" };
        continue;
      }
      const latestHL = latestHighlightOnViewerWriting[tid] ?? 0;
      const seenHL   = lastHighlightSeenAt[tid] ?? 0;
      if (latestHL > seenHL) {
        out[tid] = { kind: "yellow" };
        continue;
      }
      const isOwn = !!profile?.username && entry.authorUsername === profile.username;
      const hiddenCount = perThreadHiddenCount[tid] ?? 0;
      const greenDismissedThisSession = greenDismissedSet.has(tid);
      // Manual X-dismissal is a snooze through the moment of click, not a
      // forever-suppress. If a NEW hidden reply lands after the dismissal,
      // the dismissal is stale and red re-fires. Comparing the dismissal
      // timestamp against perThreadLatestHidden[tid] (max createdAt of
      // hidden replies, populated by fetchGroupThreads) gives that.
      const dismissedAt    = redDismissedAt[tid] ?? 0;
      const latestHiddenAt = perThreadLatestHidden[tid] ?? 0;
      const manuallyDismissed = dismissedAt > 0 && dismissedAt >= latestHiddenAt;
      if (isOwn && hiddenCount > 0 && !greenDismissedThisSession && !manuallyDismissed) {
        out[tid] = { kind: "red", redCount: hiddenCount };
      }
    }
    return out;
  }, [feedEntries, perThreadLatestReply, lastOpenedAt, perThreadHiddenCount, perThreadLatestHidden, greenDismissedSet, redDismissedAt, profile?.username, latestHighlightOnViewerWriting, lastHighlightSeenAt]);

  // A1 isNew lookup — per-thread "new to me since my last room visit AND
  // not yet engaged this session." Used by V2RoomFeed for the white card
  // outline and by V2RoomMap for the white cell outline.
  //
  // 2026-05-26: switched the freshness test from
  //   createdAt > lastRoomVisitedSnapshot
  // to
  //   !prevVisibleThreadIds.has(threadId)
  // because the time-based test missed "newly-visible-to-me" entries —
  // entries that existed before my last visit but were ahead of my
  // progress then, and are visible to me now after I advanced. The
  // set-based test catches both "brand-new since last visit" and
  // "newly-revealed by progress advance" under one rule. On a first
  // ever visit, the set is empty so all visible entries flag as new
  // (same noise level as the old createdAt > 0 behavior).
  const isNewMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    if (!profile?.username) return out;
    const prevSet = prevVisibleThreadIdsRef.current;
    for (const entry of feedEntries) {
      if (entry.isDeleted) continue;
      if (entry.authorUsername === profile.username) continue;
      if (!prevSet.has(entry.threadId) && !engagedSet.has(entry.threadId)) {
        out[entry.threadId] = true;
      }
    }
    return out;
  }, [feedEntries, engagedSet, profile?.username]);

  if (loadError) {
    return (
      <V2Layout palette="room">
        <div className="muted" style={{ padding: 32, textAlign: "center" }}>
          {loadError}
        </div>
      </V2Layout>
    );
  }

  if (loading || !room || !show) {
    return (
      <V2Layout palette="room">
        <div className="muted" style={{ padding: 32, textAlign: "center" }}>
          Loading
          <LoadingDots />
        </div>
      </V2Layout>
    );
  }

  return (
    <V2Layout palette="room" bareMain>
      <div
        style={{
          minHeight: "100vh",
          // Padding-bottom moved INSIDE the left pane (see below) so the
          // two-pane container extends to the page bottom — the right pane
          // (alignSelf: stretch) inherits that height, keeping the inner
          // sticky map pinned through the entire scroll. Without the move,
          // the last ~120px of page-bottom padding was OUTSIDE the right
          // pane's containing block, so sticky released as the page bottom
          // approached the sticky-top.
          padding: "calc(var(--site-header-h) + 12px) 24px 0",
        }}
      >
        {/* ── Two-pane wrapper ─────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: GAP,
            alignItems: "flex-start",
            justifyContent: "center",
            maxWidth: 1400,
            margin: "0 auto",
          }}
        >
          {/* ── LEFT/CENTER pane: banner + feed ──────────────────────────
              paddingBottom: 120 — visual breathing space below the last
              entry. Lives on THIS pane (not the outer wrapper) so the
              two-pane container extends through it, letting the sticky
              map stay pinned all the way to the page bottom. */}
          <div style={{ flex: `0 1 ${FEED_MAX_W}px`, minWidth: 0, paddingBottom: 120 }}>
            {/* Banner row 1 — eyebrow + room name + settings gear (left)
                + "to public conversation" globe button (right). Matches V1
                public-space's `.bannerRow1` layout: flex / align-items:
                flex-end / justify-content: space-between, so the icon
                button baseline-aligns with the title row. */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 16,
                padding: "8px 0",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", flex: "0 1 auto", minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    lineHeight: 1.2,
                    color: "var(--dos-light)",
                    marginLeft: 28,
                  }}
                >
                  your friend room:
                </div>
                <div style={{ display: "inline-flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
                  <span
                    className="bannerTitle editorial"
                    style={{
                      fontSize: 34,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      lineHeight: 1.05,
                      color: "var(--dos-light)",
                      userSelect: "none",
                      minWidth: 0,
                      overflowWrap: "break-word",
                      display: "inline-flex",
                      alignItems: "flex-start",
                      gap: 6,
                    }}
                  >
                    <Users size={22} color="var(--dos-light)" style={{ flexShrink: 0, marginTop: 7 }} />
                    {room.name.toUpperCase()}
                  </span>
                  <span
                    onClick={() => setSettingsOpen(true)}
                    title="Room settings"
                    style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", marginTop: 8, flexShrink: 0 }}
                  >
                    <Settings size={20} color="#fff" />
                  </span>
                </div>
              </div>
              {/* Public-rooms scope (2026): the old "to public conversation"
                  link to the show-wide public aggregate was removed. The
                  aggregate is no longer a navigable destination; a member's
                  public writing lives in their own public room, reached from
                  their profile. */}
            </div>

            {/* Banner row 2 — write button + sort + watch-progress */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "8px 0 16px",
              }}
            >
              <button
                className="btn post"
                onClick={handleWrite}
                style={{ lineHeight: 1.2, display: "inline-flex", alignItems: "center", gap: 5 }}
                title="Start a new post"
              >
                <SquarePen size={15} /> write
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  {/* Single dropdown encodes both sort + user-filter state.
                      Values are namespaced: "sort:<asc|desc>" or
                      "user:<userId>". Picking either sort option clears
                      any active user filter (= all members); picking a
                      specific member sets the filter and the feed forces
                      to desc sort in render, per spec. */}
                  <select
                    className="badge h40"
                    value={userFilter ? `user:${userFilter}` : `sort:${sortOrder}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("sort:")) {
                        setSortOrder(v.slice(5) as "asc" | "desc");
                        setUserFilter(null);
                      } else if (v.startsWith("user:")) {
                        setUserFilter(v.slice(5));
                      }
                    }}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      paddingRight: 28,
                      appearance: "none",
                      WebkitAppearance: "none",
                      cursor: "pointer",
                      color: "var(--dos-border)",
                    }}
                  >
                    <optgroup label="Sort">
                      <option value="sort:desc">newest first</option>
                      <option value="sort:asc">oldest first</option>
                    </optgroup>
                    {mapMembers.length > 0 && (
                      <optgroup label="Filter by member">
                        {/* No "all members" option — picking either Sort
                            entry exits filter mode (ordering by newest /
                            oldest IS the all-members view). */}
                        {mapMembers.map((m) => (
                          <option key={m.userId} value={`user:${m.userId}`}>
                            only @{m.username}{m.isDeparted ? " (left)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <ChevronDown
                    size={14}
                    color="var(--dos-border)"
                    style={{ position: "absolute", right: 10, pointerEvents: "none" }}
                  />
                </div>
                <OneSelectProgress
                  show={show}
                  value={eff || { s: 1, e: 1 }}
                  onConfirm={handleProgressConfirm}
                  onForwardPick={handleForwardPick}
                  requireConfirm={true}
                  allowZero={eff?.s === 0}
                  rewatchHighest={
                    progressForShow?.isRewatching &&
                    progressForShow.highestS != null &&
                    progressForShow.highestE != null
                      ? { s: progressForShow.highestS, e: progressForShow.highestE }
                      : null
                  }
                />
              </div>
            </div>

            {/* ── Feed ─────────────────────────────────────────────── */}
            {(() => {
              // Apply user filter at the page level so the empty-state
              // check reflects the filtered view, not the underlying feed.
              // When a user filter is active, force descending sort
              // (newest episode first) per the odds-and-ends spec.
              const visibleEntries = userFilter
                ? feedEntries.filter((e) => e.authorId === userFilter)
                : feedEntries;
              const effectiveSortOrder = userFilter ? "desc" : sortOrder;
              if (visibleEntries.length === 0) {
                const filteredUsername = userFilter
                  ? mapMembers.find((m) => m.userId === userFilter)?.username
                  : null;
                return (
                  <div className="muted" style={{ fontSize: 14, padding: "48px 0", textAlign: "center" }}>
                    {filteredUsername
                      ? `Nothing from @${filteredUsername} at your progress yet.`
                      : "Nothing visible at your progress yet."}
                  </div>
                );
              }
              return (
              <V2RoomFeed
                ref={feedRef}
                entries={visibleEntries}
                sortOrder={effectiveSortOrder}
                groupId={groupId}
                viewerProgress={progressForShow}
                userId={user?.id ?? ""}
                onThreadEdited={handleThreadEdited}
                onThreadDeleted={handleThreadDeleted}
                onVisibleEntriesChange={setVisibleEntryIds}
                onClickProfile={handleClickProfile}
                onEntryExpanded={handleEntryExpanded}
                onEntryCollapsed={handleEntryCollapsed}
                isNewMap={isNewMap}
                cellSignals={cellSignals}
                engagedThreadIds={engagedSet}
                initialExpandedThreadId={initialExpandThreadId ?? undefined}
                initialFocusReplyId={initialFocusReplyId ?? undefined}
                onReplyAdded={(tid) =>
                  setFeedEntries((prev) =>
                    prev.map((e) => (e.threadId === tid ? { ...e, replyCount: e.replyCount + 1 } : e)),
                  )
                }
              />
              );
            })()}
          </div>

          {/* ── RIGHT pane: map ──────────────────────────────────────────
              Two-level wrapping so the map STAYS pinned to the viewport
              throughout a feed-driven page scroll:
                • Outer wrapper: alignSelf:"stretch" forces it to the full
                  two-pane-container height (= feed height). This is the
                  sticky element's CONTAINING BLOCK — needs to be tall, or
                  sticky releases as soon as the parent's bottom reaches
                  sticky-top in viewport coords. The previous single-level
                  wrapper used alignSelf:"flex-start", sizing it to just
                  the map's height, which made sticky release almost
                  immediately on scroll (~symptom users saw: map "pushed
                  up" by page scroll).
                • Inner sticky: top: calc(--site-header-h + 60px). Pinned
                  to viewport throughout. Transform sits on the inner
                  too so it doesn't bias containing-block resolution. */}
          <div
            style={{
              flex: "0 0 auto",
              alignSelf: "stretch",
            }}
          >
            <div
              style={{
                position: "sticky",
                top: "calc(var(--site-header-h) + 60px)",
              }}
            >
            <V2RoomMap
              members={mapMembers}
              seasons={show.seasons}
              viewerProgress={progressForShow}
              viewerUserId={user?.id}
              visibleEntryIds={visibleEntryIds}
              groupId={groupId}
              onEntryClick={handleCellClick}
              onRateOwnCell={handleRateOwnCell}
              onPollOpened={() => setPollRefreshKey((k) => k + 1)}
              cellSignals={cellSignals}
              onDismissRedDot={handleDismissRedDot}
              isNewMap={isNewMap}
              firstHighlightedSet={firstHighlightedSet}
              onCommitRatings={handleCommitRatings}
              filteredUserId={userFilter}
            />
            </div>
          </div>
        </div>
      </div>

      {settingsOpen && (
        <V2GroupSettingsModal
          room={room}
          onClose={() => setSettingsOpen(false)}
          onLeft={() => {
            setSettingsOpen(false);
            navigate("/journal");
          }}
          onRenamed={(newName) => {
            setRoom((prev) => (prev ? { ...prev, name: newName } : prev));
          }}
        />
      )}

      {pendingRating && (
        <RatingCaptureModal
          season={pendingRating.s}
          episode={pendingRating.e}
          onCommit={handleRatingCommit}
          onCancel={handleRatingCancel}
        />
      )}

      {/* Receive-side stickies — port of v1 ShowSection's friend-room
          chrome. All three self-render as fixed-position elements (no
          layout participation here); they manage their own visibility
          gates (e.g. PollSticky hides when there's no active poll).
          IncomingPingSticky surfaces pings sent TO the viewer; pings
          render on top of the map per spec ("charming marginalia"). */}
      {user && (
        <>
          <IncomingPingSticky groupId={groupId} currentUserId={user.id} />
          <PollSticky
            groupId={groupId}
            currentUserId={user.id}
            refreshKey={pollRefreshKey}
          />
          {show && (
            <SIKWSticky
              groupId={groupId}
              currentUserId={user.id}
              seasons={show.seasons}
            />
          )}
        </>
      )}
    </V2Layout>
  );
}
