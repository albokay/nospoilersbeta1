import React, { useState, useMemo, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SquarePen, X, Globe, Users, LockKeyhole, Sparkles, CircleChevronDown, ChevronDown, Mail, ArrowLeft, ArrowRight, Plus } from "lucide-react";
import type { Reply, Thread, FriendGroup } from "../types";
import { seedShows } from "../lib/mockData";
import type { Show } from "../lib/db";
import { fetchUserThreads, fetchUserReplies, fetchRepliesToUserThreads, fetchLikedThreads, fetchLikedReplies, fetchUserShowActivity, insertThread, fetchPrompts, fetchFriendGroupsForUser, addThreadToGroup, createFriendGroup, readTabCreated, refreshShowIfStale, fetchRoomActivityVisibility, stopWatching } from "../lib/db";
import type { RoomVisibility } from "../lib/db";
import type { PromptRow } from "../lib/db";
import { prefetchComposeData } from "../lib/composeDataCache";
import { getCachedActivity, setCachedActivity, invalidateJournalCache } from "../lib/journalCache";
import { useAuth } from "../lib/auth";
import { canView, timeAgo } from "../lib/utils";
import { linkifyText } from "../lib/linkify";
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

// V3JournalPage = wholesale duplicate of ProfilePage (mounted at /v3/journal
// inside AppShell, sharing the same prop graph). Reuse ProfilePage's exported
// ProfileTabData type so AppShell's setProfileTabData accepts callbacks from
// either component without divergence. Tweaks to v3 layout/behavior happen in
// this file only — live /profile is unaffected.
import type { ProfileTabData } from "./ProfilePage";

export default function V3JournalPage({
  shows: showsProp,
  username,
  progress,
  openThreadWithFocus, openShow, onClose,
  repliesToUser = [],
  pingCountsByShow = {},
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
  repliesToUser?: { reply: Reply; thread: Thread; groupId?: string }[];
  pingCountsByShow?: Record<string, number>;
  openedAtSeenAt?: number;
  onTabsChange?: (data: ProfileTabData | null) => void;
  onGroupCreated?: (g: FriendGroup) => void;
  onShowUpdated?: (updated: Show) => void;
}) {
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
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

  // Step 1: lightweight metadata query — only show IDs + timestamps.
  // Hydrate-then-refresh: localStorage cache populates activityOrder
  // synchronously so the tab list renders before any network round-trip
  // for returning visits. Background fetch always runs to reconcile +
  // re-cache. Cache TTL = 1h; outside that window we fall through to
  // the network with the spinner. See lib/journalCache.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const cached = getCachedActivity(user.id);
    if (cached) {
      setActivityOrder(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    fetchUserShowActivity(user.id)
      .then(activity => {
        if (cancelled) return;
        setActivityOrder(activity);
        setLoading(false);
        setCachedActivity(user.id, activity);
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
    // Hide any show the user has stopped watching — that show belongs on
    // the profile's Stopped Watching shelf, not in the journal's tab list.
    // Mirrors V2JournalPage's userShowIds filter. Without this, after the
    // stopWatching cascade the tab would linger in the journal until the
    // user manually hid it.
    return Object.keys(latest)
      .filter(sid => !progress[sid]?.stoppedWatching)
      .sort((a, b) => latest[b] - latest[a]);
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
  // Tab surface bg follows the active filter — extends the existing
  // "private cards on green diary surface" pattern (where the cards
  // already match the surface and visually disappear into it) to
  // friends + public modes. Cards retain their per-mode bg, so on a
  // matching-color surface they read as the same headline-typography
  // treatment as private has had all along. Filter-as-destination
  // also keys off this — see write-button onClick + compose modal
  // dropdown gating below.
  //   friends → canon light-blue (#adc8d7)
  //   private → canon green (#7abd8e, same as var(--dos-bg))
  //   public  → canon yellow (#dea838)
  const tabBg = activeFilter === "friends" ? "#adc8d7"
              : activeFilter === "public"  ? "#dea838"
              : "#7abd8e";

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

  // Stop-watching modal — ported from V2JournalPage. Opens from the
  // active tab's chevron-dropdown's "Close show / stop watching" item.
  // Confirmation lists the friend rooms the user will leave (drawn from
  // tabGroups, which is populated for activeTab); on confirm runs the
  // stopWatching cascade (removes user from rooms / soft-deletes
  // solo-owned rooms / transfers ownership of created rooms / flags
  // progress.stopped_watching=true) and lands the user on /v2/profile
  // where the show now lives in the Stopped Watching shelf.
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [stopShowId, setStopShowId] = useState<string | null>(null);
  const [stopSubmitting, setStopSubmitting] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

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

  // Red-dot dismissal rules (2026-04-26):
  //   1. 24h time gate, anchored to when the user first sees the dot for that show
  //      (per-show timestamp written to localStorage on first appearance, cleared
  //      when the underlying invisible activity goes to zero).
  //   2. Per-reply visit dismissal — a reply is dismissed if the user has visited
  //      the friend room (for group_id replies) or public forum (for public-thread
  //      replies) since the reply's updatedAt. ShowSection writes those visit
  //      stamps on mount; this code reads them.
  // Both gates dismiss; the show's red dot only renders if it has at least one
  // invisible reply that's NOT dismissed by visit AND the 24h window hasn't
  // expired. localStorage-only, per-device — no DB.
  //
  // Edge case knowingly accepted: 24h check uses Date.now() inside a memo whose
  // deps don't include "current time", so a tab left open past the 24h boundary
  // wouldn't see the dot disappear without another deps change. No interval —
  // realistic users mount /profile fresh frequently enough that the staleness
  // is theoretical.
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const [redSeenStamps, setRedSeenStamps] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    if (!user?.id) return map;
    const prefix = `ns_red_seen_${user.id}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) {
        const ts = parseInt(localStorage.getItem(k) ?? "0", 10);
        if (ts > 0) map[k.slice(prefix.length)] = ts;
      }
    }
    return map;
  });

  // Per-tab activity: "green" if new visible replies, "red" if invisible activity
  // remains undismissed and within the 24h window. Green takes precedence.
  // Also tracks per-show counts so the tab tooltip can pluralize.
  const { tabActivity, tabActivityCounts } = useMemo(() => {
    const r: Record<string, "green" | "red"> = {};
    const counts: Record<string, number> = {};
    if (!user?.id) return { tabActivity: r, tabActivityCounts: counts };
    const now = Date.now();
    const roomPrefix = `ns_room_visited_${user.id}_`;
    const publicPrefix = `ns_show_public_visited_${user.id}_`;

    // Green: any visible reply newer than the last profile open
    for (const { reply, thread: t } of repliesToUser) {
      if (canView({ season: reply.season, episode: reply.episode }, progress[t.showId])
          && reply.updatedAt > openedAtSeenAt) {
        r[t.showId] = "green";
        counts[t.showId] = (counts[t.showId] ?? 0) + 1;
      }
    }

    // Green: any incoming sticky-channel ping fires green for that show.
    // Same wayfinding as new-replies per spec ("same way they fire for
    // new entries"). Pings outrank the red branch — having content to
    // engage with beats having content blocked above your progress.
    for (const sid of Object.keys(pingCountsByShow)) {
      const n = pingCountsByShow[sid] ?? 0;
      if (n <= 0) continue;
      r[sid] = "green";
      counts[sid] = (counts[sid] ?? 0) + n;
    }

    // Red: invisible reply not dismissed by visit, show stamp <24h old
    for (const item of repliesToUser) {
      const { reply, thread: t, groupId } = item;
      if (r[t.showId] === "green") continue;
      if (canView({ season: reply.season, episode: reply.episode }, progress[t.showId])) continue;
      let visitTs = 0;
      if (groupId) {
        visitTs = parseInt(localStorage.getItem(roomPrefix + groupId) ?? "0", 10) || 0;
      } else if (t.isPublic) {
        visitTs = parseInt(localStorage.getItem(publicPrefix + t.showId) ?? "0", 10) || 0;
      } else {
        continue;
      }
      if (visitTs >= reply.updatedAt) continue;
      const stamp = redSeenStamps[t.showId];
      if (!stamp) continue; // effect below will write it; next render renders the dot
      if (now - stamp >= TWENTY_FOUR_HOURS) continue;
      if (r[t.showId] !== "red") counts[t.showId] = 0; // reset count on first red hit
      r[t.showId] = "red";
      counts[t.showId] = (counts[t.showId] ?? 0) + 1;
    }
    return { tabActivity: r, tabActivityCounts: counts };
  }, [repliesToUser, pingCountsByShow, progress, openedAtSeenAt, user?.id, redSeenStamps, TWENTY_FOUR_HOURS]);

  // Manage the per-show red-seen stamp lifecycle: write on first appearance of
  // active invisible activity, clear when activity goes to zero. Effect (not
  // memo) so the localStorage writes don't run during render.
  useEffect(() => {
    if (!user?.id) return;
    const prefix = `ns_red_seen_${user.id}_`;
    const roomPrefix = `ns_room_visited_${user.id}_`;
    const publicPrefix = `ns_show_public_visited_${user.id}_`;

    const showsWithActive = new Set<string>();
    for (const item of repliesToUser) {
      const { reply, thread: t, groupId } = item;
      if (canView({ season: reply.season, episode: reply.episode }, progress[t.showId])) continue;
      let visitTs = 0;
      if (groupId) {
        visitTs = parseInt(localStorage.getItem(roomPrefix + groupId) ?? "0", 10) || 0;
      } else if (t.isPublic) {
        visitTs = parseInt(localStorage.getItem(publicPrefix + t.showId) ?? "0", 10) || 0;
      } else {
        continue;
      }
      if (visitTs >= reply.updatedAt) continue;
      showsWithActive.add(t.showId);
    }

    setRedSeenStamps(prev => {
      const next = { ...prev };
      let changed = false;
      const now = Date.now();
      for (const sid of showsWithActive) {
        if (!next[sid]) {
          localStorage.setItem(prefix + sid, String(now));
          next[sid] = now;
          changed = true;
        }
      }
      for (const sid of Object.keys(next)) {
        if (!showsWithActive.has(sid)) {
          localStorage.removeItem(prefix + sid);
          delete next[sid];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [repliesToUser, progress, user?.id]);

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
              <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginTop: 0, marginBottom: 12, minHeight: 28 }}>
                <div className="title profile-journal-heading" style={{ fontSize: 22 }}>this is your journal</div>
                {/* Restored from v2: companion link to the v2 self profile
                    page (/v2/profile). Lives next to "this is your journal"
                    so the user can hop between their two homes. */}
                {profile?.username && (
                  <a
                    href="/v2/profile"
                    onClick={(e) => { e.preventDefault(); navigate("/v2/profile"); }}
                    style={{
                      fontFamily: "Lora, Georgia, serif",
                      fontStyle: "italic",
                      fontSize: 16,
                      color: "var(--dos-gray)",
                      textDecoration: "none",
                      borderBottom: "1px dotted var(--dos-gray)",
                      paddingBottom: 1,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <ArrowRight size={14} /> go to your public profile
                  </a>
                )}
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
                          // Active tab bg tracks tabBg so the show tab and
                          // the diary surface below it read as one continuous
                          // panel per filter. border-bottom-color also tracks
                          // tabBg — the CSS sets it to var(--dos-bg) for the
                          // seamless connection, and the inline override
                          // keeps that connection on light-blue/yellow
                          // surfaces too. Inactive tabs use the existing
                          // dark semi-transparent fill from CSS, which
                          // reads on all 3 surfaces without modification.
                          style={active ? { background: tabBg, borderBottomColor: tabBg } : undefined}
                          title={(() => {
                            if (activity !== "red" && activity !== "green") return undefined;
                            const count = tabActivityCounts[sid] ?? 1;
                            const plural = count > 1;
                            if (activity === "green") {
                              return plural
                                ? "You have responses waiting for you."
                                : "Someone wrote you a response.";
                            }
                            // red
                            return plural
                              ? "You have responses waiting for you (but you can't read them just yet)."
                              : "Someone wrote you a response (but you can't read it just yet).";
                          })()}
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
                <div className="card" style={{ height: 700, display: "flex", flexDirection: "column", padding: 0, position: "relative", zIndex: 1, background: tabBg }}>
                  {/* Action bar — lives ABOVE the scroll container so entries never bleed through */}
                  {activeTab && (
                    <div className="profileActionBar" style={{ background: tabBg }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        {/* v3: write button navigates to /v2/compose/:showId
                           instead of opening the in-page modal. Destination
                           selection moves to the compose page's chooser.
                           onMouseEnter pre-fetches the compose bootstrap
                           data so the destination page renders instantly
                           (cache hit) on click — see lib/composeDataCache.
                           Touch devices that don't fire mouseenter just get
                           the regular fetch path; no functional difference. */}
                        <button
                          className="btn post h40"
                          onMouseEnter={() => {
                            if (user?.id && activeTab) prefetchComposeData(user.id, activeTab);
                            // Warm the lazy v2 chunk so the navigate-to-
                            // /v2/compose route doesn't pay the chunk
                            // download cost on click. Same dynamic import
                            // path App.tsx uses for lazy(); both resolve
                            // to the same Vite chunk.
                            import("./v2/V2App");
                          }}
                          onFocus={() => {
                            if (user?.id && activeTab) prefetchComposeData(user.id, activeTab);
                            import("./v2/V2App");
                          }}
                          onClick={() => navigate(`/v2/compose/${activeTab}`)}
                          style={{ lineHeight: 1.2, display: "inline-flex", alignItems: "center", gap: 5, background: tabBg }}
                        >
                          <SquarePen size={15} /> write
                        </button>

                        {/* Friend-room affordance — conditional on room count.
                           Single: direct link. Multi: dropdown (chevron). */}
                        {tabGroups.length === 1 && (
                          <button
                            className="btn h40"
                            onClick={() => goToShowRoom(activeTab, tabGroups[0].id)}
                            style={{
                              lineHeight: 1.2,
                              display: "inline-flex", alignItems: "center", gap: 5,
                              background: "transparent",
                              border: "2px solid #fff",
                              color: "#fff",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <ArrowRight size={15} color="#fff" style={{ flexShrink: 0 }} />
                            <span>go to friend room</span>
                            <Users size={15} color="#fff" style={{ flexShrink: 0 }} />
                          </button>
                        )}
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
                      <div style={{ display: "flex", alignItems: "center", gap: 24, flexShrink: 0 }}>
                        {/* Journal mode filter — radio buttons styled like
                           the SearchShows onboarding "First time / Rewatching"
                           radios (white circle, canon-green dot when active),
                           with the label set BENEATH the button so the unit
                           reads as a compact icon-with-caption. Per-show
                           state (preserved across tab switches within
                           ProfilePage, reset on navigation away or refresh).
                           Order: friends / private / public. Default =
                           friends per desktop refocus (chunk 2). All three
                           carry tooltips. Sized to roughly match the prior
                           segmented-pill footprint so the surrounding nav
                           controls don't shift. */}
                        <div style={{ display: "flex", gap: 12, flexShrink: 0, marginTop: 16 }}>
                          {([
                            { val: "friends", label: "friends", tooltip: "What you've written for friends." },
                            { val: "private", label: "private", tooltip: "Your private thoughts." },
                            { val: "public",  label: "public",  tooltip: "What the public sees." },
                          ] as const).map(({ val, label, tooltip }) => {
                            const active = activeFilter === val;
                            const cell = (
                              <button
                                onClick={() => setFilterByShow(prev => ({ ...prev, [activeTab]: val }))}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  gap: 3,
                                  fontFamily: "inherit",
                                  lineHeight: 1,
                                }}
                              >
                                <div style={{
                                  width: 14, height: 14, borderRadius: "50%",
                                  background: "#fff",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  flexShrink: 0,
                                }}>
                                  {active && (
                                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: tabBg }} />
                                  )}
                                </div>
                                <span style={{
                                  fontSize: 10,
                                  lineHeight: 1.2,
                                  fontWeight: active ? 700 : 500,
                                  color: "#fff",
                                  whiteSpace: "nowrap",
                                }}>{label}</span>
                              </button>
                            );
                            return (
                              <Tooltip
                                key={val}
                                text={tooltip}
                                direction="below"
                                tooltipStyle={{ width: "auto", whiteSpace: "nowrap", padding: "6px 10px" }}
                              >
                                {cell}
                              </Tooltip>
                            );
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
                            pillBg={tabBg}
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
                          {/* Standardized card-title format across all
                             three card types — order is:
                               [title text] [icon] [name as link] [progress tag]
                             where:
                               - icon  = Lock (private) / Globe (public) / Users (friend room)
                               - name  = friend-room name for friend-room cards,
                                         show name for public + private cards
                               - link  = goToShowRoom(showId, groupId?) — with
                                         groupId for friend-room cards (lands in
                                         the room), without for public/private
                                         (lands on the show's public forum)
                             stopPropagation on the link click preserves the
                             parent card-click → open-thread behavior. */}
                          {t.titleBase}
                          {/* Meta unit — icon, name link, and episode tag
                             are wrapped in one inline-flex container so
                             they always wrap to the next line as a single
                             unit if the title's line can't fit them.
                             whiteSpace: nowrap belt-and-suspenders prevents
                             any internal break between the three children.
                             Without this, the tag could orphan to its own
                             line while the icon + name stayed beside the
                             title. */}
                          <span style={{
                            marginLeft: 8,
                            display: "inline-flex", alignItems: "center", gap: 6,
                            verticalAlign: "middle",
                            whiteSpace: "nowrap",
                            opacity: 0.7,
                            fontWeight: 400,
                          }}>
                            {!t.isPublic && !groupId && <LockKeyhole size={14} color="var(--icon-color)" />}
                            {isPub && <Globe size={14} color="var(--icon-color)" />}
                            {isGroup && <Users size={14} color="var(--icon-color)" />}
                            <a
                              onClick={(e) => {
                                e.stopPropagation();
                                goToShowRoom(t.showId, groupId);
                              }}
                              style={{ color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 13 }}
                            >
                              {isGroup ? (groupName ?? showName(t.showId)) : showName(t.showId)}
                            </a>
                            {t.showId !== "simshow" && (
                              <span style={{ fontSize: 14 }}>
                                <EpisodeTag season={t.season} episode={t.episode} isRewatch={t.isRewatch} rewatchS={t.rewatchS} rewatchE={t.rewatchE} />
                              </span>
                            )}
                          </span>
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
                        {expandedIds.has(t.id) ? linkifyText(t.body) : t.preview}
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
                  {tabRepliesToMe.map(({ reply: r, thread: t, groupId, groupName }) => {
                    const showExpand = r.body.length > 140 || r.body.includes("\n");
                    const isExpanded = expandedIds.has(r.id);
                    return (
                    <div key={r.id} className="card reply-card" style={{ margin: "10px 0", cursor: "pointer", position: "relative", color: "var(--dos-bg)", ["--dos-accent" as any]: "var(--dos-bg)", ["--dos-cyan" as any]: "var(--dos-bg)", ["--dos-gray" as any]: "rgba(222,168,56,0.65)" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id, groupId)}>
                      {newVisibleReplyIds[r.id] && (
                        <div style={{ position: "absolute", left: -10, top: -2, width: 20, height: 20, borderRadius: "50%", background: "var(--green)", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", zIndex: 2, pointerEvents: "none" }} />
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="muted" style={{ fontSize: 14 }}>
                            On <b>{t.titleBase}</b>
                          </div>
                          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                            <span style={{ color: "var(--dos-cyan)" }}>
                              <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                            </span>{" "}
                            • {groupName
                                ? <span style={{ fontStyle: "italic" }}>in {groupName}</span>
                                : <span style={{ fontStyle: "italic" }}>publicly</span>}{" "}
                            • <span className="username">@{r.author}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {showExpand && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#7abd8e", color: "#fff", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }}>
                              {isExpanded ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>{timeAgo(r.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 15, whiteSpace: isExpanded ? "pre-wrap" : undefined }}
                        className={isExpanded ? undefined : "clamp3"}>
                        {linkifyText(r.body)}
                      </div>
                    </div>
                  );})}
                </div>
              </section>

              {/* your responses */}
              <section style={{ marginTop: 24 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your responses</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabMyReplies.length === 0 && <div className="muted">No responses yet.</div>}
                  {tabMyReplies.map(({ reply: r, thread: t }) => {
                    const showExpand = r.body.length > 140 || r.body.includes("\n");
                    const isExpanded = expandedIds.has(r.id);
                    return (
                    <div key={r.id} className="card reply-card" style={{ margin: "10px 0", cursor: "pointer", color: "var(--dos-bg)", ["--dos-accent" as any]: "var(--dos-bg)", ["--dos-cyan" as any]: "var(--dos-bg)", ["--dos-gray" as any]: "rgba(222,168,56,0.65)" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="muted" style={{ fontSize: 14 }}>
                            On <b>{t.titleBase}</b>
                          </div>
                          {t.showId !== "simshow" && (
                            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                              <span style={{ color: "var(--dos-cyan)" }}>
                                <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                              </span>
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {showExpand && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#7abd8e", color: "#fff", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }}>
                              {isExpanded ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>{timeAgo(r.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 15, whiteSpace: isExpanded ? "pre-wrap" : undefined }}
                        className={isExpanded ? undefined : "clamp3"}>
                        {linkifyText(r.body)}
                      </div>
                    </div>
                  );})}
                </div>
              </section>

              {/* Starred posts */}
              <section style={{ marginTop: 24 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your starred entries</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabLikedThreads.length === 0 && <div className="muted">No starred entries yet.</div>}
                  {tabLikedThreads.map(t => {
                    const showExpand = t.body !== t.preview;
                    const isExpanded = expandedIds.has(t.id);
                    return (
                    <div key={t.id} className="card threadCard"
                      style={{ margin: "10px 0", cursor: "pointer", position: "relative" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="title" style={{ fontSize: 18 }}>
                            {t.titleBase}
                          </div>
                          {t.showId !== "simshow" && (
                            <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.7, marginTop: 2 }}>
                              <EpisodeTag season={t.season} episode={t.episode} isRewatch={t.isRewatch} rewatchS={t.rewatchS} rewatchE={t.rewatchE} />
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {showExpand && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#7abd8e", color: "#fff", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(t.id); }}>
                              {isExpanded ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>{timeAgo(t.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: isExpanded ? "pre-wrap" : undefined }}
                        className={isExpanded ? undefined : "clamp3"}>
                        {isExpanded ? t.body : t.preview}
                      </div>
                    </div>
                  );})}
                </div>
              </section>

              {/* Starred replies */}
              <section style={{ marginTop: 24 }}>
                <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>your starred responses</div>
                <div className="card" style={{ maxHeight: 400, overflowY: "auto" }}>
                  {tabLikedReplies.length === 0 && <div className="muted">No starred responses yet.</div>}
                  {tabLikedReplies.map(({ reply: r, thread: t }) => {
                    const showExpand = r.body.length > 140 || r.body.includes("\n");
                    const isExpanded = expandedIds.has(r.id);
                    return (
                    <div key={r.id} className="card reply-card" style={{ margin: "10px 0", cursor: "pointer", color: "var(--dos-bg)", ["--dos-accent" as any]: "var(--dos-bg)", ["--dos-cyan" as any]: "var(--dos-bg)", ["--dos-gray" as any]: "rgba(222,168,56,0.65)" }}
                      onClick={() => openThreadWithFocus(t.showId, t.id, r.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="muted" style={{ fontSize: 14 }}>
                            On <b>{t.titleBase}</b>
                          </div>
                          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                            <span style={{ color: "var(--dos-cyan)" }}>
                              <EpisodeTag season={r.season} episode={r.episode} isRewatch={r.isRewatch} rewatchS={r.rewatchS} rewatchE={r.rewatchE} parens={false} />
                            </span>{" "}
                            • <span className="username">@{r.author}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          {showExpand && (
                            <div style={{ fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#7abd8e", color: "#fff", borderRadius: 999, padding: "7px 14px", whiteSpace: "nowrap", userSelect: "none" }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }}>
                              {isExpanded ? "▴ less" : "▾ expand"}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>{timeAgo(r.updatedAt)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: isExpanded ? "pre-wrap" : undefined }}
                        className={isExpanded ? undefined : "clamp3"}>
                        {linkifyText(r.body)}
                      </div>
                    </div>
                  );})}
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
            {/* Per the filter-as-destination model: the destination
               type is determined by the journal's active filter
               (friends / private / public), set on the write
               button's click handler. The dropdown only appears
               in one specific case — when the filter is "friends"
               AND the user has multiple friend rooms for this show
               — so they can pick which room. Single-room and
               non-friends filter states get a clean modal with no
               destination selector. List shows rooms only;
               private / public are not selectable here. */}
            {activeFilter === "friends" && tabGroups.length > 1 && (
              <div>
                <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  <select
                    className="badge"
                    value={composeDestination}
                    onChange={(e) => setComposeDestination(e.target.value)}
                    style={{ fontSize: 13, fontWeight: 600, paddingRight: 30, appearance: "none", WebkitAppearance: "none", cursor: "pointer", width: "100%" }}
                  >
                    {sortedRooms.map(g => (
                      <option key={g.id} value={g.id}>{g.name} friend room</option>
                    ))}
                  </select>
                  <ChevronDown size={14} color="var(--dos-fg)" style={{ position: "absolute", right: 10, pointerEvents: "none" }} />
                </div>
              </div>
            )}

            <input
              className="badge"
              placeholder="Title"
              value={postTitle}
              onChange={(e) => setPostTitle(e.target.value)}
              // Width trimmed by 60px so the title stops short of the
              // absolute-positioned close X button (at top:12 right:16,
              // 28px wide). Reserves ~60px on the right (16+28+16
              // breathing room) so the input never sits underneath the X.
              style={{ width: "calc(100% - 60px)", height: 40, fontWeight: 700 }}
            />
            {activeShow && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <OneSelectProgress
                  show={activeShow}
                  value={postProgress}
                  onConfirm={(val) => updateProgressFor?.(activeTab, val)}
                  requireConfirm={true}
                  allowZero={postProgress?.s === 0}
                  rewatchHighest={postProgress?.isRewatching && postProgress.highestS != null && postProgress.highestE != null
                    ? { s: postProgress.highestS, e: postProgress.highestE }
                    : null}
                  pillBg="transparent"
                />
                <div style={{ fontSize: 13, color: "#fff", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <ArrowLeft size={14} />
                  Are you sure your watch progress is up to date?
                </div>
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
                      : composeDestination === "private" ? <><LockKeyhole size={14} style={{verticalAlign:"middle"}} /> save for yourself</>
                      : composeDestination === "public" ? <><Globe size={14} style={{verticalAlign:"middle"}} /> publish publicly</>
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
          {/* 3. Close show / stop watching — ported from V2.
             Stronger than the prior local-hide: runs the stopWatching
             cascade (removes user from any friend rooms on this show,
             flags progress.stopped_watching=true) so the show moves to
             the Stopped Watching shelf on the profile rather than just
             being hidden in the journal view. Opens a confirmation modal
             that lists the rooms the user will leave. */}
          <Tooltip text="Closes the show in your journal and removes you from any friend rooms on this show. Searching for the show again restores your entries and progress, but not room memberships." direction="below">
            <button className="btn" style={{
              fontSize: 13, whiteSpace: "nowrap", opacity: 0.75,
              display: "flex", alignItems: "center", width: "100%",
            }}
              onClick={() => {
                const sid = tabDropdownOpen;
                setStopShowId(sid);
                setStopError(null);
                setTabDropdownOpen(null);
                setStopModalOpen(true);
              }}>
              <X size={14} color="var(--icon-color)" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: "center", margin: "0 8px" }}>Close show / stop watching</span>
              <span style={{ width: 14, flexShrink: 0 }} />
            </button>
          </Tooltip>
        </div>
      )}

      {/* Stop-watching confirmation modal — same Modal component + visual
          shape as InlineThreadView's Duplicate-to confirm (rounded card,
          no outline, Inter text). Copy is intentionally minimal: the
          dropdown's tooltip already explains what stop-watching does, so
          the modal just confirms the action. On confirm runs the
          stopWatching cascade, hides the tab locally + invalidates the
          journal cache so it stays hidden across remounts, and switches
          to another tab if the closed one was active — user stays on
          /v3/journal throughout. */}
      {stopModalOpen && stopShowId && profile && user && (() => {
        const sid = stopShowId;
        const sName = showName(sid);
        const closeIfIdle = () => { if (!stopSubmitting) { setStopModalOpen(false); setStopError(null); } };
        return (
          <Modal onClose={closeIfIdle} width="min(420px,92vw)">
            <div style={{ padding: "16px 12px 12px" }}>
              <p style={{ margin: "0 0 20px", fontSize: 17, lineHeight: 1.5, fontWeight: 600 }}>
                Stop watching <em>{sName}</em>?
              </p>
              {stopError && (
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--danger)" }}>{stopError}</p>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  className="btn"
                  style={{ fontSize: 14, background: "transparent", border: "2px solid var(--danger)", color: "var(--danger)" }}
                  onClick={closeIfIdle}
                  disabled={stopSubmitting}
                >
                  Cancel
                </button>
                <button
                  className="btn"
                  style={{ fontSize: 14, background: "#7abd8e", border: "none", color: "#fff" }}
                  disabled={stopSubmitting}
                  onClick={async () => {
                    if (!user || !profile || !sid) return;
                    setStopSubmitting(true);
                    setStopError(null);
                    try {
                      await stopWatching(user.id, profile.username, sid);
                      // Cache invalidate so next App-level progress refetch
                      // sees stopped_watching=true and the showTabOrder
                      // filter picks it up there too.
                      invalidateJournalCache(user.id);
                      // Per-show session keys: clear so a later search of
                      // this show lands in a fresh context rather than
                      // bouncing into the old room/public state.
                      sessionStorage.removeItem(`ns_browse_prog_${sid}`);
                      sessionStorage.removeItem(`ns_browse_show_${sid}`);
                      sessionStorage.removeItem(`ns_active_group_${sid}`);
                      sessionStorage.removeItem(`ns_came_from_group_${sid}`);
                      // Local hide is the immediate-feedback path: the
                      // App-level progress hasn't refetched yet (V3 reads
                      // it as a prop), so showTabOrder still includes the
                      // show until the next mount. hideTab pushes it into
                      // hiddenTabs which visibleTabOrder filters out
                      // synchronously, so the tab disappears in this
                      // render cycle.
                      hideTab(sid);
                      setStopModalOpen(false);
                      setStopSubmitting(false);
                      // If the closed tab was active, switch to the next
                      // remaining visible tab (or clear if none).
                      if (sid === activeTab) {
                        const remaining = visibleTabOrder.filter(s => s !== sid);
                        if (remaining.length) setActiveTab(remaining[0]);
                        else setActiveTab("");
                      }
                    } catch (err: any) {
                      console.warn("stopWatching failed:", err);
                      setStopError(err?.message || "Couldn't stop watching. Try again.");
                      setStopSubmitting(false);
                    }
                  }}
                >
                  {stopSubmitting ? "Stopping…" : "Stop watching"}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </section>
  );
}
