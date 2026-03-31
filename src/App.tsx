import React, { useState, useMemo, useEffect } from "react";
import { injectDOSStyles } from "./styles/theme";
import { seedShows, seedThreads, repliesByThread } from "./lib/mockData";
import { canView } from "./lib/utils";
import { fetchProgress, upsertProgress, fetchShows } from "./lib/db";
import type { Show } from "./lib/db";
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

  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [focusReplyId, setFocusReplyId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const [progress, setProgress] = useState<{ [sid: string]: { s: number; e: number } }>({});

  // Load progress from DB when user logs in; clear it when they log out
  useEffect(() => {
    if (!user) { setProgress({}); return; }
    fetchProgress(user.id).then(saved => {
      setProgress(saved);
    }).catch(err => console.error("Failed to load progress:", err));
  }, [user?.id]);

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
    setShowProfile(false);
    setExpandedShowId(id);
    setActiveThreadId(null);
    setFocusReplyId(null);
    requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
  };

  const openThreadWithFocus = (showId: string, threadId: string, replyId?: string) => {
    openShow(showId);
    setActiveThreadId(threadId);
    setFocusReplyId(replyId || null);
    requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
  };

  const goHomepage = () => {
    setExpandedShowId(null);
    setActiveThreadId(null);
    setFocusReplyId(null);
    setShowProfile(false);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  };

  const handlePickFromSearch = (showId: string) => {
    if (progress[showId]) {
      openShow(showId);
    } else {
      setPickShowMode("set");
      setPickShowId(showId);
      setShowProfile(false);
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

  const isHomepage = !expandedShowId && !showProfile;

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
            <button className="btn h40" onClick={() => setShowAuthModal(true)}>
              Sign in / Join
            </button>
          )}
          {!authLoading && user && username && (
            <button
              className="profileChip"
              onClick={() => {
                setExpandedShowId(null);
                setActiveThreadId(null);
                setFocusReplyId(null);
                setShowProfile(true);
                requestAnimationFrame(() => window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
              }}
              title="View profile"
            >
              <span className="avatar">{username[0].toUpperCase()}</span>
              <span style={{ fontWeight: 700, color: "var(--dos-fg)" }}>{username}</span>
            </button>
          )}
          {!authLoading && user && username && (
            <button className="btn h40" onClick={() => { goHomepage(); signOut(); }} title="Sign out">
              Sign out
            </button>
          )}
        </div>
      </div>

    </header>
  );

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      {header}
      <ExtensionDock />
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {isHomepage && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "0 0 32px", position: "relative", zIndex: 95 }}>
          <SidebarLogo />
          <div style={{ marginTop: 12, fontSize: 18, fontWeight: 600, letterSpacing: "0.02em", color: "var(--dos-fg)" }}>
            watch. together. whenever.
          </div>
        </div>
      )}
      {!showProfile && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 28, placeItems: "center", marginTop: 36 }}>
            <YourShowsSelect
              shows={shows}
              progress={progress}
              value={""}
              onChange={(id) => {
                if (!id) return;
                setPickShowMode("confirm");
                setPickShowId(id);
                setShowProfile(false);
              }}
            />
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
          <SearchShows
            shows={shows}
            onPick={handlePickFromSearch}
            onShowCreated={(newShow) => {
              setShows(prev => [...prev, newShow]);
              setProgress(p => ({ ...p, [newShow.id]: { s: 1, e: 1 } }));
            }}
          />

          {!expandedShowId && (
            <div className="homeAbout" style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ maxWidth: 460, width: "100%", padding: "30px 16px" }}>
                <p>** Hello friendly beta-tester!</p><br />
                <p>The BREAKING BAD forum is populated with posts (a.i. generated) that discuss the actual show. SIMULATED SHOW uses generic posts to help you understand the logic of the site.<br /><br />
                  On this mock site, you can create posts across all forums.<br /><br />
                  You can use the "find a show" search field to go to a new show forum. They are all empty for now.<br /><br />
                  The back button on your browser window will leave this mockup site altogether. Click and post with abandon!<br /><br />
                  — Alborz<br /><br /><br /><br /><br /></p>
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
        />
      )}

      {SINGLE_PAGE && !showProfile && expandedShowId && (
        <div style={{ marginTop: 8 }}>
          <ShowSection
            shows={shows}
            username={username ?? ""}
            showId={expandedShowId}
            progress={progress}
            updateProgressFor={(sid: string, next: { s: number; e: number }) => {
              setProgress(prev => ({ ...prev, [sid]: next }));

              setActiveThreadId(currentId => {
                if (!currentId) return currentId;
                const t = seedThreads.find(t => t.id === currentId);
                if (!t) return currentId;
                if (t.showId !== sid) return currentId;
                const stillVisible = canView({ season: t.season, episode: t.episode }, next);
                return stillVisible ? currentId : null;
              });

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
            setActiveThreadId={setActiveThreadId}
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
          />
        </div>
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
