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

export type ReplyMeta = { id: string; season: number; episode: number; createdAt: number };

export async function fetchThreadsForShow(showId: string): Promise<{
  threads: Thread[];
  replyCounts: Record<string, number>;
  replyMeta: Record<string, ReplyMeta[]>;
  hasExternalReplies: Record<string, boolean>;
}> {
  const { data, error } = await supabase
    .from("threads")
    .select("*, replies(id, season, episode, created_at, author_id)")
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
    id:        row.id,
    threadId:  row.thread_id,
    showId:    row.show_id,
    season:    row.season,
    episode:   row.episode,
    author:    row.author_name,
    body:      row.body,
    updatedAt: new Date(row.updated_at).getTime(),
    likes:     row.likes_count ?? 0,
    replyToId: row.reply_to_id ?? undefined,
    isDeleted: row.is_deleted ?? false,
    isEdited:  row.is_edited ?? false,
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

// ── Replies ──────────────────────────────────────────────────────────────────

export async function insertReply(data: {
  threadId: string; showId: string; season: number; episode: number;
  authorId: string; authorName: string; body: string; replyToId?: string;
}): Promise<Reply> {
  const row = {
    id: crypto.randomUUID(),
    thread_id: data.threadId, show_id: data.showId,
    season: data.season, episode: data.episode,
    author_id: data.authorId, author_name: data.authorName,
    body: data.body, reply_to_id: data.replyToId ?? null, likes_count: 0,
  };
  const { data: inserted, error } = await supabase
    .from("replies").insert(row).select().single();
  if (error) throw error;
  return rowToReply(inserted);
}
