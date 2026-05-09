import React, { useEffect, useMemo, useRef, useState } from "react";
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
  persistProgressUpdate,
  createFriendGroup,
} from "../../lib/db";
import type { Show } from "../../lib/db";
import type { Thread, Reply, ProgressEntry, FriendGroup } from "../../types";
import SearchShows from "../SearchShows";
import SidebarLogo from "../SidebarLogo";
import EpisodeTag from "../EpisodeTag";
import OneSelectProgress from "../OneSelectProgress";
import EmptyProfileWelcome from "../EmptyProfileWelcome";
import { timeAgo } from "../../lib/utils";
import { linkifyText } from "../../lib/linkify";
import LoadingDots from "../LoadingDots";
import V2Layout from "./V2Layout";
import { navigateToShow } from "./v2nav";
import { createPortal } from "react-dom";
import { ChevronDown, SquarePen, Users, Globe, Plus } from "lucide-react";

// Replaces the last space in a string with U+00A0 so the final two
// words stay glued. Browser wraps at the previous space instead. Same
// helper used by ShowSection.tsx:7 to prevent last-line widows on long
// banner titles.
function preventLastWordOrphan(s: string): string {
  if (!s) return s;
  const idx = s.lastIndexOf(" ");
  if (idx === -1 || idx === 0) return s;
  return s.slice(0, idx) + " " + s.slice(idx + 1);
}

// Solid canon-light-blue pill — friend-room destination identity
// throughout v2. Solid-fill-no-outline per the v2 button rule.
const friendRoomBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "#adc8d7",
  color: "#fff",
  border: "none",
  borderRadius: 9999,
  padding: "0 16px",
  height: 32,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

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
  const chevronBtnRef = useRef<HTMLButtonElement | null>(null);
  const [chevronRect, setChevronRect] = useState<{ top: number; left: number } | null>(null);
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [stopSubmitting, setStopSubmitting] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [createRoomSubmitting, setCreateRoomSubmitting] = useState(false);
  const [createRoomError, setCreateRoomError] = useState<string | null>(null);
  const [roomsDropdownOpen, setRoomsDropdownOpen] = useState(false);
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

  // Create-friend-room handler. The user is on /v2/journal/:showId, which
  // means the show is already in their progress, so we don't need the
  // auto-onboard branch the live ShowSection has — just create the group
  // and surface it locally.
  async function handleCreateRoom() {
    if (!user || !activeShow || !newRoomName.trim() || createRoomSubmitting) return;
    setCreateRoomSubmitting(true);
    setCreateRoomError(null);
    try {
      const g = await createFriendGroup({ showId: activeShow.id, name: newRoomName.trim(), createdBy: user.id });
      setGroupsForActive((prev) => [...prev, g]);
      setCreateRoomOpen(false);
      setNewRoomName("");
    } catch (err: any) {
      console.warn("createFriendGroup failed:", err);
      setCreateRoomError(err?.message || "Couldn't create room. Try again.");
    } finally {
      setCreateRoomSubmitting(false);
    }
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
  // Nudge main column slightly right so it doesn't hug the rail too tightly.
  const MAIN_LEFT = RAIL_LEFT + RAIL_WIDTH + 56; // 300

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
                top: 16,
                width: RAIL_WIDTH,
                zIndex: 10,
              }
        }
      >
        {!isNarrow && (
          <div style={{ marginBottom: 8 }}>
            <SidebarLogo scale={0.6} />
          </div>
        )}

        <SearchShows
            shows={shows}
            progress={progress}
            // Tighter search pill so it sits in the rail at roughly the
            // same height as the show buttons below it.
            style={{ width: "100%", height: 34, margin: 0 }}
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
              margin: "16px 0 4px",
              paddingLeft: 8,
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
                ? { display: "flex", flexDirection: "column", gap: 4 }
                : {
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
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
              // count was previously surfaced in the rail; dropped 2026-05-08
              // — progress alone is the primary signal. countByShow stays
              // available for future affordances (per-show notification dot, etc).
              void countByShow;
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
                    padding: "4px 12px",
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    borderRadius: 9999,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span style={{ fontSize: 11, color: "var(--dos-fg)", opacity: 0.7, fontWeight: 500, flexShrink: 0, marginLeft: 8 }}>
                    {formatProgressShort(p)}
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
                  // Top padding picks the heading down so "this is your
                  // journal" lines up with the "sidebar" wordmark in the
                  // rail logo. SidebarLogo at scale 0.6 is ~89px tall;
                  // wordmark sits at the bottom (52×0.6 = 31px tall) and
                  // its baseline lands ~80px below the logo's top edge
                  // (which is at viewport y=16 via aside top: 16). 80-px
                  // padding-top puts the heading baseline at the same y.
                  padding: "80px 48px 120px",
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
                gap: 16,
                marginBottom: 16,
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
                <div style={{ flexShrink: 0, padding: "16px 24px 8px" }}>
                {/* Title row: title shrinks/wraps; progress pill stays
                    pinned in the corner. align-items: flex-start keeps
                    the pill top-aligned when the title goes multi-line. */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 4 }}>
                  <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
                    <h1
                      style={{
                        fontFamily: "Lora, Georgia, serif",
                        fontWeight: 600,
                        fontSize: 28,
                        letterSpacing: "0.02em",
                        textTransform: "uppercase",
                        color: "#fff",
                        lineHeight: 1.1,
                        margin: 0,
                        overflowWrap: "break-word",
                        wordBreak: "break-word",
                        minWidth: 0,
                      }}
                    >
                      {preventLastWordOrphan(activeShow.name)}
                    </h1>
                    <button
                      ref={chevronBtnRef}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (chevronOpen) {
                          setChevronOpen(false);
                          return;
                        }
                        // Capture viewport coords of the chevron button so the
                        // portaled dropdown can position itself with `position:
                        // fixed`. The dropdown lives outside the panel's
                        // overflow:hidden via a portal, so it renders fully
                        // even when its anchor is inside a clipped container.
                        const rect = chevronBtnRef.current?.getBoundingClientRect();
                        if (rect) setChevronRect({ top: rect.bottom + 8, left: rect.left });
                        setChevronOpen(true);
                      }}
                      title="show options"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#fff",
                        cursor: "pointer",
                        padding: "4px 6px",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <ChevronDown size={20} />
                    </button>
                  </div>

                  {/* Universal progress picker — exact same component the live
                      site uses (OneSelectProgress with default requireConfirm).
                      Selecting a new S/E opens the standard confirmation modal,
                      then commits via persistProgressUpdate which mirrors
                      App.tsx's updateProgressFor (rewatcher-aware: bumps
                      highest, transitions out of rewatch when past previous
                      highest, otherwise updates rewatch position only). */}
                  {user && (
                    // Wrapper guarantees the pill stays in the corner via
                    // flex-shrink: 0 + align-self: flex-start, even when the
                    // title wraps to multiple lines.
                    <div style={{ flexShrink: 0, alignSelf: "flex-start" }}>
                      <OneSelectProgress
                        show={activeShow as any}
                        value={{ s: progress[activeShow.id]?.s ?? 1, e: progress[activeShow.id]?.e ?? 1 }}
                        rewatchHighest={
                          progress[activeShow.id]?.isRewatching && progress[activeShow.id]?.highestS != null && progress[activeShow.id]?.highestE != null
                            ? { s: progress[activeShow.id].highestS!, e: progress[activeShow.id].highestE! }
                            : null
                        }
                        onConfirm={async (val) => {
                          try {
                            const updated = await persistProgressUpdate(user.id, activeShow.id, progress[activeShow.id], val);
                            setProgress((prev) => ({ ...prev, [activeShow.id]: updated }));
                          } catch (err) {
                            console.warn("progress update failed:", err);
                          }
                        }}
                      />
                    </div>
                  )}
                </div>

                <div
                  style={{
                    fontFamily: "Lora, Georgia, serif",
                    fontStyle: "italic",
                    fontSize: 13,
                    color: "var(--dos-gray)",
                    marginBottom: 8,
                  }}
                >
                  {activeEntries.length} {activeEntries.length === 1 ? "entry" : "entries"}
                  {sinceTs ? ` written since ${formatSinceDate(sinceTs)}` : ""}
                </div>

                {/* action row */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <button
                    className="btn post"
                    onClick={() => navigate(`/v2/compose/${activeShow.id}`)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 32, padding: "0 16px", fontSize: 12 }}
                  >
                    <SquarePen size={13} /> write a new entry
                  </button>
                  {/* Friend-room nav — single room: solid pill that goes
                      straight there. Multi-room: dropdown trigger (still
                      solid pill) that reveals one solid pill per room. */}
                  {groupsForActive.length === 1 && (
                    <button
                      onClick={() => navigateToShow(navigate, activeShow.id, { activeGroupId: groupsForActive[0].id })}
                      style={friendRoomBtnStyle}
                    >
                      <Users size={13} /> → your friend room
                    </button>
                  )}
                  {groupsForActive.length > 1 && (
                    <div style={{ position: "relative", display: "inline-flex" }}>
                      <button
                        onClick={() => setRoomsDropdownOpen((v) => !v)}
                        style={friendRoomBtnStyle}
                      >
                        <Users size={13} /> → your {groupsForActive.length} friend rooms
                        <ChevronDown size={13} style={{ marginLeft: 4 }} />
                      </button>
                      {roomsDropdownOpen && (
                        <>
                          <div
                            onClick={() => setRoomsDropdownOpen(false)}
                            style={{ position: "fixed", inset: 0, zIndex: 4 }}
                            aria-hidden
                          />
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 8px)",
                              left: 0,
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                              zIndex: 5,
                            }}
                          >
                            {groupsForActive.map((g) => (
                              <button
                                key={g.id}
                                onClick={() => {
                                  setRoomsDropdownOpen(false);
                                  navigateToShow(navigate, activeShow.id, { activeGroupId: g.id });
                                }}
                                style={friendRoomBtnStyle}
                              >
                                <Users size={13} /> → {g.name}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {/* + friends — start a new friend room on this show.
                      0 rooms → "+ friends" text pill (white outline +
                      white text + transparent fill).
                      1+ rooms → circular "+" icon (same outline/colors)
                      so the affordance is compact and reads as
                      "add another room." */}
                  {groupsForActive.length === 0 ? (
                    <button
                      onClick={() => {
                        setNewRoomName("");
                        setCreateRoomError(null);
                        setCreateRoomOpen(true);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        background: "transparent",
                        color: "#fff",
                        border: "2px solid #fff",
                        borderRadius: 9999,
                        padding: "0 16px",
                        height: 32,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      + friend room
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setNewRoomName("");
                        setCreateRoomError(null);
                        setCreateRoomOpen(true);
                      }}
                      title="add another friend room"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "transparent",
                        color: "#fff",
                        border: "2px solid #fff",
                        borderRadius: "50%",
                        width: 32,
                        height: 32,
                        cursor: "pointer",
                      }}
                    >
                      <Plus size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => navigateToShow(navigate, activeShow.id)}
                    // Solid canon-yellow + no outline + white text —
                    // matches the public destination identity throughout v2.
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: "#dea838",
                      color: "#fff",
                      border: "none",
                      borderRadius: 9999,
                      padding: "0 16px",
                      height: 32,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <Globe size={13} /> → public conversation
                  </button>
                </div>
                </div>{/* /fixed-position header */}

                {/* entry feed — scrolls inside the panel.
                    Borders + padding match live .diaryScrollArea. */}
                <div style={{ flex: 1, overflowY: "auto", padding: "0 32px 24px", borderTop: "1px solid rgba(255,255,255,0.25)" }}>
                  {activeEntries.length === 0 && (() => {
                    // Empty-state precedence (mirrors live ProfilePage:1198):
                    //   1. TSP show → canonical demo welcome
                    //   2. invitedMode (sessionStorage flag set by InviteAcceptPage)
                    //   3. selfCreatedRoom (user has at least one room they created)
                    //   4. Default welcome
                    if (activeShow.id === "tsp") {
                      return <div style={{ padding: "16px 0" }}><EmptyProfileWelcome isTsp /></div>;
                    }
                    const invitedMode = typeof window !== "undefined" && !!sessionStorage.getItem(`ns_invite_welcome_${activeShow.id}`);
                    if (invitedMode) {
                      return <div style={{ padding: "16px 0" }}><EmptyProfileWelcome invitedMode showName={activeShow.name} /></div>;
                    }
                    const hasSelfCreatedRoom = !!user && groupsForActive.some((g) => g.createdBy === user.id);
                    if (hasSelfCreatedRoom) {
                      return <div style={{ padding: "16px 0" }}><EmptyProfileWelcome selfCreatedRoom showName={activeShow.name} /></div>;
                    }
                    return <div style={{ padding: "16px 0" }}><EmptyProfileWelcome /></div>;
                  })()}
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
                        // Chip clicks land directly on the open thread inside
                        // the appropriate destination context (room or public).
                        onNavigateRoom={(groupId) => navigateToShow(navigate, t.showId, { threadId: t.id, activeGroupId: groupId })}
                        onNavigatePublic={() => navigateToShow(navigate, t.showId, { threadId: t.id })}
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

      {/* Chevron-dropdown — portaled to body so the panel's overflow:hidden
          (needed for the entry-feed scroll) doesn't clip it. Anchored to
          the chevron button's viewport coords captured at click. */}
      {chevronOpen && chevronRect && createPortal(
        <>
          <div
            onClick={() => setChevronOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 60 }}
            aria-hidden
          />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: chevronRect.top,
              left: chevronRect.left,
              background: "var(--dos-bg)",
              border: "2px solid #fff",
              padding: 8,
              minWidth: 320,
              maxWidth: 360,
              zIndex: 61,
            }}
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
                padding: "8px 12px",
                color: "var(--dos-fg)",
                fontSize: 14,
                fontWeight: 600,
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
                  fontSize: 13,
                  color: "var(--dos-fg)",
                  opacity: 0.85,
                  lineHeight: 1.5,
                  marginTop: 8,
                  fontWeight: 400,
                }}
              >
                Closes the show in your journal and removes you from any friend rooms on this show. Searching for the show again restores your entries and progress, but not room memberships.
              </span>
            </button>
          </div>
        </>,
        document.body
      )}

      {/* create-friend-room modal — name your room, hit create */}
      {createRoomOpen && activeShow && user && (
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
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !createRoomSubmitting) setCreateRoomOpen(false);
          }}
        >
          <div
            style={{
              background: "var(--dos-bg)",
              border: "2px solid #fff",
              padding: "24px 24px 16px",
              maxWidth: 440,
              width: "100%",
              color: "var(--dos-fg)",
            }}
          >
            <div style={{ fontFamily: "Lora, Georgia, serif", fontWeight: 600, fontSize: 24, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.02em" }}>
              new friend room
            </div>
            <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 14, color: "var(--dos-gray)", lineHeight: 1.5, marginBottom: 16 }}>
              for <strong style={{ fontStyle: "normal", fontWeight: 600, color: "var(--dos-fg)" }}>{activeShow.name}</strong>. give it a name, then invite friends from the room itself.
            </div>
            <input
              autoFocus
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && newRoomName.trim() && !createRoomSubmitting) {
                  await handleCreateRoom();
                }
              }}
              placeholder="e.g. Almost Paradise"
              maxLength={120}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.18)",
                border: "2px solid #fff",
                borderRadius: 9999,
                padding: "8px 16px",
                color: "var(--dos-fg)",
                fontSize: 14,
                marginBottom: 16,
                outline: "none",
              }}
            />
            {createRoomError && (
              <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
                {createRoomError}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={createRoomSubmitting}
                onClick={() => setCreateRoomOpen(false)}
                style={{
                  background: "transparent",
                  color: "var(--dos-fg)",
                  border: "2px solid var(--dos-border)",
                  borderRadius: 9999,
                  padding: "0 16px",
                  height: 32,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: createRoomSubmitting ? "not-allowed" : "pointer",
                }}
              >
                cancel
              </button>
              <button
                disabled={createRoomSubmitting || !newRoomName.trim()}
                onClick={handleCreateRoom}
                style={{
                  background: "#adc8d7",
                  color: "#fff",
                  border: "none",
                  borderRadius: 9999,
                  padding: "0 16px",
                  height: 32,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: createRoomSubmitting || !newRoomName.trim() ? "not-allowed" : "pointer",
                  opacity: createRoomSubmitting || !newRoomName.trim() ? 0.6 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {createRoomSubmitting ? <>creating<LoadingDots /></> : "create room"}
              </button>
            </div>
          </div>
        </div>
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
