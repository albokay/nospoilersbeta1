import React, { useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";
import { fetchNextRoomPing, dismissPing } from "../lib/db";
import type { Ping } from "../types";

// ── Visual constants ─────────────────────────────────────────────────────
const STICKY_BG       = "#fef8ea";  // canon cream
const TEXT_COLOR      = "#355eb8";  // canon dark blue — readable on cream paper
const TILT_DEG        = 4;           // clockwise — matches the green post-it direction at half angle
const MIN_VIEWPORT_PX = 1230;        // hide on narrow viewports (matches green post-it gate)
const ENTRY_TRANSITION_MS = 380;
const ENTRY_DELAY_MS      = 600;     // brief pause after page load before the sticky animates in
const ENTRY_RISE_PX       = 18;

interface Props {
  groupId: string;
  currentUserId: string;
}

export default function IncomingPingSticky({ groupId, currentUserId }: Props) {
  const [wide, setWide] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= MIN_VIEWPORT_PX,
  );
  useEffect(() => {
    const fn = () => setWide(window.innerWidth >= MIN_VIEWPORT_PX);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const [ping, setPing] = useState<Ping | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [entered, setEntered] = useState(false);

  // Fetch the next undismissed sticky-channel ping for this room.
  // Per spec: shown on page load / nav refresh only; no realtime.
  useEffect(() => {
    let cancelled = false;
    setHidden(false);
    setLoaded(false);
    setPing(null);
    fetchNextRoomPing(currentUserId, groupId)
      .then((p) => {
        if (cancelled) return;
        setPing(p);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Graceful degrade — failed fetch hides the sticky entirely;
        // user just doesn't see a ping until next nav.
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, currentUserId]);

  async function handleDismiss() {
    if (!ping || dismissing) return;
    setDismissing(true);
    try {
      await dismissPing(ping.id);
    } catch {
      // Even if the RPC fails, hide locally — better UX than a stuck sticky.
      // Next nav refresh will re-fetch the truth.
    }
    setHidden(true);
  }

  useLayoutEffect(() => {
    if (loaded && ping && !hidden) {
      const t = window.setTimeout(() => setEntered(true), ENTRY_DELAY_MS);
      return () => window.clearTimeout(t);
    }
  }, [loaded, ping, hidden]);

  if (!wide || !loaded || !ping || hidden) return null;

  const senderHandle = ping.senderUsername || "a friend";

  return (
    <div
      aria-label="Incoming ping"
      style={{
        position: "fixed",
        right: 32,
        bottom: 440,
        zIndex: 51,
        width: 260,
        transform: `rotate(${TILT_DEG}deg) translateY(${entered ? 0 : ENTRY_RISE_PX}px)`,
        transformOrigin: "center",
        opacity: entered ? 1 : 0,
        transition: `opacity ${ENTRY_TRANSITION_MS}ms ease-out, transform ${ENTRY_TRANSITION_MS}ms ease-out`,
        background: STICKY_BG,
        color: TEXT_COLOR,
        padding: "14px 16px",
        borderRadius: 0,
        boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <button
        onClick={handleDismiss}
        disabled={dismissing}
        aria-label="Dismiss"
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          background: "transparent",
          border: "none",
          padding: 2,
          color: "rgba(53,94,184,0.5)",
          cursor: dismissing ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <X size={13} />
      </button>

      <div style={{ fontSize: 12, marginBottom: 6, paddingRight: 16 }}>
        <span style={{ fontWeight: 500 }}>@{senderHandle}</span>{" "}
        <span style={{ opacity: 0.7 }}>pinged you:</span>
      </div>
      <div
        style={{
          fontStyle: "italic",
          fontSize: 14,
          lineHeight: 1.45,
          paddingRight: 4,
        }}
      >
        {ping.message}
      </div>
    </div>
  );
}
