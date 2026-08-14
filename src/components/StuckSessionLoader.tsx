import { useEffect, useState } from "react";
import LoadingDots from "./LoadingDots";

/**
 * The homepage "loading" overlay for a signed-in user whose profile / redirect
 * hasn't resolved yet. The "sign out" escape hatch is for a GENUINELY STUCK
 * session (profile never loads — HANDOFF §6 item 15), so it only appears after
 * a delay: during a normal sign-in the redirect fires in well under a second
 * and this component unmounts before the timer, so the escape never flashes
 * (Alborz 2026-08-15 — the "sign out" text was appearing mid-sign-in).
 */
export default function StuckSessionLoader({ onSignOut }: { onSignOut: () => void }) {
  const [showEscape, setShowEscape] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShowEscape(true), 4000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "var(--canon-personal,#7abd8e)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
      <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, color: "var(--canon-cream,#FEF8EA)" }}>loading<LoadingDots /></span>
      {showEscape && (
        <button
          onClick={onSignOut}
          style={{ border: "none", background: "transparent", color: "var(--canon-cream,#FEF8EA)", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 12, opacity: 0.7, cursor: "pointer" }}
        >
          sign out
        </button>
      )}
    </div>
  );
}
