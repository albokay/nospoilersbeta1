import React, { useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { insertReply } from "../lib/db";

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
    if (!textareaRef.current) return;
    const ta = textareaRef.current;
    const pos = ta.selectionStart ?? body.length;
    const newBody = body.slice(0, pos) + "[QUOTE]" + body.slice(pos);
    setBody(newBody);
    setQuoteInserted(true);
    // Restore cursor after the token
    requestAnimationFrame(() => {
      ta.selectionStart = pos + "[QUOTE]".length;
      ta.selectionEnd = pos + "[QUOTE]".length;
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

      {/* Pending reference chip */}
      {pendingReference && (
        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="pending-ref-chip">
            {pendingReference.type === "quote"
              ? `Quoting ${pendingReference.authorName}`
              : `Linking to ${pendingReference.authorName}'s response`}
            <button onClick={onClearReference} title="Discard reference">×</button>
          </span>
          {pendingReference.type === "quote" && !quoteInserted && (
            <button className="insert-btn" onClick={handleInsertQuote}>
              Insert quote
            </button>
          )}
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
          onClick={() => handleSubmit(true)}
          disabled={submitting || !body.trim()}
          title="Save privately to your journal"
        >
          {submitting ? "Saving…" : "📝 Save to your journal"}
        </button>
        <button
          className="btn primary"
          onClick={() => handleSubmit(false)}
          disabled={submitting || !body.trim()}
        >
          {submitting ? "Posting…" : "Send to the room"}
        </button>
      </div>
    </div>
  );
}
