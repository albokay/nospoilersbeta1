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
import { useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import StickyNote from "./StickyNote";
import TipText from "./TipText";
import { tipsFor, GROUP_ROOM_TIPS, type Tip, type TipsPage } from "../lib/tipsContent";

function TipBody({ tip, first = true }: { tip: Tip; first?: boolean }) {
  return (
    <>
      <p style={{ margin: first ? 0 : "10px 0 0" }}><TipText text={tip.body} /></p>
      {tip.aside && (
        <p style={{ margin: "8px 0 0", fontStyle: "italic", opacity: 0.85 }}><TipText text={tip.aside} /></p>
      )}
    </>
  );
}

export default function TipsNote({ page, onDismiss }: {
  page: TipsPage;
  onDismiss: () => void;
}) {
  // Stepper index (group room). The component unmounts when the "?" closes,
  // so a re-open always starts back at the welcome tip.
  const [idx, setIdx] = useState(0);
  // Entrance fade only on first appearance — stepping swaps instantly.
  const [stepped, setStepped] = useState(false);
  function step(delta: number) {
    setStepped(true);
    setIdx((i) => Math.max(0, Math.min(GROUP_ROOM_TIPS.length - 1, i + delta)));
  }

  // The shell's >=1160px gate is skipped throughout: these only exist when
  // the user pressed "?" (or first-visit auto-open) — hiding them then
  // would make the button feel dead on narrow desktop windows.
  if (page === "groupRoom") {
    const t = GROUP_ROOM_TIPS[idx];
    const atStart = idx === 0;
    const atEnd = idx === GROUP_ROOM_TIPS.length - 1;
    return (
      <StickyNote
        key={idx}
        tilt={t.tilt}
        width={300}
        centered
        onDismiss={onDismiss}
        ariaLabel="Tips"
        ignoreViewportGate
        animateEntrance={!stepped}
        style={{ top: t.top, left: t.left }}
      >
        <TipBody tip={t} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
          <button aria-label="previous tip" disabled={atStart} onClick={() => step(-1)}
            style={{ ...stepBtn, opacity: atStart ? 0.3 : 1, cursor: atStart ? "default" : "pointer" }}>
            <ChevronLeft size={18} />
          </button>
          <button aria-label="next tip" disabled={atEnd} onClick={() => step(1)}
            style={{ ...stepBtn, opacity: atEnd ? 0.3 : 1, cursor: atEnd ? "default" : "pointer" }}>
            <ChevronRight size={18} />
          </button>
        </div>
      </StickyNote>
    );
  }
  const tips = tipsFor(page, "desktop");
  return (
    <StickyNote
      tilt={-2}
      width={300}
      centered
      onDismiss={onDismiss}
      ariaLabel="Tips"
      ignoreViewportGate
      style={{ top: 210, left: "min(calc(75vw + 180px), calc(100vw - 250px))" }}
    >
      {tips.map((t, i) => <TipBody key={i} tip={t} first={i === 0} />)}
    </StickyNote>
  );
}

// Bare chevron steppers on the paper — inherit the sticky's text color.
const stepBtn: CSSProperties = {
  background: "transparent", border: "none", padding: 4,
  color: "inherit", display: "flex", alignItems: "center",
};
