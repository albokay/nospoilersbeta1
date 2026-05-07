import React, { useRef, useState } from "react";
import { X, Clock, ArrowRight } from "lucide-react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import CanonRadio from "./CanonRadio";
import { openAsk, sendSikwEmail } from "../lib/db";

// Canon palette
const CREAM        = "#fef8ea";
const CANON_BLUE   = "#355eb8";
const CANON_YELLOW = "#dea838";
const CANON_RED    = "#f45028";
const CANON_NAVY   = "#1a3a4a";
const CANON_LIGHT  = "#adc8d7";
const TEXT_MUTED   = "#5f5e5a";

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
  const [customSelected, setCustomSelected] = useState<boolean>(false);
  const [customText, setCustomText] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [existingType, setExistingType] = useState<"poll" | "ask" | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);

  function handleSelectPreset(preset: string) {
    setSelectedPreset(preset);
    setCustomSelected(false);
    setCustomText("");
    setError(null);
  }
  function handleSelectCustom() {
    setSelectedPreset(null);
    setCustomSelected(true);
    setError(null);
    requestAnimationFrame(() => customInputRef.current?.focus());
  }
  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCustomText(e.target.value);
    if (error) setError(null);
  }

  const trimmedCustom = customText.trim();
  const messageToSend: string | null = selectedPreset
    ? selectedPreset
    : customSelected && trimmedCustom.length > 0
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
    <Modal onClose={onClose} width="min(420px, 92vw)" cardStyle={{ background: CREAM, padding: "20px 22px 18px", border: `2px solid ${CANON_BLUE}` }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, color: CANON_NAVY, fontFamily: '"Lora", Georgia, serif' }}>
          Should I keep watching?
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            padding: 6,
            margin: -6,
            color: TEXT_MUTED,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 16 }}>
        Ask the room whether to stick with the show.
      </div>

      {/* Progress context block */}
      <div
        style={{
          background: "rgba(173,200,215,0.25)",
          border: "none",
          borderRadius: 12,
          padding: "10px 12px",
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Clock size={14} color={CANON_NAVY} strokeWidth={1.8} />
        <div style={{ fontSize: 12, color: CANON_NAVY }}>
          Your friends will see you're at{" "}
          <span style={{ fontWeight: 600 }}>
            {formatSE(progressSeason, progressEpisode)}
          </span>
          .
        </div>
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
          You have an active {existingType === "poll" ? "poll" : "ask"} in this room. Opening a new ask will replace it.
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              onClick={handleConfirmReplace}
              disabled={submitting}
              style={{
                background: CANON_YELLOW,
                color: "#fff",
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

      <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 8 }}>
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
                gap: 10,
                padding: "9px 12px",
                borderRadius: 12,
                background: CANON_LIGHT,
                border: "none",
                fontSize: 13,
                color: selected ? CANON_NAVY : "#2c2c2a",
                cursor: "pointer",
              }}
            >
              <CanonRadio checked={selected} color={CANON_BLUE} size={20} dotSize={10} />
              <input
                type="radio"
                name="sikw-preset"
                checked={selected}
                onChange={() => handleSelectPreset(preset)}
                style={{ display: "none" }}
              />
              {preset}
            </label>
          );
        })}

        {/* Write your own */}
        <div
          style={{
            padding: "9px 12px",
            borderRadius: 12,
            border: "none",
            background: CANON_LIGHT,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              color: "#2c2c2a",
              marginBottom: customSelected ? 8 : 0,
              cursor: "pointer",
            }}
          >
            <CanonRadio
              checked={customSelected}
              color={CANON_BLUE}
              size={20}
              dotSize={10}
            />
            <input
              type="radio"
              name="sikw-preset"
              checked={customSelected}
              onChange={handleSelectCustom}
              style={{ display: "none" }}
            />
            (write your own)
          </label>
          {customSelected && (
            <input
              ref={customInputRef}
              type="text"
              value={customText}
              onChange={handleCustomChange}
              maxLength={MESSAGE_MAX}
              placeholder="80 char max — keep it spoiler-free for friends behind you"
              style={{
                width: "100%",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 9999,
                border: `2px solid ${CANON_LIGHT}`,
                background: "#fff",
                height: 30,
                boxSizing: "border-box",
                color: CANON_NAVY,
                outline: "none",
              }}
            />
          )}
        </div>
      </div>

      {error && <div style={{ fontSize: 11, color: CANON_RED, marginBottom: 10 }}>{error}</div>}

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          paddingTop: 12,
          borderTop: `2px solid rgba(26,58,74,0.12)`,
        }}
      >
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            background: canSubmit ? CANON_BLUE : "rgba(53,94,184,0.45)",
            color: "#fff",
            border: canSubmit ? `2px solid ${CANON_BLUE}` : "none",
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
          {!canSubmit ? null : submitting ? <>Asking<LoadingDots /></> : <>Ask the room <ArrowRight size={14} /></>}
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
    case "message_empty":      return "Pick or write something to ask.";
    case "message_too_long":   return `Keep it under ${MESSAGE_MAX} characters.`;
    case "progress_required":  return "Set your watch progress first.";
    case "progress_invalid":   return "Your progress looks invalid.";
    case "unauthenticated":    return "Sign in and try again.";
    default:                   return "Couldn't send. Try again?";
  }
}
