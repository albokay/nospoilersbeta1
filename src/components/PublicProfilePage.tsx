import React, { useState, useMemo, useEffect, useRef } from "react";
import type { Reply, Thread } from "../types";
import type { Show } from "../lib/db";
import {
  fetchPublicProfileByUsername,
  fetchPublicThreadsForUser,
  fetchPublicRepliesForUser,
  fetchPublicProgressForUser,
} from "../lib/db";
import { canView, timeAgo, type ViewerProgress } from "../lib/utils";
import { linkifyText } from "../lib/linkify";
import EpisodeTag from "./EpisodeTag";
import LoadingDots from "./LoadingDots";
import type { ProfileTabData } from "./ProfilePage";

const GLOBAL_HEADER_H = 72;
const ROW_PAD_Y = 8;

export default function PublicProfilePage({
  username,
  shows,
  viewerProgress,
  openThreadWithFocus,
  openShow,
  onClose,
  onTabsChange,
}: {
  username: string;
  shows: Show[];
  viewerProgress: Record<string, ViewerProgress>;
  openThreadWithFocus: (showId: string, threadId: string, replyId?: string) => void;
  openShow: (showId: string) => void;
  onClose: () => void;
  onTabsChange?: (data: ProfileTabData | null) => void;
}) {
  const showName = (sid: string) => sid === "bb" ? "Breaking Bad (DEMO)" : shows.find(s => s.id === sid)?.name || sid;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [replies, setReplies] = useState<{ reply: Reply; thread: Thread }[]>([]);
  // fetchPublicProgressForUser returns the full ProgressEntry shape as of
  // 2026-05-08 (checkpoint 5 phase A). Live PublicProfilePage only needs s/e,
  // but the wider type keeps assignment from the helper trivially correct.
  const [targetProgress, setTargetProgress] = useState<Record<string, import("../types").ProgressEntry>>({});

  // Theme the page with the canon yellow "public" palette while mounted.
  // Pairs with has-header for the gradient-anchor logic used everywhere
  // else context theming runs (matches ShowSection's public-forum view).
  // Cleans up on unmount so navigating back to /profile or / gets the
  // default green palette.
  useEffect(() => {
    document.body.classList.add("public-context", "has-header");
    return () => {
      document.body.classList.remove("public-context", "has-header");
    };
  }, []);

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

  // Show tab order: only shows with public posts visible to the viewer
  const showTabOrder = useMemo(() => {
    const latest: Record<string, number> = {};
    const bump = (sid: string, ts: number) => {
      if (!latest[sid] || ts > latest[sid]) latest[sid] = ts;
    };
    visibleThreads.forEach(t => bump(t.showId, t.updatedAt));
    visibleReplies.forEach(({ reply: r, thread: t }) => bump(t.showId, r.updatedAt));
    return Object.keys(latest).sort((a, b) => latest[b] - latest[a]);
  }, [visibleThreads, visibleReplies]);

  const [activeTab, setActiveTab] = useState("");
  useEffect(() => {
    if (!loading && showTabOrder.length) setActiveTab(showTabOrder[0]);
  }, [loading]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  useEffect(() => { setExpandedIds(new Set()); }, [activeTab]);
  const [viewedTabIds, setViewedTabIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const tabThreads = useMemo(() =>
    visibleThreads.filter(t => t.showId === activeTab), [visibleThreads, activeTab]);

  const tabReplies = useMemo(() =>
    visibleReplies.filter(p => p.thread.showId === activeTab), [visibleReplies, activeTab]);

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
      tabActivity: {},
      viewedTabIds,
    });
  }, [loading, showTabOrder, activeTab, viewedTabIds]);
  useEffect(() => { return () => { onTabsChangeRef.current?.(null); }; }, []);

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      {loading && <div className="muted" style={{ padding: "24px 0" }}>Loading profile<LoadingDots /></div>}

      {!loading && notFound && (
        <div className="muted" style={{ padding: "24px 0" }}>Profile not found.</div>
      )}

      {!loading && !notFound && (
        <div className="container" style={{ marginTop: 12 }}>
          {showTabOrder.length === 0 && !loading && (
            <div
              className="editorial"
              style={{
                padding: "32px 0",
                fontSize: 28,
                fontWeight: 600,
                letterSpacing: 0.5,
                lineHeight: 1.05,
                color: "#FEF8EA",
                opacity: 0.8,
              }}
            >
              <span style={{ opacity: 0.7 }}>@{username}</span> hasn't<br />written anything publicly yet.
            </div>
          )}

          {activeTab && (
            <div className="hangLContent" style={{ paddingTop: 0 }}>
            <>
              {/* Their posts — diary look */}
              <section style={{ marginTop: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 0, marginBottom: 12, minHeight: 28 }}>
                  <div className="title" style={{ fontSize: 22, marginLeft: 0 }}>this is {username}'s journal</div>
                </div>
                <div className="diaryOuter">
                  {[48, 32, 16].map(offset => (
                    <div key={offset} className="diaryBackPage" style={{ top: 27, transform: `translate(-${offset}px, ${offset}px)` }} />
                  ))}
                  <div className="diaryTabScroller">
                  <div className="diaryTabRow">
                    {showTabOrder.map(sid => {
                      const active = sid === activeTab;
                      return (
                        <button
                          key={sid}
                          className={`diaryTab${active ? " active" : ""}`}
                          onClick={() => {
                            if (sid === activeTab) { openShow(sid); }
                            else { setActiveTab(sid); setViewedTabIds(prev => new Set([...prev, sid])); }
                          }}
                        >
                          {showName(sid)}
                        </button>
                      );
                    })}
                  </div>
                  </div>{/* /diaryTabScroller */}
                <div className="diaryCardWrap">
                <div className="card" style={{ minHeight: 700, maxHeight: 700, overflowY: "auto", position: "relative", zIndex: 1 }}>
                  {tabThreads.length === 0 && (
                    <div className="muted">No posts visible to you yet.</div>
                  )}
                  {tabThreads.map(t => (
                    <div key={t.id} className="card threadCard"
                      style={{ margin: "10px 0 10px 20px", cursor: "pointer", position: "relative" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="title" style={{ fontSize: 18 }}>
                          {t.titleBase}
                          {t.showId !== "simshow" && (
                            <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 7, whiteSpace: "nowrap" }}>
                              <EpisodeTag season={t.season} episode={t.episode} isRewatch={t.isRewatch} rewatchS={t.rewatchS} rewatchE={t.rewatchE} />
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {t.body !== t.preview && (
                            <div className="expand-chip" style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#FEF8EA", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
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
                  <div style={{ height: 32, flexShrink: 0 }} aria-hidden />
                </div>
                </div>{/* /diaryCardWrap */}
                </div>{/* /diaryOuter */}
              </section>

              {/* Their responses */}
              <section className="profile-public-responses" style={{ marginTop: 104 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>responses</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabReplies.length === 0 && (
                    <div className="muted">No responses visible to you yet.</div>
                  )}
                  {tabReplies.map(({ reply: r, thread: t }) => (
                    <div
                      key={r.id}
                      className="card reply-card"
                      style={{
                        margin: "10px 0", cursor: "pointer",
                        color: "var(--dos-bg)",
                        ["--dos-accent" as any]: "var(--dos-bg)",
                        ["--dos-cyan" as any]: "var(--dos-bg)",
                        ["--dos-gray" as any]: "rgba(222,168,56,0.65)",
                      }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="muted" style={{ fontSize: 14 }}>
                          On <b>{t.titleBase}</b>{" "}
                          {t.showId !== "simshow" && (
                            <span style={{ color: "var(--dos-cyan)", fontWeight: 700 }}>
                              <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {(r.body.length > 260 || r.body.split('\n').length > 3) && (
                            <div className="expand-chip" style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#FEF8EA", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }}>
                              {expandedIds.has(r.id) ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>{timeAgo(r.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 15 }}
                        className={expandedIds.has(r.id) ? undefined : "clamp3"}>
                        {linkifyText(r.body)}
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
