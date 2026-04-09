import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { injectDOSStyles } from "./styles/theme";
import { seedShows, seedThreads, repliesByThread } from "./lib/mockData";
import { canView } from "./lib/utils";
import { fetchProgress, upsertProgress, upsertRewatchStatus, clearRewatchMode, fetchShows, fetchRepliesToUserThreads, fetchLikedThreads, fetchLikedReplies, fetchUnreadFeedbackCount } from "./lib/db";
import { supabase } from "./lib/supabaseClient";
import type { Show } from "./lib/db";
import type { Reply, Thread, ProgressEntry } from "./types";
import { useAuth } from "./lib/auth";
import ExtensionDock from "./extensions/ExtensionDock";
import SearchShows from "./components/SearchShows";
import YourShowsSelect from "./components/YourShowsSelect";
import ShowSection from "./components/ShowSection";
import ProfilePage, { type ProfileTabData } from "./components/ProfilePage";
import Modal from "./components/Modal";
import OneSelectProgress from "./components/OneSelectProgress";
import AuthModal from "./components/AuthModal";
import SidebarLogo from "./components/SidebarLogo";
import AdminPage from "./components/AdminPage";
import { Tv, ListCheck, EyeClosed, UsersRound, MessagesSquare, Globe } from "lucide-react";
import PublicProfilePage from "./components/PublicProfilePage";
import Tooltip from "./components/Tooltip";
import FeedbackWidget from "./components/FeedbackWidget";

const ADMIN_USER_ID = "b4b37a6c-1f14-4189-9347-6ddbcadb99a6";

const SINGLE_PAGE = true;
const GLOBAL_HEADER_H = 56;

// Reusable grouped episode select (used in the watch-status first-join modal)
function EpisodeSelect({ show, value, onChange }: { show: any; value: { s: number; e: number }; onChange: (v: { s: number; e: number }) => void }) {
  const toId = (s: number, e: number) => `s${s}e${e}`;
  return (
    <select
      className="badge"
      value={toId(value.s, value.e)}
      onChange={ev => {
        const [, sp, ep] = ev.target.value.match(/^s(\d+)e(\d+)$/) || [];
        if (sp && ep) onChange({ s: parseInt(sp), e: parseInt(ep) });
      }}
      style={{ width: "100%" }}
    >
      {(show.seasons || []).map((count: number, idx: number) => {
        const s = idx + 1;
        return (
          <optgroup key={s} label={`Season ${s}`}>
            {Array.from({ length: count }, (_, j) => {
              const ep = j + 1;
              return (
                <option key={ep} value={toId(s, ep)}>
                  {`S${String(s).padStart(2, "0")} E${String(ep).padStart(2, "0")}`}
                </option>
              );
            })}
          </optgroup>
        );
      })}
    </select>
  );
}

export default function App() {
  useEffect(injectDOSStyles, []);

  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 600);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const [feedbackUnread, setFeedbackUnread] = useState(0);

  const [shows, setShows] = useState<Show[]>([]);
  useEffect(() => {
    fetchShows().then(setShows).catch(() => setShows(
      seedShows.filter(s => s.id === "bb" || s.id === "simshow") as Show[]
    ));

    // Real-time sync: push show list changes to all connected clients instantly
    const rowToShow = (row: any): Show => ({
      id: row.id,
      name: row.name,
      seasons: row.seasons,
      tvmazeId: row.tvmaze_id ?? undefined,
      status: row.status ?? "Ended",
      isHidden: row.is_hidden ?? false,
      lastSyncedAt: row.last_synced_at ?? undefined,
    });

    const channel = supabase
      .channel("shows-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shows" }, (payload) => {
        const s = rowToShow(payload.new);
        setShows(prev => prev.some(x => x.id === s.id) ? prev : [...prev, s].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shows" }, (payload) => {
        const s = rowToShow(payload.new);
        setShows(prev => prev.map(x => x.id === s.id ? s : x));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "shows" }, (payload) => {
        const deletedId = (payload.old as any).id;
        setShows(prev => prev.filter(x => x.id !== deletedId));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const { user, profile, loading: authLoading, signOut } = useAuth();
  const username = profile?.username ?? null;
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [feedbackForcedOpen, setFeedbackForcedOpen] = useState(false);
  const [feedbackPrefill, setFeedbackPrefill] = useState("");

  // ── URL-driven navigation (React Router) ─────────────────────
  const navigate = useNavigate();
  const location = useLocation();

  // Derive all nav state from the URL so the browser's back/forward buttons
  // work automatically — no manual pushState needed.
  //   /                         → homepage
  //   /show/:showId             → show forum
  //   /show/:showId/thread/:id  → thread view
  //   /profile                  → own profile
  //   /user/:username           → public profile
  const pathParts = location.pathname.split("/").filter(Boolean);
  const expandedShowId   = pathParts[0] === "show" ? (pathParts[1] ?? null) : null;
  const activeThreadId   = pathParts[0] === "show" && pathParts[2] === "thread" ? (pathParts[3] ?? null) : null;
  const showProfile      = location.pathname === "/profile";
  const publicProfileUsername = pathParts[0] === "user" ? decodeURIComponent(pathParts[1] ?? "") || null : null;

  // focusReplyId is still ephemeral state — it is set programmatically when
  // navigating from a notification, and cleared by RepliesList after scrolling.
  const [focusReplyId, setFocusReplyId] = useState<string | null>(null);

  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({ bb: { s: 1, e: 1 } });

  // Stale-progress nudge: show once per session if user returns after 12+ hour gap
  const [showStaleNudge, setShowStaleNudge] = useState(false);
  const [staleNudgeDismissed, setStaleNudgeDismissed] = useState(false);
  useEffect(() => {
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    const last = localStorage.getItem("ns_last_visit");
    const now = Date.now();
    if (last && now - parseInt(last, 10) > TWELVE_HOURS) {
      setShowStaleNudge(true);
    }
    localStorage.setItem("ns_last_visit", String(now));
  }, []);

  // Load progress from DB when user logs in; clear it when they log out
  useEffect(() => {
    if (!user) { setProgress({ bb: { s: 1, e: 1 } }); return; }
    fetchProgress(user.id).then(saved => {
      // Always keep BB in the dropdown as the demo entry
      setProgress({ bb: { s: 1, e: 1 }, ...saved });
    }).catch(err => console.error("Failed to load progress:", err));
  }, [user?.id]);

  // Replies-to-user for profile pill badge
  const [repliesToUser, setRepliesToUser] = useState<{ reply: Reply; thread: Thread }[]>([]);

  // Fetch on login + whenever the user navigates to a show or the profile
  useEffect(() => {
    if (!user) { setRepliesToUser([]); return; }
    fetchRepliesToUserThreads(user.id).then(setRepliesToUser).catch(() => {});
  }, [user?.id, expandedShowId, showProfile]);

  // Live: refetch whenever any reply is inserted/updated/deleted in the DB
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`user-replies-rt-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "replies" }, () => {
        fetchRepliesToUserThreads(user.id).then(setRepliesToUser).catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // Track when user last visited their profile (clears green badge)
  const [visibleSeenAt, setVisibleSeenAt] = useState<number>(() => {
    const s = localStorage.getItem("ns_visible_seen_at");
    return s ? parseInt(s, 10) : 0;
  });

  // When user last clicked to dismiss invisible replies (filters them out of the pill)
  const [invisibleSeenAt, setInvisibleSeenAt] = useState<number>(() => {
    const s = localStorage.getItem("ns_invisible_seen_at");
    return s ? parseInt(s, 10) : 0;
  });

  // When the red indicator was FIRST shown this "session" of notifications
  const [invisibleFirstSeenAt, setInvisibleFirstSeenAt] = useState<number>(() => {
    const s = localStorage.getItem("ns_invisible_first_seen_at");
    return s ? parseInt(s, 10) : 0;
  });

  // Compute pill badge state
  const { hasVisibleNewReplies, invisibleShowName } = useMemo(() => {
    let hasVisible = false;
    let latestInvisible: { reply: Reply; thread: Thread } | null = null;
    for (const { reply: r, thread: t } of repliesToUser) {
      const canSee = canView({ season: r.season, episode: r.episode }, progress[t.showId]);
      if (canSee) { if (r.updatedAt > visibleSeenAt) hasVisible = true; }
      else if (r.updatedAt > invisibleSeenAt && (!latestInvisible || r.updatedAt > latestInvisible.reply.updatedAt))
        latestInvisible = { reply: r, thread: t };
    }
    return {
      hasVisibleNewReplies: hasVisible,
      invisibleShowName: latestInvisible ? (shows.find(s => s.id === latestInvisible!.thread.showId)?.name ?? latestInvisible.thread.showId) : "",
    };
  }, [repliesToUser, progress, visibleSeenAt, invisibleSeenAt, shows]);

  // Start the 36h expiry clock the first time the red indicator appears;
  // clear it when there are no more new invisible replies (user caught up or dismissed).
  const THIRTY_SIX_HOURS = 36 * 60 * 60 * 1000;
  useEffect(() => {
    if (invisibleShowName) {
      if (!invisibleFirstSeenAt) {
        const now = Date.now();
        setInvisibleFirstSeenAt(now);
        localStorage.setItem("ns_invisible_first_seen_at", String(now));
      }
    } else {
      if (invisibleFirstSeenAt) {
        setInvisibleFirstSeenAt(0);
        localStorage.removeItem("ns_invisible_first_seen_at");
      }
    }
  }, [invisibleShowName]);

  // Capture the pre-clear seenAt so ProfilePage can detect which replies are "new"
  const hasVisibleRef = useRef(hasVisibleNewReplies);
  hasVisibleRef.current = hasVisibleNewReplies;
  const [openedAtSeenAt, setOpenedAtSeenAt] = useState(0);
  useEffect(() => {
    if (showProfile) {
      setOpenedAtSeenAt(visibleSeenAt); // capture BEFORE clearing
      const now = Date.now();
      setVisibleSeenAt(now);
      localStorage.setItem("ns_visible_seen_at", String(now));
      setInvisibleSeenAt(now);
      localStorage.setItem("ns_invisible_seen_at", String(now));
      setInvisibleFirstSeenAt(0);
      localStorage.removeItem("ns_invisible_first_seen_at");
    }
  }, [showProfile]);

  const [pickShowId, setPickShowId] = useState<string | null>(null);
  // Stores a just-created show so the modal can render before `shows` state updates settle
  const [pendingNewShow, setPendingNewShow] = useState<Show | null>(null);
  const pickShow = useMemo(() =>
    (pendingNewShow?.id === pickShowId ? pendingNewShow : null) || shows.find(s => s.id === pickShowId) || null,
    [pickShowId, shows, pendingNewShow]
  );
  const [hasPendingChange, setHasPendingChange] = useState(false);
  const [firstSel, setFirstSel] = useState<{ s: number; e: number } | null>(null);
  const [pickShowMode, setPickShowMode] = useState<"set" | "confirm">("set");

  // Watch-status questionnaire state (for first-time join modal)
  const [watchStatusChoice, setWatchStatusChoice] = useState<"first" | "rewatch" | null>(null);
  const [highestSel, setHighestSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });
  const [rewatchSel, setRewatchSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });
  const [firstTimeSel, setFirstTimeSel] = useState<{ s: number; e: number }>({ s: 1, e: 1 });

  useEffect(() => {
    if (pickShowId) {
      const init = progress[pickShowId] || { s: 1, e: 1 };
      setFirstSel(init);
      // Reset questionnaire each time a new show is opened
      setWatchStatusChoice(null);
      setHighestSel({ s: 1, e: 1 });
      setRewatchSel({ s: 1, e: 1 });
      setFirstTimeSel({ s: 1, e: 1 });
    }
  }, [pickShowId]);

  const [betaOpen, setBetaOpen] = useState(false);
  const [showsEmojiHover, setShowsEmojiHover] = useState(false);
  const [newHighlights, setNewHighlights] = useState<{ [sid: string]: { [tid: string]: true } }>({});
  const [visitedThreads, setVisitedThreads] = useState<{ [tid: string]: true }>({});

  // Profile tab data lifted from ProfilePage / PublicProfilePage for fixed-header rendering
  const [profileTabData, setProfileTabData] = useState<ProfileTabData | null>(null);

  const [likesThreads, setLikesThreads] = useState<Record<string, number>>({});
  const [likesReplies, setLikesReplies] = useState<Record<string, number>>({});
  const [likedByUserThreads, setLikedByUserThreads] = useState<Record<string, boolean>>({});
  const [likedByUserReplies, setLikedByUserReplies] = useState<Record<string, boolean>>({});

  // Load the user's likes from DB on login so stars persist across refreshes
  useEffect(() => {
    if (!user) { setLikedByUserThreads({}); setLikedByUserReplies({}); return; }
    fetchLikedThreads(user.id).then(threads => {
      const map: Record<string, boolean> = {};
      threads.forEach(t => { map[t.id] = true; });
      setLikedByUserThreads(map);
    }).catch(() => {});
    fetchLikedReplies(user.id).then(pairs => {
      const map: Record<string, boolean> = {};
      pairs.forEach(({ reply }) => { map[reply.id] = true; });
      setLikedByUserReplies(map);
    }).catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    const lt: Record<string, number> = {};
    seedThreads.forEach(t => { lt[t.id] = t.likes; });
    const lr: Record<string, number> = {};
    Object.keys(repliesByThread).forEach(tid => {
      repliesByThread[tid].forEach(r => { lr[r.id] = r.likes; });
    });
    setLikesThreads(lt); setLikesReplies(lr);
  }, []);

  // Lightweight progress update — merges into existing entry, preserving rewatch metadata
  const updateProgressFor = (sid: string, next: { s: number; e: number }) => {
    setProgress(prev => ({ ...prev, [sid]: { ...(prev[sid] || {}), ...next } }));
    if (user) {
      upsertProgress(user.id, sid, next.s, next.e).catch(err =>
        console.error("Failed to save progress:", err)
      );
    }
  };

  // Full entry setter — used on first join and rewatch status changes
  const setWatchStatusFor = (sid: string, entry: ProgressEntry) => {
    setProgress(prev => ({ ...prev, [sid]: entry }));
    if (user) {
      upsertRewatchStatus(user.id, sid, entry).catch(err =>
        console.error("Failed to save watch status:", err)
      );
    }
  };

  // Clear rewatch mode — called on auto-flip after re-watcher catches up
  const clearRewatchFor = (sid: string) => {
    setProgress(prev => {
      const cur = prev[sid] || { s: 1, e: 1 };
      return { ...prev, [sid]: { s: cur.s, e: cur.e, isRewatching: false } };
    });
    if (user) {
      clearRewatchMode(user.id, sid).catch(err =>
        console.error("Failed to clear rewatch mode:", err)
      );
    }
  };

  const openShow = (id: string) => {
    if (!id) return;
    navigate(`/show/${id}`);
    requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
  };

  const openThreadWithFocus = (showId: string, threadId: string, replyId?: string) => {
    setFocusReplyId(replyId || null);
    navigate(`/show/${showId}/thread/${threadId}`);
    requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
  };

  const goHomepage = () => {
    navigate("/");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  };

  const handleClickProfile = (name: string) => {
    // Own username goes to /profile; everyone else to /user/:username
    if (name === username) {
      navigate("/profile");
    } else {
      navigate(`/user/${encodeURIComponent(name)}`);
    }
    requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
  };

  const handlePickFromSearch = (showId: string) => {
    if (progress[showId]) {
      setPickShowMode("confirm");
      setPickShowId(showId);
    } else {
      setPickShowMode("set");
      setPickShowId(showId);
    }
  };

  const handleStartNewForum = (query: string) => {
    const name = query || prompt("Name your new show/forum:");
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || `show${Date.now()}`;
    alert(`(Demo) Created forum "${name}". Add it to your catalog / backend later.`);
    setProgress(p => ({ ...p, [id]: { s: 1, e: 1 } }));
    openShow(id);
  };

  const isHomepage = !expandedShowId && !showProfile && !publicProfileUsername;
  useEffect(() => {
    document.body.classList.toggle("has-header", !isHomepage);
  }, [isHomepage]);
  const isProfilePage = showProfile || !!publicProfileUsername;
  const showAdmin = location.search.includes("admin");
  const isAdmin = user?.id === ADMIN_USER_ID;

  // Fetch unread feedback count for admin badge
  useEffect(() => {
    if (!isAdmin || !user) { setFeedbackUnread(0); return; }
    fetchUnreadFeedbackCount().then(setFeedbackUnread).catch(() => {});
  }, [isAdmin, user?.id]);

  // Clear unread badge when admin panel opens
  useEffect(() => {
    if (showAdmin && isAdmin) setFeedbackUnread(0);
  }, [showAdmin, isAdmin]);

  const fixedHelp = null;

  // ── Fixed sidebar logo + "find a show" (non-homepage, top-left) ─
  const fixedLogo = !isHomepage ? (
    <div style={{ position: "fixed", top: 14, left: 14, zIndex: 1000, display: "flex", alignItems: "center", gap: 14 }}>
      <h1
        className="brand brandLink"
        style={{ margin: 0 }}
        tabIndex={0}
        aria-label="Go to homepage"
        onClick={goHomepage}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goHomepage(); } }}
      >
        <img src="/sidebar-logo.png" alt="sidebar" className="brandLogoImg" style={{ height: 38, width: "auto", display: "block" }} />
      </h1>
      <span className="mobileHide" style={{ display: "inline-flex" }}>
        <SearchShows
          shows={shows}
          onPick={handlePickFromSearch}
          onShowCreated={(newShow, entry) => {
            setShows(prev => [...prev, newShow]);
            setWatchStatusFor(newShow.id, entry);
            openShow(newShow.id);
          }}
          onAuthRequired={() => { setAuthHint("Sign in or open a new account in order to start a new show forum."); setShowAuthModal(true); }}
          style={{ width: 176, margin: 0, height: 34 }}
        />
      </span>
    </div>
  ) : null;

  // ── Fixed auth / profile / admin controls (top-right, all pages) ─
  const fixedAuth = (
    <div className="fixedAuthWrap" style={{ position: "fixed", top: 14, right: 14, zIndex: 1000, display: "flex", alignItems: "center", gap: 8 }}>
      {!isHomepage && !expandedShowId && !authLoading && user && (
        <span className="mobileHide" style={{ display: "inline-flex" }}>
          <YourShowsSelect
            shows={shows}
            progress={progress}
            value={""}
            onChange={(id: string) => {
              if (!id) return;
              setPickShowMode("confirm");
              setPickShowId(id);
            }}
            compact
          />
        </span>
      )}
      {!authLoading && !user && (
        <button className="btn" onClick={() => setShowAuthModal(true)}>
          Sign in / Join
        </button>
      )}
      {!isHomepage && !authLoading && user && username && (() => {
        const redExpired = !invisibleFirstSeenAt || Date.now() - invisibleFirstSeenAt >= THIRTY_SIX_HOURS;
        const pillBadge = hasVisibleNewReplies ? "green" : (!redExpired && invisibleShowName) ? "red" : null;
        const pillTooltipText =
          pillBadge === "green" ? "Someone wrote you back!" :
          pillBadge === "red" ? `FYI: ${invisibleShowName} has replies beyond your progress! You'll see them once you catch up.` :
          null;
        const pillContent = (
          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              className="profileChip"
              onClick={() => {
                navigate("/profile");
                requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
              }}
            >
              <span className="avatar">{username[0].toUpperCase()}</span>
              <span className="profileChipLabel" style={{ fontWeight: 700, color: "var(--dos-fg)" }}>{username}</span>
            </button>
            {pillBadge === "green" && (
              <div style={{ position: "absolute", top: -6, right: -6, width: 21, height: 21, borderRadius: "50%", background: "var(--green)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", pointerEvents: "none" }} />
            )}
            {pillBadge === "red" && (
              <div style={{ position: "absolute", top: -6, right: -6, width: 21, height: 21, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", pointerEvents: "none" }} />
            )}
          </div>
        );
        return pillTooltipText
          ? <Tooltip text={pillTooltipText} direction="below" align="right" tooltipStyle={{ background: "#bdd4de", color: "#1a2c3a", boxShadow: "0 4px 20px rgba(0,0,0,0.18)" }}>{pillContent}</Tooltip>
          : pillContent;
      })()}
      {!authLoading && user && username && (
        <button className="btn signOutBtn" onClick={() => { goHomepage(); signOut(); }}>
          <span className="signOutLabel">Sign out</span>
          <span className="signOutX">✕</span>
        </button>
      )}
      {!authLoading && isAdmin && (
        <div style={{ position: "relative", display: "inline-flex" }}>
          <button className="btn" onClick={() => navigate(showAdmin ? "/" : "/?admin")} title="Admin" style={{ fontSize: 18 }}>
            ⚙
          </button>
          {feedbackUnread > 0 && (
            <div style={{
              position: "absolute", top: -6, right: -6,
              width: 18, height: 18, borderRadius: "50%",
              background: "var(--danger)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 800, lineHeight: 1,
              pointerEvents: "none",
            }}>
              {feedbackUnread > 9 ? "9+" : feedbackUnread}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Header is a pure height-spacer + full-bleed bottom border.
  // Logo and auth are both position:fixed so they float above this bar.
  // On profile pages an extra fixed button-bar sits just below, so the spacer is taller.
  const headerHeight = GLOBAL_HEADER_H;
  const header = (
    <header className="site bleed" style={{ height: headerHeight }} />
  );

  // Show tabs are now integrated directly into the diary graphic on the profile page.
  const fixedProfileTabs = null;

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      {fixedHelp}
      {fixedLogo}
      {fixedAuth}
      {fixedProfileTabs}
      {!isHomepage && header}
      <FeedbackWidget
        isMobile={isMobile}
        forcedOpen={feedbackForcedOpen}
        prefillMessage={feedbackPrefill}
        onForcedClose={() => setFeedbackForcedOpen(false)}
      />
      {showAuthModal && <AuthModal onClose={() => { setShowAuthModal(false); setAuthHint(null); }} hint={authHint ?? undefined} />}
      {!showProfile && !publicProfileUsername && (
        <>
          {/* ── Homepage ── */}
          {isHomepage && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: isMobile ? 48 : 56, paddingBottom: 24, zIndex: 95, position: "relative", width: "100vw", marginLeft: "calc(-50vw + 50%)" }}>
              <div style={{ transform: isMobile ? "translateX(8px) translateY(8px)" : "translateX(13px)" }}><SidebarLogo scale={isMobile ? 0.75 : 1} /></div>

              {/* Hero headline */}
              <p style={{
                maxWidth: 880, textAlign: "center",
                margin: "56px 16px",
                fontSize: isMobile ? 20 : 32, fontWeight: 800,
                color: "#fff", lineHeight: 1.3,
              }}>
                {isMobile ? (
                  <>
                    Watching TV with friends<br />
                    usually means spoilers or silence.<br />
                    <em>Sidebar fixes that.</em><br />
                    <span style={{ fontSize: 16, lineHeight: 1.1, display: "inline-block", marginTop: 4 }}>
                      Watch at your own pace<br />
                      and still talk about it freely.<br />
                      Nobody gets spoiled, ever.<br />
                      When you're ready,<br />
                      the conversation can grow wider.
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ whiteSpace: "nowrap" }}>Watching TV with friends</span><br />
                    <span style={{ whiteSpace: "nowrap" }}>usually means spoilers or silence.</span><br />
                    <em>Sidebar fixes that.</em><br />
                    <span style={{ fontSize: 20, lineHeight: 1.1, display: "inline-block", marginTop: 4 }}>
                      <span style={{ whiteSpace: "nowrap" }}>Watch at your own pace and still talk about it freely.</span>{" "}<span style={{ whiteSpace: "nowrap" }}>Nobody gets spoiled, ever.</span><br />
                      <span style={{ whiteSpace: "nowrap" }}>When you're ready,</span>{" "}<span style={{ whiteSpace: "nowrap" }}>the conversation can grow wider.</span>
                    </span>
                  </>
                )}
              </p>

              {/* Three buttons row */}
              <div style={{
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                alignItems: "stretch",
                gap: 8,
                width: isMobile ? "min(288px, 90vw)" : "100%",
                maxWidth: isMobile ? undefined : 960,
                padding: isMobile ? 0 : "0 16px",
                boxSizing: "border-box",
              }}>
                {user && (
                  <button
                    className="btn"
                    onClick={() => { navigate("/profile"); requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" })); }}
                    style={{
                      flex: isMobile ? undefined : 1, background: "var(--dos-user)", color: "#fff", border: "none",
                      borderRadius: 9999, height: 40, boxSizing: "border-box",
                      fontSize: 16, fontWeight: 700, letterSpacing: "0.01em",
                      position: "relative", whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ position: "absolute", left: "12%", top: "50%", transform: "translateY(-50%)", fontSize: 20, lineHeight: 1 }}>📓</span>
                    read your journal
                  </button>
                )}
                {user && (
                  <div style={{ flex: isMobile ? undefined : 1, position: "relative", height: 40, boxSizing: "border-box" }}>
                    <YourShowsSelect
                      shows={shows}
                      progress={progress}
                      value={""}
                      onChange={(id) => {
                        if (!id) return;
                        setPickShowMode("confirm");
                        setPickShowId(id);
                      }}
                      placeholder="START HERE"
                      wrapperStyle={{ width: "100%", height: "100%" }}
                      onMouseEnter={() => setShowsEmojiHover(true)}
                      onMouseLeave={() => setShowsEmojiHover(false)}
                    />
                    <span style={{ position: "absolute", right: "8%", top: "50%", transform: "translateY(-50%)", fontSize: 20, lineHeight: 1, pointerEvents: "none" }}>{showsEmojiHover ? "🐵" : "🙈"}</span>
                  </div>
                )}
                <SearchShows
                  shows={shows}
                  onPick={handlePickFromSearch}
                  onShowCreated={(newShow, entry) => {
                    setShows(prev => [...prev, newShow]);
                    setWatchStatusFor(newShow.id, entry);
                    openShow(newShow.id);
                  }}
                  onAuthRequired={() => { setAuthHint("Sign in or open a new account in order to start a new show forum."); setShowAuthModal(true); }}
                  placeholder="find a show"
                  style={{ flex: isMobile ? undefined : 1, width: "auto", minWidth: 0, margin: 0, height: 40, boxSizing: "border-box" }}
                />
              </div>

              {/* Feature grid */}
              {(() => {
                const items: { Icon: React.ElementType; text: string }[] = [
                  { Icon: Tv,             text: "Find your show — search for any TV show and join the room." },
                  { Icon: ListCheck,      text: "Mark your progress — note the last episode you've watched, each time you join in. Everyone else does the same." },
                  { Icon: EyeClosed,      text: "Only see what's safe — Sidebar filters the room to your watch progress. No spoilers." },
                  { Icon: UsersRound,     text: "Invite your friends — share the room with the people you already love talking to." },
                  { Icon: MessagesSquare, text: "Talk freely — If you're behind, your friends' entries will wait for you. If you're ahead, friends will see your writing when they catch up. Everyone at their own pace, together." },
                  { Icon: Globe,          text: "Venture further — the room is open to the public. Others can read and respond to you. Filter the forum by your friends only, or let your conversation expand." },
                ];
                return (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr",
                    gap: 8,
                    maxWidth: 920,
                    width: "100%",
                    margin: "32px 16px 0",
                    padding: "0 16px",
                    boxSizing: "border-box",
                  }}>
                    {items.map(({ Icon, text }) => (
                      <div key={text} style={{
                        border: "none",
                        borderRadius: 16,
                        padding: isMobile ? "12px 12px" : "16px 18px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 8,
                        background: "#fff",
                      }}>
                        <Icon size={isMobile ? 20 : 24} color="var(--dos-bg)" strokeWidth={1.5} />
                        <span style={{ fontSize: isMobile ? 12 : 13, color: "var(--dos-bg)", fontWeight: 500, lineHeight: 1.4, textAlign: "center" }}>{text}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* BB demo entry — only shown to logged-out users */}
              {!user && (
                <div style={{ marginTop: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "#fff", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Breaking Bad (Demo Forum)
                  </span>
                  <button
                    className="btn"
                    onClick={() => { setPickShowMode("set"); setPickShowId("bb"); }}
                    style={{ fontSize: 15, padding: "8px 28px", borderRadius: 9999, whiteSpace: "nowrap", background: "#fff", color: "var(--dos-bg)", borderColor: "#fff" }}
                  >
                    Enter the demo
                  </button>
                </div>
              )}
            </div>
          )}

          {!expandedShowId && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 48 }}>
              {/* Beta message pill toggle */}
              <button
                onClick={() => setBetaOpen(o => !o)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 999,
                  boxShadow: "0 0 0 2px #fff",
                  border: "none",
                  overflow: "hidden",
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  gap: 0,
                }}
              >
                <span style={{
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: !betaOpen ? 700 : 400,
                  background: !betaOpen ? "var(--dos-border)" : "transparent",
                  color: !betaOpen ? "var(--dos-bg)" : "transparent",
                  whiteSpace: "nowrap",
                }}>
                  *click here beta tester!
                </span>
                <span style={{
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: betaOpen ? 700 : 400,
                  background: betaOpen ? "var(--dos-border)" : "transparent",
                  color: betaOpen ? "var(--dos-bg)" : "transparent",
                  whiteSpace: "nowrap",
                }}>
                  Hello!
                </span>
              </button>

              {betaOpen && (
                <div style={{ maxWidth: 460, width: "100%", padding: "0 16px", marginTop: 28, marginBottom: 60 }}>
                  <div style={{
                    background: "#fff",
                    borderRadius: 12,
                    padding: "20px 24px",
                    color: "var(--dos-bg)",
                    fontSize: 15,
                    lineHeight: 1.6,
                    fontWeight: 700,
                  }}>
                    Thank you for your time and mind.<br /><br />
                    I'm making this site because I love stories and I love thinking about them. If you're reading this right now, you are probably the same way and I probably love talking to you about said stories. That's the whole point here: to make it easier to have ongoing conversations about the TV shows that we love (or love to hate).<br /><br />
                    Considering how easy it is these days to watch shows new or old at different paces, I'm frankly surprised why something like Sidebar doesn't already exist. I hope you agree.<br /><br />
                    Hopefully everything on this beta version of the site is functional, even if not in its final form. Use the 'feedback' tab on the right to send your thoughts (large or small). Don't overthink it — your gut reactions are as important as your more considered thoughts. Just fire messages off as they occur to you.<br /><br />
                    The 'Breaking Bad (DEMO FORUM)' is where you can begin to get a sense of how things work. Have at it. You can't break anything and if you post anything that gives you deep existential regrets, I can remove / reset / delete it.<br /><br />
                    I'm excited to see how you use the site.<br /><br />
                    — Alborz
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showProfile && username && (
        <ProfilePage
          shows={shows}
          username={username}
          progress={progress}
          likesThreads={likesThreads}
          likesReplies={likesReplies}
          likedByUserThreads={likedByUserThreads}
          likedByUserReplies={likedByUserReplies}
          openThreadWithFocus={openThreadWithFocus}
          openShow={openShow}
          onClose={goHomepage}
          repliesToUser={repliesToUser}
          openedAtSeenAt={openedAtSeenAt}
          onTabsChange={setProfileTabData}
        />
      )}

      {publicProfileUsername && (
        <PublicProfilePage
          username={publicProfileUsername}
          shows={shows}
          viewerProgress={progress}
          openThreadWithFocus={openThreadWithFocus}
          openShow={openShow}
          onClose={goHomepage}
          onTabsChange={setProfileTabData}
        />
      )}

      {SINGLE_PAGE && !showProfile && expandedShowId && (
        <div>
          <ShowSection
            shows={shows}
            onShowUpdated={(updated: Show) => setShows(prev => prev.map(s => s.id === updated.id ? updated : s))}
            username={username ?? ""}
            showId={expandedShowId}
            progress={progress}
            updateProgressFor={updateProgressFor}
            clearRewatchFor={clearRewatchFor}
            onOpenFeedback={(prefill: string) => {
              setFeedbackPrefill(prefill);
              setFeedbackForcedOpen(true);
            }}
            newHighlights={newHighlights}
            setNewHighlights={setNewHighlights}
            visitedThreads={visitedThreads}
            setVisitedThreads={setVisitedThreads}
            activeThreadId={activeThreadId}
            setActiveThreadId={(tid: string | null) => {
              if (tid) navigate(`/show/${expandedShowId}/thread/${tid}`);
              else navigate(`/show/${expandedShowId}`);
            }}
            onHomepage={goHomepage}
            likesThreads={likesThreads}
            setLikesThreads={setLikesThreads}
            likesReplies={likesReplies}
            setLikesReplies={setLikesReplies}
            likedByUserThreads={likedByUserThreads}
            setLikedByUserThreads={setLikedByUserThreads}
            likedByUserReplies={likedByUserReplies}
            setLikedByUserReplies={setLikedByUserReplies}
            focusReplyId={focusReplyId}
            onAuthRequired={() => setShowAuthModal(true)}
            onClickProfile={handleClickProfile}
            showStaleNudge={showStaleNudge && !staleNudgeDismissed}
            onDismissStaleNudge={() => setStaleNudgeDismissed(true)}
            onSwitchShow={(id: string) => { setPickShowMode("confirm"); setPickShowId(id); }}
          />
        </div>
      )}

      {showAdmin && isAdmin && (
        <AdminPage
          shows={shows}
          onShowsChange={setShows}
          onShowDeleted={(showId) => {
            setShows(prev => prev.filter(s => s.id !== showId));
            setProgress(prev => { const n = { ...prev }; delete n[showId]; return n; });
            if (expandedShowId === showId) goHomepage();
          }}
          onClose={goHomepage}
        />
      )}

      {pickShow && (
        <Modal onClose={() => { setPickShowId(null); setPickShowMode("set"); setPendingNewShow(null); }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <h3 className="title" style={{ fontSize: 20, margin: 0 }}>
              {pickShowMode === "confirm" ? "Confirm or update your progress" : "Set your watch status"}
            </h3>
            <button className="btn" onClick={() => { setPickShowId(null); setPickShowMode("set"); setPendingNewShow(null); }}>✕</button>
          </div>

          {pickShowMode === "set" ? (
            /* ── First-time join: watch status questionnaire ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <p className="muted" style={{ fontSize: 14, marginTop: 0, marginBottom: 10 }}>
                  Are you rewatching <strong>{pickShow.name}</strong>, or is this your first time through?
                </p>
                <div style={{ display: "flex", gap: 12 }}>
                  {(["first", "rewatch"] as const).map(choice => (
                    <label key={choice} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}>
                      <input
                        type="radio"
                        name="watchStatus"
                        value={choice}
                        checked={watchStatusChoice === choice}
                        onChange={() => setWatchStatusChoice(choice)}
                      />
                      {choice === "first" ? "First time" : "Rewatching"}
                    </label>
                  ))}
                </div>
              </div>

              {watchStatusChoice === "rewatch" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>What's the furthest you watched last time?</label>
                    <EpisodeSelect show={pickShow} value={highestSel} onChange={setHighestSel} />
                  </div>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>How far are you on your rewatch?</label>
                    <EpisodeSelect show={pickShow} value={rewatchSel} onChange={setRewatchSel} />
                  </div>
                </div>
              )}

              {watchStatusChoice === "first" && (
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>How far have you watched?</label>
                  <EpisodeSelect show={pickShow} value={firstTimeSel} onChange={setFirstTimeSel} />
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <button className="btn" onClick={() => { setPickShowId(null); setPickShowMode("set"); setPendingNewShow(null); }}>Cancel</button>
                <button
                  className="btn primary"
                  disabled={!watchStatusChoice}
                  onClick={() => {
                    if (!watchStatusChoice) return;
                    let entry: ProgressEntry;
                    if (watchStatusChoice === "rewatch") {
                      entry = {
                        s: rewatchSel.s, e: rewatchSel.e,
                        isRewatching: true,
                        rewatchS: rewatchSel.s, rewatchE: rewatchSel.e,
                        highestS: highestSel.s, highestE: highestSel.e,
                      };
                    } else {
                      entry = { s: firstTimeSel.s, e: firstTimeSel.e, isRewatching: false };
                    }
                    if (pickShow.id === "bb") {
                      window.dispatchEvent(new CustomEvent("dock:progress", { detail: { showId: "bb", s: entry.s, e: entry.e } }));
                    }
                    setWatchStatusFor(pickShow.id, entry);
                    setPickShowId(null);
                    setPickShowMode("set");
                    setPendingNewShow(null);
                    openShow(pickShow.id);
                  }}
                >
                  {pickShow.isHidden === false && !progress[pickShow.id] ? "Create forum" : "Confirm"}
                </button>
              </div>
            </div>
          ) : (
            /* ── Confirm / update progress (returning user) ── */
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <OneSelectProgress
                  show={pickShow}
                  value={progress[pickShow.id] || { s: 1, e: 1 }}
                  onConfirm={(val) => {
                    setFirstSel(val);
                    updateProgressFor(pickShow.id, val);
                    setHasPendingChange(false);
                    setPickShowId(null);
                    setPickShowMode("set");
                    setPendingNewShow(null);
                    openShow(pickShow.id);
                  }}
                  onPendingChange={setHasPendingChange}
                  requireConfirm={false}
                  onChangeSelected={(val) => setFirstSel(val)}
                />
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button className="btn" onClick={() => { setPickShowId(null); setPickShowMode("set"); setPendingNewShow(null); }}>Cancel</button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      const chosen = firstSel || (progress[pickShow.id] || { s: 1, e: 1 });
                      if (pickShow.id === "bb") {
                        window.dispatchEvent(new CustomEvent("dock:progress", { detail: { showId: "bb", s: chosen.s, e: chosen.e } }));
                      }
                      updateProgressFor(pickShow.id, chosen);
                      setPickShowId(null);
                      setPickShowMode("set");
                      setPendingNewShow(null);
                      openShow(pickShow.id);
                    }}
                  >
                    Confirm
                  </button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
                Your feed will only show posts up to your selected episode.
              </p>
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}
