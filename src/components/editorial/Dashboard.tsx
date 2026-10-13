/**
 * Dashboard.tsx — the editorial dashboard's pieces (checkpoint 2, 2026-10-12;
 * the E3Dash / D3Dash boards). Rendered under the editorial skin only, by
 * MobileDashboard and DashboardPage; the classic dashboards are untouched.
 *
 *   EditorialGroups  "Groups" on a rule with "Invite new friend group →";
 *                    hairline rows — the members' initials, the group's
 *                    name, a mono second line (new letters · a sealed
 *                    letter · new in chat · the room with the latest
 *                    activity · no shows yet) and the envelope at the end;
 *                    an invite row with the inviter's line in red and Join.
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
import React, { useEffect, useMemo, useRef, useState } from "react";
import { E } from "../../styles/editorial";
import LetterDisc from "../LetterDisc";
import { SectionHead, UnderlineWord } from "./Chrome";
import {
  fetchShows, fetchShowRoomsForGroups, roomHasNewActivity, roomHasNewInvisibleActivity, chatHasNewActivity, pitchHasNewActivity,
  type RoomVisibility, type GroupChatActivity, type GroupPitchActivity, type PendingGroupInvite, type Show, type ShowRoomOfGroup,
} from "../../lib/db";
import { groupDisplayName, joinNames, personDisplayName, pendingInviteMemberNames, pendingInviterLabel } from "../../lib/groupNames";
import type { PeopleGroup, PeopleGroupMember } from "../../types";

export type DashboardGroup = { group: PeopleGroup; members: PeopleGroupMember[]; pendingInvites: { name: string }[] };

type GroupLine = { line: string; envelope: "open" | "sealed" | null; /** A friend's new pitch (round 3): the identity dot. */ dot?: boolean };

/** "Sam pitched The Sopranos" — the newest pitch by someone else in a group,
 *  when the viewer hasn't seen it (Alborz's notes, round 3). */
export function pitchSentence(g: DashboardGroup, a: GroupPitchActivity | undefined, contactNames: Record<string, string>): { text: string; at: number } | null {
  if (!a || !pitchHasNewActivity(a)) return null;
  const m = g.members.find((x) => x.userId === a.latestPitchUserId);
  const who = m ? personDisplayName(contactNames, m.userId, m.username, m.displayName) : "A friend";
  return { text: `${who} pitched ${a.latestPitchShowName ?? "a show"}`, at: a.latestPitchAt ?? 0 };
}

function computeLines(
  groups: DashboardGroup[], roomVis: RoomVisibility[], chatActivity: GroupChatActivity[],
  rooms: ShowRoomOfGroup[], showsById: Record<string, Show>,
  pitches: GroupPitchActivity[] = [], contactNames: Record<string, string> = {},
): Record<string, GroupLine> {
  const chatNew = new Set(chatActivity.filter(chatHasNewActivity).map((a) => a.groupId));
  const roomsById = new Map(rooms.map((r) => [r.roomId, r]));
  const showOf = (roomId: string): string | null => {
    const r = roomsById.get(roomId);
    return r ? (showsById[r.showId]?.name ?? null) : null;
  };
  const out: Record<string, GroupLine> = {};
  for (const g of groups) {
    const gid = g.group.id;
    let newest: { at: number; roomId: string } | null = null;
    let sealed: { at: number; roomId: string } | null = null;
    let latest: { at: number; roomId: string } | null = null;
    for (const v of roomVis) {
      if (v.parentGroupId !== gid) continue;
      if (roomHasNewActivity(v)) {
        const at = v.latestVisibleActivityAt ?? 0;
        if (!newest || at > newest.at) newest = { at, roomId: v.groupId };
      } else if (roomHasNewInvisibleActivity(v)) {
        const at = v.latestInvisibleActivityAt ?? 0;
        if (!sealed || at > sealed.at) sealed = { at, roomId: v.groupId };
      }
      const at = v.latestVisibleActivityAt ?? 0;
      if (at && (!latest || at > latest.at)) latest = { at, roomId: v.groupId };
    }
    // A group whose rooms have no activity yet: its newest room.
    if (!latest) {
      for (const r of rooms) if (r.groupId === gid && (!latest || r.createdAt > latest.at)) latest = { at: r.createdAt, roomId: r.roomId };
    }
    const chat = chatNew.has(gid);
    // A friend's new pitch (round 3): after new letters, before a sealed one.
    const pitch = pitchSentence(g, pitches.find((a) => a.groupId === gid), contactNames);
    const envelope: GroupLine["envelope"] = newest || chat ? "open" : (!pitch && sealed) ? "sealed" : null;
    const withShow = (lead: string, roomId: string) => { const n = showOf(roomId); return n ? `${lead} · ${n}` : lead; };
    const line = newest ? withShow("New letters", newest.roomId)
      : pitch ? pitch.text
      : sealed ? withShow("A sealed letter", sealed.roomId)
      : chat ? "New in chat"
      : latest ? (showOf(latest.roomId) ?? "No shows yet")
      : "No shows yet";
    out[gid] = { line, envelope, dot: !newest && !!pitch };
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
const lineStyle: React.CSSProperties = { ...E.type.label11, letterSpacing: "0.04em", color: E.color.inkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function Avatar({ initial, first, pending = false }: { initial: string; first: boolean; pending?: boolean }) {
  return (
    <span style={{ width: 30, height: 30, boxSizing: "border-box", borderRadius: "50%", border: `1px ${pending ? "dashed" : "solid"} ${E.color.ink}`, background: E.color.cream, ...E.type.label11, letterSpacing: 0, color: E.color.ink, display: "inline-flex", alignItems: "center", justifyContent: "center", marginLeft: first ? 0 : -9, flexShrink: 0 }}>
      {(initial || "?").toUpperCase()}
    </span>
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

export function EditorialGroups({ groups, pendingInvites, contactNames, groupNumberById, selfUserId, roomVis, chatActivity, pitchActivity = [], loading = false, onEnter, onInvite, onNewGroup, hideNewGroup = false }: {
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
  onInvite: (inv: PendingGroupInvite) => void;
  onNewGroup: () => void;
  hideNewGroup?: boolean;
}) {
  const [showsById, setShowsById] = useState<Record<string, Show>>({});
  const [rooms, setRooms] = useState<ShowRoomOfGroup[]>([]);
  const idsKey = useMemo(() => groups.map((g) => g.group.id).sort().join(","), [groups]);
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
  const lines = useMemo(() => computeLines(groups, roomVis, chatActivity, rooms, showsById, pitchActivity, contactNames), [groups, roomVis, chatActivity, rooms, showsById, pitchActivity, contactNames]);

  return (
    <div>
      <SectionHead right={!hideNewGroup && !loading ? <UnderlineWord onClick={onNewGroup}>Invite new friend group →</UnderlineWord> : null}>Groups</SectionHead>
      {loading && groups.length === 0 && <><GhostRow /><GhostRow /></>}
      {groups.map(({ group, members, pendingInvites: gp }) => {
        const others = members.filter((m) => m.userId !== selfUserId);
        const name = groupDisplayName(group, others, contactNames, gp.map((p) => p.name || "a friend"), groupNumberById[group.id]);
        const l = lines[group.id];
        return (
          <button key={group.id} type="button" onClick={() => onEnter(group.id)} style={rowBase}>
            {(others.length > 0 || gp.length > 0) && (
              <span style={{ display: "inline-flex", flexShrink: 0 }}>
                {others.map((m, i) => <Avatar key={m.userId} initial={personDisplayName(contactNames, m.userId, m.username, m.displayName)[0] ?? "?"} first={i === 0} />)}
                {gp.map((p, i) => <Avatar key={`p${i}`} initial={(p.name || "?")[0]} first={others.length === 0 && i === 0} pending />)}
              </span>
            )}
            <span style={textCol}>
              <span style={nameStyle}>{name}</span>
              <span style={lineStyle}>{l?.line ?? ""}</span>
            </span>
            {l?.envelope ? <LetterDisc kind={l.envelope} className="m-dot-in" /> : l?.dot ? <span aria-hidden="true" className="m-dot-in" style={{ width: 10, height: 10, borderRadius: "50%", background: E.color.identity, flexShrink: 0 }} /> : null}
          </button>
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

export function PaperNote({ text, at, uid, desktop = false, style }: { text: string; at: number; uid: string; desktop?: boolean; style?: React.CSSProperties }) {
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
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => { if (startX.current != null) setDx(Math.max(0, e.clientX - startX.current)); };
  const onUp = () => {
    if (startX.current == null) return;
    const d = dx; startX.current = null; setDragging(false);
    if (d > 80) dismiss(); else setDx(0);
  };
  const shift = gone ? 420 : dx;
  const revealed = shift > 0;
  return (
    <div
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      style={{ position: "absolute", zIndex: 3, transform: "rotate(-3deg)", overflow: "hidden", background: revealed ? E.color.accent : "transparent", touchAction: "pan-y", ...style }}
    >
      {revealed && <span aria-hidden="true" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: E.color.cream, fontSize: 22, lineHeight: 1 }}>×</span>}
      <div className="e-note" style={{ position: "relative", boxSizing: "border-box", padding: desktop ? "12px 100px 13px 16px" : "12px 60px 13px 16px", background: E.color.cream, border: `1px solid ${E.color.ink}`, borderLeft: `5px solid ${E.color.accent}`, ...E.type.note13, color: E.color.ink, transform: `translateX(${shift}px)`, transition: dragging ? "none" : "transform 220ms ease" }}>
        {text}
        {desktop && (
          <button type="button" className="e-nx" aria-label="Dismiss" title="Dismiss" onClick={dismiss} style={{ position: "absolute", right: 46, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 18, lineHeight: 1, color: E.color.ink, background: "transparent", border: 0, padding: 0, cursor: "pointer" }}>×</button>
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
        ...(desktop ? { left: "50%", width: 360, marginLeft: -180 } : { left: 44, right: 44 }),
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
