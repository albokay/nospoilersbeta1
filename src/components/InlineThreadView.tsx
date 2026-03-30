import React, { useEffect, useState } from "react";
import type { Thread } from "../types";
import { timeAgo } from "../lib/utils";
import { useAuth } from "../lib/auth";
import LikeBadge from "./LikeBadge";
import RepliesList from "./RepliesList";

export default function InlineThreadView({
  thread, show, onBack, progressForShow, onMountAlignTop,
  likeThread, likedByUser, likesCount,
  likeReply, likesReplies, likedByUserReplies,
  mode, focusReplyId, onAuthRequired
}: {
  thread: Thread;
  show: any;
  onBack: () => void;
  progressForShow?: { s: number; e: number };
  onMountAlignTop?: () => void;
  likeThread: () => void;
  likedByUser: boolean;
  likesCount: number;
  likeReply: (rid: string) => void;
  likesReplies: Record<string, number>;
  likedByUserReplies: Record<string, boolean>;
  mode: "standard" | "risky";
  focusReplyId?: string | null;
  onAuthRequired: () => void;
}) {
  const { user } = useAuth();
  const [threadReplyOpen, setThreadReplyOpen] = useState(false);

  useEffect(() => { onMountAlignTop?.(); }, []);

  const handleReplyToThread = () => {
    if (!user) { onAuthRequired(); return; }
    setThreadReplyOpen(true);
  };

  return (
    <section className="container" style={{ padding: "16px 0 24px" }}>
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 22 }} className="title">
            <span>{thread.titleBase}</span>
            {thread.showId !== "simshow" && (
              <span style={{ color: "var(--dos-cyan)" }}>
                {` — S${String(thread.season).padStart(2, "0")}E${String(thread.episode).padStart(2, "0")}`}
              </span>
            )}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LikeBadge
              count={likesCount}
              userLiked={likedByUser}
              onClick={(e) => { e.stopPropagation(); likeThread(); }}
              title="this post!"
            />
          </div>
        </div>

        <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>
          {show.name} • S{thread.season}E{thread.episode} • Started by <span className="username">@{thread.author}</span> • {timeAgo(thread.updatedAt)}
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ whiteSpace: "pre-wrap" }}>{thread.body}</div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button
            className="btn"
            onClick={handleReplyToThread}
          >
            Reply
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <RepliesList
          thread={thread}
          progressForShow={progressForShow}
          riskyMode={mode === "risky"}
          likeReply={likeReply}
          likesReplies={likesReplies}
          likedByUserReplies={likedByUserReplies}
          focusReplyId={focusReplyId}
          onAuthRequired={onAuthRequired}
          threadReplyOpen={threadReplyOpen}
          onThreadReplyClose={() => setThreadReplyOpen(false)}
        />
      </div>
    </section>
  );
}
