import React, { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { SquarePen, X, Globe, Users, LockKeyhole, Sparkles, CircleChevronDown, ChevronDown, Mail, ArrowRight, Plus } from "lucide-react";
import type { Reply, Thread, FriendGroup } from "../types";
import { seedShows } from "../lib/mockData";
import type { Show } from "../lib/db";
import { fetchUserThreads, fetchUserReplies, fetchRepliesToUserThreads, fetchLikedThreads, fetchLikedReplies, fetchUserShowActivity, insertThread, fetchPrompts, fetchFriendGroupsForUser, addThreadToGroup, createFriendGroup, readTabCreated, refreshShowIfStale, fetchRoomActivityVisibility } from "../lib/db";
import type { RoomVisibility } from "../lib/db";
import type { PromptRow } from "../lib/db";
import { useAuth } from "../lib/auth";
import { canView, timeAgo } from "../lib/utils";
import EpisodeTag from "./EpisodeTag";
import Tooltip from "./Tooltip";
import EmptyProfileWelcome from "./EmptyProfileWelcome";
import Modal from "./Modal";
import OneSelectProgress from "./OneSelectProgress";
import LoadingDots from "./LoadingDots";
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
  onGroupCreated,
  onShowUpdated,
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
  onGroupCreated?: (g: FriendGroup) => void;
  onShowUpdated?: (updated: Show) => void;
}) {
  const { user, profile } = useAuth();
  const location = useLocation();
  const allShows: Show[] = showsProp?.length ? showsProp : seedShows as Show[];
  const showName = (showId: string) => showId === "bb" ? "Breaking Bad (DEMO)" : allShows.find(s => s.id === showId)?.name || showId;

  // ── Lazy-load: lightweight activity query for tab ordering, per-tab data cache ──
  type TabData = {
    myThreads: { thread: Thread; groupId?: string; groupName?: string }[];
    myReplies: { reply: Reply; thread: Thread }[];
    repliesToMe: { reply: Reply; thread: Thread; groupId?: string; groupName?: string }[];
    likedThreads: Thread[];
    likedReplies: { reply: Reply; thread: Thread }[];
  };
  const [activityOrder, setActivityOrder] = useState<{ showId: string; latestAt: number }[]>([]);
  const [tabDataCache, setTabDataCache] = useState<Record<string, TabData>>({});
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const loadingTabRef = useRef<string | null>(null);

  // Step 1: lightweight metadata query — only show IDs + timestamps
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    fetchUserShowActivity(user.id)
      .then(activity => {
        if (cancelled) return;
        setActivityOrder(activity);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("ProfilePage activity load failed (recoverable):", err);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Step 2: fetch per-tab data when activeTab changes and isn't cached
  const [activeTab, setActiveTab] = useState("");
  useEffect(() => {
    if (!user || !activeTab || tabDataCache[activeTab] || loadingTabRef.current === activeTab) return;
    loadingTabRef.current = activeTab;
    setTabLoading(true);
    const tabId = activeTab; // capture for closure
    let cancelled = false;
    Promise.all([
      fetchUserThreads(user.id, tabId),
      fetchUserReplies(user.id, tabId),
      fetchRepliesToUserThreads(user.id, tabId),
      fetchLikedThreads(user.id, tabId),
      fetchLikedReplies(user.id, tabId),
    ]).then(([threads, myR, replies, likedT, likedR]) => {
      if (cancelled) return;
      setTabDataCache(prev => ({
        ...prev,
        [tabId]: {
          myThreads: threads,
          myReplies: myR,
          repliesToMe: replies,
          likedThreads: likedT,
          likedReplies: likedR,
        },
      }));
      if (loadingTabRef.current === tabId) loadingTabRef.current = null;
      setTabLoading(false);
    }).catch(err => {
      if (cancelled) return;
      console.warn("ProfilePage tab load failed (recoverable):", err);
      if (loadingTabRef.current === tabId) loadingTabRef.current = null;
      setTabLoading(false);
    });
    return () => { cancelled = true; };
  }, [user?.id, activeTab, tabDataCache]);

  // Derive flat lists from the active tab's cache (or empty if not yet loaded)
  const currentTabData = tabDataCache[activeTab];
  const myThreads = currentTabData?.myThreads ?? [];
  const myReplies = currentTabData?.myReplies ?? [];
  const repliesToMe = currentTabData?.repliesToMe ?? [];
  const likedThreadsList = currentTabData?.likedThreads ?? [];
  const likedRepliesList = currentTabData?.likedReplies ?? [];

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

  // Compute show tab order from lightweight activity data + progress keys.
  // Fallback for shows with no activity yet: the localStorage tab-creation
  // timestamp (written by markTabCreated when the user starts a journal,
  // creates a friend room, or accepts an invite). This ensures new tabs
  // land at the top of the tab list; pre-existing tabs without a creation
  // mark fall back to 0 as before.
  const showTabOrder = useMemo(() => {
    const latest: Record<string, number> = {};
    for (const { showId, latestAt } of activityOrder) latest[showId] = latestAt;
    Object.keys(progress).forEach(sid => {
      if (!latest[sid]) {
        latest[sid] = user ? readTabCreated(user.id, sid) : 0;
      }
    });
    return Object.keys(latest).sort((a, b) => latest[b] - latest[a]);
  }, [activityOrder, progress, user?.id]);

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

  const [viewedTabIds, setViewedTabIds] = useState<Set<string>>(new Set());
  // Tracks the last location.key whose state.activeTab we've already applied.
  // Ensures the nav directive is one-shot — re-fires caused by other deps
  // (e.g. visibleTabOrder.length shrinking when a tab is closed) don't
  // re-apply a stale directive and override the user's action.
  const consumedDirectiveKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const rawRequestedTab = (location.state as any)?.activeTab as string | undefined;
    const isFreshDirective =
      !!rawRequestedTab && consumedDirectiveKeyRef.current !== location.key;

    // Unhide a hidden tab *before* the visibleTabOrder gate. A directive for
    // a hidden tab implies the user wants it visible again — crucially, this
    // must run even when visibleTabOrder is currently empty (all tabs
    // hidden), otherwise reopening a closed tab from search would be a
    // no-op. We don't consume the directive yet; the next render re-enters
    // this effect with an updated visibleTabOrder and applies activeTab.
    if (isFreshDirective && rawRequestedTab && hiddenTabs.has(rawRequestedTab)) {
      unhideTab(rawRequestedTab);
      return;
    }

    if (!visibleTabOrder.length) return;

    if (isFreshDirective && rawRequestedTab) {
      const tab = (visibleTabOrder.includes(rawRequestedTab) || showTabOrder.includes(rawRequestedTab))
        ? rawRequestedTab
        : visibleTabOrder[0];
      setActiveTab(tab);
      setViewedTabIds(prev => new Set([...prev, tab]));
      consumedDirectiveKeyRef.current = location.key;
    } else if (!activeTab) {
      // Initial pick when no directive is present and no tab is selected yet.
      const tab = visibleTabOrder[0];
      setActiveTab(tab);
      setViewedTabIds(prev => new Set([...prev, tab]));
    }
  }, [loading, location.key, visibleTabOrder.length, hiddenTabs]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // clear expanded state when switching tabs
  useEffect(() => { setExpandedIds(new Set()); }, [activeTab]);

  // Keep the active tab in view — matters when a user searches for a show
  // whose tab is off-screen in the horizontal tab scroller (including tabs
  // all the way to the right past the visible window). scrollIntoView with
  // inline: "nearest" nudges horizontally without touching vertical scroll.
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (!activeTab) return;
    const el = tabButtonRefs.current[activeTab];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    }
  }, [activeTab]);

  // Per-show journal filter. Each show keeps its own current selection;
  // switching tabs preserves each tab's state. Navigation away from
  // /profile or a full page refresh resets the whole map (ProfilePage
  // unmounts → useState re-initializes). Default for any untouched
  // show is "all".
  // Three-segment journal filter — friend rooms are the default lens
  // since the desktop refocus toward friend rooms (chunk 2 of refocus).
  // The previous "all" segment was removed; per-mode empty-states now
  // own the empty-tab welcome surface (with TSP / invitedMode /
  // selfCreatedRoom precedence inside the friends branch — see
  // EmptyProfileWelcome).
  type JournalFilter = "friends" | "private" | "public";
  const [filterByShow, setFilterByShow] = useState<Record<string, JournalFilter>>({});
  const activeFilter: JournalFilter = filterByShow[activeTab] ?? "friends";

  // Friend-room filter for the journal
  const [tabGroups, setTabGroups] = useState<FriendGroup[]>([]);
  const [journalGroupFilter, setJournalGroupFilter] = useState<string | null>(null);
  useEffect(() => {
    if (!user || !activeTab) { setTabGroups([]); return; }
    fetchFriendGroupsForUser(user.id, activeTab).then(setTabGroups).catch(() => setTabGroups([]));
  }, [user?.id, activeTab]);
  // Reset group filter when switching show tabs
  useEffect(() => { setJournalGroupFilter(null); }, [activeTab]);

  // canView-aware per-room visibility lookup. Used to pick the
  // most-recently-active friend room as the compose-default destination
  // (chunk 3 of desktop refocus). Reuses the SECURITY DEFINER RPC
  // shipped for mobile (20260425_room_last_seen.sql); the server-side
  // join against effective progress means we don't surface activity
  // the user can't view, which would otherwise leak its existence as
  // a sort signal. Fetched once per user; refetches on activeTab
  // change so newly-created rooms (chunk 1's flow) are picked up
  // without requiring a navigation round-trip. Failures degrade
  // gracefully: an empty map → fall back to FriendGroup.createdAt
  // for ordering.
  const [roomVisibility, setRoomVisibility] = useState<RoomVisibility[]>([]);
  useEffect(() => {
    if (!user) { setRoomVisibility([]); return; }
    let cancelled = false;
    fetchRoomActivityVisibility(user.id)
      .then(rows => { if (!cancelled) setRoomVisibility(rows); })
      .catch(() => { if (!cancelled) setRoomVisibility([]); });
    return () => { cancelled = true; };
  }, [user?.id, activeTab]);

  // Pick the most-recently-active room from a list. Order:
  // (1) latestVisibleActivityAt desc, NULL last; (2) createdAt desc
  // tiebreaker. Returns null when the list is empty.
  const pickMostActiveRoom = (groups: FriendGroup[]): string | null => {
    if (!groups.length) return null;
    const visMap = new Map(roomVisibility.map(v => [v.groupId, v.latestVisibleActivityAt]));
    const sorted = [...groups].sort((a, b) => {
      const av = visMap.get(a.id) ?? null;
      const bv = visMap.get(b.id) ?? null;
      if (av != null && bv != null) return bv - av;
      if (av != null) return -1;  // a has activity, b doesn't → a first
      if (bv != null) return 1;
      return b.createdAt - a.createdAt;  // both null → most-recently-created first
    });
    return sorted[0].id;
  };

  // Compose state
  const [composeOpen, setComposeOpen] = useState(false);
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [composeDestination, setComposeDestination] = useState<"private" | "public" | string>("");

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

  // Show-tab header "your friend rooms" dropdown (2+ rooms case)
  const [roomsHeaderDropdownOpen, setRoomsHeaderDropdownOpen] = useState(false);
  const roomsHeaderDropdownRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!roomsHeaderDropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      if (roomsHeaderDropdownRef.current && !roomsHeaderDropdownRef.current.contains(e.target as Node)) {
        setRoomsHeaderDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [roomsHeaderDropdownOpen]);
  // Close the dropdown when switching show tabs
  useEffect(() => { setRoomsHeaderDropdownOpen(false); }, [activeTab]);
  const handleCreateRoom = async () => {
    if (!user || !newRoomName.trim() || !activeTab) return;
    setCreateRoomSubmitting(true);
    try {
      const g = await createFriendGroup({ showId: activeTab, name: newRoomName.trim(), createdBy: user.id });
      setTabGroups(prev => [...prev, g]);
      setNewRoomName("");
      setShowCreateRoomModal(false);
      // Surface the new room in the top-nav pills without waiting on a refresh.
      if (typeof onGroupCreated === "function") onGroupCreated(g);
      // Navigate into the new room
      sessionStorage.setItem(`ns_active_group_${activeTab}`, g.id);
      openShow(activeTab);
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

  // Background staleness refresh for the active tab's show. Mirrors the
  // same effect in ShowSection so the journal-side progress picker stays
  // current with newly-aired episodes. 12-hour cadence is enforced inside
  // refreshShowIfStale — within that window this is a fast no-op. Cancelled
  // flag guards against state writes after a tab switch.
  useEffect(() => {
    if (!activeShow) return;
    let cancelled = false;
    refreshShowIfStale(activeShow).then(updated => {
      if (cancelled || !updated) return;
      onShowUpdated?.(updated);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeTab]);

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
        rewatchSeason: postProgress.isRewatching ? (postProgress.rewatchS ?? postProgress.s) : undefined,
        rewatchEpisode: postProgress.isRewatching ? (postProgress.rewatchE ?? postProgress.e) : undefined,
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

      const destShowId = activeTab;
      const groupId = (composeDestination !== "public" && composeDestination !== "private") ? composeDestination : undefined;
      const groupName = groupId ? tabGroups.find(g => g.id === groupId)?.name : undefined;
      setTabDataCache(prev => {
        const existing = prev[activeTab];
        if (!existing) return prev;
        return { ...prev, [activeTab]: { ...existing, myThreads: [{ thread: t, groupId, groupName }, ...existing.myThreads] } };
      });
      setPostTitle(""); setPostBody("");
      setActivePrompt(null); setShownPromptIds([]); setInsertedPromptIds([]);
      setComposeOpen(false);
      // Navigate to the newly created thread in its context
      openThreadWithFocus(destShowId, t.id, undefined, groupId);
    } catch {
      alert("Failed to post. Please try again.");
    } finally {
      setPostSubmitting(false);
    }
  };

  const toggleExpand = (id: string) =>
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Per-tab data is already filtered by showId via lazy-load; apply spoiler filter only
  // Journal entries ("your posts" — top half) are sorted by the *about
  // episode* airdate: for rewatch posts, the rewatch position frozen at time
  // of writing; for everything else, the post's season/episode. This is a
  // one-off exception for the notebook metaphor — filter tags still drive
  // spoiler visibility everywhere else on the site, and the lower-half
  // sections (responses, stars) keep their default activity ordering.
  const tabThreads = useMemo(() => {
    const aboutSeason = (t: Thread) =>
      t.isRewatch && t.rewatchS != null ? t.rewatchS : t.season;
    const aboutEpisode = (t: Thread) =>
      t.isRewatch && t.rewatchE != null ? t.rewatchE : t.episode;
    return [...visibleThreads].sort((a, b) => {
      const aS = aboutSeason(a.thread);
      const bS = aboutSeason(b.thread);
      if (aS !== bS) return bS - aS;
      const aE = aboutEpisode(a.thread);
      const bE = aboutEpisode(b.thread);
      if (aE !== bE) return bE - aE;
      // Tiebreaker within the same episode: newer above.
      return b.thread.createdAt - a.thread.createdAt;
    });
  }, [visibleThreads]);
  const tabMyReplies = visibleMyReplies;
  const tabRepliesToMe = visibleRepliesToMe;
  const tabLikedThreads = visibleLikedThreads;
  const tabLikedReplies = visibleLikedReplies;

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

  // Which threads have visible replies (within progress) and their counts / latest timestamps
  const visibleByThreadId = useMemo(() => {
    const r: Record<string, true> = {};
    for (const { reply, thread: t } of repliesToUser) {
      if (canView({ season: reply.season, episode: reply.episode }, progress[t.showId])) r[t.id] = true;
    }
    return r;
  }, [repliesToUser, progress]);

  const visibleReplyCountByThreadId = useMemo(() => {
    const r: Record<string, number> = {};
    for (const { reply, thread: t } of repliesToUser) {
      if (canView({ season: reply.season, episode: reply.episode }, progress[t.showId]))
        r[t.id] = (r[t.id] ?? 0) + 1;
    }
    return r;
  }, [repliesToUser, progress]);

  const latestVisibleAtByThreadId = useMemo(() => {
    const r: Record<string, number> = {};
    for (const { reply, thread: t } of repliesToUser) {
      if (canView({ season: reply.season, episode: reply.episode }, progress[t.showId])) {
        if (!r[t.id] || reply.updatedAt > r[t.id]) r[t.id] = reply.updatedAt;
      }
    }
    return r;
  }, [repliesToUser, progress]);

  // Dismissed green indicators: threadId → timestamp when dismissed
  const [dismissedGreenIndicators, setDismissedGreenIndicators] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_dismissed_green_indicators") || "{}"); }
    catch { return {}; }
  });
  const dismissGreenIndicator = (threadId: string) => {
    const updated = { ...dismissedGreenIndicators, [threadId]: Date.now() };
    setDismissedGreenIndicators(updated);
    localStorage.setItem("ns_dismissed_green_indicators", JSON.stringify(updated));
  };

  const shouldShowGreenIndicator = (threadId: string) => {
    if (!visibleByThreadId[threadId]) return false;
    const dismissedAt = dismissedGreenIndicators[threadId];
    if (!dismissedAt) return true;
    return (latestVisibleAtByThreadId[threadId] ?? 0) > dismissedAt;
  };

  const shouldShowRedIndicator = (threadId: string) => {
    if (!invisibleByThreadId[threadId]) return false;
    // Red only shows if green is NOT showing
    if (shouldShowGreenIndicator(threadId)) return false;
    const dismissedAt = dismissedIndicators[threadId];
    if (!dismissedAt) return true;
    return (latestInvisibleAtByThreadId[threadId] ?? 0) > dismissedAt;
  };

  // Combined: returns "green", "red", or null
  const getThreadIndicator = (threadId: string): "green" | "red" | null => {
    if (shouldShowGreenIndicator(threadId)) return "green";
    if (shouldShowRedIndicator(threadId)) return "red";
    return null;
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
    <section className="container journalShift" style={{ paddingBottom: 28 }}>
      {loading && <div className="muted" style={{ padding: "24px 0" }}>Loading your profile<LoadingDots /></div>}

      {!loading && (
        <div className="container" style={{ marginTop: 12 }}>
          {/* Journal always renders its heading. When there are no visible
             tabs (first-time user, or all-tabs-closed state), the welcome
             lives inside a diary card in the same spot the real entries
             would occupy — so the page feels present, not broken.
             When there's an active tab, the full journal (tab row, filters,
             compose, entries) renders in its usual form. */}
          <div className="hangLContent" style={{ paddingTop: 0 }}>
            <section style={{ marginTop: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 0, marginBottom: 12, minHeight: 28 }}>
                <div className="title profile-journal-heading" style={{ fontSize: 22 }}>this is your journal</div>
              </div>
              {!activeTab && (
                <div className="diaryOuter">
                  <div className="diaryCardWrap">
                    {([48, 32, 16] as const).map(offset => {
                      const opacity = offset === 48 ? 0.18 : offset === 32 ? 0.36 : 0.55;
                      return (
                        <div key={offset} className="diaryBackPage" style={{ transform: `translate(-${offset}px, ${offset}px)`, borderColor: `rgba(255,255,255,${opacity})` }} />
                      );
                    })}
                    <div className="card" style={{ minHeight: 500, display: "flex", flexDirection: "column", padding: 0, position: "relative", zIndex: 1 }}>
                      <EmptyProfileWelcome />
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          {activeTab && (
            <div className="hangLContent" style={{ paddingTop: 0 }}>
            <>
              {/* Your Watch Diary */}
              <section style={{ marginTop: 0 }}>
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
                          ref={(el) => { tabButtonRefs.current[sid] = el; }}
                          className={`diaryTab${active ? " active" : ""}`}
                          title={activity ? "There are new responses to you in here." : undefined}
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
                            <span data-hamburger style={{ marginLeft: 8, opacity: 0.8, lineHeight: 1, display: "inline-flex", verticalAlign: "middle" }}><CircleChevronDown size={20} color="currentColor" /></span>
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
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        {/* Write — defaults to most-recently-active friend
                           room for this show (canView-aware) per desktop
                           refocus (chunk 3). Falls back to "private" when
                           the user has no rooms for this tab (legacy show). */}
                        <button
                          className="btn post h40"
                          onClick={() => {
                            const defaultRoom = pickMostActiveRoom(tabGroups);
                            setComposeDestination(defaultRoom ?? "private");
                            setComposeOpen(true);
                          }}
                          style={{ lineHeight: 1.2, display: "inline-flex", alignItems: "center", gap: 5 }}
                        >
                          <SquarePen size={15} /> write
                        </button>

                        {/* Friend-room affordance — conditional on room count.
                           Single: direct link. Multi: dropdown (chevron). */}
                        {tabGroups.length === 1 && (() => {
                          const name = tabGroups[0].name;
                          const MAX = 12;
                          const truncated = name.length > MAX ? name.slice(0, MAX) + "…" : name;
                          return (
                            <Tooltip
                              text="Go to friend room."
                              direction="below"
                              align="center"
                              portal
                              tooltipStyle={{ width: "auto", whiteSpace: "nowrap", padding: "6px 10px" }}
                            >
                              <button
                                className="btn h40"
                                onClick={() => goToShowRoom(activeTab, tabGroups[0].id)}
                                style={{
                                  lineHeight: 1.2,
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  background: "#adc8d7",
                                  border: "2px solid #adc8d7",
                                  color: "#fff",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <ArrowRight size={15} color="#fff" style={{ flexShrink: 0 }} />
                                <span>{truncated}</span>
                                <Users size={15} color="#fff" style={{ flexShrink: 0 }} />
                              </button>
                            </Tooltip>
                          );
                        })()}
                        {tabGroups.length >= 2 && (
                          <div ref={roomsHeaderDropdownRef} style={{ position: "relative" }}>
                            <button
                              className="btn"
                              onClick={() => setRoomsHeaderDropdownOpen(o => !o)}
                              style={{
                                lineHeight: 1.2,
                                padding: "4px 10px",
                                fontSize: 13,
                                display: "inline-flex", alignItems: "center", gap: 4,
                                background: "transparent",
                                border: "2px solid #fff",
                                color: "#fff",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <span>friend rooms</span>
                              <ChevronDown size={14} color="#fff" style={{ flexShrink: 0 }} />
                            </button>
                            {roomsHeaderDropdownOpen && (
                              <div style={{
                                position: "absolute", top: "calc(100% + 6px)", left: 0,
                                display: "flex", flexDirection: "column", gap: 6,
                                background: "var(--dos-bg)", border: "none",
                                borderRadius: 10, padding: 8, zIndex: 200,
                                boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
                                minWidth: 240,
                              }}>
                                {tabGroups.map(g => (
                                  <button
                                    key={g.id}
                                    className="btn"
                                    onClick={() => {
                                      setRoomsHeaderDropdownOpen(false);
                                      goToShowRoom(activeTab, g.id);
                                    }}
                                    style={{
                                      fontSize: 13, whiteSpace: "nowrap",
                                      display: "flex", alignItems: "center", width: "100%",
                                      background: "#adc8d7", color: "#fff", border: "none",
                                    }}
                                  >
                                    <ArrowRight size={14} color="#fff" style={{ flexShrink: 0 }} />
                                    <span style={{ flex: 1, textAlign: "center", margin: "0 8px", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                                    <Users size={14} color="#fff" style={{ flexShrink: 0 }} />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* + friends (or a circular + once the show already has ≥1 room) */}
                        <Tooltip
                          text={tabGroups.length > 0
                            ? <>Create another friend room<br />for this show.</>
                            : "Create a friend room for this show."}
                          direction="below"
                          tooltipStyle={{ width: "auto", whiteSpace: "nowrap", padding: "6px 10px" }}
                        >
                          <button
                            className="btn"
                            onClick={() => setShowCreateRoomModal(true)}
                            style={tabGroups.length > 0
                              ? {
                                  // Circular icon-only state
                                  lineHeight: 1,
                                  width: 28, height: 28, padding: 0,
                                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                                  background: "transparent",
                                  border: "2px solid #fff",
                                  borderRadius: "50%",
                                  color: "#fff",
                                }
                              : {
                                  // Pill state with "friends" label
                                  lineHeight: 1.2,
                                  padding: "4px 10px",
                                  fontSize: 13,
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  background: "transparent",
                                  border: "2px solid #fff",
                                  color: "#fff",
                                  whiteSpace: "nowrap",
                                }}
                          >
                            <Plus size={14} />{tabGroups.length === 0 && " friends"}
                          </button>
                        </Tooltip>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                        {/* Journal mode filter — three-segment radio pill,
                           per-show state (preserved across tab switches
                           within ProfilePage, reset on navigation away
                           or refresh). Label order: friends / private /
                           public. Default = friends per desktop refocus
                           (chunk 2). All three segments carry tooltips. */}
                        <div style={{
                          display: "flex", gap: 0, borderRadius: 999, overflow: "hidden",
                          border: "2px solid var(--dos-border)", flexShrink: 0,
                        }}>
                          {([
                            { val: "friends", label: "friends", tooltip: "What you've written for friends." },
                            { val: "private", label: "private", tooltip: "Your private thoughts." },
                            { val: "public",  label: "public",  tooltip: "What the public sees." },
                          ] as const).map(({ val, label, tooltip }) => {
                            const btn = (
                              <button
                                onClick={() => setFilterByShow(prev => ({ ...prev, [activeTab]: val }))}
                                style={{
                                  padding: "1px 6px",
                                  fontSize: 10,
                                  fontWeight: activeFilter === val ? 700 : 400,
                                  background: activeFilter === val ? "var(--dos-border)" : "transparent",
                                  color: activeFilter === val ? "var(--dos-bg)" : "var(--dos-fg)",
                                  border: "none",
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 4,
                                  width: "100%",
                                  height: "100%",
                                }}
                              >
                                {label}
                              </button>
                            );
                            // Pass display: flex to Tooltip's wrapper span so it
                            // becomes a flex container — inner button then stretches
                            // to the wrapper's full height (the wrapper, as a flex
                            // item of the outer pill, already stretches to pill
                            // height). Without this the tooltip-wrapped segments'
                            // backgrounds don't reach top-to-bottom and they sit
                            // at a different vertical baseline than the bare "all"
                            // segment.
                            return tooltip
                              ? (
                                <Tooltip
                                  key={val}
                                  text={tooltip}
                                  direction="below"
                                  tooltipStyle={{ width: "auto", whiteSpace: "nowrap", padding: "6px 10px" }}
                                  style={{ display: "flex" }}
                                >
                                  {btn}
                                </Tooltip>
                              )
                              : <React.Fragment key={val}>{btn}</React.Fragment>;
                          })}
                        </div>
                        {activeShow && (
                          <OneSelectProgress
                            show={activeShow}
                            value={postProgress}
                            onConfirm={(val) => updateProgressFor?.(activeTab, val)}
                            requireConfirm={true}
                            allowZero={postProgress?.s === 0}
                            rewatchHighest={postProgress?.isRewatching && postProgress.highestS != null && postProgress.highestE != null
                              ? { s: postProgress.highestS, e: postProgress.highestE }
                              : null}
                          />
                        )}
                      </div>
                    </div>
                  )}
                  <div className="diaryScrollArea">
                  {tabLoading && !currentTabData && (
                    <div className="muted" style={{ padding: "80px 20px", textAlign: "center" }}>Loading…</div>
                  )}
                  {(!tabLoading || currentTabData) && (() => {
                    const byDiary =
                      activeFilter === "public"  ? tabThreads.filter(({ thread: t }) => t.isPublic)
                      : activeFilter === "friends" ? tabThreads.filter(({ thread: t, groupId }) => !t.isPublic && !!groupId)
                      : /* private */              tabThreads.filter(({ thread: t, groupId }) => !t.isPublic && !groupId);
                    const filtered = journalGroupFilter ? byDiary.filter(({ groupId }) => groupId === journalGroupFilter) : byDiary;
                    if (filtered.length === 0) {
                      // Empty-state precedence on the friends filter (the new
                      // default after the desktop refocus). Order:
                      //   1. TSP — canonical demo welcome
                      //   2. invitedMode — session flag set by
                      //      InviteAcceptPage.handleAccept (sessionStorage:
                      //      ns_invite_welcome_<showId>). Cleared on browser
                      //      close or first post.
                      //   3. selfCreatedRoom — user has at least one friend
                      //      room they created for this show. Discriminator:
                      //      tabGroups.some(g => g.createdBy === user.id).
                      //   4. Fallthrough → legacy "you haven't written for
                      //      any friends yet" copy below (covers users with
                      //      a journal tab but no friend room).
                      // The private + public branches keep their existing
                      // per-mode copy unchanged.
                      if (activeFilter === "friends") {
                        if (activeTab === "tsp") {
                          return <EmptyProfileWelcome isTsp={true} />;
                        }
                        const invitedMode = !!activeTab && typeof window !== "undefined" && !!sessionStorage.getItem(`ns_invite_welcome_${activeTab}`);
                        if (invitedMode) {
                          return <EmptyProfileWelcome invitedMode={true} showName={activeTab ? showName(activeTab) : undefined} />;
                        }
                        const hasSelfCreatedRoom = !!user && tabGroups.some(g => g.createdBy === user.id);
                        if (hasSelfCreatedRoom) {
                          return <EmptyProfileWelcome selfCreatedRoom={true} showName={activeTab ? showName(activeTab) : undefined} />;
                        }
                        // else: fall through to per-mode "haven't written for friends yet" copy below.
                      }
                      const sName = showName(activeTab);
                      const copy: React.ReactNode =
                        activeFilter === "public"
                          ? <>You haven't written publicly yet. When you do, your public entries about <em>{sName}</em> will become part of a durable archive of good TV writing, waiting to be found by anyone who reaches the episodes you've written about.</>
                          : activeFilter === "friends"
                            ? <>You haven't written for any friends yet. They're waiting to know your thoughts!</>
                            : <>No private entries about <em>{sName}</em> yet. Sometimes the best thinking happens when you write just for yourself…</>;
                      return (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "150px 0 48px" }}>
                          <div style={{ width: "min(400px, 100%)" }}>
                            {/* Wrapper font-style kept "normal" so the <em>
                               show-name markup actually renders italic against
                               roman body copy. If the body should be italic
                               overall, swap to bold for show-name emphasis
                               instead. */}
                            <p style={{ margin: 0, fontSize: 16, fontWeight: 400, lineHeight: 1.6, color: "var(--dos-fg)", opacity: 0.65, textAlign: "left" }}>
                              {copy}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    return filtered.map(({ thread: t, groupId, groupName }) => {
                    const isGroup = !!groupId;
                    const isPub = t.isPublic && !groupId;
                    // card bg: blue for friend room, yellow for public, transparent for private
                    const cardBg = isGroup ? "#adc8d7" : isPub ? "#dea838" : undefined;
                    const cardFg = isGroup ? "#1a3a4a" : "#fff";
                    const cardMuted = isGroup ? "rgba(26,58,74,0.65)" : "rgba(255,255,255,0.65)";
                    const epColor = isGroup ? "#1a3a4a" : "var(--dos-cyan)";
                    // expand button: inverted chip using card accent
                    const chipBg = isGroup ? "#1a3a4a" : isPub ? "rgba(0,0,0,0.18)" : "#fff";
                    const chipFg = isGroup ? "#adc8d7" : isPub ? "#fff" : "var(--dos-bg)";
                    return (
                    <div key={t.id} className="card threadCard"
                      style={{
                        margin: "10px 0 10px 20px", cursor: "pointer", position: "relative",
                        ...((isGroup || isPub) ? { background: cardBg, color: cardFg, borderColor: "transparent" } : {}),
                      }}
                      onClick={() => { dismissGreenIndicator(t.id); openThreadWithFocus(t.showId, t.id, undefined, groupId); }}>
                      {getThreadIndicator(t.id) === "green" && (
                        <Tooltip
                          text="People have written to you."
                          direction="right"
                          gap={14}
                          style={{ position: "absolute", left: -10, top: -2, zIndex: 2 }}
                          tooltipStyle={{ background: "#adc8d7", color: "#1a2c3a", boxShadow: "0 4px 20px rgba(0,0,0,0.18)" }}
                          width={200}
                        >
                          <div
                            style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--green)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                            onClick={(e) => { e.stopPropagation(); dismissGreenIndicator(t.id); }}
                          >
                            <X size={12} color="#fff" />
                          </div>
                        </Tooltip>
                      )}
                      {getThreadIndicator(t.id) === "red" && (
                        <Tooltip
                          text={<>{invisibleCountByThreadId[t.id] ?? ""} people ahead of you have written you back! You can read these once you catch up.</>}
                          direction="right"
                          gap={14}
                          style={{ position: "absolute", left: -10, top: -2, zIndex: 2 }}
                          tooltipStyle={{ background: "#adc8d7", color: "#1a2c3a", boxShadow: "0 4px 20px rgba(0,0,0,0.18)" }}
                          width={260}
                        >
                          <div
                            style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                            onClick={(e) => { e.stopPropagation(); dismissIndicator(t.id); }}
                          >
                            <X size={12} color="#fff" />
                          </div>
                        </Tooltip>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="title" style={{ fontSize: 18, ...((isGroup || isPub) ? { color: cardFg } : {}) }}>
                          {!t.isPublic && !groupId && <span title="Private" style={{ marginRight: 8, display: "inline-flex", verticalAlign: "middle" }}><LockKeyhole size={14} color="var(--icon-color)" /></span>}
                          {isPub && <span title="Public" style={{ marginRight: 8, display: "inline-flex", verticalAlign: "middle" }}><Globe size={14} color="var(--icon-color)" /></span>}
                          {isGroup && <span title={`Friend room: ${groupName ?? ""}`} style={{ marginRight: 8, display: "inline-flex", verticalAlign: "middle" }}><Users size={14} color="var(--icon-color)" /></span>}
                          {isGroup && groupName && (
                            <span style={{ fontSize: 13, opacity: 0.7, fontWeight: 400, marginRight: 6 }}>
                              {groupName} ·{" "}
                            </span>
                          )}
                          {/* Public-card show-name prefix link (chunk 4 of
                             desktop refocus). Mirrors the friend-room-name
                             prefix style above (fontSize 13, opacity 0.7,
                             roman weight, separator dot) but adds an
                             underline and click handler on the show-name
                             token itself so it reads as a link to the
                             public aggregate space. White color is
                             inherited from the public card's cardFg.
                             stopPropagation prevents the parent card
                             onClick from firing when the show name is
                             tapped — card click still opens the thread,
                             show-name click goes to the show forum.
                             Sessionstorage active-group key is cleared
                             before navigating so the user lands on the
                             public forum view, not whatever room context
                             they last had for this show. */}
                          {isPub && (
                            <span style={{ fontSize: 13, opacity: 0.7, fontWeight: 400, marginRight: 6 }}>
                              <a
                                onClick={(e) => {
                                  e.stopPropagation();
                                  try { sessionStorage.removeItem(`ns_active_group_${t.showId}`); } catch {}
                                  openShow(t.showId);
                                }}
                                style={{ color: "inherit", textDecoration: "underline", cursor: "pointer" }}
                              >
                                {showName(t.showId)}
                              </a>
                              {" "}·{" "}
                            </span>
                          )}
                          {t.titleBase}
                          {t.showId !== "simshow" && (
                            <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 7, whiteSpace: "nowrap" }}>
                              <EpisodeTag season={t.season} episode={t.episode} isRewatch={t.isRewatch} rewatchS={t.rewatchS} rewatchE={t.rewatchE} />
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
                      {(isGroup || isPub) && visibleReplyCountByThreadId[t.id] > 0 && (
                        <div style={{ position: "absolute", right: 12, bottom: 8, fontSize: 12, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 4 }}>
                          <Mail size={14} color="#fff" /> {visibleReplyCountByThreadId[t.id]}
                        </div>
                      )}
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
                        <div style={{ position: "absolute", left: -10, top: -2, width: 20, height: 20, borderRadius: "50%", background: "var(--green)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", zIndex: 2, pointerEvents: "none" }} />
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div className="muted" style={{ fontSize: 14 }}>
                          On <b>{t.titleBase}</b>{" "}
                          <span style={{ color: "var(--dos-cyan)" }}>
                            <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                          </span>{" "}
                          • {groupName
                              ? <span style={{ fontStyle: "italic" }}>in {groupName}</span>
                              : <span style={{ fontStyle: "italic" }}>publicly</span>}{" "}
                          • <span className="username">@{r.author}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 13, flexShrink: 0 }}>{timeAgo(r.updatedAt)}</div>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 15 }} className="clamp3">
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
                              <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                            </span>
                          )}
                        </div>
                        <div className="muted" style={{ fontSize: 13, flexShrink: 0 }}>{timeAgo(r.updatedAt)}</div>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 15 }} className="clamp3">
                        {r.body}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Starred posts */}
              <section style={{ marginTop: 24 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your starred entries</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabLikedThreads.length === 0 && <div className="muted">No starred entries yet.</div>}
                  {tabLikedThreads.map(t => (
                    <div key={t.id} className="card threadCard"
                      style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
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
                        <div className="muted" style={{ fontSize: 13, flexShrink: 0 }}>{timeAgo(t.updatedAt)}</div>
                      </div>
                      <div style={{ marginTop: 6 }} className="clamp3">
                        {t.preview}
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
                            <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                          </span>{" "}
                          • <span className="username">@{r.author}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 13, flexShrink: 0 }}>{timeAgo(r.updatedAt)}</div>
                      </div>
                      <div style={{ marginTop: 6 }} className="clamp3">
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
      {composeOpen && (() => {
        // Group destination = a friend-room id (anything that's not
        // "private" or "public" or the empty disabled placeholder).
        const isGroupDest = composeDestination !== "" && composeDestination !== "private" && composeDestination !== "public";
        // Modal frame color tracks destination per chunk 3:
        //   friend room → canon light-blue, public → canon yellow,
        //   private → canon green (default journal fill).
        const composeBg = isGroupDest ? "#adc8d7" : composeDestination === "public" ? "#dea838" : "#7abd8e";
        // Prompt-button accent: opposite axis of the modal so the CTA
        // pops. For room context, fall back to canon green (the
        // default journal accent).
        const promptBtnBg = isGroupDest ? "#7abd8e" : composeDestination === "public" ? "#7abd8e" : "#dea838";
        // Sorted rooms list for the dropdown — most-recently-active
        // first, matching the default-destination signal so the chosen
        // default sits at the top of the list (predictable mapping).
        const sortedRooms = (() => {
          const visMap = new Map(roomVisibility.map(v => [v.groupId, v.latestVisibleActivityAt]));
          return [...tabGroups].sort((a, b) => {
            const av = visMap.get(a.id) ?? null;
            const bv = visMap.get(b.id) ?? null;
            if (av != null && bv != null) return bv - av;
            if (av != null) return -1;
            if (bv != null) return 1;
            return b.createdAt - a.createdAt;
          });
        })();
        return (
        <Modal onClose={closeCompose} width="min(720px,92vw)" cardStyle={{ background: composeBg }}>
          <button className="close-x" onClick={closeCompose} style={{ position: "absolute", top: 12, right: 16 }}><X size={14} /></button>
          <div style={{ display: "grid", gap: 10 }}>
            {/* ── Destination dropdown ── */}
            {/* Order: friend rooms (most-recently-active first) →
               private → public. Per spec, profile compose surfaces
               all three destination types. The default selection is
               wired in the "write" button click handler above. */}
            <div>
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <select
                  className="badge"
                  value={composeDestination}
                  onChange={(e) => setComposeDestination(e.target.value)}
                  style={{ fontSize: 13, fontWeight: 600, paddingRight: 30, appearance: "none", WebkitAppearance: "none", cursor: "pointer", width: "100%" }}
                >
                  <option value="" disabled>where do you want to write?</option>
                  {sortedRooms.map(g => (
                    <option key={g.id} value={g.id}>{g.name} friend room</option>
                  ))}
                  <option value="private">private entry</option>
                  <option value="public">public entry</option>
                </select>
                <ChevronDown size={14} color="var(--dos-fg)" style={{ position: "absolute", right: 10, pointerEvents: "none" }} />
              </div>
            </div>

            <input
              className="badge"
              placeholder="Title"
              value={postTitle}
              onChange={(e) => setPostTitle(e.target.value)}
              style={{ width: "100%", height: 40, fontWeight: 700 }}
            />
            {activeShow && (
              <div className="muted" style={{ fontSize: 13 }}>
                {postProgress.isRewatching ? (
                  <>Your post is automatically marked to <b>Season {postTagS} Episode {postTagE}</b> — your highest prior progress as a re-watcher. It will only show to people who've watched at least that far.</>
                ) : (
                  <>Your post is automatically marked to <b>Season {postTagS} Episode {postTagE}</b> and will only show to people who've watched at least that far.</>
                )}
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
            {/* ── Submit row ── */}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
              {promptEntries.length > 0 && (
                <button className="prompt-btn" type="button" onClick={handlePromptBtn} title="Get a writing prompt" style={{ marginRight: "auto", background: promptBtnBg, borderColor: promptBtnBg, color: "#fff" }}>
                  <Sparkles size={14} color="currentColor" style={{verticalAlign:"middle"}} /> want a prompt?
                </button>
              )}
              <button className="btn" onClick={closeCompose} disabled={postSubmitting} style={{ background: "transparent", border: "2px solid var(--danger)", color: "var(--danger)", whiteSpace: "nowrap", fontSize: 13 }}>Cancel</button>
              {(() => {
                const formReady = !!composeDestination && !!postTitle.trim() && !!postBody.trim();
                return (
                  <button
                    className="btn compose-submit"
                    onClick={submitPost}
                    disabled={postSubmitting || !formReady}
                    style={{
                      background: "#fff",
                      border: "none",
                      // Text color tracks destination; icons use currentColor
                      // so they track automatically. Friend-room destination
                      // (chunk 3 of desktop refocus) uses canon navy text
                      // on white to match the room theme's dark-on-light
                      // styling pattern (canon-light-blue bg → canon-navy
                      // foreground).
                      color: isGroupDest ? "#1a3a4a" : composeDestination === "public" ? "#dea838" : "#7abd8e",
                      whiteSpace: "nowrap",
                      fontSize: 13,
                      minWidth: 130,
                      opacity: formReady ? 1 : 0.3,
                    }}
                  >
                    {!formReady && !postSubmitting ? "\u00A0"
                      : postSubmitting ? <>Posting<LoadingDots /></>
                      : composeDestination === "private" ? <><LockKeyhole size={14} style={{verticalAlign:"middle"}} /> save to journal</>
                      : composeDestination === "public" ? <><Globe size={14} style={{verticalAlign:"middle"}} /> publish</>
                      : <><Users size={14} style={{verticalAlign:"middle"}} /> send to friends</>}
                  </button>
                );
              })()}
            </div>
          </div>
        </Modal>
        );
      })()}

      {/* Create friend room modal */}
      {showCreateRoomModal && (
        <Modal onClose={() => { setShowCreateRoomModal(false); setNewRoomName(""); }} width="min(420px,92vw)">
          <h3 className="title" style={{ margin: "0 0 12px" }}>Create a friend room</h3>
          <p style={{ margin: "0 0 16px", fontSize: 14, opacity: 0.75, lineHeight: 1.5 }}>
            This will be where you and your friends talk about <strong>{activeTab ? showName(activeTab) : "this show"}</strong>. Whatever anyone writes here will only be visible to you and your friends. You can decide who to invite later.
          </p>
          <input
            className="badge"
            placeholder="give your room a unique name"
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
          boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
          minWidth: 260,
        }}>
          {/* Friend-room access lives in the show-tab header now; this
             dropdown is simplified to just Public conversations + Close. */}
          {/* 1. Public conversations */}
          <Tooltip text={`See what others are writing about ${showName(tabDropdownOpen)}.`} direction="below">
            <button className="btn" style={{
              fontSize: 13, whiteSpace: "nowrap",
              display: "flex", alignItems: "center", width: "100%",
              background: "#dea838", color: "#fff", border: "none",
            }}
              onClick={() => goToShowRoom(tabDropdownOpen)}>
              <ArrowRight size={14} color="#fff" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: "center", margin: "0 8px" }}>Public conversations</span>
              <Globe size={14} color="#fff" style={{ flexShrink: 0 }} />
            </button>
          </Tooltip>
          {/* 2. Divider — half-width, centered, same 2px weight as the
             journal-page outlines with 0.75 opacity so it reads as a soft
             separator rather than a hard rule. */}
          <div style={{ borderTop: "2px solid var(--dos-border)", width: "50%", margin: "2px auto", opacity: 0.75 }} />
          {/* 3. Close show tab */}
          <Tooltip text="Hides this tab from your journal view. Your entries and progress are kept. Search for the show again and choose 'Start your journal' to bring it back." direction="below">
            <button className="btn" style={{
              fontSize: 13, whiteSpace: "nowrap", opacity: 0.75,
              display: "flex", alignItems: "center", width: "100%",
            }}
              onClick={() => {
                const sid = tabDropdownOpen;
                setTabDropdownOpen(null);
                hideTab(sid);
                // Clear every per-show session key so a later search doesn't
                // short-circuit into a stale context (public space with
                // preserved browse progress, friend room with preserved
                // active-group id, etc.). Without this, searching a show
                // whose tab was closed can bounce the user into whatever
                // space they were last in, instead of back to a fresh tab.
                sessionStorage.removeItem(`ns_browse_prog_${sid}`);
                sessionStorage.removeItem(`ns_browse_show_${sid}`);
                sessionStorage.removeItem(`ns_active_group_${sid}`);
                sessionStorage.removeItem(`ns_came_from_group_${sid}`);
                // Switch to another tab if the hidden one was active.
                // If there are no remaining visible tabs, clear activeTab so
                // the welcome renders immediately instead of the card falling
                // back to cached data for the just-closed tab.
                if (sid === activeTab) {
                  const remaining = visibleTabOrder.filter(s => s !== sid);
                  if (remaining.length) setActiveTab(remaining[0]);
                  else setActiveTab("");
                }
              }}>
              <X size={14} color="var(--icon-color)" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: "center", margin: "0 8px" }}>Close show tab</span>
              <span style={{ width: 14, flexShrink: 0 }} />
            </button>
          </Tooltip>
        </div>
      )}
    </section>
  );
}
