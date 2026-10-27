/**
 * JournalPicker.tsx — pick the journal entries to hand to a group
 * (the journal arc, 2026-10-26; his approved board "Phone · pick the
 * entries to hand over"). The phone's is a full-screen cream panel from
 * the title line down (centred head, the back corner); the desktop's the
 * editorial dialog. Every entry starts picked; the foot counts the pick
 * and says what happens: copies go to the room, the journal keeps them.
 */
import React, { useState } from "react";
import { Check } from "lucide-react";
import { E } from "../../styles/editorial";
import type { Thread } from "../../types";
import { CornerTab } from "./Chrome";
import { EditorialDialog } from "./GroupRoom";
import { monthYear } from "../../lib/journal";

export default function JournalPicker({ entries, showName, groupName, busy = false, error = null, desktop = false, onConfirm, onClose }: {
  /** In episode order, earliest first. */
  entries: Thread[];
  showName: string;
  groupName: string;
  busy?: boolean;
  error?: string | null;
  desktop?: boolean;
  onConfirm: (threadIds: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(entries.map((t) => t.id)));
  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const n = picked.size;
  const label = busy ? "Handing over…" : n === 0 ? "Pick at least one" : `Hand over ${n} ${n === 1 ? "letter" : "letters"} →`;

  const head = (
    <div style={{ textAlign: "center" }}>
      <div style={{ ...E.type.question30, lineHeight: 1.15 }}>Hand over your journal</div>
      <div style={{ ...E.type.label11, marginTop: 8, color: E.color.inkSub }}>{showName} · to {groupName}</div>
    </div>
  );
  const list = (
    <div style={{ marginTop: 20 }}>
      <div style={{ ...E.type.label11, display: "flex", justifyContent: "space-between", paddingBottom: 9, borderBottom: `1px solid ${E.color.ink}` }}>
        <span>Your entries</span><span style={{ color: E.color.inkMuted }}>{n} of {entries.length} picked</span>
      </div>
      {entries.map((t) => {
        const on = picked.has(t.id);
        return (
          <button key={t.id} type="button" onClick={() => toggle(t.id)} aria-pressed={on} style={{ display: "flex", alignItems: "flex-start", gap: 14, width: "100%", padding: "14px 0", background: "transparent", border: 0, borderBottom: `1px solid ${E.color.hairline}`, textAlign: "left", cursor: "pointer", color: E.color.ink, WebkitTapHighlightColor: "transparent" }}>
            <span aria-hidden="true" style={{ width: 22, height: 22, flexShrink: 0, marginTop: 2, boxSizing: "border-box", border: `1px solid ${E.color.ink}`, background: on ? E.color.ink : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              {on && <Check size={14} strokeWidth={2.5} color={E.color.cream} />}
            </span>
            <span style={{ minWidth: 0, flex: 1, opacity: on ? 1 : 0.55 }}>
              <span style={{ ...E.type.label11, color: E.color.inkMuted, display: "block" }}>S{t.season} E{t.episode} · {monthYear(t.createdAt)}</span>
              <span style={{ ...E.type.letterTitle22, fontSize: 20, display: "block", marginTop: 6 }}>{t.titleBase || "Untitled"}</span>
              {t.preview && <span style={{ ...E.type.letterBody15, display: "block", marginTop: 4, color: "rgba(26,58,74,0.75)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.preview}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
  const foot = (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 13, lineHeight: 1.45, color: "rgba(26,58,74,0.75)", textWrap: "balance" } as React.CSSProperties}>Copies go to the room and you join it. Your journal keeps every entry.</div>
      {error && <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.45, color: E.color.alert }}>{error}</div>}
      <button type="button" disabled={busy || n === 0} onClick={() => onConfirm([...picked])} style={{ ...E.type.button16, marginTop: 12, width: "100%", height: 56, background: E.color.ink, color: E.color.cream, border: 0, cursor: busy || n === 0 ? "not-allowed" : "pointer", opacity: busy || n === 0 ? 0.6 : 1 }}>{label}</button>
    </div>
  );

  if (desktop) {
    return (
      <EditorialDialog onClose={() => { if (!busy) onClose(); }} width={520} label="Hand over your journal" zIndex={1200}>
        {head}
        <div style={{ maxHeight: "50vh", overflowY: "auto" }}>{list}</div>
        <div style={{ marginTop: 20 }}>{foot}</div>
      </EditorialDialog>
    );
  }
  return (
    <div role="dialog" aria-label="Hand over your journal" style={{ position: "fixed", inset: 0, zIndex: 1200, background: E.color.cream, color: E.color.ink, overflowY: "auto" }}>
      <CornerTab kind="back" onClick={() => { if (!busy) onClose(); }} label="Back" />
      <div style={{ padding: `${E.measure.phone.titleTop}px ${E.space.gutter}px 180px` }}>
        {head}
        {list}
      </div>
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: E.color.cream, padding: `14px ${E.space.gutter}px calc(24px + env(safe-area-inset-bottom, 0px))` }}>{foot}</div>
    </div>
  );
}
