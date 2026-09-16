import React, { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import Modal from "./Modal";
import LoadingDots from "./LoadingDots";
import CanonRadio from "./CanonRadio";
import useSheetSwipeDown from "../lib/useSheetSwipeDown";
import { openAsk, sendSikwEmail } from "../lib/db";
import { CANON, withAlpha } from "../styles/canon";
import { M, OVERLAY } from "../mobile/m";
import { D } from "./dashboardChrome";

// Canon palette. Pass 3 (2026-09-16): the off-palette greys (#5f5e5a,
// #2c2c2a) retired — quiet text is dark ink at 0.7. The surface itself is
// DORMANT (SIKW retired 2026-07-28; the map opens PollComposer directly) —
// restyled anyway per Alborz so a revival lands on the current grammar.
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
  /** Pass 3: /m idiom — the cream bottom sheet (grabber, swipe-down,
   *  tap-out, no ×). Default false = the desktop Form card. */
  mobile?: boolean;
}

export default function SIKWComposer({
  groupId,
  progressSeason,
  progressEpisode,
  onClose,
  onOpened,
  mobile = false,
}: Props) {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [customSelected, setCustomSelected] = useState<boolean>(false);
  const [customText, setCustomText] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [existingType, setExistingType] = useState<"poll" | "ask" | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const sheetSwipe = useSheetSwipeDown(onClose, { enabled: !submitting });

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

  const mPill = mobile ? M.pill.M : D.pill.M;

  const content = (
    <>
      <style>{`
        .sikw-composer-input::placeholder { color: rgba(26,58,74,0.45); opacity: 1; }
      `}</style>
      {/* No × (pass 3) — Cancel is the exit; tap-out still closes. The
          clock box folded into the caption below. */}
      <div style={{ fontFamily: LORA, fontWeight: 700, fontSize: mobile ? 22 : 28, lineHeight: 1.25, color: CANON_NAVY, marginBottom: 4 }}>
        Should I keep watching?
      </div>
      <div style={{ fontFamily: INTER, fontSize: 13, lineHeight: 1.45, color: INK_70, marginBottom: 20 }}>
        Ask the room whether to stick with the show. They&rsquo;ll see you&rsquo;re at{" "}
        <b>S{progressSeason} E{progressEpisode}</b>.
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
          You have an active {existingType === "poll" ? "poll" : "ask"} in this room. Opening a new ask will replace it.
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

      <div style={{ fontFamily: INTER, fontSize: 14, fontWeight: 700, color: CANON_NAVY, marginBottom: 8 }}>
        How do you want to ask it?
      </div>

      {/* Preset rows — 48 min at 15/radius 12; the SELECTED row fills solid
          sky (+600) so the choice reads as a state, others sky at 45%. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {PRESETS.map((preset) => {
          const selected = selectedPreset === preset;
          return (
            <label
              key={preset}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 16px",
                minHeight: 48,
                boxSizing: "border-box",
                borderRadius: 12,
                background: selected ? CANON_LIGHT : withAlpha(CANON_LIGHT, 0.45),
                fontFamily: INTER,
                fontSize: 15,
                fontWeight: selected ? 600 : 400,
                color: CANON_NAVY,
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

        {/* Write your own — same row grammar ("(write your own)" label kept
            per Alborz); the field appears BELOW the row as a 44 on-cream
            input, not tucked inside it. */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            minHeight: 48,
            boxSizing: "border-box",
            borderRadius: 12,
            background: customSelected ? CANON_LIGHT : withAlpha(CANON_LIGHT, 0.45),
            fontFamily: INTER,
            fontSize: 15,
            fontWeight: customSelected ? 600 : 400,
            color: CANON_NAVY,
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
            className="sikw-composer-input"
            type="text"
            value={customText}
            onChange={handleCustomChange}
            maxLength={MESSAGE_MAX}
            placeholder="80 char max — keep it spoiler-free for friends behind you"
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: "none",
              borderRadius: 9999,
              background: CREAM,
              boxShadow: `inset 0 0 0 2px ${CANON_LIGHT}`,
              minHeight: 44,
              padding: "10px 16px",
              fontFamily: INTER,
              fontSize: 15,
              color: CANON_NAVY,
              outline: "none",
            }}
          />
        )}
      </div>

      {error && <div style={{ fontFamily: INTER, fontSize: 13, color: CANON_RED, marginTop: 12 }}>{error}</div>}

      {/* Buttons — primary first, label always visible (0.6 until valid);
          Cancel = sky outline. Divider gone; 28px gap. */}
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
          {submitting ? <>Asking<LoadingDots /></> : <>Ask the room <ArrowRight size={14} /></>}
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
    case "message_empty":      return "Pick or write something to ask.";
    case "message_too_long":   return `Keep it under ${MESSAGE_MAX} characters.`;
    case "progress_required":  return "Set your watch progress first.";
    case "progress_invalid":   return "Your progress looks invalid.";
    case "unauthenticated":    return "Sign in and try again.";
    default:                   return "Couldn't send. Try again?";
  }
}
