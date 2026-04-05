import React, { useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { insertReply } from "../lib/db";
import Tooltip from "./Tooltip";

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
  onSubmitted: () => void;
  onCancel: () => void;
  pendingReference: PendingReference | null;
  onClearReference: () => void;
  composerRef: React.RefObject<HTMLDivElement>;
  onAuthRequired: () => void;
  threadAuthor: string;
  onExternalReplyAdded?: () => void;
}

export default function ResponseComposer({
  threadId,
  showId,
  viewerSeason,
  viewerEpisode,
  onSubmitted,
  onCancel,
  pendingReference,
  onClearReference,
  composerRef,
  onAuthRequired,
  threadAuthor,
  onExternalReplyAdded,
}: ResponseComposerProps) {
  const { user, profile } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteInserted, setQuoteInserted] = useState(false);

  // Reset quoteInserted when pendingReference changes
  React.useEffect(() => {
    setQuoteInserted(false);
  }, [pendingReference]);

  const handleInsertQuote = () => {
    if (!textareaRef.current || !pendingReference?.quotedText) return;
    const ta = textareaRef.current;
    const pos = ta.selectionStart ?? body.length;
    const token = `[QUOTE: ${pendingReference.quotedText}]`;
    const newBody = body.slice(0, pos) + token + body.slice(pos);
    setBody(newBody);
    setQuoteInserted(true);
    // Restore cursor after the token
    requestAnimationFrame(() => {
      ta.selectionStart = pos + token.length;
      ta.selectionEnd = pos + token.length;
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
      await insertReply({
        threadId,
        showId,
        season: viewerSeason,
        episode: viewerEpisode,
        authorId: user.id,
        authorName: profile.username,
        body: trimmed,
        referenceType: pendingReference?.type ?? null,
        referencedReplyId: pendingReference?.replyId ?? null,
        referencedThreadId: pendingReference?.threadId ?? null,
        quotedText: (pendingReference?.type === "quote" ? pendingReference.quotedText : null) ?? null,
      });
      setBody("");
      setQuoteInserted(false);
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
      style={{ marginTop: 16, borderLeft: "4px solid var(--dos-accent)" }}
      id="response-composer"
    >
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Write a response</div>

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
            Linking to {pendingReference.authorName}'s response
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
          border: "1px solid var(--dos-border)",
          borderRadius: 4,
          padding: "8px 10px",
          fontSize: 14,
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 4 }}>{error}</div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button
          className="btn"
          onClick={onCancel}
          disabled={submitting}
          style={{ background: "var(--danger)", border: "none", color: "#fff" }}
        >
          Cancel
        </button>
        <Tooltip
          text="Post privately. Your entry will live in your journal alongside everything else you've written — a record of your watching life, whether or not you share it. (If you want, you can swap it to public later.)"
          direction="above"
          align="right"
          width={280}
          tooltipStyle={{ background: "#bdd4de", color: "#000", textAlign: "left", borderRadius: 10, fontSize: 13, fontWeight: 400, lineHeight: 1.5 }}
        >
          <button
            className="btn"
            onClick={() => handleSubmit(true)}
            disabled={submitting || !body.trim()}
            style={{ background: "var(--dos-bg)", border: "2px solid #fff", color: "#fff" }}
          >
            {submitting ? "Saving…" : "📝 Save to your journal"}
          </button>
        </Tooltip>
        <Tooltip
          text="Post publicly. Visible to anyone in this show room who has watched at least as far as you. They won't see spoilers from ahead of your progress, and neither will you see theirs."
          direction="above"
          align="right"
          width={280}
          tooltipStyle={{ background: "#bdd4de", color: "#000", textAlign: "left", borderRadius: 10, fontSize: 13, fontWeight: 400, lineHeight: 1.5 }}
        >
          <button
            className="btn"
            onClick={() => handleSubmit(false)}
            disabled={submitting || !body.trim()}
            style={{ background: "var(--green)", border: "none", color: "#fff" }}
          >
            {submitting ? "Posting…" : "Send to the room"}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
