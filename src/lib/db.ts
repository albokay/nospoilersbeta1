/**
 * Supabase query functions — typed, snake_case → camelCase mapped.
 * All reads are public (no auth required).
 */
import { supabase } from "./supabaseClient";
import type { Thread, Reply } from "../types";

// ── Shows ────────────────────────────────────────────────────────────────────

export type Show = { id: string; name: string; seasons: number[] };

export async function fetchShows(): Promise<Show[]> {
  const { data, error } = await supabase
    .from("shows")
    .select("id, name, seasons")
    .order("name");
  if (error) throw error;
  return data as Show[];
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
  };
}

export type ReplyMeta = { id: string; season: number; episode: number; createdAt: number };

export async function fetchThreadsForShow(showId: string): Promise<{
  threads: Thread[];
  replyCounts: Record<string, number>;
  replyMeta: Record<string, ReplyMeta[]>;
}> {
  const { data, error } = await supabase
    .from("threads")
    .select("*, replies(id, season, episode, created_at)")
    .eq("show_id", showId)
    .eq("is_private", false)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const threads = (data ?? []).map(rowToThread);
  const replyCounts: Record<string, number> = {};
  const replyMeta: Record<string, ReplyMeta[]> = {};
  for (const row of data ?? []) {
    const replies = row.replies ?? [];
    replyCounts[row.id] = replies.length;
    replyMeta[row.id] = replies.map((r: any) => ({
      id: r.id,
      season: r.season,
      episode: r.episode,
      createdAt: new Date(r.created_at).getTime(),
    }));
  }
  return { threads, replyCounts, replyMeta };
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

export async function likeReply(userId: string, replyId: string): Promise<void> {
  await supabase.from("likes_replies").insert({ user_id: userId, reply_id: replyId });
  await supabase.rpc("increment_reply_likes", { reply_id: replyId });
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

// ── Profile page queries ──────────────────────────────────────────────────────

export async function fetchUserThreads(userId: string): Promise<Thread[]> {
  const { data, error } = await supabase
    .from("threads")
    .select("*")
    .eq("author_id", userId)
    .eq("is_private", false)
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
    .eq("is_private", false);
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
    .filter(Boolean)
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
      if (!r || !r.threads) return null;
      return { reply: rowToReply(r), thread: rowToThread(r.threads) };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.reply.updatedAt - a.reply.updatedAt) as { reply: Reply; thread: Thread }[];
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
