import React, { useState } from "react";
import { X, Clock } from "lucide-react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import { openAsk, sendSikwEmail } from "../lib/db";

const MESSAGE_MAX = 80;

const PRESETS: string[] = [
  "not feeling it. worth pushing through?",
  "I'm bored. does it pick up?",
];

interface Props {
  groupId: string;
  /** Asker's progress at send time, captured into the ask record so
   *  respondents can render meaningful episode-target dropdowns. */
  progressSeason: number;
  progressEpisode: number;
  onClose: () => void;
  onOpened?: (askId: string) => void;
}

function formatSE(season: number, episode: number): string {
  return `Season ${season} Episode ${episode}`;
}

export default function SIKWComposer({
  groupId,
  progressSeason,
  progressEpisode,
  onClose,
  onOpened,
}: Props) {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [customText, setCustomText] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [existingType, setExistingType] = useState<"poll" | "ask" | null>(null);

  function handleSelectPreset(preset: string) {
    setSelectedPreset(preset);
    setCustomText("");
    setError(null);
  }
  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCustomText(e.target.value);
    if (selectedPreset) setSelectedPreset(null);
    if (error) setError(null);
  }

  const trimmedCustom = customText.trim();
  const messageToSend: string | null = selectedPreset
    ? selectedPreset
    : trimmedCustom.length > 0
      ? trimmedCustom
      : null;

  const canSubmit =
    !!messageToSend &&
    !submitting &&
    trimmedCustom.length <= MESSAGE_MAX;

  async function attemptSubmit(replaceExisting: boolean) {
    if (!messageToSend) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await openAsk({
        groupId,
        message: messageToSend,
        progressSeason,
        progressEpisode,
        replaceExisting,
      });
      if (!result.ok) {
        if (result.error === "has_active_item") {
          setExistingType(result.existingType ?? "ask");
          setSubmitting(false);
          setShowReplaceConfirm(true);
          return;
        }
        setError(humanError(result.error));
        setSubmitting(false);
        return;
      }
      // Fire-and-forget invites to non-asker members.
      sendSikwEmail({ templateType: "sikw_ask_invite", askId: result.askId }).catch(() => {});
      onOpened?.(result.askId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send. Try again?");
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 500, color: "#042c53" }}>
          Should I keep watching?
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: "#888780",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div style={{ fontSize: 12, color: "#5f5e5a", marginBottom: 16 }}>
        Ask the room whether to stick with the show. Replies are spoiler-light by structure.
      </div>

      {/* Progress context block */}
      <div
        style={{
          background: "#f1efe8",
          borderRadius: 7,
          padding: "10px 12px",
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Clock size={14} color="#5f5e5a" strokeWidth={1.8} />
        <div style={{ fontSize: 12, color: "#2c2c2a" }}>
          Your friends will see you're at{" "}
          <span style={{ fontWeight: 500, color: "#042c53" }}>
            {formatSE(progressSeason, progressEpisode)}
          </span>
          .
        </div>
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
          You have an active {existingType === "poll" ? "poll" : "ask"} in this room. Opening a new ask will replace it.
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

      <div style={{ fontSize: 12, color: "#5f5e5a", marginBottom: 8 }}>
        How do you want to ask it?
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
        {PRESETS.map((preset) => {
          const selected = selectedPreset === preset;
          return (
            <label
              key={preset}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 11px",
                borderRadius: 6,
                background: selected ? "#e6f1fb" : "transparent",
                border: selected ? "0.5px solid #b5d4f4" : "0.5px solid rgba(0,0,0,0.12)",
                fontSize: 13,
                color: selected ? "#042c53" : "#2c2c2a",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="sikw-preset"
                checked={selected}
                onChange={() => handleSelectPreset(preset)}
                style={{ margin: 0 }}
              />
              {preset}
            </label>
          );
        })}

        {/* Write your own */}
        <div
          style={{
            padding: "9px 11px",
            borderRadius: 6,
            border: "0.5px solid rgba(0,0,0,0.12)",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "#2c2c2a",
              marginBottom: 7,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="sikw-preset"
              checked={selectedPreset === null && trimmedCustom.length > 0}
              onChange={() => setSelectedPreset(null)}
              style={{ margin: 0 }}
            />
            Write your own
          </label>
          <input
            type="text"
            value={customText}
            onChange={handleCustomChange}
            maxLength={MESSAGE_MAX}
            placeholder="80 char max — keep it spoiler-free for friends behind you"
            style={{
              width: "100%",
              fontSize: 12,
              padding: "6px 9px",
              borderRadius: 4,
              border: "0.5px solid rgba(0,0,0,0.12)",
              height: 28,
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {error && <div style={{ fontSize: 11, color: "#f45028", marginBottom: 10 }}>{error}</div>}

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          paddingTop: 12,
          borderTop: "0.5px solid rgba(0,0,0,0.08)",
        }}
      >
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
          {submitting ? <>Asking<LoadingDots /></> : "Ask the room →"}
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
    case "message_empty":      return "Pick or write something to ask.";
    case "message_too_long":   return `Keep it under ${MESSAGE_MAX} characters.`;
    case "progress_required":  return "Set your watch progress first.";
    case "progress_invalid":   return "Your progress looks invalid.";
    case "unauthenticated":    return "Sign in and try again.";
    default:                   return "Couldn't send. Try again?";
  }
}
