import React, { useState, useMemo, useEffect, useRef } from "react";
import type { Thread } from "../types";
import { seedShows } from "../lib/mockData";
import { fetchThreadsForShow } from "../lib/db";
import { canView, timeAgo } from "../lib/utils";
import Modal from "./Modal";
import LikeBadge from "./LikeBadge";
import ModeToggle from "./ModeToggle";
import OneSelectProgress from "./OneSelectProgress";
import InlineThreadView from "./InlineThreadView";

const GLOBAL_HEADER_H = 72;
const ROW_PAD_Y = 8;

export default function ShowSection({
  username, showId, progress, updateProgressFor, newHighlights, setNewHighlights,
  visitedThreads, setVisitedThreads, activeThreadId, setActiveThreadId, onHomepage,
  likesThreads, setLikesThreads, likedByUserThreads, setLikedByUserThreads,
  likesReplies, setLikesReplies, likedByUserReplies, setLikedByUserReplies,
  focusReplyId
}: any) {
  const show = seedShows.find((s) => s.id === showId) || { id: showId, name: showId, seasons: [10] };

  const [sortBy, setSortBy] = useState<"post" | "episode" | "hot">("post");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<"standard" | "risky">("standard");
  const [composeOpen, setComposeOpen] = useState(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const topRef = bannerRef;

  // ── DB state ──────────────────────────────────────────────
  const [dbThreads, setDbThreads] = useState<Thread[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [threadsLoading, setThreadsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setThreadsLoading(true);
    setDbThreads([]);
    fetchThreadsForShow(showId).then(({ threads, replyCounts: rc }) => {
      if (cancelled) return;
      setDbThreads(threads);
      setReplyCounts(rc);
      // Seed likes state from DB counts
      setLikesThreads((m: any) => {
        const next = { ...m };
        for (const t of threads) if (!(t.id in next)) next[t.id] = t.likes;
        return next;
      });
      setThreadsLoading(false);
    }).catch(() => setThreadsLoading(false));
    return () => { cancelled = true; };
  }, [showId]);

  // ── Scoring / filtering ───────────────────────────────────
  const scoreThread = (t: Thread, q: string) => {
    const text = `${t.titleBase} ${t.preview} ${t.body} ${t.author}`.toLowerCase();
    const phrase = q.trim().toLowerCase();
    const tokens = Array.from(new Set(phrase.split(/\s+/).filter(Boolean)));
    if (tokens.length === 0) return 0;
    let score = 0;
    if (text.includes(phrase)) score += 3;
    for (const tok of tokens) if (text.includes(tok)) score += 1;
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      if (text.includes(bigram)) score += 2;
    }
    return score;
  };

  const baseVisible = useMemo(() => {
    const prog = progress[showId];
    let list = dbThreads.filter(t => canView(t, prog));

    if (searchQuery.trim()) {
      const withScores = list
        .map(t => ({ t, s: scoreThread(t, searchQuery) }))
        .filter(x => x.s > 0)
        .sort((a, b) => (b.s - a.s) || (b.t.updatedAt - a.t.updatedAt));
      list = withScores.map(x => x.t);
    }

    if (sortBy === "post") {
      list = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    } else if (sortBy === "episode") {
      list = [...list].sort((a, b) => {
        if (a.season !== b.season) return b.season - a.season;
        if (a.episode !== b.episode) return b.episode - a.episode;
        return b.updatedAt - a.updatedAt;
      });
    } else if (sortBy === "hot") {
      list = [...list].sort((a, b) => {
        const la = likesThreads[a.id] ?? a.likes;
        const lb = likesThreads[b.id] ?? b.likes;
        if (lb !== la) return lb - la;
        return b.updatedAt - a.updatedAt;
      });
    }
    return list;
  }, [dbThreads, progress, searchQuery, sortBy, likesThreads]);

  const [limit, setLimit] = useState(10);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setLimit(10), [showId, progress[showId]?.s, progress[showId]?.e, searchQuery, sortBy]);
  useEffect(() => {
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const obs = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) setLimit(n => Math.min(n + 10, baseVisible.length));
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [baseVisible.length]);

  const displayed = useMemo(() => baseVisible.slice(0, limit), [baseVisible, limit]);
  const thread = activeThreadId ? dbThreads.find(t => t.id === activeThreadId && t.showId === showId) : null;

  useEffect(() => {
    if (thread?.id) {
      const tid = thread.id;
      setVisitedThreads((v: any) => ({ ...v, [tid]: true }));
      setNewHighlights((nh: any) => { const next = { ...(nh[showId] || {}) }; delete next[tid]; return { ...nh, [showId]: next }; });
    }
  }, [thread?.id, showId, setVisitedThreads, setNewHighlights]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { setSearchQuery(searchInput); setLimit(10); }
  };
  const clearSearch = () => { setSearchInput(""); setSearchQuery(""); setLimit(10); };

  const scrollToShowTop = () => {
    const y = (topRef.current?.getBoundingClientRect().top || 0) + window.scrollY;
    window.scrollTo({ top: y - GLOBAL_HEADER_H, behavior: "auto" });
  };

  const likeThread = (tid: string) => {
    setLikesThreads((m: any) => ({ ...m, [tid]: (m[tid] ?? 0) + 1 }));
    setLikedByUserThreads((u: any) => u[tid] ? u : ({ ...u, [tid]: true }));
  };
  const likeReply = (rid: string) => {
    setLikesReplies((m: any) => ({ ...m, [rid]: (m[rid] ?? 0) + 1 }));
    setLikedByUserReplies((u: any) => u[rid] ? u : ({ ...u, [rid]: true }));
  };

  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const postProgress = progress[showId] || { s: 1, e: 1 };

  const submitPost = (isPrivate = false) => {
    const title = (postTitle || "").trim();
    const body = (postBody || "").trim();
    if (!title && !body) { alert("Write something first."); return; }
    const now = Date.now();
    const id = `${showId}-u-${now}`;
    const t: Thread = {
      id, showId, season: postProgress.s, episode: postProgress.e,
      author: username, titleBase: title || "Untitled note",
      preview: (body || "").slice(0, 240) + ((body || "").length > 240 ? "…" : ""),
      body: body || "(blank)",
      updatedAt: now, likes: 0, isPrivate
    };
    // Optimistically add to local state (step 3 will persist to DB)
    setDbThreads(prev => [t, ...prev]);
    setReplyCounts(rc => ({ ...rc, [id]: 0 }));
    setComposeOpen(false);
    setPostTitle(""); setPostBody("");
    setActiveThreadId(id);
    setTimeout(() => scrollToShowTop(), 0);
  };

  return (
    <section className="container" style={{ paddingTop: 16, paddingBottom: 140 }}>
      {/* TWO-ROW STICKY BANNER */}
      <div className="stickybar bleed" style={{ top: GLOBAL_HEADER_H }} ref={bannerRef}>
        <div className="container">
          {/* Row 1 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: `${ROW_PAD_Y}px 0` }}>
            <span
              className="hangL"
              role={thread ? "button" : "heading"}
              title={thread ? "Back to forum" : "Forum"}
              onClick={thread ? () => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); } : undefined}
              style={{
                fontSize: 28, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase",
                color: "var(--dos-light)", cursor: thread ? "pointer" : "default", userSelect: "none", flex: "0 0 auto"
              }}
            >
              {String((seedShows.find(s => s.id === showId)?.name) || showId)}
            </span>
            {!thread && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                <select className="badge" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
                  <option value="post">Post date</option>
                  <option value="episode">Episode order</option>
                  <option value="hot">Hot</option>
                </select>
              </div>
            )}
          </div>

          <hr className="bleed-line" />

          {/* Row 2 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: `${ROW_PAD_Y}px 0` }}>
            {!thread ? (
              <button className="btn post h40" onClick={() => setComposeOpen(true)} title="Start a new post">
                + New Post
              </button>
            ) : (
              <button className="btn h40" onClick={() => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); }}>
                ← Back to forum
              </button>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {thread && (
                <ModeToggle
                  value={mode}
                  onToggle={() => setMode(m => (m === "risky" ? "standard" : "risky"))}
                />
              )}
              <OneSelectProgress
                show={seedShows.find(s => s.id === showId) || { seasons: [10] }}
                value={progress[showId] || { s: 1, e: 1 }}
                onConfirm={(val) => updateProgressFor(showId, val)}
                requireConfirm={true}
              />
            </div>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      {thread ? (
        <InlineThreadView
          thread={{ ...thread, likes: likesThreads[thread.id] ?? thread.likes }}
          show={seedShows.find(s => s.id === showId) || { name: showId }}
          onBack={() => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); }}
          progressForShow={progress[showId] || { s: 1, e: 1 }}
          onMountAlignTop={() => scrollToShowTop()}
          likeThread={() => likeThread(thread.id)}
          likedByUser={!!likedByUserThreads[thread.id]}
          likesCount={likesThreads[thread.id] ?? thread.likes}
          likeReply={likeReply}
          likesReplies={likesReplies}
          likedByUserReplies={likedByUserReplies}
          mode={mode}
          focusReplyId={focusReplyId}
        />
      ) : (
        <div style={{ marginTop: 12 }}>
          {threadsLoading && (
            <div className="muted" style={{ fontSize: 14, padding: "24px 0" }}>Loading…</div>
          )}
          {!threadsLoading && displayed.map((t) => {
            const isNew = !!newHighlights[showId]?.[t.id];
            const isRead = !!visitedThreads[t.id];
            const likeCt = likesThreads[t.id] ?? t.likes;
            const replyCt = replyCounts[t.id] ?? 0;

            return (
              <div
                key={t.id}
                className="card threadCard"
                style={{
                  margin: "12px 0",
                  opacity: isRead ? 0.41 : 1,
                  cursor: "pointer",
                  position: "relative",
                  paddingTop: 12,
                  borderLeft: isNew ? "8px solid var(--green)" : "1px solid var(--dos-border)"
                }}
                onClick={() => {
                  setVisitedThreads((v: any) => ({ ...v, [t.id]: true }));
                  setNewHighlights((nh: any) => {
                    const next = { ...(nh[showId] || {}) };
                    delete next[t.id];
                    return { ...nh, [showId]: next };
                  });
                  setActiveThreadId(t.id);
                  setTimeout(() => scrollToShowTop(), 0);
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 style={{ margin: 0, fontSize: 22 }} className="title">
                    <span>{t.titleBase}</span>
                    {t.showId !== "simshow" && (
                      <span style={{ color: "var(--dos-cyan)" }}>{` — S${String(t.season).padStart(2, "0")}E${String(t.episode).padStart(2, "0")}`}</span>
                    )}
                  </h2>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <LikeBadge count={likeCt} readOnly title="open post to vote" />
                  </div>
                </div>

                <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>
                  {show.name} • S{t.season}E{t.episode} • Started by <span className="username">@{t.author}</span> • {timeAgo(t.updatedAt)}
                </div>

                <div style={{ marginTop: 6 }}>
                  <div className="clamp3">{t.preview}</div>
                </div>

                <div className="replyCount">💬 {replyCt}</div>
              </div>
            );
          })}
          {!threadsLoading && displayed.length < baseVisible.length && <div ref={sentinelRef} style={{ height: 1 }} />}
          {!threadsLoading && displayed.length === 0 && (
            <div className="muted" style={{ fontSize: 14 }}>No posts match your watch progress.</div>
          )}
        </div>
      )}

      {/* Compose modal */}
      {composeOpen && (
        <Modal onClose={() => setComposeOpen(false)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <h3 className="title" style={{ margin: 0 }}>New Post</h3>
            <button className="btn" onClick={() => setComposeOpen(false)}>✕</button>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <input
              className="badge"
              placeholder="Title"
              value={postTitle}
              onChange={(e) => setPostTitle(e.target.value)}
              style={{ width: "100%", height: 40, fontWeight: 700 }}
            />
            <div className="muted" style={{ fontSize: 13 }}>
              Your post is automatically marked to <b>S{String(postProgress.s).padStart(2, "0")}E{String(postProgress.e).padStart(2, "0")}</b> and will only show to people who've watched at least that far.
            </div>
            <textarea
              className="card"
              placeholder="Food for thought: did that last episode remind you of something from earlier in the show...or even from your own life?"
              value={postBody}
              onChange={(e) => setPostBody(e.target.value)}
              style={{ width: "100%", height: 260, resize: "vertical" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => setComposeOpen(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => submitPost(false)}>Post</button>
              <button className="btn post" onClick={() => submitPost(true)}>Post privately</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
