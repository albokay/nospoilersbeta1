// ============================================================
// What a push says (push notifications CP2, 2026-11-05).
//
// gatherActs: every friend's act since `since` that a recipient should hear
// about, as one list per recipient. It MIRRORS the daily email's rules
// (send-digests: progress gate, stand-alone seasons, seen-gating against the
// app's own stamps, seed/demo authors dropped) for the kinds pushes carry —
// letters, a handed-over journal, responses and notes on your writing, chat,
// pitches, answers to your pitches, guide letters — with three differences
// that are his calls:
//   • friends' acts only: Sidebar's own letters, the behind prompt,
//     "reached your letter" and deck answers stay email-only;
//   • a guide letter pushes only when it's open to you (the email also
//     mentions sealed ones, "It'll open when you get there");
//   • a room's "stop emails" switch is email only; pushes ignore it.
// The email's code is NOT shared or changed; keep the two in step by hand.
//
// composePush: his wording. One push per batch:
//   one friend, one thing   → "Sam wrote a letter in The Bear."
//   one friend, two things  → "Sam wrote a letter in The Bear and messaged Sunday Crew."
//   one friend, 3+ things   → "Sam left you a few things on Sidebar."
//   two or more friends     → "Sam and 2 other friends left you some things on Sidebar."
//                             (the friend with the most things named; ties → the latest)
// A run of chat messages in one group is ONE thing. Never a letter's words.
// ============================================================

export const SIDEBAR_USER_ID = "00000000-0000-4000-8000-000000000001";

export type ActKind = "letter" | "journal" | "response" | "note" | "chat" | "pitch" | "answer" | "guide";
export type Act = {
  kind: ActKind;
  friendId: string;
  at: string;          // when it happened (the latest message, for a chat run)
  key: string;         // what makes two rows the same thing
  url: string;         // where a tap lands when this is the push's only thing
  show?: string;       // the show's title
  groupName?: string | null; // a watch group's own name (chat, pitches)
  answer?: "in" | "out" | "seen";
  yours?: boolean;     // a response/note on YOUR letter
  onResponse?: boolean; // a note on your response
};

// ── Gating, mirrored from send-digests (src/lib/utils.ts is the source) ──
const STAND_ALONE_TYPES = ["reality", "talk show", "documentary", "game show", "news", "sports", "variety", "award show", "panel show"];
function standAloneShow(sh: any): boolean {
  if (typeof sh?.stand_alone === "boolean") return sh.stand_alone;
  const t = String(sh?.tvmaze_type ?? "").trim().toLowerCase();
  return !!t && STAND_ALONE_TYPES.includes(t);
}
type Eff = { s: number; e: number };
function effectiveProgress(p: any): Eff {
  if (p.is_rewatching && p.highest_season != null && p.highest_episode != null) return { s: p.highest_season, e: p.highest_episode };
  return { s: p.season ?? 0, e: p.episode ?? 0 };
}
function canView(season: number, episode: number, eff: Eff): boolean {
  return season < eff.s || (season === eff.s && episode <= eff.e);
}
type Places = Map<string, Map<number, number>>;
async function loadPlaces(admin: any, userIds: string[], showIds: string[]): Promise<Places> {
  const out: Places = new Map();
  if (!userIds.length || !showIds.length) return out;
  const { data } = await admin.from("progress_seasons").select("user_id, show_id, season, episode").in("user_id", userIds).in("show_id", showIds);
  for (const r of (data ?? []) as any[]) {
    const k = `${r.user_id}|${r.show_id}`;
    if (!out.has(k)) out.set(k, new Map());
    out.get(k)!.set(Number(r.season), Number(r.episode));
  }
  return out;
}
function canSeeInSeason(places: Places, userId: string, showId: string, p: any, season: number, episode: number): boolean {
  if (season <= 0) return true;
  const remembered = places.get(`${userId}|${showId}`)?.get(season) ?? -1;
  const current = p && Number(p.season ?? 0) === season ? Number(p.episode ?? 0) : -1;
  return Math.max(remembered, current) >= episode;
}
function seenBefore(stamp: string | null | undefined, at: string | null | undefined): boolean {
  if (!stamp || !at) return false;
  return new Date(at).getTime() <= new Date(stamp).getTime();
}
const ms = (t: string) => new Date(t).getTime();
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const enc = encodeURIComponent;

/** Every recipient's acts since `since`, recipients limited to `recipients`
 *  (the people with a device on). Seed/demo and Sidebar's own acts dropped. */
export async function gatherActs(admin: any, since: string, recipients: Set<string>): Promise<Map<string, Act[]>> {
  const byUser = new Map<string, Map<string, Act>>();
  const add = (uid: string, act: Act) => {
    if (!recipients.has(uid) || uid === act.friendId) return;
    if (!byUser.has(uid)) byUser.set(uid, new Map());
    const m = byUser.get(uid)!;
    const k = `${act.kind}|${act.friendId}|${act.key}`;
    const cur = m.get(k);
    if (!cur || ms(act.at) > ms(cur.at)) m.set(k, act);
  };
  const recipientIds = [...recipients];
  if (!recipientIds.length) return new Map();

  // ── Rooms: letters, handed-over journals, responses, notes ──────────────
  const [{ data: links }, { data: replyRows }, { data: hlRows }] = await Promise.all([
    admin.from("group_threads").select("group_id, thread_id, shared_at, journal_kind, threads(id, author_id, season, episode, is_deleted, is_public)").gte("shared_at", since),
    admin.from("replies").select("id, thread_id, group_id, author_id, season, episode, created_at, is_deleted").gte("created_at", since),
    admin.from("highlights").select("id, target_type, target_id, group_id, author_id, kind, author_season, author_episode, created_at").gte("created_at", since),
  ]);
  const recentLinks = ((links ?? []) as any[]).filter((l) => l.threads && !l.threads.is_deleted && l.threads.is_public === false);
  const recentReplies = ((replyRows ?? []) as any[]).filter((r) => r.group_id && !r.is_deleted);
  const recentNotes = ((hlRows ?? []) as any[]).filter((h) => h.group_id && h.kind === "note");

  // The letters responses and notes hang under, and who is part of each.
  const replyTargetIds = recentNotes.filter((h) => h.target_type === "reply").map((h) => h.target_id as string);
  const replyById = new Map<string, any>();
  if (replyTargetIds.length) {
    const { data } = await admin.from("replies").select("id, thread_id, author_id, is_deleted").in("id", replyTargetIds);
    for (const r of (data ?? []) as any[]) if (!r.is_deleted) replyById.set(r.id, r);
  }
  const noteTarget = new Map<string, { threadId: string; onResponse: boolean; responseAuthorId: string | null }>();
  for (const h of recentNotes) {
    if (h.target_type === "thread") { noteTarget.set(h.id, { threadId: h.target_id, onResponse: false, responseAuthorId: null }); continue; }
    const r = replyById.get(h.target_id);
    if (r) noteTarget.set(h.id, { threadId: r.thread_id, onResponse: true, responseAuthorId: r.author_id });
  }
  const sideThreadIds = uniq([...recentReplies.map((r) => r.thread_id as string), ...[...noteTarget.values()].map((x) => x.threadId)]);
  const threadById = new Map<string, any>();
  const partsByThread = new Map<string, Set<string>>();
  if (sideThreadIds.length) {
    const [{ data: tRows }, { data: pRows }, { data: nRows }] = await Promise.all([
      admin.from("threads").select("id, author_id, is_deleted, is_public").in("id", sideThreadIds),
      admin.from("replies").select("thread_id, author_id, group_id, is_deleted").in("thread_id", sideThreadIds),
      admin.from("highlights").select("target_id, author_id").eq("target_type", "thread").eq("kind", "note").in("target_id", sideThreadIds),
    ]);
    for (const th of (tRows ?? []) as any[]) if (!th.is_deleted && th.is_public === false) { threadById.set(th.id, th); partsByThread.set(th.id, new Set([th.author_id])); }
    for (const pr of (pRows ?? []) as any[]) if (pr.group_id && !pr.is_deleted) partsByThread.get(pr.thread_id)?.add(pr.author_id);
    for (const n of (nRows ?? []) as any[]) partsByThread.get(n.target_id)?.add(n.author_id);
  }

  const roomIds = uniq([...recentLinks.map((l) => l.group_id as string), ...recentReplies.map((r) => r.group_id as string), ...recentNotes.map((h) => h.group_id as string)]);
  const rooms = new Map<string, { showId: string }>();
  const roster = new Map<string, any[]>();
  const showById = new Map<string, any>();
  if (roomIds.length) {
    const { data: g } = await admin.from("friend_groups").select("id, show_id, deleted_at").in("id", roomIds);
    for (const r of (g ?? []) as any[]) if (!r.deleted_at) rooms.set(r.id, { showId: r.show_id });
    const liveIds = [...rooms.keys()];
    if (liveIds.length) {
      const { data: mem } = await admin.from("friend_group_members").select("group_id, user_id, last_seen_at").in("group_id", liveIds).in("user_id", recipientIds);
      for (const m of (mem ?? []) as any[]) {
        if (!roster.has(m.group_id)) roster.set(m.group_id, []);
        roster.get(m.group_id)!.push(m);
      }
    }
  }

  // ── Watch groups: chat, pitches, answers ─────────────────────────────────
  const [{ data: chatRows }, { data: voteRows }, { data: passRows }] = await Promise.all([
    admin.from("group_messages").select("group_id, author_id, created_at").gte("created_at", since),
    admin.from("group_show_votes").select("group_id, show_id, user_id, created_at").gte("created_at", since),
    admin.from("group_show_passes").select("group_id, show_id, user_id, kind, created_at").gte("created_at", since),
  ]);
  const recentChats = (chatRows ?? []) as any[];
  const recentVotes = (voteRows ?? []) as any[];
  const recentPasses = ((passRows ?? []) as any[]).filter((p) => p.kind === "out" || p.kind === "seen");
  // Each pitched pair's pitcher = its earliest vote ever.
  const pairs = uniq([...recentVotes, ...recentPasses].map((v) => `${v.group_id}|${v.show_id}`));
  const pitchOf = new Map<string, { userId: string; at: string }>();
  if (pairs.length) {
    const { data: allVotes } = await admin.from("group_show_votes").select("group_id, show_id, user_id, created_at")
      .in("group_id", uniq(pairs.map((p) => p.split("|")[0]))).in("show_id", uniq(pairs.map((p) => p.split("|")[1])));
    for (const v of (allVotes ?? []) as any[]) {
      const k = `${v.group_id}|${v.show_id}`;
      const cur = pitchOf.get(k);
      if (!cur || ms(v.created_at) < ms(cur.at)) pitchOf.set(k, { userId: v.user_id, at: v.created_at });
    }
  }
  const pgIds = uniq([...recentChats.map((c) => c.group_id as string), ...pairs.map((p) => p.split("|")[0])]);
  const pgName = new Map<string, string | null>();
  const pgMembers = new Map<string, { userId: string; chat: string | null; pitches: string | null }[]>();
  if (pgIds.length) {
    const [{ data: pgs }, { data: pgm }] = await Promise.all([
      admin.from("people_groups").select("id, name").in("id", pgIds),
      admin.from("people_group_members").select("group_id, user_id, chat_last_seen_at, pitches_last_seen_at").in("group_id", pgIds),
    ]);
    for (const g of (pgs ?? []) as any[]) pgName.set(g.id, g.name ?? null);
    for (const m of (pgm ?? []) as any[]) {
      if (!pgMembers.has(m.group_id)) pgMembers.set(m.group_id, []);
      pgMembers.get(m.group_id)!.push({ userId: m.user_id, chat: m.chat_last_seen_at ?? null, pitches: m.pitches_last_seen_at ?? null });
    }
  }

  // ── Guide letters ────────────────────────────────────────────────────────
  const { data: guideRows } = await admin.from("guide_letters")
    .select("user_id, show_id, season, episode, from_season, from_episode, created_at").is("deleted_at", null).gte("created_at", since);
  const guides = (guideRows ?? []) as any[];
  const friendsOf = new Map<string, Set<string>>();
  if (guides.length) {
    const writerIds = uniq(guides.map((l) => l.user_id as string));
    const { data: wm } = await admin.from("people_group_members").select("group_id").in("user_id", writerIds);
    const wgIds = uniq(((wm ?? []) as any[]).map((m) => m.group_id as string));
    if (wgIds.length) {
      const [{ data: gRows }, { data: mRows }] = await Promise.all([
        admin.from("people_groups").select("id, deleted_at").in("id", wgIds),
        admin.from("people_group_members").select("group_id, user_id").in("group_id", wgIds),
      ]);
      const live = new Set(((gRows ?? []) as any[]).filter((g) => !g.deleted_at).map((g) => g.id as string));
      const byGroup = new Map<string, string[]>();
      for (const m of (mRows ?? []) as any[]) if (live.has(m.group_id)) { if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, []); byGroup.get(m.group_id)!.push(m.user_id); }
      for (const members of byGroup.values()) for (const w of members) if (writerIds.includes(w)) for (const r of members) if (r !== w) {
        if (!friendsOf.has(w)) friendsOf.set(w, new Set());
        friendsOf.get(w)!.add(r);
      }
    }
  }

  // ── Shows, progress and places for the gates ─────────────────────────────
  const showIds = uniq([
    ...[...rooms.values()].map((r) => r.showId),
    ...pairs.map((p) => p.split("|")[1]),
    ...guides.map((l) => l.show_id as string),
  ]).filter(Boolean);
  if (showIds.length) {
    const { data } = await admin.from("shows").select("id, name, stand_alone, tvmaze_type").in("id", showIds);
    for (const s of (data ?? []) as any[]) showById.set(s.id, s);
  }
  const showName = (id: string) => String(showById.get(id)?.name ?? "a show");
  const saShowIds = showIds.filter((id) => standAloneShow(showById.get(id)));
  const progIndex = new Map<string, any>();
  {
    const { data } = await admin.from("progress").select("user_id, show_id, season, episode, is_rewatching, highest_season, highest_episode").in("user_id", recipientIds);
    for (const p of (data ?? []) as any[]) progIndex.set(`${p.user_id}|${p.show_id}`, p);
  }
  const places = await loadPlaces(admin, recipientIds, saShowIds);
  const readable = (userId: string, showId: string, prog: any, season: number, episode: number): boolean =>
    standAloneShow(showById.get(showId))
      ? canSeeInSeason(places, userId, showId, prog, season, episode)
      : canView(season, episode, prog ? effectiveProgress(prog) : { s: 0, e: 0 });

  // Letters and handed-over journals.
  for (const l of recentLinks) {
    const room = rooms.get(l.group_id);
    const t = l.threads;
    if (!room || t.author_id === SIDEBAR_USER_ID) continue;
    for (const m of roster.get(l.group_id) ?? []) {
      if (seenBefore(m.last_seen_at, l.shared_at)) continue;
      const prog = progIndex.get(`${m.user_id}|${room.showId}`);
      if (!prog) continue;
      if (l.journal_kind === "handover") {
        add(m.user_id, { kind: "journal", friendId: t.author_id, at: l.shared_at, key: l.group_id, url: `/show-room/${enc(l.group_id)}`, show: showName(room.showId) });
        continue;
      }
      if (!readable(m.user_id, room.showId, prog, t.season, t.episode)) continue;
      add(m.user_id, { kind: "letter", friendId: t.author_id, at: l.shared_at, key: t.id, url: `/show-room/${enc(l.group_id)}?entry=${enc(t.id)}`, show: showName(room.showId) });
    }
  }
  // Responses on letters you're part of.
  for (const rr of recentReplies) {
    const room = rooms.get(rr.group_id);
    const th = threadById.get(rr.thread_id);
    if (!room || !th) continue;
    const parts = partsByThread.get(rr.thread_id);
    for (const m of roster.get(rr.group_id) ?? []) {
      if (!parts?.has(m.user_id)) continue;
      if (seenBefore(m.last_seen_at, rr.created_at)) continue;
      const prog = progIndex.get(`${m.user_id}|${room.showId}`);
      if (!prog || !readable(m.user_id, room.showId, prog, rr.season, rr.episode)) continue;
      add(m.user_id, { kind: "response", friendId: rr.author_id, at: rr.created_at, key: rr.thread_id, url: `/show-room/${enc(rr.group_id)}?entry=${enc(th.id)}`, show: showName(room.showId), yours: th.author_id === m.user_id });
    }
  }
  // Notes on your writing, or on a letter you're part of.
  for (const h of recentNotes) {
    const room = rooms.get(h.group_id);
    const tgt = noteTarget.get(h.id);
    const th = tgt ? threadById.get(tgt.threadId) : null;
    if (!room || !tgt || !th) continue;
    const parts = partsByThread.get(tgt.threadId);
    for (const m of roster.get(h.group_id) ?? []) {
      const mine = tgt.onResponse ? tgt.responseAuthorId === m.user_id : !!parts?.has(m.user_id);
      if (!mine) continue;
      if (seenBefore(m.last_seen_at, h.created_at)) continue;
      const prog = progIndex.get(`${m.user_id}|${room.showId}`);
      if (!prog || !readable(m.user_id, room.showId, prog, h.author_season ?? 0, h.author_episode ?? 0)) continue;
      add(m.user_id, { kind: "note", friendId: h.author_id, at: h.created_at, key: `${th.id}|${tgt.onResponse ? "r" : "t"}`, url: `/show-room/${enc(h.group_id)}?entry=${enc(th.id)}`, show: showName(room.showId), yours: th.author_id === m.user_id, onResponse: tgt.onResponse });
    }
  }
  // Chat: one thing per (friend, group), however many messages.
  for (const c of recentChats) {
    for (const m of pgMembers.get(c.group_id) ?? []) {
      if (seenBefore(m.chat, c.created_at)) continue;
      add(m.userId, { kind: "chat", friendId: c.author_id, at: c.created_at, key: c.group_id, url: `/dashboard?g=${enc(c.group_id)}&chat=1`, groupName: pgName.get(c.group_id) ?? null });
    }
  }
  // Pitches (a pair's first vote, inside the window) and answers to yours.
  for (const pair of pairs) {
    const [gid, sid] = pair.split("|");
    const p = pitchOf.get(pair);
    if (!p) continue;
    const members = pgMembers.get(gid) ?? [];
    if (ms(p.at) >= ms(since)) {
      for (const m of members) {
        if (seenBefore(m.pitches, p.at)) continue;
        add(m.userId, { kind: "pitch", friendId: p.userId, at: p.at, key: pair, url: `/dashboard?g=${enc(gid)}`, show: showName(sid), groupName: pgName.get(gid) ?? null });
      }
    }
    const pitcher = members.find((m) => m.userId === p.userId);
    if (!pitcher) continue;
    const answersHere = [
      ...recentVotes.filter((v) => `${v.group_id}|${v.show_id}` === pair && v.user_id !== p.userId).map((v) => ({ by: v.user_id as string, at: v.created_at as string, kind: "in" as const })),
      ...recentPasses.filter((v) => `${v.group_id}|${v.show_id}` === pair && v.user_id !== p.userId).map((v) => ({ by: v.user_id as string, at: v.created_at as string, kind: v.kind as "out" | "seen" })),
    ];
    for (const a of answersHere) {
      if (seenBefore(pitcher.pitches, a.at)) continue;
      add(p.userId, { kind: "answer", friendId: a.by, at: a.at, key: pair, url: `/dashboard?g=${enc(gid)}`, show: showName(sid), answer: a.kind });
    }
  }
  // Guide letters, only when open to you.
  if (guides.length) {
    const gShowIds = uniq(guides.map((l) => l.show_id as string));
    const [{ data: viewRows }, { data: holdRows }] = await Promise.all([
      admin.from("guide_letter_views").select("user_id, show_id, season, episode, seen_at").in("user_id", recipientIds).in("show_id", gShowIds),
      admin.from("guide_letter_holds").select("user_id, show_id, seen_at, not_for_me").in("user_id", recipientIds).in("show_id", gShowIds),
    ]);
    const views = new Map<string, string>(((viewRows ?? []) as any[]).map((v) => [`${v.user_id}|${v.show_id}|${v.season}|${v.episode}`, v.seen_at]));
    const holds = new Map<string, any>(((holdRows ?? []) as any[]).map((h) => [`${h.user_id}|${h.show_id}`, h]));
    for (const l of guides) {
      const fromS = Number(l.from_season ?? l.season), fromE = Number(l.from_episode ?? l.episode);
      for (const r of friendsOf.get(l.user_id) ?? []) {
        if (!recipients.has(r)) continue;
        const h = holds.get(`${r}|${l.show_id}`);
        if (h?.not_for_me) continue;
        if (h?.seen_at && ms(h.seen_at) >= ms(l.created_at)) continue;
        const p = progIndex.get(`${r}|${l.show_id}`);
        const eff = p ? effectiveProgress(p) : { s: 0, e: 0 };
        if (eff.s === 0 && !standAloneShow(showById.get(l.show_id))) continue;
        const open = standAloneShow(showById.get(l.show_id)) ? canSeeInSeason(places, r, l.show_id, p, fromS, fromE) : (eff.s > fromS || (eff.s === fromS && eff.e >= fromE));
        if (!open) continue;
        const seen = views.get(`${r}|${l.show_id}|${l.season}|${l.episode}`);
        if (seen && ms(seen) >= ms(l.created_at)) continue;
        add(r, { kind: "guide", friendId: l.user_id, at: l.created_at, key: `${l.show_id}|${l.season}|${l.episode}`, url: "/dashboard", show: showName(l.show_id) });
      }
    }
  }

  // Seed/demo friends never push; neither do Sidebar's own acts.
  const actorIds = uniq([...byUser.values()].flatMap((m) => [...m.values()].map((a) => a.friendId)));
  const seeds = new Set<string>([SIDEBAR_USER_ID]);
  if (actorIds.length) {
    const { data } = await admin.from("profiles").select("id, is_seed").in("id", actorIds);
    for (const p of (data ?? []) as any[]) if (p.is_seed) seeds.add(p.id);
  }
  const out = new Map<string, Act[]>();
  for (const [uid, m] of byUser) {
    const list = [...m.values()].filter((a) => !seeds.has(a.friendId)).sort((a, b) => ms(a.at) - ms(b.at));
    if (list.length) out.set(uid, list);
  }
  return out;
}

const ANSWER_WORDS = { in: "I’m in", seen: "seen it", out: "sitting this out" } as const;

/** One thing, said without its subject: "wrote a letter in The Bear". */
export function phrase(a: Act): string {
  switch (a.kind) {
    case "letter": return `wrote a letter in ${a.show}`;
    case "journal": return `opened their journal to you in ${a.show}`;
    case "response": return a.yours ? `responded to your letter in ${a.show}` : `responded to a letter in ${a.show}`;
    case "note": return a.onResponse ? `left a note on your response in ${a.show}` : a.yours ? `left a note on your letter in ${a.show}` : `left a note on a letter in ${a.show}`;
    case "chat": return a.groupName ? `messaged ${a.groupName}` : "messaged your group";
    case "pitch": return `pitched ${a.show} to ${a.groupName ?? "your group"}`;
    case "answer": return `answered your ${a.show} pitch: ${ANSWER_WORDS[a.answer ?? "in"]}`;
    case "guide": return `wrote about ${a.show} in the show guide`;
  }
}

/** His wording for one batch (see the header). Null when there's nothing. */
export function composePush(acts: Act[], nameOf: (id: string) => string): { body: string; url: string } | null {
  if (!acts.length) return null;
  const byFriend = new Map<string, Act[]>();
  for (const a of acts) {
    if (!byFriend.has(a.friendId)) byFriend.set(a.friendId, []);
    byFriend.get(a.friendId)!.push(a);
  }
  const latest = (xs: Act[]) => Math.max(...xs.map((x) => ms(x.at)));
  if (byFriend.size >= 2) {
    const [top] = [...byFriend.entries()].sort((a, b) => b[1].length - a[1].length || latest(b[1]) - latest(a[1]));
    const n = byFriend.size - 1;
    return { body: `${nameOf(top[0])} and ${n} other friend${n === 1 ? "" : "s"} left you some things on Sidebar.`, url: "/dashboard" };
  }
  const [[friendId, list]] = [...byFriend.entries()];
  const name = nameOf(friendId);
  if (list.length >= 3) return { body: `${name} left you a few things on Sidebar.`, url: "/dashboard" };
  if (list.length === 1) return { body: `${name} ${phrase(list[0])}.`, url: list[0].url };
  // Two things, in the order they happened; an answer goes last so its
  // colon ends the sentence.
  let [a, b] = [...list].sort((x, y) => ms(x.at) - ms(y.at));
  if (a.kind === "answer" && b.kind !== "answer") [a, b] = [b, a];
  const pa = phrase(a), pb = phrase(b);
  if (pa === pb) {
    return { body: a.kind === "letter" ? `${name} wrote two letters in ${a.show}.` : `${name} ${pa} twice.`, url: "/dashboard" };
  }
  return { body: `${name} ${pa} and ${pb}.`, url: "/dashboard" };
}
