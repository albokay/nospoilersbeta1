import React, { useState } from "react";
import { CANON } from "../styles/canon";
import Stamp from "./Stamp";
import { ROOM_LETTER, roomLetterKey } from "../lib/tipsContent";
import { E } from "../styles/editorial";
import { SidebarPaper, FROM_LINE, FrameButton } from "./editorial/ShowRoom";

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

export default function SidebarLetter({ idiom, userId, firstName, open, onDismiss, editorial = false }: {
  idiom: "desktop" | "mobile";
  userId: string;
  firstName: string;
  /** Controlled visibility (desktop "?"); omitted = self-managed (mobile). */
  open?: boolean;
  onDismiss?: () => void;
  /** The editorial skin (checkpoint 4, 2026-10-12): the letter on its paper
   *  — a hairline frame with the sky stack, Sidebar's framed stamp, the mono
   *  FROM line, Lora throughout, "Got it" as a frame. Same words. */
  editorial?: boolean;
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
  if (editorial) {
    const pr = m ? 90 : 120;
    return (
      <SidebarPaper tone="alert" style={{ marginTop: 22, marginBottom: 16 }}>
        <span style={{ position: "absolute", right: 14, top: 12 }}>
          <Stamp spec={{ family: 2, ornament: 5, cancel: 0, tilt: 3 }} label={"Season\nEpisode"} ink={CANON.friend} lineWidth={1.4} scale={m ? 0.72 : 0.9} />
        </span>
        <div style={{ ...FROM_LINE, paddingRight: pr }}>From: Sidebar · Pinned</div>
        <div style={{ ...E.type.letterTitle22, marginTop: 12, paddingRight: pr }}>Dear {firstName},</div>
        <div className="sb-balance" style={{ ...E.type.letterTitle22, fontSize: 19, marginTop: 8, paddingRight: pr }}>{ROOM_LETTER.headline}</div>
        <p style={{ ...E.type.letterBody15, lineHeight: 1.55, margin: "10px 0 0" }}>{ROOM_LETTER.p0}</p>
        <p style={{ ...E.type.letterBody15, lineHeight: 1.55, margin: "10px 0 0" }}>{ROOM_LETTER.p1}</p>
        <p style={{ ...E.type.letterBody15, lineHeight: 1.55, margin: "10px 0 0" }}>{ROOM_LETTER.p1b}</p>
        <p style={{ ...E.type.letterBody15, lineHeight: 1.55, margin: "10px 0 0" }}>{m ? ROOM_LETTER.p2Mobile : ROOM_LETTER.p2}</p>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <span style={{ ...E.type.quote14, color: E.color.ink }}>{ROOM_LETTER.signoff}</span>
          <FrameButton onClick={dismiss}>{ROOM_LETTER.cta}</FrameButton>
        </div>
      </SidebarPaper>
    );
  }
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
        <Stamp spec={{ family: 2, ornament: 5, cancel: 0, tilt: 3 }} label={"Season\nEpisode"} ink={CANON.friend} scale={m ? 0.72 : 1} />
      </div>
      {/* The greeting + headline clear the stamp; the paragraphs start
          below it and run the card's width. */}
      <div style={{ paddingRight: m ? 84 : 130, boxSizing: "border-box" }}>
        <div style={{ fontFamily: LORA, fontSize: m ? 16 : 20, color: CANON.identity, marginBottom: m ? 6 : 8 }}>Dear {firstName},</div>
        <div className="sb-balance" style={{ fontFamily: LORA, fontWeight: 700, fontSize: m ? 22 : 30, lineHeight: 1.2, color: CANON.identity, maxWidth: 560, marginBottom: m ? 12 : 14 }}>
          {ROOM_LETTER.headline}
        </div>
      </div>
      <p style={body}>{ROOM_LETTER.p0}</p>
      <p style={{ ...body, marginTop: m ? 10 : 14 }}>{ROOM_LETTER.p1}</p>
      <p style={{ ...body, marginTop: m ? 10 : 14 }}>{ROOM_LETTER.p1b}</p>
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

/** The journal's note on the letter from Sidebar's paper (Alborz 2026-10-26):
 *  the room letter's card, his explainer exactly as it reads — no FROM line,
 *  no stamp, no "?" and no button — at the foot of the journal, always there. */
export function JournalLetter({ style }: { mobile?: boolean; style?: React.CSSProperties }) {
  return (
    <SidebarPaper tone="alert" style={style}>
      {/* His words, 2026-10-28 (Send is a copy now; his wording that evening). */}
      <div style={{ ...E.type.letterTitle22, fontSize: 19 }}>Sidebar is for your friends, but the journal tab is for you.</div>
      <p style={{ ...E.type.letterBody15, fontWeight: 700, color: E.color.ink, margin: "10px 0 0" }}>You can use it in two ways:</p>
      <p style={{ ...E.type.letterBody15, color: E.color.inkSub, margin: "10px 0 0" }}><span style={{ fontWeight: 700, color: E.color.ink }}>1. For yourself.</span> Your writing stays here and no one else ever sees it. We do some of our best thinking when we write.</p>
      <p style={{ ...E.type.letterBody15, color: E.color.inkSub, margin: "10px 0 0" }}><span style={{ fontWeight: 700, color: E.color.ink }}>2. As a publisher.</span> Watching a show with more than one friend group? Write it here once and send it to all of them. And if a friend later invites you to a show you&rsquo;ve already written about, you can hand over your journal &mdash; like a time capsule of your thoughts. Your writing stays here; each group gets its own copy.</p>
    </SidebarPaper>
  );
}
