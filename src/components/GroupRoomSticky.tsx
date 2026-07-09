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
// CP3: the onboarding-bootstrap group gets its own explainer copy + its own
// dismissal, so dismissing one variant never hides the other.
const ONB_DISMISS_KEY = "ns_onb_group_sticky_dismissed";

export default function GroupRoomSticky({ onboarding = false }: { onboarding?: boolean }) {
  const key = onboarding ? ONB_DISMISS_KEY : DISMISS_KEY;
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  });

  function handleDismiss() {
    try { localStorage.setItem(key, "1"); } catch { /* tolerate */ }
    setHidden(true);
  }

  if (hidden) return null;

  if (onboarding) {
    return (
      <StickyNote
        ariaLabel="Your first show room"
        tone="cream"
        tilt={3}
        width={300}
        centered
        padding="16px 18px"
        fontSize={14}
        lineHeight={1.5}
        dismissSize={17}
        onDismiss={handleDismiss}
        style={{
          top: "calc(50% + 40px)",
          left: "min(calc(75vw + 180px), calc(100vw - 250px))",
          zIndex: 60,
        }}
      >
        <div style={{ paddingRight: 12 }}>
          <div>You have a room started for your first show.</div>
          <div style={{ marginTop: 12 }}>
            From now on, when you and your friends propose more shows, they get
            added to a {"“"}proposed shows{"”"} list. Everyone can vote for the
            shows they{"’"}re interested in, and anyone can start a room for any
            show.
          </div>
          <div style={{ marginTop: 12 }}>
            Use the 💬 button on the right to discuss what you want to watch.
          </div>
          <div style={{ marginTop: 12, fontStyle: "italic", opacity: 0.85 }}>
            (Careful, the chat box isn{"’"}t spoiler-gated!)
          </div>
        </div>
      </StickyNote>
    );
  }

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
