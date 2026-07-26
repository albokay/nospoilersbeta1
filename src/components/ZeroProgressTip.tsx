/**
 * ZeroProgressTip — the show room's "haven't started" pointer (help-system
 * arc CP4). Inline at the top of the entry column — it sits with the
 * writing it unlocks rather than floating as page chrome — on BOTH
 * platforms. Contextual: renders at zero progress until dismissed (one
 * site-wide flag; a viewer who dismissed it in one room knows the lesson).
 */
import { useState } from "react";
import { X } from "lucide-react";
import { CANON } from "../styles/canon";
import { ZERO_PROGRESS_TIP, ZERO_TIP_KEY } from "../lib/tipsContent";

export default function ZeroProgressTip() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return !!localStorage.getItem(ZERO_TIP_KEY); } catch { return false; }
  });
  if (dismissed) return null;
  return (
    <div style={{
      position: "relative", background: CANON.cream, borderRadius: 12,
      padding: "12px 36px 12px 16px", marginBottom: 14,
      fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.5, color: CANON.dark,
    }}>
      {ZERO_PROGRESS_TIP}
      <button
        aria-label="Dismiss"
        onClick={() => {
          try { localStorage.setItem(ZERO_TIP_KEY, "1"); } catch { /* tolerate */ }
          setDismissed(true);
        }}
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
