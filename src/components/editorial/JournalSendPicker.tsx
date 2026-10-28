/**
 * JournalSendPicker.tsx — send ONE journal entry to your groups (2026-10-28,
 * "write it once here and send it to all of them"). Every group of yours
 * with a room for the show, the room you're in first, all ticked; a group
 * that already holds a copy shows "already there" and can't be ticked. The
 * phone's is a sheet-sized panel, the desktop's the editorial dialog.
 */
import React, { useState } from "react";
import { Check } from "lucide-react";
import { E } from "../../styles/editorial";
import { CornerTab } from "./Chrome";
import { EditorialDialog } from "./GroupRoom";

export type JournalSendPlace = { groupId: string; roomId: string; name: string; alreadyThere: boolean };

export default function JournalSendPicker({ places, stamp, busy = false, error = null, desktop = false, onConfirm, onClose }: {
  /** In display order (the current room first). */
  places: JournalSendPlace[];
  /** "S1 E3" — where the copy is stamped. */
  stamp: string;
  busy?: boolean;
  error?: string | null;
  desktop?: boolean;
  onConfirm: (roomIds: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(places.filter((p) => !p.alreadyThere).map((p) => p.roomId)));
  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const n = picked.size;
  const names = places.filter((p) => picked.has(p.roomId)).map((p) => p.name);
  const title = names.length === 0 ? "Send to a group?" : names.length === 1 ? `Send to ${names[0]}?` : names.length === 2 ? `Send to ${names[0]} and ${names[1]}?` : `Send to ${names.length} groups?`;
  const label = busy ? "Sending…" : n === 0 ? "Pick at least one" : `Send letter${n === 1 ? "" : "s"} →`;

  const body = (
    <>
      <div style={{ ...E.type.letterTitle22, paddingRight: desktop ? 28 : 0 }}>{title}</div>
      <div style={{ ...E.type.body15, lineHeight: 1.55, color: E.color.inkSub, marginTop: 10 }}>A copy becomes a letter stamped {stamp} in each group you pick, sealed until your friends reach that episode. Your journal keeps the entry.</div>
      <div style={{ marginTop: 16, borderTop: `1px solid ${E.color.ink}` }}>
        {places.map((p) => {
          const on = picked.has(p.roomId);
          return (
            <button key={p.roomId} type="button" disabled={p.alreadyThere} onClick={() => toggle(p.roomId)} aria-pressed={on} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", padding: "13px 0", background: "transparent", border: 0, borderBottom: `1px solid ${E.color.hairline}`, textAlign: "left", cursor: p.alreadyThere ? "default" : "pointer", color: E.color.ink, WebkitTapHighlightColor: "transparent", opacity: p.alreadyThere ? 0.5 : 1 }}>
              <span aria-hidden="true" style={{ width: 22, height: 22, flexShrink: 0, boxSizing: "border-box", border: `1px solid ${E.color.ink}`, background: on ? E.color.ink : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                {on && <Check size={14} strokeWidth={2.5} color={E.color.cream} />}
              </span>
              <span style={{ ...E.type.body15, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              {p.alreadyThere && <span style={{ ...E.type.label11, color: E.color.inkMuted, flexShrink: 0 }}>already there</span>}
            </button>
          );
        })}
      </div>
      {error && <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.45, color: E.color.alert }}>{error}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button type="button" disabled={busy || n === 0} onClick={() => onConfirm([...picked])} style={{ ...E.type.button16, flex: 1, height: 54, background: E.color.ink, color: E.color.cream, border: 0, cursor: busy || n === 0 ? "not-allowed" : "pointer", opacity: busy || n === 0 ? 0.6 : 1 }}>{label}</button>
        <button type="button" disabled={busy} onClick={onClose} style={{ ...E.type.button16, flex: 1, height: 54, border: `1px solid ${E.color.ink}`, background: "transparent", color: E.color.ink, cursor: "pointer", boxSizing: "border-box" }}>Cancel</button>
      </div>
    </>
  );

  if (desktop) {
    return (
      <EditorialDialog onClose={() => { if (!busy) onClose(); }} width={480} label="Send to a group" zIndex={1200} align="left">
        {body}
      </EditorialDialog>
    );
  }
  return (
    <div role="dialog" aria-label="Send to a group" style={{ position: "fixed", inset: 0, zIndex: 1200, background: E.color.cream, color: E.color.ink, overflowY: "auto" }}>
      <CornerTab kind="back" onClick={() => { if (!busy) onClose(); }} label="Back" />
      <div style={{ padding: `${E.measure.phone.titleTop}px ${E.space.gutter}px calc(40px + env(safe-area-inset-bottom, 0px))` }}>
        {body}
      </div>
    </div>
  );
}
