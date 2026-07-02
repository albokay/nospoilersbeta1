import React, { useEffect, useRef, useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { sendMessage } from "../lib/db";
import LoadingDots from "./LoadingDots";
import SidebarAvatar from "./SidebarAvatar";
import CanonRadio from "./CanonRadio";
import type { PingType } from "../types";
import { CANON } from "../styles/canon";

// Canon palette
const CREAM       = CANON.cream;
const CANON_BLUE  = CANON.identity;
const CANON_GREEN = CANON.personal;
const CANON_LIGHT = CANON.friend;
const CANON_RED   = CANON.alert;
const CANON_NAVY  = CANON.dark;
const TEXT_MUTED  = "#5f5e5a";

// ── Direction is FRIEND-relative (matches the right-sticky's framing) ─────
// "ahead"       = friend is ahead of me  → I am behind → behind-to-ahead picker (sticky channel)
// "behind"      = friend is behind me    → I am ahead  → ahead-to-behind picker (email channel)
// "same"        = friend at same episode → same picker (sticky channel)
// "not-started" = friend hasn't started  → treat like behind (ahead-to-behind picker, email channel)

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
  /** "from-page-bottom" (default, v1 FriendProgressPostIt) pins the popover
   *  bottom at POPOVER_BOTTOM_PX from the viewport bottom.
   *  "from-anchor" (V2 friend room map header) places the popover directly
   *  BELOW the anchor element, right-aligned to the anchor's right edge. */
  anchorMode?: "from-page-bottom" | "from-anchor";
  onClose: () => void;
}

const POPOVER_WIDTH = 300;
const GAP_FROM_ANCHOR = 14;
const POPOVER_BOTTOM_PX = 96; // matches FriendProgressPostIt bottom — anchors popup bottom to the sticky
const MESSAGE_MAX_LENGTH = 80;
// "Sent!" takeover hold time before unmount (no fade — instant swap).
const SENT_TOTAL_MS = 1000;

// Vocabulary lines per spec amendment. Sender-relative direction picks the
// set; "not-started" reuses ahead-to-behind since not-started == behind.
const VOCAB_AHEAD_TO_BEHIND = [
  "miss you in here 👋",
  "no rush, but it just got good",
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
  // friend ahead → I am behind → behind-to-ahead vocab
  if (direction === "ahead") return VOCAB_BEHIND_TO_AHEAD;
  // friend behind / not-started → I am ahead → ahead-to-behind vocab
  return VOCAB_AHEAD_TO_BEHIND;
}

function templateTypeFor(direction: NudgeDirection): PingType {
  if (direction === "same") return "nudge_same";
  // friend ahead → sender is behind → nudge_behind (sticky channel)
  if (direction === "ahead") return "nudge_behind";
  // friend behind / not-started → sender is ahead → nudge_ahead (email channel)
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
  anchorMode = "from-page-bottom",
  onClose,
}: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const presets = vocabFor(direction);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [customSelected, setCustomSelected] = useState<boolean>(false);
  const [customText, setCustomText] = useState<string>("");
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sentFlash, setSentFlash] = useState<boolean>(false);
  const [sentBoxHeight, setSentBoxHeight] = useState<number | null>(null);

  // 2026-05-24: per-ping rate limit removed. Friends can nudge as many
  // times as they want; the only throttle that remains is at the email
  // layer (1 email per (sender, recipient, room) per 24h, server-side
  // in send-message). Previous pre-check via hasRecentPing was deleted
  // along with the kill switch.

  // Position. "from-page-bottom" (v1 FriendProgressPostIt): bottom-anchored
  // popover sits to the LEFT of the anchor at 96px from the viewport
  // bottom. "from-anchor" (V2 friend room map): popover sits BELOW the
  // anchor with its right edge aligned to the anchor's right edge
  // (extends leftward — there's more page space on that side).
  const positionStyle: React.CSSProperties =
    anchorMode === "from-anchor"
      ? {
          position: "fixed",
          top: anchorRect.bottom + GAP_FROM_ANCHOR,
          right: Math.max(14, window.innerWidth - anchorRect.right),
          width: POPOVER_WIDTH,
        }
      : {
          position: "fixed",
          bottom: POPOVER_BOTTOM_PX,
          left: Math.max(14, anchorRect.left - POPOVER_WIDTH - GAP_FROM_ANCHOR),
          width: POPOVER_WIDTH,
        };

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
    setCustomSelected(false);
    setCustomText("");
    setErrorMsg(null);
  }

  function handleSelectCustom() {
    setSelectedPreset(null);
    setCustomSelected(true);
    setErrorMsg(null);
    // Focus the input on the next paint, after it mounts.
    requestAnimationFrame(() => {
      customInputRef.current?.focus();
    });
  }

  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCustomText(e.target.value);
    if (errorMsg) setErrorMsg(null);
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
        setErrorMsg(result.message || "Couldn't send. Try again?");
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      // Capture the form's height so the takeover keeps the same box size.
      if (popoverRef.current) {
        setSentBoxHeight(popoverRef.current.offsetHeight);
      }
      setSentFlash(true);
      setTimeout(() => onClose(), SENT_TOTAL_MS);
    } catch (err) {
      setSubmitting(false);
      setErrorMsg(err instanceof Error ? err.message : "Couldn't send. Try again?");
    }
  }

  function handleViewProfile(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    onClose();
    navigate(`/pool/${encodeURIComponent(recipientUsername)}`);
  }

  // ── Render ────────────────────────────────────────────────────────────
  // Takeover: when sentFlash, the entire popover contents are replaced by a
  // centered "Sent!" word, while the box keeps the same size as the form.
  if (sentFlash) {
    return (
      <div
        role="dialog"
        style={{
          ...positionStyle,
          height: sentBoxHeight ?? "auto",
          background: CREAM,
          borderRadius: 24,
          padding: "16px 18px 14px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          zIndex: 70,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: CANON_NAVY,
            fontFamily:
              '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          }}
        >
          Sent!
        </div>
      </div>
    );
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      style={{
        ...positionStyle,
        background: CREAM,
        borderRadius: 24,
        padding: "16px 18px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 70,
      }}
    >
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
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: CANON_NAVY,
              fontFamily: '"Lora", Georgia, serif',
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <SidebarAvatar userId={recipientId} username={recipientUsername} size={24} />{recipientUsername}
          </div>
          <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 1 }}>
            {relativePositionLabel(direction, count)}
          </div>
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
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 6 }}>
        Send a nudge:
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {presets.map((preset) => {
          const selected = selectedPreset === preset;
          return (
            <label
              key={preset}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 10px",
                borderRadius: 12,
                background: CANON_LIGHT,
                border: "none",
                fontSize: 12,
                color: CANON.cream,
                cursor: "pointer",
              }}
            >
              <CanonRadio checked={selected} color={CANON_BLUE} />
              <input
                type="radio"
                name={`nudge-preset-${recipientId}`}
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
            padding: "7px 10px",
            borderRadius: 12,
            border: "none",
            background: CANON_LIGHT,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: CANON.cream,
              marginBottom: customSelected ? 6 : 0,
              cursor: "pointer",
            }}
          >
            <CanonRadio
              checked={customSelected}
              color={CANON_BLUE}
            />
            <input
              type="radio"
              name={`nudge-preset-${recipientId}`}
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
              maxLength={MESSAGE_MAX_LENGTH}
              placeholder={`${MESSAGE_MAX_LENGTH} char max`}
              style={{
                width: "100%",
                fontSize: 11,
                padding: "5px 10px",
                borderRadius: 9999,
                border: "none",
                background: "rgba(253,248,236,0.7)",
                height: 26,
                boxSizing: "border-box",
                color: CANON_NAVY,
                outline: "none",
              }}
            />
          )}
        </div>
      </div>

      {/* Inline error message (rare — covers network / server failures
          only; per-ping rate limit was removed 2026-05-24). */}
      {errorMsg && (
        <div style={{ fontSize: 11, color: CANON_RED, marginBottom: 8, textAlign: "center", textWrap: "balance" }}>
          {errorMsg}
        </div>
      )}

      {/* Footer: Send / Cancel */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 32 }}>
            <button
              onClick={handleSend}
              disabled={!canSubmit}
              style={{
                background: canSubmit ? CANON_GREEN : "rgba(122,189,142,0.45)",
                color: CANON.cream,
                border: canSubmit ? `2px solid ${CANON_GREEN}` : "none",
                padding: "6px 14px",
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 500,
                cursor: canSubmit ? "pointer" : "not-allowed",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                minHeight: 28,
                minWidth: canSubmit ? undefined : 90,
              }}
            >
              {!canSubmit ? null : submitting ? <>Sending<LoadingDots /></> : <>Send <ArrowRight size={13} /></>}
            </button>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                color: TEXT_MUTED,
                border: `2px solid ${TEXT_MUTED}`,
                padding: "6px 12px",
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
      </div>

      {/* Profile link */}
      <div
        style={{
          borderTop: `2px solid rgba(26,58,74,0.12)`,
          marginTop: 12,
          paddingTop: 8,
        }}
      >
        <a
          href={`/pool/${encodeURIComponent(recipientUsername)}`}
          onClick={handleViewProfile}
          style={{
            fontSize: 11,
            color: CANON_BLUE,
            textDecoration: "none",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          View @{recipientUsername}'s profile <ArrowRight size={11} />
        </a>
      </div>
    </div>
  );
}
