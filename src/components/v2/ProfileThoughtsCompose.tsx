import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { X, RefreshCw } from "lucide-react";
import LoadingDots from "../LoadingDots";
import { pickProfileThoughtPrompt } from "../../lib/profileThoughtPrompts";
import { preventLastWordOrphan } from "../../lib/utils";

// Cream/ink palette mirrored from V2ComposePage so the modal reads as the
// same writing surface — see [V2ComposePage.tsx:27](src/components/v2/V2ComposePage.tsx:27).
// Re-declared locally rather than imported because V2ComposePage exports
// nothing and the constants are small. Future polish: lift to a shared
// `composeStyles.ts` if a third surface needs the same palette.
const CREAM_BG = "#fef8ea";
const PAPER_BG = "#fdfbf3";
const INK = "#2b2418";
const INK_SOFT = "#5a4d3a";
const INK_FAINT = "#8a7860";
const RULE = "rgba(43, 36, 24, 0.32)";
const RULE_FAINT = "rgba(43, 36, 24, 0.14)";
const LH = 28;
const RULE_GRADIENT = `repeating-linear-gradient(
  to bottom,
  transparent 0px,
  transparent ${LH - 2}px,
  ${RULE_FAINT} ${LH - 2}px,
  ${RULE_FAINT} ${LH - 1}px,
  transparent ${LH - 1}px,
  transparent ${LH}px
)`;
const BODY_MIN_LINES = 11;
// Inline mode (V2 self profile empty state) starts shorter — the form
// sits in page flow with a tighter visual footprint at idle. Auto-grow
// behavior + max-grow are unchanged; only the starting min-height
// differs.
const BODY_MIN_LINES_INLINE = 5;

// Title soft cap (visual counter turns red); hard cap blocks further input.
const TITLE_SOFT_CAP = 100;
const TITLE_HARD_CAP = 150;

// Title row line-height. Independent of body LH because the title is bigger
// (26px font vs 16px) — its own ruled-paper gradient period.
const TITLE_LH = 34;
const TITLE_RULE_GRADIENT = `repeating-linear-gradient(
  to bottom,
  transparent 0px,
  transparent ${TITLE_LH - 2}px,
  ${RULE_FAINT} ${TITLE_LH - 2}px,
  ${RULE_FAINT} ${TITLE_LH - 1}px,
  transparent ${TITLE_LH - 1}px,
  transparent ${TITLE_LH}px
)`;

export type ProfileThoughtsComposeMode = "create" | "edit-private" | "edit-public";

export type ProfileThoughtsSubmitPayload = {
  titleCompletion: string;
  body: string;
  isPublic: boolean;
};

type Props = {
  mode: ProfileThoughtsComposeMode;
  /** When editing, pre-loads the modal. Null for fresh `create`. */
  initialContent: { titleCompletion: string; body: string } | null;
  /** Caller decides what to do with the payload (insert vs update + the
   *  bumpPublishedAt decision based on prior state). The modal resolves
   *  + closes on success; rejects → modal stays open with error displayed. */
  onSubmit: (payload: ProfileThoughtsSubmitPayload) => Promise<void>;
  onClose: () => void;
  /** Inline mode: render the white-paper title+body in page flow instead
   *  of a fixed-position modal overlay. Used by V2 self profile's empty
   *  state — no thoughts yet → inline form instead of a "write a thought"
   *  CTA that opens the modal. In inline mode the footer is two destination
   *  buttons (post privately / post to your profile) instead of the modal's
   *  destination pills + cancel + single submit; no discard-confirm; no
   *  body-scroll lock; no overlay backdrop. mode is always "create". */
  inline?: boolean;
  /** Inline-mode surface tint for the footer buttons. The default ("dark")
   *  renders the "post privately" button white-on-transparent for the
   *  canon-yellow profile bg. "cream" renders it ink-on-transparent so it
   *  stays legible when the inline form is embedded on a cream surface —
   *  used by the first-login OnboardingModal's Thoughts page. */
  creamSurface?: boolean;
  /** Inline-mode: render the writing surface only, NO footer buttons. The
   *  caller drives submission via the imperative `submitPublic()` handle
   *  (used by the OnboardingModal, which supplies its own Confirm / Not-now). */
  hideActions?: boolean;
};

export type ProfileThoughtsComposeHandle = { submitPublic: () => Promise<void> };

const ProfileThoughtsCompose = forwardRef<ProfileThoughtsComposeHandle, Props>(function ProfileThoughtsCompose({ mode, initialContent, onSubmit, onClose, inline = false, creamSurface = false, hideActions = false }, ref) {
  // Title: in create mode, pre-populate with a random prompt suggestion. In
  // edit modes, mirror the existing piece's completion. The user can edit
  // freely, or cycle to a different prompt via the ↻ affordance — cycling
  // replaces the field unconditionally (per spec).
  const [titleCompletion, setTitleCompletion] = useState<string>(() => {
    if (initialContent) return initialContent.titleCompletion;
    // Auto-suggested prompts get NBSP between last words so they don't
    // orphan when the title row wraps. User-typed input is unmodified.
    return preventLastWordOrphan(pickProfileThoughtPrompt(null));
  });
  const [body, setBody] = useState(initialContent?.body ?? "");

  // Destination chooser. mode=edit-public is locked to "featured" (the spec
  // forbids public→private transitions; UI gates entirely via this lock).
  // mode=create defaults to featured; mode=edit-private defaults to private.
  const [destination, setDestination] = useState<"private" | "featured">(() => {
    if (mode === "edit-public") return "featured";
    if (mode === "edit-private") return "private";
    return "featured";
  });
  const destinationLocked = mode === "edit-public";

  // Captured-once initial values for dirty detection. The auto-suggested
  // prompt counts as "not user content" — only changes to either field
  // count as dirty. Cycling, then cycling back to the same string, won't
  // trigger discard-confirm.
  const initialTitleRef = useRef<string>(titleCompletion);
  const initialBodyRef = useRef<string>(body);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  // Ref on the modal card (the scrolling parent). Used by autosize to push
  // scroll to the very bottom so the action row (× not now + publish/save)
  // stays visible as the body grows past the modal's initial frame.
  const modalCardRef = useRef<HTMLDivElement | null>(null);

  // Title is rendered as a contenteditable <span> inside a flowing container
  // alongside the locked "Thoughts on" prefix + the inline "another prompt"
  // button. Sync external changes (initial mount, cycle prompt) to the DOM
  // via the ref; user typing updates state via onInput. The check
  // `textContent !== titleCompletion` keeps the cursor stable while typing
  // (state already matches DOM, so the effect is a no-op).
  const titleEditableRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = titleEditableRef.current;
    if (!el) return;
    if (el.textContent !== titleCompletion) {
      el.textContent = titleCompletion;
    }
  }, [titleCompletion]);

  // Idle (min) line count differs between modal and inline modes — see
  // BODY_MIN_LINES_INLINE comment. Auto-grow / snap behavior is identical.
  const minLines = inline ? BODY_MIN_LINES_INLINE : BODY_MIN_LINES;

  // Auto-grow textarea — snaps to 28px multiples. Same shape as
  // [V2ComposePage.tsx:172](src/components/v2/V2ComposePage.tsx:172).
  function autosize() {
    const ta = bodyRef.current;
    if (!ta) return;
    // Reset then re-measure so we can both grow AND shrink with content.
    // Drop the previous "max(target, current)" pattern — that path only
    // grew, which left the textarea oversized after the user deleted lines.
    ta.style.height = "auto";
    const target = Math.max(minLines * LH, Math.ceil(ta.scrollHeight / LH) * LH);
    ta.style.height = `${target}px`;
    ta.style.minHeight = `${target}px`;
    // Once the body grows past the modal's visible area, scroll the modal
    // card all the way to its bottom so the action row stays visible. (We
    // previously called scrollIntoView on the body which only revealed the
    // textarea's bottom edge — the action row was just below it and stayed
    // clipped.) Scrolling the modal-card ref directly avoids the page
    // viewport ever scrolling.
    // Inline mode: the page handles scroll naturally — no modal card to
    // pin, so skip this step.
    if (!inline) {
      const card = modalCardRef.current;
      if (card) card.scrollTop = card.scrollHeight;
    }
  }
  useEffect(() => { autosize(); }, [body]);

  // Lock body scroll while the modal is open — prevents the profile
  // underneath from scrolling when the modal's content is shorter than
  // the viewport and the user wheels over the backdrop. Inline mode
  // lives in page flow, so don't lock.
  useEffect(() => {
    if (inline) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [inline]);

  function isDirty(): boolean {
    return titleCompletion.trim() !== initialTitleRef.current.trim()
      || body.trim() !== initialBodyRef.current.trim();
  }

  function attemptClose() {
    if (isDirty()) setDiscardOpen(true);
    else onClose();
  }

  function cyclePrompt() {
    setTitleCompletion(preventLastWordOrphan(pickProfileThoughtPrompt(titleCompletion)));
  }

  // Optional destination override — used by inline mode where each of
  // the two footer buttons implicitly picks a destination and submits in
  // one click (no destination-pill step). Modal mode passes nothing and
  // uses the `destination` state set by the pill UI.
  async function handleSubmit(overrideDestination?: "private" | "featured") {
    const t = titleCompletion.trim();
    const b = body.trim();
    if (!t) {
      setSubmitError("add a completion to the title.");
      return;
    }
    if (!b) {
      setSubmitError("add a body to your thought.");
      return;
    }
    const dest = overrideDestination ?? destination;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        titleCompletion: t,
        body: b,
        isPublic: dest === "featured",
      });
      // Parent's onSubmit resolves → close. On rejection we keep the modal
      // open so the user can adjust + retry. Inline mode: parent removes
      // the inline form from the tree (because thoughts.length > 0 now)
      // so onClose is effectively a no-op there.
      onClose();
    } catch (err: any) {
      setSubmitError(err?.message || "save failed. try again.");
      setSubmitting(false);
    }
  }

  // Imperative submit for callers that supply their own buttons (OnboardingModal
  // Thoughts page → Confirm). Always posts PUBLIC. Resolves on success (parent's
  // onClose runs), no-ops with an inline error if the body is empty.
  // NOTE: no deps array on purpose — the handle must wrap the CURRENT-render
  // handleSubmit so it sees the latest title/body. An empty-deps array froze the
  // first render's closure (body=""), which surfaced as a spurious "add a body"
  // error even when the user had typed one.
  useImperativeHandle(ref, () => ({ submitPublic: () => handleSubmit("featured") }));

  // (actionLabel removed — replaced by the two-button footer that picks
  // destination implicitly; edit-public's "save" label is inlined into
  // the destination-locked branch of the primary button.)

  const titleLen = titleCompletion.length;
  const showCounter = titleLen > 80;
  const counterColor = titleLen >= TITLE_SOFT_CAP ? "var(--danger)" : INK_FAINT;

  // Style block — used by both modal and inline modes. Scoped via class
  // names; safe to render twice if both modes ever mount (only one does
  // in practice).
  const styleBlock = (
    <style>{`
      .v2-thoughts-paper-body {
        background-color: #fff !important;
        background-image: ${RULE_GRADIENT} !important;
        background-position: 0 0 !important;
        background-size: 100% ${LH}px !important;
        background-repeat: repeat !important;
        color: ${INK} !important;
      }
      .v2-thoughts-paper-body::placeholder {
        color: ${INK_FAINT};
        font-style: italic;
        font-weight: 400;
      }
      .v2-thoughts-title-editable {
        outline: none;
        white-space: pre-wrap;
        overflow-wrap: break-word;
      }
      .v2-thoughts-title-editable:empty::before {
        content: "…";
        color: ${INK_FAINT};
        font-style: italic;
        pointer-events: none;
      }
      body.public-context .btn.post.v2-thoughts-publish-button,
      .btn.post.v2-thoughts-publish-button {
        border-color: transparent !important;
        outline: none !important;
        box-shadow: none !important;
      }
      body.public-context .btn.post.v2-thoughts-publish-button:focus,
      body.public-context .btn.post.v2-thoughts-publish-button:focus-visible,
      .btn.post.v2-thoughts-publish-button:focus,
      .btn.post.v2-thoughts-publish-button:focus-visible {
        outline: none !important;
        box-shadow: none !important;
      }
      body.public-context .btn.post.v2-thoughts-publish-button.v2-thoughts-publish-featured,
      .btn.post.v2-thoughts-publish-button.v2-thoughts-publish-featured {
        background: #dea838 !important;
      }
      body.public-context .btn.post.v2-thoughts-publish-button.v2-thoughts-publish-featured:hover,
      .btn.post.v2-thoughts-publish-button.v2-thoughts-publish-featured:hover {
        background: #c9962f !important;
      }
    `}</style>
  );

  // White paper container with title block + counter + body textarea.
  // Used by both modal and inline modes verbatim. Only the bottom row
  // and the outer chrome differ.
  const whitePaper = (
    <div
      style={{
        background: "#fff",
        border: `2px solid ${RULE}`,
        borderRadius: 0,
        padding: "32px 32px 24px",
        marginBottom: 24,
      }}
    >
      <div
        style={{
          fontSize: 26,
          lineHeight: `${TITLE_LH}px`,
          color: INK,
          height: `${TITLE_LH * 2}px`,
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <span style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontWeight: 500, color: INK }}>
          Thoughts on{" "}
        </span>
        <span
          ref={titleEditableRef}
          className="v2-thoughts-title-editable"
          contentEditable={!submitting}
          suppressContentEditableWarning
          onInput={(e) => {
            const t = (e.currentTarget as HTMLSpanElement).textContent || "";
            setTitleCompletion(t.length > TITLE_HARD_CAP ? t.slice(0, TITLE_HARD_CAP) : t);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.metaKey || e.ctrlKey) handleSubmit();
            }
          }}
          style={{
            fontFamily: "Inter, sans-serif",
            fontWeight: 600,
            color: INK,
            display: "inline",
          }}
        />
        <button
          onClick={cyclePrompt}
          disabled={submitting}
          title="cycle through prompt suggestions"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginLeft: 10,
            verticalAlign: "middle",
            background: "#7abd8e",
            color: "#fff",
            border: "none",
            borderRadius: 9999,
            padding: "4px 12px",
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            cursor: submitting ? "not-allowed" : "pointer",
            lineHeight: 1,
          }}
        >
          <RefreshCw size={12} color="currentColor" /> another prompt
        </button>
      </div>

      {showCounter && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <span style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: counterColor }}>
            {titleLen}/{TITLE_SOFT_CAP}
          </span>
        </div>
      )}

      <textarea
        ref={bodyRef}
        className="v2-thoughts-paper-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={10000}
        placeholder="Take a moment. Think about something specific: a show, an actor, a way you watch. Write as little or as much as feels good. Think big-picture, spoiler-free. If you decide to share it, these thoughts become the first bit of writing other people see on your profile."
        style={{
          fontFamily: "Inter, sans-serif",
          fontSize: 16,
          lineHeight: `${LH}px`,
          color: INK,
          border: "none",
          width: "100%",
          minWidth: "100%",
          maxWidth: "100%",
          height: `${minLines * LH}px`,
          minHeight: `${minLines * LH}px`,
          resize: "vertical",
          overflow: "hidden",
          outline: "none",
          fontWeight: 400,
          padding: 0,
          margin: 0,
          display: "block",
          boxSizing: "border-box",
        }}
      />
    </div>
  );

  // Inline-mode early return: page-flow form. Two destination-implicit
  // buttons in the footer; no destination pills, no Cancel, no discard
  // confirm. Used by V2 self profile's empty state ("no thoughts yet").
  if (inline) {
    return (
      <div style={{ width: "100%" }}>
        {styleBlock}
        {whitePaper}
        {!hideActions && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 16,
          }}
        >
          <button
            onClick={() => handleSubmit("private")}
            disabled={submitting}
            style={{
              background: "transparent",
              border: `2px solid ${creamSurface ? INK : "#fff"}`,
              color: creamSurface ? INK : "#fff",
              borderRadius: 9999,
              padding: "10px 22px",
              fontFamily: "Inter, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              cursor: submitting ? "not-allowed" : "pointer",
              minWidth: 140,
            }}
          >
            post privately
          </button>
          <button
            onClick={() => handleSubmit("featured")}
            disabled={submitting}
            style={{
              background: "#355eb8",
              color: "#fff",
              border: "none",
              borderRadius: 9999,
              padding: "10px 22px",
              fontFamily: "Inter, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              minWidth: 160,
            }}
          >
            post to your profile
          </button>
        </div>
        )}
        {submitError && (
          <div style={{ textAlign: hideActions ? "left" : "right", marginTop: 8, color: "var(--danger)", fontSize: 13 }}>
            {submitError}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Backdrop. Click-outside attempts a clean close (with discard-confirm
          gate if the user has typed anything). */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 9990,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 20px",
        }}
        onClick={(e) => { if (e.target === e.currentTarget) attemptClose(); }}
      >
        {/* Modal card. Sharp corners, cream surround framing the white paper.
            maxHeight + overflowY:auto contains the scroll inside the modal
            so the browser viewport doesn't scroll when the body grows long. */}
        <div
          ref={modalCardRef}
          style={{
            background: CREAM_BG,
            color: INK,
            width: "min(720px, 100%)",
            maxHeight: "calc(100vh - 80px)",
            overflowY: "auto",
            borderRadius: 0,
            padding: "32px 36px 28px",
            position: "relative",
            boxShadow: "0 16px 60px rgba(0,0,0,0.25)",
          }}
        >
          {styleBlock}
          {whitePaper}

          {/* Bottom row — single right-aligned cluster:
              [× not now] [post privately] [post to your profile]
              (create + edit-private), or [× not now] [save] when the
              destination is locked (edit-public — published thoughts
              can't downgrade to private). Destination pills are gone:
              each action button picks its destination implicitly, same
              shape as the inline empty-state form. */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={attemptClose}
              disabled={submitting}
              style={{
                background: "transparent",
                border: `2px solid ${RULE}`,
                color: INK_SOFT,
                borderRadius: 9999,
                padding: "10px 20px",
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              × not now
            </button>
            {!destinationLocked && (
              <button
                onClick={() => handleSubmit("private")}
                disabled={submitting}
                style={{
                  background: "transparent",
                  border: `2px solid ${INK}`,
                  color: INK,
                  borderRadius: 9999,
                  padding: "10px 22px",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: submitting ? "not-allowed" : "pointer",
                  minWidth: 140,
                }}
              >
                post privately
              </button>
            )}
            <button
              onClick={() => handleSubmit("featured")}
              disabled={submitting}
              style={{
                background: "#355eb8",
                color: "#fff",
                border: "none",
                borderRadius: 9999,
                padding: "10px 22px",
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
                minWidth: 160,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {submitting
                ? <>saving<LoadingDots /></>
                : destinationLocked
                  ? <>save</>
                  : <>post to your profile</>}
            </button>
          </div>

          {submitError && (
            <div style={{ textAlign: "right", marginTop: 8, color: "var(--danger)", fontSize: 13 }}>
              {submitError}
            </div>
          )}
        </div>
      </div>

      {/* Discard confirm. Mirrors V2ComposePage's discard modal verbatim so
          users see the exact same dialog across both writing surfaces. */}
      {discardOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(43,36,24,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9995,
            padding: 20,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setDiscardOpen(false); }}
        >
          <div
            style={{
              background: PAPER_BG,
              border: `2px solid ${INK}`,
              borderRadius: 18,
              padding: "28px 32px",
              maxWidth: 420,
              width: "100%",
              color: INK,
            }}
          >
            <div style={{ fontFamily: "Lora, Georgia, serif", fontWeight: 600, fontSize: 20, marginBottom: 10 }}>
              Are you sure?
            </div>
            <div style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontSize: 15, color: INK_SOFT, marginBottom: 24 }}>
              You will lose what you've written.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => setDiscardOpen(false)}
                style={{
                  background: "transparent",
                  border: `2px solid ${RULE}`,
                  color: INK_SOFT,
                  borderRadius: 9999,
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                keep writing
              </button>
              <button
                onClick={() => { setDiscardOpen(false); onClose(); }}
                style={{
                  background: "var(--danger)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 9999,
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <X size={13} /> discard
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default ProfileThoughtsCompose;

// DestinationPill helper removed — the new two-button footer replaces
// the radio-style pill UI. Each button picks its destination implicitly.
