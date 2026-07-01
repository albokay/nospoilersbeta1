import React, { useState } from "react";
import { X, ArrowRight, Plus } from "lucide-react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import CanonRadio from "./CanonRadio";
import { openPoll, sendPollEmail, type PollDuration } from "../lib/db";
import { CANON } from "../styles/canon";

// Canon palette
const CREAM        = CANON.cream;
const CANON_BLUE   = CANON.blue;
const CANON_GREEN  = CANON.green;
const CANON_YELLOW = CANON.yellow;
const CANON_RED    = CANON.red;
const CANON_NAVY   = CANON.midnight;
const CANON_LIGHT  = CANON.sky;
const TEXT_MUTED   = "#5f5e5a";

const QUESTION_MAX = 100;
const OPTION_MAX   = 30;
const MIN_OPTIONS  = 2;
const MAX_OPTIONS  = 5;

interface Props {
  groupId: string;
  onClose: () => void;
  /** Fired after a successful open + poll_invite send so callers can refresh state. */
  onOpened?: (pollId: string) => void;
}

const DURATIONS: { value: PollDuration; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "3d",  label: "3 days"   },
  { value: "1w",  label: "1 week"   },
];

export default function PollComposer({ groupId, onClose, onOpened }: Props) {
  const [question, setQuestion]       = useState("");
  const [options, setOptions]         = useState<string[]>(["", ""]);
  const [allowWriteIn, setAllowWriteIn] = useState(false);
  const [duration, setDuration]       = useState<PollDuration>("3d");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [existingType, setExistingType] = useState<"poll" | "ask" | null>(null);

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

  return (
    <Modal onClose={onClose} width="min(360px, 92vw)" cardStyle={{ background: CREAM, padding: "20px 22px 18px", border: "none" }}>
      <style>{`
        .poll-composer-input::placeholder { color: #FEF8EA; opacity: 0.95; }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: CANON_NAVY, fontFamily: '"Lora", Georgia, serif' }}>Open a poll</div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ background: "transparent", border: "none", padding: 6, margin: -6, color: TEXT_MUTED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <X size={16} />
        </button>
      </div>
      <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 18 }}>
        Take the temperature of the room…
      </div>

      {showReplaceConfirm && (
        <div
          style={{
            background: "rgba(222,168,56,0.15)",
            border: `2px solid ${CANON_YELLOW}`,
            borderRadius: 12,
            padding: "10px 12px",
            marginBottom: 14,
            fontSize: 12,
            color: CANON_NAVY,
            lineHeight: 1.4,
          }}
        >
          You have an active {existingType === "ask" ? "ask" : "poll"} in this room. Opening a new poll will replace it.
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              onClick={handleConfirmReplace}
              disabled={submitting}
              style={{
                background: CANON_YELLOW,
                color: "#FEF8EA",
                border: `2px solid ${CANON_YELLOW}`,
                padding: "5px 12px",
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 500,
                cursor: submitting ? "default" : "pointer",
              }}
            >
              {submitting ? <>Opening<LoadingDots /></> : "Replace it"}
            </button>
            <button
              onClick={() => setShowReplaceConfirm(false)}
              disabled={submitting}
              style={{
                background: "transparent",
                color: TEXT_MUTED,
                border: `2px solid ${TEXT_MUTED}`,
                padding: "5px 12px",
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Question */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ display: "block", fontSize: 12, color: TEXT_MUTED, marginBottom: 6 }}>
          Question:
        </label>
        <input
          className="poll-composer-input"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={QUESTION_MAX}
          placeholder="e.g. Favorite episode so far?"
          style={{
            width: "100%",
            fontSize: 14,
            padding: "9px 16px",
            borderRadius: 9999,
            border: "none",
            height: 40,
            boxSizing: "border-box",
            color: CANON_NAVY,
            background: CANON_LIGHT,
            outline: "none",
          }}
        />
      </div>

      {/* Options */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ display: "block", fontSize: 12, color: TEXT_MUTED, marginBottom: 6 }}>
          Answer options <span style={{ color: TEXT_MUTED, opacity: 0.7 }}>(2–5)</span>
        </label>
        {options.map((o, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: TEXT_MUTED, width: 16, textAlign: "center" }}>{i + 1}</span>
            <input
              className="poll-composer-input"
              type="text"
              value={o}
              onChange={(e) => setOption(i, e.target.value)}
              maxLength={OPTION_MAX}
              placeholder={`Option ${i + 1}`}
              style={{
                flex: 1,
                fontSize: 13,
                padding: "7px 14px",
                borderRadius: 9999,
                border: "none",
                height: 34,
                boxSizing: "border-box",
                color: CANON_NAVY,
                background: CANON_LIGHT,
                outline: "none",
              }}
            />
            {options.length > MIN_OPTIONS && (
              <button
                onClick={() => removeOption(i)}
                aria-label="Remove option"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 4,
                  color: TEXT_MUTED,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <button
            onClick={addOption}
            style={{
              background: "transparent",
              border: "none",
              color: CANON_BLUE,
              fontSize: 12,
              padding: "4px 0 0",
              marginLeft: 24,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontWeight: 500,
            }}
          >
            <Plus size={12} /> add option
          </button>
        )}
        {hasDuplicates && (
          <div style={{ fontSize: 11, color: CANON_RED, marginTop: 6 }}>
            Each option must be unique.
          </div>
        )}
      </div>

      {/* Allow write-in toggle — radio sits in the number column to align
          with the 1, 2, … numbers above; text pill aligns with the inputs. */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 18,
          cursor: "pointer",
        }}
      >
        <span style={{ width: 16, display: "flex", justifyContent: "center", flexShrink: 0 }}>
          <CanonRadio
            checked={allowWriteIn}
            bgColor={CANON_LIGHT}
            color="#FEF8EA"
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
        <span
          style={{
            flex: 1,
            padding: "8px 14px",
            background: "#FEF8EA",
            borderRadius: 9999,
            fontSize: 13,
            color: CANON_NAVY,
            lineHeight: 1.4,
          }}
        >
          Allow friends to write their own answers?
        </span>
      </label>

      {/* Duration */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: 12, color: TEXT_MUTED, marginBottom: 8 }}>
          Open for:
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          {DURATIONS.map((d) => {
            const selected = d.value === duration;
            return (
              <button
                key={d.value}
                onClick={() => setDuration(d.value)}
                style={{
                  flex: 1,
                  padding: "7px 0",
                  borderRadius: 9999,
                  border: selected ? `2px solid ${CANON_GREEN}` : "none",
                  background: selected ? CANON_GREEN : "#FEF8EA",
                  fontSize: 12,
                  color: selected ? "#FEF8EA" : CANON_NAVY,
                  fontWeight: 500,
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
        <div style={{ fontSize: 11, color: CANON_RED, marginBottom: 12 }}>{error}</div>
      )}

      {/* Bottom action bar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 12, borderTop: `2px solid rgba(26,58,74,0.12)` }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            background: canSubmit ? CANON_GREEN : "rgba(122,189,142,0.45)",
            color: "#FEF8EA",
            border: canSubmit ? `2px solid ${CANON_GREEN}` : "none",
            padding: "8px 18px",
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 500,
            cursor: canSubmit ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            minHeight: 36,
            minWidth: canSubmit ? undefined : 120,
          }}
        >
          {!canSubmit ? null : submitting ? <>Opening<LoadingDots /></> : <>Open the poll <ArrowRight size={14} /></>}
        </button>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            color: TEXT_MUTED,
            border: `2px solid ${TEXT_MUTED}`,
            padding: "8px 16px",
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
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
