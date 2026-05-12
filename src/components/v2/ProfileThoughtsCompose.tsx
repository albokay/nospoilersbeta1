import React, { useEffect, useRef, useState } from "react";
import { X, RefreshCw, ArrowRight } from "lucide-react";
import LoadingDots from "../LoadingDots";
import { pickProfileThoughtPrompt } from "../../lib/profileThoughtPrompts";

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
    return pickProfileThoughtPrompt(null);
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
    setTitleCompletion(pickProfileThoughtPrompt(titleCompletion));
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
        {/* Modal card. Cream paper surface; ink type. Mirrors the V2 compose
            page palette so the modal feels like the same writing surface
            without being a full-route navigation. */}
        <div
          style={{
            background: CREAM_BG,
            color: INK,
            width: "min(720px, 100%)",
            borderRadius: 12,
            padding: "40px 48px 40px",
            position: "relative",
            boxShadow: "0 16px 60px rgba(0,0,0,0.25)",
          }}
        >
          {/* × not now — top-right (mirrors the compose page's persistent
              top-right discard). */}
          <button
            onClick={attemptClose}
            disabled={submitting}
            style={{
              position: "absolute",
              top: 16,
              right: 20,
              background: "transparent",
              border: `2px solid ${RULE}`,
              color: INK_SOFT,
              borderRadius: 9999,
              padding: "8px 18px",
              fontSize: 13,
              fontWeight: 500,
              cursor: submitting ? "not-allowed" : "pointer",
              fontFamily: "Inter, sans-serif",
              height: 34,
            }}
          >
            × not now
          </button>

          {/* Eyebrow — italic Lora, matches "capture your thoughts on:" on
              the regular compose page. */}
          <div
            style={{
              fontFamily: "Lora, Georgia, serif",
              fontStyle: "italic",
              fontSize: 15,
              color: INK_FAINT,
              marginBottom: 14,
            }}
          >
            take a moment…
          </div>

          {/* Title row — "Thoughts on" + editable completion + auto period.
              Opener is locked (rendered as plain text, not an input). The
              input flexes to fill remaining space. Underline is the visual
              equivalent of the write-on-a-line affordance. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontFamily: "Inter, sans-serif", fontSize: 26, fontWeight: 600, color: INK, lineHeight: 1.2 }}>
              Thoughts on
            </span>
            <input
              type="text"
              value={titleCompletion}
              onChange={(e) => setTitleCompletion(e.target.value.slice(0, TITLE_HARD_CAP))}
              maxLength={TITLE_HARD_CAP}
              placeholder="…"
              style={{
                flex: 1,
                minWidth: 200,
                fontFamily: "Inter, sans-serif",
                fontSize: 26,
                fontWeight: 600,
                color: INK,
                background: "transparent",
                border: "none",
                outline: "none",
                borderBottom: `2px solid ${RULE}`,
                padding: "2px 0",
                lineHeight: 1.2,
              }}
            />
            <span style={{ fontFamily: "Inter, sans-serif", fontSize: 26, fontWeight: 600, color: INK, lineHeight: 1.2 }}>.</span>
          </div>

          {/* Cycle prompt + soft-cap counter row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, marginBottom: 24 }}>
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

          {/* Body — ruled-paper textarea matching V2ComposePage. No title
              field above this since the title is the "Thoughts on..." line. */}
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={10000}
            placeholder="what stays with you?"
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 16,
              lineHeight: `${LH}px`,
              color: INK,
              border: `1px solid ${RULE_FAINT}`,
              backgroundColor: "#fff",
              backgroundImage: RULE_GRADIENT,
              backgroundPosition: "0 8px",
              backgroundSize: `100% ${LH}px`,
              backgroundRepeat: "repeat",
              width: "100%",
              minWidth: "100%",
              maxWidth: "100%",
              height: `${BODY_MIN_LINES * LH + 16}px`,
              minHeight: `${BODY_MIN_LINES * LH + 16}px`,
              resize: "vertical",
              overflow: "hidden",
              outline: "none",
              fontWeight: 400,
              padding: "8px 16px",
              margin: 0,
              display: "block",
              borderRadius: 4,
              boxSizing: "border-box",
            }}
          />

          {/* Destination chooser — pill pair, single-select. Hidden entirely
              when destinationLocked (edit-public mode). Defaults set in the
              destination useState initializer above. */}
          {!destinationLocked && (
            <div style={{ marginTop: 28 }}>
              <div style={{ display: "grid", gridTemplateColumns: "max-content", justifyContent: "center", gap: 8 }}>
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
            </div>
          )}

          {/* Action row */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              marginTop: 32,
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
