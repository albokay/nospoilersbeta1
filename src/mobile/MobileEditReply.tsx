import { CANON } from "../styles/canon";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  editReply,
  fetchThreadById,
  fetchRepliesForThread,
  fetchProgress,
  fetchAllFriendGroupsWithActivity,
} from "../lib/db";
import type { Thread, Reply, ProgressEntry } from "../types";
import { effectiveProgress } from "../lib/utils";
import LoadingDots from "../components/LoadingDots";

// /m/rooms/:groupId/thread/:threadId/reply/:replyId/edit — edit an
// existing reply. Body-only (replies have no title).
//
// Mirrors MobileRespond's structure (full-screen, Cancel top-left, Save
// below the body) but reads existing reply data and calls editReply
// instead of insertReply. Author-only is server-side enforced (RLS);
// the kebab on a reply card only opens for the author anyway.
//
// Always retags: editReply receives current effectiveProgress as the
// season/episode arguments. Same retag policy as MobileEditThread —
// every edit retags. Banner explaining the retag lands in chunk 4.
export default function MobileEditReply({
  groupId,
  threadId,
  replyId,
}: {
  groupId: string;
  threadId: string;
  replyId: string;
}) {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [thread, setThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
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
      fetchRepliesForThread(threadId, groupId),
      fetchAllFriendGroupsWithActivity(user.id),
      fetchProgress(user.id),
    ])
      .then(([t, replies, rooms, progressMap]) => {
        if (cancelled) return;
        if (!t) { setLoadError("not_found"); return; }
        const room = rooms.find(r => r.id === groupId);
        if (!room) { setLoadError("not_member"); return; }
        const r = replies.find(x => x.id === replyId);
        if (!r) { setLoadError("reply_not_found"); return; }
        if (profile?.username && r.author !== profile.username) {
          setLoadError("not_author");
          return;
        }
        setThread(t);
        setReply(r);
        setProgress(progressMap[t.showId] ?? null);
        setBody(r.body || "");
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("MobileEditReply fetch failed:", err);
        setLoadError("fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [groupId, threadId, replyId, user?.id, profile?.username]);

  const eff = effectiveProgress(progress);
  const tag = eff
    ? `S${String(eff.s).padStart(2, "0")} E${String(eff.e).padStart(2, "0")}`
    : null;

  // "Progress has moved past where you were when you first wrote this":
  // current effective > stored reply tag. Same shape as MobileEditThread —
  // see comment there for the rewatcher / first-timer monotonicity note.
  const progressAdvanced = !!(eff && reply && (
    eff.s > reply.season ||
    (eff.s === reply.season && eff.e > reply.episode)
  ));

  const canSubmit =
    !!user && !!reply && !!eff &&
    body.trim().length > 0 &&
    !submitting;

  const onSubmit = async () => {
    if (!user || !reply || !eff) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await editReply(reply.id, body.trim(), eff.s, eff.e);
      navigate(`/m/rooms/${groupId}/thread/${threadId}`, { replace: true });
    } catch (err) {
      console.warn("MobileEditReply submit failed:", err);
      const msg = err instanceof Error ? err.message : "Could not save. Try again.";
      setSubmitError(msg);
      setSubmitting(false);
    }
  };

  // ── Render ──

  const wrapper: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--dos-bg, var(--canon-personal,#7abd8e))",
    color: CANON.cream,
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
          {loadError === "not_found"       && "This entry doesn't exist or has been removed."}
          {loadError === "reply_not_found" && "This response doesn't exist or has been removed."}
          {loadError === "not_member"      && "You're not in this room."}
          {loadError === "not_author"      && "You can only edit your own responses."}
          {loadError === "fetch_failed"    && "Couldn't load. Try again."}
        </p>
        <button
          onClick={() => navigate(`/m/rooms/${groupId}/thread/${threadId}`, { replace: true })}
          style={{
            background: "transparent", color: CANON.cream,
            border: "2px solid var(--canon-cream,#fef8ea)",
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
          Set your watch progress before editing. Edits retag the response to your current episode.
        </p>
        <button
          onClick={() => navigate(`/m/rooms/${groupId}/progress`)}
          style={{
            background: CANON.cream, color: "var(--dos-bg)",
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
        {/* ── Top bar (Cancel only — Save is below the body) ── */}
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
              background: "transparent", color: CANON.cream,
              border: "none",
              fontSize: 15, fontWeight: 600, cursor: submitting ? "default" : "pointer",
              fontFamily: "inherit", opacity: submitting ? 0.55 : 0.85,
              padding: "6px 0",
            }}
          >
            Cancel
          </button>
        </div>

        <h1 style={{ fontSize: 18, fontWeight: 800, margin: "8px 0 6px" }}>Edit response</h1>

        {/* ── Tag pill ── */}
        <div style={{
          fontSize: 12,
          opacity: 0.85,
          margin: "0 0 16px",
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
            tag {tag}
          </span>
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
            border: "2px solid rgba(253,248,236,0.4)",
            borderRadius: 10,
            background: "rgba(253,248,236,0.08)",
            color: CANON.cream,
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
            color: CANON.cream,
            background: "rgba(244,80,40,0.9)",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
          }}>
            {submitError}
          </div>
        )}

        {/* ── Retag warning banner ── */}
        {/* Same pattern as MobileEditThread — fires only when the user's */}
        {/* current effective progress is past the reply's stored tag.    */}
        {/* Sits directly above the Confirm button so the heads-up lands  */}
        {/* at the moment of commit. Canon-red border + text per polish.  */}
        {progressAdvanced && (
          <div style={{
            margin: "16px 0 0",
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(253,248,236,0.08)",
            border: "2px solid var(--canon-alert,#f45028)",
            fontSize: 13,
            lineHeight: 1.5,
            color: CANON.alert,
          }}>
            <strong style={{ display: "block", fontWeight: 800, marginBottom: 4 }}>
              Heads up
            </strong>
            Your progress has moved past where you were when you first wrote this. Editing it will retag it to your current watch progress.
          </div>
        )}

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
            background: canSubmit ? CANON.cream : "rgba(253,248,236,0.4)",
            color: "var(--dos-bg)",
            border: "none",
            borderRadius: 9999,
            cursor: canSubmit ? "pointer" : "default",
            letterSpacing: "0.02em",
          }}
        >
          {submitting ? <LoadingDots /> : (progressAdvanced ? "Confirm" : "Save")}
        </button>
      </div>
    </div>
  );
}
