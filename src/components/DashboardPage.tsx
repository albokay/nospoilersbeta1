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
import { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { X, Settings, UsersRound, Pencil, ArrowUp, LogOut, ArrowLeft, MessageCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  fetchShows,
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
  leavePeopleGroup,
  renamePeopleGroup,
  fetchMyPendingGroupInvites,
  fetchGroupPendingInvites,
  fetchGroupMessages,
  sendGroupMessage,
  fetchOutOfPoolShows,
  removeShowFromPool,
  restoreShowToPool,
  type Show,
  type GroupDashboardShow,
  type PendingGroupInvite,
  type GroupMessage,
} from "../lib/db";
import { computePill, type PillData } from "../lib/groupPills";
import type { ProgressEntry, PeopleGroup, PeopleGroupMember } from "../types";
import SidebarLogo from "./SidebarLogo";
import OneSelectProgress from "./OneSelectProgress";

// ── §16 palette (authoritative) ──────────────────────────────────────────────
const C = {
  green:    "#7ABD8E",
  sky:      "#ADC8D7",
  blue:     "#355EB8",
  yellow:   "#DEA838",
  red:      "#F45028",
  cream:    "#FEF8EA",
  midnight: "#1A3A4A",
  greyblue: "#8DAABA",
};
const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';

type RailGroup = { group: PeopleGroup; members: PeopleGroupMember[]; pendingHandles: string[] };

export default function DashboardPage() {
  const { user, profile, loading: authLoading, signOut } = useAuth() as any;
  const navigate = useNavigate();
  const location = useLocation();

  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [railGroups, setRailGroups] = useState<RailGroup[]>([]);
  const [loading, setLoading] = useState(true);
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

  // Invite / create-group modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmails, setInviteEmails] = useState<string[]>([""]);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<{ email: string; link?: string; error?: string }[] | null>(null);
  // null = INVITE FRIENDS (form a NEW group); set = "connect more" to this group.
  const [inviteTargetGroupId, setInviteTargetGroupId] = useState<string | null>(null);

  // §9 click-model popover (group context). mode captured at click time.
  const [clicked, setClicked] = useState<{ showId: string; name: string; mode: "solo" | "vote" | "watchq" } | null>(null);
  const [declaredProgress, setDeclaredProgress] = useState<{ s: number; e: number }>({ s: 0, e: 0 });

  // CP5b: pending invites (rail "*you're invited"), group options (gear).
  const [pendingInvites, setPendingInvites] = useState<PendingGroupInvite[]>([]);
  const [invitePrompt, setInvitePrompt] = useState<PendingGroupInvite | null>(null);
  const [optionsFor, setOptionsFor] = useState<string | null>(null); // group id whose gear options are open
  const [optionsAnchor, setOptionsAnchor] = useState<{ x: number; y: number } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // CP6: group chat panel.
  const [chatGroupId, setChatGroupId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<GroupMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  // Personal-dashboard pill click → progress dropdown (+ write-by-yourself on
  // the currently-watching shelf). mode distinguishes the two shelves.
  const [pillModal, setPillModal] = useState<{ showId: string; name: string; mode: "watching" | "notStarted" } | null>(null);

  // Cursor-following tooltip (opt-in avatars + show-button watch progress).
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  function tipProps(text?: string) {
    if (!text) return {};
    return {
      onMouseMove: (e: React.MouseEvent) => setTip({ text, x: e.clientX, y: e.clientY }),
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
      try {
        const [showRows, prog, oop] = await Promise.all([
          fetchShows(), fetchProgress(user.id), fetchOutOfPoolShows(user.id),
        ]);
        if (cancelled) return;
        setShows(showRows);
        setProgress(prog);
        setOutOfPool(oop);
      } catch (e) {
        console.error("[dashboard] core load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
      const rail = await loadRail(user.id);
      if (!cancelled) setRailGroups(rail);
      try {
        const inv = await fetchMyPendingGroupInvites();
        if (!cancelled) setPendingInvites(inv);
      } catch (e) { console.warn("[dashboard] pending invites not loaded", e); }
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, navigate, loadRail]);

  // ── Group dashboard load ───────────────────────────────────────────────────
  const refreshGroup = useCallback(async (groupId: string) => {
    try {
      const rows = await fetchGroupDashboard(groupId);
      setGroupShows(rows);
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
    type OptIn = { username: string; s: number | null; e: number | null };
    type Row = { pill: PillData; name: string; opted: OptIn[]; selfProg: { s: number; e: number } | null; tier: number; lastActivityAt: number | null };
    const watching: Row[] = [];
    const notStarted: Row[] = [];
    for (const gs of groupShows) {
      const show = showsById[gs.showId];
      const pill = computePill(gs, show?.seasons, selfUserId);
      // Opted-in members other than you → the avatars overlapping the pill.
      const opted: OptIn[] = gs.members
        .filter((mm) => mm.userId !== selfUserId)
        .map((mm) => ({ username: memberNameById[mm.userId] ?? "someone", s: mm.s, e: mm.e }));
      // Your own progress on this show (if any) → the show-button tooltip.
      const self = gs.members.find((mm) => mm.userId === selfUserId);
      const selfProg = self && ((self.s ?? 0) > 0 || (self.e ?? 0) > 0) ? { s: self.s as number, e: self.e as number } : null;
      // Activity bucket: 2+ writing → 1 writing → 2+ watching → 1 watching.
      const writerCount = pill.writerCount;
      const watcherCount = gs.members.filter((mm) => (mm.s ?? 0) > 0 || (mm.e ?? 0) > 0).length;
      const tier = writerCount >= 2 ? 0 : writerCount === 1 ? 1 : watcherCount >= 2 ? 2 : watcherCount >= 1 ? 3 : 4;
      const row = { pill, name: show?.name ?? gs.showId, opted, selfProg, tier, lastActivityAt: gs.lastActivityAt };
      (pill.shelf === "watching" ? watching : notStarted).push(row);
    }
    const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);
    // Currently-watching shelf: by bucket, then most recent activity within it.
    const byActivity = (a: Row, b: Row) =>
      (a.tier - b.tier) || ((b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)) || a.name.localeCompare(b.name);
    return { watching: watching.sort(byActivity), notStarted: notStarted.sort(byName) };
  }, [groupShows, showsById, selfUserId, memberNameById]);

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

  // ── Actions ────────────────────────────────────────────────────────────────
  function openSearch() { setSearchOpen(true); setQuery(""); }
  function closeSearch() { setSearchOpen(false); setQuery(""); setPickShow(null); }

  async function addShow(show: Show, val: { s: number; e: number }) {
    if (!user) return;
    const entry: ProgressEntry = { s: val.s, e: val.e, highestS: val.s, highestE: val.e };
    try {
      await upsertRewatchStatus(user.id, show.id, entry);
      setProgress((prev) => ({ ...prev, [show.id]: entry }));
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
      const links: { email: string; link?: string; error?: string }[] = [];
      for (const email of emails) {
        try {
          const token = await createPeopleGroupInvite(id, email);
          sendGroupInviteEmail(token); // best-effort email; link below is the fallback
          links.push({ email, link: `${window.location.origin}/group-invite/${token}` });
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
    if (!activeGroupId) return;
    try {
      await setShowVote(activeGroupId, showId, voted);
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
    setRailGroups(await loadRail(user.id));
    try { setPendingInvites(await fetchMyPendingGroupInvites()); } catch { /* tolerant */ }
  }

  async function acceptInvite(inv: PendingGroupInvite) {
    setInvitePrompt(null);
    const res = await acceptPeopleGroupInvite(inv.token);
    if (res.ok) {
      await refreshRailAndInvites();
      navigate(`/dashboard?g=${inv.groupId}`);
    } else {
      console.error("[dashboard] accept invite failed", res.error);
    }
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
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [chatGroupId, loadChat, railGroups]);

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
        <SidebarLogo scale={0.5} blocksOpacity={1} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button style={invitePill} onClick={() => openInvite()}>INVITE FRIENDS</button>
          <button style={topCircleBtn(inGroup)} title="sign out" onClick={async () => { try { await signOut?.(); } catch { /* ignore */ } navigate("/"); }}>
            <LogOut size={18} color={inGroup ? C.midnight : "#fff"} />
          </button>
          {profile?.is_admin && (
            <button style={topCircleBtn(inGroup)} title="admin" onClick={() => navigate("/?admin")}>
              <Settings size={18} color={inGroup ? C.midnight : "#fff"} />
            </button>
          )}
        </div>
      </div>

      {/* Group clusters (top of the body) — replaces the old right rail */}
      <GroupClusters
        groups={railGroups}
        selfUserId={selfUserId}
        activeGroupId={activeGroupId}
        pendingInvites={pendingInvites}
        onEnter={(id) => navigate(`/dashboard?g=${id}`)}
        onInviteClick={(inv) => setInvitePrompt(inv)}
        onGearClick={(id, rect) => { setOptionsFor(id); setOptionsAnchor({ x: rect.left, y: rect.bottom + 8 }); setRenameValue(railGroups.find((r) => r.group.id === id)?.group.name ?? ""); }}
      />

      {/* Edge tabs (group context only): back-to-dashboard left · chat right */}
      {inGroup && (
        <button style={backTab} title="back to dashboard" onClick={() => navigate("/dashboard")}>
          <ArrowLeft size={24} color={C.green} />
        </button>
      )}
      {inGroup && (
        <button style={chatTab} title="open chat" onClick={() => activeGroupId && setChatGroupId(activeGroupId)}>
          <MessageCircle size={24} color={C.green} />
        </button>
      )}

      {inGroup ? (
        // ── Group context (sky) ───────────────────────────────────────────────
        <div style={contentWrap}>
          {groupShelves.watching.length > 0 && (
            <>
              <h1 style={shelfHeader}>CURRENTLY WATCHING:</h1>
              <div style={shelfGrid}>
                {groupShelves.watching.map((r) => (
                  <div key={r.pill.showId} className="group-pill-wrap">
                    <div {...tipProps(r.selfProg ? `You've watched: S${r.selfProg.s} E${r.selfProg.e}` : undefined)}>
                      <GroupPill pill={r.pill} name={r.name} onClick={() => onPillClick(r.pill, r.name)} />
                    </div>
                    <OptInAvatars members={r.opted} withTooltip onTip={setTip} />
                  </div>
                ))}
              </div>
            </>
          )}

          <h1 style={{ ...shelfHeader, textTransform: "none", marginTop: groupShelves.watching.length ? 56 : 0 }}>
            Haven&rsquo;t started yet:
          </h1>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <button style={searchPill} onClick={openSearch}>SEARCH</button>
          </div>
          {groupShelves.notStarted.length > 0 && (
            <div style={shelfGrid}>
              {groupShelves.notStarted.map((r) => (
                <div key={r.pill.showId} className="group-pill-wrap">
                  <div {...tipProps(r.selfProg ? `You've watched: S${r.selfProg.s} E${r.selfProg.e}` : undefined)}>
                    <GroupPill pill={r.pill} name={r.name} onClick={() => onPillClick(r.pill, r.name)} />
                  </div>
                  <OptInAvatars members={r.opted} withTooltip={false} onTip={setTip} />
                </div>
              ))}
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: 64 }}>
            {/* Adds members to the CURRENT group (distinct from INVITE FRIENDS). */}
            <button style={connectMorePill} onClick={() => activeGroupId && openInvite(activeGroupId)}>
              CONNECT MORE FRIENDS TO THIS GROUP
            </button>
          </div>
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
              <div style={shelfGrid}>
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

          <h1 style={{ ...shelfHeader, textTransform: "none", marginTop: watching.length ? 56 : 0 }}>
            Haven&rsquo;t started yet:
          </h1>
          {notStarted.length > 0 && (
            <div style={shelfGrid}>
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
            <button style={modalClose} onClick={() => setInviteOpen(false)}><X size={18} color="#fff" /></button>
            <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, letterSpacing: 0, color: C.cream, textAlign: "center", margin: "8px 0 24px" }}>
              {inviteTargetGroupId ? <>Connect more friends<br />to this group:</> : <>Email a friend to<br />start a watch group:</>}
            </h1>

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
                <div style={{ color: C.midnight, fontSize: 11, marginTop: 16, opacity: 0.8 }}>
                  CP5a: sending mints a shareable invite link (email delivery is CP5b).
                </div>
                <div style={{ textAlign: "right", marginTop: 16 }}>
                  <button style={{ ...invitePill, opacity: inviteSending ? 0.6 : 1 }} disabled={inviteSending} onClick={sendInvites}>
                    {inviteSending ? "creating…" : "send invite"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ color: C.midnight, fontSize: 13, marginBottom: 12 }}>
                  Invites emailed. The link is here too as a backup — they open it (signed in with that email) to join:
                </div>
                {inviteLinks.map((r, i) => (
                  <CopyRow key={i} email={r.email} link={r.link} error={r.error} />
                ))}
                <div style={{ textAlign: "right", marginTop: 12 }}>
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
        const roomLabel = gs?.roomId ? "Open show room" : "Start a show room?";
        // "Solo" only when you're the sole opt-in; 2+ opted in → plain show room.
        const optedCount = gs?.members.length ?? 0;
        const cur = progress[clicked.showId];
        const curVal = cur ? { s: cur.s, e: cur.e } : { s: 0, e: 0 };
        return (
          <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setClicked(null); }}>
            {/* solo + watchq are wider to fit the "Yes" + "just log my progress" row. */}
            <div style={{ ...yellowCard, ...(clicked.mode === "watchq" || clicked.mode === "solo" ? { width: "min(460px, 92vw)" } : {}) }}>
              <button style={modalClose} onClick={() => setClicked(null)}><X size={16} color="#fff" /></button>

              {clicked.mode === "solo" && (
                <>
                  <div style={yellowTitle}>Have you watched more?</div>
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
                  <div style={{ ...yellowTitle, fontSize: 13 }}>{gs?.roomId ? "Open show room" : optedCount > 1 ? "Start a show room?" : "Start a solo show room?"}</div>
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", marginTop: 12 }}>
                    <button style={startBtn} onClick={() => declareAndGo(clicked.showId, declaredProgress)}>Yes</button>
                    <button
                      style={{ ...startBtn, padding: "11px 24px", whiteSpace: "nowrap", background: "transparent", color: C.cream, border: `2px solid ${C.cream}` }}
                      onClick={() => declareProgressOnly(clicked.showId, declaredProgress)}
                    >just log my progress</button>
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
                      <button style={{ ...startBtn, marginTop: 12 }} onClick={() => goToRoom(clicked.showId)}>Yes</button>
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
                  <div style={{ ...yellowTitle, fontSize: 13 }}>{roomLabel}</div>
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", marginTop: 12 }}>
                    <button style={startBtn} onClick={() => declareAndGo(clicked.showId, declaredProgress)}>Yes</button>
                    <button
                      style={{ ...startBtn, padding: "11px 24px", whiteSpace: "nowrap", background: "transparent", color: C.cream, border: `2px solid ${C.cream}` }}
                      onClick={() => declareProgressOnly(clicked.showId, declaredProgress)}
                    >just log my progress</button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* CP5b: "Join a group with @X?" from a pending invite (rail red cluster) */}
      {invitePrompt && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setInvitePrompt(null); }}>
          <div style={yellowCard}>
            <button style={modalClose} onClick={() => setInvitePrompt(null)}><X size={16} color="#fff" /></button>
            <div style={yellowTitle}>Join a group with {inviteNames(invitePrompt)}?</div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
              <button style={startBtn} onClick={() => acceptInvite(invitePrompt)}>Yes</button>
              <button style={{ ...startBtn, background: "transparent", color: "#fff", border: "2px solid #fff" }} onClick={() => setInvitePrompt(null)}>no</button>
            </div>
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
              <button style={modalClose} onClick={() => setOptionsFor(null)}><X size={16} color="#fff" /></button>
              <div style={{ ...yellowTitle, marginBottom: 12 }}>Rename group:</div>
              <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="group name" style={{ ...searchInput, border: "none", background: C.cream, color: C.midnight }} />
              <button style={{ ...startBtn, marginTop: 12 }} onClick={() => doRename(optionsFor)}>confirm name</button>
            </div>
            <div style={yellowCard}>
              <div style={{ ...yellowTitle, marginBottom: 12 }}>Leave this group?</div>
              <button style={dangerBtn} onClick={() => doLeave(optionsFor)}>yes, leave</button>
              <div style={yellowDivider} />
              <div style={{ color: "#fff", fontSize: 12, opacity: 0.9 }}>You can join again if someone sends you another invite.</div>
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
              <div style={{ fontWeight: 700, color: C.green, fontSize: 14, lineHeight: 1.3 }}>You're connected with:<br />{connected}</div>
              <button style={{ border: "none", background: "transparent", cursor: "pointer" }} onClick={() => setChatGroupId(null)}><X size={18} color={C.sky} /></button>
            </div>
            <div style={chatBody}>
              {chatMessages.map((m) => {
                const mine = m.authorId === selfUserId;
                return (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", marginBottom: 12 }}>
                    {!mine && <div style={{ fontSize: 11, color: "#fff", opacity: 0.85, marginBottom: 3 }}>{m.username}</div>}
                    <div style={mine ? chatBubbleMine : chatBubbleOther}>{m.body}</div>
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
              <button style={chatSend} onClick={sendChat}><ArrowUp size={18} color="#fff" /></button>
            </div>
          </div>
        );
      })()}

      {/* §4 remove-from-pool confirm */}
      {removeConfirm && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setRemoveConfirm(null); }}>
          <div style={{ background: C.sky, borderRadius: 15, padding: "26px 30px", width: "min(340px, 90vw)", position: "relative" }}>
            <button style={modalClose} onClick={() => setRemoveConfirm(null)}><X size={16} color="#fff" /></button>
            <div style={{ color: C.red, fontWeight: 700, fontSize: 15, marginBottom: 12, letterSpacing: -0.3 }}>Remove this show from your pool?</div>
            <div style={{ color: "#fff", fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>This will down vote the show across all your groups and you will leave all your friend rooms.</div>
            <div style={{ color: "#fff", fontSize: 12, lineHeight: 1.5, marginBottom: 18 }}>BUT, your progress will be saved and restored if you search for and add the show back to your show pool.</div>
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
              <button style={modalClose} onClick={() => setPillModal(null)}><X size={16} color="#fff" /></button>

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
                    >just log my progress</button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Cursor-following tooltip bubble (opt-in avatars + watch progress). */}
      {tip && createPortal(
        <div style={{ ...tipBubble, left: tip.x + 14, top: tip.y + 16 }}>{tip.text}</div>,
        document.body,
      )}
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
            style={{ border: "none", background: C.blue, color: "#fff", fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 65, cursor: "pointer", whiteSpace: "nowrap" }}
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
        background: "#fff", transition: "left 120ms",
      }} />
      <span style={{ width: "50%", textAlign: "center", fontSize: 12, fontWeight: 700, color: value ? "rgba(0,0,0,0.35)" : C.midnight, zIndex: 1 }}>no</span>
      <span style={{ width: "50%", textAlign: "center", fontSize: 12, fontWeight: 700, color: value ? C.green : "rgba(0,0,0,0.35)", zIndex: 1 }}>yes</span>
    </button>
  );
}

// ── Group pill (§7) ──────────────────────────────────────────────────────────
function GroupPill({ pill, name, onClick }: { pill: PillData; name: string; onClick: () => void }) {
  const isGreen = pill.fill === "green";
  const isCream = pill.fill === "cream";
  // In sky group-context: green = solid green/white; outlined = white outline +
  // white text; cream = cream fill + green text.
  const base: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, padding: "12px 18px",
    borderRadius: 65, fontFamily: '"Inter", sans-serif', fontWeight: 700,
    fontSize: 14, letterSpacing: -1, width: "100%", boxSizing: "border-box",
    background: isGreen ? C.green : isCream ? C.cream : "transparent",
    border: isCream || isGreen ? "2px solid transparent" : "2px solid #fff",
    color: isGreen ? "#fff" : isCream ? C.green : "#fff",
    cursor: "pointer", textAlign: "left",
  };
  return (
    <button style={base} onClick={onClick}>
      {/* Left badge cluster */}
      {pill.people ? (
        <span style={leftIcon}><UsersRound size={16} /></span>
      ) : (
        <>
          {pill.showCount && <span style={countCircle}>{pill.count}</span>}
          {pill.pencil && <span style={{ ...leftIcon, color: isCream ? C.green : "#fff" }}><Pencil size={14} /></span>}
        </>
      )}
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      <PillRightSide right={pill.right} />
    </button>
  );
}

function PillRightSide({ right }: { right: PillData["right"] }) {
  if (right.kind === "none") return null;
  if (right.kind === "progress") {
    return <span style={{ fontWeight: 500, opacity: 0.85, fontSize: 13 }}>s{right.s} e{right.e}</span>;
  }
  const up = right.dir === "up";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: up ? C.green : C.red, fontWeight: 700 }}>
      <span style={{ fontSize: 12 }}>{up ? "▲" : "▼"}</span>{right.n}
    </span>
  );
}

// ── Group clusters (top of the dashboard body) ───────────────────────────────
function Avatar({ letter, state }: { letter?: string; state: "accepted" | "pending" | "invited" }) {
  // accepted = cream/green · pending (invite sent) = yellow/cream · invited-to-you = red/green
  const bg = state === "accepted" ? C.cream : state === "pending" ? C.yellow : C.red;
  const fg = state === "accepted" ? C.green : state === "pending" ? C.cream : C.green;
  return <span style={{ ...avatarCircle, background: bg, color: fg }}>{(letter ?? "?").toUpperCase()}</span>;
}

/** Opt-in member avatars overlapping a group-pill's bottom edge (the friends
 *  who have this show in the group's pool). Decorative — pointer-events off so
 *  they never block a pill click. */
function OptInAvatars({ members, withTooltip, onTip }: {
  members: { username: string; s: number | null; e: number | null }[];
  withTooltip: boolean;
  onTip: (t: { text: string; x: number; y: number } | null) => void;
}) {
  if (!members.length) return null;
  return (
    <div style={optInRow}>
      {members.map((m, i) => {
        const watched = (m.s ?? 0) > 0 || (m.e ?? 0) > 0;
        const tip = watched ? `${m.username} has watched: S${m.s} E${m.e}` : `${m.username} hasn't started yet`;
        return (
          <span
            key={`${m.username}-${i}`}
            style={optInAvatar}
            onMouseMove={withTooltip ? (e) => onTip({ text: tip, x: e.clientX, y: e.clientY }) : undefined}
            onMouseLeave={withTooltip ? () => onTip(null) : undefined}
          >
            {(m.username[0] ?? "?").toUpperCase()}
          </span>
        );
      })}
    </div>
  );
}

function GroupClusters({
  groups, selfUserId, activeGroupId, pendingInvites, onEnter, onInviteClick, onGearClick,
}: {
  groups: RailGroup[];
  selfUserId: string;
  activeGroupId: string | null;
  pendingInvites: PendingGroupInvite[];
  onEnter: (id: string) => void;
  onInviteClick: (inv: PendingGroupInvite) => void;
  onGearClick: (groupId: string, rect: DOMRect) => void;
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
        <button style={headingIconBtn} title="group options" onClick={(e) => onGearClick(active.group.id, e.currentTarget.getBoundingClientRect())}><Settings size={22} color="#fff" /></button>
      </div>
    );
  }

  // Green dashboard: every group you're in + every group you're invited to.
  return (
    <div style={clustersRow}>
      {groups.map(({ group, members, pendingHandles }) => {
        const others = members.filter((m) => m.userId !== selfUserId);
        const display = others.length ? others : members;
        return (
          <button key={group.id} style={clusterBtn} title="open group" onClick={() => onEnter(group.id)}>
            <div style={avatarPile}>
              {display.map((m) => <Avatar key={m.userId} letter={m.username[0]} state="accepted" />)}
              {pendingHandles.map((h, i) => <Avatar key={`p${i}`} letter={h[0]} state="pending" />)}
            </div>
            <div style={clusterName}>{groupAutoName(group, others)}</div>
          </button>
        );
      })}
      {pendingInvites.map((inv) => {
        const names = inv.memberNames.length ? inv.memberNames : [inv.inviterName];
        const label = inv.groupName || names.join(", ");
        return (
          <button key={inv.token} style={clusterBtn} title="you're invited" onClick={() => onInviteClick(inv)}>
            <div style={avatarPile}>
              {names.map((n, i) => <Avatar key={i} letter={n[0]} state="invited" />)}
            </div>
            <div style={clusterName}>{label}</div>
          </button>
        );
      })}
    </div>
  );
}

/** Custom name if set, else the other members' usernames, alphabetical. */
function groupAutoName(group: PeopleGroup, others: PeopleGroupMember[]): string {
  if (group.name) return group.name;
  if (!others.length) return "(just you)";
  return others.map((m) => m.username).sort((a, b) => a.localeCompare(b)).join(", ");
}

// ── Styles ──────────────────────────────────────────────────────────────────────
const pageStyle: React.CSSProperties = {
  position: "fixed", inset: 0, fontFamily: '"Inter", system-ui, sans-serif', overflowY: "auto",
};
const heroWrap: React.CSSProperties = {
  minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "center", textAlign: "center", gap: 32, padding: "0 24px",
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
const searchPill: React.CSSProperties = {
  border: "none", background: C.cream, color: C.red, fontWeight: 700, fontSize: 14,
  padding: "16px 56px", borderRadius: 65, cursor: "pointer",
};
const invitePill: React.CSSProperties = {
  border: "none", background: C.blue, color: "#fff", fontWeight: 700, fontSize: 14,
  padding: "18px 64px", borderRadius: 65, cursor: "pointer", boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};
const connectMorePill: React.CSSProperties = {
  border: "2px solid #fff", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 14,
  padding: "16px 40px", borderRadius: 65, cursor: "pointer", letterSpacing: -0.5,
};
const topBar: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 28px",
};
const topCircleBtn = (inGroup: boolean): React.CSSProperties => ({
  width: 44, height: 44, borderRadius: "50%", background: "transparent",
  border: `2px solid ${inGroup ? C.midnight : "#fff"}`, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
});
const clustersRow: React.CSSProperties = {
  display: "flex", justifyContent: "center", alignItems: "flex-start", flexWrap: "wrap",
  gap: 56, padding: "16px 80px 36px",
};
const clusterBtn: React.CSSProperties = { border: "none", background: "transparent", cursor: "pointer", padding: 0 };
const avatarPile: React.CSSProperties = {
  display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 4, maxWidth: 104, margin: "0 auto",
};
const avatarCircle: React.CSSProperties = {
  width: 60, height: 60, borderRadius: "50%", display: "inline-flex", alignItems: "center",
  justifyContent: "center", fontFamily: LORA, fontWeight: 700, fontSize: 32, letterSpacing: 0,
};
const optInRow: React.CSSProperties = {
  // Right-anchored: avatars fill from the button's right edge toward center.
  position: "absolute", right: 40, bottom: 0, transform: "translateY(50%)",
  display: "flex", gap: 6, pointerEvents: "none", zIndex: 5,
};
const optInAvatar: React.CSSProperties = {
  width: 30, height: 30, borderRadius: "50%", border: `2px solid ${C.cream}`, background: C.sky,
  color: C.blue, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  pointerEvents: "auto", // hoverable for the per-member tooltip
};
const tipBubble: React.CSSProperties = {
  position: "fixed", background: C.green, color: "#fff", padding: "7px 12px", borderRadius: 12,
  fontFamily: '"Inter", sans-serif', fontSize: 13, fontWeight: 600, lineHeight: 1.3,
  whiteSpace: "nowrap", pointerEvents: "none", zIndex: 9999, boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
};
const clusterName: React.CSSProperties = {
  marginTop: 8, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: -1,
  color: "#fff", maxWidth: 120, lineHeight: 1.25, marginLeft: "auto", marginRight: "auto",
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
  fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: 0, color: "#fff", margin: 0,
};
const groupHeadingMembers: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: 0, color: "#fff",
};
const backTab: React.CSSProperties = {
  position: "fixed", left: 0, top: "18%", background: C.cream, border: "none", cursor: "pointer",
  borderTopRightRadius: 28, borderBottomRightRadius: 28, padding: "16px 22px 16px 14px",
  display: "inline-flex", alignItems: "center", boxShadow: "6px 6px 18px rgba(0,0,0,0.15)", zIndex: 45,
};
const chatTab: React.CSSProperties = {
  position: "fixed", right: 0, top: "60%", background: C.cream, border: "none", cursor: "pointer",
  borderTopLeftRadius: 28, borderBottomLeftRadius: 28, padding: "16px 14px 16px 22px",
  display: "inline-flex", alignItems: "center", boxShadow: "-6px 6px 18px rgba(0,0,0,0.15)", zIndex: 45,
};
const countCircle: React.CSSProperties = {
  minWidth: 22, height: 22, padding: "0 6px", borderRadius: 11, background: C.green, color: "#fff",
  fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const leftIcon: React.CSSProperties = { display: "inline-flex", alignItems: "center", color: "#fff" };
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
  fontSize: 13, color: C.midnight, background: "#fff", outline: "none",
};
const chatSend: React.CSSProperties = {
  border: "none", background: C.blue, borderRadius: "50%", width: 38, height: 38, display: "inline-flex",
  alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "0 0 auto",
};
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(26,58,74,0.25)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 50,
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
  color: "#fff", fontSize: 15, fontWeight: 600, letterSpacing: -0.5,
};
const yellowDivider: React.CSSProperties = {
  height: 1, background: "rgba(255,255,255,0.5)", margin: "20px 0 14px",
};
// Button-outline rule: solid fill = no contrasting outline; outlined = transparent fill.
const startBtn: React.CSSProperties = {
  border: "none", background: C.blue, color: "#fff", fontWeight: 700, fontSize: 14,
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
      .dash-pill--watching .dash-pill__prog { font-weight: 500; opacity: 0.8; }
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
      .group-pill-wrap { position: relative; }
    `}</style>
  );
}
