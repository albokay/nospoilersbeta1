/**
 * MobileTipsSheet — the mobile pointer-tips surface (help-system arc CP4).
 *
 * Docked: a cream "?" circle pinned bottom-RIGHT, above the deck card's
 * docked title (QA round 1 — was a bottom-left "tips" tab; the "?" mark
 * matches the desktop button but in Friend color). Open: a left-justified
 * bottom sheet with the page's tips. Dismiss = tap outside OR swipe down
 * on the sheet (the swipe gesture is built here first; rolling it out to
 * the app's other bottom sheets is a later arc — Alborz). Copy-only
 * pointers, no links inside tips (locked).
 *
 * First-visit auto-open for post-launch accounts, like desktop; dismissing
 * stamps the seen flag and the tab reopens the sheet anytime.
 */
import React, { useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import TipText from "./TipText";
import { CANON } from "../styles/canon";
import { tipsFor, tipsDefaultOpen, markTipsSeen, type TipsPage } from "../lib/tipsContent";

export default function MobileTipsSheet({ page }: { page: TipsPage }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(() => tipsDefaultOpen(page, user?.created_at));
  // Swipe-down: track the drag so the sheet follows the finger; release past
  // the threshold closes, otherwise it springs back.
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  const tips = tipsFor(page, "mobile");

  function close() {
    markTipsSeen(page);
    setOpen(false);
    setDragY(0);
    startY.current = null;
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} aria-label="tips" style={tabStyle}>?</button>;
  }

  return (
    <div
      // zIndex sits BELOW the deck waves/drip (1000): if a must-answer card
      // and a first-visit auto-open collide, the card wins and the tips wait
      // underneath.
      style={{ position: "fixed", inset: 0, zIndex: 990, background: "rgba(26,58,74,0.35)" }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
        onTouchMove={(e) => {
          if (startY.current == null) return;
          const d = e.touches[0].clientY - startY.current;
          if (d > 0) setDragY(d);
        }}
        onTouchEnd={() => {
          if (dragY > 80) { close(); return; }
          setDragY(0);
          startY.current = null;
        }}
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          background: CANON.cream, borderRadius: "24px 24px 0 0",
          boxShadow: "0 -8px 28px rgba(0,0,0,0.28)",
          padding: "16px 20px calc(env(safe-area-inset-bottom, 0px) + 22px)",
          transform: `translateY(${dragY}px)`,
          transition: startY.current == null ? "transform .18s ease" : "none",
        }}
      >
        {/* Grab handle — signals the swipe-down affordance. */}
        <div style={{ width: 44, height: 4, borderRadius: 2, background: "rgba(26,58,74,0.25)", margin: "0 auto 14px" }} />
        {tips.map((t, i) => (
          <div key={i} style={{ marginTop: i === 0 ? 0 : 14 }}>
            <p style={tipText}><TipText text={t.body} /></p>
            {t.aside && <p style={{ ...tipText, marginTop: 5, fontStyle: "italic", opacity: 0.85 }}><TipText text={t.aside} /></p>}
          </div>
        ))}
      </div>
    </div>
  );
}

const tipText: React.CSSProperties = {
  margin: 0, fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.5,
  color: CANON.dark, textAlign: "left",
};

// "?" circle, bottom-right above the deck card's docked title — cream fill,
// Friend-color mark (matches the desktop "?" glyph).
const tabStyle: React.CSSProperties = {
  position: "fixed", right: 14, bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)",
  zIndex: 40, width: 44, height: 44, borderRadius: "50%",
  background: CANON.cream, color: CANON.friend, border: "none",
  fontFamily: '"Inter", sans-serif', fontWeight: 800, fontSize: 18, lineHeight: 1,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
};
