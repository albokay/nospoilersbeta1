import React, { useState, useMemo, useEffect } from "react";
import type { Reply, Thread } from "../types";
import { seedShows } from "../lib/mockData";
import { fetchUserThreads, fetchRepliesToUserThreads, fetchLikedThreads, fetchLikedReplies } from "../lib/db";
import { useAuth } from "../lib/auth";
import { canView, timeAgo } from "../lib/utils";
import Tabs from "./Tabs";

const GLOBAL_HEADER_H = 72;
const ROW_PAD_Y = 8;

function showName(showId: string) {
  return seedShows.find(s => s.id === showId)?.name || showId;
}

export default function ProfilePage({
  username,
  progress,
  openThreadWithFocus, openShow, onClose
}: {
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

  const [myThreads, setMyThreads] = useState<Thread[]>([]);
  const [repliesToMe, setRepliesToMe] = useState<{ reply: Reply; thread: Thread }[]>([]);
  const [likedThreadsList, setLikedThreadsList] = useState<Thread[]>([]);
  const [likedRepliesList, setLikedRepliesList] = useState<{ reply: Reply; thread: Thread }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      fetchUserThreads(user.id),
      fetchRepliesToUserThreads(user.id),
      fetchLikedThreads(user.id),
      fetchLikedReplies(user.id),
    ]).then(([threads, replies, likedT, likedR]) => {
      setMyThreads(threads);
      setRepliesToMe(replies);
      setLikedThreadsList(likedT);
      setLikedRepliesList(likedR);
      setLoading(false);
    }).catch(err => {
      console.error("ProfilePage load error:", err);
      setLoading(false);
    });
  }, [user?.id]);

  // ── Spoiler-filter helpers ─────────────────────────────────
  const visibleThreads = useMemo(() =>
    myThreads.filter(t => canView({ season: t.season, episode: t.episode }, progress[t.showId])),
    [myThreads, progress]);

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

  // ── Tab state ──────────────────────────────────────────────
  const postTabs = useMemo(() => {
    const ids = Array.from(new Set(visibleThreads.map(t => t.showId)));
    return ids.map(id => ({ id, label: showName(id) }));
  }, [visibleThreads]);
  const [postTab, setPostTab] = useState("");
  useEffect(() => {
    if (!postTabs.find(t => t.id === postTab) && postTabs[0]) setPostTab(postTabs[0].id);
  }, [postTabs]);
  const myThreadsFiltered = useMemo(() =>
    postTab ? visibleThreads.filter(t => t.showId === postTab) : visibleThreads,
    [visibleThreads, postTab]);

  const replyTabs = useMemo(() => {
    const ids = Array.from(new Set(visibleRepliesToMe.map(p => p.thread.showId)));
    return ids.map(id => ({ id, label: showName(id) }));
  }, [visibleRepliesToMe]);
  const [replyTab, setReplyTab] = useState("");
  useEffect(() => {
    if (!replyTabs.find(t => t.id === replyTab) && replyTabs[0]) setReplyTab(replyTabs[0].id);
  }, [replyTabs]);
  const repliesToMeFiltered = useMemo(() =>
    replyTab ? visibleRepliesToMe.filter(p => p.thread.showId === replyTab) : visibleRepliesToMe,
    [visibleRepliesToMe, replyTab]);

  const likedPostTabs = useMemo(() => {
    const ids = Array.from(new Set(visibleLikedThreads.map(t => t.showId)));
    return ids.map(id => ({ id, label: showName(id) }));
  }, [visibleLikedThreads]);
  const [likedPostTab, setLikedPostTab] = useState("");
  useEffect(() => {
    if (!likedPostTabs.find(t => t.id === likedPostTab) && likedPostTabs[0]) setLikedPostTab(likedPostTabs[0].id);
  }, [likedPostTabs]);
  const likedThreadsFiltered = useMemo(() =>
    likedPostTab ? visibleLikedThreads.filter(t => t.showId === likedPostTab) : visibleLikedThreads,
    [visibleLikedThreads, likedPostTab]);

  const likedReplyTabs = useMemo(() => {
    const ids = Array.from(new Set(visibleLikedReplies.map(p => p.thread.showId)));
    return ids.map(id => ({ id, label: showName(id) }));
  }, [visibleLikedReplies]);
  const [likedReplyTab, setLikedReplyTab] = useState("");
  useEffect(() => {
    if (!likedReplyTabs.find(t => t.id === likedReplyTab) && likedReplyTabs[0]) setLikedReplyTab(likedReplyTabs[0].id);
  }, [likedReplyTabs]);
  const likedRepliesFiltered = useMemo(() =>
    likedReplyTab ? visibleLikedReplies.filter(p => p.thread.showId === likedReplyTab) : visibleLikedReplies,
    [visibleLikedReplies, likedReplyTab]);

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      <div className="stickybar bleed" style={{ top: GLOBAL_HEADER_H }}>
        <div className="container" style={{ padding: `${ROW_PAD_Y}px 0` }}>
          <div className="hangL" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "0 0 auto" }}>
              <div className="avatar">{(username?.[0] || "?").toUpperCase()}</div>
              <div className="title" style={{ fontSize: 22, fontWeight: 700, color: "var(--dos-fg)" }}>{username}</div>
              <div className="muted" style={{ fontStyle: "italic", fontWeight: 600, letterSpacing: 0.2 }}>is watching…</div>
            </div>

            <div className="scrollWin" style={{ display: "flex", gap: 12, overflowX: "auto", padding: "4px 0", flex: "1 1 auto" }}>
              {Object.keys(progress)
                .sort((a, b) => {
                  const showA = seedShows.find(s => s.id === a);
                  const showB = seedShows.find(s => s.id === b);
                  const pa = progress[a]; const pb = progress[b];
                  const ra = showA ? (pa.s - 1) + (pa.e / (showA.seasons[pa.s - 1] || 1)) : 0;
                  const rb = showB ? (pb.s - 1) + (pb.e / (showB.seasons[pb.s - 1] || 1)) : 0;
                  return rb - ra;
                })
                .map(sid => (
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

      <div className="container" style={{ marginTop: 16 }}>
        {loading && <div className="muted" style={{ padding: "24px 0" }}>Loading your profile…</div>}

        {/* Your posts */}
        <section style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", marginBottom: 8 }}>
            <div className="title hangL" style={{ fontSize: 18 }}>Your posts</div>
            <Tabs tabs={postTabs} value={postTab} onChange={setPostTab} />
          </div>
          <div className="card scrollWin" style={{ maxHeight: 6 * 120 + 48, overflow: "auto" }}>
            {!loading && myThreadsFiltered.length === 0 && <div className="muted">No posts yet.</div>}
            {myThreadsFiltered.map(t => (
              <div key={t.id} className="card threadCard"
                style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
                onClick={() => openThreadWithFocus(t.showId, t.id)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="title" style={{ fontSize: 18 }}>
                    {t.isPrivate && <span title="Private" style={{ marginRight: 8 }}>🔒</span>}
                    {t.titleBase}
                    {t.showId !== "simshow" && (
                      <span style={{ color: "var(--dos-cyan)" }}>
                        {` — S${String(t.season).padStart(2, "0")}E${String(t.episode).padStart(2, "0")}`}
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 14 }}>
                    <span className="username">@{t.author}</span> • {timeAgo(t.updatedAt)}
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{showName(t.showId)}</div>
                <div style={{ marginTop: 6 }} className="clamp3">{t.preview}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Replies to you */}
        <section style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", marginBottom: 8 }}>
            <div className="title hangL" style={{ fontSize: 18 }}>Replies to you</div>
            <Tabs tabs={replyTabs} value={replyTab} onChange={setReplyTab} />
          </div>
          <div className="card scrollWin" style={{ maxHeight: 6 * 110 + 48, overflow: "auto" }}>
            {!loading && repliesToMeFiltered.length === 0 && <div className="muted">No replies yet.</div>}
            {repliesToMeFiltered.map(({ reply: r, thread: t }) => (
              <div key={r.id} className="card" style={{ margin: "10px 0", cursor: "pointer" }}
                onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                <div className="muted" style={{ fontSize: 14 }}>
                  On <b>{t.titleBase}</b>{" "}
                  <span style={{ color: "var(--dos-cyan)" }}>
                    S{String(r.season).padStart(2, "0")}E{String(r.episode).padStart(2, "0")}
                  </span>{" "}
                  • <span className="username">@{r.author}</span> • {timeAgo(r.updatedAt)}
                </div>
                <div style={{ marginTop: 6, fontSize: 15 }} className="clamp3">{r.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* You liked */}
        <section style={{ marginTop: 24 }}>
          <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>You liked</div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="title" style={{ fontSize: 16 }}>Posts</div>
            {likedPostTabs.length > 0 && (
              <Tabs tabs={likedPostTabs} value={likedPostTab} onChange={setLikedPostTab} />
            )}
            <div className="card scrollWin" style={{ maxHeight: 6 * 120 + 48, overflow: "auto" }}>
              {!loading && likedThreadsFiltered.length === 0 && <div className="muted">You haven't liked any posts yet.</div>}
              {likedThreadsFiltered.map(t => (
                <div key={t.id} className="card"
                  style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
                  onClick={() => openThreadWithFocus(t.showId, t.id)}>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {showName(t.showId)} • {timeAgo(t.updatedAt)}
                  </div>
                  <div className="title" style={{ fontSize: 18, marginTop: 6 }}>
                    {t.titleBase}{" "}
                    <span style={{ color: "var(--dos-cyan)" }}>
                      — S{String(t.season).padStart(2, "0")}E{String(t.episode).padStart(2, "0")}
                    </span>
                  </div>
                  <div style={{ marginTop: 6 }} className="clamp3">{t.preview}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="title" style={{ fontSize: 16 }}>Replies</div>
            {likedReplyTabs.length > 0 && (
              <Tabs tabs={likedReplyTabs} value={likedReplyTab} onChange={setLikedReplyTab} />
            )}
            <div className="card scrollWin" style={{ maxHeight: 6 * 110 + 48, overflow: "auto" }}>
              {!loading && likedRepliesFiltered.length === 0 && <div className="muted">You haven't liked any replies yet.</div>}
              {likedRepliesFiltered.map(({ reply: r, thread: t }) => (
                <div key={r.id} className="card" style={{ margin: "10px 0", cursor: "pointer" }}
                  onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                  <div className="muted" style={{ fontSize: 14 }}>
                    On <b>{t.titleBase}</b>{" "}
                    <span style={{ color: "var(--dos-cyan)" }}>
                      S{String(r.season).padStart(2, "0")}E{String(r.episode).padStart(2, "0")}
                    </span>{" "}
                    • <span className="username">@{r.author}</span> • {timeAgo(r.updatedAt)}
                  </div>
                  <div style={{ marginTop: 6 }}>{r.body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Your shows quick links */}
        <section style={{ marginTop: 24 }}>
          <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>Your shows</div>
          <div className="card">
            {Object.keys(progress).length === 0 && <div className="muted">No shows yet.</div>}
            {Object.keys(progress).map((sid) => (
              <a key={sid} onClick={() => openShow(sid)}
                style={{ display: "block", padding: "6px 8px", borderRadius: 8, cursor: "pointer" }}>
                {showName(sid)}
              </a>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
