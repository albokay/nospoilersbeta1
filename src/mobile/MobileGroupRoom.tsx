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
import {
  fetchShows,
  refreshStaleShows,
  fetchProgress,
  upsertRewatchStatus,
  fetchPeopleGroupsForUser,
  fetchPeopleGroupMembers,
  fetchGroupDashboard,
  setShowVote,
  startShowRoom,
  leavePeopleGroup,
  renamePeopleGroup,
  fetchOutOfPoolShows,
  restoreShowToPool,
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

/** Custom name if set, else a stable generic "Group <seq>". (Same rule as desktop.) */
function groupAutoName(group: PeopleGroup | null, others: PeopleGroupMember[]): string {
  if (group?.name) return group.name;
  if (group?.seq != null) return `Group ${group.seq}`;
  if (!others.length) return "Group";
  return others.map((m) => m.username).sort((a, b) => a.localeCompare(b)).join(", ");
}

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
  const [members, setMembers] = useState<PeopleGroupMember[]>([]);
  const [groupShows, setGroupShows] = useState<GroupDashboardShow[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [outOfPool, setOutOfPool] = useState<Set<string>>(new Set());
  const [roomVis, setRoomVis] = useState<RoomVisibility[]>([]);
  const [chatNew, setChatNew] = useState(false);
  const [loading, setLoading] = useState(true);

  // Sheets
  const [clicked, setClicked] = useState<{ showId: string; name: string; mode: "solo" | "vote" | "watchq" } | null>(null);
  const [declaredProgress, setDeclaredProgress] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  // ── Loads (same calls as desktop's group context) ─────────────────────────
  const refreshGroup = useCallback(async () => {
    try {
      const rows = await fetchGroupDashboard(groupId);
      setGroupShows(rows);
      // Keep this group's shows' episode lists fresh (12h cadence; non-blocking).
      const ids = new Set(rows.map((r) => r.showId));
      const catalog = await fetchShows();
      refreshStaleShows(catalog.filter((s) => ids.has(s.id))).then((upd) => {
        if (!upd.length) return;
        setShows((prev) => prev.map((s) => upd.find((u) => u.id === s.id) ?? s));
      }).catch(() => {});
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
      await refreshGroup();
      if (!cancelled) setLoading(false);
      // Group meta + activity — concurrent, independently tolerant.
      fetchPeopleGroupsForUser(user.id)
        .then((gs) => { if (!cancelled) setGroup(gs.find((g) => g.id === groupId) ?? null); })
        .catch(() => {});
      fetchPeopleGroupMembers(groupId)
        .then((ms) => { if (!cancelled) setMembers(ms); })
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

  const memberNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mem of members) m[mem.userId] = mem.username;
    return m;
  }, [members]);

  // ── Shelves — identical pill computation + ordering to desktop ────────────
  const groupShelves = useMemo(() => {
    type OptIn = { username: string; s: number | null; e: number | null; wrote: boolean };
    type Row = { pill: PillData; name: string; opted: OptIn[]; selfProg: { s: number; e: number } | null; selfOpted: boolean; selfWrote: boolean; tier: number; lastActivityAt: number | null };
    const watching: Row[] = [];
    const notStarted: Row[] = [];
    for (const gs of groupShows) {
      const show = showsById[gs.showId];
      const pill = computePill(gs, show?.seasons, selfUserId);
      const opted: OptIn[] = gs.members
        .filter((mm) => mm.userId !== selfUserId)
        .map((mm) => ({ username: memberNameById[mm.userId] ?? "someone", s: mm.s, e: mm.e, wrote: !!mm.wrote }));
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
    const selfHasShow = !!progress[pill.showId];
    const mode = selfHasShow ? "solo" : pill.shelf === "notStarted" ? "vote" : "watchq";
    const cur = progress[pill.showId];
    setDeclaredProgress(cur ? { s: cur.s, e: cur.e } : { s: 0, e: 0 });
    setClicked({ showId: pill.showId, name, mode });
  }

  async function doVote(showId: string, voted: boolean) {
    if (!user) return;
    try {
      await setShowVote(groupId, showId, voted);
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

  async function addShow(show: Show, val: { s: number; e: number }) {
    if (!user) return;
    const entry: ProgressEntry = { s: val.s, e: val.e, highestS: val.s, highestE: val.e };
    try {
      await upsertRewatchStatus(user.id, show.id, entry);
      setProgress((prev) => ({ ...prev, [show.id]: entry }));
      await clearMigrationDormantForShow(show.id);
      await refreshGroup();
    } catch (e) {
      console.error("[m-group] add show failed", e);
    }
    setSearchOpen(false);
  }

  async function restoreShow(show: Show) {
    if (!user) return;
    try {
      await restoreShowToPool(user.id, show.id);
      setOutOfPool((prev) => { const n = new Set(prev); n.delete(show.id); return n; });
      await clearMigrationDormantForShow(show.id);
      await refreshGroup();
    } catch (e) { console.error("[m-group] restore show failed", e); }
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

  async function doLeave() {
    setGearOpen(false);
    try { await leavePeopleGroup(groupId); } catch (e) { console.error("[m-group] leave failed", e); }
    navigate("/m/dashboard");
  }

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (authLoading) return null;
  if (!user) return <Navigate to="/m" replace />;

  const others = members.filter((m) => m.userId !== selfUserId);
  const names = others.map((m) => m.username).join(", ");
  const groupName = groupAutoName(group, others);
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
        <button style={iconBtn} title="group options" onClick={() => { setRenameValue(group?.name ?? ""); setGearOpen(true); }}>
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
        <div style={{ textAlign: "center", padding: 48, color: C.cream }}><LoadingDots /></div>
      ) : (
        <div style={contentWrap}>
          {groupShelves.watching.length > 0 && (
            <>
              <h1 style={shelfHeader}>CURRENTLY WATCHING:</h1>
              <div style={shelfCol}>
                {groupShelves.watching.map((r) => (
                  <ShowRow key={r.pill.showId} row={r} dot={!!r.pill.roomId && roomDotByRoomId.has(r.pill.roomId)} line2={gapLine(r)} onClick={() => onRowClick(r.pill, r.name)} />
                ))}
              </div>
            </>
          )}

          {groupShelves.notStarted.length > 0 && (
            <h1 style={{ ...shelfHeader, textTransform: "none", marginTop: groupShelves.watching.length ? 40 : 0 }}>
              Haven&rsquo;t started yet:
            </h1>
          )}
          {empty && (
            <h1 style={{ ...heroH1, textAlign: "center", marginTop: 8, marginBottom: 8 }}>
              What shows are you watching<br />or thinking about starting?
            </h1>
          )}
          <div style={{ textAlign: "center", marginBottom: 24, marginTop: groupShelves.notStarted.length === 0 && groupShelves.watching.length ? 40 : 0 }}>
            <button style={searchPill} onClick={() => setSearchOpen(true)}>SEARCH</button>
          </div>
          {groupShelves.notStarted.length > 0 && (
            <div style={shelfCol}>
              {groupShelves.notStarted.map((r) => (
                <ShowRow key={r.pill.showId} row={r} dot={!!r.pill.roomId && roomDotByRoomId.has(r.pill.roomId)} line2={null} onClick={() => onRowClick(r.pill, r.name)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Click-model sheet (full-screen; desktop's yellow modal + trailer) ── */}
      {clicked && (() => {
        const gs = groupShows.find((s) => s.showId === clicked.showId);
        const selfVoted = !!gs?.members.find((m) => m.userId === selfUserId)?.voted;
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
        const readText = visibleWriters.length > 1 ? "Read what your friends have written?" : `Read what @${readName} has written?`;
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

              {clicked.mode === "solo" && (
                <>
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

              {clicked.mode === "vote" && (
                <>
                  <div style={sheetTitle}>Do you want to watch <b>{clicked.name}</b>?</div>
                  {interestedNames.length > 0 && (
                    // Desktop's hover tooltip on "haven't started" pills, inline.
                    <div style={{ marginTop: 10, color: C.cream, fontSize: 13, fontWeight: 600, textAlign: "center", opacity: 0.9 }}>
                      {interestedLine(interestedNames, clicked.name, selfVoted)}
                    </div>
                  )}
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                    <YesNoToggle value={selfVoted} onChange={(v) => doVote(clicked.showId, v)} />
                  </div>
                  {selfVoted && (
                    <>
                      <div style={sheetDivider} />
                      <div style={{ ...sheetTitle, fontSize: 13 }}>{roomLabel}</div>
                      <div style={sheetBtnRow}>
                        <button style={startBtn} onClick={() => goToRoom(clicked.showId)}>Yes</button>
                        <button style={outlineBtn} onClick={() => setClicked(null)}>not yet</button>
                      </div>
                    </>
                  )}
                </>
              )}

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
          <div style={{ ...bottomSheet, background: C.yellow }}>
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

      {/* ── Search (shared full-screen sheet) ── */}
      {searchOpen && (
        <MobileSearchSheet
          shows={shows}
          progress={progress}
          outOfPool={outOfPool}
          onClose={() => setSearchOpen(false)}
          onAdd={addShow}
          onRestore={restoreShow}
          onCatalogAdd={(show) => setShows((prev) => (prev.some((s) => s.id === show.id) ? prev : [...prev, show]))}
        />
      )}
    </div>
  );
}

// ── Show row (full-width, two-line, opt-in avatars right) ───────────────────
function ShowRow({ row, dot, line2, onClick }: {
  row: { pill: PillData; name: string; opted: { username: string; s: number | null; e: number | null; wrote: boolean }[] };
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
              {(m.username[0] ?? "?").toUpperCase()}
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
  marginLeft: -6,
};
const writerPencilBadge: React.CSSProperties = {
  position: "absolute", top: -5, right: -5, display: "inline-flex",
  alignItems: "center", justifyContent: "center",
};
const searchPill: React.CSSProperties = {
  border: "none", background: C.yellow, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "16px 56px", borderRadius: 65, cursor: "pointer", minHeight: 48,
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
