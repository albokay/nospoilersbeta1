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
