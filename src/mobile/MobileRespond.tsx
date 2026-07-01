import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  insertReply,
  fetchThreadById,
  fetchRepliesForThread,
  fetchAllFriendGroupsWithActivity,
  fetchProgress,
} from "../lib/db";
import type { Thread, Reply, ProgressEntry } from "../types";
import { canView, effectiveProgress } from "../lib/utils";
import { linkifyText } from "../lib/linkify";
import LoadingDots from "../components/LoadingDots";

// /m/rooms/:groupId/thread/:threadId/respond — write a response to a
// specific thread inside a room.
//
// Same shape as MobileCompose, but body-only (replies don't have titles)
// and writes to replies via insertReply with group_id set to the current
// room. Tag uses effectiveProgress (rewatcher rule preserved). No quote
// feature on mobile (per spec) — referenceType / referencedReplyId /
// quotedText all stay null.
//
// On success: navigate(`/m/rooms/:id/thread/:tid`, { replace: true }).
// MobileThread's refetch effect (keyed on location.key) re-pulls the
// reply list so the new reply appears immediately.
export default function MobileRespond({ groupId, threadId }: { groupId: string; threadId: string }) {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [thread, setThread] = useState<Thread | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [progress, setProgress] = useState<ProgressEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Ref + initial-scroll effect: after data loads, scroll the textarea into
  // view so the user lands ready to type. The full thread + responses sit
  // above the textarea — they can scroll up to reread while writing.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const didInitialScrollRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetchThreadById(threadId),
      fetchRepliesForThread(threadId, groupId),
      fetchAllFriendGroupsWithActivity(user.id),
      fetchProgress(user.id),
    ])
      .then(([t, rs, rooms, progressMap]) => {
        if (cancelled) return;
        if (!t) { setLoadError("not_found"); return; }
        const room = rooms.find(r => r.id === groupId);
        if (!room) { setLoadError("not_member"); return; }
        // Membership matches the room; the show_id path goes via thread,
        // not via room, so use thread.showId to pull progress.
        setThread(t);
        setReplies(rs);
        setProgress(progressMap[t.showId] ?? null);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("MobileRespond fetch failed:", err);
        setLoadError("fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [groupId, threadId, user?.id]);

  // After initial render with data, scroll the textarea into view. One-shot
  // (didInitialScrollRef) so subsequent re-renders don't yank the page if
  // the user has scrolled up to reread the thread.
  useEffect(() => {
    if (loading || loadError || didInitialScrollRef.current) return;
    if (!textareaRef.current) return;
    didInitialScrollRef.current = true;
    // requestAnimationFrame so the DOM has settled (response cards rendered,
    // page height final) before we measure + scroll.
    requestAnimationFrame(() => {
      textareaRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }, [loading, loadError]);

  // Chain-visible reply filter (mirrors MobileThread): a reply is shown iff
  // canView(reply, viewer) AND every ancestor in the parent chain is also
  // canView'able. Walks both replyToId (legacy/seed) and referencedReplyId
  // (current composer). Soft-deleted replies render as tombstones only when
  // they've been responded to — otherwise filtered entirely.
  const visibleReplies = useMemo(() => {
    if (!thread) return [];
    const byId: Record<string, Reply> = {};
    replies.forEach(r => (byId[r.id] = r));

    const respondedToIds = new Set<string>();
    for (const r of replies) {
      if (r.isDeleted) continue;
      if (r.replyToId) respondedToIds.add(r.replyToId);
      if (r.referencedReplyId) respondedToIds.add(r.referencedReplyId);
    }

    const getParent = (r: Reply): Reply | null =>
      (r.replyToId && byId[r.replyToId]) ||
      (r.referencedReplyId && byId[r.referencedReplyId]) ||
      null;
    const chainVisible = (r: Reply): boolean => {
      if (r.isDeleted && !respondedToIds.has(r.id)) return false;
      if (!canView({ season: r.season, episode: r.episode }, progress)) return false;
      let cur = getParent(r);
      while (cur) {
        if (!canView({ season: cur.season, episode: cur.episode }, progress)) return false;
        cur = getParent(cur);
      }
      return true;
    };
    return replies.filter(chainVisible);
  }, [replies, progress, thread]);

  const eff = effectiveProgress(progress);
  const tag = eff
    ? `S${String(eff.s).padStart(2, "0")} E${String(eff.e).padStart(2, "0")}`
    : null;

  const canSubmit =
    !!user && !!thread && !!eff &&
    body.trim().length > 0 &&
    !submitting;

  const onSubmit = async () => {
    if (!user || !thread || !eff || !profile?.username) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const trimmedBody = body.trim();
      const isRewatch = !!progress?.isRewatching;
      const rewatchSeason = isRewatch ? progress?.s : undefined;
      const rewatchEpisode = isRewatch ? progress?.e : undefined;

      await insertReply({
        threadId: thread.id,
        showId: thread.showId,
        season: eff.s,
        episode: eff.e,
        authorId: user.id,
        authorName: profile.username,
        body: trimmedBody,
        groupId,                 // scope to this room (per HANDOFF §3)
        isRewatch,
        rewatchSeason,
        rewatchEpisode,
        // Quote feature is desktop-only — no referenceType/referencedReplyId
        // /quotedText. Per spec.
      });

      navigate(`/m/rooms/${groupId}/thread/${threadId}`, { replace: true });
    } catch (err) {
      console.warn("MobileRespond submit failed:", err);
      const msg = err instanceof Error ? err.message : "Could not send response. Try again.";
      setSubmitError(msg);
      setSubmitting(false);
    }
  };

  // ── Render ──

  const wrapper: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--dos-bg, #7abd8e)",
    color: "#FEF8EA",
    padding: "16px 20px 32px",
    boxSizing: "border-box",
  };

  if (loading) {
    return (
      <div style={{ ...wrapper, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 14, opacity: 0.85 }}>Loading<LoadingDots /></span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ ...wrapper, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ fontSize: 14, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320 }}>
          {loadError === "not_found"   && "This entry doesn't exist or has been removed."}
          {loadError === "not_member"  && "You're not in this room."}
          {loadError === "fetch_failed" && "Couldn't load. Try again."}
        </p>
        <button
          onClick={() => navigate(`/m/rooms/${groupId}`, { replace: true })}
          style={{
            background: "transparent", color: "#FEF8EA",
            border: "2px solid #FEF8EA",
            borderRadius: 9999, padding: "10px 24px",
            fontSize: 14, fontWeight: 700, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ← Back
        </button>
      </div>
    );
  }

  if (!eff) {
    return (
      <div style={{ ...wrapper, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ fontSize: 14, opacity: 0.85, margin: 0, textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
          Set your watch progress before responding. Posts get tagged at your current episode so spoiler-filtering can work.
        </p>
        <button
          onClick={() => navigate(`/m/rooms/${groupId}/progress`)}
          style={{
            background: "#FEF8EA", color: "var(--dos-bg)",
            border: "none",
            borderRadius: 9999, padding: "12px 28px",
            fontSize: 15, fontWeight: 800, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Set progress
        </button>
      </div>
    );
  }

  return (
    <div style={wrapper}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        {/* ── Top bar (Cancel only — Send moved below the body) ── */}
        <div style={{
          display: "flex",
          justifyContent: "flex-start",
          alignItems: "center",
          marginBottom: 12,
        }}>
          <button
            onClick={() => navigate(`/m/rooms/${groupId}/thread/${threadId}`)}
            disabled={submitting}
            style={{
              background: "transparent", color: "#FEF8EA",
              border: "none",
              fontSize: 15, fontWeight: 600, cursor: submitting ? "default" : "pointer",
              fontFamily: "inherit", opacity: submitting ? 0.55 : 0.85,
              padding: "6px 0",
            }}
          >
            Cancel
          </button>
        </div>

        {/* ── Full thread context (mirrors the article card on            */}
        {/*    MobileThread so the user sees the entry they're responding */}
        {/*    to, not just its title). Soft-deleted threads tombstone to */}
        {/*    "[deleted by author]" same as MobileThread.                 */}
        {thread && (() => {
          const threadTag = `S${String(thread.season).padStart(2, "0")} E${String(thread.episode).padStart(2, "0")}`;
          const threadDeleted = !!thread.isDeleted;
          return (
            <article style={{
              background: "rgba(253,248,236,0.95)",
              color: "var(--dos-bg, #2a4a36)",
              borderRadius: 12,
              padding: "16px 16px",
              marginBottom: 16,
            }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                opacity: 0.65,
                marginBottom: 8,
              }}>
                <span>{thread.author}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{threadTag}</span>
              </div>
              <h2 style={{
                fontSize: 18,
                fontWeight: 800,
                margin: "0 0 10px",
                lineHeight: 1.25,
                overflowWrap: "break-word",
              }}>
                {thread.titleBase || "Untitled"}
              </h2>
              <div style={{
                fontSize: 14,
                lineHeight: 1.55,
                opacity: threadDeleted ? 0.55 : 1,
                fontStyle: threadDeleted ? "italic" : "normal",
                whiteSpace: "pre-wrap",
                overflowWrap: "break-word",
              }}>
                {threadDeleted ? "[deleted by author]" : (thread.body || "")}
              </div>
            </article>
          );
        })()}

        {/* ── Existing responses (mirrors MobileThread's stream so the user */}
        {/*    can scroll up and reread the full conversation while writing. */}
        {/*    Same chainVisible filter — orphans hidden, soft-deleted shown */}
        {/*    as tombstones only when responded to. Lighter card than the   */}
        {/*    MobileThread version: drops the edited/timestamp footer since */}
        {/*    the user is composing, not browsing.                          */}
        {visibleReplies.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {visibleReplies.map(r => {
              if (r.isDeleted) {
                return (
                  <div key={r.id} style={{
                    background: "transparent",
                    border: "2px dashed rgba(253,248,236,0.4)",
                    color: "rgba(253,248,236,0.6)",
                    borderRadius: 10,
                    padding: "10px 14px",
                    fontStyle: "italic",
                    fontSize: 13,
                  }}>
                    @{r.author} deleted their response.
                  </div>
                );
              }
              const replyTag = `S${String(r.season).padStart(2, "0")} E${String(r.episode).padStart(2, "0")}`;
              return (
                <div key={r.id} style={{
                  background: "transparent",
                  border: "2px solid #FEF8EA",
                  color: "#FEF8EA",
                  borderRadius: 10,
                  padding: "12px 14px",
                }}>
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    opacity: 0.85,
                    marginBottom: 6,
                  }}>
                    <span>{r.author}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{replyTag}</span>
                  </div>
                  <div style={{
                    fontSize: 14,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "break-word",
                  }}>
                    {linkifyText(r.body)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Tag pill + rewatcher note (your reply's context) ── */}
        <div style={{
          marginBottom: 12,
          fontSize: 12,
          opacity: 0.85,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}>
          <span style={{
            fontVariantNumeric: "tabular-nums",
            background: "rgba(253,248,236,0.18)",
            padding: "2px 8px",
            borderRadius: 999,
            fontWeight: 700,
          }}>
            your reply tag {tag}
          </span>
          {progress?.isRewatching && (
            <span style={{ opacity: 0.85 }}>(your highest, since you&rsquo;re rewatching)</span>
          )}
        </div>

        {/* ── Body textarea ── */}
        <textarea
          ref={textareaRef}
          className="m-input"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Your response"
          maxLength={5000}
          rows={10}
          autoFocus
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 16,
            fontFamily: "inherit",
            lineHeight: 1.5,
            border: "2px solid rgba(253,248,236,0.4)",
            borderRadius: 10,
            background: "rgba(253,248,236,0.08)",
            color: "#FEF8EA",
            outline: "none",
            boxSizing: "border-box",
            WebkitAppearance: "none",
            resize: "vertical",
            minHeight: 200,
          }}
        />

        {submitError && (
          <div style={{
            marginTop: 12,
            color: "#FEF8EA",
            background: "rgba(244,80,40,0.9)",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}>
            {submitError}
          </div>
        )}

        {/* ── Submit (moved from header to under the body field) ── */}
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "16px 0",
            fontSize: 18,
            fontWeight: 800,
            fontFamily: "inherit",
            background: canSubmit ? "#FEF8EA" : "rgba(253,248,236,0.4)",
            color: "var(--dos-bg)",
            border: "none",
            borderRadius: 9999,
            cursor: canSubmit ? "pointer" : "default",
            letterSpacing: "0.02em",
          }}
        >
          {submitting ? <LoadingDots /> : "Send"}
        </button>
      </div>
    </div>
  );
}
