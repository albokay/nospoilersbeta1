import React, { useEffect, useRef, useState } from "react";
import { X, RefreshCw, ArrowRight } from "lucide-react";
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
};

export default function ProfileThoughtsCompose({ mode, initialContent, onSubmit, onClose }: Props) {
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

  // Auto-grow textarea — snaps to 28px multiples. Same shape as
  // [V2ComposePage.tsx:172](src/components/v2/V2ComposePage.tsx:172).
  function autosize() {
    const ta = bodyRef.current;
    if (!ta) return;
    // Reset then re-measure so we can both grow AND shrink with content.
    // Drop the previous "max(target, current)" pattern — that path only
    // grew, which left the textarea oversized after the user deleted lines.
    ta.style.height = "auto";
    const target = Math.max(BODY_MIN_LINES * LH, Math.ceil(ta.scrollHeight / LH) * LH);
    ta.style.height = `${target}px`;
    ta.style.minHeight = `${target}px`;
    // Once the body grows past the modal's visible area, scroll the modal
    // card all the way to its bottom so the action row stays visible. (We
    // previously called scrollIntoView on the body which only revealed the
    // textarea's bottom edge — the action row was just below it and stayed
    // clipped.) Scrolling the modal-card ref directly avoids the page
    // viewport ever scrolling.
    const card = modalCardRef.current;
    if (card) card.scrollTop = card.scrollHeight;
  }
  useEffect(() => { autosize(); }, [body]);

  // Lock body scroll while the modal is open — prevents the profile
  // underneath from scrolling when the modal's content is shorter than
  // the viewport and the user wheels over the backdrop.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

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

  async function handleSubmit() {
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
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        titleCompletion: t,
        body: b,
        isPublic: destination === "featured",
      });
      // Parent's onSubmit resolves → close. On rejection we keep the modal
      // open so the user can adjust + retry.
      onClose();
    } catch (err: any) {
      setSubmitError(err?.message || "save failed. try again.");
      setSubmitting(false);
    }
  }

  // Action button copy. Mirrors the spec's three-state rule:
  //  - edit-public → "save" (no state transition possible)
  //  - destination = featured → "publish to profile"
  //  - destination = private  → "save privately"
  const actionLabel = destinationLocked
    ? "save"
    : destination === "featured"
      ? "publish to profile"
      : "save privately";

  const titleLen = titleCompletion.length;
  const showCounter = titleLen > 80;
  const counterColor = titleLen >= TITLE_SOFT_CAP ? "var(--danger)" : INK_FAINT;

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
          {/* Scoped CSS overrides to claw back from theme.ts:296's global
              "textarea { background: #fff !important }" rule which would
              otherwise wipe the ruled-paper gradient. Mirrors the pattern
              from V2ComposePage at [V2ComposePage.tsx:352](src/components/v2/V2ComposePage.tsx:352). */}
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
            /* Title content-editable region. Empty-state placeholder via ::before. */
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
            /* Publish button. theme.ts:101 forces .btn.post canon-green
               !important under body.public-context, so any inline style
               loses. We add an always-on class to take control of border
               (always transparent → no outline in either state) and the
               featured-only class to flip the fill to canon yellow.
               outline:none also kills browser focus rings which can read
               as a faint outline on click. */
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

          {/* White paper container. Title + body share the same writing
              surface; the title sits on white at the top, ruled lines start
              with the body textarea below. Sharp corners per spec. */}
          <div
            style={{
              background: "#fff",
              border: `2px solid ${RULE}`,
              borderRadius: 0,
              padding: "32px 32px 24px",
              marginBottom: 24,
            }}
          >
            {/* Title block. The locked "Thoughts on" prefix, the editable
                completion, and the inline "another prompt" button all flow
                as one inline-block stream so wrap aligns the second line
                with the prefix's left edge. Fixed 2-line height so a
                1-line title doesn't shrink the modal. */}
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
                  // Truncate at hard cap. Done in state only; DOM keeps user's
                  // current input — slicing the DOM would move the cursor.
                  setTitleCompletion(t.length > TITLE_HARD_CAP ? t.slice(0, TITLE_HARD_CAP) : t);
                }}
                onKeyDown={(e) => {
                  // Block raw Enter — title is single-flow text, no newlines.
                  // Submit on Cmd/Ctrl+Enter for parity with the body modal.
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
              {/* Inline cycle-prompt pill. Sits at the end of the title
                  content stream — moves with title length (#5). Canon-green
                  fill, white text+icon, standard pill radius (#6). */}
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

            {/* Soft-cap counter row */}
            {showCounter && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                <span style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: counterColor }}>
                  {titleLen}/{TITLE_SOFT_CAP}
                </span>
              </div>
            )}

            {/* Body — ruled-paper textarea inside the same white paper. */}
            <textarea
              ref={bodyRef}
              className="v2-thoughts-paper-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={10000}
              placeholder="Take a moment. Think about something specific: a show, an episode, a way you watch. Write as little or as much as feels good. If you decide to share it, these thoughts become the first bit of writing other people see on your profile."
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 16,
                lineHeight: `${LH}px`,
                color: INK,
                border: "none",
                width: "100%",
                minWidth: "100%",
                maxWidth: "100%",
                height: `${BODY_MIN_LINES * LH}px`,
                minHeight: `${BODY_MIN_LINES * LH}px`,
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

          {/* Bottom row — destination pills stacked bottom-LEFT, action
              buttons (× not now + save) bottom-RIGHT. align-items: flex-end
              so the bottom pill aligns vertically with the action buttons. */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            {/* Left: stacked destination pills. Renders only when not locked
                (i.e. not in edit-public mode). Placeholder div keeps the
                flex layout balanced in the locked case. */}
            {!destinationLocked ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <DestinationPill
                  selected={destination === "private"}
                  bg="#7abd8e"
                  fg="#fff"
                  label="private — only you'll see this"
                  onClick={() => setDestination("private")}
                />
                <DestinationPill
                  selected={destination === "featured"}
                  bg="#dea838"
                  fg="#fff"
                  label="featured on your profile"
                  onClick={() => setDestination("featured")}
                />
              </div>
            ) : (
              <div />
            )}

            {/* Right: action buttons */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
              <button
                onClick={handleSubmit}
                disabled={submitting}
                // v2-thoughts-publish-button is always on — gives us a
                // specificity hook to force transparent border (no outline)
                // regardless of context. v2-thoughts-publish-featured adds
                // when destination=featured to flip fill to canon yellow.
                className={`btn post h40 v2-thoughts-publish-button${destination === "featured" ? " v2-thoughts-publish-featured" : ""}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 0,
                  cursor: submitting ? "not-allowed" : "pointer",
                  minWidth: 160,
                }}
              >
                {submitting ? <>saving<LoadingDots /></> : <>{actionLabel}<ArrowRight size={14} /></>}
              </button>
            </div>
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
}

// Single-select destination pill — same shape as V2ComposePage's
// DestinationPill so the visual language carries over.
function DestinationPill({
  selected,
  bg,
  fg,
  label,
  onClick,
}: {
  selected: boolean;
  bg: string;
  fg: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{
        background: bg,
        color: fg,
        border: "none",
        borderRadius: 9999,
        height: 40,
        padding: "0 22px",
        width: "100%",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "inherit",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: CREAM_BG,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {selected && (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: bg }} />
        )}
      </span>
      <span style={{ fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 500, color: fg, lineHeight: 1.2, whiteSpace: "nowrap" }}>
        {label}
      </span>
    </button>
  );
}
