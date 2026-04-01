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

  // Spoiler-filter by viewer's own progress
  const visibleThreads = useMemo(() =>
    threads.filter(t => canView({ season: t.season, episode: t.episode }, viewerProgress[t.showId])),
    [threads, viewerProgress]);

  const visibleReplies = useMemo(() =>
    replies.filter(({ reply: r, thread: t }) =>
      canView({ season: r.season, episode: r.episode }, viewerProgress[t.showId])),
    [replies, viewerProgress]);

  // Show tab order: most recently engaged first
  const showTabOrder = useMemo(() => {
    const latest: Record<string, number> = {};
    const bump = (sid: string, ts: number) => {
      if (!latest[sid] || ts > latest[sid]) latest[sid] = ts;
    };
    threads.forEach(t => bump(t.showId, t.updatedAt));
    replies.forEach(({ reply: r, thread: t }) => bump(t.showId, r.updatedAt));
    Object.keys(targetProgress).forEach(sid => { if (!latest[sid]) latest[sid] = 0; });
    return Object.keys(latest).sort((a, b) => latest[b] - latest[a]);
  }, [threads, replies, targetProgress]);

  const [activeTab, setActiveTab] = useState("");
  useEffect(() => {
    if (!loading && showTabOrder.length) setActiveTab(showTabOrder[0]);
  }, [loading]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  useEffect(() => { setExpandedIds(new Set()); }, [activeTab]);
  const toggleExpand = (id: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const tabThreads = useMemo(() =>
    visibleThreads.filter(t => t.showId === activeTab), [visibleThreads, activeTab]);

  const tabReplies = useMemo(() =>
    visibleReplies.filter(p => p.thread.showId === activeTab), [visibleReplies, activeTab]);

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      {loading && <div className="muted" style={{ padding: "24px 0" }}>Loading profile…</div>}

      {!loading && notFound && (
        <div className="muted" style={{ padding: "24px 0" }}>Profile not found.</div>
      )}

      {!loading && !notFound && (
        <div className="container" style={{ marginTop: 32 }}>
          {/* Scrollable show folder tabs */}
          {showTabOrder.length > 0 && (
            <div style={{ display: "flex", overflowX: "auto", gap: 4, marginBottom: -2 }}>
              {showTabOrder.map(sid => {
                const active = sid === activeTab;
                return (
                  <button
                    key={sid}
                    onClick={() => active ? openShow(sid) : setActiveTab(sid)}
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
                      textDecoration: active ? "underline" : "none",
                      textUnderlineOffset: 3,
                    }}
                  >
                    {showName(sid)}
                  </button>
                );
              })}
            </div>
          )}

          {showTabOrder.length === 0 && (
            <div className="muted" style={{ padding: "24px 0" }}>Nothing to show yet.</div>
          )}

          {activeTab && (
            <div style={{ borderTop: "2px solid var(--dos-border)", paddingTop: 20, marginLeft: -45, paddingLeft: 45 }}>
            <>
              {/* Their posts */}
              <section style={{ marginTop: 0 }}>
                <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>Posts</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabThreads.length === 0 && (
                    <div className="muted">No posts visible to you yet.</div>
                  )}
                  {tabThreads.map(t => (
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

              {/* Their replies */}
              <section style={{ marginTop: 24 }}>
                <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>Replies</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabReplies.length === 0 && (
                    <div className="muted">No replies visible to you yet.</div>
                  )}
                  {tabReplies.map(({ reply: r, thread: t }) => (
                    <div key={r.id} className="card" style={{ margin: "10px 0", cursor: "pointer" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="muted" style={{ fontSize: 14 }}>
                          On <b>{t.titleBase}</b>{" "}
                          <span style={{ color: "var(--dos-cyan)" }}>
                            S{String(r.season).padStart(2, "0")}E{String(r.episode).padStart(2, "0")}
                          </span>
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
            </>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
