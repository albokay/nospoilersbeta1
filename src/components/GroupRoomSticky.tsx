import { useState } from "react";
import StickyNote from "./StickyNote";

/**
 * GroupRoomSticky — a once-only explainer note shown in a group room (the
 * dashboard's group context). Tells a new member that the group's shows pile up
 * over time, that selections are shared, and where the chat lives. Dismissible;
 * once dismissed it stays gone for that person (remembered in the browser — no
 * DB, no migration). Renders on the shared StickyNote shell (cream paper, dark
 * blue text, slight tilt, fade-in).
 */
const DISMISS_KEY = "ns_group_room_sticky_dismissed";

export default function GroupRoomSticky() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  function handleDismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* tolerate */ }
    setHidden(true);
  }

  if (hidden) return null;

  return (
    <StickyNote
      ariaLabel="Group room tips"
      tone="cream"
      tilt={3}
      width={300}
      centered
      padding="16px 18px"
      fontSize={14}
      lineHeight={1.5}
      dismissSize={17}
      onDismiss={handleDismiss}
      // Vertically centered ("about halfway up the page"); horizontally centered
      // in the right gutter — clamped so it never runs off-screen.
      style={{
        top: "calc(50% + 40px)",
        left: "min(calc(75vw + 180px), calc(100vw - 250px))",
        zIndex: 60,
      }}
    >
      <div style={{ paddingRight: 12 }}>
        Shows you and your friends add accumulate here. You can opt into each
        other{"’"}s selections and anyone can start a room for any show. Use
        the 💬 button on the right to chat about what you want to watch.
      </div>
      <div style={{ marginTop: 8, fontStyle: "italic", opacity: 0.85 }}>
        (Careful, the chat box isn{"’"}t spoiler-gated!)
      </div>
    </StickyNote>
  );
}
