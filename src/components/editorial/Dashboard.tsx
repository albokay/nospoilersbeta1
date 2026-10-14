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
import { GripVertical, SquarePen } from "lucide-react";
import { E } from "../../styles/editorial";
import LetterDisc from "../LetterDisc";
import { SectionHead, UnderlineWord } from "./Chrome";
import { useRowSwipe } from "./GroupRoom";
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
    // The quiet line (Alborz's notes, round 5): the room with the latest
    // letters (the newest room before anyone writes), led by "Latest:" once
    // the group has more than one room.
    const roomCount = rooms.filter((r) => r.groupId === gid).length;
    const quiet = latest ? showOf(latest.roomId) : null;
    const line = newest ? withShow("New letters", newest.roomId)
      : pitch ? pitch.text
      : sealed ? withShow("A sealed letter", sealed.roomId)
      : chat ? "New in chat"
      : quiet ? (roomCount > 1 ? `Latest: ${quiet}` : quiet)
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

type GripHandlers = { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void; onPointerMove: (e: React.PointerEvent<HTMLElement>) => void; onPointerUp: () => void; onPointerCancel: () => void; active: boolean };

/** One group's row (Alborz's notes, round 5): on the phone it swipes left
 *  over a friend-blue pane to the group's settings (a cream pen); on desktop
 *  a pen appears on hover. The grip at the row's end drags it up or down
 *  the list (the faintest ink over cream). */
function GroupRow({ desktop, lift, rowRef, onEnter, onOptions, grip, children }: {
  desktop: boolean;
  /** The dragged row's offset while it's carried. */
  lift: number | null;
  rowRef: (el: HTMLDivElement | null) => void;
  onEnter: () => void;
  onOptions?: (rect?: DOMRect) => void;
  grip: GripHandlers | null;
  children: React.ReactNode;
}) {
  const swipe = useRowSwipe(!desktop && onOptions ? () => onOptions() : undefined);
  const gutter = E.space.gutter;
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEnter(); } };
  const gripEl = grip && (
    <span
      data-grip="1" role="button" aria-label="Drag to reorder" title="Drag to reorder"
      onPointerDown={grip.onPointerDown} onPointerMove={grip.onPointerMove} onPointerUp={grip.onPointerUp} onPointerCancel={grip.onPointerCancel}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 44, marginRight: -6, flexShrink: 0, color: E.color.inkFaint, cursor: grip.active ? "grabbing" : "grab", touchAction: "none", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
    >
      <GripVertical size={18} strokeWidth={1.6} aria-hidden="true" />
    </span>
  );
  const carried: React.CSSProperties = lift != null ? { transform: `translateY(${lift}px)`, zIndex: 3, boxShadow: "0 6px 18px rgba(26,58,74,0.18)" } : {};
  if (desktop) {
    return (
      <div ref={rowRef} className="e-row" role="button" tabIndex={0} onClick={onEnter} onKeyDown={onKey} style={{ ...rowBase, position: "relative", background: E.color.cream, userSelect: "none", ...carried }}>
        {children}
        {onOptions && (
          <span className="e-pen" role="button" aria-label="Group settings" title="Group settings" onClick={(e) => { e.stopPropagation(); onOptions(e.currentTarget.getBoundingClientRect()); }} style={{ width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>
            <SquarePen size={16} strokeWidth={1.5} color={E.color.ink} aria-hidden="true" />
          </span>
        )}
        {gripEl}
      </div>
    );
  }
  return (
    // Nothing in the row is selectable and the long-press callout is off
    // (his catch): a held grip no longer wakes iOS's text selection mid-drag.
    <div ref={rowRef} style={{ position: "relative", overflow: "hidden", margin: `0 -${gutter}px`, borderBottom: `1px solid ${E.color.hairline}`, touchAction: "pan-y", background: E.color.cream, WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", ...carried }} {...swipe.handlers}>
      {onOptions && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: E.color.friend, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 30 }}>
          <span role="button" aria-label="Group settings" onClick={() => onOptions()} style={{ display: "inline-flex", width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <SquarePen size={22} strokeWidth={1.8} color={E.color.cream} aria-hidden="true" />
          </span>
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!swipe.dragging && swipe.dx === 0) onEnter(); }} onKeyDown={onKey} style={{ ...rowBase, position: "relative", borderBottom: 0, padding: `18px ${gutter}px`, background: E.color.cream, transform: `translateX(${swipe.dx}px)`, transition: swipe.dragging ? "none" : "transform 260ms ease" }}>
        {children}
        {gripEl}
        {/* The edge strip that says the row swipes (the show rows' hint) — accent, like theirs (his call); the pane behind stays friend blue. */}
        {onOptions && <span aria-hidden="true" style={{ position: "absolute", right: 0, top: 6, bottom: 6, width: 4, background: E.color.accent }} />}
      </div>
    </div>
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

export function EditorialGroups({ groups, pendingInvites, contactNames, groupNumberById, selfUserId, roomVis, chatActivity, pitchActivity = [], loading = false, onEnter, onInvite, onNewGroup, hideNewGroup = false, desktop = false, onOptions, onReorder }: {
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
  /** Desktop: a pen on hover instead of the swipe; the grip drags with the mouse. */
  desktop?: boolean;
  /** The group's settings (round 5): the phone row's swipe, the desktop row's hover pen (with the pen's rect). */
  onOptions?: (groupId: string, rect?: DOMRect) => void;
  /** Your own order (round 5): every group's id in the dragged order, to save. */
  onReorder?: (groupIds: string[]) => void;
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

  // Your own order (round 5): the groups you've dragged first, in that
  // order, then the rest newest-joined first. A drag this session is the
  // truth until the saved order comes back with the next load.
  const defaultIds = useMemo(() => {
    const joined = (g: DashboardGroup) => g.members.find((m) => m.userId === selfUserId)?.joinedAt ?? g.group.createdAt;
    const manual = groups.filter((g) => g.group.sortOrder != null).sort((a, b) => (a.group.sortOrder as number) - (b.group.sortOrder as number));
    const rest = groups.filter((g) => g.group.sortOrder == null).sort((a, b) => joined(b) - joined(a));
    return [...manual, ...rest].map((g) => g.group.id);
  }, [groups, selfUserId]);
  const [draggedIds, setDraggedIds] = useState<string[] | null>(null);
  const orderedIds = useMemo(
    () => (draggedIds ? [...draggedIds.filter((id) => defaultIds.includes(id)), ...defaultIds.filter((id) => !draggedIds.includes(id))] : defaultIds),
    [draggedIds, defaultIds],
  );
  const ordered = useMemo(() => orderedIds.map((id) => groups.find((g) => g.group.id === id)).filter((g): g is DashboardGroup => !!g), [orderedIds, groups]);

  // The drag from the grip: the row follows the pointer; past a neighbour's
  // midpoint the two swap and the anchor carries along, so the carried row
  // keeps its place under the finger.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragRef = useRef<{ id: string; startY: number; order: string[] } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null);
  const onGripDown = (id: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (!onReorder) return;
    e.preventDefault(); e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
    dragRef.current = { id, startY: e.clientY, order: orderedIds };
    setDrag({ id, dy: 0 });
  };
  const onGripMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    let dy = e.clientY - d.startY;
    const i = d.order.indexOf(d.id);
    const heightOf = (id: string) => rowRefs.current[id]?.getBoundingClientRect().height ?? 0;
    if (dy > 0 && i < d.order.length - 1) {
      const h = heightOf(d.order[i + 1]);
      if (h && dy > h / 2) { const next = [...d.order]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; d.order = next; d.startY += h; dy -= h; setDraggedIds(next); }
    } else if (dy < 0 && i > 0) {
      const h = heightOf(d.order[i - 1]);
      if (h && -dy > h / 2) { const next = [...d.order]; [next[i], next[i - 1]] = [next[i - 1], next[i]]; d.order = next; d.startY -= h; dy += h; setDraggedIds(next); }
    }
    setDrag({ id: d.id, dy });
  };
  const onGripUp = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    onReorder?.(d.order);
  };

  return (
    <div>
      <div data-tip-anchor="groups-head"><SectionHead right={!hideNewGroup && !loading ? <UnderlineWord onClick={onNewGroup}>Invite new friend group →</UnderlineWord> : null}>Groups</SectionHead></div>
      {loading && groups.length === 0 && <><GhostRow /><GhostRow /></>}
      {ordered.map(({ group, members, pendingInvites: gp }) => {
        const others = members.filter((m) => m.userId !== selfUserId);
        const name = groupDisplayName(group, others, contactNames, gp.map((p) => p.name || "a friend"), groupNumberById[group.id]);
        const l = lines[group.id];
        const id = group.id;
        return (
          <GroupRow
            key={id}
            desktop={desktop}
            lift={drag?.id === id ? drag.dy : null}
            rowRef={(el) => { rowRefs.current[id] = el; }}
            onEnter={() => onEnter(id)}
            onOptions={onOptions ? (rect) => onOptions(id, rect) : undefined}
            grip={onReorder ? { onPointerDown: onGripDown(id), onPointerMove: onGripMove, onPointerUp: onGripUp, onPointerCancel: onGripUp, active: !!drag } : null}
          >
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
          </GroupRow>
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
export function PaperNote({ text, at, uid, desktop = false, side = "right", style }: { text: string; at: number; uid: string; desktop?: boolean; side?: "left" | "right"; style?: React.CSSProperties }) {
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
    if (Math.abs(d) > 80) dismiss(); else setDx(0);
  };
  const shift = gone ? (leftward ? -420 : 420) : dx;
  const revealed = shift !== 0;
  return (
    <div
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      style={{ position: "absolute", zIndex: 3, transform: `rotate(${leftward ? 3 : -3}deg)`, overflow: "hidden", background: revealed ? E.color.accent : "transparent", touchAction: "pan-y", ...style }}
    >
      {revealed && <span aria-hidden="true" style={{ position: "absolute", ...(leftward ? { right: 14 } : { left: 14 }), top: "50%", transform: "translateY(-50%)", color: E.color.cream, fontSize: 22, lineHeight: 1 }}>×</span>}
      <div className="e-note" style={{ position: "relative", boxSizing: "border-box", padding: desktop ? "12px 100px 13px 16px" : leftward ? "12px 16px 13px 60px" : "12px 60px 13px 16px", background: E.color.cream, border: `1px solid ${E.color.ink}`, ...(leftward ? { borderRight: `5px solid ${E.color.accent}`, textAlign: "right" as const } : { borderLeft: `5px solid ${E.color.accent}` }), ...E.type.note13, color: E.color.ink, transform: `translateX(${shift}px)`, transition: dragging ? "none" : "transform 220ms ease" }}>
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
