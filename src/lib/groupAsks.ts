/**
 * "Thoughts on…" asks in the group chat (Alborz 2026-10-25, CP2) — the data
 * side of the card pinned at the top of a people-group's chat. Backed by
 * 20261025_group_asks.sql: `group_asks` (one open per group, earlier ones
 * kept for paging back), `ask_takes` (sealed by row policy until the viewer
 * has a take of their own), `ask_views` (seen / last-opened stamps), and the
 * `get_ask_answerers` RPC (who answered, without their words).
 *
 * Sidebar has no auth user, so an ask is not a chat message; the chat pages
 * draw the card from these rows above the messages.
 */
import { supabase } from "./supabaseClient";

export const ASK_TAKE_MAX_LENGTH = 240;
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

export type GroupAsk = {
  id: string;
  groupId: string;
  prompt: string;      // completes "Thoughts on …"
  createdAt: number;
  closedAt: number | null;
};

export type AskTake = { askId: string; userId: string; body: string; createdAt: number };

export type AskState = {
  ask: GroupAsk;
  /** Everyone who answered (names only), oldest first. */
  answerers: { userId: string; createdAt: number }[];
  /** The takes the viewer may read: their own, and everyone's once theirs is in. */
  takes: AskTake[];
  mine: AskTake | null;
  seenAt: number | null;
  lastOpenedAt: number | null;
};

/** Every ask of a group, newest first (the open one, if any, leads). */
export async function fetchGroupAsks(groupId: string): Promise<GroupAsk[]> {
  const { data, error } = await supabase
    .from("group_asks")
    .select("id, group_id, prompt, created_at, closed_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, groupId: r.group_id, prompt: r.prompt,
    createdAt: new Date(r.created_at).getTime(),
    closedAt: r.closed_at ? new Date(r.closed_at).getTime() : null,
  }));
}

/** The viewer's full picture of one ask: who answered, the takes they can
 *  read, their own, and their stamps. */
export async function fetchAskState(ask: GroupAsk, userId: string): Promise<AskState> {
  const [ans, takes, view] = await Promise.all([
    supabase.rpc("get_ask_answerers", { p_ask_id: ask.id }),
    supabase.from("ask_takes").select("ask_id, user_id, body, created_at").eq("ask_id", ask.id).order("created_at", { ascending: true }),
    supabase.from("ask_views").select("seen_at, last_opened_at").eq("ask_id", ask.id).eq("user_id", userId).maybeSingle(),
  ]);
  if (ans.error) throw ans.error;
  if (takes.error) throw takes.error;
  const rows: AskTake[] = (takes.data ?? []).map((r: any) => ({ askId: r.ask_id, userId: r.user_id, body: r.body, createdAt: new Date(r.created_at).getTime() }));
  return {
    ask,
    answerers: (ans.data ?? []).map((r: any) => ({ userId: r.user_id, createdAt: new Date(r.created_at).getTime() })),
    takes: rows,
    mine: rows.find((t) => t.userId === userId) ?? null,
    seenAt: view.data?.seen_at ? new Date(view.data.seen_at).getTime() : null,
    lastOpenedAt: view.data?.last_opened_at ? new Date(view.data.last_opened_at).getTime() : null,
  };
}

/** One line, sent once. */
export async function sendAskTake(askId: string, userId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text || text.length > ASK_TAKE_MAX_LENGTH) throw new Error("A take is one line, up to 240 characters.");
  const { error } = await supabase.from("ask_takes").insert({ ask_id: askId, user_id: userId, body: text });
  if (error) throw error;
}

/** The card was on screen (first time only; later calls change nothing). */
export async function markAskSeen(askId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("ask_views").upsert({ ask_id: askId, user_id: userId }, { onConflict: "ask_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}

/** The card is open on the viewer's screen now. */
export async function markAskOpened(askId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("ask_views").upsert({ ask_id: askId, user_id: userId, last_opened_at: new Date().toISOString() }, { onConflict: "ask_id,user_id" });
  if (error) throw error;
}

/** His rule for entering the chat: the card is OPEN when the viewer has no
 *  take yet, or when any take they can read is newer than the last time they
 *  had the card open; otherwise it is folded to the strip. */
export function askOpensOnEntry(s: AskState): boolean {
  if (!s.mine) return true;
  const newest = Math.max(0, ...s.takes.filter((t) => t.userId !== s.mine!.userId).map((t) => t.createdAt));
  return s.lastOpenedAt == null ? newest > 0 : newest > s.lastOpenedAt;
}

export type AskSignal = {
  /** The ask counts as one new thing on the chat button (landed since the
   *  viewer last opened the chat, and they have no take). */
  countsNew: boolean;
  /** Seen three days ago and still unanswered: the dot comes back. */
  dot: boolean;
};

/** The group page's chat button, for the open ask (if any). */
export async function fetchAskSignal(groupId: string, userId: string, chatLastSeenAt: number | null, now = Date.now()): Promise<AskSignal> {
  const none: AskSignal = { countsNew: false, dot: false };
  const { data, error } = await supabase
    .from("group_asks").select("id, created_at").eq("group_id", groupId).is("closed_at", null).maybeSingle();
  if (error || !data) return none;
  const [mine, view] = await Promise.all([
    supabase.from("ask_takes").select("ask_id").eq("ask_id", data.id).eq("user_id", userId).maybeSingle(),
    supabase.from("ask_views").select("seen_at").eq("ask_id", data.id).eq("user_id", userId).maybeSingle(),
  ]);
  if (mine.data) return none;
  const createdAt = new Date(data.created_at).getTime();
  const seenAt = view.data?.seen_at ? new Date(view.data.seen_at).getTime() : null;
  return {
    countsNew: chatLastSeenAt == null || createdAt > chatLastSeenAt,
    dot: seenAt != null && now - seenAt >= THREE_DAYS,
  };
}

/** The dashboards' group dots (Alborz 10-25): an open ask you haven't
 *  answered lights a group the way a new message does — when it landed since
 *  you last opened the chat, or once you saw it three days ago and still
 *  haven't answered. Returns the group ids that light. One pass for every
 *  group you're in (the row policies scope the reads). */
export async function fetchAskNewGroups(userId: string, chatLastSeenByGroup: Map<string, number | null>, now = Date.now()): Promise<Set<string>> {
  const out = new Set<string>();
  const { data: asks, error } = await supabase.from("group_asks").select("id, group_id, created_at").is("closed_at", null);
  if (error || !asks?.length) return out;
  const ids = asks.map((a: any) => a.id as string);
  const [mine, views] = await Promise.all([
    supabase.from("ask_takes").select("ask_id").in("ask_id", ids).eq("user_id", userId),
    supabase.from("ask_views").select("ask_id, seen_at").in("ask_id", ids).eq("user_id", userId),
  ]);
  const answered = new Set((mine.data ?? []).map((r: any) => r.ask_id as string));
  const seenAt = new Map((views.data ?? []).map((r: any) => [r.ask_id as string, new Date(r.seen_at).getTime()]));
  for (const a of asks as any[]) {
    if (answered.has(a.id)) continue;
    const createdAt = new Date(a.created_at).getTime();
    const lastSeen = chatLastSeenByGroup.get(a.group_id) ?? null;
    const countsNew = lastSeen == null || createdAt > lastSeen;
    const seen = seenAt.get(a.id);
    const dot = seen != null && now - seen >= THREE_DAYS;
    if (countsNew || dot) out.add(a.group_id);
  }
  return out;
}
