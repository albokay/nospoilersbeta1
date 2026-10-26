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
// 2026-10-13 (Alborz, round 6) — SEEN-GATING: every item is also checked
//   against the recipient's own stamps (the room's last_seen_at, the group's
//   chat_last_seen_at and pitches_last_seen_at — the same stamps the app's
//   dots read). What they've already opened never emails; nothing left, no
//   email. The digest's sender is letters@ (Promotions), the finished
//   letter wears the ★, and the opt-out line's gear is the ⚙️ emoji again
//   (Alborz, 10-14: the hosted glyph showed as a broken square where images
//   don't load).
//
// 2026-09-28 (Alborz) — LETTERS FROM SIDEBAR: before the scan, this run
//   PLANTS the "what's next" and "returning season" alerts as letters from
//   the Sidebar account into the rooms that qualify (see plantSidebarLetters),
//   so they ride tonight's digest, light the room, and deep-link like any
//   letter. Tagged S0 E0, they reach every member, progress row or not.
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

// Its own sender (Alborz, round 6 — Gmail sorted the digest into Promotions
// beside the invite emails it shared a sender with).
const FROM_ADDRESS = "Sidebar <letters@sidebar.watch>";
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

// Seen-gating (Alborz, round 6): an item counts only while the app itself
// still marks it new for the recipient — newer than their last visit to that
// room (friend_group_members.last_seen_at), that chat (chat_last_seen_at) or
// that pitched list (pitches_last_seen_at). What they've already opened
// never emails; with nothing left, no email.
function seenBefore(stamp: string | null | undefined, at: string | null | undefined): boolean {
  if (!stamp || !at) return false;
  return new Date(at).getTime() <= new Date(stamp).getTime();
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
// Notes (Alborz 2026-10-07, the letters-only rooms arc): friends' highlight
// NOTES on the recipient's writing — a letter they wrote or are part of (a
// response or a note of theirs on it), or a response they wrote. Said as
// "{name} left a note on your letter". Readable notes only; a sealed one
// stays an in-app red dot. Yups aren't mail.
type DigestNote = { threadId: string; title: string; ownerName: string | null; onResponse: boolean; noterNames: string[] };
const noteWhere = (x: DigestNote, possessive: (owner: string) => string): string =>
  x.onResponse ? "your response in" : (x.ownerName === null ? "your letter" : `${possessive(x.ownerName)} letter`);
type RoomDigest = { groupId: string; roomName: string; entries: DigestEntry[]; authorNames: string[]; responses: DigestResponse[]; notes: DigestNote[] };
// Proposals (Alborz 2026-09-30): grouped under the FRIEND who proposed —
// "{Friend} proposed new shows to watch." then one line per show, with
// "(X is also in.)" when another friend has already opted in (never the
// proposer or the recipient; opt-outs are never mentioned). groupLabel is
// set only when the same friend proposed in more than one of the recipient's
// groups, to tell the blocks apart.
type ProposalDigest = { groupId: string; proposerName: string; groupLabel: string | null; shows: { showName: string; alsoIn: string[] }[] };
const proposalHeading = (p: ProposalDigest): string =>
  `${p.proposerName} proposed ${p.shows.length === 1 ? "a new show" : "new shows"} to watch${p.groupLabel ? ` (${p.groupLabel})` : ""}.`;
const alsoInLine = (names: string[]): string => `${formatNames(names)} ${names.length === 1 ? "is" : "are"} also in.`;
// Letters from Sidebar (Alborz 2026-09-30): not "what your friends wrote" —
// each is its own linked line right under the greeting, and a digest that
// holds nothing else is subject-lined "There's a new letter in your X room".
type SidebarLetterDigest = { groupId: string; roomName: string; threadId: string; title: string };
type ChatDigest = { groupId: string; groupLabel: string; senderNames: string[] };
// Answers to the recipient's own pitches (Alborz, 10-14): one block per
// group, one line per answer — "Rodrigo answered your Say Nothing pitch:
// seen it." `lead` is the line without its answer, for the subject.
type AnswerDigest = { groupId: string; groupLabel: string; lines: { text: string; lead: string }[] };
// The prompt to nudge (the friend who pulls ahead, CP3, 2026-10-22): a
// friend 3+ episodes behind the recipient whose progress has held for a
// couple of days — "Sam's at S1 E3, four episodes behind you… Nudge Sam →".
// Once per (room, ahead, behind) (nudge_prompts), re-armed once the friend
// comes within 2; skipped when the recipient nudged them this week or
// turned the room's emails off. It can carry a digest on its own.
type NudgePromptDigest = { groupId: string; roomName: string; behindId: string; behindName: string; started: boolean; behindS: number; behindE: number; gap: number; viewerEpisodes: number };
// "Reached your letter" (CP4, 2026-10-22): a friend who was 3+ behind a
// letter when it was written (letter_watchers, by trigger) has reached its
// stamp — the author hears it in their daily email. Grouped per (room,
// friend): "Priya reached S1 E5. Your letter 'The break room' is open for
// them now." It can carry a digest on its own.
type ReachedDigest = { groupId: string; roomName: string; behindId: string; behindName: string; s: number; e: number; letters: { threadId: string; title: string }[] };
// A "Thoughts on…" ask that landed in one of the recipient's group chats
// today and they haven't answered (Alborz 10-25, CP3). His copy: "Tell your
// {group} friends about {prompt}." — answeredNames are the friends already
// in, through the recipient's eyes.
type AskDigest = { groupId: string; groupLabel: string; prompt: string; answeredNames: string[] };
const reachedLine = (r: ReachedDigest, q: (t: string) => string): string => {
  const titles = r.letters.map((l) => q(l.title));
  const list = titles.length === 1 ? titles[0] : titles.length === 2 ? `${titles[0]} and ${titles[1]}` : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
  return `${r.behindName} reached S${r.s} E${r.e}. Your letter${titles.length === 1 ? "" : "s"} ${list} ${titles.length === 1 ? "is" : "are"} open for them now.`;
};
const NUDGE_PROMPT_GAP = 3;
const NUDGE_PROMPT_HOLD_DAYS = 2;
const NUDGE_PROMPT_QUIET_DAYS = 7;
const SMALL_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const numberWord = (n: number): string => (n >= 0 && n < SMALL_NUMBERS.length ? SMALL_NUMBERS[n] : String(n));
const promptLine = (p: NudgePromptDigest, bold: (s: string) => string): string =>
  p.started
    ? `${bold(`${p.behindName}’s at S${p.behindS} E${p.behindE}`)}, ${numberWord(p.gap)} episodes behind you, and has been for a few days. A word from you might bring them back.`
    : `${bold(`${p.behindName} hasn’t started ${p.roomName} yet.`)} You’re ${p.viewerEpisodes} episode${p.viewerEpisodes === 1 ? "" : "s"} in. A word from you might get them going.`;
const promptSubject = (p: NudgePromptDigest): string =>
  p.started ? `${p.behindName}’s ${numberWord(p.gap)} episodes behind you on ${p.roomName}` : `${p.behindName} hasn’t started ${p.roomName} yet`;
/** "Tell your Sunday Crew friends about a show you defend…" (his copy). */
function askLine(a: AskDigest): string {
  return `Tell your ${a.groupLabel} friends about ${a.prompt}.`;
}
/** "One line is plenty. Priya's already in; her take opens once yours is." */
function askSub(a: AskDigest): string {
  if (!a.answeredNames.length) return "One line is plenty.";
  const names = formatNames(a.answeredNames);
  return a.answeredNames.length === 1
    ? `One line is plenty. ${names}'s already in; their take opens once yours is.`
    : `One line is plenty. ${names} are already in; their takes open once yours is.`;
}

function linearIndex(s: number, e: number, seasons: number[]): number {
  if (s <= 0) return 0;
  let idx = 0;
  if (seasons.length) { for (let i = 0; i < s - 1 && i < seasons.length; i++) idx += seasons[i] || 0; } else idx = (s - 1) * 1000;
  return idx + e;
}

const SECTION_H2 = `margin:0 0 6px;font-size:18px;color:#1a2c3a;font-weight:800;line-height:1.3`;
const ITEM_P = `margin:0 0 8px;font-size:15px;color:#1a2c3a;line-height:1.5`;

function buildDigestHtml(
  rooms: RoomDigest[],
  baseUrl: string,
  deckNames: string[] = [],
  proposals: ProposalDigest[] = [],
  chats: ChatDigest[] = [],
  greetName: string | null = null,
  sidebarLetters: SidebarLetterDigest[] = [],
  answers: AnswerDigest[] = [],
  prompts: NudgePromptDigest[] = [],
  reached: ReachedDigest[] = [],
  asks: AskDigest[] = [],
): string {
  const hasFriendContent = rooms.length > 0 || proposals.length > 0 || chats.length > 0 || deckNames.length > 0 || answers.length > 0 || reached.length > 0;
  // "Thoughts on…" asks (CP3): a framed block each, the link opens the
  // group's chat with the card at the top.
  const askSections = asks
    .map((a) => {
      const url = `${baseUrl}/dashboard?g=${encodeURIComponent(a.groupId)}&chat=1`;
      return `
  <div style="margin:0 0 28px;padding:18px 20px;border:1px solid #1a2c3a">
    <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(26,44,58,0.6)">${escapeHtml(a.groupLabel)} &middot; from Sidebar</p>
    <p style="margin:0;font-size:18px;color:#1a2c3a;line-height:1.4;font-family:Georgia,'Times New Roman',serif">${escapeHtml(askLine(a))}</p>
    <p style="margin:10px 0 0;font-size:14px;color:rgba(26,44,58,0.75);line-height:1.5">${escapeHtml(askSub(a))}</p>
    <a href="${url}" style="display:inline-block;margin-top:14px;color:#355eb8;font-weight:700;font-size:15px">Your take &rarr;</a>
  </div>`;
    })
    .join("");
  // "Reached your letter" (CP4): one linked line per friend, in the room's
  // section (or under the room's heading when nothing else is new there).
  const reachedLineHtml = (r: ReachedDigest): string => {
    const url = `${baseUrl}/show-room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(r.letters[0].threadId)}`;
    return `<p style="${ITEM_P}">&mdash; <a href="${url}" style="color:#1a2c3a;font-weight:600">${reachedLine({ ...r, behindName: escapeHtml(r.behindName) }, (t) => `<span style="font-style:italic">&ldquo;${escapeHtml(t)}&rdquo;</span>`)}</a></p>`;
  };
  const reachedByRoom = new Map<string, ReachedDigest[]>();
  for (const r of reached) reachedByRoom.set(r.groupId, [...(reachedByRoom.get(r.groupId) ?? []), r]);
  // The prompt to nudge (CP3): a yellow-barred block — inside the room's
  // section when the room has one tonight, else under its own room heading.
  const promptBlock = (p: NudgePromptDigest): string => {
    const url = `${baseUrl}/show-room/${encodeURIComponent(p.groupId)}?nudge=${encodeURIComponent(p.behindId)}`;
    return `
    <div style="margin:14px 0 0;padding:16px 18px;border-left:4px solid #dea838;background:#fbf6ea">
      <p style="margin:0;font-size:15px;color:#1a2c3a;line-height:1.55">${promptLine(p, (t) => `<strong>${escapeHtml(t)}</strong>`)}</p>
      <a href="${url}" style="display:inline-block;margin-top:14px;background:#dea838;color:#fef8ea;text-decoration:none;padding:10px 22px;font-size:14px;font-weight:700">Nudge ${escapeHtml(p.behindName)} →</a>
    </div>`;
  };
  const promptsByRoom = new Map<string, NudgePromptDigest[]>();
  for (const p of prompts) promptsByRoom.set(p.groupId, [...(promptsByRoom.get(p.groupId) ?? []), p]);
  const roomsWithSections = new Set(rooms.map((r) => r.groupId));
  // Rooms with only a prompt and/or a reached line tonight get a heading of their own.
  const extraRoomIds = [...new Set([...promptsByRoom.keys(), ...reachedByRoom.keys()])].filter((gid) => !roomsWithSections.has(gid));
  const promptSections = extraRoomIds
    .map((gid) => {
      const ps = promptsByRoom.get(gid) ?? []; const rs = reachedByRoom.get(gid) ?? [];
      const name = (ps[0]?.roomName ?? rs[0]?.roomName) ?? "";
      return `
  <div style="margin:0 0 28px">
    <h2 style="${SECTION_H2}">${escapeHtml(name)}</h2>${rs.map(reachedLineHtml).join("")}${ps.map(promptBlock).join("")}
  </div>`;
    })
    .join("");
  const sidebarBlock = sidebarLetters
    .map((l) => {
      const url = `${baseUrl}/show-room/${encodeURIComponent(l.groupId)}?entry=${encodeURIComponent(l.threadId)}`;
      // The finished-together star (Alborz, round 6) opens "You all finished …".
      const star = l.title.startsWith("You all finished ") ? `<span style="color:#dea838">&#9733;</span> ` : "";
      return `<p style="margin:0 0 ${hasFriendContent ? 22 : 10}px;font-size:17px;color:#1a2c3a;line-height:1.45"><a href="${url}" style="color:#1a2c3a;font-weight:700">${star}${escapeHtml(l.title)}</a></p>`;
    })
    .join("");
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
      const notes = (r.notes ?? [])
        .map((x) => {
          const url = `${baseUrl}/show-room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(x.threadId)}`;
          const what = x.noterNames.length === 1 ? "left a note on" : "left notes on";
          const where = noteWhere(x, (o) => `${escapeHtml(o)}&rsquo;s`);
          return `<p style="${ITEM_P}">&mdash; <a href="${url}" style="color:#1a2c3a;font-weight:600">${escapeHtml(formatNames(x.noterNames))} ${what} ${where} <span style="font-style:italic">&ldquo;${escapeHtml(x.title)}&rdquo;</span></a></p>`;
        })
        .join("");
      return `
  <div style="margin:0 0 28px">
    <h2 style="${SECTION_H2}">${escapeHtml(r.roomName)}</h2>
    ${intro}${items}${responses}${notes}${(reachedByRoom.get(r.groupId) ?? []).map(reachedLineHtml).join("")}${(promptsByRoom.get(r.groupId) ?? []).map(promptBlock).join("")}
  </div>`;
    })
    .join("");

  // Proposals (2026-09-30): the FRIEND carries the section — the heading
  // links into the group room, then one line per show.
  const proposalSections = proposals
    .map((p) => {
      const url = `${baseUrl}/dashboard?g=${encodeURIComponent(p.groupId)}`;
      const items = p.shows
        .map((sh) => `<p style="${ITEM_P}">&mdash; ${escapeHtml(sh.showName)}${sh.alsoIn.length ? ` <span style="color:rgba(26,44,58,0.6)">(${escapeHtml(alsoInLine(sh.alsoIn))})</span>` : ""}</p>`)
        .join("");
      return `
  <div style="margin:0 0 28px">
    <h2 style="${SECTION_H2}"><a href="${url}" style="color:#1a2c3a">${escapeHtml(proposalHeading(p))}</a></h2>
    ${items}
  </div>`;
    })
    .join("");

  // Answers to your pitches (10-14): one answer is its own linked line; more
  // than one in a group head with a count and list under it.
  const answerSections = answers
    .map((a) => {
      const url = `${baseUrl}/dashboard?g=${encodeURIComponent(a.groupId)}`;
      const one = a.lines.length === 1;
      const head = one ? a.lines[0].text : `${a.lines.length} answers to your pitches in ${a.groupLabel}.`;
      const items = one ? "" : a.lines.map((l) => `<p style="${ITEM_P}">&mdash; ${escapeHtml(l.text)}</p>`).join("");
      return `
  <div style="margin:0 0 28px">
    <h2 style="${SECTION_H2}"><a href="${url}" style="color:#1a2c3a">${escapeHtml(head)}</a></h2>
    ${items}
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
  ${greetName ? `<p style="margin:0 0 ${sidebarLetters.length ? 16 : 10}px;font-size:15px;color:#1a2c3a;line-height:1.5">Hi ${escapeHtml(greetName)},</p>` : ""}
  ${sidebarBlock}${hasFriendContent ? `
  <h1 style="margin:0 0 28px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    What your friends wrote today.
  </h1>` : asks.length ? `
  <h1 style="margin:0 0 28px;font-size:22px;color:#1a2c3a;font-weight:800;line-height:1.35">
    A question for your group.
  </h1>` : ""}
  ${askSections}${sections}${promptSections}${proposalSections}${answerSections}${chatSections}${deckNames.length ? `
  <p style="margin:0 0 28px;font-size:15px;color:#1a2c3a;line-height:1.55">${escapeHtml(formatNames(deckNames))} answered more &ldquo;How We Watch TV&rdquo; questions.</p>` : ""}
  <p style="margin:32px 0 0;font-size:12px;color:rgba(26,44,58,0.6);line-height:1.6">
    To stop getting emails about your friend rooms, open a room and click the ⚙️ next to its name, then choose &ldquo;unsubscribe.&rdquo;
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
function buildSubject(rooms: RoomDigest[], chats: ChatDigest[], proposals: ProposalDigest[], deckNames: string[], sidebarLetters: SidebarLetterDigest[] = [], answers: AnswerDigest[] = [], prompts: NudgePromptDigest[] = [], reached: ReachedDigest[] = [], asks: AskDigest[] = []): string {
  const entryRooms = rooms.filter((r) => r.entries.length > 0);
  const respRooms = rooms.filter((r) => r.responses.length > 0);
  const noteRooms = rooms.filter((r) => (r.notes ?? []).length > 0);
  const kinds = [entryRooms.length > 0, respRooms.length > 0, noteRooms.length > 0, chats.length > 0, proposals.length > 0, deckNames.length > 0, sidebarLetters.length > 0, answers.length > 0, prompts.length > 0, reached.length > 0, asks.length > 0].filter(Boolean).length;
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
  } else if (noteRooms.length) {
    // Notes (2026-10-07) rank right after responses: they are the response
    // in a letters-only room.
    const all = noteRooms.flatMap((r) => r.notes);
    if (all.length === 1) {
      const x = all[0];
      lead = x.onResponse
        ? `${formatNames(x.noterNames)} left a note on your response in ${noteRooms[0].roomName}`
        : `${formatNames(x.noterNames)} left a note on ${x.ownerName === null ? "your" : `${x.ownerName}'s`} ${noteRooms[0].roomName} letter`;
    } else if (noteRooms.length === 1) lead = `New notes in ${noteRooms[0].roomName}`;
    else lead = `New notes in ${noteRooms.length} of your rooms`;
  } else if (chats.length) {
    lead = chats.length === 1 ? `${formatNames(chats[0].senderNames)} messaged you in ${chats[0].groupLabel}` : `New messages in ${chats.length} groups`;
  } else if (proposals.length) {
    const total = proposals.reduce((n, p) => n + p.shows.length, 0);
    if (proposals.length === 1) lead = total === 1 ? `${proposals[0].proposerName} proposed ${proposals[0].shows[0].showName}` : `${proposals[0].proposerName} proposed ${total} new shows`;
    else lead = `${total} new show proposals`;
  } else if (answers.length) {
    // Answers to your pitches (10-14) rank with proposals.
    const all = answers.flatMap((a) => a.lines);
    lead = all.length === 1 ? all[0].lead : `${all.length} answers to your pitches`;
  } else if (deckNames.length) {
    lead = `${formatNames(deckNames)} answered more How We Watch TV questions`;
  } else if (reached.length) {
    // "Reached your letter" (CP4) ranks with the answers: a friend arrived.
    lead = reached.length === 1 ? `${reached[0].behindName} reached your ${reached[0].roomName} letter${reached[0].letters.length === 1 ? "" : "s"}` : `${reached.length} friends reached your letters`;
  } else if (prompts.length) {
    // The prompt to nudge (CP3) can be the whole email: name the friend.
    lead = prompts.length === 1 ? promptSubject(prompts[0]) : `${prompts.length} friends have fallen behind you`;
  } else if (asks.length) {
    // A "Thoughts on…" ask (CP3) can be the whole email: the prompt is the subject.
    lead = asks.length === 1 ? `Thoughts on ${asks[0].prompt}` : `A question for ${asks.length} of your groups`;
  } else if (sidebarLetters.length) {
    // Only a letter from Sidebar (2026-09-30): name the room, not "Sidebar wrote".
    const roomNames = [...new Set(sidebarLetters.map((l) => l.roomName))];
    lead = roomNames.length === 1
      ? (sidebarLetters.length === 1 ? `There's a new letter in your ${roomNames[0]} room` : `There are new letters in your ${roomNames[0]} room`)
      : `There are new letters in ${roomNames.length} of your rooms`;
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
  sidebarLetters: SidebarLetterDigest[] = [],
  answers: AnswerDigest[] = [],
  prompts: NudgePromptDigest[] = [],
  reached: ReachedDigest[] = [],
  asks: AskDigest[] = [],
): string {
  const askLines = asks
    .map((a) => `${a.groupLabel} · from Sidebar\n${askLine(a)}\n${askSub(a)}\nYour take: ${baseUrl}/dashboard?g=${encodeURIComponent(a.groupId)}&chat=1`)
    .join("\n\n");
  const reachedLines = reached
    .map((r) => `${r.roomName}\n${reachedLine(r, (t) => `"${t}"`)} — ${baseUrl}/show-room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(r.letters[0].threadId)}`)
    .join("\n\n");
  const promptLines = prompts
    .map((p) => `${p.roomName}\n${promptLine(p, (t) => t)}\nNudge ${p.behindName}: ${baseUrl}/show-room/${encodeURIComponent(p.groupId)}?nudge=${encodeURIComponent(p.behindId)}`)
    .join("\n\n");
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
      const notes = (r.notes ?? [])
        .map((x) => {
          const url = `${baseUrl}/show-room/${encodeURIComponent(r.groupId)}?entry=${encodeURIComponent(x.threadId)}`;
          const what = x.noterNames.length === 1 ? "left a note on" : "left notes on";
          return `  - ${formatNames(x.noterNames)} ${what} ${noteWhere(x, (o) => `${o}'s`)} "${x.title}" — ${url}`;
        })
        .join("\n");
      const head = r.entries.length ? `${r.roomName}\n${formatNames(r.authorNames)} ${verb}:\n${items}` : r.roomName;
      return [head, responses, notes].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const proposalLines = proposals
    .map((p) => `${proposalHeading(p)} — ${baseUrl}/dashboard?g=${encodeURIComponent(p.groupId)}\n${p.shows.map((sh) => `  - ${sh.showName}${sh.alsoIn.length ? ` (${alsoInLine(sh.alsoIn)})` : ""}`).join("\n")}`)
    .join("\n\n");
  const chatLines = chats
    .map((c) => `${c.groupLabel}\n${formatNames(c.senderNames)} messaged you. — ${baseUrl}/dashboard?g=${encodeURIComponent(c.groupId)}&chat=1`)
    .join("\n\n");

  const deckLine = deckNames.length
    ? `\n\n${formatNames(deckNames)} answered more "How We Watch TV" questions.`
    : "";
  const answerLines = answers
    .map((a) => `${a.lines.length === 1 ? a.lines[0].text : `${a.lines.length} answers to your pitches in ${a.groupLabel}.`} — ${baseUrl}/dashboard?g=${encodeURIComponent(a.groupId)}${a.lines.length === 1 ? "" : `\n${a.lines.map((l) => `  - ${l.text}`).join("\n")}`}`)
    .join("\n\n");
  const blocks = [askLines, sections, reachedLines, promptLines, proposalLines, answerLines, chatLines].filter(Boolean).join("\n\n");
  const sidebarLines = sidebarLetters
    .map((l) => `${l.title} — ${baseUrl}/show-room/${encodeURIComponent(l.groupId)}?entry=${encodeURIComponent(l.threadId)}`)
    .join("\n");
  const friendBlock = blocks || deckLine ? `${rooms.length || proposals.length || chats.length || deckNames.length || answers.length || reached.length ? "What your friends wrote today." : "A question for your group."}\n\n${blocks}${deckLine}\n\n` : "";
  return `${greetName ? `Hi ${greetName},\n\n` : ""}${sidebarLines ? `${sidebarLines}\n\n` : ""}${friendBlock}To stop getting emails about your friend rooms, open a room and click the gear icon next to its name, then choose "unsubscribe."`;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Letters from Sidebar (2026-09-28) ─────────────────────────────────────
// The "what's next" and "returning season" alerts are LETTERS planted into a
// show room by this run, before the scan, so they ride tonight's digest and
// light the room like any letter. The Sidebar identity is a profiles row;
// the letters are tagged S0 E0 (readable by every member); the app pins them
// and reads their kind from sidebar_letters, whose key (room, kind, season)
// also keeps this to one letter per room per season.
//   • what's next — the room is about to finish the show's AVAILABLE
//     episodes: someone's progress (or a letter) reached the second-to-last
//     episode of the last aired season, that season is known complete, and
//     it happened within the last 7 days (an old finished room stays quiet);
//   • returning — everyone in the room finished the available episodes and
//     a NEW season's first episode airs within 14 days.
const SIDEBAR_USER_ID = "00000000-0000-4000-8000-000000000001";
const SIDEBAR_USERNAME = "sidebar";
const RECENT_DAYS = 7;
const RETURNING_DAYS = 14;

// Mirrors src/lib/utils.ts isSeasonEnd for a season's last aired episode.
function seasonKnownComplete(show: any, S: number): boolean {
  const seasons: number[] = Array.isArray(show.seasons) ? show.seasons : [];
  const last = seasons[S - 1] ?? 0;
  if (last < 1) return false;
  const laterAired = seasons.slice(S).some((n: number) => (n || 0) > 0);
  const ended = !!show.status && show.status !== "Running";
  const planned = Array.isArray(show.seasons_planned) ? show.seasons_planned[S - 1] : null;
  const moreScheduled = show.next_air_season === S && !!show.next_air_at;
  const listedAllAired = planned != null && planned > 0 && last >= planned && !moreScheduled;
  return laterAired || ended || listedAllAired;
}
const atOrPast = (eff: Eff | null, s: number, e: number): boolean => !!eff && (eff.s > s || (eff.s === s && eff.e >= e));
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
const fmtMonth = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", timeZone: "America/Los_Angeles" });

async function plantOne(
  admin: any, roomId: string, showId: string, kind: "whats_next" | "returning", season: number,
  copy: { title: string; preview: string; body: string },
): Promise<boolean> {
  const id = crypto.randomUUID();
  const { error: tErr } = await admin.from("threads").insert({
    id, show_id: showId, season: 0, episode: 0, author_id: SIDEBAR_USER_ID, author_name: SIDEBAR_USERNAME,
    title: copy.title, preview: copy.preview, body: copy.body, is_public: false,
  });
  if (tErr) { console.error("[sidebar-letters] thread insert failed", tErr.message); return false; }
  // The kind row is the guard: a second run for the same (room, kind,
  // season) fails here and drops its orphan thread.
  const { error: kErr } = await admin.from("sidebar_letters").insert({ room_id: roomId, kind, season, thread_id: id });
  if (kErr) { await admin.from("threads").delete().eq("id", id); return false; }
  const { error: lErr } = await admin.from("group_threads").insert({ group_id: roomId, thread_id: id });
  if (lErr) {
    console.error("[sidebar-letters] link failed", lErr.message);
    await admin.from("threads").delete().eq("id", id); // cascades the kind row
    return false;
  }
  return true;
}

async function plantSidebarLetters(admin: any): Promise<{ whatsNext: number; returning: number }> {
  const out = { whatsNext: 0, returning: 0 };
  const nowMs = Date.now();
  const { data: rooms } = await admin
    .from("friend_groups")
    .select("id, show_id, parent_group_id, deleted_at, dnf_at")
    .not("parent_group_id", "is", null)
    .is("deleted_at", null);
  const live = ((rooms ?? []) as any[]).filter((r) => !r.dnf_at && r.show_id);
  if (!live.length) return out;
  const roomIds = live.map((r) => r.id as string);
  const showIds = [...new Set(live.map((r) => r.show_id as string))];
  const [{ data: showRows }, { data: memberRows }, { data: existing }] = await Promise.all([
    admin.from("shows").select("id, name, seasons, status, seasons_planned, next_air_at, next_air_season").in("id", showIds),
    admin.from("friend_group_members").select("group_id, user_id").in("group_id", roomIds),
    admin.from("sidebar_letters").select("room_id, kind, season").in("room_id", roomIds),
  ]);
  const showById = new Map<string, any>();
  for (const sh of (showRows ?? []) as any[]) showById.set(sh.id, sh);
  const membersByRoom = new Map<string, string[]>();
  for (const m of (memberRows ?? []) as any[]) {
    if (!membersByRoom.has(m.group_id)) membersByRoom.set(m.group_id, []);
    membersByRoom.get(m.group_id)!.push(m.user_id);
  }
  const planted = new Set(((existing ?? []) as any[]).map((x) => `${x.room_id}|${x.kind}|${x.season}`));
  const userIds = [...new Set(((memberRows ?? []) as any[]).map((m) => m.user_id as string))];
  const progByKey = new Map<string, any>();
  if (userIds.length) {
    const { data: progs } = await admin
      .from("progress")
      .select("user_id, show_id, season, episode, is_rewatching, highest_season, highest_episode, updated_at")
      .in("user_id", userIds)
      .in("show_id", showIds);
    for (const pr of (progs ?? []) as any[]) progByKey.set(`${pr.user_id}|${pr.show_id}`, pr);
  }
  // A letter at the second-to-last episode counts as the trigger too.
  const { data: linkRows } = await admin
    .from("group_threads")
    .select("group_id, shared_at, threads!inner(season, episode, is_deleted, author_id)")
    .in("group_id", roomIds);
  const lettersByRoom = new Map<string, { s: number; e: number; at: number }[]>();
  for (const l of (linkRows ?? []) as any[]) {
    if (!l.threads || l.threads.is_deleted || l.threads.author_id === SIDEBAR_USER_ID) continue;
    if (!lettersByRoom.has(l.group_id)) lettersByRoom.set(l.group_id, []);
    lettersByRoom.get(l.group_id)!.push({ s: l.threads.season, e: l.threads.episode, at: l.shared_at ? new Date(l.shared_at).getTime() : 0 });
  }
  const recentCutoff = nowMs - RECENT_DAYS * 86400000;

  for (const room of live) {
    const show = showById.get(room.show_id);
    const members = membersByRoom.get(room.id) ?? [];
    if (!show || !members.length) continue;
    const seasons: number[] = Array.isArray(show.seasons) ? show.seasons : [];
    const S = seasons.length;
    const last = S ? (seasons[S - 1] ?? 0) : 0;
    if (S < 1 || last < 1) continue;
    const effs = members.map((uid) => {
      const pr = progByKey.get(`${uid}|${room.show_id}`);
      return pr ? { eff: effectiveProgress(pr) as Eff, at: pr.updated_at ? new Date(pr.updated_at).getTime() : 0 } : null;
    });

    // what's next
    if (last >= 2 && seasonKnownComplete(show, S) && !planted.has(`${room.id}|whats_next|${S}`)) {
      const pen = last - 1;
      const recentProgress = effs.some((x) => x && atOrPast(x.eff, S, pen) && x.at >= recentCutoff);
      const recentLetter = (lettersByRoom.get(room.id) ?? []).some((l) => (l.s > S || (l.s === S && l.e >= pen)) && l.at >= recentCutoff);
      if (recentProgress || recentLetter) {
        // A room that already reached the end this week gets the finished
        // wording; the rest hear "almost done".
        const everyoneDone = effs.every((x) => x && atOrPast(x.eff, S, last));
        // Responses are off in the rooms, so the letter no longer asks for a
        // write-back (Alborz's notes, round 2).
        const tail = "\n\nBelow are the shows already proposed in this group, and a few from your own lists. Say yes to what you'd watch.";
        const ok = await plantOne(admin, room.id, room.show_id, "whats_next", S, everyoneDone ? {
          title: `You all finished ${show.name}. What's next?`,
          preview: "Everyone in this room has reached the end.",
          body: `Everyone in this room has reached the end of ${show.name}. Time to pick what you'll watch together next.${tail}`,
        } : {
          title: `You're almost done with ${show.name}. What's next?`,
          preview: "Someone in this room just reached the second-to-last episode.",
          body: `Someone in this room just reached the second-to-last episode of ${show.name}. Before the finale lands, pick what you'll watch together next.${tail}`,
        });
        if (ok) { out.whatsNext++; planted.add(`${room.id}|whats_next|${S}`); }
      }
    }

    // returning
    const nextAt = show.next_air_at ? new Date(show.next_air_at).getTime() : 0;
    const nextSeason = Number(show.next_air_season ?? 0);
    if (nextAt > nowMs && nextAt <= nowMs + RETURNING_DAYS * 86400000 && nextSeason > S && !planted.has(`${room.id}|returning|${nextSeason}`)) {
      const everyoneFinished = effs.every((x) => x && atOrPast(x.eff, S, last));
      if (everyoneFinished) {
        const finishedAt = Math.max(...effs.map((x) => x ? x.at : 0));
        const month = finishedAt > 0 ? ` in ${fmtMonth(finishedAt)}` : "";
        const day = fmtDay(show.next_air_at);
        const ok = await plantOne(admin, room.id, room.show_id, "returning", nextSeason, {
          title: `${show.name} returns ${day}.`,
          preview: `Season ${nextSeason} starts ${day}. You finished season ${S} together${month}.`,
          body: `Season ${nextSeason} starts ${day}. You finished season ${S} together${month}.\n\nYour letters from last season are right here below — worth a re-read before it starts — and the show guide has the recap, filtered to what you've seen.\n\nWrite back with what you're hoping for.`,
        });
        if (ok) { out.returning++; planted.add(`${room.id}|returning|${nextSeason}`); }
      }
    }
  }
  return out;
}

// ── The prompt to nudge (the friend who pulls ahead, CP3, 2026-10-22) ────
// Every live show room with two or more current members: for each pair, an
// AHEAD friend (a) and a BEHIND friend (b) with a gap of NUDGE_PROMPT_GAP+
// episodes (b's effective progress; never started = 0) whose position has
// held NUDGE_PROMPT_HOLD_DAYS (b's progress row untouched that long, or,
// with no row, b in the room that long). Skipped when a turned the room's
// emails off, nudged b in the last NUDGE_PROMPT_QUIET_DAYS, is a seed, or
// was already prompted about b in this room (nudge_prompts); that memory
// is cleared whenever b is within 2 again, so a fresh fall-behind earns a
// fresh prompt. Both ahead friends get prompted (his call). Not a dry run:
// the memory is written. Returns Map<aheadId, prompts[]> (names resolved
// per recipient later).
// "Thoughts on…" asks (CP3, 2026-10-25): every ask that landed in the window
// — the instant first ask on a new room, or tonight's planting — goes to each
// current member who has no take on it, through the one daily email, once
// (the window is the memory). Seen-gated like chat: a member who opened the
// chat since it landed has seen the card. Returns per recipient, with the
// group ids (for labels) and the answerers' ids (for names) to resolve.
async function computeAskDigests(admin: any, since: string, onlyUserId: string | null): Promise<{ byUser: Map<string, { groupId: string; prompt: string; answeredIds: string[] }[]>; groupIds: string[]; identityIds: string[] }> {
  const byUser = new Map<string, { groupId: string; prompt: string; answeredIds: string[] }[]>();
  const { data: askRows } = await admin
    .from("group_asks")
    .select("id, group_id, prompt, created_at")
    .gte("created_at", since)
    .is("closed_at", null);
  const asks = (askRows ?? []) as any[];
  if (!asks.length) return { byUser, groupIds: [], identityIds: [] };
  const groupIds = [...new Set(asks.map((a) => a.group_id as string))];
  const [{ data: mRows }, { data: tRows }] = await Promise.all([
    admin.from("people_group_members").select("group_id, user_id, chat_last_seen_at, migration_dormant").in("group_id", groupIds),
    admin.from("ask_takes").select("ask_id, user_id").in("ask_id", asks.map((a) => a.id)),
  ]);
  const membersByGroup = new Map<string, any[]>();
  for (const m of (mRows ?? []) as any[]) {
    if (m.migration_dormant) continue;
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
    membersByGroup.get(m.group_id)!.push(m);
  }
  const takersByAsk = new Map<string, string[]>();
  for (const t of (tRows ?? []) as any[]) takersByAsk.set(t.ask_id, [...(takersByAsk.get(t.ask_id) ?? []), t.user_id]);
  const identity = new Set<string>();
  for (const a of asks) {
    const takers = takersByAsk.get(a.id) ?? [];
    for (const m of membersByGroup.get(a.group_id) ?? []) {
      if (takers.includes(m.user_id)) continue;                     // already in
      if (onlyUserId && m.user_id !== onlyUserId) continue;
      if (seenBefore(m.chat_last_seen_at, a.created_at)) continue;  // opened the chat since — saw the card
      if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
      byUser.get(m.user_id)!.push({ groupId: a.group_id, prompt: a.prompt, answeredIds: takers });
      for (const t of takers) identity.add(t);
    }
  }
  return { byUser, groupIds, identityIds: [...identity] };
}

async function computeNudgePrompts(admin: any, dryRun: boolean, onlyUserId: string | null): Promise<Map<string, NudgePromptDigest[]>> {
  const out = new Map<string, NudgePromptDigest[]>();
  const nowMs = Date.now();
  const holdBefore = nowMs - NUDGE_PROMPT_HOLD_DAYS * 86400000;
  const quietSince = new Date(nowMs - NUDGE_PROMPT_QUIET_DAYS * 86400000).toISOString();

  const { data: roomRows } = await admin
    .from("friend_groups")
    .select("id, show_id, parent_group_id, deleted_at, dnf_at")
    .is("deleted_at", null)
    .is("dnf_at", null)
    .not("parent_group_id", "is", null);
  const rooms = (roomRows ?? []) as any[];
  if (!rooms.length) return out;
  const roomIds = rooms.map((r) => r.id as string);
  const { data: memRows } = await admin
    .from("friend_group_members")
    .select("group_id, user_id, digest_opt_out, joined_at")
    .in("group_id", roomIds);
  const membersByRoom = new Map<string, any[]>();
  for (const m of (memRows ?? []) as any[]) membersByRoom.set(m.group_id, [...(membersByRoom.get(m.group_id) ?? []), m]);
  const liveRooms = rooms.filter((r) => (membersByRoom.get(r.id)?.length ?? 0) >= 2);
  if (!liveRooms.length) return out;

  const userIds = [...new Set(liveRooms.flatMap((r) => (membersByRoom.get(r.id) ?? []).map((m) => m.user_id as string)))];
  const showIds = [...new Set(liveRooms.map((r) => r.show_id as string))];
  const [{ data: progRows }, { data: showRows }, { data: profRows }, { data: pingRows }, { data: promptRows }] = await Promise.all([
    admin.from("progress").select("user_id, show_id, season, episode, is_rewatching, highest_season, highest_episode, updated_at").in("user_id", userIds).in("show_id", showIds),
    admin.from("shows").select("id, name, seasons").in("id", showIds),
    admin.from("profiles").select("id, is_seed").in("id", userIds),
    admin.from("pings").select("sender_id, recipient_id, group_id").eq("ping_type", "nudge_ahead").gte("sent_at", quietSince).in("group_id", liveRooms.map((r) => r.id)),
    admin.from("nudge_prompts").select("group_id, ahead_id, behind_id").in("group_id", liveRooms.map((r) => r.id)),
  ]);
  const prog = new Map<string, any>();
  for (const p of (progRows ?? []) as any[]) prog.set(`${p.user_id}|${p.show_id}`, p);
  const shows = new Map<string, { name: string; seasons: number[] }>();
  for (const sh of (showRows ?? []) as any[]) shows.set(sh.id, { name: String(sh.name ?? sh.id), seasons: Array.isArray(sh.seasons) ? sh.seasons : [] });
  const seeds = new Set(((profRows ?? []) as any[]).filter((p) => p.is_seed).map((p) => p.id as string));
  const nudgedRecently = new Set(((pingRows ?? []) as any[]).map((p) => `${p.group_id}|${p.sender_id}|${p.recipient_id}`));
  const prompted = new Set(((promptRows ?? []) as any[]).map((p) => `${p.group_id}|${p.ahead_id}|${p.behind_id}`));

  const toInsert: { group_id: string; ahead_id: string; behind_id: string; gap: number }[] = [];
  const toDelete: { group_id: string; ahead_id: string; behind_id: string }[] = [];
  for (const room of liveRooms) {
    const show = shows.get(room.show_id);
    if (!show) continue;
    const members = membersByRoom.get(room.id) ?? [];
    const pos = members.map((m) => {
      const p = prog.get(`${m.user_id}|${room.show_id}`);
      const eff = p ? effectiveProgress(p) : { s: 0, e: 0 };
      const idx = linearIndex(eff.s, eff.e, show.seasons);
      // When the position last moved: the progress row, else joining the room.
      const movedAt = p?.updated_at ? new Date(p.updated_at).getTime() : (m.joined_at ? new Date(m.joined_at).getTime() : nowMs);
      return { m, eff, idx, movedAt };
    });
    for (const a of pos) {
      for (const b of pos) {
        if (a === b) continue;
        const key = `${room.id}|${a.m.user_id}|${b.m.user_id}`;
        const gap = a.idx - b.idx;
        if (gap <= 2) {
          if (prompted.has(key)) { prompted.delete(key); toDelete.push({ group_id: room.id, ahead_id: a.m.user_id, behind_id: b.m.user_id }); }
          continue;
        }
        if (gap < NUDGE_PROMPT_GAP) continue;
        if (prompted.has(key)) continue;
        if (a.m.digest_opt_out) continue;
        if (seeds.has(a.m.user_id) || seeds.has(b.m.user_id)) continue;
        if (b.movedAt > holdBefore) continue;
        if (nudgedRecently.has(key)) continue;
        if (onlyUserId && a.m.user_id !== onlyUserId) continue;
        out.set(a.m.user_id, [...(out.get(a.m.user_id) ?? []), {
          groupId: room.id, roomName: show.name, behindId: b.m.user_id, behindName: "", started: b.idx > 0,
          behindS: b.eff.s, behindE: b.eff.e, gap, viewerEpisodes: a.idx,
        }]);
        toInsert.push({ group_id: room.id, ahead_id: a.m.user_id, behind_id: b.m.user_id, gap });
      }
    }
  }
  if (!dryRun) {
    for (const d of toDelete) {
      await admin.from("nudge_prompts").delete().eq("group_id", d.group_id).eq("ahead_id", d.ahead_id).eq("behind_id", d.behind_id);
    }
    if (toInsert.length) await admin.from("nudge_prompts").upsert(toInsert, { onConflict: "group_id,ahead_id,behind_id" });
  }
  return out;
}

// ── "Reached your letter" (the friend who pulls ahead, CP4, 2026-10-22) ──
// letter_watchers rows (by trigger: a letter linked into a room while a
// member was 3+ episodes behind its stamp) not yet reported. The friend has
// REACHED the letter when their effective progress is at or past its
// stamp. Skipped (but still stamped reported) when the letter is gone, the
// room is gone or parked, the friend left it, or the author turned the
// room's emails off. Grouped per (author, room, friend), letters oldest
// first. Not a dry run: reported_at is written.
async function computeReachedLetters(admin: any, dryRun: boolean, onlyUserId: string | null): Promise<Map<string, ReachedDigest[]>> {
  const out = new Map<string, ReachedDigest[]>();
  const { data: rows } = await admin
    .from("letter_watchers")
    .select("thread_id, behind_id, author_id, group_id, stamp_season, stamp_episode, created_at")
    .is("reported_at", null);
  const watchers = (rows ?? []) as any[];
  if (!watchers.length) return out;
  const groupIds = [...new Set(watchers.map((w) => w.group_id as string))];
  const threadIds = [...new Set(watchers.map((w) => w.thread_id as string))];
  const behindIds = [...new Set(watchers.map((w) => w.behind_id as string))];
  const [{ data: groupRows }, { data: threadRows }, { data: memRows }] = await Promise.all([
    admin.from("friend_groups").select("id, show_id, deleted_at, dnf_at").in("id", groupIds),
    admin.from("threads").select("id, title, is_deleted, created_at").in("id", threadIds),
    admin.from("friend_group_members").select("group_id, user_id, digest_opt_out").in("group_id", groupIds),
  ]);
  const groups = new Map<string, any>(((groupRows ?? []) as any[]).map((g) => [g.id, g]));
  const threads = new Map<string, any>(((threadRows ?? []) as any[]).map((t) => [t.id, t]));
  const members = new Map<string, any>(((memRows ?? []) as any[]).map((m) => [`${m.group_id}|${m.user_id}`, m]));
  const showIds = [...new Set([...groups.values()].map((g) => g.show_id as string))];
  const [{ data: showRows }, { data: progRows }] = await Promise.all([
    admin.from("shows").select("id, name, seasons").in("id", showIds),
    admin.from("progress").select("user_id, show_id, season, episode, is_rewatching, highest_season, highest_episode").in("user_id", behindIds).in("show_id", showIds),
  ]);
  const shows = new Map<string, { name: string; seasons: number[] }>();
  for (const sh of (showRows ?? []) as any[]) shows.set(sh.id, { name: String(sh.name ?? sh.id), seasons: Array.isArray(sh.seasons) ? sh.seasons : [] });
  const prog = new Map<string, any>();
  for (const p of (progRows ?? []) as any[]) prog.set(`${p.user_id}|${p.show_id}`, p);

  const done: { thread_id: string; behind_id: string }[] = [];
  const byKey = new Map<string, ReachedDigest>();
  for (const w of watchers) {
    const g = groups.get(w.group_id); const t = threads.get(w.thread_id);
    const show = g ? shows.get(g.show_id) : undefined;
    const member = members.get(`${w.group_id}|${w.behind_id}`);
    const authorMember = members.get(`${w.group_id}|${w.author_id}`);
    // Gone, parked, left, deleted: close the watcher quietly.
    if (!g || g.deleted_at || g.dnf_at || !t || t.is_deleted || !show || !member) { done.push({ thread_id: w.thread_id, behind_id: w.behind_id }); continue; }
    const p = prog.get(`${w.behind_id}|${g.show_id}`);
    const eff = p ? effectiveProgress(p) : { s: 0, e: 0 };
    if (linearIndex(eff.s, eff.e, show.seasons) < linearIndex(w.stamp_season, w.stamp_episode, show.seasons)) continue; // not there yet
    done.push({ thread_id: w.thread_id, behind_id: w.behind_id });
    if (authorMember?.digest_opt_out) continue;      // the author turned the room's emails off
    if (onlyUserId && w.author_id !== onlyUserId) continue;
    const key = `${w.author_id}|${w.group_id}|${w.behind_id}`;
    if (!byKey.has(key)) byKey.set(key, { groupId: w.group_id, roomName: show.name, behindId: w.behind_id, behindName: "", s: eff.s, e: eff.e, letters: [] });
    byKey.get(key)!.letters.push({ threadId: w.thread_id, title: (t.title && String(t.title).trim()) || "(untitled)", createdAt: t.created_at } as any);
    if (!out.has(w.author_id)) out.set(w.author_id, []);
  }
  for (const [key, d] of byKey) {
    d.letters.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const authorId = key.split("|")[0];
    out.get(authorId)!.push(d);
  }
  for (const [uid, list] of out) if (!list.length) out.delete(uid);
  if (!dryRun && done.length) {
    const at = new Date().toISOString();
    for (const d of done) await admin.from("letter_watchers").update({ reported_at: at }).eq("thread_id", d.thread_id).eq("behind_id", d.behind_id);
  }
  return out;
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

  // Letters from Sidebar (2026-09-28): plant this run's letters FIRST so they
  // land inside the window and ride tonight's digest. Never on a dry run;
  // never blocks the digest.
  const planted = dryRun
    ? { whatsNext: 0, returning: 0, dryRun: true }
    : await plantSidebarLetters(admin).catch((e) => { console.error("[sidebar-letters] planting failed", e); return { whatsNext: 0, returning: 0, error: String(e) }; });

  // "Thoughts on…" asks (CP3, 2026-10-25): plant tonight's asks FIRST so they
  // land inside the window and ride tonight's email (14 days after everyone
  // answered the last one, 28 after it landed, held while the chat was busy;
  // groups with a room and no ask yet get their first). Never on a dry run.
  let asksPlanted = 0;
  if (!dryRun) {
    const { data: n, error: pe } = await admin.rpc("plant_group_asks");
    if (pe) console.error("[asks] planting failed", pe); else asksPlanted = Number(n ?? 0);
  }
  const askDigestsRaw = await computeAskDigests(admin, since, onlyUserId).catch((e) => { console.warn("asks skipped:", e); return { byUser: new Map<string, { groupId: string; prompt: string; answeredIds: string[] }[]>(), groupIds: [] as string[], identityIds: [] as string[] }; });

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
  let proposals: { groupId: string; showId: string; proposerId: string; createdAt: string }[] = [];
  // A yes on a pair that already had votes is an ANSWER to its pitch (10-14).
  const answerVotes: any[] = [];
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
    proposals = [...earliestByPair.values()].map((v) => ({ groupId: v.group_id, showId: v.show_id, proposerId: v.user_id, createdAt: v.created_at }));
    for (const v of recentVotes) if (priorPairs.has(`${v.group_id}|${v.show_id}`)) answerVotes.push(v);
  }

  // 1c-ans. Answers to pitches (Alborz, 10-14): the passes in the window
  //     ("sit this out" / "seen it") plus the later yes-votes above. The
  //     pitcher — the pair's EARLIEST vote, in or before the window — is the
  //     recipient; an answer by the pitcher themself is not an answer.
  const { data: passRows } = await admin
    .from("group_show_passes")
    .select("group_id, show_id, user_id, kind, created_at")
    .gte("created_at", since);
  const rawAnswers: { groupId: string; showId: string; byUserId: string; kind: "in" | "out" | "seen"; createdAt: string }[] = [
    ...answerVotes.map((v) => ({ groupId: v.group_id as string, showId: v.show_id as string, byUserId: v.user_id as string, kind: "in" as const, createdAt: v.created_at as string })),
    ...((passRows ?? []) as any[])
      .filter((p) => p.kind === "out" || p.kind === "seen")
      .map((p) => ({ groupId: p.group_id as string, showId: p.show_id as string, byUserId: p.user_id as string, kind: p.kind as "out" | "seen", createdAt: p.created_at as string })),
  ];
  let answers: { groupId: string; showId: string; pitcherId: string; byUserId: string; kind: "in" | "out" | "seen"; createdAt: string }[] = [];
  if (rawAnswers.length) {
    const { data: allVotes } = await admin
      .from("group_show_votes")
      .select("group_id, show_id, user_id, created_at")
      .in("group_id", [...new Set(rawAnswers.map((a) => a.groupId))])
      .in("show_id", [...new Set(rawAnswers.map((a) => a.showId))]);
    const pitcherByPair = new Map<string, { userId: string; at: number }>();
    for (const v of (allVotes ?? []) as any[]) {
      const key = `${v.group_id}|${v.show_id}`;
      const at = new Date(v.created_at).getTime();
      const cur = pitcherByPair.get(key);
      if (!cur || at < cur.at) pitcherByPair.set(key, { userId: v.user_id, at });
    }
    answers = rawAnswers.flatMap((a) => {
      const p = pitcherByPair.get(`${a.groupId}|${a.showId}`);
      return p && p.userId !== a.byUserId ? [{ ...a, pitcherId: p.userId }] : [];
    });
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

  // 1e. Notes (2026-10-07): friends' highlight NOTES in the window, each
  //     resolved to the LETTER it hangs under (a note on a response resolves
  //     through the response) plus everyone who is part of that letter —
  //     its author, live responders, and anyone who has left a note on it.
  const { data: hlRows } = await admin
    .from("highlights")
    .select("id, target_type, target_id, group_id, author_id, kind, author_season, author_episode, created_at")
    .gte("created_at", since);
  const recentNotes = ((hlRows ?? []) as any[]).filter((h) => h.group_id && h.kind === "note");
  const notedThreadById = new Map<string, any>();
  const noteTarget = new Map<string, { threadId: string; onResponse: boolean; responseAuthorId: string | null }>();
  const partsByNotedThread = new Map<string, Set<string>>();
  if (recentNotes.length) {
    const replyTargetIds = recentNotes.filter((h) => h.target_type === "reply").map((h) => h.target_id as string);
    const replyById = new Map<string, any>();
    if (replyTargetIds.length) {
      const { data: rrows } = await admin.from("replies").select("id, thread_id, author_id, group_id, is_deleted").in("id", replyTargetIds);
      for (const r of (rrows ?? []) as any[]) if (!r.is_deleted) replyById.set(r.id, r);
    }
    for (const h of recentNotes) {
      if (h.target_type === "thread") { noteTarget.set(h.id, { threadId: h.target_id, onResponse: false, responseAuthorId: null }); continue; }
      const r = replyById.get(h.target_id);
      if (r) noteTarget.set(h.id, { threadId: r.thread_id, onResponse: true, responseAuthorId: r.author_id });
    }
    const ntIds = [...new Set([...noteTarget.values()].map((x) => x.threadId))];
    if (ntIds.length) {
      const { data: ntRows } = await admin
        .from("threads")
        .select("id, author_id, title, season, episode, is_deleted, is_public")
        .in("id", ntIds);
      for (const th of (ntRows ?? []) as any[]) {
        if (!th.is_deleted && th.is_public === false) notedThreadById.set(th.id, th);
      }
      for (const [tid, th] of notedThreadById) partsByNotedThread.set(tid, new Set([th.author_id]));
      const { data: partRows2 } = await admin.from("replies").select("thread_id, author_id, group_id, is_deleted").in("thread_id", ntIds);
      for (const pr of (partRows2 ?? []) as any[]) {
        if (!pr.group_id || pr.is_deleted) continue;
        partsByNotedThread.get(pr.thread_id)?.add(pr.author_id);
      }
      const { data: noteRows2 } = await admin.from("highlights").select("target_id, author_id").eq("target_type", "thread").eq("kind", "note").in("target_id", ntIds);
      for (const n of (noteRows2 ?? []) as any[]) partsByNotedThread.get(n.target_id)?.add(n.author_id);
    }
  }

  // 1f. The prompt to nudge (CP3, 2026-10-22): per room, every (ahead,
  //     behind) pair of current members with a gap of 3+ that has held for
  //     a couple of days. Its own memory (nudge_prompts) keeps it to once,
  //     re-armed when the friend comes within 2. Tolerant — a failure just
  //     means no prompts tonight.
  const promptsByUser = await computeNudgePrompts(admin, dryRun, onlyUserId).catch((e) => { console.warn("nudge prompts skipped:", e); return new Map<string, NudgePromptDigest[]>(); });
  // 1g. "Reached your letter" (CP4): watchers whose friend has arrived.
  const reachedByUser = await computeReachedLetters(admin, dryRun, onlyUserId).catch((e) => { console.warn("reached letters skipped:", e); return new Map<string, ReachedDigest[]>(); });

  if (!recentLinks.length && !recentChats.length && !proposals.length && !recentReplies.length && !recentNotes.length && !answers.length && !promptsByUser.size && !reachedByUser.size) {
    return json({ ok: true, sent: 0, reason: "nothing new", planted });
  }

  // 2. Index thread rows (from the embedded join, plus replied-to threads).
  //    Seed/demo authors are dropped later (not a "friend"); departed authors
  //    still resolve.
  const threadById = new Map<string, any>();
  for (const l of recentLinks) threadById.set(l.threads.id, l.threads);
  for (const [tid, th] of repliedThreadById) if (!threadById.has(tid)) threadById.set(tid, th);
  for (const [tid, th] of notedThreadById) if (!threadById.has(tid)) threadById.set(tid, th);

  // 3. Active rooms only (skip soft-deleted).
  const groupIds = [...new Set([...recentLinks.map((l) => l.group_id), ...recentReplies.map((r) => r.group_id), ...recentNotes.map((h) => h.group_id)])];
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
    ...answers.map((a) => a.showId),
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
      .select("group_id, user_id, digest_opt_out, last_seen_at")
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
    ...answers.map((a) => a.groupId),
    ...askDigestsRaw.groupIds,
  ])];
  const pgNameById = new Map<string, string | null>();
  const pgMembersByGroup = new Map<string, string[]>();
  // Seen-gating (round 6): each member's chat and pitched-list stamps.
  const pgStampByKey = new Map<string, { chat: string | null; pitches: string | null }>();
  if (pgIds.length) {
    const { data: pgs } = await admin.from("people_groups").select("id, name").in("id", pgIds);
    for (const g of pgs ?? []) pgNameById.set(g.id, g.name ?? null);
    const { data: pgm } = await admin
      .from("people_group_members")
      .select("group_id, user_id, chat_last_seen_at, pitches_last_seen_at")
      .in("group_id", pgIds);
    for (const m of pgm ?? []) {
      if (!pgMembersByGroup.has(m.group_id)) pgMembersByGroup.set(m.group_id, []);
      pgMembersByGroup.get(m.group_id)!.push(m.user_id);
      pgStampByKey.set(`${m.group_id}|${m.user_id}`, { chat: m.chat_last_seen_at ?? null, pitches: m.pitches_last_seen_at ?? null });
    }
  }

  // 5. One profile fetch for every identity a digest might render: entry
  //    authors, chat senders, proposers, and people-group members (labels).
  const identityIds = [...new Set([
    ...[...threadById.values()].map((t) => t.author_id),
    ...recentReplies.map((r) => r.author_id),
    ...recentNotes.map((h) => h.author_id),
    ...recentChats.map((c) => c.author_id),
    ...proposals.map((p) => p.proposerId),
    ...answers.map((a) => a.byUserId),
    ...[...pgMembersByGroup.values()].flat(),
    ...[...promptsByUser.values()].flat().map((p) => p.behindId),
    ...[...reachedByUser.values()].flat().map((r) => r.behindId),
    ...askDigestsRaw.identityIds,
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
  const perUser = new Map<string, Map<string, { roomName: string; entries: any[]; responses: any[]; notes: any[] }>>();
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
      if (seenBefore(m.last_seen_at, link.shared_at)) continue; // opened the room since — seen
      const prog = progIndex.get(`${m.user_id}|${g.show_id}`);
      // A letter from Sidebar (S0 E0) reaches every member, row or no row.
      if (!prog && t.author_id !== SIDEBAR_USER_ID) continue; // hasn't started → sees nothing
      if (!canView(t.season, t.episode, prog ? effectiveProgress(prog) : { s: 0, e: 0 })) continue;
      if (!perUser.has(m.user_id)) perUser.set(m.user_id, new Map());
      const rooms = perUser.get(m.user_id)!;
      if (!rooms.has(link.group_id)) {
        rooms.set(link.group_id, { roomName: showNameById.get(g.show_id) ?? g.name, entries: [], responses: [], notes: [] });
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
      if (seenBefore(m.last_seen_at, rr.created_at)) continue; // opened the room since — seen
      const prog = progIndex.get(`${m.user_id}|${g.show_id}`);
      if (!prog) continue;
      // Readable only — a hidden reply is the in-app red dot, never mail.
      if (!canView(rr.season, rr.episode, effectiveProgress(prog))) continue;
      if (!perUser.has(m.user_id)) perUser.set(m.user_id, new Map());
      const rooms = perUser.get(m.user_id)!;
      if (!rooms.has(rr.group_id)) {
        rooms.set(rr.group_id, { roomName: showNameById.get(g.show_id) ?? g.name, entries: [], responses: [], notes: [] });
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

  // 6-note. Per-recipient READABLE notes on their writing (2026-10-07): a
  //     letter they wrote or are part of, or a response they wrote.
  for (const h of recentNotes) {
    const g = activeGroups.get(h.group_id);
    if (!g) continue;
    const tgt = noteTarget.get(h.id);
    if (!tgt) continue;
    const th = notedThreadById.get(tgt.threadId);
    if (!th) continue;
    if (seedAuthors.has(h.author_id)) continue;      // skip seed/demo content
    const parts = partsByNotedThread.get(tgt.threadId);
    const roster = membersByGroup.get(h.group_id) ?? [];
    for (const m of roster) {
      if (m.user_id === h.author_id) continue;        // not your own notes
      const mine = tgt.onResponse ? tgt.responseAuthorId === m.user_id : !!parts?.has(m.user_id);
      if (!mine) continue;                             // only your writing, or a letter you're part of
      if (m.digest_opt_out) continue;                  // opted out of this room
      if (onlyUserId && m.user_id !== onlyUserId) continue;
      if (seenBefore(m.last_seen_at, h.created_at)) continue; // opened the room since — seen
      const prog = progIndex.get(`${m.user_id}|${g.show_id}`);
      if (!prog) continue;
      // Readable only — a sealed note is the in-app red dot, never mail.
      if (!canView(h.author_season ?? 0, h.author_episode ?? 0, effectiveProgress(prog))) continue;
      if (!perUser.has(m.user_id)) perUser.set(m.user_id, new Map());
      const rooms = perUser.get(m.user_id)!;
      if (!rooms.has(h.group_id)) {
        rooms.set(h.group_id, { roomName: showNameById.get(g.show_id) ?? g.name, entries: [], responses: [], notes: [] });
      }
      rooms.get(h.group_id)!.notes.push({
        threadId: th.id,
        title: (th.title && String(th.title).trim()) || "(untitled)",
        threadAuthorId: th.author_id,
        onResponse: tgt.onResponse,
        noterId: h.author_id,
        createdAt: h.created_at,
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
      if (seenBefore(pgStampByKey.get(`${c.group_id}|${uid}`)?.chat, c.created_at)) continue; // opened the chat since — seen
      if (!perUserChat.has(uid)) perUserChat.set(uid, new Map());
      const groups = perUserChat.get(uid)!;
      if (!groups.has(c.group_id)) groups.set(c.group_id, new Set());
      groups.get(c.group_id)!.add(c.author_id);
    }
  }

  // 6a-prop-in. Who else has opted in to each proposed show (2026-09-30):
  //     Map<"group|show", Set<userId>> — the "(X is also in.)" note.
  const votersByPair = new Map<string, Set<string>>();
  if (proposals.length) {
    const { data: inRows } = await admin
      .from("group_show_votes")
      .select("group_id, show_id, user_id")
      .in("group_id", [...new Set(proposals.map((p) => p.groupId))])
      .in("show_id", [...new Set(proposals.map((p) => p.showId))]);
    for (const v of (inRows ?? []) as any[]) {
      const key = `${v.group_id}|${v.show_id}`;
      if (!votersByPair.has(key)) votersByPair.set(key, new Set());
      votersByPair.get(key)!.add(v.user_id);
    }
  }

  // 6a-prop. Per-recipient proposal items.
  const perUserProps = new Map<string, { groupId: string; showId: string; proposerId: string; createdAt: string }[]>();
  for (const p of proposals) {
    if (seedAuthors.has(p.proposerId)) continue;
    const roster = pgMembersByGroup.get(p.groupId) ?? [];
    for (const uid of roster) {
      if (uid === p.proposerId) continue;            // not your own proposals
      if (onlyUserId && uid !== onlyUserId) continue;
      if (seenBefore(pgStampByKey.get(`${p.groupId}|${uid}`)?.pitches, p.createdAt)) continue; // opened the pitched list since — seen
      if (!perUserProps.has(uid)) perUserProps.set(uid, []);
      perUserProps.get(uid)!.push(p);
    }
  }

  // 6a-ans. Per-recipient answers to their own pitches (10-14), gated like the
  //     pitches: skipped once the pitcher has opened the pitched list since.
  const perUserAnswers = new Map<string, typeof answers>();
  for (const a of answers) {
    if (seedAuthors.has(a.byUserId)) continue;
    if (onlyUserId && a.pitcherId !== onlyUserId) continue;
    if (!(pgMembersByGroup.get(a.groupId) ?? []).includes(a.pitcherId)) continue;
    if (seenBefore(pgStampByKey.get(`${a.groupId}|${a.pitcherId}`)?.pitches, a.createdAt)) continue;
    if (!perUserAnswers.has(a.pitcherId)) perUserAnswers.set(a.pitcherId, []);
    perUserAnswers.get(a.pitcherId)!.push(a);
  }

  const recipientIds = [...new Set([...perUser.keys(), ...perUserChat.keys(), ...perUserProps.keys(), ...perUserAnswers.keys(), ...promptsByUser.keys(), ...reachedByUser.keys(), ...askDigestsRaw.byUser.keys()])];
  if (recipientIds.length === 0) return json({ ok: true, sent: 0, reason: "nothing visible/new", planted, asksPlanted });
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
    const rooms = perUser.get(userId) ?? new Map<string, { roomName: string; entries: any[]; responses: any[]; notes: any[] }>();
    const roomDigests: RoomDigest[] = [...rooms.entries()]
      .map(([groupId, r]: [string, { roomName: string; entries: any[]; responses: any[]; notes: any[] }]) => {
        const entries: DigestEntry[] = r.entries
          .filter((e: any) => e.authorId !== SIDEBAR_USER_ID) // Sidebar's letters get their own lines (below)
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
        // Notes grouped per letter (a note on a response under it is its own
        // line), noters in arrival order.
        const notesByKey = new Map<string, DigestNote>();
        for (const x of [...r.notes].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
          const key = `${x.threadId}|${x.onResponse ? "r" : "t"}`;
          if (!notesByKey.has(key)) {
            notesByKey.set(key, { threadId: x.threadId, title: x.title, ownerName: x.threadAuthorId === userId ? null : authorName(x.threadAuthorId), onResponse: x.onResponse, noterNames: [] });
          }
          const d = notesByKey.get(key)!;
          const n = authorName(x.noterId);
          if (!d.noterNames.includes(n)) d.noterNames.push(n);
        }
        return { groupId, roomName: r.roomName, entries, authorNames, responses: [...byThread.values()], notes: [...notesByKey.values()] };
      })
      // A room whose only news is a letter from Sidebar has no friend section.
      .filter((r) => r.entries.length > 0 || r.responses.length > 0 || r.notes.length > 0)
      .sort((a, b) => a.roomName.localeCompare(b.roomName));
    // Letters from Sidebar (2026-09-30): their own linked lines under the greeting.
    const sidebarLetters: SidebarLetterDigest[] = [...rooms.entries()]
      .flatMap(([groupId, r]: [string, { roomName: string; entries: any[]; responses: any[]; notes: any[] }]) => r.entries
        .filter((e: any) => e.authorId === SIDEBAR_USER_ID)
        .map((e: any) => ({ groupId, roomName: r.roomName, threadId: e.threadId, title: e.title })))
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

    // Proposals grouped under the friend who proposed (2026-09-30): one
    // block per (friend, group), shows by name; "(X is also in.)" names the
    // OTHER friends who've opted in — never the proposer or the recipient.
    const propBlocks = new Map<string, { groupId: string; proposerId: string; shows: { showName: string; alsoIn: string[] }[] }>();
    for (const p of perUserProps.get(userId) ?? []) {
      const key = `${p.proposerId}|${p.groupId}`;
      if (!propBlocks.has(key)) propBlocks.set(key, { groupId: p.groupId, proposerId: p.proposerId, shows: [] });
      const alsoIn = [...(votersByPair.get(`${p.groupId}|${p.showId}`) ?? [])]
        .filter((uid) => uid !== p.proposerId && uid !== userId && !seedAuthors.has(uid))
        .map((uid) => authorName(uid));
      propBlocks.get(key)!.shows.push({ showName: showNameById.get(p.showId) ?? p.showId, alsoIn });
    }
    const groupsByProposer = new Map<string, Set<string>>();
    for (const b of propBlocks.values()) {
      if (!groupsByProposer.has(b.proposerId)) groupsByProposer.set(b.proposerId, new Set());
      groupsByProposer.get(b.proposerId)!.add(b.groupId);
    }
    const proposalDigests: ProposalDigest[] = [...propBlocks.values()]
      .map((b) => ({
        groupId: b.groupId,
        proposerName: authorName(b.proposerId),
        groupLabel: (groupsByProposer.get(b.proposerId)?.size ?? 0) > 1 ? groupLabel(b.groupId) : null,
        shows: b.shows.sort((x, y) => x.showName.localeCompare(y.showName)),
      }))
      .sort((a, b) => a.proposerName.localeCompare(b.proposerName));

    const chatDigests: ChatDigest[] = [...(perUserChat.get(userId) ?? new Map<string, Set<string>>()).entries()]
      .map(([gid, senders]: [string, Set<string>]) => ({
        groupId: gid,
        groupLabel: groupLabel(gid),
        senderNames: [...senders].map((sid) => authorName(sid)),
      }))
      .sort((a, b) => a.groupLabel.localeCompare(b.groupLabel));

    // Answers to your pitches (10-14): one block per group, in arrival order.
    const ansByGroup = new Map<string, AnswerDigest>();
    for (const a of [...(perUserAnswers.get(userId) ?? [])].sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime())) {
      if (!ansByGroup.has(a.groupId)) ansByGroup.set(a.groupId, { groupId: a.groupId, groupLabel: groupLabel(a.groupId), lines: [] });
      const lead = `${authorName(a.byUserId)} answered your ${showNameById.get(a.showId) ?? a.showId} pitch`;
      ansByGroup.get(a.groupId)!.lines.push({ lead, text: `${lead}: ${a.kind === "in" ? "I’m in" : a.kind === "seen" ? "seen it" : "sitting this out"}.` });
    }
    const answerDigests: AnswerDigest[] = [...ansByGroup.values()].sort((a, b) => a.groupLabel.localeCompare(b.groupLabel));

    const deckNames = deckNamesByRecipient.get(userId) ?? [];
    // The prompts to nudge (CP3), the behind friend named the recipient's way.
    const nudgePrompts: NudgePromptDigest[] = (promptsByUser.get(userId) ?? []).map((p) => ({ ...p, behindName: authorName(p.behindId) }));
    const reachedLetters: ReachedDigest[] = (reachedByUser.get(userId) ?? []).map((r) => ({ ...r, behindName: authorName(r.behindId) }));
    const askDigests: AskDigest[] = (askDigestsRaw.byUser.get(userId) ?? []).map((a) => ({
      groupId: a.groupId, groupLabel: groupLabel(a.groupId), prompt: a.prompt,
      answeredNames: a.answeredIds.filter((id) => !seedAuthors.has(id)).map((id) => authorName(id)),
    }));
    if (dryRun) {
      report.push({
        userId, email,
        rooms: roomDigests.length,
        entries: roomDigests.reduce((n, r) => n + r.entries.length, 0),
        responses: roomDigests.reduce((n, r) => n + r.responses.length, 0),
        notes: roomDigests.reduce((n, r) => n + r.notes.length, 0),
        proposals: proposalDigests.reduce((n, p) => n + p.shows.length, 0),
        answers: answerDigests.reduce((n, a) => n + a.lines.length, 0),
        sidebarLetters: sidebarLetters.length,
        chats: chatDigests.length,
        deckNames: deckNames.length,
        nudgePrompts: nudgePrompts.map((p) => ({ room: p.roomName, behind: p.behindName, gap: p.gap, started: p.started })),
        reached: reachedLetters.map((r) => ({ room: r.roomName, behind: r.behindName, at: `S${r.s} E${r.e}`, letters: r.letters.length })),
        asks: askDigests.map((a) => ({ group: a.groupLabel, prompt: a.prompt, in: a.answeredNames })),
        dryRun: true,
      });
      continue;
    }
    const ok = await sendResendEmail(
      resendKey,
      email,
      buildSubject(roomDigests, chatDigests, proposalDigests, deckNames, sidebarLetters, answerDigests, nudgePrompts, reachedLetters, askDigests),
      buildDigestHtml(roomDigests, baseUrl, deckNames, proposalDigests, chatDigests, greetName, sidebarLetters, answerDigests, nudgePrompts, reachedLetters, askDigests),
      buildDigestText(roomDigests, baseUrl, deckNames, proposalDigests, chatDigests, greetName, sidebarLetters, answerDigests, nudgePrompts, reachedLetters, askDigests),
    );
    if (ok) sent++;
    report.push({ userId, email, rooms: roomDigests.length, proposals: proposalDigests.length, answers: answerDigests.length, chats: chatDigests.length, nudgePrompts: nudgePrompts.length, reached: reachedLetters.length, asks: askDigests.length, sent: ok });
  }

  return json({ ok: true, dryRun, candidates: recipientIds.length, sent, planted, asksPlanted, report });
});
