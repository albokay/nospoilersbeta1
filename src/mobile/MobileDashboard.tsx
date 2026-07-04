import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { X, LogOut, UserCog, MessageCircleWarning } from "lucide-react";
import { CANON } from "../styles/canon";
import { useAuth } from "../lib/auth";
import AccountModal from "../components/AccountModal";
import MobileFeedbackSheet from "./MobileFeedbackSheet";
import SidebarLogo from "../components/SidebarLogo";
import OneSelectProgress from "../components/OneSelectProgress";
import LoadingDots from "../components/LoadingDots";
import MobileSearchSheet from "./MobileSearchSheet";
import MobileInviteSheet from "./MobileInviteSheet";
import {
  fetchShows,
  refreshStaleShows,
  fetchProgress,
  upsertRewatchStatus,
  fetchPeopleGroupsForUser,
  fetchPeopleGroupMembers,
  fetchGroupPendingInvites,
  fetchMyPendingGroupInvites,
  acceptPeopleGroupInvite,
  declinePeopleGroupInvite,
  fetchOutOfPoolShows,
  removeShowFromPool,
  restoreShowToPool,
  clearMigrationDormantForShow,
  fetchRoomActivityVisibility,
  roomHasNewActivity,
  fetchGroupChatActivity,
  chatHasNewActivity,
  type Show,
  type PendingGroupInvite,
  type RoomVisibility,
  type GroupChatActivity,
} from "../lib/db";
import type { ProgressEntry, PeopleGroup, PeopleGroupMember } from "../types";

/**
 * MobileDashboard (CP3) — the signed-in home of the /m rebuild.
 *
 * Mobile re-expression of the PERSONAL (green) context of the desktop
 * DashboardPage — same data calls, same copy, laid out as one column per
 * the mobile rebuild spec:
 *
 *   • Groups first (social is the priority): full-width rows with the member
 *     avatar cluster + TWO activity indicators — a new-WRITING dot and a
 *     new-CHAT dot (desktop merges these into one cluster dot; mobile shows
 *     them separately per spec). VISIBLE-writing only — the desktop red
 *     "invisible writing" dot layer is cut on mobile.
 *   • Pending group invites render as rows too; tapping opens the join
 *     sheet (the desktop hover tooltip copy moves inline — no hover here).
 *   • Then search + the personal show shelves (S/E labels, no social layer,
 *     no trailers — those are group-room affordances).
 *   • Tapping a show opens a FULL-SCREEN sheet (desktop: centered yellow
 *     modal) carrying the same control set: progress picker, write-by-
 *     yourself, remove-from-pool (desktop's hover ×  becomes a visible
 *     button — no hover on mobile).
 *
 * Deferred to later checkpoints (deliberate, not dropped): sending invites /
 * creating a group (CP7), the account modal (CP8), TSP onboarding demo
 * (decision parked). Group rows navigate to /m/group/:id (CP4 stub for now);
 * write-by-yourself navigates to /m/show-room/private/:id (CP6 stub).
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
};

type RailGroup = { group: PeopleGroup; members: PeopleGroupMember[]; pendingHandles: string[] };

// Last-render snapshot for instant paint (stale-while-revalidate): the
// dashboard renders this immediately on open while the live fetches run,
// so cold opens / back-swipes don't flash a bare page. Pooled shows only
// (search re-fetches the full catalog by the time it opens).
const SNAP_KEY = (uid: string) => `ns_m_dash_snap_${uid}`;

/** Custom name if set, else a stable generic "Group <seq>". (Same rule as desktop.) */
function groupAutoName(group: PeopleGroup, others: PeopleGroupMember[]): string {
  if (group.name) return group.name;
  if (group.seq != null) return `Group ${group.seq}`;
  if (!others.length) return "Group";
  return others.map((m) => m.username).sort((a, b) => a.localeCompare(b)).join(", ");
}

/** Format a pending invite's members as "@X and @Y" for the join prompt. */
function inviteNames(inv: PendingGroupInvite): string {
  const ns = (inv.memberNames.length ? inv.memberNames : [inv.inviterName]).map((n) => `@${n}`);
  if (ns.length === 1) return ns[0];
  if (ns.length === 2) return `${ns[0]} and ${ns[1]}`;
  return `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}

export default function MobileDashboard() {
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const selfUserId = user?.id ?? "";

  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [outOfPool, setOutOfPool] = useState<Set<string>>(new Set());
  const [railGroups, setRailGroups] = useState<RailGroup[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingGroupInvite[]>([]);
  const [roomVis, setRoomVis] = useState<RoomVisibility[]>([]);
  const [chatActivity, setChatActivity] = useState<GroupChatActivity[]>([]);
  const [loading, setLoading] = useState(true);

  // Sheets
  const [showSheet, setShowSheet] = useState<{ showId: string; name: string; mode: "watching" | "notStarted" } | null>(null);
  const [declaredProgress, setDeclaredProgress] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; name: string } | null>(null);
  const [invitePrompt, setInvitePrompt] = useState<PendingGroupInvite | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // ── Loads (same calls + tolerance as desktop DashboardPage) ──────────────
  const loadRail = useCallback(async (uid: string): Promise<RailGroup[]> => {
    try {
      const groups = await fetchPeopleGroupsForUser(uid);
      return await Promise.all(
        groups.map(async (g) => ({
          group: g,
          members: await fetchPeopleGroupMembers(g.id),
          pendingHandles: await fetchGroupPendingInvites(g.id),
        }))
      );
    } catch (e) {
      console.warn("[m-dashboard] people-groups not loaded", e);
      return [];
    }
  }, []);

  // One-time-per-mount snapshot hydration guard.
  const hydratedRef = React.useRef(false);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    // Instant paint: hydrate from the last visit's snapshot (if any) before
    // the live fetches — the page renders real content immediately and the
    // fresh data replaces it when it lands. Display-only staleness; every
    // write path still goes through the live DB calls.
    let snapshotUsed = false;
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      try {
        const raw = sessionStorage.getItem(SNAP_KEY(user.id));
        if (raw) {
          const s = JSON.parse(raw);
          setShows(s.shows ?? []);
          setProgress(s.progress ?? {});
          setOutOfPool(new Set(s.outOfPool ?? []));
          setRailGroups(s.railGroups ?? []);
          setPendingInvites(s.pendingInvites ?? []);
          setLoading(false);
          snapshotUsed = true;
        }
      } catch { /* corrupt/absent snapshot → normal load */ }
    }
    (async () => {
      if (!snapshotUsed) setLoading(true);
      let pooled: Show[] = [];
      try {
        const [showRows, prog, oop] = await Promise.all([
          fetchShows(), fetchProgress(user.id), fetchOutOfPoolShows(user.id),
        ]);
        if (cancelled) return;
        setShows(showRows);
        setProgress(prog);
        setOutOfPool(oop);
        pooled = showRows.filter((s) => prog[s.id]);
      } catch (e) {
        console.error("[m-dashboard] core load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Keep pooled shows' episode lists current (12h cadence; non-blocking).
      refreshStaleShows(pooled).then((upd) => {
        if (cancelled || !upd.length) return;
        setShows((prev) => prev.map((s) => upd.find((u) => u.id === s.id) ?? s));
      }).catch(() => {});
      // Secondary data — concurrent, independently tolerant (desktop parity).
      loadRail(user.id)
        .then((rail) => { if (!cancelled) setRailGroups(rail); })
        .catch((e) => console.warn("[m-dashboard] rail not loaded", e));
      fetchMyPendingGroupInvites()
        .then((inv) => { if (!cancelled) setPendingInvites(inv); })
        .catch((e) => console.warn("[m-dashboard] pending invites not loaded", e));
      Promise.all([
        fetchRoomActivityVisibility(user.id, true),
        fetchGroupChatActivity(user.id),
      ])
        .then(([rv, ca]) => { if (!cancelled) { setRoomVis(rv); setChatActivity(ca); } })
        .catch((e) => console.warn("[m-dashboard] activity dots not loaded", e));
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, loadRail]);

  // Keep the instant-paint snapshot current (pooled shows only — the full
  // catalog is large and search re-fetches it live anyway).
  useEffect(() => {
    if (loading || !user) return;
    try {
      sessionStorage.setItem(SNAP_KEY(user.id), JSON.stringify({
        shows: shows.filter((s) => progress[s.id]),
        progress,
        outOfPool: Array.from(outOfPool),
        railGroups,
        pendingInvites,
      }));
    } catch { /* quota/private mode — instant paint just won't happen */ }
  }, [loading, user, shows, progress, outOfPool, railGroups, pendingInvites]);

  const showsById = useMemo(() => {
    const m: Record<string, Show> = {};
    for (const s of shows) m[s.id] = s;
    return m;
  }, [shows]);

  // ── Shelves (same split + sort as desktop) ────────────────────────────────
  const { watching, notStarted } = useMemo(() => {
    const watching: { show: Show; entry: ProgressEntry }[] = [];
    const notStarted: { show: Show; entry: ProgressEntry }[] = [];
    for (const [showId, entry] of Object.entries(progress)) {
      const show = showsById[showId];
      if (!show) continue;
      if (outOfPool.has(showId)) continue;
      const started = (entry.s ?? 0) > 0 || (entry.e ?? 0) > 0;
      (started ? watching : notStarted).push({ show, entry });
    }
    const byRecent = (a: { show: Show; entry: ProgressEntry }, b: { show: Show; entry: ProgressEntry }) =>
      ((b.entry.progressUpdatedAt ?? 0) - (a.entry.progressUpdatedAt ?? 0)) || a.show.name.localeCompare(b.show.name);
    return { watching: watching.sort(byRecent), notStarted: notStarted.sort(byRecent) };
  }, [progress, showsById, outOfPool]);

  const hasAnyShows = watching.length + notStarted.length > 0;

  // ── Per-group activity indicators — VISIBLE writing only (spec cut: no red
  //    invisible-writing layer on mobile). Two separate dots per spec. ───────
  const writingNewByGroup = useMemo(() => {
    const s = new Set<string>();
    for (const v of roomVis) {
      if (v.parentGroupId && roomHasNewActivity(v)) s.add(v.parentGroupId);
    }
    return s;
  }, [roomVis]);
  const chatNewByGroup = useMemo(() => {
    const s = new Set<string>();
    for (const a of chatActivity) if (chatHasNewActivity(a)) s.add(a.groupId);
    return s;
  }, [chatActivity]);

  // ── Actions (same DB calls as desktop; search UI lives in MobileSearchSheet) ──
  function openSearch() { setSearchOpen(true); }
  function closeSearch() { setSearchOpen(false); }

  async function addShow(show: Show, val: { s: number; e: number }) {
    if (!user) return;
    const entry: ProgressEntry = { s: val.s, e: val.e, highestS: val.s, highestE: val.e };
    try {
      await upsertRewatchStatus(user.id, show.id, entry);
      setProgress((prev) => ({ ...prev, [show.id]: entry }));
      await clearMigrationDormantForShow(show.id);
      setRailGroups(await loadRail(user.id));
    } catch (e) {
      console.error("[m-dashboard] add show failed", e);
    }
    closeSearch();
  }

  async function restoreShow(show: Show) {
    if (!user) return;
    try {
      await restoreShowToPool(user.id, show.id);
      setOutOfPool((prev) => { const n = new Set(prev); n.delete(show.id); return n; });
      await clearMigrationDormantForShow(show.id);
      setRailGroups(await loadRail(user.id));
    } catch (e) { console.error("[m-dashboard] restore show failed", e); }
    closeSearch();
  }

  async function doRemoveFromPool(showId: string) {
    setRemoveConfirm(null);
    setShowSheet(null);
    try {
      await removeShowFromPool(showId);
      setOutOfPool((prev) => new Set(prev).add(showId));
    } catch (e) { console.error("[m-dashboard] remove from pool failed", e); }
  }

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
    } catch (e) { console.error("[m-dashboard] personal log-progress failed", e); }
  }

  async function refreshRailAndInvites() {
    if (!user) return;
    try { setRailGroups(await loadRail(user.id)); } catch { /* tolerant */ }
    try { setPendingInvites(await fetchMyPendingGroupInvites()); } catch { /* tolerant */ }
  }

  async function acceptInvite(inv: PendingGroupInvite) {
    const res = await acceptPeopleGroupInvite(inv.token);
    if (res.ok) {
      setInvitePrompt(null);
      setAcceptError(null);
      await refreshRailAndInvites();
      navigate(`/m/group/${inv.groupId}`);
      return;
    }
    console.error("[m-dashboard] accept invite failed", res.error);
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

  async function declineInvite(inv: PendingGroupInvite) {
    setInvitePrompt(null);
    setPendingInvites((prev) => prev.filter((p) => p.token !== inv.token));
    await declinePeopleGroupInvite(inv.token);
    await refreshRailAndInvites();
  }

  // ── Guards ─────────────────────────────────────────────────────────────────
  // While the session restores, paint the page chrome instead of a blank
  // screen (the blank was the "feels broken" moment on cold opens).
  if (authLoading) {
    return (
      <div style={page}>
        <div style={topBar}>
          <SidebarLogo scale={0.5} blocksOpacity={1} bg="green" />
        </div>
        <div style={{ textAlign: "center", padding: 48, color: C.cream }}><LoadingDots /></div>
      </div>
    );
  }
  if (!user) return <Navigate to="/m" replace />;

  return (
    <div style={page}>
      {/* ── Top bar: logo (home) · sign-out ── */}
      <div style={topBar}>
        <div onClick={() => navigate("/m/dashboard")} role="button" aria-label="Home" style={{ cursor: "pointer" }}>
          <SidebarLogo scale={0.5} blocksOpacity={1} bg="green" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button style={topCircleBtn} title="feedback" onClick={() => setFeedbackOpen(true)}>
            <MessageCircleWarning size={18} color={C.cream} />
          </button>
          <button style={topCircleBtn} title="account" onClick={() => setShowAccount(true)}>
            <UserCog size={18} color={C.cream} />
          </button>
          <button
            style={topCircleBtn}
            title="sign out"
            onClick={async () => { try { await signOut?.(); } catch { /* ignore */ } navigate("/m", { replace: true }); }}
          >
            <LogOut size={18} color={C.cream} />
          </button>
        </div>
      </div>

      {showAccount && <AccountModal onClose={() => setShowAccount(false)} />}
      {feedbackOpen && <MobileFeedbackSheet onClose={() => setFeedbackOpen(false)} />}

      {/* ── Groups (top — social first per spec) ── */}
      {(railGroups.length > 0 || pendingInvites.length > 0) && (
        <div style={groupsWrap}>
          {railGroups.map(({ group, members, pendingHandles }) => {
            const others = members.filter((m) => m.userId !== selfUserId);
            // ONE dot per group row: new visible writing OR new chat (the
            // split shows up inside the group — show-row dots vs the chat
            // toggle's dot). Per Alborz 2026-07-02: no separate chat icon here.
            const anyNew = writingNewByGroup.has(group.id) || chatNewByGroup.has(group.id);
            return (
              <button key={group.id} style={groupRow} onClick={() => navigate(`/m/group/${group.id}`)}>
                <span style={avatarStrip}>
                  {others.map((m) => (
                    <span key={m.userId} style={{ ...avatarCircle, background: C.cream, color: C.green }}>
                      {(m.username[0] ?? "?").toUpperCase()}
                    </span>
                  ))}
                  {pendingHandles.map((h, i) => (
                    <span key={`p${i}`} style={{ ...avatarCircle, background: C.yellow, color: C.cream }}>
                      {(h[0] ?? "?").toUpperCase()}
                    </span>
                  ))}
                </span>
                <span style={groupRowName}>{groupAutoName(group, others)}</span>
                {anyNew && <span style={writingDot} />}
              </button>
            );
          })}
          {pendingInvites.map((inv) => {
            const names = inv.memberNames.length ? inv.memberNames : [inv.inviterName];
            const label = inv.groupName || names.join(", ");
            return (
              <button key={inv.token} style={groupRow} onClick={() => { setInvitePrompt(inv); setAcceptError(null); }}>
                <span style={avatarStrip}>
                  {names.map((n, i) => (
                    <span key={i} style={{ ...avatarCircle, background: C.red, color: C.cream }}>
                      {(n[0] ?? "?").toUpperCase()}
                    </span>
                  ))}
                </span>
                <span style={groupRowName}>{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Invite new friends (starts a NEW group) — desktop's top-right pill ── */}
      <div style={{ textAlign: "center", padding: "0 16px 24px" }}>
        <button style={invitePill} onClick={() => setInviteOpen(true)}>Invite new friends?</button>
      </div>

      {/* ── Personal shelves ── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.cream }}><LoadingDots /></div>
      ) : !hasAnyShows && !searchOpen ? (
        <div style={heroWrap}>
          <h1 style={heroH1}>
            What shows are you watching<br />or thinking about starting?
          </h1>
          <button style={searchPill} onClick={openSearch}>SEARCH</button>
        </div>
      ) : (
        <div style={contentWrap}>
          {watching.length > 0 && (
            <>
              <h1 style={shelfHeader}>CURRENTLY WATCHING:</h1>
              <div style={shelfCol}>
                {watching.map(({ show, entry }) => (
                  <button
                    key={show.id}
                    style={pillWatching}
                    onClick={() => { setDeclaredProgress({ s: entry.s, e: entry.e }); setShowSheet({ showId: show.id, name: show.name, mode: "watching" }); }}
                  >
                    <span style={pillName}>{show.name}</span>
                    <span style={{ fontWeight: 500 }}>s{entry.s} e{entry.e}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {notStarted.length > 0 && (
            <>
              <h1 style={{ ...shelfHeader, textTransform: "none", marginTop: watching.length ? 40 : 0 }}>
                Haven&rsquo;t started yet:
              </h1>
              <div style={shelfCol}>
                {notStarted.map(({ show }) => (
                  <button
                    key={show.id}
                    style={pillWant}
                    onClick={() => { setDeclaredProgress({ s: 0, e: 0 }); setShowSheet({ showId: show.id, name: show.name, mode: "notStarted" }); }}
                  >
                    <span style={pillName}>{show.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div style={{ textAlign: "center", marginTop: 40, paddingBottom: 24 }}>
            <h1 style={{ ...shelfHeader, textTransform: "none", marginBottom: 16 }}>What else?</h1>
            <button style={searchPill} onClick={openSearch}>SEARCH</button>
          </div>
        </div>
      )}

      {/* ── Personal show sheet (full-screen; desktop's yellow modal) ── */}
      {showSheet && (() => {
        const cur = progress[showSheet.showId];
        const curVal = cur ? { s: cur.s, e: cur.e } : { s: 0, e: 0 };
        const isWatching = showSheet.mode === "watching";
        return (
          <div style={{ ...sheet, background: C.yellow }}>
            <button style={sheetClose} onClick={() => setShowSheet(null)}><X size={20} color={C.cream} /></button>
            <div style={sheetInner}>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 26, color: C.cream, textAlign: "center", marginBottom: 20 }}>
                {showSheet.name}
              </div>

              {!isWatching ? (
                <>
                  <div style={sheetTitle}>Have you started watching?</div>
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                    <OneSelectProgress
                      show={showsById[showSheet.showId] ?? { seasons: [] }}
                      value={{ s: 0, e: 0 }}
                      allowZero
                      pillBg="transparent"
                      onForwardPick={(v) => { logProgressPersonal(showSheet.showId, v); setShowSheet(null); }}
                      onConfirm={(v) => { logProgressPersonal(showSheet.showId, v); setShowSheet(null); }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div style={sheetTitle}>Have you watched more?</div>
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
                    <OneSelectProgress
                      show={showsById[showSheet.showId] ?? { seasons: [] }}
                      value={curVal}
                      allowZero
                      requireConfirm={false}
                      pillBg="transparent"
                      onChangeSelected={(v) => setDeclaredProgress(v)}
                      onConfirm={() => {}}
                    />
                  </div>
                  <div style={sheetDivider} />
                  <div style={{ ...sheetTitle, fontSize: 13 }}>Do you want to write by yourself?</div>
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                    <button
                      style={startBtn}
                      onClick={() => { const id = showSheet.showId; logProgressPersonal(id, declaredProgress); setShowSheet(null); navigate(`/m/show-room/private/${id}`); }}
                    >Yes</button>
                    <button
                      style={{ ...startBtn, padding: "11px 24px", whiteSpace: "nowrap", background: "transparent", color: C.cream, border: `2px solid ${C.cream}` }}
                      onClick={() => { logProgressPersonal(showSheet.showId, declaredProgress); setShowSheet(null); }}
                    >just confirm my progress</button>
                  </div>
                </>
              )}

              {/* Desktop's hover × (title "remove from pool") — a visible
                  button here, since hover doesn't exist on mobile. */}
              <div style={sheetDivider} />
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button style={dangerBtn} onClick={() => setRemoveConfirm({ id: showSheet.showId, name: showSheet.name })}>
                  remove from pool
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Remove-from-pool confirm (bottom sheet; desktop copy) ── */}
      {removeConfirm && (
        <div style={dim} onClick={(e) => { if (e.target === e.currentTarget) setRemoveConfirm(null); }}>
          <div style={bottomSheet}>
            <div style={{ color: C.red, fontWeight: 700, fontSize: 15, marginBottom: 12, letterSpacing: -0.3 }}>Remove this show from your pool?</div>
            <div style={{ color: C.cream, fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>This will opt you out of the show across all your groups and you will leave any friend rooms for the show.</div>
            <div style={{ color: C.cream, fontSize: 12, lineHeight: 1.5, marginBottom: 18 }}>BUT, your progress will be saved and restored if you search for and add the show back to your show pool.</div>
            {/* Bottom-sheet rule (2026-07-03): left-justify. */}
            <div style={{ display: "flex", justifyContent: "flex-start", gap: 16, alignItems: "center" }}>
              <button style={dangerBtn} onClick={() => doRemoveFromPool(removeConfirm.id)}>remove</button>
              <button style={{ border: "none", background: "transparent", color: C.midnight, fontWeight: 700, fontSize: 13, cursor: "pointer", minHeight: 44 }} onClick={() => setRemoveConfirm(null)}>cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending-invite join prompt (bottom sheet; desktop copy + the
             hover tooltip line moved inline) ── */}
      {invitePrompt && (
        <div style={dim} onClick={(e) => { if (e.target === e.currentTarget) { setInvitePrompt(null); setAcceptError(null); } }}>
          {/* Bottom-sheet rule (2026-07-03): left-justify. */}
          <div style={{ ...bottomSheet, background: C.yellow }}>
            <div style={{ color: C.cream, fontSize: 13, fontWeight: 600, marginBottom: 10, opacity: 0.9 }}>
              You&rsquo;ve been invited by @{invitePrompt.inviterName} to join a watch group.
            </div>
            <div style={{ ...sheetTitle, textAlign: "left" }}>Join a group with {inviteNames(invitePrompt)}?</div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-start", marginTop: 16 }}>
              <button style={startBtn} onClick={() => acceptInvite(invitePrompt)}>Yes</button>
              <button style={{ ...startBtn, background: "transparent", color: C.cream, border: `2px solid ${C.cream}` }} onClick={() => declineInvite(invitePrompt)}>no</button>
            </div>
            {acceptError && (
              <div style={{ marginTop: 14, textAlign: "left", color: C.cream, fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{acceptError}</div>
            )}
          </div>
        </div>
      )}

      {/* ── Invite compose (full-screen; creates a new group) ── */}
      {inviteOpen && (
        <MobileInviteSheet
          onClose={() => setInviteOpen(false)}
          onSent={() => { refreshRailAndInvites(); }}
        />
      )}

      {/* ── Search (shared full-screen sheet) ── */}
      {searchOpen && (
        <MobileSearchSheet
          shows={shows}
          progress={progress}
          outOfPool={outOfPool}
          onClose={closeSearch}
          onAdd={addShow}
          onRestore={restoreShow}
          onCatalogAdd={(show) => setShows((prev) => (prev.some((s) => s.id === show.id) ? prev : [...prev, show]))}
        />
      )}
    </div>
  );
}

// ── Styles (canon tokens; §16 type; 44px targets; 100dvh + safe areas) ──────
const page: React.CSSProperties = {
  minHeight: "100dvh",
  boxSizing: "border-box",
  background: "var(--dos-bg, var(--canon-personal,#7abd8e))",
  fontFamily: '"Inter", system-ui, sans-serif',
  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
};
const topBar: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 8px",
};
const topCircleBtn: React.CSSProperties = {
  width: 44, height: 44, borderRadius: "50%", background: "transparent",
  border: `2px solid ${C.cream}`, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const groupsWrap: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 12, padding: "8px 16px 24px",
};
const groupRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  width: "100%", minHeight: 64, padding: "10px 16px", boxSizing: "border-box",
  borderRadius: 20, border: `2px solid ${C.cream}`, background: "transparent",
  cursor: "pointer", textAlign: "left",
};
const avatarStrip: React.CSSProperties = { display: "inline-flex", flexShrink: 0 };
const avatarCircle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: "50%",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  fontFamily: LORA, fontWeight: 700, fontSize: 22, letterSpacing: 0,
  marginRight: -8, border: `2px solid ${CANON.personal}`, boxSizing: "border-box",
};
const groupRowName: React.CSSProperties = {
  flex: 1, marginLeft: 8, fontWeight: 700, fontSize: 15, letterSpacing: -0.5,
  color: C.cream, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const writingDot: React.CSSProperties = {
  width: 14, height: 14, borderRadius: "50%", background: C.blue, display: "inline-block", flexShrink: 0,
};
const heroWrap: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "flex-start", textAlign: "center", gap: 28, padding: "40px 24px 24px",
};
const heroH1: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 28, lineHeight: 1.2, letterSpacing: 0, color: C.cream, margin: 0,
};
const contentWrap: React.CSSProperties = { padding: "8px 16px 40px" };
const shelfHeader: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 24, letterSpacing: 0, color: C.cream,
  textAlign: "center", textTransform: "uppercase", margin: "0 0 16px",
};
const shelfCol: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const pillBase: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 12, padding: "14px 24px", borderRadius: 65, cursor: "pointer",
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 14,
  letterSpacing: -1, width: "100%", boxSizing: "border-box", textAlign: "left",
  minHeight: 48,
};
const pillWatching: React.CSSProperties = {
  ...pillBase, background: "transparent", border: `2px solid ${C.cream}`, color: C.cream,
};
const pillWant: React.CSSProperties = {
  ...pillBase, background: C.cream, border: `2px solid ${C.cream}`, color: C.green,
};
const pillName: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const searchPill: React.CSSProperties = {
  border: "none", background: C.yellow, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "16px 56px", borderRadius: 65, cursor: "pointer", minHeight: 48,
};
const invitePill: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "16px 40px", borderRadius: 65, cursor: "pointer", minHeight: 48,
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};
// Full-screen sheet (mobile idiom for desktop's centered modal cards).
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
// Bottom sheet (mobile idiom for small confirm cards).
const dim: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, background: "rgba(26,58,74,0.35)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
};
const bottomSheet: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: C.sky,
  borderTopLeftRadius: 24, borderTopRightRadius: 24,
  padding: "26px 24px calc(env(safe-area-inset-bottom, 0px) + 26px)",
};
const startBtn: React.CSSProperties = {
  border: "none", background: C.blue, color: C.cream, fontWeight: 700, fontSize: 14,
  padding: "11px 38px", borderRadius: 65, cursor: "pointer", minHeight: 44,
};
const dangerBtn: React.CSSProperties = {
  border: `2px solid ${C.red}`, background: "transparent", color: C.red, fontWeight: 700, fontSize: 14,
  padding: "10px 32px", borderRadius: 65, cursor: "pointer", minHeight: 44,
};
