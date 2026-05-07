import React, { useEffect, useState } from "react";
import {
  fetchActiveRoomPoll,
  fetchPollCount,
  voteOnPoll,
  sendPollEmail,
  type ActivePollData,
} from "../lib/db";
import LoadingDots from "./LoadingDots";
import type { PollDurationCode } from "../types";

// ── Visual constants ─────────────────────────────────────────────────────
// Amber paper sticky in the left rail of the friend room. Mirrors the
// right post-it's tilt direction (negative). Visually distinct from
// presence (green) — this surface is for room activity (polls + SIKW).
const STICKY_BG       = "#FAC775";  // amber paper
const TEXT_COLOR      = "#412402";  // warm dark — body
const FADED_TEXT      = "#633806";  // faded darker amber for asker line + footer
const ACCENT          = "#854F0B";  // selected-state accent
const TILT_DEG        = -8;
const MIN_VIEWPORT_PX = 1230;
const STICKY_WIDTH    = 280;

interface Props {
  groupId: string;
  currentUserId: string;
}

function durationMs(d: PollDurationCode): number {
  return d === "24h" ? 24 * 60 * 60 * 1000
       : d === "3d"  ?  3 * 24 * 60 * 60 * 1000
       :                7 * 24 * 60 * 60 * 1000;
}

function closesInLabel(targetMs: number): string {
  const delta = targetMs - Date.now();
  if (delta <= 0) return "any moment";
  const minutes = Math.floor(delta / 60000);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours / 24);
  if (days >= 1)  return `${days}d`;
  if (hours >= 1) return `${hours}h`;
  if (minutes >= 1) return `${minutes}m`;
  return "<1m";
}

export default function PollSticky({ groupId, currentUserId }: Props) {
  const [wide, setWide] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= MIN_VIEWPORT_PX,
  );
  useEffect(() => {
    const fn = () => setWide(window.innerWidth >= MIN_VIEWPORT_PX);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const [data, setData] = useState<ActivePollData | null>(null);
  const [count, setCount] = useState<{ responseCount: number; eligibleCount: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [writeInText, setWriteInText] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load + refetch on group/user change
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setData(null);
    setCount(null);
    setSelectedOptionId(null);
    setWriteInText("");
    setError(null);

    fetchActiveRoomPoll(groupId, currentUserId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoaded(true);
        if (d) {
          fetchPollCount(d.poll.id).then((c) => {
            if (cancelled || !c) return;
            setCount({ responseCount: c.responseCount, eligibleCount: c.eligibleCount });
          }).catch(() => {});
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [groupId, currentUserId]);

  if (!wide || !loaded || !data) return null;

  const { poll, options, askerUsername, myResponse } = data;
  const hasVoted = !!myResponse;
  const closesAt = poll.createdAt + durationMs(poll.duration);

  const canSubmit =
    !submitting &&
    !hasVoted &&
    (
      selectedOptionId !== null ||
      (poll.allowWriteIn && writeInText.trim().length > 0)
    );

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await voteOnPoll({
        pollId: poll.id,
        optionId: selectedOptionId,
        writeInText: selectedOptionId ? null : writeInText.trim() || null,
      });
      if (!result.ok) {
        setError(humanVoteError(result.error));
        setSubmitting(false);
        return;
      }

      // Fire close email if this vote triggered close, otherwise the
      // vote-notification email (server-side 5-min batching de-dupes).
      if (result.didClose) {
        sendPollEmail({ templateType: "poll_close", pollId: poll.id }).catch(() => {});
      } else {
        sendPollEmail({ templateType: "poll_vote_notification", pollId: poll.id }).catch(() => {});
      }

      // Refresh state. If didClose, fetchActiveRoomPoll returns null
      // (poll is closed) and the sticky disappears — closed-state
      // bloom lands in phase 2e.
      const fresh = await fetchActiveRoomPoll(groupId, currentUserId);
      setData(fresh);
      setCount({ responseCount: result.responseCount, eligibleCount: result.eligibleCount });
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit. Try again?");
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      aria-label="Active poll"
      style={{
        position: "fixed",
        left: 32,
        top: 200,
        zIndex: 50,
        width: STICKY_WIDTH,
        transform: `rotate(${TILT_DEG}deg)`,
        transformOrigin: "center",
        background: STICKY_BG,
        color: TEXT_COLOR,
        padding: "14px 16px",
        borderRadius: 0,
        boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      {/* Asker line */}
      <div style={{ fontStyle: "italic", fontSize: 11, color: FADED_TEXT, opacity: 0.85, marginBottom: 4 }}>
        @{askerUsername || "a friend"} asks:
      </div>

      {/* Question */}
      <div
        style={{
          fontFamily: "var(--font-serif), Georgia, serif",
          fontSize: 14,
          color: TEXT_COLOR,
          lineHeight: 1.4,
          marginBottom: 12,
        }}
      >
        {poll.question}
      </div>

      {/* Option rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
        {options.map((opt) => {
          const isMine = myResponse?.optionId === opt.id;
          const isSelected = !hasVoted && selectedOptionId === opt.id;
          const highlighted = isMine || isSelected;
          return (
            <label
              key={opt.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 9px",
                borderRadius: 5,
                background: highlighted ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.5)",
                border: highlighted ? `0.5px solid ${ACCENT}` : "0.5px solid transparent",
                fontSize: 12,
                color: TEXT_COLOR,
                fontWeight: highlighted ? 500 : 400,
                cursor: hasVoted ? "default" : "pointer",
              }}
            >
              <input
                type="radio"
                name={`poll-${poll.id}`}
                disabled={hasVoted}
                checked={highlighted}
                onChange={() => setSelectedOptionId(opt.id)}
                style={{ margin: 0 }}
              />
              {opt.optionText}
            </label>
          );
        })}

        {/* Write-in row (only when allowed and not voted) */}
        {poll.allowWriteIn && !hasVoted && (
          <div
            style={{
              padding: "6px 9px",
              borderRadius: 5,
              background: "rgba(255,255,255,0.5)",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, marginBottom: 5 }}>
              <input
                type="radio"
                name={`poll-${poll.id}`}
                checked={selectedOptionId === null && writeInText.length > 0}
                onChange={() => setSelectedOptionId(null)}
                style={{ margin: 0 }}
              />
              Write your own
            </label>
            <input
              type="text"
              value={writeInText}
              onChange={(e) => {
                setWriteInText(e.target.value);
                if (selectedOptionId !== null) setSelectedOptionId(null);
              }}
              maxLength={80}
              placeholder="80 char · spoiler-free"
              style={{
                width: "100%",
                fontSize: 11,
                padding: "4px 7px",
                borderRadius: 4,
                border: `0.5px solid rgba(99,56,6,0.3)`,
                height: 24,
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Write-in display (already voted with a write-in) */}
        {hasVoted && myResponse?.writeInText && (
          <div
            style={{
              padding: "6px 9px",
              borderRadius: 5,
              background: "rgba(255,255,255,0.85)",
              border: `0.5px solid ${ACCENT}`,
              fontSize: 12,
              fontStyle: "italic",
              color: TEXT_COLOR,
              fontWeight: 500,
            }}
          >
            {myResponse.writeInText}
          </div>
        )}
      </div>

      {/* Submit button (active until vote) */}
      {!hasVoted && (
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            background: canSubmit ? ACCENT : "rgba(133,79,11,0.45)",
            color: "#fff",
            border: "none",
            padding: "6px 12px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 500,
            width: "100%",
            cursor: canSubmit ? "pointer" : "not-allowed",
            marginBottom: 8,
          }}
        >
          {submitting ? <>Sending<LoadingDots /></> : "Submit"}
        </button>
      )}

      {error && (
        <div style={{ fontSize: 11, color: "#f45028", marginBottom: 6 }}>{error}</div>
      )}

      {/* Footer */}
      <div
        style={{
          borderTop: `0.5px dashed rgba(99,56,6,0.4)`,
          paddingTop: 6,
          fontStyle: "italic",
          fontSize: 11,
          color: FADED_TEXT,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          {count
            ? `${count.responseCount} of ${count.eligibleCount} weighed in`
            : ""}
        </span>
        <span style={{ opacity: 0.75 }}>closes in {closesInLabel(closesAt)}</span>
      </div>
    </div>
  );
}

function humanVoteError(code: string): string {
  switch (code) {
    case "already_voted":         return "You already voted in this poll.";
    case "closed":                return "This poll just closed.";
    case "not_member":            return "You aren't a member of this room.";
    case "invalid_option":        return "That option isn't part of this poll.";
    case "write_in_not_allowed":  return "Write-ins aren't enabled for this poll.";
    case "write_in_empty":        return "Write-in can't be empty.";
    case "invalid_vote":          return "Pick one option (preset or write-in).";
    default:                      return "Couldn't submit. Try again?";
  }
}
