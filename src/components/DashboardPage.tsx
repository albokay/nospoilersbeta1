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
import { useNavigate, useLocation } from "react-router-dom";
import { X, Settings, UsersRound, Pencil, ArrowUp } from "lucide-react";
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
  acceptPeopleGroupInvite,
  leavePeopleGroup,
  renamePeopleGroup,
  fetchMyPendingGroupInvites,
  fetchGroupMessages,
  sendGroupMessage,
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

type RailGroup = { group: PeopleGroup; members: PeopleGroupMember[] };

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [railGroups, setRailGroups] = useState<RailGroup[]>([]);
  const [loading, setLoading] = useState(true);

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

  // §9 click-model popover (group context). mode captured at click time.
  const [clicked, setClicked] = useState<{ showId: string; name: string; mode: "solo" | "vote" | "watchq" } | null>(null);
  const [declaredProgress, setDeclaredProgress] = useState<{ s: number; e: number }>({ s: 0, e: 0 });

  // CP5b: pending invites (rail "*you're invited"), group options (gear).
  const [pendingInvites, setPendingInvites] = useState<PendingGroupInvite[]>([]);
  const [invitePrompt, setInvitePrompt] = useState<PendingGroupInvite | null>(null);
  const [optionsFor, setOptionsFor] = useState<string | null>(null); // group id whose gear options are open
  const [renameValue, setRenameValue] = useState("");

  // CP6: group chat panel.
  const [chatGroupId, setChatGroupId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<GroupMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  const selfUserId = user?.id ?? "";
  const inGroup = !!activeGroupId;

  // ── Rail (people-groups). Isolated + tolerant so the dashboard works before
  //    the CP1 migration is applied. ─────────────────────────────────────────
  const loadRail = useCallback(async (uid: string) => {
    try {
      const groups = await fetchPeopleGroupsForUser(uid);
      const withMembers = await Promise.all(
        groups.map(async (g) => ({ group: g, members: await fetchPeopleGroupMembers(g.id) }))
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
        const [showRows, prog] = await Promise.all([fetchShows(), fetchProgress(user.id)]);
        if (cancelled) return;
        setShows(showRows);
        setProgress(prog);
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
      const started = (entry.s ?? 0) > 0 || (entry.e ?? 0) > 0;
      (started ? watching : notStarted).push({ show, entry });
    }
    const byName = (a: { show: Show }, b: { show: Show }) => a.show.name.localeCompare(b.show.name);
    return { watching: watching.sort(byName), notStarted: notStarted.sort(byName) };
  }, [progress, showsById]);

  const hasAnyShows = watching.length + notStarted.length > 0;

  // ── Group shelves (sky) — pills computed from the aggregation RPC ──────────
  const groupShelves = useMemo(() => {
    const watching: { pill: PillData; name: string }[] = [];
    const notStarted: { pill: PillData; name: string }[] = [];
    for (const gs of groupShows) {
      const show = showsById[gs.showId];
      const pill = computePill(gs, show?.seasons, selfUserId);
      const row = { pill, name: show?.name ?? gs.showId };
      (pill.shelf === "watching" ? watching : notStarted).push(row);
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return { watching: watching.sort(byName), notStarted: notStarted.sort(byName) };
  }, [groupShows, showsById, selfUserId]);

  // Catalog search (CP2: catalog-only; TVMaze add is a later refinement).
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shows.filter((s) => !s.isHidden && s.name.toLowerCase().includes(q) && !progress[s.id]).slice(0, 8);
  }, [query, shows, progress]);

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

  function openInvite() {
    setInviteEmails([""]);
    setInviteLinks(null);
    setInviteOpen(true);
  }

  // INVITE FRIENDS: a new group forms and an invite link is minted per email.
  // (Email delivery is CP5b; for now the inviter shares the link in-app.)
  async function sendInvites() {
    if (!user || inviteSending) return;
    const emails = inviteEmails.map((e) => e.trim()).filter(Boolean);
    setInviteSending(true);
    try {
      const id = await createPeopleGroup();
      const links: { email: string; link?: string; error?: string }[] = [];
      for (const email of emails) {
        try {
          const token = await createPeopleGroupInvite(id, email);
          links.push({ email, link: `${window.location.origin}/group-invite/${token}` });
        } catch (e: any) {
          links.push({ email, error: e?.message || "failed" });
        }
      }
      setInviteLinks(links);
      const rail = await loadRail(user.id);
      setRailGroups(rail);
    } catch (e) {
      console.error("[dashboard] create group / invites failed", e);
      setInviteLinks([{ email: "", error: "Could not create the group." }]);
    } finally {
      setInviteSending(false);
    }
  }

  function openShow(_showId: string) {
    // CP4: dashboard (green) click opens the show's PRIVATE tab ("Want to write
    // by yourself?"). Rides with the room view. No-op until CP4.
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
    setDeclaredProgress({ s: 0, e: 0 });
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

  // ── CP6: chat (per group, not real-time) ─────────────────────────────────
  const loadChat = useCallback(async (groupId: string) => {
    try { setChatMessages(await fetchGroupMessages(groupId)); } catch (e) { console.error("[dashboard] chat load failed", e); }
  }, []);

  useEffect(() => {
    if (!chatGroupId) { setChatMessages([]); return; }
    loadChat(chatGroupId);
  }, [chatGroupId, loadChat]);

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

      <div style={{ position: "absolute", top: 16, left: 20 }}>
        <SidebarLogo scale={0.5} blocksOpacity={1} />
      </div>

      {inGroup ? (
        // ── Group context (sky) ───────────────────────────────────────────────
        <div style={contentWrap}>
          {groupShelves.watching.length > 0 && (
            <>
              <h1 style={shelfHeader}>CURRENTLY WATCHING:</h1>
              <div style={shelfGrid}>
                {groupShelves.watching.map((r) => (
                  <GroupPill key={r.pill.showId} pill={r.pill} name={r.name} onClick={() => onPillClick(r.pill, r.name)} />
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
                <GroupPill key={r.pill.showId} pill={r.pill} name={r.name} onClick={() => onPillClick(r.pill, r.name)} />
              ))}
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: 64 }}>
            {/* CP5: adds members to the CURRENT group (distinct from INVITE FRIENDS). */}
            <button style={connectMorePill} onClick={() => { /* CP5 */ }}>
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
                  <button key={show.id} className="dash-pill dash-pill--watching" onClick={() => openShow(show.id)}>
                    <span className="dash-pill__name">{show.name}</span>
                    <span className="dash-pill__prog">s{entry.s} e{entry.e}</span>
                  </button>
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
                <button key={show.id} className="dash-pill dash-pill--want" onClick={() => openShow(show.id)}>
                  <span className="dash-pill__name">{show.name}</span>
                </button>
              ))}
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: 48 }}>
            <h1 style={{ ...shelfHeader, textTransform: "none", marginBottom: 16 }}>What else?</h1>
            <button style={searchPill} onClick={openSearch}>SEARCH</button>
          </div>

          <div style={{ textAlign: "center", marginTop: 72 }}>
            <button style={invitePill} onClick={openInvite}>INVITE FRIENDS</button>
          </div>
        </div>
      )}

      <GroupsRail
        groups={railGroups}
        selfUserId={selfUserId}
        activeGroupId={activeGroupId}
        pendingInvites={pendingInvites}
        onEnter={(id) => navigate(`/dashboard?g=${id}`)}
        onExit={() => navigate("/dashboard")}
        onInviteClick={(inv) => setInvitePrompt(inv)}
        onGearClick={(id) => { setOptionsFor(id); setRenameValue(railGroups.find((r) => r.group.id === id)?.group.name ?? ""); }}
        onOpenChat={(id) => setChatGroupId(id)}
      />

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
                  {results.map((s) => (
                    <button key={s.id} className="dash-result" onClick={() => { setPickShow(s); setPickProgress({ s: 0, e: 0 }); }}>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={pickerCard}>
              <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: -2, color: C.green }}>
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
            <h1 style={{ fontFamily: LORA, fontWeight: 700, fontSize: 30, letterSpacing: -2, color: C.cream, textAlign: "center", margin: "8px 0 24px" }}>
              Email a friend to<br />start a watch group:
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
                  Group created. Share each link with that person — they open it (signed in with that email) to join:
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
        return (
          <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setClicked(null); }}>
            <div style={yellowCard}>
              <button style={modalClose} onClick={() => setClicked(null)}><X size={16} color="#fff" /></button>

              {clicked.mode === "solo" && (
                <>
                  <div style={yellowTitle}>Start a solo show room?</div>
                  <button style={{ ...startBtn, marginTop: 16 }} onClick={() => goToRoom(clicked.showId)}>Yes</button>
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
                      onChangeSelected={(v) => setDeclaredProgress(v)}
                      onConfirm={() => {}}
                    />
                  </div>
                  <div style={yellowDivider} />
                  <div style={{ ...yellowTitle, fontSize: 13 }}>{roomLabel}</div>
                  <button style={{ ...startBtn, marginTop: 12 }} onClick={() => declareAndGo(clicked.showId, declaredProgress)}>Yes</button>
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

      {/* CP5b: group options (gear) — rename + leave */}
      {optionsFor && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setOptionsFor(null); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={yellowCard}>
              <button style={modalClose} onClick={() => setOptionsFor(null)}><X size={16} color="#fff" /></button>
              <div style={{ ...yellowTitle, marginBottom: 12 }}>Rename group:</div>
              <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="group name" style={{ ...searchInput, border: "none", background: C.cream, color: C.midnight }} />
              <button style={{ ...startBtn, marginTop: 12 }} onClick={() => doRename(optionsFor)}>confirm name</button>
            </div>
            <div style={yellowCard}>
              <div style={{ ...yellowTitle, marginBottom: 12 }}>Leave this group?</div>
              <button style={{ ...startBtn, color: C.red, borderColor: C.red }} onClick={() => doLeave(optionsFor)}>yes, leave</button>
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
    <button style={base} onClick={onClick} title={`${pill.count} in pool`}>
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

// ── Groups rail ────────────────────────────────────────────────────────────────
function GroupsRail({
  groups, selfUserId, activeGroupId, pendingInvites, onEnter, onExit, onInviteClick, onGearClick, onOpenChat,
}: {
  groups: RailGroup[];
  selfUserId: string;
  activeGroupId: string | null;
  pendingInvites: PendingGroupInvite[];
  onEnter: (id: string) => void;
  onExit: () => void;
  onInviteClick: (inv: PendingGroupInvite) => void;
  onGearClick: (groupId: string) => void;
  onOpenChat: (groupId: string) => void;
}) {
  return (
    <div style={railWrap}>
      <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: -1, color: C.green, textAlign: "center", marginBottom: 24 }}>
        groups:
      </div>

      {/* Incoming invites — red "*you're invited" cluster (§8). */}
      {pendingInvites.map((inv) => {
        const names = inv.memberNames.length ? inv.memberNames : [inv.inviterName];
        return (
          <button
            key={inv.token}
            onClick={() => onInviteClick(inv)}
            title={`Join a group with @${names[0]}?`}
            style={{ border: "none", background: "transparent", cursor: "pointer", display: "block", width: "100%", textAlign: "center", marginBottom: 36 }}
          >
            <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 4, maxWidth: 96, margin: "0 auto" }}>
              {names.map((n, i) => (
                <span key={i} style={{ ...avatar, background: C.red }}>{(n[0] ?? "?").toUpperCase()}</span>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, letterSpacing: -1, color: C.red, fontWeight: 700 }}>*you're invited</div>
          </button>
        );
      })}

      {groups.map(({ group, members }) => {
        const others = members.filter((m) => m.userId !== selfUserId);
        const active = group.id === activeGroupId;
        return (
          <div key={group.id} style={{ textAlign: "center", marginBottom: 40, position: "relative" }}>
            {active && (
              <div style={{ position: "absolute", top: -4, right: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                <button style={railIcon} title="back to dashboard" onClick={onExit}><X size={16} color={C.midnight} /></button>
                <button style={railIcon} title="group options" onClick={() => onGearClick(group.id)}><Settings size={15} color={C.midnight} /></button>
              </div>
            )}
            <button
              onClick={() => (active ? onOpenChat(group.id) : onEnter(group.id))}
              title={active ? "open chat" : "open group"}
              style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0 }}
            >
              <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 4, maxWidth: 96, margin: "0 auto" }}>
                {(others.length ? others : members).map((m) => (
                  <span key={m.userId} style={{ ...avatar, background: active ? C.green : C.sky }} title={m.username}>
                    {(m.username[0] ?? "?").toUpperCase()}
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, letterSpacing: -1, color: C.green }}>
                {groupAutoName(group, others)}
              </div>
            </button>
          </div>
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
  fontFamily: LORA, fontWeight: 700, fontSize: 44, lineHeight: 1.15, letterSpacing: -2, color: C.cream, margin: 0,
};
const contentWrap: React.CSSProperties = {
  maxWidth: 1040, margin: "0 auto", padding: "96px 200px 80px 64px",
};
const shelfHeader: React.CSSProperties = {
  fontFamily: LORA, fontWeight: 700, fontSize: 34, letterSpacing: -2, color: C.cream,
  textAlign: "center", textTransform: "uppercase", margin: "0 0 24px",
};
const shelfGrid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, maxWidth: 880, margin: "0 auto",
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
const railWrap: React.CSSProperties = {
  position: "fixed", top: 0, right: 0, bottom: 0, width: 160, background: C.cream,
  borderTopLeftRadius: 24, borderBottomLeftRadius: 24, padding: "32px 12px", overflowY: "auto",
};
const avatar: React.CSSProperties = {
  width: 28, height: 28, borderRadius: "50%", color: "#fff", fontSize: 12, fontWeight: 700,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const railIcon: React.CSSProperties = {
  border: "none", background: "transparent", cursor: "pointer", padding: 2, lineHeight: 0,
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
const startBtn: React.CSSProperties = {
  border: `2px solid ${C.blue}`, background: C.cream, color: C.blue, fontWeight: 700, fontSize: 14,
  padding: "10px 36px", borderRadius: 65, cursor: "pointer",
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
    `}</style>
  );
}
