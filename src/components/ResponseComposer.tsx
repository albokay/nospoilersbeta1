import React, { useRef, useState, useEffect } from "react";
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
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: "var(--dos-border)" }}>Write a response</div>

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
          background: "#fff",
          color: "#000",
          border: "none",
          borderRadius: 8,
          padding: "8px 10px",
          fontSize: 14,
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />

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
        {(() => {
          // Three-way context resolves from (inGroupContext, threadIsPublic).
          // Each context gets a white-fill submit button with its canon
          // accent color as text + border, and a context-specific label.
          // Canon palette: #dea838 yellow (public), #7abd8e green
          // (private / default), #1a3a4a navy (friend room).
          const accent = inGroupContext
            ? "#1a3a4a"
            : threadIsPublic
              ? "#dea838"
              : "#7abd8e";
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
              style={{ background: "#fff", border: `2px solid ${accent}`, color: accent }}
            >
              {submitting ? "Posting…" : label}
            </button>
          );
        })()}
      </div>
    </div>
  );
}
