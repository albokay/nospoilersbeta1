/**
 * Supabase query functions — typed, snake_case → camelCase mapped.
 * All reads are public (no auth required).
 */
import { supabase } from "./supabaseClient";
import type { Thread, Reply, FriendGroup, FriendGroupMember, Invitation, PeopleGroup, PeopleGroupMember, GroupShowVote } from "../types";
import type { PromptEntry } from "./promptData";
import { repliesByThread } from "./mockData";
import { canView, type ViewerProgress } from "./utils";

// ── Rate-limit helpers ──────────────────────────────────────────────────────

async function checkRateLimit(action: string, maxCount: number, windowSeconds: number = 60): Promise<void> {
  const { data, error } = await supabase.rpc('check_rate_limit', {
    action_name: action,
    max_count: maxCount,
    window_seconds: windowSeconds,
  });
  if (error) throw error;
  if (data === false) throw new Error('Rate limit exceeded. Please wait before trying again.');
}

async function checkRateLimitDaily(action: string, maxDaily: number): Promise<void> {
  const { data, error } = await supabase.rpc('check_rate_limit_daily', {
    action_name: action,
    max_daily: maxDaily,
  });
  if (error) throw error;
  if (data === false) throw new Error('Daily limit reached. Please try again tomorrow.');
}

// ── Input length validation ─────────────────────────────────────────────────

function validateLength(field: string, value: string, min: number, max: number): void {
  const trimmed = value.trim();
  if (trimmed.length < min) throw new Error(`${field} must be at least ${min} character${min > 1 ? 's' : ''}`);
  if (trimmed.length > max) throw new Error(`${field} must be ${max} characters or less`);
}

// ── Shows ────────────────────────────────────────────────────────────────────

export type Show = {
  id: string;
  name: string;
  seasons: number[];
  tvmazeId?: string;
  status?: string;
  isHidden?: boolean;
  lastSyncedAt?: string;
  genres?: string[];
  tvmazeType?: string;
};

export async function fetchShows(): Promise<Show[]> {
  const { data, error } = await supabase
    .from("shows")
    .select("id, name, seasons, tvmaze_id, status, is_hidden, last_synced_at, genres, tvmaze_type")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    seasons: row.seasons,
    tvmazeId: row.tvmaze_id ?? undefined,
    status: row.status ?? "Ended",
    isHidden: row.is_hidden ?? false,
    lastSyncedAt: row.last_synced_at ?? undefined,
    genres: row.genres ?? [],
    tvmazeType: row.tvmaze_type ?? undefined,
  }));
}

// ── Threads ──────────────────────────────────────────────────────────────────

function rowToThread(row: any): Thread {
  return {
    id:             row.id,
    showId:         row.show_id,
    season:         row.season,
    episode:        row.episode,
    author:         row.author_name,
    titleBase:      row.title,
    preview:        row.preview ?? "",
    body:           row.body ?? "",
    createdAt:      new Date(row.created_at).getTime(),
    updatedAt:      new Date(row.updated_at).getTime(),
    likes:          row.likes_count ?? 0,
    isPublic:       row.is_public ?? false,
    isDeleted:      row.is_deleted ?? false,
    isEdited:       row.is_edited ?? false,
    isRewatch:      row.is_rewatch ?? false,
    rewatchS:       row.rewatch_season ?? undefined,
    rewatchE:       row.rewatch_episode ?? undefined,
    isMoved:        row.is_moved ?? false,
    sourceThreadId: row.source_thread_id ?? undefined,
  };
}

// ReplyMeta is the lightweight shape used by thread-card reply counters.
// Includes parent-pointer fields so the counter can walk up the chain and
// exclude orphan replies (a reply whose parent is hidden at the viewer's
// progress). replyToId is populated only by seed data in-memory — the
// reply_to_id DB column was dropped in response-system-migration.sql when
// the reference system replaced it; real DB rows carry only
// referenced_reply_id (set by the composer via Quote / Link).
export type ReplyMeta = {
  id: string;
  season: number;
  episode: number;
  createdAt: number;
  authorId: string;
  replyToId?: string;
  referencedReplyId?: string;
};

export async function fetchThreadsForShow(showId: string): Promise<{
  threads: Thread[];
  replyCounts: Record<string, number>;
  replyMeta: Record<string, ReplyMeta[]>;
  hasExternalReplies: Record<string, boolean>;
}> {
  const { data, error } = await supabase
    .from("threads")
    .select("*, replies!thread_id(id, season, episode, created_at, author_id, referenced_reply_id)")
    .eq("show_id", showId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const threads = (data ?? []).map(rowToThread);
  const replyCounts: Record<string, number> = {};
  const replyMeta: Record<string, ReplyMeta[]> = {};
  const hasExternalReplies: Record<string, boolean> = {};
  for (const row of data ?? []) {
    const replies = row.replies ?? [];
    replyCounts[row.id] = replies.length;
    replyMeta[row.id] = replies.map((r: any) => ({
      id: r.id,
      season: r.season,
      episode: r.episode,
      createdAt: new Date(r.created_at).getTime(),
      authorId: r.author_id,
      referencedReplyId: r.referenced_reply_id ?? undefined,
    }));
    hasExternalReplies[row.id] = replies.some((r: any) => r.author_id !== row.author_id);
  }
  return { threads, replyCounts, replyMeta, hasExternalReplies };
}

// ── Write: threads ───────────────────────────────────────────────────────────

export async function insertThread(data: {
  showId: string; season: number; episode: number;
  authorId: string; authorName: string;
  title: string; preview: string; body: string;
  isPublic: boolean;      // true = visible on aggregated show page
  groupIds?: string[];    // friend groups to share to immediately (Phase 4)
  isRewatch?: boolean;
  // Frozen at-time-of-writing rewatch position. Display-only — season/episode
  // above is the filter tag (= author's highest at time of writing).
  rewatchSeason?: number;
  rewatchEpisode?: number;
}): Promise<Thread> {
  await checkRateLimit('create_thread', 5, 60);
  validateLength("Title", data.title, 1, 200);
  validateLength("Body", data.body, 1, 10000);
  const row = {
    id: crypto.randomUUID(),
    show_id: data.showId, season: data.season, episode: data.episode,
    author_id: data.authorId, author_name: data.authorName,
    title: data.title, preview: data.preview, body: data.body,
    is_public: data.isPublic, likes_count: 0,
    is_rewatch: data.isRewatch ?? false,
    rewatch_season: data.rewatchSeason ?? null,
    rewatch_episode: data.rewatchEpisode ?? null,
  };
  const { data: inserted, error } = await supabase
    .from("threads").insert(row).select().single();
  if (error) throw error;
  return rowToThread(inserted);
}

export async function editThread(threadId: string, title: string, body: string, season: number, episode: number): Promise<void> {
  validateLength("Title", title, 1, 200);
  validateLength("Body", body, 1, 10000);
  const preview = body.slice(0, 240) + (body.length > 240 ? "…" : "");
  const { error } = await supabase
    .from("threads")
    .update({ title, body, preview, season, episode, is_edited: true, updated_at: new Date().toISOString() })
    .eq("id", threadId);
  if (error) throw error;
  // Re-anchor any highlights on this thread to the new body. Best-effort;
  // failures are logged but don't fail the edit. No-op when the thread
  // has no highlights (the RPC iterates an empty set).
  await reanchorHighlightsForTarget({ targetType: "thread", targetId: threadId });
}

export async function deleteThread(threadId: string): Promise<void> {
  // Soft-delete only. The threads_delete RLS policy is admin-only by design
  // (20260413_enable_rls_all_tables.sql:87-89, "hard delete reserved for admin
  // cascade"). A prior hard-delete branch for no-reply threads silently no-op'd
  // against RLS; for friend-room posts it ran group_threads.delete() first and
  // succeeded, then threads.delete() silently failed, orphaning the thread as
  // a bogus private journal entry. Read paths filter is_deleted=true or render
  // a stub when the thread has replies (fetchUserThreads, fetchGroupThreads,
  // ShowSection render, fetchPublic*).
  const { error } = await supabase
    .from("threads")
    .update({ is_deleted: true })
    .eq("id", threadId);
  if (error) throw error;
}

/** Set a thread's public visibility. false = journal-only; true = visible on aggregated show page. */
export async function setThreadPublic(threadId: string, isPublic: boolean): Promise<void> {
  const { error } = await supabase
    .from("threads")
    .update({ is_public: isPublic })
    .eq("id", threadId);
  if (error) throw error;
}

/** @deprecated Use setThreadPublic(id, false) */
export const makeThreadPrivate = (id: string) => setThreadPublic(id, false);
/** @deprecated Use setThreadPublic(id, true) */
export const makeThreadPublic  = (id: string) => setThreadPublic(id, true);

/**
 * Create a public clone of a friend-room thread.
 * The clone gets is_public=true and source_thread_id pointing to the original.
 * The original is left untouched — replies stay fully isolated.
 */
export async function cloneThreadToPublic(threadId: string): Promise<Thread> {
  const { data: orig, error: origErr } = await supabase
    .from("threads")
    .select("*")
    .eq("id", threadId)
    .single();
  if (origErr || !orig) throw origErr ?? new Error("Thread not found");

  const newId = crypto.randomUUID();
  const { data: inserted, error } = await supabase
    .from("threads")
    .insert({
      id:               newId,
      show_id:          orig.show_id,
      season:           orig.season,
      episode:          orig.episode,
      author_id:        orig.author_id,
      author_name:      orig.author_name,
      title:            orig.title,
      preview:          orig.preview,
      body:             orig.body,
      is_public:        true,
      likes_count:      0,
      source_thread_id: threadId,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToThread(inserted);
}

/**
 * Returns true if a public clone already exists for the given friend-room thread.
 * Used to keep the "Share to Public" button disabled after sharing.
 */
export async function hasPublicClone(threadId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("threads")
    .select("id", { count: "exact", head: true })
    .eq("source_thread_id", threadId);
  if (error) return false;
  return (count ?? 0) > 0;
}

/**
 * Mark a friend-room thread as "moved to public".
 * Sets is_moved=true so the friend room shows a stub in place of the full card.
 * Call this AFTER cloneThreadToPublic when the user wants to move (not just share).
 */
export async function markThreadMovedFromGroup(threadId: string): Promise<void> {
  const { error } = await supabase
    .from("threads")
    .update({ is_moved: true, moved_context: "public" })
    .eq("id", threadId);
  if (error) throw error;
}

/**
 * Create a duplicate of a thread without touching the source.
 *
 * "Duplicate" semantics differ from cloneThreadToPublic + markThreadMovedFromGroup:
 *   - The source thread is NEVER mutated. No is_moved flag, no group_threads
 *     row removed. The original stays a fully-live first-class instance.
 *   - The clone gets a fresh thread id; replies are scoped per thread_id so
 *     the two instances' reply chains never bleed.
 *   - source_thread_id on the clone points back at the original (so a future
 *     "duplicate of [original]" hint can render).
 *
 * Powers the "Duplicate to..." UI on public posts (→ friend room) and on
 * friend-room posts (→ public). All copyable columns are preserved including
 * rewatch metadata so the spoiler tag and "written on rewatch" annotation
 * carry over faithfully.
 *
 *  - opts.isPublic: true  → clone is_public=true (lands on the public stream)
 *  - opts.groupId set     → clone is added to that friend room via group_threads
 *
 * Both can apply, but typical callers pick one (public-OR-room target).
 */
export async function cloneThreadAsDuplicate(
  threadId: string,
  opts: { isPublic?: boolean; groupId?: string }
): Promise<Thread> {
  const { data: orig, error: origErr } = await supabase
    .from("threads")
    .select("*")
    .eq("id", threadId)
    .single();
  if (origErr || !orig) throw origErr ?? new Error("Thread not found");

  const newId = crypto.randomUUID();
  const { data: inserted, error } = await supabase
    .from("threads")
    .insert({
      id:               newId,
      show_id:          orig.show_id,
      season:           orig.season,
      episode:          orig.episode,
      author_id:        orig.author_id,
      author_name:      orig.author_name,
      title:            orig.title,
      preview:          orig.preview,
      body:             orig.body,
      is_public:        !!opts.isPublic,
      is_rewatch:       orig.is_rewatch ?? false,
      rewatch_season:   orig.rewatch_season ?? null,
      rewatch_episode:  orig.rewatch_episode ?? null,
      likes_count:      0,
      source_thread_id: threadId,
    })
    .select()
    .single();
  if (error) throw error;

  if (opts.groupId) {
    // Best-effort: matches the live insertThread + addThreadToGroup pattern
    // in ProfilePage.tsx:533 and ShowSection.tsx:1660. If the link fails the
    // clone exists in the user's journal as a phantom private entry until
    // they delete it; the trade-off is consistency with the existing UX.
    await addThreadToGroup(newId, opts.groupId).catch((err) => {
      console.warn(`cloneThreadAsDuplicate: addThreadToGroup failed thread=${newId} group=${opts.groupId}:`, err);
    });
  }

  return rowToThread(inserted);
}

/**
 * Returns the list of friend_group ids this thread already lives in (via
 * group_threads). Used by the "Duplicate to..." dropdown on public posts to
 * hide rooms where the thread is already present, so the user can't create
 * accidental second-duplicates in the same room.
 *
 * Returns an empty array on error (best-effort): caller treats "couldn't
 * determine" as "show all rooms" rather than blocking the dropdown.
 */
export async function fetchGroupIdsForThread(threadId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("group_threads")
    .select("group_id")
    .eq("thread_id", threadId);
  if (error) {
    console.warn("fetchGroupIdsForThread failed:", error);
    return [];
  }
  return (data ?? []).map((r: any) => r.group_id);
}

// ── Likes ─────────────────────────────────────────────────────────────────────

export async function fetchUserThreadLikes(userId: string, threadIds: string[]): Promise<Set<string>> {
  if (!threadIds.length) return new Set();
  const { data } = await supabase
    .from("likes_threads").select("thread_id")
    .eq("user_id", userId).in("thread_id", threadIds);
  return new Set((data ?? []).map((r: any) => r.thread_id));
}

export async function fetchUserReplyLikes(userId: string, replyIds: string[]): Promise<Set<string>> {
  if (!replyIds.length) return new Set();
  const { data } = await supabase
    .from("likes_replies").select("reply_id")
    .eq("user_id", userId).in("reply_id", replyIds);
  return new Set((data ?? []).map((r: any) => r.reply_id));
}

export async function likeThread(userId: string, threadId: string): Promise<void> {
  await checkRateLimit('like', 20, 60);
  await supabase.from("likes_threads").insert({ user_id: userId, thread_id: threadId });
  await supabase.rpc("increment_thread_likes", { thread_id: threadId });
}

export async function unlikeThread(userId: string, threadId: string): Promise<void> {
  await checkRateLimit('like', 20, 60);
  await supabase.from("likes_threads").delete().eq("user_id", userId).eq("thread_id", threadId);
  await supabase.rpc("decrement_thread_likes", { thread_id: threadId });
}

export async function likeReply(userId: string, replyId: string): Promise<void> {
  await checkRateLimit('like', 20, 60);
  await supabase.from("likes_replies").insert({ user_id: userId, reply_id: replyId });
  await supabase.rpc("increment_reply_likes", { reply_id: replyId });
}

export async function unlikeReply(userId: string, replyId: string): Promise<void> {
  await checkRateLimit('like', 20, 60);
  await supabase.from("likes_replies").delete().eq("user_id", userId).eq("reply_id", replyId);
  await supabase.rpc("decrement_reply_likes", { reply_id: replyId });
}

// ── Replies ──────────────────────────────────────────────────────────────────

function rowToReply(row: any): Reply {
  return {
    id:                 row.id,
    threadId:           row.thread_id,
    showId:             row.show_id,
    season:             row.season,
    episode:            row.episode,
    author:             row.author_name,
    body:               row.body,
    createdAt:          new Date(row.created_at).getTime(),
    updatedAt:          new Date(row.updated_at).getTime(),
    likes:              row.likes_count ?? 0,
    replyToId:          row.reply_to_id ?? undefined,
    isDeleted:          row.is_deleted ?? false,
    isEdited:           row.is_edited ?? false,
    isRewatch:          row.is_rewatch ?? false,
    rewatchS:           row.rewatch_season ?? undefined,
    rewatchE:           row.rewatch_episode ?? undefined,
    referenceType:      row.reference_type ?? null,
    referencedReplyId:  row.referenced_reply_id ?? null,
    referencedThreadId: row.referenced_thread_id ?? null,
    quotedText:         row.quoted_text ?? null,
  };
}

/** Single thread by id. Returns null if not found. */
export async function fetchThreadById(threadId: string): Promise<Thread | null> {
  const { data, error } = await supabase
    .from("threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToThread(data) : null;
}

export async function fetchRepliesForThread(threadId: string, groupId?: string | null): Promise<Reply[]> {
  // Seed threads live in memory — return them directly without hitting Supabase
  if (repliesByThread[threadId]) return repliesByThread[threadId];
  let query = supabase
    .from("replies")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  // When viewing inside a friend room, scope replies to that room's group_id
  if (groupId) {
    query = query.eq("group_id", groupId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToReply);
}

/**
 * Public-conversation reply fetcher. Mirrors fetchRepliesForThread but pins
 * group_id IS NULL — the public-conversation channel where everyone reads
 * the same reply stream. Friend-room replies (group_id IS NOT NULL) stay
 * scoped to their room and are excluded here.
 */
export async function fetchPublicRepliesForThread(threadId: string): Promise<Reply[]> {
  if (repliesByThread[threadId]) return repliesByThread[threadId];
  const { data, error } = await supabase
    .from("replies")
    .select("*")
    .eq("thread_id", threadId)
    .is("group_id", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToReply);
}

export async function editReply(replyId: string, body: string, season: number, episode: number): Promise<void> {
  validateLength("Reply", body, 1, 5000);
  const { error } = await supabase
    .from("replies")
    .update({ body, season, episode, is_edited: true, updated_at: new Date().toISOString() })
    .eq("id", replyId);
  if (error) throw error;
  // Re-anchor any highlights on this reply to the new body. Best-effort;
  // failures are logged but don't fail the edit. No-op when the reply
  // has no highlights (the RPC iterates an empty set).
  await reanchorHighlightsForTarget({ targetType: "reply", targetId: replyId });
}

export async function deleteReply(replyId: string): Promise<void> {
  // Soft-delete only. Same RLS-driven silent-failure class as the threads
  // delete bug from baa3c9f (HANDOFF §6 item 17): the replies_delete RLS
  // policy at 20260413_enable_rls_all_tables.sql:109-111 is admin-only
  // (USING (public.is_admin())), while replies_update is owner-allowed.
  // The previous branch tried hard-delete on non-cited replies, which
  // silently no-op'd against RLS for regular users — UI optimistically
  // removed the reply, refresh brought it back. Reported 2026-04-25 by a
  // beta tester who tried to delete their own response.
  //
  // Switching to always-soft-delete (single UPDATE that the owner-can-update
  // policy permits) makes the call work for both authors and admins. Read
  // paths already filter is_deleted correctly:
  //   - MobileThread chainVisible drops is_deleted replies entirely
  //   - fetchGroupThreads selfVisible (db.ts:1542) excludes is_deleted from
  //     reply counts
  //   - utils.visibleRepliesCount applies the same filter (via canView +
  //     parent walk; though it doesn't gate on is_deleted directly, the
  //     desktop side already filters at the render layer)
  //
  // Trade-off: tombstones accumulate in `replies` for non-cited replies
  // nobody can see anymore. Same accepted compromise as threads soft-
  // delete tombstones (§6 item 18). Read paths filter; UX clean. If
  // tombstone volume ever becomes a storage concern, an admin sweep over
  // is_deleted=true rows older than N days handles it.
  //
  // The previous response_citations cleanup is no longer needed: with the
  // reply still in the DB (just flagged is_deleted), citations remain
  // resolvable but the rendered surfaces don't reach them via filtered
  // read paths.
  const { error } = await supabase
    .from("replies")
    .update({ is_deleted: true })
    .eq("id", replyId);
  if (error) throw error;
}

// ── Profile page queries ──────────────────────────────────────────────────────

/**
 * Lightweight query: get show IDs + latest activity timestamp for tab ordering.
 *
 * Signals that count as "activity" for a show tab (all fold into a single
 * per-show max(latestAt)):
 *   1. User's own thread on this show (any destination)
 *   2. User's own reply on any thread on this show
 *   3. Reply on one of the user's own threads, by anyone else — IF that reply
 *      is visible to the user given their current effective progress
 *   4. Thread in a friend room the user is a member of, by anyone else — IF
 *      that thread is visible to the user given their current effective
 *      progress
 *
 * Signals 3 and 4 are spoiler-gated by the user's own progress (using
 * effective progress semantics — highestS/E for rewatchers, s/e otherwise)
 * so spoilers don't move a tab to the top. Signal 5 (new-tab creation)
 * is handled client-side via localStorage; see markTabCreated/readTabCreated.
 *
 * Tabs live on the client as "any show with a progress row" — so a brand-new
 * tab with no activity yet won't appear in this result; ProfilePage fills
 * that gap by falling back to the localStorage tab-creation timestamp.
 */
export async function fetchUserShowActivity(userId: string): Promise<{ showId: string; latestAt: number }[]> {
  // Progress rows drive the visibility filter for signals 3 and 4.
  const { data: progressRows } = await supabase
    .from("progress")
    .select("show_id, season, episode, is_rewatching, highest_season, highest_episode")
    .eq("user_id", userId);
  const effByShow: Record<string, { s: number; e: number }> = {};
  for (const p of progressRows ?? []) {
    const useHighest = (p as any).is_rewatching && (p as any).highest_season != null && (p as any).highest_episode != null;
    effByShow[(p as any).show_id] = {
      s: useHighest ? (p as any).highest_season : (p as any).season,
      e: useHighest ? (p as any).highest_episode : (p as any).episode,
    };
  }
  const isVisible = (sid: string, s: number, e: number): boolean => {
    const eff = effByShow[sid];
    if (!eff) return false;
    return s < eff.s || (s === eff.s && e <= eff.e);
  };

  // (1) User's own threads
  const { data: threadData } = await supabase
    .from("threads")
    .select("id, show_id, updated_at")
    .eq("author_id", userId)
    .eq("is_deleted", false);

  // (2) User's own replies
  const { data: replyData } = await supabase
    .from("replies")
    .select("updated_at, threads!inner(show_id)")
    .eq("author_id", userId)
    .eq("is_deleted", false);

  // (3) Visible replies on user's own threads by others
  const userThreadIds = (threadData ?? []).map((t: any) => t.id);
  let repliesToUser: any[] = [];
  if (userThreadIds.length > 0) {
    try {
      const { data } = await supabase
        .from("replies")
        .select("updated_at, season, episode, threads!inner(show_id)")
        .in("thread_id", userThreadIds)
        .neq("author_id", userId)
        .eq("is_deleted", false);
      repliesToUser = data ?? [];
    } catch (err) {
      console.warn("fetchUserShowActivity: replies-to-user fetch failed (recoverable):", err);
    }
  }

  // (4) Visible threads in user's friend rooms by others
  let groupThreadsData: any[] = [];
  try {
    const { data: memberRows } = await supabase
      .from("friend_group_members")
      .select("group_id")
      .eq("user_id", userId);
    const groupIds = (memberRows ?? []).map((r: any) => r.group_id);
    if (groupIds.length > 0) {
      const { data: linkRows } = await supabase
        .from("group_threads")
        .select("thread_id")
        .in("group_id", groupIds);
      const threadIds = Array.from(new Set((linkRows ?? []).map((r: any) => r.thread_id)));
      if (threadIds.length > 0) {
        const { data } = await supabase
          .from("threads")
          .select("show_id, updated_at, season, episode")
          .in("id", threadIds)
          .neq("author_id", userId)
          .eq("is_deleted", false);
        groupThreadsData = data ?? [];
      }
    }
  } catch (err) {
    console.warn("fetchUserShowActivity: group-threads fetch failed (recoverable):", err);
  }

  const latest: Record<string, number> = {};
  const bump = (sid: string, ts: number) => {
    if (!latest[sid] || ts > latest[sid]) latest[sid] = ts;
  };
  for (const row of threadData ?? []) bump((row as any).show_id, new Date((row as any).updated_at).getTime());
  for (const row of replyData ?? []) {
    const sid = (row as any).threads?.show_id;
    if (sid) bump(sid, new Date((row as any).updated_at).getTime());
  }
  for (const row of repliesToUser) {
    const sid = (row as any).threads?.show_id;
    if (sid && isVisible(sid, (row as any).season, (row as any).episode)) {
      bump(sid, new Date((row as any).updated_at).getTime());
    }
  }
  for (const row of groupThreadsData) {
    const sid = (row as any).show_id;
    if (sid && isVisible(sid, (row as any).season, (row as any).episode)) {
      bump(sid, new Date((row as any).updated_at).getTime());
    }
  }

  return Object.entries(latest)
    .map(([showId, latestAt]) => ({ showId, latestAt }))
    .sort((a, b) => b.latestAt - a.latestAt);
}

/**
 * Mark a show tab as newly created for a given user. Writes a timestamp to
 * localStorage so ProfilePage's showTabOrder can float new tabs to the front
 * even before any real activity exists for them. Called from journal / friend
 * room / invite-accept creation paths.
 */
export function markTabCreated(userId: string, showId: string): void {
  try {
    localStorage.setItem(`ns_tab_created_${userId}_${showId}`, String(Date.now()));
  } catch {}
}

/** Read the tab-creation timestamp written by markTabCreated. Returns 0 if not set. */
export function readTabCreated(userId: string, showId: string): number {
  try {
    const raw = localStorage.getItem(`ns_tab_created_${userId}_${showId}`);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function fetchUserThreads(
  userId: string,
  showId?: string
): Promise<{ thread: Thread; groupId?: string; groupName?: string; allGroups: { groupId: string; groupName: string }[] }[]> {
  let query = supabase
    .from("threads")
    .select("*")
    .eq("author_id", userId)
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false });
  if (showId) query = query.eq("show_id", showId);
  const { data, error } = await query;
  if (error) throw error;
  const threads = (data ?? []).map(rowToThread);
  if (!threads.length) return [];

  // Enrich with group context. Pre-2026-05-08 this only ever returned
  // one group per thread (single-key map overwrite), which was fine
  // when the live composer was exclusive (private | public | one-room).
  // The v2 compose path (checkpoint 6) creates multi-room threads, so
  // we now collect the FULL set into `allGroups`. The legacy
  // `groupId`/`groupName` fields stay (= first group) for backwards
  // compatibility with the live ProfilePage.
  const threadIds = threads.map(t => t.id);
  const groupsByThreadId: Record<string, { groupId: string; groupName: string }[]> = {};
  const { data: gtData } = await supabase
    .from("group_threads")
    .select("thread_id, friend_groups(id, name)")
    .in("thread_id", threadIds);
  for (const row of gtData ?? []) {
    const g = (row as any).friend_groups;
    if (g) {
      const tid = (row as any).thread_id as string;
      if (!groupsByThreadId[tid]) groupsByThreadId[tid] = [];
      groupsByThreadId[tid].push({ groupId: g.id, groupName: g.name });
    }
  }

  return threads.map(thread => {
    const all = groupsByThreadId[thread.id] ?? [];
    const first = all[0];
    return {
      thread,
      groupId: first?.groupId,
      groupName: first?.groupName,
      allGroups: all,
    };
  });
}

// Replies in threads the user started, not written by the user themselves
export async function fetchRepliesToUserThreads(
  userId: string,
  showId?: string
): Promise<{ reply: Reply; thread: Thread; groupId?: string; groupName?: string }[]> {
  let tQuery = supabase
    .from("threads")
    .select("*")
    .eq("author_id", userId)
    .eq("is_deleted", false);
  if (showId) tQuery = tQuery.eq("show_id", showId);
  const { data: threadData, error: tErr } = await tQuery;
  if (tErr) throw tErr;
  const threads = (threadData ?? []).map(rowToThread);
  if (!threads.length) return [];

  const threadIds = threads.map(t => t.id);
  const threadById: Record<string, Thread> = {};
  for (const t of threads) threadById[t.id] = t;

  // Fetch group context + replies in parallel (both depend only on threadIds)
  const groupByThreadId: Record<string, { groupId: string; groupName: string }> = {};
  const [gtResult, replyResult] = await Promise.all([
    supabase
      .from("group_threads")
      .select("thread_id, friend_groups(id, name)")
      .in("thread_id", threadIds),
    supabase
      .from("replies")
      .select("*")
      .in("thread_id", threadIds)
      .neq("author_id", userId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  for (const row of gtResult.data ?? []) {
    const g = (row as any).friend_groups;
    if (g) groupByThreadId[row.thread_id] = { groupId: g.id, groupName: g.name };
  }
  const replyData = replyResult.data;
  if (replyResult.error) throw replyResult.error;

  return (replyData ?? []).map((row: any) => {
    const thread = threadById[row.thread_id];
    const group = groupByThreadId[row.thread_id];
    return { reply: rowToReply(row), thread, groupId: group?.groupId, groupName: group?.groupName };
  }).filter(x => x.thread);
}

/** Replies written BY the user, with their parent thread for context. */
export async function fetchUserReplies(userId: string, showId?: string): Promise<{ reply: Reply; thread: Thread; groupId?: string }[]> {
  let query = supabase
    .from("replies")
    .select("*")
    .eq("author_id", userId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(200);
  if (showId) query = query.eq("show_id", showId);
  const { data, error } = await query;
  if (error) throw error;
  // Surface group_id per row alongside rowToReply. groupId is the room
  // context the reply was written in (replies.group_id, nullable for
  // public replies). V3 journal uses this to route friend-room reply
  // clicks to /v2/room/<groupId>; null/undefined → V1 path.
  const repliesWithGroup = (data ?? []).map((row: any) => ({
    reply: rowToReply(row),
    groupId: (row.group_id as string | null) ?? undefined,
  }));
  const threadIds = [...new Set(repliesWithGroup.map(x => x.reply.threadId))];
  if (!threadIds.length) return [];
  const { data: tData, error: tErr } = await supabase
    .from("threads").select("*").in("id", threadIds);
  if (tErr) throw tErr;
  const threadById: Record<string, Thread> = {};
  for (const t of (tData ?? []).map(rowToThread)) threadById[t.id] = t;
  return repliesWithGroup
    .map(({ reply, groupId }) => {
      const t = threadById[reply.threadId];
      if (!t || t.isDeleted) return null;
      return { reply, thread: t, groupId };
    })
    .filter(Boolean) as { reply: Reply; thread: Thread; groupId?: string }[];
}

export async function fetchLikedThreads(userId: string, showId?: string): Promise<(Thread & { groupId?: string })[]> {
  let query = supabase
    .from("likes_threads")
    .select("threads(*)")
    .eq("user_id", userId);
  if (showId) query = query.eq("threads.show_id", showId);
  const { data, error } = await query;
  if (error) throw error;
  const threads = (data ?? [])
    .map((row: any) => row.threads)
    .filter((t: any) => t && !t.is_deleted)
    .map(rowToThread)
    .sort((a: Thread, b: Thread) => b.updatedAt - a.updatedAt);
  if (!threads.length) return threads;
  // Resolve per-thread group context for the viewer: look up which
  // friend rooms (the viewer is a member of) host each thread via
  // group_threads. Two-step query mirrors fetchUserShowActivity's
  // pattern. Threads not hosted in any viewer-member room get
  // groupId=undefined (public/private only → V1 path on click).
  const threadIds = threads.map(t => t.id);
  const { data: memberRows } = await supabase
    .from("friend_group_members")
    .select("group_id")
    .eq("user_id", userId);
  const userGroupIds = (memberRows ?? []).map((r: any) => r.group_id);
  const groupByThreadId: Record<string, string> = {};
  if (userGroupIds.length > 0) {
    const { data: gtRows } = await supabase
      .from("group_threads")
      .select("thread_id, group_id")
      .in("thread_id", threadIds)
      .in("group_id", userGroupIds);
    for (const row of gtRows ?? []) {
      // First-write wins (each user is in at most one room per thread
      // in practice; see HANDOFF §3 + the V3 journal nav arc).
      if (!groupByThreadId[(row as any).thread_id]) {
        groupByThreadId[(row as any).thread_id] = (row as any).group_id;
      }
    }
  }
  return threads.map(t => ({ ...t, groupId: groupByThreadId[t.id] }));
}

export async function fetchLikedReplies(userId: string, showId?: string): Promise<{ reply: Reply; thread: Thread; groupId?: string }[]> {
  let query = supabase
    .from("likes_replies")
    .select("replies(*)")
    .eq("user_id", userId);
  if (showId) query = query.eq("replies.show_id", showId);
  const { data, error } = await query;
  if (error) throw error;
  // Surface group_id per row alongside rowToReply (see fetchUserReplies
  // for rationale). The embedded `replies(*)` already returns group_id
  // among the reply columns.
  const repliesWithGroup = (data ?? [])
    .map((row: any) => row.replies)
    .filter((r: any) => r && !r.is_deleted)
    .map((r: any) => ({
      reply: rowToReply(r),
      groupId: (r.group_id as string | null) ?? undefined,
    }));
  const threadIds = [...new Set(repliesWithGroup.map(x => x.reply.threadId))];
  if (!threadIds.length) return [];
  const { data: tData, error: tErr } = await supabase
    .from("threads").select("*").in("id", threadIds);
  if (tErr) throw tErr;
  const threadById: Record<string, Thread> = {};
  for (const t of (tData ?? []).map(rowToThread)) threadById[t.id] = t;
  return repliesWithGroup
    .map(({ reply, groupId }) => {
      const t = threadById[reply.threadId];
      if (!t || t.isDeleted) return null;
      return { reply, thread: t, groupId };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.reply.updatedAt - a.reply.updatedAt) as { reply: Reply; thread: Thread; groupId?: string }[];
}

// ── Create show ──────────────────────────────────────────────────────────────

export async function createShow(show: {
  id: string;
  name: string;
  seasons: number[];
  tvmazeId?: string;
  status?: string;
}): Promise<Show> {
  const now = new Date().toISOString();
  const insertRow = {
    id: show.id,
    name: show.name,
    seasons: show.seasons,
    tvmaze_id: show.tvmazeId ?? null,
    status: show.status ?? "Ended",
    is_hidden: false,
    last_synced_at: now,
  };

  // Try fresh INSERT first. On unique-key conflict (row already exists)
  // we fall through to a targeted UPDATE that refreshes only seasons +
  // last_synced_at. That keeps the caller's current TVMaze episode
  // snapshot in sync without clobbering identity fields (name, tvmaze_id,
  // status, is_hidden) — some callers (ShowSection auto-onboard paths)
  // pass only partial info and would null out tvmaze_id / change status
  // if we used a blanket upsert.
  const mapRow = (r: any): Show => ({
    id: r.id,
    name: r.name,
    seasons: r.seasons,
    tvmazeId: r.tvmaze_id ?? undefined,
    status: r.status ?? "Ended",
    isHidden: r.is_hidden ?? false,
  });

  const { data: inserted, error: insertErr } = await supabase
    .from("shows").insert(insertRow).select().single();
  if (inserted) return mapRow(inserted);

  // Insert failed — most commonly a unique-key conflict because the row
  // already exists. Targeted UPDATE refreshes the TVMaze-sourced seasons
  // and sync timestamp. If this also fails, throw the original insert
  // error for the caller.
  const { data: updated, error: updateErr } = await supabase
    .from("shows")
    .update({ seasons: show.seasons, last_synced_at: now })
    .eq("id", show.id)
    .select().single();
  if (updated) return mapRow(updated);

  // Last resort: return whatever is in the DB so onboarding can still
  // proceed even if both writes failed (e.g. transient network error).
  const { data: existing } = await supabase
    .from("shows").select().eq("id", show.id).single();
  if (existing) return mapRow(existing);

  throw insertErr ?? updateErr ?? new Error("createShow failed");
}

// ── Staleness refresh ─────────────────────────────────────────────────────────

export async function refreshShowIfStale(show: Show): Promise<Show | null> {
  // Gate only on having a tvmazeId + the 7-day cadence. Previously this also
  // required show.status === "Running", but the create paths normalize any
  // non-Running status to "Ended" (SearchShows.tsx, ShowSection.tsx) — which
  // meant unreleased shows ("To Be Determined" on TVMaze) got stored as
  // "Ended" and then never refreshed when they started airing. Lifting the
  // status gate lets unreleased shows transition cleanly. Extra API cost is
  // trivial (TVMaze is free + unauth + our cadence is weekly).
  if (!show.tvmazeId) return null;
  // Twelve-hour cadence strikes a balance between "new episode options
  // appear within half a day of airing" and "don't hammer TVMaze with
  // redundant calls." Refresh is async / non-blocking so the page-load
  // cost of a cadence hit is invisible to the user.
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const lastSync = show.lastSyncedAt ? new Date(show.lastSyncedAt).getTime() : 0;
  if (Date.now() - lastSync < TWELVE_HOURS) return null;

  // Fetch show metadata (genres, type, status) and episodes from TVmaze in parallel
  const [showRes, epRes] = await Promise.all([
    fetch(`https://api.tvmaze.com/shows/${show.tvmazeId}`),
    fetch(`https://api.tvmaze.com/shows/${show.tvmazeId}/episodes`),
  ]);
  if (!epRes.ok) return null;

  const episodes: any[] = await epRes.json();
  const nowIso = new Date().toISOString();
  const bySeason: Record<number, number> = {};
  for (const ep of episodes) {
    const isRegular = ep.type === "regular" || !ep.type;
    // Only count episodes that have actually aired. airstamp is ISO 8601
    // with timezone; lexicographic compare against now-ISO is correct.
    const hasAired = typeof ep.airstamp === "string" && ep.airstamp <= nowIso;
    if (isRegular && hasAired) {
      bySeason[ep.season] = (bySeason[ep.season] ?? 0) + 1;
    }
  }
  const seasonKeys = Object.keys(bySeason).map(Number);
  const maxSeason = seasonKeys.length ? Math.max(...seasonKeys) : 0;
  const seasons: number[] = [];
  for (let i = 1; i <= maxSeason; i++) seasons.push(bySeason[i] ?? 0);
  // seasons may be empty for unreleased shows — that's a valid state. Still
  // proceed with the update so last_synced_at + status get refreshed and the
  // next weekly check picks up the show's transition to airing.

  let genres: string[] = show.genres ?? [];
  let tvmazeType: string | undefined = show.tvmazeType;
  let tvmazeStatus: string | undefined = undefined;
  if (showRes.ok) {
    const showData = await showRes.json();
    if (Array.isArray(showData.genres)) genres = showData.genres;
    if (showData.type) tvmazeType = showData.type;
    if (showData.status) tvmazeStatus = showData.status;
  }
  // Normalize to Running|Ended to match the create-path convention used by
  // SearchShows.tsx and ShowSection.tsx. Keeps prompts.ts's status === "Running"
  // checks consistent across create + refresh. Falls back to the existing
  // stored status when TVMaze metadata isn't available in this round.
  const normalizedStatus = tvmazeStatus
    ? (tvmazeStatus === "Running" ? "Running" : "Ended")
    : (show.status ?? "Ended");

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("shows")
    .update({ seasons, last_synced_at: now, genres, tvmaze_type: tvmazeType ?? null, status: normalizedStatus })
    .eq("id", show.id);
  if (error) return null;

  return { ...show, seasons, lastSyncedAt: now, genres, tvmazeType, status: normalizedStatus };
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function adminDeleteShow(showId: string): Promise<void> {
  // 1. fetch all thread ids for this show (needed to delete replies)
  const { data: threads } = await supabase.from("threads").select("id").eq("show_id", showId);
  const threadIds = (threads ?? []).map((t: any) => t.id);

  // 2. delete replies for those threads
  if (threadIds.length) {
    await supabase.from("replies").delete().in("thread_id", threadIds);
  }

  // 3. delete threads directly by show_id (avoids silent batch-size failures)
  await supabase.from("threads").delete().eq("show_id", showId);

  // 4. delete progress rows
  await supabase.from("progress").delete().eq("show_id", showId);

  // 5. delete the show itself
  const { error } = await supabase.from("shows").delete().eq("id", showId);
  if (error) throw error;
}

export async function adminToggleHidden(showId: string, isHidden: boolean): Promise<void> {
  const { error } = await supabase.from("shows").update({ is_hidden: isHidden }).eq("id", showId);
  if (error) throw error;
}

// ── Admin: per-user overview + drill-down activity ────────────────────────────
// Both call SECURITY DEFINER RPCs gated on public.is_admin(). The RPCs surface
// auth.users.email + last_sign_in_at to admins only — RLS still hides the
// auth schema from regular clients. Migration: 20260426_admin_user_overview.sql.

export type AdminUserOverviewRow = {
  userId: string;
  username: string | null;
  email: string | null;
  signupAt: number | null;          // ms
  lastSignInAt: number | null;      // ms — Supabase auth.users.last_sign_in_at
  roomsCount: number;
  distinctCoMembers: number;
  invitesSent: number;
  threadsCount: number;             // real-room threads (excl. soft-deleted)
  repliesCount: number;             // real-room replies (excl. soft-deleted)
  threadsCountTsp: number;          // TSP-room threads (excl. soft-deleted)
  repliesCountTsp: number;          // TSP-room replies (excl. soft-deleted)
  lastActivityAt: number | null;    // ms — MAX(updated_at) across threads + replies
  postsPerWeek: number;             // (threads + replies) / max(1 week, weeks since signup)
};

// Owner / test accounts excluded from the admin overview. Self-filter so
// the panel reflects real-user activity. Comparison is case-insensitive +
// trimmed to defend against any whitespace / casing oddities at the
// auth.users.email source. Edit this list to add/remove exclusions; no SQL
// re-run required (filter is client-side).
const ADMIN_OVERVIEW_EXCLUDED_EMAILS = new Set([
  "akamalizad@gmail.com",
  "alkamalizad@yahoo.com",
]);

export async function fetchAdminUserOverview(): Promise<AdminUserOverviewRow[]> {
  const { data, error } = await supabase.rpc("get_admin_user_overview");
  if (error) throw error;
  return (data ?? [])
    .filter((r: any) => {
      const email = (r.email ?? "").toLowerCase().trim();
      return !ADMIN_OVERVIEW_EXCLUDED_EMAILS.has(email);
    })
    .map((r: any) => ({
    userId:             r.user_id,
    username:           r.username ?? null,
    email:              r.email ?? null,
    signupAt:           r.signup_at ? new Date(r.signup_at).getTime() : null,
    lastSignInAt:       r.last_sign_in_at ? new Date(r.last_sign_in_at).getTime() : null,
    roomsCount:         r.rooms_count ?? 0,
    distinctCoMembers:  r.distinct_co_members ?? 0,
    invitesSent:        r.invites_sent ?? 0,
    threadsCount:       r.threads_count ?? 0,
    repliesCount:       r.replies_count ?? 0,
    threadsCountTsp:    r.threads_count_tsp ?? 0,
    repliesCountTsp:    r.replies_count_tsp ?? 0,
    lastActivityAt:     r.last_activity_at ? new Date(r.last_activity_at).getTime() : null,
    postsPerWeek:       Number(r.posts_per_week ?? 0),
  }));
}

export type AdminUserActivityRow = {
  kind: "thread" | "reply";
  threadId: string;
  replyId: string | null;
  showId: string;
  groupId: string | null;
  groupName: string | null;
  isPublic: boolean | null;        // thread-only — null on replies
  isDeleted: boolean;
  season: number;
  episode: number;
  body: string;                     // truncated to 200 chars server-side
  title: string | null;             // thread-only — null on replies
  createdAt: number;                // ms
};

export async function fetchAdminUserActivity(userId: string): Promise<AdminUserActivityRow[]> {
  const { data, error } = await supabase.rpc("get_admin_user_activity", { p_user_id: userId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    kind:       r.kind,
    threadId:   r.thread_id,
    replyId:    r.reply_id ?? null,
    showId:     r.show_id,
    groupId:    r.group_id ?? null,
    groupName:  r.group_name ?? null,
    isPublic:   r.is_public ?? null,
    isDeleted:  !!r.is_deleted,
    season:     r.season,
    episode:    r.episode,
    body:       r.body ?? "",
    title:      r.title ?? null,
    createdAt:  r.created_at ? new Date(r.created_at).getTime() : 0,
  }));
}

// ── Progress ──────────────────────────────────────────────────────────────────

export async function fetchProgress(userId: string): Promise<Record<string, import("../types").ProgressEntry>> {
  // Try-with-fallback: select including the 2026-05-11 shelf-display columns
  // first; on failure (column doesn't exist — code-first deploy before the
  // migration runs) fall back to the legacy select. Same pattern as the bio
  // migration. Safe to drop the fallback once every env has the columns.
  let data: any[] | null = null;
  let usedFallback = false;
  {
    const res = await supabase
      .from("progress")
      .select("show_id, season, episode, is_rewatching, rewatch_season, rewatch_episode, highest_season, highest_episode, stopped_watching, canon_pin, watching_quote, want_reason, canon_take, stopped_reason, shelf_override, shelf_position")
      .eq("user_id", userId);
    if (res.error) {
      const legacy = await supabase
        .from("progress")
        .select("show_id, season, episode, is_rewatching, rewatch_season, rewatch_episode, highest_season, highest_episode, stopped_watching, canon_pin, watching_quote, want_reason, canon_take, stopped_reason")
        .eq("user_id", userId);
      if (legacy.error) throw legacy.error;
      data = legacy.data;
      usedFallback = true;
    } else {
      data = res.data;
    }
  }
  const result: Record<string, import("../types").ProgressEntry> = {};
  for (const row of data ?? []) {
    result[row.show_id] = {
      s: row.season,
      e: row.episode,
      isRewatching:  row.is_rewatching  ?? false,
      rewatchS:      row.rewatch_season  ?? undefined,
      rewatchE:      row.rewatch_episode ?? undefined,
      highestS:      row.highest_season  ?? undefined,
      highestE:      row.highest_episode ?? undefined,
      // v2 columns (2026-05-08 migration). Live UI ignores these;
      // v2 components (profile shelves, journal stop-watching action)
      // consume them as those checkpoints land.
      stoppedWatching: row.stopped_watching ?? false,
      canonPin:        row.canon_pin ?? false,
      watchingQuote:   row.watching_quote ?? undefined,
      wantReason:      row.want_reason ?? undefined,
      canonTake:       row.canon_take ?? undefined,
      stoppedReason:   row.stopped_reason ?? undefined,
      // v2 profile-display columns (2026-05-11). null when on legacy fallback.
      shelfOverride:   usedFallback ? null : (row.shelf_override ?? null),
      shelfPosition:   usedFallback ? null : (row.shelf_position ?? null),
    };
  }
  return result;
}

// === v2 setters (2026-05-08) ====================================================
//
// Owner-only writes to the new progress columns. RLS enforces caller-owns-row.
// All four helpers operate on a (user_id, show_id) row that's guaranteed to
// exist — every show in a user's journal has an existing progress row from
// onboarding. We UPDATE rather than UPSERT so a missing row throws (signals
// a programming error: trying to set a v2 field for a show the user doesn't
// have in their journal).
//
// Length validation for the four blurb fields is enforced here (not in SQL)
// so we can give callers a Promise rejection with a useful message rather
// than a Postgres check-constraint error. Numbers picked to match the spirit
// of LIMITS in db.ts:12 (titles ~120, bodies ~5000): blurbs are short prose,
// 280 chars each (one tweet's worth).

const V2_BLURB_MAX = 280;

export async function setStoppedWatching(
  userId: string,
  showId: string,
  value: boolean
): Promise<void> {
  const { error } = await supabase
    .from("progress")
    .update({ stopped_watching: value })
    .eq("user_id", userId)
    .eq("show_id", showId);
  if (error) throw error;
}

// Full stop-watching cascade (2026-05-08, v2 checkpoint 8). For each
// friend room the user is in on this show:
//   - if the user owns the room AND others remain, transfer ownership
//     to the oldest other member (live ShowSection convention)
//   - record departure (so remaining members see "has left the room")
//   - remove the user's membership
//   - if the user was the last member, soft-delete the room instead
//     (skip the record/remove in that branch — group is gone anyway)
//
// Order matters: cascade first, flag last. If the cascade fails partway,
// the stopped_watching flag stays false and the user can retry — every
// step (`removeGroupMember`, `recordDepartedMember`, `softDeleteFriendGroup`)
// is idempotent enough for re-runs against the partial state.
//
// Returns counts so the UI can report what happened ("you left N rooms,
// 1 was soft-deleted because you were the last member").
export async function stopWatching(
  userId: string,
  username: string,
  showId: string
): Promise<{ groupsLeft: number; groupsSoftDeleted: number }> {
  const groups = await fetchFriendGroupsForUser(userId, showId);
  let groupsLeft = 0;
  let groupsSoftDeleted = 0;

  for (const g of groups) {
    const members = await fetchFriendGroupMembers(g.id);
    const others = members.filter((m) => m.userId !== userId);
    if (others.length === 0) {
      await softDeleteFriendGroup(g.id);
      groupsSoftDeleted++;
    } else {
      if (g.createdBy === userId) {
        const oldestOther = [...others].sort((a, b) => a.joinedAt - b.joinedAt)[0];
        await transferGroupOwnership(g.id, oldestOther.userId);
      }
      await recordDepartedMember(g.id, userId, username);
      await removeGroupMember(g.id, userId);
      groupsLeft++;
    }
  }

  // Flag last so a partial-failure retry resumes cleanly.
  await setStoppedWatching(userId, showId, true);
  return { groupsLeft, groupsSoftDeleted };
}

/**
 * "Remove this show from my profile entirely" — stronger sibling of
 * stopWatching. Runs the same room cascade (leave/transfer/soft-delete)
 * AND deletes the user's progress row so the show no longer appears on
 * any profile shelf (Watching Now / Want / Finished / Stopped).
 *
 * The user's threads + replies for the show are NOT touched — they live
 * under their journal + the public stream regardless of whether the show
 * appears on the profile. Profile shelves are driven by the progress
 * table only; deleting that row removes the show from those shelves.
 *
 * Two-step (cascade then delete) rather than one transaction. If the
 * delete fails after stopWatching succeeds, the user retries: the room-
 * cascade is idempotent on already-stopped shows (groups already left,
 * flag already set), so only the delete fires the second time.
 */
export async function removeShowFromProfile(
  userId: string,
  username: string,
  showId: string
): Promise<void> {
  await stopWatching(userId, username, showId);
  const { error } = await supabase
    .from("progress")
    .delete()
    .eq("user_id", userId)
    .eq("show_id", showId);
  if (error) throw error;
}

export async function setCanonPin(
  userId: string,
  showId: string,
  value: boolean
): Promise<void> {
  const { error } = await supabase
    .from("progress")
    .update({ canon_pin: value })
    .eq("user_id", userId)
    .eq("show_id", showId);
  if (error) throw error;
}

// Stamps profiles.onboarded_at = now() for the user. The durable marker that
// the first-login onboarding modal + reveal have run (confirmed or skipped
// through). Set once the paged modal flow ends; after that, normal post-login
// routing applies and the TSP demo card surfaces in Watching-now.
// Owner-only via the existing profiles_update RLS policy (auth.uid() = id).
export async function markOnboarded(userId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

// === v2 profile-display layer (2026-05-11) =====================================
//
// shelfOverride pins a (user, show) to a specific shelf on the V2 profile UI
// regardless of progress / stopped_watching. NULL = derive shelf from progress
// (legacy behavior). Override takes priority over both stoppedWatching and the
// (s, e) derivation when set.
//
// shelfPosition orders rows within their resolved shelf. After the first drag
// in a shelf the V2 client writes positions for ALL items in that shelf via
// setShelfPositions, so position-mode is consistent within a shelf.
//
// Both writes are owner-only via the existing progress RLS policy.

export type ShelfName = "watching" | "want" | "finished" | "stopped";

export async function setShelfOverride(
  userId: string,
  showId: string,
  value: ShelfName | null
): Promise<void> {
  const { error } = await supabase
    .from("progress")
    .update({ shelf_override: value })
    .eq("user_id", userId)
    .eq("show_id", showId);
  if (error) throw error;
}

// Bulk-update positions for a list of (showId, position) pairs in one user's
// progress rows. Used by the V2 profile drag-reorder: after a drop, the client
// computes new indices for every visible row in the affected shelf and ships
// them in one call. N parallel UPDATEs (one per row) — fine for shelf sizes in
// the 10–50 range we expect at beta scale.
export async function setShelfPositions(
  userId: string,
  updates: { showId: string; position: number | null }[]
): Promise<void> {
  if (!updates.length) return;
  const errors: any[] = [];
  await Promise.all(
    updates.map(async (u) => {
      const { error } = await supabase
        .from("progress")
        .update({ shelf_position: u.position })
        .eq("user_id", userId)
        .eq("show_id", u.showId);
      if (error) errors.push(error);
    })
  );
  if (errors.length) throw errors[0];
}

export type V2BlurbKind = "watching_quote" | "want_reason" | "canon_take" | "stopped_reason";

// setProfileBio + V2_BIO_MAX removed 2026-05-12 — the bio surface was
// replaced by the "Thoughts on..." carousel (commits 0c3bb07 → 69ee87c).
// profiles.bio column stays dormant in DB; auth.tsx's loadProfile still
// pulls it via the bio-tolerant SELECT. Drop the column + the auth-side
// fallback in a later pass if/when nothing depends on it.

export async function setShelfBlurb(
  userId: string,
  showId: string,
  kind: V2BlurbKind,
  text: string | null
): Promise<void> {
  if (text !== null && text.length > V2_BLURB_MAX) {
    throw new Error(`Blurb exceeds ${V2_BLURB_MAX} characters.`);
  }
  // Whitespace-only strings save as NULL — the placeholder copy ("add a take…",
  // etc.) re-renders rather than the user seeing their own empty string.
  const trimmed = text === null ? null : (text.trim() || null);
  const { error } = await supabase
    .from("progress")
    .update({ [kind]: trimmed })
    .eq("user_id", userId)
    .eq("show_id", showId);
  if (error) throw error;
}

export async function upsertProgress(userId: string, showId: string, s: number, e: number): Promise<void> {
  const { error } = await supabase
    .from("progress")
    .upsert({ user_id: userId, show_id: showId, season: s, episode: e }, { onConflict: "user_id,show_id" });
  if (error) throw error;
}

export async function upsertRewatchStatus(
  userId: string,
  showId: string,
  entry: import("../types").ProgressEntry
): Promise<void> {
  const { error } = await supabase
    .from("progress")
    .upsert({
      user_id: userId,
      show_id: showId,
      season:          entry.s,
      episode:         entry.e,
      is_rewatching:   entry.isRewatching  ?? false,
      rewatch_season:  entry.rewatchS      ?? null,
      rewatch_episode: entry.rewatchE      ?? null,
      highest_season:  entry.highestS      ?? null,
      highest_episode: entry.highestE      ?? null,
    }, { onConflict: "user_id,show_id" });
  if (error) throw error;
}

// === v2 progress-update helper (2026-05-08) ===================================
//
// Pure-function port of App.tsx's updateProgressFor (App.tsx:449). Three
// cases: non-rewatcher forward progress (bumps highest if needed); rewatcher
// within previous highest (updates rewatch position only); rewatcher past
// previous highest (transitions out of rewatch mode). Logic must stay byte-
// equivalent to App.tsx so v2 behaves "exactly like before."
//
// Kept duplicated rather than extracted-and-shared so the live App.tsx isn't
// touched during the v2 arc. At cutover, App.tsx can drop its inline version
// and import this one.
export function computeNextProgressEntry(
  cur: import("../types").ProgressEntry | undefined,
  next: { s: number; e: number }
): import("../types").ProgressEntry {
  // Non-rewatcher (or no prior entry): regular forward progress.
  if (!cur?.isRewatching) {
    const newHighestS =
      cur?.highestS != null && cur?.highestE != null
        ? next.s > cur.highestS || (next.s === cur.highestS && next.e > cur.highestE) ? next.s : cur.highestS
        : next.s;
    const newHighestE =
      cur?.highestS != null && cur?.highestE != null
        ? next.s > cur.highestS || (next.s === cur.highestS && next.e > cur.highestE) ? next.e : cur.highestE
        : next.e;
    return {
      ...(cur || {} as import("../types").ProgressEntry),
      s: next.s,
      e: next.e,
      highestS: newHighestS,
      highestE: newHighestE,
    };
  }
  // Rewatcher: compare new position to previous highest.
  const hs = cur.highestS ?? cur.s;
  const he = cur.highestE ?? cur.e;
  const pastHighest = next.s > hs || (next.s === hs && next.e > he);
  if (!pastHighest) {
    return {
      ...cur,
      s: next.s,
      e: next.e,
      rewatchS: next.s,
      rewatchE: next.e,
    };
  }
  // Transition out of rewatch — strictly past previous highest.
  return {
    s: next.s,
    e: next.e,
    isRewatching: false,
    rewatchS: undefined,
    rewatchE: undefined,
    highestS: next.s,
    highestE: next.e,
  };
}

// Persist + return the updated entry. Caller mirrors the same shape into
// local state. Failures throw — caller decides how to surface.
export async function persistProgressUpdate(
  userId: string,
  showId: string,
  cur: import("../types").ProgressEntry | undefined,
  next: { s: number; e: number }
): Promise<import("../types").ProgressEntry> {
  const updated = computeNextProgressEntry(cur, next);
  await upsertRewatchStatus(userId, showId, updated);
  return updated;
}

export async function clearRewatchMode(userId: string, showId: string): Promise<void> {
  const { error } = await supabase
    .from("progress")
    .update({ is_rewatching: false, rewatch_season: null, rewatch_episode: null, highest_season: null, highest_episode: null })
    .eq("user_id", userId)
    .eq("show_id", showId);
  if (error) throw error;
}

// ── Browse progress (silent, non-committed progress for public browsing) ─────

export async function upsertBrowseProgress(
  userId: string,
  showId: string,
  entry: import("../types").ProgressEntry
): Promise<void> {
  const { error } = await supabase
    .from("browse_progress")
    .upsert({
      user_id: userId,
      show_id: showId,
      season: entry.s,
      episode: entry.e,
      is_rewatching: entry.isRewatching ?? false,
      rewatch_season: entry.rewatchS ?? null,
      rewatch_episode: entry.rewatchE ?? null,
      highest_season: entry.highestS ?? null,
      highest_episode: entry.highestE ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,show_id" });
  if (error) console.error("Failed to upsert browse progress:", error);
}

export async function fetchBrowseProgress(
  userId: string,
  showId: string
): Promise<import("../types").ProgressEntry | null> {
  const { data, error } = await supabase
    .from("browse_progress")
    .select("season, episode, is_rewatching, rewatch_season, rewatch_episode, highest_season, highest_episode")
    .eq("user_id", userId)
    .eq("show_id", showId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    s: data.season,
    e: data.episode,
    isRewatching: data.is_rewatching ?? false,
    rewatchS: data.rewatch_season ?? undefined,
    rewatchE: data.rewatch_episode ?? undefined,
    highestS: data.highest_season ?? undefined,
    highestE: data.highest_episode ?? undefined,
  };
}

// ── Public profile ────────────────────────────────────────────────────────────

export type PublicProfile = { id: string; username: string; bio: string | null };

/** Resolves a username → userId + bio. Returns null if not found or is a seed user.
 *  Bio-tolerant: if the bio column doesn't exist (migration not applied),
 *  falls back to the legacy select and returns bio: null. */
export async function fetchPublicProfileByUsername(username: string): Promise<PublicProfile | null> {
  let res = await supabase
    .from("profiles")
    .select("id, username, is_seed, bio")
    .eq("username", username)
    .single();
  let bioSupported = !res.error;
  if (res.error) {
    res = await supabase
      .from("profiles")
      .select("id, username, is_seed")
      .eq("username", username)
      .single();
  }
  const data: any = res.data;
  if (!data || data.is_seed) return null;
  return { id: data.id, username: data.username, bio: bioSupported ? (data.bio ?? null) : null };
}

/** Public threads by a user — only those marked is_public=true. */
export async function fetchPublicThreadsForUser(userId: string): Promise<Thread[]> {
  const { data, error } = await supabase
    .from("threads")
    .select("*")
    .eq("author_id", userId)
    .eq("is_deleted", false)
    .eq("is_public", true)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToThread);
}

/**
 * Aggregated show page query — all public threads for a show, progress-filtered.
 * maxS/maxE: the viewer's current progress. Seed threads are excluded (is_seed check
 * is done client-side via author field for now; a future author_is_seed column would be cleaner).
 */
export async function fetchPublicThreadsForShow(
  showId: string,
  maxS: number,
  maxE: number
): Promise<Thread[]> {
  const { data, error } = await supabase
    .from("threads")
    .select("*")
    .eq("show_id", showId)
    .eq("is_deleted", false)
    .eq("is_public", true)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .map(rowToThread)
    .filter(t => t.season < maxS || (t.season === maxS && t.episode <= maxE));
}

/** Public replies by a user — excludes deleted replies and replies in deleted/private threads. */
export async function fetchPublicRepliesForUser(userId: string): Promise<{ reply: Reply; thread: Thread }[]> {
  const { data, error } = await supabase
    .from("replies")
    .select("*")
    .eq("author_id", userId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const replies = (data ?? []).map(rowToReply);
  const threadIds = [...new Set(replies.map(r => r.threadId))];
  if (!threadIds.length) return [];
  const { data: tData, error: tErr } = await supabase
    .from("threads").select("*").in("id", threadIds);
  if (tErr) throw tErr;
  const threadById: Record<string, Thread> = {};
  for (const t of (tData ?? []).map(rowToThread)) threadById[t.id] = t;
  return replies
    .map(r => {
      const t = threadById[r.threadId];
      if (!t || t.isDeleted || !t.isPublic) return null;
      return { reply: r, thread: t };
    })
    .filter(Boolean) as { reply: Reply; thread: Thread }[];
}

/** Shows a user is tracking (progress rows), sorted by show name.
 *  Uses RPC to bypass owner-only RLS on the progress table.
 *  Returns the full ProgressEntry shape — the v2 visitor profile classifies
 *  shelves and renders blurbs from these fields. The 14-column RPC was
 *  introduced 2026-05-08 (checkpoint 5 phase A). Live PublicProfilePage
 *  is column-name-keyed so the wider return shape is non-breaking. */
export async function fetchPublicProgressForUser(
  userId: string
): Promise<Record<string, import("../types").ProgressEntry>> {
  const { data, error } = await supabase
    .rpc("get_public_progress", { target_user_id: userId });
  if (error) throw error;
  const result: Record<string, import("../types").ProgressEntry> = {};
  for (const row of data ?? []) {
    result[row.show_id] = {
      s: row.season,
      e: row.episode,
      isRewatching:    row.is_rewatching ?? false,
      rewatchS:        row.rewatch_season ?? undefined,
      rewatchE:        row.rewatch_episode ?? undefined,
      highestS:        row.highest_season ?? undefined,
      highestE:        row.highest_episode ?? undefined,
      stoppedWatching: row.stopped_watching ?? false,
      canonPin:        row.canon_pin ?? false,
      watchingQuote:   row.watching_quote ?? undefined,
      wantReason:      row.want_reason ?? undefined,
      canonTake:       row.canon_take ?? undefined,
      stoppedReason:   row.stopped_reason ?? undefined,
      // v2 profile-display columns (2026-05-11). undefined when the RPC is
      // still on the pre-v3 shape; default to null in that case.
      shelfOverride:   (row.shelf_override ?? null) as ("watching" | "want" | "finished" | "stopped" | null),
      shelfPosition:   row.shelf_position ?? null,
    };
  }
  return result;
}

// === v2 visitor-profile context (2026-05-08, checkpoint 5 phase B) ===
//
// Per-show CTA logic on the visitor profile needs three signals:
//   1. Visitor's own progress on each show (already available via fetchProgress).
//   2. Friend rooms that BOTH the visitor and the owner are members of, per show.
//   3. Whether the owner has any public threads on each show.
//
// (1) + (3) reuse existing helpers (fetchProgress, fetchPublicThreadsForUser).
// (2) is the new helper below — single round-trip via a self-join of
// friend_group_members.

export type SharedRoomRow = { groupId: string; groupName: string; showId: string };

export async function fetchSharedRoomsForUsers(
  viewerId: string,
  targetId: string
): Promise<SharedRoomRow[]> {
  // Friend-group memberships for the viewer.
  const { data: viewerRows, error: vErr } = await supabase
    .from("friend_group_members")
    .select("group_id")
    .eq("user_id", viewerId);
  if (vErr) throw vErr;
  const viewerGroupIds = new Set((viewerRows ?? []).map((r: any) => r.group_id));
  if (!viewerGroupIds.size) return [];

  // Friend-group memberships for the target.
  const { data: targetRows, error: tErr } = await supabase
    .from("friend_group_members")
    .select("group_id")
    .eq("user_id", targetId);
  if (tErr) throw tErr;
  const sharedIds = (targetRows ?? [])
    .map((r: any) => r.group_id)
    .filter((id: string) => viewerGroupIds.has(id));
  if (!sharedIds.length) return [];

  // Resolve the shared groups, excluding soft-deleted.
  const { data: groupRows, error: gErr } = await supabase
    .from("friend_groups")
    .select("id, name, show_id, deleted_at")
    .in("id", sharedIds);
  if (gErr) throw gErr;
  return (groupRows ?? [])
    .filter((g: any) => !g.deleted_at)
    .map((g: any) => ({ groupId: g.id, groupName: g.name, showId: g.show_id }));
}

// ── Replies ──────────────────────────────────────────────────────────────────

export async function insertReply(data: {
  threadId: string; showId: string; season: number; episode: number;
  authorId: string; authorName: string; body: string; replyToId?: string;
  referenceType?: 'quote' | 'link' | null;
  referencedReplyId?: string | null;
  referencedThreadId?: string | null;
  quotedText?: string | null;
  isRewatch?: boolean;
  rewatchSeason?: number;
  rewatchEpisode?: number;
  groupId?: string | null;
}): Promise<Reply> {
  await checkRateLimit('create_reply', 10, 60);
  validateLength("Reply", data.body, 1, 5000);
  const row = {
    id: crypto.randomUUID(),
    thread_id: data.threadId, show_id: data.showId,
    season: data.season, episode: data.episode,
    author_id: data.authorId, author_name: data.authorName,
    body: data.body, likes_count: 0,
    reference_type: data.referenceType ?? null,
    referenced_reply_id: data.referencedReplyId ?? null,
    referenced_thread_id: data.referencedThreadId ?? null,
    quoted_text: data.quotedText ?? null,
    group_id: data.groupId ?? null,
    is_rewatch: data.isRewatch ?? false,
    rewatch_season: data.rewatchSeason ?? null,
    rewatch_episode: data.rewatchEpisode ?? null,
  };
  const { data: inserted, error } = await supabase
    .from("replies").insert(row).select().single();
  if (error) throw error;

  const reply = rowToReply(inserted);

  // Insert citation row if there's a reference
  if (data.referenceType && (data.referencedReplyId || data.referencedThreadId)) {
    const citationRow: any = { citing_reply_id: reply.id };
    if (data.referencedReplyId) citationRow.cited_reply_id = data.referencedReplyId;
    if (data.referencedThreadId) citationRow.cited_thread_id = data.referencedThreadId;
    // Best-effort: don't throw if citation insert fails
    await supabase.from("response_citations").insert(citationRow).then(({ error: e }) => {
      if (e) console.warn("Citation insert failed:", e.message);
    });
  }

  return reply;
}

// ── Public-room response gate ───────────────────────────────────────────────

/** True if `responderId` may respond directly in `ownerId`'s public rooms:
 *  the owner themselves, a friend (shares any non-deleted friend room, any
 *  show), or an approved responder. Mirrors the replies INSERT policy, so the
 *  UI state and the database rule can't disagree. */
export async function canRespondToPublicRoom(ownerId: string, responderId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_respond_to_public", {
    p_owner: ownerId,
    p_responder: responderId,
  });
  if (error) { console.warn("can_respond_to_public failed:", error.message); return false; }
  return data === true;
}

/** Park a held response from a not-yet-approved requester. Invisible to readers
 *  until the owner approves (CP3 publishes it into `replies`). `season`/
 *  `episode` snapshot the requester's claimed progress so the published reply
 *  is spoiler-tagged correctly whenever approval happens. */
export async function insertPendingPublicResponse(data: {
  threadId: string; showId: string; ownerId: string;
  requesterId: string; requesterName: string;
  body: string; message?: string | null;
  season: number; episode: number;
  referenceType?: 'quote' | 'link' | null;
  referencedReplyId?: string | null;
  referencedThreadId?: string | null;
  quotedText?: string | null;
}): Promise<string> {
  await checkRateLimit('public_response_request', 10, 60);
  validateLength("Response", data.body, 1, 5000);
  if (data.message && data.message.trim()) validateLength("Message", data.message, 1, 500);
  const { data: inserted, error } = await supabase.from("pending_public_responses").insert({
    thread_id: data.threadId, show_id: data.showId,
    owner_id: data.ownerId,
    requester_id: data.requesterId, requester_name: data.requesterName,
    body: data.body, message: data.message ?? null,
    season: data.season, episode: data.episode,
    reference_type: data.referenceType ?? null,
    referenced_reply_id: data.referencedReplyId ?? null,
    referenced_thread_id: data.referencedThreadId ?? null,
    quoted_text: data.quotedText ?? null,
  }).select("id").single();
  if (error) throw error;
  return inserted.id as string;
}

/** Email the public room's owner that a held response is waiting (best-effort).
 *  The edge function decides whether to include the response body based on the
 *  requester's progress vs the owner's. Failure here doesn't undo the held row. */
export async function notifyPublicResponseRequest(pendingId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("send-message", {
    body: { template_type: "public_response_request", pending_id: pendingId },
  });
  if (error) console.warn("public_response_request email failed:", error.message);
}

/** Summary for the Allow page (owner-only). Returns null if the caller isn't
 *  the owner or the request no longer exists. `body` is null when the requester
 *  has watched further than the owner. */
export async function fetchPublicResponseRequest(id: string): Promise<{
  requesterUsername: string;
  showId: string;
  showName: string;
  message: string | null;
  requesterAhead: boolean;
  body: string | null;
} | null> {
  const { data, error } = await supabase.rpc("get_public_response_request", { p_id: id });
  if (error) { console.warn("get_public_response_request failed:", error.message); return null; }
  if (!data) return null;
  return {
    requesterUsername: data.requester_username,
    showId: data.show_id,
    showName: data.show_name,
    message: data.message ?? null,
    requesterAhead: !!data.requester_ahead,
    body: data.body ?? null,
  };
}

/** Owner approves a held request: grants the requester blanket permission and
 *  publishes all of their held responses. Returns the thread id to land on. */
export async function approvePublicResponse(id: string): Promise<{ ok: boolean; threadId?: string; error?: string }> {
  const { data, error } = await supabase.rpc("approve_public_response", { p_id: id });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? "unknown" };
  return { ok: true, threadId: data.thread_id ?? undefined };
}

/** Thread ids in `ownerId`'s public rooms that `requesterId` already has a
 *  pending request on — lets the UI note "you already asked". */
export async function fetchMyPendingResponseThreadIds(ownerId: string, requesterId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("pending_public_responses")
    .select("thread_id")
    .eq("owner_id", ownerId)
    .eq("requester_id", requesterId);
  if (error) { console.warn("fetch pending responses failed:", error.message); return new Set(); }
  return new Set((data ?? []).map((r: any) => r.thread_id as string));
}

// ── Citations ─────────────────────────────────────────────────────────────────

export type CitationEntry = { citingReplyId: string; index: number };

/**
 * Fetch citations for a list of reply IDs.
 * Returns a Map: citedReplyId → array of {citingReplyId, index} sorted by creation order.
 * Progress filtering (spoilers) is handled client-side in RepliesList via the existing
 * isVisible check — avoids FK-ambiguity errors from the double reference_citations→replies FK.
 */
export async function fetchCitationsForReplies(
  replyIds: string[]
): Promise<Map<string, CitationEntry[]>> {
  if (!replyIds.length) return new Map();

  const { data, error } = await supabase
    .from("response_citations")
    .select("cited_reply_id, citing_reply_id, created_at")
    .in("cited_reply_id", replyIds)
    .order("created_at", { ascending: true });

  if (error) { console.warn("fetchCitationsForReplies error:", error.message); return new Map(); }

  const result = new Map<string, CitationEntry[]>();
  for (const row of data ?? []) {
    const citedId = (row as any).cited_reply_id as string;
    if (!result.has(citedId)) result.set(citedId, []);
    const arr = result.get(citedId)!;
    arr.push({ citingReplyId: (row as any).citing_reply_id as string, index: arr.length + 1 });
  }
  return result;
}

/**
 * Fetch citations for an original thread entry.
 * Returns array of {citingReplyId, index}.
 */
export async function fetchCitationsForThread(
  threadId: string
): Promise<CitationEntry[]> {
  const { data, error } = await supabase
    .from("response_citations")
    .select("citing_reply_id, created_at")
    .eq("cited_thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) { console.warn("fetchCitationsForThread error:", error.message); return []; }

  return (data ?? []).map((row: any, i: number) => ({
    citingReplyId: row.citing_reply_id as string,
    index: i + 1,
  }));
}

// ── Feedback ──────────────────────────────────────────────────────────────────

export type FeedbackRow = {
  id: string;
  userId: string | null;
  username: string | null;
  pageUrl: string | null;
  message: string;
  status: "will-do" | "consider" | "done" | "ignore" | null;
  createdAt: number;
  readAt: number | null;
};

export async function insertFeedback(
  userId: string | null,
  username: string,
  pageUrl: string,
  message: string
): Promise<void> {
  // Rate-limit via the RPC only when signed-in — check_rate_limit keys on
  // auth.uid() and throws for anon callers. The FeedbackWidget still enforces
  // a localStorage-based 8s cooldown on both paths.
  if (userId) await checkRateLimit('feedback', 6, 60);
  validateLength("Feedback message", message, 1, 2000);
  const { error } = await supabase.from("feedback").insert({
    user_id: userId,
    username,
    page_url: pageUrl,
    message,
  });
  if (error) throw error;
}

export async function fetchFeedback(): Promise<FeedbackRow[]> {
  const { data, error } = await supabase
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    pageUrl: row.page_url,
    message: row.message,
    status: row.status ?? null,
    createdAt: new Date(row.created_at).getTime(),
    readAt: row.read_at ? new Date(row.read_at).getTime() : null,
  }));
}

export async function updateFeedbackStatus(
  id: string,
  status: "will-do" | "consider" | "done" | "ignore" | null
): Promise<void> {
  const { error } = await supabase
    .from("feedback")
    .update({ status })
    .eq("id", id);
  if (error) throw error;
}

export async function markFeedbackRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from("feedback")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) throw error;
}

export async function deleteFeedback(id: string): Promise<void> {
  const { error } = await supabase.from("feedback").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchUnreadFeedbackCount(): Promise<number> {
  const { count, error } = await supabase
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}

// ── Prompts ───────────────────────────────────────────────────────────────────

export type PromptRow = {
  id: number;
  text: string;
  display_type: "fragment" | "lighthearted-fragment" | "prompt";
  tvmaze_types: string[];
  genres: string[];
  progress_tags: string[];
  themes: string[];
  is_active: boolean;
};

export async function fetchPrompts(): Promise<PromptRow[]> {
  const { data, error } = await supabase
    .from("prompts")
    .select("id, text, display_type, tvmaze_types, genres, progress_tags, themes, is_active")
    .eq("is_active", true)
    .order("id");
  if (error) throw error;
  return (data ?? []) as PromptRow[];
}

export async function fetchAllPrompts(): Promise<PromptRow[]> {
  const { data, error } = await supabase
    .from("prompts")
    .select("id, text, display_type, tvmaze_types, genres, progress_tags, themes, is_active")
    .order("id");
  if (error) throw error;
  return (data ?? []) as PromptRow[];
}

export async function togglePromptActive(id: number, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("prompts")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw error;
}

export async function deletePrompt(id: number): Promise<void> {
  const { error } = await supabase.from("prompts").delete().eq("id", id);
  if (error) throw error;
}

export async function updatePrompt(
  id: number,
  updates: { text?: string; tvmaze_types?: string[]; genres?: string[]; progress_tags?: string[] }
): Promise<void> {
  const { error } = await supabase.from("prompts").update(updates).eq("id", id);
  if (error) throw error;
}

export async function createPrompt(
  prompt: Pick<PromptRow, "text" | "display_type" | "tvmaze_types" | "genres" | "progress_tags" | "themes">
): Promise<PromptRow> {
  // Get next available ID (max existing + 1)
  const { data: maxRow } = await supabase
    .from("prompts")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .single();
  const nextId = ((maxRow as any)?.id ?? 0) + 1;

  const { data, error } = await supabase
    .from("prompts")
    .insert({ ...prompt, id: nextId, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data as PromptRow;
}

export async function seedPrompts(prompts: PromptEntry[]): Promise<void> {
  const rows = prompts.map((p) => ({
    id: p.id,
    text: p.text,
    display_type: p.displayType,
    tvmaze_types: p.tvmazeTypes,
    genres: p.genres,
    progress_tags: p.progressTags,
    themes: p.themes,
    is_active: true,
  }));
  const { error } = await supabase
    .from("prompts")
    .upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

export async function logThreadPrompt(threadId: string, promptId: number): Promise<void> {
  const { error } = await supabase
    .from("thread_prompts")
    .insert({ thread_id: threadId, prompt_id: promptId });
  // Best-effort: don't throw if insert fails (e.g. table not yet created)
  if (error) console.warn("logThreadPrompt failed:", error.message);
}

// ── Friend groups ─────────────────────────────────────────────────────────────

function rowToFriendGroup(row: any): FriendGroup {
  return {
    id:        row.id,
    showId:    row.show_id,
    name:      row.name,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/** Create a new friend group for a show and add the creator as first member. */
export async function createFriendGroup(data: {
  showId: string;
  name: string;
  createdBy: string;
}): Promise<FriendGroup> {
  await checkRateLimit('create_group', 3, 60);
  validateLength("Group name", data.name, 1, 60);
  const { data: inserted, error } = await supabase
    .from("friend_groups")
    .insert({ show_id: data.showId, name: data.name, created_by: data.createdBy })
    .select()
    .single();
  if (error) throw error;
  // Add creator as first member
  const { error: memberErr } = await supabase
    .from("friend_group_members")
    .insert({ group_id: inserted.id, user_id: data.createdBy });
  if (memberErr) throw memberErr;
  return rowToFriendGroup(inserted);
}

/** All friend groups the user is a member of, optionally filtered by show. */
export async function fetchFriendGroupsForUser(
  userId: string,
  showId?: string
): Promise<FriendGroup[]> {
  // First get all group IDs the user belongs to
  const { data: memberRows, error: mErr } = await supabase
    .from("friend_group_members")
    .select("group_id")
    .eq("user_id", userId);
  if (mErr) throw mErr;
  const groupIds = (memberRows ?? []).map((r: any) => r.group_id);
  if (!groupIds.length) return [];

  let query = supabase.from("friend_groups").select("*").in("id", groupIds);
  if (showId) query = query.eq("show_id", showId);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToFriendGroup);
}

/** Fetch ALL friend groups for a user (across all shows) with latest activity timestamp. */
export async function fetchAllFriendGroupsWithActivity(
  userId: string
): Promise<(FriendGroup & { lastActivityAt: number })[]> {
  // 1. Get all group IDs the user belongs to
  const { data: memberRows, error: mErr } = await supabase
    .from("friend_group_members")
    .select("group_id")
    .eq("user_id", userId);
  if (mErr) throw mErr;
  const groupIds = (memberRows ?? []).map((r: any) => r.group_id);
  if (!groupIds.length) return [];

  // 2. Fetch the groups
  const { data: groupData, error: gErr } = await supabase
    .from("friend_groups")
    .select("*")
    .in("id", groupIds);
  if (gErr) throw gErr;
  const groups = (groupData ?? []).map(rowToFriendGroup);

  // 3a. Thread activity: shared_at on group_threads (a proxy for thread
  //     creation/sharing into the room).
  const { data: threadActivity, error: aErr } = await supabase
    .from("group_threads")
    .select("group_id, shared_at")
    .in("group_id", groupIds);
  if (aErr) throw aErr;

  // 3b. Reply activity: replies.created_at, scoped by group_id. Replies
  //     don't touch group_threads, so without this query reply-only
  //     activity would never bump the pill order.
  const { data: replyActivity, error: rErr } = await supabase
    .from("replies")
    .select("group_id, created_at")
    .in("group_id", groupIds)
    .eq("is_deleted", false);
  if (rErr) throw rErr;

  // Compute max timestamp per group across both sources. Any thread-create
  // or reply-create qualifies; stars, progress updates, and other writes
  // don't touch these tables so they correctly don't bump the order.
  const latestByGroup: Record<string, number> = {};
  const bump = (gid: string, ts: number) => {
    if (!latestByGroup[gid] || ts > latestByGroup[gid]) latestByGroup[gid] = ts;
  };
  for (const row of threadActivity ?? []) {
    bump(row.group_id, new Date(row.shared_at).getTime());
  }
  for (const row of replyActivity ?? []) {
    if (row.group_id) bump(row.group_id, new Date(row.created_at).getTime());
  }

  // 4. Merge and sort by activity (most recent first)
  return groups
    .map(g => ({ ...g, lastActivityAt: latestByGroup[g.id] ?? g.createdAt }))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** All members of a friend group with their usernames. */
export async function fetchFriendGroupMembers(
  groupId: string
): Promise<FriendGroupMember[]> {
  const { data, error } = await supabase
    .from("friend_group_members")
    .select("group_id, user_id, joined_at, profiles(username)")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    groupId:  row.group_id,
    userId:   row.user_id,
    username: row.profiles?.username ?? "unknown",
    joinedAt: new Date(row.joined_at).getTime(),
  }));
}

// ── People-groups (restructure foundation) ──────────────────────────────────
// A people-group is a set of people spanning shows. Each (group × show) room
// is a friend_groups row with parent_group_id pointing at the people-group, so
// the existing room machinery is reused unchanged. All writes go through the
// atomic SECURITY DEFINER RPCs added in 20260619_restructure_phase1_people_groups.sql.

function rowToPeopleGroup(row: any): PeopleGroup {
  return {
    id:        row.id,
    name:      row.name ?? null,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/** Create a people-group (caller becomes first member). Returns the new id. */
export async function createPeopleGroup(name?: string): Promise<string> {
  await checkRateLimit('create_group', 3, 60);
  const { data, error } = await supabase.rpc("create_people_group", {
    p_name: name ?? null,
  });
  if (error) throw error;
  if (!data || data.ok === false) throw new Error(data?.error || "create_people_group failed");
  return data.group_id as string;
}

/** All non-deleted people-groups the caller is a member of. */
export async function fetchPeopleGroupsForUser(userId: string): Promise<PeopleGroup[]> {
  const { data: memberRows, error: mErr } = await supabase
    .from("people_group_members")
    .select("group_id")
    .eq("user_id", userId);
  if (mErr) throw mErr;
  const groupIds = (memberRows ?? []).map((r: any) => r.group_id);
  if (!groupIds.length) return [];

  const { data, error } = await supabase
    .from("people_groups")
    .select("*")
    .in("id", groupIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToPeopleGroup);
}

/** Members of a people-group with usernames (drives the auto-name + rail).
 *  user_id references auth.users (not profiles), so the profiles(username)
 *  embed has no FK to follow — resolve usernames in a second query instead. */
export async function fetchPeopleGroupMembers(groupId: string): Promise<PeopleGroupMember[]> {
  const { data: rows, error } = await supabase
    .from("people_group_members")
    .select("group_id, user_id, joined_at")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });
  if (error) throw error;

  const ids = (rows ?? []).map((r: any) => r.user_id);
  const usernames: Record<string, string> = {};
  if (ids.length) {
    const { data: profs } = await supabase.from("profiles").select("id, username").in("id", ids);
    for (const p of profs ?? []) usernames[p.id] = p.username;
  }

  return (rows ?? []).map((row: any) => ({
    groupId:  row.group_id,
    userId:   row.user_id,
    username: usernames[row.user_id] ?? "unknown",
    joinedAt: new Date(row.joined_at).getTime(),
  }));
}

/** All show-votes in a people-group (every member's opt-ins), for pill counts. */
export async function fetchGroupShowVotes(groupId: string): Promise<GroupShowVote[]> {
  const { data, error } = await supabase
    .from("group_show_votes")
    .select("group_id, user_id, show_id, created_at")
    .eq("group_id", groupId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    groupId:   row.group_id,
    userId:    row.user_id,
    showId:    row.show_id,
    createdAt: new Date(row.created_at).getTime(),
  }));
}

/** Toggle the caller's per-group opt-in ("want to watch") for a show. */
export async function setShowVote(groupId: string, showId: string, voted: boolean): Promise<void> {
  const { data, error } = await supabase.rpc("set_show_vote", {
    p_group_id: groupId,
    p_show_id:  showId,
    p_voted:    voted,
  });
  if (error) throw error;
  if (!data || data.ok === false) throw new Error(data?.error || "set_show_vote failed");
}

/**
 * Start (or open) the one (people-group × show) room. Creates it on first call
 * and auto-enrolls opted-in members; on later calls returns the existing room.
 * Returns the room's friend_groups id and whether it was just created.
 */
export async function startShowRoom(
  groupId: string,
  showId: string
): Promise<{ roomId: string; created: boolean }> {
  const { data, error } = await supabase.rpc("start_show_room", {
    p_group_id: groupId,
    p_show_id:  showId,
  });
  if (error) throw error;
  if (!data || data.ok === false) throw new Error(data?.error || "start_show_room failed");
  return { roomId: data.room_id as string, created: !!data.created };
}

/** The existing (group × show) room id, or null if none has been started yet. */
export async function fetchRoomForGroupShow(groupId: string, showId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("friend_groups")
    .select("id")
    .eq("parent_group_id", groupId)
    .eq("show_id", showId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// ── People-group lifecycle (restructure) ────────────────────────────────────

/** Leave a people-group (§13 cascade — handled atomically server-side). */
export async function leavePeopleGroup(groupId: string): Promise<void> {
  const { data, error } = await supabase.rpc("leave_people_group", { p_group_id: groupId });
  if (error) throw error;
  if (!data || data.ok === false) throw new Error(data?.error || "leave failed");
}

/** Set (or clear, with empty string) a group's shared custom name. */
export async function renamePeopleGroup(groupId: string, name: string): Promise<void> {
  const { data, error } = await supabase.rpc("rename_people_group", { p_group_id: groupId, p_name: name });
  if (error) throw error;
  if (!data || data.ok === false) throw new Error(data?.error || "rename failed");
}

export type PendingGroupInvite = {
  token: string;
  groupId: string;
  inviterName: string;
  memberNames: string[];
};

/** Pending people-group invites addressed to the caller (rail "*you're invited"). */
export async function fetchMyPendingGroupInvites(): Promise<PendingGroupInvite[]> {
  const { data, error } = await supabase.rpc("get_my_pending_group_invites");
  if (error) throw error;
  if (!data || data.ok === false) return [];
  return (data.invites ?? []).map((i: any) => ({
    token: i.token,
    groupId: i.group_id,
    inviterName: i.inviter_name ?? "someone",
    memberNames: i.member_names ?? [],
  }));
}

// ── People-group invitations (restructure) ──────────────────────────────────

/** Create (or reuse) a people-group invite for an email. Returns the token. */
export async function createPeopleGroupInvite(groupId: string, email: string): Promise<string> {
  await checkRateLimit('send_invite', 6, 60);
  const { data, error } = await supabase.rpc("create_people_group_invitation", {
    p_group_id: groupId, p_email: email,
  });
  if (error) throw error;
  if (!data || data.ok === false) throw new Error(data?.error || "create invite failed");
  return data.token as string;
}

export type GroupInviteInfo = {
  groupId: string;
  inviterName: string;
  memberNames: string[];
  expiresAt: number;
};

/** Look up a people-group invite by token (for the accept page). */
export async function getPeopleGroupInvite(
  token: string
): Promise<{ ok: true; info: GroupInviteInfo } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("get_people_group_invitation", { p_token: token });
  if (error) return { ok: false, error: error.message };
  if (!data || data.ok === false) return { ok: false, error: data?.error || "invalid" };
  return {
    ok: true,
    info: {
      groupId: data.group_id,
      inviterName: data.inviter_name ?? "someone",
      memberNames: data.member_names ?? [],
      expiresAt: new Date(data.expires_at).getTime(),
    },
  };
}

/** Accept a people-group invite (recipient-bound). */
export async function acceptPeopleGroupInvite(
  token: string
): Promise<{ ok: true; groupId: string } | { ok: false; error: string; maskedEmail?: string }> {
  const { data, error } = await supabase.rpc("accept_people_group_invitation", { p_token: token });
  if (error) return { ok: false, error: error.message };
  if (!data || data.ok === false) {
    return { ok: false, error: data?.error || "failed", maskedEmail: data?.invitee_email_masked };
  }
  return { ok: true, groupId: data.group_id };
}

// Per-member opt-in/progress/writing for one pooled show in a group.
export type GroupDashboardMember = {
  userId: string;
  voted: boolean;
  s: number | null;
  e: number | null;
  wrote: boolean;
};

// One pooled show in a group, with everything the pill system needs.
export type GroupDashboardShow = {
  showId: string;
  roomId: string | null;
  inRoom: boolean;
  members: GroupDashboardMember[];
};

/**
 * The group-context dashboard: every show in the group's pool with each
 * member's vote / watch-progress / whether-they-wrote, so the client can
 * compute the §7 pill states + shelf placement. Member-gated via RPC.
 */
export async function fetchGroupDashboard(groupId: string): Promise<GroupDashboardShow[]> {
  const { data, error } = await supabase.rpc("get_group_dashboard", { p_group_id: groupId });
  if (error) throw error;
  if (!data || data.ok === false) throw new Error(data?.error || "get_group_dashboard failed");
  return (data.shows ?? []).map((s: any) => ({
    showId: s.show_id,
    roomId: s.room_id ?? null,
    inRoom: !!s.in_room,
    members: (s.members ?? []).map((m: any) => ({
      userId: m.user_id,
      voted:  !!m.voted,
      s:      m.s ?? null,
      e:      m.e ?? null,
      wrote:  !!m.wrote,
    })),
  }));
}

// ── Mobile: per-room last-seen + new-activity visibility ─────────────────────
//
// Backed by 20260425_room_last_seen.sql. Mobile renders an indicator dot on
// room buttons when there's canView-visible content the user hasn't seen
// since their last_seen_at stamp. The visibility query does the canView join
// server-side via the user's per-show effective progress so a list view
// doesn't pay N round-trips.
//
// Both functions degrade gracefully if the migration isn't applied yet — RPC
// calls throw, the caller's catch logs and moves on without indicators. The
// rest of the mobile UI is unaffected.

/** Stamp the calling user's last_seen_at to NOW() for a given room. */
export async function markRoomSeen(groupId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_room_seen", { p_group_id: groupId });
  if (error) throw error;
}

/**
 * Read the calling user's last_seen_at for a single room. Returns null if
 * the user has never visited the room (column exists but value is null).
 *
 * THROWS on error so the caller can distinguish "fetch failed" (e.g.
 * 20260425_room_last_seen migration not applied — column doesn't exist)
 * from "fetched fine, value is null." Mobile thread-card indicators use
 * this distinction to fall back gracefully (no dots) when the migration
 * isn't applied, vs. firing dots on first visit when the column is there
 * but the user hasn't entered the room before.
 */
export async function fetchRoomLastSeen(userId: string, groupId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("friend_group_members")
    .select("last_seen_at")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.last_seen_at) return null;
  return new Date(data.last_seen_at).getTime();
}

// ── Friend-room daily digest: per-room opt-out ───────────────────────────────
//
// Backed by 20260603_friend_room_digest_optout.sql. Digests are ON by default
// (opt_out = false). Each member's preference is private from co-members, so
// the column isn't REST-readable — reads/writes go through SECURITY DEFINER
// RPCs that only ever touch the caller's own membership row.

/** Read the calling user's digest opt-out for a room. false = digests ON. */
export async function fetchRoomDigestOptOut(groupId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("get_room_digest_opt_out", { p_group_id: groupId });
  if (error) throw error;
  return !!data;
}

/** Set the calling user's digest opt-out for a room. true = stop digests. */
export async function setRoomDigestOptOut(groupId: string, optOut: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_room_digest_opt_out", { p_group_id: groupId, p_opt_out: optOut });
  if (error) throw error;
}

export type RoomVisibility = {
  groupId: string;
  /** ms since epoch, or null if the user has never entered the room. */
  lastSeenAt: number | null;
  /** ms since epoch, or null if no canView-visible activity exists yet. */
  latestVisibleActivityAt: number | null;
};

/**
 * Per-room visibility state for the calling user. Returns one entry per
 * friend group the user is a member of. Compare `latestVisibleActivityAt`
 * against `lastSeenAt` (via roomHasNewVisibleActivity) to decide whether
 * to render a "new" indicator.
 */
export async function fetchRoomActivityVisibility(userId: string): Promise<RoomVisibility[]> {
  const { data, error } = await supabase.rpc("get_room_activity_visibility", { p_user_id: userId });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    groupId: r.group_id,
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).getTime() : null,
    latestVisibleActivityAt: r.latest_visible_activity_at
      ? new Date(r.latest_visible_activity_at).getTime()
      : null,
  }));
}

/**
 * "Has new visible activity since the user last saw the room?"
 * - NULL lastSeenAt + non-NULL activity → true (never visited; new content exists)
 * - NULL activity → false (nothing visible at the user's progress)
 * - Both set → true iff activity is newer than seen
 */
export function roomHasNewVisibleActivity(v: RoomVisibility): boolean {
  if (!v.latestVisibleActivityAt) return false;
  if (!v.lastSeenAt) return true;
  return v.latestVisibleActivityAt > v.lastSeenAt;
}

// ── Mobile: per-thread last-seen ─────────────────────────────────────────────
//
// Backed by 20260428_thread_views.sql. Independent of the per-room
// last_seen_at system (which still drives the rooms-list room-button dot).
// Mobile thread cards compare a thread's latest visible reply timestamp
// against the caller's per-(user, group, thread) last_seen_at to decide
// whether to render the new-activity dot. Threads the caller has never
// opened are absent from the map and treated as "never seen" — first
// visit shows dots on everything, matching prior behavior.
//
// Both functions throw on error so callers can degrade gracefully (no dots)
// when the migration hasn't been applied yet.

/** Stamp the calling user's per-thread last_seen_at to NOW(). */
export async function markThreadSeen(groupId: string, threadId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_thread_seen", {
    p_group_id: groupId,
    p_thread_id: threadId,
  });
  if (error) throw error;
}

/**
 * Per-thread last_seen_at map for the calling user in one room. Threads
 * the caller has never opened are absent from the result. Caller defaults
 * absence to "never seen" (-Infinity) when comparing against latest reply.
 */
export async function fetchThreadViewState(groupId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("get_thread_view_state", { p_group_id: groupId });
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ thread_id: string; last_seen_at: string }>) {
    out[r.thread_id] = new Date(r.last_seen_at).getTime();
  }
  return out;
}

// ── Per-thread read tracking — public context (20260429) ────────────────────
//
// Companion to mark_thread_seen / get_thread_view_state above (which cover
// friend-room context). Public-context wrappers stamp / fetch last_seen for
// public threads — drives the desktop relevance sort, the green badge
// freshness boundary on public threads, and the per-thread "I've read this"
// state outside friend rooms.
//
// Both functions throw on error so callers can degrade gracefully (fall back
// to localStorage lastOpenedAt) when the migration hasn't been applied.

/** Stamp the calling user's per-thread last_seen_at on a public thread. */
export async function markThreadPublicSeen(threadId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_thread_public_seen", {
    p_thread_id: threadId,
  });
  if (error) throw error;
}

/**
 * Per-thread last_seen_at map for the calling user across one show's public
 * threads. Threads the caller has never opened are absent; caller treats
 * absence as "never seen" (timestamp 0) when comparing against latest reply.
 */
export async function fetchThreadPublicViewState(showId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("get_thread_public_view_state", { p_show_id: showId });
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ thread_id: string; last_seen_at: string }>) {
    out[r.thread_id] = new Date(r.last_seen_at).getTime();
  }
  return out;
}

/** Share a thread to a friend group (creates group_threads row). */
export async function addThreadToGroup(threadId: string, groupId: string): Promise<void> {
  const { error } = await supabase
    .from("group_threads")
    .insert({ group_id: groupId, thread_id: threadId });
  if (error) throw error;
}

/** Remove a thread from a friend group (leaves tombstone in original thread). */
export async function removeThreadFromGroup(threadId: string, groupId: string): Promise<void> {
  const { error } = await supabase
    .from("group_threads")
    .delete()
    .eq("group_id", groupId)
    .eq("thread_id", threadId);
  if (error) throw error;
}

/** Fetch all threads shared to a group, progress-filtered for the viewer. */
export async function fetchGroupThreads(
  groupId: string,
  maxS: number,
  maxE: number,
  /**
   * Optional viewer id. When provided, replies authored by the viewer are
   * excluded from `latestVisibleReplyAt` (so the mobile thread-card
   * notification dot doesn't fire on the user's own posts). Reply *counts*
   * remain inclusive — own replies still count toward the "(N)" total.
   */
  viewerId?: string | null
): Promise<{
  threads: Thread[];
  replyCounts: Record<string, number>;
  /**
   * Per-thread max created_at among chain-visible replies (ms since epoch).
   * Mobile thread-card indicators use this together with the room's at-mount
   * last_seen snapshot to decide "this thread has new activity since you
   * last saw the room." Threads with no visible replies don't appear in
   * the map (caller defaults to 0).
   */
  latestVisibleReplyAt: Record<string, number>;
  /**
   * Per-thread count of HIDDEN replies (above the viewer's progress) on
   * threads the viewer authored. Used by the V2 friend-room map's red
   * notification dot on the viewer's own cells — "you have N responses in
   * this entry that you can't see yet." Populated ONLY for threads where
   * `author_id === viewerId`; absent otherwise. Excludes deleted replies.
   */
  hiddenCounts: Record<string, number>;
  /**
   * Per-thread MAX created_at of HIDDEN replies on threads the viewer
   * authored. Used by the V2 friend-room map to decide whether a prior
   * red-dot manual dismissal is still valid: if a new hidden reply lands
   * with `created_at > redDismissedAt[tid]`, the dismissal is stale and
   * red re-fires (so each new hidden reply gets a fresh chance to notify,
   * matching the green-dot's "new since last visit" semantic). Populated
   * only for threads where `author_id === viewerId` and at least one
   * hidden reply exists; absent otherwise.
   */
  latestHiddenReplyAt: Record<string, number>;
  /**
   * Per-thread count of replies above the viewer's progress, on ALL
   * threads (not just the viewer's own). Used by V2 friend rooms to
   * render "ahead-of-progress" stubs in RepliesList and to include those
   * stubs in the entry-card reply count display. Excludes deleted
   * replies. The corresponding stubs appear in RepliesList when its
   * `showAheadStubs` opt-in prop is set.
   */
  aheadCounts: Record<string, number>;
  /**
   * Per-thread `group_threads.shared_at` (ms) — when the entry ARRIVED in
   * this room. This is the room-relevant "time" (entry-card timestamp +
   * within-episode ordering), as opposed to threads.created_at (originally
   * written) or updated_at (last edited). For a privately-written post later
   * converted into the room, this is the conversion moment.
   */
  sharedAt: Record<string, number>;
}> {
  // Fetch threads linked to this group, with reply count scoped to this group_id
  // (shared seed threads have per-room reply copies — without the group_id filter,
  //  counts would include replies from every user's room).
  // `created_at` added to the embedded reply select so the per-thread "newest
  // visible reply" timestamp can be computed alongside the count.
  const { data, error } = await supabase
    .from("group_threads")
    .select("shared_at, threads(*, replies!thread_id(id, group_id, author_id, season, episode, is_deleted, referenced_reply_id, created_at))")
    .eq("group_id", groupId)
    .order("shared_at", { ascending: false });
  if (error) throw error;

  const threads: Thread[] = [];
  const replyCounts: Record<string, number> = {};
  const latestVisibleReplyAt: Record<string, number> = {};
  const hiddenCounts: Record<string, number> = {};
  const latestHiddenReplyAt: Record<string, number> = {};
  const aheadCounts: Record<string, number> = {};
  const sharedAt: Record<string, number> = {};
  for (const row of data ?? []) {
    const t = (row as any).threads;
    if (!t) continue;
    // Count only replies that are chain-visible at the viewer's progress:
    // scoped to this group, not deleted, self passes progress check, AND
    // every ancestor via referenced_reply_id also passes. An orphan reply
    // (self visible, parent hidden) must NOT count, or the card number
    // will drift from the in-thread render which applies the same rule.
    const allReplies = ((t.replies as any[]) ?? []);
    const byId: Record<string, any> = {};
    for (const r of allReplies) byId[r.id] = r;
    const selfVisible = (r: any) =>
      r.group_id === groupId && !r.is_deleted &&
      (r.season < maxS || (r.season === maxS && r.episode <= maxE));
    const chainVisible = (r: any): boolean => {
      if (!selfVisible(r)) return false;
      let cur = r.referenced_reply_id ? byId[r.referenced_reply_id] : null;
      while (cur) {
        if (!selfVisible(cur)) return false;
        cur = cur.referenced_reply_id ? byId[cur.referenced_reply_id] : null;
      }
      return true;
    };
    const visibleReplies = allReplies.filter(chainVisible);
    const replyCount = visibleReplies.length;
    if (t.is_deleted && replyCount === 0) continue;
    const thread = rowToThread(t);
    if (thread.season > maxS || (thread.season === maxS && thread.episode > maxE)) continue;
    threads.push(thread);
    sharedAt[thread.id] = (row as any).shared_at ? new Date((row as any).shared_at).getTime() : 0;
    replyCounts[thread.id] = replyCount;
    // Track per-thread newest visible reply timestamp for thread-card
    // "new since last visit" indicators.
    let maxAt = 0;
    for (const r of visibleReplies) {
      // Skip viewer's own replies — own posts shouldn't trigger the
      // "new since last visit" indicator on mobile thread cards.
      if (viewerId && r.author_id === viewerId) continue;
      const ts = r.created_at ? new Date(r.created_at).getTime() : 0;
      if (ts > maxAt) maxAt = ts;
    }
    if (maxAt > 0) latestVisibleReplyAt[thread.id] = maxAt;

    // Hidden-count: only populated for threads the viewer authored. Counts
    // group-scoped, not-deleted replies that the viewer can't see yet
    // (themselves above progress OR an ancestor above progress — i.e. NOT
    // chain-visible). Excludes the viewer's own replies (you wouldn't nudge
    // yourself about replies you wrote that are above your own progress).
    if (viewerId && t.author_id === viewerId) {
      let hidden = 0;
      let maxHiddenAt = 0;
      for (const r of allReplies) {
        if (r.group_id !== groupId) continue;
        if (r.is_deleted) continue;
        if (r.author_id === viewerId) continue;
        if (!chainVisible(r)) {
          hidden++;
          const ts = r.created_at ? new Date(r.created_at).getTime() : 0;
          if (ts > maxHiddenAt) maxHiddenAt = ts;
        }
      }
      if (hidden > 0) hiddenCounts[thread.id] = hidden;
      if (maxHiddenAt > 0) latestHiddenReplyAt[thread.id] = maxHiddenAt;
    }

    // Ahead-count: per-thread count of replies above viewer progress on
    // ALL threads. Drives V2 friend room's "ahead stubs" + the entry-card
    // reply count's inclusion of those stubs. Excludes deleted replies.
    // Counts a reply when ITSELF is above progress (orphans of ahead
    // replies are filtered out by chain-visibility upstream and don't
    // exist in practice — a responder's progress tag is monotonic, so
    // they couldn't have responded to an ahead reply at a lower tag).
    let ahead = 0;
    for (const r of allReplies) {
      if (r.group_id !== groupId) continue;
      if (r.is_deleted) continue;
      if (!(r.season > maxS || (r.season === maxS && r.episode > maxE))) continue;
      ahead++;
    }
    if (ahead > 0) aheadCounts[thread.id] = ahead;
  }
  return { threads, replyCounts, latestVisibleReplyAt, hiddenCounts, latestHiddenReplyAt, aheadCounts, sharedAt };
}

/** Rename a friend group. */
export async function renameFriendGroup(groupId: string, name: string): Promise<void> {
  validateLength("Group name", name, 1, 60);
  const { error } = await supabase
    .from("friend_groups")
    .update({ name })
    .eq("id", groupId);
  if (error) throw error;
}

/** Permanently delete a friend group. Cascades to members, shared threads, invitations. */
export async function deleteFriendGroup(groupId: string): Promise<void> {
  const { error } = await supabase
    .from("friend_groups")
    .delete()
    .eq("id", groupId);
  if (error) throw error;
}

/** Remove a member from a group (creator kicks member, or member leaves). */
export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("friend_group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Transfer group ownership to another member (by join order). */
export async function transferGroupOwnership(groupId: string, newOwnerId: string): Promise<void> {
  const { error } = await supabase
    .from("friend_groups")
    .update({ created_by: newOwnerId })
    .eq("id", groupId);
  if (error) throw error;
}

/** Soft-delete a friend group (sets deleted_at, removes all members). */
export async function softDeleteFriendGroup(groupId: string): Promise<void> {
  // Remove all members first
  const { error: mErr } = await supabase
    .from("friend_group_members")
    .delete()
    .eq("group_id", groupId);
  if (mErr) throw mErr;
  // Set deleted_at timestamp
  const { error } = await supabase
    .from("friend_groups")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", groupId);
  if (error) throw error;
}

/** Record a departed member (for "has left the room" display). */
export async function recordDepartedMember(groupId: string, userId: string, username: string): Promise<void> {
  const { error } = await supabase
    .from("friend_group_departed_members")
    .upsert({ group_id: groupId, user_id: userId, username, departed_at: new Date().toISOString() });
  if (error) throw error;
}

/** Remove departed member record (on rejoin). */
export async function removeDepartedMember(groupId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("friend_group_departed_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Fetch departed members for a group. */
export async function fetchDepartedMembers(groupId: string): Promise<{ userId: string; username: string; departedAt: number }[]> {
  const { data, error } = await supabase
    .from("friend_group_departed_members")
    .select("user_id, username, departed_at")
    .eq("group_id", groupId);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    username: r.username,
    departedAt: new Date(r.departed_at).getTime(),
  }));
}

// ── Invitations ───────────────────────────────────────────────────────────────

/** Create a single-use, time-limited invitation for an email address to join a group. */
export async function createInvitation(data: {
  groupId: string;
  createdBy: string;
  inviteeEmail: string;
  expiresInHours?: number;
}): Promise<Invitation> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + (data.expiresInHours ?? 48) * 60 * 60 * 1000
  ).toISOString();

  const { data: inserted, error } = await supabase
    .from("invitations")
    .insert({
      group_id:      data.groupId,
      created_by:    data.createdBy,
      invitee_email: data.inviteeEmail,
      token,
      expires_at:    expiresAt,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToInvitation(inserted);
}

function rowToInvitation(row: any): Invitation {
  return {
    id:           row.id,
    groupId:      row.group_id,
    createdBy:    row.created_by,
    inviteeEmail: row.invitee_email,
    token:        row.token,
    expiresAt:    new Date(row.expires_at).getTime(),
    acceptedAt:   row.accepted_at ? new Date(row.accepted_at).getTime() : null,
    createdAt:    new Date(row.created_at).getTime(),
  };
}

/** Fetch all pending (unused, unexpired) invitations the current user has sent. */
export async function fetchSentInvitations(userId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from("invitations")
    .select("*")
    .eq("created_by", userId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToInvitation);
}

// ── Send invite via Edge Function ─────────────────────────────────────────────

export type SendInviteResult =
  | { ok: true }
  | { ok: false; error: string; message?: string };

/**
 * Calls the `send-invite` Edge Function which validates the caller,
 * rate-limits, creates the DB row, and sends the email via Resend.
 */
export async function sendInvite(data: {
  groupId: string;
  groupName: string;
  inviteeEmail: string;
  inviterName: string;
}): Promise<SendInviteResult> {
  await checkRateLimit('send_invite', 6, 60);
  await checkRateLimitDaily('send_invite', 10);
  const { data: result, error } = await supabase.functions.invoke("send-invite", {
    body: { ...data, appUrl: window.location.origin },
  });
  if (error) {
    // FunctionsHttpError wraps non-2xx responses with a generic message
    // ("Edge Function returned a non-2xx status code") and stashes the raw
    // Response on `.context`. Parse the body so the real error code +
    // message reach the UI.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        if (body && typeof body === "object" && body.ok === false && typeof body.error === "string") {
          return { ok: false, error: body.error, message: body.message };
        }
        return {
          ok: false,
          error: "edge_function_error",
          message: `${error.message} (status ${ctx.status}${body ? `: ${JSON.stringify(body)}` : ""})`,
        };
      } catch {
        const text = await ctx.text().catch(() => "");
        return {
          ok: false,
          error: "edge_function_error",
          message: `${error.message} (status ${ctx.status}${text ? `: ${text}` : ""})`,
        };
      }
    }
    return { ok: false, error: "edge_function_error", message: error.message };
  }
  return result as SendInviteResult;
}

// ── Pings (round 1: friend-room one-way nudges) ───────────────────────────────

import type { Ping, PingType } from "../types";

export type SendMessageResult =
  | { ok: true; pingId: string; channel: "sticky" | "email"; warning?: string }
  | { ok: false; error: string; message?: string };

/**
 * Calls the `send-message` Edge Function. The function validates caller +
 * group membership + 7-day rate limit, writes the ping row, and (for
 * nudge_ahead only) sends the Resend email. Mirrors sendInvite's error
 * handling so non-2xx responses surface their structured error code +
 * message rather than the generic FunctionsHttpError wrapper.
 */
export async function sendMessage(args: {
  templateType: PingType;
  recipientId: string;
  groupId: string;
  message: string;
}): Promise<SendMessageResult> {
  const { data: result, error } = await supabase.functions.invoke("send-message", {
    body: {
      template_type: args.templateType,
      recipient_id:  args.recipientId,
      group_id:      args.groupId,
      message:       args.message,
    },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        if (body && typeof body === "object" && body.ok === false && typeof body.error === "string") {
          return { ok: false, error: body.error, message: body.message };
        }
        return {
          ok: false,
          error: "edge_function_error",
          message: `${error.message} (status ${ctx.status}${body ? `: ${JSON.stringify(body)}` : ""})`,
        };
      } catch {
        const text = await ctx.text().catch(() => "");
        return {
          ok: false,
          error: "edge_function_error",
          message: `${error.message} (status ${ctx.status}${text ? `: ${text}` : ""})`,
        };
      }
    }
    return { ok: false, error: "edge_function_error", message: error.message };
  }
  return result as SendMessageResult;
}

/**
 * Recipient stamps an active ping as dismissed. Returns true if the call
 * dismissed the row, false otherwise (not yours / doesn't exist /
 * already dismissed — all return false uniformly, no leak).
 */
export async function dismissPing(pingId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("dismiss_ping", { p_ping_id: pingId });
  if (error) throw error;
  return data === true;
}

type PingRow = {
  id:            string;
  sender_id:     string;
  recipient_id:  string;
  show_id:       string;
  group_id:      string;
  ping_type:     PingType;
  message:       string | null;
  sent_at:       string;
  dismissed_at:  string | null;
};

function rowToPing(row: PingRow, senderUsername?: string): Ping {
  return {
    id:            row.id,
    senderId:      row.sender_id,
    recipientId:   row.recipient_id,
    showId:        row.show_id,
    groupId:       row.group_id,
    pingType:      row.ping_type,
    message:       row.message,
    sentAt:        new Date(row.sent_at).getTime(),
    dismissedAt:   row.dismissed_at ? new Date(row.dismissed_at).getTime() : null,
    senderUsername,
  };
}

// (2026-05-24) Per-ping 24h rate limit removed. Friends can nudge as
// many times as they want; the only rate limit that remains is at the
// EMAIL layer — at most one nudge_ahead email per (sender, recipient,
// room) per 24h. See supabase/functions/send-message/index.ts for the
// email gate. The kill-switch machinery + hasRecentPing helper have
// been deleted; if a per-ping cap is ever wanted again, the index
// `pings_rate_limit_idx` is still in place (see 20260506 migration).

// ── Polls ─────────────────────────────────────────────────────────────────

export type PollDuration = "24h" | "3d" | "1w";

export type ActiveItemType = "poll" | "ask";

export type OpenPollResult =
  | { ok: true; pollId: string; replacedId: string | null; replacedType: ActiveItemType | null }
  | { ok: false; error: string; existingType?: ActiveItemType; existingId?: string };

export type OpenAskResult =
  | { ok: true; askId: string; replacedId: string | null; replacedType: ActiveItemType | null }
  | { ok: false; error: string; existingType?: ActiveItemType; existingId?: string };

/**
 * Calls the open_poll RPC. Validates membership, enforces the shared
 * one-active-item slot (poll OR SIKW ask per asker per room),
 * atomically creates the poll + options.
 *
 * On has_active_item: returns existingType + existingId so the
 * frontend can prompt for replacement-with-confirmation with copy
 * referencing the right kind of item.
 */
export async function openPoll(args: {
  groupId: string;
  question: string;
  allowWriteIn: boolean;
  duration: PollDuration;
  options: string[];
  replaceExisting: boolean;
}): Promise<OpenPollResult> {
  const { data, error } = await supabase.rpc("open_poll", {
    p_group_id:        args.groupId,
    p_question:        args.question,
    p_allow_write_in:  args.allowWriteIn,
    p_duration:        args.duration,
    p_options:         args.options,
    p_replace_existing: args.replaceExisting,
  });
  if (error) return { ok: false, error: error.message };
  if (!data || data.ok === false) {
    return {
      ok: false,
      error: data?.error || "unknown",
      existingType: data?.existing_type ?? undefined,
      existingId:   data?.existing_id   ?? undefined,
    };
  }
  return {
    ok: true,
    pollId:       data.poll_id,
    replacedId:   data.replaced_id ?? null,
    replacedType: data.replaced_type ?? null,
  };
}

/**
 * Calls the open_ask RPC for SIKW ("should I keep watching?") asks.
 * Same shared-slot semantics as openPoll. asker_progress_* are
 * stored at send time so respondents can render meaningful
 * episode-target dropdowns.
 */
export async function openAsk(args: {
  groupId: string;
  message: string;
  progressSeason: number;
  progressEpisode: number;
  replaceExisting: boolean;
}): Promise<OpenAskResult> {
  const { data, error } = await supabase.rpc("open_ask", {
    p_group_id:         args.groupId,
    p_message:          args.message,
    p_progress_season:  args.progressSeason,
    p_progress_episode: args.progressEpisode,
    p_replace_existing: args.replaceExisting,
  });
  if (error) return { ok: false, error: error.message };
  if (!data || data.ok === false) {
    return {
      ok: false,
      error: data?.error || "unknown",
      existingType: data?.existing_type ?? undefined,
      existingId:   data?.existing_id   ?? undefined,
    };
  }
  return {
    ok: true,
    askId:        data.ask_id,
    replacedId:   data.replaced_id ?? null,
    replacedType: data.replaced_type ?? null,
  };
}

export type SendPollEmailResult = {
  ok: boolean;
  error?: string;
  message?: string;
  channel?: string;
  warning?: string;
  sent_count?: number;
  failed_count?: number;
};

// ── SIKW asks: data shapes + fetch/write wrappers ────────────────────────

export type SikwReplyType = "stick_with_it" | "give_until" | "dropping_is_fair" | "custom";

export type SikwAsk = {
  id: string;
  askerId: string;
  groupId: string;
  message: string;
  askerProgressSeason: number;
  askerProgressEpisode: number;
  createdAt: number;
  closedAt: number | null;
};

export type SikwReply = {
  id: string;
  askId: string;
  replierId: string;
  replyType: SikwReplyType;
  episodeTargetSeason: number | null;
  episodeTargetEpisode: number | null;
  message: string | null;
  repliedAt: number;
};

type SikwAskRow = {
  id: string;
  asker_id: string;
  group_id: string;
  message: string;
  asker_progress_season: number;
  asker_progress_episode: number;
  created_at: string;
  closed_at: string | null;
};

type SikwReplyRow = {
  id: string;
  ask_id: string;
  replier_id: string;
  reply_type: SikwReplyType;
  episode_target_season: number | null;
  episode_target_episode: number | null;
  message: string | null;
  replied_at: string;
};

function rowToAsk(r: SikwAskRow): SikwAsk {
  return {
    id:                    r.id,
    askerId:               r.asker_id,
    groupId:               r.group_id,
    message:               r.message,
    askerProgressSeason:   r.asker_progress_season,
    askerProgressEpisode:  r.asker_progress_episode,
    createdAt:             new Date(r.created_at).getTime(),
    closedAt:              r.closed_at ? new Date(r.closed_at).getTime() : null,
  };
}

function rowToSikwReply(r: SikwReplyRow): SikwReply {
  return {
    id:                     r.id,
    askId:                  r.ask_id,
    replierId:              r.replier_id,
    replyType:              r.reply_type,
    episodeTargetSeason:    r.episode_target_season,
    episodeTargetEpisode:   r.episode_target_episode,
    message:                r.message,
    repliedAt:              new Date(r.replied_at).getTime(),
  };
}

export type SikwReplyWithUser = SikwReply & { replierUsername: string | null };

export type ActiveAskData = {
  ask: SikwAsk;
  askerUsername: string | null;
  myReply: SikwReply | null;
  /** Populated only when caller is the asker (RLS allows asker to read all). */
  allReplies: SikwReplyWithUser[];
  eligibleCount: number;
};

/**
 * Returns the room's currently-active SIKW ask + caller's own reply.
 * If caller is the asker, also returns ALL replies (RLS allows it).
 * Eligible count = members minus asker (asker doesn't reply).
 */
export async function fetchActiveRoomAsk(
  groupId: string,
  callerId: string,
): Promise<ActiveAskData | null> {
  const { data: askRow, error: askErr } = await supabase
    .from("sikw_asks")
    .select("*")
    .eq("group_id", groupId)
    .is("closed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (askErr) throw askErr;
  if (!askRow) return null;

  const ask = rowToAsk(askRow as SikwAskRow);
  const isAsker = ask.askerId === callerId;

  let askerUsername: string | null = null;
  const { data: askerProfile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", ask.askerId)
    .maybeSingle();
  if (askerProfile?.username) askerUsername = askerProfile.username;

  let myReply: SikwReply | null = null;
  if (!isAsker) {
    const { data: replyRow } = await supabase
      .from("sikw_replies")
      .select("*")
      .eq("ask_id", ask.id)
      .eq("replier_id", callerId)
      .maybeSingle();
    if (replyRow) myReply = rowToSikwReply(replyRow as SikwReplyRow);
  }

  let allReplies: SikwReplyWithUser[] = [];
  if (isAsker) {
    const { data: replyRows } = await supabase
      .from("sikw_replies")
      .select("*")
      .eq("ask_id", ask.id)
      .order("replied_at", { ascending: true });
    const ids = Array.from(new Set((replyRows ?? []).map((r: { replier_id: string }) => r.replier_id)));
    const userMap: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", ids);
      for (const p of profiles ?? []) {
        if (p.username) userMap[p.id as string] = p.username as string;
      }
    }
    allReplies = (replyRows ?? []).map((r) => {
      const base = rowToSikwReply(r as SikwReplyRow);
      return { ...base, replierUsername: userMap[base.replierId] ?? null };
    });
  }

  // Eligible count: members minus asker.
  const { count: memberCount } = await supabase
    .from("friend_group_members")
    .select("user_id", { count: "exact", head: true })
    .eq("group_id", groupId);
  const eligibleCount = Math.max(0, (memberCount ?? 0) - 1);

  return { ask, askerUsername, myReply, allReplies, eligibleCount };
}

export type ReplyToAskResult =
  | { ok: true; replyId: string; didClose: boolean; replyCount: number; eligibleCount: number }
  | { ok: false; error: string };

export async function replyToAsk(args: {
  askId: string;
  replyType: SikwReplyType;
  episodeTargetSeason?: number | null;
  episodeTargetEpisode?: number | null;
  message?: string | null;
}): Promise<ReplyToAskResult> {
  const { data, error } = await supabase.rpc("reply_to_ask", {
    p_ask_id:                  args.askId,
    p_reply_type:              args.replyType,
    p_episode_target_season:   args.episodeTargetSeason ?? null,
    p_episode_target_episode:  args.episodeTargetEpisode ?? null,
    p_message:                 args.message ?? null,
  });
  if (error) return { ok: false, error: error.message };
  if (!data || data.ok === false) return { ok: false, error: data?.error || "unknown" };
  return {
    ok:             true,
    replyId:        data.reply_id,
    didClose:       !!data.did_close,
    replyCount:     data.reply_count as number,
    eligibleCount:  data.eligible_count as number,
  };
}

export type ClosedAskData = {
  ask: SikwAsk;
  askerUsername: string | null;
  myReply: SikwReply | null;
  /** Populated only when caller is the asker. */
  allReplies: SikwReplyWithUser[];
  eligibleCount: number;
  myDismissed: boolean;
};

/**
 * Returns the most-recent closed SIKW ask in the room within the 1-week
 * post-close window, skipping any the caller has already dismissed.
 * Mirrors fetchMostRecentClosedRoomPoll. Replies stay private to asker
 * forever — RLS allows asker to read all, others to read only own.
 */
export async function fetchMostRecentClosedRoomAsk(
  groupId: string,
  callerId: string,
): Promise<ClosedAskData | null> {
  const since1w = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // SIKW dismissal is GLOBAL (per amendment) — once anyone in the room
  // X's a closed ask, the sticky vanishes for everyone. Implemented via
  // sikw_asks.dismissed_at column; we filter at the query level.
  const { data: askRow, error: askErr } = await supabase
    .from("sikw_asks")
    .select("*")
    .eq("group_id", groupId)
    .not("closed_at", "is", null)
    .gt("closed_at", since1w)
    .is("dismissed_at", null)
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (askErr) throw askErr;
  if (!askRow) return null;

  const ask = rowToAsk(askRow as SikwAskRow);
  const isAsker = ask.askerId === callerId;

  let askerUsername: string | null = null;
  const { data: askerProfile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", ask.askerId)
    .maybeSingle();
  if (askerProfile?.username) askerUsername = askerProfile.username;

  let myReply: SikwReply | null = null;
  if (!isAsker) {
    const { data: replyRow } = await supabase
      .from("sikw_replies")
      .select("*")
      .eq("ask_id", ask.id)
      .eq("replier_id", callerId)
      .maybeSingle();
    if (replyRow) myReply = rowToSikwReply(replyRow as SikwReplyRow);
  }

  let allReplies: SikwReplyWithUser[] = [];
  if (isAsker) {
    const { data: replyRows } = await supabase
      .from("sikw_replies")
      .select("*")
      .eq("ask_id", ask.id)
      .order("replied_at", { ascending: true });
    const ids = Array.from(new Set((replyRows ?? []).map((r: { replier_id: string }) => r.replier_id)));
    const userMap: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", ids);
      for (const p of profiles ?? []) {
        if (p.username) userMap[p.id as string] = p.username as string;
      }
    }
    allReplies = (replyRows ?? []).map((r) => {
      const base = rowToSikwReply(r as SikwReplyRow);
      return { ...base, replierUsername: userMap[base.replierId] ?? null };
    });
  }

  const { count: memberCount } = await supabase
    .from("friend_group_members")
    .select("user_id", { count: "exact", head: true })
    .eq("group_id", groupId);
  const eligibleCount = Math.max(0, (memberCount ?? 0) - 1);

  return {
    ask,
    askerUsername,
    myReply,
    allReplies,
    eligibleCount,
    myDismissed: false,
  };
}

export async function lazyCloseRoomAsks(groupId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("lazy_close_room_asks", { p_group_id: groupId });
  if (error) throw error;
  return (data ?? []) as string[];
}

export async function dismissClosedAsk(askId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("dismiss_closed_ask", { p_ask_id: askId });
  if (error) throw error;
  return data === true;
}

type PollRow = {
  id: string;
  asker_id: string;
  group_id: string;
  question: string;
  allow_write_in: boolean;
  duration: import("../types").PollDurationCode;
  created_at: string;
  closed_at: string | null;
};

type PollOptionRow = {
  id: string;
  poll_id: string;
  option_text: string;
  display_order: number;
};

type PollResponseRow = {
  id: string;
  poll_id: string;
  responder_id: string;
  option_id: string | null;
  write_in_text: string | null;
  responded_at: string;
};

export type ActivePollData = {
  poll: import("../types").Poll;
  options: import("../types").PollOption[];
  askerUsername: string | null;
  myResponse: import("../types").PollResponse | null;
};

function rowToPoll(r: PollRow): import("../types").Poll {
  return {
    id:           r.id,
    askerId:      r.asker_id,
    groupId:      r.group_id,
    question:     r.question,
    allowWriteIn: r.allow_write_in,
    duration:     r.duration,
    createdAt:    new Date(r.created_at).getTime(),
    closedAt:     r.closed_at ? new Date(r.closed_at).getTime() : null,
  };
}

function rowToPollOption(r: PollOptionRow): import("../types").PollOption {
  return {
    id:           r.id,
    pollId:       r.poll_id,
    optionText:   r.option_text,
    displayOrder: r.display_order,
  };
}

function rowToPollResponse(r: PollResponseRow): import("../types").PollResponse {
  return {
    id:           r.id,
    pollId:       r.poll_id,
    responderId:  r.responder_id,
    optionId:     r.option_id,
    writeInText:  r.write_in_text,
    respondedAt:  new Date(r.responded_at).getTime(),
  };
}

/**
 * Returns the room's currently-active poll (closed_at IS NULL),
 * its options, the asker's @username, and the caller's own response
 * if they've voted. Returns null when no active poll exists.
 *
 * Pre-close, RLS prevents callers from seeing OTHERS' responses;
 * the caller's own response is fetched separately and returned here.
 */
export async function fetchActiveRoomPoll(
  groupId: string,
  callerId: string,
): Promise<ActivePollData | null> {
  const { data: pollRow, error: pollErr } = await supabase
    .from("polls")
    .select("*")
    .eq("group_id", groupId)
    .is("closed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pollErr) throw pollErr;
  if (!pollRow) return null;

  const poll = rowToPoll(pollRow as PollRow);

  const { data: optionRows, error: optErr } = await supabase
    .from("poll_options")
    .select("*")
    .eq("poll_id", poll.id)
    .order("display_order", { ascending: true });
  if (optErr) throw optErr;
  const options = (optionRows ?? []).map((r) => rowToPollOption(r as PollOptionRow));

  // Best-effort asker @username
  let askerUsername: string | null = null;
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", poll.askerId)
    .maybeSingle();
  if (profileRow?.username) askerUsername = profileRow.username;

  // Caller's own response (RLS allows reading own row)
  const { data: responseRow } = await supabase
    .from("poll_responses")
    .select("*")
    .eq("poll_id", poll.id)
    .eq("responder_id", callerId)
    .maybeSingle();
  const myResponse = responseRow ? rowToPollResponse(responseRow as PollResponseRow) : null;

  return { poll, options, askerUsername, myResponse };
}

export type PollResponseWithUser = import("../types").PollResponse & {
  responderUsername: string | null;
};

export type ClosedPollData = {
  poll: import("../types").Poll;
  options: import("../types").PollOption[];
  askerUsername: string | null;
  responses: PollResponseWithUser[];
  eligibleCount: number;
  myDismissed: boolean;
};

/**
 * Marks a closed poll as dismissed for the caller. Idempotent —
 * returns true on first dismiss, false on repeats.
 */
export async function dismissClosedPoll(pollId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("dismiss_closed_poll", { p_poll_id: pollId });
  if (error) throw error;
  return data === true;
}

/**
 * Stamps closed_at on any open polls in this room whose duration has
 * elapsed. Race-safe via SQL — among parallel callers, exactly one
 * wins per expired poll. Returns the IDs that THIS call closed so
 * the caller can fire close emails for those.
 */
export async function lazyCloseRoomPolls(groupId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("lazy_close_room_polls", { p_group_id: groupId });
  if (error) throw error;
  return (data ?? []) as string[];
}

/**
 * Returns the most-recent closed poll in the room within the 48-hour
 * post-close visible window — UNLESS the caller has already dismissed
 * it, in which case looks at the next one. Also pulls all responses
 * (RLS allows post-close member reads) with responder usernames
 * resolved, plus the asker's @username.
 *
 * Returns null when no closed-and-not-dismissed poll exists in the
 * 48h window.
 */
export async function fetchMostRecentClosedRoomPoll(
  groupId: string,
  callerId: string,
): Promise<ClosedPollData | null> {
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Pull a small batch — most rooms won't have more than a couple
  // closed polls in 48h.
  const { data: pollRows, error: pollErr } = await supabase
    .from("polls")
    .select("*")
    .eq("group_id", groupId)
    .not("closed_at", "is", null)
    .gt("closed_at", since48h)
    .order("closed_at", { ascending: false })
    .limit(10);
  if (pollErr) throw pollErr;
  if (!pollRows || pollRows.length === 0) return null;

  const pollIds = pollRows.map((p: { id: string }) => p.id);

  // Caller's dismissals across these polls.
  const { data: dismissalRows } = await supabase
    .from("poll_dismissals")
    .select("poll_id")
    .eq("user_id", callerId)
    .in("poll_id", pollIds);
  const dismissedIds = new Set((dismissalRows ?? []).map((d: { poll_id: string }) => d.poll_id));

  const targetRow = pollRows.find((p: { id: string }) => !dismissedIds.has(p.id));
  if (!targetRow) return null;
  const poll = rowToPoll(targetRow as PollRow);

  const { data: optionRows } = await supabase
    .from("poll_options")
    .select("*")
    .eq("poll_id", poll.id)
    .order("display_order", { ascending: true });
  const options = (optionRows ?? []).map((r) => rowToPollOption(r as PollOptionRow));

  // Responses (post-close: RLS allows members to see all).
  const { data: responseRows } = await supabase
    .from("poll_responses")
    .select("*")
    .eq("poll_id", poll.id);

  const responderIds = Array.from(
    new Set((responseRows ?? []).map((r: { responder_id: string }) => r.responder_id)),
  );
  const userMap: Record<string, string> = {};
  if (responderIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", responderIds);
    for (const p of profiles ?? []) {
      if (p.username) userMap[p.id as string] = p.username as string;
    }
  }

  const responses: PollResponseWithUser[] = (responseRows ?? []).map((r) => {
    const base = rowToPollResponse(r as PollResponseRow);
    return { ...base, responderUsername: userMap[base.responderId] ?? null };
  });

  let askerUsername: string | null = null;
  const { data: askerProfile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", poll.askerId)
    .maybeSingle();
  if (askerProfile?.username) askerUsername = askerProfile.username;

  // Eligible count for the "X of N weighed in" footer.
  const { count: eligibleCount } = await supabase
    .from("friend_group_members")
    .select("user_id", { count: "exact", head: true })
    .eq("group_id", groupId);

  return {
    poll,
    options,
    askerUsername,
    responses,
    eligibleCount: eligibleCount ?? 0,
    myDismissed: false,
  };
}

/**
 * Calls get_poll_count RPC. Aggregate-only; never leaks vote content.
 * Used by both the asker's pre-close "X of N weighed in" footer and
 * by voters who want to see the same count.
 */
export async function fetchPollCount(pollId: string): Promise<{
  responseCount: number;
  eligibleCount: number;
  closed: boolean;
} | null> {
  const { data, error } = await supabase.rpc("get_poll_count", { p_poll_id: pollId });
  if (error) throw error;
  if (!data || data.ok === false) return null;
  return {
    responseCount: data.response_count as number,
    eligibleCount: data.eligible_count as number,
    closed:        !!data.closed,
  };
}

export type VoteOnPollResult =
  | { ok: true; responseId: string; didClose: boolean; responseCount: number; eligibleCount: number }
  | { ok: false; error: string };

/**
 * Calls vote_on_poll RPC. Records the vote (locks at submit via
 * UNIQUE constraint), checks all-voted close, returns didClose=true
 * if this vote triggered close. Frontend fires poll_close email when
 * didClose is true.
 *
 * Either optionId or writeInText is provided, never both.
 */
export async function voteOnPoll(args: {
  pollId: string;
  optionId?: string | null;
  writeInText?: string | null;
}): Promise<VoteOnPollResult> {
  const { data, error } = await supabase.rpc("vote_on_poll", {
    p_poll_id:   args.pollId,
    p_option_id: args.optionId ?? null,
    p_write_in:  args.writeInText ?? null,
  });
  if (error) return { ok: false, error: error.message };
  if (!data || data.ok === false) return { ok: false, error: data?.error || "unknown" };
  return {
    ok:             true,
    responseId:     data.response_id,
    didClose:       !!data.did_close,
    responseCount:  data.response_count as number,
    eligibleCount:  data.eligible_count as number,
  };
}

/**
 * Calls the send-message edge function with a SIKW template
 * (sikw_ask_invite or sikw_reply). Same response shape as
 * sendPollEmail.
 */
export async function sendSikwEmail(args: {
  templateType: "sikw_ask_invite" | "sikw_reply";
  askId: string;
}): Promise<SendPollEmailResult> {
  const { data: result, error } = await supabase.functions.invoke("send-message", {
    body: { template_type: args.templateType, ask_id: args.askId },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        if (body && typeof body === "object" && body.ok === false) {
          return { ok: false, error: body.error, message: body.message };
        }
      } catch {
        // fall through
      }
    }
    return { ok: false, error: "edge_function_error", message: error.message };
  }
  return result as SendPollEmailResult;
}

/**
 * Calls the send-message edge function with a poll template.
 * Fire-and-forget for poll_invite (multicast); single send for
 * poll_close and poll_vote_notification.
 */
export async function sendPollEmail(args: {
  templateType: "poll_invite" | "poll_close" | "poll_vote_notification";
  pollId: string;
}): Promise<SendPollEmailResult> {
  const { data: result, error } = await supabase.functions.invoke("send-message", {
    body: { template_type: args.templateType, poll_id: args.pollId },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        if (body && typeof body === "object" && body.ok === false) {
          return { ok: false, error: body.error, message: body.message };
        }
      } catch {
        // fall through
      }
    }
    return { ok: false, error: "edge_function_error", message: error.message };
  }
  return result as SendPollEmailResult;
}

/**
 * Returns the oldest undismissed ping for the caller in the given
 * room. Used by the in-room incoming-ping sticky.
 *
 * Filters:
 *   - recipient_id = caller (only incoming, not pings I sent)
 *   - group_id = the active room
 *   - dismissed_at IS NULL (not already dismissed)
 *
 * All ping_types surface in-room; nudge_ahead also delivers an email
 * but the sticky shows up the same way for consistency.
 *
 * Resolves the sender's @username via a separate profiles lookup.
 */
export async function fetchNextRoomPing(
  recipientUserId: string,
  groupId: string,
): Promise<Ping | null> {
  const { data, error } = await supabase
    .from("pings")
    .select("*")
    .eq("recipient_id", recipientUserId)
    .eq("group_id", groupId)
    .is("dismissed_at", null)
    .not("message", "is", null)
    .order("sent_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as PingRow;

  // Resolve sender username (best-effort — display falls back to "@a friend"
  // if the join misses).
  let senderUsername: string | undefined;
  const { data: prof } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", row.sender_id)
    .maybeSingle();
  if (prof?.username) senderUsername = prof.username;

  return rowToPing(row, senderUsername);
}

/**
 * Returns a per-show count of the caller's undismissed incoming
 * pings. Used by the journal rail dot signal — one query at App load,
 * drives both the per-show dot and (later) any pluralized tooltips.
 *
 * Same filter shape as fetchNextRoomPing: recipient = caller, not
 * dismissed. All ping_types count (nudge_ahead also surfaces in-room
 * now, in addition to its email).
 */
export async function fetchUndismissedPingCountsByShow(
  recipientUserId: string,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("pings")
    .select("show_id")
    .eq("recipient_id", recipientUserId)
    .is("dismissed_at", null)
    .not("message", "is", null);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const r of data ?? []) {
    if (r.show_id) {
      const sid = r.show_id as string;
      counts[sid] = (counts[sid] ?? 0) + 1;
    }
  }
  return counts;
}

// ── Accept invite via SECURITY DEFINER RPC ─────────────────────────────────────

/**
 * Look up an invitation by token for the accept page.
 * Uses the `get_invitation_by_token` SECURITY DEFINER RPC so unauthenticated
 * users can read invite metadata. Returns null for invalid/expired/used tokens.
 * Note: the actual invitation row data is returned directly by InviteAcceptPage
 * via supabase.rpc(); this export is kept for any other callers.
 */
export async function fetchInvitationByToken(token: string): Promise<Invitation | null> {
  const { data, error } = await supabase.rpc("get_invitation_by_token", { p_token: token });
  if (error || !data) return null;
  return {
    id:           data.id,
    groupId:      data.group_id,
    createdBy:    data.created_by ?? "",
    inviteeEmail: data.invitee_email ?? "",
    token,
    expiresAt:    new Date(data.expires_at).getTime(),
    acceptedAt:   null,
    createdAt:    new Date(data.created_at ?? data.expires_at).getTime(),
  };
}

/**
 * Atomically accept an invitation via the `accept_invitation` SECURITY DEFINER
 * RPC. Marks it used, adds the caller as a group member, and returns the
 * group_id on success (or null on failure).
 */
export async function acceptInvitation(token: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error || !data?.ok) return null;
  return (data as any).group_id ?? null;
}

// === Profile "Thoughts on..." pieces (2026-05-12, checkpoint 1) ===========
//
// Show-agnostic reflective writing that lives entirely on the V2 public
// profile. Two states: private (is_public=false, owner-only) or public
// (is_public=true, visible to visitors). UI enforces a one-way state
// machine — private→public is allowed, public→private is NOT. The
// `last_published_at` column is set on the private→public transition
// (and on fresh public inserts); never bumped on a public-piece edit.
//
// Reads are RLS-gated: visible if is_public=true OR caller owns the row.
// No RPC indirection needed — the privacy boundary is just is_public.

type ProfileThoughtRow = {
  id: string;
  author_id: string;
  title_completion: string;
  body: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  last_published_at: string | null;
};

const PROFILE_THOUGHT_COLS = "id, author_id, title_completion, body, is_public, created_at, updated_at, last_published_at";

function rowToProfileThought(row: ProfileThoughtRow): import("../types").ProfileThought {
  return {
    id: row.id,
    authorId: row.author_id,
    titleCompletion: row.title_completion,
    body: row.body,
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPublishedAt: row.last_published_at,
  };
}

/** Fetch every piece a user owns (private + public). Ordered by created_at
 *  desc; callers (V2ProfileSelfPage) re-sort client-side to put the
 *  currently-featured public piece first per the owner-view rule. */
export async function fetchProfileThoughtsForOwner(
  userId: string
): Promise<import("../types").ProfileThought[]> {
  const { data, error } = await supabase
    .from("profile_thoughts")
    .select(PROFILE_THOUGHT_COLS)
    .eq("author_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToProfileThought as any);
}

/** Fetch a user's public pieces only — for the visitor view. Ordered by
 *  last_published_at desc so the most recently published is first. RLS would
 *  hide private rows from a visitor anyway; the explicit is_public filter
 *  is defense-in-depth + makes the intent obvious at the call site. */
export async function fetchPublicProfileThoughtsByUserId(
  userId: string
): Promise<import("../types").ProfileThought[]> {
  const { data, error } = await supabase
    .from("profile_thoughts")
    .select(PROFILE_THOUGHT_COLS)
    .eq("author_id", userId)
    .eq("is_public", true)
    .order("last_published_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToProfileThought as any);
}

/** Insert a new piece. If isPublic is true, last_published_at is set to now()
 *  so the row immediately participates in the visitor-view sort. */
export async function insertProfileThought(args: {
  authorId: string;
  titleCompletion: string;
  body: string;
  isPublic: boolean;
}): Promise<import("../types").ProfileThought> {
  const insert: any = {
    author_id: args.authorId,
    title_completion: args.titleCompletion,
    body: args.body,
    is_public: args.isPublic,
  };
  if (args.isPublic) insert.last_published_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("profile_thoughts")
    .insert(insert)
    .select(PROFILE_THOUGHT_COLS)
    .single();
  if (error) throw error;
  return rowToProfileThought(data as ProfileThoughtRow);
}

/** Update an existing piece. Pass `bumpPublishedAt: true` ONLY on a true
 *  private→public transition (caller knows the prior state). Public→public
 *  edits should omit `bumpPublishedAt` so the row's featured position is
 *  preserved (edits don't reshuffle the carousel order — per spec).
 *
 *  This function does NOT enforce the no-public→private rule; callers (the
 *  compose modal) are responsible for never passing isPublic:false on a row
 *  that's already public. RLS allows the write regardless because owners
 *  can edit any field on their own rows; the UI is the gatekeeper. */
export async function updateProfileThought(
  id: string,
  updates: {
    titleCompletion?: string;
    body?: string;
    isPublic?: boolean;
    bumpPublishedAt?: boolean;
  }
): Promise<import("../types").ProfileThought> {
  const patch: any = {};
  if (updates.titleCompletion !== undefined) patch.title_completion = updates.titleCompletion;
  if (updates.body !== undefined) patch.body = updates.body;
  if (updates.isPublic !== undefined) patch.is_public = updates.isPublic;
  if (updates.bumpPublishedAt) patch.last_published_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("profile_thoughts")
    .update(patch)
    .eq("id", id)
    .select(PROFILE_THOUGHT_COLS)
    .single();
  if (error) throw error;
  return rowToProfileThought(data as ProfileThoughtRow);
}

export async function deleteProfileThought(id: string): Promise<void> {
  const { error } = await supabase
    .from("profile_thoughts")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ── V2 friend room: episode ratings + room map ─────────────────────────────//
// Drives the right-pane "season map" on /v2/room/:groupId. Rating capture UI
// ships in a follow-up spec — for this checkpoint, the read RPC + a stub
// upsert are exposed so the future capture step has typed handles.

export type EpisodeRating = {
  s: number;
  e: number;
  rating: number; // 1..6 — ascends with goodness. 1=Nope. 2=Losing me. 3=I'll keep going. 4=Solid. 5=Things are cooking. 6=Woah!
};

export type RoomMapEntry = {
  threadId: string;
  s: number;
  e: number;
  title: string;
  createdAt: number;
};

export type RoomMapMember = {
  userId: string;
  username: string | null;
  isDeparted: boolean;
  departedAt: number | null;
  progress: import("../types").ProgressEntry | null;
  ratings: EpisodeRating[];
  entries: RoomMapEntry[];
};

type RoomMapRPCRow = {
  user_id: string;
  username: string | null;
  is_departed: boolean;
  departed_at: string | null;
  progress_season: number | null;
  progress_episode: number | null;
  is_rewatching: boolean | null;
  highest_season: number | null;
  highest_episode: number | null;
  ratings: Array<{ s: number; e: number; r: number }> | null;
  entries: Array<{ thread_id: string; s: number; e: number; title: string; created_at: string }> | null;
};

function rowToRoomMapMember(row: RoomMapRPCRow): RoomMapMember {
  const hasProgress =
    typeof row.progress_season === "number" && typeof row.progress_episode === "number";
  return {
    userId: row.user_id,
    username: row.username,
    isDeparted: !!row.is_departed,
    departedAt: row.departed_at ? Date.parse(row.departed_at) : null,
    progress: hasProgress
      ? {
          s: row.progress_season as number,
          e: row.progress_episode as number,
          isRewatching: !!row.is_rewatching,
          highestS: row.highest_season ?? undefined,
          highestE: row.highest_episode ?? undefined,
        }
      : null,
    ratings: (row.ratings ?? []).map((r) => ({ s: r.s, e: r.e, rating: r.r })),
    entries: (row.entries ?? []).map((e) => ({
      threadId: e.thread_id,
      s: e.s,
      e: e.e,
      title: e.title,
      createdAt: Date.parse(e.created_at),
    })),
  };
}

/**
 * Single round-trip read for the V2 friend room map. Returns every member
 * (current + departed-and-not-rejoined) with their progress + ratings on the
 * room's show + this-room's entries by them. Caller must be a current member
 * of the group; the SECURITY DEFINER RPC raises `not_a_member` otherwise.
 */
export async function fetchRoomMapData(groupId: string): Promise<RoomMapMember[]> {
  const { data, error } = await supabase.rpc("get_room_map_data", { p_group_id: groupId });
  if (error) throw error;
  return ((data ?? []) as RoomMapRPCRow[]).map(rowToRoomMapMember);
}

/**
 * Upserts the caller's rating for one (show, season, episode). Rating capture
 * UI lands in a follow-up spec; this is exposed now so the data layer is in
 * place. DB CHECK enforces rating in 1..5; RLS pins user_id to auth.uid().
 */
/**
 * Single-call data fetch for one expanded thread inside the V2 friend room.
 * Bundles thread + chain-visible replies (group-scoped) + the caller's
 * thread/reply likes + citations into the thread's entry body and into
 * each reply, in two parallel fan-outs.
 *
 * Returns null when the thread doesn't exist (deleted, RLS-hidden, etc).
 */
export async function fetchV2ThreadDetail(
  threadId: string,
  groupId: string,
  userId: string,
): Promise<{
  thread: import("../types").Thread;
  replies: import("../types").Reply[];
  threadLikedByMe: boolean;
  replyLikedByMe: Set<string>;
  threadCitations: CitationEntry[];
  replyCitations: Map<string, CitationEntry[]>;
} | null> {
  const [thread, replies] = await Promise.all([
    fetchThreadById(threadId),
    fetchRepliesForThread(threadId, groupId),
  ]);
  if (!thread) return null;

  const replyIds = replies.map((r) => r.id);
  const [threadLikes, replyLikes, threadCitations, replyCitations] = await Promise.all([
    fetchUserThreadLikes(userId, [threadId]),
    fetchUserReplyLikes(userId, replyIds),
    fetchCitationsForThread(threadId),
    fetchCitationsForReplies(replyIds),
  ]);

  return {
    thread,
    replies,
    threadLikedByMe: threadLikes.has(threadId),
    replyLikedByMe: replyLikes,
    threadCitations,
    replyCitations,
  };
}

/**
 * Public-conversation counterpart to fetchV2ThreadDetail. Same bundle shape,
 * but pulls replies from the public channel (group_id IS NULL) and tolerates
 * a missing userId (logged-out visitors get empty like-state — they can read,
 * not interact). Returns null when the thread doesn't exist or isn't public.
 */
export async function fetchV2PublicThreadDetail(
  threadId: string,
  userId: string | null,
): Promise<{
  thread: import("../types").Thread;
  replies: import("../types").Reply[];
  threadLikedByMe: boolean;
  replyLikedByMe: Set<string>;
  threadCitations: CitationEntry[];
  replyCitations: Map<string, CitationEntry[]>;
} | null> {
  const [thread, replies] = await Promise.all([
    fetchThreadById(threadId),
    fetchPublicRepliesForThread(threadId),
  ]);
  if (!thread) return null;

  const replyIds = replies.map((r) => r.id);
  const [threadLikes, replyLikes, threadCitations, replyCitations] = await Promise.all([
    userId ? fetchUserThreadLikes(userId, [threadId]) : Promise.resolve(new Set<string>()),
    userId ? fetchUserReplyLikes(userId, replyIds) : Promise.resolve(new Set<string>()),
    fetchCitationsForThread(threadId),
    fetchCitationsForReplies(replyIds),
  ]);

  return {
    thread,
    replies,
    threadLikedByMe: threadLikes.has(threadId),
    replyLikedByMe: replyLikes,
    threadCitations,
    replyCitations,
  };
}

export async function upsertEpisodeRating(args: {
  userId: string;
  showId: string;
  season: number;
  episode: number;
  rating: number;
}): Promise<void> {
  const { error } = await supabase
    .from("episode_ratings")
    .upsert(
      {
        user_id: args.userId,
        show_id: args.showId,
        season_number: args.season,
        episode_number: args.episode,
        rating: args.rating,
      },
      { onConflict: "user_id,show_id,season_number,episode_number" },
    );
  if (error) throw error;
}

// Clear a rating. Used by the V2 friend room map's click-cycle, which
// includes "no rating" as a position between 6 and 1 (clicking a 6-rated
// cell removes the rating; the cell reverts to state 3 watched-unrated).
export async function deleteEpisodeRating(args: {
  userId: string;
  showId: string;
  season: number;
  episode: number;
}): Promise<void> {
  const { error } = await supabase
    .from("episode_ratings")
    .delete()
    .eq("user_id", args.userId)
    .eq("show_id", args.showId)
    .eq("season_number", args.season)
    .eq("episode_number", args.episode);
  if (error) throw error;
}

// ── Highlights (friend-room text annotations) ────────────────────────────

export type Highlight = {
  id: string;
  targetType: "thread" | "reply";
  targetId: string;
  groupId: string;
  authorId: string;
  authorUsername: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  kind: "yup" | "note";
  note: string | null;
  createdAt: number;
  /** Author's effective progress at the moment they CREATED the highlight.
   *  Spoiler tag: viewers must be at-or-past this to see the highlight.
   *  Snapshot semantics match threads.season/episode + replies.season/episode. */
  authorSeason: number;
  authorEpisode: number;
};

function rowToHighlight(row: any): Highlight {
  return {
    id:             row.id,
    targetType:     row.target_type,
    targetId:       row.target_id,
    groupId:        row.group_id,
    authorId:       row.author_id,
    authorUsername: row.profiles?.username ?? "unknown",
    startOffset:    row.start_offset,
    endOffset:      row.end_offset,
    quotedText:     row.quoted_text,
    kind:           row.kind,
    note:           row.note ?? null,
    createdAt:      new Date(row.created_at).getTime(),
    authorSeason:   row.author_season ?? 0,
    authorEpisode:  row.author_episode ?? 0,
  };
}

/**
 * Fetch highlights for a batch of targets. Used on entry / reply render to
 * pull every annotation for everything currently visible.
 *
 * Two-step query: first the highlights themselves, then a batched username
 * lookup. We can't use PostgREST's embedded `profiles(username)` join
 * because `highlights.author_id` references `auth.users(id)` directly
 * (not `profiles(id)`) — without a direct FK to profiles, the embed errors
 * out and the call returns []. The `friend_group_members → profiles` join
 * works only because that table has a direct FK to profiles.
 *
 * RLS gates SELECT on room membership; non-members get an empty result for
 * targets in rooms they're not in (not an error).
 *
 * When `viewerProgress` is provided, applies the spoiler filter: highlights
 * whose author snapshot (author_season / author_episode) is past the
 * viewer's effective progress are dropped. Mirrors the threads/replies
 * canView pattern. Pass undefined (or omit) to skip the filter — used by
 * the C10 notification-dot pipeline which has its own visibility logic.
 */
export async function fetchHighlights(args: {
  targetType: "thread" | "reply";
  targetIds: string[];
  viewerProgress?: ViewerProgress;
}): Promise<Highlight[]> {
  if (!args.targetIds.length) return [];
  const { data, error } = await supabase
    .from("highlights")
    .select("*")
    .eq("target_type", args.targetType)
    .in("target_id", args.targetIds)
    .order("start_offset", { ascending: true });
  if (error) {
    console.warn("fetchHighlights failed:", error);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Spoiler filter: drop rows where author snapshot is past viewer progress.
  // Done BEFORE the username lookup so we don't waste a round-trip on rows
  // we're going to discard anyway.
  const visibleRows = args.viewerProgress
    ? rows.filter((r: any) =>
        canView(
          { season: r.author_season ?? 0, episode: r.author_episode ?? 0 },
          args.viewerProgress,
        ),
      )
    : rows;
  if (visibleRows.length === 0) return [];

  // Batch-fetch usernames for all distinct authors in one round-trip.
  const authorIds = Array.from(new Set(visibleRows.map((r: any) => r.author_id)));
  const usernameById: Record<string, string> = {};
  const { data: profs, error: profErr } = await supabase
    .from("profiles")
    .select("id, username")
    .in("id", authorIds);
  if (profErr) {
    console.warn("fetchHighlights: profile lookup failed:", profErr);
    // Fall through with empty map; rowToHighlight defaults username to "unknown".
  }
  for (const p of profs ?? []) {
    usernameById[p.id] = p.username;
  }

  return visibleRows.map((r: any) =>
    rowToHighlight({ ...r, profiles: { username: usernameById[r.author_id] ?? "unknown" } }),
  );
}

/**
 * Create a highlight via the create_highlight RPC. The RPC runs the
 * membership, target-in-group, and overlap checks atomically.
 *
 * Server-side error codes are translated into user-facing messages:
 *   - "overlap"             → "Someone already highlighted part of this text."
 *   - "not_a_member"        → "You're not a member of this room."
 *   - "target_not_in_group" → "Couldn't attach the highlight — please refresh."
 *   - other                 → the raw error message
 *
 * Length validations mirror the DB CHECK constraints (1..2000 quoted_text,
 * 1..50 note when kind='note') so a malformed call fails fast on the client.
 */
export async function createHighlight(args: {
  targetType: "thread" | "reply";
  targetId: string;
  groupId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  kind: "yup" | "note";
  note?: string | null;
  /** Author's effective progress at create time — snapshotted onto the
   *  highlight row as the spoiler tag. Caller computes via
   *  effectiveProgress(viewerProgress). Falls back to 0/0 if undefined,
   *  which keeps the highlight visible to anyone who's started watching. */
  authorSeason: number;
  authorEpisode: number;
}): Promise<Highlight> {
  await checkRateLimit("create_highlight", 30, 60);
  validateLength("Highlighted text", args.quotedText, 1, 2000);
  if (args.kind === "note") {
    validateLength("Note", args.note ?? "", 1, 50);
  }
  if (args.endOffset <= args.startOffset) {
    throw new Error("Invalid highlight range.");
  }

  const { data, error } = await supabase.rpc("create_highlight", {
    p_target_type:    args.targetType,
    p_target_id:      args.targetId,
    p_group_id:       args.groupId,
    p_start_offset:   args.startOffset,
    p_end_offset:     args.endOffset,
    p_quoted_text:    args.quotedText,
    p_kind:           args.kind,
    p_note:           args.kind === "note" ? (args.note ?? "").trim() : null,
    p_author_season:  args.authorSeason,
    p_author_episode: args.authorEpisode,
  });
  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("overlap")) {
      throw new Error("Someone already highlighted part of this text.");
    }
    if (msg.includes("not_a_member")) {
      throw new Error("You're not a member of this room.");
    }
    if (msg.includes("target_not_in_group")) {
      throw new Error("Couldn't attach the highlight — please refresh.");
    }
    if (msg.includes("not_authenticated")) {
      throw new Error("Please sign in to highlight.");
    }
    throw error;
  }

  // The RPC returns the inserted row as a single object (RETURNS public.highlights).
  // PostgREST surfaces it without the embedded profiles join — fill in the
  // username locally via a quick lookup so the caller gets a fully-populated
  // Highlight (same shape as fetchHighlights). Best-effort: tooltip will show
  // "unknown" if the lookup fails, which is harmless.
  const inserted = data as any;
  let username = "unknown";
  try {
    const { data: prof } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", inserted.author_id)
      .single();
    if (prof?.username) username = prof.username;
  } catch (e) {
    console.warn("createHighlight: username lookup failed:", e);
  }
  return rowToHighlight({ ...inserted, profiles: { username } });
}

/**
 * Delete the caller's own highlight. RLS policy "highlights: author can delete"
 * gates this to author_id = auth.uid(); attempts to delete another user's
 * highlight silently no-op (zero rows affected, no error).
 */
export async function deleteHighlight(id: string): Promise<void> {
  const { error } = await supabase
    .from("highlights")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/**
 * Best-effort re-anchor of all highlights on a target after the body has
 * been edited. Calls the reanchor_highlights_for_target SECURITY DEFINER
 * RPC, which reads the (already-updated) body and walks every highlight:
 * updates offsets to the closest substring match, or deletes the highlight
 * if its quoted_text no longer appears.
 *
 * Errors are warned but NOT thrown — the body edit already succeeded, so
 * we don't want a re-anchor failure to surface as a failed edit. Worst
 * case the highlights stay stuck at their old offsets until next edit;
 * they may render at the wrong position or get filtered out by the
 * segment-bounds check. Better than failing the user's edit.
 *
 * Used by editThread / editReply automatically — callers don't need to
 * invoke this directly.
 */
export async function reanchorHighlightsForTarget(args: {
  targetType: "thread" | "reply";
  targetId: string;
}): Promise<void> {
  const { error } = await supabase.rpc("reanchor_highlights_for_target", {
    p_target_type: args.targetType,
    p_target_id:   args.targetId,
  });
  if (error) {
    console.warn("reanchorHighlightsForTarget failed:", error);
  }
}
