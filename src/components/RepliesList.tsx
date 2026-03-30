import React, { useState, useEffect, useRef, useMemo } from "react";
import type { Thread, Reply } from "../types";
import { fetchRepliesForThread, insertReply, likeReply as dbLikeReply } from "../lib/db";
import { useAuth } from "../lib/auth";
import { canView, timeAgo } from "../lib/utils";
import Modal from "./Modal";
import LikeBadge from "./LikeBadge";

export default function RepliesList({
  thread, progressForShow, riskyMode = false,
  likeReply, likesReplies, likedByUserReplies, focusReplyId, onAuthRequired,
  threadReplyOpen, onThreadReplyClose, onRiskyReveal,
}: {
  thread: Thread;
  progressForShow?: { s: number; e: number };
  riskyMode?: boolean;
  likeReply: (rid: string, baseCount?: number) => void;
  likesReplies: Record<string, number>;
  likedByUserReplies: Record<string, boolean>;
  focusReplyId?: string | null;
  onAuthRequired: () => void;
  threadReplyOpen?: boolean;
  onThreadReplyClose?: () => void;
  onRiskyReveal?: (rid: string) => void;
}) {
  const { user, profile } = useAuth();

  const [replies, setReplies] = useState<Reply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRepliesLoading(true);
    fetchRepliesForThread(thread.id).then(async (data) => {
      if (cancelled) return;
      setReplies(data);
      setRepliesLoading(false);

    }).catch(() => setRepliesLoading(false));
    return () => { cancelled = true; };
  }, [thread.id, user]);

  const [localLiked, setLocalLiked] = useState<Record<string, boolean>>({});

  const byId = useMemo(() => {
    const map: Record<string, Reply> = {};
    for (const r of replies) map[r.id] = r;
    return map;
  }, [replies]);

  const [revealed, setRevealed] = useState<Record<string, true>>({});
  const [progressReveal, setProgressReveal] = useState<Record<string, true>>({});
  const [promptFor, setPromptFor] = useState<Reply | null>(null);

  // ── Inline reply form state ───────────────────────────────
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Thread-level reply form state ─────────────────────────
  const [threadReplyBody, setThreadReplyBody] = useState("");
  const [threadReplySubmitting, setThreadReplySubmitting] = useState(false);
  const [threadReplyError, setThreadReplyError] = useState<string | null>(null);
  const threadReplyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (threadReplyOpen && threadReplyRef.current) {
      setThreadReplyBody("");
      setThreadReplyError(null);
      setTimeout(() => threadReplyRef.current?.focus(), 50);
    }
  }, [threadReplyOpen]);

  const handleSubmitThreadReply = async () => {
    if (!user || !profile) { onAuthRequired(); return; }
    const body = threadReplyBody.trim();
    if (!body) return;
    setThreadReplySubmitting(true);
    setThreadReplyError(null);
    try {
      const newReply = await insertReply({
        threadId: thread.id,
        showId: thread.showId,
        season: progressForShow?.s ?? thread.season,
        episode: progressForShow?.e ?? thread.episode,
        authorId: user.id,
        authorName: profile.username,
        body,
      });
      setReplies((prev) => [...prev, newReply]);
      setThreadReplyBody("");
      onThreadReplyClose?.();
      setTimeout(() => {
        const el = document.getElementById(`c-${newReply.id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    } catch (err: any) {
      setThreadReplyError(err?.message ?? "Failed to post. Please try again.");
    } finally {
      setThreadReplySubmitting(false);
    }
  };

  useEffect(() => {
    if (replyingToId && replyTextareaRef.current) {
      replyTextareaRef.current.focus();
    }
  }, [replyingToId]);

  const handleReplyClick = (replyId: string) => {
    if (!user) { onAuthRequired(); return; }
    setReplyingToId(replyId);
    setReplyBody("");
    setReplyError(null);
  };

  const handleCancelReply = () => {
    setReplyingToId(null);
    setReplyBody("");
    setReplyError(null);
  };

  const handleSubmitReply = async (replyToId: string) => {
    if (!user || !profile) { onAuthRequired(); return; }
    const body = replyBody.trim();
    if (!body) return;
    setSubmitting(true);
    setReplyError(null);
    try {
      const newReply = await insertReply({
        threadId: thread.id,
        showId: thread.showId,
        season: progressForShow?.s ?? thread.season,
        episode: progressForShow?.e ?? thread.episode,
        authorId: user.id,
        authorName: profile.username,
        body,
        replyToId,
      });
      setReplies((prev) => [...prev, newReply]);
      setReplyingToId(null);
      setReplyBody("");
      setTimeout(() => {
        const el = document.getElementById(`c-${newReply.id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    } catch (err: any) {
      setReplyError(err?.message ?? "Failed to post. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLikeReply = async (rid: string) => {
    if (!user) { onAuthRequired(); return; }
    const alreadyLiked = likedByUserReplies[rid] || localLiked[rid];
    if (alreadyLiked) return;
    // Pass the currently displayed count so the optimistic update uses the right base,
    // even when likesReplies[rid] hasn't been seeded for this reply yet
    const reply = replies.find(r => r.id === rid);
    const baseCount = likesReplies[rid] ?? reply?.likes ?? 0;
    likeReply(rid, baseCount);
    setLocalLiked((prev) => ({ ...prev, [rid]: true }));
    try {
      await dbLikeReply(user.id, rid);
    } catch (err) {
      console.error("Failed to like reply:", err);
      // Rollback local
      setLocalLiked((prev) => { const n = { ...prev }; delete n[rid]; return n; });
    }
  };

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
                onRiskyReveal?.(id);
                setPromptFor(null);
                setTimeout(() => scrollTo(id, true), 0);
              }}
            >
              I'll risk it.
            </button>
          </div>
        </Modal>
      )}

      {threadReplyOpen && (
        <div className="card" style={{ marginBottom: 12, borderLeft: "4px solid var(--dos-accent)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Reply to this post</div>
          <textarea
            ref={threadReplyRef}
            value={threadReplyBody}
            onChange={(e) => setThreadReplyBody(e.target.value)}
            placeholder="Write your reply…"
            rows={3}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "var(--dos-bg)", color: "var(--dos-fg)",
              border: "1px solid var(--dos-border)", borderRadius: 4,
              padding: "8px 10px", fontSize: 14, resize: "vertical",
              fontFamily: "inherit",
            }}
          />
          {threadReplyError && (
            <div style={{ color: "var(--dos-red, #f45028)", fontSize: 13, marginTop: 4 }}>{threadReplyError}</div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button className="btn" onClick={() => { onThreadReplyClose?.(); setThreadReplyBody(""); setThreadReplyError(null); }} disabled={threadReplySubmitting}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={handleSubmitThreadReply}
              disabled={threadReplySubmitting || !threadReplyBody.trim()}
            >
              {threadReplySubmitting ? "Posting…" : "Post reply"}
            </button>
          </div>
        </div>
      )}

      {repliesLoading && <div className="muted" style={{ fontSize: 14 }}>Loading replies…</div>}
      <div style={{ display: "grid", gap: 12 }}>
        {replies.map((r) => {
          const vis = isVisible(r);
          const parent = r.replyToId ? byId[r.replyToId] : null;
          const likeCt = likesReplies[r.id] ?? r.likes;
          const userLiked = likedByUserReplies[r.id] || !!localLiked[r.id];

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
                  userLiked={userLiked}
                  onClick={() => handleLikeReply(r.id)}
                  title="this post!"
                />
                <button
                  className="btn"
                  onClick={() => replyingToId === r.id ? handleCancelReply() : handleReplyClick(r.id)}
                >
                  {replyingToId === r.id ? "Cancel" : "Reply"}
                </button>
              </div>

              {replyingToId === r.id && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--dos-border)", paddingTop: 10 }}>
                  <textarea
                    ref={replyTextareaRef}
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder={`Reply to @${r.author}…`}
                    rows={3}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "var(--dos-bg)", color: "var(--dos-fg)",
                      border: "1px solid var(--dos-border)", borderRadius: 4,
                      padding: "8px 10px", fontSize: 14, resize: "vertical",
                      fontFamily: "inherit",
                    }}
                  />
                  {replyError && (
                    <div style={{ color: "var(--dos-red, #f45028)", fontSize: 13, marginTop: 4 }}>{replyError}</div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
                    <button className="btn" onClick={handleCancelReply} disabled={submitting}>
                      Cancel
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => handleSubmitReply(r.id)}
                      disabled={submitting || !replyBody.trim()}
                    >
                      {submitting ? "Posting…" : "Post reply"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!repliesLoading && replies.length === 0 && (
          <div className="muted" style={{ fontSize: 14 }}>No replies yet.</div>
        )}
      </div>
    </>
  );
}
