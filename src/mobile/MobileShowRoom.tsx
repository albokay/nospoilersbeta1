import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, LayoutGrid, Minus, Settings, SquarePen, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import {
  fetchShows, refreshShowIfStale, fetchProgress, fetchRoomMapData, fetchGroupThreads, fetchUserThreads,
  persistProgressUpdate, upsertEpisodeRating, deleteEpisodeRating, markRoomSeen, markThreadSeen, fetchThreadViewState,
  fetchThreadSeenProgress, isAboveSeenProgress,
  fetchHighlights, fetchPeopleGroupsForUser, fetchRoomDigestOptOut, setRoomDigestOptOut,
  leaveShowRoom, setRoomDnf, fetchContactNames,
  type Show,
} from "../lib/db";
import { joinNames } from "../lib/groupNames";
import { M, OVERLAY } from "./m";
import { effectiveProgress } from "../lib/utils";
import type { Thread, ProgressEntry } from "../types";
import V2RoomFeed, { type V2RoomFeedEntry, type V2RoomFeedHandle } from "../components/v2/V2RoomFeed";
import RoomProgressTip from "../components/RoomProgressTip";
import LoadingDots from "../components/LoadingDots";
import V2RoomMap, { type V2RoomMapMember } from "../components/v2/V2RoomMap";
import UnlockLine, { type UnlockNote } from "../components/UnlockLine";
import { linearIndex } from "../lib/groupPills";
import ComposeForm, { type ComposeFormHandle } from "../components/v2/ComposeForm";
import DeckWave from "../components/deck/DeckWave";
import OneSelectProgress from "../components/OneSelectProgress";
import RatingCaptureModal from "../components/RatingCaptureModal";
import MobilePool from "./MobilePool";
import ShowReference from "../components/reference/ShowReference";
import { ensureShowReference } from "../lib/reference";
import { CANON, withAlpha } from "../styles/canon";
import useSheetSwipeDown from "../lib/useSheetSwipeDown";

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
 *   • SEASON MAP — the desktop map in a cream bottom sheet (2026-09-23,
 *     direction A; a tester asked for it), opened from the control card's
 *     Map pill: same V2RoomMap in its `mobile` idiom (avatar + name
 *     headers, season strips, Friend-blue lines on the cream), same
 *     folding, signals and rating edit mode. Tapping a cell closes the
 *     sheet and scrolls the feed to that entry. Its header replaced the
 *     roster dropdown that stood in for the map from CP6 to here.
 *   • Notification signals — desktop's full set since 2026-08-21 (the red
 *     cut was reversed): white "new since last visit" outline (newly-visible
 *     entry), green (new response on your entry), yellow (new highlight on
 *     your writing), RED = the expand chevron's 32px circle in Alert red on
 *     your own entries with hidden ahead-of-progress responses (the green
 *     badge's grammar, red; the map sheet carries it too) — never
 *     dismissed by hand; it clears when catching up reveals the responses.
 *     Same localStorage keys as desktop, so seen-state stays consistent
 *     across surfaces.
 *   • Pings / polls / SIKW stickies: cut (no launchers, no receive-side).
 *   • Digest deep-links (?entry=) land here cold: the feed auto-expands the
 *     entry, and back walks up the real stack (group room → dashboard).
 *   • Member-name clicks (desktop → /pool/:username) are deferred — the
 *     read-only pool page has no mobile surface yet (CP8 decision).
 */

const C = { green: CANON.personal, sky: CANON.friend, blue: CANON.identity, yellow: CANON.accent, red: CANON.alert, cream: CANON.cream, midnight: CANON.dark, greyblue: CANON.business };
const LORA = '"Lora", Georgia, serif';
// "reference" = the spoiler-gated reference (2026-09-05); its tab exists
// only once the viewer's dial reaches S1E1 — no 0-state reference page.
type Tab = "friend" | "private" | "reference";

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
  // The viewer's contact names (naming arc 2026-07-07, desktop parity) —
  // drives the displayNames map for the reused feed components, the roster,
  // and the member filter. Display-only; ids/keys stay real handles.
  const [roomContactNames, setRoomContactNames] = useState<Record<string, string>>({});
  const [progressForShow, setProgressForShow] = useState<ProgressEntry | null>(null);
  const [feedEntries, setFeedEntries] = useState<V2RoomFeedEntry[]>([]);
  const [mapMembers, setMapMembers] = useState<V2RoomMapMember[]>([]);
  // The unlock line (2026-09-25): what the last progress move opened. See
  // load() for the detection; UnlockLine for the copy.
  const [unlockNote, setUnlockNote] = useState<UnlockNote | null>(null);
  const unlockRef = useRef<{ idx: number; gated: Set<string>; hidden: Record<string, number> } | null>(null);
  const [privateEntries, setPrivateEntries] = useState<Thread[]>([]);
  // The dashboard band arrives ON the reference tab (nav state, CP2).
  const [tab, setTab] = useState<Tab>(() =>
    (location.state as { openReference?: boolean } | null)?.openReference
      ? "reference"
      : (privateOnly ? "private" : "friend"));
  // Cross-room navigation reuses this mounted page (the guide's room pills
  // navigate /show-room/private/... → /show-room/{roomId}) — the tab state
  // survives, so re-derive it whenever the path actually changes (2026-09-08:
  // arriving from a guide should land on the friend room).
  useEffect(() => {
    setTab((location.state as { openReference?: boolean } | null)?.openReference
      ? "reference"
      : (privateOnly ? "private" : "friend"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  // Compose minimize (Alborz 2026-09-08): hide the sheet WITHOUT unmounting
  // it so a half-written entry survives a guide/room check.
  const [composeMinimized, setComposeMinimized] = useState(false);
  useEffect(() => { if (!composeOpen) setComposeMinimized(false); }, [composeOpen]);
  // Season map sheet (2026-09-23): the sheet's inner div scrolls (both
  // ways — wide rooms pan sideways), so the swipe hook gates on it.
  const [mapSheetOpen, setMapSheetOpen] = useState(false);
  const [mapEditing, setMapEditing] = useState(false);
  const mapScrollRef = useRef<HTMLDivElement>(null);
  const mapSwipe = useSheetSwipeDown(() => setMapSheetOpen(false), { scrollRef: mapScrollRef, open: mapSheetOpen });
  // Byline tap → the member's pool as an OVERLAY on the still-mounted room
  // (stable back swipe): opening pushes a same-path history entry, so the
  // iOS edge-swipe / back button pops it → popstate → overlay closes and
  // the room is exactly as you left it (expanded ticket, scroll, no refetch).
  const [poolUser, setPoolUser] = useState<string | null>(null);
  function openPool(username: string) {
    window.history.pushState({ mPoolOverlay: true }, "", `#pool=${encodeURIComponent(username)}`);
    setPoolUser(username);
  }
  useEffect(() => {
    if (!poolUser) return;
    const onPop = () => setPoolUser(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [poolUser]);

  // Progress picker → rating capture (forward picks only).
  const [pendingRating, setPendingRating] = useState<{ s: number; e: number } | null>(null);
  // The automatic post-rating composition (Alborz 2026-09-13, restored) —
  // desktop parity; the write button's manual open clears the flag.
  const [composeAuto, setComposeAuto] = useState(false);

  // Digest gear (friend room only) — lazy fetch on open, same as desktop.
  const [digestModalOpen, setDigestModalOpen] = useState(false);
  const [digestOptOut, setDigestOptOut] = useState<boolean | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  // Swipe-down dismiss (2026-07-28 rollout); disabled while a save is in
  // flight, matching each sheet's tap-outside guard.
  const digestSwipe = useSheetSwipeDown(() => setDigestModalOpen(false), { enabled: !digestBusy, open: digestModalOpen });
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

  // CP5 (mobile mirror): leave ONLY this show room in this group — never
  // global. Writing stays intact; the room and everyone else's votes are
  // untouched; rejoin via the group's search ("· rejoin"). Lands back on the
  // group, whose shelf now hides this room for the leaver only.
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const leaveSwipe = useSheetSwipeDown(() => setLeaveConfirmOpen(false), { enabled: !leaveBusy, open: leaveConfirmOpen });
  // "We're done with this one" from the gear (Alborz 2026-09-13) — parks
  // the show for the whole group (same action as the shelf long-press) and
  // returns to the group room; revivable from the finished drawer.
  const [dnfBusy, setDnfBusy] = useState(false);
  async function doDnfRoom() {
    if (!roomId || dnfBusy) return;
    setDnfBusy(true);
    try {
      await setRoomDnf(roomId, true);
      setDigestModalOpen(false);
      closeRoom();
    } catch (e) {
      console.error("[m-show-room] dnf failed", e);
      alert("Couldn't park the show. Please try again.");
    } finally {
      setDnfBusy(false);
    }
  }
  async function doLeaveRoom() {
    if (!roomId || leaveBusy) return;
    setLeaveBusy(true);
    try {
      await leaveShowRoom(roomId);
      setLeaveConfirmOpen(false);
      setDigestModalOpen(false);
      closeRoom();
    } catch (e) {
      console.error("[m-show-room] leave room failed", e);
      alert("Couldn't leave the room. Please try again.");
    } finally {
      setLeaveBusy(false);
    }
  }

  // ── Notification signals (desktop parity — the red-layer cut was reversed,
  //    Alborz 2026-08-21). Same localStorage keys as desktop so seen-state is
  //    shared across surfaces. Red = hidden (ahead-of-progress) responses on
  //    the viewer's OWN entries, shown as the expand chevron's circle in
  //    Alert red (and as the map sheet's dot since 2026-09-23); never
  //    dismissed by hand — it clears when catching up reveals the responses.
  const prevVisibleThreadIdsRef = useRef<Set<string>>(new Set());
  const [lastOpenedAt, setLastOpenedAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_last_opened") || "{}"); } catch { return {}; }
  });
  const [perThreadLatestReply, setPerThreadLatestReply] = useState<Record<string, number>>({});
  const [perThreadHiddenCount, setPerThreadHiddenCount] = useState<Record<string, number>>({});
  // Catch-up green (2026-09-20): the deepest READABLE other-reply tag per
  // thread, and the progress the viewer had when they last opened it. A
  // reply readable now but ABOVE that progress only just became readable
  // → green, regardless of when it was written.
  const [deepestVisibleReply, setDeepestVisibleReply] = useState<Record<string, { season: number; episode: number }>>({});
  const [seenProgress, setSeenProgress] = useState<Record<string, { season: number; episode: number }>>({});
  const [engagedSet, setEngagedSet] = useState<Set<string>>(new Set());
  // Threads the viewer has RESPONDED in — green also fires there (Alborz
  // 2026-09-12: a response in a conversation you're part of is for you).
  const [myReplyThreadIds, setMyReplyThreadIds] = useState<Set<string>>(new Set());
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
  // (2026-09-12: the seen-set is FROZEN — the outline now clears only on
  // open, so nothing writes "seen on sight" anymore; the stored set stays
  // as the historical baseline read above.)

  const freshenShow = useCallback((s: Show) => {
    refreshShowIfStale(s).then((u) => {
      if (u) setShow((cur) => (cur?.id === u.id ? u : cur));
    }).catch(() => {});
  }, []);

  // Perf (2026-09-01, desktop parity, plan 3b): the group room's row passes
  // the room's show + parent group through navigation state, so entry from
  // there skips the blocking room-row lookup (background verify catches
  // deleted rooms). Cold URLs still do the lookup. Captured once.
  const navRoomRef = useRef<{ roomShowId?: string; roomParentGroupId?: string | null } | null>((location.state as any) ?? null);
  // Perf (plan 3a): last-render snapshot per room — re-entries paint the
  // header/feed instantly while the live load refreshes (display-only
  // staleness; the group room's stale-while-revalidate pattern).
  const paintedFromSnapRef = useRef(false);
  useEffect(() => {
    if (privateOnly || !roomId || !user) return;
    try {
      const raw = sessionStorage.getItem(`ns_m_room_snap_${user.id}_${roomId}`);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (!snap?.show) return;
      setShow(snap.show);
      setGroupName(snap.groupName ?? null);
      setProgressForShow(snap.progress ?? null);
      setFeedEntries(snap.feedEntries ?? []);
      setMapMembers(snap.mapMembers ?? []);
      setPrivateEntries(snap.privateEntries ?? []);
      setParentGroupId(snap.parentGroupId ?? null);
      paintedFromSnapRef.current = true;
      setLoading(false);
    } catch { /* corrupt snapshot — the live load paints */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    if (!paintedFromSnapRef.current) setLoading(true);
    // (paintedFromSnapRef flips true after any successful load below, so
    // doorbell/live refetches never re-show the full-page spinner.)
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
      let showId: string;
      let parentGid: string | null;
      const navRoom = navRoomRef.current;
      if (navRoom?.roomShowId) {
        showId = navRoom.roomShowId;
        parentGid = navRoom.roomParentGroupId ?? null;
        // Background verify only — a deleted room bounces back out.
        supabase.from("friend_groups").select("id, deleted_at").eq("id", roomId).maybeSingle()
          .then(({ data }) => { if (!data || data.deleted_at) navigate(parentGid ? `/m/group/${parentGid}` : "/m/dashboard", { replace: true }); });
      } else {
        const { data: roomRow, error: roomErr } = await supabase
          .from("friend_groups")
          .select("id, show_id, parent_group_id, deleted_at")
          .eq("id", roomId)
          .maybeSingle();
        if (roomErr) throw roomErr;
        if (!roomRow || roomRow.deleted_at) throw new Error("room not found");
        showId = roomRow.show_id as string;
        parentGid = (roomRow.parent_group_id as string | null) ?? null;
      }
      setParentGroupId(parentGid);
      // Entering the room clears its new-activity dot up the tree.
      markRoomSeen(roomId).catch(() => { /* tolerate */ });

      // Perf (2026-07-07): the drafts fetch needs only the showId, so it
      // rides the main parallel batch instead of trailing the whole chain.
      // Perf (2026-09-01, plan 3c): the writing fetch chains off the
      // progress promise INSIDE the batch instead of trailing it.
      const emptyGr = { threads: [] as Thread[], replyCounts: {} as Record<string, number>, aheadCounts: {} as Record<string, number>, sharedAt: {} as Record<string, number>, latestVisibleReplyAt: {} as Record<string, number>, hiddenCounts: {} as Record<string, number>, latestHiddenReplyAt: {} as Record<string, number> };
      const progressP = fetchProgress(user.id);
      const grP: Promise<any> = progressP.then((pm) => {
        const eff = effectiveProgress(pm[showId] ?? null);
        return eff ? fetchGroupThreads(roomId, eff.s, eff.e, user.id) : (emptyGr as any);
      });
      const [allShows, progressMap, roomMapData, myGroups, cn, mine, gr] = await Promise.all([
        fetchShows(), progressP, fetchRoomMapData(roomId),
        parentGid ? fetchPeopleGroupsForUser(user.id).catch(() => []) : Promise.resolve([]),
        fetchContactNames(user.id).catch(() => ({} as Record<string, string>)),
        fetchUserThreads(user.id, showId),
        grP,
      ]);
      setRoomContactNames(cn);
      const showRow = allShows.find((s) => s.id === showId) ?? null;
      const progress = progressMap[showId] ?? null;
      const pg = parentGid ? myGroups.find((x) => x.id === parentGid) : null;
      // "with …" lists the members who OPTED INTO THIS SHOW — the room's
      // current (non-departed) members from roomMapData, NOT the whole group
      // (2026-07-09; matches desktop). Custom group name still wins; unnamed
      // → the viewer's given names for those members; else "Group N". (No
      // extra fetch — roomMapData is already loaded.)
      let derivedGroupName: string | null = null;
      if (pg) {
        if (pg.name) derivedGroupName = pg.name;
        else {
          const optedNames = roomMapData
            .filter((m) => !m.isDeparted && m.userId !== user.id && m.username)
            .map((m) => cn[m.userId] ?? m.displayName ?? (m.username as string));
          // No one else in the room yet → no "with" line at all (cleaner than
          // "with Group N" for a solo/awaiting-accept room).
          derivedGroupName = optedNames.length ? joinNames(optedNames) : null;
        }
      }

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
      // CP4 (desktop parity): spoiler-gated entries ride the same feed as
      // one-line stubs ("X has watched … and written to …"), sorted like
      // ordinary entries.
      const gatedStubs: V2RoomFeedEntry[] = ((gr.gatedThreads ?? []) as Thread[]).map((t) => ({
        threadId: t.id, s: t.season, e: t.episode, title: "", body: "", preview: "",
        authorId: u2id[t.author] ?? "", authorUsername: t.author,
        isDeparted: departed.has(t.author), isDeleted: false,
        updatedAt: gr.sharedAt?.[t.id] || t.updatedAt,
        replyCount: 0, thread: t, gatedStub: true,
      }));

      const members: V2RoomMapMember[] = roomMapData.map((m) => ({
        userId: m.userId, username: m.username ?? "?", displayName: m.displayName, isDeparted: m.isDeparted,
        progress: m.progress, ratings: m.ratings,
        entries: m.entries.map((e) => ({ threadId: e.threadId, s: e.s, e: e.e, title: e.title })),
      }));

      const priv = mine.filter((x) => !x.thread.isPublic && !x.groupId).map((x) => x.thread);

      // The unlock line (letters in transit, 2026-09-25): when this load
      // lands with the viewer further along than the last one, the entries
      // that were sealed stubs and the responses that were hidden a moment
      // ago are what just opened. Every path that moves progress (the
      // picker, the compose picker, the rating flow, even another device)
      // reloads through here. In-session only — the ref dies with the page.
      {
        const effNow = effectiveProgress(progress);
        const idxNow = effNow ? linearIndex(effNow.s, effNow.e, showRow?.seasons) : 0;
        const prev = unlockRef.current;
        if (prev && effNow && idxNow > prev.idx) {
          const opened = entries.filter((en) => prev.gated.has(en.threadId) && !en.isDeleted);
          let responses = 0;
          for (const [tid, was] of Object.entries(prev.hidden)) responses += Math.max(0, was - ((gr.hiddenCounts ?? {})[tid] ?? 0));
          // A move that opens nothing clears the last line rather than
          // leaving it stale.
          setUnlockNote(opened.length || responses
            ? { s: effNow.s, e: effNow.e, entries: opened.length, authors: [...new Set(opened.map((en) => en.authorUsername))], responses }
            : null);
        }
        unlockRef.current = { idx: idxNow, gated: new Set(gatedStubs.map((g) => g.threadId)), hidden: (gr.hiddenCounts ?? {}) as Record<string, number> };
      }
      setShow(showRow);
      if (showRow) freshenShow(showRow);
      setGroupName(derivedGroupName);
      setProgressForShow(progress);
      setFeedEntries([...entries, ...gatedStubs]);
      setMapMembers(members);
      setPrivateEntries(priv);
      setPerThreadLatestReply(gr.latestVisibleReplyAt ?? {});
      // Cross-device opens (2026-09-12): merge the server's per-entry open
      // stamps into the local map — opening on desktop clears here too.
      if (!privateOnly && roomId) {
        // Progress-at-last-open, for the catch-up arm of green (2026-09-20).
        fetchThreadSeenProgress(roomId)
          .then((sp) => setSeenProgress((prev) => {
            // MERGE, keeping the DEEPER progress per entry — never replace.
            // markThreadSeen is fire-and-forget, so a refetch that lands
            // before it would otherwise hand back the OLD progress and
            // re-light the green we just cleared on expand. Same shape as
            // the lastOpenedAt merge above (which keeps the later stamp).
            const next = { ...prev };
            for (const [tid, sv] of Object.entries(sp)) {
              const cur = next[tid];
              if (!cur || sv.season > cur.season || (sv.season === cur.season && sv.episode > cur.episode)) next[tid] = sv;
            }
            return next;
          }))
          .catch(() => { /* tolerate (pre-migration) */ });
        fetchThreadViewState(roomId).then((sv) => {
          setLastOpenedAt((prev) => {
            const next = { ...prev };
            for (const [tid, ts] of Object.entries(sv)) if (!(tid in next) || next[tid] < ts) next[tid] = ts;
            try { localStorage.setItem("ns_last_opened", JSON.stringify(next)); } catch { /* ignore */ }
            return next;
          });
        }).catch(() => { /* tolerate (migration state) */ });
      }
      // Red-layer data: hidden-response counts for threads the viewer is
      // part of. (2026-09-23: no manual dismissals anywhere any more — the
      // desktop map dot's X is gone, so the ns_tdot_x_ / ns_tdot_dismiss_
      // stamps are no longer read. Red persists until catch-up.)
      setPerThreadHiddenCount(gr.hiddenCounts ?? {});
      setDeepestVisibleReply(gr.deepestVisibleReply ?? {});
      // Store the re-entry snapshot (plan 3a) — display-only staleness.
      if (!privateOnly && roomId) {
        try {
          sessionStorage.setItem(`ns_m_room_snap_${user.id}_${roomId}`, JSON.stringify({
            show: showRow, groupName: derivedGroupName, progress,
            feedEntries: [...entries, ...gatedStubs], mapMembers: members,
            privateEntries: priv, parentGroupId: parentGid,
          }));
        } catch { /* quota — instant paint just won't happen */ }
      }
      paintedFromSnapRef.current = true; // painted (live) — spinner stands down
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
  // ── In-room LIVE updates (Alborz 2026-09-02, green-lit scope) — the
  //    DOORBELL pattern: subscribe to this room's new responses (replies —
  //    already in the realtime publication) and new entries (group_threads —
  //    silently inert until Alborz adds it to the publication), IGNORE the
  //    payloads entirely (the live frame is not progress-gated), and re-run
  //    the same spoiler-gated load, debounced. The snapshot/instant-paint
  //    path is untouched: the subscription attaches after first paint and
  //    refetches fire only when a friend actually writes. Dashboard/group
  //    dots stay non-live — flagged for a later scope.
  useEffect(() => {
    if (privateOnly || !roomId || !user) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let debounce: number | null = null;
    const ding = () => {
      if (cancelled) return;
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { if (!cancelled) load(); }, 1200);
    };
    (async () => {
      // Member-gated tables need the user token on the socket (the chat
      // realtime's fix) or events silently never arrive.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      } catch { /* tolerate */ }
      if (cancelled) return;
      channel = supabase
        .channel(`room-live-${roomId}`)
        // Own posts don't ring — the page already refreshes itself after
        // posting (author_id is the only payload field read; never content).
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "replies", filter: `group_id=eq.${roomId}` }, (payload) => {
          if ((payload.new as any)?.author_id === user.id) return;
          ding();
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_threads", filter: `group_id=eq.${roomId}` }, ding)
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (debounce) window.clearTimeout(debounce);
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId, privateOnly, user, load]);


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
    setComposeAuto(!privateOnly);
    setComposeOpen(true);
    setComposeMinimized(false);
  }

  async function onProgressConfirm(val: { s: number; e: number }) {
    if (!user || !show) return;
    try { await persistProgressUpdate(user.id, show.id, progressForShow ?? undefined, val); }
    catch (e) { console.warn("progress write failed", e); }
    await load();
  }

  // Composition still follows a skipped rating — the flow is progress →
  // rating → write, rated or not (Alborz 2026-09-13).
  async function skipRating() {
    if (!user || !show || !pendingRating) return;
    const target = pendingRating;
    setPendingRating(null);
    try { await persistProgressUpdate(user.id, show.id, progressForShow ?? undefined, target); }
    catch (e) { console.warn("progress write failed", e); }
    await load();
    setComposeAuto(!privateOnly);
    setComposeOpen(true);
    setComposeMinimized(false);
  }

  // Map edit mode's Save (desktop's commitRatings, ported 2026-09-23): batch
  // the writes, then patch the viewer's own map cells in place — no room
  // reload for a ratings-only change.
  async function commitRatings(changes: { s: number; e: number; rating: number | null }[]): Promise<{ ok: boolean }> {
    if (!user || !show) return { ok: false };
    if (!changes.length) return { ok: true };
    try {
      await Promise.all(changes.map((c) => c.rating === null
        ? deleteEpisodeRating({ userId: user.id, showId: show.id, season: c.s, episode: c.e })
        : upsertEpisodeRating({ userId: user.id, showId: show.id, season: c.s, episode: c.e, rating: c.rating })));
      setMapMembers((prev) => prev.map((m) => {
        if (m.userId !== user.id) return m;
        let ratings = m.ratings;
        for (const c of changes) {
          if (c.rating === null) {
            ratings = ratings.filter((r) => !(r.s === c.s && r.e === c.e));
          } else {
            const idx = ratings.findIndex((r) => r.s === c.s && r.e === c.e);
            ratings = idx >= 0
              ? ratings.map((r, i) => (i === idx ? { ...r, rating: c.rating as number } : r))
              : [...ratings, { s: c.s, e: c.e, rating: c.rating as number }];
          }
        }
        return { ...m, ratings };
      }));
      return { ok: true };
    } catch (e) { console.warn("batch rating commit failed", e); return { ok: false }; }
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
        if (!cancelled) setMyReplyThreadIds(new Set((viewerReplyRows ?? []).map((r: any) => r.thread_id as string)));
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

  // ── Per-entry signals — BLUE > YELLOW > RED, desktop's precedence (the
  //    red layer joined mobile 2026-08-21). Red = hidden responses on the
  //    viewer's OWN entry; suppressed once the entry is expanded (the stamp
  //    below) until a NEWER hidden response lands. When catching up reveals
  //    a response, green naturally takes over. ────────────────────────────
  const cellSignals = useMemo(() => {
    const out: Record<string, { kind: "blue" | "yellow" | "red"; redCount?: number }> = {};
    for (const entry of feedEntries) {
      if (entry.isDeleted) continue;
      const tid = entry.threadId;
      const isOwn = !!profile?.username && entry.authorUsername === profile.username;
      const hasNewReadable = (perThreadLatestReply[tid] ?? 0) > (lastOpenedAt[tid] ?? 0);
      // Catch-up arm (Alborz 2026-09-20): a response readable NOW but above
      // the progress you had when you last opened this entry only just became
      // readable — green, no matter when it was written. Without this, a
      // response written BEFORE your last open is older than your open stamp
      // forever, so red would drop on catch-up and nothing would light.
      // Needs 20260920_seen_progress_catchup_green.sql; pre-migration
      // seenProgress is empty and this is inert.
      const becameReadable = isAboveSeenProgress(deepestVisibleReply[tid], seenProgress[tid]);
      // Colors (Alborz 2026-09-16 — supersedes the 09-13 own-entry red):
      // BLUE (2026-09-25; was green) = new responses you can READ now, on your own entry or in a
      // thread you responded in; RED = hidden responses in those same threads,
      // waiting for you to catch up (counted, below). Own replies excluded,
      // so posting never self-notifies.
      if ((isOwn || myReplyThreadIds.has(tid)) && (hasNewReadable || becameReadable)) { out[tid] = { kind: "blue" }; continue; }
      if ((latestHighlightOnViewerWriting[tid] ?? 0) > (lastHighlightSeenAt[tid] ?? 0)) { out[tid] = { kind: "yellow" }; continue; }
      const hiddenCount = perThreadHiddenCount[tid] ?? 0;
      if ((isOwn || myReplyThreadIds.has(tid)) && hiddenCount > 0) out[tid] = { kind: "red", redCount: hiddenCount };
    }
    return out;
  }, [feedEntries, perThreadLatestReply, lastOpenedAt, myReplyThreadIds, perThreadHiddenCount, deepestVisibleReply, seenProgress, profile?.username, latestHighlightOnViewerWriting, lastHighlightSeenAt]);

  // The red signal's render home: the expand chevron in an Alert-red 32px
  // circle — the green new-responses badge's exact grammar, red (Alborz
  // 2026-08-21, replacing a first-pass corner dot). V2RoomFeed derives it
  // from cellSignals' red under the entryRedChevron flag.

  // ── White "never opened" outline (others' entries) — Alborz 2026-09-12:
  //    clears only when the entry is opened; the frozen legacy seen-set is
  //    the baseline for everything from before this rule (desktop parity). ──
  const isNewMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    if (!profile?.username) return out;
    const legacySeen = prevVisibleThreadIdsRef.current;
    for (const entry of feedEntries) {
      if (entry.isDeleted || entry.gatedStub || entry.authorUsername === profile.username) continue;
      if (!(entry.threadId in lastOpenedAt) && !legacySeen.has(entry.threadId)) out[entry.threadId] = true;
    }
    return out;
  }, [feedEntries, lastOpenedAt, profile?.username]);

  // The road (2026-09-25): the other current members' reading positions
  // for the feed's markers + countdowns. Effective progress (rewatch-aware
  // ceiling); friends who haven't started stay off the road.
  const roadPositions = useMemo(() => mapMembers
    .filter((m) => m.userId !== user?.id && !m.isDeparted)
    .map((m) => { const eff = effectiveProgress(m.progress); return eff && (eff.s > 0 || eff.e > 0) ? { username: m.username, s: eff.s, e: eff.e } : null; })
    .filter((p): p is { username: string; s: number; e: number } => p !== null), [mapMembers, user?.id]);

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
    // NOTE (Alborz 2026-09-20): expanding NO LONGER dismisses the red
    // hidden-responses signal. The 2026-08-21 rule stamped ns_tdot_dismiss_
    // here, but opening the entry only ever showed a GATED STUB — the
    // response itself was never readable, so the signal had not been
    // answered. Red now persists until the viewer CATCHES UP (progress
    // advances → chainVisible → hiddenCounts drops the thread entirely,
    // db.ts fetchGroupThreads). Mirrors the room-level rule shipped the
    // same week in 20260919_room_dots_red_persists.sql. Desktop's handler
    // never stamped this; mobile is now at parity.
    // Stamp progress-at-open locally too (2026-09-20) so the catch-up GREEN
    // clears on this expand rather than waiting for the server round-trip —
    // mark_thread_seen writes the same pair. effectiveProgress = the rewatch
    // ceiling when rewatching, matching the SQL's CASE.
    {
      const effNow = effectiveProgress(progressForShow);
      if (effNow) setSeenProgress((prev) => ({ ...prev, [threadId]: { season: effNow.s, episode: effNow.e } }));
    }
    setEngagedSet((prev) => (prev.has(threadId) ? prev : new Set(prev).add(threadId)));
    // Server stamp — makes opens CROSS-DEVICE (and feeds CP2's exact room
    // dots). Tolerant fire-and-forget.
    if (!privateOnly && roomId) markThreadSeen(roomId, threadId).catch(() => { /* tolerate */ });
  }, [perThreadLatestReply, privateOnly, roomId, progressForShow]);

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

  // The reference exists once the dial reaches S1E1 (and the show can be
  // bridged to the databases) — rewatch-aware. MUST sit above the loading
  // early-return (hooks run on every render).
  const refEff = effectiveProgress(progressForShow);
  const referenceAvailable = !!show?.tvmazeId && !!refEff && (refEff.s > 1 || (refEff.s === 1 && refEff.e >= 1));
  useEffect(() => {
    // Only bounce AFTER the load has landed — on arrival from the dashboard
    // band the progress row isn't fetched yet, and the pre-load bounce was
    // kicking band arrivals onto the drafts tab (Alborz catch 2026-09-05).
    if (!loading && tab === "reference" && !referenceAvailable) setTab(privateOnly ? "private" : "friend");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, referenceAvailable, loading]);

  // "created by …" swaps in for the "with …" line on the reference tab
  // (desktop parity). Fetched only while ON the tab; module-cached. MUST
  // sit above the loading early-return.
  const [refCreatedBy, setRefCreatedBy] = useState<string[]>([]);
  useEffect(() => {
    if (tab !== "reference" || !referenceAvailable || !show?.id) return;
    let cancelled = false;
    ensureShowReference(show.id)
      .then((r) => { if (!cancelled) setRefCreatedBy(r.createdBy ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tab, referenceAvailable, show?.id]);

  if (authLoading || loading) {
    return (
      <div style={{ ...page, background: C.green, display: "flex", alignItems: "center", justifyContent: "center" }} aria-busy="true">
        {/* Standard loading line: "loading" + ellipses, Header 2, cream. */}
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: C.cream }}>loading<LoadingDots /></span>
      </div>
    );
  }

  const bodyBg = tab === "friend" ? C.sky : tab === "reference" ? C.yellow : C.green;
  const visibleFriendEntries = userFilter ? feedEntries.filter((e) => e.authorId === userFilter) : feedEntries;
  const effectiveSortOrder = userFilter ? "desc" : sortOrder;

  const privateFeedEntries: V2RoomFeedEntry[] = privateEntries.map((t) => ({
    threadId: t.id, s: t.season, e: t.episode, title: t.titleBase, body: t.body, preview: t.preview,
    authorId: user?.id ?? "", authorUsername: t.author,
    isRewatch: t.isRewatch, rewatchS: t.rewatchS, rewatchE: t.rewatchE, isEdited: t.isEdited,
    isDeparted: false, isDeleted: t.isDeleted ?? false,
    updatedAt: t.updatedAt, replyCount: 0, thread: t,
  }));

  // username → the viewer's given name (identity fallback) for the reused
  // feed components + roster + filter — desktop's displayNames convention.
  const displayNames: Record<string, string> = {};
  for (const mm of mapMembers) if (mm.username) displayNames[mm.username] = roomContactNames[mm.userId] ?? mm.displayName ?? mm.username;

  return (
    <div ref={pageRef} style={{ ...page, background: bodyBg }}>
      {/* Fit the reused OneSelectProgress pill to the phone: the select sizes
          to its widest option label ("you've watched: S02 E08"), which pushed
          it offscreen. Cap it at the cell's width — the browser truncates the
          selected label; the opened option list is unaffected. Scoped to this
          page's cell class so desktop is untouched. */}
      <style>{`
        .m-progress-cell { min-width: 0; flex: 0 1 auto; }
        .m-progress-cell > span { max-width: 100%; }
        .m-progress-cell select { max-width: 100%; text-overflow: ellipsis; }
        /* Control card (polish pass 2026-09-14): the shared progress pill
           renders as text-with-chevron in the card's dark ink — the select
           stays, only the chrome goes. !important beats the component's
           inline pill styling; the drafts tab's cream border-color rule
           can't resurface because border-style goes to none. */
        .m-progress-cell select {
          -webkit-appearance: none !important; appearance: none !important;
          background: transparent !important; border: none !important; border-radius: 0 !important;
          color: ${C.midnight} !important; font-weight: 700 !important; font-size: 14px !important;
          padding: 0 22px 0 0 !important; min-height: 44px;
          text-align: right; text-align-last: right;
        }
        .m-progress-cell svg { stroke: ${C.midnight}; width: 16px; height: 16px; right: 0 !important; }
        /* Guide + drafts (Alborz 2026-09-16): the picker LEADS those rows,
           so it reads from the left and takes the width it's given (on the
           guide tab that's the whole row — nothing sits opposite it). */
        .m-progress-cell--left { flex: 1 1 auto; }
        .m-progress-cell--left select { text-align: left; text-align-last: left; }
      `}</style>
      {/* ── Header: back · show name (+ with group) · digest gear ── */}
      <div style={{ background: tab === "private" ? C.sky : C.green }}>
        <div style={topBar}>
          <button style={iconBtn} title={privateOnly ? "back to dashboard" : "back to group"} onClick={closeRoom}>
            <ArrowLeft size={20} color={C.cream} />
          </button>
          {/* Gear rides RIGHT BESIDE the title (Alborz 2026-08-14 —
              group-room parity); the "with {group}" / "created by …" line
              is a CAPTION under the title (polish pass 2026-09-14 — it
              lived inline inside the h1). */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
              <h1 style={{ ...headerTitle, flex: "0 1 auto" }}>{show?.name ?? "Show"}</h1>
              {!privateOnly && roomId && (
                <button style={{ ...iconBtn, margin: "-8px 0" }} aria-label="Email updates for this room" title="Email updates for this room" onClick={openDigestModal}>
                  <Settings size={20} color={C.cream} />
                </button>
              )}
            </div>
            {(tab === "reference" && refCreatedBy.length > 0) || groupName ? (
              <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 400, fontSize: 13, lineHeight: 1.45, color: C.cream, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {tab === "reference" && refCreatedBy.length > 0 ? <>created by {refCreatedBy.join(" & ")}</> : <>with {groupName}</>}
              </div>
            ) : null}
          </div>
        </div>
        {/* Tabs on the header/body boundary (same swap rule as desktop). */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, padding: "8px 16px 0" }}>
          {!privateOnly && <RoomTab label="friend room" active={tab === "friend"} bg={C.sky} onClick={() => setTab("friend")} />}
          {referenceAvailable && <RoomTab label="show guide" active={tab === "reference"} bg={C.yellow} onClick={() => setTab("reference")} />}
          {/* CP6: solo → drafts (desktop parity) — just-for-you space. */}
          <RoomTab label="drafts" active={tab === "private"} bg={C.green} onClick={() => setTab("private")} />
        </div>
      </div>

      <div style={{ padding: "16px 16px 120px" }}>
        {/* Help-system QA round 8: the progress-picker pointer sits ABOVE
            the control card, its ↓ pointing at the picker row inside it;
            first-entrance, X-able, any progress. */}
        {tab === "friend" && user && <RoomProgressTip idiom="mobile" userId={user.id} />}

        {/* ── Control card (polish pass 2026-09-14; map pass 2026-09-23):
               sort + progress · Map · Write in ONE cream card, dark ink.
               Friend tab = all rows; drafts = picker + Write; guide =
               picker only. (The roster row that led the card until the
               map sheet arrived is gone — the map's header is the roster.) ── */}
        <div style={controlCard}>
          {/* Row 1 — sort/filter as text-with-chevron · "you've watched"
              picker (the <select>s stay; only the chrome changed). */}
          <div style={controlRow}>
            {tab === "friend" && !privateOnly && feedEntries.length > 0 ? (
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center", minHeight: 44 }}>
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
                        <option key={m.userId} value={`user:${m.userId}`}>only {m.userId === user?.id ? "you" : (displayNames[m.username] ?? m.username)}{m.isDeparted ? " (left)" : ""}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <ChevronDown size={16} color={C.midnight} style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              </span>
            ) : (tab === "reference" || tab === "private") && show && progressForShow ? (
              /* Guide + drafts tabs: the picker LEADS the row — alone on
                 the guide (the canon pill was retired from this card,
                 Alborz 2026-09-16), opposite Write on drafts. */
              <div className={`m-progress-cell m-progress-cell--left${tab === "private" ? " private-progress" : ""}`} style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                <OneSelectProgress
                  show={show}
                  value={effectiveProgress(progressForShow) || { s: 1, e: 1 }}
                  onConfirm={onProgressConfirm}
                  onForwardPick={onForwardPick}
                  requireConfirm
                  allowZero
                  shortLabel
                />
              </div>
            ) : <span />}
            {tab === "private" ? (
              /* S pill (Alborz 2026-09-16): the M pill read too thick
                 inside the 60px band — this matches the retired canon
                 pill's weight. */
              <button style={writeBtnInline} onClick={() => { setComposeAuto(false); setComposeOpen(true); setComposeMinimized(false); }}><SquarePen size={16} /> Write</button>
            ) : tab === "friend" && show && progressForShow ? (
              <div className="m-progress-cell" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                <OneSelectProgress
                  show={show}
                  value={effectiveProgress(progressForShow) || { s: 1, e: 1 }}
                  onConfirm={onProgressConfirm}
                  onForwardPick={onForwardPick}
                  requireConfirm
                  allowZero
                  shortLabel
                />
              </div>
            ) : null}
          </div>
          {/* Rows 2 + 3 — Map, then Write, full width inside the card
              (friend tab; the drafts tab's Write sits in its one-row card
              above, pass 3). Map leads (Alborz 2026-09-23: "I want to
              emphasize the map feature") in Identity, sized and weighted
              exactly like Write. No write on the reference tab (2026-09-05). */}
          {tab === "friend" && (
            <div style={{ padding: "4px 12px 12px", display: "grid", gap: 10 }}>
              {!privateOnly && roomId && mapMembers.length > 0 && (
                <button style={mapBtn} onClick={() => setMapSheetOpen(true)}><LayoutGrid size={16} /> Map</button>
              )}
              <button style={writeBtn} onClick={() => { setComposeAuto(false); setComposeOpen(true); setComposeMinimized(false); }}><SquarePen size={16} /> Write</button>
            </div>
          )}
        </div>

        {/* ── Feed (shared V2RoomFeed — expansion, respond, edit, stubs) ── */}
        {tab === "reference" && show && refEff && (
          <ShowReference showId={show.id} viewerProgress={refEff} mobile showRoomLinks={privateOnly} nudgeEssentials={!!(location.state as { essentialsNudge?: boolean } | null)?.essentialsNudge} />
        )}
        {/* Friend + drafts columns stay MOUNTED (display:none) on the other
            tabs, so in-progress replies/drafts survive a guide check
            (Alborz 2026-09-08). */}
        {!privateOnly && (
        <div style={{ display: tab === "friend" ? undefined : "none" }}>
          {unlockNote && <UnlockLine note={unlockNote} nameOf={(u) => displayNames[u] ?? u} />}
          {feedEntries.length === 0 ? (
            <div style={{ maxWidth: 420 }}>
              <p style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, color: C.cream, margin: "16px 0 12px" }}>Be a trailblazer.</p>
              <p style={emptyCopy}>You're the first one in here. Start writing so your friends have letters to open as they finish episodes.</p>
              <p style={emptyCopy}>Think of it as sending them letters from the future!</p>
            </div>
          ) : (
            <V2RoomFeed
              ref={feedRef}
              mobileIdiom
              displayNames={displayNames}
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
              onClickProfile={openPool}
              isNewMap={isNewMap}
              cellSignals={cellSignals}
              entryRedChevron
              engagedThreadIds={engagedSet}
              // CP4: stub audience decided at display time — exactly one OTHER
              // current room member → "you", 2+ → "the room" (departed members
              // don't count; desktop parity).
              gatedStubAudience={mapMembers.filter((m) => !m.isDeparted && m.userId !== user?.id).length === 1 ? "you" : "the room"}
              seasons={show?.seasons}
              positions={roadPositions}
              onReplyAdded={(tid) => setFeedEntries((prev) => prev.map((e) => (e.threadId === tid ? { ...e, replyCount: e.replyCount + 1 } : e)))}
            />
          )}
        </div>
        )}
        <div className="drafts-lane" style={{ display: tab === "private" ? undefined : "none" }}>
            {privateFeedEntries.length > 0 && (
              <V2RoomFeed
                mobileIdiom
                displayNames={displayNames}
                entries={privateFeedEntries}
                viewerProgress={progressForShow}
                userId={user?.id ?? ""}
                onThreadEdited={() => load()}
                onThreadDeleted={() => load()}
              />
            )}
            {/* Pass 3: the explainer is the dashed-cream "not here yet"
                card, three levels, copy verbatim; below drafts when they
                exist, the empty state otherwise. */}
            <div style={{ marginTop: privateFeedEntries.length ? 40 : 8, border: "2px dashed rgba(254,248,234,0.8)", borderRadius: 24, padding: 20, boxSizing: "border-box" }}>
              <p style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, lineHeight: 1.3, color: C.cream, margin: "0 0 10px" }}>Sidebar is best with friends.</p>
              <p style={{ fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 15, lineHeight: 1.5, color: C.cream, margin: "0 0 10px" }}>But this drafts space is just for you — no one will ever see what you write here.</p>
              <p style={{ fontFamily: '"Inter", sans-serif', fontWeight: 400, fontSize: 14, lineHeight: 1.5, color: C.cream, opacity: 0.85, margin: 0 }}>Draft freely or keep a private journal; sometimes we do our best thinking when we write for ourselves. When something&rsquo;s ready for your friends, copy and paste it into a letter.</p>
            </div>
        </div>
      </div>

      {/* ── Compose — full-screen (mobile idiom of desktop's centered card) ── */}
      {composeOpen && createPortal(
        <>
        <div style={{ ...composeShell, ...(composeMinimized ? { display: "none" } : {}) }}>
          {/* Pass 3: 40 → 44 circles at the standard top-bar spots —
              minimize LEFT, discard RIGHT; the caption between them
              (rendered by ComposeForm) names destination · tag. */}
          <button onClick={() => composeFormRef.current?.attemptDiscard()} aria-label="Discard and close" style={composeCloseX}><X size={20} color={CANON.alert} /></button>
          <button onClick={() => setComposeMinimized(true)} aria-label="Minimize — your draft stays" style={{ ...composeCloseX, right: "auto", left: 12, border: `2px solid ${CANON.identity}` }}><Minus size={20} color={CANON.identity} /></button>
          <ComposeForm
            ref={composeFormRef}
            autoPrompt={composeAuto}
            mobileIdiom
            showId={show?.id}
            restrictGroupId={privateOnly ? undefined : roomId}
            privateOnly={privateOnly}
            defaultDestination={privateOnly ? undefined : (tab === "private" ? "private" : roomId)}
            mobileHeaderContext={privateOnly || tab === "private" ? "Draft" : (groupName ?? "Your room")}
            hideTopRightClose
            // A progress advance made inside the composer refetches the room
            // (signals, hidden counts) — same as the room picker's path.
            onProgressPersisted={() => { void load(); }}
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
        {composeMinimized && (
          <button onClick={() => setComposeMinimized(false)} style={{ ...continueChip, color: CANON.identity }}>
            <SquarePen size={14} color={CANON.identity} /> continue writing
          </button>
        )}
        </>,
        document.body,
      )}

      {/* ── Member pool overlay (byline tap) — the room stays mounted under
             it; closing = history.back() so swipe and button share one path. ── */}
      {poolUser && (
        <MobilePool username={poolUser} overlay onBack={() => window.history.back()} />
      )}

      {/* ── Season map sheet (2026-09-23, direction A): cream, grabber +
             swipe-down + tap-out, a fixed 80dvh so folding a season never
             moves the sheet. Title + caption stay put; the map scrolls
             inside (and pans sideways for wide rooms). Tap a cell → the
             sheet closes and the feed scrolls to that entry, highlighted;
             tap a friend → their profile over the still-open sheet; tap
             your own icon → the rating edit mode (Save commits; closing
             the sheet mid-edit drops unsaved taps). Red dots have no
             dismiss here (Alborz 2026-09-23). ── */}
      {mapSheetOpen && roomId && show && user && (
        <div style={dim} onClick={(e) => { if (e.target === e.currentTarget) setMapSheetOpen(false); }}>
          <div
            style={{ ...sheetShell, background: C.cream, padding: "12px 0 calc(env(safe-area-inset-bottom, 0px) + 12px)", height: "80dvh", display: "flex", flexDirection: "column", overflowY: "hidden", ...mapSwipe.style }}
            {...mapSwipe.handlers}
          >
            <div style={OVERLAY.grabber(CANON.dark)} />
            <div style={{ ...M.type.title, color: C.midnight, padding: "0 20px" }}>Season map</div>
            <div style={{ ...M.type.caption, color: withAlpha(CANON.dark, 0.7), padding: "0 20px", marginTop: 4 }}>
              {mapEditing
                ? "Tap your cells to rate them — each tap adds a star. Save when you're done."
                : "Tap a cell to open its letter. Tap your own icon to rate the episodes you've watched."}
            </div>
            <div ref={mapScrollRef} style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", marginTop: 14, WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
              <V2RoomMap
                mobile
                members={mapMembers}
                displayNames={displayNames}
                seasons={show.seasons ?? []}
                viewerProgress={progressForShow}
                viewerUserId={user.id}
                groupId={roomId}
                onEntryClick={(tid) => { setMapSheetOpen(false); feedRef.current?.scrollToEntry(tid); }}
                onCommitRatings={commitRatings}
                onPollOpened={() => {}}
                cellSignals={cellSignals}
                isNewMap={isNewMap}
                filteredUserId={userFilter}
                onMemberClick={openPool}
                onEditModeChange={setMapEditing}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Rate the episode you just finished (forward progress pick) ── */}
      {pendingRating && (
        <RatingCaptureModal
          mobile
          showName={show?.name}
          season={pendingRating.s}
          episode={pendingRating.e}
          onCommit={commitRating}
          onCancel={() => setPendingRating(null)}
          onSkip={skipRating}
        />
      )}

      {/* ── Room settings (digest gear) — yellow sheet, left-justified
             (polish pass 2026-09-14): grabber, room title, labelled Email
             updates section with the explanation BEFORE the button, then the
             two-path leave/done section with a caption under each exit. ── */}
      {digestModalOpen && roomId && (
        <div style={dim} onClick={() => { if (!digestBusy) setDigestModalOpen(false); }}>
          <div style={{ ...sheetShell, background: C.yellow, ...digestSwipe.style }} {...digestSwipe.handlers} onClick={(e) => e.stopPropagation()}>
            <div style={OVERLAY.grabber(CANON.cream)} />
            <div style={{ ...M.type.title, color: C.cream }}>{show?.name ?? "Show"} room</div>
            {groupName && <div style={{ ...digestSub, marginTop: 2 }}>with {groupName}</div>}
            <div style={{ ...digestLabel, marginTop: 20 }}>Email updates</div>
            {digestOptOut === null ? (
              <div style={{ color: C.cream, fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, padding: "6px 0" }}>loading<LoadingDots /></div>
            ) : digestOptOut ? (
              <>
                <div style={{ ...digestSub, marginBottom: 12 }}>You'll get the daily digest again when this room has new activity you haven't seen.</div>
                <button style={alertBtn} disabled={digestBusy} onClick={() => applyDigest(false)}>Resubscribe</button>
              </>
            ) : (
              <>
                <div style={{ ...digestSub, marginBottom: 12 }}>A daily digest when this room has activity you haven't seen. You can resubscribe here anytime.</div>
                <button style={alertBtn} disabled={digestBusy} onClick={() => applyDigest(true)}>Unsubscribe</button>
              </>
            )}
            {/* CP5 + DNF (2026-09-13): per-room leave AND "we're done with
                this one" both live here (alongside the shelf long-press) —
                the two-path grammar; each exit explained in place. */}
            <div style={digestDivider} />
            <div style={digestLabel}>Leaving, or done watching?</div>
            <button style={alertBtn} onClick={() => { setDigestModalOpen(false); setLeaveConfirmOpen(true); }}>Leave (just you)</button>
            <div style={{ ...digestSub, margin: "10px 0 16px" }}>Your letters stay. Re-propose the show to rejoin.</div>
            <button style={identityBtnM} disabled={dnfBusy} onClick={doDnfRoom}>{dnfBusy ? "one moment…" : "We’re done with this one"}</button>
            <div style={{ ...digestSub, marginTop: 10 }}>Parks the show for the whole group. Anyone can bring it back later.</div>
          </div>
        </div>
      )}

      {/* ── CP5: leave-room confirm (yellow sheet; polish pass 2026-09-14:
             Lora title, one body paragraph, alert-FILL Leave + outlined
             Cancel — a bare text "cancel" had no target). ── */}
      {leaveConfirmOpen && roomId && (
        <div style={dim} onClick={(e) => { if (e.target === e.currentTarget && !leaveBusy) setLeaveConfirmOpen(false); }}>
          <div style={{ ...sheetShell, background: C.yellow, ...leaveSwipe.style }} {...leaveSwipe.handlers}>
            <div style={OVERLAY.grabber(CANON.cream)} />
            <div style={{ ...M.type.title, color: C.cream, marginBottom: 12 }}>Leave this show room?</div>
            <div style={{ color: C.cream, fontSize: 15, lineHeight: 1.5, marginBottom: 18 }}>
              This takes you out of the <b>{show?.name ?? "show"}</b> room in this group and removes it from your list. Your letters stay; re-propose the show to rejoin.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start", gap: 12, alignItems: "center" }}>
              <button style={{ ...M.pill.M, background: CANON.alert, color: CANON.cream, opacity: leaveBusy ? 0.6 : 1 }} disabled={leaveBusy} onClick={doLeaveRoom}>Leave</button>
              <button style={{ ...M.pill.M, background: "transparent", color: C.cream, border: "2px solid var(--canon-cream,#fef8ea)" }} disabled={leaveBusy} onClick={() => setLeaveConfirmOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Swipe-deck arc CP4 — the drip / catch-up modal fires wherever
             the user is (once per session; self-skipping). ── */}
      {user && <DeckWave wave="drip" heading="none" idiom="mobile" onComplete={() => {}} />}
    </div>
  );
}

function RoomTab({ label, active, bg, onClick }: { label: string; active: boolean; bg: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        cursor: "pointer", padding: "10px 18px", minHeight: 44,
        borderTopLeftRadius: 12, borderTopRightRadius: 12,
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
const topBar: React.CSSProperties = { ...M.topBar };
const iconBtn: React.CSSProperties = { ...M.iconBtn };
const headerTitle: React.CSSProperties = {
  flex: 1, minWidth: 0, fontFamily: LORA, fontWeight: 700, fontSize: 22, letterSpacing: 0,
  color: C.cream, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};
// The control card (polish pass 2026-09-14): roster + sort/progress + Write
// as one cream card, dark ink.
const controlCard: React.CSSProperties = {
  background: C.cream, borderRadius: 12, marginBottom: 24, overflow: "hidden",
};
const controlRow: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  minHeight: 48, padding: "0 14px", boxSizing: "border-box",
};
const writeBtn: React.CSSProperties = {
  ...M.pill.M, display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 8,
  background: C.yellow, color: CANON.cream,
};
// The map's door (2026-09-23): Write's exact pill in Identity.
const mapBtn: React.CSSProperties = { ...writeBtn, background: CANON.identity };
// Drafts tab: the same pill one size down, sitting IN the control row.
const writeBtnInline: React.CSSProperties = {
  ...M.pill.S, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  background: C.yellow, color: CANON.cream, flexShrink: 0,
};
// Text-with-chevron inside the control card (the chevron is a lucide sibling
// painted over the reserved right padding).
const sortSelect: React.CSSProperties = {
  appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
  background: "transparent", border: "none", color: C.midnight,
  padding: "0 22px 0 0", fontSize: 14, fontWeight: 600, minHeight: 44,
  fontFamily: '"Inter", system-ui, sans-serif', cursor: "pointer", outline: "none",
  // Shares a row with the progress picker — cap width so the pair always fits.
  maxWidth: "42vw", textOverflow: "ellipsis",
};
const emptyCopy: React.CSSProperties = { color: C.cream, opacity: 0.85, fontSize: 14, lineHeight: 1.5 };
const composeShell: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, background: C.cream, overflowY: "auto",
  WebkitOverflowScrolling: "touch",
};
// The minimized-compose dock (rev): the deck card's docked-tab grammar —
// cream, rounded-top, flush to the page bottom (safe-area padded), label in
// the current tab's body color (set inline).
const continueChip: React.CSSProperties = {
  position: "fixed", bottom: 0, right: 32, zIndex: 1001,
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  background: CANON.cream, border: "none", minWidth: 210,
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14,
  padding: "11px 20px", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 13px)",
  borderRadius: "24px 24px 0 0", cursor: "pointer",
  boxShadow: "0 -6px 24px rgba(0,0,0,0.18)",
};
const composeCloseX: React.CSSProperties = {
  position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: 12,
  background: "var(--canon-cream,#fef8ea)", border: "2px solid var(--canon-alert,#f45028)",
  color: CANON.alert, borderRadius: "50%", width: 44, height: 44, padding: 0,
  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 1010,
};
const dim: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, background: "rgba(26,58,74,0.35)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
  animation: "mDimIn 180ms ease-out",
};
// The shared sheet shell (polish pass 2026-09-14): grabber + 180ms rise +
// swipe-down; add background per sheet.
const sheetShell: React.CSSProperties = {
  ...OVERLAY.sheet, overscrollBehavior: "none",
};
const digestLabel: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif', color: CANON.cream, fontSize: 14, fontWeight: 700, marginBottom: 8,
};
const alertBtn: React.CSSProperties = {
  ...M.pill.M, border: `2px solid ${CANON.alert}`, background: "transparent", color: CANON.alert,
};
const identityBtnM: React.CSSProperties = {
  // DNF / revive grammar (Alborz): Identity fill AND outline, cream text.
  ...M.pill.M, border: `2px solid ${CANON.identity}`, background: CANON.identity, color: CANON.cream,
};
const digestDivider: React.CSSProperties = { ...OVERLAY.divider(CANON.cream) };
const digestSub: React.CSSProperties = { color: CANON.cream, fontSize: 13, opacity: 0.85, lineHeight: 1.45 };
