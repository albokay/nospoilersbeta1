import React, { useState, useMemo, useEffect, useRef } from "react";

const THIRTY_SIX_HOURS = 36 * 60 * 60 * 1000;

// Returns true if the thread's red dot should still be shown.
// Starts the 36h expiry clock on first call with hasDot=true; clears on hasDot=false.
function threadDotActive(threadId: string, hasDot: boolean): boolean {
  const key = `ns_tdot_${threadId}`;
  if (!hasDot) { localStorage.removeItem(key); return false; }
  const stored = localStorage.getItem(key);
  const now = Date.now();
  if (!stored) { localStorage.setItem(key, String(now)); return true; }
  const seenAt = parseInt(stored, 10);
  if (now - seenAt >= THIRTY_SIX_HOURS) { localStorage.removeItem(key); return false; }
  return true;
}
import type { Thread } from "../types";
import { seedShows, seedThreads, repliesByThread } from "../lib/mockData";
import type { Show, CitationEntry } from "../lib/db";
import { fetchThreadsForShow, insertThread, likeThread as dbLikeThread, unlikeThread as dbUnlikeThread, unlikeReply as dbUnlikeReply, refreshShowIfStale, fetchCitationsForReplies, fetchCitationsForThread, fetchPrompts, logThreadPrompt } from "../lib/db";
import type { PromptRow } from "../lib/db";
import { supabase } from "../lib/supabaseClient";
import type { ReplyMeta } from "../lib/db";
import { useAuth } from "../lib/auth";
import { canView, timeAgo } from "../lib/utils";
import Modal from "./Modal";
import LikeBadge from "./LikeBadge";
import Tooltip from "./Tooltip";
import ModeToggle from "./ModeToggle";
import OneSelectProgress from "./OneSelectProgress";
import InlineThreadView from "./InlineThreadView";
import Username from "./Username";
import type { PendingReference } from "./ResponseComposer";
import PromptCard from "./PromptCard";
import type { PromptEntry } from "../lib/promptData";
import { getFragment, getPromptSuggestion } from "../lib/prompts";

const GLOBAL_HEADER_H = 56;
const ROW_PAD_Y = 8;

export default function ShowSection({
  shows: showsProp, onShowUpdated, username, showId, progress, updateProgressFor, newHighlights, setNewHighlights,
  visitedThreads, setVisitedThreads, activeThreadId, setActiveThreadId, onHomepage,
  likesThreads, setLikesThreads, likedByUserThreads, setLikedByUserThreads,
  likesReplies, setLikesReplies, likedByUserReplies, setLikedByUserReplies,
  focusReplyId, onAuthRequired, onClickProfile, navLeft, navRight,
  showStaleNudge, onDismissStaleNudge,
  clearRewatchFor, onOpenFeedback,
}: any) {
  const { user, profile } = useAuth();
  const allShows: Show[] = showsProp?.length ? showsProp : seedShows as Show[];
  const show = allShows.find((s) => s.id === showId) || { id: showId, name: showId, seasons: [10] };

  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 768);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const [sortBy, setSortBy] = useState<"relevance" | "post" | "episode" | "hot">("relevance");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<"standard" | "risky">("standard");
  const [riskyRevealedIds, setRiskyRevealedIds] = useState<Set<string>>(new Set());
  const [freshReplyThreadIds, setFreshReplyThreadIds] = useState<Record<string, true>>({});
  const [freshReplyIds, setFreshReplyIds] = useState<Record<string, true>>({});

  // Clear risky reveals only when the thread changes, not on mode toggle
  useEffect(() => { setRiskyRevealedIds(new Set()); }, [activeThreadId]);

  // When toggling FROM standard TO risky: scroll to + flash first redacted stub
  const prevModeRef = useRef(mode);
  useEffect(() => {
    const wasStandard = prevModeRef.current === "standard";
    prevModeRef.current = mode;
    if (!wasStandard || mode !== "risky") return;
    // Give RepliesList one frame to render the stubs
    setTimeout(() => {
      const stubs = Array.from(document.querySelectorAll<HTMLElement>(".card.redacted"));
      if (!stubs.length) return;
      stubs[0].scrollIntoView({ behavior: "smooth", block: "center" });
      // Flash ALL stubs after scroll settles
      setTimeout(() => {
        stubs.forEach(el => {
          const s = getComputedStyle(el);
          el.style.position = s.position === "static" ? "relative" : s.position;
          const cover = document.createElement("div");
          cover.className = "flash-cover";
          el.appendChild(cover);
          setTimeout(() => cover.remove(), 1300);
        });
      }, 650);
    }, 30);
  }, [mode]);

  // One-time popup for the Breaking Bad room (seeded with AI content)
  const [showBBPopup, setShowBBPopup] = useState(() => showId === "bb" && !localStorage.getItem("ns_bb_popup_seen"));
  const dismissBBPopup = () => {
    localStorage.setItem("ns_bb_popup_seen", "1");
    setShowBBPopup(false);
  };

  const [showProgressCelebration, setShowProgressCelebration] = useState(false);
  const [showAutoFlipMsg, setShowAutoFlipMsg] = useState(false);
  const [reWatchOnly, setReWatchOnly] = useState(false);

  // Dismiss both banners on any click anywhere.
  // Delay registering the listener so the click that triggered the banner
  // (e.g. "Confirm" in the portal modal) doesn't immediately dismiss it.
  useEffect(() => {
    if (!showStaleNudge && !showProgressCelebration) return;
    const handler = () => {
      onDismissStaleNudge?.();
      setShowProgressCelebration(false);
    };
    const timer = setTimeout(() => {
      document.addEventListener("click", handler, { once: true });
    }, 150);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handler);
    };
  }, [showStaleNudge, showProgressCelebration]);

  const [helpOpen, setHelpOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  // Show private/public tooltips only on the very first compose session ever
  const [showComposeTooltips, setShowComposeTooltips] = useState(() => !localStorage.getItem("ns_compose_seen"));
  const openCompose = () => {
    localStorage.setItem("ns_compose_seen", "1");
    setComposeOpen(true);
  };
  const closeCompose = () => {
    setShowComposeTooltips(false);
    setComposeOpen(false);
  };
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const topRef = bannerRef;

  // ── Prompt system state ───────────────────────────────────
  const [promptEntries, setPromptEntries] = useState<PromptEntry[]>([]);
  const [activePrompt, setActivePrompt] = useState<PromptEntry | null>(null);
  const [shownPromptIds, setShownPromptIds] = useState<number[]>([]);
  const [insertedPromptIds, setInsertedPromptIds] = useState<number[]>([]);
  const [composePlaceholder, setComposePlaceholder] = useState<string>(
    "Food for thought: did that last episode remind you of something from earlier in the show...or even from your own life?"
  );
  const postBodyRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Reference system state ────────────────────────────────
  const [pendingReference, setPendingReference] = useState<PendingReference | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [citations, setCitations] = useState<Map<string, CitationEntry[]>>(new Map());
  const [threadCitations, setThreadCitations] = useState<CitationEntry[]>([]);

  const onScrollToComposer = () => {
    const el = composerRef.current ?? document.getElementById("response-composer");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => {
        const ta = el.querySelector("textarea");
        if (ta) (ta as HTMLTextAreaElement).focus();
      }, 350);
    }
  };

  // Fetch thread-level citations when thread opens
  const fetchCitations = async (threadId: string) => {
    try {
      const threadCits = await fetchCitationsForThread(threadId);
      setThreadCitations(threadCits);
      // Reply citations are fetched after replies load — see handleRepliesLoaded
    } catch (e) {
      console.warn("Failed to fetch thread citations:", e);
    }
  };

  const handleRepliesLoaded = async (replyIds: string[]) => {
    if (!replyIds.length) return;
    try {
      const cits = await fetchCitationsForReplies(replyIds);
      setCitations(cits);
      // Also refresh thread-level citations so sup links on the original entry stay current
      if (activeThreadId) {
        const threadCits = await fetchCitationsForThread(activeThreadId);
        setThreadCitations(threadCits);
      }
    } catch (e) {
      console.warn("Failed to fetch reply citations:", e);
    }
  };

  // ── Prompt fetch (once per session) ──────────────────────
  useEffect(() => {
    fetchPrompts()
      .then((rows: PromptRow[]) => {
        const entries: PromptEntry[] = rows.map((r) => ({
          id: r.id,
          text: r.text,
          displayType: r.display_type,
          tvmazeTypes: r.tvmaze_types,
          genres: r.genres,
          progressTags: r.progress_tags,
          themes: r.themes,
        }));
        setPromptEntries(entries);
      })
      .catch(() => {
        // Graceful degradation: prompts just won't appear
      });
  }, []);

  // Update placeholder when compose opens or prompts load
  useEffect(() => {
    if (composeOpen && promptEntries.length > 0) {
      const currentShow = allShows.find(s => s.id === showId) || { id: showId, name: showId, seasons: [10] };
      setComposePlaceholder(getFragment(currentShow as Show, promptEntries));
      // Reset prompt state for fresh compose session
      setActivePrompt(null);
      setShownPromptIds([]);
      setInsertedPromptIds([]);
    }
  }, [composeOpen, promptEntries.length]);

  // ── DB state ──────────────────────────────────────────────
  const [dbThreads, setDbThreads] = useState<Thread[]>([]);
  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [replyMeta, setReplyMeta] = useState<Record<string, ReplyMeta[]>>({});
  const [hasExternalReplies, setHasExternalReplies] = useState<Record<string, boolean>>({});
  const [threadsLoading, setThreadsLoading] = useState(false);

  // ── New-reply tracking (persisted to localStorage) ────────
  // lastOpenedAt: updated every time user opens a thread → clears the green (visible-new) bubble
  // hiddenBaseAt:  set ONCE when the thread is first encountered → never updated on open,
  //               so hidden replies stay flagged until progress advances and makes them visible
  const [lastOpenedAt, setLastOpenedAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_last_opened") || "{}"); } catch { return {}; }
  });
  const [hiddenBaseAt, setHiddenBaseAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("ns_hidden_base") || "{}"); } catch { return {}; }
  });

  const markThreadVisited = (tid: string) => {
    setLastOpenedAt(prev => {
      const next = { ...prev, [tid]: Date.now() };
      localStorage.setItem("ns_last_opened", JSON.stringify(next));
      return next;
    });
  };

  const getNewCounts = (threadId: string) => {
    const meta = replyMeta[threadId] ?? [];
    const prog = progress[showId];
    const openedAt = lastOpenedAt[threadId] ?? Date.now();
    const baseAt = hiddenBaseAt[threadId] ?? Date.now();
    let visibleNew = 0, hiddenNew = 0, totalVisible = 0;
    for (const r of meta) {
      const visible = canView({ season: r.season, episode: r.episode }, prog);
      if (visible) totalVisible++;
      if (r.authorId === user?.id) continue; // own replies don't trigger indicators
      if (visible && r.createdAt > openedAt) visibleNew++;
      if (!visible && r.createdAt > baseAt && !riskyRevealedIds.has(r.id)) hiddenNew++;
    }
    return { visibleNew, hiddenNew, totalVisible };
  };

  // Background staleness refresh for ongoing shows
  useEffect(() => {
    const currentShow = allShows.find(s => s.id === showId);
    if (!currentShow) return;
    refreshShowIfStale(currentShow).then(updated => {
      if (updated) onShowUpdated?.(updated);
    }).catch(() => {});
  }, [showId]);

  useEffect(() => {
    let cancelled = false;
    setThreadsLoading(true);
    setDbThreads([]);
    fetchThreadsForShow(showId).then(async ({ threads, replyCounts: rc, replyMeta: rm, hasExternalReplies: her }) => {
      if (cancelled) return;
      setDbThreads(threads);
      // Merge seed reply counts/meta so reply badges show on seed threads
      const seedRc: Record<string, number> = {};
      const seedRm: Record<string, any[]> = {};
      for (const [tid, replies] of Object.entries(repliesByThread)) {
        const isSeedForShow = seedThreads.some(t => t.id === tid && t.showId === showId);
        if (isSeedForShow) {
          seedRc[tid] = replies.length;
          seedRm[tid] = replies.map((r: any) => ({ id: r.id, season: r.season, episode: r.episode, createdAt: r.updatedAt ?? Date.now(), authorId: r.author }));
        }
      }
      setReplyCounts({ ...seedRc, ...rc });
      setReplyMeta({ ...seedRm, ...rm });
      setHasExternalReplies(her);
      // Initialize both timestamps for threads encountered for the first time
      const now = Date.now();
      setLastOpenedAt(prev => {
        const next = { ...prev };
        let changed = false;
        for (const tid of Object.keys(rm)) {
          if (!(tid in next)) { next[tid] = now; changed = true; }
        }
        if (changed) localStorage.setItem("ns_last_opened", JSON.stringify(next));
        return changed ? next : prev;
      });
      setHiddenBaseAt(prev => {
        const next = { ...prev };
        let changed = false;
        for (const tid of Object.keys(rm)) {
          if (!(tid in next)) { next[tid] = now; changed = true; }
        }
        if (changed) localStorage.setItem("ns_hidden_base", JSON.stringify(next));
        return changed ? next : prev;
      });
      setLikesThreads((m: any) => {
        const next = { ...m };
        for (const t of threads) if (!(t.id in next)) next[t.id] = t.likes;
        return next;
      });
      setThreadsLoading(false);
    }).catch(() => setThreadsLoading(false));
    return () => { cancelled = true; };
  }, [showId, user?.id]);

  // ── Live reply updates via Supabase real-time ─────────────
  useEffect(() => {
    const channel = supabase
      .channel(`show-replies-rt-${showId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "replies", filter: `show_id=eq.${showId}` }, (payload) => {
        const r = payload.new as any;
        if (!r) return;
        const meta = { id: r.id, season: r.season, episode: r.episode, createdAt: new Date(r.created_at).getTime(), authorId: r.author_id };
        setReplyMeta(prev => ({ ...prev, [r.thread_id]: [...(prev[r.thread_id] ?? []), meta] }));
        setReplyCounts(prev => ({ ...prev, [r.thread_id]: (prev[r.thread_id] ?? 0) + 1 }));
        setHasExternalReplies(prev => ({ ...prev, [r.thread_id]: true }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [showId]);

  // ── Scoring / filtering ───────────────────────────────────
  const scoreThread = (t: Thread, q: string) => {
    const text = `${t.titleBase} ${t.preview} ${t.body} ${t.author}`.toLowerCase();
    const phrase = q.trim().toLowerCase();
    const tokens = Array.from(new Set(phrase.split(/\s+/).filter(Boolean)));
    if (tokens.length === 0) return 0;
    let score = 0;
    if (text.includes(phrase)) score += 3;
    for (const tok of tokens) if (text.includes(tok)) score += 1;
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      if (text.includes(bigram)) score += 2;
    }
    return score;
  };

  const allThreads = useMemo(() =>
    [...dbThreads, ...seedThreads.filter(t => t.showId === showId)],
    [dbThreads, showId]
  );

  const baseVisible = useMemo(() => {
    const prog = progress[showId];
    let list = allThreads.filter(t => canView(t, prog));

    if (searchQuery.trim()) {
      const withScores = list
        .map(t => ({ t, s: scoreThread(t, searchQuery) }))
        .filter(x => x.s > 0)
        .sort((a, b) => (b.s - a.s) || (b.t.updatedAt - a.t.updatedAt));
      list = withScores.map(x => x.t);
    }

    if (sortBy === "relevance") {
      const newlyVisible = newHighlights[showId] ?? {};
      list = [...list].sort((a, b) => {
        // P1: newly visible first
        const aNv = newlyVisible[a.id] ? 1 : 0;
        const bNv = newlyVisible[b.id] ? 1 : 0;
        if (bNv !== aNv) return bNv - aNv;
        // P2: episode order (most recent episode first)
        if (a.season !== b.season) return b.season - a.season;
        if (a.episode !== b.episode) return b.episode - a.episode;
        // P3: post date (newest first)
        return b.updatedAt - a.updatedAt;
      });
    } else if (sortBy === "post") {
      list = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    } else if (sortBy === "episode") {
      list = [...list].sort((a, b) => {
        if (a.season !== b.season) return b.season - a.season;
        if (a.episode !== b.episode) return b.episode - a.episode;
        return b.updatedAt - a.updatedAt;
      });
    } else if (sortBy === "hot") {
      list = [...list].sort((a, b) => {
        const la = likesThreads[a.id] ?? a.likes;
        const lb = likesThreads[b.id] ?? b.likes;
        if (lb !== la) return lb - la;
        return b.updatedAt - a.updatedAt;
      });
    }
    if (reWatchOnly) list = list.filter(t => t.isRewatch);
    return list;
  }, [allThreads, progress, searchQuery, sortBy, likesThreads, newHighlights, showId, reWatchOnly]);

  // ── Green-tab: compute newly visible threads ──
  const prevProgRef = useRef<{ s: number; e: number } | undefined>(undefined);
  useEffect(() => {
    const cur = progress[showId];
    const prev = prevProgRef.current;
    if (prev && cur && allThreads.length > 0 && (prev.s !== cur.s || prev.e !== cur.e)) {
      const newly: Record<string, true> = {};
      for (const t of allThreads) {
        if (!canView(t, prev) && canView(t, cur)) newly[t.id] = true;
      }
      if (Object.keys(newly).length > 0) {
        setNewHighlights((nh: any) => ({ ...nh, [showId]: { ...(nh[showId] || {}), ...newly } }));
      }
      // Track replies newly revealed by progress advancement
      const newReplyThreads: Record<string, true> = {};
      const newReplyIds: Record<string, true> = {};
      for (const [tid, meta] of Object.entries(replyMeta)) {
        for (const r of meta) {
          const was = canView({ season: r.season, episode: r.episode }, prev);
          const now = canView({ season: r.season, episode: r.episode }, cur);
          if (!was && now) { newReplyThreads[tid] = true; newReplyIds[r.id] = true; }
        }
      }
      if (Object.keys(newReplyThreads).length > 0) {
        setFreshReplyThreadIds(prev => ({ ...prev, ...newReplyThreads }));
        setFreshReplyIds(prev => ({ ...prev, ...newReplyIds }));
      }
    }
    prevProgRef.current = cur;
  }, [progress[showId]?.s, progress[showId]?.e, allThreads]);

  const displayed = baseVisible;
  const thread = activeThreadId ? allThreads.find(t => t.id === activeThreadId && t.showId === showId) : null;

  // Shared progress-confirm handler: updates progress, then navigates back to
  // the forum if the currently-open thread is no longer visible at the new progress.
  const handleProgressConfirm = (val: { s: number; e: number }) => {
    const prog = progress[showId];

    // Auto-flip: if re-watcher reaches or passes their highest prior progress, revert to regular mode
    if (prog?.isRewatching && prog.highestS != null && prog.highestE != null) {
      const reachedHighest =
        val.s > prog.highestS ||
        (val.s === prog.highestS && val.e >= prog.highestE);
      if (reachedHighest) {
        updateProgressFor(showId, val);
        clearRewatchFor?.(showId);
        if (thread && !canView({ season: thread.season, episode: thread.episode }, val)) {
          setActiveThreadId(null);
        }
        setShowAutoFlipMsg(true);
        if (showStaleNudge) onDismissStaleNudge?.();
        return;
      }
    }

    updateProgressFor(showId, val);
    if (thread && !canView({ season: thread.season, episode: thread.episode }, val)) {
      setActiveThreadId(null);
    }
    setShowProgressCelebration(true);
    if (showStaleNudge) onDismissStaleNudge?.();
  };

  useEffect(() => {
    if (thread?.id) {
      const tid = thread.id;
      setVisitedThreads((v: any) => ({ ...v, [tid]: true }));
      setNewHighlights((nh: any) => { const next = { ...(nh[showId] || {}) }; delete next[tid]; return { ...nh, [showId]: next }; });
      setFreshReplyThreadIds(prev => { const next = { ...prev }; delete next[tid]; return next; });
      // Fetch thread-level citations
      fetchCitations(tid);
      // Clear pending reference when switching threads
      setPendingReference(null);
      setCitations(new Map());
      setThreadCitations([]);
    }
  }, [thread?.id, showId, setVisitedThreads, setNewHighlights]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { setSearchQuery(searchInput); }
  };
  const clearSearch = () => { setSearchInput(""); setSearchQuery(""); };

  const scrollToShowTop = () => {
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const likeThread = (tid: string) => {
    if (!user) { onAuthRequired(); return; }
    if (likedByUserThreads[tid]) {
      // Unlike
      setLikesThreads((m: any) => ({ ...m, [tid]: Math.max(0, (m[tid] ?? 1) - 1) }));
      setLikedByUserThreads((u: any) => { const n = { ...u }; delete n[tid]; return n; });
      dbUnlikeThread(user.id, tid).catch(() => {
        setLikesThreads((m: any) => ({ ...m, [tid]: (m[tid] ?? 0) + 1 }));
        setLikedByUserThreads((u: any) => ({ ...u, [tid]: true }));
      });
    } else {
      // Like
      setLikesThreads((m: any) => ({ ...m, [tid]: (m[tid] ?? 0) + 1 }));
      setLikedByUserThreads((u: any) => ({ ...u, [tid]: true }));
      dbLikeThread(user.id, tid).catch(() => {
        setLikesThreads((m: any) => ({ ...m, [tid]: Math.max(0, (m[tid] ?? 1) - 1) }));
        setLikedByUserThreads((u: any) => { const n = { ...u }; delete n[tid]; return n; });
      });
    }
  };
  const likeReply = (rid: string, baseCount?: number) => {
    setLikesReplies((m: any) => ({ ...m, [rid]: (baseCount ?? m[rid] ?? 0) + 1 }));
    setLikedByUserReplies((u: any) => u[rid] ? u : ({ ...u, [rid]: true }));
  };
  const unlikeReply = (rid: string) => {
    setLikesReplies((m: any) => ({ ...m, [rid]: Math.max(0, (m[rid] ?? 1) - 1) }));
    setLikedByUserReplies((u: any) => { const n = { ...u }; delete n[rid]; return n; });
  };

  // ── Prompt handlers ───────────────────────────────────────
  const handlePromptBtn = () => {
    const currentShow = allShows.find(s => s.id === showId) || { id: showId, name: showId, seasons: [10] };
    const prog = progress[showId] || { s: 1, e: 1 };
    const next = getPromptSuggestion(currentShow as Show, prog, shownPromptIds, promptEntries);
    if (next) {
      setShownPromptIds(prev => [...prev, next.id]);
      setActivePrompt(next);
    }
  };

  const handlePromptShuffle = () => {
    const currentShow = allShows.find(s => s.id === showId) || { id: showId, name: showId, seasons: [10] };
    const prog = progress[showId] || { s: 1, e: 1 };
    const next = getPromptSuggestion(currentShow as Show, prog, shownPromptIds, promptEntries);
    if (next) {
      setShownPromptIds(prev => [...prev, next.id]);
      setActivePrompt(next);
    }
  };

  const handlePromptInsert = (text: string) => {
    if (!activePrompt) return;
    const token = `[PROMPT: ${text}]`;
    const ta = postBodyRef.current;
    if (ta) {
      const pos = ta.selectionStart ?? postBody.length;
      const before = postBody.slice(0, pos).trimEnd();
      const after = postBody.slice(pos).trimStart();
      const prefix = before.length ? "\n" : "";
      const suffix = "\n";
      const newBody = before + prefix + token + suffix + after;
      const newPos = before.length + prefix.length + token.length + suffix.length;
      setPostBody(newBody);
      requestAnimationFrame(() => {
        ta.selectionStart = newPos;
        ta.selectionEnd = newPos;
        ta.focus();
      });
    } else {
      setPostBody(prev => prev.trimEnd() + (prev.trim() ? "\n" : "") + token + "\n");
    }
    setInsertedPromptIds(prev => [...prev, activePrompt.id]);
    setActivePrompt(null);
  };

  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const postProgress = progress[showId] || { s: 1, e: 1 };
  // Re-watchers tag posts at their highest prior progress so first-timers can't see them
  const postTagS = postProgress.isRewatching && postProgress.highestS ? postProgress.highestS : postProgress.s;
  const postTagE = postProgress.isRewatching && postProgress.highestE ? postProgress.highestE : postProgress.e;

  const [postSubmitting, setPostSubmitting] = useState(false);

  const submitPost = async (isPrivate = false) => {
    if (!user || !profile) { onAuthRequired(); return; }
    const title = (postTitle || "").trim();
    const body = (postBody || "").trim();
    if (!title) { alert("Please add a title before posting."); return; }
    if (!body) { alert("Write something first."); return; }
    setPostSubmitting(true);
    try {
      const t = await insertThread({
        showId, season: postTagS, episode: postTagE,
        authorId: user.id, authorName: profile.username,
        title: title || "Untitled note",
        preview: body.slice(0, 240) + (body.length > 240 ? "…" : ""),
        body: body || "(blank)", isPrivate,
        isRewatch: postProgress.isRewatching ?? false,
      });
      setDbThreads(prev => [t, ...prev]);
      setReplyCounts(rc => ({ ...rc, [t.id]: 0 }));
      // Log prompt usage (best-effort)
      for (const pid of insertedPromptIds) {
        logThreadPrompt(t.id, pid).catch(() => {});
      }
      setInsertedPromptIds([]);
      // Anchor hiddenBaseAt at creation time so future hidden replies are correctly flagged
      const now = Date.now();
      setHiddenBaseAt(prev => {
        const next = { ...prev, [t.id]: now };
        localStorage.setItem("ns_hidden_base", JSON.stringify(next));
        return next;
      });
      setLastOpenedAt(prev => {
        const next = { ...prev, [t.id]: now };
        localStorage.setItem("ns_last_opened", JSON.stringify(next));
        return next;
      });
      closeCompose();
      setPostTitle(""); setPostBody("");
      setActiveThreadId(t.id);
      setTimeout(() => scrollToShowTop(), 0);
    } catch (e) {
      alert("Failed to post. Please try again.");
    } finally {
      setPostSubmitting(false);
    }
  };

  return (
    <section className="container" style={{ paddingBottom: 140 }}>
      {showBBPopup && (
        <Modal onClose={dismissBBPopup} width="min(520px,92vw)" cardClassName="explanation-card">
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              🧪 This Breaking Bad DEMO room is seeded with AI-generated entries so you can see how the forum works before real users fill it. The posts are illustrative, not real opinions.
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              Try updating your watch progress using the dropdown in the top right of the room to see how the spoiler filter works in practice. All other features are functional here too.
            </p>
            <p style={{ margin: "0 0 32px", fontSize: 15, lineHeight: 1.6, opacity: 0.65, fontStyle: "italic" }}>
              Hope you're caught up on the show…if not, get out of here! Join the real Breaking Bad room by using the "find a show" search field.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn" style={{ fontSize: 15, padding: "8px 24px" }} onClick={dismissBBPopup}>Got it</button>
            </div>
          </div>
        </Modal>
      )}
      {/* TWO-ROW STICKY BANNER */}
      <div className="stickybar bleed" style={{ top: GLOBAL_HEADER_H }} ref={bannerRef}>
        <div className="container">
          {(navLeft || navRight) && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0 4px" }}>
              <div className="hangL">{navLeft}</div>
              <div>{navRight}</div>
            </div>
          )}
          {/* Row 1 */}
          <div className="bannerRow1">
            <span
              className="bannerTitle"
              role={thread ? "button" : "heading"}
              title={thread ? "Back to room" : "Room"}
              onClick={thread ? () => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); } : undefined}
              style={{
                fontSize: 22, fontWeight: 800, letterSpacing: .5,
                color: "var(--dos-light)", cursor: thread ? "pointer" : "default", userSelect: "none",
                flex: "0 0 auto",
              }}
            >
              {showId === "bb"
                ? "the BREAKING BAD (DEMO) room"
                : `the ${String((allShows.find(s => s.id === showId)?.name) || showId).toUpperCase()} room`}
            </span>
            {!thread && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                <select className="badge" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
                  <option value="relevance">Relevance</option>
                  <option value="post">Post date</option>
                  <option value="episode">Episode order</option>
                  <option value="hot">Hot</option>
                </select>
                <button
                  className="btn"
                  onClick={() => setReWatchOnly(v => !v)}
                  style={{ fontSize: 12, padding: "4px 10px", background: reWatchOnly ? "var(--dos-user)" : "transparent", color: reWatchOnly ? "#fff" : "inherit", border: "2px solid var(--dos-border)", whiteSpace: "nowrap" }}
                  title="Show only re-watcher posts"
                >
                  😍 re-watchers
                </button>
              </div>
            )}
          </div>

          <hr className="bleed-line" />

          {/* Row 2 */}
          {thread && isMobile ? (
            /* ── Thread · mobile: two rows so nothing bleeds off-screen ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: `${ROW_PAD_Y}px 0` }}>
              {/* Row 1: back + mode toggle */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <button
                  className="btn"
                  onClick={() => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); }}
                  style={{ fontSize: 12, padding: "5px 9px", lineHeight: 1.2, whiteSpace: "nowrap" }}
                >
                  ← to forum
                </button>
                <ModeToggle
                  value={mode}
                  onToggle={() => setMode(m => (m === "risky" ? "standard" : "risky"))}
                  hiddenNewReplies={thread.author === username ? getNewCounts(thread.id).hiddenNew : 0}
                  compact={true}
                />
              </div>
              {/* Row 2: compose + progress */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <button
                  className="btn post"
                  onClick={() => user ? openCompose() : onAuthRequired()}
                  style={{ fontSize: 12, padding: "5px 9px", lineHeight: 1.2, whiteSpace: "nowrap" }}
                >
                  + make an entry
                </button>
                <OneSelectProgress
                  show={allShows.find(s => s.id === showId) || { seasons: [10] }}
                  value={progress[showId] || { s: 1, e: 1 }}
                  onConfirm={handleProgressConfirm}
                  requireConfirm={true}
                  compactLabel="progress"
                />
              </div>
            </div>
          ) : (
            /* ── Thread · desktop  OR  Forum (any width) ── */
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: `${ROW_PAD_Y}px 0` }}>
              {!thread ? (
                <button
                  className="btn post h40"
                  onClick={() => user ? openCompose() : onAuthRequired()}
                  title="Start a new post"
                  style={{ lineHeight: 1.2 }}
                >
                  + make an entry
                </button>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    className="btn h40"
                    onClick={() => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); }}
                    style={{ lineHeight: 1.2, whiteSpace: "nowrap" }}
                  >
                    ← Back to room
                  </button>
                  <button
                    className="btn post h40"
                    onClick={() => user ? openCompose() : onAuthRequired()}
                    title="Start a new post"
                    style={{ lineHeight: 1.2, whiteSpace: "nowrap" }}
                  >
                    + make an entry
                  </button>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {thread && (
                  <div style={{ transform: "translateX(-10px)" }}>
                    <ModeToggle
                      value={mode}
                      onToggle={() => setMode(m => (m === "risky" ? "standard" : "risky"))}
                      hiddenNewReplies={thread.author === username ? getNewCounts(thread.id).hiddenNew : 0}
                    />
                  </div>
                )}
                <div style={{ position: "relative" }}>
                  <OneSelectProgress
                    show={allShows.find(s => s.id === showId) || { seasons: [10] }}
                    value={progress[showId] || { s: 1, e: 1 }}
                    onConfirm={handleProgressConfirm}
                    requireConfirm={true}
                    compactLabel={undefined}
                  />
                  <Tooltip text="Did you make a mistake setting your progress? Click here." direction="below" disabled={helpOpen}>
                    <button
                      onClick={() => setHelpOpen(v => !v)}
                      style={{
                        position: "absolute", top: 0, right: 0,
                        transform: "translate(50%, -50%)",
                        width: 20, height: 20, padding: 0,
                        borderRadius: "50%", border: "none",
                        background: "var(--dos-user)", color: "#fff",
                        fontSize: 12, fontWeight: 800, lineHeight: 1,
                        cursor: "pointer", zIndex: 10,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                      }}
                    >
                      !
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stale-progress nudge — shown once per session after a 12hr gap */}
      {showStaleNudge && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "10px 16px", marginBottom: 8,
          background: "#fff", border: "none",
          borderRadius: 24, fontSize: 13, color: "var(--danger)",
        }}>
          <span>
            Have you watched more of <strong>{show.name}</strong>?{" "}
            If so, update your progress above so you don't leave any accidental spoilers!
          </span>
          <button
            className="btn"
            onClick={onDismissStaleNudge}
            style={{ flexShrink: 0, width: 28, height: 28, padding: 0, background: "transparent", border: "2px solid #c8e4b0", borderRadius: "50%", color: "#c8e4b0", fontSize: 13, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Auto-flip congratulatory message — shown when re-watcher catches up to prior progress */}
      {showAutoFlipMsg && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "10px 16px", marginBottom: 8,
          background: "#fff", border: "none",
          borderRadius: 24, fontSize: 13, color: "var(--danger)",
        }}>
          <span>
            Congratulations, you've reached your previous watch progress! From now on your activity on the site will be sorted just like someone watching episodes for the first time — because you are!
          </span>
          <button
            className="btn"
            onClick={() => setShowAutoFlipMsg(false)}
            style={{ flexShrink: 0, width: 28, height: 28, padding: 0, background: "transparent", border: "2px solid #c8e4b0", borderRadius: "50%", color: "#c8e4b0", fontSize: 13, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Progress update celebration — shown after every progress update */}
      {showProgressCelebration && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "10px 16px", marginBottom: 8,
          background: "#fff", border: "none",
          borderRadius: 24, fontSize: 13, color: "var(--danger)",
        }}>
          <span>
            Thanks for updating your progress — everyone's looking forward to your new thoughts!
          </span>
          <button
            className="btn"
            onClick={() => setShowProgressCelebration(false)}
            style={{ flexShrink: 0, width: 28, height: 28, padding: 0, background: "transparent", border: "2px solid #c8e4b0", borderRadius: "50%", color: "#c8e4b0", fontSize: 13, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ? Help panel */}
      {helpOpen && (
        <div style={{
          background: "#fff", borderRadius: 20, padding: "16px 20px",
          marginBottom: 10, display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--dos-bg)" }}>Need help?</span>
            <button
              className="btn"
              onClick={() => setHelpOpen(false)}
              style={{ width: 28, height: 28, padding: 0, background: "transparent", border: "2px solid #c8e4b0", borderRadius: "50%", color: "#c8e4b0", fontSize: 13, lineHeight: 1 }}
            >
              ✕
            </button>
          </div>
          {[
            {
              label: "I set my rewatch status incorrectly",
              prefill: `Hi — I set my rewatch status wrong for ${show.name} and need help correcting it. My username is @${progress[showId] ? "" : ""}`,
            },
            {
              label: "I accidentally set the wrong episode",
              prefill: `Hi — I accidentally set the wrong episode for ${show.name} and need help correcting it. My username is @`,
            },
          ].map(({ label, prefill }) => (
            <button
              key={label}
              onClick={() => {
                setHelpOpen(false);
                onOpenFeedback?.(prefill);
              }}
              style={{
                textAlign: "left", background: "transparent",
                border: "1.5px solid var(--dos-border)", borderRadius: 12,
                padding: "10px 14px", cursor: "pointer", fontSize: 13,
                color: "var(--dos-bg)", fontWeight: 500, lineHeight: 1.4,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.05)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {label} →
            </button>
          ))}
        </div>
      )}

      {/* CONTENT */}
      {thread ? (
        <InlineThreadView
          thread={{ ...thread, likes: likesThreads[thread.id] ?? thread.likes }}
          show={allShows.find(s => s.id === showId) || { name: showId }}
          onBack={() => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); }}
          progressForShow={progress[showId] || { s: 1, e: 1 }}
          onMountAlignTop={() => scrollToShowTop()}
          likeThread={() => likeThread(thread.id)}
          likedByUser={!!likedByUserThreads[thread.id]}
          likesCount={likesThreads[thread.id] ?? thread.likes}
          likeReply={likeReply}
          unlikeReply={unlikeReply}
          likesReplies={likesReplies}
          likedByUserReplies={likedByUserReplies}
          mode={mode}
          focusReplyId={focusReplyId}
          onAuthRequired={onAuthRequired}
          hiddenNewReplies={getNewCounts(thread.id).hiddenNew}
          onRiskyReveal={(rid: string) => setRiskyRevealedIds(prev => new Set([...prev, rid]))}
          onThreadUpdate={(updated: Thread) => setDbThreads(prev => prev.map(t => t.id === updated.id ? updated : t))}
          onThreadDelete={() => {
            const tid = activeThreadId!;
            const hadExternal = hasExternalReplies[tid] ?? false;
            if (hadExternal) {
              setDbThreads(prev => prev.map(t => t.id === tid ? { ...t, isDeleted: true } : t));
            } else {
              setDbThreads(prev => prev.filter(t => t.id !== tid));
            }
            setActiveThreadId(null);
            setTimeout(() => scrollToShowTop(), 0);
          }}
          onThreadMakePrivate={() => {
            // Mark private in state — owner still sees it with 📝, others see nothing
            setDbThreads(prev => prev.map(t => t.id === activeThreadId ? { ...t, isPrivate: true } : t));
          }}
          onThreadMakePublic={() => {
            setDbThreads(prev => prev.map(t => t.id === activeThreadId ? { ...t, isPrivate: false } : t));
          }}
          hasExternalReplies={(replyCounts[thread.id] ?? 0) > 0}
          onExternalReplyAdded={(tid: string) => setHasExternalReplies(prev => ({ ...prev, [tid]: true }))}
          onReplyDeleted={(rid: string) => {
            const tid = thread.id;
            setReplyMeta(prev => ({ ...prev, [tid]: (prev[tid] ?? []).filter(r => r.id !== rid) }));
          }}
          freshReplyIds={freshReplyIds}
          onClickProfile={onClickProfile}
          pendingReference={pendingReference}
          onSetPendingReference={setPendingReference}
          composerRef={composerRef}
          onScrollToComposer={onScrollToComposer}
          citations={citations}
          threadCitations={threadCitations}
          onRepliesLoaded={handleRepliesLoaded}
        />
      ) : (
        <div style={{ marginTop: 12 }}>
          {threadsLoading && (
            <div className="muted" style={{ fontSize: 14, padding: "24px 0" }}>Loading…</div>
          )}
          {!threadsLoading && displayed.map((t) => {
            const isNew = !!newHighlights[showId]?.[t.id];
            const isRead = !!visitedThreads[t.id];
            const isOwn = !!username && t.author === username;
            const likeCt = likesThreads[t.id] ?? t.likes;
            const { visibleNew, hiddenNew, totalVisible } = getNewCounts(t.id);
            const hasExternal = hasExternalReplies[t.id] ?? false;

            // Private: owner sees normally (with 📝 in title); others see nothing
            if (t.isPrivate && !isOwn) return null;

            // Deleted:
            //   - no external replies → completely gone for everyone
            //   - has external replies → show clickable stub so others can still see replies
            if (t.isDeleted) {
              if (!hasExternal) return null;
              return (
                <div key={t.id} style={{ position: "relative", margin: "12px 0" }}>
                  <div
                    className="card threadCard"
                    style={{ margin: 0, opacity: 0.72, cursor: "pointer", position: "relative" }}
                    onClick={() => {
                      setActiveThreadId(t.id);
                      setTimeout(() => scrollToShowTop(), 0);
                    }}
                  >
                    <div className="muted" style={{ fontSize: 14, padding: "2px 0" }}>
                      (@{t.author}) deleted their post.
                    </div>
                    <div className="replyCount">
                      <span>💬 {totalVisible}</span>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={t.id} style={{ position: "relative", margin: "12px 0" }}>
                {isOwn && threadDotActive(t.id, hiddenNew > 0) && (
                  <Tooltip
                    text="People (who are ahead of you) have written you back!"
                    direction="right"
                    align="left"
                    useAbsolute
                    style={{ position: "absolute", left: -14, top: "calc(50% - 14px)", zIndex: 1 }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "var(--danger)", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800, lineHeight: 1,
                      boxShadow: "0 2px 6px rgba(0,0,0,0.30)",
                    }}>
                      {hiddenNew}
                    </div>
                  </Tooltip>
                )}
              <div
                className="card threadCard"
                style={{
                  margin: 0,
                  opacity: (isRead && !isOwn) ? 0.5 : 1,
                  cursor: "pointer",
                  position: "relative",
                  paddingTop: 12,
                  paddingBottom: 36,
                  border: isNew ? "4px solid #4b8f6c" : isOwn ? "4px solid var(--dos-user)" : "4px solid var(--dos-border)"
                }}
                onClick={() => {
                  markThreadVisited(t.id);
                  setVisitedThreads((v: any) => ({ ...v, [t.id]: true }));
                  setNewHighlights((nh: any) => {
                    const next = { ...(nh[showId] || {}) };
                    delete next[t.id];
                    return { ...nh, [showId]: next };
                  });
                  setActiveThreadId(t.id);
                  setTimeout(() => scrollToShowTop(), 0);
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 style={{ margin: 0, fontSize: 22 }} className="title">
                    {t.isPrivate && <span style={{ marginRight: 4 }}>📝</span>}
                    {t.titleBase}
                    {t.showId !== "simshow" && (
                      <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 7, whiteSpace: "nowrap" }}>
                        {`(S${String(t.season).padStart(2, "0")} E${String(t.episode).padStart(2, "0")})`}
                      </span>
                    )}
                    {t.isEdited && (
                      <span style={{ fontStyle: "italic", fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 6 }}>(edited)</span>
                    )}
                  </h2>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <LikeBadge count={likeCt} readOnly title="open post to vote" />
                  </div>
                </div>

                <div className="muted" style={{ marginTop: 4, fontSize: 14, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  Started by <Username name={t.author} onClickProfile={onClickProfile} />
                  {t.isRewatch && (
                    <Tooltip text={`This viewer is also rewatching ${show.name}.`} direction="above">
                      <span style={{ cursor: "default" }}>😍</span>
                    </Tooltip>
                  )}
                  {" "}• {timeAgo(t.updatedAt)}
                </div>

                <div style={{ marginTop: 6 }}>
                  <div className="clamp3">{t.preview}</div>
                </div>

                <div className="replyCount">
                  <span style={(visibleNew > 0 || freshReplyThreadIds[t.id]) ? {
                    background: "#dea838", color: "#fff", borderRadius: 9999,
                    padding: "2px 7px", fontWeight: 700,
                  } : {}}>
                    💬 {totalVisible}
                  </span>
                </div>
              </div>
              </div>
            );
          })}
          {!threadsLoading && displayed.length === 0 && (
            <div className="muted" style={{ fontSize: 14 }}>No posts match your watch progress.</div>
          )}
        </div>
      )}

      {/* Compose modal */}
      {composeOpen && (
        <Modal onClose={() => closeCompose()} width="min(720px,92vw)">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <h3 className="title" style={{ margin: 0 }}>make an entry</h3>
            <button className="btn" onClick={() => closeCompose()}>✕</button>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <input
              className="badge"
              placeholder="Title"
              value={postTitle}
              onChange={(e) => setPostTitle(e.target.value)}
              style={{ width: "100%", height: 40, fontWeight: 700 }}
            />
            <div className="muted" style={{ fontSize: 13 }}>
              Your post is automatically marked to <b>S{String(postTagS).padStart(2, "0")}E{String(postTagE).padStart(2, "0")}</b> and will only show to people who've watched at least that far.
              {postProgress.isRewatching && <span> (tagged at your highest prior progress as a re-watcher)</span>}
            </div>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              {promptEntries.length > 0 ? (
                <button
                  className="prompt-btn"
                  type="button"
                  onClick={handlePromptBtn}
                  title="Get a writing prompt"
                >
                  ✦ want a prompt?
                </button>
              ) : <span />}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="btn" onClick={() => closeCompose()} disabled={postSubmitting} style={{ background: "var(--danger)", border: "none", color: "#fff", whiteSpace: "nowrap", fontSize: 13 }}>Cancel</button>
                <Tooltip
                  text="Post privately. Your entry will live in your journal alongside everything else you've written — a record of your watching life, whether or not you share it. (If you want, you can swap it to public later.)"
                  direction="above"
                  align="right"
                  useAbsolute={true}
                  width={280}
                  tooltipStyle={{ background: "#bdd4de", color: "#000", textAlign: "left", borderRadius: 10, fontSize: 13, fontWeight: 400, lineHeight: 1.5 }}
                  disabled={!showComposeTooltips}
                >
                  <button className="btn" onClick={() => submitPost(true)} disabled={postSubmitting} style={{ background: "var(--dos-bg)", border: "2px solid #fff", color: "#fff", whiteSpace: "nowrap", fontSize: 13 }}>📝 save to your journal</button>
                </Tooltip>
                <Tooltip
                  text="Post publicly. Visible to anyone in this show room who has watched at least as far as you. They won't see spoilers from ahead of your progress, and neither will you see theirs."
                  direction="above"
                  align="right"
                  useAbsolute={true}
                  width={280}
                  tooltipStyle={{ background: "#bdd4de", color: "#000", textAlign: "left", borderRadius: 10, fontSize: 13, fontWeight: 400, lineHeight: 1.5 }}
                  disabled={!showComposeTooltips}
                >
                  <button className="btn" onClick={() => submitPost(false)} disabled={postSubmitting} style={{ background: "var(--green)", border: "2px solid var(--green)", color: "#fff", whiteSpace: "nowrap", fontSize: 13 }}>{postSubmitting ? "Posting…" : "send to the room"}</button>
                </Tooltip>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
