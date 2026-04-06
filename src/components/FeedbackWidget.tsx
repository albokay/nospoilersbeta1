import React, { useState } from "react";
import { useAuth } from "../lib/auth";
import { useLocation } from "react-router-dom";
import { insertFeedback } from "../lib/db";

const MAX_CHARS = 2000;
const PROMPT_LINES = [
  "Let me know how things are working.",
  "Any suggestions?",
  "Anything confusing?",
  "Anything glitching?",
  "Anything exciting?",
  "Anything you love or want more of?",
];

function canSubmit(): boolean {
  const last = localStorage.getItem("ns_fb_last");
  if (!last) return true;
  return Date.now() - parseInt(last, 10) > 20_000;
}

export default function FeedbackWidget({ isMobile }: { isMobile: boolean }) {
  const { user, profile } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "rate-limited">("idle");

  if (!user) return null;

  const handleOpen = () => { setOpen(true); setPhase("idle"); };
  const handleClose = () => { setOpen(false); };

  const handleSend = async () => {
    if (!message.trim() || phase === "sending") return;
    if (!canSubmit()) { setPhase("rate-limited"); return; }
    setPhase("sending");
    try {
      await insertFeedback(
        user.id,
        profile?.username ?? "",
        location.pathname,
        message.trim()
      );
      localStorage.setItem("ns_fb_last", String(Date.now()));
      setPhase("sent");
      setMessage("");
      setTimeout(() => { setPhase("idle"); setOpen(false); }, 1000);
    } catch {
      setPhase("idle");
    }
  };

  return (
    <>
      {/* Trigger: vertical tab (desktop) or floating button (mobile) */}
      {!open && (
        isMobile ? (
          <button
            onClick={handleOpen}
            style={{
              position: "fixed", bottom: 24, right: 20, zIndex: 10000,
              background: "#f45028", color: "#fff", border: "none",
              borderRadius: 9999, padding: "10px 18px",
              fontWeight: 700, fontSize: 13, cursor: "pointer",
              boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
            }}
          >
            feedback
          </button>
        ) : (
          <div
            onClick={handleOpen}
            style={{
              position: "fixed", right: 0, top: "75%",
              transform: "translateY(-50%) rotate(180deg)",
              writingMode: "vertical-rl" as React.CSSProperties["writingMode"],
              zIndex: 10000,
              background: "#fff", color: "var(--dos-bg)",
              padding: "14px 9px",
              cursor: "pointer", fontWeight: 700, fontSize: 13,
              letterSpacing: 0.4, borderRadius: "0 8px 8px 0",
              userSelect: "none" as React.CSSProperties["userSelect"],
              boxShadow: "-2px 2px 8px rgba(0,0,0,0.18)",
            }}
          >
            feedback
          </div>
        )
      )}

      {/* Backdrop */}
      {open && (
        <div
          onClick={handleClose}
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(0,0,0,0.18)",
          }}
        />
      )}

      {/* Slide panel */}
      <div
        style={{
          position: "fixed",
          zIndex: 10001,
          background: "var(--dos-bg)",
          transition: "transform 0.28s ease",
          display: "flex",
          flexDirection: "column",
          ...(isMobile ? {
            bottom: 0, left: 0, right: 0,
            maxHeight: "80vh",
            transform: open ? "translateY(0)" : "translateY(100%)",
            borderRadius: "16px 16px 0 0",
            boxShadow: "0 -4px 24px rgba(0,0,0,0.22)",
          } : {
            top: 0, right: 0, bottom: 0, width: 340,
            transform: open ? "translateX(0)" : "translateX(100%)",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.22)",
          }),
        }}
      >
        {/* Panel header */}
        <div style={{
          padding: "18px 20px 12px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderBottom: "2px solid var(--dos-border)",
        }}>
          <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: 0.3 }}>
            Send me your thoughts
          </div>
          <button
            onClick={handleClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 18, color: "var(--dos-fg)", padding: 4, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Panel body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Prompt header */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {PROMPT_LINES.map((line, i) => (
              <div key={i} style={{
                fontWeight: 700, fontSize: 15, lineHeight: 1.5,
                color: "var(--dos-fg)", opacity: 0.85,
              }}>
                {line}
              </div>
            ))}
          </div>

          {/* Textarea */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, MAX_CHARS))}
              rows={6}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "#fff", color: "#000",
                border: "2px solid var(--dos-border)", borderRadius: 8,
                padding: "10px 12px", fontSize: 14,
                resize: "vertical", lineHeight: 1.5,
                fontFamily: "inherit",
              }}
            />
            <div style={{
              textAlign: "right", fontSize: 11,
              color: message.length > MAX_CHARS * 0.85 ? "var(--danger)" : "rgba(0,0,0,0.35)",
            }}>
              {message.length} / {MAX_CHARS}
            </div>
          </div>

          {/* Feedback states */}
          {phase === "sent" && (
            <div style={{ fontWeight: 800, fontSize: 15, color: "var(--dos-fg)", textAlign: "center" }}>
              Thanks for your thoughts!
            </div>
          )}
          {phase === "rate-limited" && (
            <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>
              Give it a moment before sending another.
            </div>
          )}

          {/* Send button */}
          {phase !== "sent" && (
            <button
              onClick={handleSend}
              disabled={!message.trim() || phase === "sending"}
              className="btn primary"
              style={{ width: "100%", fontWeight: 700, fontSize: 14, opacity: (!message.trim() || phase === "sending") ? 0.5 : 1 }}
            >
              {phase === "sending" ? "Sending…" : "Send"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
