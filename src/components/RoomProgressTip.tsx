/**
 * RoomProgressTip — the show room's progress-picker pointer (help-system
 * QA round 3; replaced the zero-progress ticket at the top of the entry
 * column). Shows on room entrance REGARDLESS of progress, until X'd
 * (one site-wide flag — the lesson transfers between rooms). No "?"
 * toggle in the show room; once dismissed it's gone.
 *
 * Desktop: a cream StickyNote to the RIGHT of the progress dropdown,
 * leading with a ← icon aligned to point at it. Mobile: the inline-card
 * idiom above the feed (no sticky layer on mobile), pointing ↑ since the
 * picker sits above.
 */
import { useState } from "react";
import { ArrowLeft, ArrowUp, X } from "lucide-react";
import StickyNote from "./StickyNote";
import { CANON } from "../styles/canon";
import { ROOM_PROGRESS_TIP, ROOM_TIP_KEY } from "../lib/tipsContent";

export default function RoomProgressTip({ idiom }: { idiom: "desktop" | "mobile" }) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return !!localStorage.getItem(ROOM_TIP_KEY); } catch { return false; }
  });
  if (dismissed) return null;

  function dismiss() {
    try { localStorage.setItem(ROOM_TIP_KEY, "1"); } catch { /* tolerate */ }
    setDismissed(true);
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
        style={{ top: 222, left: "min(calc(50% + 330px), calc(100vw - 175px))" }}
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
    <div style={{
      position: "relative", background: CANON.cream, borderRadius: 12,
      padding: "12px 36px 12px 16px", marginBottom: 14,
      fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.5, color: CANON.dark,
    }}>
      <p style={{ margin: 0 }}>
        <ArrowUp size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
        {ROOM_PROGRESS_TIP.body}
      </p>
      <p style={{ margin: "6px 0 0", fontStyle: "italic", opacity: 0.85 }}>{ROOM_PROGRESS_TIP.aside}</p>
      <button
        aria-label="Dismiss"
        onClick={dismiss}
        style={{
          position: "absolute", top: 6, right: 6, background: "transparent",
          border: "none", color: CANON.dark, opacity: 0.6, cursor: "pointer",
          padding: 4, display: "flex",
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
