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
        right: isMobile ? "auto" : 16,
        left: isMobile ? "50%" : "auto",
        transform: isMobile ? "translateX(-50%)" : "none",
      }}
    >
      <div
        className="card"
        style={{
          width: 340,
          maxWidth: "92vw",
          background: "rgba(201,168,67,0.97)",
          border: "3px solid #fff",
          boxShadow: "0 8px 32px rgba(0,0,0,0.20)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          padding: "14px 16px",
        }}
      >
        <div style={{ fontSize: 12, lineHeight: 1.5, fontWeight: 400, color: "#fff" }}>
          ⏳<b>FUTURE FEATURE:</b> ALERTS ABOUT FRIENDS YOU'RE WATCHING SHOWS WITH.⏳<br></br><br></br>Have they caught up to you? Are they ahead? Are there posts or replies about shows you’re watching together?
        </div>
      </div>
    </div>
  );

  return createPortal(ui, hostRef.current!);
}
