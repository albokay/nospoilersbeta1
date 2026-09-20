/**
 * MobileTipsSheet — the mobile pointer-tips surface (help-system arc CP4).
 *
 * The "?" circle renders IN PLACE (Alborz 2026-08-14 — it lives in the
 * page's top chrome now and scrolls away with it; the old fixed bottom-
 * right dock is retired): mount the component where the button belongs —
 * the dashboard's top-right circle row / the group room's header corner —
 * and it renders a static cream circle with the Friend-color "?" mark
 * (matches the desktop button). `tabStyle` tweaks size to sit flush with
 * sibling buttons. Open: a left-justified bottom sheet with the page's
 * tips (the sheet itself is fixed, so the mount point doesn't matter to
 * it). Dismiss = tap outside, swipe-down, or the grabber gesture (polish
 * pass 2026-09-14 — the × is gone; the swipe hook's scrollRef gate lets
 * long tip sets scroll while the sheet still swipes away from the top,
 * resolving the 2026-08-01 swipe-vs-scroll retirement; the sheet caps at
 * ~55% of the viewport and the TIPS scroll past that). Copy-only
 * pointers, no links inside tips (locked strings; the polish pass strips
 * aside parentheses at RENDER only).
 *
 * First-visit auto-open for post-launch accounts, like desktop; dismissing
 * stamps the seen flag and the tab reopens the sheet anytime.
 */
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import TipText from "./TipText";
import { CANON } from "../styles/canon";
import { OVERLAY, LORA } from "../mobile/m";
import useSheetSwipeDown from "../lib/useSheetSwipeDown";
import { tipsFor, tipsDefaultOpen, markTipsSeen, type TipsPage } from "../lib/tipsContent";

/** Presentation-only paren strip (polish pass 2026-09-14): asides render as
 *  italic captions without their wrapping parentheses — the SOURCE strings in
 *  tipsContent.ts are locked and untouched. */
function deparen(t: string): string {
  const m = t.trim().match(/^\((.*)\)$/s);
  return m ? m[1] : t;
}

export default function MobileTipsSheet({ page, tabStyle: tabOverride }: { page: TipsPage; tabStyle?: React.CSSProperties }) {
  const { user } = useAuth();
  // First-visit auto-open ARRIVES, it doesn't preexist (Alborz 2026-08-01):
  // the page paints tip-less first, then the sheet rises in after a beat —
  // so the tip reads as an event, not furniture. Manual "?" opens stay
  // instant (the keyframe still plays, which is fine).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!tipsDefaultOpen(page, user?.id, user?.created_at)) return;
    const t = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, user?.id]);
  const tips = tipsFor(page, "mobile");
  const scrollRef = useRef<HTMLDivElement>(null);

  function close() {
    markTipsSeen(page, user?.id);
    setOpen(false);
  }

  // Swipe-down joins tap-out as an exit (polish pass 2026-09-14); the
  // scrollRef gate keeps long tip sets scrolling normally — the sheet only
  // follows the finger while the tips sit at their top (which resolves the
  // 2026-08-01 swipe-vs-scroll conflict that retired the gesture here).
  const swipe = useSheetSwipeDown(close, { scrollRef, open });

  if (!open) {
    return <button onClick={() => setOpen(true)} aria-label="tips" style={{ ...tabStyle, ...tabOverride }}>?</button>;
  }

  return (
    <div
      // zIndex sits BELOW the deck waves/drip (1000): if a must-answer card
      // and a first-visit auto-open collide, the card wins and the tips wait
      // underneath.
      style={{ position: "fixed", inset: 0, zIndex: 990, background: "rgba(26,58,74,0.35)", animation: "mDimIn 180ms ease-out" }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        {...swipe.handlers}
        style={{
          ...OVERLAY.sheet,
          position: "absolute", left: 0, right: 0, bottom: 0,
          background: CANON.cream,
          display: "flex", flexDirection: "column",
          // Scroll threshold: past ~55% of the viewport the TIPS scroll
          // (short sets never hit it); the sheet itself never scrolls — the
          // inner div does, so the swipe hook's scrollRef gate works.
          maxHeight: "55dvh", overflowY: "hidden",
          ...swipe.style,
        }}
      >
        <div style={OVERLAY.grabber(CANON.dark)} />
        <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: 22, lineHeight: 1.25, color: CANON.dark, marginBottom: 12 }}>Tips</div>
        <div ref={scrollRef} style={{ overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
        {tips.map((t, i) => (
          <div key={i} style={{ marginTop: i === 0 ? 0 : 14 }}>
            {t.body.split("\n\n").map((p, j) => (
              <p key={j} style={{ ...tipText, ...(j > 0 ? { marginTop: 5 } : {}), ...(p.trim().startsWith("(") ? { fontSize: 13, fontStyle: "italic", opacity: 0.75 } : {}) }}>
                <TipText text={p.trim().startsWith("(") ? deparen(p) : p} />
              </p>
            ))}
            {t.aside && <p style={{ ...tipText, marginTop: 5, fontSize: 13, fontStyle: "italic", opacity: 0.75 }}><TipText text={deparen(t.aside)} /></p>}
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}

const tipText: React.CSSProperties = {
  margin: 0, fontFamily: '"Inter", sans-serif', fontSize: 15, lineHeight: 1.5,
  color: CANON.dark, textAlign: "left",
};

// "?" circle — cream fill, Friend-color mark (matches the desktop "?"
// glyph). Static: it renders wherever the component is mounted (the page's
// top chrome) and scrolls with it.
const tabStyle: React.CSSProperties = {
  width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
  background: CANON.cream, color: CANON.friend, border: "none",
  fontFamily: '"Inter", sans-serif', fontWeight: 800, fontSize: 18, lineHeight: 1,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer",
};
