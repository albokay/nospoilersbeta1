/**
 * MobileTipsSheet — the mobile pointer-tips surface (help-system arc CP4).
 *
 * Docked: a cream "?" circle pinned bottom-RIGHT, above the deck card's
 * docked title (QA round 1 — was a bottom-left "tips" tab; the "?" mark
 * matches the desktop button but in Friend color). Open: a left-justified
 * bottom sheet with the page's tips. Dismiss = tap outside OR swipe down
 * on the sheet (built here first, now shared app-wide via
 * useSheetSwipeDown — 2026-07-28 rollout). Copy-only pointers, no links
 * inside tips (locked).
 *
 * First-visit auto-open for post-launch accounts, like desktop; dismissing
 * stamps the seen flag and the tab reopens the sheet anytime.
 */
import React, { useState } from "react";
import { useAuth } from "../lib/auth";
import TipText from "./TipText";
import { CANON } from "../styles/canon";
import useSheetSwipeDown from "../lib/useSheetSwipeDown";
import { tipsFor, tipsDefaultOpen, markTipsSeen, type TipsPage } from "../lib/tipsContent";

export default function MobileTipsSheet({ page }: { page: TipsPage }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(() => tipsDefaultOpen(page, user?.id, user?.created_at));
  const tips = tipsFor(page, "mobile");

  function close() {
    markTipsSeen(page, user?.id);
    setOpen(false);
  }

  const swipe = useSheetSwipeDown(close);

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
        {...swipe.handlers}
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          background: CANON.cream, borderRadius: "24px 24px 0 0",
          boxShadow: "0 -8px 28px rgba(0,0,0,0.28)",
          padding: "16px 20px calc(env(safe-area-inset-bottom, 0px) + 22px)",
          ...swipe.style,
        }}
      >
        {/* Grab handle — signals the swipe-down affordance. */}
        <div style={{ width: 44, height: 4, borderRadius: 2, background: "rgba(26,58,74,0.25)", margin: "0 auto 14px" }} />
        {tips.map((t, i) => (
          <div key={i} style={{ marginTop: i === 0 ? 0 : 14 }}>
            {t.body.split("\n\n").map((p, j) => (
              <p key={j} style={{ ...tipText, ...(j > 0 ? { marginTop: 5 } : {}), ...(p.startsWith("(") ? { fontStyle: "italic", opacity: 0.85 } : {}) }}>
                <TipText text={p} />
              </p>
            ))}
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
