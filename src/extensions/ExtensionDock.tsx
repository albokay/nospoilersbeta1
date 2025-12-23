import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function ExtensionDock() {
  // --- portal host ---
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (!hostRef.current) {
    hostRef.current = document.createElement("div");
    hostRef.current.setAttribute("data-ext-dock-root", "true");
  }

useEffect(() => {
  const node = hostRef.current!;
  document.body.appendChild(node);

  // listen for progress updates from the main app
  const onProgress = (ev: Event) => {
    const { showId, s, e } = (ev as CustomEvent).detail || {};
    if (showId === FRIEND_SHOW && typeof s === "number" && typeof e === "number") {
      setBbProg({ s, e });
    }
  };
  window.addEventListener("dock:progress", onProgress as EventListener);

  return () => {
    try { document.body.removeChild(node); } catch {}
    window.removeEventListener("dock:progress", onProgress as EventListener);
  };
}, []);


  const hl = { color: "var(--dos-cyan)" };

  // Friend's latest episode for Breaking Bad (quietloop)
const FRIEND_SHOW = "bb";
const FRIEND_SEASON = 4;
const FRIEND_EPISODE = 5;

// Your current BB progress (updated by an event from the app)
const [bbProg, setBbProg] = useState<{ s: number; e: number }>({ s: 1, e: 1 });

const isMobile = window.matchMedia("(max-width: 700px)").matches;

const hasReachedFriendPost =
  bbProg.s > FRIEND_SEASON ||
  (bbProg.s === FRIEND_SEASON && bbProg.e >= FRIEND_EPISODE);


  const handleMikeClick = (e: React.MouseEvent) => {
  e.preventDefault();
  // Fire a custom event the main app can listen for (optional future wiring)
  window.dispatchEvent(
    new CustomEvent("dock:open-thread-by-title", {
      detail: {
        show: "Breaking Bad",
        title: "Gus Fring: The Most Polite Threat in TV History",
      },
    })
  );
  // Demo feedback so you can see it's clickable now
  try {
    alert('Link to friend alerts not working yet!');
  } catch {}
};

  const ui = (
<div
  style={{
    position: "fixed",
    bottom: 16,
    zIndex: 2147483000,

    // Desktop (current behavior)
    right: isMobile ? "auto" : 16,

    // Mobile (centered)
    left: isMobile ? "50%" : "auto",
    transform: isMobile ? "translateX(-50%)" : "none",
  }}
>
      <div
  className="card"
  style={{
    minWidth: 320,
    maxWidth: 380,
    background: "rgba(0,0,0,0.25)",           // was 0.65
    border: "1px solid var(--dos-border)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",              // <-- add
    WebkitBackdropFilter: "blur(10px)",        // <-- add (Safari)
  }}
>

        {/* Top status line */}
{(() => {
  // -1 = you're behind, 0 = exact match, 1 = you're ahead
  const compare =
    bbProg.s > FRIEND_SEASON ? 1 :
    bbProg.s < FRIEND_SEASON ? -1 :
    bbProg.e > FRIEND_EPISODE ? 1 :
    bbProg.e < FRIEND_EPISODE ? -1 :
    0;

  if (compare === 1) {
    // you are past S04E05
    return (
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        <span style={{ color: "var(--green, #00AA00)" }}>•</span>&nbsp;You&apos;ve watched passed <b>@_quietloop</b>. <br></br><span style={{ color: "var(--green, #00AA00)" }}>Time for them to catch up!</span>
      </div>
    );
  }

  if (compare === 0) {
    // exactly S04E05
    return (
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        <span style={{ color: "var(--green, #00AA00)" }}>•</span>&nbsp;You&apos;re all <span style={{ color: "var(--green, #00AA00)" }}>caught up</span> with <b>@_quietloop</b>!
      </div>
    );
  }

  // compare === -1 → behind friend
  return (
    <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
      <span style={{ color: "var(--danger, #ff3b30)" }}>•</span>&nbsp;You’re watching <b>Breaking Bad</b> with <b>@_quietloop</b>.{" "}
      They just watched <b>S{String(FRIEND_SEASON).padStart(2,"0")} E{String(FRIEND_EPISODE).padStart(2,"0")}</b>.&nbsp;
      <span style={{ color: "var(--danger, #ff3b30)" }}>Time to catch up!</span>
    </div>
  );
})()}



        {/* Friends header */}
        <div className="title" style={{ fontSize: 12, letterSpacing: "0.08em", opacity: 0.9, marginBottom: 6, textAlign: "center" }}>
          YOUR FRIENDS:
        </div>

        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
  <li style={{ fontSize: 12, lineHeight: 1.35, margin: "6px 0" }}>
    <b>@SlateOrbit</b> <span style={hl}>watched</span> <b>S01E03</b> of <b>Breaking Bad</b>.
  </li>

  {hasReachedFriendPost && (
    <li style={{ fontSize: 12, lineHeight: 1.35, margin: "6px 0" }}>
      <a
        href="#"
        onClick={handleMikeClick}
        style={{ color: "inherit", textDecoration: "underline", cursor: "pointer" }}
        aria-label='Open post: "Gus Fring: The Most Polite Threat in TV History" in Breaking Bad'
      >
        <b>@_quietloop</b> <span style={hl}>posted</span> about{" "}
        <b>Breaking Bad S04E05</b>.
      </a>
    </li>
  )}
</ul>


      </div>
    </div>
  );

  return createPortal(ui, hostRef.current!);
}
