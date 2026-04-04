/**
 * Supabase query functions — typed, snake_case → camelCase mapped.
 * All reads are public (no auth required).
 */
import { supabase } from "./supabaseClient";
import type { Thread, Reply } from "../types";

// ── Shows ────────────────────────────────────────────────────────────────────

export type Show = {
  id: string;
  name: string;
  seasons: number[];
  tvmazeId?: string;
  status?: string;
  isHidden?: boolean;
  lastSyncedAt?: string;
};

export async function fetchShows(): Promise<Show[]> {
  const { data, error } = await supabase
    .from("shows")
    .select("id, name, seasons, tvmaze_id, status, is_hidden, last_synced_at")
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
    isPrivate:  row.is_private ?? false,
    isDeleted:  row.is_deleted ?? false,
    isEdited:   row.is_edited ?? false,
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
  title: string; preview: string; body: string; isPrivate: boolean;
}): Promise<Thread> {
  const row = {
    id: crypto.randomUUID(),
    show_id: data.showId, season: data.season, episode: data.episode,
    author_id: data.authorId, author_name: data.authorName,
    title: data.title, preview: data.preview, body: data.body,
    is_private: data.isPrivate, likes_count: 0,
  };
  const { data: inserted, error } = await supabase
    .from("threads").insert(row).select().single();
  if (error) throw error;
  return rowToThread(inserted);
}

export async function editThread(threadId: string, title: string, body: string): Promise<void> {
  const preview = body.slice(0, 240) + (body.length > 240 ? "…" : "");
  const { error } = await supabase
    .from("threads")
    .update({ title, body, preview, is_edited: true, updated_at: new Date().toISOString() })
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

export async function makeThreadPrivate(threadId: string): Promise<void> {
  const { error } = await supabase
    .from("threads")
    .update({ is_private: true })
    .eq("id", threadId);
  if (error) throw error;
}

export async function makeThreadPublic(threadId: string): Promise<void> {
  const { error } = await supabase
    .from("threads")
    .update({ is_private: false })
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
    referenceType:      row.reference_type ?? null,
    referencedReplyId:  row.referenced_reply_id ?? null,
    referencedThreadId: row.referenced_thread_id ?? null,
    quotedText:         row.quoted_text ?? null,
  };
}

export async function fetchRepliesForThread(threadId: string): Promise<Reply[]> {
  const { data, error } = await supabase
    .from("replies")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToReply);
}

export async function editReply(replyId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from("replies")
    .update({ body, is_edited: true, updated_at: new Date().toISOString() })
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
    .select("*, threads(*)")
    .eq("author_id", userId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? [])
    .map((row: any) => {
      const t = row.threads;
      if (!t || t.is_deleted) return null;
      return { reply: rowToReply(row), thread: rowToThread(t) };
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
    .select("replies(*, threads(*))")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? [])
    .map((row: any) => {
      const r = row.replies;
      if (!r || !r.threads || r.is_deleted || r.threads.is_deleted) return null;
      return { reply: rowToReply(r), thread: rowToThread(r.threads) };
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

  // Fetch latest episodes from TVmaze
  const res = await fetch(`https://api.tvmaze.com/shows/${show.tvmazeId}/episodes`);
  if (!res.ok) return null;
  const episodes: any[] = await res.json();
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

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("shows")
    .update({ seasons, last_synced_at: now })
    .eq("id", show.id);
  if (error) return null;

  return { ...show, seasons, lastSyncedAt: now };
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

export async function fetchProgress(userId: string): Promise<Record<string, { s: number; e: number }>> {
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

export async function upsertProgress(userId: string, showId: string, s: number, e: number): Promise<void> {
  const { error } = await supabase
    .from("progress")
    .upsert({ user_id: userId, show_id: showId, season: s, episode: e }, { onConflict: "user_id,show_id" });
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

/** Public threads by a user — excludes deleted and private posts. */
export async function fetchPublicThreadsForUser(userId: string): Promise<Thread[]> {
  const { data, error } = await supabase
    .from("threads")
    .select("*")
    .eq("author_id", userId)
    .eq("is_deleted", false)
    .eq("is_private", false)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToThread);
}

/** Public replies by a user — excludes deleted replies and replies in deleted threads. */
export async function fetchPublicRepliesForUser(userId: string): Promise<{ reply: Reply; thread: Thread }[]> {
  const { data, error } = await supabase
    .from("replies")
    .select("*, threads(*)")
    .eq("author_id", userId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? [])
    .map((row: any) => {
      const t = row.threads;
      if (!t || t.is_deleted || t.is_private) return null;
      return { reply: rowToReply(row), thread: rowToThread(t) };
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
 * Fetch citations for a list of reply IDs, filtered by viewer progress.
 * Returns a Map: citedReplyId → array of {citingReplyId, index} sorted by creation order.
 */
export async function fetchCitationsForReplies(
  replyIds: string[],
  viewerSeason: number,
  viewerEpisode: number
): Promise<Map<string, CitationEntry[]>> {
  if (!replyIds.length) return new Map();

  const { data, error } = await supabase
    .from("response_citations")
    .select("cited_reply_id, citing_reply_id, created_at, replies!citing_reply_id(season, episode)")
    .in("cited_reply_id", replyIds)
    .order("created_at", { ascending: true });

  if (error) { console.warn("fetchCitationsForReplies error:", error.message); return new Map(); }

  const result = new Map<string, CitationEntry[]>();
  for (const row of data ?? []) {
    const citingReply = (row as any).replies;
    if (!citingReply) continue;
    // Filter: only show citation if the citing reply is within viewer's progress
    const cSeason = citingReply.season as number;
    const cEpisode = citingReply.episode as number;
    if (cSeason > viewerSeason || (cSeason === viewerSeason && cEpisode > viewerEpisode)) continue;

    const citedId = (row as any).cited_reply_id as string;
    if (!result.has(citedId)) result.set(citedId, []);
    const arr = result.get(citedId)!;
    arr.push({ citingReplyId: (row as any).citing_reply_id as string, index: arr.length + 1 });
  }
  return result;
}

/**
 * Fetch citations for an original thread entry, filtered by viewer progress.
 * Returns array of {citingReplyId, index}.
 */
export async function fetchCitationsForThread(
  threadId: string,
  viewerSeason: number,
  viewerEpisode: number
): Promise<CitationEntry[]> {
  const { data, error } = await supabase
    .from("response_citations")
    .select("citing_reply_id, created_at, replies!citing_reply_id(season, episode)")
    .eq("cited_thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) { console.warn("fetchCitationsForThread error:", error.message); return []; }

  const result: CitationEntry[] = [];
  for (const row of data ?? []) {
    const citingReply = (row as any).replies;
    if (!citingReply) continue;
    const cSeason = citingReply.season as number;
    const cEpisode = citingReply.episode as number;
    if (cSeason > viewerSeason || (cSeason === viewerSeason && cEpisode > viewerEpisode)) continue;
    result.push({ citingReplyId: (row as any).citing_reply_id as string, index: result.length + 1 });
  }
  return result;
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
