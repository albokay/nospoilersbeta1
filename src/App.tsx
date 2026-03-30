import React, { useState, useMemo, useEffect } from "react";
import { injectDOSStyles } from "./styles/theme";
import { seedShows, seedThreads, repliesByThread } from "./lib/mockData";
import { canView } from "./lib/utils";
import ExtensionDock from "./extensions/ExtensionDock";
import SearchShows from "./components/SearchShows";
import YourShowsSelect from "./components/YourShowsSelect";
import ShowSection from "./components/ShowSection";
import ProfilePage from "./components/ProfilePage";
import Modal from "./components/Modal";
import OneSelectProgress from "./components/OneSelectProgress";

const SINGLE_PAGE = true;
const GLOBAL_HEADER_H = 72;

export default function App() {
  useEffect(injectDOSStyles, []);

  const username = "hi_itsme";

  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [focusReplyId, setFocusReplyId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const [progress, setProgress] = useState<{ [sid: string]: { s: number; e: number } }>({});

  const [pickShowId, setPickShowId] = useState<string | null>(null);
  const pickShow = useMemo(() => seedShows.find(s => s.id === pickShowId) || null, [pickShowId]);
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

  const computeVisibleIds = (sid: string, prog?: { s: number; e: number }) =>
    !prog ? [] : seedThreads.filter(t => t.showId === sid).filter(t => canView(t, prog)).map(t => t.id);

  const updateProgressFor = (sid: string, next: { s: number; e: number }) => {
    setProgress(prev => {
      const before = prev[sid]; const beforeIds = computeVisibleIds(sid, before); const afterIds = computeVisibleIds(sid, next);
      const isNew: any = {}; afterIds.forEach(id => { if (!beforeIds.includes(id)) isNew[id] = true; });
      setNewHighlights(nh => ({ ...nh, [sid]: isNew }));
      return { ...prev, [sid]: next };
    });
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

  const header = (
    <header className="site bleed">
      <div style={{ height: GLOBAL_HEADER_H, display: "flex", alignItems: "center", padding: "0 0", width: "100%" }}>
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

        <div style={{ marginLeft: "auto", marginRight: 20, display: "flex", alignItems: "center" }}>
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
            <span className="avatar">h</span>
            <span style={{ fontWeight: 700, color: "var(--dos-fg)" }}>hi_itsme</span>
          </button>
        </div>
      </div>

      <div className="siteTagline">
        proof of concept mockup for spoiler-safe TV discussion forum
      </div>
    </header>
  );

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      {header}
      <ExtensionDock />
      {!showProfile && (
        <>
          <SearchShows onPick={handlePickFromSearch} onStartNewForum={handleStartNewForum} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 28, placeItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
                Popular Right Now
              </div>
              <div style={{ fontSize: 26 }}>
                {["bb", "simshow"].map((id, idx, arr) => {
                  const s = seedShows.find(x => x.id === id);
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
            <YourShowsSelect
              progress={progress}
              value={""}
              onChange={(id) => {
                if (!id) return;
                setPickShowMode("confirm");
                setPickShowId(id);
                setShowProfile(false);
              }}
            />
          </div>

          {!expandedShowId && (
            <div className="homeAbout" style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ maxWidth: 460, width: "100%", padding: "30px 16px" }}>
                <p>** Hello friendly beta-tester!<br /></p><br />
                <p>The BREAKING BAD forum is populated with posts that discuss the actual show. SIMULATED SHOW uses generic posts to help you understand the logic of the site.<br /><br />
                  On this mock site, you can create posts (but not replies) across all forums. <br /><br />
                  Use the "find a show" search field to go to a new show forum. They are all empty for now. <br /><br />
                  The back button on your browser window will leave this mockup site altogether, and refreshing your page will reset it. Click and post with abandon — nothing is breakable or actually publishable for now!<br /><br />
                  — Alborz<br /><br /><br /><br /><br /></p>
              </div>
            </div>
          )}
        </>
      )}

      {showProfile && (
        <ProfilePage
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
        <div style={{ marginTop: 40 }}>
          <ShowSection
            username={username}
            showId={expandedShowId}
            progress={progress}
            updateProgressFor={(sid: string, next: { s: number; e: number }) => {
              setProgress(prev => {
                const before = prev[sid];
                const computeIds = (sid: string, prog?: { s: number; e: number }) => {
                  if (!prog) return [] as string[];
                  return seedThreads
                    .filter(t => t.showId === sid)
                    .filter(t => !t.isPrivate)
                    .filter(t => canView({ season: t.season, episode: t.episode }, prog))
                    .map(t => t.id);
                };
                const beforeIds = computeIds(sid, before);
                const afterIds = computeIds(sid, next);
                const newly = {} as { [tid: string]: true };
                for (const id of afterIds) if (!beforeIds.includes(id)) newly[id] = true;
                if (Object.keys(newly).length) setNewHighlights(nh => ({ ...nh, [sid]: newly }));
                return { ...prev, [sid]: next };
              });

              setActiveThreadId(currentId => {
                if (!currentId) return currentId;
                const t = seedThreads.find(t => t.id === currentId);
                if (!t) return currentId;
                if (t.showId !== sid) return currentId;
                const stillVisible = canView({ season: t.season, episode: t.episode }, next);
                return stillVisible ? currentId : null;
              });
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
