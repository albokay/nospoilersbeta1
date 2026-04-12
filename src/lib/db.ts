/**
 * Supabase query functions — typed, snake_case → camelCase mapped.
 * All reads are public (no auth required).
 */
import { supabase } from "./supabaseClient";
import type { Thread, Reply, FriendGroup, FriendGroupMember, Invitation } from "../types";
import type { PromptEntry } from "./promptData";
import { repliesByThread } from "./mockData";

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
    id:         row.id,
    showId:     row.show_id,
    season:     row.season,
    episode:    row.episode,
    author:     row.author_name,
    titleBase:  row.title,
    preview:    row.preview ?? "",
    body:       row.body ?? "",
    updatedAt:  new Date(row.updated_at).getTime(),
    likes:      row.likes_count ?? 0,
    isPublic:   row.is_public ?? false,
    isDeleted:  row.is_deleted ?? false,
    isEdited:   row.is_edited ?? false,
    isRewatch:  row.is_rewatch ?? false,
  };
}

export type ReplyMeta = { id: string; season: number; episode: number; createdAt: number; authorId: string };

export async function fetchThreadsForShow(showId: string): Promise<{
  threads: Thread[];
  replyCounts: Record<string, number>;
  replyMeta: Record<string, ReplyMeta[]>;
  hasExternalReplies: Record<string, boolean>;
}> {
  const { data, error } = await supabase
    .from("threads")
    .select("*, replies!thread_id(id, season, episode, created_at, author_id)")
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
}): Promise<Thread> {
  const row = {
    id: crypto.randomUUID(),
    show_id: data.showId, season: data.season, episode: data.episode,
    author_id: data.authorId, author_name: data.authorName,
    title: data.title, preview: data.preview, body: data.body,
    is_public: data.isPublic, likes_count: 0,
  };
  const { data: inserted, error } = await supabase
    .from("threads").insert(row).select().single();
  if (error) throw error;
  return rowToThread(inserted);
}

export async function editThread(threadId: string, title: string, body: string, season: number, episode: number): Promise<void> {
  const preview = body.slice(0, 240) + (body.length > 240 ? "…" : "");
  const { error } = await supabase
    .from("threads")
    .update({ title, body, preview, season, episode, is_edited: true, updated_at: new Date().toISOString() })
    .eq("id", threadId);
  if (error) throw error;
}

export async function deleteThread(threadId: string): Promise<void> {
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
  await supabase.from("likes_threads").insert({ user_id: userId, thread_id: threadId });
  await supabase.rpc("increment_thread_likes", { thread_id: threadId });
}

export async function unlikeThread(userId: string, threadId: string): Promise<void> {
  await supabase.from("likes_threads").delete().eq("user_id", userId).eq("thread_id", threadId);
  await supabase.rpc("decrement_thread_likes", { thread_id: threadId });
}

export async function likeReply(userId: string, replyId: string): Promise<void> {
  await supabase.from("likes_replies").insert({ user_id: userId, reply_id: replyId });
  await supabase.rpc("increment_reply_likes", { reply_id: replyId });
}

export async function unlikeReply(userId: string, replyId: string): Promise<void> {
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
    referenceType:      row.reference_type ?? null,
    referencedReplyId:  row.referenced_reply_id ?? null,
    referencedThreadId: row.referenced_thread_id ?? null,
    quotedText:         row.quoted_text ?? null,
  };
}

export async function fetchRepliesForThread(threadId: string): Promise<Reply[]> {
  // Seed threads live in memory — return them directly without hitting Supabase
  if (repliesByThread[threadId]) return repliesByThread[threadId];
  const { data, error } = await supabase
    .from("replies")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToReply);
}

export async function editReply(replyId: string, body: string, season: number, episode: number): Promise<void> {
  const { error } = await supabase
    .from("replies")
    .update({ body, season, episode, is_edited: true, updated_at: new Date().toISOString() })
    .eq("id", replyId);
  if (error) throw error;
}

export async function deleteReply(replyId: string): Promise<void> {
  const { error } = await supabase
    .from("replies")
    .update({ is_deleted: true })
    .eq("id", replyId);
  if (error) throw error;
}

// ── Profile page queries ──────────────────────────────────────────────────────

export async function fetchUserThreads(userId: string): Promise<Thread[]> {
  const { data, error } = await supabase
    .from("threads")
    .select("*")
    .eq("author_id", userId)
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToThread);
}

// Replies in threads the user started, not written by the user themselves
export async function fetchRepliesToUserThreads(userId: string): Promise<{ reply: Reply; thread: Thread }[]> {
  const { data: threadData, error: tErr } = await supabase
    .from("threads")
    .select("*")
    .eq("author_id", userId)
    .eq("is_deleted", false);
  if (tErr) throw tErr;
  const threads = (threadData ?? []).map(rowToThread);
  if (!threads.length) return [];

  const threadIds = threads.map(t => t.id);
  const threadById: Record<string, Thread> = {};
  for (const t of threads) threadById[t.id] = t;

  const { data: replyData, error: rErr } = await supabase
    .from("replies")
    .select("*")
    .in("thread_id", threadIds)
    .neq("author_id", userId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(200);
  if (rErr) throw rErr;

  return (replyData ?? []).map((row: any) => ({
    reply: rowToReply(row),
    thread: threadById[row.thread_id],
  })).filter(x => x.thread);
}

/** Replies written BY the user, with their parent thread for context. */
export async function fetchUserReplies(userId: string): Promise<{ reply: Reply; thread: Thread }[]> {
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
      if (!t || t.isDeleted) return null;
      return { reply: r, thread: t };
    })
    .filter(Boolean) as { reply: Reply; thread: Thread }[];
}

export async function fetchLikedThreads(userId: string): Promise<Thread[]> {
  const { data, error } = await supabase
    .from("likes_threads")
    .select("threads(*)")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? [])
    .map((row: any) => row.threads)
    .filter((t: any) => t && !t.is_deleted)
    .map(rowToThread)
    .sort((a: Thread, b: Thread) => b.updatedAt - a.updatedAt);
}

export async function fetchLikedReplies(userId: string): Promise<{ reply: Reply; thread: Thread }[]> {
  const { data, error } = await supabase
    .from("likes_replies")
    .select("replies(*)")
    .eq("user_id", userId);
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
  const row = {
    id: show.id,
    name: show.name,
    seasons: show.seasons,
    tvmaze_id: show.tvmazeId ?? null,
    status: show.status ?? "Ended",
    is_hidden: false,
    last_synced_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("shows").insert(row).select().single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    seasons: data.seasons,
    tvmazeId: data.tvmaze_id ?? undefined,
    status: data.status ?? "Ended",
    isHidden: data.is_hidden ?? false,
  };
}

// ── Staleness refresh ─────────────────────────────────────────────────────────

export async function refreshShowIfStale(show: Show): Promise<Show | null> {
  if (show.status !== "Running" || !show.tvmazeId) return null;
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const lastSync = show.lastSyncedAt ? new Date(show.lastSyncedAt).getTime() : 0;
  if (Date.now() - lastSync < SEVEN_DAYS) return null;

  // Fetch show metadata (genres, type) and episodes from TVmaze in parallel
  const [showRes, epRes] = await Promise.all([
    fetch(`https://api.tvmaze.com/shows/${show.tvmazeId}`),
    fetch(`https://api.tvmaze.com/shows/${show.tvmazeId}/episodes`),
  ]);
  if (!epRes.ok) return null;

  const episodes: any[] = await epRes.json();
  const bySeason: Record<number, number> = {};
  for (const ep of episodes) {
    if (ep.type === "regular" || !ep.type) {
      bySeason[ep.season] = (bySeason[ep.season] ?? 0) + 1;
    }
  }
  const maxSeason = Math.max(...Object.keys(bySeason).map(Number));
  const seasons: number[] = [];
  for (let i = 1; i <= maxSeason; i++) seasons.push(bySeason[i] ?? 1);
  if (!seasons.length) return null;

  let genres: string[] = show.genres ?? [];
  let tvmazeType: string | undefined = show.tvmazeType;
  if (showRes.ok) {
    const showData = await showRes.json();
    if (Array.isArray(showData.genres)) genres = showData.genres;
    if (showData.type) tvmazeType = showData.type;
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("shows")
    .update({ seasons, last_synced_at: now, genres, tvmaze_type: tvmazeType ?? null })
    .eq("id", show.id);
  if (error) return null;

  return { ...show, seasons, lastSyncedAt: now, genres, tvmazeType };
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

/** Shows a user is tracking (progress rows), sorted by show name. */
export async function fetchPublicProgressForUser(
  userId: string
): Promise<Record<string, { s: number; e: number }>> {
  const { data, error } = await supabase
    .from("progress")
    .select("show_id, season, episode")
    .eq("user_id", userId);
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
}): Promise<Reply> {
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
  userId: string,
  username: string,
  pageUrl: string,
  message: string
): Promise<void> {
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
  const { data: inserted, error } = await supabase
    .from("friend_groups")
    .insert({ show_id: data.showId, name: data.name, created_by: data.createdBy })
    .select()
    .single();
  if (error) throw error;
  // Add creator as first member
  await supabase
    .from("friend_group_members")
    .insert({ group_id: inserted.id, user_id: data.createdBy });
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
  const { data, error } = await supabase
    .from("group_threads")
    .select("threads(*, replies!thread_id(id))")
    .eq("group_id", groupId)
    .order("shared_at", { ascending: false });
  if (error) throw error;

  const threads: Thread[] = [];
  const replyCounts: Record<string, number> = {};
  for (const row of data ?? []) {
    const t = (row as any).threads;
    if (!t || t.is_deleted) continue;
    const thread = rowToThread(t);
    if (thread.season > maxS || (thread.season === maxS && thread.episode > maxE)) continue;
    threads.push(thread);
    replyCounts[thread.id] = ((t.replies as any[]) ?? []).filter(
      (r: any) => r.group_id === groupId
    ).length;
  }
  return { threads, replyCounts };
}

/** Rename a friend group. */
export async function renameFriendGroup(groupId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from("friend_groups")
    .update({ name })
    .eq("id", groupId);
  if (error) throw error;
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

/**
 * Look up an invitation by token (for the accept page).
 * Returns null if token is invalid, expired, or already used.
 */
export async function fetchInvitationByToken(token: string): Promise<Invitation | null> {
  const { data, error } = await supabase
    .from("invitations")
    .select("*")
    .eq("token", token)
    .single();
  if (error || !data) return null;
  const inv = rowToInvitation(data);
  if (inv.acceptedAt !== null) return null;           // already used
  if (inv.expiresAt < Date.now()) return null;        // expired
  return inv;
}

/**
 * Mark an invitation as accepted and add the user to the group.
 * Called after the user authenticates on the invite accept page.
 * Note: friend_group_members INSERT for the invitee bypasses the
 * "creator only" RLS via a Supabase Edge Function (service role).
 * This client-side function just marks the invite accepted.
 */
export async function acceptInvitation(token: string, userId: string): Promise<string | null> {
  const inv = await fetchInvitationByToken(token);
  if (!inv) return null;
  // Mark accepted
  await supabase
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("token", token);
  // Add member (requires service-role or relaxed RLS — see Edge Function)
  await supabase
    .from("friend_group_members")
    .insert({ group_id: inv.groupId, user_id: userId });
  return inv.groupId;
}
