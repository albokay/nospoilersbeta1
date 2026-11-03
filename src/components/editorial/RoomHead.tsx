/**
 * RoomHead.tsx — the show room's head pieces (the landing-rule arc's CP2,
 * 2026-11-02, his boards).
 *
 *   GroupRoomDisc    the sky disc beside the group's headline — "GROUP ROOM"
 *                    over a right arrow, the way up to the group room. A
 *                    notification dot over its top-left when something new
 *                    waits ELSEWHERE in the group (the dashboard rows' colours:
 *                    blue = something you can act on now — new writing in
 *                    another room, a friend's pitch, the chat; red = a sealed
 *                    letter in another room).
 *   RotatedLabel     the show's name up the side of its art, reading bottom to
 *                    top: one row hugging the art, two balanced rows, then an
 *                    ellipsis.
 *   useGroupSignals  the signals behind the disc's dot and the chat fold's
 *                    count, for a room: this room's own writing is left out.
 */
import React, { useCallback, useEffect, useState } from "react";
import { E } from "../../styles/editorial";
import {
  fetchRoomActivityVisibility, fetchGroupChatActivity, fetchGroupPitchActivity,
  roomHasNewActivity, roomHasNewInvisibleActivity, chatHasNewActivity, pitchHasNewActivity, chatUnreadLabel,
  type GroupPitchActivity,
} from "../../lib/db";
import { fetchAskSignal } from "../../lib/groupAsks";

export type DiscSignal = "blue" | "red" | null;

export function GroupRoomDisc({ desktop = false, signal = null, onClick, style }: { desktop?: boolean; signal?: DiscSignal; onClick: () => void; style?: React.CSSProperties }) {
  const size = desktop ? E.measure.desktop.groupDisc : E.measure.phone.groupDisc;
  const arrow = desktop ? 32 : 24;
  const dot = desktop ? 16 : 12;
  // The dot's centre on the circle's edge, up and to the left at 45°: r(1 − 1/√2) in from the box's corner.
  const inset = (size / 2) * (1 - Math.SQRT1_2);
  return (
    <button
      type="button" aria-label="Group room" title="Group room" onClick={onClick}
      style={{ position: "relative", width: size, height: size, borderRadius: "50%", background: E.color.friend, color: E.color.ink, border: 0, padding: 0, cursor: "pointer", display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: desktop ? 10 : 8, flexShrink: 0, WebkitTapHighlightColor: "transparent", ...style }}
    >
      <span style={{ ...E.type.label11, fontSize: desktop ? 11 : 8, letterSpacing: "0.12em" }}>Group room</span>
      <svg width={arrow} height={arrow} viewBox="0 0 24 24" fill="none" stroke={E.color.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
      {signal && (
        <span aria-hidden="true" style={{ position: "absolute", left: inset - dot / 2 - 2, top: inset - dot / 2 - 2, width: dot, height: dot, borderRadius: "50%", background: signal === "blue" ? E.color.identity : E.color.alert, border: `2px solid ${E.color.cream}` }} />
      )}
    </button>
  );
}

/** The name up the art's side in a 30px strip: the strip is `height` tall;
 *  the box inside is rotated a quarter turn counter-clockwise, so its lines
 *  fill from the strip's far side towards the art — a single row hugs the
 *  art (his nudge on the board), two rows fill outward, a third is cut. */
export function RotatedLabel({ name, height, style }: { name: string; height: number; style?: React.CSSProperties }) {
  return (
    <div aria-hidden="true" style={{ position: "relative", width: 30, height, flexShrink: 0, ...style }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: height, height: 30, transformOrigin: "top left", transform: `rotate(-90deg) translateX(-${height}px)`, display: "flex", alignItems: "flex-end" }}>
        <div style={{ ...E.type.label11, color: E.color.ink, width: "100%", lineHeight: 1.35, display: "-webkit-box", WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"], WebkitLineClamp: 2, overflow: "hidden", textWrap: "balance" } as React.CSSProperties}>{name}</div>
      </div>
    </div>
  );
}

export type GroupSignals = { disc: DiscSignal; chatNew: boolean; chatCountLabel: string | null; reload: () => void };

/** The group's signals as the dashboard reads them, minus this room: the
 *  disc's dot (blue over red) and the chat fold's count (the unread count
 *  plus one for an open "Thoughts on…" ask you haven't answered). Loaded on
 *  entry and on `reload()` (the chat closing); nothing live. */
export function useGroupSignals(userId: string | null | undefined, groupId: string | null | undefined, roomId: string | null | undefined): GroupSignals {
  const [s, setS] = useState<{ disc: DiscSignal; chatNew: boolean; count: number | undefined }>({ disc: null, chatNew: false, count: undefined });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!userId || !groupId) { setS({ disc: null, chatNew: false, count: undefined }); return; }
    let cancelled = false;
    (async () => {
      const [vis, chat, pitches] = await Promise.all([
        fetchRoomActivityVisibility(userId, true).catch(() => []),
        fetchGroupChatActivity(userId).catch(() => []),
        fetchGroupPitchActivity(userId).catch(() => [] as GroupPitchActivity[]),
      ]);
      if (cancelled) return;
      let blue = false, red = false;
      for (const v of vis) {
        if (v.parentGroupId !== groupId || v.groupId === roomId) continue;
        if (roomHasNewActivity(v)) blue = true;
        else if (roomHasNewInvisibleActivity(v)) red = true;
      }
      const c = chat.find((a) => a.groupId === groupId);
      let chatNew = !!c && chatHasNewActivity(c);
      let count: number | undefined = chatNew ? c?.unreadCount : (c?.unreadCount == null ? undefined : 0);
      try {
        const ask = await fetchAskSignal(groupId, userId, c?.chatLastSeenAt ?? null);
        if (cancelled) return;
        if (ask.countsNew) count = (count ?? 0) + 1;
        if (ask.countsNew || ask.dot) chatNew = true;
      } catch { /* the fold just doesn't know about the ask this time */ }
      const p = pitches.find((a) => a.groupId === groupId);
      const pitchNew = !!p && pitchHasNewActivity(p) && p.latestPitchUserId !== userId;
      setS({ disc: blue || chatNew || pitchNew ? "blue" : red ? "red" : null, chatNew, count });
    })();
    return () => { cancelled = true; };
  }, [userId, groupId, roomId, tick]);
  return { disc: s.disc, chatNew: s.chatNew, chatCountLabel: s.count && s.count > 0 ? chatUnreadLabel(s.count) : null, reload };
}
