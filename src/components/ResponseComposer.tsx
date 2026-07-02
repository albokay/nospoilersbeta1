import React, { useRef, useState, useEffect } from "react";
import { CANON } from "../styles/canon";
import { useAuth } from "../lib/auth";
import { insertReply, fetchPrompts, logThreadPrompt } from "../lib/db";
import type { PromptRow } from "../lib/db";
import PromptCard from "./PromptCard";
import type { PromptEntry } from "../lib/promptData";
import { getPromptSuggestion } from "../lib/prompts";
import type { Show } from "../lib/db";

export interface PendingReference {
  type: "quote" | "link";
  replyId?: string;      // if referencing a reply
  threadId?: string;     // if referencing the original entry
  authorName: string;
  quotedText?: string;   // for quote type only
}

interface ResponseComposerProps {
  threadId: string;
  showId: string;
  viewerSeason: number;
  viewerEpisode: number;
  // Override tag applied to new replies (for re-watchers, this is their highest prior progress)
  postTagSeason?: number;
  postTagEpisode?: number;
  isRewatch?: boolean;
  // Rewatch-position snapshot (display-only) for the badge inline tag
  rewatchSnapshotSeason?: number;
  rewatchSnapshotEpisode?: number;
  onSubmitted: () => void;
  onCancel: () => void;
  pendingReference: PendingReference | null;
  onClearReference: () => void;
  composerRef: React.RefObject<HTMLDivElement>;
  onAuthRequired: () => void;
  threadAuthor: string;
  onExternalReplyAdded?: () => void;
  show?: Show;
  progress?: { s: number; e: number };
  inGroupContext?: boolean;
  groupId?: string | null;
  // Whether the thread being responded to is public. Combined with
  // inGroupContext this resolves the three contexts the submit button
  // styles against: friend room / public thread / private thread.
  threadIsPublic: boolean;
  // Public-room permission gate (public-rooms scope, 2026). When requestMode
  // is true the viewer isn't yet allowed to respond in this owner's public
  // room, so the composer switches to "request to respond": it collects an
  // optional note and HOLDS the response (via onSubmitRequest) for the owner
  // to approve, instead of publishing it. Off everywhere these props are
  // omitted (friend rooms, private, the general aggregate) — behavior there
  // is unchanged.
  requestMode?: boolean;
  requestOwnerUsername?: string;
  requestHasPending?: boolean;
  onSubmitRequest?: (payload: {
    body: string;
    message: string;
    season: number;
    episode: number;
    reference: PendingReference | null;
  }) => Promise<void>;
}

export default function ResponseComposer({
  threadId,
  showId,
  viewerSeason,
  viewerEpisode,
  postTagSeason,
  postTagEpisode,
  isRewatch,
  rewatchSnapshotSeason,
  rewatchSnapshotEpisode,
  onSubmitted,
  onCancel,
  pendingReference,
  onClearReference,
  composerRef,
  onAuthRequired,
  threadAuthor,
  onExternalReplyAdded,
  show,
  progress,
  inGroupContext,
  groupId,
  threadIsPublic,
  requestMode = false,
  requestOwnerUsername,
  requestHasPending = false,
  onSubmitRequest,
}: ResponseComposerProps) {
  // Re-watchers tag replies at their highest prior progress; others use viewerSeason/Episode
  const replyTagS = postTagSeason ?? viewerSeason;
  const replyTagE = postTagEpisode ?? viewerEpisode;
  const { user, profile } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteInserted, setQuoteInserted] = useState(false);
  // Request-mode (public-room gate) local state.
  const [requestMessage, setRequestMessage] = useState("");
  const [requestSent, setRequestSent] = useState(false);

  // ── Prompt state ─────────────────────────────────────────
  const [promptEntries, setPromptEntries] = useState<PromptEntry[]>([]);
  const [activePrompt, setActivePrompt] = useState<PromptEntry | null>(null);
  const [shownPromptIds, setShownPromptIds] = useState<number[]>([]);
  const [insertedPromptIds, setInsertedPromptIds] = useState<number[]>([]);

  useEffect(() => {
    fetchPrompts()
      .then((rows: PromptRow[]) => {
        setPromptEntries(
          rows.map((r) => ({
            id: r.id,
            text: r.text,
            displayType: r.display_type,
            tvmazeTypes: r.tvmaze_types,
            genres: r.genres,
            progressTags: r.progress_tags,
            themes: r.themes,
          }))
        );
      })
      .catch(() => {});
  }, []);

  const handlePromptBtn = () => {
    if (!show || !progress) return;
    const next = getPromptSuggestion(show, progress, shownPromptIds, promptEntries);
    if (next) {
      setShownPromptIds((prev) => [...prev, next.id]);
      setActivePrompt(next);
    }
  };

  const handlePromptShuffle = () => {
    if (!show || !progress) return;
    const next = getPromptSuggestion(show, progress, shownPromptIds, promptEntries);
    if (next) {
      setShownPromptIds((prev) => [...prev, next.id]);
      setActivePrompt(next);
    }
  };

  const handlePromptInsert = (text: string) => {
    if (!activePrompt) return;
    const ta = textareaRef.current;
    const token = `[PROMPT: ${text}]`;
    if (ta) {
      const pos = ta.selectionStart ?? body.length;
      const before = body.slice(0, pos).trimEnd();
      const after = body.slice(pos).trimStart();
      const prefix = before.length ? "\n" : "";
      const suffix = "\n";
      const newBody = before + prefix + token + suffix + after;
      const newPos = before.length + prefix.length + token.length + suffix.length;
      setBody(newBody);
      requestAnimationFrame(() => {
        ta.selectionStart = newPos;
        ta.selectionEnd = newPos;
        ta.focus();
      });
    } else {
      setBody((prev) => prev.trimEnd() + (prev.trim() ? "\n" : "") + token + "\n");
    }
    setInsertedPromptIds((prev) => [...prev, activePrompt.id]);
    setActivePrompt(null);
  };

  // Reset quoteInserted when pendingReference changes
  React.useEffect(() => {
    setQuoteInserted(false);
  }, [pendingReference]);

  const handleInsertQuote = () => {
    if (!textareaRef.current || !pendingReference?.quotedText) return;
    const ta = textareaRef.current;
    const pos = ta.selectionStart ?? body.length;
    const token = `[QUOTE: ${pendingReference.quotedText}]`;
    const before = body.slice(0, pos).trimEnd();
    const after = body.slice(pos).trimStart();
    const newBody = before + (before ? "\n" : "") + token + "\n" + after;
    setBody(newBody);
    setQuoteInserted(true);
    // Restore cursor after the token + newline
    const cursorPos = before.length + (before ? 1 : 0) + token.length + 1;
    requestAnimationFrame(() => {
      ta.selectionStart = cursorPos;
      ta.selectionEnd = cursorPos;
      ta.focus();
    });
  };

  const handleSubmit = async (_isPrivate: boolean) => {
    if (!user || !profile) { onAuthRequired(); return; }
    const trimmed = body.trim();
    if (!trimmed) return;

    // Request-to-respond path: the viewer can't respond directly in this
    // owner's public room, so HOLD the response for approval instead of
    // publishing it. (Public-rooms scope, 2026.)
    if (requestMode && onSubmitRequest) {
      setSubmitting(true);
      setError(null);
      try {
        await onSubmitRequest({
          body: trimmed,
          message: requestMessage.trim(),
          season: replyTagS,
          episode: replyTagE,
          reference: pendingReference,
        });
        setBody("");
        setRequestMessage("");
        setQuoteInserted(false);
        setActivePrompt(null);
        onClearReference();
        setRequestSent(true);
      } catch (e: any) {
        setError(e?.message ?? "Couldn't send your request. Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const reply = await insertReply({
        threadId,
        showId,
        season: replyTagS,
        episode: replyTagE,
        authorId: user.id,
        authorName: profile.username,
        body: trimmed,
        referenceType: pendingReference?.type ?? null,
        referencedReplyId: pendingReference?.replyId ?? null,
        referencedThreadId: pendingReference?.threadId ?? null,
        quotedText: (pendingReference?.type === "quote" ? pendingReference.quotedText : null) ?? null,
        isRewatch: isRewatch ?? false,
        rewatchSeason: isRewatch ? rewatchSnapshotSeason : undefined,
        rewatchEpisode: isRewatch ? rewatchSnapshotEpisode : undefined,
        groupId: groupId ?? null,
      });
      // Log prompt usage (best-effort)
      for (const pid of insertedPromptIds) {
        logThreadPrompt(reply.id, pid).catch(() => {});
      }
      setInsertedPromptIds([]);
      setBody("");
      setQuoteInserted(false);
      setActivePrompt(null);
      onClearReference();
      if (profile.username !== threadAuthor) onExternalReplyAdded?.();
      onSubmitted();
    } catch (e: any) {
      setError(e?.message ?? "Failed to post. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={composerRef}
      className="card"
      style={{ marginTop: 16, border: "2px solid var(--dos-border)", borderRadius: 24 }}
      id="response-composer"
    >
      {requestSent ? (
        <div style={{ fontSize: 14, color: "var(--dos-border)", lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Request sent.</div>
          <div>
            We let {requestOwnerUsername ? `@${requestOwnerUsername}` : "the author"} know
            you'd like to respond. If they approve, your response is published here — and
            you'll be able to respond to their public writing from then on.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button
              className="btn"
              onClick={onCancel}
              style={{ background: CANON.cream, border: "2px solid var(--canon-accent,#dea838)", color: CANON.accent }}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
       <>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: "var(--dos-border)" }}>
        {requestMode
          ? (requestOwnerUsername ? `Respond to @${requestOwnerUsername}` : "Respond")
          : "Write a response"}
      </div>

      {/* Pending reference row */}
      {pendingReference && pendingReference.type === "quote" && !quoteInserted && (
        <div style={{ marginBottom: 8 }}>
          <div className="insert-quote-chip">
            <button className="insert-quote-main" onClick={handleInsertQuote}>
              Insert quotation from {pendingReference.authorName}.
            </button>
            <button className="insert-quote-cancel" onClick={onClearReference} title="Cancel">×</button>
          </div>
        </div>
      )}
      {pendingReference && pendingReference.type === "link" && (
        <div style={{ marginBottom: 8 }}>
          <span className="pending-ref-chip">
            Responding to {pendingReference.authorName}
            <button onClick={onClearReference} title="Discard reference">×</button>
          </span>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your response…"
        rows={8}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: CANON.cream,
          color: "#000",
          border: "none",
          borderRadius: 8,
          padding: "8px 10px",
          fontSize: 14,
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />

      {/* Permission-request section (public-room gate). The viewer writes
          their response above; here they add an optional note. Submitting
          sends both together and holds the response for the owner. */}
      {requestMode && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 12,
            borderTop: "1px dashed var(--dos-border)",
            fontSize: 13,
            color: "var(--dos-border)",
            lineHeight: 1.45,
          }}
        >
          <div style={{ marginBottom: 8 }}>
            You're not in a friend room with{" "}
            {requestOwnerUsername ? `@${requestOwnerUsername}` : "this writer"} yet, so your
            response is sent for approval. They'll see your note and your response.
          </div>
          {profile && (
            <div style={{ marginBottom: 8 }}>
              From: <strong style={{ fontWeight: 700 }}>@{profile.username}</strong>
            </div>
          )}
          <textarea
            value={requestMessage}
            onChange={(e) => setRequestMessage(e.target.value)}
            placeholder={`Tell ${requestOwnerUsername ? "@" + requestOwnerUsername : "them"} who you are and why you want to respond (optional)`}
            rows={2}
            maxLength={500}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: CANON.cream,
              color: "#000",
              border: "none",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 13,
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
          {requestHasPending && (
            <div style={{ marginTop: 8, fontStyle: "italic" }}>
              You already have a request pending with{" "}
              {requestOwnerUsername ? `@${requestOwnerUsername}` : "this writer"}. Sending
              again adds another response for them to approve.
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 4 }}>{error}</div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 8 }}>
        <button
          className="btn"
          onClick={onCancel}
          disabled={submitting}
          style={{ background: "transparent", border: "2px solid var(--danger)", color: "var(--danger)" }}
        >
          Cancel
        </button>
        {requestMode ? (
          <button
            className="btn"
            onClick={() => handleSubmit(false)}
            disabled={submitting || !body.trim()}
            style={{ background: CANON.cream, border: "2px solid var(--canon-accent,#dea838)", color: CANON.accent }}
          >
            {submitting ? "Sending…" : "Send request"}
          </button>
        ) : (() => {
          // Three-way context resolves from (inGroupContext, threadIsPublic).
          // Each context gets a white-fill submit button with its canon
          // accent color as text + border, and a context-specific label.
          // Canon palette: var(--canon-accent,#dea838) yellow (public), var(--canon-personal,#7abd8e) green
          // (private / default), var(--canon-dark,#1a3a4a) navy (friend room).
          const accent = inGroupContext
            ? CANON.dark
            : threadIsPublic
              ? CANON.accent
              : CANON.personal;
          const label = inGroupContext
            ? "Send to the room"
            : threadIsPublic
              ? "Share response"
              : "Add your thoughts";
          return (
            <button
              className="btn"
              onClick={() => handleSubmit(false)}
              disabled={submitting || !body.trim()}
              style={{ background: CANON.cream, border: `2px solid ${accent}`, color: accent }}
            >
              {submitting ? "Posting…" : label}
            </button>
          );
        })()}
      </div>
       </>
      )}
    </div>
  );
}
