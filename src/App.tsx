import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { injectDOSStyles } from "./styles/theme";
import { seedShows, seedThreads, repliesByThread } from "./lib/mockData";
import { canView } from "./lib/utils";
import { fetchShows, fetchRepliesToUserThreads, fetchLikedThreads, fetchLikedReplies, fetchUnreadFeedbackCount } from "./lib/db";
import { supabase } from "./lib/supabaseClient";
import type { Show } from "./lib/db";
import type { Reply, Thread } from "./types";
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
import PublicProfilePage from "./components/PublicProfilePage";
import Tooltip from "./components/Tooltip";
import FeedbackWidget from "./components/FeedbackWidget";

const ADMIN_USER_ID = "b4b37a6c-1f14-4189-9347-6ddbcadb99a6";

const SINGLE_PAGE = true;
const GLOBAL_HEADER_H = 56;

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

  const [progress, setProgress] = useState<{ [sid: string]: { s: number; e: number } }>({});

  // Progress is session-only: clear on sign-out, do not persist to DB
  useEffect(() => {
    if (!user) { setProgress({}); }
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
  const pickShow = useMemo(() => shows.find(s => s.id === pickShowId) || null, [pickShowId, shows]);
  const [hasPendingChange, setHasPendingChange] = useState(false);
  const [firstSel, setFirstSel] = useState<{ s: number; e: number } | null>(null);
  const [pickShowMode, setPickShowMode] = useState<"set" | "confirm">("set");

  useEffect(() => {
    if (pickShowId) {
      const init = progress[pickShowId] || { s: 1, e: 1 };
      setFirstSel(init);
    }
  }, [pickShowId, progress]);

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

  const updateProgressFor = (sid: string, next: { s: number; e: number }) => {
    setProgress(prev => ({ ...prev, [sid]: next }));
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

  // ── Fixed ? button (homepage only) ──────────────────────────
  const fixedHelp = isHomepage ? (
    <div style={{ position: "fixed", top: 14, left: 14, zIndex: 1000 }}>
      <Tooltip text="A spoiler-safe TV forum built around your watch progress — no spoilers guaranteed." direction="below" align="left">
        <button className="btn" style={{ width: 30, height: 30, borderRadius: "50%", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, lineHeight: 1, background: "#fff", border: "none", outline: "none", color: "var(--dos-bg)" }}>
          ?
        </button>
      </Tooltip>
    </div>
  ) : null;

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
          onShowCreated={(newShow) => {
            setShows(prev => [...prev, newShow]);
            setProgress(p => ({ ...p, [newShow.id]: { s: 1, e: 1 } }));
          }}
          onAuthRequired={() => { setAuthHint("Sign in or open a new account in order to start a new show forum."); setShowAuthModal(true); }}
          style={{ width: 220, margin: 0, height: 34 }}
        />
      </span>
    </div>
  ) : null;

  // ── Fixed auth / profile / admin controls (top-right, all pages) ─
  const fixedAuth = (
    <div className="fixedAuthWrap" style={{ position: "fixed", top: 14, right: 14, zIndex: 1000, display: "flex", alignItems: "center", gap: 8 }}>
      {!isHomepage && !authLoading && user && (
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
      <FeedbackWidget isMobile={isMobile} />
      {showAuthModal && <AuthModal onClose={() => { setShowAuthModal(false); setAuthHint(null); }} hint={authHint ?? undefined} />}
      {!showProfile && !publicProfileUsername && (
        <>
          {/* ── Mobile homepage (no diary pages) ── */}
          {isHomepage && isMobile && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "0 0 32px", position: "relative", zIndex: 95, paddingTop: 64 }}>
              <SidebarLogo />
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "0.02em", color: "var(--dos-fg)" }}>
                  watch. together. whenever.
                </span>
              </div>
            </div>
          )}
          {!expandedShowId && isHomepage && isMobile && (
            <>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 16 }}>
                {user && (
                  <button
                    className="btn"
                    onClick={() => { navigate("/profile"); requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" })); }}
                    style={{ background: "var(--dos-user)", color: "#fff", border: "none", borderRadius: 9999, height: 40, width: 288, maxWidth: "90vw", fontSize: 15, fontWeight: 700, letterSpacing: "0.01em", position: "relative" }}
                  >
                    <span style={{ position: "absolute", left: "14%", top: "50%", transform: "translateY(-50%)", fontSize: 20, lineHeight: 1 }}>📓</span>
                    read your journal
                  </button>
                )}
                {user && (
                  <div style={{ position: "relative", width: 288, maxWidth: "90vw" }}>
                    <YourShowsSelect
                      shows={shows}
                      progress={progress}
                      value={""}
                      onChange={(id) => {
                        if (!id) return;
                        setPickShowMode("confirm");
                        setPickShowId(id);
                      }}
                      placeholder="your shows"
                      wrapperStyle={{ width: "100%" }}
                      onMouseEnter={() => setShowsEmojiHover(true)}
                      onMouseLeave={() => setShowsEmojiHover(false)}
                    />
                    <span style={{ position: "absolute", right: "8%", top: "50%", transform: "translateY(-50%)", fontSize: 20, lineHeight: 1, pointerEvents: "none" }}>{showsEmojiHover ? "🐵" : "🙈"}</span>
                  </div>
                )}
                <SearchShows
                  shows={shows}
                  onPick={handlePickFromSearch}
                  onShowCreated={(newShow) => {
                    setShows(prev => [...prev, newShow]);
                    setProgress(p => ({ ...p, [newShow.id]: { s: 1, e: 1 } }));
                  }}
                  onAuthRequired={() => { setAuthHint("Sign in or open a new account in order to start a new show forum."); setShowAuthModal(true); }}
                  placeholder="join a new show"
                  style={{ margin: 0 }}
                />
              </div>
              <div style={{ textAlign: "center", marginTop: 24 }}>
                <div className="popularHeading" style={{ fontSize: 16, fontWeight: 600, letterSpacing: 0.3, marginBottom: 10 }}>
                  trial forum:
                </div>
                <button
                  onClick={() => handlePickFromSearch("bb")}
                  style={{ background: "var(--dos-bg)", color: "#fff", border: "1.5px solid rgba(255,255,255,0.7)", borderRadius: 9999, padding: "6px 20px", fontSize: 15, fontWeight: 500, cursor: "pointer", letterSpacing: 0.2 }}
                >
                  Breaking Bad (DEMO)
                </button>
              </div>
            </>
          )}

          {!expandedShowId && isHomepage && !isMobile && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 56, paddingBottom: 20, zIndex: 95, position: "relative" }}>
              <SidebarLogo />
              <div style={{ marginTop: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "0.02em", color: "var(--dos-fg)" }}>
                  watch. together. whenever.
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 24, width: "100%" }}>
                {user && (
                  <button
                    className="btn"
                    onClick={() => { navigate("/profile"); requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" })); }}
                    style={{ background: "var(--dos-user)", color: "#fff", border: "none", borderRadius: 9999, height: 40, width: 288, maxWidth: "90%", fontSize: 15, fontWeight: 700, letterSpacing: "0.01em", position: "relative" }}
                  >
                    <span style={{ position: "absolute", left: "14%", top: "50%", transform: "translateY(-50%)", fontSize: 20, lineHeight: 1 }}>📓</span>
                    read your journal
                  </button>
                )}
                {user && (
                  <div style={{ position: "relative", width: 288, maxWidth: "90%" }}>
                    <YourShowsSelect
                      shows={shows}
                      progress={progress}
                      value={""}
                      onChange={(id) => {
                        if (!id) return;
                        setPickShowMode("confirm");
                        setPickShowId(id);
                      }}
                      placeholder="your shows"
                      wrapperStyle={{ width: "100%" }}
                      onMouseEnter={() => setShowsEmojiHover(true)}
                      onMouseLeave={() => setShowsEmojiHover(false)}
                    />
                    <span style={{ position: "absolute", right: "8%", top: "50%", transform: "translateY(-50%)", fontSize: 20, lineHeight: 1, pointerEvents: "none" }}>{showsEmojiHover ? "🐵" : "🙈"}</span>
                  </div>
                )}
                <SearchShows
                  shows={shows}
                  onPick={handlePickFromSearch}
                  onShowCreated={(newShow) => {
                    setShows(prev => [...prev, newShow]);
                    setProgress(p => ({ ...p, [newShow.id]: { s: 1, e: 1 } }));
                  }}
                  onAuthRequired={() => { setAuthHint("Sign in or open a new account in order to start a new show forum."); setShowAuthModal(true); }}
                  placeholder="join a new show"
                  style={{ margin: 0 }}
                />
              </div>

              <div style={{ textAlign: "center", marginTop: 48 }}>
                <div className="popularHeading" style={{ fontSize: 16, fontWeight: 600, letterSpacing: 0.3, marginBottom: 10 }}>
                  trial forum:
                </div>
                <button
                  onClick={() => handlePickFromSearch("bb")}
                  style={{ background: "var(--dos-bg)", color: "#fff", border: "1.5px solid rgba(255,255,255,0.7)", borderRadius: 9999, padding: "6px 20px", fontSize: 15, fontWeight: 500, cursor: "pointer", letterSpacing: 0.2 }}
                >
                  Breaking Bad (DEMO)
                </button>
              </div>
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
                    The BREAKING BAD (DEMO) forum is populated with posts (a.i. generated) that discuss the actual show. Feel free to use it as a playground to test things out.<br /><br />
                    But don't post anything you care about in there as it will regularly get purged and reset. If you actually want to start a diary or conversation about Breaking Bad, use the "join a new show" field…<br /><br />
                    "Join a new show" is how you either:<br /><br />
                    1) join an existing forum, or<br />
                    2) create the official public forum for your show (that everyone else can join).<br /><br />
                    Hope you enjoy using the site. And THANK YOU.<br /><br />
                    — Alborz<br /><br />
                    🕓 <b>FUTURE FEATURES:</b> there are a lot in the works. What would you like?? ⏳
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
            updateProgressFor={(sid: string, next: { s: number; e: number }) => {
              setProgress(prev => ({ ...prev, [sid]: next }));
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
        <Modal onClose={() => { setPickShowId(null); setPickShowMode("set"); }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <h3 className="title" style={{ fontSize: 20, margin: 0 }}>
              {pickShowMode === "confirm" ? "Confirm or update your progress" : "Set your progress"}
            </h3>
            <button className="btn" onClick={() => { setPickShowId(null); setPickShowMode("set"); }}>✕</button>
          </div>

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
                openShow(pickShow.id);
              }}
              onPendingChange={setHasPendingChange}
              requireConfirm={false}
              onChangeSelected={(val) => setFirstSel(val)}
            />
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => { setPickShowId(null); setPickShowMode("set"); }}>Cancel</button>
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
        </Modal>
      )}
    </section>
  );
}
