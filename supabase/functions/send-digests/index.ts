// ============================================================
// Supabase Edge Function: send-digests
//
// Daily friend-room digest emails (lean v1).
// Spec: sidebar_spec_friend_room_digest_emails.md
//
// One consolidated email per recipient, listing friend-room entries that
// became newly visible to them in the last 24h, grouped by room, names
// emphasized, no entry bodies. Sent at a single fixed time for everyone
// (the schedule lives in pg_cron — see 20260603_digest_cron.sql); this
// function is the engine and is timezone-agnostic.
//
// Invocation (NOT user-facing — cron + manual testing only):
//   POST  Header: x-digest-secret: <DIGEST_CRON_SECRET>
//   Body (all optional):
//     { "dry_run": true }            → compute + return who WOULD get mail, send nothing
//     { "only_user_id": "<uuid>" }   → restrict recipients to one user (testing)
//
// "New" = entry that ARRIVED in the room (group_threads.shared_at) in the
// last 24h, by another member, not deleted, that the recipient can currently
// see (progress gate). Keying on shared_at (not threads.created_at) means an
// entry written privately days ago and only just converted/shared into a room
// still counts as new-to-the-room. Entries that became visible only because
// the recipient advanced their progress past an OLDER entry are intentionally
// NOT included (lean v1 — no progress-history).
//
// Deck line (2026-07-26, swipe-deck deferred item): a digest ALSO carries one
// line naming the recipient's groupmates who answered more "How We Watch TV"
// questions in the window (deck_answers.created_at — first answers only,
// grid edits don't count). It rides digests; deck answers alone never
// trigger an email.
//
// 2026-09-13 (Alborz) — three additions:
//   • Room headings use the SHOW's catalog title (shows.name), not the
//     room row's stored name (which is the raw slug for show rooms —
//     "spidernoir" was reaching inboxes instead of "Spider-Noir").
//   • CHAT items: unseen-window group-chat messages become a per-group
//     section — "{Friend} messaged you." — linking to the group room with
//     the chat box open (/dashboard?g=<id>&chat=1; the app forks phones
//     to the mobile chat page).
//   • PROPOSAL items: a show proposed into a group for the FIRST time in
//     the window becomes its own section — bold show title (the room-
//     heading grammar) + "{Friend} proposed a new show to watch." —
//     linking to the group room. Later "yes" votes on an already-proposed
//     show never email anyone.
// Any one of the three types alone is enough to send a digest.
//
// Environment variables required:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   RESEND_API_KEY            (manual; reused from send-invite/send-message)
//   DIGEST_CRON_SECRET        (manual; shared secret gating invocation)
//   APP_URL                   (optional; defaults to https://beta.sidebar.watch)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FROM_ADDRESS = "Sidebar <invites@sidebar.watch>";
const WINDOW_HOURS = 24;

type Eff = { s: number; e: number };

// Mirrors src/lib/utils.ts effectiveProgress + canView. Kept in sync by hand
// (edge functions can't import from src). A rewatcher's spoiler ceiling is
// their highest reached episode, not their rewatch position.
function effectiveProgress(p: any): Eff {
  // Exact match for src/lib/utils.ts: use the rewatch ceiling only when BOTH
  // highest fields are present, else fall back to current position.
  if (p.is_rewatching && p.highest_season != null && p.highest_episode != null) {
    return { s: p.highest_season, e: p.highest_episode };
  }
  return { s: p.season ?? 0, e: p.episode ?? 0 };
}
function canView(season: number, episode: number, eff: Eff): boolean {
  return season < eff.s || (season === eff.s && episode <= eff.e);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Join already-formatted display names ("Johnny" or "@handle" — each carries
// its own @ or not): "a" / "a and b" / "a, b, and c".
function formatNames(names: string[]): string {
  const u = [...new Set(names)];
  if (u.length === 0) return "";
  if (u.length === 1) return u[0];
  if (u.length === 2) return `${u[0]} and ${u[1]}`;
  return `${u.slice(0, -1).join(", ")}, and ${u[u.length - 1]}`;
}

async function sendResendEmail(
  resendKey: string,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html, text }),
    });
    if (!res.ok) {
      console.error("Resend error:", await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Resend fetch error:", err);
    return false;
  }
}

// authorName is the recipient's display name for the author: their given
// (contact) name if set, else "@handle", else a graceful fallback. Already
// formatted — no @ is added downstream.
type DigestEntry = { threadId: string; title: string; authorName: string };
// Responses (Alborz 2026-09-22): friends' replies on threads the recipient is
// PART OF (wrote, or responded in) — the same scope as the in-app green
// signal. ownerName is null when the entry is the recipient's own ("your
// entry"). Only READABLE replies are ever emailed; hidden (ahead-of-progress)
// ones stay an in-app red dot and never leak into mail.
type DigestResponse = { threadId: string; title: string; ownerName: string | null; responderNames: string[] };
type RoomDigest = { groupId: string; roomName: string; entries: DigestEntry[]; authorNames: string[]; responses: DigestResponse[] };
type ProposalDigest = { groupId: string; showName: string; proposerName: string };
type ChatDigest = { groupId: string; groupLabel: string; senderNames: string[] };

const SECTION_H2 = `margin:0 0 6px;font-size:18px;color:#1a2c3a;font-weight:800;line-height:1.3`;
const ITEM_P = `margin:0 0 8px;font-size:15px;color:#1a2c3a;line-height:1.5`;

function buildDigestHtml(
  rooms: RoomDigest[],
  baseUrl: string,
  deckNames: string[] = [],
  proposals: ProposalDigest[] = [],
  chats: ChatDigest[] = [],
  greetName: string | null = null,
): string {
  const sections = rooms
    .map((r) => {
      const multiAuthor = r.authorNames.length > 1;
      const verb = r.entries.length === 1 ? "left a new letter" : "left new letters";
      const items = r.entries
        .map((e) => {
          // CP7: point at the restructured show room. The id lines up (a
          // parented friend_groups id IS the show-room roomId); ShowRoomPage
          // reads ?entry= and auto-expands the post. Old emails still resolve
          // via the /room/:id -> /show-room/:id redirect.
          const url = `${baseUrl}/show-room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(e.threadId)}`;
          const byline = multiAuthor
            ? ` <span style="color:rgba(26,44,58,0.6)">by ${escapeHtml(e.authorName)}</span>`
            : "";
          return `<p style="${ITEM_P}">&mdash; <a href="${url}" style="color:#1a2c3a;font-style:italic;font-weight:600">&ldquo;${escapeHtml(e.title)}&rdquo;</a>${byline}</p>`;
        })
        .join("");
      const intro = r.entries.length
        ? `<p style="margin:0 0 12px;font-size:15px;color:#1a2c3a;line-height:1.55">${escapeHtml(formatNames(r.authorNames))} ${verb}:</p>`
        : "";
      const responses = r.responses
        .map((x) => {
          const url = `${baseUrl}/show-room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(x.threadId)}`;
          const whose = x.ownerName === null ? "your" : `${escapeHtml(x.ownerName)}&rsquo;s`;
          return `<p style="${ITEM_P}">&mdash; <a href="${url}" style="color:#1a2c3a;font-weight:600">${escapeHtml(formatNames(x.responderNames))} responded to ${whose} letter <span style="font-style:italic">&ldquo;${escapeHtml(x.title)}&rdquo;</span></a></p>`;
        })
        .join("");
      return `
  <div style="margin:0 0 28px">
    <h2 style="${SECTION_H2}">${escapeHtml(r.roomName)}</h2>
    ${intro}${items}${responses}
  </div>`;
    })
    .join("");

  // Proposals: the show title carries the section (bold, the room-heading
  // grammar); the line links into the group room.
  const proposalSections = proposals
    .map((p) => {
      const url = `${baseUrl}/dashboard?g=${encodeURIComponent(p.groupId)}`;
      return `
  <div style="margin:0 0 28px">
    <h2 style="${SECTION_H2}">${escapeHtml(p.showName)}</h2>
    <p style="${ITEM_P}">&mdash; <a href="${url}" style="color:#1a2c3a;font-weight:600">${escapeHtml(p.proposerName)} proposed a new show to watch.</a></p>
  </div>`;
    })
    .join("");

  // Chats: one section per group; the link opens the room WITH the chat box.
  const chatSections = chats
    .map((c) => {
      const url = `${baseUrl}/dashboard?g=${encodeURIComponent(c.groupId)}&chat=1`;
      return `
  <div style="margin:0 0 28px">
    <h2 style="${SECTION_H2}">${escapeHtml(c.groupLabel)}</h2>
    <p style="${ITEM_P}">&mdash; <a href="${url}" style="color:#1a2c3a;font-weight:600">${escapeHtml(formatNames(c.senderNames))} messaged you.</a></p>
  </div>`;
    })
    .join("");

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ffffff;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:56px 32px">
  ${greetName ? `<p style="margin:0 0 10px;font-size:15px;color:#1a2c3a;line-height:1.5">Hi ${escapeHtml(greetName)},</p>` : ""}
  <h1 style="margin:0 0 28px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    What your friends wrote today.
  </h1>
  ${sections}${proposalSections}${chatSections}${deckNames.length ? `
  <p style="margin:0 0 28px;font-size:15px;color:#1a2c3a;line-height:1.55">${escapeHtml(formatNames(deckNames))} answered more &ldquo;How We Watch TV&rdquo; questions.</p>` : ""}
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    To stop getting emails about your friend rooms, open a room and click the &#9881;&#65039; next to its name, then choose &ldquo;unsubscribe.&rdquo;
  </p>
</div>
</body>
</html>`;
}

// Subject (Alborz 2026-09-22): ONE specific line instead of the fixed "What
// your friends wrote today." — a subject identical for everyone every day is
// the classic bulk-mail fingerprint Gmail files under Promotions. Names the
// most specific item by rank — entries → responses → chat → proposals → deck —
// and admits the rest with ", and more". The h1 stays the stable frame.
function buildSubject(rooms: RoomDigest[], chats: ChatDigest[], proposals: ProposalDigest[], deckNames: string[]): string {
  const entryRooms = rooms.filter((r) => r.entries.length > 0);
  const respRooms = rooms.filter((r) => r.responses.length > 0);
  const kinds = [entryRooms.length > 0, respRooms.length > 0, chats.length > 0, proposals.length > 0, deckNames.length > 0].filter(Boolean).length;
  let lead = "What your friends wrote today";
  if (entryRooms.length) {
    const authors = [...new Set(entryRooms.flatMap((r) => r.authorNames))];
    if (entryRooms.length === 1) lead = `${formatNames(authors)} wrote about ${entryRooms[0].roomName}`;
    else if (entryRooms.length === 2 && authors.length === 1) lead = `${authors[0]} wrote about ${entryRooms[0].roomName} and ${entryRooms[1].roomName}`;
    else lead = `New letters in ${entryRooms.length} of your rooms`;
  } else if (respRooms.length) {
    const all = respRooms.flatMap((r) => r.responses);
    if (all.length === 1) {
      const x = all[0];
      lead = `${formatNames(x.responderNames)} responded to ${x.ownerName === null ? "your" : `${x.ownerName}'s`} ${respRooms[0].roomName} letter`;
    } else if (respRooms.length === 1) lead = `New responses in ${respRooms[0].roomName}`;
    else lead = `New responses in ${respRooms.length} of your rooms`;
  } else if (chats.length) {
    lead = chats.length === 1 ? `${formatNames(chats[0].senderNames)} messaged you in ${chats[0].groupLabel}` : `New messages in ${chats.length} groups`;
  } else if (proposals.length) {
    lead = proposals.length === 1 ? `${proposals[0].proposerName} proposed ${proposals[0].showName}` : `${proposals.length} new show proposals`;
  } else if (deckNames.length) {
    lead = `${formatNames(deckNames)} answered more How We Watch TV questions`;
  }
  return kinds > 1 ? `${lead}, and more` : lead;
}

function buildDigestText(
  rooms: RoomDigest[],
  baseUrl: string,
  deckNames: string[] = [],
  proposals: ProposalDigest[] = [],
  chats: ChatDigest[] = [],
  greetName: string | null = null,
): string {
  const sections = rooms
    .map((r) => {
      const multiAuthor = r.authorNames.length > 1;
      const verb = r.entries.length === 1 ? "left a new letter" : "left new letters";
      const items = r.entries
        .map((e) => {
          const url = `${baseUrl}/show-room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(e.threadId)}`;
          const byline = multiAuthor ? ` by ${e.authorName}` : "";
          return `  - "${e.title}"${byline} — ${url}`;
        })
        .join("\n");
      const responses = r.responses
        .map((x) => {
          const url = `${baseUrl}/show-room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(x.threadId)}`;
          const whose = x.ownerName === null ? "your" : `${x.ownerName}'s`;
          return `  - ${formatNames(x.responderNames)} responded to ${whose} letter "${x.title}" — ${url}`;
        })
        .join("\n");
      const head = r.entries.length ? `${r.roomName}\n${formatNames(r.authorNames)} ${verb}:\n${items}` : r.roomName;
      return responses ? `${head}\n${responses}` : head;
    })
    .join("\n\n");

  const proposalLines = proposals
    .map((p) => `${p.showName}\n${p.proposerName} proposed a new show to watch. — ${baseUrl}/dashboard?g=${encodeURIComponent(p.groupId)}`)
    .join("\n\n");
  const chatLines = chats
    .map((c) => `${c.groupLabel}\n${formatNames(c.senderNames)} messaged you. — ${baseUrl}/dashboard?g=${encodeURIComponent(c.groupId)}&chat=1`)
    .join("\n\n");

  const deckLine = deckNames.length
    ? `\n\n${formatNames(deckNames)} answered more "How We Watch TV" questions.`
    : "";
  const blocks = [sections, proposalLines, chatLines].filter(Boolean).join("\n\n");
  return `${greetName ? `Hi ${greetName},\n\n` : ""}What your friends wrote today.

${blocks}${deckLine}

To stop getting emails about your friend rooms, open a room and click the gear icon next to its name, then choose "unsubscribe."`;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("DIGEST_CRON_SECRET");
  const provided = req.headers.get("x-digest-secret");
  if (!secret || provided !== secret) return json({ error: "unauthorized" }, 401);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "missing_resend_key" }, 500);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const baseUrl = (Deno.env.get("APP_URL") ?? "https://beta.sidebar.watch").replace(/\/$/, "");
  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; only_user_id?: string };
  const dryRun = !!body.dry_run;
  const onlyUserId = body.only_user_id ?? null;

  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  // 1. Friend-room entries that ARRIVED in a room in the last 24h, keyed on
  //    group_threads.shared_at (when the entry was linked into the room) — NOT
  //    threads.created_at — so a privately-written post that was just converted
  //    or shared into a room still counts as new-to-the-room. Each link is per
  //    (room, thread), which matches the per-room digest grouping. The thread
  //    row is pulled in via the embedded join.
  //    (2026-09-13: no early return on empty — chat/proposal items can carry
  //    a digest on their own.)
  const { data: links, error: linkErr } = await admin
    .from("group_threads")
    .select("group_id, thread_id, shared_at, threads(id, author_id, title, season, episode, is_deleted, is_public)")
    .gte("shared_at", since);
  if (linkErr) return json({ error: "links_query_failed", detail: linkErr.message }, 500);

  // Keep only live friend-room entries (not deleted, not public).
  const recentLinks = ((links ?? []) as any[]).filter(
    (l) => l.threads && !l.threads.is_deleted && l.threads.is_public === false,
  );

  // 1b. Chat messages in the window (people-group chat boxes).
  const { data: chatRows } = await admin
    .from("group_messages")
    .select("group_id, author_id, created_at")
    .gte("created_at", since);
  const recentChats = (chatRows ?? []) as any[];

  // 1c. Proposals: interest votes in the window. A vote is a PROPOSAL only
  //     when its (group, show) pair had NO votes before the window — later
  //     "yes, me too" votes never email anyone.
  const { data: voteRows } = await admin
    .from("group_show_votes")
    .select("group_id, show_id, user_id, created_at")
    .gte("created_at", since);
  const recentVotes = (voteRows ?? []) as any[];
  let proposals: { groupId: string; showId: string; proposerId: string }[] = [];
  if (recentVotes.length) {
    const vGroupIds = [...new Set(recentVotes.map((v) => v.group_id))];
    const vShowIds = [...new Set(recentVotes.map((v) => v.show_id))];
    const { data: priorRows } = await admin
      .from("group_show_votes")
      .select("group_id, show_id")
      .in("group_id", vGroupIds)
      .in("show_id", vShowIds)
      .lt("created_at", since);
    const priorPairs = new Set(((priorRows ?? []) as any[]).map((v) => `${v.group_id}|${v.show_id}`));
    const earliestByPair = new Map<string, any>();
    for (const v of recentVotes) {
      const key = `${v.group_id}|${v.show_id}`;
      if (priorPairs.has(key)) continue;
      const cur = earliestByPair.get(key);
      if (!cur || new Date(v.created_at).getTime() < new Date(cur.created_at).getTime()) earliestByPair.set(key, v);
    }
    proposals = [...earliestByPair.values()].map((v) => ({ groupId: v.group_id, showId: v.show_id, proposerId: v.user_id }));
  }

  // 1d. Responses (2026-09-22): friend-room replies in the window, plus the
  //     thread each sits on and everyone who has taken part in that thread
  //     (author + any live group-scoped reply) — the recipient must be one.
  const { data: replyRows } = await admin
    .from("replies")
    .select("id, thread_id, group_id, author_id, season, episode, created_at, is_deleted")
    .gte("created_at", since);
  const recentReplies = ((replyRows ?? []) as any[]).filter((r) => r.group_id && !r.is_deleted);
  const repliedThreadById = new Map<string, any>();
  const participantsByThread = new Map<string, Set<string>>();
  if (recentReplies.length) {
    const rtIds = [...new Set(recentReplies.map((r) => r.thread_id as string))];
    const { data: rtRows } = await admin
      .from("threads")
      .select("id, author_id, title, season, episode, is_deleted, is_public")
      .in("id", rtIds);
    for (const th of (rtRows ?? []) as any[]) {
      if (!th.is_deleted && th.is_public === false) repliedThreadById.set(th.id, th);
    }
    const { data: partRows } = await admin
      .from("replies")
      .select("thread_id, author_id, group_id, is_deleted")
      .in("thread_id", rtIds);
    for (const [tid, th] of repliedThreadById) participantsByThread.set(tid, new Set([th.author_id]));
    for (const pr of (partRows ?? []) as any[]) {
      if (!pr.group_id || pr.is_deleted) continue;
      participantsByThread.get(pr.thread_id)?.add(pr.author_id);
    }
  }

  if (!recentLinks.length && !recentChats.length && !proposals.length && !recentReplies.length) {
    return json({ ok: true, sent: 0, reason: "nothing new" });
  }

  // 2. Index thread rows (from the embedded join, plus replied-to threads).
  //    Seed/demo authors are dropped later (not a "friend"); departed authors
  //    still resolve.
  const threadById = new Map<string, any>();
  for (const l of recentLinks) threadById.set(l.threads.id, l.threads);
  for (const [tid, th] of repliedThreadById) if (!threadById.has(tid)) threadById.set(tid, th);

  // 3. Active rooms only (skip soft-deleted).
  const groupIds = [...new Set([...recentLinks.map((l) => l.group_id), ...recentReplies.map((r) => r.group_id)])];
  const activeGroups = new Map<string, { show_id: string; name: string }>();
  if (groupIds.length) {
    const { data: groups } = await admin
      .from("friend_groups")
      .select("id, show_id, name, deleted_at")
      .in("id", groupIds);
    for (const g of groups ?? []) if (!g.deleted_at) activeGroups.set(g.id, { show_id: g.show_id, name: g.name });
  }

  // 3b. Show catalog titles — the room heading is the SHOW's display name
  //     ("Spider-Noir"), never the room row's stored slug (2026-09-13);
  //     proposals need their titles from the same place.
  const showIds = [...new Set([
    ...[...activeGroups.values()].map((g) => g.show_id),
    ...proposals.map((p) => p.showId),
  ])].filter(Boolean);
  const showNameById = new Map<string, string>();
  if (showIds.length) {
    const { data: showRows } = await admin.from("shows").select("id, name").in("id", showIds);
    for (const srow of showRows ?? []) if (srow.name) showNameById.set(srow.id, String(srow.name));
  }

  // 4. Members of those rooms (current members only — leavers are removed).
  const activeGroupIds = [...activeGroups.keys()];
  const membersByGroup = new Map<string, any[]>();
  const roomMembers: any[] = [];
  if (activeGroupIds.length) {
    const { data: members } = await admin
      .from("friend_group_members")
      .select("group_id, user_id, digest_opt_out")
      .in("group_id", activeGroupIds);
    for (const m of members ?? []) {
      roomMembers.push(m);
      if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
      membersByGroup.get(m.group_id)!.push(m);
    }
  }

  // 4b. People-groups + members for chat/proposal items (recipients + the
  //     chat sections' group labels).
  const pgIds = [...new Set([
    ...recentChats.map((c) => c.group_id),
    ...proposals.map((p) => p.groupId),
  ])];
  const pgNameById = new Map<string, string | null>();
  const pgMembersByGroup = new Map<string, string[]>();
  if (pgIds.length) {
    const { data: pgs } = await admin.from("people_groups").select("id, name").in("id", pgIds);
    for (const g of pgs ?? []) pgNameById.set(g.id, g.name ?? null);
    const { data: pgm } = await admin
      .from("people_group_members")
      .select("group_id, user_id")
      .in("group_id", pgIds);
    for (const m of pgm ?? []) {
      if (!pgMembersByGroup.has(m.group_id)) pgMembersByGroup.set(m.group_id, []);
      pgMembersByGroup.get(m.group_id)!.push(m.user_id);
    }
  }

  // 5. One profile fetch for every identity a digest might render: entry
  //    authors, chat senders, proposers, and people-group members (labels).
  const identityIds = [...new Set([
    ...[...threadById.values()].map((t) => t.author_id),
    ...recentReplies.map((r) => r.author_id),
    ...recentChats.map((c) => c.author_id),
    ...proposals.map((p) => p.proposerId),
    ...[...pgMembersByGroup.values()].flat(),
  ])];
  const usernameById = new Map<string, string>();
  const firstNameById = new Map<string, string>();
  const seedAuthors = new Set<string>();
  if (identityIds.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, username, display_name, is_seed")
      .in("id", identityIds);
    // Identity arc: the FIRST NAME is what a reader sees. The handle is an
    // auto-generated slug and must never reach an email body.
    for (const p of profs ?? []) {
      usernameById.set(p.id, p.username);
      if (p.display_name) firstNameById.set(p.id, p.display_name);
      if (p.is_seed) seedAuthors.add(p.id);
    }
  }

  // 5b. Progress for every (room member, show) we might need.
  const memberUserIds = [...new Set(roomMembers.map((m) => m.user_id))];
  const progIndex = new Map<string, any>();
  if (memberUserIds.length) {
    const { data: progresses } = await admin
      .from("progress")
      .select("user_id, show_id, season, episode, is_rewatching, highest_season, highest_episode")
      .in("user_id", memberUserIds);
    for (const p of progresses ?? []) progIndex.set(`${p.user_id}|${p.show_id}`, p);
  }

  // 6. Compute per-recipient, per-room visible-new entries.
  //    perUser: Map<userId, Map<groupId, { roomName, entries[] }>>
  const perUser = new Map<string, Map<string, { roomName: string; entries: any[]; responses: any[] }>>();
  for (const link of recentLinks) {
    const g = activeGroups.get(link.group_id);
    if (!g) continue;
    const t = threadById.get(link.thread_id);
    if (!t) continue;
    if (seedAuthors.has(t.author_id)) continue; // skip seed/demo content
    const roster = membersByGroup.get(link.group_id) ?? [];
    for (const m of roster) {
      if (m.user_id === t.author_id) continue;       // not your own entries
      if (m.digest_opt_out) continue;                // opted out of this room
      if (onlyUserId && m.user_id !== onlyUserId) continue;
      const prog = progIndex.get(`${m.user_id}|${g.show_id}`);
      if (!prog) continue;                           // hasn't started → sees nothing
      if (!canView(t.season, t.episode, effectiveProgress(prog))) continue;
      if (!perUser.has(m.user_id)) perUser.set(m.user_id, new Map());
      const rooms = perUser.get(m.user_id)!;
      if (!rooms.has(link.group_id)) {
        rooms.set(link.group_id, { roomName: showNameById.get(g.show_id) ?? g.name, entries: [], responses: [] });
      }
      rooms.get(link.group_id)!.entries.push({
        threadId: t.id,
        title: (t.title && String(t.title).trim()) || "(untitled)",
        authorId: t.author_id,
        sharedAt: link.shared_at,
      });
    }
  }

  // 6-resp. Per-recipient READABLE responses on threads they're part of.
  for (const rr of recentReplies) {
    const g = activeGroups.get(rr.group_id);
    if (!g) continue;
    const th = repliedThreadById.get(rr.thread_id);
    if (!th) continue;
    if (seedAuthors.has(rr.author_id)) continue;   // skip seed/demo content
    const parts = participantsByThread.get(rr.thread_id);
    const roster = membersByGroup.get(rr.group_id) ?? [];
    for (const m of roster) {
      if (m.user_id === rr.author_id) continue;      // not your own responses
      if (!parts?.has(m.user_id)) continue;          // only threads you're part of
      if (m.digest_opt_out) continue;                // opted out of this room
      if (onlyUserId && m.user_id !== onlyUserId) continue;
      const prog = progIndex.get(`${m.user_id}|${g.show_id}`);
      if (!prog) continue;
      // Readable only — a hidden reply is the in-app red dot, never mail.
      if (!canView(rr.season, rr.episode, effectiveProgress(prog))) continue;
      if (!perUser.has(m.user_id)) perUser.set(m.user_id, new Map());
      const rooms = perUser.get(m.user_id)!;
      if (!rooms.has(rr.group_id)) {
        rooms.set(rr.group_id, { roomName: showNameById.get(g.show_id) ?? g.name, entries: [], responses: [] });
      }
      rooms.get(rr.group_id)!.responses.push({
        threadId: th.id,
        title: (th.title && String(th.title).trim()) || "(untitled)",
        threadAuthorId: th.author_id,
        responderId: rr.author_id,
        createdAt: rr.created_at,
      });
    }
  }

  // 6a-chat. Per-recipient chat items: Map<userId, Map<groupId, Set<senderId>>>.
  const perUserChat = new Map<string, Map<string, Set<string>>>();
  for (const c of recentChats) {
    if (seedAuthors.has(c.author_id)) continue;
    const roster = pgMembersByGroup.get(c.group_id) ?? [];
    for (const uid of roster) {
      if (uid === c.author_id) continue;             // not your own messages
      if (onlyUserId && uid !== onlyUserId) continue;
      if (!perUserChat.has(uid)) perUserChat.set(uid, new Map());
      const groups = perUserChat.get(uid)!;
      if (!groups.has(c.group_id)) groups.set(c.group_id, new Set());
      groups.get(c.group_id)!.add(c.author_id);
    }
  }

  // 6a-prop. Per-recipient proposal items.
  const perUserProps = new Map<string, { groupId: string; showId: string; proposerId: string }[]>();
  for (const p of proposals) {
    if (seedAuthors.has(p.proposerId)) continue;
    const roster = pgMembersByGroup.get(p.groupId) ?? [];
    for (const uid of roster) {
      if (uid === p.proposerId) continue;            // not your own proposals
      if (onlyUserId && uid !== onlyUserId) continue;
      if (!perUserProps.has(uid)) perUserProps.set(uid, []);
      perUserProps.get(uid)!.push(p);
    }
  }

  const recipientIds = [...new Set([...perUser.keys(), ...perUserChat.keys(), ...perUserProps.keys()])];
  if (recipientIds.length === 0) return json({ ok: true, sent: 0, reason: "nothing visible/new" });
  // Greeting (Alborz 2026-09-22): the recipient's own first name opens the
  // email — a personal first line is one of the signals that keeps a
  // notification out of Gmail's Promotions tab. Fetched for all recipients
  // in one query; a missing name simply drops the line.
  const recipientFirstName = new Map<string, string>();
  {
    const { data: rp } = await admin.from("profiles").select("id, display_name").in("id", recipientIds);
    for (const p of rp ?? []) if (p.display_name) recipientFirstName.set(p.id, p.display_name);
  }

  // 6b. Each recipient's contact names for the authors — so the digest shows
  //     the recipient's given name for a friend (else @handle). Owner-scoped;
  //     one bulk read for all recipients (2026-07-08).
  const contactByOwner = new Map<string, Map<string, string>>();
  {
    const { data: cn } = await admin
      .from("contact_names")
      .select("owner_id, contact_id, name")
      .in("owner_id", recipientIds);
    for (const row of cn ?? []) {
      if (!row.name) continue;
      if (!contactByOwner.has(row.owner_id)) contactByOwner.set(row.owner_id, new Map());
      contactByOwner.get(row.owner_id)!.set(row.contact_id, String(row.name));
    }
  }

  // 6c. Deck line (2026-07-26): per recipient, groupmates who ANSWERED more
  //     deck questions in the window (created_at — new answers only). Names
  //     resolve like entry authors: recipient's contact name → @handle;
  //     seed profiles are dropped. Every read is tolerant — a failure just
  //     means no deck line.
  const deckNamesByRecipient = new Map<string, string[]>();
  try {
    const { data: deckRows } = await admin
      .from("deck_answers")
      .select("user_id, created_at")
      .gte("created_at", since);
    const answererIds = [...new Set((deckRows ?? []).map((r: any) => r.user_id as string))];
    if (answererIds.length) {
      const ids = [...new Set([...recipientIds, ...answererIds])];
      const { data: pgm } = await admin
        .from("people_group_members")
        .select("group_id, user_id")
        .in("user_id", ids);
      const groupsOf = new Map<string, Set<string>>();
      for (const m of pgm ?? []) {
        if (!groupsOf.has(m.user_id)) groupsOf.set(m.user_id, new Set());
        groupsOf.get(m.user_id)!.add(m.group_id);
      }
      const { data: ansProfs } = await admin
        .from("profiles")
        .select("id, username, display_name, is_seed")
        .in("id", answererIds);
      // The username map doubles as the real-account gate below; the name
      // map is what actually renders (never the handle slug).
      const ansUsername = new Map<string, string>(
        (ansProfs ?? []).filter((p: any) => !p.is_seed).map((p: any) => [p.id, p.username]),
      );
      const ansFirstName = new Map<string, string>(
        (ansProfs ?? []).filter((p: any) => !p.is_seed && p.display_name).map((p: any) => [p.id, p.display_name]),
      );
      for (const rid of recipientIds) {
        const rGroups = groupsOf.get(rid);
        if (!rGroups || rGroups.size === 0) continue;
        const names: string[] = [];
        for (const aid of answererIds) {
          if (aid === rid) continue;
          const uname = ansUsername.get(aid);
          if (!uname) continue;
          const aGroups = groupsOf.get(aid);
          if (!aGroups || ![...aGroups].some((g) => rGroups.has(g))) continue;
          const given = contactByOwner.get(rid)?.get(aid);
          names.push(given || ansFirstName.get(aid) || `@${uname}`);
        }
        if (names.length) deckNamesByRecipient.set(rid, [...new Set(names)]);
      }
    }
  } catch (err) {
    console.warn("deck line skipped:", err);
  }

  // 7. Build + send one email per recipient.
  let sent = 0;
  const report: any[] = [];
  for (const userId of recipientIds) {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const email = u?.user?.email;
    if (!email) { report.push({ userId, skipped: "no_email" }); continue; }
    const greetName = recipientFirstName.get(userId) ?? null;

    const contacts = contactByOwner.get(userId);
    const authorName = (authorId: string): string => {
      // Given name (recipient's contact) → profile first name → @handle
      // (effectively unreachable: every account has a name) → fallback.
      const given = contacts?.get(authorId);
      if (given) return given;
      const first = firstNameById.get(authorId);
      if (first) return first;
      const uname = usernameById.get(authorId);
      return uname ? `@${uname}` : "a friend";
    };
    const rooms = perUser.get(userId) ?? new Map<string, { roomName: string; entries: any[]; responses: any[] }>();
    const roomDigests: RoomDigest[] = [...rooms.entries()]
      .map(([groupId, r]: [string, { roomName: string; entries: any[]; responses: any[] }]) => {
        const entries: DigestEntry[] = r.entries
          .sort((a: any, b: any) => new Date(a.sharedAt).getTime() - new Date(b.sharedAt).getTime())
          .map((e: any) => ({
            threadId: e.threadId,
            title: e.title,
            authorName: authorName(e.authorId),
          }));
        const authorNames = [...new Set(entries.map((e) => e.authorName))];
        // Responses grouped per thread, responders in arrival order.
        const byThread = new Map<string, DigestResponse>();
        for (const x of [...r.responses].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
          if (!byThread.has(x.threadId)) {
            byThread.set(x.threadId, { threadId: x.threadId, title: x.title, ownerName: x.threadAuthorId === userId ? null : authorName(x.threadAuthorId), responderNames: [] });
          }
          const d = byThread.get(x.threadId)!;
          const n = authorName(x.responderId);
          if (!d.responderNames.includes(n)) d.responderNames.push(n);
        }
        return { groupId, roomName: r.roomName, entries, authorNames, responses: [...byThread.values()] };
      })
      .sort((a, b) => a.roomName.localeCompare(b.roomName));

    // The recipient's label for a people-group: its custom name, else the
    // OTHER members through the recipient's eyes, else a plain fallback.
    const groupLabel = (gid: string): string => {
      const custom = pgNameById.get(gid);
      if (custom) return custom;
      const others = (pgMembersByGroup.get(gid) ?? []).filter((uid) => uid !== userId && !seedAuthors.has(uid));
      const names = others.map((uid) => authorName(uid)).filter(Boolean);
      return names.length ? formatNames(names) : "Your group";
    };

    const proposalDigests: ProposalDigest[] = (perUserProps.get(userId) ?? [])
      .map((p) => ({
        groupId: p.groupId,
        showName: showNameById.get(p.showId) ?? p.showId,
        proposerName: authorName(p.proposerId),
      }))
      .sort((a, b) => a.showName.localeCompare(b.showName));

    const chatDigests: ChatDigest[] = [...(perUserChat.get(userId) ?? new Map<string, Set<string>>()).entries()]
      .map(([gid, senders]: [string, Set<string>]) => ({
        groupId: gid,
        groupLabel: groupLabel(gid),
        senderNames: [...senders].map((sid) => authorName(sid)),
      }))
      .sort((a, b) => a.groupLabel.localeCompare(b.groupLabel));

    const deckNames = deckNamesByRecipient.get(userId) ?? [];
    if (dryRun) {
      report.push({
        userId, email,
        rooms: roomDigests.length,
        entries: roomDigests.reduce((n, r) => n + r.entries.length, 0),
        proposals: proposalDigests.length,
        chats: chatDigests.length,
        deckNames: deckNames.length,
        dryRun: true,
      });
      continue;
    }
    const ok = await sendResendEmail(
      resendKey,
      email,
      buildSubject(roomDigests, chatDigests, proposalDigests, deckNames),
      buildDigestHtml(roomDigests, baseUrl, deckNames, proposalDigests, chatDigests, greetName),
      buildDigestText(roomDigests, baseUrl, deckNames, proposalDigests, chatDigests, greetName),
    );
    if (ok) sent++;
    report.push({ userId, email, rooms: roomDigests.length, proposals: proposalDigests.length, chats: chatDigests.length, sent: ok });
  }

  return json({ ok: true, dryRun, candidates: recipientIds.length, sent, report });
});
