import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { hasRecentPing, sendMessage } from "../lib/db";
import LoadingDots from "./LoadingDots";
import type { PingType } from "../types";

// ── Direction maps to which picker the popover renders ────────────────────
// Sender-relative: "ahead" means the sender is ahead of the recipient
// (recipient is behind, email channel). "behind" means recipient is
// ahead of the sender (sticky channel). "same" means same progress
// (sticky channel). "not-started" treats the recipient as behind.

export type NudgeDirection = "ahead" | "same" | "behind" | "not-started";

interface Props {
  recipientUsername: string;
  recipientId: string;
  groupId: string;
  currentUserId: string;
  direction: NudgeDirection;
  /** Episodes ahead/behind, when computable. null when seasons[] is incomplete. */
  count: number | null;
  /** Bounding rect of the row that was clicked, used to anchor the popover. */
  anchorRect: DOMRect;
  onClose: () => void;
}

const POPOVER_WIDTH = 300;
const ARROW_SIZE = 7;
const GAP_FROM_ANCHOR = 14;
const MESSAGE_MAX_LENGTH = 80;
const SENT_FLASH_MS = 1500;

// Vocabulary lines per spec amendment. Sender-relative direction picks the
// set; "not-started" reuses ahead-to-behind since not-started == behind.
const VOCAB_AHEAD_TO_BEHIND = [
  "miss you in here 👋",
  "no rush, but it's getting good",
  "piling up takes for you",
  "still planning to watch or did you give up?",
];
const VOCAB_SAME = [
  "can't wait to read your thoughts!",
];
const VOCAB_BEHIND_TO_AHEAD = [
  "ok, ok, I'll catch up!",
  "wow, you binged. must be getting good.",
];

function vocabFor(direction: NudgeDirection): string[] {
  if (direction === "same") return VOCAB_SAME;
  if (direction === "behind") return VOCAB_BEHIND_TO_AHEAD;
  return VOCAB_AHEAD_TO_BEHIND;
}

function templateTypeFor(direction: NudgeDirection): PingType {
  if (direction === "same") return "nudge_same";
  if (direction === "behind") return "nudge_behind";
  return "nudge_ahead";
}

function relativePositionLabel(direction: NudgeDirection, count: number | null): string {
  if (direction === "same") return "caught up with you";
  if (direction === "not-started") return "hasn't started watching";
  const word = direction === "ahead" ? "ahead" : "behind";
  if (count == null) return word;
  return `${count} episode${count === 1 ? "" : "s"} ${word}`;
}

export default function NudgePopover({
  recipientUsername,
  recipientId,
  groupId,
  currentUserId,
  direction,
  count,
  anchorRect,
  onClose,
}: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const presets = vocabFor(direction);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [customText, setCustomText] = useState<string>("");
  const [rateLimited, setRateLimited] = useState<boolean>(false);
  const [rateChecked, setRateChecked] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sentFlash, setSentFlash] = useState<boolean>(false);

  // Pre-check rate limit so the Send button can render disabled from the
  // start instead of accepting input that will be rejected.
  useEffect(() => {
    let cancelled = false;
    hasRecentPing({ senderId: currentUserId, recipientId, groupId })
      .then((recent) => {
        if (cancelled) return;
        setRateLimited(recent);
        setRateChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Network/RLS issue. Don't block — the edge function will catch
        // an actual rate-limit violation on submit.
        setRateChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, recipientId, groupId]);

  // Position: sit to the LEFT of the anchor row (the post-it lives on the
  // right of the screen), vertically centered on the row. Clamp to keep
  // the popover on-screen.
  const popoverTop = Math.max(
    14,
    Math.min(
      window.innerHeight - 320,
      anchorRect.top + anchorRect.height / 2 - 130,
    ),
  );
  const popoverLeft = Math.max(
    14,
    anchorRect.left - POPOVER_WIDTH - GAP_FROM_ANCHOR,
  );
  const arrowTop = Math.max(
    20,
    Math.min(
      290,
      anchorRect.top + anchorRect.height / 2 - popoverTop,
    ),
  );

  // Click-outside dismissal
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    }
    const t = setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [onClose]);

  // Escape key dismissal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleSelectPreset(preset: string) {
    setSelectedPreset(preset);
    setCustomText("");
    setErrorMsg(null);
  }

  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCustomText(e.target.value);
    if (selectedPreset) setSelectedPreset(null);
    if (errorMsg) setErrorMsg(null);
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
    !rateLimited &&
    rateChecked &&
    trimmedCustom.length <= MESSAGE_MAX_LENGTH;

  async function handleSend() {
    if (!messageToSend) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await sendMessage({
        templateType: templateTypeFor(direction),
        recipientId,
        groupId,
        message: messageToSend,
      });
      if (!result.ok) {
        if (result.error === "rate_limit") {
          setRateLimited(true);
          setErrorMsg(`You already nudged @${recipientUsername} in this room this week.`);
        } else {
          setErrorMsg(result.message || "Couldn't send. Try again?");
        }
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      setSentFlash(true);
      setTimeout(() => onClose(), SENT_FLASH_MS);
    } catch (err) {
      setSubmitting(false);
      setErrorMsg(err instanceof Error ? err.message : "Couldn't send. Try again?");
    }
  }

  function handleViewProfile(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    onClose();
    navigate(`/user/${encodeURIComponent(recipientUsername)}`);
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      ref={popoverRef}
      role="dialog"
      style={{
        position: "fixed",
        top: popoverTop,
        left: popoverLeft,
        width: POPOVER_WIDTH,
        background: "#fff",
        borderRadius: 10,
        border: "0.5px solid rgba(0,0,0,0.12)",
        padding: "14px 14px 12px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 70,
      }}
    >
      {/* Arrow pointing right (toward the anchor row) */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -ARROW_SIZE,
          top: arrowTop,
          width: 0,
          height: 0,
          borderTop: `${ARROW_SIZE}px solid transparent`,
          borderBottom: `${ARROW_SIZE}px solid transparent`,
          borderLeft: `${ARROW_SIZE}px solid #fff`,
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#042c53" }}>
            @{recipientUsername}
          </div>
          <div style={{ fontSize: 11, color: "#5f5e5a", marginTop: 1 }}>
            {relativePositionLabel(direction, count)}
          </div>
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
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div style={{ fontSize: 11, color: "#5f5e5a", marginBottom: 6 }}>
        Send a nudge:
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
        {presets.map((preset) => {
          const selected = selectedPreset === preset;
          return (
            <label
              key={preset}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 9px",
                borderRadius: 5,
                background: selected ? "#e6f1fb" : "transparent",
                border: selected ? "0.5px solid #b5d4f4" : "0.5px solid rgba(0,0,0,0.08)",
                fontSize: 12,
                color: selected ? "#042c53" : "#2c2c2a",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name={`nudge-preset-${recipientId}`}
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
            padding: "6px 9px",
            borderRadius: 5,
            border: "0.5px solid rgba(0,0,0,0.08)",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12,
              color: "#2c2c2a",
              marginBottom: 5,
            }}
          >
            <input
              type="radio"
              name={`nudge-preset-${recipientId}`}
              checked={selectedPreset === null && trimmedCustom.length > 0}
              onChange={() => {
                setSelectedPreset(null);
              }}
              style={{ margin: 0 }}
            />
            Write your own
          </label>
          <input
            type="text"
            value={customText}
            onChange={handleCustomChange}
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder={`${MESSAGE_MAX_LENGTH} char max`}
            style={{
              width: "100%",
              fontSize: 11,
              padding: "4px 7px",
              borderRadius: 4,
              border: "0.5px solid rgba(0,0,0,0.12)",
              height: 24,
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {/* Inline rate-limit / error message */}
      {rateLimited && (
        <div style={{ fontSize: 11, color: "#5f5e5a", marginBottom: 8, fontStyle: "italic" }}>
          You already nudged @{recipientUsername} in this room this week.
        </div>
      )}
      {!rateLimited && errorMsg && (
        <div style={{ fontSize: 11, color: "#f45028", marginBottom: 8 }}>
          {errorMsg}
        </div>
      )}

      {/* Footer: Send / Cancel, OR sent confirmation */}
      <div style={{ display: "flex", gap: 7, alignItems: "center", minHeight: 30 }}>
        {sentFlash ? (
          <div style={{ fontSize: 12, color: "#185fa5", fontWeight: 500 }}>sent →</div>
        ) : (
          <>
            <button
              onClick={handleSend}
              disabled={!canSubmit}
              style={{
                background: canSubmit ? "#185fa5" : "rgba(24,95,165,0.45)",
                color: "#fff",
                border: "none",
                padding: "6px 14px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
                cursor: canSubmit ? "pointer" : "not-allowed",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {submitting ? <>Sending<LoadingDots /></> : "Send →"}
            </button>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                color: "#5f5e5a",
                border: "0.5px solid #b4b2a9",
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Profile link */}
      <div
        style={{
          borderTop: "0.5px solid rgba(0,0,0,0.08)",
          marginTop: 12,
          paddingTop: 8,
        }}
      >
        <a
          href={`/user/${encodeURIComponent(recipientUsername)}`}
          onClick={handleViewProfile}
          style={{
            fontSize: 11,
            color: "#185fa5",
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          View @{recipientUsername}'s profile →
        </a>
      </div>
    </div>
  );
}
