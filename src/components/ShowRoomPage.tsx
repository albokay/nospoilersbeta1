/**
 * ShowRoomPage — the restructure (group × show) room (CP4a).
 *
 * Two tabs (friend room / private writing), reusing V2RoomFeed / V2RoomMap for
 * the friend feed + season map + dice + nudges. "write" opens the existing
 * ComposeForm, constrained (restrictGroupId) to THIS friend room + private —
 * no public, no other groups. Mounted at /show-room/:roomId; legacy
 * /room/:groupId (V2FriendRoomPage) is left untouched.
 *
 * Deferred to CP4b (inline): rating capture (read-only dice for now), the
 * dashboard private-only standalone, the in-room progress picker, notification
 * dots, polls/SIKW/highlights stickies.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, SquarePen, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import {
  fetchShows, fetchProgress, fetchRoomMapData, fetchGroupThreads, fetchUserThreads,
  persistProgressUpdate, upsertEpisodeRating, deleteEpisodeRating, markRoomSeen,
  fetchHighlights,
  type Show,
} from "../lib/db";
import { effectiveProgress } from "../lib/utils";
import type { Thread, ProgressEntry } from "../types";
import V2RoomFeed, { type V2RoomFeedEntry, type V2RoomFeedHandle } from "./v2/V2RoomFeed";
import V2RoomMap, { type V2RoomMapMember } from "./v2/V2RoomMap";
import ComposeForm, { type ComposeFormHandle } from "./v2/ComposeForm";
import OneSelectProgress from "./OneSelectProgress";
import RatingCaptureModal from "./RatingCaptureModal";
import SidebarLogo from "./SidebarLogo";
import IncomingPingSticky from "./IncomingPingSticky";
import PollSticky from "./PollSticky";
import SIKWSticky from "./SIKWSticky";

const C = { green: "#7ABD8E", sky: "#ADC8D7", blue: "#355EB8", yellow: "#DEA838", cream: "#FEF8EA", midnight: "#1A3A4A" };
const LORA = '"Lora", Georgia, serif';
const HEADER_H = 92;
type Tab = "friend" | "private";

export default function ShowRoomPage({ roomId, privateShowId }: { roomId?: string; privateShowId?: string }) {
  // Private-only standalone (dashboard "write by yourself"): no group/room,
  // just the viewer's private writing for a show. Group-independent.
  const privateOnly = !!privateShowId && !roomId;
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // CP7: digest-email deep-links arrive as /show-room/<id>?entry=<threadId>
  // (and the legacy /room/<id>?entry= redirect preserves it). Read once on
  // mount and hand it to the friend feed, which auto-expands + scrolls to that
  // post — same pattern the legacy room used. Router state wins for in-app
  // navigations that can carry it; the query param covers plain email URLs.
  const [initialExpandThreadId] = useState<string | null>(
    () =>
      (location.state as { expandThreadId?: string } | null)?.expandThreadId ??
      new URLSearchParams(location.search).get("entry") ??
      null,
  );
  const feedRef = useRef<V2RoomFeedHandle>(null);
  const composeFormRef = useRef<ComposeFormHandle>(null);
  const pageRef = useRef<HTMLDivElement>(null); // the fixed scroll container

  const [show, setShow] = useState<Show | null>(null);
  const [parentGroupId, setParentGroupId] = useState<string | null>(null);
  const [progressForShow, setProgressForShow] = useState<ProgressEntry | null>(null);
  const [feedEntries, setFeedEntries] = useState<V2RoomFeedEntry[]>([]);
  const [mapMembers, setMapMembers] = useState<V2RoomMapMember[]>([]);
  const [privateEntries, setPrivateEntries] = useState<Thread[]>([]);
  const [tab, setTab] = useState<Tab>(privateOnly ? "private" : "friend");
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);

  // CP4b: progress picker + rating capture.
  const [pendingRating, setPendingRating] = useState<{ s: number; e: number } | null>(null);
  const ratingTimersRef = useRef<Record<string, number>>({});

  // ── In-room notification-signal state (ported from V2FriendRoomPage) ──────
  // Green (new visible responses since you last opened the entry), yellow
  // (unseen highlight on your writing), red (own-entry hidden responses), and
  // the white "new since last visit" outline. localStorage-backed where the
  // live room is, with room-scoped keys.
  const prevVisibleThreadIdsRef = useRef<Set<string>>(new Set());
  const [visibleEntryIds, setVisibleEntryIds] = useState<Set<string>>(new Set());
  const [lastOpenedAt, setLastOpenedAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_last_opened") || "{}"); } catch { return {}; }
  });
  const [perThreadLatestReply, setPerThreadLatestReply] = useState<Record<string, number>>({});
  const [perThreadHiddenCount, setPerThreadHiddenCount] = useState<Record<string, number>>({});
  const [perThreadLatestHidden, setPerThreadLatestHidden] = useState<Record<string, number>>({});
  const [engagedSet, setEngagedSet] = useState<Set<string>>(new Set());
  const [greenDismissedSet, setGreenDismissedSet] = useState<Set<string>>(new Set());
  const [redDismissedAt, setRedDismissedAt] = useState<Record<string, number>>({});
  const [firstHighlightedSet, setFirstHighlightedSet] = useState<Set<string>>(new Set());
  const [latestHighlightOnViewerWriting, setLatestHighlightOnViewerWriting] = useState<Record<string, number>>({});
  const [lastHighlightSeenAt, setLastHighlightSeenAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_highlight_seen") || "{}"); } catch { return {}; }
  });
  // Poll launcher refresh + feed sort / member filter (parity with live room).
  const [pollRefreshKey, setPollRefreshKey] = useState(0);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [userFilter, setUserFilter] = useState<string | null>(null);

  // The reused V2 feed/map expect the group-context palette.
  useEffect(() => {
    document.body.classList.add("group-context");
    return () => { document.body.classList.remove("group-context"); };
  }, []);

  // Capture the set of entry ids that were visible to me at my LAST visit (for
  // the white "new since last visit" outline). Captured once per room; the
  // fresh set is written by the effect below after feedEntries loads.
  useEffect(() => {
    if (privateOnly || !roomId || !user?.id) return;
    const vKey = `ns_room_visible_threads_${user.id}_${roomId}`;
    try {
      const v = localStorage.getItem(vKey);
      prevVisibleThreadIdsRef.current = v ? new Set(JSON.parse(v)) : new Set();
    } catch { prevVisibleThreadIdsRef.current = new Set(); }
  }, [user?.id, roomId, privateOnly]);

  useEffect(() => {
    if (privateOnly || !roomId || !user?.id) return;
    const vKey = `ns_room_visible_threads_${user.id}_${roomId}`;
    const ids = feedEntries.filter((e) => !e.isDeleted).map((e) => e.threadId);
    try { localStorage.setItem(vKey, JSON.stringify(ids)); } catch { /* ignore quota */ }
  }, [user?.id, roomId, privateOnly, feedEntries]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Private-only standalone: no group/room — load show + progress + the
      // viewer's private threads only.
      if (privateOnly && privateShowId) {
        const [allShows, progressMap] = await Promise.all([fetchShows(), fetchProgress(user.id)]);
        const mine = await fetchUserThreads(user.id, privateShowId);
        setShow(allShows.find((s) => s.id === privateShowId) ?? null);
        setProgressForShow(progressMap[privateShowId] ?? null);
        setPrivateEntries(mine.filter((x) => !x.thread.isPublic && !x.groupId).map((x) => x.thread));
        setParentGroupId(null);
        setFeedEntries([]);
        setMapMembers([]);
        return;
      }
      if (!roomId) return;
      const { data: roomRow, error: roomErr } = await supabase
        .from("friend_groups")
        .select("id, show_id, parent_group_id, deleted_at")
        .eq("id", roomId)
        .maybeSingle();
      if (roomErr) throw roomErr;
      if (!roomRow || roomRow.deleted_at) throw new Error("room not found");
      const showId = roomRow.show_id as string;
      setParentGroupId(roomRow.parent_group_id ?? null);
      // Entering the room clears its new-activity dot on the dashboard/group view.
      markRoomSeen(roomId).catch(() => { /* tolerate (migration not applied) */ });

      const [allShows, progressMap, roomMapData] = await Promise.all([
        fetchShows(), fetchProgress(user.id), fetchRoomMapData(roomId),
      ]);
      const showRow = allShows.find((s) => s.id === showId) ?? null;
      const progress = progressMap[showId] ?? null;
      const eff = effectiveProgress(progress);

      const empty = { threads: [] as Thread[], replyCounts: {} as Record<string, number>, aheadCounts: {} as Record<string, number>, sharedAt: {} as Record<string, number>, latestVisibleReplyAt: {} as Record<string, number>, hiddenCounts: {} as Record<string, number>, latestHiddenReplyAt: {} as Record<string, number> };
      const gr: any = eff ? await fetchGroupThreads(roomId, eff.s, eff.e, user.id) : empty;

      const departed = new Set(roomMapData.filter((m) => m.isDeparted).map((m) => m.username ?? "").filter(Boolean));
      const u2id: Record<string, string> = {};
      for (const m of roomMapData) if (m.username) u2id[m.username] = m.userId;

      const entries: V2RoomFeedEntry[] = gr.threads.map((t: Thread) => ({
        threadId: t.id, s: t.season, e: t.episode, title: t.titleBase, body: t.body, preview: t.preview,
        authorId: u2id[t.author] ?? "", authorUsername: t.author,
        isRewatch: t.isRewatch, rewatchS: t.rewatchS, rewatchE: t.rewatchE, isEdited: t.isEdited,
        isDeparted: departed.has(t.author), isDeleted: t.isDeleted ?? false,
        updatedAt: gr.sharedAt?.[t.id] || t.updatedAt,
        replyCount: (gr.replyCounts[t.id] ?? 0) + (gr.aheadCounts?.[t.id] ?? 0),
        thread: t,
      }));

      const members: V2RoomMapMember[] = roomMapData.map((m) => ({
        userId: m.userId, username: m.username ?? "?", isDeparted: m.isDeparted,
        progress: m.progress, ratings: m.ratings,
        entries: m.entries.map((e) => ({ threadId: e.threadId, s: e.s, e: e.e, title: e.title })),
      }));

      const mine = await fetchUserThreads(user.id, showId);
      const priv = mine.filter((x) => !x.thread.isPublic && !x.groupId).map((x) => x.thread);

      setShow(showRow);
      setProgressForShow(progress);
      setFeedEntries(entries);
      setMapMembers(members);
      setPrivateEntries(priv);
      // Per-thread freshness data driving the map notification signals.
      setPerThreadLatestReply(gr.latestVisibleReplyAt ?? {});
      setPerThreadHiddenCount(gr.hiddenCounts ?? {});
      setPerThreadLatestHidden(gr.latestHiddenReplyAt ?? {});
      // Hydrate manual red-dot dismissals from localStorage (persist across sessions).
      const dismisses: Record<string, number> = {};
      for (const t of gr.threads as Thread[]) {
        const v = localStorage.getItem(`ns_tdot_dismiss_${t.id}`);
        if (v) dismisses[t.id] = parseInt(v, 10);
      }
      setRedDismissedAt(dismisses);
    } catch (e) {
      console.error("[show-room] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [roomId, privateShowId, privateOnly, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/", { replace: true }); return; }
    load();
  }, [authLoading, user, load, navigate]);

  // × closes the room → back to the group it belongs to (sky group context).
  function closeRoom() {
    navigate(parentGroupId ? `/dashboard?g=${parentGroupId}` : "/dashboard");
  }

  // ── CP4b: progress picker → rating-capture (forward) / confirm (backward) ──
  // Forward pick → rate the episode you finished, then advance + refetch
  // (the feed re-filters to the newly-visible episodes).
  function onForwardPick(val: { s: number; e: number }) { setPendingRating(val); }

  async function commitRating(rating: number) {
    if (!user || !show || !pendingRating) return;
    const target = pendingRating;
    setPendingRating(null);
    upsertEpisodeRating({ userId: user.id, showId: show.id, season: target.s, episode: target.e, rating })
      .catch((e) => console.warn("rating upsert failed", e));
    try {
      await persistProgressUpdate(user.id, show.id, progressForShow ?? undefined, target);
    } catch (e) { console.warn("progress write failed", e); }
    await load();
  }

  async function onProgressConfirm(val: { s: number; e: number }) {
    if (!user || !show) return;
    try { await persistProgressUpdate(user.id, show.id, progressForShow ?? undefined, val); }
    catch (e) { console.warn("progress write failed", e); }
    await load();
  }

  // "skip rating": commit the progress advance for the pending episode but
  // don't write a rating.
  async function skipRating() {
    if (!user || !show || !pendingRating) return;
    const target = pendingRating;
    setPendingRating(null);
    try { await persistProgressUpdate(user.id, show.id, progressForShow ?? undefined, target); }
    catch (e) { console.warn("progress write failed", e); }
    await load();
  }

  // Click-to-rate a self map cell: optimistic update + debounced write.
  function rateOwnCell(season: number, episode: number, newRating: number | null) {
    if (!user || !show) return;
    setMapMembers((prev) => prev.map((m) => {
      if (m.userId !== user.id) return m;
      if (newRating === null) return { ...m, ratings: m.ratings.filter((r) => !(r.s === season && r.e === episode)) };
      const idx = m.ratings.findIndex((r) => r.s === season && r.e === episode);
      const ratings = idx >= 0 ? m.ratings.map((r, i) => (i === idx ? { ...r, rating: newRating } : r)) : [...m.ratings, { s: season, e: episode, rating: newRating }];
      return { ...m, ratings };
    }));
    const key = `${season}-${episode}`;
    if (ratingTimersRef.current[key]) window.clearTimeout(ratingTimersRef.current[key]);
    ratingTimersRef.current[key] = window.setTimeout(() => {
      const op = newRating === null
        ? deleteEpisodeRating({ userId: user.id, showId: show.id, season, episode })
        : upsertEpisodeRating({ userId: user.id, showId: show.id, season, episode, rating: newRating });
      op.catch((e) => console.warn("rating write failed", e));
      delete ratingTimersRef.current[key];
    }, 500);
  }

  async function commitRatings(changes: { s: number; e: number; rating: number | null }[]): Promise<{ ok: boolean }> {
    if (!user || !show) return { ok: false };
    if (!changes.length) return { ok: true };
    try {
      await Promise.all(changes.map((c) => c.rating === null
        ? deleteEpisodeRating({ userId: user.id, showId: show.id, season: c.s, episode: c.e })
        : upsertEpisodeRating({ userId: user.id, showId: show.id, season: c.s, episode: c.e, rating: c.rating })));
      await load();
      return { ok: true };
    } catch (e) { console.warn("batch rating commit failed", e); return { ok: false }; }
  }

  // ── Yellow-highlight signal data: highlights on the viewer's own writing
  //    (entry or reply) by other users, that the viewer hasn't seen. ──────────
  useEffect(() => {
    if (privateOnly || !roomId || !user?.id || feedEntries.length === 0) {
      setLatestHighlightOnViewerWriting({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const entryIds = feedEntries.map((e) => e.threadId);
        const { data: viewerReplyRows } = await supabase
          .from("replies").select("id, thread_id").eq("group_id", roomId).eq("author_id", user.id);
        const allViewerReplyIds = (viewerReplyRows ?? []).map((r: any) => r.id);
        const [entryHL, replyHL] = await Promise.all([
          fetchHighlights({ targetType: "thread", targetIds: entryIds, viewerProgress: progressForShow ?? undefined }),
          allViewerReplyIds.length > 0
            ? fetchHighlights({ targetType: "reply", targetIds: allViewerReplyIds, viewerProgress: progressForShow ?? undefined })
            : Promise.resolve([]),
        ]);
        const latest: Record<string, number> = {};
        const viewerUsername = profile?.username ?? null;
        const isViewerEntry: Record<string, boolean> = {};
        for (const e of feedEntries) isViewerEntry[e.threadId] = !!viewerUsername && e.authorUsername === viewerUsername;
        for (const h of entryHL) {
          if (!isViewerEntry[h.targetId] || h.authorId === user.id) continue;
          if (h.createdAt > (latest[h.targetId] ?? 0)) latest[h.targetId] = h.createdAt;
        }
        const replyToThread: Record<string, string> = {};
        for (const r of viewerReplyRows ?? []) replyToThread[r.id] = r.thread_id;
        for (const h of replyHL) {
          if (h.authorId === user.id) continue;
          const tid = replyToThread[h.targetId];
          if (tid && h.createdAt > (latest[tid] ?? 0)) latest[tid] = h.createdAt;
        }
        if (!cancelled) setLatestHighlightOnViewerWriting(latest);
      } catch (err) { console.warn("highlight-signal fetch failed:", err); }
    })();
    return () => { cancelled = true; };
  }, [user?.id, roomId, privateOnly, feedEntries, progressForShow, profile?.username]);

  // ── Per-entry map signal (precedence GREEN > YELLOW > RED, one per cell) ────
  const cellSignals = useMemo(() => {
    const out: Record<string, { kind: "green" | "yellow" | "red"; redCount?: number }> = {};
    for (const entry of feedEntries) {
      if (entry.isDeleted) continue;
      const tid = entry.threadId;
      const isOwn = !!profile?.username && entry.authorUsername === profile.username;
      // Green = a new reply since you last opened it, but ONLY on your OWN
      // entries ("someone replied to your writing"). It must not fire on other
      // members' cells — the map's own contract is green/red are own-column
      // only; others' brand-new entries surface via the white "new" outline.
      if (isOwn && (perThreadLatestReply[tid] ?? 0) > (lastOpenedAt[tid] ?? 0)) { out[tid] = { kind: "green" }; continue; }
      if ((latestHighlightOnViewerWriting[tid] ?? 0) > (lastHighlightSeenAt[tid] ?? 0)) { out[tid] = { kind: "yellow" }; continue; }
      const hiddenCount = perThreadHiddenCount[tid] ?? 0;
      const dismissedAt = redDismissedAt[tid] ?? 0;
      const manuallyDismissed = dismissedAt > 0 && dismissedAt >= (perThreadLatestHidden[tid] ?? 0);
      if (isOwn && hiddenCount > 0 && !greenDismissedSet.has(tid) && !manuallyDismissed) {
        out[tid] = { kind: "red", redCount: hiddenCount };
      }
    }
    return out;
  }, [feedEntries, perThreadLatestReply, lastOpenedAt, perThreadHiddenCount, perThreadLatestHidden, greenDismissedSet, redDismissedAt, profile?.username, latestHighlightOnViewerWriting, lastHighlightSeenAt]);

  // ── White "new since last visit" outline (others' entries, not yet engaged) ─
  const isNewMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    if (!profile?.username) return out;
    const prevSet = prevVisibleThreadIdsRef.current;
    for (const entry of feedEntries) {
      if (entry.isDeleted || entry.authorUsername === profile.username) continue;
      if (!prevSet.has(entry.threadId) && !engagedSet.has(entry.threadId)) out[entry.threadId] = true;
    }
    return out;
  }, [feedEntries, engagedSet, profile?.username]);

  // ── Signal-clearing handlers (ported) ──────────────────────────────────────
  const handleEntryExpanded = useCallback((threadId: string) => {
    const latestSeenAt = perThreadLatestReply[threadId] ?? 0;
    const wasGreen = latestSeenAt > (lastOpenedAt[threadId] ?? 0);
    setLastOpenedAt((prev) => {
      const next = { ...prev, [threadId]: latestSeenAt };
      try { localStorage.setItem("ns_last_opened", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    const nowMs = Date.now();
    setLastHighlightSeenAt((prev) => {
      const next = { ...prev, [threadId]: nowMs };
      try { localStorage.setItem("ns_highlight_seen", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    if (wasGreen) setGreenDismissedSet((prev) => (prev.has(threadId) ? prev : new Set(prev).add(threadId)));
    setEngagedSet((prev) => (prev.has(threadId) ? prev : new Set(prev).add(threadId)));
  }, [perThreadLatestReply, lastOpenedAt]);

  const handleEntryCollapsed = useCallback((threadId: string) => {
    setEngagedSet((prev) => (prev.has(threadId) ? prev : new Set(prev).add(threadId)));
  }, []);

  const handleDismissRedDot = useCallback((threadId: string) => {
    const now = Date.now();
    try { localStorage.setItem(`ns_tdot_dismiss_${threadId}`, String(now)); } catch { /* ignore */ }
    setRedDismissedAt((prev) => ({ ...prev, [threadId]: now }));
  }, []);

  // Map cell click: scroll the feed to the entry + register the first-highlight
  // (so a self-cell with a notification highlights before it rotates a rating).
  const handleCellClick = useCallback((threadId: string) => {
    feedRef.current?.scrollToEntry(threadId);
    setFirstHighlightedSet((prev) => (prev.has(threadId) ? prev : new Set(prev).add(threadId)));
  }, []);

  // Edit/delete reflect in the feed without a refetch (parity with live room).
  const handleThreadEdited = useCallback((updated: Thread) => {
    setFeedEntries((prev) => prev.map((e) => (e.threadId === updated.id ? {
      ...e, title: updated.titleBase, body: updated.body, preview: updated.preview,
      s: updated.season, e: updated.episode, isEdited: updated.isEdited, thread: updated,
    } : e)));
  }, []);
  const handleThreadDeleted = useCallback((threadId: string) => {
    setFeedEntries((prev) => {
      const entry = prev.find((e) => e.threadId === threadId);
      if (!entry) return prev;
      if (entry.replyCount === 0) return prev.filter((e) => e.threadId !== threadId);
      return prev.map((e) => (e.threadId === threadId ? { ...e, isDeleted: true, thread: { ...e.thread, isDeleted: true } } : e));
    });
  }, []);

  // Username byline click → that person's public dashboard (read-only pool),
  // not the old profile.
  const handleClickProfile = useCallback((username: string) => {
    navigate(`/pool/${encodeURIComponent(username)}`);
  }, [navigate]);

  if (authLoading || loading) {
    return <div style={{ ...page, background: C.green }} aria-busy="true" />;
  }

  const bodyBg = tab === "friend" ? C.sky : C.green;

  // Private entries rendered through the same V2RoomFeed as the friend feed so
  // the cards have identical mechanics (expand/collapse, star, edit/delete).
  // No groupId → public-conversation mode (these are the viewer's own private
  // threads; nobody else can see them).
  // Member filter: restrict the friend feed to one author (dims the others'
  // map columns via filteredUserId); sort forced to desc while filtering.
  const visibleFriendEntries = userFilter ? feedEntries.filter((e) => e.authorId === userFilter) : feedEntries;
  const effectiveSortOrder = userFilter ? "desc" : sortOrder;

  const privateFeedEntries: V2RoomFeedEntry[] = privateEntries.map((t) => ({
    threadId: t.id, s: t.season, e: t.episode, title: t.titleBase, body: t.body, preview: t.preview,
    authorId: user?.id ?? "", authorUsername: t.author,
    isRewatch: t.isRewatch, rewatchS: t.rewatchS, rewatchE: t.rewatchE, isEdited: t.isEdited,
    isDeparted: false, isDeleted: t.isDeleted ?? false,
    updatedAt: t.updatedAt, replyCount: 0, thread: t,
  }));

  return (
    <div ref={pageRef} style={{ ...page, background: bodyBg }}>
      {/* ── Back-to-group tab — partial pill at the left edge (mirrors chat) ── */}
      <button style={backTab} title={privateOnly ? "back to dashboard" : "back to group"} onClick={closeRoom}>
        <ArrowLeft size={24} color={C.green} />
      </button>

      {/* ── Header strip: logo left · centered name · tabs on the boundary.
            Header + body colors swap by mode: friend = green header / sky body,
            private = sky header / green body (the inactive tab shows through). ── */}
      <div style={{ position: "relative", background: tab === "friend" ? C.green : C.sky, height: HEADER_H }}>
        <div style={{ position: "absolute", left: 20, top: 12 }}><SidebarLogo scale={0.45} blocksOpacity={1} /></div>

        <div style={{ position: "absolute", left: "50%", top: 18, transform: "translateX(-50%)" }}>
          <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: -1, color: C.cream, margin: 0 }}>{show?.name ?? "Show"}</h1>
        </div>

        <div style={{ position: "absolute", left: 160, bottom: 0, display: "flex", alignItems: "flex-end", gap: 6 }}>
          {!privateOnly && <RoomTab label="friend room" active={tab === "friend"} bg={C.sky} onClick={() => setTab("friend")} />}
          <RoomTab label="private writing" active={tab === "private"} bg={C.green} onClick={() => setTab("private")} />
        </div>
      </div>

      {/* ── Two-pane body — mirrors the live room (V2FriendRoomPage): a 672px
            feed column + season map, the pair centered within a 1400 max width.
            Write + progress live at the top of the column. The private tab
            reuses the same column at the same position; the map area is kept
            (visibility:hidden) so the column doesn't shift between tabs. ── */}
      <div style={{ padding: "24px 24px 0" }}>
        <div style={{ display: "flex", gap: 64, alignItems: "flex-start", justifyContent: "center", maxWidth: 1400, margin: "0 auto" }}>
          {/* LEFT/CENTER pane: toolbar + feed (friend) or private writing */}
          <div style={{ flex: "0 1 672px", minWidth: 0, paddingBottom: 120 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button style={writeBtn} onClick={() => setComposeOpen(true)}><SquarePen size={16} /> write</button>
                {tab === "friend" && !privateOnly && feedEntries.length > 0 && (
                  <select
                    value={userFilter ? `user:${userFilter}` : `sort:${sortOrder}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("sort:")) { setSortOrder(v.slice(5) as "asc" | "desc"); setUserFilter(null); }
                      else if (v.startsWith("user:")) setUserFilter(v.slice(5));
                    }}
                    style={sortSelect}
                  >
                    <optgroup label="Sort">
                      <option value="sort:desc">episode order</option>
                    </optgroup>
                    {mapMembers.length > 0 && (
                      <optgroup label="Filter by member">
                        {mapMembers.map((m) => (
                          <option key={m.userId} value={`user:${m.userId}`}>only @{m.username}{m.isDeparted ? " (left)" : ""}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>
              {show && progressForShow && (
                // On the private tab (green body) the default green picker
                // outline is invisible — switch it to cream there.
                <div className={tab === "private" ? "private-progress" : undefined}>
                  <OneSelectProgress
                    show={show}
                    value={effectiveProgress(progressForShow) || { s: 1, e: 1 }}
                    onConfirm={onProgressConfirm}
                    onForwardPick={onForwardPick}
                    requireConfirm
                    allowZero={(effectiveProgress(progressForShow)?.s ?? 1) === 0}
                  />
                </div>
              )}
            </div>

            {tab === "friend" ? (
              feedEntries.length === 0 ? (
                <div style={{ maxWidth: 420 }}>
                  <p style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: C.cream, margin: "16px 0 12px" }}>Be a trailblazer.</p>
                  <p style={emptyCopy}>You're the first one in here. Start writing so that your friends have your thoughts ready when they finish episodes.</p>
                  <p style={emptyCopy}>Think of it as sending them a letter from the future!</p>
                </div>
              ) : (
                <V2RoomFeed
                  ref={feedRef}
                  entries={visibleFriendEntries}
                  sortOrder={effectiveSortOrder}
                  initialExpandedThreadId={initialExpandThreadId ?? undefined}
                  scrollContainerRef={pageRef}
                  groupId={roomId}
                  viewerProgress={progressForShow}
                  userId={user?.id ?? ""}
                  onVisibleEntriesChange={setVisibleEntryIds}
                  onEntryExpanded={handleEntryExpanded}
                  onEntryCollapsed={handleEntryCollapsed}
                  onThreadEdited={handleThreadEdited}
                  onThreadDeleted={handleThreadDeleted}
                  onClickProfile={handleClickProfile}
                  isNewMap={isNewMap}
                  cellSignals={cellSignals}
                  engagedThreadIds={engagedSet}
                  onReplyAdded={(tid) => setFeedEntries((prev) => prev.map((e) => (e.threadId === tid ? { ...e, replyCount: e.replyCount + 1 } : e)))}
                />
              )
            ) : (
              <>
                {privateFeedEntries.length > 0 && (
                  <V2RoomFeed
                    entries={privateFeedEntries}
                    viewerProgress={progressForShow}
                    userId={user?.id ?? ""}
                    onThreadEdited={() => load()}
                    onThreadDeleted={() => load()}
                  />
                )}
                <div style={{ marginTop: privateFeedEntries.length ? 40 : 8 }}>
                  <p style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: C.cream, margin: "0 0 12px" }}>Sidebar is best with friends.</p>
                  <p style={{ ...emptyCopy, maxWidth: 460 }}>But you can use this private space to write drafts or to keep a personal journal. No one will see what you write here. Sometimes we do our best thinking when we write for ourselves.</p>
                </div>
              </>
            )}
          </div>

          {/* RIGHT pane: season map. Reserved but hidden on the private tab so
              the left column keeps the exact same placement across tabs.
              Omitted entirely in the private-only standalone (no group). */}
          {!privateOnly && roomId && (
            <div style={{ flex: "0 0 auto", alignSelf: "stretch", visibility: tab === "friend" ? "visible" : "hidden" }} aria-hidden={tab !== "friend"}>
              <div style={{ position: "sticky", top: 24 }}>
              <V2RoomMap
                members={mapMembers}
                seasons={show?.seasons ?? []}
                viewerProgress={progressForShow}
                viewerUserId={user?.id}
                groupId={roomId}
                visibleEntryIds={visibleEntryIds}
                onEntryClick={handleCellClick}
                onRateOwnCell={rateOwnCell}
                onCommitRatings={commitRatings}
                onPollOpened={() => setPollRefreshKey((k) => k + 1)}
                cellSignals={cellSignals}
                isNewMap={isNewMap}
                onDismissRedDot={handleDismissRedDot}
                firstHighlightedSet={firstHighlightedSet}
                filteredUserId={userFilter}
              />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Compose: the existing ComposeForm, constrained to this room + private ── */}
      {composeOpen && createPortal(
        <div style={composeBackdrop}>
          <div style={composeCardOuter}>
            <button onClick={() => composeFormRef.current?.attemptDiscard()} aria-label="Discard and close" style={composeCloseX}><X size={16} color="#f45028" /></button>
            <ComposeForm
              ref={composeFormRef}
              showId={show?.id}
              restrictGroupId={privateOnly ? undefined : roomId}
              privateOnly={privateOnly}
              // Default the destination to match the tab you wrote from:
              // friend tab → this room, private tab → private.
              defaultDestination={privateOnly ? undefined : (tab === "private" ? "private" : roomId)}
              hideTopRightClose
              onCancel={() => setComposeOpen(false)}
              onSubmitted={(destination, threadId) => {
                setComposeOpen(false);
                const toPrivate = privateOnly || destination === "private";
                setTab(toPrivate ? "private" : "friend");
                load().then(() => {
                  if (!toPrivate && threadId) setTimeout(() => feedRef.current?.expandEntry(threadId), 0);
                });
              }}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* CP4b: rate the episode you just finished (forward progress pick) */}
      {pendingRating && (
        <RatingCaptureModal
          season={pendingRating.s}
          episode={pendingRating.e}
          onCommit={commitRating}
          onCancel={() => setPendingRating(null)}
          onSkip={skipRating}
        />
      )}

      {/* Pings / polls / SIKW stickies — fixed-position, self-gating; friend
          room only (no group context in the private-only standalone). */}
      {!privateOnly && roomId && user && (
        <>
          <IncomingPingSticky groupId={roomId} currentUserId={user.id} />
          <PollSticky groupId={roomId} currentUserId={user.id} refreshKey={pollRefreshKey} />
          {show && <SIKWSticky groupId={roomId} currentUserId={user.id} seasons={show.seasons} />}
        </>
      )}
    </div>
  );
}

function RoomTab({ label, active, bg, onClick }: { label: string; active: boolean; bg: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        cursor: "pointer", padding: "6px 22px",
        borderTopLeftRadius: 14, borderTopRightRadius: 14,
        // Cream outline lives only on the deselected tab; the selected tab is
        // a clean fill that bleeds into the panel below.
        borderTop: active ? "none" : `2px solid ${C.cream}`,
        borderLeft: active ? "none" : `2px solid ${C.cream}`,
        borderRight: active ? "none" : `2px solid ${C.cream}`,
        borderBottom: "none",
        // Header 2 spec: Inter, 17px, semibold. Cream in both tab states.
        fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 600, fontSize: 17, letterSpacing: "0.005em",
        background: active ? bg : "transparent",
        color: C.cream,
        position: "relative", bottom: -2, // bleed into the panel below
      }}
    >
      {label}
    </button>
  );
}

const page: React.CSSProperties = { position: "fixed", inset: 0, overflowY: "auto", fontFamily: '"Inter", system-ui, sans-serif' };
const backTab: React.CSSProperties = {
  position: "fixed", left: 0, top: "18%", background: C.cream, border: "none", cursor: "pointer",
  borderTopRightRadius: 28, borderBottomRightRadius: 28, padding: "16px 22px 16px 14px",
  display: "inline-flex", alignItems: "center", boxShadow: "6px 6px 18px rgba(0,0,0,0.15)", zIndex: 45,
};
const writeBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, border: "none", background: C.yellow, color: "#fff",
  fontWeight: 700, fontSize: 14, padding: "12px 24px", borderRadius: 65, cursor: "pointer",
};
const sortSelect: React.CSSProperties = {
  appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
  background: "transparent", border: `2px solid ${C.cream}`, color: C.cream,
  borderRadius: 65, padding: "8px 18px", fontSize: 12, fontWeight: 700,
  fontFamily: '"Inter", system-ui, sans-serif', cursor: "pointer", outline: "none",
};
const emptyCopy: React.CSSProperties = { color: C.cream, opacity: 0.85, fontSize: 14, lineHeight: 1.5 };
const composeBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const composeCardOuter: React.CSSProperties = {
  position: "relative", width: "85vw", height: "90vh", background: C.cream,
  borderRadius: 24, boxShadow: "0 12px 36px rgba(0,0,0,0.25)", overflow: "auto",
};
const composeCloseX: React.CSSProperties = {
  position: "absolute", top: 20, right: 24, background: "transparent", border: "2px solid #f45028",
  color: "#f45028", borderRadius: "50%", width: 34, height: 34, padding: 0,
  display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16, cursor: "pointer", zIndex: 10,
};
