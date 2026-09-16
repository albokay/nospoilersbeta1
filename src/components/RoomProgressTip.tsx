/**
 * RoomProgressTip — the show room's progress-picker pointer (help-system
 * QA round 3; replaced the zero-progress ticket at the top of the entry
 * column). Shows on room entrance REGARDLESS of progress, until X'd
 * (one flag per ACCOUNT — the lesson transfers between rooms, but a new
 * account on a shared browser still gets it; Alborz's 2026-08-01 catch).
 *
 * Desktop (2026-09-15): the header "?" toggles it back after dismissal —
 * ShowRoomPage owns visibility via `open`/`onDismiss` (dashboard tips
 * parity). Mobile stays self-managed: once X'd it's gone.
 *
 * Desktop: a cream StickyNote to the RIGHT of the progress dropdown,
 * leading with a ← icon aligned to point at it. Mobile: the inline-card
 * idiom, mounted ABOVE the picker row (below the roster — QA round 8),
 * with a ↓ at its bottom right pointing at the picker beneath.
 */
import { useState } from "react";
import { ArrowLeft, ArrowDown, X } from "lucide-react";
import StickyNote from "./StickyNote";
import { CANON } from "../styles/canon";
import { ROOM_PROGRESS_TIP, roomTipKey } from "../lib/tipsContent";

export default function RoomProgressTip({ idiom, userId, open, onDismiss }: {
  idiom: "desktop" | "mobile";
  userId: string;
  /** Controlled visibility — the parent decides when the sticky shows
   *  (the desktop "?" toggle). Omitted = self-managed (mobile). */
  open?: boolean;
  onDismiss?: () => void;
}) {
  const [selfDismissed, setSelfDismissed] = useState<boolean>(() => {
    try { return !!localStorage.getItem(roomTipKey(userId)); } catch { return false; }
  });
  const visible = open !== undefined ? open : !selfDismissed;
  if (!visible) return null;

  function dismiss() {
    // X always re-arms the per-account flag, controlled or not — the
    // sticky stops auto-showing on entrance either way.
    try { localStorage.setItem(roomTipKey(userId), "1"); } catch { /* tolerate */ }
    setSelfDismissed(true);
    onDismiss?.();
  }

  if (idiom === "desktop") {
    return (
      <StickyNote
        tilt={2}
        width={300}
        centered
        onDismiss={dismiss}
        ariaLabel="Progress picker tip"
        ignoreViewportGate
        // Absolute, not fixed (Alborz 2026-09-15): anchored in the room's
        // scroll container so the note travels with the picker it points at
        // instead of staying glued to the viewport. top = note CENTER
        // (`centered`): header 96 + tab row 44 + body pad 24 + half the
        // 44px toolbar row = picker center 186; +70 puts the first-line ←
        // level with it (the note is ~185 tall, arrow ~23 below its top).
        // Re-derive if that row's height changes again.
        style={{ position: "absolute", top: 256, left: "min(calc(50% + 330px), calc(100vw - 175px))" }}
      >
        <p style={{ margin: 0 }}>
          <ArrowLeft size={15} style={{ display: "inline", verticalAlign: "-3px", marginRight: 4 }} />
          {ROOM_PROGRESS_TIP.body}
        </p>
        <p style={{ margin: "8px 0 0", fontStyle: "italic", opacity: 0.85 }}>{ROOM_PROGRESS_TIP.aside}</p>
      </StickyNote>
    );
  }

  return (
    // Alert fill + Dark text (Alborz 2026-08-01): the cream card read as
    // part of the page; this is an important instruction, not furniture.
    <div style={{
      position: "relative", background: CANON.alert, borderRadius: 12,
      padding: "12px 36px 12px 16px", marginBottom: 14,
      fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.5, color: CANON.dark,
    }}>
      <p style={{ margin: 0 }}>{ROOM_PROGRESS_TIP.body}</p>
      <p style={{ margin: "6px 0 0", fontStyle: "italic", opacity: 0.85 }}>{ROOM_PROGRESS_TIP.aside}</p>
      {/* ↓ at the bottom right — the picker sits just beneath. Large +
          heavy (Alborz 2026-08-01); Cream (Alborz 2026-08-11). */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4, color: CANON.cream }}>
        <ArrowDown size={26} strokeWidth={2.8} />
      </div>
      {/* "×" matches the ↓ — Cream, same size + weight (Alborz 2026-08-14;
          was a small faded Dark mark). */}
      <button
        aria-label="Dismiss"
        onClick={dismiss}
        style={{
          position: "absolute", top: 6, right: 6, background: "transparent",
          border: "none", color: CANON.cream, cursor: "pointer",
          padding: 4, display: "flex",
        }}
      >
        <X size={26} strokeWidth={2.8} />
      </button>
    </div>
  );
}
