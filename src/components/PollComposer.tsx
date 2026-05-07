import React, { useState } from "react";
import { X } from "lucide-react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import { openPoll, sendPollEmail, type PollDuration } from "../lib/db";

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
        if (result.error === "has_active_poll") {
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
    <Modal onClose={onClose} width="min(420px, 92vw)" cardStyle={{ background: "#fff", padding: "20px 22px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: "#042c53" }}>Open a poll</div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ background: "transparent", border: "none", padding: 0, color: "#888780", cursor: "pointer", display: "flex", alignItems: "center" }}
        >
          <X size={16} />
        </button>
      </div>
      <div style={{ fontSize: 12, color: "#5f5e5a", marginBottom: 18 }}>
        Ask the room a question with set answer choices.
      </div>

      {showReplaceConfirm && (
        <div
          style={{
            background: "#fef6e6",
            border: "0.5px solid #dea838",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 14,
            fontSize: 12,
            color: "#412402",
            lineHeight: 1.4,
          }}
        >
          You have an active poll in this room. Opening a new poll will replace it.
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              onClick={handleConfirmReplace}
              disabled={submitting}
              style={{
                background: "#dea838",
                color: "#fff",
                border: "none",
                padding: "5px 12px",
                borderRadius: 999,
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
                color: "#5f5e5a",
                border: "0.5px solid #b4b2a9",
                padding: "5px 12px",
                borderRadius: 999,
                fontSize: 12,
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
        <label style={{ display: "block", fontSize: 12, color: "#5f5e5a", marginBottom: 6 }}>
          Question
        </label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={QUESTION_MAX}
          placeholder="e.g. Favorite episode so far?"
          style={{
            width: "100%",
            fontSize: 14,
            padding: "9px 11px",
            borderRadius: 6,
            border: "0.5px solid rgba(0,0,0,0.18)",
            height: 36,
            boxSizing: "border-box",
            color: "#042c53",
          }}
        />
      </div>

      {/* Options */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ display: "block", fontSize: 12, color: "#5f5e5a", marginBottom: 6 }}>
          Answer options <span style={{ color: "#888780" }}>(2–5)</span>
        </label>
        {options.map((o, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "#888780", width: 16, textAlign: "center" }}>{i + 1}</span>
            <input
              type="text"
              value={o}
              onChange={(e) => setOption(i, e.target.value)}
              maxLength={OPTION_MAX}
              placeholder={`Option ${i + 1}`}
              style={{
                flex: 1,
                fontSize: 13,
                padding: "7px 10px",
                borderRadius: 6,
                border: "0.5px solid rgba(0,0,0,0.18)",
                height: 32,
                boxSizing: "border-box",
                color: "#042c53",
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
                  color: "#888780",
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
              color: "#185fa5",
              fontSize: 12,
              padding: "4px 0 0",
              marginLeft: 24,
              cursor: "pointer",
            }}
          >
            + add option
          </button>
        )}
        {hasDuplicates && (
          <div style={{ fontSize: 11, color: "#f45028", marginTop: 6 }}>
            Each option must be unique.
          </div>
        )}
      </div>

      {/* Allow write-in toggle */}
      <div
        style={{
          marginBottom: 18,
          padding: "10px 12px",
          borderRadius: 8,
          background: "#f1efe8",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "#042c53", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={allowWriteIn}
            onChange={(e) => setAllowWriteIn(e.target.checked)}
            style={{ margin: 0 }}
          />
          Allow write-in answers
        </label>
        <div style={{ fontSize: 11, color: "#5f5e5a", marginTop: 4, marginLeft: 26, lineHeight: 1.4 }}>
          If on, friends can write their own answer. Remind them to keep it spoiler-free.
        </div>
      </div>

      {/* Duration */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: 12, color: "#5f5e5a", marginBottom: 8 }}>
          Open for
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
                  borderRadius: 6,
                  border: selected ? "0.5px solid #185fa5" : "0.5px solid rgba(0,0,0,0.18)",
                  background: selected ? "#e6f1fb" : "#fff",
                  fontSize: 12,
                  color: "#042c53",
                  fontWeight: selected ? 500 : 400,
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
        <div style={{ fontSize: 11, color: "#f45028", marginBottom: 12 }}>{error}</div>
      )}

      {/* Bottom action bar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 12, borderTop: "0.5px solid rgba(0,0,0,0.08)" }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            background: canSubmit ? "#185fa5" : "rgba(24,95,165,0.45)",
            color: "#fff",
            border: "none",
            padding: "8px 18px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 500,
            cursor: canSubmit ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {submitting ? <>Opening<LoadingDots /></> : "Open the poll →"}
        </button>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            color: "#5f5e5a",
            border: "0.5px solid #b4b2a9",
            padding: "8px 16px",
            borderRadius: 999,
            fontSize: 13,
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
