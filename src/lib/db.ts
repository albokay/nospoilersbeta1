/**
 * Supabase query functions — typed, snake_case → camelCase mapped.
 * All reads are public (no auth required).
 */
import { supabase } from "./supabaseClient";
import type { Thread, Reply, FriendGroup, FriendGroupMember, Invitation } from "../types";
import type { PromptEntry } from "./promptData";
import { repliesByThread } from "./mockData";

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

export async function editReply(replyId: string, body: string, season: number, episode: number): Promise<void> {
  validateLength("Reply", body, 1, 5000);
  const { error } = await supabase
    .from("replies")
    .update({ body, season, episode, is_edited: true, updated_at: new Date().toISOString() })
    .eq("id", replyId);
  if (error) throw error;
}

export async function deleteReply(replyId: string): Promise<void> {
  // Check if this reply is cited by another reply
  const { count: citedCount } = await supabase
    .from("response_citations")
    .select("id", { count: "exact", head: true })
    .eq("cited_reply_id", replyId);

  if (citedCount && citedCount > 0) {
    // Soft delete — keep stub so citation chain remains intact
    const { error } = await supabase
      .from("replies")
      .update({ is_deleted: true })
      .eq("id", replyId);
    if (error) throw error;
  } else {
    // Hard delete — not referenced anywhere, remove entirely
    // Clean up any citations this reply made
    await supabase.from("response_citations").delete().eq("citing_reply_id", replyId);
    const { error } = await supabase.from("replies").delete().eq("id", replyId);
    if (error) throw error;
  }
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
): Promise<{ thread: Thread; groupId?: string; groupName?: string }[]> {
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

  // Enrich with group context (same pattern as fetchRepliesToUserThreads)
  const threadIds = threads.map(t => t.id);
  const groupByThreadId: Record<string, { groupId: string; groupName: string }> = {};
  const { data: gtData } = await supabase
    .from("group_threads")
    .select("thread_id, friend_groups(id, name)")
    .in("thread_id", threadIds);
  for (const row of gtData ?? []) {
    const g = (row as any).friend_groups;
    if (g) groupByThreadId[row.thread_id] = { groupId: g.id, groupName: g.name };
  }

  return threads.map(thread => {
    const group = groupByThreadId[thread.id];
    return { thread, groupId: group?.groupId, groupName: group?.groupName };
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
export async function fetchUserReplies(userId: string, showId?: string): Promise<{ reply: Reply; thread: Thread }[]> {
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
      if (!t || t.isDeleted) return null;
      return { reply: r, thread: t };
    })
    .filter(Boolean) as { reply: Reply; thread: Thread }[];
}

export async function fetchLikedThreads(userId: string, showId?: string): Promise<Thread[]> {
  let query = supabase
    .from("likes_threads")
    .select("threads(*)")
    .eq("user_id", userId);
  if (showId) query = query.eq("threads.show_id", showId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? [])
    .map((row: any) => row.threads)
    .filter((t: any) => t && !t.is_deleted)
    .map(rowToThread)
    .sort((a: Thread, b: Thread) => b.updatedAt - a.updatedAt);
}

export async function fetchLikedReplies(userId: string, showId?: string): Promise<{ reply: Reply; thread: Thread }[]> {
  let query = supabase
    .from("likes_replies")
    .select("replies(*)")
    .eq("user_id", userId);
  if (showId) query = query.eq("replies.show_id", showId);
  const { data, error } = await query;
  if (error) throw error;
  const replies = (data ?? [])
    .map((row: any) => row.replies)
    .filter((r: any) => r && !r.is_deleted)
    .map(rowToReply);
  const threadIds = [...new Set(replies.map((r: Reply) => r.threadId))];
  if (!threadIds.length) return [];
  const { data: tData, error: tErr } = await supabase
    .from("threads").select("*").in("id", threadIds);
  if (tErr) throw tErr;
  const threadById: Record<string, Thread> = {};
  for (const t of (tData ?? []).map(rowToThread)) threadById[t.id] = t;
  return replies
    .map((r: Reply) => {
      const t = threadById[r.threadId];
      if (!t || t.isDeleted) return null;
      return { reply: r, thread: t };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.reply.updatedAt - a.reply.updatedAt) as { reply: Reply; thread: Thread }[];
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

// ── Progress ──────────────────────────────────────────────────────────────────

export async function fetchProgress(userId: string): Promise<Record<string, import("../types").ProgressEntry>> {
  const { data, error } = await supabase
    .from("progress")
    .select("show_id, season, episode, is_rewatching, rewatch_season, rewatch_episode, highest_season, highest_episode")
    .eq("user_id", userId);
  if (error) throw error;
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
    };
  }
  return result;
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

export type PublicProfile = { id: string; username: string };

/** Resolves a username → userId. Returns null if not found or is a seed user. */
export async function fetchPublicProfileByUsername(username: string): Promise<PublicProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, username, is_seed")
    .eq("username", username)
    .single();
  if (!data || data.is_seed) return null;
  return { id: data.id, username: data.username };
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
 *  Uses RPC to bypass owner-only RLS on the progress table. */
export async function fetchPublicProgressForUser(
  userId: string
): Promise<Record<string, { s: number; e: number }>> {
  const { data, error } = await supabase
    .rpc("get_public_progress", { target_user_id: userId });
  if (error) throw error;
  const result: Record<string, { s: number; e: number }> = {};
  for (const row of data ?? []) {
    result[row.show_id] = { s: row.season, e: row.episode };
  }
  return result;
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
  maxE: number
): Promise<{ threads: Thread[]; replyCounts: Record<string, number> }> {
  // Fetch threads linked to this group, with reply count scoped to this group_id
  // (shared seed threads have per-room reply copies — without the group_id filter,
  //  counts would include replies from every user's room)
  const { data, error } = await supabase
    .from("group_threads")
    .select("threads(*, replies!thread_id(id, group_id, season, episode, is_deleted, referenced_reply_id))")
    .eq("group_id", groupId)
    .order("shared_at", { ascending: false });
  if (error) throw error;

  const threads: Thread[] = [];
  const replyCounts: Record<string, number> = {};
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
    const replyCount = allReplies.filter(chainVisible).length;
    if (t.is_deleted && replyCount === 0) continue;
    const thread = rowToThread(t);
    if (thread.season > maxS || (thread.season === maxS && thread.episode > maxE)) continue;
    threads.push(thread);
    replyCounts[thread.id] = replyCount;
  }
  return { threads, replyCounts };
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
  await checkRateLimit('send_invite', 4, 60);
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
