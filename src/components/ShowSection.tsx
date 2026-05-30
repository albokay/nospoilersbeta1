import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { SquarePen, X, Globe, Users, Settings, Mail, Sparkles, LockKeyhole, AlertTriangle, Crown, FlaskConical, Heart, ChevronDown, ArrowRight, ArrowLeft, Plus, Clock, EyeOff, CirclePlus } from "lucide-react";
import LoadingDots from "./LoadingDots";

const THIRTY_SIX_HOURS = 36 * 60 * 60 * 1000;

// Banner titles: prevent the last word from wrapping alone onto line 2.
// Replaces the last space with U+00A0 so the final two words stay glued;
// browser wraps at the previous space instead, guaranteeing ≥2 words on
// the last line whenever wrapping occurs.
function preventLastWordOrphan(s: string): string {
  const lastSpace = s.lastIndexOf(" ");
  if (lastSpace === -1) return s;
  return s.slice(0, lastSpace) + "\u00A0" + s.slice(lastSpace + 1);
}

// Returns true if the thread's red dot should still be shown.
// Starts the 36h expiry clock on first call with hasDot=true; clears on hasDot=false.
function threadDotActive(threadId: string, hasDot: boolean): boolean {
  const key = `ns_tdot_${threadId}`;
  const dismissKey = `ns_tdot_dismiss_${threadId}`;
  if (!hasDot) { localStorage.removeItem(key); return false; }
  // Check if manually dismissed
  const dismissedAt = localStorage.getItem(dismissKey);
  if (dismissedAt) {
    const stored = localStorage.getItem(key);
    if (stored && parseInt(stored, 10) <= parseInt(dismissedAt, 10)) return false;
  }
  const stored = localStorage.getItem(key);
  const now = Date.now();
  if (!stored) { localStorage.setItem(key, String(now)); return true; }
  const seenAt = parseInt(stored, 10);
  if (now - seenAt >= THIRTY_SIX_HOURS) { localStorage.removeItem(key); return false; }
  return true;
}

function dismissThreadDot(threadId: string) {
  localStorage.setItem(`ns_tdot_dismiss_${threadId}`, String(Date.now()));
}

/** Red dot with count that transforms to X on hover; clicking X dismisses. */
function ThreadRedDot({ count, threadId, onDismiss }: { count: number; threadId: string; onDismiss: () => void }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      style={{
        width: 28, height: 28, borderRadius: "50%",
        background: "var(--danger)", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: hovered ? 12 : 11, fontWeight: 800, lineHeight: 1,
        boxShadow: "0 2px 6px rgba(0,0,0,0.30)",
        cursor: hovered ? "pointer" : "default",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => { e.stopPropagation(); dismissThreadDot(threadId); onDismiss(); }}
    >
      {hovered ? "\u2715" : count}
    </div>
  );
}
import type { Thread, FriendGroup, FriendGroupMember } from "../types";
import { seedShows, seedThreads, repliesByThread } from "../lib/mockData";
import type { Show, CitationEntry } from "../lib/db";
import { fetchThreadsForShow, insertThread, likeThread as dbLikeThread, unlikeThread as dbUnlikeThread, unlikeReply as dbUnlikeReply, refreshShowIfStale, fetchCitationsForReplies, fetchCitationsForThread, fetchPrompts, logThreadPrompt, fetchFriendGroupsForUser, addThreadToGroup, createFriendGroup, createShow, fetchGroupThreads, fetchFriendGroupMembers, renameFriendGroup, deleteFriendGroup, removeGroupMember, transferGroupOwnership, softDeleteFriendGroup, recordDepartedMember, fetchDepartedMembers, sendInvite, fetchSentInvitations, fetchBrowseProgress, fetchRoomActivityVisibility, fetchThreadViewState, fetchThreadPublicViewState } from "../lib/db";
import type { RoomVisibility } from "../lib/db";
import type { Invitation } from "../types";
import type { PromptRow } from "../lib/db";
import { supabase } from "../lib/supabaseClient";
import type { ReplyMeta } from "../lib/db";
import { useAuth } from "../lib/auth";
import { canView, timeAgo, maskEmail } from "../lib/utils";
import EpisodeTag from "./EpisodeTag";
import Modal from "./Modal";
import LikeBadge from "./LikeBadge";
import Tooltip from "./Tooltip";
import ModeToggle from "./ModeToggle";
import OneSelectProgress from "./OneSelectProgress";
import InlineThreadView from "./InlineThreadView";
import V2RoomFeed, { type V2RoomFeedEntry, type V2RoomFeedHandle } from "./v2/V2RoomFeed";
import { useComposeModal } from "./v2/ComposeModal";
import FriendProgressPostIt from "./FriendProgressPostIt";
import IncomingPingSticky from "./IncomingPingSticky";
import PollSticky from "./PollSticky";
import SIKWSticky from "./SIKWSticky";
import Username from "./Username";
import type { PendingReference } from "./ResponseComposer";
import PromptCard from "./PromptCard";
import type { PromptEntry } from "../lib/promptData";
import { getFragment, getPromptSuggestion } from "../lib/prompts";

const GLOBAL_HEADER_H = 56;
const ROW_PAD_Y = 8;

export default function ShowSection({
  shows: showsProp, onShowUpdated, onShowCreated, username, showId, progress, updateProgressFor, newHighlights, setNewHighlights,
  visitedThreads, setVisitedThreads, activeThreadId, setActiveThreadId, onHomepage,
  likesThreads, setLikesThreads, likedByUserThreads, setLikedByUserThreads,
  likesReplies, setLikesReplies, likedByUserReplies, setLikedByUserReplies,
  focusReplyId, onAuthRequired, onClickProfile, navLeft, navRight,
  showStaleNudge, onDismissStaleNudge,
  clearRewatchFor, onOpenFeedback, onSwitchShow, onGroupLeft, onGroupCreated, allFriendGroups,
}: any) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const composeModal = useComposeModal();
  const allShows: Show[] = showsProp?.length ? showsProp : seedShows as Show[];
  const show = allShows.find((s) => s.id === showId) || (() => {
    // Fallback: try browse metadata from sessionStorage (set by SearchShows onboarding modal)
    try {
      const stored = JSON.parse(sessionStorage.getItem(`ns_browse_show_${showId}`) || "null");
      if (stored) return { id: showId, name: stored.name, seasons: stored.seasons };
    } catch {}
    return { id: showId, name: showId, seasons: [10] };
  })();

  // ── Guest progress (logged-out users — stored in localStorage) ───────────
  const guestProgressKey = `ns_guest_prog_${showId}`;
  const [guestProgress, setGuestProgress] = useState<{ s: number; e: number } | null>(() => {
    if (user) return null;
    try { return JSON.parse(localStorage.getItem(`ns_guest_prog_${showId}`) || "null"); } catch { return null; }
  });
  const [showGuestPicker, setShowGuestPicker] = useState(() => {
    if (user) return false;
    // Skip the picker if progress already exists from onboarding modal or prior visit
    const hasGuest = !!(() => { try { return JSON.parse(localStorage.getItem(`ns_guest_prog_${showId}`) || "null"); } catch { return null; } })();
    const hasBrowse = !!(() => { try { return JSON.parse(sessionStorage.getItem(`ns_browse_prog_${showId}`) || "null"); } catch { return null; } })();
    return !hasGuest && !hasBrowse;
  });

  // Browse progress from sessionStorage — available immediately for all users
  const [browseSessionProgress, setBrowseSessionProgress] = useState<{ s: number; e: number } | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(`ns_browse_prog_${showId}`) || "null"); } catch { return null; }
  });
  const [browseProgress, setBrowseProgress] = useState<any>(null);

  // Fetch browse_progress for logged-in users who don't have committed progress
  useEffect(() => {
    if (!user || progress[showId]) { setBrowseProgress(null); return; }
    fetchBrowseProgress(user.id, showId).then(bp => {
      if (bp) setBrowseProgress(bp);
    }).catch(() => {});
  }, [user?.id, showId, !!progress[showId]]);

  // For logged-in users: show progress prompt if progress is unset (e === 0 sentinel).
  // Exempt legitimate zero-progress ({s:0, e:0}), which is a real "haven't started
  // yet" state set via the friend-room creation / invite-accept flows.
  const isUnsetSentinel = (p?: { s: number; e: number }) =>
    !!p && p.e === 0 && p.s !== 0;
  const [showLoggedInPicker, setShowLoggedInPicker] = useState(() =>
    !!(user && isUnsetSentinel(progress[showId]))
  );
  useEffect(() => {
    if (user && isUnsetSentinel(progress[showId])) setShowLoggedInPicker(true);
  }, [showId, user, progress[showId]?.e, progress[showId]?.s]);

  // Sync guest progress state when showId changes (user navigates to a different show)
  useEffect(() => {
    if (user) return;
    let hasProgress = false;
    try {
      const stored = JSON.parse(localStorage.getItem(`ns_guest_prog_${showId}`) || "null");
      setGuestProgress(stored);
      if (stored) hasProgress = true;
    } catch {
      setGuestProgress(null);
    }
    // Also check sessionStorage for browse progress
    try {
      const bp = JSON.parse(sessionStorage.getItem(`ns_browse_prog_${showId}`) || "null");
      setBrowseSessionProgress(bp);
      if (bp) hasProgress = true;
    } catch {
      setBrowseSessionProgress(null);
    }
    setShowGuestPicker(!hasProgress);
  }, [showId]);

  // Effective progress: committed > sessionStorage browse > DB browse > guest > undefined
  // sessionStorage is checked for all users (immediate, no async delay)
  const effectiveProgress = user
    ? (progress[showId] ?? browseSessionProgress ?? browseProgress ?? undefined)
    : (guestProgress ?? browseSessionProgress ?? undefined);

  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 768);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const [sortBy, setSortBy] = useState<"relevance" | "post" | "episode">("relevance");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<"standard" | "risky">("standard");
  const [riskyRevealedIds, setRiskyRevealedIds] = useState<Set<string>>(new Set());
  const [freshReplyThreadIds, setFreshReplyThreadIds] = useState<Record<string, true>>({});
  const [freshReplyIds, setFreshReplyIds] = useState<Record<string, true>>({});
  // Bumped when the asker successfully opens a poll, forcing PollSticky to
  // re-fetch immediately so the asker sees their poll without a page nav.
  const [pollRefreshKey, setPollRefreshKey] = useState(0);

  // Clear risky reveals only when the thread changes, not on mode toggle
  // Scroll to top whenever the show changes (reliable on mobile)
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [showId]);

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
  const [riskyHintPending, setRiskyHintPending] = useState(false);

  const handleModeToggle = () => {
    const next = mode === "risky" ? "standard" : "risky";
    if (next === "risky" && !localStorage.getItem("ns_risky_hint_seen")) {
      setRiskyHintPending(true);
      return;
    }
    setMode(next);
  };

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
  const [dismissedDots, setDismissedDots] = useState(0);

  // ── Compose destination state (Phase 3) ──────────────────────────────────
  const [composeDestination, setComposeDestination] = useState<"private" | "public" | string>("private");
  const [userGroups, setUserGroups] = useState<FriendGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // canView-aware per-room visibility lookup. Used to pick the
  // most-recently-active room as the compose-default destination
  // (chunk 3 of desktop refocus). Reuses the SECURITY DEFINER RPC
  // shipped for mobile (20260425_room_last_seen.sql); server-side
  // join against effective progress means we don't surface activity
  // the user can't view, which would otherwise leak its existence.
  // Failures degrade gracefully — empty map → fall back to
  // FriendGroup.createdAt for ordering.
  const [roomVisibility, setRoomVisibility] = useState<RoomVisibility[]>([]);
  useEffect(() => {
    if (!user) { setRoomVisibility([]); return; }
    let cancelled = false;
    fetchRoomActivityVisibility(user.id)
      .then(rows => { if (!cancelled) setRoomVisibility(rows); })
      .catch(() => { if (!cancelled) setRoomVisibility([]); });
    return () => { cancelled = true; };
  }, [user?.id, showId]);

  // Hidden tabs (read from localStorage so switch-shows dropdown excludes them)
  const hiddenTabs = useMemo<Set<string>>(() => {
    if (!user) return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(`ns_hidden_tabs_${user.id}`) || "[]")); } catch { return new Set(); }
  }, [user]);

  // ── Friend group view state (Phase 4) ────────────────────────────────────
  // Persist the active group in sessionStorage so a page refresh restores the
  // correct room context (and shows the right "Share to Public" button label).
  const activeGroupSessionKey = `ns_active_group_${showId}`;
  // Session-scoped breadcrumb: which friend room the user was in before
  // stepping out to the public conversations space for this show. Written
  // by the "to public conversations" button, read by the new "back to room"
  // button on the public side so it can offer a direct return.
  const cameFromGroupSessionKey = `ns_came_from_group_${showId}`;
  const [activeGroupId, setActiveGroupId] = useState<string | null>(() =>
    sessionStorage.getItem(`ns_active_group_${showId}`) ?? null
  );
  const [cameFromGroupId, setCameFromGroupId] = useState<string | null>(() =>
    sessionStorage.getItem(cameFromGroupSessionKey) ?? null
  );

  // Visit stamp for ProfilePage's per-tab red-dot dismissal (2026-04-26).
  // Writes a localStorage timestamp whenever the user enters a friend-room view
  // or the public-forum view of this show. Dismisses red-dot notifications for
  // invisible replies whose updatedAt is older than the visit. Per-device only;
  // no DB write. Public/private threads inside a friend room context still
  // count as visiting that room.
  useEffect(() => {
    if (!user?.id) return;
    const now = String(Date.now());
    if (activeGroupId) {
      localStorage.setItem(`ns_room_visited_${user.id}_${activeGroupId}`, now);
    } else {
      localStorage.setItem(`ns_show_public_visited_${user.id}_${showId}`, now);
    }
  }, [user?.id, showId, activeGroupId]);
  // Public→friend-rooms dropdown state (used when user has >1 room and
  // no direct came-from breadcrumb).
  const [friendRoomsDropdownOpen, setFriendRoomsDropdownOpen] = useState(false);
  const friendRoomsDropdownRef = useRef<HTMLDivElement | null>(null);
  const [groupThreadsData, setGroupThreadsData] = useState<Thread[]>([]);
  const [groupReplyCounts, setGroupReplyCounts] = useState<Record<string, number>>({});
  const [groupThreadsLoading, setGroupThreadsLoading] = useState(false);
  // Create-group modal
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [createGroupSubmitting, setCreateGroupSubmitting] = useState(false);
  // Zero-progress: when creating a room for a show the user hasn't onboarded
  // onto yet, they pick their current progress (including "haven't started").
  // Defaults to zero; only used when progress[showId] is absent.
  const [newRoomProgress, setNewRoomProgress] = useState<{ s: number; e: number }>({ s: 0, e: 0 });

  // Auto-open create group modal when navigated with openCreateGroup state
  useEffect(() => {
    if ((location.state as any)?.openCreateGroup) {
      setShowCreateGroupModal(true);
      // Clear the state so it doesn't re-trigger on navigation
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  // Switch active group when navigated with activeGroupId state (e.g. from header friend room buttons)
  useEffect(() => {
    const stateGroupId = (location.state as any)?.activeGroupId;
    if (stateGroupId && stateGroupId !== activeGroupId) {
      setActiveGroupId(stateGroupId);
      sessionStorage.setItem(activeGroupSessionKey, stateGroupId);
      // Clear the state so it doesn't re-trigger
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.key]);

  // ── Per-thread last_seen_at, DB-backed (20260429) ──────────────────────────
  //
  // Replaces the old localStorage `lastOpenedAt` system as the freshness
  // boundary for "is this reply new for me?" computation. Two contexts:
  //
  //   - Friend-room: from `friend_group_thread_views` via fetchThreadViewState.
  //     Loaded per active group; switching groups reloads.
  //   - Public:      from `user_thread_public_views` via fetchThreadPublicViewState.
  //     Loaded per show; threads outside this show are absent.
  //
  // `lastSeenByThread[threadId]` is the merged read-state map keyed on thread
  // id. Absence of a thread = "never seen" (the localStorage `lastOpenedAt`
  // fallback in getNewCounts handles users / shows the RPCs don't cover).
  const [lastSeenByThread, setLastSeenByThread] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!user) { setLastSeenByThread({}); return; }
    let cancelled = false;
    const loadPublic = fetchThreadPublicViewState(showId).catch(() => ({} as Record<string, number>));
    const loadFriend = activeGroupId
      ? fetchThreadViewState(activeGroupId).catch(() => ({} as Record<string, number>))
      : Promise.resolve({} as Record<string, number>);
    Promise.all([loadPublic, loadFriend]).then(([pub, fr]) => {
      if (cancelled) return;
      // Merge: friend-room rows override public rows when both exist for a
      // shared thread. Friend-room wins because that's the active context.
      setLastSeenByThread({ ...pub, ...fr });
    });
    return () => { cancelled = true; };
  }, [user?.id, showId, activeGroupId]);

  // Group settings modal
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [settingsGroupId, setSettingsGroupId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<FriendGroupMember[]>([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);

  // Members of the active friend room — fetched whenever activeGroupId
  // changes, independent of the settings modal's groupMembers state.
  // Drives the friend-progress post-it. Failure leaves the array empty
  // → post-it hides itself.
  const [roomMembers, setRoomMembers] = useState<FriendGroupMember[]>([]);
  useEffect(() => {
    if (!activeGroupId) { setRoomMembers([]); return; }
    let cancelled = false;
    fetchFriendGroupMembers(activeGroupId)
      .then(rows => { if (!cancelled) setRoomMembers(rows); })
      .catch(() => { if (!cancelled) setRoomMembers([]); });
    return () => { cancelled = true; };
  }, [activeGroupId]);
  const [renameValue, setRenameValue] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  // Invite form (inside group settings modal). Multi-row: each row tracks
  // its own email + post-submit status so we can show per-row ✓ / error
  // messages after a partial-failure batch send. Cap at 5 rows; sends
  // beyond that require starting a fresh batch.
  type InviteRow = { email: string; status: "idle" | "success" | "error"; errorMsg?: string };
  const MAX_INVITE_ROWS = 5;
  const [inviteRows, setInviteRows] = useState<InviteRow[]>([{ email: "", status: "idle" }]);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  // Batch-level error (e.g. rate-limit blocked the whole submission before
  // any row was sent). Per-row errors live on the row itself.
  const [inviteBatchError, setInviteBatchError] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<Invitation[]>([]);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  // Leave room modal
  const [showLeaveModal, setShowLeaveModal] = useState<"confirm" | "last-member" | null>(null);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  // Departed members (for "has left the room" labels)
  const [departedMembers, setDepartedMembers] = useState<{ userId: string; username: string; departedAt: number }[]>([]);

  // Fetch friend groups whenever user or show changes
  useEffect(() => {
    if (!user) { setUserGroups([]); setGroupsLoading(false); return; }
    setGroupsLoading(true);
    fetchFriendGroupsForUser(user.id, showId)
      .then(setUserGroups)
      .catch(() => {})
      .finally(() => setGroupsLoading(false));
  }, [user?.id, showId]);

  const activeGroup = userGroups.find(g => g.id === activeGroupId) ?? null;

  // Reset group view when switching shows (skip on initial mount so sessionStorage
  // restoration of activeGroupId isn't immediately overwritten by this effect)
  const prevShowIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevShowIdRef.current !== null && prevShowIdRef.current !== showId) {
      // If navigating with an explicit activeGroupId in state, use that instead of clearing
      const incomingGroupId = (location.state as any)?.activeGroupId;
      if (incomingGroupId) {
        setActiveGroupId(incomingGroupId);
      } else {
        setActiveGroupId(null);
      }
      setGroupThreadsData([]);
      setGroupReplyCounts({});
    }
    prevShowIdRef.current = showId;
  }, [showId]);


  // Keep sessionStorage in sync with activeGroupId so refreshing restores the room context
  useEffect(() => {
    if (activeGroupId) {
      sessionStorage.setItem(activeGroupSessionKey, activeGroupId);
      // Entering any room consumes the breadcrumb — we no longer need to
      // remember where the user was before stepping out to public.
      sessionStorage.removeItem(cameFromGroupSessionKey);
      setCameFromGroupId(null);
    } else {
      sessionStorage.removeItem(activeGroupSessionKey);
    }
  }, [activeGroupId, activeGroupSessionKey, cameFromGroupSessionKey]);

  // Record the group the user came from when stepping out to public. Callers
  // (the "to public conversations" button) invoke this before clearing
  // activeGroupId so the public-side back button can offer a direct return.
  const stepOutToPublic = () => {
    if (activeGroupId) {
      sessionStorage.setItem(cameFromGroupSessionKey, activeGroupId);
      setCameFromGroupId(activeGroupId);
    }
    setActiveGroupId(null);
  };
  // Re-enter a friend room (used by the new public-side back button and
  // its dropdown items). Navigates to the V2 friend room at /room/:groupId
  // — the canonical room surface. The legacy setActiveGroupId-on-
  // ShowSection branch is dead code (per HANDOFF, V1 friend-room mode is
  // unreachable), so previously this button silently no-op'd at the URL
  // level even though it appeared to switch contexts.
  const enterGroup = (gid: string) => {
    setFriendRoomsDropdownOpen(false);
    navigate(`/room/${gid}`);
  };

  // Close the public-side friend-rooms dropdown on outside click.
  useEffect(() => {
    if (!friendRoomsDropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      if (friendRoomsDropdownRef.current &&
          !friendRoomsDropdownRef.current.contains(e.target as Node)) {
        setFriendRoomsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [friendRoomsDropdownOpen]);

  // Rooms for this show sorted by most recent activity, for the public-side
  // "to friend rooms" dropdown. Falls back to userGroups order if App didn't
  // pass allFriendGroups (e.g. in tests) or if a room is missing from it.
  const roomsForThisShow = useMemo(() => {
    if (!Array.isArray(allFriendGroups) || allFriendGroups.length === 0) {
      return userGroups;
    }
    const byId: Record<string, number> = {};
    for (const g of allFriendGroups) {
      if ((g as any).showId === showId) byId[g.id] = (g as any).lastActivityAt ?? 0;
    }
    return [...userGroups].sort((a, b) => (byId[b.id] ?? 0) - (byId[a.id] ?? 0));
  }, [userGroups, allFriendGroups, showId]);

  // Fetch group threads when the active group changes or progress changes
  useEffect(() => {
    if (!activeGroupId) return;
    const prog = effectiveProgress || { s: 1, e: 1 };
    setGroupThreadsLoading(true);
    fetchGroupThreads(activeGroupId, prog.s, prog.e)
      .then(({ threads, replyCounts }) => {
        setGroupThreadsData(threads);
        setGroupReplyCounts(replyCounts);
      })
      .catch(() => {})
      .finally(() => setGroupThreadsLoading(false));
    // Fetch departed members for this group
    fetchDepartedMembers(activeGroupId)
      .then(setDepartedMembers)
      .catch(() => setDepartedMembers([]));
  }, [activeGroupId, effectiveProgress?.s, effectiveProgress?.e]);

  const openGroupSettings = (groupId: string) => {
    setSettingsGroupId(groupId);
    const grp = userGroups.find(g => g.id === groupId);
    setRenameValue(grp?.name ?? "");
    setGroupMembers([]);
    setGroupMembersLoading(true);
    fetchFriendGroupMembers(groupId)
      .then(setGroupMembers)
      .catch(() => {})
      .finally(() => setGroupMembersLoading(false));
    // Reset invite form state
    setInviteRows([{ email: "", status: "idle" }]);
    setInviteBatchError(null);
    // Load pending invitations for this group (creator only)
    if (user) {
      setPendingInvites([]);
      setPendingInvitesLoading(true);
      fetchSentInvitations(user.id)
        .then(all => setPendingInvites(all.filter(i => i.groupId === groupId)))
        .catch(() => {})
        .finally(() => setPendingInvitesLoading(false));
    }
    setShowGroupSettings(true);
  };

  const handleCreateGroup = async () => {
    if (!user || !newGroupName.trim()) return;
    setCreateGroupSubmitting(true);
    try {
      // Same auto-onboard guard as submitPost: if the user landed here via
      // "see public conversations" without ever onboarding into this show,
      // the shows row + their progress row may not exist, which would make
      // createFriendGroup fail the show_id FK. Ensure both exist first.
      // See submitPost comment for why we check progress[showId] (not shows list).
      const hasJournalTab = !!progress?.[showId];
      if (!hasJournalTab) {
        await createShow({
          id: showId,
          name: show.name,
          seasons: show.seasons,
        });
        // User selected their progress inside the Create-room modal.
        // This is the only place zero-progress can enter the system.
        updateProgressFor?.(showId, { s: newRoomProgress.s, e: newRoomProgress.e });
        onShowCreated?.({
          id: showId,
          name: show.name,
          seasons: show.seasons,
          status: "Ended",
          isHidden: false,
        } as Show);
      }
      const g = await createFriendGroup({ showId, name: newGroupName.trim(), createdBy: user.id });
      setUserGroups(prev => [...prev, g]);
      setActiveGroupId(g.id);
      setShowCreateGroupModal(false);
      setNewGroupName("");
      setNewRoomProgress({ s: 0, e: 0 });
      // Surface the new room in the top-nav pills immediately, no refresh needed.
      if (typeof onGroupCreated === "function") onGroupCreated(g);
    } catch (e: any) {
      console.error("createFriendGroup error:", e);
      alert("Failed to create room: " + (e?.message ?? String(e)));
    } finally {
      setCreateGroupSubmitting(false);
    }
  };

  const handleRenameGroup = async () => {
    if (!settingsGroupId || !renameValue.trim()) return;
    setRenameSubmitting(true);
    try {
      await renameFriendGroup(settingsGroupId, renameValue.trim());
      setUserGroups(prev => prev.map(g => g.id === settingsGroupId ? { ...g, name: renameValue.trim() } : g));
      setShowGroupSettings(false);
    } catch {
      alert("Failed to rename. Please try again.");
    } finally {
      setRenameSubmitting(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!settingsGroupId) return;
    if (!window.confirm("Delete this room for everyone? This cannot be undone.")) return;
    try {
      await deleteFriendGroup(settingsGroupId);
      setUserGroups(prev => prev.filter(g => g.id !== settingsGroupId));
      if (activeGroupId === settingsGroupId) setActiveGroupId(null);
      setShowGroupSettings(false);
      if (typeof onGroupLeft === "function") onGroupLeft();
    } catch {
      alert("Failed to delete room. Please try again.");
    }
  };

  // Opens the appropriate leave modal based on member count
  const initiateLeaveGroup = () => {
    if (!settingsGroupId || !groupMembers.length) return;
    if (groupMembers.length === 1) {
      setShowLeaveModal("last-member");
    } else {
      setShowLeaveModal("confirm");
    }
  };

  // Actually perform the leave (called from modal confirmation)
  const executeLeaveGroup = async () => {
    if (!user || !settingsGroupId || !profile) return;
    setLeaveSubmitting(true);
    try {
      const grp = userGroups.find(g => g.id === settingsGroupId);
      const isCreator = !!grp && grp.createdBy === user.id;

      // If creator is leaving and others remain, transfer ownership to next member by join order
      if (isCreator && groupMembers.length > 1) {
        const otherMembers = groupMembers
          .filter(m => m.userId !== user.id)
          .sort((a, b) => a.joinedAt - b.joinedAt);
        if (otherMembers.length > 0) {
          await transferGroupOwnership(settingsGroupId, otherMembers[0].userId);
        }
      }

      // Record departure (so remaining members see "has left the room")
      await recordDepartedMember(settingsGroupId, user.id, profile.username);

      // Remove membership
      await removeGroupMember(settingsGroupId, user.id);

      // Update local state
      setUserGroups(prev => prev.filter(g => g.id !== settingsGroupId));
      if (activeGroupId === settingsGroupId) setActiveGroupId(null);
      setShowGroupSettings(false);
      setShowLeaveModal(null);
      // Navigate to journal — user just left a room, take them back to
      // their content hub.
      navigate("/journal");
      if (typeof onGroupLeft === "function") onGroupLeft();
    } catch {
      alert("Failed to leave room. Please try again.");
    } finally {
      setLeaveSubmitting(false);
    }
  };

  // Last member leaves → soft-delete the room
  const executeLastMemberLeave = async () => {
    if (!user || !settingsGroupId) return;
    setLeaveSubmitting(true);
    try {
      await softDeleteFriendGroup(settingsGroupId);
      setUserGroups(prev => prev.filter(g => g.id !== settingsGroupId));
      if (activeGroupId === settingsGroupId) setActiveGroupId(null);
      setShowGroupSettings(false);
      setShowLeaveModal(null);
      navigate("/journal");
      if (typeof onGroupLeft === "function") onGroupLeft();
    } catch {
      alert("Failed to leave room. Please try again.");
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const ERROR_MESSAGES: Record<string, string> = {
    rate_limit:      "You've reached the 10 invitations/day limit. Try again tomorrow.",
    already_invited: "Already invited.",
    not_creator:     "Only the room creator can send invitations.",
    invalid_email:   "Not a valid email address.",
    self_invite:     "You can't invite yourself.",
  };

  const handleSendInvites = async () => {
    if (!user || !settingsGroupId) return;
    const grp = userGroups.find(g => g.id === settingsGroupId);
    if (!grp) return;
    setInviteBatchError(null);

    // Build the list of rows to actually submit. Rules:
    // - Skip rows already in success state (don't re-send already-confirmed
    //   invites if the user clicks Send again after fixing a failed row).
    // - Skip empty rows (user added a row but didn't fill it).
    // - Dedupe within the batch by lowercase-trim — first occurrence wins;
    //   later duplicates get marked as errors so the user sees what happened.
    // - Self-invite check happens client-side per-row for immediate feedback;
    //   edge function rejects again server-side as a safety net.
    const callerEmail = user.email?.toLowerCase().trim();
    const seen = new Set<string>();
    const nextRows: InviteRow[] = inviteRows.map(r => ({ ...r }));
    const indicesToSend: number[] = [];

    for (let i = 0; i < nextRows.length; i++) {
      const row = nextRows[i];
      if (row.status === "success") continue;
      const trimmed = row.email.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (callerEmail && lower === callerEmail) {
        nextRows[i] = { ...row, status: "error", errorMsg: ERROR_MESSAGES.self_invite };
        continue;
      }
      if (seen.has(lower)) {
        nextRows[i] = { ...row, status: "error", errorMsg: "Duplicate email in this batch." };
        continue;
      }
      seen.add(lower);
      // Reset any prior error on this row before re-sending.
      nextRows[i] = { ...row, status: "idle", errorMsg: undefined };
      indicesToSend.push(i);
    }

    setInviteRows(nextRows);
    if (indicesToSend.length === 0) return;

    setInviteSubmitting(true);
    try {
      // Send all in parallel. Per-row outcomes update only their own row.
      // sendInvite resolves with { ok: false, error } rather than throwing
      // for known errors, so allSettled is mostly belt-and-suspenders for
      // unexpected throws (network failure, etc).
      const results = await Promise.allSettled(
        indicesToSend.map(i =>
          sendInvite({
            groupId:      settingsGroupId,
            groupName:    grp.name,
            inviteeEmail: nextRows[i].email.trim(),
            inviterName:  profile?.username ?? "Someone",
          })
        )
      );

      const finalRows = nextRows.map(r => ({ ...r }));
      let anySuccess = false;
      let rateLimitedBatch = false;

      results.forEach((res, k) => {
        const idx = indicesToSend[k];
        if (res.status === "fulfilled") {
          if (res.value.ok) {
            finalRows[idx] = { ...finalRows[idx], status: "success", errorMsg: undefined };
            anySuccess = true;
          } else {
            const msg = ERROR_MESSAGES[res.value.error] ?? res.value.message ?? "Failed to send.";
            finalRows[idx] = { ...finalRows[idx], status: "error", errorMsg: msg };
            if (res.value.error === "rate_limit") rateLimitedBatch = true;
          }
        } else {
          finalRows[idx] = { ...finalRows[idx], status: "error", errorMsg: "Failed to send." };
        }
      });

      setInviteRows(finalRows);
      if (rateLimitedBatch) {
        setInviteBatchError(ERROR_MESSAGES.rate_limit);
      }

      if (anySuccess) {
        // Refresh pending invites once (any number of new rows landed).
        fetchSentInvitations(user.id)
          .then(all => setPendingInvites(all.filter(i => i.groupId === settingsGroupId)))
          .catch(() => {});
      }
    } catch {
      setInviteBatchError("Something went wrong. Please try again.");
    } finally {
      setInviteSubmitting(false);
    }
  };

  const addInviteRow = () => {
    setInviteRows(rows =>
      rows.length >= MAX_INVITE_ROWS ? rows : [...rows, { email: "", status: "idle" }]
    );
  };

  const updateInviteRowEmail = (index: number, email: string) => {
    // Editing a row resets its status — a sent-then-edited row should
    // re-arm rather than stay stuck on its old success/error state.
    setInviteRows(rows =>
      rows.map((r, i) => (i === index ? { email, status: "idle", errorMsg: undefined } : r))
    );
    setInviteBatchError(null);
  };

  // Pick the most-recently-active room from a list (chunk 3).
  // Order: latestVisibleActivityAt desc (NULL last); createdAt desc
  // tiebreaker. Returns null when the list is empty.
  const pickMostActiveRoom = (groups: FriendGroup[]): string | null => {
    if (!groups.length) return null;
    const visMap = new Map(roomVisibility.map(v => [v.groupId, v.latestVisibleActivityAt]));
    const sorted = [...groups].sort((a, b) => {
      const av = visMap.get(a.id) ?? null;
      const bv = visMap.get(b.id) ?? null;
      if (av != null && bv != null) return bv - av;
      if (av != null) return -1;
      if (bv != null) return 1;
      return b.createdAt - a.createdAt;
    });
    return sorted[0].id;
  };

  const openCompose = () => {
    setComposeOpen(true);
    // Defaults per chunk 3 of the desktop refocus:
    //   - In a friend room → that specific room.
    //   - In public forum / public thread → "public" (per spec B —
    //     contextual to the public space, but other destinations
    //     remain available in the dropdown).
    //   - In a private thread → most-recently-active room, falling
    //     back to "private" if the user has no rooms (legacy).
    if (activeGroupId) {
      setComposeDestination(activeGroupId);
    } else if (!activeThreadId || dbThreads.find(t => t.id === activeThreadId)?.isPublic) {
      setComposeDestination("public");
    } else {
      const defaultRoom = pickMostActiveRoom(userGroups);
      setComposeDestination(defaultRoom ?? "private");
    }
  };
  const closeCompose = () => {
    setComposeOpen(false);
    setComposeDestination("private");
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

  // Apply themed background: yellow for public room/posts, blue for friend room, default green for private posts
  useEffect(() => {
    const activeThread = activeThreadId ? dbThreads.find(t => t.id === activeThreadId) : null;
    const viewingPrivate = !activeGroupId && !!activeThread && !activeThread.isPublic;
    if (activeGroupId) {
      document.body.classList.add("group-context");
      document.body.classList.remove("public-context");
    } else if (viewingPrivate) {
      document.body.classList.remove("group-context");
      document.body.classList.remove("public-context");
    } else {
      document.body.classList.remove("group-context");
      document.body.classList.add("public-context");
    }
    return () => {
      document.body.classList.remove("group-context");
      document.body.classList.remove("public-context");
    };
  }, [activeGroupId, activeThreadId, dbThreads]);

  const [replyCounts, setReplyCounts] = useState<Record<string, number>>({});
  const [replyMeta, setReplyMeta] = useState<Record<string, ReplyMeta[]>>({});
  const [hasExternalReplies, setHasExternalReplies] = useState<Record<string, boolean>>({});
  // Start true so the thread-URL guard fires on the very first render,
  // before the fetch useEffect has a chance to run.
  const [threadsLoading, setThreadsLoading] = useState(true);

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

  // firstVisibleOverrides: per-(user, thread) timestamp written when a thread
  // transitions from hidden → visible due to a progress advance during the
  // session (the "catch-up moment"). The relevance comparator uses this to
  // refresh the brand-new (1b) window for users who just unlocked content
  // their friends posted earlier. Storage key namespaced per user; localStorage
  // is per-device — cross-device drift accepted for v1 per spec amendment.
  const [firstVisibleOverrides, setFirstVisibleOverrides] = useState<Record<string, number>>(() => {
    if (!user) return {};
    try { return JSON.parse(localStorage.getItem(`ns_first_visible_${user.id}`) || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    if (!user) { setFirstVisibleOverrides({}); return; }
    try { setFirstVisibleOverrides(JSON.parse(localStorage.getItem(`ns_first_visible_${user.id}`) || "{}")); }
    catch { setFirstVisibleOverrides({}); }
  }, [user?.id]);

  const markThreadVisited = (tid: string) => {
    setLastOpenedAt(prev => {
      const next = { ...prev, [tid]: Date.now() };
      localStorage.setItem("ns_last_opened", JSON.stringify(next));
      return next;
    });
  };

  const getNewCounts = (threadId: string) => {
    const meta = replyMeta[threadId] ?? [];
    const prog = effectiveProgress;
    // Freshness boundary: DB-backed last_seen wins when present; falls back
    // to localStorage lastOpenedAt when the thread isn't in the DB map yet
    // (RPC failure, brand-new thread before backfill, etc). Absence in both
    // is treated as "never seen" (timestamp 0) so all existing replies count
    // as new the first time the user encounters the thread.
    const dbSeen = lastSeenByThread[threadId];
    const lsSeen = lastOpenedAt[threadId];
    const openedAt = dbSeen ?? lsSeen ?? 0;
    // hiddenBaseAt stays on its original semantics (set ONCE on first
    // encounter, never updated on open) — preserved for the red 28×28 own-
    // thread badge counter, which by spec must not change behavior.
    const baseAt = hiddenBaseAt[threadId] ?? Date.now();
    // Build an id lookup so chain-visibility can walk the parent chain.
    // A reply counts as "chain-visible" only if it passes canView AND
    // every ancestor (via replyToId for seed data, referencedReplyId for
    // real replies) does too. Matches the orphan-hide rule in the
    // in-thread render (RepliesList.isAncestorRedacted); without the
    // chain walk the card number drifts above the number of rendered
    // replies whenever a user has posted in response to a risky reply.
    const metaById: Record<string, typeof meta[number]> = {};
    for (const r of meta) metaById[r.id] = r;
    const getParent = (r: typeof meta[number]): typeof meta[number] | null =>
      (r.replyToId && metaById[r.replyToId]) || (r.referencedReplyId && metaById[r.referencedReplyId]) || null;
    const chainVisible = (r: typeof meta[number]): boolean => {
      if (!canView({ season: r.season, episode: r.episode }, prog)) return false;
      let cur = getParent(r);
      while (cur) {
        if (!canView({ season: cur.season, episode: cur.episode }, prog)) return false;
        cur = getParent(cur);
      }
      return true;
    };
    let visibleNew = 0, hiddenNew = 0, totalVisible = 0;
    for (const r of meta) {
      const visible = chainVisible(r);
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

  // Imperative handle on V2RoomFeed so post-publish flows can auto-expand
  // the freshly-written entry once the refetched threads land in state.
  const feedRef = useRef<V2RoomFeedHandle>(null);

  // Publish-refetch wiring for the public surface — mirrors V2FriendRoomPage.
  // ComposeModal navigates back to /show/<id> with state.publishedThreadId
  // set; we bump a counter so the threads-fetch effect re-runs, and stash
  // the new threadId in a ref so expandEntry can fire after the data lands.
  const [publishRefetchCounter, setPublishRefetchCounter] = useState(0);
  const pendingExpandAfterPublishRef = useRef<string | null>(null);
  useEffect(() => {
    const id = (location.state as { publishedThreadId?: string } | null)?.publishedThreadId;
    if (id && pendingExpandAfterPublishRef.current !== id) {
      pendingExpandAfterPublishRef.current = id;
      setPublishRefetchCounter((c) => c + 1);
      // Clear the location state so a later re-render (or back-button
      // arrival) doesn't fire the watcher again.
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

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
          // Seed replies use replyToId in-memory; real DB replies use
          // referencedReplyId (reply_to_id was dropped from the table).
          // Keep both so the chain walker in getNewCounts can handle
          // either source without special-casing.
          seedRm[tid] = replies.map((r: any) => ({ id: r.id, season: r.season, episode: r.episode, createdAt: r.updatedAt ?? Date.now(), authorId: r.author, replyToId: r.replyToId }));
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
      // Post-publish auto-expand: if a state.publishedThreadId arrived via
      // ComposeModal's navigate-back, the new entry should now be in
      // `threads`. Defer one tick so publicEntries memo + V2RoomFeed re-
      // render before expandEntry tries to find the ticket ref.
      const targetId = pendingExpandAfterPublishRef.current;
      if (targetId && threads.some((t) => t.id === targetId)) {
        pendingExpandAfterPublishRef.current = null;
        setTimeout(() => feedRef.current?.expandEntry(targetId), 0);
      }
    }).catch(() => setThreadsLoading(false));
    return () => { cancelled = true; };
  }, [showId, user?.id, publishRefetchCounter]);

  // ── Live reply updates via Supabase real-time ─────────────
  useEffect(() => {
    const channel = supabase
      .channel(`show-replies-rt-${showId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "replies", filter: `show_id=eq.${showId}` }, (payload) => {
        const r = payload.new as any;
        if (!r) return;
        const meta = { id: r.id, season: r.season, episode: r.episode, createdAt: new Date(r.created_at).getTime(), authorId: r.author_id, referencedReplyId: r.referenced_reply_id ?? undefined };
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

  const allThreads = useMemo(() => {
    const dbIds = new Set(dbThreads.map(t => t.id));
    return [...dbThreads, ...seedThreads.filter(t => t.showId === showId && !dbIds.has(t.id))];
  }, [dbThreads, showId]);

  // ── Override pin: publisher's just-published thread (relevance only) ───────
  //
  // Captured ONCE per context-mount (user / showId / activeGroupId). The pin
  // expires when (a) the thread receives a non-own reply, OR (b) 6h pass
  // since publish — but the expiration check happens at mount only. A
  // publisher who keeps the page open past either threshold continues to
  // see the pin until next mount (intentional: "transition should be
  // invisible to the active user").
  //
  // Stamps written to `ns_just_published_<userId>` at insertThread success
  // (skipped for private journal). Captured here at the moment threads
  // finish loading, then frozen in the useMemo cache so subsequent reply
  // arrivals don't recompute.
  //
  // replyMeta is INTENTIONALLY excluded from deps — including it would
  // unpin threads when replies arrived mid-session, which is exactly what
  // the spec rules out. The closure captures replyMeta at first compute.
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const pinSet = useMemo<Map<string, number>>(() => {
    if (!user || threadsLoading) return new Map();
    let raw: Record<string, number> = {};
    try { raw = JSON.parse(localStorage.getItem(`ns_just_published_${user.id}`) || "{}"); } catch { /* keep empty */ }
    const now = Date.now();
    const result = new Map<string, number>();
    for (const [tid, publishedAt] of Object.entries(raw)) {
      if (now - publishedAt > SIX_HOURS) continue; // expired by time
      const meta = replyMeta[tid] ?? [];
      const hasNonOwnReply = meta.some((r: any) => r.authorId !== user.id);
      if (hasNonOwnReply) continue; // expired by reply arrival
      result.set(tid, publishedAt);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, showId, activeGroupId, threadsLoading]);

  // ── Shared sort comparator (used by baseVisible + activeList) ──────────────
  //
  // sortBy values:
  //   - "post":      latest activity desc (single criterion)
  //   - "episode":   season → episode → updatedAt (all desc)
  //   - "relevance": tiered (lowest tier first, recency desc within tier).
  //
  // Friend-room hierarchy (full):
  //   pin (publisher-only) → 1a → 1b → 1c → 1d → 1e → 2a → 2b → rest
  //     1a: visible-new reply addressed to user (parent is user-authored)
  //     1b: brand-new thread from friends, <36h, user has not written in it
  //     1c: visible-new reply in thread user has written in
  //     1d: visible-new reply in thread user has read but not written in
  //     1e: brand-new thread, ≥36h, user has not written in it
  //     2a: hidden-new reply addressed to user
  //     2b: hidden-new reply elsewhere
  //
  // Public hierarchy (simplified, drops 1b/1e): "from friends" doesn't
  // map cleanly to public context, so brand-new lanes don't exist there.
  //   pin → 1a → 1c → 1d → 2a → 2b → rest
  //
  // "Brand-new" = thread the user has never marked seen (no last_seen row,
  // no localStorage lastOpened) AND createdAt within window. Once opened,
  // a thread leaves the brand-new lanes regardless of age.
  //
  // "Participated" = user has authored at least one reply in the thread
  // (writing only — liking does not count).
  //
  // Tier-classification + sort uses the SAME `openedAt` and `baseAt`
  // boundaries as getNewCounts so the green/red badges and the tier sort
  // can never disagree on what counts as new.
  const THIRTY_SIX_HOURS = 36 * 60 * 60 * 1000;
  const sortThreads = (input: Thread[]): Thread[] => {
    if (sortBy === "post") {
      return [...input].sort((a, b) => b.updatedAt - a.updatedAt);
    }
    if (sortBy === "episode") {
      return [...input].sort((a, b) => {
        if (a.season !== b.season) return b.season - a.season;
        if (a.episode !== b.episode) return b.episode - a.episode;
        return b.updatedAt - a.updatedAt;
      });
    }
    // relevance — tiered.
    const myId = user?.id;
    const myUsername = profile?.username;
    const prog = effectiveProgress;
    const inFriendRoom = !!activeGroupId;
    const now = Date.now();
    // User's join time for the active friend room (for the brand-new window
    // floor: a user who joined a room 5 days ago doesn't see threads from
    // 4 days ago as brand-new). Public has no room-join floor — public
    // threads use thread.createdAt only.
    const myJoinedAt = inFriendRoom
      ? (roomMembers.find(m => m.userId === myId)?.joinedAt ?? 0)
      : 0;

    const tierOf = (t: Thread): number => {
      const meta = replyMeta[t.id] ?? [];
      const openedAt = lastSeenByThread[t.id] ?? lastOpenedAt[t.id] ?? 0;
      const baseAt   = hiddenBaseAt[t.id] ?? Date.now();
      // "Brand-new" requires literally never having marked-seen the thread.
      // After the 20260429 backfill, every existing thread has a row, so
      // brand-new = a thread created after deploy that the user has not yet
      // opened-and-scrolled.
      const userRead   = (lastSeenByThread[t.id] !== undefined) || (lastOpenedAt[t.id] !== undefined);
      const userWrote  = meta.some(r => r.authorId === myId);
      const brandNew   = !userRead;
      // firstVisibleToUserAt: when the thread became visible to *this* user.
      //   - Catch-up override (in-session progress advance unlocked the thread)
      //     wins when present — written by the progress-bump effect.
      //   - Friend-room default: max(thread.createdAt, joinedAt). A thread
      //     posted before the user joined uses joinedAt.
      //   - Public default: thread.createdAt only.
      // Used for the 1b/1e window so caught-up users see freshly-unlocked
      // content as "brand-new for them" within 36h of the unlock moment.
      const override = firstVisibleOverrides[t.id];
      const firstVisibleAt = override
        ?? (inFriendRoom ? Math.max(t.createdAt ?? 0, myJoinedAt) : (t.createdAt ?? 0));
      const threadAge  = now - firstVisibleAt;

      const metaById: Record<string, typeof meta[number]> = {};
      for (const r of meta) metaById[r.id] = r;
      const getParent = (r: typeof meta[number]): typeof meta[number] | null =>
        (r.replyToId && metaById[r.replyToId]) || (r.referencedReplyId && metaById[r.referencedReplyId]) || null;
      const chainVisible = (r: typeof meta[number]): boolean => {
        if (!canView({ season: r.season, episode: r.episode }, prog)) return false;
        let cur = getParent(r);
        while (cur) {
          if (!canView({ season: cur.season, episode: cur.episode }, prog)) return false;
          cur = getParent(cur);
        }
        return true;
      };

      let hasVisibleNew = false;
      let hasVisibleNewToMe = false;
      let hasHiddenNewToMe = false;
      let hasHiddenNewOther = false;
      for (const r of meta) {
        if (r.authorId === myId) continue;  // own replies don't trigger any tier
        const visible = chainVisible(r);
        if (visible) {
          if (r.createdAt > openedAt) {
            hasVisibleNew = true;
            const parent = getParent(r);
            const toUser = parent ? parent.authorId === myId : t.author === myUsername;
            if (toUser) hasVisibleNewToMe = true;
          }
        } else {
          if (r.createdAt > baseAt && !riskyRevealedIds.has(r.id)) {
            const parent = getParent(r);
            const toUser = parent ? parent.authorId === myId : t.author === myUsername;
            if (toUser) hasHiddenNewToMe = true;
            else hasHiddenNewOther = true;
          }
        }
      }

      // Tier classification. Order: most personal/urgent first.
      if (hasVisibleNewToMe)                                          return 1;  // 1a
      if (inFriendRoom && brandNew && threadAge < THIRTY_SIX_HOURS && !userWrote) return 2;  // 1b
      if (hasVisibleNew && userWrote)                                 return 3;  // 1c
      if (hasVisibleNew && userRead)                                  return 4;  // 1d
      if (inFriendRoom && brandNew && !userWrote)                     return 5;  // 1e
      if (hasHiddenNewToMe)                                           return 6;  // 2a
      if (hasHiddenNewOther)                                          return 7;  // 2b
      return 8;  // rest
    };

    // Pull pinned threads out before tier sort. Pinned threads are excluded
    // from tier evaluation entirely (no double-appearance) and stack at the
    // top sorted by publish time desc.
    const pinned: Thread[] = [];
    const others: Thread[] = [];
    for (const t of input) {
      if (pinSet.has(t.id)) pinned.push(t);
      else others.push(t);
    }
    pinned.sort((a, b) => (pinSet.get(b.id) ?? 0) - (pinSet.get(a.id) ?? 0));
    others.sort((a, b) => {
      const ta = tierOf(a);
      const tb = tierOf(b);
      if (ta !== tb) return ta - tb;
      return b.updatedAt - a.updatedAt;
    });
    return [...pinned, ...others];
  };

  const baseVisible = useMemo(() => {
    const prog = effectiveProgress;
    let list = allThreads
      .filter(t => canView(t, prog))
      .filter(t => t.isPublic);  // show page is public-only; private entries live in the journal

    if (searchQuery.trim()) {
      // Search results bypass sortBy and use score-based ordering instead.
      const withScores = list
        .map(t => ({ t, s: scoreThread(t, searchQuery) }))
        .filter(x => x.s > 0)
        .sort((a, b) => (b.s - a.s) || (b.t.updatedAt - a.t.updatedAt));
      return withScores.map(x => x.t);
    }

    return sortThreads(list);
  }, [allThreads, progress, searchQuery, sortBy, newHighlights, showId, reWatchOnly, replyMeta, lastSeenByThread, lastOpenedAt, hiddenBaseAt, firstVisibleOverrides, freshReplyThreadIds, riskyRevealedIds, pinSet, activeGroupId, roomMembers, user?.id, profile?.username, effectiveProgress?.s, effectiveProgress?.e]);

  // ── Green-tab: compute newly visible threads ──
  const prevProgRef = useRef<{ s: number; e: number } | undefined>(undefined);
  useEffect(() => {
    const cur = effectiveProgress;
    const prev = prevProgRef.current;
    if (prev && cur && allThreads.length > 0 && (prev.s !== cur.s || prev.e !== cur.e)) {
      const newly: Record<string, true> = {};
      for (const t of allThreads) {
        if (!canView(t, prev) && canView(t, cur)) newly[t.id] = true;
      }
      if (Object.keys(newly).length > 0) {
        setNewHighlights((nh: any) => ({ ...nh, [showId]: { ...(nh[showId] || {}), ...newly } }));
        // Catch-up moment: stamp firstVisibleAt for these threads so the
        // 1b/1e relevance window resets to "now." Persist per-user to
        // localStorage; survives session close. Only writes for threads
        // not yet stamped (never overwrite a prior catch-up moment).
        if (user) {
          setFirstVisibleOverrides(prev => {
            const next = { ...prev };
            const stamp = Date.now();
            let changed = false;
            for (const tid of Object.keys(newly)) {
              if (!(tid in next)) { next[tid] = stamp; changed = true; }
            }
            if (changed) {
              try { localStorage.setItem(`ns_first_visible_${user.id}`, JSON.stringify(next)); } catch {}
              return next;
            }
            return prev;
          });
        }
      }
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
  }, [effectiveProgress?.s, effectiveProgress?.e, allThreads]);

  const displayed = baseVisible;

  // When a group tab is active, map group thread IDs back through allThreads to pick up
  // full metadata (replyMeta, etc.) already loaded by fetchThreadsForShow. Then apply
  // the same sortThreads the public path uses — without this, friend-room threads
  // bypassed sortBy entirely and rendered in raw DB order.
  const activeList = useMemo(() => {
    if (!activeGroupId) return displayed;
    const groupIdSet = new Set(groupThreadsData.map(t => t.id));
    const filtered = allThreads.filter(t => groupIdSet.has(t.id));
    return sortThreads(filtered);
  }, [activeGroupId, groupThreadsData, allThreads, displayed, sortBy, replyMeta, lastSeenByThread, lastOpenedAt, hiddenBaseAt, firstVisibleOverrides, freshReplyThreadIds, riskyRevealedIds, newHighlights, pinSet, roomMembers, showId, user?.id, profile?.username, effectiveProgress?.s, effectiveProgress?.e]);

  const activeLoading = activeGroupId ? groupThreadsLoading : threadsLoading;

  // V2 inline-expand entries for the public mode. Built from the same
  // sorted/filtered activeList used by the legacy click-through cards but
  // shaped for V2RoomFeed. Tombstones (soft-deleted with replies) survive;
  // soft-deleted with no replies drop out. Private journal entries already
  // filtered out client-side via t.isPublic.
  const publicEntries = useMemo<V2RoomFeedEntry[]>(() => {
    if (activeGroupId) return [];
    return activeList
      .filter((t) => t.isPublic && !t.isMoved)
      .filter((t) => !t.isDeleted || (replyMeta[t.id] ?? []).length > 0)
      .map((t) => ({
        threadId: t.id,
        s: t.season,
        e: t.episode,
        title: t.titleBase,
        body: t.body,
        preview: t.preview,
        authorId: "",
        authorUsername: t.author,
        isRewatch: t.isRewatch,
        rewatchS: t.rewatchS,
        rewatchE: t.rewatchE,
        isEdited: t.isEdited,
        isDeleted: t.isDeleted ?? false,
        updatedAt: t.updatedAt,
        replyCount: getNewCounts(t.id).totalVisible,
        thread: t,
      }));
  }, [activeGroupId, activeList, replyMeta]);

  // Set of departed usernames for quick lookup in thread/reply rendering
  const departedUsernameSet = useMemo(() => new Set(departedMembers.map(d => d.username)), [departedMembers]);

  const thread = activeThreadId ? allThreads.find(t => t.id === activeThreadId && t.showId === showId) : null;

  // On the public show page the cards expand inline (via V2RoomFeed), so
  // activeThreadId being set doesn't mean the surface flipped to a thread
  // view — it just means one card is open. The banner + controls row
  // should keep reading as "forum view" regardless of whether a card is
  // expanded. `chromeThread` is the value used by every chrome ternary
  // below: it stays null in inline-expand mode (public surface) so the
  // chrome doesn't switch on expand, and equals `thread` in the other
  // modes (friend room + private journal post) where the surface really
  // does flip to a focused thread view.
  const isInlineExpandMode = !activeGroupId && !(thread && !thread.isPublic);
  const chromeThread = isInlineExpandMode ? null : thread;

  // Shared progress-confirm handler: updates progress, then navigates back to
  // the forum if the currently-open thread is no longer visible at the new progress.
  const handleProgressConfirm = (val: { s: number; e: number }) => {
    if (!user) {
      // Guest: persist to localStorage, update local state
      setGuestProgress(val);
      localStorage.setItem(guestProgressKey, JSON.stringify(val));
      if (thread && !canView({ season: thread.season, episode: thread.episode }, val)) {
        setActiveThreadId(null);
      }
      setShowProgressCelebration(true);
      return;
    }
    const prog = progress[showId];

    // Transition detection: strictly past the previous highest flips rewatch off.
    // updateProgressFor handles the actual state update (flag, highest, rewatch
    // fields) — this branch just triggers the celebratory UI.
    if (prog?.isRewatching && prog.highestS != null && prog.highestE != null) {
      const pastHighest =
        val.s > prog.highestS ||
        (val.s === prog.highestS && val.e > prog.highestE);
      if (pastHighest) {
        // Transitioning out of rewatch — effective progress becomes val
        // (isRewatching flips to false, highest gets bumped to val).
        // Bare {s,e} is the correct check for the post-update state.
        updateProgressFor(showId, val);
        if (thread && !canView({ season: thread.season, episode: thread.episode }, val)) {
          setActiveThreadId(null);
        }
        setShowAutoFlipMsg(true);
        if (showStaleNudge) onDismissStaleNudge?.();
        return;
      }
      // Still rewatching, advancing within previous highest. Effective
      // progress (= highest) is unchanged, so the open thread's visibility
      // cannot have changed by this update — skip the canView check.
      // Without this, passing bare {s,e} val to canView would treat the
      // user as a non-rewatcher at val and incorrectly close threads
      // tagged between val and highest that they can still see.
      updateProgressFor(showId, val);
      setShowProgressCelebration(true);
      if (showStaleNudge) onDismissStaleNudge?.();
      return;
    }

    // Non-rewatcher — effective progress is just val.
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
    const prog = effectiveProgress || { s: 1, e: 1 };
    const next = getPromptSuggestion(currentShow as Show, prog, shownPromptIds, promptEntries);
    if (next) {
      setShownPromptIds(prev => [...prev, next.id]);
      setActivePrompt(next);
    }
  };

  const handlePromptShuffle = () => {
    const currentShow = allShows.find(s => s.id === showId) || { id: showId, name: showId, seasons: [10] };
    const prog = effectiveProgress || { s: 1, e: 1 };
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
  const postProgress = progress[showId] || { s: 1, e: 1 };  // compose requires login → always progress[showId]
  // Re-watchers tag posts at their highest prior progress so first-timers can't see them
  const postTagS = postProgress.isRewatching && postProgress.highestS ? postProgress.highestS : postProgress.s;
  const postTagE = postProgress.isRewatching && postProgress.highestE ? postProgress.highestE : postProgress.e;

  const [postSubmitting, setPostSubmitting] = useState(false);

  const submitPost = async () => {
    if (!user || !profile) { onAuthRequired(); return; }
    const title = (postTitle || "").trim();
    const body = (postBody || "").trim();
    if (!title) { alert("Please add a title before posting."); return; }
    if (!body) { alert("Write something first."); return; }
    setPostSubmitting(true);
    try {
      // If the user landed here via "see public conversations" without ever onboarding
      // into this show, the shows row + their progress row may not exist in DB.
      // Creating the thread would fail the FK. Auto-onboard them here so posting
      // from the public/private space just works — creates the show row (idempotent),
      // writes their progress (= journal tab), and syncs App state.
      // NOTE: shows state is populated optimistically by App.onBrowsePublic even when
      // the DB row doesn't exist, so that list is NOT a reliable "has journal tab"
      // signal. progress[showId] is — it's only set when the user picks Start Journal
      // or Create Friend Room from the onboarding modal.
      const hasJournalTab = !!progress?.[showId];
      if (!hasJournalTab) {
        await createShow({
          id: showId,
          name: show.name,
          seasons: show.seasons,
        });
        updateProgressFor?.(showId, { s: postTagS, e: postTagE });
        onShowCreated?.({
          id: showId,
          name: show.name,
          seasons: show.seasons,
          status: "Ended",
          isHidden: false,
        } as Show);
      }

      const threadData = {
        showId, season: postTagS, episode: postTagE,
        authorId: user.id, authorName: profile.username,
        title: title || "Untitled note",
        preview: body.slice(0, 240) + (body.length > 240 ? "…" : ""),
        body: body || "(blank)",
        isRewatch: postProgress.isRewatching ?? false,
        // Frozen rewatch-position snapshot for the badge display: (rewatch / highest).
        // Only set when posting as a rewatcher; otherwise undefined.
        rewatchSeason: postProgress.isRewatching ? (postProgress.rewatchS ?? postProgress.s) : undefined,
        rewatchEpisode: postProgress.isRewatching ? (postProgress.rewatchE ?? postProgress.e) : undefined,
      };

      let t: Awaited<ReturnType<typeof insertThread>>;
      if (composeDestination === "public") {
        t = await insertThread({ ...threadData, isPublic: true });
      } else if (composeDestination === "private") {
        t = await insertThread({ ...threadData, isPublic: false });
      } else {
        // group id
        t = await insertThread({ ...threadData, isPublic: false });
        await addThreadToGroup(t.id, composeDestination).catch(err => {
          console.warn(`addThreadToGroup failed for thread=${t.id}, group=${composeDestination}:`, err);
        });
      }

      // Log prompt usage
      for (const pid of insertedPromptIds) {
        logThreadPrompt(t.id, pid).catch(() => {});
      }
      setInsertedPromptIds([]);
      const now = Date.now();
      setHiddenBaseAt(prev => {
        const next = { ...prev, [t.id]: now };
        localStorage.setItem("ns_hidden_base", JSON.stringify(next));
        return next;
      });

      // Stamp the publish time for the override-pin (relevance sort).
      // Skipped for private journal posts — no social-momentum need there.
      // Read at mount-time only by the pin capture; expires at 6h or first
      // non-own reply (checked at next mount, never mid-session).
      if (user && composeDestination !== "private") {
        const pubKey = `ns_just_published_${user.id}`;
        try {
          const map = JSON.parse(localStorage.getItem(pubKey) || "{}") as Record<string, number>;
          map[t.id] = now;
          // GC: drop entries older than 6h while we're here.
          const SIX_H = 6 * 60 * 60 * 1000;
          for (const [tid, ts] of Object.entries(map)) {
            if (now - ts > SIX_H) delete map[tid];
          }
          localStorage.setItem(pubKey, JSON.stringify(map));
        } catch { /* corrupt JSON: silently overwrite */
          localStorage.setItem(pubKey, JSON.stringify({ [t.id]: now }));
        }
      }

      setDbThreads(prev => [t, ...prev]);
      setReplyCounts(rc => ({ ...rc, [t.id]: 0 }));
      if (composeDestination !== "public" && composeDestination !== "private") {
        if (activeGroupId === composeDestination) {
          setGroupThreadsData(prev => [t, ...prev]);
          setGroupReplyCounts(prev => ({ ...prev, [t.id]: 0 }));
        }
      }

      setPostTitle(""); setPostBody("");
      setActivePrompt(null); setShownPromptIds([]); setInsertedPromptIds([]);
      closeCompose();
    } catch {
      alert("Failed to post. Please try again.");
    } finally {
      setPostSubmitting(false);
    }
  };

  return (
    <section className="container" style={{ paddingBottom: 140 }}>
      {/* ── Guest progress picker ── shown to logged-out users who haven't set progress yet */}
      {!user && showGuestPicker && (
        <Modal
          onClose={() => {
            // Default to S1E1 if closed without picking so they see at least some content
            if (!guestProgress) {
              const fallback = { s: 1, e: 1 };
              setGuestProgress(fallback);
              localStorage.setItem(guestProgressKey, JSON.stringify(fallback));
            }
            setShowGuestPicker(false);
          }}
          width="min(440px,92vw)"
        >
          <div style={{ padding: "20px 16px 20px" }}>
            <p style={{ margin: "0 0 8px", fontSize: 19, fontWeight: 700, lineHeight: 1.3 }}>
              Where are you in {(allShows.find(s => s.id === showId)?.name) || showId}?
            </p>
            <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.5, opacity: 0.75 }}>
              Set your watch progress so we only show you entries written by people who were at your level or earlier — no spoilers from further ahead.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <OneSelectProgress
                show={allShows.find(s => s.id === showId) || { seasons: [10] }}
                value={guestProgress || { s: 1, e: 1 }}
                onConfirm={(val) => {
                  setGuestProgress(val);
                  localStorage.setItem(guestProgressKey, JSON.stringify(val));
                  setShowGuestPicker(false);
                  setShowProgressCelebration(true);
                }}
                requireConfirm={true}
                plain
              />
            </div>
            <p style={{ margin: "20px 0 0", fontSize: 13, opacity: 0.5, textAlign: "center" }}>
              <a href="/auth" style={{ color: "inherit", textDecoration: "underline" }}>Sign up or log in</a> to save your progress permanently.
            </p>
          </div>
        </Modal>
      )}
      {user && showLoggedInPicker && (() => {
        const confirmPicker = (val: { s: number; e: number }) => {
          updateProgressFor?.(showId, val);
          setShowLoggedInPicker(false);
          setShowProgressCelebration(true);
        };
        // Track what's currently selected in the picker so the confirm button always works
        let pickerSelected = { s: 1, e: 1 };
        return (
          <Modal
            onClose={() => { confirmPicker({ s: 1, e: 1 }); }}
            width="min(440px,92vw)"
          >
            <div style={{ padding: "20px 16px 20px" }}>
              <p style={{ margin: "0 0 8px", fontSize: 19, fontWeight: 700, lineHeight: 1.3 }}>
                Where are you in {(allShows.find(s => s.id === showId)?.name) || showId}?
              </p>
              <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.5, opacity: 0.75 }}>
                Set your watch progress so we only show you entries written by people who were at your level or earlier — no spoilers from further ahead.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <OneSelectProgress
                  show={allShows.find(s => s.id === showId) || { seasons: [10] }}
                  value={{ s: 1, e: 1 }}
                  onConfirm={confirmPicker}
                  onChangeSelected={(val) => { pickerSelected = val; }}
                  requireConfirm={false}
                  plain
                />
                <button
                  className="btn post h40"
                  onClick={() => confirmPicker(pickerSelected)}
                  style={{ whiteSpace: "nowrap" }}
                >
                  Confirm →
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
      {showBBPopup && (
        <Modal onClose={dismissBBPopup} width="min(520px,92vw)" cardClassName="explanation-card">
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              <FlaskConical size={14} color="var(--icon-color)" style={{verticalAlign:"middle"}} /> This Breaking Bad DEMO room is seeded with AI-generated entries so you can see how the forum works before real users fill it. The posts are illustrative, not real opinions.
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
      <div className="stickybar bleed" ref={bannerRef}>
        <div className="container">
          {(navLeft || navRight) && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0 4px" }}>
              <div className="hangL">{navLeft}</div>
              <div>{navRight}</div>
            </div>
          )}
          {/* Row 1 */}
          <div className="bannerRow1">
            {activeGroupId && activeGroup ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", flex: "0 1 auto", minWidth: 0 }}>
                  {/* Eyebrow — always shown in the friend-room context (forum
                     view or inside a friend-room thread). Left-aligned with
                     the title's text by offsetting the Users-icon width + gap
                     (22 + 6 = 28). */}
                  <div style={{
                    fontSize: 13, fontWeight: 400, lineHeight: 1.2,
                    color: "var(--dos-light)", marginLeft: 28,
                  }}>
                    your friend room:
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
                    <span
                      className="bannerTitle editorial"
                      role={thread ? "button" : "heading"}
                      title={thread ? "Back to room" : "Room"}
                      onClick={thread ? () => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); } : undefined}
                      style={{
                        fontSize: 34, fontWeight: 600, letterSpacing: .5, lineHeight: 1.05,
                        color: "var(--dos-light)", cursor: thread ? "pointer" : "default", userSelect: "none",
                        flex: "0 1 auto", minWidth: 0, overflowWrap: "break-word",
                        display: "inline-flex", alignItems: "flex-start", gap: 6,
                      }}
                    >
                      <Users size={22} color="var(--dos-light)" style={{ flexShrink: 0, marginTop: 7 }} /> {preventLastWordOrphan(activeGroup.name.toUpperCase())}
                    </span>
                    <span
                      onClick={() => openGroupSettings(activeGroupId)}
                      title="Room settings"
                      style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", marginTop: 8, flexShrink: 0 }}
                    >
                      <Settings size={20} color="#fff" />
                    </span>
                  </div>
                </div>
                {!thread && (
                  <button
                    className="btn"
                    onClick={stepOutToPublic}
                    style={{
                      whiteSpace: "nowrap", fontSize: 13, flexShrink: 0,
                      padding: "3px 12px",
                      background: "transparent",
                      border: "2px solid #fff",
                      color: "#fff",
                    }}
                  >
                    to public conversation <ArrowRight size={14} color="var(--icon-color)" style={{verticalAlign:"middle"}} />
                  </button>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", flex: "0 1 auto", minWidth: 0 }}>
                  {/* Eyebrow — always shown. Text varies by context:
                       - private thread (no group, thread not public) →
                         "your private thoughts on:", no icon offset since
                         the Globe is hidden in this case and the title
                         starts at x=0.
                       - public forum view or public thread →
                         "public writing about:", offset 24 (Globe 18 + gap 6)
                         to left-align with the title's text past the icon. */}
                  {(() => {
                    const isPrivateThread = !!(thread && !thread.isPublic);
                    return (
                      <div style={{
                        fontSize: 13, fontWeight: 400, lineHeight: 1.2,
                        color: "var(--dos-light)",
                        marginLeft: isPrivateThread ? 0 : 24,
                      }}>
                        {isPrivateThread ? "your private thoughts on:" : "public writing about:"}
                      </div>
                    );
                  })()}
                  <span
                    className="bannerTitle editorial"
                    role={chromeThread ? "button" : "heading"}
                    title={chromeThread ? "Back to forum" : "Show"}
                    onClick={chromeThread ? () => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); } : undefined}
                    style={{
                      fontSize: 34, fontWeight: 600, letterSpacing: .5, lineHeight: 1.05,
                      color: "var(--dos-light)", cursor: chromeThread ? "pointer" : "default", userSelect: "none",
                      minWidth: 0, overflowWrap: "break-word",
                      display: "inline-flex", alignItems: "flex-start", gap: 6,
                      // Underline when the title is acting as a link back to
                      // the show forum (chunk 5 of desktop refocus). The
                      // "more entries" back button was removed in the same
                      // chunk so this is now the primary back affordance
                      // from inside a public thread; the underline makes
                      // the link affordance explicit. Inline-expand mode
                      // (public surface) suppresses the underline because
                      // expansion stays on the same surface.
                      textDecoration: chromeThread ? "underline" : "none",
                      textUnderlineOffset: 4,
                    }}
                  >
                    {!(thread && !thread.isPublic && !activeGroupId) && <Globe size={18} color="#fff" style={{ flexShrink: 0, marginTop: 9 }} />}
                    {preventLastWordOrphan(showId === "bb"
                      ? "BREAKING BAD (DEMO)"
                      : String((allShows.find(s => s.id === showId)?.name) || showId).toUpperCase())}
                  </span>
                </div>
                {/* Mirror of the friend-room "to public conversations" button.
                   Shown in the public space (forum view only — hidden inside
                   any thread; thread-level back-nav is handled by the thread
                   toolbar's "Back to show" button). Three behaviors:
                     - breadcrumb set → direct return to [breadcrumb room]
                     - one room only → direct enter that room
                     - multiple rooms → opens a dropdown listing rooms
                   Visual: icon-only pill [Users][ArrowRight] with tooltip
                   "go to your friend room"; the dynamic label moved into
                   the dropdown rows for the multi-room case. */}
                {!thread && userGroups.length > 0 && (() => {
                  const breadcrumbRoom = cameFromGroupId
                    ? userGroups.find(g => g.id === cameFromGroupId)
                    : null;
                  const targetRoom = breadcrumbRoom
                    || (userGroups.length === 1 ? userGroups[0] : null);
                  return (
                    <div ref={friendRoomsDropdownRef} style={{ position: "relative", flexShrink: 0 }}>
                      <Tooltip
                        text="go to your friend room"
                        direction="below"
                        tooltipStyle={{ width: "auto", whiteSpace: "nowrap", padding: "6px 10px" }}
                      >
                        <button
                          className="btn dim-hover"
                          aria-label="go to your friend room"
                          onClick={() => {
                            if (targetRoom) enterGroup(targetRoom.id);
                            else setFriendRoomsDropdownOpen(o => !o);
                          }}
                          style={{
                            padding: "5px 10px",
                            background: "transparent",
                            border: "2px solid #fff",
                            color: "#fff",
                            display: "inline-flex", alignItems: "center", gap: 6,
                          }}
                        >
                          <Users size={16} color="#fff" style={{ flexShrink: 0 }} />
                          <ArrowRight size={14} color="#fff" style={{ flexShrink: 0 }} />
                        </button>
                      </Tooltip>
                      {friendRoomsDropdownOpen && !targetRoom && (
                        <div style={{
                          position: "absolute", top: "calc(100% + 6px)", right: 0,
                          background: "#dea838", border: "none", borderRadius: 10,
                          padding: 8, minWidth: 220, zIndex: 200,
                          display: "flex", flexDirection: "column", gap: 6,
                          boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
                        }}>
                          {roomsForThisShow.map(g => (
                            <button
                              key={g.id}
                              className="btn"
                              onClick={() => enterGroup(g.id)}
                              style={{
                                fontSize: 13, whiteSpace: "nowrap",
                                display: "flex", alignItems: "center", width: "100%",
                                background: "transparent",
                                border: "2px solid #fff",
                                color: "#fff",
                              }}
                            >
                              <ArrowRight size={14} color="#fff" style={{ flexShrink: 0 }} />
                              <span style={{ flex: 1, textAlign: "center", margin: "0 8px" }}>{g.name}</span>
                              <Users size={14} color="#fff" style={{ flexShrink: 0 }} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          <hr className="bleed-line" />

          {/* Row 2 */}
          {chromeThread && isMobile ? (
            /* ── Thread · mobile: two rows so nothing bleeds off-screen ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: `${ROW_PAD_Y}px 0` }}>
              {/* Row 1: back + mode toggle. Private threads skip the back
                  button — users return to the journal via the top-nav pill. */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {/* Friend-room threads keep their explicit back button —
                     it points back to a different forum than the banner
                     show-name link does (room forum vs. public forum), so
                     the affordance can't fold into the banner. Public
                     threads' "more entries" button was removed in chunk 5
                     of the desktop refocus; the now-underlined banner
                     show-name is the primary back-to-forum affordance.
                     Private threads continue to skip the back button —
                     users return to the journal via the top-nav pill. */}
                  {activeGroupId && (
                    <button
                      className="btn"
                      onClick={() => {
                        setActiveThreadId(null);
                        setTimeout(() => scrollToShowTop(), 0);
                      }}
                      style={{ fontSize: 12, padding: "5px 9px", lineHeight: 1.2, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <ArrowLeft size={12} /> back to friend room
                    </button>
                  )}
                </div>
                {chromeThread && !(!chromeThread.isPublic && !activeGroupId) && (
                  <ModeToggle
                    value={mode}
                    onToggle={handleModeToggle}
                    hiddenNewReplies={chromeThread.author === username ? getNewCounts(chromeThread.id).hiddenNew : 0}
                    compact={true}
                  />
                )}
              </div>
              {/* Row 2: compose + progress */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <button
                  className="btn post"
                  onClick={() => user ? openCompose() : onAuthRequired()}
                  style={{ fontSize: 12, padding: "5px 9px", lineHeight: 1.2, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <SquarePen size={13} /> write
                </button>
                <OneSelectProgress
                  show={allShows.find(s => s.id === showId) || { seasons: [10] }}
                  value={effectiveProgress || { s: 1, e: 1 }}
                  onConfirm={handleProgressConfirm}
                  requireConfirm={true}
                  compactLabel={effectiveProgress?.isRewatching ? "rewatch" : "progress"}
                  allowZero={effectiveProgress?.s === 0}
                  rewatchHighest={effectiveProgress?.isRewatching && effectiveProgress.highestS != null && effectiveProgress.highestE != null
                    ? { s: effectiveProgress.highestS, e: effectiveProgress.highestE }
                    : null}
                />
              </div>
            </div>
          ) : (
            /* ── Thread · desktop  OR  Forum (any width) ── */
            <>
            {/* ── Row 1: journal / back button (left) + sort & progress (right) ── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: `${ROW_PAD_Y}px 0` }}>
              {!chromeThread ? (
                /* Forum view: write + (public-only) "+ friend room" button.
                   Hide the friend-room CTA when the user is already inside a
                   friend room — they can't create one from within another. */
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    className="btn post h40"
                    onClick={() => {
                      if (!user) { onAuthRequired(); return; }
                      // Public surface (and dead-code friend-room forum) →
                      // open the V2 compose modal. Inside a friend-room
                      // forum view (activeGroupId set), fall back to the
                      // legacy inline composer since that path was
                      // intentionally out of scope for the modal-compose
                      // arc. Public is the only live caller — activeGroupId
                      // mode is unreachable per HANDOFF.
                      if (activeGroupId) {
                        openCompose();
                      } else {
                        composeModal.open({ showId, returnTo: location.pathname });
                      }
                    }}
                    title="Start a new post"
                    style={{ lineHeight: 1.2, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <SquarePen size={15} /> write
                  </button>
                  {!activeGroupId && (
                    <button
                      className="btn h40"
                      onClick={() => user ? setShowCreateGroupModal(true) : onAuthRequired()}
                      title="Create a friend room for this show"
                      style={{
                        lineHeight: 1.2, flexShrink: 0, whiteSpace: "nowrap",
                        display: "inline-flex", alignItems: "center", gap: 5,
                        background: "transparent", border: "2px solid #fff", color: "#fff",
                      }}
                    >
                      <Plus size={15} /> friend room
                    </button>
                  )}
                </div>
              ) : (
                /* Thread view: back button (friend-room threads only) +
                   write. Public threads' "more entries" button was
                   removed in chunk 5 of the desktop refocus — the
                   banner show-name (now underlined) is the primary
                   back-to-forum affordance. Private threads continue
                   to skip the back button — users return to the
                   journal via the top-nav pill. */
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {activeGroupId && (
                    <button
                      className="btn h40"
                      onClick={() => {
                        setActiveThreadId(null);
                        setTimeout(() => scrollToShowTop(), 0);
                      }}
                      style={{ lineHeight: 1.2, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <ArrowLeft size={14} /> back to friend room
                    </button>
                  )}
                  <button
                    className="btn post h40"
                    onClick={() => user ? openCompose() : onAuthRequired()}
                    title="Start a new post"
                    style={{ lineHeight: 1.2, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <SquarePen size={15} /> write
                  </button>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {!chromeThread && (
                  <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                    <select
                      className="badge h40"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      style={{ fontSize: 12, fontWeight: 700, paddingRight: 28, appearance: "none", WebkitAppearance: "none", cursor: "pointer", color: "var(--dos-border)" }}
                    >
                      <option value="relevance">Relevance</option>
                      <option value="post">Post date</option>
                      <option value="episode">Episode order</option>
                    </select>
                    <ChevronDown size={14} color="var(--dos-border)" style={{ position: "absolute", right: 10, pointerEvents: "none" }} />
                  </div>
                )}
                {chromeThread && !(!chromeThread.isPublic && !activeGroupId) && (
                  <div style={{ transform: "translateX(-10px)" }}>
                    <ModeToggle
                      value={mode}
                      onToggle={handleModeToggle}
                      hiddenNewReplies={chromeThread.author === username ? getNewCounts(chromeThread.id).hiddenNew : 0}
                    />
                  </div>
                )}
                <div style={{ position: "relative", display: "inline-block" }}>
                  <OneSelectProgress
                    show={allShows.find(s => s.id === showId) || { seasons: [10] }}
                    value={effectiveProgress || { s: 1, e: 1 }}
                    onConfirm={handleProgressConfirm}
                    requireConfirm={true}
                    compactLabel={undefined}
                    allowZero={effectiveProgress?.s === 0}
                    rewatchHighest={effectiveProgress?.isRewatching && effectiveProgress.highestS != null && effectiveProgress.highestE != null
                      ? { s: effectiveProgress.highestS, e: effectiveProgress.highestE }
                      : null}
                  />
                  <Tooltip
                    key={String(helpOpen)}
                    text="Did you make a mistake setting your progress? Click here."
                    direction="below"
                    useAbsolute
                    style={{ position: "absolute", top: 4, right: 4, transform: "translate(50%, -50%)", zIndex: 10 }}
                  >
                    <button
                      onClick={() => setHelpOpen(v => !v)}
                      style={{
                        width: 20, height: 20, padding: 0,
                        borderRadius: "50%", border: "none",
                        background: "var(--dos-user)", color: "#fff",
                        fontSize: 12, fontWeight: 800, lineHeight: 1,
                        cursor: "pointer",
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
            {/* Room switcher pills removed — navigation now via header scroll + title icons */}
            </>
          )}
        </div>
      </div>

      {/* Stale-progress nudge — shown once per session after a 12hr gap */}
      {showStaleNudge && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "8px 16px", marginBottom: 0,
          background: "#fff", border: "none",
          borderRadius: 24, fontSize: 13, color: "var(--danger)",
        }}>
          <span>
            Have you watched more of <strong>{show.name}</strong>?{" "}
            If so, update your progress above so you don't leave any accidental spoilers!
          </span>
          <button className="close-x" onClick={onDismissStaleNudge}>
            <X size={14} />
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
          <button className="close-x" onClick={() => setShowAutoFlipMsg(false)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Risky mode first-time explanation modal */}
      {riskyHintPending && (
        <Modal onClose={() => setRiskyHintPending(false)} width="min(520px,92vw)" cardClassName="explanation-card">
          <div style={{ padding: "16px 12px 12px" }}>
            <p style={{ margin: "0 0 32px", fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>
              <AlertTriangle size={14} color="var(--icon-color)" style={{verticalAlign:"middle"}} /> People who have watched further may have responded to a thread that's inside your watch progress. Sidebar can't promise they didn't leave spoilers, but you can take the risk if you like.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn"
                style={{ fontSize: 15, padding: "8px 24px" }}
                onClick={() => {
                  localStorage.setItem("ns_risky_hint_seen", "1");
                  setRiskyHintPending(false);
                  setMode("risky");
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Progress update celebration — shown after every progress update */}
      {showProgressCelebration && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "8px 16px", marginBottom: 0,
          background: "#fff", border: "none",
          borderRadius: 24, fontSize: 13, color: "var(--dos-bg)",
        }}>
          <span>
            Thanks for updating your progress — everyone's looking forward to your new thoughts!
          </span>
          <button className="close-x" onClick={() => setShowProgressCelebration(false)} style={{ border: "2px solid var(--dos-bg)", color: "var(--dos-bg)" }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ? Help panel */}
      {helpOpen && (
        <div style={{
          background: "#fff", borderRadius: 20, padding: "8px 12px",
          marginBottom: 10, display: "flex", flexDirection: "column", gap: 4,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--dos-bg)" }}>Need help?</span>
            <button className="close-x" onClick={() => setHelpOpen(false)}>
              <X size={14} />
            </button>
          </div>
          {[
            {
              label: "I set my rewatch status incorrectly",
              prefill: `Dear beta tester, you can't reach admin through the site yet. Just reach out to Alborz! Or leave your name here and mention what you need fixed. Thanks!`,
            },
            {
              label: "I accidentally set the wrong episode",
              prefill: `Dear beta tester, you can't reach admin through the site yet. Just reach out to Alborz! Or leave your name here and mention what you need fixed. Thanks!`,
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
                padding: "6px 10px", cursor: "pointer", fontSize: 13,
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

      {/* ── Create friend room modal ── */}
      {showCreateGroupModal && (() => {
        // The progress selector only appears when the user has no prior
        // progress for this show. If they're already on a journey for it,
        // their progress doesn't change when creating a room.
        const needsProgressPick = !progress?.[showId];
        const resetModal = () => {
          setShowCreateGroupModal(false);
          setNewGroupName("");
          setNewRoomProgress({ s: 0, e: 0 });
        };
        return (
        <Modal onClose={resetModal} width="min(420px,92vw)">
          <h3 className="title" style={{ margin: "0 0 12px" }}>Create a friend room</h3>
          <p style={{ margin: "0 0 16px", fontSize: 14, opacity: 0.75, lineHeight: 1.5 }}>
            This will be where you and your friends talk about <strong>{show.name}</strong>. Whatever anyone writes here will only be visible to you and your friends. You can decide who to invite later.
          </p>
          <input
            className="badge"
            placeholder="give your room a unique name"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreateGroup(); }}
            style={{ width: "100%", height: 40, marginBottom: 12 }}
            autoFocus
          />
          {needsProgressPick && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, marginBottom: 6, opacity: 0.8 }}>Where are you in the show?</div>
              <OneSelectProgress
                show={allShows.find(s => s.id === showId) || { seasons: [10] }}
                value={newRoomProgress}
                // OneSelectProgress fires onConfirm only from the
                // confirm-modal flow, which is disabled here via
                // requireConfirm={false}. Use onChangeSelected — which
                // fires on every select change regardless of
                // requireConfirm — to track the value, and keep a
                // no-op onConfirm for the required prop.
                onConfirm={() => {}}
                onChangeSelected={(val) => setNewRoomProgress(val)}
                requireConfirm={false}
                allowZero
                plain
              />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={resetModal} disabled={createGroupSubmitting} style={{ background: "var(--danger)", border: "none", color: "#fff" }}>Cancel</button>
            <button className="btn" onClick={handleCreateGroup} disabled={createGroupSubmitting || !newGroupName.trim()} style={{ background: "var(--green)", border: "none", color: "#fff" }}>
              {createGroupSubmitting ? "Creating…" : "Create room"}
            </button>
          </div>
        </Modal>
        );
      })()}

      {/* ── Group settings modal ── */}
      {showGroupSettings && settingsGroupId && (() => {
        const grp = userGroups.find(g => g.id === settingsGroupId);
        const isCreator = !!user && grp?.createdBy === user.id;
        return (
          <Modal onClose={() => setShowGroupSettings(false)} width="min(460px,92vw)">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <h3 className="title" style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 4 }}><Users size={14} color="var(--icon-color)" /> {grp?.name ?? "Room settings"}</h3>
              <button className="close-x" onClick={() => setShowGroupSettings(false)}><X size={14} /></button>
            </div>

            {/* Members list */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.5, marginBottom: 8 }}>Members</div>
              {groupMembersLoading ? (
                <div className="muted" style={{ fontSize: 13 }}>Loading…</div>
              ) : groupMembers.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>No members yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {groupMembers.map(m => (
                    <div key={m.userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>@{m.username}{m.userId === grp?.createdBy ? <Crown size={14} color="var(--icon-color)" /> : ""}</span>
                    </div>
                  ))}
                  {departedMembers.map(d => (
                    <div key={d.userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, opacity: 0.5 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>@{d.username} <em style={{ fontSize: 12 }}>has left the room</em></span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Rename (creator only) */}
            {isCreator && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.5, marginBottom: 8 }}>Rename</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="badge"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleRenameGroup(); }}
                    style={{ flex: 1, height: 36 }}
                  />
                  <button className="btn" onClick={handleRenameGroup} disabled={renameSubmitting || !renameValue.trim()} style={{ background: "var(--green)", border: "none", color: "#fff", whiteSpace: "nowrap" }}>
                    {renameSubmitting ? "Saving…" : "Rename"}
                  </button>
                </div>
              </div>
            )}

            {/* Invite by email (creator only) — multi-row, up to 5 at once.
                The Send button always sits on the LAST row so the visual
                hierarchy stays clear regardless of how many rows are open.
                A circle-plus below the rows adds another field; it
                disappears at MAX_INVITE_ROWS so the cap is implicit in the
                UI rather than gated by an error message. */}
            {isCreator && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.5, marginBottom: 8 }}>Invite by email</div>
                {(() => {
                  const totalRows = inviteRows.length;
                  const isPlural = totalRows > 1;
                  const anyNonEmpty = inviteRows.some(r => r.email.trim() && r.status !== "success");
                  const sendLabel = inviteSubmitting
                    ? "Sending…"
                    : isPlural ? "Send invites" : "Send invite";
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {inviteRows.map((row, i) => {
                        const isLast = i === totalRows - 1;
                        return (
                          <div key={i}>
                            <div style={{ display: "flex", gap: 8 }}>
                              <input
                                className="badge"
                                type="email"
                                placeholder="friend@example.com"
                                value={row.email}
                                onChange={e => updateInviteRowEmail(i, e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") handleSendInvites(); }}
                                style={{ flex: 1, height: 36 }}
                                disabled={inviteSubmitting || row.status === "success"}
                              />
                              {isLast && (
                                <button
                                  className="btn"
                                  onClick={handleSendInvites}
                                  disabled={inviteSubmitting || !anyNonEmpty}
                                  style={{ background: "var(--dos-user)", border: "none", color: "#fff", whiteSpace: "nowrap", minWidth: 120 }}
                                >
                                  {sendLabel}
                                </button>
                              )}
                            </div>
                            {row.status === "success" && (
                              <div style={{ fontSize: 12, color: "#fff", marginTop: 4 }}>
                                ✓ Invite sent.
                              </div>
                            )}
                            {row.status === "error" && row.errorMsg && (
                              <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>
                                {row.errorMsg}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {totalRows < MAX_INVITE_ROWS && (
                        <button
                          type="button"
                          onClick={addInviteRow}
                          disabled={inviteSubmitting}
                          aria-label="Add another email"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#fff",
                            opacity: 0.85,
                            cursor: "pointer",
                            padding: 4,
                            alignSelf: "flex-start",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 12,
                            fontFamily: "inherit",
                          }}
                        >
                          <CirclePlus size={18} strokeWidth={2} />
                          <span>Add another</span>
                        </button>
                      )}
                    </div>
                  );
                })()}
                {inviteSubmitting && (
                  <div style={{ fontSize: 12, color: "#fff", marginTop: 6 }} aria-live="polite">
                    <span className="invite-dot">.</span>
                    <span className="invite-dot">.</span>
                    <span className="invite-dot">.</span>
                  </div>
                )}
                {inviteBatchError && (
                  <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 6 }}>{inviteBatchError}</div>
                )}

                {/* Pending invitations */}
                {(pendingInvitesLoading || pendingInvites.length > 0) && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.4, marginBottom: 6 }}>Pending invites</div>
                    {pendingInvitesLoading ? (
                      <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {pendingInvites.map(inv => (
                          <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, opacity: 0.7 }}>
                            <span>{maskEmail(inv.inviteeEmail)}</span>
                            <span style={{ opacity: 0.5, fontSize: 11 }}>
                              expires {new Date(inv.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Footer row: Leave room on the left; OK on the right once at
                least one invite has been successfully sent (gives the sender
                a clean way to dismiss the modal after confirmation appears). */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <button className="btn" onClick={initiateLeaveGroup} style={{ background: "var(--danger)", border: "none", color: "#fff", minWidth: 120 }}>Leave room</button>
              {inviteRows.some(r => r.status === "success") && (
                <button
                  className="btn"
                  onClick={() => setShowGroupSettings(false)}
                  style={{ background: "transparent", border: "2px solid #fff", color: "#fff", minWidth: 120 }}
                >
                  OK
                </button>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* Leave room confirmation modal */}
      {showLeaveModal === "confirm" && (
        <Modal onClose={() => setShowLeaveModal(null)} width="min(420px,90vw)">
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <h3 className="title" style={{ margin: "0 0 16px", fontSize: 18 }}>Are you sure?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, margin: "0 0 24px" }}>
              You will no longer be able to see your own writing in this room. (Everything will remain intact in case you rejoin later.)
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
              <button className="btn" onClick={executeLeaveGroup} disabled={leaveSubmitting}
                style={{ background: "var(--danger)", border: "none", color: "#fff" }}>
                {leaveSubmitting ? "Leaving…" : "Leave the room"}
              </button>
              <button className="btn" onClick={() => setShowLeaveModal(null)}
                style={{ background: "var(--green)", border: "none", color: "#fff" }}>
                I'll stay
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Last member leave confirmation modal */}
      {showLeaveModal === "last-member" && (
        <Modal onClose={() => setShowLeaveModal(null)} width="min(420px,90vw)">
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <h3 className="title" style={{ margin: "0 0 16px", fontSize: 18 }}>Are you sure?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, margin: "0 0 24px" }}>
              You're the last one in here. Leaving now means deleting the room.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
              <button className="btn" onClick={executeLastMemberLeave} disabled={leaveSubmitting}
                style={{ background: "var(--danger)", border: "none", color: "#fff" }}>
                {leaveSubmitting ? "Leaving…" : "Delete and leave"}
              </button>
              <button className="btn" onClick={() => setShowLeaveModal(null)}
                style={{ background: "var(--green)", border: "none", color: "#fff" }}>
                I'll stay
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Friend-progress post-it: floats in the right margin throughout the
          friend-room view (thread list AND open thread). Only renders inside
          a friend room and only on desktop viewports (component handles the
          width gate + solo-room hide internally). */}
      {activeGroupId && user && (
        <FriendProgressPostIt
          members={roomMembers}
          currentUserId={user.id}
          showId={showId}
          seasons={allShows.find(s => s.id === showId)?.seasons ?? []}
          userProgress={effectiveProgress}
          groupId={activeGroupId}
          onPollOpened={() => setPollRefreshKey(k => k + 1)}
        />
      )}

      {activeGroupId && user && (
        <IncomingPingSticky
          groupId={activeGroupId}
          currentUserId={user.id}
        />
      )}

      {activeGroupId && user && (
        <PollSticky
          groupId={activeGroupId}
          currentUserId={user.id}
          refreshKey={pollRefreshKey}
        />
      )}

      {activeGroupId && user && (
        <SIKWSticky
          groupId={activeGroupId}
          currentUserId={user.id}
          seasons={allShows.find(s => s.id === showId)?.seasons ?? []}
        />
      )}

      {/* CONTENT */}
      {/* Public mode uses the V2 inline-expand feed (cards expand in place;
          /show/:id/thread/:tid deep-links auto-expand that card on mount).
          Private journal posts opened via /show/:id/thread/:tid still use
          the V1 InlineThreadView (journal-style view) — they're not part
          of the public feed and have no inline-expand surface.
          Friend-room mode (dead code per HANDOFF) preserves the legacy
          click-through-to-thread-page rendering as the else-branch below. */}
      {isInlineExpandMode ? (
        <div style={{ marginTop: 8 }}>
          {activeLoading ? (
            <div className="muted" style={{ fontSize: 14, padding: "24px 0" }}>Loading<LoadingDots /></div>
          ) : publicEntries.length === 0 ? (
            effectiveProgress?.s === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "120px 0 48px", gap: 12 }}>
                <EyeOff size={24} color="var(--icon-color)" />
                <div className="muted" style={{ fontSize: 14, textAlign: "center", maxWidth: 360, lineHeight: 1.5 }}>
                  <p style={{ margin: 0 }}>You haven&rsquo;t watched anything so there&rsquo;s nothing to read yet! Come back and update your progress after you&rsquo;ve watched an episode.</p>
                  <p style={{ margin: "12px 0 0" }}>(Or make a post about how excited you are to start watching?!)</p>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "120px 0 48px", gap: 12 }}>
                <Clock size={24} color="var(--icon-color)" />
                <div className="muted" style={{ fontSize: 14, textAlign: "center", maxWidth: 360, lineHeight: 1.5 }}>
                  <p style={{ margin: 0 }}>Sidebar is brand new so there isn&rsquo;t much to see in public spaces yet. It&rsquo;s only a matter of time&hellip;</p>
                  <p style={{ margin: "12px 0 0" }}>But this is your chance to be a pioneer. When you post publicly on your profile, your writing shows up here.</p>
                </div>
              </div>
            )
          ) : (
            <V2RoomFeed
              ref={feedRef}
              entries={publicEntries}
              viewerProgress={effectiveProgress ?? null}
              userId={user?.id ?? null}
              onAuthRequired={onAuthRequired}
              onClickProfile={onClickProfile}
              onEntryExpanded={(tid) => setActiveThreadId(tid)}
              onEntryCollapsed={() => setActiveThreadId(null)}
              initialExpandedThreadId={activeThreadId ?? undefined}
              preserveOrder
              onThreadEdited={(updated) => {
                // Reflect inline edits in the public feed immediately
                // (title / body / preview / SE retag). Without this the
                // edited card keeps showing the pre-edit body until a
                // refresh — same shape as the delete bug.
                setDbThreads(prev => prev.map(t => t.id === updated.id ? updated : t));
              }}
              onThreadDeleted={(tid) => {
                // Mark the soft-deleted thread locally so publicEntries
                // re-derives: thread drops out if no replies, renders as
                // a tombstone if any visible replies still exist. Without
                // this the card lingers in the feed until the user does
                // a hard refresh.
                setDbThreads(prev => prev.map(t => t.id === tid ? { ...t, isDeleted: true } : t));
              }}
            />
          )}
        </div>
      ) : activeThreadId && !thread && threadsLoading ? (
        <div className="muted" style={{ fontSize: 14, padding: "24px 0" }}>Loading<LoadingDots /></div>
      ) : thread ? (
        <InlineThreadView
          thread={{ ...thread, likes: likesThreads[thread.id] ?? thread.likes }}
          show={allShows.find(s => s.id === showId) || { name: showId }}
          inGroupContext={!!activeGroupId}
          groupId={activeGroupId}
          departedUsernames={departedUsernameSet}
          onBack={() => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); }}
          progressForShow={effectiveProgress || { s: 1, e: 1 }}
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
            // Classify from the viewer's context at delete-time. The
            // InlineThreadView's handleDelete chose the right DB op based
            // on thread state (groupIdProp, thread.isPublic); we mirror
            // that into local state here.
            //   - Friend-room context: link removed, thread alive elsewhere.
            //     Filter out of local list.
            //   - Public conversation context (thread was public, no group):
            //     is_public flipped false, thread alive in journal/rooms.
            //     Mirror locally — thread stays in dbThreads with
            //     isPublic=false (next renders filter it out of the public
            //     forum).
            //   - Private journal context (thread was not public, no group):
            //     true soft-delete. Mark isDeleted; bounce to /profile.
            const wasFriendRoomRemoval = !!activeGroupId;
            const wasPublicRemoval = !activeGroupId && !!thread?.isPublic;
            const wasPrivateJournalPost = thread && !thread.isPublic && !activeGroupId;
            if (wasFriendRoomRemoval) {
              setDbThreads(prev => prev.filter(t => t.id !== tid));
            } else if (wasPublicRemoval) {
              setDbThreads(prev => prev.map(t => t.id === tid ? { ...t, isPublic: false } : t));
            } else {
              // Private soft-delete. Mark isDeleted — the thread list decides
              // at render time whether to show a stub (has replies) or hide
              // entirely (no replies) using replyMeta, kept fresh by the
              // realtime subscription.
              setDbThreads(prev => prev.map(t => t.id === tid ? { ...t, isDeleted: true } : t));
            }
            setActiveThreadId(null);
            if (wasPrivateJournalPost) {
              navigate("/journal", { state: { activeTab: showId } });
            } else {
              setTimeout(() => scrollToShowTop(), 0);
            }
          }}
          onThreadMakePrivate={() => {
            // Mark not-public in state — owner still sees it with lock icon, others see nothing
            setDbThreads(prev => prev.map(t => t.id === activeThreadId ? { ...t, isPublic: false } : t));
          }}
          onThreadMakePublic={() => {
            setDbThreads(prev => prev.map(t => t.id === activeThreadId ? { ...t, isPublic: true } : t));
          }}
          onThreadSharedToPublic={(clone) => {
            // Two-instance: add the public clone to the main thread list
            setDbThreads(prev => [clone, ...prev]);
            setReplyCounts(rc => ({ ...rc, [clone.id]: 0 }));
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
          userGroups={userGroups}
          onThreadMovedToGroup={(groupId) => {
            // Switch to the group view where the post now lives
            setActiveGroupId(groupId);
            setActiveThreadId(null);
            setTimeout(() => scrollToShowTop(), 0);
          }}
        />
      ) : (
        <div style={{ marginTop: 8 }}>
          {activeLoading && (
            <div className="muted" style={{ fontSize: 14, padding: "24px 0" }}>Loading<LoadingDots /></div>
          )}
          {!activeLoading && activeList.map((t) => {
            const isNew = !!newHighlights[showId]?.[t.id];
            const isRead = !!visitedThreads[t.id];
            const isOwn = !!username && t.author === username;
            const likeCt = likesThreads[t.id] ?? t.likes;
            const { visibleNew, hiddenNew, totalVisible } = getNewCounts(t.id);
            const hasExternal = hasExternalReplies[t.id] ?? false;
            // In group view use group-scoped reply count; in public view use totalVisible
            const displayReplyCount = activeGroupId
              ? (groupReplyCounts[t.id] ?? 0)
              : totalVisible;

            // Public view: only show public threads (private entries live in journal)
            if (!activeGroupId && !t.isPublic) return null;

            // Moved-to-public stub: show in group view so members know the entry left
            if (activeGroupId && t.isMoved) {
              return (
                <div key={t.id} style={{ position: "relative", margin: "0 0 12px 0" }}>
                  <div className="card threadCard" style={{ margin: 0, opacity: 0.65 }}>
                    <div className="muted" style={{ fontSize: 14, padding: "2px 0", fontStyle: "italic" }}>
                      This entry has been moved to the public room.
                    </div>
                  </div>
                </div>
              );
            }

            // Deleted:
            //   - no replies at all → completely gone
            //   - has any replies → show clickable stub so responses remain accessible
            // Use replyMeta (kept fresh by realtime) rather than displayReplyCount,
            // because groupReplyCounts is not updated by the realtime subscription.
            const anyReplies = (replyMeta[t.id] ?? []).length > 0;
            if (t.isDeleted) {
              if (!anyReplies) return null;
              return (
                <div key={t.id} style={{ position: "relative", margin: "0 0 12px 0" }}>
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
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Mail size={14} color="var(--icon-color)" /> {displayReplyCount}</span>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={t.id} style={{ position: "relative", margin: "0 0 12px 0" }}>
              <div
                className="card threadCard"
                style={{
                  margin: 0,
                  opacity: (isRead && !isOwn) ? 0.5 : 1,
                  cursor: "pointer",
                  position: "relative",
                  paddingTop: 12,
                  paddingBottom: 36,
                  border: isNew ? "4px solid #355eb8" : isOwn ? "4px solid #fff" : "4px solid var(--dos-border)"
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
                    {activeGroupId
                      ? <span style={{ marginRight: 4, display: "inline-flex", alignItems: "center" }}><Users size={14} color="var(--icon-color)" /></span>
                      : !t.isPublic && <span style={{ marginRight: 4, display: "inline-flex", alignItems: "center" }}><LockKeyhole size={14} color="var(--icon-color)" /></span>}
                    {t.titleBase}
                    {t.showId !== "simshow" && (
                      <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 7, whiteSpace: "nowrap" }}>
                        <EpisodeTag
                          season={t.season}
                          episode={t.episode}
                          isRewatch={t.isRewatch}
                          rewatchS={t.rewatchS}
                          rewatchE={t.rewatchE}
                        />
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
                  {activeGroupId && departedMembers.some(d => d.username === t.author) && (
                    <span style={{ fontStyle: "italic", fontSize: 12, opacity: 0.6 }}>has left the room</span>
                  )}
                  {t.isRewatch && (
                    <Tooltip text={`This viewer is also rewatching ${show.name}.`} direction="above">
                      <span style={{ cursor: "default", display: "inline-flex", alignItems: "center" }}><Heart size={14} color="var(--icon-color)" /></span>
                    </Tooltip>
                  )}
                  {" "}• {timeAgo(t.updatedAt)}
                </div>

                <div style={{ marginTop: 6 }}>
                  <div className="clamp3">{t.preview}</div>
                </div>

                <div className="replyCount" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Red 28×28 own-thread badge sits to the LEFT of the reply count.   */}
                  {/* Functionality + styling preserved (size, shadow, color, count,    */}
                  {/* hover-X dismissal, 36h auto-expiry); only position changes.       */}
                  {isOwn && threadDotActive(t.id, hiddenNew > 0) && (
                    <Tooltip
                      text={<>There is new writing in here for you...<br />for when you catch up.</>}
                      direction="above"
                      align="center"
                      width={280}
                    >
                      <ThreadRedDot count={hiddenNew} threadId={t.id} onDismiss={() => setDismissedDots(d => d + 1)} />
                    </Tooltip>
                  )}
                  {(visibleNew > 0 || freshReplyThreadIds[t.id]) ? (
                    <Tooltip
                      text={<>There is new writing<br />in here for you.</>}
                      direction="above"
                      align="center"
                      width={180}
                    >
                      <span className="newReplyBadge"
                        style={{
                          background: "#355eb8", color: "#fff", borderRadius: 9999,
                          padding: "2px 7px", fontWeight: 700,
                        }}>
                        <Mail size={14} color="var(--icon-color)" style={{verticalAlign:"middle"}} /> {displayReplyCount}
                      </span>
                    </Tooltip>
                  ) : (
                    <span>
                      <Mail size={14} color="var(--icon-color)" style={{verticalAlign:"middle"}} /> {displayReplyCount}
                    </span>
                  )}
                </div>
              </div>
              </div>
            );
          })}
          {!activeLoading && activeList.length === 0 && (
            activeGroupId ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "120px 0 48px", gap: 16 }}>
                <div className="muted" style={{ fontSize: 14, textAlign: "center" }}>You can start the conversation or:</div>
                <button
                  className="btn"
                  onClick={() => openGroupSettings(activeGroupId)}
                  style={{ background: "var(--dos-user)", border: "none", color: "#fff", fontSize: 14, padding: "8px 20px" }}
                >
                  <Users size={14} color="#fff" style={{verticalAlign:"middle"}} /> invite friends
                </button>
              </div>
            ) : effectiveProgress?.s === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "120px 0 48px", gap: 12 }}>
                <EyeOff size={24} color="var(--icon-color)" />
                <div className="muted" style={{ fontSize: 14, textAlign: "center", maxWidth: 360, lineHeight: 1.5 }}>
                  <p style={{ margin: 0 }}>You haven&rsquo;t watched anything so there&rsquo;s nothing to read yet! Come back and update your progress after you&rsquo;ve watched an episode.</p>
                  <p style={{ margin: "12px 0 0" }}>(Or make a post about how excited you are to start watching?!)</p>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "120px 0 48px", gap: 12 }}>
                <Clock size={24} color="var(--icon-color)" />
                <div className="muted" style={{ fontSize: 14, textAlign: "center", maxWidth: 360, lineHeight: 1.5 }}>
                  <p style={{ margin: 0 }}>Sidebar is brand new so there isn&rsquo;t much to see in public spaces yet. It&rsquo;s only a matter of time&hellip;</p>
                  <p style={{ margin: "12px 0 0" }}>But this is your chance to be a pioneer. When you post publicly on your profile, your writing shows up here.</p>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Compose modal */}
      {composeOpen && (() => {
        // Determine if destination is a friend room (not private/public/empty)
        const isGroupDest = composeDestination !== "" && composeDestination !== "private" && composeDestination !== "public";
        // Was the modal opened from a friend room context?
        const openedFromGroup = !!activeGroupId;

        // Color scheme: public → yellow, friend room → light-blue, private → green
        const composeBg = composeDestination === "public" ? "#dea838" : isGroupDest ? "#adc8d7" : "#7abd8e";
        // Inverse button color: public → green, friend room → green, private (from group context) → light-blue, private (from public) → yellow
        const inverseBg = composeDestination === "public" ? "#7abd8e"
          : isGroupDest ? "#7abd8e"
          : openedFromGroup ? "#adc8d7" : "#dea838";
        const formReady = !!composeDestination && !!postTitle.trim() && !!postBody.trim();

        // Friend room context has distinct styling (persists even when switching to private)
        const dropdownColor = openedFromGroup ? "#fff" : undefined;
        const dropdownBorder = openedFromGroup ? "2px solid #fff" : undefined;

        // Sorted rooms list — most-recently-active first, matching the
        // default-destination signal so the chosen default sits at the
        // top of the dropdown. Inside a friend room the current room
        // moves to the very top regardless of activity (you're writing
        // here right now — predictable mapping).
        const sortedRooms = (() => {
          const visMap = new Map(roomVisibility.map(v => [v.groupId, v.latestVisibleActivityAt]));
          const arr = [...userGroups].sort((a, b) => {
            const av = visMap.get(a.id) ?? null;
            const bv = visMap.get(b.id) ?? null;
            if (av != null && bv != null) return bv - av;
            if (av != null) return -1;
            if (bv != null) return 1;
            return b.createdAt - a.createdAt;
          });
          if (openedFromGroup && activeGroupId) {
            const idx = arr.findIndex(g => g.id === activeGroupId);
            if (idx > 0) {
              const [cur] = arr.splice(idx, 1);
              arr.unshift(cur);
            }
          }
          return arr;
        })();

        return (
        <Modal onClose={() => closeCompose()} width="min(720px,92vw)" cardStyle={{ background: composeBg }}>
          <button className="close-x" onClick={() => closeCompose()} style={{ position: "absolute", top: 12, right: 16 }}><X size={14} /></button>
          <div style={{ display: "grid", gap: 10 }}>
            {/* ── Destination dropdown ── */}
            {/* Order per chunk 3 of desktop refocus:
                  friend rooms (most-recently-active first, current room
                  pinned top when in friend-room view) → private →
                  public. Inside a friend room the public option is
                  hidden — the spec scopes friend-room writes to rooms
                  + private only. */}
            <div>
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <select
                  className="badge"
                  value={composeDestination}
                  onChange={(e) => setComposeDestination(e.target.value)}
                  style={{ fontSize: 13, fontWeight: 600, paddingRight: 30, appearance: "none", WebkitAppearance: "none", cursor: "pointer", width: "100%", ...(dropdownColor ? { color: dropdownColor, border: dropdownBorder } : {}) }}
                >
                  <option value="" disabled>where do you want to write?</option>
                  {sortedRooms.map(g => (
                    <option key={g.id} value={g.id}>{g.name} friend room</option>
                  ))}
                  <option value="private">private entry</option>
                  {!openedFromGroup && (
                    <option value="public">public entry</option>
                  )}
                </select>
                <ChevronDown size={14} color={dropdownColor ?? "var(--dos-fg)"} style={{ position: "absolute", right: 10, pointerEvents: "none" }} />
              </div>
            </div>

            <input
              className="badge"
              placeholder="Title"
              value={postTitle}
              onChange={(e) => setPostTitle(e.target.value)}
              style={{ width: "100%", height: 40, fontWeight: 700, ...(openedFromGroup ? { border: "none" } : {}) }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <OneSelectProgress
                show={allShows.find(s => s.id === showId) || { seasons: [10] }}
                value={effectiveProgress || { s: 1, e: 1 }}
                onConfirm={handleProgressConfirm}
                requireConfirm={true}
                allowZero={effectiveProgress?.s === 0}
                rewatchHighest={effectiveProgress?.isRewatching && effectiveProgress.highestS != null && effectiveProgress.highestE != null
                  ? { s: effectiveProgress.highestS, e: effectiveProgress.highestE }
                  : null}
                pillBg="transparent"
              />
              <div style={{ fontSize: 13, color: "#fff", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <ArrowLeft size={14} />
                Are you sure your watch progress is up to date?
              </div>
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

            {/* ── Submit row ── */}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
              {promptEntries.length > 0 && (
                <button
                  className="prompt-btn"
                  type="button"
                  onClick={handlePromptBtn}
                  title="Get a writing prompt"
                  style={{ marginRight: "auto", background: inverseBg, border: "none", color: "#fff", height: 34 }}
                >
                  <Sparkles size={14} color="currentColor" style={{verticalAlign:"middle"}} /> want a prompt?
                </button>
              )}
              <button className="btn" onClick={() => closeCompose()} disabled={postSubmitting} style={{ background: "transparent", border: "2px solid var(--danger)", color: "var(--danger)", whiteSpace: "nowrap", fontSize: 13, height: 34 }}>Cancel</button>
              <button
                className="btn compose-submit"
                onClick={submitPost}
                disabled={postSubmitting || !formReady}
                style={{
                  background: inverseBg,
                  border: "none",
                  color: "#fff",
                  whiteSpace: "nowrap",
                  fontSize: 13,
                  minWidth: 130,
                  height: 34,
                  opacity: formReady ? 1 : 0.3,
                }}
              >
                {!formReady && !postSubmitting ? "\u00A0"
                  : postSubmitting ? <>Posting<LoadingDots /></>
                  : composeDestination === "private" ? <><LockKeyhole size={14} style={{verticalAlign:"middle"}} /> save to journal</>
                  : composeDestination === "public" ? <><Globe size={14} style={{verticalAlign:"middle"}} /> post</>
                  : <><Users size={14} style={{verticalAlign:"middle"}} /> send to friends</>}
              </button>
            </div>
          </div>
        </Modal>
        );
      })()}
    </section>
  );
}
