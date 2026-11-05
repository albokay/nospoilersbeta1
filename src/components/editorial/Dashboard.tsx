/**
 * Dashboard.tsx — the editorial dashboard's pieces (checkpoint 2, 2026-10-12;
 * the E3Dash / D3Dash boards). Rendered under the editorial skin only, by
 * MobileDashboard and DashboardPage; the classic dashboards are untouched.
 *
 *   EditorialGroups  THE NESTED SHELF (his design, 11-04, canvas VteijWE4Ae51YCisqG8KWf
 *                    board Thin; replaces the two shelves of 11-03): "Groups"
 *                    on a rule with the + beside the tab, then one CLUSTER per
 *                    group — a thin one-line group row (the members' initials,
 *                    the group's name, the blue dot when something new waits
 *                    in the group room, the accent edge for its settings) with
 *                    the group's live rooms indented under it in a hairline
 *                    box (the show, "with Adam, Lena" on the show line — or
 *                    "w/ 3 friends" when the names would cut the title — the
 *                    news under, the envelope at the end), three rooms then
 *                    "N more rooms →". Clusters order by whatever moved last,
 *                    group or room; the dividers start at the tab's left edge
 *                    and run off the right (an open left edge). The drag grip
 *                    is retired. An invite row with the inviter's line in red
 *                    and Join still closes the shelf.
 *                    The envelope follows the live rule exactly (open = new
 *                    writing you can read or new chat; sealed = only writing
 *                    ahead of you); the line names the room through one
 *                    query for every group's rooms.
 *   dashboardNote    the paper note's one sentence from the same signals,
 *                    in the bible's priority: a readable letter, a sealed
 *                    one, chat. Null when nothing waits.
 *   PaperNote        the note: cream, ink frame, accent bar, tilted 3°; swipe
 *                    right to dismiss on the phone (it slides over an accent
 *                    block with a cream ×), × on hover on desktop; dismissed
 *                    per account, back when something newer arrives.
 *   DrawerTab        the docked "How I watch TV" tab at the foot.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, SquarePen } from "lucide-react";
import { E } from "../../styles/editorial";
import LetterDisc from "../LetterDisc";
import { SectionHead } from "./Chrome";
import { useRowSwipe, RowPoster, TallyLine } from "./GroupRoom";
import { tallyFor, tallySplit, type PassKind, type Tally } from "../../lib/proposalAnswers";
import {
  fetchShows, fetchShowRoomsForGroups, fetchMyStances, fetchAllGroupAnswers, fetchGroupDashboard, fetchRoomDnfMap, fetchRoomMemberIds, roomHasNewActivity, roomHasNewInvisibleActivity, chatHasNewActivity, pitchHasNewActivity,
  type RoomVisibility, type GroupChatActivity, type GroupPitchActivity, type PendingGroupInvite, type Show, type ShowRoomOfGroup, type MyStances, type GroupShowPass, type GroupDashboardShow,
} from "../../lib/db";
import { groupDisplayName, joinNames, personDisplayName, pendingInviteMemberNames, pendingInviterLabel } from "../../lib/groupNames";
import { linearIndex } from "../../lib/groupPills";
import { homeScreenTabInset } from "../../lib/installPrompt";
import { atShowEnd, offSeason, roadOthers, seasonalFor, summarizeGap } from "../../lib/letters";
import type { PeopleGroup, PeopleGroupMember, GroupShowVote } from "../../types";

export type DashboardGroup = { group: PeopleGroup; members: PeopleGroupMember[]; pendingInvites: { name: string }[] };

type GroupLine = { line: string; /** Something new in the group room (a pitch, an answer to yours, chat): the identity dot. */ dot?: boolean; /** The line's tail drawn in alert red ("pitch a new show" — his note, 11-03). */ redTail?: string };

/** "Sam pitched The Sopranos" — the newest pitch by someone else in a group,
 *  when the viewer hasn't seen it (Alborz's notes, round 3). */
export function pitchSentence(g: DashboardGroup, a: GroupPitchActivity | undefined, contactNames: Record<string, string>): { text: string; at: number } | null {
  if (!a || !pitchHasNewActivity(a)) return null;
  const m = g.members.find((x) => x.userId === a.latestPitchUserId);
  const who = m ? personDisplayName(contactNames, m.userId, m.username, m.displayName) : "A friend";
  return { text: `${who} pitched ${a.latestPitchShowName ?? "a show"}`, at: a.latestPitchAt ?? 0 };
}

/** THE ROOM ROWS (two shelves, his yes 11-03; nested under their group since
 *  11-04): every room the viewer is in with two or more people, across all
 *  their groups, newest activity first — a letter, a note, a progress move,
 *  else the room's creation. A row opens its room; its line is what's new
 *  (new letters · a sealed letter · you're N behind / ahead of the nearest
 *  friend), and the envelope sits at the end. Rooms of one, rooms you left
 *  or cleared, and finished or parked rooms with nothing unread stay off
 *  it. Group rows always open the group room, so the two can't disagree. */
export type RoomShelfRow = { roomId: string; showId: string; groupId: string; show: string; group: string; reason: string; envelope: "open" | "sealed" | null; at: number; /** The friends in the room, by first name (the row's "with Adam, Lena"; initials until 11-04). */ people: string[]; /** The row's 40×56 thumbnail (2026-11-05). */ tvmazeId: string | null; /** The pitch tally (2026-11-05): who's out, has seen it, or hasn't answered — empty until the answers load. */ tally: Tally };
export function roomShelfRows(
  groups: DashboardGroup[], rooms: ShowRoomOfGroup[], roomVis: RoomVisibility[], roomMembers: Record<string, string[]>,
  brain: Map<string, GroupDashboardShow[]>, finished: Set<string>, stances: MyStances | null,
  showsById: Record<string, Show>, contactNames: Record<string, string>, groupNumberById: Record<string, number>, selfUserId: string,
  answers: { votes: GroupShowVote[]; passes: GroupShowPass[] } | null,
): RoomShelfRow[] {
  const out: RoomShelfRow[] = [];
  for (const r of rooms) {
    const g = groups.find((x) => x.group.id === r.groupId);
    if (!g) continue;
    const mem = roomMembers[r.roomId];
    if (!mem || mem.length < 2) continue;
    if (stances?.departedRooms.has(r.roomId) || stances?.cleared.has(`${r.groupId}:${r.showId}`)) continue;
    const b = brain.get(r.groupId)?.find((x) => x.showId === r.showId);
    if (b && (!b.inRoom || b.viewerLeft || b.viewerDismissed)) continue;
    const v = roomVis.find((x) => x.groupId === r.roomId);
    const fresh = !!v && roomHasNewActivity(v);
    const sealed = !!v && roomHasNewInvisibleActivity(v);
    if (finished.has(r.roomId) && !fresh && !sealed) continue;
    // The line is the gap to the nearest friend (his yes, 11-03), the
    // letters-in-transit arithmetic the group room uses. The envelope's words
    // ("new letters" / "a sealed letter") are gone (2026-11-05): they said
    // exactly what the envelope says, and hid the gap.
    let reason = "";
    if (b) {
      const seasons = showsById[r.showId]?.seasons;
      const members = b.members.filter((m) => m.s != null && m.e != null && mem.includes(m.userId)).map((m) => ({ userId: m.userId, s: m.s as number, e: m.e as number }));
      const self = members.find((m) => m.userId === selfUserId);
      const seasonal = seasonalFor(r.showId, self);
      const gap = summarizeGap(self ? linearIndex(self.s, self.e, seasons) : 0, roadOthers(members, selfUserId, seasons, seasonal), offSeason(members, selfUserId, seasonal));
      if (gap.nearestAhead) reason = `you\u2019re ${gap.nearestAhead.gap} behind`;
      // Finished (his note, 11-04): at the show's end the row says so, not "N ahead".
      else if (gap.nearestBehind) reason = self && atShowEnd(self.s, self.e, seasons) ? "you\u2019re finished" : `you\u2019re ${gap.nearestBehind.gap} ahead`;
    }
    const others = g.members.filter((m) => m.userId !== selfUserId);
    const group = groupDisplayName(g.group, others, contactNames, g.pendingInvites.map((pi) => pi.name || "a friend"), groupNumberById[g.group.id]);
    const people = others.filter((m) => mem.includes(m.userId)).map((m) => personDisplayName(contactNames, m.userId, m.username, m.displayName));
    // The pitch tally (2026-11-05): everyone in the room is "in" (a vote or the
    // room's own member list), the passes from the all-groups read, the rest
    // of the group hasn't answered. Empty until the answers have loaded, so
    // nobody reads as "?" for a moment they'd already answered.
    const passesHere: Record<string, PassKind> = {};
    for (const p of answers?.passes ?? []) if (p.groupId === r.groupId && p.showId === r.showId) passesHere[p.userId] = p.kind;
    const inIds = [...new Set([...mem, ...(answers?.votes ?? []).filter((v) => v.groupId === r.groupId && v.showId === r.showId).map((v) => v.userId)])];
    const tally = tallyFor({
      memberIds: answers ? g.members.map((m) => m.userId) : [],
      selfId: selfUserId, inIds, passes: passesHere,
      name: (id) => { const m = g.members.find((x) => x.userId === id); return m ? personDisplayName(contactNames, m.userId, m.username, m.displayName) : "someone"; },
    });
    out.push({
      roomId: r.roomId, showId: r.showId, groupId: r.groupId,
      show: showsById[r.showId]?.name ?? "A show", group, reason, people, tally,
      tvmazeId: showsById[r.showId]?.tvmazeId ?? null,
      envelope: fresh ? "open" : sealed ? "sealed" : null,
      at: Math.max(v?.latestVisibleActivityAt ?? 0, v?.latestInvisibleActivityAt ?? 0, b?.lastActivityAt ?? 0, r.createdAt),
    });
  }
  return out.sort((x, y) => y.at - x.at);
}

/** A friend's answer to one of the viewer's OWN pitches (in, sitting this
 *  out, seen it) newer than the viewer's pitches-seen stamp — the group
 *  room's own fresh-answer rule (useFreshPitches), read for every group at
 *  once. Per group, the newest such answer. */
export type PitchAnswer = { showId: string; userId: string; at: number };
/** Rooms finished together (every CURRENT member of the room at the show's
 *  end — the group room's own rule, with the room's real member list: a
 *  finished room's votes are gone, so the vote flag can't stand in for
 *  membership — his Bear/Paradise catch, 11-03) or parked. */
export function finishedRoomsFrom(brain: Map<string, GroupDashboardShow[]>, showsById: Record<string, Show>, dnf: Record<string, number>, roomMembers: Record<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const rows of brain.values()) {
    for (const gs of rows) {
      if (!gs.roomId) continue;
      if (dnf[gs.roomId]) { out.add(gs.roomId); continue; }
      const memberIds = roomMembers[gs.roomId];
      const seasons = showsById[gs.showId]?.seasons;
      if (!memberIds?.length || !seasons?.length) continue;
      const ls = seasons.length, le = seasons[ls - 1] ?? 1;
      const all = memberIds.every((uid) => {
        const m = gs.members.find((mm) => mm.userId === uid);
        return !!m && ((m.s ?? 0) > ls || ((m.s ?? 0) === ls && (m.e ?? 0) >= le));
      });
      if (all) out.add(gs.roomId);
    }
  }
  return out;
}

export function answersToMyPitches(
  groupIds: string[], votes: GroupShowVote[], passes: GroupShowPass[], pitchActivity: GroupPitchActivity[], selfUserId: string,
): Map<string, PitchAnswer> {
  const out = new Map<string, PitchAnswer>();
  for (const gid of groupIds) {
    const seen = pitchActivity.find((a) => a.groupId === gid)?.pitchesLastSeenAt ?? null;
    const earliest = new Map<string, { userId: string; at: number }>();
    for (const v of votes) {
      if (v.groupId !== gid) continue;
      const cur = earliest.get(v.showId);
      if (!cur || v.createdAt < cur.at) earliest.set(v.showId, { userId: v.userId, at: v.createdAt });
    }
    let newest: PitchAnswer | null = null;
    const consider = (showId: string, userId: string, at: number | null) => {
      if (at == null || userId === selfUserId || earliest.get(showId)?.userId !== selfUserId) return;
      if (seen != null && at <= seen) return;
      if (!newest || at > newest.at) newest = { showId, userId, at };
    };
    for (const v of votes) if (v.groupId === gid) consider(v.showId, v.userId, v.createdAt);
    for (const p of passes) if (p.groupId === gid) consider(p.showId, p.userId, p.createdAt);
    if (newest) out.set(gid, newest);
  }
  return out;
}

/** A friend's latest pitch the viewer hasn't answered: no yes, no pass, not
 *  cleared, and not a room they LEFT (leaving is an answer — his Ted Lasso
 *  catch, 11-02); answers unknown yet count as none. */
export function pitchUnanswered(gid: string, p: GroupPitchActivity, rooms: ShowRoomOfGroup[], stances: MyStances | null, selfUserId: string, brainRow?: GroupDashboardShow): boolean {
  if (!p.latestPitchShowId || !p.latestPitchUserId || p.latestPitchUserId === selfUserId) return false;
  // The group room's own row knows a left, cleared or joined show (the rooms table hides a room you left from you).
  if (brainRow && (brainRow.inRoom || brainRow.viewerLeft || brainRow.viewerDismissed)) return false;
  if (!stances) return true;
  if (stances.answered.has(`${gid}:${p.latestPitchShowId}`)) return false;
  return !rooms.some((r) => r.groupId === gid && r.showId === p.latestPitchShowId && stances.departedRooms.has(r.roomId));
}

function computeLines(
  groups: DashboardGroup[], chatActivity: GroupChatActivity[],
  rooms: ShowRoomOfGroup[], showsById: Record<string, Show>,
  pitches: GroupPitchActivity[] = [], contactNames: Record<string, string> = {},
  stances: MyStances | null = null, selfUserId = "", answers: Map<string, PitchAnswer> = new Map(),
  brain: Map<string, GroupDashboardShow[]> = new Map(), roomMembers: Record<string, string[]> = {},
): Record<string, GroupLine> {
  const chatNew = new Set(chatActivity.filter(chatHasNewActivity).map((a) => a.groupId));
  const out: Record<string, GroupLine> = {};
  for (const g of groups) {
    const gid = g.group.id;
    const chat = chatNew.has(gid);
    // A friend's new pitch (round 3): the dot.
    const pa = pitches.find((a) => a.groupId === gid);
    const pitch = pitchSentence(g, pa, contactNames);
    const roomCount = rooms.filter((r) => r.groupId === gid).length;
    // THE LINE (two shelves, his yes 11-03): a group row always opens the
    // group room, so it carries only the group room's reason — a friend's
    // pitch, an answer to yours, new in chat, "just you in X so far", "pitch
    // a new show" in red, "no shows yet" — and nothing when quiet. Letters
    // live on the rooms shelf now.
    const pulled = !!pa && !!pa.latestPitchShowId && pitchUnanswered(gid, pa, rooms, stances, selfUserId, brain.get(gid)?.find((b) => b.showId === pa.latestPitchShowId));
    let reason: string | null = null; let red = false;
    const ans = answers.get(gid);
    if (pulled && pa) {
      const m = g.members.find((x) => x.userId === pa.latestPitchUserId);
      const who = m ? personDisplayName(contactNames, m.userId, m.username, m.displayName) : "A friend";
      reason = `${who} pitched ${pa.latestPitchShowName ?? "a show"}`;
    } else if (ans) {
      // A friend answered your pitch (his ask, 11-03): the daily email's words.
      const m = g.members.find((x) => x.userId === ans.userId);
      const who = m ? personDisplayName(contactNames, m.userId, m.username, m.displayName) : "A friend";
      const show = showsById[ans.showId]?.name;
      reason = show ? `${who} answered your ${show} pitch` : `${who} answered your pitch`;
    } else if (chat) reason = "new in chat";
    else if (roomCount === 0) reason = "no shows yet";
    else {
      // A room of yours nobody has joined (his yes, 11-03): the newest one,
      // named — the show waits on a friend's "I'm in" in the group room.
      let solo: ShowRoomOfGroup | null = null;
      for (const r of rooms) {
        if (r.groupId !== gid) continue;
        const mem = roomMembers[r.roomId];
        if (!mem || mem.length !== 1 || mem[0] !== selfUserId) continue;
        if (stances?.cleared.has(`${gid}:${r.showId}`) || stances?.departedRooms.has(r.roomId)) continue;
        if (!solo || r.createdAt > solo.createdAt) solo = r;
      }
      const show = solo ? showsById[solo.showId]?.name : undefined;
      // Rooms exist but none of yours is left (you left or cleared them): his words, 11-02.
      if (show) reason = `just you in ${show} so far`;
      else if (roomCount > 0 && !rooms.some((r) => r.groupId === gid && (roomMembers[r.roomId]?.length ?? 0) >= 2 && !stances?.departedRooms.has(r.roomId) && !stances?.cleared.has(`${gid}:${r.showId}`))) { reason = "pitch a new show"; red = true; }
    }
    out[gid] = { line: reason ?? "", dot: !!pitch || answers.has(gid) || chat, redTail: red && reason ? reason : undefined };
  }
  return out;
}

/** The paper note's sentence, or null when nothing waits. `at` is the newest
 *  signal behind it, so a dismissal stays until something newer arrives. */
export function dashboardNote(
  groups: DashboardGroup[], nameOf: (groupId: string) => string,
  roomVis: RoomVisibility[], chatActivity: GroupChatActivity[],
  pitches: GroupPitchActivity[] = [], contactNames: Record<string, string> = {},
): { text: string; at: number } | null {
  const known = new Set(groups.map((g) => g.group.id));
  const readable = new Map<string, number>(), sealed = new Map<string, number>(), chat = new Map<string, number>();
  for (const v of roomVis) {
    if (!v.parentGroupId || !known.has(v.parentGroupId)) continue;
    if (roomHasNewActivity(v)) readable.set(v.parentGroupId, Math.max(readable.get(v.parentGroupId) ?? 0, v.latestVisibleActivityAt ?? 0));
    else if (roomHasNewInvisibleActivity(v)) sealed.set(v.parentGroupId, Math.max(sealed.get(v.parentGroupId) ?? 0, v.latestInvisibleActivityAt ?? 0));
  }
  for (const a of chatActivity) if (known.has(a.groupId) && chatHasNewActivity(a)) chat.set(a.groupId, a.latestMessageAt ?? 0);
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  const names = (rows: [string, number][]) => joinNames(rows.map(([g]) => nameOf(g)));
  const r = sorted(readable);
  if (r.length) return { text: r.length === 1 ? `A letter is waiting for you in ${nameOf(r[0][0])}.` : `Letters are waiting in ${names(r)}.`, at: r[0][1] };
  // A friend's new pitch (round 3): the newest one, named; several groups → their names.
  const p = groups.map((g) => ({ g, s: pitchSentence(g, pitches.find((a) => a.groupId === g.group.id), contactNames) })).filter((x) => x.s).sort((a, b) => b.s!.at - a.s!.at);
  if (p.length) return { text: p.length === 1 ? `${p[0].s!.text} to ${nameOf(p[0].g.group.id)}.` : `New pitches in ${joinNames(p.map((x) => nameOf(x.g.group.id)))}.`, at: p[0].s!.at };
  const s = sorted(sealed);
  if (s.length) return { text: s.length === 1 ? `A sealed letter is waiting for you in ${nameOf(s[0][0])}.` : `Sealed letters are waiting in ${names(s)}.`, at: s[0][1] };
  const c = sorted(chat);
  if (c.length) return { text: c.length === 1 ? `Something new in the ${nameOf(c[0][0])} chat.` : `New chat in ${names(c)}.`, at: c[0][1] };
  return null;
}

const rowBase: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 16, width: "100%", boxSizing: "border-box",
  padding: "18px 0", background: "transparent", border: 0, borderBottom: `1px solid ${E.color.hairline}`,
  color: E.color.ink, textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent",
  fontFamily: E.font.interface,
};
const textCol: React.CSSProperties = { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 };
const nameStyle: React.CSSProperties = { ...E.type.row17, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
// The row's second line (two shelves, 11-03): the reason in the muted mono, as on his boards.
const lineStyle: React.CSSProperties = { ...E.type.label11, letterSpacing: "0.04em", color: E.color.inkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function Avatar({ initial, first, pending = false }: { initial: string; first: boolean; pending?: boolean }) {
  return (
    <span style={{ width: 30, height: 30, boxSizing: "border-box", borderRadius: "50%", border: `1px ${pending ? "dashed" : "solid"} ${E.color.ink}`, background: E.color.cream, ...E.type.label11, letterSpacing: 0, color: E.color.ink, display: "inline-flex", alignItems: "center", justifyContent: "center", marginLeft: first ? 0 : -9, flexShrink: 0 }}>
      {(initial || "?").toUpperCase()}
    </span>
  );
}

/** The thin group row (his design, 11-04): ONE line — the members' initials,
 *  the group's name, the dot — with the accent edge at its end on the phone,
 *  where it swipes left over a friend-blue pane to the group's settings (a
 *  cream pen); on desktop a pen sits at the row's end (alert on its own
 *  hover). Its divider starts at the tab's left edge and runs off the right
 *  of the phone (an open left edge). No grip: the order is the activity's. */
const GROUP_ROW_PAD = 5;
function GroupRow({ desktop, onEnter, onOptions, children }: {
  desktop: boolean;
  onEnter: () => void;
  onOptions?: (rect?: DOMRect) => void;
  children: React.ReactNode;
}) {
  const swipe = useRowSwipe(!desktop && onOptions ? () => onOptions() : undefined);
  const gutter = E.space.gutter;
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEnter(); } };
  if (desktop) {
    return (
      <div className="e-row" role="button" tabIndex={0} onClick={onEnter} onKeyDown={onKey} style={{ ...rowBase, padding: `${GROUP_ROW_PAD}px 0`, position: "relative", background: E.color.cream, userSelect: "none" }}>
        {children}
        {onOptions && (
          <span className="e-pen" role="button" aria-label="Group settings" title="Group settings" onClick={(e) => { e.stopPropagation(); onOptions(e.currentTarget.getBoundingClientRect()); }} style={{ width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>
            <SquarePen size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" />
          </span>
        )}
      </div>
    );
  }
  return (
    // Nothing in the row is selectable and the long-press callout is off
    // (his catch, from the grip days): a held row never wakes iOS's text selection.
    <div style={{ position: "relative", overflow: "hidden", margin: `0 -${gutter}px 0 0`, borderBottom: `1px solid ${E.color.hairline}`, touchAction: "pan-y", background: E.color.cream, WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }} {...swipe.handlers}>
      {onOptions && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: E.color.friend, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 30 }}>
          <span role="button" aria-label="Group settings" onClick={() => onOptions()} style={{ display: "inline-flex", width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <SquarePen size={22} strokeWidth={1.8} color={E.color.cream} aria-hidden="true" />
          </span>
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!swipe.dragging && swipe.dx === 0) onEnter(); }} onKeyDown={onKey} style={{ ...rowBase, position: "relative", borderBottom: 0, padding: `${GROUP_ROW_PAD}px ${gutter}px ${GROUP_ROW_PAD}px 0`, background: E.color.cream, transform: `translateX(${swipe.dx}px)`, transition: swipe.dragging ? "none" : "transform 260ms ease" }}>
        {children}
        {/* The edge strip that says the row swipes (the show rows' hint) — accent, like theirs (his call); the pane behind stays friend blue. */}
        {onOptions && <span aria-hidden="true" style={{ position: "absolute", right: 0, top: 6, bottom: 6, width: 4, background: E.color.accent }} />}
      </div>
    </div>
  );
}

/** The show line of a room row: the show, then the friends in the room in
 *  the With line's mono ("with Adam, Lena, Mo"). Measured after it draws
 *  (his yes, 11-04): if the names would cut the title, the names give way
 *  to "w/ 3 friends" — and only then does the title truncate, so the count
 *  always fits. A resize, or a change of friends, measures again from the
 *  names. */
function RoomHead({ show, people }: { show: string; people: string[] }) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(false);
  const peopleKey = people.join("\u0000");
  useEffect(() => { setCount(false); }, [peopleKey]);
  useEffect(() => {
    const again = () => setCount(false);
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, []);
  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el || count || people.length === 0) return;
    if (el.scrollWidth > el.clientWidth + 1) setCount(true);
  });
  const names = people.length === 0 ? null : count ? `w/ ${people.length} friend${people.length === 1 ? "" : "s"}` : `with ${people.join(", ")}`;
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
      <span ref={nameRef} style={{ ...nameStyle, minWidth: 0, flexShrink: 1 }}>{show}</span>
      {names && <span style={{ ...E.type.label11, color: E.color.inkSub, whiteSpace: "nowrap", flexShrink: 0 }}>{names}</span>}
    </span>
  );
}

/** A room row inside its group's box: the 40×56 thumbnail (2026-11-05), the
 *  show with the friends on its line, the gap under in the With line's ink,
 *  the pitch tally's outstanding friends under that while the group is split
 *  (the poster absorbs the third line: the row stays 88), the envelope flush
 *  right (no pen — settings live in the room; the order is the activity's). */
function RoomRow({ desktop, row, last, onEnter }: { desktop: boolean; row: RoomShelfRow; last: boolean; onEnter: () => void }) {
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEnter(); } };
  const gutter = E.space.gutter;
  const split = tallySplit(row.tally);
  return (
    <div className={desktop ? "e-row" : undefined} role="button" tabIndex={0} onClick={onEnter} onKeyDown={onKey} style={{ ...rowBase, padding: desktop ? "16px 0 16px 24px" : `16px ${gutter}px 16px 24px`, borderBottom: last ? 0 : `1px solid ${E.color.hairline}`, background: E.color.cream }}>
      <RowPoster tvmazeId={row.tvmazeId} />
      <span style={{ ...textCol, gap: split ? 4 : 5 }}>
        <RoomHead show={row.show} people={row.people} />
        <span style={{ ...lineStyle, color: E.color.inkSub, minHeight: 13 }}>{row.reason}</span>
        {split && <TallyLine tally={row.tally} outstandingOnly />}
      </span>
      {row.envelope && <LetterDisc kind={row.envelope} className="m-dot-in" />}
    </div>
  );
}

/** A group's rooms, indented in a hairline box under its row (his sketch):
 *  the group row's divider is the box's top, the box's left rule sits a
 *  gutter in, its right edge is open on the phone. Three rooms, then "N more
 *  rooms →" into the group room. */
const ROOMS_SHOWN = 3;
function RoomsBox({ desktop, rows, onEnterRoom, onMore }: { desktop: boolean; rows: RoomShelfRow[]; onEnterRoom: (r: RoomShelfRow) => void; onMore: () => void }) {
  const gutter = E.space.gutter;
  const shown = rows.slice(0, ROOMS_SHOWN);
  const more = rows.length - shown.length;
  return (
    <div style={{ marginLeft: gutter, marginRight: desktop ? 0 : -gutter, borderLeft: `1px solid ${E.color.hairline}`, borderBottom: `1px solid ${E.color.hairline}`, background: E.color.cream }}>
      {shown.map((r, i) => <RoomRow key={r.roomId} desktop={desktop} row={r} last={i === shown.length - 1 && more === 0} onEnter={() => onEnterRoom(r)} />)}
      {more > 0 && (
        <button type="button" onClick={onMore} style={{ ...E.type.label11, color: E.color.inkMuted, display: "block", width: "100%", boxSizing: "border-box", textAlign: "left", padding: desktop ? "12px 0 13px 24px" : `12px ${gutter}px 13px 24px`, background: "transparent", border: 0, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          {more} more room{more === 1 ? "" : "s"} →
        </button>
      )}
    </div>
  );
}
/** The Groups shelf's +: a sky-blue disc with a cream plus, a 44px hit on the phone. */
function PlusDisc({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Start a new watch group" title="Start a new watch group" onClick={onClick} style={{ width: 44, height: 44, margin: "-8px 0 -8px -8px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: 0, padding: 0, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: "50%", background: E.color.friend, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <Plus size={18} strokeWidth={2.4} color={E.color.cream} />
      </span>
    </button>
  );
}

function GhostRow() {
  return (
    <div aria-hidden="true" style={{ ...rowBase, cursor: "default" }}>
      <span style={{ width: 30, height: 30, borderRadius: "50%", border: `1px solid ${E.color.hairline}`, flexShrink: 0 }} />
      <span style={textCol}>
        <span style={{ display: "block", width: 140, height: 12, background: E.color.draft }} />
        <span style={{ display: "block", width: 200, height: 9, background: E.color.draft }} />
      </span>
    </div>
  );
}

export function EditorialGroups({ groups, pendingInvites, contactNames, groupNumberById, selfUserId, roomVis, chatActivity, pitchActivity = [], loading = false, onEnter, onEnterRoom, onInvite, onNewGroup, hideNewGroup = false, desktop = false, onOptions }: {
  groups: DashboardGroup[];
  pendingInvites: PendingGroupInvite[];
  contactNames: Record<string, string>;
  groupNumberById: Record<string, number>;
  selfUserId: string;
  roomVis: RoomVisibility[];
  chatActivity: GroupChatActivity[];
  /** A friend's new pitch per group (round 3). */
  pitchActivity?: GroupPitchActivity[];
  loading?: boolean;
  onEnter: (groupId: string) => void;
  /** A rooms-shelf row's tap (two shelves, 11-03); without it the row enters the room's group. */
  onEnterRoom?: (roomId: string, showId: string, groupId: string) => void;
  onInvite: (inv: PendingGroupInvite) => void;
  onNewGroup: () => void;
  hideNewGroup?: boolean;
  /** Desktop: a pen in the row instead of the swipe. */
  desktop?: boolean;
  /** The group's settings (round 5): the phone row's swipe, the desktop row's pen (with the pen's rect). */
  onOptions?: (groupId: string, rect?: DOMRect) => void;
}) {
  const [showsById, setShowsById] = useState<Record<string, Show>>({});
  const [rooms, setRooms] = useState<ShowRoomOfGroup[]>([]);
  // The viewer's answers to pitches (the landing rule): null until loaded.
  const [stances, setStances] = useState<MyStances | null>(null);
  // Friends' answers to the viewer's own pitches, every group at once (11-03).
  const [groupAnswers, setGroupAnswers] = useState<{ votes: GroupShowVote[]; passes: GroupShowPass[] } | null>(null);
  useEffect(() => {
    if (!selfUserId) return;
    let cancelled = false;
    fetchMyStances(selfUserId).then((s) => { if (!cancelled) setStances(s); }).catch(() => { /* unknown answers → the group room, as before */ });
    fetchAllGroupAnswers().then((a) => { if (!cancelled) setGroupAnswers(a); }).catch(() => { /* no answer marks this time */ });
    return () => { cancelled = true; };
  }, [selfUserId]);
  const answerByGroup = useMemo(() => groupAnswers ? answersToMyPitches(groups.map((g) => g.group.id), groupAnswers.votes, groupAnswers.passes, pitchActivity, selfUserId) : new Map<string, PitchAnswer>(), [groupAnswers, groups, pitchActivity, selfUserId]);
  const idsKey = useMemo(() => groups.map((g) => g.group.id).sort().join(","), [groups]);
  // THE ONE BRAIN (his yes, 11-03): the group room's own data per group — the
  // member-gated RPC its shelves read — decides which rooms are yours (in
  // it, not left, not cleared) and which are finished; the rows and the tap
  // can't disagree with the room again. One call per group.
  const [brain, setBrain] = useState<Map<string, GroupDashboardShow[]>>(new Map());
  useEffect(() => {
    if (!idsKey || !selfUserId) { setBrain(new Map()); return; }
    let cancelled = false;
    (async () => {
      const next = new Map<string, GroupDashboardShow[]>();
      await Promise.all(idsKey.split(",").map(async (gid) => { try { next.set(gid, await fetchGroupDashboard(gid)); } catch { /* that group's rows fall back to the raw data */ } }));
      if (!cancelled) setBrain(next);
    })();
    return () => { cancelled = true; };
  }, [idsKey, selfUserId]);
  // Parked rooms ("we're done with this one") and each room's CURRENT members, yours only.
  const roomIdsKey = useMemo(() => roomVis.map((v) => v.groupId).sort().join(","), [roomVis]);
  const [dnf, setDnf] = useState<Record<string, number>>({});
  const [roomMembers, setRoomMembers] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!roomIdsKey) { setDnf({}); setRoomMembers({}); return; }
    let cancelled = false;
    const ids = roomIdsKey.split(",");
    fetchRoomDnfMap(ids).then((m) => { if (!cancelled) setDnf(m); }).catch(() => { /* none parked, then */ });
    fetchRoomMemberIds(ids).then((m) => { if (!cancelled) setRoomMembers(m); }).catch(() => { /* no room counts as finished, then */ });
    return () => { cancelled = true; };
  }, [roomIdsKey]);
  const finishedRooms = useMemo(() => finishedRoomsFrom(brain, showsById, dnf, roomMembers), [brain, showsById, dnf, roomMembers]);
  useEffect(() => {
    let cancelled = false;
    fetchShows().then((rows) => { if (!cancelled) setShowsById(Object.fromEntries(rows.map((s) => [s.id, s]))); }).catch(() => { /* names stay off the lines */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!idsKey) { setRooms([]); return; }
    let cancelled = false;
    fetchShowRoomsForGroups(idsKey.split(",")).then((r) => { if (!cancelled) setRooms(r); }).catch(() => { /* lines fall back to the signal alone */ });
    return () => { cancelled = true; };
  }, [idsKey]);
  const lines = useMemo(() => computeLines(groups, chatActivity, rooms, showsById, pitchActivity, contactNames, stances, selfUserId, answerByGroup, brain, roomMembers), [groups, chatActivity, rooms, showsById, pitchActivity, contactNames, stances, selfUserId, answerByGroup, brain, roomMembers]);
  const roomRows = useMemo(() => roomShelfRows(groups, rooms, roomVis, roomMembers, brain, finishedRooms, stances, showsById, contactNames, groupNumberById, selfUserId, groupAnswers), [groups, rooms, roomVis, roomMembers, brain, finishedRooms, stances, showsById, contactNames, groupNumberById, selfUserId, groupAnswers]);

  // Each group's rooms, newest activity first, and the clusters' order (his
  // call, 11-04): a group sits by whatever moved last in it — a room (a
  // letter, a note, a progress move, the room's creation) or the group
  // itself (a friend's pitch, an answer to yours, chat) — else by when you
  // joined. The saved drag order (round 5) is no longer read.
  const roomsByGroup = useMemo(() => {
    const m = new Map<string, RoomShelfRow[]>();
    for (const r of roomRows) { const list = m.get(r.groupId) ?? []; list.push(r); m.set(r.groupId, list); }
    return m; // roomRows is already newest-first
  }, [roomRows]);
  const ordered = useMemo(() => {
    const at = (g: DashboardGroup) => {
      const gid = g.group.id;
      const joined = g.members.find((m) => m.userId === selfUserId)?.joinedAt ?? g.group.createdAt;
      const room = roomsByGroup.get(gid)?.[0]?.at ?? 0;
      const pitch = pitchActivity.find((a) => a.groupId === gid)?.latestPitchAt ?? 0;
      const chat = chatActivity.find((a) => a.groupId === gid)?.latestMessageAt ?? 0;
      const answer = answerByGroup.get(gid)?.at ?? 0;
      return Math.max(joined, room, pitch, chat, answer);
    };
    return [...groups].sort((a, b) => at(b) - at(a));
  }, [groups, roomsByGroup, pitchActivity, chatActivity, answerByGroup, selfUserId]);
  return (
    <div>
      {/* The head's rule runs off the right of the phone (his sketch): the dividers' open left edge starts at the tab. The green + beside the tab (his note, 11-03) opens the invite modal headed "Start a new watch group". */}
      <div data-tip-anchor="groups-head" style={{ marginRight: desktop ? 0 : -E.space.gutter }}><SectionHead big tab={E.color.friend} after={!hideNewGroup && !loading ? <PlusDisc onClick={onNewGroup} /> : null}>Groups</SectionHead></div>
      {loading && groups.length === 0 && <><GhostRow /><GhostRow /></>}
      {ordered.map(({ group, members, pendingInvites: gp }) => {
        const others = members.filter((m) => m.userId !== selfUserId);
        const name = groupDisplayName(group, others, contactNames, gp.map((p) => p.name || "a friend"), groupNumberById[group.id]);
        const l = lines[group.id];
        const id = group.id;
        const rows = roomsByGroup.get(id) ?? [];
        return (
          <React.Fragment key={id}>
            <GroupRow desktop={desktop} onEnter={() => onEnter(id)} onOptions={onOptions ? (rect) => onOptions(id, rect) : undefined}>
              {/* The initials on the group row (restored at his ask, 11-03): a dashed circle is a friend who hasn't joined yet. */}
              {(others.length > 0 || gp.length > 0) && (
                <span style={{ display: "inline-flex", flexShrink: 0 }}>
                  {others.map((m, i) => <Avatar key={m.userId} initial={personDisplayName(contactNames, m.userId, m.username, m.displayName)[0] ?? "?"} first={i === 0} />)}
                  {gp.map((p, i) => <Avatar key={`p${i}`} initial={(p.name || "?")[0]} first={others.length === 0 && i === 0} pending />)}
                </span>
              )}
              <span style={{ ...nameStyle, flex: 1, minWidth: 0 }}>{name}</span>
              {/* The dot alone says something new waits in the group room (his call, 11-04: the sentence lives in the room and the paper note). */}
              {l?.dot ? <span aria-hidden="true" className="m-dot-in" style={{ width: 10, height: 10, borderRadius: "50%", background: E.color.identity, flexShrink: 0 }} /> : null}
            </GroupRow>
            {rows.length > 0 && <RoomsBox desktop={desktop} rows={rows} onEnterRoom={(r) => { if (onEnterRoom) onEnterRoom(r.roomId, r.showId, r.groupId); else onEnter(r.groupId); }} onMore={() => onEnter(id)} />}
          </React.Fragment>
        );
      })}
      {pendingInvites.map((inv) => {
        const names = pendingInviteMemberNames(inv, contactNames);
        const label = inv.groupName || joinNames(names);
        const inviter = pendingInviterLabel(inv, contactNames);
        return (
          <div key={inv.token} style={{ ...rowBase, cursor: "default" }}>
            <Avatar initial={inviter[0] ?? "?"} first />
            <span style={textCol}>
              <span style={nameStyle}>{label}</span>
              <span style={{ ...lineStyle, color: E.color.alert }}>{inviter} invited you</span>
            </span>
            <button type="button" onClick={() => onInvite(inv)} style={{ ...E.type.label11, height: 34, padding: "0 16px", background: E.color.alert, color: E.color.cream, border: 0, display: "inline-flex", alignItems: "center", cursor: "pointer", flexShrink: 0 }}>
              Join
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** `side`: the edge the phone's note is pinned to (right for the
 *  dashboard's, left for the group room's since 2026-10-13). A left note
 *  is the right one's mirror on every front: the accent strip at its
 *  right, the words right-aligned with the strip's 16px inset, the tilt
 *  the other way, and it swipes LEFT — off its own edge. */
export function PaperNote({ text, at, uid, desktop = false, side = "right", style, onClick, byline, tone = "accent" }: { text: string; at: number; uid: string; desktop?: boolean; side?: "left" | "right"; style?: React.CSSProperties; /** A tappable note (the nudge's, 2026-10-22): a press that isn't a swipe opens it. */ onClick?: () => void; /** A friend's guide letter (open letters, 2026-11-01): a letter card's byline over the sentence, and the sliver in the letter blue (the LetterDisc's) instead of the accent. */ byline?: string; tone?: "accent" | "letter" }) {
  const key = `ns_dash_note_${uid}`;
  const isDismissed = () => {
    try {
      const s = JSON.parse(window.localStorage.getItem(key) ?? "null");
      return !!s && s.text === text && Number(s.at) >= at;
    } catch { return false; }
  };
  const [dismissed, setDismissed] = useState<boolean>(isDismissed);
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);
  // A new arrival (newer signal or a different sentence) brings the note back.
  useEffect(() => { setDismissed(isDismissed()); setGone(false); setDx(0); }, [text, at]); // eslint-disable-line react-hooks/exhaustive-deps
  function dismiss() {
    try { window.localStorage.setItem(key, JSON.stringify({ text, at })); } catch { /* storage off: the note returns next visit */ }
    setGone(true);
    window.setTimeout(() => setDismissed(true), 240);
  }
  if (dismissed) return null;
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (desktop) return;
    startX.current = e.clientX; setDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
  };
  const leftward = side === "left";
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startX.current == null) return;
    const d = e.clientX - startX.current;
    setDx(leftward ? Math.min(0, d) : Math.max(0, d));
  };
  const onUp = () => {
    if (startX.current == null) return;
    const d = dx; startX.current = null; setDragging(false);
    if (Math.abs(d) > 80) dismiss(); else { setDx(0); if (Math.abs(d) < 6) onClick?.(); }
  };
  const shift = gone ? (leftward ? -420 : 420) : dx;
  const revealed = shift !== 0;
  return (
    <div
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      style={{ position: "absolute", zIndex: 3, transform: `rotate(${leftward ? 3 : -3}deg)`, overflow: "hidden", background: revealed ? E.color.accent : "transparent", touchAction: "pan-y", ...style }}
    >
      {revealed && <span aria-hidden="true" style={{ position: "absolute", ...(leftward ? { right: 14 } : { left: 14 }), top: "50%", transform: "translateY(-50%)", color: E.color.cream, fontSize: 22, lineHeight: 1 }}>×</span>}
      <div className="e-note" onClick={desktop && onClick ? onClick : undefined} style={{ position: "relative", boxSizing: "border-box", cursor: onClick ? "pointer" : undefined, padding: desktop ? "12px 100px 13px 16px" : leftward ? "12px 16px 13px 60px" : "12px 60px 13px 16px", background: E.color.cream, border: `1px solid ${E.color.ink}`, ...(leftward ? { borderRight: `5px solid ${tone === "letter" ? E.color.identity : E.color.accent}`, textAlign: "right" as const } : { borderLeft: `5px solid ${tone === "letter" ? E.color.identity : E.color.accent}` }), ...E.type.note13, color: E.color.ink, transform: `translateX(${shift}px)`, transition: dragging ? "none" : "transform 220ms ease" }}>
        {byline && <div style={{ ...E.type.label10, color: "rgba(26,58,74,0.7)", marginBottom: 4 }}>{byline}</div>}
        {text}
        {desktop && (
          <button type="button" className="e-nx" aria-label="Dismiss" title="Dismiss" onClick={(e) => { e.stopPropagation(); dismiss(); }} style={{ position: "absolute", right: 46, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 18, lineHeight: 1, color: E.color.ink, background: "transparent", border: 0, padding: 0, cursor: "pointer" }}>×</button>
        )}
      </div>
      {desktop && <style>{`.e-note .e-nx{opacity:0}.e-note:hover .e-nx{opacity:1}`}</style>}
    </div>
  );
}

/** The docked drawer tab at the foot of the page: "How I watch TV ↑". */
export function DrawerTab({ label, onClick, desktop = false, right = "↑", anchor }: { label: string; onClick: () => void; desktop?: boolean; right?: React.ReactNode; anchor?: string }) {
  return (
    <button
      type="button"
      data-tip-anchor={anchor}
      title={`open ${label}`}
      onClick={onClick}
      style={{
        position: "fixed", bottom: 0, zIndex: 40,
        // The phone (2026-11-04): the tab stops short of the home-screen
        // square docked at its right (lib/installPrompt homeScreenTabInset);
        // inside the installed app there's no square and it runs to 44.
        ...(desktop ? { left: "50%", width: 360, marginLeft: -180 } : { left: 44, right: homeScreenTabInset() }),
        height: desktop ? 56 : "calc(56px + env(safe-area-inset-bottom, 0px))", boxSizing: "border-box",
        padding: desktop ? "0 20px" : "0 20px env(safe-area-inset-bottom, 0px)",
        border: `1px solid ${E.color.ink}`, borderBottom: 0, background: E.color.cream,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        ...E.type.label11, color: E.color.ink, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span>{label}</span>
      <span style={{ color: E.color.inkMuted }}>{right}</span>
    </button>
  );
}
