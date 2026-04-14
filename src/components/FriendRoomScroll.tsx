import React, { useRef, useEffect } from "react";
import type { FriendGroup } from "../types";

type FriendRoomScrollProps = {
  groups: (FriendGroup & { lastActivityAt: number })[];
  onNavigate: (showId: string, groupId: string) => void;
};

/** Horizontal scroll row of friend room pill buttons, ordered by most recent activity. */
export default function FriendRoomScroll({ groups, onNavigate }: FriendRoomScrollProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to the left on mount (most recent rooms are first/leftmost)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [groups.length]);

  if (!groups.length) return null;

  return (
    <div
      ref={scrollRef}
      className="friendRoomScroll"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        overflowX: "auto",
        overflowY: "hidden",
        minWidth: 0,
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {groups.map(g => {
        const label = g.name.length > 15 ? g.name.slice(0, 15) + "..." : g.name;
        return (
          <button
            key={g.id}
            onClick={() => onNavigate(g.showId, g.id)}
            title={g.name}
            style={{
              flexShrink: 0,
              background: "var(--danger)",
              color: "#fff",
              border: "none",
              borderRadius: 9999,
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap",
              lineHeight: 1.3,
              fontFamily: "inherit",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
