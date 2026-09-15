import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { CANON } from "../styles/canon";
import { M, OVERLAY, LORA } from "./m";
import { useAuth } from "../lib/auth";
import { insertFeedback } from "../lib/db";
import LoadingDots from "../components/LoadingDots";
import useSheetSwipeDown from "../lib/useSheetSwipeDown";

/**
 * MobileFeedbackSheet — the desktop FeedbackWidget's form as a bottom sheet.
 * Mobile has no room for the always-visible left-edge tab (and the left edge
 * is the iOS back-swipe zone), so the trigger lives in the dashboard's top
 * bar instead; this sheet reuses the widget's exact submission path: same
 * insertFeedback call (server rate limit for signed-in users) + the same
 * ns_fb_last 8s localStorage cooldown, same copy.
 */

const MAX_CHARS = 2000;
const PROMPT_LINES = [
  "How are things working?",
  "Any suggestions?",
  "Anything confusing?",
  "Anything glitching?",
  "Anything exciting?",
  "Anything you love or want more of?",
];

function canSubmit(): boolean {
  const last = localStorage.getItem("ns_fb_last");
  if (!last) return true;
  return Date.now() - parseInt(last, 10) > 8_000;
}

const C = { sky: CANON.friend, blue: CANON.identity, red: CANON.alert, cream: CANON.cream, midnight: CANON.dark };

export default function MobileFeedbackSheet({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const location = useLocation();
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "rate-limited" | "error">("idle");

  const handleSend = async () => {
    if (!message.trim() || phase === "sending") return;
    if (!canSubmit()) { setPhase("rate-limited"); return; }
    setPhase("sending");
    try {
      await insertFeedback(
        user?.id ?? null,
        user ? (profile?.username ?? "") : "anon",
        location.pathname,
        message.trim()
      );
      localStorage.setItem("ns_fb_last", String(Date.now()));
      setPhase("sent");
      setMessage("");
      setTimeout(() => { onClose(); }, 1000);
    } catch (err) {
      // Log details for diagnosis but don't surface raw Supabase errors.
      console.error("[m-feedback] submit failed:", err);
      setPhase("error");
    }
  };

  // Swipe-down dismiss (2026-07-28 rollout); drags starting in the textarea
  // don't move the sheet, so typing/selection is untouched.
  const swipe = useSheetSwipeDown(onClose);

  return (
    // pointerdown (not click) so the FIRST tap outside closes the sheet even
    // when the keyboard is up — iOS consumes the click that dismisses the
    // keyboard, which is why tap-outside used to need a scroll-to-top first.
    <div style={dim} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...sheet, ...swipe.style }} {...swipe.handlers}>
        {/* Grabber + swipe/tap-out are the exits (polish pass 2026-09-14 —
            the × sat in the title's line and forced a right pad). */}
        <div style={OVERLAY.grabber(C.midnight)} />
        <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, lineHeight: 1.25, color: C.midnight, marginBottom: 10 }}>
          Send Sidebar feedback
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.5, color: C.midnight, opacity: 0.8, marginBottom: 14 }}>
          {PROMPT_LINES.join(" ")}
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX_CHARS))}
          placeholder="Your thoughts…"
          autoFocus
          style={textarea}
        />
        {phase === "sent" && (
          <div style={{ ...note, color: C.blue }}>Thanks for your thoughts!</div>
        )}
        {phase === "rate-limited" && (
          <div style={{ ...note, color: C.midnight }}>Give it a moment before sending another.</div>
        )}
        {phase === "error" && (
          <div style={{ ...note, color: C.red }}>Couldn&rsquo;t send &mdash; please try again.</div>
        )}
        <button
          onClick={handleSend}
          disabled={!message.trim() || phase === "sending"}
          style={{ ...sendBtn, opacity: (!message.trim() || phase === "sending") ? M.disabledOpacity : 1 }}
        >
          {phase === "sending" ? <>Sending<LoadingDots /></> : "Send"}
        </button>
      </div>
    </div>
  );
}

const dim: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1000, background: "rgba(26,58,74,0.35)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
  animation: "mDimIn 180ms ease-out",
};
const sheet: React.CSSProperties = {
  ...OVERLAY.sheet, position: "relative", background: C.cream,
};
const textarea: React.CSSProperties = {
  // Sky ring as an inset shadow (the on-cream input convention) so the edge
  // can't shift on focus.
  width: "100%", boxSizing: "border-box", minHeight: 120, resize: "vertical",
  border: "none", boxShadow: `inset 0 0 0 2px ${C.sky}`, borderRadius: 12, padding: "12px 16px",
  fontFamily: '"Inter", system-ui, sans-serif', fontSize: 16, color: C.midnight,
  outline: "none", marginBottom: 12,
};
const note: React.CSSProperties = { fontSize: 13, fontWeight: 700, marginBottom: 10 };
const sendBtn: React.CSSProperties = {
  ...M.pill.L, width: "100%", background: C.blue, color: C.cream,
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
};
