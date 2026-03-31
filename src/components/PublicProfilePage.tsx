import React, { useState, useMemo, useEffect } from "react";
import type { Reply, Thread } from "../types";
import type { Show } from "../lib/db";
import {
  fetchPublicProfileByUsername,
  fetchPublicThreadsForUser,
  fetchPublicRepliesForUser,
  fetchPublicProgressForUser,
} from "../lib/db";
import { canView, timeAgo } from "../lib/utils";
import Tabs from "./Tabs";

const GLOBAL_HEADER_H = 72;
const ROW_PAD_Y = 8;

export default function PublicProfilePage({
  username,
  shows,
  viewerProgress,
  openThreadWithFocus,
  openShow,
  onClose,
}: {
  username: string;
  shows: Show[];
  /** The *viewer's* progress — used for spoiler filtering */
  viewerProgress: Record<string, { s: number; e: number }>;
  openThreadWithFocus: (showId: string, threadId: string, replyId?: string) => void;
  openShow: (showId: string) => void;
  onClose: () => void;
}) {
  const showName = (sid: string) => shows.find(s => s.id === sid)?.name || sid;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [replies, setReplies] = useState<{ reply: Reply; thread: Thread }[]>([]);
  const [targetProgress, setTargetProgress] = useState<Record<string, { s: number; e: number }>>({});

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    fetchPublicProfileByUsername(username).then(profile => {
      if (!profile) { setNotFound(true); setLoading(false); return; }
      return Promise.all([
        fetchPublicThreadsForUser(profile.id),
        fetchPublicRepliesForUser(profile.id),
        fetchPublicProgressForUser(profile.id),
      ]).then(([t, r, prog]) => {
        setThreads(t);
        setReplies(r);
        setTargetProgress(prog);
        setLoading(false);
      });
    }).catch(err => {
      console.error("PublicProfilePage load error:", err);
      setLoading(false);
    });
  }, [username]);

  // Spoiler-filter: only show content up to what the *viewer* has watched
  const visibleThreads = useMemo(() =>
    threads.filter(t => canView({ season: t.season, episode: t.episode }, viewerProgress[t.showId])),
    [threads, viewerProgress]);

  const visibleReplies = useMemo(() =>
    replies.filter(({ reply: r, thread: t }) =>
      canView({ season: r.season, episode: r.episode }, viewerProgress[t.showId])),
    [replies, viewerProgress]);

  // Show tabs for posts
  const postTabs = useMemo(() => {
    const ids = Array.from(new Set(visibleThreads.map(t => t.showId)));
    return ids.map(id => ({ id, label: showName(id) }));
  }, [visibleThreads, shows]);
  const [postTab, setPostTab] = useState("");
  useEffect(() => {
    if (!postTabs.find(t => t.id === postTab) && postTabs[0]) setPostTab(postTabs[0].id);
  }, [postTabs]);
  const threadsFiltered = useMemo(() =>
    postTab ? visibleThreads.filter(t => t.showId === postTab) : visibleThreads,
    [visibleThreads, postTab]);

  // Show tabs for replies
  const replyTabs = useMemo(() => {
    const ids = Array.from(new Set(visibleReplies.map(p => p.thread.showId)));
    return ids.map(id => ({ id, label: showName(id) }));
  }, [visibleReplies, shows]);
  const [replyTab, setReplyTab] = useState("");
  useEffect(() => {
    if (!replyTabs.find(t => t.id === replyTab) && replyTabs[0]) setReplyTab(replyTabs[0].id);
  }, [replyTabs]);
  const repliesFiltered = useMemo(() =>
    replyTab ? visibleReplies.filter(p => p.thread.showId === replyTab) : visibleReplies,
    [visibleReplies, replyTab]);

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      {/* Sticky header */}
      <div className="stickybar bleed" style={{ top: GLOBAL_HEADER_H }}>
        <div className="container" style={{ padding: `${ROW_PAD_Y}px 0` }}>
          <div className="hangL" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "0 0 auto" }}>
              <div className="avatar">{(username?.[0] || "?").toUpperCase()}</div>
              <div className="title" style={{ fontSize: 22, fontWeight: 700, color: "var(--dos-fg)" }}>
                {username}
              </div>
              {!loading && !notFound && (
                <div className="muted" style={{ fontStyle: "italic", fontWeight: 600, letterSpacing: 0.2 }}>
                  is watching…
                </div>
              )}
            </div>

            {/* Shows they're tracking */}
            {!notFound && (
              <div className="scrollWin" style={{ display: "flex", gap: 12, overflowX: "auto", padding: "4px 0", flex: "1 1 auto" }}>
                {Object.keys(targetProgress).map(sid => (
                  <a key={sid} onClick={() => openShow(sid)}
                    style={{ cursor: "pointer", textDecoration: "underline", whiteSpace: "nowrap" }}
                    title={`Go to ${showName(sid)}`}>
                    {showName(sid)}
                  </a>
                ))}
              </div>
            )}

            <div style={{ flex: "0 0 auto" }}>
              <button className="btn h40" onClick={onClose}>← Back</button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ marginTop: 16 }}>
        {loading && (
          <div className="muted" style={{ padding: "24px 0" }}>Loading profile…</div>
        )}

        {!loading && notFound && (
          <div className="muted" style={{ padding: "24px 0" }}>
            Profile not found.
          </div>
        )}

        {!loading && !notFound && (
          <>
            {/* Their posts */}
            <section style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", marginBottom: 8 }}>
                <div className="title hangL" style={{ fontSize: 18 }}>Posts</div>
                <Tabs tabs={postTabs} value={postTab} onChange={setPostTab} />
              </div>
              <div className="card scrollWin" style={{ maxHeight: 6 * 120 + 48, overflow: "auto" }}>
                {threadsFiltered.length === 0 && (
                  <div className="muted">No posts visible to you yet.</div>
                )}
                {threadsFiltered.map(t => (
                  <div key={t.id} className="card threadCard"
                    style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
                    onClick={() => openThreadWithFocus(t.showId, t.id)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div className="title" style={{ fontSize: 18 }}>
                        {t.titleBase}
                        {t.showId !== "simshow" && (
                          <span style={{ color: "var(--dos-cyan)" }}>
                            {` — S${String(t.season).padStart(2, "0")}E${String(t.episode).padStart(2, "0")}`}
                          </span>
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: 14 }}>
                        {timeAgo(t.updatedAt)}
                      </div>
                    </div>
                    <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{showName(t.showId)}</div>
                    <div style={{ marginTop: 6 }} className="clamp3">{t.preview}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Their replies */}
            <section style={{ marginTop: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", marginBottom: 8 }}>
                <div className="title hangL" style={{ fontSize: 18 }}>Replies</div>
                <Tabs tabs={replyTabs} value={replyTab} onChange={setReplyTab} />
              </div>
              <div className="card scrollWin" style={{ maxHeight: 6 * 110 + 48, overflow: "auto" }}>
                {repliesFiltered.length === 0 && (
                  <div className="muted">No replies visible to you yet.</div>
                )}
                {repliesFiltered.map(({ reply: r, thread: t }) => (
                  <div key={r.id} className="card" style={{ margin: "10px 0", cursor: "pointer" }}
                    onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                    <div className="muted" style={{ fontSize: 14 }}>
                      On <b>{t.titleBase}</b>{" "}
                      <span style={{ color: "var(--dos-cyan)" }}>
                        S{String(r.season).padStart(2, "0")}E{String(r.episode).padStart(2, "0")}
                      </span>{" "}
                      • {timeAgo(r.updatedAt)}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 15 }} className="clamp3">{r.body}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
