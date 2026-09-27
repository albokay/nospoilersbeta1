import React, { useState } from "react";
import { CANON } from "../styles/canon";
import Stamp from "./Stamp";
import { ROOM_LETTER, roomLetterKey } from "../lib/tipsContent";

// The letter from Sidebar (Alborz 2026-09-26): the show room's one
// explainer, leading the feed — where Sidebar says the letters framing
// out loud and folds in what the progress sticky used to say. It replaced
// the progress-picker sticky: shows on entrance for everyone until
// "got it" (one flag per account, per device, like every tip); the room
// header's "?" brings it back on both platforms (controlled via
// `open`/`onDismiss`; self-managed when `open` is omitted).
// Its stamp is the perforated frame in Friend blue reading Season /
// Episode: a stamp, never the logo.
const LORA = '"Lora", Georgia, serif';

export default function SidebarLetter({ idiom, userId, firstName, open, onDismiss }: {
  idiom: "desktop" | "mobile";
  userId: string;
  firstName: string;
  /** Controlled visibility (desktop "?"); omitted = self-managed (mobile). */
  open?: boolean;
  onDismiss?: () => void;
}) {
  const [selfDismissed, setSelfDismissed] = useState<boolean>(() => {
    try { return !!localStorage.getItem(roomLetterKey(userId)); } catch { return false; }
  });
  const visible = open !== undefined ? open : !selfDismissed;
  if (!visible) return null;

  function dismiss() {
    try { localStorage.setItem(roomLetterKey(userId), "1"); } catch { /* tolerate */ }
    setSelfDismissed(true);
    onDismiss?.();
  }

  const m = idiom === "mobile";
  const body: React.CSSProperties = { margin: 0, fontFamily: '"Inter", sans-serif', fontSize: m ? 14 : 17, lineHeight: 1.55, color: CANON.dark, maxWidth: 640 };
  return (
    <div
      role="note"
      aria-label="A letter from Sidebar"
      style={{
        position: "relative", background: CANON.cream, color: CANON.dark,
        borderRadius: m ? 22 : 28, boxSizing: "border-box",
        padding: m ? "22px 20px 20px" : "34px 40px 30px",
        boxShadow: "0 10px 30px rgba(26,58,74,0.12)",
        marginBottom: m ? 14 : 22,
      }}
    >
      <div style={{ position: "absolute", right: m ? 16 : 34, top: m ? 16 : 28 }}>
        <Stamp label={"Season\nEpisode"} variant={1} ink={CANON.friend} scale={m ? 0.72 : 1} />
      </div>
      {/* The greeting + headline clear the stamp; the paragraphs start
          below it and run the card's width. */}
      <div style={{ paddingRight: m ? 84 : 130, boxSizing: "border-box" }}>
        <div style={{ fontFamily: LORA, fontSize: m ? 16 : 20, color: CANON.identity, marginBottom: m ? 6 : 8 }}>Dear {firstName},</div>
        <div className="sb-balance" style={{ fontFamily: LORA, fontWeight: 700, fontSize: m ? 22 : 30, lineHeight: 1.2, color: CANON.identity, maxWidth: 560, marginBottom: m ? 12 : 14 }}>
          {ROOM_LETTER.headline}
        </div>
      </div>
      <p style={body}>{ROOM_LETTER.p1}</p>
      <p style={{ ...body, marginTop: m ? 10 : 14 }}>{m ? ROOM_LETTER.p2Mobile : ROOM_LETTER.p2}</p>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: m ? 16 : 22 }}>
        <span style={{ fontFamily: LORA, fontStyle: "italic", fontSize: m ? 15 : 18, color: CANON.dark }}>{ROOM_LETTER.signoff}</span>
        <button
          type="button"
          onClick={dismiss}
          style={{ height: m ? 44 : 48, padding: "0 26px", borderRadius: 9999, border: 0, background: CANON.identity, color: CANON.cream, font: '700 16px "Inter", sans-serif', cursor: "pointer" }}
        >
          {ROOM_LETTER.cta}
        </button>
      </div>
    </div>
  );
}
