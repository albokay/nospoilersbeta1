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
// "New" = entry created in the last 24h, by another member, not deleted,
// that the recipient can currently see (progress gate). Entries that became
// visible only because the recipient advanced their progress past an OLDER
// entry are intentionally NOT included (lean v1 — no progress-history).
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

// "@a" / "@a and @b" / "@a, @b, and @c"
function formatHandles(names: string[]): string {
  const u = [...new Set(names)].map((n) => `@${n}`);
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

type DigestEntry = { threadId: string; title: string; authorUsername: string };
type RoomDigest = { groupId: string; roomName: string; entries: DigestEntry[]; authorNames: string[] };

function buildDigestHtml(rooms: RoomDigest[], baseUrl: string): string {
  const sections = rooms
    .map((r) => {
      const multiAuthor = r.authorNames.length > 1;
      const verb = r.entries.length === 1 ? "wrote a new entry" : "wrote new entries";
      const items = r.entries
        .map((e) => {
          const url = `${baseUrl}/room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(e.threadId)}`;
          const byline = multiAuthor
            ? ` <span style="color:rgba(26,44,58,0.6)">by @${escapeHtml(e.authorUsername)}</span>`
            : "";
          return `<p style="margin:0 0 8px;font-size:15px;color:#1a2c3a;line-height:1.5">&mdash; <a href="${url}" style="color:#1a2c3a;font-style:italic;font-weight:600">&ldquo;${escapeHtml(e.title)}&rdquo;</a>${byline}</p>`;
        })
        .join("");
      return `
  <div style="margin:0 0 28px">
    <h2 style="margin:0 0 6px;font-size:18px;color:#1a2c3a;font-weight:800;line-height:1.3">${escapeHtml(r.roomName)}</h2>
    <p style="margin:0 0 12px;font-size:15px;color:#1a2c3a;line-height:1.55">${formatHandles(r.authorNames)} ${verb}:</p>
    ${items}
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
  ${sections}
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    To stop getting emails about your friend rooms, you can open a room and click the &#9881;&#65039; next to its name. There, toggle &ldquo;email digest&rdquo; to &ldquo;off.&rdquo;
  </p>
</div>
</body>
</html>`;
}

function buildDigestText(rooms: RoomDigest[], baseUrl: string): string {
  const sections = rooms
    .map((r) => {
      const multiAuthor = r.authorNames.length > 1;
      const verb = r.entries.length === 1 ? "wrote a new entry" : "wrote new entries";
      const items = r.entries
        .map((e) => {
          const url = `${baseUrl}/room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(e.threadId)}`;
          const byline = multiAuthor ? ` by @${e.authorUsername}` : "";
          return `  - "${e.title}"${byline} — ${url}`;
        })
        .join("\n");
      return `${r.roomName}\n${formatHandles(r.authorNames)} ${verb}:\n${items}`;
    })
    .join("\n\n");

  return `What your friends wrote today.

${sections}

To stop getting emails about your friend rooms, you can open a room and click the gear icon next to its name. There, toggle "email digest" to "off."`;
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

  // 1. Entries created in the last 24h (friend-room/private shape; the room
  //    link in step 2 narrows to actual friend-room entries).
  const { data: recent, error: recentErr } = await admin
    .from("threads")
    .select("id, author_id, title, season, episode, created_at")
    .gte("created_at", since)
    .eq("is_deleted", false)
    .eq("is_public", false);
  if (recentErr) return json({ error: "threads_query_failed", detail: recentErr.message }, 500);
  if (!recent?.length) return json({ ok: true, sent: 0, reason: "no recent entries" });

  // Author identities up front — used to drop seed-authored content (not a
  // "friend") and to build bylines for departed authors too.
  const recentAuthorIds = [...new Set(recent.map((t) => t.author_id))];
  const { data: authorProfs } = await admin
    .from("profiles")
    .select("id, username, is_seed")
    .in("id", recentAuthorIds);
  const usernameById = new Map<string, string>((authorProfs ?? []).map((p: any) => [p.id, p.username]));
  const seedAuthors = new Set<string>((authorProfs ?? []).filter((p: any) => p.is_seed).map((p: any) => p.id));

  const threadById = new Map<string, any>(recent.map((t) => [t.id, t]));

  // 2. Which of those entries live in which rooms.
  const { data: links, error: linkErr } = await admin
    .from("group_threads")
    .select("group_id, thread_id")
    .in("thread_id", [...threadById.keys()]);
  if (linkErr) return json({ error: "links_query_failed", detail: linkErr.message }, 500);
  if (!links?.length) return json({ ok: true, sent: 0, reason: "no room entries" });

  // 3. Active rooms only (skip soft-deleted).
  const groupIds = [...new Set(links.map((l) => l.group_id))];
  const { data: groups } = await admin
    .from("friend_groups")
    .select("id, show_id, name, deleted_at")
    .in("id", groupIds);
  const activeGroups = new Map<string, { show_id: string; name: string }>();
  for (const g of groups ?? []) if (!g.deleted_at) activeGroups.set(g.id, { show_id: g.show_id, name: g.name });

  // 4. Members of those rooms (current members only — leavers are removed).
  const activeGroupIds = [...activeGroups.keys()];
  const { data: members } = await admin
    .from("friend_group_members")
    .select("group_id, user_id, digest_opt_out")
    .in("group_id", activeGroupIds);
  const membersByGroup = new Map<string, any[]>();
  for (const m of members ?? []) {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
    membersByGroup.get(m.group_id)!.push(m);
  }

  // 5. Progress for every (member, show) we might need.
  const memberUserIds = [...new Set((members ?? []).map((m) => m.user_id))];
  const { data: progresses } = await admin
    .from("progress")
    .select("user_id, show_id, season, episode, is_rewatching, highest_season, highest_episode")
    .in("user_id", memberUserIds);
  const progIndex = new Map<string, any>();
  for (const p of progresses ?? []) progIndex.set(`${p.user_id}|${p.show_id}`, p);

  // 6. Compute per-recipient, per-room visible-new entries.
  //    perUser: Map<userId, Map<groupId, { roomName, entries[] }>>
  const perUser = new Map<string, Map<string, { roomName: string; entries: any[] }>>();
  for (const link of links) {
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
      if (!rooms.has(link.group_id)) rooms.set(link.group_id, { roomName: g.name, entries: [] });
      rooms.get(link.group_id)!.entries.push({
        threadId: t.id,
        title: (t.title && String(t.title).trim()) || "(untitled)",
        authorId: t.author_id,
        createdAt: t.created_at,
      });
    }
  }
  if (perUser.size === 0) return json({ ok: true, sent: 0, reason: "nothing visible/new" });

  // 7. Build + send one email per recipient.
  let sent = 0;
  const report: any[] = [];
  for (const [userId, rooms] of perUser.entries()) {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const email = u?.user?.email;
    if (!email) { report.push({ userId, skipped: "no_email" }); continue; }

    const roomDigests: RoomDigest[] = [...rooms.entries()]
      .map(([groupId, r]) => {
        const entries: DigestEntry[] = r.entries
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .map((e) => ({
            threadId: e.threadId,
            title: e.title,
            authorUsername: usernameById.get(e.authorId) ?? "someone",
          }));
        const authorNames = [...new Set(entries.map((e) => e.authorUsername))];
        return { groupId, roomName: r.roomName, entries, authorNames };
      })
      .sort((a, b) => a.roomName.localeCompare(b.roomName));

    if (dryRun) {
      report.push({ userId, email, rooms: roomDigests.length, entries: roomDigests.reduce((n, r) => n + r.entries.length, 0), dryRun: true });
      continue;
    }
    const ok = await sendResendEmail(
      resendKey,
      email,
      "What your friends wrote today.",
      buildDigestHtml(roomDigests, baseUrl),
      buildDigestText(roomDigests, baseUrl),
    );
    if (ok) sent++;
    report.push({ userId, email, rooms: roomDigests.length, sent: ok });
  }

  return json({ ok: true, dryRun, candidates: perUser.size, sent, report });
});
