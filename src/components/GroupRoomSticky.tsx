import { useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * GroupRoomSticky — a once-only explainer note shown in a group room (the
 * dashboard's group context). Tells a new member that the group's shows pile up
 * over time, that selections are shared, and where the chat lives. Dismissible;
 * once dismissed it stays gone for that person (remembered in the browser — no
 * DB, no migration). Models the app's canon sticky-note look (cream paper, dark
 * blue text, slight tilt, fade-in).
 */
const STICKY_BG       = "#fef8ea";  // canon cream
const TEXT_COLOR      = "#355eb8";  // canon dark blue — readable on cream paper
const TILT_DEG        = 3;
const MIN_VIEWPORT_PX = 1160;        // hide on narrow viewports (matches the other stickies)
const ENTRY_TRANSITION_MS = 380;
const ENTRY_DELAY_MS      = 600;
const ENTRY_RISE_PX       = 18;
const DISMISS_KEY = "ns_group_room_sticky_dismissed";

export default function GroupRoomSticky() {
  const [wide, setWide] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= MIN_VIEWPORT_PX,
  );
  useEffect(() => {
    const fn = () => setWide(window.innerWidth >= MIN_VIEWPORT_PX);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [entered, setEntered] = useState(false);

  function handleDismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* tolerate */ }
    setHidden(true);
  }

  useLayoutEffect(() => {
    if (!hidden) {
      const t = window.setTimeout(() => setEntered(true), ENTRY_DELAY_MS);
      return () => window.clearTimeout(t);
    }
  }, [hidden]);

  if (!wide || hidden) return null;

  return (
    <div
      aria-label="Group room tips"
      style={{
        position: "fixed",
        // Vertically centered ("about halfway up the page"); horizontally
        // centered in the right gutter — midway between the centered content
        // column (max 1040) and the browser's right edge. Clamped so it never
        // runs off-screen on narrower windows.
        top: "50%",
        left: "min(calc(75vw + 180px), calc(100vw - 250px))",
        zIndex: 60,
        width: 300,
        transform: `translate(-50%, calc(-50% + ${entered ? 0 : ENTRY_RISE_PX}px)) rotate(${TILT_DEG}deg)`,
        transformOrigin: "center",
        opacity: entered ? 1 : 0,
        transition: `opacity ${ENTRY_TRANSITION_MS}ms ease-out, transform ${ENTRY_TRANSITION_MS}ms ease-out`,
        background: STICKY_BG,
        color: TEXT_COLOR,
        padding: "16px 18px",
        borderRadius: 0,
        boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          position: "absolute",
          top: 2,
          right: 4,
          background: "transparent",
          border: "none",
          padding: 6,
          color: "rgba(53,94,184,0.5)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <X size={17} />
      </button>

      <div style={{ paddingRight: 12 }}>
        Shows you and your friends add accumulate here. You can opt into each
        others{"’"} selections and anyone can start a room for any show. Use
        the 💬 button on the right to chat about what you want to watch.
      </div>
      <div style={{ marginTop: 8, fontStyle: "italic", opacity: 0.85 }}>
        (Careful, the chat box isn{"’"}t spoiler-gated!)
      </div>
    </div>
  );
}
