/**
 * TipsNote — the desktop "?" pointer-tips stickies (help-system arc CP4).
 *
 * Dashboard: one cream StickyNote holding its tips as short paragraphs.
 * Group room (QA rounds 1–2): the four placed tips (which absorbed the
 * retired GroupRoomSticky's copy) show ONE at a time — all four at once
 * was overwhelming — stepped with < > in GROUP_ROOM_TIPS order; each step
 * appears at its own placed spot beside what it explains. < is greyed on
 * the first tip, > on the last; the X dismisses the set.
 *
 * The PARENT owns the "?" toggle + open state and stamps the page's seen
 * flag on dismiss (so first-visit auto-open never returns). Parenthetical
 * asides render italic + muted, the retired sticky's grammar.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import StickyNote from "./StickyNote";
import TipText from "./TipText";
import { tipsFor, GROUP_ROOM_TIPS, DASHBOARD_TIP_SEAT, type Tip, type TipsPage } from "../lib/tipsContent";
import { useEditorial } from "../lib/skin";

function TipBody({ tip, first = true }: { tip: Tip; first?: boolean }) {
  return (
    <>
      {tip.body.split("\n\n").map((p, i) => (
        <p
          key={i}
          style={{
            margin: first && i === 0 ? 0 : "10px 0 0",
            // First paragraph clears the dismiss X (QA round 4).
            ...(i === 0 ? { paddingRight: 16 } : {}),
            // Parenthetical paragraphs render italic (mid-body caveats).
            ...(p.startsWith("(") ? { fontStyle: "italic", opacity: 0.85 } : {}),
          }}
        >
          <TipText text={p} />
        </p>
      ))}
      {tip.aside && (
        <p style={{ margin: "8px 0 0", fontStyle: "italic", opacity: 0.85 }}><TipText text={tip.aside} /></p>
      )}
    </>
  );
}

// 2026-09-13 (Alborz): the stickies used to be viewport-FIXED, so the page
// scrolled behind them and they drifted off whatever they point at. This
// absolute frame replicates the viewport at the page top and scrolls WITH
// the content; the stickies keep their placed coordinates inside it.
const scrollFrame: CSSProperties = {
  position: "absolute", top: 0, left: 0, width: "100%", height: "100vh",
  pointerEvents: "none", zIndex: 60,
};

export default function TipsNote({ page, onDismiss }: {
  page: TipsPage;
  onDismiss: () => void;
}) {
  const editorial = useEditorial();
  // Stepper index (group room). The component unmounts when the "?" closes,
  // so a re-open always starts back at the welcome tip.
  const [idx, setIdx] = useState(0);
  // Entrance fade only on first appearance — stepping swaps instantly.
  const [stepped, setStepped] = useState(false);
  function step(delta: number) {
    setStepped(true);
    setIdx((i) => Math.max(0, Math.min(GROUP_ROOM_TIPS.length - 1, i + delta)));
  }

  // Tips about a viewport-fixed control measure that control (tagged
  // data-tip-anchor) and pin beside it. Tips SEATED in the page (2026-10-13)
  // measure their tagged element against the scroll frame and sit at its
  // corner plus the seat's offset, scrolling with the page. Re-measured per
  // step, on resize and whenever the page's height changes (rows loading
  // in move the anchors); layout effect so the first paint is in place.
  const frameRef = useRef<HTMLDivElement>(null);
  const anchorKey = page === "groupRoom" ? GROUP_ROOM_TIPS[idx]?.anchor : undefined;
  const seat = page === "groupRoom" ? GROUP_ROOM_TIPS[idx]?.seat : DASHBOARD_TIP_SEAT;
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [seatPos, setSeatPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (anchorKey) {
        const el = document.querySelector(`[data-tip-anchor="${anchorKey}"]`);
        setAnchorRect(el ? el.getBoundingClientRect() : null);
      } else setAnchorRect(null);
      const frame = frameRef.current;
      const el = seat ? document.querySelector(`[data-tip-anchor="${seat.anchor}"]`) : null;
      if (seat && el && frame) {
        const a = el.getBoundingClientRect(), f = frame.getBoundingClientRect();
        const next = { left: Math.round(a.left - f.left + seat.dx), top: Math.round(a.top - f.top + seat.dy) };
        setSeatPos((p) => (p && p.left === next.left && p.top === next.top ? p : next));
      } else setSeatPos(null);
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(document.body);
    return () => { window.removeEventListener("resize", measure); ro?.disconnect(); };
  }, [anchorKey, seat]);

  // The shell's >=1160px gate is skipped throughout: these only exist when
  // the user pressed "?" (or first-visit auto-open) — hiding them then
  // would make the button feel dead on narrow desktop windows.
  if (page === "groupRoom") {
    const t = GROUP_ROOM_TIPS[idx];
    const atStart = idx === 0;
    const atEnd = idx === GROUP_ROOM_TIPS.length - 1;
    // Deck tip: its bottom edge 16px above the docked tab, left edge on the
    // tab's title text — FIXED, the tab is. No target found (the deck dock
    // self-hides) → the static page placement. A seated tip sits at its
    // measured spot in the scroll frame; no tag → the static placement.
    const pinned: CSSProperties | null = t.anchor && anchorRect
      ? { position: "fixed", left: anchorRect.left + 24, bottom: window.innerHeight - anchorRect.top + 16 }
      : null;
    const seated: CSSProperties = seatPos
      ? { position: "absolute", top: seatPos.top, left: seatPos.left, pointerEvents: "auto" }
      : { position: "absolute", top: t.top, left: t.left, pointerEvents: "auto" };
    const note = (
      <StickyNote
        key={idx}
        tilt={t.tilt}
        width={300}
        centered={!pinned}
        onDismiss={onDismiss}
        ariaLabel="Tips"
        ignoreViewportGate
        fontSize={15}
        dismissSize={20}
        animateEntrance={!stepped}
        entranceDelayMs={0}
        // Subtle drop shadow (Alborz 2026-08-15) — lifts the tip off the page.
        boxShadow="0 4px 14px rgba(0,0,0,0.13)"
        style={pinned ? { ...pinned, pointerEvents: "auto" } : seated}
      >
        <TipBody tip={t} />
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 10 }}>
          <button aria-label="previous tip" disabled={atStart} onClick={() => step(-1)}
            style={{ ...stepBtn, opacity: atStart ? 0.3 : 1, cursor: atStart ? "default" : "pointer" }}>
            <ChevronLeft size={18} />
          </button>
          <span style={{ opacity: 0.5, fontSize: 13, fontWeight: 700 }}>Tip {idx + 1} of {GROUP_ROOM_TIPS.length}</span>
          <button aria-label="next tip" disabled={atEnd} onClick={() => step(1)}
            style={{ ...stepBtn, opacity: atEnd ? 0.3 : 1, cursor: atEnd ? "default" : "pointer" }}>
            <ChevronRight size={18} />
          </button>
        </div>
      </StickyNote>
    );
    return pinned ? note : <div ref={frameRef} style={scrollFrame}>{note}</div>;
  }
  const tips = tipsFor(page, "desktop", editorial);
  return (
    <div ref={frameRef} style={scrollFrame}>
    <StickyNote
      tilt={-2}
      width={300}
      centered
      onDismiss={onDismiss}
      ariaLabel="Tips"
      ignoreViewportGate
      fontSize={15}
      dismissSize={20}
      entranceDelayMs={0}
      // Subtle drop shadow (Alborz 2026-08-15) — lifts the tip off the page.
      boxShadow="0 4px 14px rgba(0,0,0,0.13)"
      // Seated over the right half of the group rows from the second row
      // down (his scribble, 2026-10-13); the old spot beside the clusters
      // stays as the fallback when the editorial head isn't on the page.
      style={seatPos
        ? { position: "absolute", top: seatPos.top, left: seatPos.left, pointerEvents: "auto" }
        : { position: "absolute", top: "36%", left: "min(calc(50% + 340px), calc(100vw - 180px))", pointerEvents: "auto" }}
    >
      {tips.map((t, i) => <TipBody key={i} tip={t} first={i === 0} />)}
    </StickyNote>
    </div>
  );
}

// Bare chevron steppers on the paper — inherit the sticky's text color.
const stepBtn: CSSProperties = {
  background: "transparent", border: "none", padding: 4,
  color: "inherit", display: "flex", alignItems: "center",
};
