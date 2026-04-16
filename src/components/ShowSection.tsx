import React, { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { SquarePen, X, Globe, Users, Settings, Mail, Sparkles, LockKeyhole, AlertTriangle, Crown, FlaskConical, Heart, ChevronDown, ArrowRight, Plus } from "lucide-react";

const THIRTY_SIX_HOURS = 36 * 60 * 60 * 1000;

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
import { fetchThreadsForShow, insertThread, likeThread as dbLikeThread, unlikeThread as dbUnlikeThread, unlikeReply as dbUnlikeReply, refreshShowIfStale, fetchCitationsForReplies, fetchCitationsForThread, fetchPrompts, logThreadPrompt, fetchFriendGroupsForUser, addThreadToGroup, createFriendGroup, createShow, fetchGroupThreads, fetchFriendGroupMembers, renameFriendGroup, deleteFriendGroup, removeGroupMember, transferGroupOwnership, softDeleteFriendGroup, recordDepartedMember, fetchDepartedMembers, sendInvite, fetchSentInvitations, fetchBrowseProgress } from "../lib/db";
import type { Invitation } from "../types";
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
  shows: showsProp, onShowUpdated, onShowCreated, username, showId, progress, updateProgressFor, newHighlights, setNewHighlights,
  visitedThreads, setVisitedThreads, activeThreadId, setActiveThreadId, onHomepage,
  likesThreads, setLikesThreads, likedByUserThreads, setLikedByUserThreads,
  likesReplies, setLikesReplies, likedByUserReplies, setLikedByUserReplies,
  focusReplyId, onAuthRequired, onClickProfile, navLeft, navRight,
  showStaleNudge, onDismissStaleNudge,
  clearRewatchFor, onOpenFeedback, onSwitchShow, onGroupLeft,
}: any) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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

  // For logged-in users: show progress prompt if progress is unset (e === 0 sentinel)
  const [showLoggedInPicker, setShowLoggedInPicker] = useState(() =>
    !!(user && progress[showId]?.e === 0)
  );
  useEffect(() => {
    if (user && progress[showId]?.e === 0) setShowLoggedInPicker(true);
  }, [showId, user, progress[showId]?.e]);

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

  const [sortBy, setSortBy] = useState<"relevance" | "post" | "episode" | "hot">("relevance");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<"standard" | "risky">("standard");
  const [riskyRevealedIds, setRiskyRevealedIds] = useState<Set<string>>(new Set());
  const [freshReplyThreadIds, setFreshReplyThreadIds] = useState<Record<string, true>>({});
  const [freshReplyIds, setFreshReplyIds] = useState<Record<string, true>>({});

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

  // Hidden tabs (read from localStorage so switch-shows dropdown excludes them)
  const hiddenTabs = useMemo<Set<string>>(() => {
    if (!user) return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(`ns_hidden_tabs_${user.id}`) || "[]")); } catch { return new Set(); }
  }, [user]);

  // ── Friend group view state (Phase 4) ────────────────────────────────────
  // Persist the active group in sessionStorage so a page refresh restores the
  // correct room context (and shows the right "Share to Public" button label).
  const activeGroupSessionKey = `ns_active_group_${showId}`;
  const [activeGroupId, setActiveGroupId] = useState<string | null>(() =>
    sessionStorage.getItem(`ns_active_group_${showId}`) ?? null
  );
  const [groupThreadsData, setGroupThreadsData] = useState<Thread[]>([]);
  const [groupReplyCounts, setGroupReplyCounts] = useState<Record<string, number>>({});
  const [groupThreadsLoading, setGroupThreadsLoading] = useState(false);
  // Create-group modal
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [createGroupSubmitting, setCreateGroupSubmitting] = useState(false);

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
  // Group settings modal
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [settingsGroupId, setSettingsGroupId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<FriendGroupMember[]>([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  // Invite form (inside group settings modal)
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
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
    } else {
      sessionStorage.removeItem(activeGroupSessionKey);
    }
  }, [activeGroupId, activeGroupSessionKey]);

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
    setInviteEmail("");
    setInviteError(null);
    setInviteSuccess(false);
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
        const prog = progress[showId] || { s: 1, e: 1 };
        updateProgressFor?.(showId, { s: prog.s, e: prog.e });
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
      // Navigate to profile page
      navigate("/profile");
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
      navigate("/profile");
      if (typeof onGroupLeft === "function") onGroupLeft();
    } catch {
      alert("Failed to leave room. Please try again.");
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const handleSendInvite = async () => {
    if (!user || !settingsGroupId || !inviteEmail.trim()) return;
    const grp = userGroups.find(g => g.id === settingsGroupId);
    if (!grp) return;
    setInviteError(null);
    setInviteSuccess(false);
    setInviteSubmitting(true);
    try {
      const result = await sendInvite({
        groupId:      settingsGroupId,
        groupName:    grp.name,
        inviteeEmail: inviteEmail.trim(),
        inviterName:  profile?.username ?? "Someone",
      });
      if (!result.ok) {
        const msgs: Record<string, string> = {
          rate_limit:      "You've reached the 10 invitations/day limit. Try again tomorrow.",
          already_invited: "This email already has a pending invite to this room.",
          not_creator:     "Only the room creator can send invitations.",
          invalid_email:   "Please enter a valid email address.",
        };
        setInviteError(msgs[result.error] ?? result.message ?? "Something went wrong. Please try again.");
      } else {
        setInviteSuccess(true);
        setInviteEmail("");
        // Refresh pending invites
        fetchSentInvitations(user.id)
          .then(all => setPendingInvites(all.filter(i => i.groupId === settingsGroupId)))
          .catch(() => {});
      }
    } catch {
      setInviteError("Something went wrong. Please try again.");
    } finally {
      setInviteSubmitting(false);
    }
  };

  const openCompose = () => {
    setComposeOpen(true);
    // Default based on context: friend room → that room, public view → public, otherwise → private
    if (activeGroupId) {
      setComposeDestination(activeGroupId);
    } else if (!activeThreadId || dbThreads.find(t => t.id === activeThreadId)?.isPublic) {
      // In public forum view or viewing a public thread
      setComposeDestination("public");
    } else {
      setComposeDestination("private");
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

  const allThreads = useMemo(() => {
    const dbIds = new Set(dbThreads.map(t => t.id));
    return [...dbThreads, ...seedThreads.filter(t => t.showId === showId && !dbIds.has(t.id))];
  }, [dbThreads, showId]);

  // Also update green-tab tracking to use effectiveProgress
  const baseVisible = useMemo(() => {
    const prog = effectiveProgress;
    let list = allThreads
      .filter(t => canView(t, prog))
      .filter(t => t.isPublic);  // show page is public-only; private entries live in the journal

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
    } else if (sortBy === "rewatchers") {
      list = list.filter(t => t.isRewatch).sort((a, b) => {
        if (a.season !== b.season) return b.season - a.season;
        if (a.episode !== b.episode) return b.episode - a.episode;
        return b.updatedAt - a.updatedAt;
      });
    }
    return list;
  }, [allThreads, progress, searchQuery, sortBy, likesThreads, newHighlights, showId, reWatchOnly]);

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
  // full metadata (replyMeta, etc.) already loaded by fetchThreadsForShow.
  const activeList = useMemo(() => {
    if (!activeGroupId) return displayed;
    const groupIdSet = new Set(groupThreadsData.map(t => t.id));
    return allThreads.filter(t => groupIdSet.has(t.id));
  }, [activeGroupId, groupThreadsData, allThreads, displayed]);

  const activeLoading = activeGroupId ? groupThreadsLoading : threadsLoading;

  // Set of departed usernames for quick lookup in thread/reply rendering
  const departedUsernameSet = useMemo(() => new Set(departedMembers.map(d => d.username)), [departedMembers]);

  const thread = activeThreadId ? allThreads.find(t => t.id === activeThreadId && t.showId === showId) : null;

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
      };

      let t: Awaited<ReturnType<typeof insertThread>>;
      if (composeDestination === "public") {
        t = await insertThread({ ...threadData, isPublic: true });
      } else if (composeDestination === "private") {
        t = await insertThread({ ...threadData, isPublic: false });
      } else {
        // group id
        t = await insertThread({ ...threadData, isPublic: false });
        await addThreadToGroup(t.id, composeDestination).catch(() => {});
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
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
                  <span
                    className="bannerTitle"
                    role={thread ? "button" : "heading"}
                    title={thread ? "Back to room" : "Room"}
                    onClick={thread ? () => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); } : undefined}
                    style={{
                      fontSize: 22, fontWeight: 800, letterSpacing: .5,
                      color: "var(--dos-light)", cursor: thread ? "pointer" : "default", userSelect: "none",
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <Users size={22} color="var(--dos-light)" /> {activeGroup.name.toUpperCase()}
                  </span>
                  <span
                    onClick={() => openGroupSettings(activeGroupId)}
                    title="Room settings"
                    style={{ cursor: "pointer", display: "inline-flex", alignItems: "center" }}
                  >
                    <Settings size={20} color="#fff" />
                  </span>
                </div>
                <button
                  className="btn"
                  onClick={() => setActiveGroupId(null)}
                  style={{
                    whiteSpace: "nowrap", fontSize: 13, flexShrink: 0,
                    padding: "3px 12px",
                    background: "transparent",
                    border: "2px solid #fff",
                    color: "#fff",
                  }}
                >
                  to public conversations <ArrowRight size={14} color="var(--icon-color)" style={{verticalAlign:"middle"}} />
                </button>
              </>
            ) : (
              <span
                className="bannerTitle"
                role={thread ? "button" : "heading"}
                title={thread ? "Back to forum" : "Show"}
                onClick={thread ? () => { setActiveThreadId(null); setTimeout(() => scrollToShowTop(), 0); } : undefined}
                style={{
                  fontSize: 22, fontWeight: 800, letterSpacing: .5,
                  color: "var(--dos-light)", cursor: thread ? "pointer" : "default", userSelect: "none",
                  flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                {!(thread && !thread.isPublic && !activeGroupId) && <Globe size={18} color="#fff" />}
                {showId === "bb"
                  ? "BREAKING BAD (DEMO)"
                  : String((allShows.find(s => s.id === showId)?.name) || showId).toUpperCase()}
              </span>
            )}
          </div>

          <hr className="bleed-line" />

          {/* Row 2 */}
          {thread && isMobile ? (
            /* ── Thread · mobile: two rows so nothing bleeds off-screen ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: `${ROW_PAD_Y}px 0` }}>
              {/* Row 1: back + mode toggle */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      if (!activeGroupId && thread && !thread.isPublic) {
                        navigate("/profile", { state: { activeTab: showId } });
                      } else {
                        setActiveThreadId(null);
                        setTimeout(() => scrollToShowTop(), 0);
                      }
                    }}
                    style={{ fontSize: 12, padding: "5px 9px", lineHeight: 1.2, whiteSpace: "nowrap" }}
                  >
                    {activeGroupId ? "← to friend room" : thread && !thread.isPublic ? "← back to journal" : "← to forum"}
                  </button>
                </div>
                {!(thread && !thread.isPublic && !activeGroupId) && (
                  <ModeToggle
                    value={mode}
                    onToggle={handleModeToggle}
                    hiddenNewReplies={thread.author === username ? getNewCounts(thread.id).hiddenNew : 0}
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
                  compactLabel="progress"
                />
              </div>
            </div>
          ) : (
            /* ── Thread · desktop  OR  Forum (any width) ── */
            <>
            {/* ── Row 1: journal / back button (left) + sort & progress (right) ── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: `${ROW_PAD_Y}px 0` }}>
              {!thread ? (
                /* Forum view: write + "+ friend room" buttons */
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    className="btn post h40"
                    onClick={() => user ? openCompose() : onAuthRequired()}
                    title="Start a new post"
                    style={{ lineHeight: 1.2, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <SquarePen size={15} /> write
                  </button>
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
                </div>
              ) : (
                /* Thread view: context-aware back button + optional globe + journal */
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    className="btn h40"
                    onClick={() => {
                      if (!activeGroupId && !thread.isPublic) {
                        navigate("/profile", { state: { activeTab: showId } });
                      } else {
                        setActiveThreadId(null);
                        setTimeout(() => scrollToShowTop(), 0);
                      }
                    }}
                    style={{ lineHeight: 1.2, whiteSpace: "nowrap" }}
                  >
                    {activeGroupId
                      ? "← to friend room"
                      : !thread.isPublic
                        ? "← back to journal"
                        : "← Back to room"}
                  </button>
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
                {!thread && (
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
                      <option value="hot">Hot</option>
                      <option value="rewatchers">Rewatchers</option>
                    </select>
                    <ChevronDown size={14} color="var(--dos-border)" style={{ position: "absolute", right: 10, pointerEvents: "none" }} />
                  </div>
                )}
                {thread && !(!thread.isPublic && !activeGroupId) && (
                  <div style={{ transform: "translateX(-10px)" }}>
                    <ModeToggle
                      value={mode}
                      onToggle={handleModeToggle}
                      hiddenNewReplies={thread.author === username ? getNewCounts(thread.id).hiddenNew : 0}
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
      {showCreateGroupModal && (
        <Modal onClose={() => { setShowCreateGroupModal(false); setNewGroupName(""); }} width="min(420px,92vw)">
          <h3 className="title" style={{ margin: "0 0 12px" }}>Create a friend room</h3>
          <p style={{ margin: "0 0 16px", fontSize: 14, opacity: 0.75, lineHeight: 1.5 }}>
            A friend room is a private space for a group of people watching this show together. Share entries there and reply in a spoiler-safe context.
          </p>
          <input
            className="badge"
            placeholder={'Room name (e.g. "Sunday watch crew")'}
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreateGroup(); }}
            style={{ width: "100%", height: 40, marginBottom: 12 }}
            autoFocus
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => { setShowCreateGroupModal(false); setNewGroupName(""); }} disabled={createGroupSubmitting} style={{ background: "var(--danger)", border: "none", color: "#fff" }}>Cancel</button>
            <button className="btn" onClick={handleCreateGroup} disabled={createGroupSubmitting || !newGroupName.trim()} style={{ background: "var(--green)", border: "none", color: "#fff" }}>
              {createGroupSubmitting ? "Creating…" : "Create room"}
            </button>
          </div>
        </Modal>
      )}

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

            {/* Invite by email (creator only) */}
            {isCreator && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.5, marginBottom: 8 }}>Invite by email</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="badge"
                    type="email"
                    placeholder="friend@example.com"
                    value={inviteEmail}
                    onChange={e => { setInviteEmail(e.target.value); setInviteError(null); setInviteSuccess(false); }}
                    onKeyDown={e => { if (e.key === "Enter") handleSendInvite(); }}
                    style={{ flex: 1, height: 36 }}
                    disabled={inviteSubmitting}
                  />
                  <button
                    className="btn"
                    onClick={handleSendInvite}
                    disabled={inviteSubmitting || !inviteEmail.trim()}
                    style={{ background: "var(--dos-user)", border: "none", color: "#fff", whiteSpace: "nowrap" }}
                  >
                    {inviteSubmitting ? "Sending…" : "Send invite"}
                  </button>
                </div>
                {inviteSuccess && (
                  <div style={{ fontSize: 12, color: "var(--green)", marginTop: 6 }}>
                    ✓ Invite sent! They'll receive an email with a link.
                  </div>
                )}
                {inviteError && (
                  <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 6 }}>{inviteError}</div>
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
                            <span>{inv.inviteeEmail}</span>
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

            {/* Danger zone */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={initiateLeaveGroup} style={{ background: "var(--danger)", border: "none", color: "#fff" }}>Leave room</button>
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

      {/* CONTENT */}
      {/* If a thread ID is in the URL but threads haven't loaded yet, wait — don't flash the room */}
      {activeThreadId && !thread && threadsLoading ? (
        <div className="muted" style={{ fontSize: 14, padding: "24px 0" }}>Loading…</div>
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
            // Always mark deleted — the thread list decides at render time whether
            // to show a stub (has replies) or hide entirely (no replies) using replyMeta,
            // which is kept fresh by the realtime subscription.
            setDbThreads(prev => prev.map(t => t.id === tid ? { ...t, isDeleted: true } : t));
            setActiveThreadId(null);
            setTimeout(() => scrollToShowTop(), 0);
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
            <div className="muted" style={{ fontSize: 14, padding: "24px 0" }}>Loading…</div>
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
                {isOwn && threadDotActive(t.id, hiddenNew > 0) && (
                  <Tooltip
                    text="There are new responses to you in here (for when you catch up)."
                    direction="right"
                    align="left"
                    useAbsolute
                    style={{ position: "absolute", left: -14, top: "calc(50% - 14px)", zIndex: 1 }}
                  >
                    <ThreadRedDot count={hiddenNew} threadId={t.id} onDismiss={() => setDismissedDots(d => d + 1)} />
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
                    {activeGroupId
                      ? <span style={{ marginRight: 4, display: "inline-flex", alignItems: "center" }}><Users size={14} color="var(--icon-color)" /></span>
                      : !t.isPublic && <span style={{ marginRight: 4, display: "inline-flex", alignItems: "center" }}><LockKeyhole size={14} color="var(--icon-color)" /></span>}
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

                <div className="replyCount">
                  <span className={(visibleNew > 0 || freshReplyThreadIds[t.id]) ? "newReplyBadge" : ""}
                    style={(visibleNew > 0 || freshReplyThreadIds[t.id]) ? {
                    background: "#7abd8e", color: "#fff", borderRadius: 9999,
                    padding: "2px 7px", fontWeight: 700,
                  } : {}}>
                    <Mail size={14} color="var(--icon-color)" style={{verticalAlign:"middle"}} /> {displayReplyCount}
                  </span>
                </div>
              </div>
              </div>
            );
          })}
          {!activeLoading && activeList.length === 0 && (
            activeGroupId ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "120px 0 48px", gap: 16 }}>
                <div className="muted" style={{ fontSize: 14, textAlign: "center" }}>No entries shared to this room yet.</div>
                <button
                  className="btn"
                  onClick={() => openGroupSettings(activeGroupId)}
                  style={{ background: "var(--dos-user)", border: "none", color: "#fff", fontSize: 14, padding: "8px 20px" }}
                >
                  <Users size={14} color="#fff" style={{verticalAlign:"middle"}} /> invite friends
                </button>
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 14 }}>No posts match your watch progress.</div>
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
        const activeGrp = openedFromGroup ? userGroups.find(g => g.id === activeGroupId) : null;

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

        return (
        <Modal onClose={() => closeCompose()} width="min(720px,92vw)" cardStyle={{ background: composeBg }}>
          <button className="close-x" onClick={() => closeCompose()} style={{ position: "absolute", top: 12, right: 16 }}><X size={14} /></button>
          <div style={{ display: "grid", gap: 10 }}>
            {/* ── Destination dropdown ── */}
            <div>
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <select
                  className="badge"
                  value={composeDestination}
                  onChange={(e) => setComposeDestination(e.target.value)}
                  style={{ fontSize: 13, fontWeight: 600, paddingRight: 30, appearance: "none", WebkitAppearance: "none", cursor: "pointer", width: "100%", ...(dropdownColor ? { color: dropdownColor, border: dropdownBorder } : {}) }}
                >
                  <option value="" disabled>where do you want to write?</option>
                  <option value="private">private entry</option>
                  {openedFromGroup && activeGrp && (
                    <option value={activeGrp.id}>{activeGrp.name} friend room</option>
                  )}
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
            <div className="muted" style={{ fontSize: 13 }}>
              Your post is automatically marked to <b>Season {postTagS} Episode {postTagE}</b> and will only show to people who've watched at least that far.
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
                  : postSubmitting ? "Posting…"
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
