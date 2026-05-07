import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  fetchActiveRoomPoll,
  fetchPollCount,
  voteOnPoll,
  sendPollEmail,
  lazyCloseRoomPolls,
  fetchMostRecentClosedRoomPoll,
  type ActivePollData,
  type ClosedPollData,
} from "../lib/db";
import { dismissClosedPoll } from "../lib/db";
import LoadingDots from "./LoadingDots";
import type { PollDurationCode } from "../types";

// ── Visual constants ─────────────────────────────────────────────────────
const STICKY_BG       = "#FAC775";
const TEXT_COLOR      = "#412402";
const FADED_TEXT      = "#633806";
const ACCENT          = "#854F0B";
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

  const [active, setActive]   = useState<ActivePollData | null>(null);
  const [closed, setClosed]   = useState<ClosedPollData | null>(null);
  const [count, setCount]     = useState<{ responseCount: number; eligibleCount: number } | null>(null);
  const [loaded, setLoaded]   = useState(false);
  const [dismissedLocal, setDismissedLocal] = useState(false);

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [writeInText, setWriteInText] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load: lazy-close expired polls, then fetch active + closed.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setActive(null);
    setClosed(null);
    setCount(null);
    setSelectedOptionId(null);
    setWriteInText("");
    setError(null);
    setDismissedLocal(false);

    (async () => {
      try {
        // Lazy close any duration-expired polls. Each ID returned is one
        // this caller's UPDATE just closed; fire close email for each.
        const justClosed = await lazyCloseRoomPolls(groupId);
        for (const pid of justClosed) {
          sendPollEmail({ templateType: "poll_close", pollId: pid }).catch(() => {});
        }
      } catch {
        // Best-effort — proceed with reads even if lazy close failed.
      }

      try {
        const a = await fetchActiveRoomPoll(groupId, currentUserId);
        if (cancelled) return;
        setActive(a);
        if (a) {
          fetchPollCount(a.poll.id).then((c) => {
            if (cancelled || !c) return;
            setCount({ responseCount: c.responseCount, eligibleCount: c.eligibleCount });
          }).catch(() => {});
        } else {
          // Only look at closed when there's no active poll.
          const c = await fetchMostRecentClosedRoomPoll(groupId, currentUserId);
          if (cancelled) return;
          setClosed(c);
        }
      } catch {
        if (cancelled) return;
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [groupId, currentUserId]);

  if (!wide || !loaded) return null;

  // ── ACTIVE STATE ───────────────────────────────────────────────────────
  if (active) {
    return renderActive();
  }

  // ── CLOSED STATE ───────────────────────────────────────────────────────
  if (closed && !dismissedLocal) {
    return renderClosed();
  }

  return null;

  // ── render functions (closures over hooks/state) ───────────────────────

  function renderActive() {
    if (!active) return null;
    const { poll, options, askerUsername, myResponse } = active;
    const hasVoted = !!myResponse;
    const closesAt = poll.createdAt + durationMs(poll.duration);

    const canSubmit =
      !submitting &&
      !hasVoted &&
      (selectedOptionId !== null || (poll.allowWriteIn && writeInText.trim().length > 0));

    async function handleSubmit() {
      if (!canSubmit || !active) return;
      setSubmitting(true);
      setError(null);
      try {
        const result = await voteOnPoll({
          pollId: active.poll.id,
          optionId: selectedOptionId,
          writeInText: selectedOptionId ? null : writeInText.trim() || null,
        });
        if (!result.ok) {
          setError(humanVoteError(result.error));
          setSubmitting(false);
          return;
        }
        if (result.didClose) {
          sendPollEmail({ templateType: "poll_close", pollId: active.poll.id }).catch(() => {});
        } else {
          sendPollEmail({ templateType: "poll_vote_notification", pollId: active.poll.id }).catch(() => {});
        }
        // Refresh: if didClose, fetchActiveRoomPoll returns null and
        // closed-state branch takes over on this render.
        const fresh = await fetchActiveRoomPoll(groupId, currentUserId);
        setActive(fresh);
        if (!fresh) {
          const c = await fetchMostRecentClosedRoomPoll(groupId, currentUserId);
          setClosed(c);
        } else {
          setCount({ responseCount: result.responseCount, eligibleCount: result.eligibleCount });
        }
        setSubmitting(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't submit. Try again?");
        setSubmitting(false);
      }
    }

    return (
      <div style={stickyShellStyle()}>
        <div style={askerLineStyle()}>@{askerUsername || "a friend"} asks:</div>
        <div style={questionStyle()}>{poll.question}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
          {options.map((opt) => {
            const isMine     = myResponse?.optionId === opt.id;
            const isSelected = !hasVoted && selectedOptionId === opt.id;
            const highlighted = isMine || isSelected;
            return (
              <label
                key={opt.id}
                style={optionRowStyle(highlighted, hasVoted)}
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

          {poll.allowWriteIn && !hasVoted && (
            <div style={{ padding: "6px 9px", borderRadius: 5, background: "rgba(255,255,255,0.5)" }}>
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

          {hasVoted && myResponse?.writeInText && (
            <div style={writeInLockedStyle()}>{myResponse.writeInText}</div>
          )}
        </div>

        {!hasVoted && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={submitButtonStyle(canSubmit)}
          >
            {submitting ? <>Sending<LoadingDots /></> : "Submit"}
          </button>
        )}

        {error && <div style={{ fontSize: 11, color: "#f45028", marginBottom: 6 }}>{error}</div>}

        <div style={footerStyle()}>
          <span>{count ? `${count.responseCount} of ${count.eligibleCount} weighed in` : ""}</span>
          <span style={{ opacity: 0.75 }}>closes in {closesInLabel(closesAt)}</span>
        </div>
      </div>
    );
  }

  function renderClosed() {
    if (!closed) return null;
    const { poll, options, askerUsername, responses } = closed;

    // Aggregate per option
    const total = responses.length;
    const countByOption: Record<string, string[]> = {};
    const writeIns: { responderUsername: string | null; text: string }[] = [];
    for (const r of responses) {
      if (r.optionId) {
        if (!countByOption[r.optionId]) countByOption[r.optionId] = [];
        countByOption[r.optionId].push(r.responderUsername || "(someone)");
      } else if (r.writeInText) {
        writeIns.push({ responderUsername: r.responderUsername, text: r.writeInText });
      }
    }

    const optionVoteCounts = options.map((opt) => (countByOption[opt.id] ?? []).length);
    const maxVotes = optionVoteCounts.length > 0 ? Math.max(...optionVoteCounts) : 0;

    async function handleDismiss() {
      setDismissedLocal(true);
      try {
        await dismissClosedPoll(closed!.poll.id);
      } catch {
        // local hide is enough; next nav re-fetches truth
      }
    }

    return (
      <div style={stickyShellStyle()}>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            background: "transparent",
            border: "none",
            padding: 2,
            color: FADED_TEXT,
            opacity: 0.6,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <X size={13} />
        </button>

        <div style={askerLineStyle()}>@{askerUsername || "a friend"} asked:</div>
        <div style={{ ...questionStyle(), marginBottom: 14 }}>{poll.question}</div>

        {options.map((opt) => {
          const voters = countByOption[opt.id] ?? [];
          const isWinner = voters.length > 0 && voters.length === maxVotes;
          const pct = total > 0 ? (voters.length / total) * 100 : 0;
          return (
            <div key={opt.id} style={{ marginBottom: 4 }}>
              <div
                style={{
                  fontSize: 13,
                  color: TEXT_COLOR,
                  fontWeight: isWinner ? 500 : 400,
                  opacity: voters.length === 0 ? 0.7 : 1,
                  marginBottom: 4,
                }}
              >
                {opt.optionText}
              </div>
              <div style={{ fontStyle: "italic", fontSize: 11, color: FADED_TEXT, lineHeight: 1.5, marginBottom: 6, opacity: voters.length === 0 ? 0.55 : 1 }}>
                {voters.length === 0
                  ? "no votes"
                  : voters.map((u, i) => <div key={i}>@{u}</div>)}
              </div>
              <div
                style={{
                  background: "rgba(133, 79, 11, 0.18)",
                  height: 2,
                  marginBottom: 10,
                  borderRadius: 1,
                }}
              >
                <div
                  style={{
                    background: ACCENT,
                    height: "100%",
                    width: `${pct}%`,
                    borderRadius: 1,
                  }}
                />
              </div>
            </div>
          );
        })}

        {writeIns.length > 0 && (
          <div style={{ marginTop: 6, marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: FADED_TEXT, marginBottom: 4 }}>Write-ins:</div>
            {writeIns.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: TEXT_COLOR, marginBottom: 4 }}>
                <span style={{ fontStyle: "italic" }}>"{w.text}"</span>
                <span style={{ fontStyle: "italic", color: FADED_TEXT, marginLeft: 6 }}>
                  — @{w.responderUsername || "(someone)"}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ ...footerStyle(), justifyContent: "flex-start" }}>
          <span>closed · {responses.length} of {closed.eligibleCount} weighed in</span>
        </div>
      </div>
    );
  }
}

// ── style helpers ────────────────────────────────────────────────────────

function stickyShellStyle(): React.CSSProperties {
  return {
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
  };
}

function askerLineStyle(): React.CSSProperties {
  return { fontStyle: "italic", fontSize: 11, color: FADED_TEXT, opacity: 0.85, marginBottom: 4 };
}

function questionStyle(): React.CSSProperties {
  return {
    fontFamily: "var(--font-serif), Georgia, serif",
    fontSize: 14,
    color: TEXT_COLOR,
    lineHeight: 1.4,
    marginBottom: 12,
  };
}

function optionRowStyle(highlighted: boolean, locked: boolean): React.CSSProperties {
  return {
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
    cursor: locked ? "default" : "pointer",
  };
}

function writeInLockedStyle(): React.CSSProperties {
  return {
    padding: "6px 9px",
    borderRadius: 5,
    background: "rgba(255,255,255,0.85)",
    border: `0.5px solid ${ACCENT}`,
    fontSize: 12,
    fontStyle: "italic",
    color: TEXT_COLOR,
    fontWeight: 500,
  };
}

function submitButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    background: enabled ? ACCENT : "rgba(133,79,11,0.45)",
    color: "#fff",
    border: "none",
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 500,
    width: "100%",
    cursor: enabled ? "pointer" : "not-allowed",
    marginBottom: 8,
  };
}

function footerStyle(): React.CSSProperties {
  return {
    borderTop: `0.5px dashed rgba(99,56,6,0.4)`,
    paddingTop: 6,
    fontStyle: "italic",
    fontSize: 11,
    color: FADED_TEXT,
    display: "flex",
    justifyContent: "space-between",
  };
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
