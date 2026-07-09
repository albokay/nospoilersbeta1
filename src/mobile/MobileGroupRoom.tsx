import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { X, ArrowLeft, Settings, MessageCircle, Pencil } from "lucide-react";
import { CANON } from "../styles/canon";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";
import OneSelectProgress from "../components/OneSelectProgress";
import LoadingDots from "../components/LoadingDots";
import TrailerCard from "../components/TrailerCard";
import MobileSearchSheet from "./MobileSearchSheet";
import MobileInviteSheet from "./MobileInviteSheet";
import {
  fetchShows,
  refreshStaleShows,
  fetchProgress,
  upsertRewatchStatus,
  fetchPeopleGroupsForUser,
  fetchPeopleGroupMembers,
  fetchMyGroupJoinOrder,
  fetchContactNames,
  setContactName,
  fetchGroupDashboard,
  setShowVote,
  ensureProgressRow,
  startShowRoom,
  leavePeopleGroup,
  renamePeopleGroup,
  fetchOutOfPoolShows,
  clearMigrationDormantForShow,
  fetchRoomActivityVisibility,
  roomHasNewActivity,
  fetchGroupChatActivity,
  chatHasNewActivity,
  type Show,
  type GroupDashboardShow,
  type RoomVisibility,
} from "../lib/db";
import { computePill, linearIndex, type PillData } from "../lib/groupPills";
import { groupGenericName, personDisplayName } from "../lib/groupNames";
import type { ProgressEntry, PeopleGroup, PeopleGroupMember } from "../types";

/**
 * MobileGroupRoom (CP4) — the group room, where the social layer lives.
 * Mobile re-expression of the desktop DashboardPage's GROUP (sky) context:
 * same data (get_group_dashboard), same pill rules (groupPills.ts), same
 * click-model branches — laid out per the mobile rebuild spec:
 *
 *   • Shows render as FULL-WIDTH TWO-LINE ROWS (not a pill grid): line 1 the
 *     show name, line 2 a quiet progress/gap line (the desktop hover
 *     tooltip's gap text moved inline — hover doesn't exist here); opt-in
 *     avatars on the right (pen badge on writers, same as desktop).
 *   • Row fill colors mirror the desktop pill tiers: self-watching / 2+
 *     writers = green fill; want-only = cream fill; else outlined.
 *   • New-activity dot per show row — VISIBLE writing only (blue; the red
 *     invisible-writing layer is cut on mobile). New-message dot on the
 *     chat side of the toggle.
 *   • Shows ↔ chat contextual toggle at this level only (chat = CP5).
 *   • Tapping a row opens a FULL-SCREEN SHEET carrying the desktop
 *     click-modal's full action set (solo / vote / watch-question incl. the
 *     "Read what … have written?" live prompt); for a NOT-STARTED viewer the
 *     trailer stacks below the actions, same vertical order as desktop.
 *     Already-in-room rows open the show room directly (§9 rule 1).
 *   • Gear → rename / leave (desktop copy) as a bottom sheet.
 *
 * Cut per spec: pings/polls/SIKW (no launchers, no stickies), red alert
 * dots. Deferred: "Add more friends to this group?" (CP7 invites).
 */

const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
const C = {
  green: CANON.personal,
  sky: CANON.friend,
  blue: CANON.identity,
  yellow: CANON.accent,
  red: CANON.alert,
  cream: CANON.cream,
  midnight: CANON.dark,
  greyblue: CANON.business,
};

/** Desktop's "haven't started" hover copy, moved inline (no hover on mobile). */
function interestedLine(names: string[], showName: string, selfOpted: boolean): React.ReactNode {
  if (!names.length) return null;
  const show = <i>{showName}</i>;
  const also = selfOpted ? "also " : "";
  if (names.length === 1) return <>{names[0]} is {also}interested in watching {show}.</>;
  if (names.length === 2) return <>{names[0]} and {names[1]} are {also}interested in watching {show}.</>;
  return <>{names.length} friends are {also}interested in watching {show}.</>;
}

/** Same sliding yes/no control as desktop's vote modal. */
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
        background: value ? C.green : C.yellow, transition: "left 120ms, background 120ms",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 700, color: C.cream,
      }}>{value ? "yes" : "no"}</span>
    </button>
  );
}

export default function MobileGroupRoom({ groupId }: { groupId: string }) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const selfUserId = user?.id ?? "";

  const [group, setGroup] = useState<PeopleGroup | null>(null);
  // The viewer's number for this group (their Nth by join order) — drives the
  // per-viewer "Group N" header title (naming arc 2026-07-07).
  const [viewerNumber, setViewerNumber] = useState<number | undefined>(undefined);
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<PeopleGroupMember[]>([]);
  const [groupShows, setGroupShows] = useState<GroupDashboardShow[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [outOfPool, setOutOfPool] = useState<Set<string>>(new Set());
  const [roomVis, setRoomVis] = useState<RoomVisibility[]>([]);
  const [chatNew, setChatNew] = useState(false);
  const [loading, setLoading] = useState(true);

  // Sheets
  const [clicked, setClicked] = useState<{ showId: string; name: string; mode: "solo" | "vote" | "watchq"; voteToggle?: boolean } | null>(null);
  const [declaredProgress, setDeclaredProgress] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [contactEdits, setContactEdits] = useState<Record<string, string>>({});
  const [contactsSaving, setContactsSaving] = useState(false);

  // ── Loads (same calls as desktop's group context) ─────────────────────────
  const refreshGroup = useCallback(async () => {
    try {
      const rows = await fetchGroupDashboard(groupId);
      setGroupShows(rows);
      // Keep this group's shows' episode lists fresh (12h cadence). Perf
      // (2026-07-07): FULLY non-blocking — the catalog read + TVMaze sync no
      // longer delay refreshGroup resolving (the shelves are already up).
      const ids = new Set(rows.map((r) => r.showId));
      fetchShows().then((catalog) =>
        refreshStaleShows(catalog.filter((s) => ids.has(s.id))).then((upd) => {
          if (!upd.length) return;
          setShows((prev) => prev.map((s) => upd.find((u) => u.id === s.id) ?? s));
        }),
      ).catch(() => {});
    } catch (e) {
      console.error("[m-group] group load failed", e);
      setGroupShows([]);
    }
  }, [groupId]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Perf (2026-07-07): the personal core (catalog/progress/pool) and the
      // group's shows load CONCURRENTLY — neither depends on the other, and
      // serializing them doubled the first-paint wait.
      const core = (async () => {
        try {
          const [showRows, prog, oop] = await Promise.all([
            fetchShows(), fetchProgress(user.id), fetchOutOfPoolShows(user.id),
          ]);
          if (cancelled) return;
          setShows(showRows);
          setProgress(prog);
          setOutOfPool(oop);
        } catch (e) {
          console.error("[m-group] core load failed", e);
        }
      })();
      await Promise.all([core, refreshGroup()]);
      if (!cancelled) setLoading(false);
      // Group meta + activity — concurrent, independently tolerant.
      // The join-order read pairs with the group list to derive the viewer's
      // "Group N" number (their Nth group by their own join order).
      Promise.all([fetchPeopleGroupsForUser(user.id), fetchMyGroupJoinOrder(user.id)])
        .then(([gs, jo]) => {
          if (cancelled) return;
          setGroup(gs.find((g) => g.id === groupId) ?? null);
          const sorted = gs.map((g) => ({ id: g.id, j: jo[g.id] ?? 0 })).sort((a, b) => a.j - b.j);
          const idx = sorted.findIndex((g) => g.id === groupId);
          if (idx >= 0) setViewerNumber(idx + 1);
        })
        .catch(() => {});
      fetchPeopleGroupMembers(groupId)
        .then((ms) => { if (!cancelled) setMembers(ms); })
        .catch(() => {});
      fetchContactNames(user.id)
        .then((cn) => { if (!cancelled) setContactNames(cn); })
        .catch(() => {});
      fetchRoomActivityVisibility(user.id, true)
        .then((rv) => { if (!cancelled) setRoomVis(rv); })
        .catch(() => {});
      fetchGroupChatActivity(user.id)
        .then((ca) => { if (!cancelled) setChatNew(ca.some((a) => a.groupId === groupId && chatHasNewActivity(a))); })
        .catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, groupId, refreshGroup]);

  // Live chat dot while you're on the shows side: a filtered, per-group
  // realtime listen that flips the toggle's new-message dot the instant
  // another member posts (desktop parity — same member-gated-RLS auth note
  // as the chat socket itself).
  useEffect(() => {
    if (authLoading || !user) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      } catch { /* tolerate */ }
      if (cancelled) return;
      channel = supabase
        .channel(`m-group-chat-dot-${groupId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
          (payload) => {
            const r = payload.new as any;
            if (!r || r.author_id === selfUserId) return;
            setChatNew(true);
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[m-group] chat-dot realtime status:", status);
          }
        });
    })();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [groupId, user, authLoading, selfUserId]);

  const showsById = useMemo(() => {
    const m: Record<string, Show> = {};
    for (const s of shows) m[s.id] = s;
    return m;
  }, [shows]);

  // userId → display name (naming arc 2026-07-07, desktop parity): the name
  // the VIEWER gave each member, else their handle — drives the interested
  // lines, the "Read what … has written?" prompt, and avatar letters.
  const memberNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mem of members) m[mem.userId] = personDisplayName(contactNames, mem.userId, mem.username);
    return m;
  }, [members, contactNames]);

  // ── Shelves — identical pill computation + ordering to desktop ────────────
  const groupShelves = useMemo(() => {
    type OptIn = { username: string; s: number | null; e: number | null; wrote: boolean; resolved: boolean };
    type Row = { pill: PillData; name: string; opted: OptIn[]; selfProg: { s: number; e: number } | null; selfOpted: boolean; selfWrote: boolean; tier: number; lastActivityAt: number | null };
    const watching: Row[] = [];
    const notStarted: Row[] = [];
    for (const gs of groupShows) {
      // CP5: a room the viewer deliberately LEFT is hidden from THEIR shelves
      // only (never-joined rooms stay visible for discovery; desktop parity).
      if (gs.viewerLeft && !gs.inRoom) continue;
      const show = showsById[gs.showId];
      const pill = computePill(gs, show?.seasons, selfUserId);
      const opted: OptIn[] = gs.members
        .filter((mm) => mm.userId !== selfUserId)
        // resolved = the member's name has loaded (members fetch lands after
        // groupShows); the avatar shows its letter only once resolved, so it
        // never flashes a bogus "S" from the "someone" text fallback.
        .map((mm) => ({ username: memberNameById[mm.userId] ?? "someone", s: mm.s, e: mm.e, wrote: !!mm.wrote, resolved: !!memberNameById[mm.userId] }));
      const self = gs.members.find((mm) => mm.userId === selfUserId);
      const selfProg = self && ((self.s ?? 0) > 0 || (self.e ?? 0) > 0) ? { s: self.s as number, e: self.e as number } : null;
      const writerCount = pill.writerCount;
      const watcherCount = gs.members.filter((mm) => (mm.s ?? 0) > 0 || (mm.e ?? 0) > 0).length;
      const tier = writerCount >= 2 ? 0 : writerCount === 1 ? 1 : watcherCount >= 2 ? 2 : watcherCount >= 1 ? 3 : 4;
      const row = { pill, name: show?.name ?? gs.showId, opted, selfProg, selfOpted: !!self, selfWrote: !!self?.wrote, tier, lastActivityAt: gs.lastActivityAt };
      (pill.shelf === "watching" ? watching : notStarted).push(row);
    }
    const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);
    const byActivity = (a: Row, b: Row) =>
      (a.tier - b.tier) || ((b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)) || a.name.localeCompare(b.name);
    return { watching: watching.sort(byActivity), notStarted: notStarted.sort(byName) };
  }, [groupShows, showsById, selfUserId, memberNameById]);

  // Blue dot per room — VISIBLE writing only (red layer cut on mobile).
  const roomDotByRoomId = useMemo(() => {
    const s = new Set<string>();
    for (const v of roomVis) if (roomHasNewActivity(v)) s.add(v.groupId);
    return s;
  }, [roomVis]);

  // The quiet line-2 gap text — desktop's hover tooltip copy, inline.
  function gapLine(r: { pill: PillData; opted: { username: string; s: number | null; e: number | null }[]; selfProg: { s: number; e: number } | null }): string | null {
    const seasons = showsById[r.pill.showId]?.seasons;
    const others = r.opted.filter((o) => (o.s ?? 0) > 0 || (o.e ?? 0) > 0);
    if (!others.length) {
      // Mirror the pill's right side: written-but-unwatched shows "s0 e0".
      return r.pill.right.kind === "progress" ? `s${r.pill.right.s} e${r.pill.right.e}` : null;
    }
    // Not opted in (didn't watch, didn't write) → blank, same as the pill face.
    if (!r.selfProg && r.pill.right.kind === "none") return null;
    const selfIdx = linearIndex(r.selfProg?.s ?? 0, r.selfProg?.e ?? 0, seasons);
    const eps = (n: number) => (n === 1 ? "1 episode" : `${n} episodes`);
    if (others.length === 1) {
      const o = others[0];
      const n = selfIdx - linearIndex(o.s ?? 0, o.e ?? 0, seasons);
      if (n === 0) return r.selfProg ? `s${r.selfProg.s} e${r.selfProg.e}` : null;
      return n > 0 ? `You're ${eps(n)} ahead of ${o.username}.` : `You're ${eps(-n)} behind ${o.username}.`;
    }
    const maxOther = Math.max(...others.map((o) => linearIndex(o.s ?? 0, o.e ?? 0, seasons)));
    if (selfIdx < maxOther) return `You're ${eps(maxOther - selfIdx)} behind the furthest watcher.`;
    if (selfIdx > maxOther) return `You're ${eps(selfIdx - maxOther)} ahead of your next friend.`;
    return r.selfProg ? `s${r.selfProg.s} e${r.selfProg.e}` : null;
  }

  // ── Actions (same DB calls as desktop) ─────────────────────────────────────
  function onRowClick(pill: PillData, name: string) {
    if (pill.inRoom) { goToRoom(pill.showId); return; }
    // Group-scoped model (2026-07-06, desktop parity): "yours" means you've
    // engaged with the show IN THIS GROUP — for a proposal (no room yet)
    // that's your yes-vote here; for a roomed show it's your own watching.
    // Your personal pool no longer drives the group click model.
    const gsClicked = groupShows.find((s) => s.showId === pill.showId);
    const selfVoted = !!gsClicked?.members.find((m) => m.userId === selfUserId)?.voted;
    const selfHasShow = pill.shelf === "notStarted" ? selfVoted : pill.selfWatching;
    const mode = selfHasShow ? "solo" : pill.shelf === "notStarted" ? "vote" : "watchq";
    const cur = progress[pill.showId];
    setDeclaredProgress(selfHasShow && cur ? { s: cur.s, e: cur.e } : { s: 0, e: 0 });
    // Haven't-started shows keep the vote toggle in the solo sheet (desktop
    // parity) — toggling to "no" is the per-group un-vote path.
    setClicked({ showId: pill.showId, name, mode, voteToggle: pill.shelf === "notStarted" });
  }

  // Group-scoped voting (2026-07-06, desktop parity): a vote lives in THIS
  // group only.
  //   • yes = propose/join the proposal here. The composer needs a progress
  //     row to work, so quietly ensure a not-started (S0E0) one exists —
  //     created OUT of the personal pool (a proposal lives only in its group).
  //     Existing rows — including ones you'd deliberately removed — are never
  //     touched, and real progress is never reset.
  //   • no = withdraw YOUR yes in THIS group only. No global remove, no other
  //     group affected, and a started room is never affected. The open sheet
  //     collapses back to the bare vote question; the show leaves the
  //     Proposed shelf only if yours was the last yes.
  async function doVote(showId: string, voted: boolean) {
    if (!user) return;
    try {
      await setShowVote(groupId, showId, voted);
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
      await refreshGroup();
    } catch (e) { console.error("[m-group] vote failed", e); }
  }

  async function goToRoom(showId: string) {
    try {
      const { roomId } = await startShowRoom(groupId, showId);
      setClicked(null);
      navigate(`/m/show-room/${roomId}`);
    } catch (e) { console.error("[m-group] start/open room failed", e); }
  }

  async function declareAndGo(showId: string, val: { s: number; e: number }) {
    if (!user) return;
    try {
      const entry: ProgressEntry = { s: val.s, e: val.e, highestS: val.s, highestE: val.e };
      await upsertRewatchStatus(user.id, showId, entry);
      setProgress((prev) => ({ ...prev, [showId]: entry }));
      await goToRoom(showId);
    } catch (e) { console.error("[m-group] declare+start failed", e); }
  }

  async function declareProgressOnly(showId: string, val: { s: number; e: number }) {
    if (!user) return;
    try {
      const entry: ProgressEntry = { s: val.s, e: val.e, highestS: val.s, highestE: val.e };
      await upsertRewatchStatus(user.id, showId, entry);
      setProgress((prev) => ({ ...prev, [showId]: entry }));
      setClicked(null);
      await refreshGroup();
    } catch (e) { console.error("[m-group] log-progress failed", e); }
  }

  // In-group add = PROPOSE the show into THIS group (group-scoped model,
  // 2026-07-06, desktop parity): the vote is the proposal. A not-started pick
  // stays off the personal pool (a proposal lives only in its group); a real
  // progress pick records your global watch position as always.
  async function addShow(show: Show, val: { s: number; e: number }) {
    if (!user) return;
    try {
      await setShowVote(groupId, show.id, true);
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
      await clearMigrationDormantForShow(show.id);
      await refreshGroup();
    } catch (e) {
      console.error("[m-group] propose show failed", e);
    }
    setSearchOpen(false);
  }

  // CP5 restore: re-enter a room you'd left (search → "· rejoin"). Clears the
  // "has left" marker server-side (start_show_room's re-join path).
  async function rejoinRoom(show: Show) {
    try {
      await startShowRoom(groupId, show.id);
      await refreshGroup();
    } catch (e) { console.error("[m-group] rejoin room failed", e); }
    setSearchOpen(false);
  }

  // Search hit on a show you already have a progress row for (in or out of
  // the personal pool): propose it here directly — no picker, your saved
  // progress is left exactly as it is.
  async function proposeExisting(show: Show) {
    if (!user) return;
    try {
      await setShowVote(groupId, show.id, true);
      await clearMigrationDormantForShow(show.id);
      await refreshGroup();
    } catch (e) { console.error("[m-group] propose failed", e); }
    setSearchOpen(false);
  }

  async function doRename() {
    try { await renamePeopleGroup(groupId, renameValue); } catch (e) { console.error("[m-group] rename failed", e); }
    setGearOpen(false);
    setRenameValue("");
    if (user) {
      fetchPeopleGroupsForUser(user.id)
        .then((gs) => setGroup(gs.find((g) => g.id === groupId) ?? null))
        .catch(() => {});
    }
  }

  // CP-C (desktop parity): save the viewer's names for this group's members
  // (phone-contacts rename — overwrites; empty clears back to the handle).
  // Private to the viewer; every surface re-labels instantly via the lookup.
  async function saveContactNames() {
    if (!user || contactsSaving) return;
    setContactsSaving(true);
    try {
      for (const m of members.filter((mm) => mm.userId !== selfUserId)) {
        const next = (contactEdits[m.userId] ?? "").trim();
        const cur = contactNames[m.userId] ?? "";
        if (next !== cur) await setContactName(user.id, m.userId, next);
      }
      setContactNames(await fetchContactNames(user.id));
      setGearOpen(false);
    } catch (e) { console.error("[m-group] contact rename failed", e); }
    finally { setContactsSaving(false); }
  }

  async function doLeave() {
    setGearOpen(false);
    try { await leavePeopleGroup(groupId); } catch (e) { console.error("[m-group] leave failed", e); }
    navigate("/m/dashboard");
  }

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (authLoading) return null;
  if (!user) return <Navigate to="/m" replace />;

  const others = members.filter((m) => m.userId !== selfUserId);
  // Naming arc (2026-07-07, desktop parity): the header's TITLE is the
  // generic/custom label ("Group N" → custom name); the PEOPLE live in the
  // "with…" line as the viewer's given names (handle fallback).
  const names = others.map((m) => personDisplayName(contactNames, m.userId, m.username)).join(", ");
  const groupName = group ? groupGenericName(group, viewerNumber) : "Group";
  const empty = groupShelves.watching.length === 0 && groupShelves.notStarted.length === 0;

  return (
    <div style={page}>
      {/* ── Header: back · group name (+ with members) · gear ── */}
      <div style={topBar}>
        <button style={iconBtn} title="back to dashboard" onClick={() => navigate("/m/dashboard")}>
          <ArrowLeft size={22} color={C.cream} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={headerTitle}>{groupName}</h1>
          {names && (
            <div style={headerMembers}><span style={{ color: C.greyblue }}>with</span> {names}</div>
          )}
        </div>
        <button style={iconBtn} title="group options" onClick={() => {
          setRenameValue(group?.name ?? "");
          // Seed the contact-rename inputs with the viewer's current names.
          const edits: Record<string, string> = {};
          for (const m of others) edits[m.userId] = contactNames[m.userId] ?? "";
          setContactEdits(edits);
          setGearOpen(true);
        }}>
          <Settings size={22} color={C.cream} />
        </button>
      </div>

      {/* ── Shows ↔ chat contextual toggle (group-room level only) ── */}
      <div style={toggleRow}>
        <div style={toggleShell}>
          <button style={{ ...toggleSeg, background: C.cream, color: C.midnight }}>shows</button>
          <button style={{ ...toggleSeg, background: "transparent", color: C.cream, position: "relative" }} onClick={() => navigate(`/m/group/${groupId}/chat`)}>
            <MessageCircle size={16} style={{ marginRight: 6 }} />
            chat
            {chatNew && <span style={chatDot} />}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.cream, fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14 }}>loading<LoadingDots /></div>
      ) : (
        // CP2 four-part group room (desktop parity): SHOW ROOMS shelf →
        // Proposed shelf → "Propose more shows?" → "Add more friends…".
        <div style={contentWrap}>
          {groupShelves.watching.length > 0 && (
            <>
              <h1 style={shelfHeader}>OPEN SHOW ROOMS:</h1>
              <div style={shelfCol}>
                {groupShelves.watching.map((r) => (
                  <ShowRow key={r.pill.showId} row={r} dot={!!r.pill.roomId && roomDotByRoomId.has(r.pill.roomId)} line2={gapLine(r)} onClick={() => onRowClick(r.pill, r.name)} />
                ))}
              </div>
            </>
          )}

          {groupShelves.notStarted.length > 0 && (
            <>
              <h1 style={{ ...shelfHeader, textTransform: "none", marginTop: groupShelves.watching.length ? 40 : 0 }}>
                Proposed shows:
              </h1>
              <div style={shelfCol}>
                {groupShelves.notStarted.map((r) => (
                  <ShowRow key={r.pill.showId} row={r} dot={!!r.pill.roomId && roomDotByRoomId.has(r.pill.roomId)} line2={null} onClick={() => onRowClick(r.pill, r.name)} />
                ))}
              </div>
            </>
          )}

          {empty && (
            <h1 style={{ ...heroH1, textAlign: "center", marginTop: 8, marginBottom: 8 }}>
              What shows are you watching<br />or thinking about starting?
            </h1>
          )}

          {/* The group room's two centered actions, set a little apart from
              the show rows above (desktop CP2 order + copy). */}
          <div style={{ textAlign: "center", marginTop: empty ? 24 : 40 }}>
            <button style={searchPill} onClick={() => setSearchOpen(true)}>Propose more shows?</button>
          </div>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button style={addFriendsPill} onClick={() => setInviteOpen(true)}>Add more friends to this group?</button>
          </div>
        </div>
      )}

      {/* ── Click-model sheet (full-screen; desktop's yellow modal + trailer) ── */}
      {clicked && (() => {
        const gs = groupShows.find((s) => s.showId === clicked.showId);
        // Opted-in = YOUR yes-vote in THIS group (2026-07-06, desktop parity):
        // the toggle reflects the per-group vote row, never the personal pool.
        const optedIn = !!gs?.members.find((m) => m.userId === selfUserId)?.voted;
        const roomLabel = gs?.roomId ? "Open show room?" : "Start a show room?";
        const optedCount = gs?.members.length ?? 0;
        const cur = progress[clicked.showId];
        const curVal = cur ? { s: cur.s, e: cur.e } : { s: 0, e: 0 };
        const seasons = showsById[clicked.showId]?.seasons;
        const liveIdx = linearIndex(declaredProgress.s, declaredProgress.e, seasons);
        const visibleWriters = (gs?.members ?? []).filter((m) =>
          m.userId !== selfUserId && m.wroteEntryMinS != null &&
          linearIndex(m.wroteEntryMinS, m.wroteEntryMinE ?? 0, seasons) <= liveIdx,
        );
        const showRead = !!gs?.roomId && visibleWriters.length >= 1;
        const readName = visibleWriters.length === 1 ? (memberNameById[visibleWriters[0].userId] ?? "someone") : null;
        // Display names, bare (naming arc: no "@" where a given name renders).
        const readText = visibleWriters.length > 1 ? "Read what your friends have written?" : `Read what ${readName} has written?`;
        const interestedNames = (gs?.members ?? [])
          .filter((m) => m.userId !== selfUserId)
          .map((m) => memberNameById[m.userId] ?? "someone");
        return (
          <div style={{ ...sheet, background: C.yellow }}>
            <button style={sheetClose} onClick={() => setClicked(null)}><X size={20} color={C.cream} /></button>
            <div style={sheetInner}>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 26, color: C.cream, textAlign: "center", marginBottom: 20 }}>
                {clicked.name}
              </div>

              {/* Not-started shows — solo-with-toggle and vote mode share ONE
                  shape (2026-07-03, desktop parity): the vote question leads
                  (with the inline "also interested" line), and the progress +
                  room sections render only once the toggle is "yes". A first
                  tap on a friend's show reads as pure discovery (question +
                  trailer); in the yes state progress / room / trailer are all
                  active. Watching-shelf solo (no toggle) keeps the full
                  content unconditionally. */}
              {(clicked.mode === "solo" || clicked.mode === "vote") && (() => {
                const withToggle = clicked.mode === "vote" || !!clicked.voteToggle;
                return (
                  <>
                    {withToggle && (
                      <>
                        <div style={sheetTitle}>Do you want to watch <b>{clicked.name}</b>?</div>
                        {interestedNames.length > 0 && (
                          // Desktop's hover tooltip on "haven't started" pills, inline.
                          <div style={{ marginTop: 10, color: C.cream, fontSize: 13, fontWeight: 600, textAlign: "center", opacity: 0.9 }}>
                            {interestedLine(interestedNames, clicked.name, optedIn)}
                          </div>
                        )}
                        <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                          <YesNoToggle value={optedIn} onChange={(v) => doVote(clicked.showId, v)} />
                        </div>
                      </>
                    )}
                    {(!withToggle || optedIn) && (
                      <>
                        {withToggle && <div style={sheetDivider} />}
                        <div style={sheetTitle}>{curVal.s === 0 && curVal.e === 0 ? "Have you started watching?" : "Have you watched more?"}</div>
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
                        <div style={sheetDivider} />
                        <div style={{ ...sheetTitle, fontSize: 13 }}>{showRead ? readText : gs?.roomId ? "Open show room?" : optedCount > 1 ? "Start a show room?" : (
                          <>Start a show room?<br />Your friends can join in when they&rsquo;re ready.</>
                        )}</div>
                        <div style={sheetBtnRow}>
                          <button style={startBtn} onClick={() => declareAndGo(clicked.showId, declaredProgress)}>{showRead ? "Read" : "Yes"}</button>
                          <button style={outlineBtn} onClick={() => declareProgressOnly(clicked.showId, declaredProgress)}>just confirm my progress</button>
                        </div>
                      </>
                    )}
                  </>
                );
              })()}

              {clicked.mode === "watchq" && (
                <>
                  <div style={sheetTitle}>Are you also watching <b>{clicked.name}</b>?</div>
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
                  <div style={sheetDivider} />
                  <div style={{ ...sheetTitle, fontSize: 13 }}>{showRead ? readText : roomLabel}</div>
                  <div style={sheetBtnRow}>
                    <button style={startBtn} onClick={() => declareAndGo(clicked.showId, declaredProgress)}>{showRead ? "Read" : "Yes"}</button>
                    <button style={outlineBtn} onClick={() => declareProgressOnly(clicked.showId, declaredProgress)}>just confirm my progress</button>
                  </div>
                </>
              )}

              {/* Launch trailer — only for a not-started viewer (gate on the
                  PERSISTED progress, never the live dropdown, so a dropdown
                  change can't tear out a playing trailer). Stacks BELOW the
                  actions, same vertical order as desktop. Renders nothing on
                  a miss. */}
              {curVal.s === 0 && curVal.e === 0 && (
                <div style={{ marginTop: 20, display: "flex", justifyContent: "center" }}>
                  <TrailerCard showId={clicked.showId} tvmazeId={showsById[clicked.showId]?.tvmazeId} />
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Gear: rename + leave (bottom sheet; desktop copy) ── */}
      {gearOpen && (
        <div style={dim} onClick={(e) => { if (e.target === e.currentTarget) setGearOpen(false); }}>
          <div style={{ ...bottomSheet, background: C.yellow, maxHeight: "80dvh", overflowY: "auto" }}>
            {/* Bottom-sheet rule (Alborz 2026-07-03): bottom-of-screen panels
                LEFT-justify their elements; full-screen panels center. */}
            {/* CP-C: the contacts card comes FIRST (desktop round-2 order +
                copy) — the viewer's own names for the people here. */}
            {others.length > 0 && (
              <>
                <div style={{ ...sheetTitle, textAlign: "left", marginBottom: 4 }}>Update your contact list:</div>
                <div style={{ color: C.cream, fontSize: 11, opacity: 0.85, marginBottom: 12, lineHeight: 1.5 }}>
                  Your friends&rsquo; names default to their log-in info. You can enter your own names for them &mdash; just like you would on your phone&rsquo;s contacts.
                </div>
                {others.map((m) => (
                  <input
                    key={m.userId}
                    value={contactEdits[m.userId] ?? ""}
                    onChange={(e) => setContactEdits((prev) => ({ ...prev, [m.userId]: e.target.value }))}
                    placeholder={m.username}
                    maxLength={40}
                    style={{ ...renameInput, marginBottom: 8 }}
                    className="m-input"
                  />
                ))}
                <button style={{ ...startBtn, marginTop: 4, opacity: contactsSaving ? 0.6 : 1 }} disabled={contactsSaving} onClick={saveContactNames}>
                  {contactsSaving ? "saving…" : "save names"}
                </button>
                <div style={sheetDivider} />
              </>
            )}
            <div style={{ ...sheetTitle, textAlign: "left", marginBottom: 12 }}>Rename group:</div>
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="group name" style={renameInput} className="m-input" />
            <button style={{ ...startBtn, marginTop: 12 }} onClick={doRename}>confirm name</button>
            <div style={sheetDivider} />
            <div style={{ ...sheetTitle, textAlign: "left", marginBottom: 12 }}>Leave this group?</div>
            <button style={dangerBtn} onClick={doLeave}>yes, leave</button>
            <div style={{ color: C.cream, fontSize: 12, opacity: 0.9, marginTop: 14 }}>You can join again if someone sends you another invite.</div>
          </div>
        </div>
      )}

      {/* ── Invite compose (full-screen; targets THIS group) ── */}
      {inviteOpen && (
        <MobileInviteSheet
          targetGroupId={groupId}
          onClose={() => setInviteOpen(false)}
          onSent={() => {
            // Refresh the member list so pending invites reflect on return.
            fetchPeopleGroupMembers(groupId).then(setMembers).catch(() => {});
          }}
        />
      )}

      {/* ── Search (shared full-screen sheet; group context = PROPOSE) ── */}
      {searchOpen && (
        <MobileSearchSheet
          shows={shows}
          progress={progress}
          groupContext={{
            // A left room is findable again as "· rejoin" (CP5); everything
            // else already surfaced here reads "already in this group".
            groupShowIds: new Set(groupShows.filter((gs) => !(gs.roomId && gs.viewerLeft && !gs.inRoom)).map((gs) => gs.showId)),
            rejoinShowIds: new Set(groupShows.filter((gs) => !!gs.roomId && gs.viewerLeft && !gs.inRoom).map((gs) => gs.showId)),
            onProposeExisting: proposeExisting,
            onRejoin: rejoinRoom,
          }}
          onClose={() => setSearchOpen(false)}
          onAdd={addShow}
          onCatalogAdd={(show) => setShows((prev) => (prev.some((s) => s.id === show.id) ? prev : [...prev, show]))}
        />
      )}
    </div>
  );
}

// ── Show row (full-width, two-line, opt-in avatars right) ───────────────────
function ShowRow({ row, dot, line2, onClick }: {
  row: { pill: PillData; name: string; opted: { username: string; s: number | null; e: number | null; wrote: boolean; resolved: boolean }[] };
  dot: boolean;
  line2: string | null;
  onClick: () => void;
}) {
  const pill = row.pill;
  const isSelfWatching = pill.selfWatching;
  const isGreen = pill.fill === "green";
  const isCream = pill.fill === "cream";
  const bg = isSelfWatching || isGreen ? C.green : isCream ? C.cream : "transparent";
  const border = isSelfWatching ? `2px solid ${C.green}` : (isCream || isGreen ? "2px solid transparent" : `2px solid ${C.cream}`);
  const fg = isSelfWatching || isGreen ? CANON.cream : isCream ? C.green : CANON.cream;
  return (
    <button onClick={onClick} style={{ ...rowBase, background: bg, border, color: fg }}>
      {dot && <span style={rowDot} />}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {row.name}
        </span>
        {line2 && (
          <span style={{ fontWeight: 500, fontSize: 12, opacity: 0.9 }}>{line2}</span>
        )}
      </span>
      {row.opted.length > 0 && (
        <span style={{ display: "inline-flex", flexShrink: 0 }}>
          {row.opted.map((m, i) => (
            <span key={`${m.username}-${i}`} style={optInAvatar}>
              {m.resolved ? (m.username[0] ?? "?").toUpperCase() : ""}
              {m.wrote && (
                <span style={writerPencilBadge}>
                  <Pencil size={13} color={C.cream} fill={C.sky} strokeWidth={2} />
                </span>
              )}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

// ── Styles (canon tokens; sky group-context; 44px targets; 100dvh) ──────────
const page: React.CSSProperties = {
  minHeight: "100dvh",
  boxSizing: "border-box",
  background: C.sky,
  fontFamily: '"Inter", system-ui, sans-serif',
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
};
const topBar: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "calc(env(safe-area-inset-top, 0px) + 12px) 12px 8px",
};
const iconBtn: React.CSSProperties = {
  width: 44, height: 44, flexShrink: 0, border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const headerTitle: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 22, letterSpacing: 0, color: C.cream,
  margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};
const headerMembers: React.CSSProperties = {
  fontWeight: 700, fontSize: 12, color: C.cream, marginTop: 2,
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};
const toggleRow: React.CSSProperties = { display: "flex", justifyContent: "center", padding: "8px 16px 16px" };
const toggleShell: React.CSSProperties = {
  display: "inline-flex", borderRadius: 65, border: `2px solid ${C.cream}`, overflow: "hidden",
};
const toggleSeg: React.CSSProperties = {
  border: "none", cursor: "pointer", padding: "10px 24px", minHeight: 44,
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 13,
  display: "inline-flex", alignItems: "center",
};
const chatDot: React.CSSProperties = {
  position: "absolute", top: 6, right: 8, width: 10, height: 10, borderRadius: "50%", background: C.blue,
};
const contentWrap: React.CSSProperties = { padding: "8px 16px 40px" };
const shelfHeader: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 24, letterSpacing: 0, color: C.cream,
  textAlign: "center", textTransform: "uppercase", margin: "0 0 16px",
};
const heroH1: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 28, lineHeight: 1.2, letterSpacing: 0, color: C.cream, margin: 0,
};
const shelfCol: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const rowBase: React.CSSProperties = {
  position: "relative",
  display: "flex", alignItems: "center", gap: 12,
  width: "100%", minHeight: 64, padding: "12px 18px", boxSizing: "border-box",
  borderRadius: 20, cursor: "pointer", textAlign: "left",
  fontFamily: '"Inter", sans-serif',
};
const rowDot: React.CSSProperties = {
  position: "absolute", top: -6, left: 6, width: 16, height: 16, borderRadius: "50%",
  background: C.blue, zIndex: 2,
};
const optInAvatar: React.CSSProperties = {
  position: "relative",
  width: 30, height: 30, borderRadius: "50%", border: `2px solid ${C.cream}`, background: C.sky,
  color: C.blue, fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  marginLeft: -4, // slight overlap; enough spread that pen badges don't crowd
};
const writerPencilBadge: React.CSSProperties = {
  position: "absolute", top: -5, right: -5, display: "inline-flex",
  alignItems: "center", justifyContent: "center",
};
const searchPill: React.CSSProperties = {
  border: "none", background: C.yellow, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "16px 56px", borderRadius: 65, cursor: "pointer", minHeight: 48,
};
// Desktop parity: group context = cream fill, green text, no drop-shadow.
const addFriendsPill: React.CSSProperties = {
  border: "none", background: C.cream, color: C.green, fontWeight: 700, fontSize: 14,
  padding: "14px 32px", borderRadius: 65, cursor: "pointer", minHeight: 48,
};
const sheet: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  paddingTop: "calc(env(safe-area-inset-top, 0px) + 64px)",
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
  boxSizing: "border-box",
};
const sheetClose: React.CSSProperties = {
  position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: 12,
  width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center", zIndex: 1001,
};
const sheetInner: React.CSSProperties = { maxWidth: 420, margin: "0 auto", padding: "0 20px" };
const sheetTitle: React.CSSProperties = {
  color: C.cream, fontSize: 15, fontWeight: 600, letterSpacing: -0.5, textAlign: "center",
};
const sheetDivider: React.CSSProperties = { height: 1, background: "rgba(253,248,236,0.5)", margin: "24px 0 16px" };
const sheetBtnRow: React.CSSProperties = {
  display: "flex", gap: 12, justifyContent: "center", alignItems: "center", marginTop: 12, flexWrap: "wrap",
};
const startBtn: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "11px 38px", borderRadius: 65, cursor: "pointer", minHeight: 44,
};
const outlineBtn: React.CSSProperties = {
  ...startBtn, padding: "11px 24px", whiteSpace: "nowrap", background: "transparent",
  color: C.cream, border: `2px solid ${C.cream}`,
};
const dangerBtn: React.CSSProperties = {
  border: `2px solid ${C.red}`, background: "transparent", color: C.red, fontWeight: 700, fontSize: 14,
  padding: "10px 32px", borderRadius: 65, cursor: "pointer", minHeight: 44,
};
const renameInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "none", borderRadius: 65,
  padding: "14px 24px", fontFamily: '"Inter", sans-serif', fontSize: 16, color: C.midnight,
  background: C.cream, outline: "none",
};
const dim: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, background: "rgba(26,58,74,0.35)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
};
const bottomSheet: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: C.sky,
  borderTopLeftRadius: 24, borderTopRightRadius: 24,
  padding: "26px 24px calc(env(safe-area-inset-bottom, 0px) + 26px)",
};
