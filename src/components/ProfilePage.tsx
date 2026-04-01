import React, { useState, useMemo, useEffect } from "react";
import type { Reply, Thread } from "../types";
import { seedShows } from "../lib/mockData";
import type { Show } from "../lib/db";
import { fetchUserThreads, fetchUserReplies, fetchRepliesToUserThreads, fetchLikedThreads, fetchLikedReplies } from "../lib/db";
import { useAuth } from "../lib/auth";
import { canView, timeAgo } from "../lib/utils";

const GLOBAL_HEADER_H = 72;
const ROW_PAD_Y = 8;

export default function ProfilePage({
  shows: showsProp,
  username,
  progress,
  openThreadWithFocus, openShow, onClose
}: {
  shows: Show[];
  username: string;
  progress: Record<string, { s: number; e: number }>;
  likesThreads: Record<string, number>;
  likesReplies: Record<string, number>;
  likedByUserThreads: Record<string, boolean>;
  likedByUserReplies: Record<string, boolean>;
  openThreadWithFocus: (showId: string, threadId: string, replyId?: string) => void;
  openShow: (showId: string) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const allShows: Show[] = showsProp?.length ? showsProp : seedShows as Show[];
  const showName = (showId: string) => allShows.find(s => s.id === showId)?.name || showId;

  const [myThreads, setMyThreads] = useState<Thread[]>([]);
  const [myReplies, setMyReplies] = useState<{ reply: Reply; thread: Thread }[]>([]);
  const [repliesToMe, setRepliesToMe] = useState<{ reply: Reply; thread: Thread }[]>([]);
  const [likedThreadsList, setLikedThreadsList] = useState<Thread[]>([]);
  const [likedRepliesList, setLikedRepliesList] = useState<{ reply: Reply; thread: Thread }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      fetchUserThreads(user.id),
      fetchUserReplies(user.id),
      fetchRepliesToUserThreads(user.id),
      fetchLikedThreads(user.id),
      fetchLikedReplies(user.id),
    ]).then(([threads, myR, replies, likedT, likedR]) => {
      setMyThreads(threads);
      setMyReplies(myR);
      setRepliesToMe(replies);
      setLikedThreadsList(likedT);
      setLikedRepliesList(likedR);
      setLoading(false);
    }).catch(err => {
      console.error("ProfilePage load error:", err);
      setLoading(false);
    });
  }, [user?.id]);

  // Spoiler-filter
  const visibleThreads = useMemo(() =>
    myThreads.filter(t => canView({ season: t.season, episode: t.episode }, progress[t.showId])),
    [myThreads, progress]);

  const visibleMyReplies = useMemo(() =>
    myReplies.filter(({ reply: r, thread: t }) =>
      canView({ season: r.season, episode: r.episode }, progress[t.showId])),
    [myReplies, progress]);

  const visibleRepliesToMe = useMemo(() =>
    repliesToMe.filter(({ reply: r, thread: t }) =>
      canView({ season: r.season, episode: r.episode }, progress[t.showId])),
    [repliesToMe, progress]);

  const visibleLikedThreads = useMemo(() =>
    likedThreadsList.filter(t => canView({ season: t.season, episode: t.episode }, progress[t.showId])),
    [likedThreadsList, progress]);

  const visibleLikedReplies = useMemo(() =>
    likedRepliesList.filter(({ reply: r, thread: t }) =>
      canView({ season: r.season, episode: r.episode }, progress[t.showId])),
    [likedRepliesList, progress]);

  // Compute show tab order: most recently engaged first
  const showTabOrder = useMemo(() => {
    const latest: Record<string, number> = {};
    const bump = (sid: string, ts: number) => {
      if (!latest[sid] || ts > latest[sid]) latest[sid] = ts;
    };
    myThreads.forEach(t => bump(t.showId, t.updatedAt));
    myReplies.forEach(({ reply: r, thread: t }) => bump(t.showId, r.updatedAt));
    repliesToMe.forEach(({ reply: r, thread: t }) => bump(t.showId, r.updatedAt));
    likedThreadsList.forEach(t => bump(t.showId, t.updatedAt));
    likedRepliesList.forEach(({ reply: r, thread: t }) => bump(t.showId, r.updatedAt));
    // include shows from progress even if no posts yet
    Object.keys(progress).forEach(sid => { if (!latest[sid]) latest[sid] = 0; });
    return Object.keys(latest).sort((a, b) => latest[b] - latest[a]);
  }, [myThreads, myReplies, repliesToMe, likedThreadsList, likedRepliesList, progress]);

  const [activeTab, setActiveTab] = useState("");
  useEffect(() => {
    if (!loading && showTabOrder.length) setActiveTab(showTabOrder[0]);
  }, [loading]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // clear expanded state when switching tabs
  useEffect(() => { setExpandedIds(new Set()); }, [activeTab]);
  const toggleExpand = (id: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // All content filtered to active tab
  const tabThreads = useMemo(() =>
    visibleThreads.filter(t => t.showId === activeTab), [visibleThreads, activeTab]);

  const tabMyReplies = useMemo(() =>
    visibleMyReplies.filter(p => p.thread.showId === activeTab), [visibleMyReplies, activeTab]);

  const tabRepliesToMe = useMemo(() =>
    visibleRepliesToMe.filter(p => p.thread.showId === activeTab), [visibleRepliesToMe, activeTab]);

  const tabLikedThreads = useMemo(() =>
    visibleLikedThreads.filter(t => t.showId === activeTab), [visibleLikedThreads, activeTab]);

  const tabLikedReplies = useMemo(() =>
    visibleLikedReplies.filter(p => p.thread.showId === activeTab), [visibleLikedReplies, activeTab]);

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      {/* Sticky header — show pills stay as forum quick-links */}
      <div className="stickybar bleed" style={{ top: GLOBAL_HEADER_H }}>
        <div className="container" style={{ padding: `${ROW_PAD_Y}px 0` }}>
          <div className="hangL" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "0 0 auto" }}>
              <div className="avatar">{(username?.[0] || "?").toUpperCase()}</div>
              <div className="title" style={{ fontSize: 22, fontWeight: 700, color: "var(--dos-fg)" }}>{username}</div>
              <div className="muted" style={{ fontStyle: "italic", fontWeight: 600, letterSpacing: 0.2 }}>is watching…</div>
            </div>
            <div className="scrollWin" style={{ display: "flex", gap: 12, overflowX: "auto", padding: "4px 0", flex: "1 1 auto" }}>
              {Object.keys(progress).sort((a, b) => {
                const showA = allShows.find(s => s.id === a);
                const showB = allShows.find(s => s.id === b);
                const pa = progress[a]; const pb = progress[b];
                const ra = showA ? (pa.s - 1) + (pa.e / (showA.seasons[pa.s - 1] || 1)) : 0;
                const rb = showB ? (pb.s - 1) + (pb.e / (showB.seasons[pb.s - 1] || 1)) : 0;
                return rb - ra;
              }).map(sid => (
                <a key={sid} onClick={() => openShow(sid)}
                  style={{ cursor: "pointer", textDecoration: "underline", whiteSpace: "nowrap" }}
                  title={`Go to ${showName(sid)}`}>
                  {showName(sid)}
                </a>
              ))}
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <button className="btn h40" onClick={onClose}>Homepage</button>
            </div>
          </div>
        </div>
      </div>

      {loading && <div className="muted" style={{ padding: "24px 0" }}>Loading your profile…</div>}

      {!loading && (
        <div className="container" style={{ marginTop: 32 }}>
          {/* Scrollable show folder tabs */}
          {showTabOrder.length > 0 && (
            /* marginBottom: -2 makes the tab row overlap the content border below by 2px,
               so the active tab (z-index 1, no bottom border) visually "opens" into the content */
            <div style={{ display: "flex", overflowX: "auto", gap: 4, marginBottom: -2 }}>
              {showTabOrder.map(sid => {
                const active = sid === activeTab;
                return (
                  <button
                    key={sid}
                    onClick={() => setActiveTab(sid)}
                    style={{
                      padding: active ? "8px 18px" : "5px 18px",
                      background: active ? "var(--dos-bg)" : "rgba(0,0,0,0.18)",
                      border: "2px solid var(--dos-border)",
                      borderBottom: active ? "2px solid var(--dos-bg)" : "2px solid var(--dos-border)",
                      borderRadius: "8px 8px 0 0",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      color: "var(--dos-fg)",
                      fontWeight: active ? 800 : 500,
                      fontSize: 14,
                      letterSpacing: 0.3,
                      alignSelf: "flex-end",
                      position: "relative",
                      zIndex: active ? 1 : 0,
                    }}
                  >
                    {showName(sid)}
                  </button>
                );
              })}
            </div>
          )}

          {showTabOrder.length === 0 && (
            <div className="muted" style={{ padding: "24px 0" }}>No shows yet.</div>
          )}

          {activeTab && (
            /* borderTop is the "line" — active tab overlaps and covers it with its own background */
            <div style={{ borderTop: "2px solid var(--dos-border)", paddingTop: 20, marginLeft: -45, paddingLeft: 45 }}>
            <>
              {/* Your posts */}
              <section style={{ marginTop: 0 }}>
                <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>Your posts</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabThreads.length === 0 && <div className="muted">No posts yet.</div>}
                  {tabThreads.map(t => (
                    <div key={t.id} className="card threadCard"
                      style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="title" style={{ fontSize: 18 }}>
                          {t.isPrivate && <span title="Private" style={{ marginRight: 8 }}>🔒</span>}
                          {t.titleBase}
                          {t.showId !== "simshow" && (
                            <span style={{ color: "var(--dos-cyan)" }}>
                              {` — S${String(t.season).padStart(2, "0")}E${String(t.episode).padStart(2, "0")}`}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {t.body !== t.preview && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(t.id); }}>
                              {expandedIds.has(t.id) ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>{timeAgo(t.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: expandedIds.has(t.id) ? "pre-wrap" : undefined }}
                        className={expandedIds.has(t.id) ? undefined : "clamp3"}>
                        {expandedIds.has(t.id) ? t.body : t.preview}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Your replies */}
              <section style={{ marginTop: 24 }}>
                <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>Your replies</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabMyReplies.length === 0 && <div className="muted">No replies yet.</div>}
                  {tabMyReplies.map(({ reply: r, thread: t }) => (
                    <div key={r.id} className="card" style={{ margin: "10px 0", cursor: "pointer" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="muted" style={{ fontSize: 14 }}>
                          On <b>{t.titleBase}</b>{" "}
                          {t.showId !== "simshow" && (
                            <span style={{ color: "var(--dos-cyan)" }}>
                              S{String(r.season).padStart(2, "0")}E{String(r.episode).padStart(2, "0")}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {(r.body.length > 260 || r.body.split('\n').length > 3) && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }}>
                              {expandedIds.has(r.id) ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>{timeAgo(r.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 15 }}
                        className={expandedIds.has(r.id) ? undefined : "clamp3"}>
                        {r.body}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Replies to you */}
              <section style={{ marginTop: 24 }}>
                <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>Replies to you</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabRepliesToMe.length === 0 && <div className="muted">No replies yet.</div>}
                  {tabRepliesToMe.map(({ reply: r, thread: t }) => (
                    <div key={r.id} className="card" style={{ margin: "10px 0", cursor: "pointer" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="muted" style={{ fontSize: 14 }}>
                          On <b>{t.titleBase}</b>{" "}
                          <span style={{ color: "var(--dos-cyan)" }}>
                            S{String(r.season).padStart(2, "0")}E{String(r.episode).padStart(2, "0")}
                          </span>{" "}
                          • <span className="username">@{r.author}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {(r.body.length > 260 || r.body.split('\n').length > 3) && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }}>
                              {expandedIds.has(r.id) ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>{timeAgo(r.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 15 }}
                        className={expandedIds.has(r.id) ? undefined : "clamp3"}>
                        {r.body}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Starred posts */}
              <section style={{ marginTop: 24 }}>
                <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>Your starred posts</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabLikedThreads.length === 0 && <div className="muted">No starred posts yet.</div>}
                  {tabLikedThreads.map(t => (
                    <div key={t.id} className="card threadCard"
                      style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="title" style={{ fontSize: 18 }}>
                          {t.titleBase}
                          {t.showId !== "simshow" && (
                            <span style={{ color: "var(--dos-cyan)" }}>
                              {` — S${String(t.season).padStart(2, "0")}E${String(t.episode).padStart(2, "0")}`}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {t.body !== t.preview && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(t.id); }}>
                              {expandedIds.has(t.id) ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>{timeAgo(t.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: expandedIds.has(t.id) ? "pre-wrap" : undefined }}
                        className={expandedIds.has(t.id) ? undefined : "clamp3"}>
                        {expandedIds.has(t.id) ? t.body : t.preview}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Starred replies */}
              <section style={{ marginTop: 24 }}>
                <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>Your starred replies</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabLikedReplies.length === 0 && <div className="muted">No starred replies yet.</div>}
                  {tabLikedReplies.map(({ reply: r, thread: t }) => (
                    <div key={r.id} className="card" style={{ margin: "10px 0", cursor: "pointer" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="muted" style={{ fontSize: 14 }}>
                          On <b>{t.titleBase}</b>{" "}
                          <span style={{ color: "var(--dos-cyan)" }}>
                            S{String(r.season).padStart(2, "0")}E{String(r.episode).padStart(2, "0")}
                          </span>{" "}
                          • <span className="username">@{r.author}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {(r.body.length > 260 || r.body.split('\n').length > 3) && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }}>
                              {expandedIds.has(r.id) ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>{timeAgo(r.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6 }}
                        className={expandedIds.has(r.id) ? undefined : "clamp3"}>
                        {r.body}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
