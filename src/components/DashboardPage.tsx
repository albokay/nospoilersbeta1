/**
 * DashboardPage — the new home for the groups + show-rooms restructure.
 *
 * Two contexts in one surface:
 *   • Dashboard (green)  — your show pool, search-first (§4).
 *   • Group (sky/blue)   — a people-group's pooled shelves with the §7 pill
 *                          system. Opening a group recolors the dashboard.
 *
 * Mounted at /dashboard, coexisting with the live site until the gated cutover.
 *
 * Built so far:
 *   CP2 — green dashboard: search → pick progress → add to pool; two shelves.
 *   CP3a — group context: sky recolor, pooled shelves + pill system; INVITE
 *          FRIENDS creates a people-group; rail enters/exits groups.
 *
 * Deferred (marked inline):
 *   • §9 click model on pills (vote toggles, start/open room) → CP3b
 *   • remove-from-pool "x" + cascade                          → CP3b
 *   • email invites + accept, rail invite/color states, chat, gear options → CP5/CP6
 *   • clicking a show into its room                           → CP4
 */
import { useEffect, useMemo, useState, useCallback, useRef, Fragment } from "react";
import { CANON } from "../styles/canon";
import { preventLastWordOrphan } from "../lib/utils";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { X, Settings, Pencil, Triangle, ArrowUp, LogOut, ArrowLeft, MessageCircle, UserCog } from "lucide-react";
import { useAuth } from "../lib/auth";
import AccountModal from "./AccountModal";
import {
  fetchShows,
  refreshStaleShows,
  createShow,
  fetchProgress,
  upsertRewatchStatus,
  fetchPeopleGroupsForUser,
  fetchPeopleGroupMembers,
  fetchGroupDashboard,
  createPeopleGroup,
  setShowVote,
  startShowRoom,
  createPeopleGroupInvite,
  sendGroupInviteEmail,
  acceptPeopleGroupInvite,
  declinePeopleGroupInvite,
  leavePeopleGroup,
  renamePeopleGroup,
  fetchMyPendingGroupInvites,
  fetchGroupPendingInvites,
  fetchGroupMessages,
  sendGroupMessage,
  fetchOutOfPoolShows,
  removeShowFromPool,
  restoreShowToPool,
  clearMigrationDormantForShow,
  fetchRoomActivityVisibility,
  roomHasNewActivity,
  roomHasNewInvisibleActivity,
  fetchGroupChatActivity,
  chatHasNewActivity,
  markGroupChatSeen,
  fetchTspDemoSeen,
  markTspDemoSeen,
  type Show,
  type GroupDashboardShow,
  type PendingGroupInvite,
  type GroupMessage,
  type RoomVisibility,
  type GroupChatActivity,
} from "../lib/db";
import { computePill, linearIndex, type PillData } from "../lib/groupPills";
import { tvmazeSearch, tvmazeEpisodes, networkLabel, slugify, type TVmazeShow } from "../lib/tvmaze";
import type { ProgressEntry, PeopleGroup, PeopleGroupMember } from "../types";
import SidebarLogo from "./SidebarLogo";
import OneSelectProgress from "./OneSelectProgress";
import TrailerCard from "./TrailerCard";
import { prefetchTrailers } from "../lib/trailers";
import TSPDemoModal from "./TSPDemoModal";
import GroupRoomSticky from "./GroupRoomSticky";
import { linkifyText } from "../lib/linkify";

// TSP onboarding demo (spec §9): the onboarding for the NEW /dashboard world.
// ENABLED — the demo auto-shows once on a user's first arrival at the base
// /dashboard (gated by the durable profiles.tsp_demo_seen_at flag). This does
// NOT change live signup routing: general new sign-ups still get the old
// onboarding → /journal; only people who reach /dashboard (e.g. accepting a
// group invite, which routes here) see the demo. Requires migration
// 20260623_profiles_tsp_demo_seen.sql applied, or the demo re-shows every
// /dashboard visit (the once-only flag can't persist without the column).
// ?tspdemo=1 still force-shows for testing.
const TSP_DEMO_ENABLED = true;

// ── §16 palette (authoritative) ──────────────────────────────────────────────
const C = {
  green:    CANON.personal,
  sky:      CANON.friend,
  blue:     CANON.identity,
  yellow:   CANON.accent,
  red:      CANON.alert,
  cream:    CANON.cream,
  midnight: CANON.dark,
  greyblue: CANON.business,
};
const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

// New-activity tooltip copy (matches the live site's room/feed notification text).
const NOTIF_VISIBLE = "There is new writing in here for you.";
const NOTIF_INVISIBLE = "There is new writing in here for you… for when you catch up.";

type RailGroup = { group: PeopleGroup; members: PeopleGroupMember[]; pendingHandles: string[] };

export default function DashboardPage() {
  const { user, profile, loading: authLoading, signOut } = useAuth() as any;
  const navigate = useNavigate();
  const location = useLocation();

  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [railGroups, setRailGroups] = useState<RailGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAccount, setShowAccount] = useState(false);

  // TSP onboarding demo (spec §9). Force-show for testing with ?tspdemo=1; the
  // real once-only post-signup auto-show is gated behind TSP_DEMO_ENABLED
  // (off until cutover) + the durable tsp_demo_seen_at flag.
  const forceTspDemo = new URLSearchParams(location.search).get("tspdemo") === "1";
  const [showTspDemo, setShowTspDemo] = useState(forceTspDemo);
  useEffect(() => {
    if (forceTspDemo) { setShowTspDemo(true); return; }
    if (!TSP_DEMO_ENABLED || !user) return;
    // Only auto-show on the BASE dashboard — never overlay a deep-linked group
    // context (?g=…). Invitees land on the plain /dashboard, so this still fires.
    if (new URLSearchParams(location.search).get("g")) return;
    let cancelled = false;
    fetchTspDemoSeen(user.id).then((seen) => { if (!cancelled && !seen) setShowTspDemo(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [forceTspDemo, user, location.search]);
  function closeTspDemo() {
    setShowTspDemo(false);
    if (!forceTspDemo && user) markTspDemoSeen(user.id).catch(() => {});
  }
  const [outOfPool, setOutOfPool] = useState<Set<string>>(new Set());
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; name: string } | null>(null);

  // Group context
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupShows, setGroupShows] = useState<GroupDashboardShow[]>([]);

  // Search + add-to-pool
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pickShow, setPickShow] = useState<Show | null>(null);
  const [pickProgress, setPickProgress] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  // Add-from-TVMaze: when a search has no catalog match, look the show up on
  // TVMaze and create it on pick (restores the old app's ability to add a brand-
  // new show — the restructured dashboard search was catalog-only).
  const [tvResults, setTvResults] = useState<TVmazeShow[]>([]);
  const [tvLoading, setTvLoading] = useState(false);
  const [creatingShow, setCreatingShow] = useState(false);
  const tvDebounceRef = useRef<number | null>(null);

  // Invite / create-group modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmails, setInviteEmails] = useState<string[]>([""]);
  const [inviteFromName, setInviteFromName] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<{ email: string; link?: string; error?: string; emailFailed?: boolean }[] | null>(null);
  // null = INVITE FRIENDS (form a NEW group); set = "connect more" to this group.
  const [inviteTargetGroupId, setInviteTargetGroupId] = useState<string | null>(null);

  // §9 click-model popover (group context). mode captured at click time.
  const [clicked, setClicked] = useState<{ showId: string; name: string; mode: "solo" | "vote" | "watchq" } | null>(null);
  const [declaredProgress, setDeclaredProgress] = useState<{ s: number; e: number }>({ s: 0, e: 0 });

  // CP5b: pending invites (rail "*you're invited"), group options (gear).
  const [pendingInvites, setPendingInvites] = useState<PendingGroupInvite[]>([]);
  const [invitePrompt, setInvitePrompt] = useState<PendingGroupInvite | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [optionsFor, setOptionsFor] = useState<string | null>(null); // group id whose gear options are open
  const [optionsAnchor, setOptionsAnchor] = useState<{ x: number; y: number } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // CP6: group chat panel.
  const [chatGroupId, setChatGroupId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<GroupMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  // Keep the chat scrolled to the newest message (on open, send, or an
  // incoming realtime message while the panel is open).
  const chatBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chatBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  // New-activity dots: per-room visibility (own excluded) + per-group chat state.
  const [roomVis, setRoomVis] = useState<RoomVisibility[]>([]);
  const [chatActivity, setChatActivity] = useState<GroupChatActivity[]>([]);

  // Personal-dashboard pill click → progress dropdown (+ write-by-yourself on
  // the currently-watching shelf). mode distinguishes the two shelves.
  const [pillModal, setPillModal] = useState<{ showId: string; name: string; mode: "watching" | "notStarted" } | null>(null);

  // Cursor-following tooltip (opt-in avatars + show-button watch progress).
  // `sub` adds a second line beneath a divider — used to hang the new-activity
  // notification copy under a show button's "You've watched…" line. `wrap`
  // lets the longer notification copy break instead of forcing a wide bubble.
  const [tip, setTip] = useState<{ text: React.ReactNode; sub?: React.ReactNode; wrap?: boolean; x: number; y: number } | null>(null);
  // progress = the "You've watched…" line (top); notif = the new-activity line.
  // When both exist the notif hangs beneath a divider; a notif alone shows on
  // its own. Nothing to show → no tooltip.
  function tipProps(progress?: string, notif?: string) {
    const primary = progress ?? notif;
    if (!primary) return {};
    const sub = progress ? notif : undefined;
    const wrap = !!notif; // notification copy is long → allow it to wrap
    return {
      onMouseMove: (e: React.MouseEvent) => setTip({ text: primary, sub, wrap, x: e.clientX, y: e.clientY }),
      onMouseLeave: () => setTip(null),
    };
  }
  // New-activity notification copy for a room's dot (blue = visible writing,
  // red = invisible/ahead-of-progress), or undefined when the room has no dot.
  function roomNotif(roomId?: string | null): string | undefined {
    const dot = roomId ? roomDotByRoomId.get(roomId) : undefined;
    return dot === "red" ? NOTIF_INVISIBLE : dot === "blue" ? NOTIF_VISIBLE : undefined;
  }
  // Currently-watching gap line: your progress vs the OTHER watchers (the N
  // matches the pill's ▲/▼ arrow). Null when there's no one to compare against,
  // or you're even with the leader.
  type WatchRow = { pill: PillData; opted: { username: string; s: number | null; e: number | null }[]; selfProg: { s: number; e: number } | null };
  function watchGapLine(r: WatchRow): string | null {
    const seasons = showsById[r.pill.showId]?.seasons;
    const others = r.opted.filter((o) => (o.s ?? 0) > 0 || (o.e ?? 0) > 0);
    if (!others.length) return null;
    const selfIdx = linearIndex(r.selfProg?.s ?? 0, r.selfProg?.e ?? 0, seasons);
    const eps = (n: number) => (n === 1 ? "1 episode" : `${n} episodes`);
    if (others.length === 1) {
      const o = others[0];
      const n = selfIdx - linearIndex(o.s ?? 0, o.e ?? 0, seasons);
      if (n === 0) return null;
      return n > 0 ? `You're ${eps(n)} ahead of ${o.username}.` : `You're ${eps(-n)} behind ${o.username}.`;
    }
    const maxOther = Math.max(...others.map((o) => linearIndex(o.s ?? 0, o.e ?? 0, seasons)));
    if (selfIdx < maxOther) return `You're ${eps(maxOther - selfIdx)} behind the furthest watcher.`;
    if (selfIdx > maxOther) return `You're ${eps(selfIdx - maxOther)} ahead of your next friend.`;
    return null; // even with the furthest watcher
  }
  // Currently-watching pill tooltip: progress, gap line, then new-activity notif
  // — each separated by a thin cream divider.
  function watchingTipProps(r: WatchRow) {
    const lines: React.ReactNode[] = [];
    if (r.selfProg) lines.push(`You've watched: S${r.selfProg.s} E${r.selfProg.e}`);
    const gap = watchGapLine(r);
    if (gap) lines.push(gap);
    const notif = roomNotif(r.pill.roomId);
    if (notif) lines.push(notif);
    if (!lines.length) return {};
    const [primary, ...rest] = lines;
    const sub = rest.length
      ? <>{rest.map((l, i) => <Fragment key={i}>{i > 0 && <div style={tipDivider} />}{l}</Fragment>)}</>
      : undefined;
    return {
      onMouseMove: (e: React.MouseEvent) => setTip({ text: primary, sub, wrap: true, x: e.clientX, y: e.clientY }),
      onMouseLeave: () => setTip(null),
    };
  }
  // "Haven't started yet" show button: tooltip lists the other friends who are
  // also interested in the show; falls back to the standard progress/notif tip.
  function interestedTipProps(opted: { username: string }[], showName: string, selfOpted: boolean, selfProgText?: string, notif?: string) {
    if (!opted.length) return tipProps(selfProgText, notif);
    const names = opted.map((o) => o.username);
    return {
      onMouseMove: (e: React.MouseEvent) => setTip({ text: interestedNode(names, showName, selfOpted), wrap: true, x: e.clientX, y: e.clientY }),
      onMouseLeave: () => setTip(null),
    };
  }

  const selfUserId = user?.id ?? "";
  const inGroup = !!activeGroupId;

  // ── Rail (people-groups). Isolated + tolerant so the dashboard works before
  //    the CP1 migration is applied. ─────────────────────────────────────────
  const loadRail = useCallback(async (uid: string) => {
    try {
      const groups = await fetchPeopleGroupsForUser(uid);
      const withMembers = await Promise.all(
        groups.map(async (g) => ({
          group: g,
          members: await fetchPeopleGroupMembers(g.id),
          pendingHandles: await fetchGroupPendingInvites(g.id),
        }))
      );
      return withMembers;
    } catch (e) {
      console.warn("[dashboard] people-groups not loaded (CP1 migration applied?)", e);
      return [];
    }
  }, []);

  // ── Core load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/", { replace: true }); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      let pooled: Show[] = [];
      try {
        const [showRows, prog, oop] = await Promise.all([
          fetchShows(), fetchProgress(user.id), fetchOutOfPoolShows(user.id),
        ]);
        if (cancelled) return;
        setShows(showRows);
        setProgress(prog);
        setOutOfPool(oop);
        // Shows the viewer can log progress on from the personal dashboard.
        pooled = showRows.filter((s) => prog[s.id]);
      } catch (e) {
        console.error("[dashboard] core load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Quietly keep pooled shows' episode lists current (12h cadence; mostly a
      // no-op). Non-blocking — every progress dropdown reads show.seasons, so
      // merging refreshed shows surfaces newly-aired episodes without a reload.
      refreshStaleShows(pooled).then((upd) => {
        if (cancelled || !upd.length) return;
        setShows((prev) => prev.map((s) => upd.find((u) => u.id === s.id) ?? s));
      }).catch(() => {});
      // Secondary data — all independent of one another. Fire concurrently
      // (each sets its own state when it resolves) instead of in a sequential
      // waterfall, so the rail / pending invites / activity dots no longer wait
      // in line behind each other. Each is independently tolerant.
      loadRail(user.id)
        .then((rail) => { if (!cancelled) setRailGroups(rail); })
        .catch((e) => console.warn("[dashboard] rail not loaded", e));
      fetchMyPendingGroupInvites()
        .then((inv) => { if (!cancelled) setPendingInvites(inv); })
        .catch((e) => console.warn("[dashboard] pending invites not loaded", e));
      // New-activity dots — tolerant (degrade to no dots if migrations missing).
      Promise.all([
        fetchRoomActivityVisibility(user.id, true),
        fetchGroupChatActivity(user.id),
      ])
        .then(([rv, ca]) => { if (!cancelled) { setRoomVis(rv); setChatActivity(ca); } })
        .catch((e) => console.warn("[dashboard] activity dots not loaded", e));
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, navigate, loadRail]);

  // ── Group dashboard load ───────────────────────────────────────────────────
  const refreshGroup = useCallback(async (groupId: string) => {
    try {
      const rows = await fetchGroupDashboard(groupId);
      setGroupShows(rows);
      // A group room exposes progress dropdowns for every show in the group —
      // including ones you haven't pooled yet — and they read the same catalog
      // (showsById). Keep those shows' episode lists fresh too (12h cadence,
      // non-blocking). fetchShows() is the warm in-memory cache here.
      const ids = new Set(rows.map((r) => r.showId));
      const catalog = await fetchShows();
      refreshStaleShows(catalog.filter((s) => ids.has(s.id))).then((upd) => {
        if (!upd.length) return;
        setShows((prev) => prev.map((s) => upd.find((u) => u.id === s.id) ?? s));
      }).catch(() => {});
    } catch (e) {
      console.error("[dashboard] group load failed", e);
      setGroupShows([]);
    }
  }, []);

  // Active group is driven by the URL (?g=<id>) so it survives navigation —
  // e.g. the show room's × returns here with ?g set and re-enters the group.
  useEffect(() => {
    const g = new URLSearchParams(location.search).get("g");
    setActiveGroupId(g);
  }, [location.search]);

  useEffect(() => {
    if (!activeGroupId) { setGroupShows([]); return; }
    refreshGroup(activeGroupId);
  }, [activeGroupId, refreshGroup]);

  const showsById = useMemo(() => {
    const m: Record<string, Show> = {};
    for (const s of shows) m[s.id] = s;
    return m;
  }, [shows]);

  // Warm the trailer cache for the active group's NOT-STARTED shows so the
  // opt-in modal's trailer is already resolved before the viewer clicks (zero
  // resolution latency on click). Deferred to browser idle (timeout fallback)
  // so it never competes with the group page's own load — runs only after the
  // page is on screen, fire-and-forget, third-party only (no Supabase egress).
  // prefetchTrailers dedupes, so re-runs as progress/shows change are cheap.
  useEffect(() => {
    if (!activeGroupId || groupShows.length === 0) return;
    const targets = groupShows
      .filter((gs) => { const p = progress[gs.showId]; return !p || (p.s === 0 && p.e === 0); })
      .map((gs) => showsById[gs.showId])
      .filter((sh): sh is Show => !!sh)
      .map((sh) => ({ id: sh.id, tvmazeId: sh.tvmazeId }));
    if (targets.length === 0) return;
    let cancelled = false;
    const ric: any = (window as any).requestIdleCallback;
    const handle = ric
      ? ric(() => { if (!cancelled) prefetchTrailers(targets); }, { timeout: 3000 })
      : setTimeout(() => { if (!cancelled) prefetchTrailers(targets); }, 400);
    return () => {
      cancelled = true;
      if (ric && (window as any).cancelIdleCallback) (window as any).cancelIdleCallback(handle);
      else clearTimeout(handle as any);
    };
  }, [activeGroupId, groupShows, progress, showsById]);

  // ── Dashboard shelves (green) ──────────────────────────────────────────────
  const { watching, notStarted } = useMemo(() => {
    const watching: { show: Show; entry: ProgressEntry }[] = [];
    const notStarted: { show: Show; entry: ProgressEntry }[] = [];
    for (const [showId, entry] of Object.entries(progress)) {
      const show = showsById[showId];
      if (!show) continue;
      if (outOfPool.has(showId)) continue; // removed from pool (progress kept)
      const started = (entry.s ?? 0) > 0 || (entry.e ?? 0) > 0;
      (started ? watching : notStarted).push({ show, entry });
    }
    // Most-recently-updated progress first (then name as a stable tiebreak).
    const byRecent = (a: { show: Show; entry: ProgressEntry }, b: { show: Show; entry: ProgressEntry }) =>
      ((b.entry.progressUpdatedAt ?? 0) - (a.entry.progressUpdatedAt ?? 0)) || a.show.name.localeCompare(b.show.name);
    return { watching: watching.sort(byRecent), notStarted: notStarted.sort(byRecent) };
  }, [progress, showsById, outOfPool]);

  const hasAnyShows = watching.length + notStarted.length > 0;

  // userId → username for the active group (drives the opted-in tooltip).
  const memberNameById = useMemo(() => {
    const m: Record<string, string> = {};
    const ag = railGroups.find((r) => r.group.id === activeGroupId);
    for (const mem of ag?.members ?? []) m[mem.userId] = mem.username;
    return m;
  }, [railGroups, activeGroupId]);

  // ── Group shelves (sky) — pills computed from the aggregation RPC ──────────
  const groupShelves = useMemo(() => {
    type OptIn = { username: string; s: number | null; e: number | null; wrote: boolean };
    type Row = { pill: PillData; name: string; opted: OptIn[]; selfProg: { s: number; e: number } | null; selfOpted: boolean; selfWrote: boolean; tier: number; lastActivityAt: number | null };
    const watching: Row[] = [];
    const notStarted: Row[] = [];
    for (const gs of groupShows) {
      const show = showsById[gs.showId];
      const pill = computePill(gs, show?.seasons, selfUserId);
      // Opted-in members other than you → the avatars overlapping the pill.
      const opted: OptIn[] = gs.members
        .filter((mm) => mm.userId !== selfUserId)
        .map((mm) => ({ username: memberNameById[mm.userId] ?? "someone", s: mm.s, e: mm.e, wrote: !!mm.wrote }));
      // Your own progress on this show (if any) → the show-button tooltip.
      const self = gs.members.find((mm) => mm.userId === selfUserId);
      const selfProg = self && ((self.s ?? 0) > 0 || (self.e ?? 0) > 0) ? { s: self.s as number, e: self.e as number } : null;
      // Activity bucket: 2+ writing → 1 writing → 2+ watching → 1 watching.
      const writerCount = pill.writerCount;
      const watcherCount = gs.members.filter((mm) => (mm.s ?? 0) > 0 || (mm.e ?? 0) > 0).length;
      const tier = writerCount >= 2 ? 0 : writerCount === 1 ? 1 : watcherCount >= 2 ? 2 : watcherCount >= 1 ? 3 : 4;
      // Exactly one writer → mark that writer's avatar (green fill + pencil).
      // (If the lone writer is you, no avatar exists to mark — nothing shows.)
      const row = { pill, name: show?.name ?? gs.showId, opted, selfProg, selfOpted: !!self, selfWrote: !!self?.wrote, tier, lastActivityAt: gs.lastActivityAt };
      (pill.shelf === "watching" ? watching : notStarted).push(row);
    }
    const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);
    // Currently-watching shelf: by bucket, then most recent activity within it.
    const byActivity = (a: Row, b: Row) =>
      (a.tier - b.tier) || ((b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)) || a.name.localeCompare(b.name);
    return { watching: watching.sort(byActivity), notStarted: notStarted.sort(byName) };
  }, [groupShows, showsById, selfUserId, memberNameById]);

  // ── New-activity dots ──────────────────────────────────────────────────────
  // Per room: blue = new VISIBLE writing; red = new INVISIBLE (ahead-of-progress)
  // writing with nothing new visible (visible takes priority). Both clear when
  // you open the room (same last_seen stamp), cascading up to the cluster.
  const roomDotByRoomId = useMemo(() => {
    const m = new Map<string, "blue" | "red">();
    for (const v of roomVis) {
      if (roomHasNewActivity(v)) m.set(v.groupId, "blue");
      else if (roomHasNewInvisibleActivity(v)) m.set(v.groupId, "red");
    }
    return m;
  }, [roomVis]);
  const chatNewByGroup = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const a of chatActivity) m.set(a.groupId, chatHasNewActivity(a));
    return m;
  }, [chatActivity]);
  // Cluster dot: blue if any room has new visible writing OR chat is new; else
  // red if any room has new invisible writing.
  const clusterDotByGroup = useMemo(() => {
    const visible = new Set<string>();
    const invisible = new Set<string>();
    for (const v of roomVis) {
      if (!v.parentGroupId) continue;
      if (roomHasNewActivity(v)) visible.add(v.parentGroupId);
      else if (roomHasNewInvisibleActivity(v)) invisible.add(v.parentGroupId);
    }
    for (const a of chatActivity) if (chatHasNewActivity(a)) visible.add(a.groupId);
    const m = new Map<string, "blue" | "red">();
    for (const g of invisible) m.set(g, "red");
    for (const g of visible) m.set(g, "blue"); // priority
    return m;
  }, [roomVis, chatActivity]);

  // Catalog search (CP2: catalog-only; TVMaze add is a later refinement).
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Exclude shows already in pool; KEEP removed (out-of-pool) shows so they
    // can be re-added (which restores their saved progress).
    // Keep already-in-pool shows in the list (flagged) so we can show an
    // "already in the watch pool" note instead of silently hiding them.
    return shows
      .filter((s) => !s.isHidden && s.name.toLowerCase().includes(q))
      .map((s) => ({ show: s, inPool: !!progress[s.id] && !outOfPool.has(s.id) }))
      .slice(0, 8);
  }, [query, shows, progress, outOfPool]);

  // Debounced TVMaze lookup while the search is open, so a not-yet-cataloged
  // show (e.g. "The Bear") can be found + added. Only fires for queries of 2+.
  useEffect(() => {
    if (!searchOpen) { setTvResults([]); return; }
    const q = query.trim();
    if (q.length < 2) { setTvResults([]); setTvLoading(false); return; }
    if (tvDebounceRef.current) window.clearTimeout(tvDebounceRef.current);
    let cancelled = false;
    setTvLoading(true);
    tvDebounceRef.current = window.setTimeout(async () => {
      try {
        const r = await tvmazeSearch(q);
        if (!cancelled) setTvResults(r);
      } catch { if (!cancelled) setTvResults([]); }
      finally { if (!cancelled) setTvLoading(false); }
    }, 320);
    return () => { cancelled = true; if (tvDebounceRef.current) window.clearTimeout(tvDebounceRef.current); };
  }, [query, searchOpen]);

  // TVMaze matches that aren't already in the catalog (those show as `results`).
  const tvToAdd = useMemo(() => {
    const known = new Set(shows.map((s) => s.id));
    const seen = new Set<string>();
    const out: { tv: TVmazeShow; id: string }[] = [];
    for (const tv of tvResults) {
      const id = slugify(tv.name);
      if (known.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ tv, id });
      if (out.length >= 8) break;
    }
    return out;
  }, [tvResults, shows]);

  // ── Actions ────────────────────────────────────────────────────────────────
  function openSearch() { setSearchOpen(true); setQuery(""); setTvResults([]); }
  function closeSearch() { setSearchOpen(false); setQuery(""); setPickShow(null); setTvResults([]); }

  // Create a brand-new show in the catalog from a TVMaze hit, then hand off to
  // the normal progress picker → add-to-pool flow.
  async function addFromTvmaze(tv: TVmazeShow) {
    if (creatingShow) return;
    setCreatingShow(true);
    try {
      const seasons = await tvmazeEpisodes(tv.id);
      const show = await createShow({
        id: slugify(tv.name),
        name: tv.name,
        seasons,
        tvmazeId: String(tv.id),
        status: tv.status,
      });
      setShows((prev) => (prev.some((s) => s.id === show.id) ? prev : [...prev, show]));
      setTvResults([]);
      setPickShow(show);
      setPickProgress({ s: 0, e: 0 });
    } catch (e) {
      console.error("[dashboard] add show from TVMaze failed", e);
    } finally {
      setCreatingShow(false);
    }
  }

  async function addShow(show: Show, val: { s: number; e: number }) {
    if (!user) return;
    const entry: ProgressEntry = { s: val.s, e: val.e, highestS: val.s, highestE: val.e };
    try {
      await upsertRewatchStatus(user.id, show.id, entry);
      setProgress((prev) => ({ ...prev, [show.id]: entry }));
      // CP8a: re-adding a show un-hides any dormant group that owns its room
      // (Beyond the Underdome on Paradise re-add); reload the rail to surface it.
      await clearMigrationDormantForShow(show.id);
      setRailGroups(await loadRail(user.id));
      if (activeGroupId) await refreshGroup(activeGroupId);
    } catch (e) {
      console.error("[dashboard] add show failed", e);
    }
    closeSearch();
  }

  // Re-add a removed show: restore its saved progress (no picker).
  async function restoreShow(show: Show) {
    if (!user) return;
    try {
      await restoreShowToPool(user.id, show.id);
      setOutOfPool((prev) => { const n = new Set(prev); n.delete(show.id); return n; });
      // CP8a: un-hide a dormant group (Beyond the Underdome) on its show's
      // re-add, then reload the rail so it reappears.
      await clearMigrationDormantForShow(show.id);
      setRailGroups(await loadRail(user.id));
    } catch (e) { console.error("[dashboard] restore show failed", e); }
    closeSearch();
  }

  // §4 remove-from-pool: global down-vote + leave rooms; progress kept.
  async function doRemoveFromPool(showId: string) {
    setRemoveConfirm(null);
    try {
      await removeShowFromPool(showId);
      setOutOfPool((prev) => new Set(prev).add(showId));
    } catch (e) { console.error("[dashboard] remove from pool failed", e); }
  }

  function openInvite(targetGroupId?: string) {
    setInviteTargetGroupId(targetGroupId ?? null);
    setInviteEmails([""]);
    setInviteLinks(null);
    setInviteOpen(true);
  }

  // INVITE FRIENDS forms a NEW group; "connect more friends" invites into the
  // current group (inviteTargetGroupId). Either way each email mints a link.
  async function sendInvites() {
    if (!user || inviteSending) return;
    const emails = inviteEmails.map((e) => e.trim()).filter(Boolean);
    setInviteSending(true);
    try {
      const id = inviteTargetGroupId ?? (await createPeopleGroup());
      const links: { email: string; link?: string; error?: string; emailFailed?: boolean }[] = [];
      for (const email of emails) {
        try {
          const token = await createPeopleGroupInvite(id, email);
          // Await the email leg so a silent refusal (stale token, Resend,
          // rate limit) surfaces as a copy-the-link row instead of a false
          // "Invites sent!". The link works either way.
          const sent = await sendGroupInviteEmail(token, inviteFromName.trim() || undefined);
          links.push({ email, link: `${window.location.origin}/group-invite/${token}`, emailFailed: !sent.ok });
        } catch (e: any) {
          links.push({ email, error: e?.message === "group_full" ? "This group is full (8 max)." : (e?.message || "failed") });
        }
      }
      setInviteLinks(links);
      const rail = await loadRail(user.id);
      setRailGroups(rail);
    } catch (e) {
      console.error("[dashboard] invites failed", e);
      setInviteLinks([{ email: "", error: "Could not send invites." }]);
    } finally {
      setInviteSending(false);
    }
  }


  // ── §9 click model (group context) ──────────────────────────────────────────
  function onPillClick(pill: PillData, name: string) {
    if (!activeGroupId) return;
    // Already in the room → open it directly, no dropdown (§9 rule 1).
    if (pill.inRoom) { goToRoom(pill.showId); return; }
    // Resolve the dropdown mode: your own show (you have it) → solo; else a
    // want-only show → vote; else (others watching / written) → "also watching?".
    const selfHasShow = !!progress[pill.showId];
    const mode = selfHasShow ? "solo" : pill.shelf === "notStarted" ? "vote" : "watchq";
    // Default the picker to your current progress (solo) so a button press
    // without touching the dropdown can't reset it; 0 for vote/watchq.
    const cur = progress[pill.showId];
    setDeclaredProgress(cur ? { s: cur.s, e: cur.e } : { s: 0, e: 0 });
    setClicked({ showId: pill.showId, name, mode });
  }

  async function doVote(showId: string, voted: boolean) {
    if (!activeGroupId || !user) return;
    try {
      await setShowVote(activeGroupId, showId, voted);
      // Voting "yes" opts you into the show's pool — same as adding it to your
      // want-to-watch shelf. The composer needs a pool entry to work, so make
      // sure you have one:
      //   • no progress yet → create a not-started (S0E0) want-to-watch entry
      //     (matches the path someone who added the show themselves took);
      //   • progress exists but you'd removed it from your pool → restore it
      //     (otherwise voting back in would leave you opted-out everywhere).
      // Existing real progress is never reset.
      if (voted) {
        if (!progress[showId]) {
          const entry: ProgressEntry = { s: 0, e: 0, highestS: 0, highestE: 0 };
          await upsertRewatchStatus(user.id, showId, entry);
          setProgress((prev) => ({ ...prev, [showId]: entry }));
        } else if (outOfPool.has(showId)) {
          await restoreShowToPool(user.id, showId);
          setOutOfPool((prev) => { const next = new Set(prev); next.delete(showId); return next; });
        }
      }
      await refreshGroup(activeGroupId);
    } catch (e) { console.error("[dashboard] vote failed", e); }
  }

  async function goToRoom(showId: string) {
    if (!activeGroupId) return;
    try {
      const { roomId } = await startShowRoom(activeGroupId, showId);
      setClicked(null);
      navigate(`/show-room/${roomId}`);
    } catch (e) { console.error("[dashboard] start/open room failed", e); }
  }

  async function declareAndGo(showId: string, val: { s: number; e: number }) {
    if (!user || !activeGroupId) return;
    try {
      const entry: ProgressEntry = { s: val.s, e: val.e, highestS: val.s, highestE: val.e };
      await upsertRewatchStatus(user.id, showId, entry);
      setProgress((prev) => ({ ...prev, [showId]: entry }));
      await goToRoom(showId);
    } catch (e) { console.error("[dashboard] declare+start failed", e); }
  }

  // "Just log my progress for now": record progress (which opts you into the
  // group's pool per the dashboard RPC) without starting/opening a show room.
  async function declareProgressOnly(showId: string, val: { s: number; e: number }) {
    if (!user || !activeGroupId) return;
    try {
      const entry: ProgressEntry = { s: val.s, e: val.e, highestS: val.s, highestE: val.e };
      await upsertRewatchStatus(user.id, showId, entry);
      setProgress((prev) => ({ ...prev, [showId]: entry }));
      setClicked(null);
      await refreshGroup(activeGroupId);
    } catch (e) { console.error("[dashboard] log-progress failed", e); }
  }

  // Personal dashboard: record progress for a show (no group, no room). Keeps
  // the user's highest-watched point so a re-save can't regress a rewatcher.
  async function logProgressPersonal(showId: string, val: { s: number; e: number }) {
    if (!user) return;
    const prev = progress[showId];
    let highestS = val.s, highestE = val.e;
    if (prev?.highestS != null && (prev.highestS > val.s || (prev.highestS === val.s && (prev.highestE ?? 0) >= val.e))) {
      highestS = prev.highestS; highestE = prev.highestE ?? val.e;
    }
    const entry: ProgressEntry = { ...(prev ?? {}), s: val.s, e: val.e, highestS, highestE };
    try {
      await upsertRewatchStatus(user.id, showId, entry);
      setProgress((p) => ({ ...p, [showId]: entry }));
    } catch (e) { console.error("[dashboard] personal log-progress failed", e); }
  }

  // ── CP5b: invites + group options ────────────────────────────────────────
  async function refreshRailAndInvites() {
    if (!user) return;
    // Both tolerant: a throw here must never prevent a caller (e.g. acceptInvite)
    // from navigating after a successful action.
    try { setRailGroups(await loadRail(user.id)); } catch { /* tolerant */ }
    try { setPendingInvites(await fetchMyPendingGroupInvites()); } catch { /* tolerant */ }
  }

  async function acceptInvite(inv: PendingGroupInvite) {
    const res = await acceptPeopleGroupInvite(inv.token);
    if (res.ok) {
      setInvitePrompt(null);
      setAcceptError(null);
      await refreshRailAndInvites();            // tolerant — never blocks the nav below
      navigate(`/dashboard?g=${inv.groupId}`);  // enter the group you just joined
      return;
    }
    // Genuine failure — keep the modal open and say why (was a silent console log).
    console.error("[dashboard] accept invite failed", res.error);
    setAcceptError(
      res.error === "wrong_recipient"
        ? "This invite was sent to a different email than the one you're signed in with."
        : res.error === "group_full"
        ? "This group is full (8 members max)."
        : res.error === "expired"
        ? "This invitation has expired — ask your friend to invite you again."
        : "Couldn't join. Ask your friend to invite you again.",
    );
  }

  // "no" on the invite prompt declines it: deletes the invite so it leaves the
  // dashboard (the only way to clear an awaiting invite without joining).
  async function declineInvite(inv: PendingGroupInvite) {
    setInvitePrompt(null);
    setPendingInvites((prev) => prev.filter((p) => p.token !== inv.token)); // optimistic
    await declinePeopleGroupInvite(inv.token);
    await refreshRailAndInvites();
  }

  async function doLeave(groupId: string) {
    setOptionsFor(null);
    try { await leavePeopleGroup(groupId); } catch (e) { console.error("[dashboard] leave failed", e); }
    await refreshRailAndInvites();
    navigate("/dashboard");
  }

  async function doRename(groupId: string) {
    setOptionsFor(null);
    try { await renamePeopleGroup(groupId, renameValue); } catch (e) { console.error("[dashboard] rename failed", e); }
    setRenameValue("");
    if (user) setRailGroups(await loadRail(user.id));
  }

  // ── CP6: chat (per group) — real-time via a filtered Supabase subscription ──
  const loadChat = useCallback(async (groupId: string) => {
    try { setChatMessages(await fetchGroupMessages(groupId)); } catch (e) { console.error("[dashboard] chat load failed", e); }
  }, []);

  useEffect(() => {
    if (!chatGroupId) { setChatMessages([]); return; }
    // Resolve author usernames for live rows from the group's member list
    // (every chat author is a member, so this covers them without a query).
    const grp = railGroups.find((r) => r.group.id === chatGroupId);
    const nameById: Record<string, string> = {};
    for (const m of grp?.members ?? []) nameById[m.userId] = m.username;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      // group_messages is member-gated RLS, so the realtime socket must carry
      // the user's token or it silently delivers nothing. supabase-js's auto-
      // wiring can miss restored sessions, so set it explicitly before
      // subscribing. (The app's other realtime is on anon-readable rows, which
      // is why this never surfaced before.)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      } catch { /* tolerate */ }
      if (cancelled) return;
      // Append-only, filtered to THIS group; dedupe by id.
      channel = supabase
        .channel(`group-chat-rt-${chatGroupId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${chatGroupId}` },
          (payload) => {
            const r = payload.new as any;
            if (!r) return;
            setChatMessages((prev) => prev.some((m) => m.id === r.id) ? prev : [...prev, {
              id: r.id,
              authorId: r.author_id,
              username: nameById[r.author_id] ?? "unknown",
              body: r.body,
              createdAt: new Date(r.created_at).getTime(),
            }]);
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[dashboard] chat realtime status:", status);
          }
        });
    })();
    loadChat(chatGroupId);
    // Opening the chat clears its new-message dot (server stamp + optimistic).
    markGroupChatSeen(chatGroupId).catch(() => { /* tolerate */ });
    setChatActivity((prev) => prev.map((a) => (a.groupId === chatGroupId ? { ...a, chatLastSeenAt: Date.now() } : a)));
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [chatGroupId, loadChat, railGroups]);

  // Live chat dot while you're VIEWING a group with the panel closed: a
  // filtered, per-group realtime listen that flips the new-message dot the
  // instant another member posts — no refetch, nothing polls (egress is just
  // the small INSERT push for this one group, same cost as the open-chat
  // socket). Mirrors that socket's auth handling: group_messages is member-
  // gated RLS, so the token must be on the socket or it delivers nothing.
  // Skipped while the panel is open for this group (chatGroupId === activeGroupId)
  // — the open-chat effect already streams + marks seen there.
  useEffect(() => {
    if (!activeGroupId || chatGroupId === activeGroupId) return;
    const gid = activeGroupId;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      } catch { /* tolerate */ }
      if (cancelled) return;
      channel = supabase
        .channel(`group-chat-dot-${gid}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${gid}` },
          (payload) => {
            const r = payload.new as any;
            if (!r || r.author_id === selfUserId) return;
            const at = new Date(r.created_at).getTime();
            setChatActivity((prev) => {
              const idx = prev.findIndex((a) => a.groupId === gid);
              if (idx === -1) return [...prev, { groupId: gid, chatLastSeenAt: null, latestMessageAt: at }];
              const a = prev[idx];
              if (a.latestMessageAt != null && a.latestMessageAt >= at) return prev;
              const next = prev.slice();
              next[idx] = { ...a, latestMessageAt: at };
              return next;
            });
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[dashboard] chat-dot realtime status:", status);
          }
        });
    })();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [activeGroupId, chatGroupId, selfUserId]);

  async function sendChat() {
    if (!user || !chatGroupId || !chatInput.trim()) return;
    const body = chatInput.trim();
    setChatInput("");
    try {
      await sendGroupMessage(chatGroupId, user.id, body);
      await loadChat(chatGroupId);
    } catch (e) { console.error("[dashboard] send message failed", e); }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (authLoading || loading) {
    return <div style={{ ...pageStyle, background: C.green }} aria-busy="true" />;
  }

  return (
    <div style={{ ...pageStyle, background: inGroup ? C.sky : C.green }}>
      <DashboardStyles />

      {/* Top bar: logo left · INVITE FRIENDS + sign-out + admin right */}
      <div style={topBar}>
        <div
          onClick={() => navigate("/dashboard")}
          style={{ cursor: "pointer" }}
          role="button"
          aria-label="Home"
          title="Home"
        >
          <SidebarLogo scale={0.5} blocksOpacity={1} bg={activeGroupId ? "sky" : "green"} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Context-aware: dashboard → new group (blue); group room → add to this group (cream). */}
          <button
            style={inGroup ? { ...invitePill, background: C.cream, color: C.green, boxShadow: "none" } : invitePill}
            onClick={() => (inGroup && activeGroupId ? openInvite(activeGroupId) : openInvite())}
          >
            {inGroup ? "Add more friends to this group?" : "Invite new friends?"}
          </button>
          <button style={topCircleBtn(inGroup)} title="account" onClick={() => setShowAccount(true)}>
            <UserCog size={18} color={inGroup ? C.midnight : CANON.cream} />
          </button>
          <button style={topCircleBtn(inGroup)} title="sign out" onClick={async () => { try { await signOut?.(); } catch { /* ignore */ } navigate("/"); }}>
            <LogOut size={18} color={inGroup ? C.midnight : CANON.cream} />
          </button>
          {profile?.is_admin && (
            <button style={topCircleBtn(inGroup)} title="admin" onClick={() => navigate("/?admin")}>
              <Settings size={18} color={inGroup ? C.midnight : CANON.cream} />
            </button>
          )}
        </div>
      </div>

      {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}

      {/* Group clusters (top of the body) — replaces the old right rail */}
      <GroupClusters
        groups={railGroups}
        selfUserId={selfUserId}
        activeGroupId={activeGroupId}
        pendingInvites={pendingInvites}
        clusterDotByGroup={clusterDotByGroup}
        onEnter={(id) => navigate(`/dashboard?g=${id}`)}
        onInviteClick={(inv) => { setInvitePrompt(inv); setAcceptError(null); }}
        onGearClick={(id, rect) => { setOptionsFor(id); setOptionsAnchor({ x: rect.left, y: rect.bottom + 8 }); setRenameValue(railGroups.find((r) => r.group.id === id)?.group.name ?? ""); }}
        onTip={setTip}
      />

      {/* Edge tabs (group context only): back-to-dashboard left · chat right */}
      {inGroup && (
        <button style={backTab} title="back to dashboard" onClick={() => navigate("/dashboard")}>
          <ArrowLeft size={24} color={C.green} />
        </button>
      )}
      {inGroup && (
        <button style={chatTab} title="open chat" onClick={() => activeGroupId && setChatGroupId(activeGroupId)}>
          {!!activeGroupId && chatNewByGroup.get(activeGroupId) && <span style={notifDotChat} />}
          <MessageCircle size={24} color={C.green} />
        </button>
      )}
      {inGroup && <GroupRoomSticky />}

      {inGroup ? (
        // ── Group context (sky) ───────────────────────────────────────────────
        // paddingTop 24 (= base 8 + 16) lowers the heading/shelves/show buttons
        // by 16px; the top banner + back/chat tabs are positioned separately.
        <div style={{ ...contentWrap, paddingTop: 24 }}>
          {groupShelves.watching.length > 0 && (
            <>
              <h1 style={shelfHeader}>CURRENTLY WATCHING:</h1>
              <div style={shelfLayout(groupShelves.watching.length)}>
                {groupShelves.watching.map((r) => (
                  <div key={r.pill.showId} className="group-pill-wrap">
                    {r.pill.roomId && roomDotByRoomId.get(r.pill.roomId) && <span style={{ ...notifDotButton, background: roomDotByRoomId.get(r.pill.roomId) === "red" ? C.red : C.blue }} />}
                    {/* Show tooltip (progress/gap/notif) only once you've opted in
                        (watching or wrote). Non-opted-in shows another member
                        pooled get no show tooltip; the avatars keep their own. */}
                    <div {...(r.selfProg || r.selfWrote ? watchingTipProps(r) : {})}>
                      <GroupPill pill={r.pill} name={r.name} onClick={() => onPillClick(r.pill, r.name)} />
                    </div>
                    <OptInAvatars members={r.opted} withTooltip onTip={setTip} />
                  </div>
                ))}
              </div>
            </>
          )}

          {groupShelves.notStarted.length > 0 && (
            <h1 style={{ ...shelfHeader, textTransform: "none", marginTop: groupShelves.watching.length ? 56 : 0 }}>
              Haven&rsquo;t started yet:
            </h1>
          )}
          {/* Empty group → mirror the home empty state: the prompt sits just
              below the clusters, with the search button beneath it. */}
          {groupShelves.watching.length === 0 && groupShelves.notStarted.length === 0 && (
            <h1 style={{ ...heroH1, textAlign: "center", marginTop: 8, marginBottom: 8 }}>
              What shows are you watching<br />or thinking about starting?
            </h1>
          )}
          <div style={{ textAlign: "center", marginBottom: 24, marginTop: groupShelves.notStarted.length === 0 && groupShelves.watching.length ? 56 : 0 }}>
            <button style={searchPill} onClick={openSearch}>SEARCH</button>
          </div>
          {groupShelves.notStarted.length > 0 && (
            <div style={shelfLayout(groupShelves.notStarted.length)}>
              {groupShelves.notStarted.map((r) => (
                <div key={r.pill.showId} className="group-pill-wrap">
                  {r.pill.roomId && roomDotByRoomId.get(r.pill.roomId) && <span style={{ ...notifDotButton, background: roomDotByRoomId.get(r.pill.roomId) === "red" ? C.red : C.blue }} />}
                  <div {...interestedTipProps(r.opted, r.name, r.selfOpted, r.selfProg ? `You've watched: S${r.selfProg.s} E${r.selfProg.e}` : undefined, roomNotif(r.pill.roomId))}>
                    <GroupPill pill={r.pill} name={r.name} onClick={() => onPillClick(r.pill, r.name)} />
                  </div>
                  <OptInAvatars members={r.opted} withTooltip={false} onTip={setTip} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : !hasAnyShows && !searchOpen ? (
        // ── Search-first empty state (green) ──────────────────────────────────
        <div style={heroWrap}>
          <h1 style={heroH1}>
            What shows are you watching<br />or thinking about starting?
          </h1>
          <button style={searchPill} onClick={openSearch}>SEARCH</button>
        </div>
      ) : (
        // ── Populated dashboard (green) ───────────────────────────────────────
        <div style={contentWrap}>
          {watching.length > 0 && (
            <>
              <h1 style={shelfHeader}>CURRENTLY WATCHING:</h1>
              <div style={shelfLayout(watching.length)}>
                {watching.map(({ show, entry }) => (
                  <div key={show.id} className="dash-pill-wrap">
                    <button className="dash-pill dash-pill--watching" onClick={() => { setDeclaredProgress({ s: entry.s, e: entry.e }); setPillModal({ showId: show.id, name: show.name, mode: "watching" }); }}>
                      <span className="dash-pill__name">{show.name}</span>
                      <span className="dash-pill__prog">s{entry.s} e{entry.e}</span>
                    </button>
                    <button className="dash-pill-x" title="remove from pool" onClick={() => setRemoveConfirm({ id: show.id, name: show.name })}>×</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {notStarted.length > 0 && (
            <h1 style={{ ...shelfHeader, textTransform: "none", marginTop: watching.length ? 56 : 0 }}>
              Haven&rsquo;t started yet:
            </h1>
          )}
          {notStarted.length > 0 && (
            <div style={shelfLayout(notStarted.length)}>
              {notStarted.map(({ show }) => (
                <div key={show.id} className="dash-pill-wrap">
                  <button className="dash-pill dash-pill--want" onClick={() => { setDeclaredProgress({ s: 0, e: 0 }); setPillModal({ showId: show.id, name: show.name, mode: "notStarted" }); }}>
                    <span className="dash-pill__name">{show.name}</span>
                  </button>
                  <button className="dash-pill-x" title="remove from pool" onClick={() => setRemoveConfirm({ id: show.id, name: show.name })}>×</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: 48 }}>
            <h1 style={{ ...shelfHeader, textTransform: "none", marginBottom: 16 }}>What else?</h1>
            <button style={searchPill} onClick={openSearch}>SEARCH</button>
          </div>
        </div>
      )}

      {/* Search overlay (shared by both contexts) */}
      {searchOpen && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) closeSearch(); }}>
          {!pickShow ? (
            <div style={searchCard}>
              <input
                autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="find your show" style={searchInput}
              />
              {results.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {results.map(({ show: s, inPool }) => (
                    inPool ? (
                      <div key={s.id} className="dash-result dash-result--inpool">You've already added <i>{s.name}</i> to your watch pool.</div>
                    ) : (
                      <button key={s.id} className="dash-result" onClick={() => { if (outOfPool.has(s.id)) { restoreShow(s); } else { setPickShow(s); setPickProgress({ s: 0, e: 0 }); } }}>
                        {s.name}{outOfPool.has(s.id) ? " · restore" : ""}
                      </button>
                    )
                  ))}
                </div>
              )}
              {tvToAdd.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {results.length > 0 && (
                    <div style={{ padding: "4px 16px 6px", fontSize: 11, fontWeight: 700, color: C.midnight, opacity: 0.6 }}>Not in the list? Add it:</div>
                  )}
                  {tvToAdd.map(({ tv, id }) => (
                    <button key={id} className="dash-result" disabled={creatingShow} onClick={() => addFromTvmaze(tv)}>
                      {tv.name}{networkLabel(tv) ? ` · ${networkLabel(tv)}` : ""}
                    </button>
                  ))}
                </div>
              )}
              {query.trim().length >= 2 && results.length === 0 && tvToAdd.length === 0 && (
                <div style={{ padding: "12px 16px", fontSize: 13, color: C.midnight, opacity: 0.6 }}>
                  {creatingShow ? "adding…" : tvLoading ? "searching…" : "No shows found."}
                </div>
              )}
            </div>
          ) : (
            <div style={pickerCard}>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: 0, color: C.green }}>
                {pickShow.name}
              </div>
              <div style={{ marginTop: 24, color: C.green, fontWeight: 600, fontSize: 13, letterSpacing: -1, textAlign: "center" }}>
                How much have you watched?
              </div>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                {/* requireConfirm=false → onConfirm never fires; track via
                    onChangeSelected and commit with the button. */}
                <OneSelectProgress
                  show={pickShow}
                  value={{ s: 0, e: 0 }}
                  allowZero
                  requireConfirm={false}
                  onChangeSelected={(v) => setPickProgress(v)}
                  onConfirm={() => {}}
                />
              </div>
              <button style={{ ...invitePill, marginTop: 24 }} onClick={() => addShow(pickShow, pickProgress)}>
                add to my shows
              </button>
            </div>
          )}
        </div>
      )}

      {/* Invite / create-group modal. CP3a: creates the people-group. CP5 adds
          the email-invite send + accept flow. */}
      {inviteOpen && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setInviteOpen(false); }}>
          <div style={{ ...searchCard, background: C.sky, position: "relative" }}>
            <button style={modalClose} onClick={() => setInviteOpen(false)}><X size={18} color={CANON.cream} /></button>
            {!inviteLinks && (
              <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, letterSpacing: 0, color: C.cream, textAlign: "center", margin: "8px 0 24px" }}>
                {inviteTargetGroupId ? <>Connect more friends<br />to this group:</> : <>Email friends to<br />start a watch group:</>}
              </h1>
            )}

            {!inviteLinks ? (
              <>
                {inviteEmails.map((email, i) => (
                  <input
                    key={i}
                    value={email}
                    onChange={(e) => setInviteEmails((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                    placeholder="email"
                    style={{ ...searchInput, border: "none", background: C.cream, color: C.midnight, marginBottom: 10 }}
                  />
                ))}
                <button
                  onClick={() => setInviteEmails((prev) => [...prev, ""])}
                  style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: C.cream, color: C.midnight, fontSize: 20, cursor: "pointer", marginTop: 2 }}
                >+</button>
                {/* §16 Body font (Inter regular 13, normal letter-spacing); cream. */}
                <p style={{ fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, letterSpacing: "normal", lineHeight: 1.5, color: C.cream, margin: "28px 0 12px" }}>
                  Your friend(s) will get an email invite from your username. If you don&rsquo;t think they&rsquo;d recognize it, tell them who you are:
                </p>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <input
                    value={inviteFromName}
                    onChange={(e) => setInviteFromName(e.target.value)}
                    placeholder="hi, it's…"
                    maxLength={40}
                    style={{ ...searchInput, border: "none", background: C.cream, color: C.midnight, flex: 1, marginBottom: 0 }}
                  />
                  <button style={{ ...invitePill, opacity: inviteSending ? 0.6 : 1, flexShrink: 0 }} disabled={inviteSending} onClick={sendInvites}>
                    {inviteSending ? "creating…" : "send invite"}
                  </button>
                </div>
              </>
            ) : (
              <>
                {inviteLinks.some((r) => r.error) && (
                  <div style={{ color: C.red, fontSize: 14, fontWeight: 700, textAlign: "center", margin: "8px 0 16px" }}>
                    {inviteLinks.filter((r) => r.error).map((r, i) => <div key={i}>{preventLastWordOrphan(r.error ?? "")}</div>)}
                  </div>
                )}
                {inviteLinks.every((r) => !r.error && !r.emailFailed) && (
                  <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, letterSpacing: 0, color: C.cream, textAlign: "center", margin: "8px 0 24px" }}>
                    Invites sent!
                  </h1>
                )}
                {/* Invite minted but the email leg failed (stale session,
                    rate limit, Resend refusal) — the link still works, so
                    hand it to the sender instead of a false "sent!". */}
                {inviteLinks.some((r) => !r.error && r.emailFailed) && (
                  <>
                    <p style={{ fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, lineHeight: 1.5, color: C.cream, margin: "8px 0 12px" }}>
                      {preventLastWordOrphan(inviteLinks.filter((r) => !r.error && r.emailFailed).length === 1
                        ? "Sidebar is having an issue and couldn't email this invite right now. You can copy the link and send it to your friend yourself. It works the same. Or log out, log back in, and try one more time. Sorry for the inconvenience."
                        : "Sidebar is having an issue and couldn't email these invites right now. You can copy the links and send them to your friends yourself. They work the same. Or log out, log back in, and try one more time. Sorry for the inconvenience.")}
                    </p>
                    {inviteLinks.filter((r) => !r.error && r.emailFailed).map((r, i) => (
                      <CopyRow key={i} email={r.email} link={r.link} />
                    ))}
                  </>
                )}
                <div style={{ textAlign: "center", marginTop: 12 }}>
                  <button style={invitePill} onClick={() => setInviteOpen(false)}>done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* §9 click-model popover (group context). Centered yellow card; pixel-
          anchoring to the clicked pill is a later polish. */}
      {clicked && (() => {
        const gs = groupShows.find((s) => s.showId === clicked.showId);
        const selfVoted = !!gs?.members.find((m) => m.userId === selfUserId)?.voted;
        const roomLabel = gs?.roomId ? "Open show room?" : "Start a show room?";
        // "Solo" only when you're the sole opt-in; 2+ opted in → plain show room.
        const optedCount = gs?.members.length ?? 0;
        const cur = progress[clicked.showId];
        const curVal = cur ? { s: cur.s, e: cur.e } : { s: 0, e: 0 };
        // "Read what … have written?" — other members whose earliest ENTRY is
        // visible at the viewer's LIVE (in-modal) progress. Entries-only is
        // sufficient: a reply can't be visible unless its parent entry is. Reacts
        // live to the progress dropdown (declaredProgress).
        const seasons = showsById[clicked.showId]?.seasons;
        const liveIdx = linearIndex(declaredProgress.s, declaredProgress.e, seasons);
        const visibleWriters = (gs?.members ?? []).filter((m) =>
          m.userId !== selfUserId && m.wroteEntryMinS != null &&
          linearIndex(m.wroteEntryMinS, m.wroteEntryMinE ?? 0, seasons) <= liveIdx,
        );
        const showRead = !!gs?.roomId && visibleWriters.length >= 1;
        const readName = visibleWriters.length === 1 ? (memberNameById[visibleWriters[0].userId] ?? "someone") : null;
        const readText = visibleWriters.length > 1 ? "Read what your friends have written?" : `Read what @${readName} has written?`;
        return (
          // Dedicated scrollable two-layer overlay (NOT the shared `overlay`):
          // centers [modal + 8px gap + trailer card] as one pair and lets the
          // pair scroll on short viewports. On a miss / progress > S0E0 the
          // trailer renders nothing, so the modal centers alone exactly as today.
          <div style={trailerScrollOverlay} onClick={(e) => { if (e.target === e.currentTarget) setClicked(null); }}>
           <div style={trailerCenterColumn} onClick={(e) => { if (e.target === e.currentTarget) setClicked(null); }}>
            {/* solo + watchq are wider to fit the "Yes" + "just confirm my progress" row. */}
            <div style={{ ...yellowCard, ...(clicked.mode === "watchq" || clicked.mode === "solo" ? { width: "min(460px, 92vw)" } : {}) }}>
              <button style={modalClose} onClick={() => setClicked(null)}><X size={16} color={CANON.cream} /></button>

              {clicked.mode === "solo" && (
                <>
                  <div style={yellowTitle}>{curVal.s === 0 && curVal.e === 0 ? "Have you started watching?" : "Have you watched more?"}</div>
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                    <OneSelectProgress
                      show={showsById[clicked.showId] ?? { seasons: [] }}
                      value={curVal}
                      allowZero
                      requireConfirm={false}
                      pillBg="transparent"
                      onChangeSelected={(v) => setDeclaredProgress(v)}
                      onConfirm={() => {}}
                    />
                  </div>
                  <div style={yellowDivider} />
                  <div style={{ ...yellowTitle, fontSize: 13 }}>{showRead ? readText : gs?.roomId ? "Open show room?" : optedCount > 1 ? "Start a show room?" : (
                    <>Start a show room?<br />Your friends can join in when they&rsquo;re ready.</>
                  )}</div>
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", marginTop: 12 }}>
                    <button style={startBtn} onClick={() => declareAndGo(clicked.showId, declaredProgress)}>{showRead ? "Read" : "Yes"}</button>
                    <button
                      style={{ ...startBtn, padding: "11px 24px", whiteSpace: "nowrap", background: "transparent", color: C.cream, border: `2px solid ${C.cream}` }}
                      onClick={() => declareProgressOnly(clicked.showId, declaredProgress)}
                    >just confirm my progress</button>
                  </div>
                </>
              )}

              {clicked.mode === "vote" && (
                <>
                  <div style={yellowTitle}>Do you want to watch <b>{clicked.name}</b>?</div>
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                    <YesNoToggle value={selfVoted} onChange={(v) => doVote(clicked.showId, v)} />
                  </div>
                  {selfVoted && (
                    <>
                      <div style={yellowDivider} />
                      <div style={{ ...yellowTitle, fontSize: 13 }}>{roomLabel}</div>
                      <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", marginTop: 12 }}>
                        <button style={startBtn} onClick={() => goToRoom(clicked.showId)}>Yes</button>
                        <button
                          style={{ ...startBtn, padding: "11px 24px", whiteSpace: "nowrap", background: "transparent", color: C.cream, border: `2px solid ${C.cream}` }}
                          onClick={() => setClicked(null)}
                        >not yet</button>
                      </div>
                    </>
                  )}
                </>
              )}

              {clicked.mode === "watchq" && (
                <>
                  <div style={yellowTitle}>Are you also watching <b>{clicked.name}</b>?</div>
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                    <OneSelectProgress
                      show={showsById[clicked.showId] ?? { seasons: [] }}
                      value={{ s: 0, e: 0 }}
                      allowZero
                      requireConfirm={false}
                      pillBg="transparent"
                      onChangeSelected={(v) => setDeclaredProgress(v)}
                      onConfirm={() => {}}
                    />
                  </div>
                  <div style={yellowDivider} />
                  <div style={{ ...yellowTitle, fontSize: 13 }}>{showRead ? readText : roomLabel}</div>
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", marginTop: 12 }}>
                    <button style={startBtn} onClick={() => declareAndGo(clicked.showId, declaredProgress)}>{showRead ? "Read" : "Yes"}</button>
                    <button
                      style={{ ...startBtn, padding: "11px 24px", whiteSpace: "nowrap", background: "transparent", color: C.cream, border: `2px solid ${C.cream}` }}
                      onClick={() => declareProgressOnly(clicked.showId, declaredProgress)}
                    >just confirm my progress</button>
                  </div>
                </>
              )}
            </div>
            {/* Launch trailer — only for a not-started viewer (gate on the
                PERSISTED progress curVal, never the draggable dropdown, so a
                dropdown change can't tear out a playing trailer). Renders
                nothing on a miss. */}
            {curVal.s === 0 && curVal.e === 0 && (
              <TrailerCard showId={clicked.showId} tvmazeId={showsById[clicked.showId]?.tvmazeId} />
            )}
           </div>
          </div>
        );
      })()}

      {/* CP5b: "Join a group with @X?" from a pending invite (rail red cluster) */}
      {invitePrompt && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) { setInvitePrompt(null); setAcceptError(null); } }}>
          <div style={yellowCard}>
            <button style={modalClose} onClick={() => { setInvitePrompt(null); setAcceptError(null); }}><X size={16} color={CANON.cream} /></button>
            <div style={yellowTitle}>Join a group with {inviteNames(invitePrompt)}?</div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
              <button style={startBtn} onClick={() => acceptInvite(invitePrompt)}>Yes</button>
              <button style={{ ...startBtn, background: "transparent", color: CANON.cream, border: "2px solid var(--canon-cream,#fef8ea)" }} onClick={() => declineInvite(invitePrompt)}>no</button>
            </div>
            {acceptError && (
              <div style={{ marginTop: 14, textAlign: "center", color: CANON.cream, fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{acceptError}</div>
            )}
          </div>
        </div>
      )}

      {/* CP5b: group options (gear) — rename + leave, anchored near the gear */}
      {optionsFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setOptionsFor(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: optionsAnchor?.y ?? 80,
              left: Math.min(optionsAnchor?.x ?? 28, (typeof window !== "undefined" ? window.innerWidth : 1024) - 380),
              display: "flex", flexDirection: "column", gap: 16, width: 360,
            }}
          >
            <div style={yellowCard}>
              <button style={modalClose} onClick={() => setOptionsFor(null)}><X size={16} color={CANON.cream} /></button>
              <div style={{ ...yellowTitle, marginBottom: 12 }}>Rename group:</div>
              <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="group name" style={{ ...searchInput, border: "none", background: C.cream, color: C.midnight }} />
              <button style={{ ...startBtn, marginTop: 12 }} onClick={() => doRename(optionsFor)}>confirm name</button>
            </div>
            <div style={yellowCard}>
              <div style={{ ...yellowTitle, marginBottom: 12 }}>Leave this group?</div>
              <button style={dangerBtn} onClick={() => doLeave(optionsFor)}>yes, leave</button>
              <div style={yellowDivider} />
              <div style={{ color: CANON.cream, fontSize: 12, opacity: 0.9 }}>You can join again if someone sends you another invite.</div>
            </div>
          </div>
        </div>
      )}

      {/* CP6: group chat panel (opened via the active group's avatar) */}
      {chatGroupId && (() => {
        const cg = railGroups.find((r) => r.group.id === chatGroupId);
        const others = cg ? cg.members.filter((m) => m.userId !== selfUserId) : [];
        const connected = others.length ? others.map((m) => `@${m.username}`).join(", ") : "just you";
        return (
          <div style={chatPanel}>
            <div style={chatHeader}>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}><span style={{ color: C.blue }}>You're connected with:</span><br /><span style={{ color: C.green }}>{connected}</span></div>
              <button style={{ border: "none", background: "transparent", cursor: "pointer" }} onClick={() => setChatGroupId(null)}><X size={18} color={C.sky} /></button>
            </div>
            <div style={chatBody} ref={chatBodyRef}>
              {chatMessages.map((m) => {
                const mine = m.authorId === selfUserId;
                return (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", marginBottom: 12 }}>
                    {!mine && <div style={{ fontSize: 11, color: CANON.cream, opacity: 0.85, marginBottom: 3 }}>{m.username}</div>}
                    <div style={mine ? chatBubbleMine : chatBubbleOther}>{linkifyText(m.body)}</div>
                  </div>
                );
              })}
            </div>
            <div style={chatInputRow}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
                placeholder="message…"
                style={chatInputBox}
              />
              <button style={chatSend} onClick={sendChat}><ArrowUp size={18} color={CANON.cream} /></button>
            </div>
          </div>
        );
      })()}

      {/* §4 remove-from-pool confirm */}
      {removeConfirm && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setRemoveConfirm(null); }}>
          <div style={{ background: C.sky, borderRadius: 15, padding: "26px 30px", width: "min(340px, 90vw)", position: "relative" }}>
            <button style={modalClose} onClick={() => setRemoveConfirm(null)}><X size={16} color={CANON.cream} /></button>
            <div style={{ color: C.red, fontWeight: 700, fontSize: 15, marginBottom: 12, letterSpacing: -0.3 }}>Remove this show from your pool?</div>
            <div style={{ color: CANON.cream, fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>This will opt you out of the show across all your groups and you will leave any friend rooms for the show.</div>
            <div style={{ color: CANON.cream, fontSize: 12, lineHeight: 1.5, marginBottom: 18 }}>BUT, your progress will be saved and restored if you search for and add the show back to your show pool.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button style={{ border: "none", background: "transparent", color: C.midnight, fontWeight: 700, fontSize: 13, cursor: "pointer" }} onClick={() => setRemoveConfirm(null)}>cancel</button>
              <button style={dangerBtn} onClick={() => doRemoveFromPool(removeConfirm.id)}>remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Personal dashboard pill → progress dropdown. Currently-watching also
          offers write-by-yourself; haven't-started is a self-committing picker. */}
      {pillModal && (() => {
        const cur = progress[pillModal.showId];
        const curVal = cur ? { s: cur.s, e: cur.e } : { s: 0, e: 0 };
        const isWatching = pillModal.mode === "watching";
        return (
          <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setPillModal(null); }}>
            <div style={{ ...yellowCard, ...(isWatching ? { width: "min(460px, 92vw)" } : {}) }}>
              <button style={modalClose} onClick={() => setPillModal(null)}><X size={16} color={CANON.cream} /></button>

              {!isWatching ? (
                <>
                  <div style={yellowTitle}>Have you started watching?</div>
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                    <OneSelectProgress
                      show={showsById[pillModal.showId] ?? { seasons: [] }}
                      value={{ s: 0, e: 0 }}
                      allowZero
                      pillBg="transparent"
                      onForwardPick={(v) => { logProgressPersonal(pillModal.showId, v); setPillModal(null); }}
                      onConfirm={(v) => { logProgressPersonal(pillModal.showId, v); setPillModal(null); }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div style={yellowTitle}>Have you watched more?</div>
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                    <OneSelectProgress
                      show={showsById[pillModal.showId] ?? { seasons: [] }}
                      value={curVal}
                      allowZero
                      requireConfirm={false}
                      pillBg="transparent"
                      onChangeSelected={(v) => setDeclaredProgress(v)}
                      onConfirm={() => {}}
                    />
                  </div>
                  <div style={yellowDivider} />
                  <div style={{ ...yellowTitle, fontSize: 13 }}>Do you want to write by yourself?</div>
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", marginTop: 12 }}>
                    <button style={startBtn} onClick={() => { const id = pillModal.showId; logProgressPersonal(id, declaredProgress); setPillModal(null); navigate(`/show-room/private/${id}`); }}>Yes</button>
                    <button
                      style={{ ...startBtn, padding: "11px 24px", whiteSpace: "nowrap", background: "transparent", color: C.cream, border: `2px solid ${C.cream}` }}
                      onClick={() => { logProgressPersonal(pillModal.showId, declaredProgress); setPillModal(null); }}
                    >just confirm my progress</button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Cursor-following tooltip bubble (opt-in avatars + watch progress;
          optional new-activity line beneath a divider). */}
      {tip && createPortal(
        <div style={{ ...tipBubble, ...(tip.wrap ? { whiteSpace: "normal", maxWidth: 240 } : null), left: tip.x + 14, top: tip.y + 16 }}>
          {tip.text}
          {tip.sub && (<><div style={tipDivider} />{tip.sub}</>)}
        </div>,
        document.body,
      )}

      {/* TSP onboarding demo — over the empty dashboard (spec §9). */}
      {showTspDemo && <TSPDemoModal onClose={closeTspDemo} />}
    </div>
  );
}

/** Format a pending invite's members as "@X and @Y" for the join prompt. */
function inviteNames(inv: PendingGroupInvite): string {
  const ns = (inv.memberNames.length ? inv.memberNames : [inv.inviterName]).map((n) => `@${n}`);
  if (ns.length === 1) return ns[0];
  if (ns.length === 2) return `${ns[0]} and ${ns[1]}`;
  return `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}

// A copyable invite-link row (raw text is too easy to mis-transcribe — 0 vs O).
function CopyRow({ email, link, error }: { email: string; link?: string; error?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ background: C.cream, borderRadius: 12, padding: 12, marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.midnight }}>{email || "—"}</div>
      {link ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.blue, wordBreak: "break-all", flex: 1, textDecoration: "none" }}>{link}</a>
          <button
            onClick={() => { try { navigator.clipboard?.writeText(link); } catch { /* ignore */ } setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            style={{ border: "none", background: C.blue, color: CANON.cream, fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 65, cursor: "pointer", whiteSpace: "nowrap" }}
          >{copied ? "copied!" : "copy"}</button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}

// A simple no/yes pill toggle (used for the vote question).
function YesNoToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  // Colored sliding dot carries the active label only: "no" = yellow dot left,
  // "yes" = green dot right. The inactive label is not shown.
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        border: "none", cursor: "pointer", borderRadius: 65, padding: 3, width: 84, height: 32,
        background: C.cream, position: "relative", display: "flex", alignItems: "center",
      }}
    >
      <span style={{
        position: "absolute", left: value ? 46 : 3, top: 3, width: 35, height: 26, borderRadius: 65,
        background: value ? C.green : C.yellow, transition: "left 120ms, background 120ms",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 700, color: C.cream,
      }}>{value ? "yes" : "no"}</span>
    </button>
  );
}

// ── Group pill (§7) ──────────────────────────────────────────────────────────
function GroupPill({ pill, name, onClick }: { pill: PillData; name: string; onClick: () => void }) {
  // Shows the viewer themselves is watching get a green fill + green outline,
  // regardless of the group's writer/watcher fill tier.
  const isSelfWatching = pill.selfWatching;
  const isGreen = pill.fill === "green";
  const isCream = pill.fill === "cream";
  // In sky group-context: self-watching = green fill + green outline; group
  // green = solid green/white; outlined = white outline + white text; cream =
  // cream fill + green text.
  const base: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, padding: "12px 18px",
    borderRadius: 65, fontFamily: '"Inter", sans-serif', fontWeight: 700,
    fontSize: 14, letterSpacing: -1, width: "100%", boxSizing: "border-box",
    background: isSelfWatching || isGreen ? C.green : isCream ? C.cream : "transparent",
    border: isSelfWatching ? `2px solid ${C.green}` : (isCream || isGreen ? "2px solid transparent" : "2px solid var(--canon-cream,#fef8ea)"),
    color: isSelfWatching || isGreen ? CANON.cream : isCream ? C.green : CANON.cream,
    cursor: "pointer", textAlign: "left",
  };
  return (
    <button style={base} onClick={onClick}>
      {/* No left badge: opted-in avatars convey who's in, and a writer is shown
          by the pen badge on that writer's own avatar (every writer, any count). */}
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      <PillRightSide right={pill.right} />
    </button>
  );
}

function PillRightSide({ right }: { right: PillData["right"] }) {
  if (right.kind === "none") return null;
  if (right.kind === "progress") {
    return <span style={{ fontWeight: 500, fontSize: 13 }}>s{right.s} e{right.e}</span>;
  }
  const up = right.dir === "up";
  // Lucide triangle, solid fill, no outline: cream for ahead, red for behind
  // (rotated). The count is cream.
  const triColor = up ? C.cream : C.red;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 700 }}>
      <Triangle
        size={14}
        color={triColor}
        fill={triColor}
        strokeWidth={0}
        style={up ? undefined : { transform: "rotate(180deg)" }}
      />
      <span style={{ color: C.cream }}>{right.n}</span>
    </span>
  );
}

// ── Group clusters (top of the dashboard body) ───────────────────────────────
function Avatar({ letter, state }: { letter?: string; state: "accepted" | "pending" | "invited" }) {
  // accepted = cream/green · pending (invite sent) = yellow/cream · invited-to-you = red/green
  const bg = state === "accepted" ? C.cream : state === "pending" ? C.yellow : C.red;
  const fg = state === "accepted" ? C.green : state === "pending" ? CANON.cream : C.cream;
  return <span style={{ ...avatarCircle, background: bg, color: fg }}>{(letter ?? "?").toUpperCase()}</span>;
}

/** "Haven't started yet" tooltip: which other friends are interested in a show
 *  (show name italic). 1 → "X is also…", 2 → "X and Y are also…", 3+ → "N
 *  friends are also…". */
function interestedNode(names: string[], showName: string, selfOpted: boolean): React.ReactNode {
  const show = <i>{showName}</i>;
  // "also" only when YOU've opted in too (the others are interested in addition
  // to you); otherwise just state the others' interest.
  const also = selfOpted ? "also " : "";
  if (names.length === 1) return <>{names[0]} is {also}interested in watching {show}.</>;
  if (names.length === 2) return <>{names[0]} and {names[1]} are {also}interested in watching {show}.</>;
  return <>{names.length} friends are {also}interested in watching {show}.</>;
}

/** Per-count icon arrangement (rows, top→bottom), matching the spec's pyramid:
 *  1·alone, 2·side-by-side, 3·triangle, then a growing pyramid. Cap is 8. */
function pyramidRows(n: number): number[] {
  switch (n) {
    case 0: return [];
    case 1: return [1];
    case 2: return [2];
    case 3: return [1, 2];
    case 4: return [1, 2, 1];
    case 5: return [1, 2, 2];
    case 6: return [1, 2, 3];
    case 7: return [1, 2, 3, 1];
    case 8: return [1, 2, 3, 2];
    default: { // defensive (>8): 1, 2, then rows of 3
      const rows = [1, 2];
      let rem = n - 3;
      while (rem > 0) { rows.push(Math.min(3, rem)); rem -= 3; }
      return rows;
    }
  }
}

/** Stacks avatars into the pyramid arrangement, centered, rows tucked. */
function AvatarPile({ avatars }: { avatars: React.ReactNode[] }) {
  const rows = pyramidRows(avatars.length);
  let idx = 0;
  return (
    <div style={avatarPile}>
      {rows.map((size, r) => {
        const slice = avatars.slice(idx, idx + size);
        idx += size;
        return <div key={r} style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: r === 0 ? 0 : 4 }}>{slice}</div>;
      })}
    </div>
  );
}

/** Opt-in member avatars overlapping a group-pill's bottom edge (the friends
 *  who have this show in the group's pool). Decorative — pointer-events off so
 *  they never block a pill click. */
function OptInAvatars({ members, withTooltip, onTip }: {
  members: { username: string; s: number | null; e: number | null; wrote?: boolean }[];
  withTooltip: boolean;
  onTip: (t: { text: React.ReactNode; sub?: React.ReactNode; wrap?: boolean; x: number; y: number } | null) => void;
}) {
  if (!members.length) return null;
  return (
    <div style={optInRow}>
      {members.map((m, i) => {
        const watched = (m.s ?? 0) > 0 || (m.e ?? 0) > 0;
        const tip = watched ? `${m.username} has watched: S${m.s} E${m.e}` : `${m.username} hasn't started yet`;
        // Every member who has written gets the pen badge on their own avatar
        // (no longer gated to the lone-writer case).
        const isWriter = !!m.wrote;
        // The lone writer's avatar (green + pencil) also notes they've begun writing.
        const sub = isWriter ? "They have started writing in here." : undefined;
        return (
          <span
            key={`${m.username}-${i}`}
            style={optInAvatar}
            onMouseMove={withTooltip ? (e) => onTip({ text: tip, sub, wrap: !!sub, x: e.clientX, y: e.clientY }) : undefined}
            onMouseLeave={withTooltip ? () => onTip(null) : undefined}
          >
            {(m.username[0] ?? "?").toUpperCase()}
            {/* Sole-writer indicator: cream pen on a green dot. The avatar
                fill is NOT changed — the badge is the only indicator. */}
            {/* Sole indicator: the pen icon alone (no dot) — cream lines, sky fill. */}
            {isWriter && <span style={writerPencilBadge}><Pencil size={14} color={C.cream} fill={C.sky} strokeWidth={2} /></span>}
          </span>
        );
      })}
    </div>
  );
}

function GroupClusters({
  groups, selfUserId, activeGroupId, pendingInvites, clusterDotByGroup, onEnter, onInviteClick, onGearClick, onTip,
}: {
  groups: RailGroup[];
  selfUserId: string;
  activeGroupId: string | null;
  pendingInvites: PendingGroupInvite[];
  clusterDotByGroup: Map<string, "blue" | "red">;
  onEnter: (id: string) => void;
  onInviteClick: (inv: PendingGroupInvite) => void;
  onGearClick: (groupId: string, rect: DOMRect) => void;
  onTip: (t: { text: React.ReactNode; wrap?: boolean; x: number; y: number } | null) => void;
}) {
  const active = groups.find((g) => g.group.id === activeGroupId);

  // Group context (sky): a left-aligned heading — group-name · with members · gear.
  // (Back-to-dashboard lives in the left-edge tab in the page chrome.)
  if (active) {
    const others = active.members.filter((m) => m.userId !== selfUserId);
    const names = others.map((m) => m.username).join(", ");
    return (
      <div style={groupHeadingRow}>
        <h1 style={groupHeadingTitle}>{active.group.name || groupAutoName(active.group, others)}</h1>
        {names && <span style={groupHeadingMembers}><span style={{ color: C.greyblue }}>with</span> {names}</span>}
        <button style={headingIconBtn} title="group options" onClick={(e) => onGearClick(active.group.id, e.currentTarget.getBoundingClientRect())}><Settings size={22} color={CANON.cream} /></button>
      </div>
    );
  }

  // Green dashboard: every group you're in + every group you're invited to.
  return (
    <div style={clustersRow}>
      {groups.map(({ group, members, pendingHandles }) => {
        // Cluster icons = the OTHER people (accepted cream, not-yet-accepted
        // invitees yellow). Never your own icon, even before anyone accepts.
        const others = members.filter((m) => m.userId !== selfUserId);
        const avatars = [
          ...others.map((m) => <Avatar key={m.userId} letter={m.username[0]} state="accepted" />),
          ...pendingHandles.map((h, i) => <Avatar key={`p${i}`} letter={h[0]} state="pending" />),
        ];
        const dot = clusterDotByGroup.get(group.id);
        const notif = dot === "red" ? NOTIF_INVISIBLE : dot === "blue" ? NOTIF_VISIBLE : undefined;
        return (
          <button
            key={group.id}
            style={clusterBtn}
            // Native title would compete with the new-activity tooltip; drop it when a dot is up.
            title={notif ? undefined : "open group"}
            onClick={() => onEnter(group.id)}
            onMouseMove={notif ? (e) => onTip({ text: notif, wrap: true, x: e.clientX, y: e.clientY }) : undefined}
            onMouseLeave={notif ? () => onTip(null) : undefined}
          >
            <AvatarPile avatars={avatars} />
            <div style={clusterName}>
              {dot && <span style={{ ...notifDotCluster, background: dot === "red" ? C.red : C.blue }} />}
              {groupAutoName(group, others)}
            </div>
          </button>
        );
      })}
      {pendingInvites.map((inv) => {
        const names = inv.memberNames.length ? inv.memberNames : [inv.inviterName];
        const label = inv.groupName || names.join(", ");
        return (
          <button
            key={inv.token}
            style={clusterBtn}
            onClick={() => onInviteClick(inv)}
            onMouseMove={(e) => onTip({ text: <>You&rsquo;ve been invited by @{inv.inviterName}<br />to join a watch group.</>, wrap: true, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => onTip(null)}
          >
            <AvatarPile avatars={names.map((n, i) => <Avatar key={i} letter={n[0]} state="invited" />)} />
            <div style={clusterName}>{label}</div>
          </button>
        );
      })}
    </div>
  );
}

/** Custom name if set, else a stable generic "Group <seq>". (Pre-seq-migration
 *  fallback: the other members' usernames, alphabetical, else "Group".) */
function groupAutoName(group: PeopleGroup, others: PeopleGroupMember[]): string {
  if (group.name) return group.name;
  if (group.seq != null) return `Group ${group.seq}`;
  if (!others.length) return "Group";
  return others.map((m) => m.username).sort((a, b) => a.localeCompare(b)).join(", ");
}

// ── Styles ──────────────────────────────────────────────────────────────────────
const pageStyle: React.CSSProperties = {
  position: "fixed", inset: 0, fontFamily: '"Inter", system-ui, sans-serif', overflowY: "auto",
};
const heroWrap: React.CSSProperties = {
  minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center",
  // Top-aligned (was centered) so the prompt sits just below the group clusters
  // instead of floating in the middle of the page.
  justifyContent: "flex-start", textAlign: "center", gap: 32, padding: "48px 24px 24px",
};
const heroH1: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 44, lineHeight: 1.15, letterSpacing: 0, color: C.cream, margin: 0,
};
const contentWrap: React.CSSProperties = {
  maxWidth: 1040, margin: "0 auto", padding: "8px 64px 80px",
};
const shelfHeader: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: 0, color: C.cream,
  textAlign: "center", textTransform: "uppercase", margin: "0 0 24px",
};
const shelfGrid: React.CSSProperties = {
  // 24px vertical separation (row) leaves room for the opt-in avatars that
  // overlap each pill's bottom edge in the group view; 16px between columns.
  display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px 16px", maxWidth: 880, margin: "0 auto",
};
// ≈ the 3-column width at maxWidth 880 with 16px gaps: (880 - 2*16) / 3.
const SHELF_COL = 283;
// 1–2 shows center (fixed columns matching the 3-col width); 3+ lock into the
// 3-column grid (so 4 reads as 3 on top + 1 bottom-left).
function shelfLayout(count: number): React.CSSProperties {
  if (count >= 3) return shelfGrid;
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${Math.max(count, 1)}, ${SHELF_COL}px)`,
    gap: "24px 16px", justifyContent: "center", maxWidth: 880, margin: "0 auto",
  };
}
const searchPill: React.CSSProperties = {
  border: "none", background: C.yellow, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "16px 56px", borderRadius: 65, cursor: "pointer",
};
const invitePill: React.CSSProperties = {
  border: "none", background: C.blue, color: CANON.cream, fontWeight: 700, fontSize: 14,
  padding: "18px 64px", borderRadius: 65, cursor: "pointer", boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};
const topBar: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 28px",
};
const topCircleBtn = (inGroup: boolean): React.CSSProperties => ({
  width: 44, height: 44, borderRadius: "50%", background: "transparent",
  border: `2px solid ${inGroup ? C.midnight : CANON.cream}`, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
});
const clustersRow: React.CSSProperties = {
  display: "flex", justifyContent: "center", alignItems: "flex-start", flexWrap: "wrap",
  gap: 56, padding: "16px 80px 36px",
};
const clusterBtn: React.CSSProperties = { border: "none", background: "transparent", cursor: "pointer", padding: 0 };
const avatarPile: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", margin: "0 auto",
};
const avatarCircle: React.CSSProperties = {
  width: 40, height: 40, borderRadius: "50%", display: "inline-flex", alignItems: "center",
  justifyContent: "center", fontFamily: LORA, fontWeight: 700, fontSize: 32, letterSpacing: 0,
};
const optInRow: React.CSSProperties = {
  // Right-anchored: avatars fill from the button's right edge toward center.
  // Lowered 8px (translateY 50% + 8) so the pen badges clear the s/e label;
  // .group-pill-wrap adds a matching 8px of row spacing below so the avatars
  // don't crowd the next row.
  position: "absolute", right: 40, bottom: 0, transform: "translateY(calc(50% + 8px))",
  display: "flex", gap: 6, pointerEvents: "none", zIndex: 5,
};
const optInAvatar: React.CSSProperties = {
  position: "relative",
  width: 30, height: 30, borderRadius: "50%", border: `2px solid ${C.cream}`, background: C.sky,
  color: C.blue, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  pointerEvents: "auto", // hoverable for the per-member tooltip
};
// Pencil badge on the lone-writer's avatar (top-right corner).
const writerPencilBadge: React.CSSProperties = {
  position: "absolute", top: -5, right: -5, display: "inline-flex",
  alignItems: "center", justifyContent: "center",
};
// New-activity dots (blue, 16px), slightly overlapping their surface.
const notifDotButton: React.CSSProperties = {
  position: "absolute", top: -6, left: 6, width: 16, height: 16, borderRadius: "50%",
  background: C.blue, zIndex: 6, pointerEvents: "none", // let the pill's tooltip fire through the dot
};
const notifDotChat: React.CSSProperties = {
  // Sit on the upper portion of the tab's rounded left edge (the curve), so the
  // dot straddles that curve — partly on the tab, partly off — rather than the
  // flat top near the icon.
  position: "absolute", top: 10, left: 0, width: 16, height: 16, borderRadius: "50%",
  background: C.blue, zIndex: 1,
};
const notifDotCluster: React.CSSProperties = {
  display: "inline-block", width: 16, height: 16, borderRadius: "50%",
  background: C.blue, verticalAlign: "middle", marginRight: 8,
};
const tipBubble: React.CSSProperties = {
  position: "fixed", background: C.green, color: CANON.cream, padding: "7px 12px", borderRadius: 12,
  fontFamily: '"Inter", sans-serif', fontSize: 13, fontWeight: 600, lineHeight: 1.3,
  whiteSpace: "nowrap", pointerEvents: "none", zIndex: 9999, boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
};
// Divider between the "You've watched…" line and the new-activity line.
const tipDivider: React.CSSProperties = {
  height: 1, background: "rgba(253,248,236,0.45)", margin: "7px 0",
};
const clusterName: React.CSSProperties = {
  marginTop: 8, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: -1,
  color: CANON.cream, maxWidth: 120, lineHeight: 1.25, marginLeft: "auto", marginRight: "auto",
};
const clusterIcon: React.CSSProperties = { border: "none", background: "transparent", cursor: "pointer", padding: 2, lineHeight: 0 };
const groupHeadingRow: React.CSSProperties = {
  maxWidth: 880, margin: "0 auto", padding: "4px 0 28px", position: "relative",
  display: "flex", alignItems: "center", gap: 14,
};
const headingIconBtn: React.CSSProperties = {
  border: "none", background: "transparent", cursor: "pointer", padding: 2, lineHeight: 0, display: "inline-flex", alignItems: "center",
};
const groupHeadingTitle: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: 0, color: CANON.cream, margin: 0,
};
const groupHeadingMembers: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: 0, color: CANON.cream,
};
const backTab: React.CSSProperties = {
  // ~50% larger tab; padding/radius on the 8px grid (spec §16). Icon unchanged.
  position: "fixed", left: 0, top: "18%", background: C.cream, border: "none", cursor: "pointer",
  borderTopRightRadius: 48, borderBottomRightRadius: 48, padding: "32px 40px 32px 24px",
  display: "inline-flex", alignItems: "center", boxShadow: "6px 6px 18px rgba(0,0,0,0.15)", zIndex: 45,
};
const chatTab: React.CSSProperties = {
  // ~50% larger tab; padding/radius on the 8px grid (spec §16). Icon unchanged.
  position: "fixed", right: 0, top: "60%", background: C.cream, border: "none", cursor: "pointer",
  borderTopLeftRadius: 48, borderBottomLeftRadius: 48, padding: "32px 24px 32px 40px",
  display: "inline-flex", alignItems: "center", boxShadow: "-6px 6px 18px rgba(0,0,0,0.15)", zIndex: 45,
};
const countCircle: React.CSSProperties = {
  minWidth: 22, height: 22, padding: "0 6px", borderRadius: 11, background: C.green, color: CANON.cream,
  fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const chatPanel: React.CSSProperties = {
  position: "fixed", top: 0, right: 0, bottom: 0, width: "min(440px, 44vw)", background: C.green,
  display: "flex", flexDirection: "column", zIndex: 70, boxShadow: "-12px 0 30px rgba(0,0,0,0.18)",
};
const chatHeader: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
  background: C.cream, padding: "18px 20px",
};
const chatBody: React.CSSProperties = { flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column" };
const chatBubbleOther: React.CSSProperties = {
  background: C.sky, color: C.midnight, padding: "10px 14px", borderRadius: 16, maxWidth: "78%", fontSize: 13, lineHeight: 1.4,
};
const chatBubbleMine: React.CSSProperties = {
  background: C.cream, color: C.midnight, padding: "10px 14px", borderRadius: 16, maxWidth: "78%", fontSize: 13, lineHeight: 1.4,
};
const chatInputRow: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", padding: "14px 16px", background: C.cream };
const chatInputBox: React.CSSProperties = {
  flex: 1, border: "none", borderRadius: 65, padding: "12px 18px", fontFamily: '"Inter", sans-serif',
  fontSize: 13, color: C.midnight, background: CANON.cream, outline: "none",
};
const chatSend: React.CSSProperties = {
  border: "none", background: C.blue, borderRadius: "50%", width: 38, height: 38, display: "inline-flex",
  alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "0 0 auto",
};
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(26,58,74,0.25)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 50,
};
// Trailer-aware overlay for the opt-in modal ONLY (the shared `overlay` above is
// used by other modals and must stay untouched). Two layers: a fixed scrollable
// backdrop + an inner column that centers [modal + 8px gap + trailer] as a pair
// and lets it scroll on short viewports. A lone modal (miss) centers identically.
const trailerScrollOverlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(26,58,74,0.25)", zIndex: 50, overflowY: "auto",
};
const trailerCenterColumn: React.CSSProperties = {
  minHeight: "100%", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", gap: 8,
  padding: "24px 16px", boxSizing: "border-box",
};
const searchCard: React.CSSProperties = { background: C.cream, borderRadius: 24, padding: 32, width: "min(560px, 86vw)" };
const pickerCard: React.CSSProperties = {
  background: C.cream, borderRadius: 24, padding: "40px 48px", width: "min(640px, 88vw)",
  display: "flex", flexDirection: "column", alignItems: "center",
};
const searchInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `2px solid ${C.green}`, borderRadius: 65,
  padding: "14px 24px", fontFamily: '"Inter", sans-serif', fontSize: 14, color: C.green,
  background: "transparent", outline: "none",
};
const modalClose: React.CSSProperties = {
  position: "absolute", top: 16, right: 16, border: "none", background: "transparent", cursor: "pointer",
};
const yellowCard: React.CSSProperties = {
  background: C.yellow, borderRadius: 15, padding: "28px 32px", width: "min(360px, 88vw)",
  position: "relative", textAlign: "center",
};
const yellowTitle: React.CSSProperties = {
  color: CANON.cream, fontSize: 15, fontWeight: 600, letterSpacing: -0.5,
};
const yellowDivider: React.CSSProperties = {
  height: 1, background: "rgba(253,248,236,0.5)", margin: "20px 0 14px",
};
// Button-outline rule: solid fill = no contrasting outline; outlined = transparent fill.
const startBtn: React.CSSProperties = {
  border: "none", background: C.blue, color: CANON.cream, fontWeight: 700, fontSize: 14,
  padding: "11px 38px", borderRadius: 65, cursor: "pointer",
};
const dangerBtn: React.CSSProperties = {
  border: `2px solid ${C.red}`, background: "transparent", color: C.red, fontWeight: 700, fontSize: 14,
  padding: "10px 32px", borderRadius: 65, cursor: "pointer",
};

function DashboardStyles() {
  return (
    <style>{`
      .dash-pill {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 14px 24px; border-radius: 65px; cursor: pointer;
        font-family: "Inter", sans-serif; font-weight: 700; font-size: 14px;
        letter-spacing: -1px; width: 100%; box-sizing: border-box; text-align: left;
      }
      .dash-pill--watching { background: transparent; border: 2px solid ${C.cream}; color: ${C.cream}; }
      .dash-pill--watching .dash-pill__prog { font-weight: 500; }
      .dash-pill--want { background: ${C.cream}; border: 2px solid ${C.cream}; color: ${C.green}; }
      .dash-pill__name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dash-result {
        display: block; width: 100%; text-align: left; border: none; background: transparent;
        padding: 12px 16px; border-radius: 12px; cursor: pointer; font-family: "Inter", sans-serif;
        font-size: 14px; font-weight: 600; color: ${C.green};
      }
      .dash-result:hover { background: rgba(122,189,142,0.14); }
      .dash-result--inpool { cursor: default; opacity: 0.55; }
      .dash-result--inpool:hover { background: transparent; }
      .dash-pill-wrap { position: relative; }
      .dash-pill-x {
        position: absolute; top: -7px; right: -3px; width: 22px; height: 22px; border-radius: 50%;
        border: none; background: ${C.cream}; color: ${C.red}; font-size: 15px; line-height: 1; cursor: pointer;
        display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 120ms;
        box-shadow: 0 2px 6px rgba(0,0,0,0.18);
      }
      .dash-pill-wrap:hover .dash-pill-x { opacity: 1; }
      .group-pill-wrap { position: relative; margin-bottom: 8px; }
    `}</style>
  );
}
