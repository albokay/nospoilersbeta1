import React, { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { Reply, Thread, FriendGroup } from "../types";
import { seedShows } from "../lib/mockData";
import type { Show } from "../lib/db";
import { fetchUserThreads, fetchUserReplies, fetchRepliesToUserThreads, fetchLikedThreads, fetchLikedReplies, insertThread, fetchPrompts, fetchFriendGroupsForUser, addThreadToGroup, createFriendGroup } from "../lib/db";
import type { PromptRow } from "../lib/db";
import { useAuth } from "../lib/auth";
import { canView, timeAgo } from "../lib/utils";
import Tooltip from "./Tooltip";
import EmptyProfileWelcome from "./EmptyProfileWelcome";
import Modal from "./Modal";
import OneSelectProgress from "./OneSelectProgress";
import PromptCard from "./PromptCard";
import type { PromptEntry } from "../lib/promptData";
import { getFragment, getPromptSuggestion } from "../lib/prompts";

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
  updateProgressFor,
}: {
  shows: Show[];
  username: string;
  progress: Record<string, any>;
  likesThreads: Record<string, number>;
  likesReplies: Record<string, number>;
  likedByUserThreads: Record<string, boolean>;
  likedByUserReplies: Record<string, boolean>;
  openThreadWithFocus: (showId: string, threadId: string, replyId?: string, groupId?: string) => void;
  openShow: (showId: string) => void;
  onClose: () => void;
  updateProgressFor?: (showId: string, val: { s: number; e: number }) => void;
  repliesToUser?: { reply: Reply; thread: Thread }[];
  openedAtSeenAt?: number;
  onTabsChange?: (data: ProfileTabData | null) => void;
}) {
  const { user, profile } = useAuth();
  const location = useLocation();
  const allShows: Show[] = showsProp?.length ? showsProp : seedShows as Show[];
  const showName = (showId: string) => showId === "bb" ? "Breaking Bad (DEMO)" : allShows.find(s => s.id === showId)?.name || showId;

  const [myThreads, setMyThreads] = useState<{ thread: Thread; groupId?: string; groupName?: string }[]>([]);
  const [myReplies, setMyReplies] = useState<{ reply: Reply; thread: Thread }[]>([]);
  const [repliesToMe, setRepliesToMe] = useState<{ reply: Reply; thread: Thread; groupId?: string; groupName?: string }[]>([]);
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
    myThreads.filter(({ thread: t }) => canView({ season: t.season, episode: t.episode }, progress[t.showId])),
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
    myThreads.forEach(({ thread: t }) => bump(t.showId, t.updatedAt));
    myReplies.forEach(({ reply: r, thread: t }) => bump(t.showId, r.updatedAt));
    repliesToMe.forEach(({ reply: r, thread: t }) => bump(t.showId, r.updatedAt));
    likedThreadsList.forEach(t => bump(t.showId, t.updatedAt));
    likedRepliesList.forEach(({ reply: r, thread: t }) => bump(t.showId, r.updatedAt));
    // include shows from progress even if no posts yet
    Object.keys(progress).forEach(sid => { if (!latest[sid]) latest[sid] = 0; });
    return Object.keys(latest).sort((a, b) => latest[b] - latest[a]);
  }, [myThreads, myReplies, repliesToMe, likedThreadsList, likedRepliesList, progress]);

  // Hidden tabs: user can close tabs to declutter their private profile view.
  // Entries and progress remain — purely a UI preference stored in localStorage.
  const hiddenTabsKey = user ? `ns_hidden_tabs_${user.id}` : "";
  const [hiddenTabs, setHiddenTabs] = useState<Set<string>>(() => {
    if (!hiddenTabsKey) return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(hiddenTabsKey) || "[]")); } catch { return new Set(); }
  });
  const hideTab = (sid: string) => {
    setHiddenTabs(prev => {
      const next = new Set(prev);
      next.add(sid);
      if (hiddenTabsKey) localStorage.setItem(hiddenTabsKey, JSON.stringify([...next]));
      return next;
    });
  };
  const unhideTab = (sid: string) => {
    setHiddenTabs(prev => {
      const next = new Set(prev);
      next.delete(sid);
      if (hiddenTabsKey) localStorage.setItem(hiddenTabsKey, JSON.stringify([...next]));
      return next;
    });
  };

  // Filter hidden tabs from the visible tab order
  const visibleTabOrder = useMemo(() => showTabOrder.filter(sid => !hiddenTabs.has(sid)), [showTabOrder, hiddenTabs]);

  const [activeTab, setActiveTab] = useState("");
  const [viewedTabIds, setViewedTabIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!loading && visibleTabOrder.length) {
      const requestedTab = (location.state as any)?.activeTab;
      // If a hidden tab is being re-opened (e.g. from "Start your journal"), unhide it
      if (requestedTab && hiddenTabs.has(requestedTab)) {
        unhideTab(requestedTab);
      }
      const tab = (requestedTab && (visibleTabOrder.includes(requestedTab) || showTabOrder.includes(requestedTab))) ? requestedTab : visibleTabOrder[0];
      setActiveTab(tab);
      setViewedTabIds(prev => new Set([...prev, tab]));
    }
  }, [loading, location.key, visibleTabOrder.length]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // clear expanded state when switching tabs
  useEffect(() => { setExpandedIds(new Set()); }, [activeTab]);

  const [diaryFilter, setDiaryFilter] = useState<"all" | "private">("all");

  // Friend-room filter for the journal
  const [tabGroups, setTabGroups] = useState<FriendGroup[]>([]);
  const [journalGroupFilter, setJournalGroupFilter] = useState<string | null>(null);
  useEffect(() => {
    if (!user || !activeTab) { setTabGroups([]); return; }
    fetchFriendGroupsForUser(user.id, activeTab).then(setTabGroups).catch(() => setTabGroups([]));
  }, [user?.id, activeTab]);
  // Reset group filter when switching show tabs
  useEffect(() => { setJournalGroupFilter(null); }, [activeTab]);

  // Compose state
  const [composeOpen, setComposeOpen] = useState(false);
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [composeDestination, setComposeDestination] = useState<"private" | "public" | string>("private");

  const closeCompose = () => {
    setComposeOpen(false);
    setComposeDestination("private");
  };
  const postBodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Tab "go to" dropdown
  const [tabDropdownOpen, setTabDropdownOpen] = useState<string | null>(null);
  const [tabDropdownPos, setTabDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const tabDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tabDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (tabDropdownRef.current && !tabDropdownRef.current.contains(e.target as Node)) {
        setTabDropdownOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tabDropdownOpen]);
  const goToShowRoom = (sid: string, groupId?: string) => {
    if (groupId) sessionStorage.setItem(`ns_active_group_${sid}`, groupId);
    else sessionStorage.removeItem(`ns_active_group_${sid}`);
    openShow(sid);
    setTabDropdownOpen(null);
  };

  // Create friend room from profile
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [createRoomSubmitting, setCreateRoomSubmitting] = useState(false);
  const handleCreateRoom = async () => {
    if (!user || !newRoomName.trim() || !tabDropdownOpen) return;
    setCreateRoomSubmitting(true);
    try {
      const g = await createFriendGroup({ showId: tabDropdownOpen, name: newRoomName.trim(), createdBy: user.id });
      setTabGroups(prev => [...prev, g]);
      setNewRoomName("");
      setShowCreateRoomModal(false);
      // Navigate into the new room
      sessionStorage.setItem(`ns_active_group_${tabDropdownOpen}`, g.id);
      openShow(tabDropdownOpen);
    } catch (e) { console.error(e); }
    finally { setCreateRoomSubmitting(false); }
  };

  // Prompt system
  const [promptEntries, setPromptEntries] = useState<PromptEntry[]>([]);
  const [activePrompt, setActivePrompt] = useState<PromptEntry | null>(null);
  const [shownPromptIds, setShownPromptIds] = useState<number[]>([]);
  const [insertedPromptIds, setInsertedPromptIds] = useState<number[]>([]);
  const [composePlaceholder, setComposePlaceholder] = useState<string>(
    "Food for thought: did that last episode remind you of something from earlier in the show...or even from your own life?"
  );

  useEffect(() => {
    fetchPrompts()
      .then((rows: PromptRow[]) => {
        setPromptEntries(rows.map(r => ({
          id: r.id, text: r.text, displayType: r.display_type,
          tvmazeTypes: r.tvmaze_types, genres: r.genres,
          progressTags: r.progress_tags, themes: r.themes,
        })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (composeOpen && promptEntries.length > 0 && activeShow) {
      setComposePlaceholder(getFragment(activeShow as Show, promptEntries));
      setActivePrompt(null);
      setShownPromptIds([]);
      setInsertedPromptIds([]);
    }
  }, [composeOpen, promptEntries.length]);

  const handlePromptBtn = () => {
    if (!activeShow) return;
    const next = getPromptSuggestion(activeShow as Show, postProgress, shownPromptIds, promptEntries);
    if (next) { setShownPromptIds(prev => [...prev, next.id]); setActivePrompt(next); }
  };

  const handlePromptShuffle = () => {
    if (!activeShow) return;
    const next = getPromptSuggestion(activeShow as Show, postProgress, shownPromptIds, promptEntries);
    if (next) { setShownPromptIds(prev => [...prev, next.id]); setActivePrompt(next); }
  };

  const handlePromptInsert = (text: string) => {
    if (!activePrompt) return;
    const token = `[PROMPT: ${text}]`;
    const ta = postBodyRef.current;
    if (ta) {
      const pos = ta.selectionStart ?? postBody.length;
      const before = postBody.slice(0, pos).trimEnd();
      const after = postBody.slice(pos).trimStart();
      const newBody = before + (before.length ? "\n" : "") + token + "\n" + after;
      setPostBody(newBody);
      requestAnimationFrame(() => { ta.focus(); });
    } else {
      setPostBody(prev => prev.trimEnd() + (prev.trim() ? "\n" : "") + token + "\n");
    }
    setInsertedPromptIds(prev => [...prev, activePrompt.id]);
    setActivePrompt(null);
  };

  const activeShow = useMemo(() => allShows.find(s => s.id === activeTab), [allShows, activeTab]);
  const postProgress = progress[activeTab] || { s: 1, e: 1 };
  const postTagS = postProgress.isRewatching && postProgress.highestS ? postProgress.highestS : postProgress.s;
  const postTagE = postProgress.isRewatching && postProgress.highestE ? postProgress.highestE : postProgress.e;

  const submitPost = async () => {
    if (!user || !profile) return;
    const title = (postTitle || "").trim();
    const body = (postBody || "").trim();
    if (!title) { alert("Please add a title before posting."); return; }
    if (!body) { alert("Write something first."); return; }
    setPostSubmitting(true);
    try {
      const threadData = {
        showId: activeTab,
        season: postTagS, episode: postTagE,
        authorId: user.id, authorName: profile.username,
        title,
        preview: body.slice(0, 240) + (body.length > 240 ? "…" : ""),
        body,
        isRewatch: postProgress.isRewatching ?? false,
      };

      let t: Awaited<ReturnType<typeof insertThread>>;
      if (composeDestination === "public") {
        t = await insertThread({ ...threadData, isPublic: true });
      } else if (composeDestination === "private") {
        t = await insertThread({ ...threadData, isPublic: false });
      } else {
        t = await insertThread({ ...threadData, isPublic: false });
        await addThreadToGroup(t.id, composeDestination).catch(() => {});
      }

      const groupId = (composeDestination !== "public" && composeDestination !== "private") ? composeDestination : undefined;
      const groupName = groupId ? tabGroups.find(g => g.id === groupId)?.name : undefined;
      setMyThreads(prev => [{ thread: t, groupId, groupName }, ...prev]);
      setPostTitle(""); setPostBody("");
      setActivePrompt(null); setShownPromptIds([]); setInsertedPromptIds([]);
      closeCompose();
    } catch {
      alert("Failed to post. Please try again.");
    } finally {
      setPostSubmitting(false);
    }
  };

  const toggleExpand = (id: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // All content filtered to active tab
  const tabThreads = useMemo(() =>
    visibleThreads.filter(({ thread: t }) => t.showId === activeTab), [visibleThreads, activeTab]);

  const tabMyReplies = useMemo(() =>
    visibleMyReplies.filter(p => p.thread.showId === activeTab), [visibleMyReplies, activeTab]);

  const tabRepliesToMe = useMemo(() =>
    visibleRepliesToMe.filter(p => p.thread.showId === activeTab), [visibleRepliesToMe, activeTab]);

  const tabLikedThreads = useMemo(() =>
    visibleLikedThreads.filter(t => t.showId === activeTab), [visibleLikedThreads, activeTab]);

  const tabLikedReplies = useMemo(() =>
    visibleLikedReplies.filter(p => p.thread.showId === activeTab), [visibleLikedReplies, activeTab]);

  // Dismissed indicators: threadId → timestamp when dismissed
  const [dismissedIndicators, setDismissedIndicators] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_dismissed_indicators") || "{}"); }
    catch { return {}; }
  });
  const dismissIndicator = (threadId: string) => {
    const updated = { ...dismissedIndicators, [threadId]: Date.now() };
    setDismissedIndicators(updated);
    localStorage.setItem("ns_dismissed_indicators", JSON.stringify(updated));
  };

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

  // Latest invisible reply timestamp per thread (to detect new replies after dismissal)
  const latestInvisibleAtByThreadId = useMemo(() => {
    const r: Record<string, number> = {};
    for (const { reply, thread: t } of repliesToUser) {
      if (!canView({ season: reply.season, episode: reply.episode }, progress[t.showId])) {
        if (!r[t.id] || reply.updatedAt > r[t.id]) r[t.id] = reply.updatedAt;
      }
    }
    return r;
  }, [repliesToUser, progress]);

  const shouldShowIndicator = (threadId: string) => {
    if (!invisibleByThreadId[threadId]) return false;
    const dismissedAt = dismissedIndicators[threadId];
    if (!dismissedAt) return true;
    return (latestInvisibleAtByThreadId[threadId] ?? 0) > dismissedAt;
  };

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
      showTabOrder: visibleTabOrder,
      activeTab,
      onTabClick: (sid: string) => {
        if (sid === activeTab) openShow(sid);
        else { setActiveTab(sid); setViewedTabIds(prev => new Set([...prev, sid])); }
      },
      tabActivity,
      viewedTabIds,
    });
  }, [loading, visibleTabOrder, activeTab, tabActivity, viewedTabIds]);
  useEffect(() => { return () => { onTabsChangeRef.current?.(null); }; }, []);

  return (
    <section className="container" style={{ paddingBottom: 28 }}>
      {loading && <div className="muted" style={{ padding: "24px 0" }}>Loading your profile…</div>}

      {!loading && (
        <div className="container" style={{ marginTop: 12 }}>
          {showTabOrder.length === 0 && <EmptyProfileWelcome />}

          {activeTab && (
            <div className="hangLContent" style={{ paddingTop: 20 }}>
            <>
              {/* Your Watch Diary */}
              <section style={{ marginTop: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, marginBottom: 16, minHeight: 28 }}>
                  <div className="title profile-journal-heading" style={{ fontSize: 22, marginLeft: -42 }}>Your Journal</div>
                  <div style={{ display: "flex", gap: 0, borderRadius: 999, overflow: "hidden", border: "2px solid var(--dos-border)", flexShrink: 0 }}>
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
                  {/* Folder tab row — sits flush on top of the front card */}
                  <div className="diaryTabScroller">
                  <div className="diaryTabRow">
                    {visibleTabOrder.map(sid => {
                      const active = sid === activeTab;
                      const activity = tabActivity[sid];
                      const viewed = viewedTabIds.has(sid);
                      return (
                        <button
                          key={sid}
                          className={`diaryTab${active ? " active" : ""}`}
                          onClick={(e) => {
                            if (sid !== activeTab) {
                              // First click: just select the tab
                              setActiveTab(sid);
                              setViewedTabIds(prev => new Set([...prev, sid]));
                              setTabDropdownOpen(null);
                              return;
                            }
                            // Second click (tab already active): toggle dropdown
                            const rect = e.currentTarget.getBoundingClientRect();
                            const hamburger = e.currentTarget.querySelector("[data-hamburger]");
                            const anchorLeft = hamburger ? hamburger.getBoundingClientRect().left : rect.right;
                            setTabDropdownPos({ top: rect.bottom + 6, left: anchorLeft });
                            setTabDropdownOpen(prev => prev === sid ? null : sid);
                          }}
                        >
                          {showName(sid)}
                          {active && (
                            <span data-hamburger style={{ marginLeft: 8, fontSize: 20, opacity: 0.8, lineHeight: 1 }}>☰</span>
                          )}
                          {!viewed && activity && (
                            <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: activity === "green" ? "var(--green)" : "var(--danger)", pointerEvents: "none" }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  </div>
                <div className="diaryCardWrap">
                  {/* Background pages — positioned relative to diaryCardWrap so
                      inset:0 matches the front card exactly; translate alone
                      creates the even staircase (16px steps). */}
                  {([48, 32, 16] as const).map(offset => {
                    const opacity = offset === 48 ? 0.18 : offset === 32 ? 0.36 : 0.55;
                    return (
                      <div key={offset} className="diaryBackPage" style={{ transform: `translate(-${offset}px, ${offset}px)`, borderColor: `rgba(255,255,255,${opacity})` }} />
                    );
                  })}
                <div className="card" style={{ height: 700, display: "flex", flexDirection: "column", padding: 0, position: "relative", zIndex: 1 }}>
                  {/* Action bar — lives ABOVE the scroll container so entries never bleed through */}
                  {activeTab && (
                    <div className="profileActionBar">
                      <button
                        className="btn post h40"
                        onClick={() => {
                          // Default to most recent group for this show, or private if none
                          setComposeDestination(tabGroups.length > 0 ? tabGroups[0].id : "private");
                          setComposeOpen(true);
                        }}
                        style={{ lineHeight: 1.2, marginLeft: 20 }}
                      >
                        + make an entry
                      </button>
                      {activeShow && (
                        <OneSelectProgress
                          show={activeShow}
                          value={postProgress}
                          onConfirm={(val) => updateProgressFor?.(activeTab, val)}
                          requireConfirm={true}
                        />
                      )}
                    </div>
                  )}
                  <div className="diaryScrollArea">
                  {(() => {
                    const byDiary = diaryFilter === "private" ? tabThreads.filter(({ thread: t, groupId }) => !t.isPublic && !groupId) : tabThreads;
                    const filtered = journalGroupFilter ? byDiary.filter(({ groupId }) => groupId === journalGroupFilter) : byDiary;
                    if (filtered.length === 0) {
                      if (diaryFilter === "private" && tabThreads.length > 0) {
                        // Has public entries but no private ones
                        return (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "150px 0 48px" }}>
                            <div style={{ width: "min(400px, 100%)" }}>
                              <p style={{ margin: 0, fontSize: 16, fontWeight: 400, lineHeight: 1.6, color: "var(--dos-fg)", opacity: 0.65, fontStyle: "italic", textAlign: "left" }}>
                                You don't have any private entries yet.
                              </p>
                            </div>
                          </div>
                        );
                      }
                      // No entries at all (including new users on private filter) — show welcome
                      return <EmptyProfileWelcome />;
                    }
                    return filtered.map(({ thread: t, groupId, groupName }) => {
                    const isGroup = !!groupId;
                    const isPub = t.isPublic && !groupId;
                    // card bg: blue for friend room, yellow for public, transparent for private
                    const cardBg = isGroup ? "#bdd4de" : isPub ? "#dea838" : undefined;
                    const cardFg = isGroup ? "#1a3a4a" : "#fff";
                    const cardMuted = isGroup ? "rgba(26,58,74,0.65)" : "rgba(255,255,255,0.65)";
                    const epColor = isGroup ? "#1a3a4a" : "var(--dos-cyan)";
                    // expand button: inverted chip using card accent
                    const chipBg = isGroup ? "#1a3a4a" : isPub ? "rgba(0,0,0,0.18)" : "#fff";
                    const chipFg = isGroup ? "#bdd4de" : isPub ? "#fff" : "var(--dos-bg)";
                    return (
                    <div key={t.id} className="card threadCard"
                      style={{
                        margin: "10px 0 10px 20px", cursor: "pointer", position: "relative",
                        ...((isGroup || isPub) ? { background: cardBg, color: cardFg, borderColor: "transparent" } : {}),
                      }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, undefined, groupId)}>
                      {shouldShowIndicator(t.id) && (
                        <Tooltip
                          text={<>{invisibleCountByThreadId[t.id] ?? ""} people ahead of you have written you back! You can read these once you catch up. And you can get rid of this indicator by clicking the X.<br /><br />Sidebar will still let you know if you get new responses, but you can always turn the indicator off.</>}
                          direction="right"
                          gap={14}
                          style={{ position: "absolute", left: -10, top: -10, zIndex: 2 }}
                          tooltipStyle={{ background: "#bdd4de", color: "#1a2c3a", boxShadow: "0 4px 20px rgba(0,0,0,0.18)" }}
                          width={260}
                        >
                          <div
                            style={{ width: 21, height: 21, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                            onClick={(e) => { e.stopPropagation(); dismissIndicator(t.id); }}
                          >
                            <span style={{ color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: 1, userSelect: "none" }}>✕</span>
                          </div>
                        </Tooltip>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="title" style={{ fontSize: 18, ...((isGroup || isPub) ? { color: cardFg } : {}) }}>
                          {!t.isPublic && !groupId && <span title="Private" style={{ marginRight: 8 }}>📝</span>}
                          {isPub && <span title="Public" style={{ marginRight: 8 }}>🌍</span>}
                          {isGroup && <span title={`Friend room: ${groupName ?? ""}`} style={{ marginRight: 8 }}>👥</span>}
                          {t.titleBase}
                          {t.showId !== "simshow" && (
                            <span style={{ color: epColor }}>
                              {` — S${String(t.season).padStart(2, "0")}E${String(t.episode).padStart(2, "0")}`}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {t.body !== t.preview && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: chipBg, color: chipFg, borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(t.id); }}>
                              {expandedIds.has(t.id) ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13, ...((isGroup || isPub) ? { color: cardMuted } : {}) }}>{timeAgo(t.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: expandedIds.has(t.id) ? "pre-wrap" : undefined, ...((isGroup || isPub) ? { color: cardFg } : {}) }}
                        className={expandedIds.has(t.id) ? undefined : "clamp3"}>
                        {expandedIds.has(t.id) ? t.body : t.preview}
                      </div>
                    </div>
                  );});
                  })()}
                  <div style={{ height: 32, flexShrink: 0 }} aria-hidden />
                  </div>{/* /diaryScrollArea */}
                </div>
                </div>{/* /diaryCardWrap */}
                </div>{/* /diaryOuter */}
              </section>

              {/* Responses to you — moved above "your responses" */}
              <section className="profile-responses-section" style={{ marginTop: 144 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>responses to you</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabRepliesToMe.length === 0 && <div className="muted">No responses yet.</div>}
                  {tabRepliesToMe.map(({ reply: r, thread: t, groupId, groupName }) => (
                    <div key={r.id} className="card reply-card" style={{ margin: "10px 0", cursor: "pointer", position: "relative", color: "var(--dos-bg)", ["--dos-accent" as any]: "var(--dos-bg)", ["--dos-cyan" as any]: "var(--dos-bg)", ["--dos-gray" as any]: "rgba(222,168,56,0.65)" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id, groupId)}>
                      {newVisibleReplyIds[r.id] && (
                        <div style={{ position: "absolute", left: -10, top: -10, width: 21, height: 21, borderRadius: "50%", background: "var(--green)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", zIndex: 2, pointerEvents: "none" }} />
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="muted" style={{ fontSize: 14 }}>
                          On <b>{t.titleBase}</b>{" "}
                          <span style={{ color: "var(--dos-cyan)" }}>
                            S{String(r.season).padStart(2, "0")} E{String(r.episode).padStart(2, "0")}
                          </span>{" "}
                          • {groupName
                              ? <span style={{ fontStyle: "italic" }}>in {groupName}</span>
                              : <span style={{ fontStyle: "italic" }}>publicly</span>}{" "}
                          • <span className="username">@{r.author}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {(r.body.length > 260 || r.body.split('\n').length > 3) && (
                            <div className="expand-chip" style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
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
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your responses</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabMyReplies.length === 0 && <div className="muted">No responses yet.</div>}
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
                            <div className="expand-chip" style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
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
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your starred posts</div>
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
                            <div className="expand-chip" style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
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
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your starred responses</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabLikedReplies.length === 0 && <div className="muted">No starred responses yet.</div>}
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
                            <div className="expand-chip" style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", color: "var(--dos-bg)", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
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
      {/* Compose modal */}
      {composeOpen && (
        <Modal onClose={closeCompose} width="min(720px,92vw)">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <h3 className="title" style={{ margin: 0 }}>make an entry</h3>
            <button className="btn" onClick={closeCompose}>✕</button>
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <input
              className="badge"
              placeholder="Title"
              value={postTitle}
              onChange={(e) => setPostTitle(e.target.value)}
              style={{ width: "100%", height: 40, fontWeight: 700 }}
            />
            {activeShow && (
              <div className="muted" style={{ fontSize: 13 }}>
                Your post is automatically marked to <b>S{String(postTagS).padStart(2, "0")}E{String(postTagE).padStart(2, "0")}</b> and will only show to people who've watched at least that far.
              </div>
            )}
            <textarea
              ref={postBodyRef}
              className="card"
              placeholder={composePlaceholder}
              value={postBody}
              onChange={(e) => setPostBody(e.target.value)}
              style={{ width: "100%", height: 260, resize: "vertical" }}
            />
            {activePrompt && (
              <PromptCard
                prompt={activePrompt}
                onClose={() => setActivePrompt(null)}
                onShuffle={handlePromptShuffle}
                onInsert={handlePromptInsert}
              />
            )}
            {promptEntries.length > 0 && (
              <div>
                <button className="prompt-btn" type="button" onClick={handlePromptBtn} title="Get a writing prompt">
                  ✦ want a prompt?
                </button>
              </div>
            )}

            {/* ── Destination selector ── */}
            <div style={{ border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "10px 14px", background: "rgba(255,255,255,0.04)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.55, marginBottom: 10, color: "var(--dos-light)" }}>Where to post</div>

              {/* Private journal */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, cursor: "pointer" }} onClick={() => setComposeDestination("private")}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, border: "2px solid var(--dos-border)", background: "var(--dos-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {composeDestination === "private" && <div className="radio-dot" style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--dos-bg)" }} />}
                </div>
                <span style={{ fontSize: 14, color: "var(--dos-light)" }}>📝 Private journal</span>
              </div>

              {/* One option per friend group */}
              {tabGroups.map(g => (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, cursor: "pointer" }} onClick={() => setComposeDestination(g.id)}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, border: "2px solid var(--dos-border)", background: "var(--dos-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {composeDestination === g.id && <div className="radio-dot" style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--dos-bg)" }} />}
                  </div>
                  <span style={{ fontSize: 14, color: "var(--dos-light)" }}>👥 {g.name}</span>
                </div>
              ))}

              {/* Public profile */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 0, cursor: "pointer" }} onClick={() => setComposeDestination("public")}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, border: "2px solid var(--dos-border)", background: "var(--dos-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {composeDestination === "public" && <div className="radio-dot" style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--dos-bg)" }} />}
                </div>
                <span style={{ fontSize: 14, color: "var(--dos-light)" }}>
                  🌍 Public profile
                  <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 5 }}>visible to anyone at your progress</span>
                </span>
              </div>
            </div>

            {/* ── Submit row ── */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={closeCompose} disabled={postSubmitting} style={{ background: "var(--danger)", border: "none", color: "#fff", whiteSpace: "nowrap", fontSize: 13 }}>Cancel</button>
              <button
                className="btn compose-submit"
                onClick={submitPost}
                disabled={postSubmitting}
                style={{
                  background: composeDestination !== "private" ? "var(--green)" : "var(--dos-bg)",
                  border: "2px solid rgba(255,255,255,0.3)",
                  color: "#fff",
                  whiteSpace: "nowrap",
                  fontSize: 13,
                  minWidth: 130,
                }}
              >
                {postSubmitting ? "Posting…" : composeDestination === "private" ? "📝 Save to journal" : "Post"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create friend room modal */}
      {showCreateRoomModal && (
        <Modal onClose={() => { setShowCreateRoomModal(false); setNewRoomName(""); }} width="min(420px,92vw)">
          <h3 className="title" style={{ margin: "0 0 12px" }}>Create a friend room</h3>
          <p style={{ margin: "0 0 16px", fontSize: 14, opacity: 0.75, lineHeight: 1.5 }}>
            A friend room is a private space for a group of people watching this show together. Share entries there and reply in a spoiler-safe context.
          </p>
          <input
            className="badge"
            placeholder={'Room name (e.g. "Sunday watch crew")'}
            value={newRoomName}
            onChange={e => setNewRoomName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreateRoom(); }}
            style={{ width: "100%", height: 40, marginBottom: 12 }}
            autoFocus
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => { setShowCreateRoomModal(false); setNewRoomName(""); }} disabled={createRoomSubmitting} style={{ background: "var(--danger)", border: "none", color: "#fff" }}>Cancel</button>
            <button className="btn" onClick={handleCreateRoom} disabled={createRoomSubmitting || !newRoomName.trim()} style={{ background: "var(--green)", border: "none", color: "#fff" }}>
              {createRoomSubmitting ? "Creating…" : "Create room"}
            </button>
          </div>
        </Modal>
      )}

      {/* Tab "go to" dropdown — fixed so it escapes overflow-y:clip on .diaryTabScroller */}
      {tabDropdownOpen && tabDropdownPos && (
        <div ref={tabDropdownRef} style={{
          position: "fixed", top: tabDropdownPos.top, left: tabDropdownPos.left,
          display: "flex", flexDirection: "column", gap: 6,
          background: "var(--dos-bg)", border: "none",
          borderRadius: 10, padding: "8px", zIndex: 200,
          boxShadow: "0 2px 10px rgba(0,0,0,0.18)"
        }}>
          <button className="btn" style={{ fontSize: 13, whiteSpace: "nowrap" }}
            onClick={() => goToShowRoom(tabDropdownOpen)}>
            🌍 Public entries
          </button>
          {tabGroups.map(g => (
            <button key={g.id} className="btn" style={{ fontSize: 13, whiteSpace: "nowrap" }}
              onClick={() => goToShowRoom(tabDropdownOpen, g.id)}>
              👥 {g.name}
            </button>
          ))}
          <button className="btn" style={{ fontSize: 13, whiteSpace: "nowrap", opacity: 0.75 }}
            onClick={() => { setTabDropdownOpen(null); setShowCreateRoomModal(true); }}>
            + new friend room
          </button>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.2)", margin: "2px 0" }} />
          <Tooltip text="Hides this tab from your journal view. Your entries and progress are kept. Search for the show again and choose 'Start your journal' to bring it back." direction="below">
            <button className="btn" style={{ fontSize: 13, whiteSpace: "nowrap", opacity: 0.6, width: "100%" }}
              onClick={() => {
                const sid = tabDropdownOpen;
                setTabDropdownOpen(null);
                hideTab(sid);
                // Switch to another tab if the hidden one was active
                if (sid === activeTab) {
                  const remaining = visibleTabOrder.filter(s => s !== sid);
                  if (remaining.length) setActiveTab(remaining[0]);
                }
              }}>
              Close show tab
            </button>
          </Tooltip>
        </div>
      )}
    </section>
  );
}
