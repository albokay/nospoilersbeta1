import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import {
  fetchShows,
  fetchProgress,
  fetchUserThreads,
  fetchUserReplies,
  fetchRepliesToUserThreads,
  fetchLikedThreads,
  fetchLikedReplies,
  fetchFriendGroupsForUser,
  setStoppedWatching,
  stopWatching,
  setThreadPublic,
  addThreadToGroup,
} from "../../lib/db";
import type { Show } from "../../lib/db";
import type { Thread, Reply, ProgressEntry, FriendGroup } from "../../types";
import SearchShows from "../SearchShows";
import SidebarLogo from "../SidebarLogo";
import EpisodeTag from "../EpisodeTag";
import { timeAgo } from "../../lib/utils";
import { linkifyText } from "../../lib/linkify";
import LoadingDots from "../LoadingDots";
import V2Layout from "./V2Layout";
import { ChevronDown, SquarePen, Users, Globe } from "lucide-react";

type GroupRef = { groupId: string; groupName: string };
type ThreadRow = { thread: Thread; groupId?: string; groupName?: string; allGroups: GroupRef[] };
type ReplyRow = { reply: Reply; thread: Thread; groupId?: string; groupName?: string };

function formatProgressShort(p?: ProgressEntry): string {
  if (!p) return "—";
  if (p.s === 0 && p.e === 0) return "haven't started";
  return `S${String(p.s).padStart(2, "0")} E${String(p.e).padStart(2, "0")}`;
}

function formatSinceDate(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("en-US", { month: "long", day: "numeric" });
}

export default function V2JournalPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, loading: authLoading } = useAuth();

  // URL → activeShowId. /v2/journal           → first show
  //                     /v2/journal/:showId   → that show
  const parts = location.pathname.split("/").filter(Boolean);
  const urlShowId = parts[0] === "v2" && parts[1] === "journal" ? parts[2] : undefined;

  const [shows, setShows] = useState<Show[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({});
  const [allUserThreads, setAllUserThreads] = useState<ThreadRow[]>([]);
  const [groupsForActive, setGroupsForActive] = useState<FriendGroup[]>([]);
  const [tabReplies, setTabReplies] = useState<{
    myReplies: ReplyRow[];
    repliesToMe: ReplyRow[];
    likedThreads: Thread[];
    likedReplies: ReplyRow[];
  }>({ myReplies: [], repliesToMe: [], likedThreads: [], likedReplies: [] });
  const [chevronOpen, setChevronOpen] = useState(false);
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [stopSubmitting, setStopSubmitting] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 1080);

  useEffect(() => {
    const fn = () => setIsNarrow(window.innerWidth < 1080);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  // Bootstrap data: shows, progress, all user threads. One pass on user change.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([fetchShows(), fetchProgress(user.id), fetchUserThreads(user.id)])
      .then(([allShows, prog, threads]) => {
        if (cancelled) return;
        setShows(allShows);
        setProgress(prog);
        setAllUserThreads(threads);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2JournalPage bootstrap failed (recoverable):", err);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Active show selection — URL wins; fallback to first show in user's progress.
  // Stopped-watching shows are hidden from the rail; they live on the profile's
  // Stopped Watching shelf and resurrect via the rail-search reopen path.
  const userShowIds = useMemo(() => {
    return Object.keys(progress).filter((sid) => {
      const p = progress[sid];
      if (!p) return false;
      if (p.stoppedWatching) return false;
      return true;
    });
  }, [progress]);

  const activeShowId =
    urlShowId && userShowIds.includes(urlShowId)
      ? urlShowId
      : userShowIds[0] ?? null;

  const activeShow = useMemo(
    () => (activeShowId ? shows.find((s) => s.id === activeShowId) : undefined),
    [activeShowId, shows]
  );

  // Per-show responses-section data. Refetches when active show changes.
  useEffect(() => {
    if (!user || !activeShowId) {
      setTabReplies({ myReplies: [], repliesToMe: [], likedThreads: [], likedReplies: [] });
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchUserReplies(user.id, activeShowId),
      fetchRepliesToUserThreads(user.id, activeShowId),
      fetchLikedThreads(user.id, activeShowId),
      fetchLikedReplies(user.id, activeShowId),
      fetchFriendGroupsForUser(user.id, activeShowId),
    ])
      .then(([myR, repliesToMe, likedT, likedR, groups]) => {
        if (cancelled) return;
        setTabReplies({
          myReplies: myR,
          repliesToMe,
          likedThreads: likedT,
          likedReplies: likedR,
        });
        setGroupsForActive(groups);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2JournalPage per-show fetch failed (recoverable):", err);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, activeShowId]);

  // Per-show entry feed = filter all-user-threads to the active show.
  const activeEntries = useMemo(
    () => allUserThreads.filter((r) => r.thread.showId === activeShowId),
    [allUserThreads, activeShowId]
  );

  // Per-show entry counts for rail meta.
  const countByShow = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of allUserThreads) {
      m[r.thread.showId] = (m[r.thread.showId] ?? 0) + 1;
    }
    return m;
  }, [allUserThreads]);

  // Auth gate. Mirrors /profile gate — signed-out users go home.
  if (!authLoading && !user) {
    return <V2Layout palette="journal"><div /></V2Layout>;
  }

  const sinceTs = activeEntries.length
    ? activeEntries[activeEntries.length - 1].thread.createdAt
    : undefined;

  // Layout geometry:
  //  - Wide viewports (≥1080px): rail is fixed against the viewport's
  //    left edge (24px from the corner). Main column flows with margin-left
  //    clearing the rail.
  //  - Narrow viewports: stacked layout, rail above main inline.
  const RAIL_WIDTH = 220;
  const RAIL_LEFT = 24;
  const MAIN_LEFT = RAIL_LEFT + RAIL_WIDTH + 32; // 276

  return (
    <V2Layout palette="journal" bareMain>
      {/* === RAIL ===
          Logo + search + show buttons read as one unified left-column
          nav bar. Fixed against viewport-left on wide; inline above the
          main column on narrow.
          The aside itself has NO overflow constraint — overflow-y:auto
          would auto-promote overflow-x and clip the logo's negative-
          offset blocks (SidebarLogo arrangement 4 has blocks at
          translate(-24, …)). The show-button list inside has its own
          scroll container so a long list doesn't push the layout. */}
      <aside
        style={
          isNarrow
            ? { width: "calc(100% - 48px)", margin: "36px 24px 24px" }
            : {
                position: "fixed",
                left: RAIL_LEFT,
                top: 28,
                width: RAIL_WIDTH,
                zIndex: 10,
              }
        }
      >
        {!isNarrow && (
          <div style={{ marginBottom: 14 }}>
            <SidebarLogo scale={0.6} />
          </div>
        )}

        <SearchShows
            shows={shows}
            progress={progress}
            onReopenJournal={async (showId) => {
              // Resurrection: if the picked show was previously stopped,
              // clear the flag and refresh local progress so the show
              // reappears in the rail. Memberships do NOT auto-rejoin —
              // re-invite required.
              if (user && progress[showId]?.stoppedWatching) {
                try {
                  await setStoppedWatching(user.id, showId, false);
                  const fresh = await fetchProgress(user.id);
                  setProgress(fresh);
                } catch (err) {
                  console.warn("clear-stopped failed:", err);
                }
              }
              navigate(`/v2/journal/${showId}`);
            }}
            onShowCreated={(s) => navigate(`/v2/journal/${s.id}`)}
            onAuthRequired={() => navigate("/")}
            placeholder="find a show"
          />

          <div
            style={{
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 12,
              color: "var(--dos-gray)",
              margin: "12px 0 6px",
              paddingLeft: 6,
            }}
          >
            your shows
          </div>

          {/* Show-list scrolls inside its own container so a long list
              doesn't push the layout. Logo + search above stay outside
              the scroll so SidebarLogo's negative-offset blocks aren't
              clipped by the auto-promoted overflow-x. */}
          <div
            style={
              isNarrow
                ? { display: "flex", flexDirection: "column", gap: 2 }
                : {
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    maxHeight: "calc(100vh - 240px)",
                    overflowY: "auto",
                    paddingRight: 4,
                  }
            }
          >
            {userShowIds.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--dos-gray)", fontStyle: "italic", padding: "8px 6px" }}>
                no shows yet — search above to add one.
              </div>
            )}
            {userShowIds.map((sid) => {
              const s = shows.find((sh) => sh.id === sid);
              if (!s) return null;
              const active = sid === activeShowId;
              const p = progress[sid];
              const count = countByShow[sid] ?? 0;
              return (
                <button
                  key={sid}
                  onClick={() => navigate(`/v2/journal/${sid}`)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    textAlign: "left",
                    background: active ? "rgba(255,255,255,0.18)" : "transparent",
                    border: "2px solid transparent",
                    color: "var(--dos-fg)",
                    padding: "6px 12px",
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    borderRadius: 9999,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontSize: 10, color: "var(--dos-gray)", fontWeight: 500, lineHeight: 1.2, flexShrink: 0, marginLeft: 8 }}>
                    {count > 0 && <span>{count}</span>}
                    <span style={{ fontSize: 9 }}>{formatProgressShort(p)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* === MAIN COLUMN ===
            Wide viewports: margin-left clears the fixed rail.
            Narrow viewports: full-width below the inline rail. */}
        <main
          style={
            isNarrow
              ? { padding: "0 24px 120px", minWidth: 0 }
              : {
                  marginLeft: MAIN_LEFT,
                  padding: "36px 48px 120px",
                  maxWidth: 920,
                  minWidth: 0,
                }
          }
        >
          {/* Paired header sits above the panel (aligned with panel's left
              edge), not above the entire rail+main row. Mirrors the live
              "this is your journal" placement. */}
          {profile && (
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 18,
                marginBottom: 24,
                flexWrap: "wrap",
                marginLeft: 4,
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 600, color: "var(--dos-fg)", letterSpacing: "-0.005em" }}>
                this is your journal
              </div>
              <a
                href="/v2/profile"
                onClick={(e) => { e.preventDefault(); navigate("/v2/profile"); }}
                style={{
                  fontFamily: "Lora, Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 16,
                  color: "var(--dos-gray)",
                  textDecoration: "none",
                  borderBottom: "1px dotted var(--dos-gray)",
                  paddingBottom: 1,
                  cursor: "pointer",
                }}
              >
                → go to your public profile
              </a>
            </div>
          )}

          {/* Diary wrapper — outer holds the receded back-pages, inner is the
              front card. Mirrors live .diaryCardWrap > .diaryBackPage pattern.
              The wrapper has no overflow-hidden (so back pages can peek out
              past the front card's bottom-left edge); the inner card has
              overflow-hidden so the entry feed scrolls inside it. */}
          <div style={{ position: "relative", marginBottom: 32 }}>
            {/* receded back pages — same offsets/opacities as the live diary
                (theme.ts diaryBackPage cascade). 48/32/16 staggers them
                cleanly behind the front card. */}
            {([48, 32, 16] as const).map((offset) => {
              const opacity = offset === 48 ? 0.18 : offset === 32 ? 0.36 : 0.55;
              return (
                <div
                  key={offset}
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    border: "2px solid",
                    borderColor: `rgba(255,255,255,${opacity})`,
                    background: "var(--dos-bg)",
                    transform: `translate(-${offset}px, ${offset}px)`,
                    zIndex: 0,
                  }}
                />
              );
            })}

          {/* Journal panel — uses live-site visual conventions:
              2px white border, no drop shadow, square corners, --dos-bg ground.
              Fixed height with internal scroll = same shape as the live
              .diaryCardWrap > .card (action bar fixed at top, entries scroll
              inside). Mirrors theme.ts .diaryScrollArea. */}
          <section
            style={{
              position: "relative",
              border: "2px solid #fff",
              background: "var(--dos-bg)",
              height: 720,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              zIndex: 1,
            }}
          >

            {!activeShow ? (
              <div style={{ fontStyle: "italic", color: "var(--dos-gray)", padding: "32px 32px" }}>
                no shows in your journal yet. search above to add one.
              </div>
            ) : (
              <>
                {/* fixed-position header: heading + meta + action row.
                    Sits above the scroll container so entries never bleed
                    above it (same pattern as live .profileActionBar). */}
                <div style={{ flexShrink: 0, padding: "28px 32px 18px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
                  <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <h1
                      style={{
                        fontFamily: "Lora, Georgia, serif",
                        fontWeight: 600,
                        fontSize: 34,
                        letterSpacing: "0.02em",
                        textTransform: "uppercase",
                        color: "#fff",
                        lineHeight: 1.05,
                        margin: 0,
                      }}
                    >
                      {activeShow.name}
                    </h1>
                    <button
                      onClick={(e) => { e.stopPropagation(); setChevronOpen((v) => !v); }}
                      title="show options"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--dos-gray)",
                        cursor: "pointer",
                        padding: "4px 6px",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <ChevronDown size={20} />
                    </button>

                    {chevronOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          marginTop: 6,
                          background: "var(--dos-bg)",
                          border: "2px solid #fff",
                          padding: 8,
                          minWidth: 320,
                          maxWidth: 360,
                          zIndex: 5,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setChevronOpen(false);
                            setStopError(null);
                            setStopModalOpen(true);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            background: "transparent",
                            border: "none",
                            padding: "10px 12px",
                            color: "var(--dos-fg)",
                            fontSize: 14,
                            cursor: "pointer",
                            borderRadius: 0,
                          }}
                        >
                          close show / stop watching
                          <span
                            style={{
                              display: "block",
                              fontFamily: "Lora, Georgia, serif",
                              fontStyle: "italic",
                              fontSize: 12,
                              color: "var(--dos-gray)",
                              lineHeight: 1.5,
                              marginTop: 4,
                            }}
                          >
                            Closes the show in your journal and removes you from any friend rooms on this show. Searching for the show again restores your entries and progress, but not room memberships.
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* progress pill — visual only, mirrors live --dos-user pill */}
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      background: "var(--dos-user)",
                      color: "#fff",
                      borderRadius: 9999,
                      padding: "6px 16px",
                      fontSize: 13,
                      fontWeight: 600,
                      height: 30,
                    }}
                  >
                    you've watched: {formatProgressShort(progress[activeShow.id])}
                  </span>
                </div>

                <div
                  style={{
                    fontFamily: "Lora, Georgia, serif",
                    fontStyle: "italic",
                    fontSize: 14,
                    color: "var(--dos-gray)",
                    marginBottom: 18,
                  }}
                >
                  {activeEntries.length} {activeEntries.length === 1 ? "entry" : "entries"}
                  {sinceTs ? ` written since ${formatSinceDate(sinceTs)}` : ""}
                </div>

                {/* action row */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
                  <button
                    className="btn post h40"
                    onClick={() => navigate(`/v2/compose/${activeShow.id}`)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <SquarePen size={14} /> write a new entry
                  </button>
                  {groupsForActive.length > 0 && (
                    <button
                      onClick={() => {
                        // Live ShowSection reads activeGroupId from
                        // location.state (App.tsx:659 pattern). Query
                        // strings are ignored. Single-room → preselect
                        // that room; multi-room → land on the show
                        // page and let the live UI offer the room
                        // picker.
                        const g = groupsForActive[0];
                        if (groupsForActive.length === 1) {
                          navigate(`/show/${activeShow.id}`, { state: { activeGroupId: g.id } });
                        } else {
                          navigate(`/show/${activeShow.id}`);
                        }
                      }}
                      // Solid canon-light-blue + no outline + white text —
                      // matches the friend-room destination identity
                      // throughout v2.
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: "#adc8d7",
                        color: "#fff",
                        border: "none",
                        borderRadius: 9999,
                        padding: "0 16px",
                        height: 34,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <Users size={14} /> {groupsForActive.length === 1 ? "→ your friend room" : `→ your ${groupsForActive.length} friend rooms`}
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/show/${activeShow.id}`)}
                    // Solid canon-yellow + no outline + white text —
                    // matches the public destination identity throughout v2.
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: "#dea838",
                      color: "#fff",
                      border: "none",
                      borderRadius: 9999,
                      padding: "0 16px",
                      height: 34,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <Globe size={14} /> → public conversation
                  </button>
                </div>
                </div>{/* /fixed-position header */}

                {/* entry feed — scrolls inside the panel.
                    Borders + padding match live .diaryScrollArea. */}
                <div style={{ flex: 1, overflowY: "auto", padding: "0 32px 24px", borderTop: "1px solid rgba(255,255,255,0.25)" }}>
                  {activeEntries.length === 0 && (
                    <div style={{ padding: "24px 0", color: "var(--dos-gray)", fontStyle: "italic" }}>
                      no entries on this show yet.
                    </div>
                  )}
                  {activeEntries.map((row, idx) => {
                    const t = row.thread;
                    const inRoomIds = new Set(row.allGroups.map((g) => g.groupId));
                    const roomsNotIn = groupsForActive.filter((g) => !inRoomIds.has(g.id));
                    const canMakePublic = !t.isPublic;
                    return (
                      <EntryCard
                        key={t.id}
                        row={row}
                        firstRow={idx === 0}
                        roomsNotIn={roomsNotIn}
                        canMakePublic={canMakePublic}
                        onUpgradePublic={async () => {
                          // Optimistic local update.
                          setAllUserThreads((prev) =>
                            prev.map((r) => (r.thread.id === t.id ? { ...r, thread: { ...r.thread, isPublic: true } } : r))
                          );
                          try {
                            await setThreadPublic(t.id, true);
                          } catch (err) {
                            console.warn("setThreadPublic failed:", err);
                            // Roll back local state on failure.
                            setAllUserThreads((prev) =>
                              prev.map((r) => (r.thread.id === t.id ? { ...r, thread: { ...r.thread, isPublic: false } } : r))
                            );
                          }
                        }}
                        onUpgradeRoom={async (g: FriendGroup) => {
                          const groupRef: GroupRef = { groupId: g.id, groupName: g.name };
                          // Optimistic local update.
                          setAllUserThreads((prev) =>
                            prev.map((r) =>
                              r.thread.id === t.id
                                ? { ...r, allGroups: [...r.allGroups, groupRef], groupId: r.groupId ?? g.id, groupName: r.groupName ?? g.name }
                                : r
                            )
                          );
                          try {
                            await addThreadToGroup(t.id, g.id);
                          } catch (err) {
                            console.warn("addThreadToGroup failed:", err);
                            // Roll back local state on failure.
                            setAllUserThreads((prev) =>
                              prev.map((r) =>
                                r.thread.id === t.id
                                  ? { ...r, allGroups: r.allGroups.filter((x) => x.groupId !== g.id) }
                                  : r
                              )
                            );
                          }
                        }}
                        onNavigateRoom={(groupId) => navigate(`/show/${t.showId}`, { state: { activeGroupId: groupId } })}
                        onNavigatePublic={() => navigate(`/show/${t.showId}`)}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </section>
          </div>{/* /diary wrapper */}

          {/* === RESPONSES SECTIONS — lifted from ProfilePage, scoped to active show.
              Existing classes (.title/.card/.reply-card/.threadCard/.muted/.clamp3)
              already match the live look on default body palette. === */}
          {activeShowId && (
            <>
              <section style={{ marginTop: 56 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>responses to you</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabReplies.repliesToMe.length === 0 && <div className="muted">No responses yet.</div>}
                  {tabReplies.repliesToMe.map(({ reply: r, thread: t, groupName }) => (
                    <div
                      key={r.id}
                      className="card reply-card"
                      style={{
                        margin: "10px 0",
                        cursor: "pointer",
                        color: "var(--dos-bg)",
                        ["--dos-accent" as any]: "var(--dos-bg)",
                        ["--dos-cyan" as any]: "var(--dos-bg)",
                        ["--dos-gray" as any]: "rgba(222,168,56,0.65)",
                      }}
                      onClick={() => navigate(`/show/${t.showId}`)}
                    >
                      <div className="muted" style={{ fontSize: 14 }}>On <b>{t.titleBase}</b></div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                        {" • "}
                        {groupName ? <span style={{ fontStyle: "italic" }}>in {groupName}</span> : <span style={{ fontStyle: "italic" }}>publicly</span>}
                        {" • "}
                        <span className="username">@{r.author}</span>
                      </div>
                      <div className="clamp3" style={{ marginTop: 6, fontSize: 15 }}>{linkifyText(r.body)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ marginTop: 24 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your responses</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabReplies.myReplies.length === 0 && <div className="muted">No responses yet.</div>}
                  {tabReplies.myReplies.map(({ reply: r, thread: t }) => (
                    <div
                      key={r.id}
                      className="card reply-card"
                      style={{
                        margin: "10px 0",
                        cursor: "pointer",
                        color: "var(--dos-bg)",
                        ["--dos-accent" as any]: "var(--dos-bg)",
                        ["--dos-cyan" as any]: "var(--dos-bg)",
                        ["--dos-gray" as any]: "rgba(222,168,56,0.65)",
                      }}
                      onClick={() => navigate(`/show/${t.showId}`)}
                    >
                      <div className="muted" style={{ fontSize: 14 }}>On <b>{t.titleBase}</b></div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                      </div>
                      <div className="clamp3" style={{ marginTop: 6, fontSize: 15 }}>{linkifyText(r.body)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ marginTop: 24 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your starred entries</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabReplies.likedThreads.length === 0 && <div className="muted">No starred entries yet.</div>}
                  {tabReplies.likedThreads.map((t) => (
                    <div
                      key={t.id}
                      className="card threadCard"
                      style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
                      onClick={() => navigate(`/show/${t.showId}`)}
                    >
                      <div className="title" style={{ fontSize: 18 }}>{t.titleBase}</div>
                      <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.7, marginTop: 2 }}>
                        <EpisodeTag season={t.season} episode={t.episode} isRewatch={t.isRewatch} rewatchS={t.rewatchS} rewatchE={t.rewatchE} />
                      </div>
                      <div className="clamp3" style={{ marginTop: 6 }}>{t.preview || t.body}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ marginTop: 24 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your starred responses</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabReplies.likedReplies.length === 0 && <div className="muted">No starred responses yet.</div>}
                  {tabReplies.likedReplies.map(({ reply: r, thread: t }) => (
                    <div
                      key={r.id}
                      className="card reply-card"
                      style={{
                        margin: "10px 0",
                        cursor: "pointer",
                        color: "var(--dos-bg)",
                        ["--dos-accent" as any]: "var(--dos-bg)",
                        ["--dos-cyan" as any]: "var(--dos-bg)",
                        ["--dos-gray" as any]: "rgba(222,168,56,0.65)",
                      }}
                      onClick={() => navigate(`/show/${t.showId}`)}
                    >
                      <div className="muted" style={{ fontSize: 14 }}>On <b>{t.titleBase}</b></div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                        {" • "}
                        <span className="username">@{r.author}</span>
                      </div>
                      <div className="clamp3" style={{ marginTop: 6, fontSize: 15 }}>{linkifyText(r.body)}</div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>

      {/* (entry card component lives below the main return) */}

      {/* close chevron-dropdown when clicking elsewhere */}
      {chevronOpen && (
        <div
          onClick={() => setChevronOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 4 }}
          aria-hidden
        />
      )}

      {/* stop-watching confirmation modal */}
      {stopModalOpen && activeShow && profile && user && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !stopSubmitting) setStopModalOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--dos-bg)",
              border: "2px solid #fff",
              padding: "24px 28px",
              maxWidth: 480,
              width: "100%",
              color: "var(--dos-fg)",
            }}
          >
            <div style={{ fontFamily: "Lora, Georgia, serif", fontWeight: 600, fontSize: 22, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.02em" }}>
              Stop watching {activeShow.name}?
            </div>
            <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 15, color: "var(--dos-fg)", lineHeight: 1.55, marginBottom: 16 }}>
              Your journal entries and progress will be preserved. The show moves to your <strong style={{ fontStyle: "normal", fontWeight: 600 }}>Stopped Watching</strong> shelf. Searching for it again restores everything except room memberships.
            </div>
            {groupsForActive.length > 0 && (
              <div
                style={{
                  background: "rgba(244,80,40,0.15)",
                  border: "2px solid var(--danger)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  marginBottom: 18,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dos-fg)", marginBottom: 6 }}>
                  You'll leave {groupsForActive.length === 1 ? "this friend room" : `${groupsForActive.length} friend rooms`}:
                </div>
                <ul style={{ margin: "0 0 8px 18px", padding: 0, fontSize: 14, lineHeight: 1.55, color: "var(--dos-fg)" }}>
                  {groupsForActive.map((g) => (
                    <li key={g.id} style={{ fontStyle: "italic", fontFamily: "Lora, Georgia, serif" }}>{g.name}</li>
                  ))}
                </ul>
                <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 13, color: "var(--dos-gray)", lineHeight: 1.5 }}>
                  You'd need to be re-invited to come back.
                </div>
              </div>
            )}
            {stopError && (
              <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
                {stopError}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button
                className="btn h40"
                disabled={stopSubmitting}
                onClick={() => setStopModalOpen(false)}
                style={{ fontSize: 13 }}
              >
                keep watching
              </button>
              <button
                disabled={stopSubmitting}
                onClick={async () => {
                  if (!user || !profile || !activeShow) return;
                  setStopSubmitting(true);
                  setStopError(null);
                  try {
                    await stopWatching(user.id, profile.username, activeShow.id);
                    // Land on the profile page where the new Stopped row surfaces.
                    navigate("/v2/profile");
                  } catch (err: any) {
                    console.warn("stopWatching failed:", err);
                    setStopError(err?.message || "Couldn't stop watching. Try again.");
                    setStopSubmitting(false);
                  }
                }}
                className="btn-danger h40"
                style={{
                  background: "var(--danger)",
                  border: "none",
                  color: "#fff",
                  borderRadius: 9999,
                  padding: "9px 18px",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: stopSubmitting ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 34,
                }}
              >
                {stopSubmitting ? <>stopping<LoadingDots /></> : "stop watching"}
              </button>
            </div>
          </div>
        </div>
      )}
    </V2Layout>
  );
}

// === ENTRY CARD ==============================================================
//
// One journal entry on the active show. Renders title + episode + body
// preview, then the destination chips for whichever destinations the
// thread is in (one chip per friend room + one "public" chip if applicable),
// then on hover a row of "+ add destination" affordances for the
// destinations the entry is NOT in. Click an affordance → optimistic
// local update + DB write via setThreadPublic / addThreadToGroup. The
// new chip appears immediately; if the write fails, the chip rolls back.
//
// Visual: chips use transparent fill + 2px palette outline (canon-blue
// for friend, canon-yellow for public). + add buttons use Lora italic
// + 2px dashed outline + transparent fill — both comply with the v2
// button rule (transparent-with-outline pattern).

function EntryCard({
  row,
  firstRow,
  roomsNotIn,
  canMakePublic,
  onUpgradePublic,
  onUpgradeRoom,
  onNavigateRoom,
  onNavigatePublic,
}: {
  row: ThreadRow;
  firstRow: boolean;
  roomsNotIn: FriendGroup[];
  canMakePublic: boolean;
  onUpgradePublic: () => void;
  onUpgradeRoom: (g: FriendGroup) => void;
  onNavigateRoom: (groupId: string) => void;
  onNavigatePublic: () => void;
}) {
  const t = row.thread;
  const [expanded, setExpanded] = useState(false);
  const hasChips = row.allGroups.length > 0 || t.isPublic;
  const hasUpgrades = canMakePublic || roomsNotIn.length > 0;
  const hasPreviewClip = (t.body && t.body.length > (t.preview?.length ?? 0)) || (t.preview ?? "") !== (t.body ?? "");

  return (
    <article
      style={{
        padding: "20px 0",
        borderTop: firstRow ? "none" : "1px solid rgba(255,255,255,0.18)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <h3
            className="title"
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "#fff",
              lineHeight: 1.25,
              margin: 0,
            }}
          >
            {t.titleBase}
          </h3>
          <span style={{ fontSize: 13, color: "var(--dos-gray)", fontWeight: 500 }}>
            <EpisodeTag season={t.season} episode={t.episode} isRewatch={t.isRewatch} rewatchS={t.rewatchS} rewatchE={t.rewatchE} parens={false} />
          </span>
        </div>
        <span style={{ fontSize: 13, color: "var(--dos-gray)" }}>{timeAgo(t.updatedAt)}</span>
      </div>

      {/* destinations row — current state + upgrade affordances live in
          the same row, always visible. "posted in:" italic Inter prefix
          when chips exist; chips are solid palette fill (no outline,
          white text); upgrade buttons are dashed-outline transparent
          (transparent-with-outline pattern). Both groupings share one
          flex-wrap row so what an entry IS and where it can be SENT
          read together. */}
      {(hasChips || hasUpgrades) && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          {hasChips && (
            <span
              style={{
                fontFamily: "Inter, sans-serif",
                fontStyle: "italic",
                fontSize: 12,
                color: "var(--dos-gray)",
                marginRight: 2,
              }}
            >
              posted in:
            </span>
          )}
          {row.allGroups.map((g) => (
            <a
              key={g.groupId}
              href={`/show/${t.showId}`}
              onClick={(e) => { e.preventDefault(); onNavigateRoom(g.groupId); }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 9999,
                background: "#adc8d7",
                color: "#fff",
                border: "none",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.02em",
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              friend room · {g.groupName}
            </a>
          ))}
          {t.isPublic && (
            <a
              href={`/show/${t.showId}`}
              onClick={(e) => { e.preventDefault(); onNavigatePublic(); }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 9999,
                background: "#dea838",
                color: "#fff",
                border: "none",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.02em",
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              public
            </a>
          )}
          {canMakePublic && (
            <button
              onClick={onUpgradePublic}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 9999,
                fontFamily: "Lora, Georgia, serif",
                fontStyle: "italic",
                fontSize: 12,
                color: "var(--dos-gray)",
                border: "2px dashed rgba(255,255,255,0.5)",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              + make public
            </button>
          )}
          {roomsNotIn.map((g) => (
            <button
              key={g.id}
              onClick={() => onUpgradeRoom(g)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 9999,
                fontFamily: "Lora, Georgia, serif",
                fontStyle: "italic",
                fontSize: 12,
                color: "var(--dos-gray)",
                border: "2px dashed rgba(255,255,255,0.5)",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              + send to {g.name}
            </button>
          ))}
        </div>
      )}

      <div
        className={expanded ? undefined : "clamp3"}
        style={{ fontSize: 15, lineHeight: 1.6, color: "var(--dos-fg)", whiteSpace: expanded ? "pre-wrap" : undefined }}
      >
        {linkifyText(expanded ? (t.body || t.preview) : (t.preview || t.body))}
      </div>

      {/* expand / collapse — restored from live conventions.
          White solid fill, no outline, canon-green text. */}
      {hasPreviewClip && (
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: "#fff",
              color: "#7abd8e",
              border: "none",
              borderRadius: 9999,
              padding: "6px 14px",
              fontFamily: "Inter, sans-serif",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {expanded ? "▴ less" : "▾ expand"}
          </button>
        </div>
      )}

    </article>
  );
}
