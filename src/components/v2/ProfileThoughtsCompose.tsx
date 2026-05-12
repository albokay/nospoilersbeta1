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
const BODY_MIN_LINES = 6;

// Title soft cap (visual counter turns red); hard cap blocks further input.
const TITLE_SOFT_CAP = 100;
const TITLE_HARD_CAP = 150;

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
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  // Title autosize — grow up to 2 lines, then cap. Keeps the title field
  // visually flowing into a second line when long without unbounded growth.
  function autosizeTitle() {
    const ta = titleRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const TWO_LINE_MAX = Math.ceil(26 * 1.3 * 2); // matches inline maxHeight
    const next = Math.min(ta.scrollHeight, TWO_LINE_MAX);
    ta.style.height = `${next}px`;
  }
  useEffect(() => { autosizeTitle(); }, [titleCompletion]);

  // Auto-grow textarea — snaps to 28px multiples. Same shape as
  // [V2ComposePage.tsx:172](src/components/v2/V2ComposePage.tsx:172).
  function autosize() {
    const ta = bodyRef.current;
    if (!ta) return;
    const prev = ta.style.height;
    ta.style.height = "auto";
    const sh = ta.scrollHeight;
    ta.style.height = prev;
    const target = Math.max(BODY_MIN_LINES * LH, Math.ceil(sh / LH) * LH);
    const current = parseInt(ta.style.height, 10) || BODY_MIN_LINES * LH;
    ta.style.height = `${Math.max(target, current)}px`;
    ta.style.minHeight = `${target}px`;
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
          alignItems: "flex-start",
          justifyContent: "center",
          overflowY: "auto",
          padding: "60px 20px",
        }}
        onClick={(e) => { if (e.target === e.currentTarget) attemptClose(); }}
      >
        {/* Modal card. Cream surround framing the white paper. */}
        <div
          style={{
            background: CREAM_BG,
            color: INK,
            width: "min(720px, 100%)",
            borderRadius: 12,
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
            .v2-thoughts-title-input {
              background-color: transparent !important;
              background-image: none !important;
              color: ${INK} !important;
            }
            .v2-thoughts-title-input::placeholder {
              color: ${INK_FAINT};
              font-style: italic;
              font-weight: 500;
            }
          `}</style>

          {/* White paper container. Title + body share the same writing
              surface; the title sits on white at the top, ruled lines start
              with the body textarea below. Mirrors V2ComposePage's structure. */}
          <div
            style={{
              background: "#fff",
              border: `2px solid ${RULE}`,
              borderRadius: 4,
              padding: "32px 32px 24px",
              marginBottom: 24,
            }}
          >
            {/* Title row — "Thoughts on" italic Lora + textarea (no trailing
                period). flexWrap allows the textarea to drop to a second line
                when content overflows. Title textarea is rows=1 and grows up
                to a 2-line cap via the autosize effect below. */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              <span style={{ fontFamily: "Lora, Georgia, serif", fontStyle: "italic", fontWeight: 500, fontSize: 26, color: INK, lineHeight: 1.3, flexShrink: 0 }}>
                Thoughts on
              </span>
              <textarea
                ref={titleRef}
                className="v2-thoughts-title-input"
                value={titleCompletion}
                onChange={(e) => setTitleCompletion(e.target.value.slice(0, TITLE_HARD_CAP))}
                maxLength={TITLE_HARD_CAP}
                placeholder="…"
                rows={1}
                style={{
                  flex: "1 1 240px",
                  minWidth: 120,
                  fontFamily: "Inter, sans-serif",
                  fontSize: 26,
                  fontWeight: 600,
                  color: INK,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  padding: 0,
                  margin: 0,
                  lineHeight: 1.3,
                  resize: "none",
                  overflow: "hidden",
                  overflowWrap: "break-word",
                  maxHeight: `${Math.ceil(26 * 1.3 * 2)}px`, // 2-line cap
                }}
              />
            </div>

            {/* Cycle prompt + soft-cap counter row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <button
                onClick={cyclePrompt}
                disabled={submitting}
                style={{
                  background: "transparent",
                  border: "none",
                  color: INK_SOFT,
                  fontFamily: "Lora, Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 13,
                  cursor: submitting ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: 0,
                }}
                title="cycle through prompt suggestions"
              >
                <RefreshCw size={12} color="currentColor" /> another prompt
              </button>
              {showCounter && (
                <span style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: counterColor }}>
                  {titleLen}/{TITLE_SOFT_CAP}
                </span>
              )}
            </div>

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
                className="btn post h40"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
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
      <span style={{ fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 600, color: fg, lineHeight: 1.2, whiteSpace: "nowrap" }}>
        {label}
      </span>
    </button>
  );
}
