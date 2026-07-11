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
import { X, Settings, Triangle, ArrowUp, LogOut, ArrowLeft, MessageCircle, UserCog } from "lucide-react";
import { useAuth } from "../lib/auth";
import AccountModal from "./AccountModal";
import FeedbackWidget from "./FeedbackWidget";
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
  leaveShowRoom,
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
  ensureProgressRow,
  fetchContactNames,
  fetchMyPendingInviteNames,
  setContactName,
  clearMigrationDormantForShow,
  fetchRoomActivityVisibility,
  roomHasNewActivity,
  roomHasNewInvisibleActivity,
  fetchGroupChatActivity,
  chatHasNewActivity,
  markGroupChatSeen,
  fetchTspDemoSeen,
  markTspDemoSeen,
  markSocialOnboarded,
  type Show,
  type GroupDashboardShow,
  type PendingGroupInvite,
  type GroupMessage,
  type RoomVisibility,
  type GroupChatActivity,
} from "../lib/db";
import { computePill, linearIndex, type PillData } from "../lib/groupPills";
import { groupDisplayName, groupGenericName, personDisplayName, pendingInviteMemberNames, pendingInviterLabel } from "../lib/groupNames";
import { overlay, searchCard, pickerCard, searchInput, modalClose, yellowCard, yellowTitle, startBtn, invitePill, searchPill } from "./dashboardChrome";
import { groupHeadingMembers } from "./dashboardChrome";
import { tvmazeSearch, tvmazeEpisodes, networkLabel, slugify, type TVmazeShow } from "../lib/tvmaze";
import type { ProgressEntry, PeopleGroup, PeopleGroupMember } from "../types";
import SidebarLogo from "./SidebarLogo";
import LoadingDots from "./LoadingDots";
import OneSelectProgress from "./OneSelectProgress";
import TrailerCard from "./TrailerCard";
import { prefetchTrailers } from "../lib/trailers";
import TSPDemoModal from "./TSPDemoModal";
import SocialOnboarding from "./SocialOnboarding";
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

  // CP3 social onboarding (3-screen show→friend→seed-entry flow). Fires ONCE,
  // AFTER the demo (render is gated on !showTspDemo), on the BASE dashboard,
  // for brand-new self-signup accounts only: invited accounts (already in a
  // group) are stamped as done without ever seeing it, and an account with a
  // pending invite waits (they may accept; re-evaluated next visit).
  // Force-show for testing with ?sonb=1 (doesn't stamp).
  const forceSocialOnb = new URLSearchParams(location.search).get("sonb") === "1";
  const [showSocialOnb, setShowSocialOnb] = useState(false);
  useEffect(() => {
    if (!user) return;
    if (new URLSearchParams(location.search).get("g")) return; // base dashboard only
    if (forceSocialOnb) { setShowSocialOnb(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const [groups, invites] = await Promise.all([
          fetchPeopleGroupsForUser(user.id).catch(() => []),
          fetchMyPendingGroupInvites().catch(() => []),
        ]);
        if (cancelled) return;
        // Onboarding fires whenever you have NO groups and NO pending invites
        // — brand-new self-signups AND a returning user who has LEFT all their
        // groups (guide them back to starting a room + inviting a friend;
        // Alborz 2026-07-08). Pending invite → accept that first; any group
        // (incl. one just accepted into) stamps done + skips. The onboarded
        // flag no longer suppresses it (a reset should re-guide). The TSP demo
        // stays gated-once, so a returning user won't re-see it.
        if (invites.length > 0) return;
        if (groups.length > 0) { markSocialOnboarded(user.id).catch(() => {}); return; }
        setShowSocialOnb(true);
      } catch { /* tolerant — never block the dashboard */ }
    })();
    return () => { cancelled = true; };
  }, [user, location.search, forceSocialOnb]);
  const socialOnbActive = showSocialOnb && !showTspDemo;
  async function handleSocialOnbDone(groupId: string | null) {
    setShowSocialOnb(false);
    if (!forceSocialOnb && user) markSocialOnboarded(user.id).catch(() => {});
    if (user) { try { setRailGroups(await loadRail(user.id)); } catch { /* tolerant */ } }
    if (groupId) navigate(`/dashboard?g=${groupId}`);
  }

  const [outOfPool, setOutOfPool] = useState<Set<string>>(new Set());

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

  // Invite / create-group modal. CP2: each friend row is name + email — the
  // typed name seeds the viewer's contact name for that person (group naming).
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRows, setInviteRows] = useState<{ name: string; email: string }[]>([{ name: "", email: "" }]);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<{ email: string; link?: string; error?: string; emailFailed?: boolean }[] | null>(null);
  // null = create a NEW group (friends + proposed shows, one act); set =
  // "add more friends" to this group.
  const [inviteTargetGroupId, setInviteTargetGroupId] = useState<string | null>(null);
  // CP2 create-a-group: the paired show proposals (≥1 required) + its picker.
  const [inviteShows, setInviteShows] = useState<Show[]>([]);
  const [inviteShowQuery, setInviteShowQuery] = useState("");
  const [inviteTvResults, setInviteTvResults] = useState<TVmazeShow[]>([]);
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);
  const inviteTvDebounceRef = useRef<number | null>(null);

  // CP2 dual-mode group naming: the viewer's private contact names + the
  // names on their own still-pending invites (per group). Refreshed whenever
  // the rail reloads (accepts and new invites both land there).
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [pendingInviteNames, setPendingInviteNames] = useState<Record<string, string[]>>({});

  // CP5: leave-a-room confirm (the X on an active-room button).
  const [leaveConfirm, setLeaveConfirm] = useState<{ roomId: string; showId: string; name: string } | null>(null);

  // §9 click-model popover (group context). mode captured at click time.
  const [clicked, setClicked] = useState<{ showId: string; name: string; mode: "solo" | "vote" | "watchq"; voteToggle?: boolean } | null>(null);
  const [declaredProgress, setDeclaredProgress] = useState<{ s: number; e: number }>({ s: 0, e: 0 });

  // CP5b: pending invites (rail "*you're invited"), group options (gear).
  const [pendingInvites, setPendingInvites] = useState<PendingGroupInvite[]>([]);
  const [invitePrompt, setInvitePrompt] = useState<PendingGroupInvite | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [optionsFor, setOptionsFor] = useState<string | null>(null); // group id whose gear options are open
  const [optionsAnchor, setOptionsAnchor] = useState<{ x: number; y: number } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // CP-C rename-contacts (naming arc 2026-07-07): the gear's per-member "your
  // name for them" inputs — keyed by userId, initialized on gear open.
  const [contactEdits, setContactEdits] = useState<Record<string, string>>({});
  const [contactsSaving, setContactsSaving] = useState(false);

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
      // (showsById). Keep those shows' episode lists fresh too (12h cadence).
      // Perf (2026-07-07): FULLY non-blocking — the catalog read + TVMaze sync
      // no longer delay refreshGroup resolving (post-vote syncs awaited it).
      const ids = new Set(rows.map((r) => r.showId));
      fetchShows().then((catalog) =>
        refreshStaleShows(catalog.filter((s) => ids.has(s.id))).then((upd) => {
          if (!upd.length) return;
          setShows((prev) => prev.map((s) => upd.find((u) => u.id === s.id) ?? s));
        }),
      ).catch(() => {});
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

  // Contact names + own-pending-invite names refresh with the rail (both
  // small owner-scoped reads; tolerant pre-migration → {}).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([fetchContactNames(user.id), fetchMyPendingInviteNames(user.id)])
      .then(([cn, pn]) => { if (!cancelled) { setContactNames(cn); setPendingInviteNames(pn); } })
      .catch(() => { /* tolerant */ });
    return () => { cancelled = true; };
  }, [user, railGroups]);

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

  // Per-viewer "Group N": the viewer's Nth group by THEIR join order —
  // viewer-specific like every other part of the naming model, so the rail
  // can never hold two "Group 1"s (the old per-creator seq could collide).
  const groupNumberById = useMemo(() => {
    const withJoin = railGroups.map((r) => ({
      id: r.group.id,
      joinedAt: r.members.find((m) => m.userId === selfUserId)?.joinedAt ?? 0,
    }));
    withJoin.sort((a, b) => (a.joinedAt - b.joinedAt));
    const m: Record<string, number> = {};
    withJoin.forEach((g, i) => { m[g.id] = i + 1; });
    return m;
  }, [railGroups, selfUserId]);

  // userId → display name for the active group (naming arc 2026-07-07: the
  // name the VIEWER gave each member, else their handle) — drives the opted-in
  // tooltips, the "Read what … has written?" prompt, and avatar letters.
  const memberNameById = useMemo(() => {
    const m: Record<string, string> = {};
    const ag = railGroups.find((r) => r.group.id === activeGroupId);
    for (const mem of ag?.members ?? []) m[mem.userId] = personDisplayName(contactNames, mem.userId, mem.username, mem.displayName);
    return m;
  }, [railGroups, activeGroupId, contactNames]);

  // ── Group shelves (sky) — pills computed from the aggregation RPC ──────────
  const groupShelves = useMemo(() => {
    type OptIn = { username: string; s: number | null; e: number | null; wrote: boolean; resolved: boolean };
    type Row = { pill: PillData; name: string; opted: OptIn[]; selfProg: { s: number; e: number } | null; selfOpted: boolean; selfWrote: boolean; furthestFriend: { s: number; e: number } | null; tier: number; lastActivityAt: number | null };
    const watching: Row[] = [];
    const notStarted: Row[] = [];
    for (const gs of groupShows) {
      // CP5: a room the viewer deliberately LEFT is hidden from THEIR view
      // (other members are unaffected); the in-group search re-enters it.
      if (gs.viewerLeft && !gs.inRoom) continue;
      const show = showsById[gs.showId];
      const pill = computePill(gs, show?.seasons, selfUserId);
      // Opted-in members other than you → the avatars overlapping the pill.
      const opted: OptIn[] = gs.members
        .filter((mm) => mm.userId !== selfUserId)
        // resolved = the member's name has loaded (members fetch lands after
        // groupShows); the avatar shows its letter only once resolved, so it
        // never flashes a bogus "S" from the "someone" text fallback.
        .map((mm) => ({ username: memberNameById[mm.userId] ?? "someone", s: mm.s, e: mm.e, wrote: !!mm.wrote, resolved: !!memberNameById[mm.userId] }));
      // Your own progress on this show (if any) → the show-button tooltip.
      const self = gs.members.find((mm) => mm.userId === selfUserId);
      const selfProg = self && ((self.s ?? 0) > 0 || (self.e ?? 0) > 0) ? { s: self.s as number, e: self.e as number } : null;
      // Furthest-along OTHER member with real progress → the proposed-shelf
      // "furthest progress: SxEx" label (highest wins across seasons).
      let furthestFriend: { s: number; e: number } | null = null;
      for (const o of opted) {
        if ((o.s ?? 0) === 0 && (o.e ?? 0) === 0) continue;
        if (!furthestFriend || linearIndex(o.s ?? 0, o.e ?? 0, show?.seasons) > linearIndex(furthestFriend.s, furthestFriend.e, show?.seasons)) {
          furthestFriend = { s: o.s as number, e: o.e as number };
        }
      }
      // Activity bucket: 2+ writing → 1 writing → 2+ watching → 1 watching.
      const writerCount = pill.writerCount;
      const watcherCount = gs.members.filter((mm) => (mm.s ?? 0) > 0 || (mm.e ?? 0) > 0).length;
      const tier = writerCount >= 2 ? 0 : writerCount === 1 ? 1 : watcherCount >= 2 ? 2 : watcherCount >= 1 ? 3 : 4;
      // Exactly one writer → mark that writer's avatar (green fill + pencil).
      // (If the lone writer is you, no avatar exists to mark — nothing shows.)
      const row = { pill, name: show?.name ?? gs.showId, opted, selfProg, selfOpted: !!self, selfWrote: !!self?.wrote, furthestFriend, tier, lastActivityAt: gs.lastActivityAt };
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

  // Catalog search. "Already added" is context-scoped (2026-07-06): in a
  // group it means the show is already proposed/active in THIS group; on the
  // personal dashboard it means the show is in your personal pool. Removed
  // (out-of-pool) shows stay listed so they can be re-added/re-proposed.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows
      .filter((s) => !s.isHidden && s.name.toLowerCase().includes(q))
      .map((s) => {
        const gs = activeGroupId ? groupShows.find((x) => x.showId === s.id) : undefined;
        // CP5: a room the viewer LEFT is findable again — selecting it
        // re-enters (clears the "has left" marker) and restores the button.
        const rejoin = !!gs && !!gs.roomId && gs.viewerLeft && !gs.inRoom;
        return {
          show: s,
          rejoin,
          inPool: activeGroupId
            ? !!gs && !rejoin
            : !!progress[s.id] && !outOfPool.has(s.id),
        };
      })
      .slice(0, 8);
  }, [query, shows, progress, outOfPool, activeGroupId, groupShows]);

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

  // ── Create-a-group show picker (CP2: friends + shows, one act) ─────────────
  const inviteCatalogMatches = useMemo(() => {
    const q = inviteShowQuery.trim().toLowerCase();
    if (!q) return [];
    const sel = new Set(inviteShows.map((s) => s.id));
    return shows.filter((s) => !s.isHidden && !sel.has(s.id) && s.name.toLowerCase().includes(q)).slice(0, 5);
  }, [inviteShowQuery, shows, inviteShows]);

  useEffect(() => {
    if (!inviteOpen || inviteTargetGroupId) { setInviteTvResults([]); return; }
    const q = inviteShowQuery.trim();
    if (q.length < 2) { setInviteTvResults([]); return; }
    if (inviteTvDebounceRef.current) window.clearTimeout(inviteTvDebounceRef.current);
    let cancelled = false;
    inviteTvDebounceRef.current = window.setTimeout(async () => {
      try {
        const r = await tvmazeSearch(q);
        if (!cancelled) setInviteTvResults(r);
      } catch { if (!cancelled) setInviteTvResults([]); }
    }, 320);
    return () => { cancelled = true; if (inviteTvDebounceRef.current) window.clearTimeout(inviteTvDebounceRef.current); };
  }, [inviteShowQuery, inviteOpen, inviteTargetGroupId]);

  const inviteTvToAdd = useMemo(() => {
    const known = new Set(shows.map((s) => s.id));
    const sel = new Set(inviteShows.map((s) => s.id));
    const seen = new Set<string>();
    const out: { tv: TVmazeShow; id: string }[] = [];
    for (const tv of inviteTvResults) {
      const id = slugify(tv.name);
      if (known.has(id) || sel.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ tv, id });
      if (out.length >= 5) break;
    }
    return out;
  }, [inviteTvResults, shows, inviteShows]);

  function pickInviteShow(s: Show) {
    setInviteShows((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
    setInviteShowQuery("");
    setInviteTvResults([]);
  }

  async function pickInviteTvShow(tv: TVmazeShow) {
    if (creatingShow) return;
    setCreatingShow(true);
    try {
      const seasons = await tvmazeEpisodes(tv.id);
      const show = await createShow({ id: slugify(tv.name), name: tv.name, seasons, tvmazeId: String(tv.id), status: tv.status });
      setShows((prev) => (prev.some((s) => s.id === show.id) ? prev : [...prev, show]));
      pickInviteShow(show);
    } catch (e) { console.error("[dashboard] add show from TVMaze failed", e); }
    finally { setCreatingShow(false); }
  }

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

  // In-group add = PROPOSE the show into THIS group (group-scoped model,
  // 2026-07-06): the vote is the proposal. A not-started pick stays off the
  // personal record's pool (a proposal lives only in its group); a real
  // progress pick records your global watch position as always. (The search
  // only opens inside a group since CP2 — the dashboard is groups-only.)
  async function addShow(show: Show, val: { s: number; e: number }) {
    if (!user || !activeGroupId) return;
    try {
      await setShowVote(activeGroupId, show.id, true);
      if (val.s === 0 && val.e === 0) {
        if (!progress[show.id]) {
          await ensureProgressRow(user.id, show.id);
          setProgress((prev) => ({ ...prev, [show.id]: { s: 0, e: 0, highestS: 0, highestE: 0 } }));
          setOutOfPool((prev) => new Set(prev).add(show.id)); // mirror in_pool=false
        }
      } else {
        const entry: ProgressEntry = { s: val.s, e: val.e, highestS: val.s, highestE: val.e };
        await upsertRewatchStatus(user.id, show.id, entry);
        setProgress((prev) => ({ ...prev, [show.id]: entry }));
        setOutOfPool((prev) => { const n = new Set(prev); n.delete(show.id); return n; });
      }
      // CP8a: re-adding a show un-hides any dormant group that owns its room
      // (Beyond the Underdome on Paradise re-add); reload the rail to surface it.
      await clearMigrationDormantForShow(show.id);
      setRailGroups(await loadRail(user.id));
      await refreshGroup(activeGroupId);
    } catch (e) {
      console.error("[dashboard] add show failed", e);
    }
    closeSearch();
  }

  // CP5: leave ONE show room in THIS group. Your writing stays, the room and
  // everyone else's votes are untouched; only your own shelf loses the button.
  async function doLeaveRoom(roomId: string, showId: string) {
    if (!activeGroupId) return;
    setLeaveConfirm(null);
    try {
      await leaveShowRoom(roomId);
      // Optimistic: hide the button + drop own membership; refreshGroup re-syncs.
      setGroupShows((prev) => prev.map((gs) => (gs.showId === showId ? { ...gs, inRoom: false, viewerLeft: true } : gs)));
      await refreshGroup(activeGroupId);
    } catch (e) { console.error("[dashboard] leave room failed", e); }
  }

  // CP5 restore: re-enter a room you'd left (search → select). Clears the
  // "has left" marker server-side (start_show_room's re-join path).
  async function rejoinRoom(show: Show) {
    if (!activeGroupId) return;
    try {
      await startShowRoom(activeGroupId, show.id);
      await refreshGroup(activeGroupId);
    } catch (e) { console.error("[dashboard] rejoin room failed", e); }
    closeSearch();
  }

  // In-group search hit on a show you already have a progress row for (in or
  // out of the personal pool): propose it here directly — no picker, your
  // saved progress is left exactly as it is.
  async function proposeExisting(show: Show) {
    if (!user || !activeGroupId) return;
    try {
      await setShowVote(activeGroupId, show.id, true);
      await clearMigrationDormantForShow(show.id);
      setRailGroups(await loadRail(user.id));
      await refreshGroup(activeGroupId);
    } catch (e) { console.error("[dashboard] propose failed", e); }
    closeSearch();
  }

  function openInvite(targetGroupId?: string) {
    setInviteTargetGroupId(targetGroupId ?? null);
    setInviteRows([{ name: "", email: "" }]);
    setInviteShows([]);
    setInviteShowQuery("");
    setInviteTvResults([]);
    setCreatedGroupId(null);
    setInviteLinks(null);
    setInviteOpen(true);
  }

  // "Create another watch group?" forms a NEW group as ONE act — ≥1 named
  // friend AND ≥1 proposed show (CP2); "add more friends" invites into the
  // current group. Either way each email mints a link, and a typed friend
  // name rides the invite (it becomes your contact name for them on accept).
  async function sendInvites() {
    if (!user || inviteSending) return;
    const rows = inviteRows.map((r) => ({ name: r.name.trim(), email: r.email.trim() })).filter((r) => r.email);
    setInviteSending(true);
    try {
      const creating = !inviteTargetGroupId;
      const id = inviteTargetGroupId ?? (await createPeopleGroup());
      if (creating) {
        setCreatedGroupId(id);
        // Propose the picked shows into the new group (proposing = your yes).
        for (const s of inviteShows) {
          try {
            await setShowVote(id, s.id, true);
            if (!progress[s.id]) {
              await ensureProgressRow(user.id, s.id);
              setProgress((prev) => ({ ...prev, [s.id]: { s: 0, e: 0, highestS: 0, highestE: 0 } }));
              setOutOfPool((prev) => new Set(prev).add(s.id)); // mirror in_pool=false
            }
          } catch (e) { console.error("[dashboard] propose into new group failed", e); }
        }
      }
      const links: { email: string; link?: string; error?: string; emailFailed?: boolean }[] = [];
      for (const row of rows) {
        try {
          const token = await createPeopleGroupInvite(id, row.email, row.name || undefined);
          // Await the email leg so a silent refusal (stale token, Resend,
          // rate limit) surfaces as a copy-the-link row instead of a false
          // "Invites sent!". The link works either way.
          const sent = await sendGroupInviteEmail(token);
          links.push({ email: row.email, link: `${window.location.origin}/group-invite/${token}`, emailFailed: !sent.ok });
        } catch (e: any) {
          links.push({ email: row.email, error: e?.message === "group_full" ? "This group is full (8 max)." : (e?.message || "failed") });
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

  // Done on the create-group results → land inside the new group.
  function closeInviteModal() {
    setInviteOpen(false);
    if (createdGroupId) {
      const id = createdGroupId;
      setCreatedGroupId(null);
      navigate(`/dashboard?g=${id}`);
    }
  }


  // ── §9 click model (group context) ──────────────────────────────────────────
  function onPillClick(pill: PillData, name: string) {
    if (!activeGroupId) return;
    // Already in the room → open it directly, no dropdown (§9 rule 1).
    if (pill.inRoom) { goToRoom(pill.showId); return; }
    // Resolve the dropdown mode. Group-scoped model (2026-07-06): "yours"
    // means you've engaged with the show IN THIS GROUP — for a proposal
    // (no room yet) that's your yes-vote here; for a roomed show it's your
    // own watching. Your personal pool no longer drives the group click
    // model, so a show you added or removed on the personal dashboard reads
    // here purely by what you've done in this group.
    const gsClicked = groupShows.find((s) => s.showId === pill.showId);
    const selfVoted = !!gsClicked?.members.find((m) => m.userId === selfUserId)?.voted;
    const selfHasShow = pill.shelf === "notStarted" ? selfVoted : pill.selfWatching;
    const mode = selfHasShow ? "solo" : pill.shelf === "notStarted" ? "vote" : "watchq";
    // Default the picker to your current progress (solo) so a button press
    // without touching the dropdown can't reset it; 0 for vote/watchq.
    const cur = progress[pill.showId];
    setDeclaredProgress(selfHasShow && cur ? { s: cur.s, e: cur.e } : { s: 0, e: 0 });
    // Haven't-started shows keep the vote toggle visible in the solo modal
    // (voting is a want-to-watch concept), so a "yes" can be taken back by
    // toggling — the second un-vote path besides remove-from-pool.
    setClicked({ showId: pill.showId, name, mode, voteToggle: pill.shelf === "notStarted" });
  }

  // Group-scoped voting (2026-07-06): a vote lives in THIS group only.
  //   • yes = propose/join the proposal here. The composer needs a progress
  //     row to work, so quietly ensure a not-started (S0E0) one exists —
  //     created OUT of the personal pool (a proposal lives only in its group;
  //     the personal dashboard is untouched). Existing rows — including ones
  //     you'd deliberately removed — are never touched, and real progress is
  //     never reset.
  //   • no = withdraw YOUR yes in THIS group only. No global remove, no other
  //     group affected, and a started room is never affected. The open modal
  //     collapses back to the bare vote question; the show leaves the
  //     Proposed shelf only if yours was the last yes.
  async function doVote(showId: string, voted: boolean) {
    if (!activeGroupId || !user) return;
    try {
      await setShowVote(activeGroupId, showId, voted);
      if (voted && !progress[showId]) {
        await ensureProgressRow(user.id, showId);
        setProgress((prev) => ({ ...prev, [showId]: { s: 0, e: 0, highestS: 0, highestE: 0 } }));
        setOutOfPool((prev) => new Set(prev).add(showId)); // mirror in_pool=false
      }
      // Optimistic: flip your own vote in the loaded group data so the toggle
      // and shelf react instantly; refreshGroup below re-syncs from the server.
      setGroupShows((prev) => prev.map((gs) => {
        if (gs.showId !== showId) return gs;
        const selfRow = gs.members.find((m) => m.userId === user.id);
        if (!voted) {
          // Withdrawing on a proposal (no room) removes you from its members.
          return { ...gs, members: gs.members.filter((m) => m.userId !== user.id) };
        }
        if (selfRow) return { ...gs, members: gs.members.map((m) => (m.userId === user.id ? { ...m, voted: true } : m)) };
        const cur = progress[showId];
        return { ...gs, members: [...gs.members, { userId: user.id, voted: true, s: cur?.s ?? 0, e: cur?.e ?? 0, wrote: false, wroteEntryMinS: null, wroteEntryMinE: null }] };
      }));
      if (!voted) setClicked((prev) => (prev && prev.showId === showId ? { ...prev, mode: "vote" } : prev));
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
      setOutOfPool((prev) => { const n = new Set(prev); n.delete(showId); return n; }); // mirror in_pool=true
      await goToRoom(showId);
    } catch (e) { console.error("[dashboard] declare+start failed", e); }
  }

  // "Just confirm my progress": record your (global) watch position without
  // starting/opening a show room. Group-scoped model (2026-07-06): progress
  // alone no longer surfaces you on a group's show — only a yes-vote or room
  // membership does — so this stays deliberately non-committal.
  async function declareProgressOnly(showId: string, val: { s: number; e: number }) {
    if (!user || !activeGroupId) return;
    try {
      const entry: ProgressEntry = { s: val.s, e: val.e, highestS: val.s, highestE: val.e };
      await upsertRewatchStatus(user.id, showId, entry);
      setProgress((prev) => ({ ...prev, [showId]: entry }));
      setOutOfPool((prev) => { const n = new Set(prev); n.delete(showId); return n; }); // mirror in_pool=true
      setClicked(null);
      await refreshGroup(activeGroupId);
    } catch (e) { console.error("[dashboard] log-progress failed", e); }
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

  // CP-C: save the viewer's names for this group's members (phone-contacts
  // rename — overwrites; empty clears back to the handle). Private to the
  // viewer; every surface re-labels instantly via the shared lookup.
  async function saveContactNames(groupId: string) {
    if (!user || contactsSaving) return;
    setContactsSaving(true);
    try {
      const others = (railGroups.find((r) => r.group.id === groupId)?.members ?? []).filter((m) => m.userId !== selfUserId);
      for (const m of others) {
        const next = (contactEdits[m.userId] ?? "").trim();
        const cur = contactNames[m.userId] ?? "";
        if (next !== cur) await setContactName(user.id, m.userId, next);
      }
      setContactNames(await fetchContactNames(user.id));
      setOptionsFor(null);
    } catch (e) { console.error("[dashboard] contact rename failed", e); }
    finally { setContactsSaving(false); }
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
    for (const m of grp?.members ?? []) nameById[m.userId] = personDisplayName(contactNames, m.userId, m.username, m.displayName);

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
              displayName: null, // nameById above already resolved the chain
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
  }, [chatGroupId, loadChat, railGroups, contactNames]);

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
    return (
      <div style={{ ...pageStyle, background: C.green, display: "flex", alignItems: "center", justifyContent: "center" }} aria-busy="true">
        {/* Standard loading line: "loading" + ellipses, Header 2, cream. */}
        <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: CANON.cream }}>loading<LoadingDots /></span>
      </div>
    );
  }

  // Group clusters / group heading — the same component in both contexts.
  // Extracted so the dashboard can wrap it (with the create button) in a
  // vertically-centering column while the group context keeps it at the top.
  const clustersEl = (
    <GroupClusters
      groups={railGroups}
      selfUserId={selfUserId}
      activeGroupId={activeGroupId}
      pendingInvites={pendingInvites}
      clusterDotByGroup={clusterDotByGroup}
      contactNames={contactNames}
      pendingInviteNames={pendingInviteNames}
      groupNumberById={groupNumberById}
      onEnter={(id) => navigate(`/dashboard?g=${id}`)}
      onInviteClick={(inv) => { setInvitePrompt(inv); setAcceptError(null); }}
      onGearClick={(id, rect) => {
        setOptionsFor(id);
        setOptionsAnchor({ x: rect.left, y: rect.bottom + 8 });
        setRenameValue(railGroups.find((r) => r.group.id === id)?.group.name ?? "");
        const others = (railGroups.find((r) => r.group.id === id)?.members ?? []).filter((m) => m.userId !== selfUserId);
        const edits: Record<string, string> = {};
        for (const m of others) edits[m.userId] = contactNames[m.userId] ?? "";
        setContactEdits(edits);
      }}
      onTip={setTip}
    />
  );

  return (
    // Non-group dashboard is a flex column so its body can center vertically.
    <div style={{ ...pageStyle, background: inGroup ? C.sky : C.green, ...(inGroup ? null : { display: "flex", flexDirection: "column" }) }}>
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
          {/* CP2: the invite affordances moved into the body — dashboard gets
              the centered "Create another watch group?", the group room gets
              the centered "Add more friends to this group?". */}
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

      {/* Group heading (group context only) — the clusters component returns
          the room heading there; the dashboard renders its clusters inside
          the centered body below. */}
      {inGroup && clustersEl}

      {/* Edge tabs (group context only): back-to-dashboard left · chat right.
          Position-fixed, so DOM order relative to the heading is irrelevant. */}
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
      {/* CP3: the bootstrap group gets the onboarding explainer instead of
          the generic one (its own copy + its own dismissal). */}
      {inGroup && <GroupRoomSticky onboarding={(() => { try { return localStorage.getItem("ns_onb_group") === activeGroupId; } catch { return false; } })()} />}

      {inGroup ? (
        // ── Group context (sky) ───────────────────────────────────────────────
        // paddingTop 24 (= base 8 + 16) lowers the heading/shelves/show buttons
        // by 16px; the top banner + back/chat tabs are positioned separately.
        <div style={{ ...contentWrap, paddingTop: 24 }}>
          {groupShelves.watching.length > 0 && (
            <>
              <h1 style={shelfHeader}>OPEN SHOW ROOMS:</h1>
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
                    {/* CP5: leave THIS room only — shown on rooms you're in. */}
                    {r.pill.inRoom && r.pill.roomId && (
                      <button className="dash-pill-x" title="leave this show room" onClick={() => setLeaveConfirm({ roomId: r.pill.roomId as string, showId: r.pill.showId, name: r.name })}>×</button>
                    )}
                    <OptInAvatars members={r.opted} personalFill={r.pill.fill === "green"} withTooltip onTip={setTip} />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* CP2: the group room's second shelf — proposed-but-not-started
              shows (votes live here per CP1; starting a room promotes off). */}
          {groupShelves.notStarted.length > 0 && (
            <h1 style={{ ...shelfHeader, textTransform: "none", marginTop: groupShelves.watching.length ? 56 : 0 }}>
              Proposed shows:
            </h1>
          )}
          {groupShelves.notStarted.length > 0 && (
            <div style={shelfLayout(groupShelves.notStarted.length)}>
              {groupShelves.notStarted.map((r) => (
                <div key={r.pill.showId} className="group-pill-wrap">
                  {r.pill.roomId && roomDotByRoomId.get(r.pill.roomId) && <span style={{ ...notifDotButton, background: roomDotByRoomId.get(r.pill.roomId) === "red" ? C.red : C.blue }} />}
                  <div {...interestedTipProps(r.opted, r.name, r.selfOpted, r.selfProg ? `You've watched: S${r.selfProg.s} E${r.selfProg.e}` : undefined, roomNotif(r.pill.roomId))}>
                    <GroupPill pill={r.pill} name={r.name} furthestFriend={r.furthestFriend} onClick={() => onPillClick(r.pill, r.name)} />
                  </div>
                  <OptInAvatars members={r.opted} withTooltip onTip={setTip} />
                </div>
              ))}
            </div>
          )}
          {/* Empty group → the prompt sits just below the clusters. */}
          {groupShelves.watching.length === 0 && groupShelves.notStarted.length === 0 && (
            <h1 style={{ ...heroH1, textAlign: "center", marginTop: 8, marginBottom: 8 }}>
              What shows are you watching<br />or thinking about starting?
            </h1>
          )}
          {/* CP2: the group room's two centered actions — equal width, set a
              little apart from the show buttons above. */}
          <div style={{ textAlign: "center", marginTop: groupShelves.watching.length || groupShelves.notStarted.length ? 80 : 32 }}>
            <button style={{ ...searchPill, width: 384 }} onClick={openSearch}>Propose more shows?</button>
          </div>
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button
              style={{ ...invitePill, width: 384, padding: "16px 0" }}
              onClick={() => activeGroupId && openInvite(activeGroupId)}
            >Add more friends to this group?</button>
          </div>
        </div>
      ) : (
        // ── Groups-only dashboard (green, CP2) ────────────────────────────────
        // The personal shelves are gone: the dashboard is your groups (the
        // clusters) plus one act — create a new group by pairing at least one
        // named friend with at least one proposed show. Vertically centered in
        // the space below the top bar so a sparse dashboard doesn't cling to
        // the top of the page (flex:1 fills the remaining height; content taller
        // than the space grows naturally and the page scrolls).
        <div style={dashboardCenter}>
          {/* 1:2 spacer ratio → content rests ~⅓ down (split between top-pinned
              and dead-center). Empty spacers shrink to 0 if content overflows,
              so the top stays reachable via page scroll. */}
          <div style={{ flex: 1 }} />
          {clustersEl}
          <div style={{ textAlign: "center", marginTop: 40 }}>
            {/* Hidden while the onboarding flow is up — its overlays own the
                screen and this reads as a competing (and nonsensical) action. */}
            {!socialOnbActive && (
              <button style={invitePill} onClick={() => openInvite()}>Create another watch group?</button>
            )}
          </div>
          <div style={{ flex: 2 }} />
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
                  {results.map(({ show: s, inPool, rejoin }) => (
                    inPool ? (
                      <div key={s.id} className="dash-result dash-result--inpool">{activeGroupId ? <><i>{s.name}</i> is already in this group.</> : <>You've already added <i>{s.name}</i> to your watch pool.</>}</div>
                    ) : rejoin ? (
                      // CP5: re-enter a room you'd left (marker clears server-side).
                      <button key={s.id} className="dash-result" onClick={() => rejoinRoom(s)}>
                        {s.name} · rejoin
                      </button>
                    ) : (
                      <button key={s.id} className="dash-result" onClick={() => {
                        // A show you already have a progress row for is
                        // proposed as-is (no picker — progress kept).
                        if (progress[s.id]) { proposeExisting(s); } else { setPickShow(s); setPickProgress({ s: 0, e: 0 }); }
                      }}>
                        {s.name}
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
      {inviteOpen && (() => {
        const creating = !inviteTargetGroupId;
        // ≥1 complete friend row; in create mode every filled row needs BOTH a
        // name and an email (names drive group naming), plus ≥1 proposed show.
        const filledRows = inviteRows.filter((r) => r.email.trim() || r.name.trim());
        const completeRows = filledRows.filter((r) => r.email.includes("@") && (!creating || r.name.trim()));
        const ready = completeRows.length >= 1 && completeRows.length === filledRows.length && (!creating || inviteShows.length >= 1);
        return (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) closeInviteModal(); }}>
          <div style={{ ...searchCard, background: C.sky, position: "relative" }}>
            <button style={modalClose} onClick={closeInviteModal}><X size={18} color={CANON.cream} /></button>
            {!inviteLinks && (
              <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, letterSpacing: 0, color: C.cream, textAlign: "center", margin: "8px 0 24px" }}>
                {inviteTargetGroupId ? <>Connect more friends<br />to this group:</> : <>Email friends to<br />start a watch group:</>}
              </h1>
            )}

            {!inviteLinks ? (
              <>
                {inviteRows.map((row, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <input
                      value={row.name}
                      onChange={(e) => setInviteRows((prev) => prev.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)))}
                      placeholder="their name"
                      maxLength={40}
                      style={{ ...searchInput, border: "none", background: C.cream, color: C.midnight, marginBottom: 0, flex: 0.8 }}
                    />
                    <input
                      value={row.email}
                      onChange={(e) => setInviteRows((prev) => prev.map((v, j) => (j === i ? { ...v, email: e.target.value } : v)))}
                      placeholder="email"
                      style={{ ...searchInput, border: "none", background: C.cream, color: C.midnight, marginBottom: 0, flex: 1.2 }}
                    />
                  </div>
                ))}
                <button
                  onClick={() => setInviteRows((prev) => [...prev, { name: "", email: "" }])}
                  style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: C.cream, color: C.midnight, fontSize: 20, cursor: "pointer", marginTop: 2 }}
                >+</button>
                {/* CP2 create-a-group: pair the invite with ≥1 proposed show. */}
                {creating && (
                  <>
                    <p style={{ fontFamily: "Inter, sans-serif", fontWeight: 400, fontSize: 13, letterSpacing: "normal", lineHeight: 1.5, color: C.cream, margin: "24px 0 10px" }}>
                      And propose at least one show to watch together:
                    </p>
                    {inviteShows.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                        {inviteShows.map((s) => (
                          <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.cream, color: C.midnight, fontWeight: 700, fontSize: 13, padding: "8px 14px", borderRadius: 65 }}>
                            {s.name}
                            <button
                              onClick={() => setInviteShows((prev) => prev.filter((x) => x.id !== s.id))}
                              style={{ border: "none", background: "transparent", color: C.midnight, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}
                              title="remove"
                            >×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <input
                      value={inviteShowQuery}
                      onChange={(e) => setInviteShowQuery(e.target.value)}
                      placeholder="find a show"
                      style={{ ...searchInput, border: "none", background: C.cream, color: C.midnight, marginBottom: 0 }}
                    />
                    {(inviteCatalogMatches.length > 0 || inviteTvToAdd.length > 0) && (
                      <div style={{ marginTop: 8 }}>
                        {inviteCatalogMatches.map((s) => (
                          <button key={s.id} className="dash-result" onClick={() => pickInviteShow(s)}>{s.name}</button>
                        ))}
                        {inviteTvToAdd.map(({ tv, id }) => (
                          <button key={id} className="dash-result" disabled={creatingShow} onClick={() => pickInviteTvShow(tv)}>
                            {tv.name}{networkLabel(tv) ? ` · ${networkLabel(tv)}` : ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {/* "hi, it's…" removed (first-name identity CP4): the invite
                    email now introduces the inviter by their first name. */}
                <div style={{ textAlign: "center", marginTop: 28 }}>
                  <button style={{ ...invitePill, opacity: inviteSending || !ready ? 0.6 : 1 }} disabled={inviteSending || !ready} onClick={sendInvites}>
                    {inviteSending ? "creating…" : creating ? "create group" : "send invite"}
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
                  <button style={invitePill} onClick={closeInviteModal}>done</button>
                </div>
              </>
            )}
          </div>
        </div>
        );
      })()}

      {/* §9 click-model popover (group context). Centered yellow card; pixel-
          anchoring to the clicked pill is a later polish. */}
      {clicked && (() => {
        const gs = groupShows.find((s) => s.showId === clicked.showId);
        // Opted-in = YOUR yes-vote in THIS group (2026-07-06 group-scoped
        // model): the toggle reflects the per-group vote row — proposals live
        // inside a group, so your personal pool never drives this modal.
        const optedIn = !!gs?.members.find((m) => m.userId === selfUserId)?.voted;
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
        const readText = visibleWriters.length > 1 ? "Read what your friends have written?" : `Read what ${readName} has written?`;
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

              {/* Not-started shows — solo-with-toggle and vote mode share ONE
                  shape (2026-07-03): the vote question leads, and the
                  progress + room sections render only once the toggle is
                  "yes". A first click on a friend's show reads as pure
                  discovery (question + trailer); in the yes state progress /
                  room / trailer are all active. Watching-shelf solo (no
                  toggle) keeps the full content unconditionally. */}
              {(clicked.mode === "solo" || clicked.mode === "vote") && (() => {
                const withToggle = clicked.mode === "vote" || !!clicked.voteToggle;
                return (
                  <>
                    {withToggle && (
                      <>
                        <div style={yellowTitle}>Do you want to watch <b>{clicked.name}</b>?</div>
                        <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                          <YesNoToggle value={optedIn} onChange={(v) => doVote(clicked.showId, v)} />
                        </div>
                      </>
                    )}
                    {(!withToggle || optedIn) && (
                      <>
                        {withToggle && <div style={yellowDivider} />}
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
                  </>
                );
              })()}

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
            <div style={yellowTitle}>Join a group with {inviteNames(invitePrompt, contactNames)}?</div>
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
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(26,58,74,0.25)" }} onClick={() => setOptionsFor(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: optionsAnchor?.y ?? 80,
              left: Math.min(optionsAnchor?.x ?? 28, (typeof window !== "undefined" ? window.innerWidth : 1024) - 380),
              display: "flex", flexDirection: "column", gap: 16, width: 360,
            }}
          >
            {(() => {
              const others = (railGroups.find((r) => r.group.id === optionsFor)?.members ?? []).filter((m) => m.userId !== selfUserId);
              if (!others.length) return null;
              return (
                <div style={yellowCard}>
                  <button style={modalClose} onClick={() => setOptionsFor(null)}><X size={16} color={CANON.cream} /></button>
                  <div style={{ ...yellowTitle, marginBottom: 4 }}>Update your contact list:</div>
                  <div style={{ color: CANON.cream, fontSize: 11, opacity: 0.85, marginBottom: 12, lineHeight: 1.5 }}>
                    Your friends&rsquo; names default to their log-in info. You can enter your own names for them &mdash; just like you would on your phone&rsquo;s contacts.
                  </div>
                  {others.map((m) => (
                    <input
                      key={m.userId}
                      value={contactEdits[m.userId] ?? ""}
                      onChange={(e) => setContactEdits((prev) => ({ ...prev, [m.userId]: e.target.value }))}
                      placeholder={m.displayName ?? m.username}
                      maxLength={40}
                      style={{ ...searchInput, border: "none", background: C.cream, color: C.midnight, marginBottom: 8 }}
                    />
                  ))}
                  <button style={{ ...startBtn, marginTop: 4, opacity: contactsSaving ? 0.6 : 1 }} disabled={contactsSaving} onClick={() => saveContactNames(optionsFor)}>
                    {contactsSaving ? "saving…" : "save names"}
                  </button>
                </div>
              );
            })()}
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
        const connected = others.length ? others.map((m) => personDisplayName(contactNames, m.userId, m.username, m.displayName)).join(", ") : "just you";
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
                    {!mine && <div style={{ fontSize: 11, color: CANON.cream, opacity: 0.85, marginBottom: 3 }}>{personDisplayName(contactNames, m.authorId, m.username, m.displayName)}</div>}
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

      {/* CP5: leave-a-show-room confirm (accent card / cream title / outline
          buttons). One version covers both the wrote / never-wrote cases. */}
      {leaveConfirm && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setLeaveConfirm(null); }}>
          <div style={yellowCard}>
            <button style={modalClose} onClick={() => setLeaveConfirm(null)}><X size={16} color={CANON.cream} /></button>
            <div style={{ ...yellowTitle, marginBottom: 12 }}>Leave this show room?</div>
            <div style={{ color: CANON.cream, fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
              This takes you out of the <b>{leaveConfirm.name}</b> room in this group and removes this button from view.
            </div>
            <div style={{ color: CANON.cream, fontSize: 12, lineHeight: 1.5, marginBottom: 18 }}>
              If you have writing in the room, it will stay intact. Simply re-propose the show to rejoin the room.
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
              <button
                style={{ ...startBtn, background: "transparent", color: CANON.cream, border: "2px solid var(--canon-cream,#fef8ea)" }}
                onClick={() => setLeaveConfirm(null)}
              >cancel</button>
              <button style={dangerBtn} onClick={() => doLeaveRoom(leaveConfirm.roomId, leaveConfirm.showId)}>leave</button>
            </div>
          </div>
        </div>
      )}

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

      {/* CP3 social onboarding — strictly AFTER the demo (never both at once). */}
      {socialOnbActive && <SocialOnboarding onDone={handleSocialOnbDone} />}

      {/* Feedback tab — same left-edge widget the homepage has, so feedback
          is reachable from every live desktop surface (2026-07-03). */}
      <FeedbackWidget isMobile={typeof window !== "undefined" && window.innerWidth <= 600} />
    </div>
  );
}

/** Format a pending invite's members as "X and Y" for the join prompt —
 *  first names via the CP6 chain (contact → display_name → bare handle). */
function inviteNames(inv: PendingGroupInvite, contactNames: Record<string, string>): string {
  const ns = pendingInviteMemberNames(inv, contactNames);
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
function GroupPill({ pill, name, furthestFriend, onClick }: { pill: PillData; name: string; furthestFriend?: { s: number; e: number } | null; onClick: () => void }) {
  // Fill = your relationship to the show (2026-07-07, see groupPills.ts):
  //   green    = open show room       → solid green fill, cream text
  //   cream    = proposal you're in   → cream fill, green text
  //   outlined = proposal you're not  → transparent fill, cream outline + text
  const isGreen = pill.fill === "green";
  const isCream = pill.fill === "cream";
  const base: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, padding: "12px 18px",
    borderRadius: 65, fontFamily: '"Inter", sans-serif', fontWeight: 700,
    fontSize: 14, letterSpacing: -1, width: "100%", boxSizing: "border-box",
    background: isGreen ? C.green : isCream ? C.cream : "transparent",
    border: (isGreen || isCream) ? "2px solid transparent" : "2px solid var(--canon-cream,#fef8ea)",
    color: isGreen ? CANON.cream : isCream ? C.green : CANON.cream,
    cursor: "pointer", textAlign: "left",
  };
  return (
    <button style={base} onClick={onClick}>
      {/* No left badge: opted-in avatars convey who's in, and a writer is shown
          by the pen badge on that writer's own avatar (every writer, any count). */}
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      {/* Proposed shelf: a friend already watching → surface how far the
          furthest one has gotten (takes the right slot; else the ▲/▼ gap). */}
      {furthestFriend ? (
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", opacity: 0.9 }}>
          furthest progress: S{furthestFriend.s} E{furthestFriend.e}
        </span>
      ) : (
        <PillRightSide right={pill.right} />
      )}
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
function OptInAvatars({ members, withTooltip, onTip, personalFill = false }: {
  members: { username: string; s: number | null; e: number | null; wrote?: boolean; resolved?: boolean }[];
  withTooltip: boolean;
  // On a Personal-filled (green) show pill, the avatar outline is Personal
  // (green) too (2026-07-09) — else cream (non-writer) / Friend-sky (writer).
  personalFill?: boolean;
  onTip: (t: { text: React.ReactNode; sub?: React.ReactNode; wrap?: boolean; x: number; y: number } | null) => void;
}) {
  if (!members.length) return null;
  return (
    <div style={optInRow}>
      {members.map((m, i) => {
        const watched = (m.s ?? 0) > 0 || (m.e ?? 0) > 0;
        const isWriter = !!m.wrote;
        // Writer indicator (2026-07-08): the AVATAR restyles — Personal fill,
        // Friend outline, Cream text — replacing the old pen badge. Writers
        // KEEP their sky outline on green pills (a green ring on a green fill
        // would vanish); only non-writer avatars go Personal-green there.
        const avStyle = isWriter
          ? { ...optInAvatar, background: C.green, border: `2px solid ${C.sky}`, color: CANON.cream }
          : { ...optInAvatar, border: `2px solid ${personalFill ? C.green : C.cream}` };
        const tip: React.ReactNode = watched
          ? `${m.username} has watched: S${m.s} E${m.e}`
          // Not started watching → "hasn't started / watching yet." (two
          // lines) — for writers too (a writer's own "They have writing in
          // here." sub still clarifies they've written, not watched).
          : <>{m.username} hasn&rsquo;t started<br />watching yet.</>;
        const sub = isWriter ? "They have writing in here." : undefined;
        return (
          <span
            key={`${m.username}-${i}`}
            style={avStyle}
            onMouseMove={withTooltip ? (e) => onTip({ text: tip, sub, wrap: !!sub, x: e.clientX, y: e.clientY }) : undefined}
            onMouseLeave={withTooltip ? () => onTip(null) : undefined}
          >
            {m.resolved === false ? "" : (m.username[0] ?? "?").toUpperCase()}
          </span>
        );
      })}
    </div>
  );
}

function GroupClusters({
  groups, selfUserId, activeGroupId, pendingInvites, clusterDotByGroup, contactNames, pendingInviteNames, groupNumberById, onEnter, onInviteClick, onGearClick, onTip,
}: {
  groups: RailGroup[];
  selfUserId: string;
  activeGroupId: string | null;
  pendingInvites: PendingGroupInvite[];
  clusterDotByGroup: Map<string, "blue" | "red">;
  contactNames: Record<string, string>;
  pendingInviteNames: Record<string, string[]>;
  groupNumberById: Record<string, number>;
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
    // Naming arc (2026-07-07): the header's TITLE is the generic/custom label
    // ("Group N" → custom name); the PEOPLE live in the "with…" line as the
    // viewer's given names (handle fallback).
    const names = others.map((m) => personDisplayName(contactNames, m.userId, m.username, m.displayName)).join(", ");
    return (
      <div style={groupHeadingRow}>
        <h1 style={groupHeadingTitle}>{groupGenericName(active.group, groupNumberById[active.group.id])}</h1>
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
          ...others.map((m) => <Avatar key={m.userId} letter={personDisplayName(contactNames, m.userId, m.username, m.displayName)[0]} state="accepted" />),
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
              {groupDisplayName(group, others, contactNames, pendingInviteNames[group.id] ?? [], groupNumberById[group.id])}
            </div>
          </button>
        );
      })}
      {pendingInvites.map((inv) => {
        const names = pendingInviteMemberNames(inv, contactNames);
        const label = inv.groupName || names.join(", ");
        return (
          <button
            key={inv.token}
            style={clusterBtn}
            onClick={() => onInviteClick(inv)}
            onMouseMove={(e) => onTip({ text: <>You&rsquo;ve been invited by {pendingInviterLabel(inv, contactNames)}<br />to join a watch group.</>, wrap: true, x: e.clientX, y: e.clientY })}
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

// ── Styles ──────────────────────────────────────────────────────────────────────
const pageStyle: React.CSSProperties = {
  position: "fixed", inset: 0, fontFamily: '"Inter", system-ui, sans-serif', overflowY: "auto",
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
// Groups-only dashboard body: fills the height under the top bar and centers
// its content (clusters + create button) vertically. flex item min-height is
// auto, so taller-than-viewport content grows and the page scrolls instead of
// clipping.
const dashboardCenter: React.CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "24px",
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
  // Lowered 4px (translateY 50% + 4) — pulled up from +8 now that the pen
  // badge is gone (2026-07-09); .group-pill-wrap keeps its 8px row spacing
  // below so the avatars don't crowd the next row.
  position: "absolute", right: 40, bottom: 0, transform: "translateY(calc(50% + 4px))",
  display: "flex", gap: 6, pointerEvents: "none", zIndex: 5,
};
const optInAvatar: React.CSSProperties = {
  position: "relative",
  width: 30, height: 30, borderRadius: "50%", border: `2px solid ${C.cream}`, background: C.sky,
  color: C.cream, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  pointerEvents: "auto", // hoverable for the per-member tooltip
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
const yellowDivider: React.CSSProperties = {
  height: 1, background: "rgba(253,248,236,0.5)", margin: "20px 0 14px",
};
// Button-outline rule: solid fill = no contrasting outline; outlined = transparent fill.
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
      .group-pill-wrap:hover .dash-pill-x { opacity: 1; }
    `}</style>
  );
}
