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
import { Tv, EyeClosed, Eye, EyeOff, UsersRound, ListCheck, Globe, Search, Rocket, MoveRight, MoveDown, X, Settings, BookOpen } from "lucide-react";
import PublicProfilePage from "./components/PublicProfilePage";
import Tooltip from "./components/Tooltip";
import FeedbackWidget from "./components/FeedbackWidget";
import HomepageLab from "./components/HomepageLab";
import HomepageNarrative from "./components/HomepageNarrative";
import InviteAcceptPage from "./components/InviteAcceptPage";

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
  if (pathParts[0] === "lab") return <HomepageLab />;
  if (pathParts[0] === "invite" && pathParts[1]) return <InviteAcceptPage token={pathParts[1]} />;
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
      // For logged-in users, only use what's actually saved in the DB.
      // BB appears only if they have a saved progress row for it.
      // Guests always get BB injected (handled above).
      setProgress({ ...saved });
    }).catch(err => console.error("Failed to load progress:", err));
  }, [user?.id]);

  // Navigate to journal after login
  const prevUserRef = useRef<typeof user>(user);
  useEffect(() => {
    if (prevUserRef.current === null && user !== null) {
      navigate("/profile");
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    }
    prevUserRef.current = user;
  }, [user]);

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
  const narrativeRef = useRef<HTMLDivElement>(null);
  const [gradientOpacity, setGradientOpacity] = useState(0);
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

  const openThreadWithFocus = (showId: string, threadId: string, replyId?: string, groupId?: string) => {
    setFocusReplyId(replyId || null);
    // Restore group context in sessionStorage so ShowSection opens the correct room
    if (groupId) {
      sessionStorage.setItem(`ns_active_group_${showId}`, groupId);
    } else {
      sessionStorage.removeItem(`ns_active_group_${showId}`);
    }
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
    document.body.classList.toggle("homepage", isHomepage);
  }, [isHomepage]);

  // Gradient fade-in tied to scroll progress through the narrative
  useEffect(() => {
    if (!isHomepage) { setGradientOpacity(0); return; }
    function onScroll() {
      const el = narrativeRef.current;
      if (!el) return;
      const raw = Math.min(Math.max(window.scrollY / el.offsetHeight, 0), 1);
      // Start at 15%, full power at ~75% (approx when finale copy is mid-screen)
      const progress = Math.min(Math.max((raw - 0.15) / 0.6, 0), 1);
      setGradientOpacity(progress);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHomepage]);
  const isProfilePage = showProfile || !!publicProfileUsername;
  const showAdmin = location.search.includes("admin");
  const isAdmin = !!profile?.is_admin;

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
        aria-label={user ? "Go to journal" : "Go to homepage"}
        onClick={user ? () => { navigate("/profile"); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" })); } : goHomepage}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); user ? navigate("/profile") : goHomepage(); } }}
      >
        <img src="/sidebar-logo.png" alt="sidebar" className="brandLogoImg" style={{ height: 38, width: "auto", display: "block" }} />
      </h1>
      <span className="mobileHide" style={{ display: "inline-flex" }}>
        <SearchShows
          shows={shows}
          onShowCreated={(newShow, entry, action) => {
            setShows(prev => prev.find(s => s.id === newShow.id) ? prev : [...prev, newShow]);
            setWatchStatusFor(newShow.id, entry);
            if (action === "journal") {
              navigate("/profile", { state: { activeTab: newShow.id } });
              requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
            } else {
              navigate(`/show/${newShow.id}`, { state: { openCreateGroup: true } });
              requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
            }
          }}
          onBrowsePublic={(showId, showName, _entry, seasons) => {
            // Add a temporary show entry to React state (not DB) so ShowSection
            // can render the correct name and seasons without a shows table row
            setShows(prev => prev.find(s => s.id === showId) ? prev : [...prev, {
              id: showId, name: showName, seasons, status: "Ended", isHidden: false,
            } as Show]);
            navigate(`/show/${showId}`);
            requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
          }}
          onAuthRequired={() => { setAuthHint("Sign in or create an account to start a journal or friend room."); setShowAuthModal(true); }}
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
          <span className="signOutX"><X size={14} /></span>
        </button>
      )}
      {!authLoading && isAdmin && (
        <div style={{ position: "relative", display: "inline-flex" }}>
          <button className="btn" onClick={() => navigate(showAdmin ? "/" : "/?admin")} title="Admin" style={{ fontSize: 18 }}>
            <Settings size={18} color="currentColor" />
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
            <>
              {/* ── Gradient fade-in overlay (fixed, tracks narrative scroll) ── */}
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, height: 220,
                background: "linear-gradient(to bottom, #c8e4b0 0px, transparent 180px)",
                opacity: gradientOpacity,
                pointerEvents: "none",
                zIndex: 0,
              }} />

              {/* ── Scrolling narrative ── */}
              <div ref={narrativeRef} style={{ width: "100vw", marginLeft: "calc(-50vw + 50%)" }}>
                <HomepageNarrative headerHeight={GLOBAL_HEADER_H} />
              </div>

              {/* ── Existing homepage content (logo now lives in narrative) ── */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 0, paddingBottom: 24, zIndex: 95, position: "relative", width: "100vw", marginLeft: "calc(-50vw + 50%)" }}>

              {/* Hero headline — no subtext */}
              <p style={{
                maxWidth: 880, textAlign: "center",
                margin: "80px 16px 40px",
                fontSize: isMobile ? 20 : 32, fontWeight: 800,
                color: "#fff", lineHeight: 1.3,
              }}>
                {isMobile ? (
                  <>
                    Watching TV with friends usually<br />
                    means spoilers or keeping quiet.<br />
                    <em>Not on Sidebar.</em>
                  </>
                ) : (
                  <>
                    <span style={{ whiteSpace: "nowrap" }}>Watching TV with friends usually</span><br />
                    <span style={{ whiteSpace: "nowrap" }}>means spoilers or keeping quiet.</span><br />
                    <em>Not on Sidebar.</em>
                  </>
                )}
              </p>

              {/* Logged-in shortcuts — journal + shows, no SearchShows */}
              {user && (
                <div style={{
                  display: "flex", flexDirection: isMobile ? "column" : "row",
                  alignItems: "stretch", gap: 8,
                  width: isMobile ? "min(288px, 90vw)" : "100%",
                  maxWidth: isMobile ? undefined : 960,
                  padding: isMobile ? 0 : "0 16px",
                  boxSizing: "border-box", marginBottom: 16,
                }}>
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
                    <span style={{ position: "absolute", left: "12%", top: "50%", transform: "translateY(-50%)", fontSize: 20, lineHeight: 1 }}><BookOpen size={16} color="var(--icon-color)" /></span>
                    read your journal
                  </button>
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
                    <span style={{ position: "absolute", right: "8%", top: "50%", transform: "translateY(-50%)", fontSize: 20, lineHeight: 1, pointerEvents: "none" }}>{showsEmojiHover ? <Eye size={16} color="currentColor" /> : <EyeOff size={16} color="currentColor" />}</span>
                  </div>
                </div>
              )}

              {/* "How?" */}
              <p style={{
                fontSize: isMobile ? 20 : 26, fontWeight: 800,
                color: "#fff", margin: "8px 16px 16px", textAlign: "center",
              }}>
                How?
              </p>

              {/* Feature grid — 5 steps, single icon + number, boxes 3 & 4 highlighted */}
              {(() => {
                const items: { Icon: React.ElementType; text: string; highlight: boolean }[] = [
                  { Icon: Search,     text: "Find your show and join its room.", highlight: false },
                  { Icon: UsersRound, text: "Invite your friends. Share the room with the people you love to talk to.", highlight: false },
                  { Icon: ListCheck,  text: "All of you log the last episode you watched each time you sign in. Sidebar filters the room to everyone's unique watch progress.", highlight: true },
                  { Icon: Eye,        text: "Nothing you read is ahead of where you are. Whether behind or ahead, everyone's entries wait until they're ready.", highlight: true },
                  { Icon: Rocket,     text: "Venture further — you can decide if you want a public or private room. Friends only, or let your conversation expand?", highlight: false },
                ];
                return (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                    gap: 8,
                    maxWidth: isMobile ? undefined : 840,
                    width: isMobile ? "min(288px, 90vw)" : "100%",
                    margin: "0 0 0",
                    padding: isMobile ? 0 : "0 16px",
                    boxSizing: "border-box",
                  }}>
                    {items.map(({ Icon, text, highlight }, idx) => {
                      const isLast = idx === items.length - 1;
                      const iconColor = highlight ? "var(--dos-bg)" : "#fff";
                      const numColor = highlight ? "var(--dos-bg)" : "rgba(255,255,255,0.6)";
                      return (
                        <div key={text} style={{
                          borderRadius: 16,
                          padding: isMobile ? "12px 14px" : "16px 18px",
                          display: "flex",
                          flexDirection: isMobile ? "row" : "column",
                          alignItems: "center",
                          gap: isMobile ? 14 : 8,
                          background: highlight ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.18)",
                          gridColumn: (!isMobile && isLast) ? "1 / -1" : undefined,
                        }}>
                          {/* Number + icon, always stacked and centered */}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                            <span style={{ fontSize: 16, fontWeight: 800, color: numColor, lineHeight: 1 }}>
                              {idx + 1}.
                            </span>
                            <Icon size={isMobile ? 18 : 22} color={iconColor} strokeWidth={1.5} />
                          </div>
                          <span style={{
                            fontSize: isMobile ? 12 : 13,
                            color: highlight ? "var(--dos-bg)" : "#fff",
                            fontWeight: highlight ? 600 : 500,
                            lineHeight: 1.4,
                            textAlign: isMobile ? "left" : "center",
                          }}>{text}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* BB demo — only shown to logged-out users */}
              {!user && (
                <div style={{ marginTop: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, color: "#fff", fontWeight: 600, lineHeight: 1.5 }}>
                    See how it works in a mock room:
                  </span>
                  <button
                    className="btn"
                    onClick={() => { setPickShowMode("set"); setPickShowId("bb"); }}
                    style={{ fontSize: 15, padding: "8px 28px", borderRadius: 9999, whiteSpace: "nowrap", background: "#fff", color: "var(--dos-bg)", borderColor: "#fff", letterSpacing: "0.04em", fontWeight: 700 }}
                  >
                    LET WALTER WHITE BE YOUR GUIDE
                  </button>
                </div>
              )}

              {/* Find a show — non-functional teaser for logged-out, functional for logged-in */}
              <div style={{
                marginTop: 36, marginBottom: 8,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
                maxWidth: isMobile ? "min(288px, 90vw)" : 480,
                width: "100%", textAlign: "center",
                padding: isMobile ? "0 16px" : 0,
              }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 500, lineHeight: 1.6 }}>
                  The site is in early beta so there's not much to see yet in public spaces. Eventually you can explore public show rooms with the same no-spoiler mechanics as a friends-only room.
                </span>
                <SearchShows
                  shows={shows}
                  onShowCreated={(newShow, entry, action) => {
                    setShows(prev => prev.find(s => s.id === newShow.id) ? prev : [...prev, newShow]);
                    setWatchStatusFor(newShow.id, entry);
                    if (action === "journal") {
                      navigate("/profile", { state: { activeTab: newShow.id } });
                      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
                    } else {
                      navigate(`/show/${newShow.id}`, { state: { openCreateGroup: true } });
                      requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
                    }
                  }}
                  onBrowsePublic={(showId, showName, _entry, seasons) => {
                    setShows(prev => prev.find(s => s.id === showId) ? prev : [...prev, {
                      id: showId, name: showName, seasons, status: "Ended", isHidden: false,
                    } as Show]);
                    navigate(`/show/${showId}`);
                    requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
                  }}
                  onAuthRequired={() => { setAuthHint("Sign in or create an account to start a journal or friend room."); setShowAuthModal(true); }}
                  placeholder="find a show"
                  style={{ width: "100%", minWidth: 0, margin: 0, height: 40, boxSizing: "border-box" }}
                />
              </div>
            </div>
            </>
          )}

          {!expandedShowId && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 48, paddingBottom: 96 }}>
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
          updateProgressFor={updateProgressFor}
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
            <button className="close-x" onClick={() => { setPickShowId(null); setPickShowMode("set"); setPendingNewShow(null); }}><X size={14} /></button>
          </div>

          {pickShowMode === "set" ? (
            /* ── First-time join: watch status questionnaire ── */
            pickShow.id === "bb" ? (
              /* ── BB Demo: explanatory text + direct episode select ── */
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 14, lineHeight: 1.65, color: "inherit", display: "flex", flexDirection: "column", gap: 10 }}>
                  <p style={{ margin: 0 }}>You're about to enter a demo room for the show Breaking Bad. The posts inside are not from real users.</p>
                  <p style={{ margin: 0 }}>Once inside, you can make posts, change your watch progress, leave responses, and everything else you can do in a real forum. You'll get assigned an anonymous username while you're in there. Once you leave the room, everything you've done there will be reset and deleted. Think of it as a play pen.</p>
                  <p style={{ margin: 0 }}>The most important thing is to get a sense of how the no-spoiler mechanics work.</p>
                  <p style={{ margin: 0 }}>Once you get the hang of it, you can sign up and invite some friends to start a real functioning room.</p>
                  <p style={{ margin: 0 }}>Now time to set your initial progress for the room.</p>
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>What is the last episode of Breaking Bad you have watched?</label>
                  <EpisodeSelect show={pickShow} value={firstTimeSel} onChange={setFirstTimeSel} />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  <button className="btn" onClick={() => { setPickShowId(null); setPickShowMode("set"); setPendingNewShow(null); }}>Cancel</button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      const entry: ProgressEntry = { s: firstTimeSel.s, e: firstTimeSel.e, isRewatching: false };
                      window.dispatchEvent(new CustomEvent("dock:progress", { detail: { showId: "bb", s: entry.s, e: entry.e } }));
                      setWatchStatusFor(pickShow.id, entry);
                      setPickShowId(null);
                      setPickShowMode("set");
                      setPendingNewShow(null);
                      openShow(pickShow.id);
                    }}
                  >
                    Enter demo
                  </button>
                </div>
              </div>
            ) : (
            /* ── Regular show: first-time / rewatch questionnaire ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <p className="muted" style={{ fontSize: 14, marginTop: 0, marginBottom: 10 }}>
                  Are you rewatching <strong>{pickShow.name}</strong>, or is this your first time through?
                </p>
                <div style={{ display: "flex", gap: 20 }}>
                  {(["first", "rewatch"] as const).map(choice => (
                    <div key={choice} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }} onClick={() => setWatchStatusChoice(choice)}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, border: "none", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {watchStatusChoice === choice && <div className="radio-dot" style={{ width: 10, height: 10, borderRadius: "50%", background: "#7abd8e" }} />}
                      </div>
                      {choice === "first" ? "First time" : "Rewatching"}
                    </div>
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
                    setWatchStatusFor(pickShow.id, entry);
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
            )
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
