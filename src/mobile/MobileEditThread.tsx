import { CANON } from "../styles/canon";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  editThread,
  fetchThreadById,
  fetchProgress,
  fetchAllFriendGroupsWithActivity,
} from "../lib/db";
import type { Thread, ProgressEntry } from "../types";
import { effectiveProgress } from "../lib/utils";
import LoadingDots from "../components/LoadingDots";

// /m/rooms/:groupId/thread/:threadId/edit — edit an existing thread.
//
// Mirrors MobileCompose's structure (full-screen, Cancel top-left, Save
// below the body) but reads existing thread data and calls editThread
// instead of insertThread + addThreadToGroup. Author-only is server-side
// enforced (RLS); the client doesn't gate the screen because the kebab
// only appears on author-owned cards anyway.
//
// Always retags: editThread receives current effectiveProgress as the
// season/episode arguments. Per user spec for mobile, there is no
// "save without retagging" path — every edit retags. The "your progress
// has moved" warning banner is added in chunk 4 of the post-spec polish
// pass; this chunk lays the edit form so chunk 4 can drop the banner in.
export default function MobileEditThread({ groupId, threadId }: { groupId: string; threadId: string }) {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [thread, setThread] = useState<Thread | null>(null);
  const [progress, setProgress] = useState<ProgressEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
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
        // Author guard. Server-side RLS would also reject the UPDATE,
        // but this gives a cleaner error message before the user types.
        if (profile?.username && t.author !== profile.username) {
          setLoadError("not_author");
          return;
        }
        setThread(t);
        setProgress(progressMap[t.showId] ?? null);
        setTitle(t.titleBase || "");
        setBody(t.body || "");
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("MobileEditThread fetch failed:", err);
        setLoadError("fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [groupId, threadId, user?.id, profile?.username]);

  const eff = effectiveProgress(progress);
  const tag = eff
    ? `S${String(eff.s).padStart(2, "0")} E${String(eff.e).padStart(2, "0")}`
    : null;

  // "Progress has moved past where you were when you first wrote this":
  // current effective > stored thread tag. Defensive against the
  // theoretical eff < stored case (shouldn't happen — rewatcher's
  // highestS/E is monotonic and first-timers can only move forward — but
  // if it ever did, no banner since the retag wouldn't be "advancing").
  const progressAdvanced = !!(eff && thread && (
    eff.s > thread.season ||
    (eff.s === thread.season && eff.e > thread.episode)
  ));

  const canSubmit =
    !!user && !!thread && !!eff &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    !submitting;

  const onSubmit = async () => {
    if (!user || !thread || !eff) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Always retags — pass current eff.s/eff.e. The "your progress has
      // moved past where you were when you first wrote this" banner that
      // explains the retag is added in chunk 4 of the polish pass.
      await editThread(thread.id, title.trim(), body.trim(), eff.s, eff.e);
      navigate(`/m/rooms/${groupId}/thread/${threadId}`, { replace: true });
    } catch (err) {
      console.warn("MobileEditThread submit failed:", err);
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
          {loadError === "not_found"   && "This entry doesn't exist or has been removed."}
          {loadError === "not_member"  && "You're not in this room."}
          {loadError === "not_author"  && "You can only edit your own entries."}
          {loadError === "fetch_failed" && "Couldn't load. Try again."}
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
          Set your watch progress before editing. Edits retag the entry to your current episode.
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

        <h1 style={{ fontSize: 18, fontWeight: 800, margin: "8px 0 6px" }}>Edit entry</h1>

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

        {/* ── Title input ── */}
        <input
          className="m-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title"
          maxLength={200}
          autoFocus
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 18,
            fontWeight: 700,
            fontFamily: "inherit",
            border: "2px solid rgba(253,248,236,0.4)",
            borderRadius: 10,
            background: "rgba(253,248,236,0.08)",
            color: CANON.cream,
            outline: "none",
            boxSizing: "border-box",
            WebkitAppearance: "none",
            marginBottom: 10,
          }}
        />

        {/* ── Body textarea ── */}
        <textarea
          className="m-input"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What did you think about this episode?"
          maxLength={10000}
          rows={12}
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
            minHeight: 240,
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
        {/* Shown only when current effective progress is past the entry's */}
        {/* stored season/episode. Informational — the retag happens on    */}
        {/* save regardless, but the banner makes it explicit. Sits        */}
        {/* directly above the Confirm button (relocated from above the   */}
        {/* form fields) so the warning lands at the moment of commit.    */}
        {/* Canon-red border + text since the message is a heads-up the   */}
        {/* user shouldn't miss before tapping Confirm.                    */}
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
