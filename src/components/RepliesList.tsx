import React, { useState, useEffect, useRef, useMemo } from "react";
import type { Thread, Reply } from "../types";
import { fetchRepliesForThread } from "../lib/db";
import { canView, timeAgo } from "../lib/utils";
import Modal from "./Modal";
import LikeBadge from "./LikeBadge";

export default function RepliesList({
  thread, progressForShow, riskyMode = false,
  likeReply, likesReplies, likedByUserReplies, focusReplyId
}: {
  thread: Thread;
  progressForShow?: { s: number; e: number };
  riskyMode?: boolean;
  likeReply: (rid: string) => void;
  likesReplies: Record<string, number>;
  likedByUserReplies: Record<string, boolean>;
  focusReplyId?: string | null;
}) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRepliesLoading(true);
    fetchRepliesForThread(thread.id).then(data => {
      if (!cancelled) { setReplies(data); setRepliesLoading(false); }
    }).catch(() => setRepliesLoading(false));
    return () => { cancelled = true; };
  }, [thread.id]);

  const byId = useMemo(() => {
    const map: Record<string, Reply> = {};
    for (const r of replies) map[r.id] = r;
    return map;
  }, [replies]);

  const [revealed, setRevealed] = useState<Record<string, true>>({});
  const [progressReveal, setProgressReveal] = useState<Record<string, true>>({});
  const [promptFor, setPromptFor] = useState<Reply | null>(null);

  useEffect(() => {
    if (!focusReplyId) return;
    const run = () => {
      const el = document.getElementById(`c-${focusReplyId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const cover = document.createElement("div");
      cover.className = "flash-cover";
      const s = getComputedStyle(el);
      (el as HTMLElement).style.position = (s.position === "static") ? "relative" : s.position;
      el.appendChild(cover);
      requestAnimationFrame(() => { cover.style.opacity = "0"; });
      setTimeout(() => cover.remove(), 2000);
    };
    setTimeout(run, 80);
  }, [focusReplyId]);

  const prevProgRef = useRef<{ s: number; e: number } | undefined>(progressForShow);
  useEffect(() => {
    const prev = prevProgRef.current;
    const cur = progressForShow;
    if (prev && cur && (prev.s !== cur.s || prev.e !== cur.e)) {
      const updates: Record<string, true> = {};
      for (const r of replies) {
        const was = canView({ season: r.season, episode: r.episode }, prev);
        const now = canView({ season: r.season, episode: r.episode }, cur);
        if (!was && now) updates[r.id] = true;
      }
      if (Object.keys(updates).length) setProgressReveal(pr => ({ ...pr, ...updates }));
    }
    prevProgRef.current = cur;
  }, [progressForShow, replies]);

  const canSeeSelf = (r: Reply) => canView({ season: r.season, episode: r.episode }, progressForShow);

  const isAncestorRedacted = (r: Reply): boolean => {
    let cur = r.replyToId ? byId[r.replyToId] : null;
    while (cur) {
      const curWithin = canSeeSelf(cur);
      const curRevealed = !!revealed[cur.id];
      if (!riskyMode) {
        if (!curWithin) return true;
      } else {
        if (!curWithin && !curRevealed) return true;
      }
      cur = cur.replyToId ? byId[cur.replyToId] : null;
    }
    return false;
  };

  const isVisible = (r: Reply): { show: boolean; redacted: boolean } => {
    const within = canSeeSelf(r);
    const parentRedacted = isAncestorRedacted(r);

    if (!riskyMode) {
      if (!within || parentRedacted) return { show: false, redacted: false };
      return { show: true, redacted: false };
    } else {
      const needRedact = (!within || parentRedacted) && !revealed[r.id];
      return { show: !needRedact, redacted: needRedact };
    }
  };

  const scrollTo = (replyId: string, flash = false) => {
    const el = document.getElementById(`c-${replyId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (flash) {
      const cover = document.createElement("div");
      cover.className = "flash-cover";
      const style = getComputedStyle(el);
      el.style.position = (style.position === "static") ? "relative" : style.position;
      el.appendChild(cover);
      requestAnimationFrame(() => { cover.style.opacity = "0"; });
      setTimeout(() => { cover.remove(); }, 2000);
    }
  };

  const replyLabel = (r: Reply) =>
    `This viewer has watched S${String(r.season).padStart(2, "0")}E${String(r.episode).padStart(2, "0")}. Click to reveal.`;

  return (
    <>
      {promptFor && riskyMode && (
        <Modal onClose={() => setPromptFor(null)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <h3 className="title" style={{ margin: 0 }}>Are you sure?</h3>
            <button className="btn" onClick={() => setPromptFor(null)}>✕</button>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>This person is replying to an episode you've watched, BUT they're further along in the show. <br /><br />There may be spoilers ahead!</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button className="btn btn-danger" onClick={() => setPromptFor(null)}>Nevermind</button>
            <button
              className="btn btn-danger"
              onClick={() => {
                if (!promptFor) return;
                const id = promptFor.id;
                setRevealed((r) => ({ ...r, [id]: true }));
                setPromptFor(null);
                setTimeout(() => scrollTo(id, true), 0);
              }}
            >
              I'll risk it.
            </button>
          </div>
        </Modal>
      )}

      {repliesLoading && <div className="muted" style={{ fontSize: 14 }}>Loading replies…</div>}
      <div style={{ display: "grid", gap: 12 }}>
        {replies.map((r) => {
          const vis = isVisible(r);
          const parent = r.replyToId ? byId[r.replyToId] : null;
          const likeCt = likesReplies[r.id] ?? r.likes;

          if (!riskyMode && !vis.show) return null;

          if (riskyMode && vis.redacted) {
            return (
              <div
                key={r.id}
                id={`c-${r.id}`}
                className="card redacted"
                onClick={() => setPromptFor(r)}
                style={{ marginLeft: 8, cursor: "pointer", display: "flex", alignItems: "center", minHeight: 32, padding: "4px 10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                title="Click to reveal — may contain spoilers"
              >
                <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1 }}>
                  {replyLabel(r)}
                </div>
              </div>
            );
          }

          return (
            <div
              key={r.id}
              id={`c-${r.id}`}
              className="card"
              style={{ borderLeft: (progressReveal[r.id] ? "8px solid var(--green)" : "4px solid var(--dos-border)"), marginLeft: 8, position: "relative" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14 }}>
                  <b className="username">@{r.author}</b>{" "}
                  {thread.showId !== "simshow" && (
                    <span style={{ color: "var(--dos-cyan)", fontWeight: 700 }}>
                      S{String(r.season).padStart(2, "0")}E{String(r.episode).padStart(2, "0")}
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{timeAgo(r.updatedAt)}</div>
              </div>

              {parent && canView({ season: parent.season, episode: parent.episode }, progressForShow) && (
                <div style={{ fontSize: 12, marginTop: 4 }} className="muted">
                  ↪︎{" "}
                  <button
                    onClick={() => scrollTo(parent.id, true)}
                    style={{ textDecoration: "underline", background: "transparent", border: 0, color: "var(--dos-accent)", cursor: "pointer" }}
                  >
                    in reply to
                  </button>{" "}
                  @{parent.author}
                </div>
              )}

              <div style={{ marginTop: 8, fontSize: 15 }}>{r.body}</div>

              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 10 }}>
                <LikeBadge
                  count={likeCt}
                  userLiked={!!likedByUserReplies[r.id]}
                  onClick={() => likeReply(r.id)}
                  title="this post!"
                />
                <button className="btn">Reply</button>
              </div>
            </div>
          );
        })}
        {replies.length === 0 && <div className="muted" style={{ fontSize: 14 }}>No replies yet.</div>}
      </div>
    </>
  );
}
