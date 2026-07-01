import { useEffect, useState } from "react";
import { fetchNextRoomPing, dismissPing } from "../lib/db";
import type { Ping } from "../types";
import StickyNote from "./StickyNote";

// Incoming-ping sticky. Fetches the next undismissed sticky-channel ping for
// this room on load / nav (no realtime, per spec) and renders it on the shared
// StickyNote shell. Parent (this component) owns the data gate; StickyNote owns
// the viewport gate + entrance animation + dismiss-X.

interface Props {
  groupId: string;
  currentUserId: string;
}

export default function IncomingPingSticky({ groupId, currentUserId }: Props) {
  const [ping, setPing] = useState<Ping | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [dismissing, setDismissing] = useState(false);

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
        // Graceful degrade — failed fetch hides the sticky entirely;
        // user just doesn't see a ping until next nav.
        if (cancelled) return;
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

  if (!loaded || !ping || hidden) return null;

  const senderHandle = ping.senderUsername || "a friend";

  return (
    <StickyNote
      ariaLabel="Incoming ping"
      tone="cream"
      tilt={4}
      width={260}
      dismissSize={13}
      dismissDisabled={dismissing}
      onDismiss={handleDismiss}
      style={{ right: 32, bottom: 320, zIndex: 60 }}
    >
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
    </StickyNote>
  );
}
