/**
 * TipsNote — the desktop "?" pointer-tips stickies (help-system arc CP4).
 *
 * Dashboard: one cream StickyNote holding its tips as short paragraphs.
 * Group room (QA round 1): FOUR placed stickies, each beside what it
 * explains (shelves / gear / deck card / chat tab), per Alborz's markup —
 * these absorbed the old GroupRoomSticky's copy, which is retired.
 *
 * The PARENT owns the "?" toggle + open state; any sticky's X dismisses
 * the whole set (the parent stamps the page's seen flag so first-visit
 * auto-open never returns). Parenthetical asides render italic + muted,
 * the retired sticky's grammar.
 */
import StickyNote from "./StickyNote";
import { tipsFor, GROUP_ROOM_TIPS, type Tip, type TipsPage } from "../lib/tipsContent";

function TipBody({ tip, first = true }: { tip: Tip; first?: boolean }) {
  return (
    <>
      <p style={{ margin: first ? 0 : "10px 0 0" }}>{tip.body}</p>
      {tip.aside && (
        <p style={{ margin: "8px 0 0", fontStyle: "italic", opacity: 0.85 }}>{tip.aside}</p>
      )}
    </>
  );
}

export default function TipsNote({ page, onDismiss }: {
  page: TipsPage;
  onDismiss: () => void;
}) {
  // The shell's >=1160px gate is skipped throughout: these only exist when
  // the user pressed "?" (or first-visit auto-open) — hiding them then
  // would make the button feel dead on narrow desktop windows.
  if (page === "groupRoom") {
    return (
      <>
        {GROUP_ROOM_TIPS.map((t, i) => (
          <StickyNote
            key={i}
            tilt={t.tilt}
            width={300}
            centered
            onDismiss={onDismiss}
            ariaLabel="Tips"
            ignoreViewportGate
            style={{ top: t.top, left: t.left }}
          >
            <TipBody tip={t} />
          </StickyNote>
        ))}
      </>
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
