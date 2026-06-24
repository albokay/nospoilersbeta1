import React, { useState, useMemo, useEffect, useRef, Suspense, lazy } from "react";
import LoadingDots from "./components/LoadingDots";
import SidebarAvatar from "./components/SidebarAvatar";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { injectDOSStyles } from "./styles/theme";
import { seedShows, seedThreads, repliesByThread } from "./lib/mockData";
import { canView } from "./lib/utils";
import { fetchProgress, upsertProgress, upsertRewatchStatus, clearRewatchMode, fetchShows, fetchRepliesToUserThreads, fetchLikedThreads, fetchLikedReplies, fetchUnreadFeedbackCount, fetchAllFriendGroupsWithActivity, fetchUndismissedPingCountsByShow, markTabCreated } from "./lib/db";
import { getCachedProgress, setCachedProgress } from "./lib/journalCache";
import { supabase } from "./lib/supabaseClient";
import type { Show } from "./lib/db";
import type { Reply, Thread, ProgressEntry, FriendGroup } from "./types";
import { useAuth } from "./lib/auth";
import ExtensionDock from "./extensions/ExtensionDock";
import SearchShows from "./components/SearchShows";
import ShowSection from "./components/ShowSection";
import ProfilePage, { type ProfileTabData } from "./components/ProfilePage";
import V3JournalPage from "./components/V3JournalPage";
import Modal from "./components/Modal";
import OneSelectProgress from "./components/OneSelectProgress";
import AuthModal from "./components/AuthModal";
import SidebarLogo from "./components/SidebarLogo";
// Code-split route components — Tier 1.2 perf pass. These are either
// rarely-visited (admin, lab, how-it-works variants) OR scoped to a path
// the user takes once or never (invite, reset-password, mobile, v2). Each
// is fetched as its own chunk on first visit; main bundle excludes them.
// V3JournalPage + ProfilePage + ShowSection stay eager — they're the
// primary destinations for every signed-in user.
const AdminPage = lazy(() => import("./components/AdminPage"));
import { Tv, EyeClosed, UsersRound, ListCheck, Globe, Search, Rocket, X, Settings, BookOpen, BookMarked, ArrowLeft, ArrowRight, ArrowDown, DoorOpen, UserPlus, ClipboardList, MessageSquareText, Blend, ShieldCheck, LogOut, UserPen } from "lucide-react";
import PublicProfilePage from "./components/PublicProfilePage";
import Tooltip from "./components/Tooltip";
import FeedbackWidget from "./components/FeedbackWidget";
// MobileLockout component is no longer rendered — mobile users on any
// non-/m/* path now redirect into the /m/* mobile app surface (which
// itself handles signed-in vs signed-out routing). The component file
// stays in src/components/ as a fallback if we ever want to revert.
const HomepageLab = lazy(() => import("./components/HomepageLab"));
const HowItWorks = lazy(() => import("./components/HowItWorks"));
const HowItWorksV2 = lazy(() => import("./components/HowItWorksV2"));
import HomepageNarrative from "./components/HomepageNarrative";
const InviteAcceptPage = lazy(() => import("./components/InviteAcceptPage"));
const AllowResponsePage = lazy(() => import("./components/AllowResponsePage"));
const MobileApp = lazy(() => import("./mobile/MobileApp"));
// Promoted V2 surfaces (formerly /v2/...). Each chunked individually so the
// main bundle stays lean for users who only visit one or two of these.
const V2FriendRoomPage = lazy(() => import("./components/v2/V2FriendRoomPage"));
const V2ProfileSelfPage = lazy(() => import("./components/v2/V2ProfileSelfPage"));
const V2ProfileVisitorPage = lazy(() => import("./components/v2/V2ProfileVisitorPage"));
const V2UserAggregatePage = lazy(() => import("./components/v2/V2UserAggregatePage"));
const V2ComposePage = lazy(() => import("./components/v2/V2ComposePage"));
const ResetPasswordPage = lazy(() => import("./components/ResetPasswordPage"));
// Restructure (groups + show rooms): the new green home. Working route that
// coexists with the live site until the gated cutover promotes it to home.
const DashboardPage = lazy(() => import("./components/DashboardPage"));
const GroupInviteAcceptPage = lazy(() => import("./components/GroupInviteAcceptPage"));
const ShowRoomPage = lazy(() => import("./components/ShowRoomPage"));
const PublicDashboardPage = lazy(() => import("./components/PublicDashboardPage"));

// Full-screen fallback for lazy chunks. Matches the canon palette so the
// transition from main bundle → lazy chunk doesn't flash white. Only
// renders for the (usually <100ms) window between chunk request and parse.
function RouteFallback() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--dos-bg)",
      color: "var(--dos-fg)",
    }}>
      <LoadingDots />
    </div>
  );
}

const GLOBAL_HEADER_H = 96;

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

// Top-level router. Keeps useEffect + useLocation as the only hooks called here,
// in a fixed order on every render, so the early-return special routes don't
// change the hook count between renders. The full desktop UI lives in
// <AppShell /> below, which mounts only when none of the special routes match.
// See HANDOFF.md §6 item 19 for the bug class this refactor addresses.
export default function App() {
  useEffect(injectDOSStyles, []);
  const location = useLocation();
  const pathParts = location.pathname.split("/").filter(Boolean);
  // CP7 navigation cutover: the restructured world (dashboard / show rooms) is
  // desktop-only, so the legacy-route redirects below apply to DESKTOP only.
  // On mobile (<768px) every old route falls through to its existing handling
  // (the /m surface + mobile lockout are left entirely untouched — §15.7).
  const onMobile = typeof window !== "undefined" && window.innerWidth < 768;
  if (pathParts[0] === "lab") return <Suspense fallback={<RouteFallback />}><HomepageLab /></Suspense>;
  if (pathParts[0] === "how-it-works") return <Suspense fallback={<RouteFallback />}><HowItWorksV2 /></Suspense>;
  if (pathParts[0] === "how-it-works-v1") return <Suspense fallback={<RouteFallback />}><HowItWorks /></Suspense>;
  if (pathParts[0] === "how-it-works-v2") return <Suspense fallback={<RouteFallback />}><HowItWorksV2 /></Suspense>;
  if (pathParts[0] === "invite" && pathParts[1]) {
    // Viewport-detect: redirect mobile users to the mobile invite-accept
    // route. The email link is a single static URL; the front-end forks
    // here on viewport so mobile recipients land in /m's UI rather than
    // hitting the desktop modal-style InviteAcceptPage on a phone.
    // Admins included in the redirect by design — mobile invite-accept
    // is the correct UX at <768px regardless of role.
    if (onMobile) {
      return <Navigate to={`/m/invite/${pathParts[1]}`} replace />;
    }
    // CP7: legacy friend-room invites are retired in the new world. No pending
    // ones need to keep working (confirmed), so land desktop visitors on the
    // dashboard rather than the old accept page.
    return <Navigate to="/dashboard" replace />;
  }
  // Public-rooms "Allow" link from the response-request email (2026). Sits
  // above AppShell so the owner (a signed-in non-admin) isn't bounced to
  // /journal by the auth-routing redirect before they can approve. The page
  // prompts sign-in itself when needed; approval is RPC-gated to the owner.
  if (pathParts[0] === "allow-response" && pathParts[1]) {
    return <Suspense fallback={<RouteFallback />}><AllowResponsePage id={pathParts[1]} /></Suspense>;
  }
  if (pathParts[0] === "m") return <Suspense fallback={<RouteFallback />}><MobileApp /></Suspense>;
  // ── Backward-compat redirects for the URL promotion (2026-05-27) ───
  // /v2/* and /v3/journal were promoted to clean URLs. Old paths redirect
  // so bookmarks, in-flight links, and any cached navigation calls keep
  // working. /user/:username also redirects to /u/:username (the V2 visitor
  // profile is now the official one). V1 ShowSection at /show/:showId is
  // NOT promoted — it stays as-is.
  if (pathParts[0] === "v2") {
    const seg = pathParts[1];
    if (seg === "profile") return <Navigate to="/profile" replace />;
    if (seg === "journal") return <Navigate to="/journal" replace />;
    if (seg === "room" && pathParts[2]) return <Navigate to={`/room/${pathParts[2]}`} replace />;
    if (seg === "compose" && pathParts[2]) return <Navigate to={`/compose/${pathParts[2]}`} replace />;
    if (seg === "u" && pathParts[2]) {
      const username = pathParts[2];
      if (pathParts[3] === "show" && pathParts[4] && pathParts[5] === "posts") {
        return <Navigate to={`/u/${username}/show/${pathParts[4]}/posts`} replace />;
      }
      return <Navigate to={`/u/${username}`} replace />;
    }
    // Fallback for any other /v2/* path — land on the journal.
    return <Navigate to="/journal" replace />;
  }
  if (pathParts[0] === "v3" && pathParts[1] === "journal") {
    return <Navigate to="/journal" replace />;
  }
  if (pathParts[0] === "user" && pathParts[1]) {
    return <Navigate to={`/u/${pathParts[1]}`} replace />;
  }
  // /reset-password is a top-level utility route. It MUST sit above
  // AppShell so the recovery token (parsed from the URL hash by
  // supabase-js on page load) isn't disturbed by AppShell's auth
  // redirects, mobile lockout, or v2/v3 chrome. BetaGate also exempts
  // this path. See docs/sidebar_spec_password_reset.md.
  // ── Promoted V2 surfaces — top-level short-circuits ────────────────
  // V2 surfaces ship their own full-width chrome via V2Layout. Mounting
  // them INSIDE AppShell would double the chrome (two logos, two sign-
  // out buttons) AND squish the content column to AppShell's
  // .container { width: min(672px, 92vw) } max-width. The original
  // pre-promotion architecture mounted /v2/* outside AppShell for
  // exactly this reason — these short-circuits preserve that.
  //
  // Auth-gate is intentionally NOT enforced here for /profile / /room /
  // /compose — the V2 components handle no-user state internally
  // (matches their pre-promotion behavior at /v2/*).
  if (pathParts[0] === "profile" && !pathParts[1]) {
    // CP7: the profile page is retired in the new world → dashboard (desktop).
    if (!onMobile) return <Navigate to="/dashboard" replace />;
    return <Suspense fallback={<RouteFallback />}><V2ProfileSelfPage /></Suspense>;
  }
  if (pathParts[0] === "room" && pathParts[1]) {
    // CP7: legacy friend rooms → the new (group × show) show room (desktop).
    // The id lines up (a parented friend_groups row IS the show-room roomId).
    // Preserve ?entry= so already-sent digest deep-links open the right post.
    if (!onMobile) return <Navigate to={`/show-room/${pathParts[1]}${location.search}`} replace />;
    return <Suspense fallback={<RouteFallback />}><V2FriendRoomPage groupId={pathParts[1]} /></Suspense>;
  }
  if (pathParts[0] === "compose" && pathParts[1]) {
    return <Suspense fallback={<RouteFallback />}><V2ComposePage showId={pathParts[1]} /></Suspense>;
  }
  if (pathParts[0] === "u" && pathParts[1]) {
    const username = decodeURIComponent(pathParts[1]);
    // CP7: public profiles + the per-show aggregate are retired → the new
    // read-only show pool (desktop). Mobile keeps the old visitor profile.
    if (!onMobile) return <Navigate to={`/pool/${encodeURIComponent(username)}`} replace />;
    if (pathParts[2] === "show" && pathParts[3] && pathParts[4] === "posts") {
      return <Suspense fallback={<RouteFallback />}><V2UserAggregatePage username={username} showId={pathParts[3]} /></Suspense>;
    }
    return <Suspense fallback={<RouteFallback />}><V2ProfileVisitorPage username={username} /></Suspense>;
  }
  if (pathParts[0] === "reset-password") return <Suspense fallback={<RouteFallback />}><ResetPasswordPage /></Suspense>;
  // Restructure dashboard (groups + show rooms). Self-contained like the V2
  // surfaces; redirects to "/" when signed-out (handled inside DashboardPage).
  if (pathParts[0] === "dashboard" && !pathParts[1]) {
    return <Suspense fallback={<RouteFallback />}><DashboardPage /></Suspense>;
  }
  // Restructure people-group invite accept (separate from /invite/:token).
  if (pathParts[0] === "group-invite" && pathParts[1]) {
    return <Suspense fallback={<RouteFallback />}><GroupInviteAcceptPage token={pathParts[1]} /></Suspense>;
  }
  // Public read-only view of a user's show pool (restructure; reached from the
  // show room's member-name clicks). Distinct from the live /u/:username profile.
  if (pathParts[0] === "pool" && pathParts[1]) {
    return <Suspense fallback={<RouteFallback />}><PublicDashboardPage username={decodeURIComponent(pathParts[1])} /></Suspense>;
  }
  // Dashboard "write by yourself" — private-only standalone for a show (no group).
  if (pathParts[0] === "show-room" && pathParts[1] === "private" && pathParts[2]) {
    return <Suspense fallback={<RouteFallback />}><ShowRoomPage privateShowId={pathParts[2]} /></Suspense>;
  }
  // Restructure (group × show) room — two tabs (separate from legacy /room/:id).
  if (pathParts[0] === "show-room" && pathParts[1]) {
    return <Suspense fallback={<RouteFallback />}><ShowRoomPage roomId={pathParts[1]} /></Suspense>;
  }
  // CP7: the old journal home is retired → dashboard (desktop). Signed-out
  // visitors bounce on to "/" from DashboardPage. Mobile keeps its own surface.
  if (pathParts[0] === "journal" && !pathParts[1] && !onMobile) {
    return <Navigate to="/dashboard" replace />;
  }
  return <AppShell />;
}

function AppShell() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 600);
  // Viewports narrower than 768px see the mobile lockout screen (admins
  // exempted — checked at render time). Separate from isMobile, which only
  // governs layout density for signed-in users.
  const [isMobileLocked, setIsMobileLocked] = useState(() => window.innerWidth < 768);
  // Below 1134px the header stacks into two rows; the tall dynamic logo
  // crowds that layout, so we fall back to the original static png there.
  const [isNarrowHeader, setIsNarrowHeader] = useState(() => window.innerWidth < 1134);
  useEffect(() => {
    const fn = () => {
      setIsMobile(window.innerWidth <= 600);
      setIsMobileLocked(window.innerWidth < 768);
      setIsNarrowHeader(window.innerWidth < 1134);
    };
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
  const [showAuthModal, setShowAuthModal] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("signup");
  });
  const [authInitialMode, setAuthInitialMode] = useState<"signin" | "signup">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("signup") ? "signup" : "signin";
  });
  const [authHint, setAuthHint] = useState<string | null>(null);
  // Bumped each time the user clicks the dynamic header logo. Used as the
  // SidebarLogo's React key so clicking remounts it and replays the
  // block-scatter animation (the click also navigates to /profile).
  const [headerLogoResetKey, setHeaderLogoResetKey] = useState(0);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [feedbackForcedOpen, setFeedbackForcedOpen] = useState(false);
  const [feedbackPrefill, setFeedbackPrefill] = useState("");

  // ── URL-driven navigation (React Router) ─────────────────────
  const navigate = useNavigate();
  const location = useLocation();

  // Derive all nav state from the URL so the browser's back/forward buttons
  // work automatically — no manual pushState needed.
  //   /                                       → homepage
  //   /show/:showId                           → V1 ShowSection (public-aggregate)
  //   /show/:showId/thread/:id                → V1 thread view
  //   /profile                                → V2 self profile (promoted)
  //   /journal                                → V3 journal (promoted)
  //   /room/:groupId                          → V2 friend room (promoted)
  //   /compose/:showId                        → V2 compose (promoted)
  //   /u/:username                            → V2 visitor profile (promoted)
  //   /u/:username/show/:showId/posts         → V2 user aggregate (promoted)
  //   /legacy/profile                         → V1 ProfilePage (archived)
  //   /legacy/user/:username                  → V1 PublicProfilePage (archived)
  const pathParts = location.pathname.split("/").filter(Boolean);
  // Special routes (/lab, /how-it-works*, /invite/:token, /v2/*, /v3/*,
  // /user/*) are handled by the top-level <App /> router above and never
  // reach this component.
  const expandedShowId   = pathParts[0] === "show" ? (pathParts[1] ?? null) : null;
  const activeThreadId   = pathParts[0] === "show" && pathParts[2] === "thread" ? (pathParts[3] ?? null) : null;
  // /profile — promoted V2 self profile (was V1 ProfilePage before the URL
  // promotion arc).
  const showProfile      = location.pathname === "/profile";
  // /journal — promoted V3 journal (was /v3/journal). Tracked separately
  // so post-fetch effects, seen-at logic, and reply-fetch deps still fire
  // on journal navigation specifically.
  const showJournal      = pathParts[0] === "journal" && !pathParts[1];
  // /room/:groupId — V2 friend room
  const roomGroupId      = pathParts[0] === "room" ? (pathParts[1] ?? null) : null;
  // /compose/:showId — V2 compose page
  const composeShowId    = pathParts[0] === "compose" ? (pathParts[1] ?? null) : null;
  // /u/:username — V2 visitor profile (when no further path segments)
  const visitorUsername  = pathParts[0] === "u" && pathParts[1] && !pathParts[2]
    ? decodeURIComponent(pathParts[1])
    : null;
  // /u/:username/show/:showId/posts — V2 user aggregate
  const userAggregate    = pathParts[0] === "u" && pathParts[1] && pathParts[2] === "show" && pathParts[3] && pathParts[4] === "posts"
    ? { username: decodeURIComponent(pathParts[1]), showId: pathParts[3] }
    : null;
  // /legacy/profile — V1 ProfilePage archived (fallback for the journal
  // surface; the V1 component is unchanged, just relocated)
  const showLegacyProfile = location.pathname === "/legacy/profile";
  // /legacy/user/:username — V1 PublicProfilePage archived
  const legacyPublicProfileUsername = pathParts[0] === "legacy" && pathParts[1] === "user" && pathParts[2]
    ? decodeURIComponent(pathParts[2])
    : null;

  // focusReplyId is still ephemeral state — it is set programmatically when
  // navigating from a notification, and cleared by RepliesList after scrolling.
  const [focusReplyId, setFocusReplyId] = useState<string | null>(null);

  const [progress, setProgress] = useState<Record<string, ProgressEntry>>({ bb: { s: 1, e: 1 } });

  // Hidden tabs (read from localStorage so switch-shows dropdown excludes them)
  const hiddenTabs = useMemo<Set<string>>(() => {
    if (!user) return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(`ns_hidden_tabs_${user.id}`) || "[]")); } catch { return new Set(); }
  }, [user]);

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

  // Load progress from DB when user logs in; clear it when they log out.
  // Hydrate-then-refresh: read the localStorage cache first so the journal
  // page (and anything else gated on progress) renders immediately on
  // returning visits, then re-fetch in the background and reconcile.
  // Cache TTL is 1 hour; outside that window we fall through to the
  // network fetch and show the spinner. See lib/journalCache.
  useEffect(() => {
    if (!user) { setProgress({ bb: { s: 1, e: 1 } }); return; }
    const cached = getCachedProgress(user.id);
    if (cached) setProgress({ ...cached });
    fetchProgress(user.id).then(saved => {
      // For logged-in users, only use what's actually saved in the DB.
      // BB appears only if they have a saved progress row for it.
      // Guests always get BB injected (handled above).
      setProgress({ ...saved });
      setCachedProgress(user.id, saved);
    }).catch(err => console.error("Failed to load progress:", err));
  }, [user?.id]);

  // Navigate to journal after login — but not on page refresh.
  //
  // Auth boots async: on every page load, `user` starts null and then becomes
  // the session user once supabase.auth.getSession() resolves. Without a
  // guard, that null → user transition on boot masquerades as a fresh login
  // and overrides the URL the user actually refreshed at.
  //
  // Fix: wait for authLoading to settle. The first time the effect runs with
  // authLoading=false, we snapshot the current user as the baseline and do
  // nothing. Subsequent null → user transitions (genuine sign-in or sign-up
  // during the session) navigate to /profile as intended.
  const hasSettledRef = useRef(false);
  const prevUserRef = useRef<typeof user>(null);
  const justSignedInRef = useRef(false);
  useEffect(() => {
    if (authLoading) return;
    if (!hasSettledRef.current) {
      prevUserRef.current = user;
      hasSettledRef.current = true;
      return;
    }
    if (prevUserRef.current === null && user !== null) {
      // Defer the actual navigation until the profile row loads so we can
      // branch on onboarding state (handled by the routing effect below).
      justSignedInRef.current = true;
    }
    prevUserRef.current = user;
  }, [user, authLoading]);

  // Post-login destination. Waits for the profile row so a never-onboarded
  // user (onboarded_at == null) lands on /profile — where the first-login
  // onboarding modal + self-assembling reveal play over V2ProfileSelfPage —
  // while everyone else lands on their journal as before. If the profile load
  // fails (dangling-token / RLS race, §6 items 11/15) we simply don't redirect,
  // leaving the existing degraded-state behavior unchanged.
  useEffect(() => {
    if (authLoading) return;
    if (!justSignedInRef.current) return;
    if (!user) { justSignedInRef.current = false; return; }
    // CP5b: an invite sign-up sets this one-shot flag so the brand-new
    // account lands on the restructure dashboard (where the guided tour
    // auto-fires) instead of the old /profile onboarding. Checked BEFORE the
    // profile-load gate so it routes even while the fresh profile row loads.
    // Only the invite flow ever sets it — the general sign-up path below is
    // unchanged. Read + clear (one-shot).
    const forcedDest = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("ns_post_signup_dest") : null;
    if (forcedDest) {
      justSignedInRef.current = false;
      sessionStorage.removeItem("ns_post_signup_dest");
      navigate(forcedDest, { replace: true });
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
      return;
    }
    if (!profile) return; // profile still loading — wait one more tick
    justSignedInRef.current = false;
    // CP7: every desktop sign-in now lands in the restructured world
    // (/dashboard), where the guided tour auto-fires for first-timers. Mobile
    // keeps the old destination so its lockout → /m flow is untouched.
    const dest = isMobileLocked ? (profile.onboarded_at == null ? "/profile" : "/journal") : "/dashboard";
    navigate(dest);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }, [user, profile, authLoading, navigate, isMobileLocked]);

  // Replies-to-user for profile pill badge
  const [repliesToUser, setRepliesToUser] = useState<{ reply: Reply; thread: Thread; groupId?: string }[]>([]);

  // Fetch on login + whenever the user navigates to a show, profile,
  // journal, or the V1 archived journal. The dep set includes every
  // surface that consumes repliesToUser, so stale data never lingers
  // when the user jumps between them.
  useEffect(() => {
    if (!user) { setRepliesToUser([]); return; }
    fetchRepliesToUserThreads(user.id).then(setRepliesToUser).catch(() => {});
  }, [user?.id, expandedShowId, showProfile, showJournal, showLegacyProfile]);

  // Refetch when the tab regains focus. Replaces an earlier unfiltered
  // realtime subscription on the entire replies table — that pattern
  // triggered a heavy refetch on every reply event from every user
  // across the app, driving substantial egress (the user-replies query
  // pulls up to 200 rows × thread + group context per fire). Tab-focus
  // gives near-live freshness for the typical "look away, come back"
  // pattern without per-event cascades. The navigation-driven refetch
  // above still keeps things fresh as the user moves between surfaces.
  useEffect(() => {
    if (!user) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchRepliesToUserThreads(user.id).then(setRepliesToUser).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, [user?.id]);

  // All friend groups across all shows (for header scroll)
  const [allFriendGroups, setAllFriendGroups] = useState<(FriendGroup & { lastActivityAt: number })[]>([]);
  useEffect(() => {
    if (!user) { setAllFriendGroups([]); return; }
    fetchAllFriendGroupsWithActivity(user.id).then(setAllFriendGroups).catch(() => {});
  }, [user?.id]);

  // Undismissed incoming sticky-channel ping counts per show. Drives the
  // journal rail dot signal — same wayfinding as new replies. Fetched on
  // user / nav change; no realtime per spec ("next ping shows on nav refresh").
  const [pingCountsByShow, setPingCountsByShow] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!user) { setPingCountsByShow({}); return; }
    fetchUndismissedPingCountsByShow(user.id).then(setPingCountsByShow).catch(() => {});
  }, [user?.id, expandedShowId, showProfile, showJournal, showLegacyProfile]);

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
  const { hasVisibleNewReplies, invisibleShowName, visibleShowName } = useMemo(() => {
    let hasVisible = false;
    let latestInvisible: { reply: Reply; thread: Thread } | null = null;
    let latestVisible: { reply: Reply; thread: Thread } | null = null;
    for (const { reply: r, thread: t } of repliesToUser) {
      const canSee = canView({ season: r.season, episode: r.episode }, progress[t.showId]);
      if (canSee) {
        if (r.updatedAt > visibleSeenAt) {
          hasVisible = true;
          if (!latestVisible || r.updatedAt > latestVisible.reply.updatedAt)
            latestVisible = { reply: r, thread: t };
        }
      }
      else if (r.updatedAt > invisibleSeenAt && (!latestInvisible || r.updatedAt > latestInvisible.reply.updatedAt))
        latestInvisible = { reply: r, thread: t };
    }
    return {
      hasVisibleNewReplies: hasVisible,
      invisibleShowName: latestInvisible ? (shows.find(s => s.id === latestInvisible!.thread.showId)?.name ?? latestInvisible.thread.showId) : "",
      visibleShowName: latestVisible ? (shows.find(s => s.id === latestVisible!.thread.showId)?.name ?? latestVisible.thread.showId) : "",
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
    // Fire on journal-family routes only — /journal (promoted V3 journal)
    // and /legacy/profile (V1 ProfilePage archived). The promoted /profile
    // is V2ProfileSelfPage which does NOT show journal content, so firing
    // the seen-at reset there would silently mark items as "not new" the
    // next time the user actually opens the journal.
    if (showJournal || showLegacyProfile) {
      setOpenedAtSeenAt(visibleSeenAt); // capture BEFORE clearing
      const now = Date.now();
      setVisibleSeenAt(now);
      localStorage.setItem("ns_visible_seen_at", String(now));
      setInvisibleSeenAt(now);
      localStorage.setItem("ns_invisible_seen_at", String(now));
      setInvisibleFirstSeenAt(0);
      localStorage.removeItem("ns_invisible_first_seen_at");
    }
  }, [showJournal, showLegacyProfile]);

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
  const narrativeRef = useRef<HTMLDivElement>(null);
  const [gradientOpacity, setGradientOpacity] = useState(0);
  const [arrowOpacity, setArrowOpacity] = useState(0.6);
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
    Promise.all([
      fetchLikedThreads(user.id),
      fetchLikedReplies(user.id),
    ]).then(([threads, pairs]) => {
      const tMap: Record<string, boolean> = {};
      threads.forEach(t => { tMap[t.id] = true; });
      setLikedByUserThreads(tMap);
      const rMap: Record<string, boolean> = {};
      pairs.forEach(({ reply }) => { rMap[reply.id] = true; });
      setLikedByUserReplies(rMap);
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

  // Progress update — rewatch-aware.
  //   Non-rewatcher: writes season/episode, bumps highest if new > current highest.
  //   Rewatcher, still within previous highest: writes rewatch_season/episode,
  //     leaves is_rewatching / highest alone.
  //   Rewatcher, strictly past previous highest: transitions out of rewatch —
  //     flips is_rewatching=false, nulls rewatch_season/episode, bumps highest
  //     to the new position.
  const updateProgressFor = (sid: string, next: { s: number; e: number }) => {
    setProgress(prev => {
      const cur = prev[sid];
      // Non-rewatcher (or no prior entry): regular forward progress.
      if (!cur?.isRewatching) {
        const newHighestS = cur?.highestS != null && cur?.highestE != null
          ? (next.s > cur.highestS || (next.s === cur.highestS && next.e > cur.highestE) ? next.s : cur.highestS)
          : next.s;
        const newHighestE = cur?.highestS != null && cur?.highestE != null
          ? (next.s > cur.highestS || (next.s === cur.highestS && next.e > cur.highestE) ? next.e : cur.highestE)
          : next.e;
        const updated: ProgressEntry = {
          ...(cur || {}),
          s: next.s, e: next.e,
          highestS: newHighestS,
          highestE: newHighestE,
        };
        if (user) upsertRewatchStatus(user.id, sid, updated).catch(err =>
          console.error("Failed to save progress:", err)
        );
        return { ...prev, [sid]: updated };
      }
      // Rewatcher: compare new position to previous highest.
      const hs = cur.highestS ?? cur.s;
      const he = cur.highestE ?? cur.e;
      const pastHighest = next.s > hs || (next.s === hs && next.e > he);
      if (!pastHighest) {
        // Still rewatching — update rewatch position, leave flag + highest alone.
        const updated: ProgressEntry = {
          ...cur,
          s: next.s, e: next.e,
          rewatchS: next.s, rewatchE: next.e,
        };
        if (user) upsertRewatchStatus(user.id, sid, updated).catch(err =>
          console.error("Failed to save rewatch progress:", err)
        );
        return { ...prev, [sid]: updated };
      }
      // Transition out of rewatch — strictly past previous highest.
      const updated: ProgressEntry = {
        s: next.s, e: next.e,
        isRewatching: false,
        rewatchS: undefined,
        rewatchE: undefined,
        highestS: next.s,
        highestE: next.e,
      };
      if (user) upsertRewatchStatus(user.id, sid, updated).catch(err =>
        console.error("Failed to complete rewatch:", err)
      );
      return { ...prev, [sid]: updated };
    });
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

  // Kept for back-compat with callers that explicitly clear rewatch mode
  // without advancing progress (rare). Prefer updateProgressFor which
  // auto-transitions when appropriate.
  const clearRewatchFor = (sid: string) => {
    setProgress(prev => {
      const cur = prev[sid] || { s: 1, e: 1 };
      return { ...prev, [sid]: { ...cur, isRewatching: false, rewatchS: undefined, rewatchE: undefined } };
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
      navigate(`/u/${encodeURIComponent(name)}`);
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

  const isHomepage = !expandedShowId && !showProfile && !showJournal && !roomGroupId && !composeShowId && !visitorUsername && !userAggregate && !showLegacyProfile && !legacyPublicProfileUsername;
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
      // Fade arrow out quickly — starts at 60%, gone by 5% of narrative height
      const arrowFade = Math.max(0.6 - (window.scrollY / (el.offsetHeight * 0.05)) * 0.6, 0);
      setArrowOpacity(arrowFade);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHomepage]);
  const isProfilePage = showProfile || showJournal || !!visitorUsername || !!userAggregate || showLegacyProfile || !!legacyPublicProfileUsername;
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

  // Auth-gated routing:
  //   • Signed-out users are redirected off signed-in-only routes (/profile)
  //     to the homepage. Also covers the "OS signed me out / session expired"
  //     case — as soon as auth resolves with user=null, the tab is bounced.
  //     Invite links (/invite/:token) are intentionally exempt: they need
  //     the signed-out path so the recipient can sign in to accept.
  //   • Signed-in non-admin users are redirected off the homepage (/) to
  //     their journal. Admins are exempt so they can navigate to / to reach
  //     the admin panel (via ?admin in the query).
  useEffect(() => {
    if (authLoading) return;
    const p = location.pathname;
    // Signed-out users get bounced off auth-gated AppShell-mounted
    // surfaces — /journal (V3 journal, promoted) and /legacy/profile
    // (V1 archived journal). /profile (V2ProfileSelfPage) and the
    // other V2 surfaces (/room, /compose, /u) short-circuit at App()
    // top-level above and never reach AppShell; they handle no-user
    // state inside the component (matches pre-promotion behavior).
    if (!user && (p === "/journal" || p === "/legacy/profile")) {
      navigate("/", { replace: true });
      return;
    }
    // Wait for the profile row to arrive before redirecting signed-in users
    // off /. Otherwise admin sign-in briefly sees profile=null → isAdmin=false
    // and bounces them off / before the profile load settles.
    if (user && profile && !isAdmin && p === "/") {
      // CP7: signed-in desktop users bounce off the homepage into the
      // restructured world (/dashboard). Mobile keeps the old journal/profile
      // bounce so its lockout → /m flow is untouched. Admins stay exempt so
      // they can reach the admin panel via / (?admin).
      navigate(isMobileLocked ? (profile.onboarded_at == null ? "/profile" : "/journal") : "/dashboard", { replace: true });
    }
  }, [authLoading, user, profile, isAdmin, location.pathname, navigate, isMobileLocked]);

  const fixedHelp = null;

  // ── Shared SearchShows handler (used in both header and homepage) ─
  const searchShowsHandlers = {
    onShowCreated: (newShow: Show, entry: ProgressEntry, action: "friendRoom" | "solo", friendGroup: FriendGroup | null) => {
      setShows(prev => prev.find(s => s.id === newShow.id) ? prev : [...prev, newShow]);
      setWatchStatusFor(newShow.id, entry);
      // Mark the new tab so ProfilePage's showTabOrder floats it to the front
      // even before any real activity accumulates for it.
      if (user) markTabCreated(user.id, newShow.id);
      if (action === "friendRoom" && friendGroup) {
        // Friend-room path: optimistically add to the top-nav pills, then
        // drop the user straight into the new room.
        setAllFriendGroups(prev =>
          prev.find(x => x.id === friendGroup.id) ? prev : [{ ...friendGroup, lastActivityAt: Date.now() }, ...prev]
        );
        navigate(`/show/${newShow.id}`, { state: { activeGroupId: friendGroup.id } });
      } else {
        // Solo path: no friend room — land the user on their journal tab
        // for the new show (V3JournalPage reads state.activeTab to seed
        // the active tab and auto-unhide it).
        navigate("/journal", { state: { activeTab: newShow.id } });
      }
      requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
    },
    onBrowsePublic: (showId: string, showName: string, _entry: ProgressEntry, seasons: number[]) => {
      setShows(prev => prev.find(s => s.id === showId) ? prev : [...prev, {
        id: showId, name: showName, seasons, status: "Ended", isHidden: false,
      } as Show]);
      navigate(`/show/${showId}`);
      requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
    },
    // User searched a show they've already onboarded onto. Take them back
    // to their existing journal tab — V3JournalPage auto-unhides hidden
    // tabs when state.activeTab is supplied, so this also reopens closed
    // tabs.
    onReopenJournal: (showId: string) => {
      navigate("/journal", { state: { activeTab: showId } });
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    },
    onAuthRequired: () => { setAuthHint("Sign in or create an account to start a journal or friend room."); setShowAuthModal(true); },
  };

  // ── Unified fixed header (non-homepage) ─
  // Wide (>=1134px): single row — [Logo+Search stack] ... [Pill] [FriendRooms] ... [Sign out] [Admin]
  //   (Pill and FriendRooms are anchored to the .container content-column edges via absolute positioning.)
  // Narrow (<1134px): two stacked rows —
  //   Row 1: [Logo+Search stack] ............................................ [Sign out] [Admin]
  //   Row 2: [Pill] ............................................... [FriendRooms]
  const fixedLogo = null; // replaced by fixedHeader below
  const fixedAuth = !isHomepage ? (
    <div className="topHeaderWrap">
      {/* Band: logo+search (left) + signout/admin (right) */}
      <div className="topHeaderBand">
        {/* Left stack: logo on top, search below */}
        <div className="topHeaderLeft">
          {isNarrowHeader ? (
            <h1
              className="brand brandLink"
              style={{ margin: 0 }}
              tabIndex={0}
              aria-label={user ? "Go to journal" : "Go to homepage"}
              onClick={user ? () => { navigate("/journal"); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" })); } : goHomepage}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); user ? navigate("/journal") : goHomepage(); } }}
            >
              <img src="/sidebar-logo.png" alt="sidebar" className="brandLogoImg" style={{ height: 38, width: "auto", display: "block" }} />
            </h1>
          ) : (
            // Click navigates to journal AND bumps the React key on
            // SidebarLogo so it remounts and replays the block-scatter
            // animation (since the fixed header doesn't unmount on route
            // change, navigation alone wouldn't trigger the replay).
            <h1
              className="brand"
              style={{ margin: 0, cursor: "pointer", marginLeft: 16 }}
              tabIndex={0}
              role="button"
              aria-label="Go to journal"
              onClick={() => {
                setHeaderLogoResetKey(k => k + 1);
                navigate("/journal");
                requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setHeaderLogoResetKey(k => k + 1);
                  navigate("/journal");
                }
              }}
            >
              <SidebarLogo key={headerLogoResetKey} scale={0.6} />
            </h1>
          )}
          <span className="mobileHide topHeaderSearch" style={{ display: "inline-flex" }}>
            <SearchShows
              shows={shows}
              progress={progress}
              {...searchShowsHandlers}
              placeholder="find your show"
            />
          </span>
        </div>

        {/* Right cluster: sign out / sign in + admin gear.
            The profile pill used to live in this flex row, but now renders
            as its own position:fixed element (below) so its right edge
            aligns with the journal's right edge on wide viewports instead
            of the viewport edge. Sign-out + admin gear stay anchored to
            the viewport's right edge. */}
        <div className="topHeaderRight">
          {!authLoading && user && (
            <Tooltip text="Sign out" direction="below" tooltipStyle={{ width: "auto", whiteSpace: "nowrap", padding: "6px 10px" }}>
              <button
                className="btn"
                style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px 10px" }}
                onClick={() => { goHomepage(); signOut(); }}
                aria-label="Sign out"
              >
                <LogOut size={16} color="currentColor" />
              </button>
            </Tooltip>
          )}
          {!authLoading && !user && (
            <button className="btn" style={{ flexShrink: 0 }} onClick={() => setShowAuthModal(true)}>
              Sign in / Join
            </button>
          )}
          {!authLoading && isAdmin && (
            <div style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
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

      </div>

      {/* Profile pill — rendered as its own position:fixed element so its
          right edge can align with the journal's right edge (via
          .topHeaderPillFixed CSS) instead of the viewport's right edge.
          Stays inside .topHeaderWrap so the .profileChip pointer-events
          allowlist rule still applies. On viewports <932px the CSS clamp
          snaps it back to right:14px matching the old behavior. */}
      {!authLoading && user && username && (() => {
        const redExpired = !invisibleFirstSeenAt || Date.now() - invisibleFirstSeenAt >= THIRTY_SIX_HOURS;
        const pillBadge = hasVisibleNewReplies ? "green" : (!redExpired && invisibleShowName) ? "red" : null;
        const pillTooltipText =
          pillBadge === "green" ? `Someone wrote you back about ${visibleShowName}! Find responses to you in here.` :
          pillBadge === "red" ? `FYI: ${invisibleShowName} has replies beyond your progress! You'll see them once you catch up.` :
          null;
        const pillContent = (
          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              className="profileChip"
              onClick={!(showProfile || showJournal || showLegacyProfile) ? () => {
                navigate("/journal", expandedShowId ? { state: { activeTab: expandedShowId } } : undefined);
                requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
              } : undefined}
              style={(showProfile || showJournal || showLegacyProfile) ? { cursor: "default" } : undefined}
            >
              {(showProfile || showJournal || showLegacyProfile)
                ? <><BookOpen size={16} color="#fff" style={{ flexShrink: 0 }} /><span className="profileChipLabel" style={{ fontWeight: 700, color: "#fff", display: "inline-flex", alignItems: "center", gap: 6 }}>you are <SidebarAvatar userId={user?.id} username={username ?? undefined} size={18} />{username}</span></>
                : <><BookMarked size={16} color="#fff" style={{ flexShrink: 0 }} /><ArrowLeft size={14} color="#fff" style={{ flexShrink: 0 }} /><span className="profileChipLabel" style={{ fontWeight: 700, color: "#fff" }}>go to your journal</span></>
              }
            </button>
            {pillBadge === "green" && (
              <div style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "var(--green)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", pointerEvents: "none" }} />
            )}
            {pillBadge === "red" && (
              <div style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", pointerEvents: "none" }} />
            )}
          </div>
        );
        // On non-profile-family pages (showProfile || showJournal is
        // false), render a second "go to your profile" pill directly to
        // the right of the journal pill. Canon-yellow fill + yellow outline
        // (V2Layout's treatment for non-yellow surfaces — the reachable V1
        // surface here is the private-post thread view, which is green/not
        // public-context). Icons mirrored to the right of the label.
        const showProfilePill = !(showProfile || showJournal || showLegacyProfile) && user && profile;
        return (
          <span className="topHeaderPillFixed" style={{ display: "inline-flex", gap: 8 }}>
            {pillTooltipText
              ? <Tooltip text={pillTooltipText} direction="below" align="left" tooltipStyle={{ background: "#adc8d7", color: "#1a2c3a", boxShadow: "0 4px 20px rgba(0,0,0,0.18)" }}>{pillContent}</Tooltip>
              : pillContent}
            {showProfilePill && (
              <button
                className="profileChip"
                onClick={() => {
                  navigate("/profile");
                  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
                }}
                style={{
                  background: "#dea838",
                  border: "2px solid #dea838",
                }}
              >
                <span className="profileChipLabel" style={{ fontWeight: 700, color: "#fff" }}>go to your profile</span>
                <ArrowRight size={14} color="#fff" style={{ flexShrink: 0 }} />
                <UserPen size={16} color="#fff" style={{ flexShrink: 0 }} />
              </button>
            )}
          </span>
        );
      })()}
    </div>
  ) : (
    /* Homepage — minimal auth controls only */
    <div className="fixedAuthWrap" style={{ position: "fixed", top: 14, right: 14, zIndex: 1000, display: "flex", alignItems: "center", gap: 8 }}>
      {!authLoading && isAdmin && (
        <button
          className="btn"
          onClick={() => { navigate("/journal"); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" })); }}
          title="Go to your journal"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <BookOpen size={14} color="currentColor" /> journal
        </button>
      )}
      {!authLoading && user && (
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
  // Height is driven by the --site-header-h CSS var (responsive via media queries).
  const header = (
    <header className="site bleed" />
  );

  // Show tabs are now integrated directly into the diary graphic on the profile page.
  const fixedProfileTabs = null;

  // Mobile redirect: viewports <768px get sent into the /m/* mobile app
  // surface, which is now the canonical mobile experience (replaces the
  // earlier "not ready for your phone yet" lockout screen). Admins bypass
  // so they can QA the desktop UI from a phone if needed.
  //
  // /m/* paths early-return in <App> before reaching <AppShell>, so this
  // gate only fires for mobile users on desktop-shaped paths (/, /profile,
  // /show/:id, etc.) — sending them into /m, which then routes signed-in
  // users to /m/rooms and signed-out users to MobileNarrative.
  //
  // Race-guard: wait for auth + profile to fully resolve before committing
  // to the redirect. Without these guards, an admin signing in on mobile
  // races: the gate fires on first render with profile=null → isAdmin=false
  // → Navigate to /m fires → by the time isAdmin resolves true, the
  // navigation already happened and admin is stuck on /m. The two `return
  // null` branches cover the gaps:
  //   - authLoading: initial session resolution.
  //   - user && !profile: session resolved, profile row still loading.
  // Brief blank flash possible during profile-load on mobile admin
  // sign-in (sub-second) — preferred over routing admins out of the
  // desktop QA path. Unauthed mobile users skip the guard naturally
  // (user is null after authLoading=false → falls through to the redirect).
  if (isMobileLocked && !isAdmin) {
    if (authLoading) return null;
    if (user && !profile) return null;
    return <Navigate to="/m" replace />;
  }

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
      {showAuthModal && <AuthModal onClose={() => { setShowAuthModal(false); setAuthHint(null); setAuthInitialMode("signin"); }} hint={authHint ?? undefined} initialMode={authInitialMode} />}
      {showHowItWorks && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 2000,
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowHowItWorks(false); }}
        >
          <div style={{
            width: "min(92vw, 860px)",
            maxHeight: "90vh",
            borderRadius: 20,
            background: "#7abd8e",
            overflowY: "auto",
          }}>
            <Suspense fallback={null}>
              <HowItWorksV2
                onClose={() => setShowHowItWorks(false)}
                onSignup={() => { setShowHowItWorks(false); setAuthInitialMode("signup"); setShowAuthModal(true); }}
              />
            </Suspense>
          </div>
        </div>
      )}
      {!showProfile && !showJournal && !roomGroupId && !composeShowId && !visitorUsername && !userAggregate && !showLegacyProfile && !legacyPublicProfileUsername && (
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

              {/* ── Top-right "Sign in" (always visible on homepage for
                 logged-out users; parity with the sign-out button that
                 appears on every other route for logged-in users). ── */}
              {!authLoading && !user && (
                <button
                  className="btn"
                  onClick={() => { setAuthInitialMode("signin"); setShowAuthModal(true); }}
                  style={{
                    position: "fixed", top: 16, right: 16, zIndex: 200,
                    flexShrink: 0,
                  }}
                >
                  Sign in
                </button>
              )}

              {/* ── Scroll-down arrow hint ── */}
              {arrowOpacity > 0 && (
                <div style={{
                  position: "fixed", bottom: "8vh", left: "50%", transform: "translateX(-50%)",
                  opacity: arrowOpacity, pointerEvents: "none", zIndex: 10,
                  transition: "opacity 0.15s ease",
                }}>
                  <ArrowDown size={49} color="#fff" strokeWidth={2} />
                </div>
              )}

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

              {/* "Here's how it works:" */}
              <p style={{
                fontSize: isMobile ? 20 : 26, fontWeight: 800,
                color: "#fff", margin: "8px 16px 40px", textAlign: "center",
              }}>
                Here&rsquo;s how it works:
              </p>

              {/* Feature grid — 6 steps, all white-filled with green text/icons */}
              {(() => {
                const items: { Icon: React.ElementType; text: React.ReactNode }[] = [
                  { Icon: DoorOpen,          text: "Find the show you\u2019re watching and create a room." },
                  { Icon: UserPlus,          text: "Invite friends you love talking to." },
                  { Icon: ClipboardList,     text: "Everyone logs their watch progress every time they sign in. Sidebar tags all writing to each user\u2019s logged progress." },
                  { Icon: MessageSquareText, text: "Post your thoughts without worrying about spoilers \u2014 as if your friends have watched just as far as you have." },
                  { Icon: Blend,             text: (<>Sidebar filters everything according to<br />everyone&rsquo;s unique watch progress.</>) },
                  { Icon: ShieldCheck,       text: "Nothing you read is ever ahead of where you are." },
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
                    {items.map(({ Icon, text }, idx) => (
                      <div key={idx} style={{
                        borderRadius: 16,
                        padding: isMobile ? "12px 14px" : "16px 18px",
                        display: "flex",
                        flexDirection: isMobile ? "row" : "column",
                        alignItems: "center",
                        gap: isMobile ? 14 : 8,
                        background: "rgba(255,255,255,0.92)",
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <span style={{ fontSize: 16, fontWeight: 800, color: "var(--dos-bg)", lineHeight: 1 }}>
                            {idx + 1}.
                          </span>
                          <Icon size={isMobile ? 18 : 22} color="var(--dos-bg)" strokeWidth={1.5} />
                        </div>
                        <span style={{
                          width: isMobile ? "auto" : "100%",
                          fontSize: isMobile ? 12 : 13,
                          color: "var(--dos-bg)",
                          fontWeight: 600,
                          lineHeight: 1.4,
                          textAlign: isMobile ? "left" : "center",
                          textWrap: "balance" as React.CSSProperties["textWrap"],
                        }}>{text}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* CTA buttons — sign in / learn more */}
              {!user && (
                <div style={{ marginTop: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: isMobile ? "min(288px, 90vw)" : "100%", maxWidth: isMobile ? undefined : 840, padding: isMobile ? 0 : "0 16px", boxSizing: "border-box" }}>
                  <button
                    onClick={() => { setAuthInitialMode("signup"); setShowAuthModal(true); }}
                    style={{
                      width: "100%", maxWidth: 420,
                      background: "#fff", color: "var(--dos-bg)", border: "none",
                      borderRadius: 9999, padding: "14px 0",
                      fontSize: 18, fontWeight: 800, cursor: "pointer",
                      letterSpacing: "0.02em",
                    }}
                  >
                    Join / sign in
                  </button>
                  <button
                    onClick={() => setShowHowItWorks(true)}
                    style={{
                      width: "100%", maxWidth: 420,
                      background: "transparent", color: "#fff",
                      border: "2px solid #fff",
                      borderRadius: 9999, padding: "12px 0",
                      fontSize: 18, fontWeight: 800, cursor: "pointer",
                      letterSpacing: "0.02em",
                    }}
                  >
                    Want more details?
                  </button>
                </div>
              )}
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
                <div style={{ maxWidth: 690, width: "100%", padding: "0 16px", marginTop: 28, marginBottom: 60 }}>
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
                    I&rsquo;m making this site because I love stories and I love thinking about them. If you&rsquo;re reading this right now, you&rsquo;re probably the same way and I probably love talking to you about said stories. That&rsquo;s the whole point here: to make it easier to have ongoing conversations about the TV shows we love (or love to hate).<br /><br />
                    Hopefully everything on this beta version works, even if not in its final form. There are some features that might not make sense in this early stage (like public conversations and rewatch-mode), but I wanted to include them so you have an idea of where things could head. Use the &lsquo;feedback&rsquo; tab on the right to send your thoughts &mdash; large or small. Don&rsquo;t overthink it. Your gut reactions are as important as your more considered thoughts. Just fire messages off as they occur to you.<br /><br />
                    You&rsquo;ll find a pretend show called &ldquo;The Sidebar Protocol&rdquo; already in your journal when you sign in. It&rsquo;s there to help you see how the site works. Poke around &mdash; you can&rsquo;t break anything, and anything you post can be reset or deleted if you want a clean slate.<br /><br />
                    Excited to see how you use the site.<br /><br />
                    &mdash; Alborz
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* V2 surfaces (/profile, /room/:groupId, /compose/:showId, /u/:username,
          /u/:username/show/:showId/posts) are short-circuited at App() top-
          level — they ship full-width V2Layout chrome that would double-up
          with AppShell's .topHeaderWrap and get squished by AppShell's
          .container max-width if mounted here. */}

      {/* /journal — promoted V3 journal (was /v3/journal). Stays in AppShell
          because V3JournalPage uses AppShell's chrome (same as the live
          /v3/journal did pre-promotion). */}
      {showJournal && username && (
        <V3JournalPage
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
          pingCountsByShow={pingCountsByShow}
          openedAtSeenAt={openedAtSeenAt}
          onTabsChange={setProfileTabData}
          updateProgressFor={updateProgressFor}
          onShowUpdated={(updated: Show) => setShows(prev => prev.map(s => s.id === updated.id ? updated : s))}
          onGroupCreated={(g: FriendGroup) => {
            setAllFriendGroups(prev =>
              prev.find(x => x.id === g.id) ? prev : [{ ...g, lastActivityAt: Date.now() }, ...prev]
            );
          }}
        />
      )}

      {/* /legacy/profile — V1 ProfilePage archived as a fallback. Same
          props the live /profile used to receive. */}
      {showLegacyProfile && username && (
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
          pingCountsByShow={pingCountsByShow}
          openedAtSeenAt={openedAtSeenAt}
          onTabsChange={setProfileTabData}
          updateProgressFor={updateProgressFor}
          onShowUpdated={(updated: Show) => setShows(prev => prev.map(s => s.id === updated.id ? updated : s))}
          onGroupCreated={(g: FriendGroup) => {
            setAllFriendGroups(prev =>
              prev.find(x => x.id === g.id) ? prev : [{ ...g, lastActivityAt: Date.now() }, ...prev]
            );
          }}
        />
      )}

      {/* /legacy/user/:username — V1 PublicProfilePage archived. */}
      {legacyPublicProfileUsername && (
        <PublicProfilePage
          username={legacyPublicProfileUsername}
          shows={shows}
          viewerProgress={progress}
          openThreadWithFocus={openThreadWithFocus}
          openShow={openShow}
          onClose={goHomepage}
          onTabsChange={setProfileTabData}
        />
      )}

      {!showProfile && expandedShowId && (
        <div>
          <ShowSection
            key={expandedShowId}
            shows={shows}
            onShowUpdated={(updated: Show) => setShows(prev => prev.map(s => s.id === updated.id ? updated : s))}
            onShowCreated={(newShow: Show) => setShows(prev => prev.find(s => s.id === newShow.id) ? prev : [...prev, newShow])}
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
            allFriendGroups={allFriendGroups}
            onGroupLeft={() => {
              if (user) fetchAllFriendGroupsWithActivity(user.id).then(setAllFriendGroups).catch(() => {});
            }}
            onGroupCreated={(g: FriendGroup) => {
              // Optimistically add the newly-created room to the top-nav
              // friend-room pills so the user sees it without a refresh.
              // lastActivityAt set to now so it sorts to the front if the
              // bar is activity-ordered.
              setAllFriendGroups(prev =>
                prev.find(x => x.id === g.id) ? prev : [{ ...g, lastActivityAt: Date.now() }, ...prev]
              );
            }}
          />
        </div>
      )}

      {showAdmin && isAdmin && (
        <Suspense fallback={<RouteFallback />}>
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
        </Suspense>
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
                  allowZero={progress[pickShow.id]?.s === 0}
                  rewatchHighest={progress[pickShow.id]?.isRewatching && progress[pickShow.id]?.highestS != null && progress[pickShow.id]?.highestE != null
                    ? { s: progress[pickShow.id]!.highestS!, e: progress[pickShow.id]!.highestE! }
                    : null}
                  plain
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
