import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  insertReply,
  fetchThreadById,
  fetchAllFriendGroupsWithActivity,
  fetchProgress,
} from "../lib/db";
import type { Thread, ProgressEntry } from "../types";
import { effectiveProgress } from "../lib/utils";
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
  const [progress, setProgress] = useState<ProgressEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetchThreadById(threadId),
      fetchAllFriendGroupsWithActivity(user.id),
      fetchProgress(user.id),
    ])
      .then(([t, rooms, progressMap]) => {
        if (cancelled) return;
        if (!t) { setLoadError("not_found"); return; }
        const room = rooms.find(r => r.id === groupId);
        if (!room) { setLoadError("not_member"); return; }
        // Membership matches the room; the show_id path goes via thread,
        // not via room, so use thread.showId to pull progress.
        setThread(t);
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
    color: "#fff",
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
            background: "transparent", color: "#fff",
            border: "2px solid #fff",
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
            background: "#fff", color: "var(--dos-bg)",
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
              background: "transparent", color: "#fff",
              border: "none",
              fontSize: 15, fontWeight: 600, cursor: submitting ? "default" : "pointer",
              fontFamily: "inherit", opacity: submitting ? 0.55 : 0.85,
              padding: "6px 0",
            }}
          >
            Cancel
          </button>
        </div>

        {/* ── Context: thread title + tag ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            opacity: 0.65,
            marginBottom: 4,
          }}>
            Responding to
          </div>
          <div style={{
            fontSize: 14,
            fontWeight: 700,
            lineHeight: 1.35,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}>
            {thread?.titleBase || "Untitled"}
          </div>
          <div style={{
            marginTop: 8,
            fontSize: 12,
            opacity: 0.85,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}>
            <span style={{
              fontVariantNumeric: "tabular-nums",
              background: "rgba(255,255,255,0.18)",
              padding: "2px 8px",
              borderRadius: 999,
              fontWeight: 700,
            }}>
              tag {tag}
            </span>
            {progress?.isRewatching && (
              <span style={{ opacity: 0.85 }}>(your highest, since you&rsquo;re rewatching)</span>
            )}
          </div>
        </div>

        {/* ── Body textarea ── */}
        <textarea
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
            border: "2px solid rgba(255,255,255,0.4)",
            borderRadius: 10,
            background: "rgba(255,255,255,0.08)",
            color: "#fff",
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
            color: "#fff",
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
            background: canSubmit ? "#fff" : "rgba(255,255,255,0.4)",
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
