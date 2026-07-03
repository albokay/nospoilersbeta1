import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronUp, Settings, SquarePen, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import {
  fetchShows, refreshShowIfStale, fetchProgress, fetchRoomMapData, fetchGroupThreads, fetchUserThreads,
  persistProgressUpdate, upsertEpisodeRating, markRoomSeen,
  fetchHighlights, fetchPeopleGroupsForUser, fetchRoomDigestOptOut, setRoomDigestOptOut,
  type Show,
} from "../lib/db";
import { effectiveProgress } from "../lib/utils";
import { linearIndex } from "../lib/groupPills";
import type { Thread, ProgressEntry } from "../types";
import V2RoomFeed, { type V2RoomFeedEntry, type V2RoomFeedHandle } from "../components/v2/V2RoomFeed";
import type { V2RoomMapMember } from "../components/v2/V2RoomMap";
import ComposeForm, { type ComposeFormHandle } from "../components/v2/ComposeForm";
import OneSelectProgress from "../components/OneSelectProgress";
import RatingCaptureModal from "../components/RatingCaptureModal";
import { CANON } from "../styles/canon";

/**
 * MobileShowRoom (CP6) — a single show's feed, the deepest drill-down level.
 * Mobile re-expression of the desktop ShowRoomPage: same loads (room row →
 * fetchRoomMapData + fetchGroupThreads at the viewer's effective progress),
 * same two tabs (friend room / private writing), same private-only standalone
 * variant (dashboard "write by yourself"), REUSING the shared restructure
 * components: V2RoomFeed (tickets, tap-to-expand threads, inline respond /
 * edit / delete, invisible-response stubs), ComposeForm (full-screen here
 * instead of desktop's centered card), OneSelectProgress + RatingCaptureModal
 * (rating capture on forward progress — the ONLY rating affordance on mobile).
 *
 * Per the mobile rebuild spec:
 *   • SEASON MAP CUT — replaced by an expandable ROSTER dropdown at the top:
 *     collapsed = member count + avatars; expanded = every member INCLUDING
 *     the viewer, ordered by watch progress, raw S/E (no relative math).
 *   • Notification signals are the VISIBLE-writing subset: white "new since
 *     last visit" outline (newly-visible entry), green (new response on your
 *     entry), yellow (new highlight on your writing). The RED invisible-
 *     writing layer is cut — its state isn't computed here at all. Same
 *     localStorage keys as desktop, so seen-state stays consistent across
 *     surfaces.
 *   • Pings / polls / SIKW stickies: cut (no launchers, no receive-side).
 *   • Digest deep-links (?entry=) land here cold: the feed auto-expands the
 *     entry, and back walks up the real stack (group room → dashboard).
 *   • Member-name clicks (desktop → /pool/:username) are deferred — the
 *     read-only pool page has no mobile surface yet (CP8 decision).
 */

const C = { green: CANON.personal, sky: CANON.friend, blue: CANON.identity, yellow: CANON.accent, red: CANON.alert, cream: CANON.cream, midnight: CANON.dark, greyblue: CANON.business };
const LORA = '"Lora", Georgia, serif';
type Tab = "friend" | "private";

export default function MobileShowRoom({ roomId, privateShowId }: { roomId?: string; privateShowId?: string }) {
  const privateOnly = !!privateShowId && !roomId;
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Digest deep-links arrive as ?entry=<threadId> (same param as desktop);
  // router state covers in-app navigations that carry it.
  const [initialExpandThreadId] = useState<string | null>(
    () =>
      (location.state as { expandThreadId?: string } | null)?.expandThreadId ??
      new URLSearchParams(location.search).get("entry") ??
      null,
  );
  const feedRef = useRef<V2RoomFeedHandle>(null);
  const composeFormRef = useRef<ComposeFormHandle>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const [show, setShow] = useState<Show | null>(null);
  const [parentGroupId, setParentGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [progressForShow, setProgressForShow] = useState<ProgressEntry | null>(null);
  const [feedEntries, setFeedEntries] = useState<V2RoomFeedEntry[]>([]);
  const [mapMembers, setMapMembers] = useState<V2RoomMapMember[]>([]);
  const [privateEntries, setPrivateEntries] = useState<Thread[]>([]);
  const [tab, setTab] = useState<Tab>(privateOnly ? "private" : "friend");
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);

  // Progress picker → rating capture (forward picks only).
  const [pendingRating, setPendingRating] = useState<{ s: number; e: number } | null>(null);

  // Digest gear (friend room only) — lazy fetch on open, same as desktop.
  const [digestModalOpen, setDigestModalOpen] = useState(false);
  const [digestOptOut, setDigestOptOut] = useState<boolean | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  async function openDigestModal() {
    if (!roomId) return;
    setDigestOptOut(null);
    setDigestModalOpen(true);
    try { setDigestOptOut(await fetchRoomDigestOptOut(roomId)); }
    catch { /* modal shows Loading; close + retry */ }
  }
  async function applyDigest(nextOptOut: boolean) {
    if (!roomId || digestBusy) return;
    setDigestBusy(true);
    try {
      await setRoomDigestOptOut(roomId, nextOptOut);
      setDigestOptOut(nextOptOut);
      setDigestModalOpen(false);
    } catch {
      alert("Couldn't update your email setting. Please try again.");
    } finally {
      setDigestBusy(false);
    }
  }

  // ── Visible-writing notification signals (desktop's reduced subset) ───────
  // Same localStorage keys as desktop so seen-state is shared across surfaces.
  const prevVisibleThreadIdsRef = useRef<Set<string>>(new Set());
  const [lastOpenedAt, setLastOpenedAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_last_opened") || "{}"); } catch { return {}; }
  });
  const [perThreadLatestReply, setPerThreadLatestReply] = useState<Record<string, number>>({});
  const [engagedSet, setEngagedSet] = useState<Set<string>>(new Set());
  const [latestHighlightOnViewerWriting, setLatestHighlightOnViewerWriting] = useState<Record<string, number>>({});
  const [lastHighlightSeenAt, setLastHighlightSeenAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_highlight_seen") || "{}"); } catch { return {}; }
  });
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [userFilter, setUserFilter] = useState<string | null>(null);

  // The reused V2 feed expects the group-context palette.
  useEffect(() => {
    document.body.classList.add("group-context");
    return () => { document.body.classList.remove("group-context"); };
  }, []);

  // White "new since last visit" outline: capture last visit's visible set…
  useEffect(() => {
    if (privateOnly || !roomId || !user?.id) return;
    const vKey = `ns_room_visible_threads_${user.id}_${roomId}`;
    try {
      const v = localStorage.getItem(vKey);
      prevVisibleThreadIdsRef.current = v ? new Set(JSON.parse(v)) : new Set();
    } catch { prevVisibleThreadIdsRef.current = new Set(); }
  }, [user?.id, roomId, privateOnly]);
  // …then write the fresh set after the feed loads.
  useEffect(() => {
    if (privateOnly || !roomId || !user?.id) return;
    const vKey = `ns_room_visible_threads_${user.id}_${roomId}`;
    const ids = feedEntries.filter((e) => !e.isDeleted).map((e) => e.threadId);
    try { localStorage.setItem(vKey, JSON.stringify(ids)); } catch { /* ignore quota */ }
  }, [user?.id, roomId, privateOnly, feedEntries]);

  const freshenShow = useCallback((s: Show) => {
    refreshShowIfStale(s).then((u) => {
      if (u) setShow((cur) => (cur?.id === u.id ? u : cur));
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (privateOnly && privateShowId) {
        const [allShows, progressMap] = await Promise.all([fetchShows(), fetchProgress(user.id)]);
        const mine = await fetchUserThreads(user.id, privateShowId);
        const psShow = allShows.find((s) => s.id === privateShowId) ?? null;
        setShow(psShow);
        if (psShow) freshenShow(psShow);
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
      // Entering the room clears its new-activity dot up the tree.
      markRoomSeen(roomId).catch(() => { /* tolerate */ });

      const [allShows, progressMap, roomMapData, myGroups] = await Promise.all([
        fetchShows(), fetchProgress(user.id), fetchRoomMapData(roomId),
        roomRow.parent_group_id ? fetchPeopleGroupsForUser(user.id).catch(() => []) : Promise.resolve([]),
      ]);
      const showRow = allShows.find((s) => s.id === showId) ?? null;
      const progress = progressMap[showId] ?? null;
      const pg = roomRow.parent_group_id ? myGroups.find((x) => x.id === roomRow.parent_group_id) : null;
      const derivedGroupName = pg ? (pg.name || (pg.seq != null ? `Group ${pg.seq}` : null)) : null;
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
      if (showRow) freshenShow(showRow);
      setGroupName(derivedGroupName);
      setProgressForShow(progress);
      setFeedEntries(entries);
      setMapMembers(members);
      setPrivateEntries(priv);
      setPerThreadLatestReply(gr.latestVisibleReplyAt ?? {});
    } catch (e) {
      console.error("[m-show-room] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [roomId, privateShowId, privateOnly, user, freshenShow]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/m", { replace: true }); return; }
    load();
  }, [authLoading, user, load, navigate]);

  // Back pops one drill-down level: room → its group (or dashboard when
  // private-only / groupless). Constructable from a bare URL (digest links).
  function closeRoom() {
    navigate(parentGroupId ? `/m/group/${parentGroupId}` : "/m/dashboard");
  }

  // ── Progress → rating capture (forward) / plain confirm (backward) ────────
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

  async function skipRating() {
    if (!user || !show || !pendingRating) return;
    const target = pendingRating;
    setPendingRating(null);
    try { await persistProgressUpdate(user.id, show.id, progressForShow ?? undefined, target); }
    catch (e) { console.warn("progress write failed", e); }
    await load();
  }

  // ── Yellow signal: unseen highlights on the viewer's writing ──────────────
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

  // ── Per-entry signals — GREEN > YELLOW only (red layer cut on mobile) ─────
  const cellSignals = useMemo(() => {
    const out: Record<string, { kind: "green" | "yellow" | "red"; redCount?: number }> = {};
    for (const entry of feedEntries) {
      if (entry.isDeleted) continue;
      const tid = entry.threadId;
      const isOwn = !!profile?.username && entry.authorUsername === profile.username;
      if (isOwn && (perThreadLatestReply[tid] ?? 0) > (lastOpenedAt[tid] ?? 0)) { out[tid] = { kind: "green" }; continue; }
      if ((latestHighlightOnViewerWriting[tid] ?? 0) > (lastHighlightSeenAt[tid] ?? 0)) { out[tid] = { kind: "yellow" }; }
    }
    return out;
  }, [feedEntries, perThreadLatestReply, lastOpenedAt, profile?.username, latestHighlightOnViewerWriting, lastHighlightSeenAt]);

  // ── White "new since last visit" outline (others' entries) ────────────────
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

  const handleEntryExpanded = useCallback((threadId: string) => {
    const latestSeenAt = perThreadLatestReply[threadId] ?? 0;
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
    setEngagedSet((prev) => (prev.has(threadId) ? prev : new Set(prev).add(threadId)));
  }, [perThreadLatestReply]);

  const handleEntryCollapsed = useCallback((threadId: string) => {
    setEngagedSet((prev) => (prev.has(threadId) ? prev : new Set(prev).add(threadId)));
  }, []);

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

  if (authLoading || loading) {
    return <div style={{ ...page, background: C.green }} aria-busy="true" />;
  }

  const bodyBg = tab === "friend" ? C.sky : C.green;
  const visibleFriendEntries = userFilter ? feedEntries.filter((e) => e.authorId === userFilter) : feedEntries;
  const effectiveSortOrder = userFilter ? "desc" : sortOrder;

  const privateFeedEntries: V2RoomFeedEntry[] = privateEntries.map((t) => ({
    threadId: t.id, s: t.season, e: t.episode, title: t.titleBase, body: t.body, preview: t.preview,
    authorId: user?.id ?? "", authorUsername: t.author,
    isRewatch: t.isRewatch, rewatchS: t.rewatchS, rewatchE: t.rewatchE, isEdited: t.isEdited,
    isDeparted: false, isDeleted: t.isDeleted ?? false,
    updatedAt: t.updatedAt, replyCount: 0, thread: t,
  }));

  // Roster ordering: by watch progress (furthest first), raw S/E, viewer included.
  const rosterRows = [...mapMembers].sort((a, b) => {
    const ai = linearIndex(a.progress?.s ?? 0, a.progress?.e ?? 0, show?.seasons);
    const bi = linearIndex(b.progress?.s ?? 0, b.progress?.e ?? 0, show?.seasons);
    return (bi - ai) || a.username.localeCompare(b.username);
  });

  return (
    <div ref={pageRef} style={{ ...page, background: bodyBg }}>
      {/* ── Header: back · show name (+ with group) · digest gear ── */}
      <div style={{ background: tab === "friend" ? C.green : C.sky }}>
        <div style={topBar}>
          <button style={iconBtn} title={privateOnly ? "back to dashboard" : "back to group"} onClick={closeRoom}>
            <ArrowLeft size={22} color={C.cream} />
          </button>
          <h1 style={headerTitle}>
            {show?.name ?? "Show"}
            {groupName && <span style={{ color: C.blue }}> with {groupName}</span>}
          </h1>
          {!privateOnly && roomId ? (
            <button style={iconBtn} aria-label="Email updates for this room" title="Email updates for this room" onClick={openDigestModal}>
              <Settings size={20} color={C.cream} />
            </button>
          ) : <span style={{ width: 44, flexShrink: 0 }} />}
        </div>
        {/* Tabs on the header/body boundary (same swap rule as desktop). */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, padding: "0 16px" }}>
          {!privateOnly && <RoomTab label="friend room" active={tab === "friend"} bg={C.sky} onClick={() => setTab("friend")} />}
          <RoomTab label="private writing" active={tab === "private"} bg={C.green} onClick={() => setTab("private")} />
        </div>
      </div>

      <div style={{ padding: "16px 16px 120px" }}>
        {/* ── Roster dropdown (friend tab) — replaces the season map ── */}
        {tab === "friend" && !privateOnly && mapMembers.length > 0 && (
          <div style={rosterShell}>
            <button style={rosterHead} onClick={() => setRosterOpen((o) => !o)}>
              <span style={{ display: "inline-flex" }}>
                {rosterRows.slice(0, 6).map((m) => (
                  // Departed member: opaque accent fill. Viewer: green + cream.
                  <span key={m.userId} style={{ ...rosterAvatar, ...(m.isDeparted ? { background: C.yellow, color: C.cream } : m.userId === user?.id ? { background: C.green, color: C.cream } : {}) }}>
                    {(m.username[0] ?? "?").toUpperCase()}
                  </span>
                ))}
              </span>
              <span style={{ flex: 1, textAlign: "left", marginLeft: 10, fontWeight: 700, fontSize: 13, color: C.midnight }}>
                {mapMembers.length} {mapMembers.length === 1 ? "member" : "members"}
              </span>
              {rosterOpen ? <ChevronUp size={18} color={C.midnight} /> : <ChevronDown size={18} color={C.midnight} />}
            </button>
            {rosterOpen && (
              <div style={{ padding: "4px 14px 12px" }}>
                {rosterRows.map((m) => {
                  const isSelf = m.userId === user?.id;
                  const p = m.progress;
                  return (
                    <div key={m.userId} style={rosterRow}>
                      <span style={{ ...rosterAvatar, marginRight: 10, ...(m.isDeparted ? { background: C.yellow, color: C.cream } : isSelf ? { background: C.green, color: C.cream } : {}) }}>
                        {(m.username[0] ?? "?").toUpperCase()}
                      </span>
                      <span style={{ flex: 1, fontWeight: isSelf ? 700 : 600, fontSize: 14, color: C.midnight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        @{m.username}{isSelf ? " (you)" : ""}{m.isDeparted ? " (left show)" : ""}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 13, color: C.midnight, opacity: 0.8, flexShrink: 0 }}>
                        s{p?.s ?? 0} e{p?.e ?? 0}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Toolbar: write · sort/filter · progress picker ── */}
        {/* Toolbar — two fixed rows so nothing wraps to a third:
            row 1: write (left) · row 2: order dropdown (left) + progress (right). */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
          <div>
            <button style={writeBtn} onClick={() => setComposeOpen(true)}><SquarePen size={16} /> write</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            {tab === "friend" && !privateOnly && feedEntries.length > 0 ? (
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
            ) : <span />}
            {show && progressForShow && (
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
        </div>

        {/* ── Feed (shared V2RoomFeed — expansion, respond, edit, stubs) ── */}
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
              mobileIdiom
              entries={visibleFriendEntries}
              sortOrder={effectiveSortOrder}
              initialExpandedThreadId={initialExpandThreadId ?? undefined}
              scrollContainerRef={pageRef}
              groupId={roomId}
              viewerProgress={progressForShow}
              userId={user?.id ?? ""}
              onEntryExpanded={handleEntryExpanded}
              onEntryCollapsed={handleEntryCollapsed}
              onThreadEdited={handleThreadEdited}
              onThreadDeleted={handleThreadDeleted}
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
                mobileIdiom
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

      {/* ── Compose — full-screen (mobile idiom of desktop's centered card) ── */}
      {composeOpen && createPortal(
        <div style={composeShell}>
          <button onClick={() => composeFormRef.current?.attemptDiscard()} aria-label="Discard and close" style={composeCloseX}><X size={16} color={CANON.alert} /></button>
          <ComposeForm
            ref={composeFormRef}
            mobileIdiom
            showId={show?.id}
            restrictGroupId={privateOnly ? undefined : roomId}
            privateOnly={privateOnly}
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
        </div>,
        document.body,
      )}

      {/* ── Rate the episode you just finished (forward progress pick) ── */}
      {pendingRating && (
        <RatingCaptureModal
          season={pendingRating.s}
          episode={pendingRating.e}
          onCommit={commitRating}
          onCancel={() => setPendingRating(null)}
          onSkip={skipRating}
        />
      )}

      {/* ── Digest gear (bottom sheet; desktop copy) ── */}
      {digestModalOpen && roomId && (
        <div style={dim} onClick={() => { if (!digestBusy) setDigestModalOpen(false); }}>
          <div style={{ ...bottomSheet, background: C.yellow, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
            {digestOptOut === null ? (
              <div style={{ color: C.cream, fontSize: 15, padding: "6px 0" }}>Loading…</div>
            ) : digestOptOut ? (
              <>
                <div style={digestTitle}>Resubscribe to email updates for this room?</div>
                <button style={alertBtn} disabled={digestBusy} onClick={() => applyDigest(false)}>resubscribe</button>
                <div style={digestDivider} />
                <div style={digestSub}>You'll get the daily digest again when this room has new activity you haven't seen.</div>
              </>
            ) : (
              <>
                <div style={digestTitle}>Unsubscribe from email updates for this room?</div>
                <button style={alertBtn} disabled={digestBusy} onClick={() => applyDigest(true)}>unsubscribe</button>
                <div style={digestDivider} />
                <div style={digestSub}>You'll stop getting the daily digest for this room. You can resubscribe here anytime.</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RoomTab({ label, active, bg, onClick }: { label: string; active: boolean; bg: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        cursor: "pointer", padding: "8px 18px", minHeight: 40,
        borderTopLeftRadius: 14, borderTopRightRadius: 14,
        borderTop: active ? "none" : `2px solid ${C.cream}`,
        borderLeft: active ? "none" : `2px solid ${C.cream}`,
        borderRight: active ? "none" : `2px solid ${C.cream}`,
        borderBottom: "none",
        fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 600, fontSize: 15, letterSpacing: "0.005em",
        background: active ? bg : "transparent",
        color: C.cream,
        position: "relative", bottom: -2,
      }}
    >
      {label}
    </button>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const page: React.CSSProperties = {
  position: "fixed", inset: 0, overflowY: "auto", WebkitOverflowScrolling: "touch",
  fontFamily: '"Inter", system-ui, sans-serif',
};
const topBar: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  padding: "calc(env(safe-area-inset-top, 0px) + 8px) 8px 4px",
};
const iconBtn: React.CSSProperties = {
  width: 44, height: 44, flexShrink: 0, border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const headerTitle: React.CSSProperties = {
  flex: 1, minWidth: 0, fontFamily: LORA, fontWeight: 700, fontSize: 20, letterSpacing: -0.5,
  color: C.cream, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};
const rosterShell: React.CSSProperties = {
  background: C.cream, borderRadius: 16, marginBottom: 16, overflow: "hidden",
};
const rosterHead: React.CSSProperties = {
  display: "flex", alignItems: "center", width: "100%", minHeight: 52,
  padding: "8px 14px", border: "none", background: "transparent", cursor: "pointer", boxSizing: "border-box",
};
const rosterAvatar: React.CSSProperties = {
  width: 28, height: 28, borderRadius: "50%", background: C.sky, color: C.blue,
  border: `2px solid ${C.cream}`, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 13,
  display: "inline-flex", alignItems: "center", justifyContent: "center", marginLeft: -6, boxSizing: "border-box",
};
const rosterRow: React.CSSProperties = {
  display: "flex", alignItems: "center", minHeight: 44, borderTop: "1px solid rgba(26,58,74,0.08)",
};
const writeBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, border: "none", background: C.yellow, color: CANON.cream,
  fontWeight: 700, fontSize: 14, padding: "12px 24px", borderRadius: 65, cursor: "pointer", minHeight: 44,
};
const sortSelect: React.CSSProperties = {
  appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
  background: "transparent", border: `2px solid ${C.cream}`, color: C.cream,
  borderRadius: 65, padding: "8px 18px", fontSize: 12, fontWeight: 700, minHeight: 44,
  fontFamily: '"Inter", system-ui, sans-serif', cursor: "pointer", outline: "none",
};
const emptyCopy: React.CSSProperties = { color: C.cream, opacity: 0.85, fontSize: 14, lineHeight: 1.5 };
const composeShell: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, background: C.cream, overflowY: "auto",
  WebkitOverflowScrolling: "touch",
};
const composeCloseX: React.CSSProperties = {
  position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: 12,
  background: "var(--canon-cream,#fef8ea)", border: "2px solid var(--canon-alert,#f45028)",
  color: CANON.alert, borderRadius: "50%", width: 40, height: 40, padding: 0,
  display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16, cursor: "pointer", zIndex: 1010,
};
const dim: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, background: "rgba(26,58,74,0.35)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
};
const bottomSheet: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  borderTopLeftRadius: 24, borderTopRightRadius: 24,
  padding: "26px 24px calc(env(safe-area-inset-bottom, 0px) + 26px)",
};
const digestTitle: React.CSSProperties = {
  color: CANON.cream, fontSize: 15, fontWeight: 600, letterSpacing: -0.5, marginBottom: 16,
};
const alertBtn: React.CSSProperties = {
  border: `2px solid ${CANON.alert}`, background: "transparent", color: CANON.alert,
  fontWeight: 700, fontSize: 14, padding: "10px 32px", borderRadius: 9999, cursor: "pointer", minHeight: 44,
};
const digestDivider: React.CSSProperties = { height: 1, background: "rgba(253,248,236,0.5)", margin: "20px 0 14px" };
const digestSub: React.CSSProperties = { color: CANON.cream, fontSize: 12, opacity: 0.9, lineHeight: 1.45 };
