import { X as XIcon } from "lucide-react";
import React, { useRef, useState, useEffect } from "react";
import { CANON } from "../styles/canon";
import { useEditorialScope } from "../lib/skin";
import { E } from "../styles/editorial";
import { UNDERLINE_WORD, INK_BLOCK_M, INK_SMALL, REPLY_TA_CSS } from "./editorial/MapNotes";
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
  /** Mobile show room (2026-08-18): the box sits centered in the entry
   *  card (no left indent) — mirrors RepliesList's mobileIdiom. */
  mobileIdiom?: boolean;
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
  mobileIdiom = false,
}: ResponseComposerProps) {
  // Re-watchers tag replies at their highest prior progress; others use viewerSeason/Episode
  const replyTagS = postTagSeason ?? viewerSeason;
  const replyTagE = postTagEpisode ?? viewerEpisode;
  const { user, profile } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The editorial reply box (Alborz's notes, item 7): the writing in Lora
  // inside a 1px ink frame on the paper, the staged quotation and the
  // "responding to" chip as mono frames, Send as the ink block, Cancel as an
  // underlined word. Same send, same request path.
  const editorialScope = useEditorialScope();
  // M-pill geometry for the composer's buttons (colors/hovers stay on the
  // sb-* classes; polish pass 2026-09-15).
  const mPillGeom: React.CSSProperties = {
    fontSize: 14, fontWeight: 700, padding: "12px 28px", minHeight: 44,
    borderRadius: 9999, boxSizing: "border-box",
  };
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
      setError(e?.message ?? "Couldn't send. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // Simplified 2026-08-13 (Alborz, approved mockup docs/
    // response-composer-preview.html): the outer outlined card and its
    // "Write a response" label are RETIRED — the cream textarea IS the
    // composer (one outline, one prompt: the placeholder). The requestMode
    // heading survives (its "Respond to @X" carries real context).
    <div
      ref={composerRef}
      // marginLeft 8 lines the box up with the reply cards (their own
      // marginLeft — Alborz 2026-08-13 tweak 2); 0 on mobile, where both
      // sit centered (Alborz 2026-08-18).
      style={{ marginTop: 16, marginLeft: editorialScope || mobileIdiom ? 0 : 8 }}
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
              className={editorialScope ? undefined : "btn"}
              onClick={onCancel}
              style={editorialScope ? INK_SMALL : { background: CANON.cream, border: "2px solid var(--canon-accent,#dea838)", color: CANON.accent }}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
       <>
      {requestMode && (
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: "var(--dos-border)" }}>
          {requestOwnerUsername ? `Respond to @${requestOwnerUsername}` : "Respond"}
        </div>
      )}

      {/* Pending reference row */}
      {pendingReference && pendingReference.type === "quote" && !quoteInserted && (
        <div style={{ marginBottom: 8 }}>
          <div className="insert-quote-chip" style={editorialScope ? { border: `1px solid ${E.color.ink}`, borderRadius: 0, ...E.type.label11, minHeight: 34 } : undefined}>
            <button className="insert-quote-main" onClick={handleInsertQuote} style={editorialScope ? { color: E.color.ink, fontFamily: E.font.label, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 11 } : undefined}>
              Insert quotation from {pendingReference.authorName}.
            </button>
            <button className="insert-quote-cancel" onClick={onClearReference} title="Cancel" style={{ display: "inline-flex", alignItems: "center", ...(editorialScope ? { color: E.color.ink, borderLeft: `1px solid ${E.color.ink}`, opacity: 1 } : {}) }}><XIcon size={14} /></button>
          </div>
        </div>
      )}
      {pendingReference && pendingReference.type === "link" && (
        <div style={{ marginBottom: 8 }}>
          <span className="pending-ref-chip" style={editorialScope ? { background: "transparent", border: `1px solid ${E.color.ink}`, borderRadius: 0, ...E.type.label10, fontStyle: "normal", color: E.color.ink, padding: "6px 10px" } : undefined}>
            Responding to {pendingReference.authorName}
            <button onClick={onClearReference} title="Discard reference" style={editorialScope ? { color: E.color.ink, opacity: 1 } : undefined}>×</button>
          </span>
        </div>
      )}

      {/* Cream shell + transparent textarea: the native resize handle sits
          at the TEXTAREA's corner, so the 8px right/bottom shell padding
          floats it 8px up-and-left of the visible corner (Alborz 2026-08-13
          tweak 1 — it got lost flush in the corner). */}
      {editorialScope && <style>{REPLY_TA_CSS}</style>}
      <div style={editorialScope ? { background: "transparent", border: `1px solid ${E.color.ink}`, borderRadius: 0, padding: "0 8px 8px 0" } : { background: CANON.cream, borderRadius: 12, padding: "0 8px 8px 0" }}>
        <textarea
          ref={textareaRef}
          className={editorialScope ? "d-comp-ta e-reply-ta" : "d-comp-ta"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your response…"
          rows={8}
          style={editorialScope ? {
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            background: "transparent",
            color: E.color.ink,
            border: "none",
            borderRadius: 0,
            padding: "14px 16px",
            ...E.type.letterBody15,
            lineHeight: 1.6,
            resize: "vertical",
            outline: "none",
          } : {
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            background: "transparent",
            color: CANON.dark,
            border: "none",
            borderRadius: 12, // polish pass 2026-09-15 (was 15)
            padding: "14px 16px",
            fontSize: 15,
            lineHeight: 1.6,
            resize: "vertical",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
      </div>

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

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: editorialScope ? 18 : 12, marginTop: editorialScope ? 12 : 8 }}>
        <button
          // Cream outline at rest; alert only on hover (polish pass
          // 2026-09-15 — cancelling a draft isn't destructive, and the
          // draft-loss confirm already exists).
          className={editorialScope ? undefined : "btn sb-cancel-quiet"}
          onClick={onCancel}
          disabled={submitting}
          style={editorialScope ? UNDERLINE_WORD : mPillGeom}
        >
          Cancel
        </button>
        {requestMode ? (
          <button
            className={editorialScope ? undefined : "btn"}
            onClick={() => handleSubmit(false)}
            disabled={submitting || !body.trim()}
            style={editorialScope ? { ...INK_BLOCK_M, opacity: submitting || !body.trim() ? 0.6 : 1 } : { ...mPillGeom, background: CANON.cream, border: "2px solid var(--canon-accent,#dea838)", color: CANON.accent }}
          >
            {submitting ? "Sending…" : "Send request"}
          </button>
        ) : (() => {
          // Context-specific LABEL only (2026-08-13, Alborz): all three
          // variants share ONE style. Polish pass 2026-09-15 (approved):
          // identity fill + cream text — the site's one primary-button
          // grammar; the cream-fill/sky-text version was ≈1.7:1.
          const label = inGroupContext
            ? "Send"
            : threadIsPublic
              ? "Share response"
              : "Add your thoughts";
          return (
            // sb-send (theme.ts): Identity fill + cream text; hover = cream
            // fill + identity text.
            <button
              className={editorialScope ? undefined : "btn sb-send"}
              onClick={() => handleSubmit(false)}
              disabled={submitting || !body.trim()}
              style={editorialScope ? { ...INK_BLOCK_M, opacity: submitting || !body.trim() ? 0.6 : 1 } : mPillGeom}
            >
              {submitting ? "Sending…" : label}
            </button>
          );
        })()}
      </div>
       </>
      )}
    </div>
  );
}
