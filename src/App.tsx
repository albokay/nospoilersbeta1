import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { injectDOSStyles } from "./styles/theme";
import { seedShows, seedThreads, repliesByThread } from "./lib/mockData";
import { canView } from "./lib/utils";
import { fetchProgress, upsertProgress, fetchShows, fetchRepliesToUserThreads, fetchLikedThreads, fetchLikedReplies } from "./lib/db";
import { supabase } from "./lib/supabaseClient";
import type { Show } from "./lib/db";
import type { Reply, Thread } from "./types";
import { useAuth } from "./lib/auth";
import ExtensionDock from "./extensions/ExtensionDock";
import SearchShows from "./components/SearchShows";
import YourShowsSelect from "./components/YourShowsSelect";
import ShowSection from "./components/ShowSection";
import ProfilePage from "./components/ProfilePage";
import Modal from "./components/Modal";
import OneSelectProgress from "./components/OneSelectProgress";
import AuthModal from "./components/AuthModal";
import SidebarLogo from "./components/SidebarLogo";
import AdminPage from "./components/AdminPage";
import PublicProfilePage from "./components/PublicProfilePage";
import Tooltip from "./components/Tooltip";

const ADMIN_USER_ID = "b4b37a6c-1f14-4189-9347-6ddbcadb99a6";

const SINGLE_PAGE = true;
const GLOBAL_HEADER_H = 72;

export default function App() {
  useEffect(injectDOSStyles, []);

  const [shows, setShows] = useState<Show[]>([]);
  useEffect(() => {
    fetchShows().then(setShows).catch(() => setShows(
      seedShows.filter(s => s.id === "bb" || s.id === "simshow") as Show[]
    ));
  }, []);

  const { user, profile, loading: authLoading, signOut } = useAuth();
  const username = profile?.username ?? null;
  const [showAuthModal, setShowAuthModal] = useState(false);

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

  // Load progress from DB when user logs in; clear it when they log out
  useEffect(() => {
    if (!user) { setProgress({}); return; }
    fetchProgress(user.id).then(saved => {
      setProgress(saved);
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

  const [newHighlights, setNewHighlights] = useState<{ [sid: string]: { [tid: string]: true } }>({});
  const [visitedThreads, setVisitedThreads] = useState<{ [tid: string]: true }>({});

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
    if (user) {
      upsertProgress(user.id, sid, next.s, next.e).catch(err =>
        console.error("Failed to save progress:", err)
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
    navigate(`/user/${encodeURIComponent(name)}`);
    requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
  };

  const handlePickFromSearch = (showId: string) => {
    if (progress[showId]) {
      openShow(showId);
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
  const showAdmin = location.search.includes("admin");
  const isAdmin = user?.id === ADMIN_USER_ID;

  const header = (
    <header className="site bleed" style={{ borderBottom: isHomepage ? "none" : undefined }}>
      <div style={{ height: GLOBAL_HEADER_H, display: "flex", alignItems: "center", padding: "0 0", width: "100%" }}>
        {!isHomepage && (
          <div style={{ flex: "0 0 auto", marginLeft: 20 }}>
            <h1
              className="brand brandLink"
              style={{ margin: 0 }}
              tabIndex={0}
              aria-label="Go to homepage"
              onClick={goHomepage}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goHomepage(); } }}
            >
              <img src="/sidebar-logo.png" alt="sidebar" style={{ height: 38, width: "auto", display: "block" }} />
            </h1>
          </div>
        )}

        {!isHomepage && (
          <div className="siteTagline" style={{ flex: 1, margin: 0 }}>
            watch. together. whenever.
          </div>
        )}

        <div style={{ marginLeft: "auto", marginRight: 20, display: "flex", alignItems: "center", gap: 8 }}>
          {!authLoading && !user && (
            <button className="btn" onClick={() => setShowAuthModal(true)}>
              Sign in / Join
            </button>
          )}
          {!authLoading && user && username && (() => {
            const redExpired = !invisibleFirstSeenAt || Date.now() - invisibleFirstSeenAt >= THIRTY_SIX_HOURS;
            const pillBadge = hasVisibleNewReplies ? "green" : (!redExpired && invisibleShowName) ? "red" : null;
            const pillTooltipText =
              pillBadge === "green" ? "You have new replies to read!" :
              pillBadge === "red" ? `FYI: ${invisibleShowName} has replies beyond your progress! You'll see them once you catch up.` :
              null;
            const pillContent = (
              <div style={{ position: "relative", display: "inline-block" }}>
                <button
                  className="profileChip"
                  onClick={() => {
                    navigate("/profile");
                    requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
                  }}
                >
                  <span className="avatar">{username[0].toUpperCase()}</span>
                  <span style={{ fontWeight: 700, color: "var(--dos-fg)" }}>{username}</span>
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
              ? <Tooltip text={pillTooltipText} direction="below" align="right">{pillContent}</Tooltip>
              : pillContent;
          })()}
          {!authLoading && user && username && (
            <button className="btn" onClick={() => { goHomepage(); signOut(); }}>
              Sign out
            </button>
          )}
          {!authLoading && isAdmin && (
            <button className="btn" onClick={() => navigate("/?admin")} title="Admin" style={{ fontSize: 18 }}>
              ⚙
            </button>
          )}
        </div>
      </div>

    </header>
  );

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      {header}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {isHomepage && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "0 0 32px", position: "relative", zIndex: 95 }}>
          <SidebarLogo />
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "0.02em", color: "var(--dos-fg)" }}>
              watch. together. whenever.
            </span>
            <Tooltip text="A spoiler-safe TV forum built around your watch progress — no spoilers guaranteed." direction="right" align="center">
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--dos-fg)", opacity: 0.55, cursor: "default", userSelect: "none" }}>ℹ</span>
            </Tooltip>
          </div>
        </div>
      )}
      {!showProfile && !publicProfileUsername && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 28, placeItems: "center", marginTop: 36 }}>
            {user && (
              <YourShowsSelect
                shows={shows}
                progress={progress}
                value={""}
                onChange={(id) => {
                  if (!id) return;
                  setPickShowMode("confirm");
                  setPickShowId(id);
                }}
              />
            )}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
                Popular Right Now
              </div>
              <div style={{ fontSize: 26 }}>
                {["bb", "simshow"].map((id, idx, arr) => {
                  const s = shows.find(x => x.id === id);
                  if (!s) return null;
                  const sep = idx < arr.length - 1 ? " / " : "";
                  return (
                    <span key={id}>
                      <a onClick={() => handlePickFromSearch(id)} style={{ cursor: "pointer" }}>{s.name}</a>
                      {sep}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 24 }}>
            <SearchShows
              shows={shows}
              onPick={handlePickFromSearch}
              onShowCreated={(newShow) => {
                setShows(prev => [...prev, newShow]);
                setProgress(p => ({ ...p, [newShow.id]: { s: 1, e: 1 } }));
              }}
            />
          </div>

          {!expandedShowId && (
            <div className="homeAbout" style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ maxWidth: 460, width: "100%", padding: "30px 16px" }}>
                <p>** Hello friendly beta-tester!</p><br />
                <p>The BREAKING BAD forum is populated with posts (a.i. generated) that discuss the actual show. SIMULATED SHOW uses generic posts to help you understand the logic of the site.<br /><br />
                  On this mock site, you can create posts across all forums.<br /><br />
                  You can use the "find a show" search field to go to a new show forum. They are all empty for now.<br /><br />
                  The back and forward buttons on your browser window navigate within the site. Click and post with abandon!<br /><br />
                  — Alborz<br /><br />
                  🕓 <b>FUTURE FEATURE:</b> alerts about friends you're watching shows with. Have they caught up to you? Are they ahead? Are there new posts or replies about shows you're watching together? ⏳<br /><br /><br /></p>
              </div>
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
        />
      )}

      {SINGLE_PAGE && !showProfile && expandedShowId && (
        <div style={{ marginTop: 8 }}>
          <ShowSection
            shows={shows}
            onShowUpdated={(updated: Show) => setShows(prev => prev.map(s => s.id === updated.id ? updated : s))}
            username={username ?? ""}
            showId={expandedShowId}
            progress={progress}
            updateProgressFor={(sid: string, next: { s: number; e: number }) => {
              setProgress(prev => ({ ...prev, [sid]: next }));
              // Thread-visibility check is handled inside ShowSection's handleProgressConfirm,
              // which has access to the real dbThreads.
              if (user) {
                upsertProgress(user.id, sid, next.s, next.e).catch(err =>
                  console.error("Failed to save progress:", err)
                );
              }
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
