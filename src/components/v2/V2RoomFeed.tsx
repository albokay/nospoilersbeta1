import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Mail, Users } from "lucide-react";
import EpisodeTag from "../EpisodeTag";
import LikeBadge from "../LikeBadge";
import SidebarAvatar from "../SidebarAvatar";
import { timeAgo } from "../../lib/utils";

// V2 friend room feed — episode-ascending list of entry tickets.
//
// Each ticket has two inline display states (collapsed / expanded) plus a
// "navigate out" action when the card body itself is clicked. The body→
// thread click and the expand→toggle click are two separate hit targets
// on the same card; expand stops propagation so it doesn't also navigate.
//
// External scroll-and-highlight (used by the map's cell-click): callers
// pass a ref and invoke `scrollToEntry(threadId)`. The component scrolls
// the ticket into view and flips the ticket's outer border to canon blue
// (`#355eb8`) for ~1.5s — the same visual signal `ShowSection.tsx` uses
// for newly-visible threads after a progress bump (its `isNew` branch on
// the card border). No keyframe animation; just a snap on/off of the
// border color, matching the live treatment exactly.

export type V2RoomFeedEntry = {
  threadId: string;
  s: number;
  e: number;
  title: string;
  body: string;
  preview: string;
  authorId: string;
  authorUsername: string;
  isRewatch?: boolean;
  rewatchS?: number;
  rewatchE?: number;
  isEdited?: boolean;
  /** Author has departed this room. Adds the inline "has left the room" tag. */
  isDeparted?: boolean;
  updatedAt: number;
  replyCount: number;
};

export type V2RoomFeedHandle = {
  scrollToEntry: (threadId: string) => void;
};

export type V2RoomFeedProps = {
  entries: V2RoomFeedEntry[];
  onOpenThread: (threadId: string) => void;
};

const HIGHLIGHT_MS = 1500;

const V2RoomFeed = forwardRef<V2RoomFeedHandle, V2RoomFeedProps>(function V2RoomFeed(
  { entries, onOpenThread },
  ref,
) {
  // Episode-ascending sort. Within an episode, chronological by createdAt
  // (oldest first) per spec. updatedAt is the closest proxy on the entry
  // shape — callers pass createdAt-equivalent timestamps.
  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.s !== b.s) return a.s - b.s;
      if (a.e !== b.e) return a.e - b.e;
      return a.updatedAt - b.updatedAt;
    });
  }, [entries]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const ticketRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
  }, []);

  const scrollToEntry = useCallback((threadId: string) => {
    const el = ticketRefs.current[threadId];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightedId(threadId);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlightedId(null);
      highlightTimer.current = null;
    }, HIGHLIGHT_MS);
  }, []);

  useImperativeHandle(ref, () => ({ scrollToEntry }), [scrollToEntry]);

  const toggleExpand = (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((m) => ({ ...m, [threadId]: !m[threadId] }));
  };

  return (
    <div>
      {sorted.map((entry) => {
        const isExpanded = !!expanded[entry.threadId];
        const isHighlighted = highlightedId === entry.threadId;
        return (
          <div
            key={entry.threadId}
            ref={(el) => {
              ticketRefs.current[entry.threadId] = el;
            }}
            data-thread-id={entry.threadId}
            style={{ position: "relative", margin: "0 0 12px 0" }}
          >
            <div
              className="card threadCard"
              style={{
                margin: 0,
                cursor: "pointer",
                position: "relative",
                paddingTop: 12,
                paddingBottom: 36,
                border: isHighlighted ? "4px solid #355eb8" : "4px solid var(--dos-border)",
              }}
              onClick={() => onOpenThread(entry.threadId)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 22 }} className="title">
                  <span style={{ marginRight: 4, display: "inline-flex", alignItems: "center" }}>
                    <Users size={14} color="var(--icon-color)" />
                  </span>
                  {entry.title}
                  <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 7, whiteSpace: "nowrap" }}>
                    <EpisodeTag
                      season={entry.s}
                      episode={entry.e}
                      isRewatch={entry.isRewatch}
                      rewatchS={entry.rewatchS}
                      rewatchE={entry.rewatchE}
                    />
                  </span>
                  {entry.isEdited && (
                    <span style={{ fontStyle: "italic", fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 6 }}>(edited)</span>
                  )}
                </h2>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <LikeBadge count={0} readOnly title="open post to vote" />
                </div>
              </div>

              <div className="muted" style={{ marginTop: 4, fontSize: 14, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                Started by{" "}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "middle", fontWeight: 700 }}>
                  <SidebarAvatar userId={entry.authorId} username={entry.authorUsername} size={16} />
                  {entry.authorUsername}
                </span>
                {entry.isDeparted && (
                  <span style={{ fontStyle: "italic", fontSize: 12, opacity: 0.6 }}>has left the room</span>
                )}
                {" "}• {timeAgo(entry.updatedAt)}
              </div>

              <div style={{ marginTop: 6 }}>
                {isExpanded ? (
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{entry.body}</div>
                ) : (
                  <div className="clamp3">{entry.preview}</div>
                )}
              </div>

              {/* Bottom-right: expand/collapse button. Reply count only renders
                  in the expanded state per spec — collapsed cards intentionally
                  hide any signal that responses exist. */}
              <div
                style={{
                  position: "absolute",
                  right: 12,
                  bottom: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                {isExpanded && (
                  <span className="muted" style={{ fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Mail size={14} color="var(--icon-color)" /> {entry.replyCount}
                  </span>
                )}
                <button
                  className="btn"
                  onClick={(e) => toggleExpand(entry.threadId, e)}
                  style={{ fontSize: 13, padding: "4px 12px" }}
                >
                  • {isExpanded ? "collapse" : "expand"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default V2RoomFeed;
