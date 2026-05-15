import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import RepliesList from "../RepliesList";
import {
  fetchV2ThreadDetail,
  likeReply as dbLikeReply,
  unlikeReply as dbUnlikeReply,
  type CitationEntry,
} from "../../lib/db";
import type { ProgressEntry, Thread } from "../../types";

// V2 friend-room inline thread view.
//
// Mounted inside V2RoomFeed's expanded ticket state. Renders the thread's
// body + chain-visible replies (via RepliesList) + a bottom "collapse"
// button (the spec's "second instance"). The card's primary expand/collapse
// button at the bottom-right of the ticket stays where it is — clicking
// either one collapses the entry and scrolls the ticket's top into view
// (handled by V2RoomFeed's collapse path).
//
// Entry-level actions (star, edit, delete, quote) and the reply composer
// land in subsequent checkpoints. For checkpoint 2 this is the read-only
// scaffold — replies are visible, reply-likes work, no compose.

export type V2InlineThreadProps = {
  thread: Thread;
  groupId: string;
  viewerProgress: ProgressEntry | null;
  userId: string;
  /** Caller scrolls the ticket top into view and clears expansion. */
  onCollapseTop: () => void;
  onAuthRequired?: () => void;
};

export default function V2InlineThread({
  thread,
  groupId,
  viewerProgress,
  userId,
  onCollapseTop,
  onAuthRequired,
}: V2InlineThreadProps) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [likesReplies, setLikesReplies] = useState<Record<string, number>>({});
  const [likedByUserReplies, setLikedByUserReplies] = useState<Record<string, boolean>>({});
  const [citations, setCitations] = useState<Map<string, CitationEntry[]>>(new Map());
  const [threadCitations, setThreadCitations] = useState<CitationEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchV2ThreadDetail(thread.id, groupId, userId)
      .then((detail) => {
        if (cancelled) return;
        if (!detail) {
          setLoadError("thread not found");
          return;
        }
        const likes: Record<string, number> = {};
        const likedByMe: Record<string, boolean> = {};
        for (const r of detail.replies) {
          likes[r.id] = r.likes;
          likedByMe[r.id] = detail.replyLikedByMe.has(r.id);
        }
        setLikesReplies(likes);
        setLikedByUserReplies(likedByMe);
        setCitations(detail.replyCitations);
        setThreadCitations(detail.threadCitations);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("V2InlineThread fetch failed:", err);
        setLoadError("couldn't load this thread");
      });
    return () => {
      cancelled = true;
    };
  }, [thread.id, groupId, userId]);

  // Reply like / unlike — optimistic local update + db call, revert on
  // failure. Same shape as the live thread view's handlers, scoped to the
  // single thread this component owns.
  const handleLikeReply = useCallback(
    (rid: string, baseCount?: number) => {
      if (!userId) {
        onAuthRequired?.();
        return;
      }
      setLikedByUserReplies((prev) => ({ ...prev, [rid]: true }));
      setLikesReplies((prev) => ({
        ...prev,
        [rid]: (baseCount ?? prev[rid] ?? 0) + 1,
      }));
      dbLikeReply(userId, rid).catch(() => {
        setLikedByUserReplies((prev) => ({ ...prev, [rid]: false }));
        setLikesReplies((prev) => ({
          ...prev,
          [rid]: Math.max(0, (prev[rid] ?? 1) - 1),
        }));
      });
    },
    [userId, onAuthRequired],
  );

  const handleUnlikeReply = useCallback(
    (rid: string) => {
      if (!userId) return;
      setLikedByUserReplies((prev) => ({ ...prev, [rid]: false }));
      setLikesReplies((prev) => ({
        ...prev,
        [rid]: Math.max(0, (prev[rid] ?? 1) - 1),
      }));
      dbUnlikeReply(userId, rid).catch(() => {
        setLikedByUserReplies((prev) => ({ ...prev, [rid]: true }));
        setLikesReplies((prev) => ({
          ...prev,
          [rid]: (prev[rid] ?? 0) + 1,
        }));
      });
    },
    [userId],
  );

  if (loadError) {
    return (
      <div className="muted" style={{ fontSize: 14, padding: "16px 0" }}>
        {loadError}
      </div>
    );
  }

  return (
    <>
      {/* Thread body — plain pre-wrap. Inline citation-sup support for the
          entry body can be added in a follow-up checkpoint (RepliesList
          handles its own per-reply citation rendering). */}
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, marginTop: 8 }}>
        {thread.body}
      </div>

      {/* Replies list — chain-visibility filter built into RepliesList. */}
      <div style={{ marginTop: 16 }}>
        <RepliesList
          thread={thread}
          groupId={groupId}
          progressForShow={viewerProgress ?? undefined}
          likeReply={handleLikeReply}
          unlikeReply={handleUnlikeReply}
          likesReplies={likesReplies}
          likedByUserReplies={likedByUserReplies}
          onAuthRequired={onAuthRequired ?? (() => {})}
          citations={citations}
          threadCitations={threadCitations}
        />
      </div>

      {/* Second collapse button — the "end of thread" instance per spec.
          Tucks to the right at the bottom of the inline content. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button
          className="btn"
          onClick={onCollapseTop}
          style={{
            fontSize: 13,
            padding: "4px 12px",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <ChevronDown size={13} /> collapse
        </button>
      </div>
    </>
  );
}
