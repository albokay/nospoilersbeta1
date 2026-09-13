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
type RoomDigest = { groupId: string; roomName: string; entries: DigestEntry[]; authorNames: string[] };
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
): string {
  const sections = rooms
    .map((r) => {
      const multiAuthor = r.authorNames.length > 1;
      const verb = r.entries.length === 1 ? "wrote a new entry" : "wrote new entries";
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
      return `
  <div style="margin:0 0 28px">
    <h2 style="${SECTION_H2}">${escapeHtml(r.roomName)}</h2>
    <p style="margin:0 0 12px;font-size:15px;color:#1a2c3a;line-height:1.55">${escapeHtml(formatNames(r.authorNames))} ${verb}:</p>
    ${items}
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

function buildDigestText(
  rooms: RoomDigest[],
  baseUrl: string,
  deckNames: string[] = [],
  proposals: ProposalDigest[] = [],
  chats: ChatDigest[] = [],
): string {
  const sections = rooms
    .map((r) => {
      const multiAuthor = r.authorNames.length > 1;
      const verb = r.entries.length === 1 ? "wrote a new entry" : "wrote new entries";
      const items = r.entries
        .map((e) => {
          const url = `${baseUrl}/show-room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(e.threadId)}`;
          const byline = multiAuthor ? ` by ${e.authorName}` : "";
          return `  - "${e.title}"${byline} — ${url}`;
        })
        .join("\n");
      return `${r.roomName}\n${formatNames(r.authorNames)} ${verb}:\n${items}`;
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
  return `What your friends wrote today.

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

  if (!recentLinks.length && !recentChats.length && !proposals.length) {
    return json({ ok: true, sent: 0, reason: "nothing new" });
  }

  // 2. Index thread rows (from the embedded join). Seed/demo authors are
  //    dropped later (not a "friend"); departed authors still resolve.
  const threadById = new Map<string, any>();
  for (const l of recentLinks) threadById.set(l.threads.id, l.threads);

  // 3. Active rooms only (skip soft-deleted).
  const groupIds = [...new Set(recentLinks.map((l) => l.group_id))];
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
  const perUser = new Map<string, Map<string, { roomName: string; entries: any[] }>>();
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
        rooms.set(link.group_id, { roomName: showNameById.get(g.show_id) ?? g.name, entries: [] });
      }
      rooms.get(link.group_id)!.entries.push({
        threadId: t.id,
        title: (t.title && String(t.title).trim()) || "(untitled)",
        authorId: t.author_id,
        sharedAt: link.shared_at,
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
    const rooms = perUser.get(userId) ?? new Map<string, { roomName: string; entries: any[] }>();
    const roomDigests: RoomDigest[] = [...rooms.entries()]
      .map(([groupId, r]: [string, { roomName: string; entries: any[] }]) => {
        const entries: DigestEntry[] = r.entries
          .sort((a: any, b: any) => new Date(a.sharedAt).getTime() - new Date(b.sharedAt).getTime())
          .map((e: any) => ({
            threadId: e.threadId,
            title: e.title,
            authorName: authorName(e.authorId),
          }));
        const authorNames = [...new Set(entries.map((e) => e.authorName))];
        return { groupId, roomName: r.roomName, entries, authorNames };
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
      "What your friends wrote today.",
      buildDigestHtml(roomDigests, baseUrl, deckNames, proposalDigests, chatDigests),
      buildDigestText(roomDigests, baseUrl, deckNames, proposalDigests, chatDigests),
    );
    if (ok) sent++;
    report.push({ userId, email, rooms: roomDigests.length, proposals: proposalDigests.length, chats: chatDigests.length, sent: ok });
  }

  return json({ ok: true, dryRun, candidates: recipientIds.length, sent, report });
});
