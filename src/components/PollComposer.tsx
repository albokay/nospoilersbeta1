import React, { useState } from "react";
import { X, ArrowRight, Plus } from "lucide-react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import CanonRadio from "./CanonRadio";
import useSheetSwipeDown from "../lib/useSheetSwipeDown";
import { openPoll, sendPollEmail, type PollDuration } from "../lib/db";
import { CANON } from "../styles/canon";
import { M, OVERLAY } from "../mobile/m";
import { D } from "./dashboardChrome";

// Canon palette. Pass 3 (2026-09-16): the off-palette grey #5f5e5a retired —
// quiet text is dark ink at 0.7 / 0.45 (the last non-canon colors on the
// site lived in these two composers).
const CREAM        = CANON.cream;
const CANON_BLUE   = CANON.identity;
const CANON_GREEN  = CANON.personal;
const CANON_YELLOW = CANON.accent;
const CANON_RED    = CANON.alert;
const CANON_NAVY   = CANON.dark;
const CANON_LIGHT  = CANON.friend;
const INK_70       = "rgba(26,58,74,0.7)";
const INTER        = '"Inter", sans-serif';
const LORA         = '"Lora", Georgia, serif';

const QUESTION_MAX = 100;
const OPTION_MAX   = 30;
const MIN_OPTIONS  = 2;
const MAX_OPTIONS  = 5;

interface Props {
  groupId: string;
  onClose: () => void;
  /** Fired after a successful open + poll_invite send so callers can refresh state. */
  onOpened?: (pollId: string) => void;
  /** Pass 3: /m idiom — the cream bottom sheet (grabber, swipe-down,
   *  tap-out, no ×). Default false = the desktop Form card. No live /m
   *  surface passes it yet (polls open from the desktop map). */
  mobile?: boolean;
  /** Pass 3: the asker's progress, folded into the caption ("They'll see
   *  you're at S1 E4."). Optional — the sentence is omitted without it. */
  progressSeason?: number;
  progressEpisode?: number;
}

const DURATIONS: { value: PollDuration; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "3d",  label: "3 days"   },
  { value: "1w",  label: "1 week"   },
];

export default function PollComposer({ groupId, onClose, onOpened, mobile = false, progressSeason, progressEpisode }: Props) {
  const [question, setQuestion]       = useState("");
  const [options, setOptions]         = useState<string[]>(["", ""]);
  const [allowWriteIn, setAllowWriteIn] = useState(false);
  const [duration, setDuration]       = useState<PollDuration>("3d");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [existingType, setExistingType] = useState<"poll" | "ask" | null>(null);
  const sheetSwipe = useSheetSwipeDown(onClose, { enabled: !submitting, open: mobile });

  function setOption(i: number, val: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? val : o)));
  }
  function addOption() {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((prev) => [...prev, ""]);
  }
  function removeOption(i: number) {
    if (options.length <= MIN_OPTIONS) return;
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Validation
  const trimmedQuestion = question.trim();
  const trimmedOptions  = options.map((o) => o.trim()).filter((o) => o.length > 0);
  const lowerOpts       = trimmedOptions.map((o) => o.toLowerCase());
  const hasDuplicates   = new Set(lowerOpts).size !== lowerOpts.length;
  const canSubmit =
    !submitting &&
    trimmedQuestion.length > 0 &&
    trimmedOptions.length >= MIN_OPTIONS &&
    !hasDuplicates;

  async function attemptSubmit(replaceExisting: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await openPoll({
        groupId,
        question:        trimmedQuestion,
        allowWriteIn,
        duration,
        options:         trimmedOptions,
        replaceExisting,
      });
      if (!result.ok) {
        if (result.error === "has_active_item") {
          setExistingType(result.existingType ?? "poll");
          setSubmitting(false);
          setShowReplaceConfirm(true);
          return;
        }
        setError(humanError(result.error));
        setSubmitting(false);
        return;
      }
      // Fire-and-forget invites. We don't block the UI on email send;
      // edge function returns sent_count for diagnostic visibility.
      sendPollEmail({ templateType: "poll_invite", pollId: result.pollId }).catch(() => {
        /* ignore — poll exists either way */
      });
      onOpened?.(result.pollId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open poll. Try again?");
      setSubmitting(false);
    }
  }

  function handleSubmit() {
    if (!canSubmit) return;
    attemptSubmit(false);
  }
  function handleConfirmReplace() {
    setShowReplaceConfirm(false);
    attemptSubmit(true);
  }

  // ── Pass 3 shared styles: on-cream fields (sky inset ring), Label 14/700
  //    field heads without colons, sky-outline duration chips + Cancel. ──
  const fieldLabel: React.CSSProperties = {
    display: "block", fontFamily: INTER, fontSize: 14, fontWeight: 700, color: CANON_NAVY, marginBottom: 8,
  };
  const fieldBase: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", border: "none", borderRadius: 9999,
    background: CREAM, boxShadow: `inset 0 0 0 2px ${CANON_LIGHT}`,
    fontFamily: INTER, color: CANON_NAVY, outline: "none",
  };
  const mPill = mobile ? M.pill.M : D.pill.M;

  const content = (
    <>
      <style>{`
        .poll-composer-input::placeholder { color: rgba(26,58,74,0.45); opacity: 1; }
      `}</style>
      {/* No × (pass 3) — Cancel is the exit; tap-out still closes. */}
      <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 22 : 28, lineHeight: 1.25, color: CANON_NAVY, marginBottom: 4 }}>
        Open a poll
      </div>
      <div style={{ fontFamily: INTER, fontSize: 13, lineHeight: 1.45, color: INK_70, marginBottom: 20 }}>
        Take the temperature of the room.
        {progressSeason != null && progressEpisode != null && (
          <> They&rsquo;ll see you&rsquo;re at <b>S{progressSeason} E{progressEpisode}</b>.</>
        )}
      </div>

      {showReplaceConfirm && (
        <div
          style={{
            background: "rgba(222,168,56,0.15)",
            border: `2px solid ${CANON_YELLOW}`,
            borderRadius: 12,
            padding: "12px 14px",
            marginBottom: 16,
            fontFamily: INTER,
            fontSize: 13,
            color: CANON_NAVY,
            lineHeight: 1.45,
          }}
        >
          You have an active {existingType === "ask" ? "ask" : "poll"} in this room. Opening a new poll will replace it.
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={handleConfirmReplace}
              disabled={submitting}
              style={{ ...mPill, background: CANON_YELLOW, color: CREAM, cursor: submitting ? "default" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              {submitting ? <>Opening<LoadingDots /></> : "Replace it"}
            </button>
            <button
              onClick={() => setShowReplaceConfirm(false)}
              disabled={submitting}
              style={{ ...mPill, background: "transparent", border: `2px solid ${CANON_LIGHT}`, color: CANON_LIGHT, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Question */}
      <div style={{ marginBottom: 20 }}>
        <label style={fieldLabel}>Question</label>
        <input
          className="poll-composer-input"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={QUESTION_MAX}
          placeholder="Favorite episode so far?"
          style={{ ...fieldBase, minHeight: 48, padding: "12px 20px", fontSize: 16 }}
        />
      </div>

      {/* Options */}
      <div style={{ marginBottom: 20 }}>
        <label style={fieldLabel}>Answer options &middot; 2 to 5</label>
        {options.map((o, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: INTER, fontSize: 13, color: INK_70, width: 16, textAlign: "center", flexShrink: 0 }}>{i + 1}</span>
            <input
              className="poll-composer-input"
              type="text"
              value={o}
              onChange={(e) => setOption(i, e.target.value)}
              maxLength={OPTION_MAX}
              placeholder={`Option ${i + 1}`}
              style={{ ...fieldBase, flex: 1, width: "auto", minHeight: 44, padding: "10px 16px", fontSize: 15 }}
            />
            {options.length > MIN_OPTIONS && (
              <button
                onClick={() => removeOption(i)}
                aria-label="Remove option"
                style={{ background: "transparent", border: "none", padding: 4, color: INK_70, cursor: "pointer", display: "flex", alignItems: "center", flexShrink: 0 }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <button
            onClick={addOption}
            style={{ ...(mobile ? M.pill.S : D.pill.S), background: "transparent", border: "none", color: CANON_BLUE, display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 12 }}
          >
            <Plus size={14} /> Add option
          </button>
        )}
        {hasDuplicates && (
          <div style={{ fontFamily: INTER, fontSize: 13, color: CANON_RED, marginTop: 6 }}>
            Each option must be unique.
          </div>
        )}
      </div>

      {/* Allow write-in — plain Body beside the radio (the cream pill
          wrapper is gone, pass 3); radio stays CanonRadio at 20. */}
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, cursor: "pointer" }}>
        <span style={{ width: 16, display: "flex", justifyContent: "center", flexShrink: 0 }}>
          <CanonRadio
            checked={allowWriteIn}
            bgColor={CANON_LIGHT}
            color={CREAM}
            size={20}
            dotSize={10}
          />
        </span>
        <input
          type="checkbox"
          checked={allowWriteIn}
          onChange={(e) => setAllowWriteIn(e.target.checked)}
          style={{ display: "none" }}
        />
        <span style={{ fontFamily: INTER, fontSize: 15, lineHeight: 1.5, color: CANON_NAVY }}>
          Allow friends to write their own answers?
        </span>
      </label>

      {/* Duration — 40px chips, sky outline off / green fill on. Labels
          stay the live site's ("24 hours", not the boards' "1 day"). */}
      <div>
        <label style={fieldLabel}>Open for</label>
        <div style={{ display: "flex", gap: 8 }}>
          {DURATIONS.map((d) => {
            const selected = d.value === duration;
            return (
              <button
                key={d.value}
                onClick={() => setDuration(d.value)}
                style={{
                  flex: 1,
                  minHeight: 40,
                  borderRadius: 9999,
                  border: `2px solid ${selected ? CANON_GREEN : CANON_LIGHT}`,
                  background: selected ? CANON_GREEN : "transparent",
                  fontFamily: INTER,
                  fontSize: 13,
                  fontWeight: 700,
                  color: selected ? CREAM : CANON_LIGHT,
                  cursor: "pointer",
                }}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div style={{ fontFamily: INTER, fontSize: 13, color: CANON_RED, marginTop: 12 }}>{error}</div>
      )}

      {/* Buttons — primary first, labels always visible (0.6 until valid);
          Cancel = sky outline (nothing is lost on cancel, so no alert).
          The divider above is gone; 28px gap instead. */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 28 }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            ...mPill,
            background: CANON_GREEN,
            color: CREAM,
            opacity: canSubmit ? 1 : 0.6,
            cursor: canSubmit ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {submitting ? <>Opening<LoadingDots /></> : <>Open poll <ArrowRight size={14} /></>}
        </button>
        <button
          onClick={onClose}
          style={{ ...mPill, background: "transparent", border: `2px solid ${CANON_LIGHT}`, color: CANON_LIGHT, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </>
  );

  // ── Shells: /m = the cream bottom sheet (grabber + swipe-down + tap-out,
  //    no ×); desktop = the 560 cream Form card on the standard dim. ──
  if (mobile) {
    return (
      <div style={{ ...OVERLAY.dim, zIndex: 1200 }} onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
        <div
          {...sheetSwipe.handlers}
          style={{ ...OVERLAY.sheet, background: CREAM, padding: "12px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)", maxHeight: "85dvh", overflowY: "auto", WebkitOverflowScrolling: "touch", ...sheetSwipe.style }}
        >
          <div style={OVERLAY.grabber(CANON_NAVY)} />
          {content}
        </div>
      </div>
    );
  }
  return (
    <Modal onClose={onClose} width="min(560px, 92vw)" cardStyle={{ background: CREAM, borderRadius: 24, padding: 32, border: "none", animation: "dCardRise 180ms ease-out" }}>
      {content}
    </Modal>
  );
}

function humanError(code: string): string {
  switch (code) {
    case "not_member":         return "You aren't a member of this room.";
    case "question_empty":     return "Question can't be empty.";
    case "invalid_duration":   return "Pick a valid duration.";
    case "too_few_options":    return "At least 2 options needed.";
    case "too_many_options":   return "5 options max.";
    case "unauthenticated":    return "Sign in and try again.";
    default:                   return "Couldn't open poll. Try again?";
  }
}
