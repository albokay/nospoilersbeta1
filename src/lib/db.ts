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

export async function fetchThreadsForShow(showId: string): Promise<{ threads: Thread[]; replyCounts: Record<string, number> }> {
  const { data, error } = await supabase
    .from("threads")
    .select("*, replies(count)")
    .eq("show_id", showId)
    .eq("is_private", false)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const threads = (data ?? []).map(rowToThread);
  const replyCounts: Record<string, number> = {};
  for (const row of data ?? []) {
    replyCounts[row.id] = row.replies?.[0]?.count ?? 0;
  }
  return { threads, replyCounts };
}

// ── Write: threads ───────────────────────────────────────────────────────────

export async function insertThread(data: {
  showId: string; season: number; episode: number;
  authorId: string; authorName: string;
  title: string; preview: string; body: string; isPrivate: boolean;
}): Promise<Thread> {
  const row = {
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

export async function insertReply(data: {
  threadId: string; showId: string; season: number; episode: number;
  authorId: string; authorName: string; body: string; replyToId?: string;
}): Promise<Reply> {
  const row = {
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
