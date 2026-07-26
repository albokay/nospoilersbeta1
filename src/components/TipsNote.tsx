/**
 * TipsNote — the desktop "?" pointer-tips sticky (help-system arc CP4).
 * One cream StickyNote per page holding that page's tips as short
 * paragraphs (parenthetical caveats render italic + muted, matching
 * GroupRoomSticky's grammar). The PARENT owns the "?" toggle + open state;
 * this renders while open and reports dismissal (the parent stamps the
 * seen flag so first-visit auto-open never returns).
 *
 * Anchored high in the right gutter — same horizontal rail as
 * GroupRoomSticky (mid-page) but clear of it, so both can show in the
 * group room while the old sticky survives (Alborz: keep it for now).
 */
import StickyNote from "./StickyNote";
import { tipsFor, type TipsPage } from "../lib/tipsContent";

export default function TipsNote({ page, onDismiss }: {
  page: TipsPage;
  onDismiss: () => void;
}) {
  const tips = tipsFor(page, "desktop");
  return (
    <StickyNote
      tilt={-2}
      width={300}
      centered
      onDismiss={onDismiss}
      ariaLabel="Tips"
      // The shell's >=1160px gate is skipped: this sticky only exists when
      // the user pressed "?" (or first-visit auto-open) — hiding it then
      // would make the button feel dead on narrow desktop windows.
      ignoreViewportGate
      style={{ top: 210, left: "min(calc(75vw + 180px), calc(100vw - 250px))" }}
    >
      {tips.map((t, i) => (
        <p
          key={i}
          style={{
            margin: i === 0 ? 0 : "10px 0 0",
            ...(t.startsWith("(") ? { fontStyle: "italic", opacity: 0.85 } : {}),
          }}
        >
          {t}
        </p>
      ))}
    </StickyNote>
  );
}
