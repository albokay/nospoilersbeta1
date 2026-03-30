import React, { useState, useMemo, useEffect } from "react";
import type { Reply, Thread } from "../types";
import { seedShows, seedThreads, repliesByThread } from "../lib/mockData";
import { canView, visibleRepliesCount, timeAgo } from "../lib/utils";
import Tabs from "./Tabs";

const GLOBAL_HEADER_H = 72;
const ROW_PAD_Y = 8;

export default function ProfilePage({
  username,
  progress,
  likesThreads, likesReplies, likedByUserThreads, likedByUserReplies,
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
  const myThreadsAll = useMemo(() => seedThreads
    .filter(t => t.author === username)
    .filter(t => canView({ season: t.season, episode: t.episode }, progress[t.showId]))
    .sort((a, b) => b.updatedAt - a.updatedAt), [username, progress]);

  const postTabs = useMemo(() => {
    const ids = Array.from(new Set(myThreadsAll.map(t => t.showId)));
    return ids.map(id => ({ id, label: seedShows.find(s => s.id === id)?.name || id }));
  }, [myThreadsAll]);

  const [postTab, setPostTab] = useState<string>(postTabs[0]?.id || "");
  useEffect(() => { if (!postTabs.find(t => t.id === postTab) && postTabs[0]) setPostTab(postTabs[0].id); }, [postTabs, postTab]);
  const myThreads = useMemo(() => myThreadsAll.filter(t => t.showId === postTab), [myThreadsAll, postTab]);

  const repliesToMeAll = useMemo(() => {
    const out: { r: Reply; t: Thread }[] = [];
    for (const t of seedThreads) {
      const list = repliesByThread[t.id] || [];
      const byId: Record<string, Reply> = {}; list.forEach(r => byId[r.id] = r);
      const prog = progress[t.showId];
      const chainVisible = (r: Reply) => {
        if (!canView({ season: r.season, episode: r.episode }, prog)) return false;
        let cur = r.replyToId ? byId[r.replyToId] : null;
        while (cur) {
          if (!canView({ season: cur.season, episode: cur.episode }, prog)) return false;
          cur = cur.replyToId ? byId[cur.replyToId] : null;
        }
        return true;
      };
      for (const r of list) {
        if (!r.replyToId) continue;
        const parent = list.find(x => x.id === r.replyToId);
        const involvesMe = (parent && parent.author === username) || (r.author === username);
        if (involvesMe && chainVisible(r)) out.push({ r, t });
      }
    }
    return out.sort((a, b) => (b.r.updatedAt - a.r.updatedAt)).slice(0, 200);
  }, [username, progress]);

  const replyTabs = useMemo(() => {
    const ids = Array.from(new Set(repliesToMeAll.map(p => p.t.showId)));
    return ids.map(id => ({ id, label: seedShows.find(s => s.id === id)?.name || id }));
  }, [repliesToMeAll]);

  const [replyTab, setReplyTab] = useState<string>(replyTabs[0]?.id || "");
  useEffect(() => { if (!replyTabs.find(t => t.id === replyTab) && replyTabs[0]) setReplyTab(replyTabs[0].id); }, [replyTabs, replyTab]);
  const repliesToMe = useMemo(() => repliesToMeAll.filter(p => p.t.showId === replyTab), [repliesToMeAll, replyTab]);

  const likedThreadsList = useMemo(() => seedThreads
    .filter(t => likedByUserThreads[t.id])
    .filter(t => canView({ season: t.season, episode: t.episode }, progress[t.showId]))
    .sort((a, b) => b.updatedAt - a.updatedAt), [likedByUserThreads, progress]);

  const likedRepliesList = useMemo(() => {
    const rows: { r: Reply; t: Thread }[] = [];
    for (const tid of Object.keys(repliesByThread)) {
      const list = repliesByThread[tid];
      const t = seedThreads.find(x => x.id === tid);
      if (!t) continue;
      const byId: Record<string, Reply> = {}; list.forEach(r => byId[r.id] = r);
      const prog = progress[t.showId];
      const chainVisible = (r: Reply) => {
        if (!canView({ season: r.season, episode: r.episode }, prog)) return false;
        let cur = r.replyToId ? byId[r.replyToId] : null;
        while (cur) {
          if (!canView({ season: cur.season, episode: cur.episode }, prog)) return false;
          cur = cur.replyToId ? byId[cur.replyToId] : null;
        }
        return true;
      };
      for (const r of list) if (likedByUserReplies[r.id] && chainVisible(r)) rows.push({ r, t });
    }
    return rows.sort((a, b) => b.r.updatedAt - a.r.updatedAt);
  }, [likedByUserReplies, progress]);

  const likedPostTabs = useMemo(() => {
    const ids = Array.from(new Set(likedThreadsList.map(t => t.showId)));
    return ids.map(id => ({ id, label: seedShows.find(s => s.id === id)?.name || id }));
  }, [likedThreadsList]);

  const [likedPostTab, setLikedPostTab] = useState<string>(likedPostTabs[0]?.id || "");
  useEffect(() => {
    if (!likedPostTabs.find(t => t.id === likedPostTab) && likedPostTabs[0]) setLikedPostTab(likedPostTabs[0].id);
  }, [likedPostTabs, likedPostTab]);
  const likedThreads = useMemo(
    () => likedPostTab ? likedThreadsList.filter(t => t.showId === likedPostTab) : likedThreadsList,
    [likedThreadsList, likedPostTab]
  );

  const likedReplyTabs = useMemo(() => {
    const ids = Array.from(new Set(likedRepliesList.map(p => p.t.showId)));
    return ids.map(id => ({ id, label: seedShows.find(s => s.id === id)?.name || id }));
  }, [likedRepliesList]);

  const [likedReplyTab, setLikedReplyTab] = useState<string>(likedReplyTabs[0]?.id || "");
  useEffect(() => {
    if (!likedReplyTabs.find(t => t.id === likedReplyTab) && likedReplyTabs[0]) setLikedReplyTab(likedReplyTabs[0].id);
  }, [likedReplyTabs, likedReplyTab]);
  const likedReplies = useMemo(
    () => likedReplyTab ? likedRepliesList.filter(p => p.t.showId === likedReplyTab) : likedRepliesList,
    [likedRepliesList, likedReplyTab]
  );

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
                .map(sid => {
                  const s = seedShows.find(x => x.id === sid);
                  return (
                    <a
                      key={sid}
                      onClick={() => openShow(sid)}
                      style={{ cursor: "pointer", textDecoration: "underline", whiteSpace: "nowrap" }}
                      title={`Go to ${s?.name || sid}`}
                    >
                      {s?.name || sid}
                    </a>
                  );
                })
              }
            </div>

            <div style={{ flex: "0 0 auto" }}>
              <button className="btn h40" onClick={onClose}>Homepage</button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ marginTop: 16 }}>
        {/* Your posts */}
        <section style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", marginBottom: 8 }}>
            <div className="title hangL" style={{ fontSize: 18 }}>Your posts</div>
            <Tabs tabs={postTabs} value={postTab} onChange={setPostTab} />
          </div>

          <div className="card scrollWin" style={{ maxHeight: 6 * 120 + 48, overflow: "auto" }}>
            {myThreads.length === 0 && <div className="muted">No posts yet.</div>}
            {myThreads.map(t => (
              <div
                key={t.id}
                className="card threadCard"
                style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
                onClick={() => openThreadWithFocus(t.showId, t.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="title" style={{ fontSize: 18 }}>
                    {t.isPrivate && <span title="Private" aria-label="Private" style={{ marginRight: 8 }}>🔒</span>}
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
                <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                  {seedShows.find(s => s.id === t.showId)?.name || t.showId}
                </div>
                <div style={{ marginTop: 6 }} className="clamp3">{t.preview}</div>
                <div className="replyCount">💬 {visibleRepliesCount(t.id, repliesByThread, progress[t.showId])}</div>
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
            {repliesToMe.length === 0 && <div className="muted">No replies yet.</div>}
            {repliesToMe.map(({ r, t }) => (
              <div key={r.id} className="card" style={{ margin: "10px 0", cursor: "pointer" }}
                onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="muted" style={{ fontSize: 14 }}>
                    On <b>{t.titleBase}</b> <span style={{ color: "var(--dos-cyan)" }}>S{String(r.season).padStart(2, "0")}E{String(r.episode).padStart(2, "0")}</span> • <span className="username">@{r.author}</span> • {timeAgo(r.updatedAt)}
                  </div>
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
              {likedThreads.length === 0 && <div className="muted">You haven't liked any posts yet.</div>}
              {likedThreads.map(t => (
                <div
                  key={t.id}
                  className="card"
                  style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
                  onClick={() => openThreadWithFocus(t.showId, t.id)}
                >
                  <div className="muted" style={{ fontSize: 14 }}>
                    {seedShows.find(s => s.id === t.showId)?.name || t.showId} • {timeAgo(t.updatedAt)}
                  </div>
                  <div className="title" style={{ fontSize: 18, marginTop: 6 }}>
                    {t.titleBase} <span style={{ color: "var(--dos-cyan)" }}>— S{String(t.season).padStart(2, "0")}E{String(t.episode).padStart(2, "0")}</span>
                  </div>
                  <div style={{ marginTop: 6 }} className="clamp3">{t.preview}</div>
                  <div className="replyCount">💬 {visibleRepliesCount(t.id, repliesByThread, progress[t.showId])}</div>
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
              {likedReplies.length === 0 && <div className="muted">You haven't liked any replies yet.</div>}
              {likedReplies.map(({ r, t }) => (
                <div key={r.id} className="card" style={{ margin: "10px 0", cursor: "pointer" }}
                  onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                  <div className="muted" style={{ fontSize: 14 }}>
                    On <b>{t.titleBase}</b> <span style={{ color: "var(--dos-cyan)" }}>S{String(r.season).padStart(2, "0")}E{String(r.episode).padStart(2, "0")}</span> • <span className="username">@{r.author}</span> • {timeAgo(r.updatedAt)}
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
              <a key={sid} onClick={() => openShow(sid)} style={{ display: "block", padding: "6px 8px", borderRadius: 8, cursor: "pointer" }}>
                {seedShows.find(s => s.id === sid)?.name || sid}
              </a>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
