import React, { useState, useMemo, useEffect, useRef } from "react";
import type { Reply, Thread } from "../types";
import { seedShows } from "../lib/mockData";
import type { Show } from "../lib/db";
import { fetchUserThreads, fetchUserReplies, fetchRepliesToUserThreads, fetchLikedThreads, fetchLikedReplies } from "../lib/db";
import { useAuth } from "../lib/auth";
import { canView, timeAgo } from "../lib/utils";
import Tooltip from "./Tooltip";

const GLOBAL_HEADER_H = 72;
const ROW_PAD_Y = 8;

export type ProfileTabData = {
  showTabOrder: string[];
  activeTab: string;
  onTabClick: (sid: string) => void;
  tabActivity: Record<string, "green" | "red">;
  viewedTabIds: Set<string>;
};

export default function ProfilePage({
  shows: showsProp,
  username,
  progress,
  openThreadWithFocus, openShow, onClose,
  repliesToUser = [],
  openedAtSeenAt = 0,
  onTabsChange,
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
  repliesToUser?: { reply: Reply; thread: Thread }[];
  openedAtSeenAt?: number;
  onTabsChange?: (data: ProfileTabData | null) => void;
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
  const [viewedTabIds, setViewedTabIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!loading && showTabOrder.length) {
      setActiveTab(showTabOrder[0]);
      setViewedTabIds(prev => new Set([...prev, showTabOrder[0]]));
    }
  }, [loading]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // clear expanded state when switching tabs
  useEffect(() => { setExpandedIds(new Set()); }, [activeTab]);

  const [diaryFilter, setDiaryFilter] = useState<"all" | "private">("all");
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

  // Which threads have invisible replies, and how many
  const invisibleByThreadId = useMemo(() => {
    const r: Record<string, true> = {};
    for (const { reply, thread: t } of repliesToUser) {
      if (!canView({ season: reply.season, episode: reply.episode }, progress[t.showId])) r[t.id] = true;
    }
    return r;
  }, [repliesToUser, progress]);

  const invisibleCountByThreadId = useMemo(() => {
    const r: Record<string, number> = {};
    for (const { reply, thread: t } of repliesToUser) {
      if (!canView({ season: reply.season, episode: reply.episode }, progress[t.showId]))
        r[t.id] = (r[t.id] ?? 0) + 1;
    }
    return r;
  }, [repliesToUser, progress]);

  // Which reply IDs are newly visible (unread since profile was opened)
  const newVisibleReplyIds = useMemo(() => {
    const r: Record<string, true> = {};
    for (const { reply, thread: t } of repliesToUser) {
      if (canView({ season: reply.season, episode: reply.episode }, progress[t.showId]) && reply.updatedAt > openedAtSeenAt) r[reply.id] = true;
    }
    return r;
  }, [repliesToUser, progress, openedAtSeenAt]);

  // Per-tab activity: "green" if new visible replies, "red" if only invisible
  const tabActivity = useMemo(() => {
    const r: Record<string, "green" | "red"> = {};
    for (const { reply, thread: t } of repliesToUser) {
      const sid = t.showId;
      if (canView({ season: reply.season, episode: reply.episode }, progress[t.showId])) {
        if (reply.updatedAt > openedAtSeenAt) r[sid] = "green";
      } else {
        if (!r[sid]) r[sid] = "red";
      }
    }
    return r;
  }, [repliesToUser, progress, openedAtSeenAt]);

  // Push tab data up to App.tsx so it can render tabs in the fixed global header
  const onTabsChangeRef = useRef(onTabsChange);
  onTabsChangeRef.current = onTabsChange;
  useEffect(() => {
    if (loading) return;
    onTabsChangeRef.current?.({
      showTabOrder,
      activeTab,
      onTabClick: (sid: string) => {
        if (sid === activeTab) openShow(sid);
        else { setActiveTab(sid); setViewedTabIds(prev => new Set([...prev, sid])); }
      },
      tabActivity,
      viewedTabIds,
    });
  }, [loading, showTabOrder, activeTab, tabActivity, viewedTabIds]);
  useEffect(() => { return () => { onTabsChangeRef.current?.(null); }; }, []);

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      {loading && <div className="muted" style={{ padding: "24px 0" }}>Loading your profile…</div>}

      {!loading && (
        <div className="container" style={{ marginTop: 12 }}>
          {showTabOrder.length === 0 && (
            <div className="muted" style={{ padding: "24px 0" }}>No shows yet.</div>
          )}

          {activeTab && (
            <div className="hangLContent" style={{ paddingTop: 20 }}>
            <>
              {/* Your Watch Diary */}
              <section style={{ marginTop: 0 }}>
                <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8, minHeight: 28 }}>
                  {/* Title pinned to center independently of toggle width */}
                  <div className="title" style={{ fontSize: 18, position: "absolute", left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", pointerEvents: "none" }}>your journal</div>
                  {/* Toggle floats right so it never touches the title */}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 0, borderRadius: 999, overflow: "hidden", border: "2px solid var(--dos-border)", flexShrink: 0 }}>
                    {(["all", "private"] as const).map(opt => (
                      <button
                        key={opt}
                        onClick={() => setDiaryFilter(opt)}
                        style={{
                          padding: "3px 10px",
                          fontSize: 12,
                          fontWeight: diaryFilter === opt ? 700 : 400,
                          background: diaryFilter === opt ? "var(--dos-border)" : "transparent",
                          color: diaryFilter === opt ? "var(--dos-bg)" : "var(--dos-fg)",
                          border: "none",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {opt === "all" ? "all" : "private journal only"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="diaryOuter">
                <div className="diaryCardWrap">
                <div className="card" style={{ minHeight: 700, maxHeight: 700, overflowY: "auto", position: "relative", zIndex: 1 }}>
                  {(() => {
                    const filtered = diaryFilter === "private" ? tabThreads.filter(t => t.isPrivate) : tabThreads;
                    if (filtered.length === 0) return <div className="muted">{diaryFilter === "private" ? "No private posts yet." : "No posts yet."}</div>;
                    return filtered.map(t => (
                    <div key={t.id} className="card threadCard"
                      style={{ margin: "10px 0 10px 20px", cursor: "pointer", position: "relative" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id)}>
                      {invisibleByThreadId[t.id] && (
                        <Tooltip
                          text={`${invisibleCountByThreadId[t.id] ?? ""} people ahead of you have written back! You can read these once you catch up.`}
                          direction="below"
                          align="left"
                          gap={48}
                          style={{ position: "absolute", left: -10, top: -10, zIndex: 2 }}
                        >
                          <div style={{ width: 21, height: 21, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
                        </Tooltip>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="title" style={{ fontSize: 18 }}>
                          {t.isPrivate && <span title="Private" style={{ marginRight: 8 }}>📝</span>}
                          {t.titleBase}
                          {t.showId !== "simshow" && (
                            <span style={{ color: "var(--dos-cyan)" }}>
                              {` — S${String(t.season).padStart(2, "0")}E${String(t.episode).padStart(2, "0")}`}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {t.body !== t.preview && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
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
                  ));
                  })()}
                  <div style={{ height: 32, flexShrink: 0 }} aria-hidden />
                </div>
                </div>{/* /diaryCardWrap */}
                </div>{/* /diaryOuter */}
              </section>

              {/* Responses to you — moved above "your responses" */}
              <section style={{ marginTop: 24 }}>
                <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>responses to you</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabRepliesToMe.length === 0 && <div className="muted">No replies yet.</div>}
                  {tabRepliesToMe.map(({ reply: r, thread: t }) => (
                    <div key={r.id} className="card reply-card" style={{ margin: "10px 0", cursor: "pointer", position: "relative", color: "var(--dos-bg)", ["--dos-accent" as any]: "var(--dos-bg)", ["--dos-cyan" as any]: "var(--dos-bg)", ["--dos-gray" as any]: "rgba(222,168,56,0.65)" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                      {newVisibleReplyIds[r.id] && (
                        <div style={{ position: "absolute", left: -10, top: -10, width: 21, height: 21, borderRadius: "50%", background: "var(--green)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", zIndex: 2, pointerEvents: "none" }} />
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="muted" style={{ fontSize: 14 }}>
                          On <b>{t.titleBase}</b>{" "}
                          <span style={{ color: "var(--dos-cyan)" }}>
                            S{String(r.season).padStart(2, "0")} E{String(r.episode).padStart(2, "0")}
                          </span>{" "}
                          • <span className="username">@{r.author}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {(r.body.length > 260 || r.body.split('\n').length > 3) && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
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

              {/* your responses */}
              <section style={{ marginTop: 24 }}>
                <div className="title hangL" style={{ fontSize: 18, marginBottom: 8 }}>your responses</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabMyReplies.length === 0 && <div className="muted">No replies yet.</div>}
                  {tabMyReplies.map(({ reply: r, thread: t }) => (
                    <div key={r.id} className="card reply-card" style={{ margin: "10px 0", cursor: "pointer", color: "var(--dos-bg)", ["--dos-accent" as any]: "var(--dos-bg)", ["--dos-cyan" as any]: "var(--dos-bg)", ["--dos-gray" as any]: "rgba(222,168,56,0.65)" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="muted" style={{ fontSize: 14 }}>
                          On <b>{t.titleBase}</b>{" "}
                          {t.showId !== "simshow" && (
                            <span style={{ color: "var(--dos-cyan)" }}>
                              S{String(r.season).padStart(2, "0")} E{String(r.episode).padStart(2, "0")}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {(r.body.length > 260 || r.body.split('\n').length > 3) && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
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
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
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
                    <div key={r.id} className="card reply-card" style={{ margin: "10px 0", cursor: "pointer", color: "var(--dos-bg)", ["--dos-accent" as any]: "var(--dos-bg)", ["--dos-cyan" as any]: "var(--dos-bg)", ["--dos-gray" as any]: "rgba(222,168,56,0.65)" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="muted" style={{ fontSize: 14 }}>
                          On <b>{t.titleBase}</b>{" "}
                          <span style={{ color: "var(--dos-cyan)" }}>
                            S{String(r.season).padStart(2, "0")} E{String(r.episode).padStart(2, "0")}
                          </span>{" "}
                          • <span className="username">@{r.author}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {(r.body.length > 260 || r.body.split('\n').length > 3) && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
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
