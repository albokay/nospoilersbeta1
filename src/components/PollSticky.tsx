import React, { useEffect, useState } from "react";
import { X, ArrowRight } from "lucide-react";
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
import CanonRadio from "./CanonRadio";
import type { PollDurationCode } from "../types";
import { CANON } from "../styles/canon";

// ── Visual constants ─────────────────────────────────────────────────────
const STICKY_BG       = CANON.accent;           // canon yellow
const TEXT_COLOR      = CANON.cream;                 // primary text over yellow
const FADED_TEXT      = "rgba(253,248,236,0.7)";// secondary text over yellow
const DIVIDER_COLOR   = "rgba(253,248,236,0.6)";
const SUBMIT_BG       = CANON.personal;            // canon green
const CANON_NAVY      = CANON.dark;         // text on white choice rows
const TILT_DEG        = -4;
const MIN_VIEWPORT_PX = 1160;
const STICKY_WIDTH    = 240;

// localStorage gate — asker dismissed their own active poll. Hides the
// active sticky for that asker until the poll closes; the closed-state
// sticky then renders normally (different gate: dismissedLocal +
// dismiss_closed_poll RPC).
const ASKER_DISMISS_KEY_PREFIX = "ns_poll_asker_dismissed_";
function isAskerDismissed(pollId: string): boolean {
  try { return localStorage.getItem(ASKER_DISMISS_KEY_PREFIX + pollId) === "1"; }
  catch { return false; }
}
function markAskerDismissed(pollId: string): void {
  try { localStorage.setItem(ASKER_DISMISS_KEY_PREFIX + pollId, "1"); } catch {}
}

interface Props {
  groupId: string;
  currentUserId: string;
  /** Bumping this counter forces an immediate re-fetch — used so the asker
   *  sees their just-opened poll without a page nav. */
  refreshKey?: number;
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

export default function PollSticky({ groupId, currentUserId, refreshKey = 0 }: Props) {
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
  const [askerDismissedPollId, setAskerDismissedPollId] = useState<string | null>(null);

  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [customSelected, setCustomSelected] = useState<boolean>(false);
  const [writeInText, setWriteInText] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load: lazy-close expired polls, then fetch active + closed.
  // On a refresh-triggered load (refreshKey > 0, e.g. asker just opened a
  // poll), skip lazy close and keep prior visible state in place until the
  // fresh data overwrites it — eliminates a wasted round-trip and avoids a
  // blank flash for the asker waiting to see their poll.
  useEffect(() => {
    let cancelled = false;
    const isRefresh = refreshKey > 0;
    if (!isRefresh) {
      setLoaded(false);
      setActive(null);
      setClosed(null);
      setCount(null);
      setSelectedOptionId(null);
      setCustomSelected(false);
      setWriteInText("");
      setError(null);
      setDismissedLocal(false);
    }

    (async () => {
      if (!isRefresh) {
        try {
          const justClosed = await lazyCloseRoomPolls(groupId);
          for (const pid of justClosed) {
            sendPollEmail({ templateType: "poll_close", pollId: pid }).catch(() => {});
          }
        } catch {
          // Best-effort — proceed with reads even if lazy close failed.
        }
      }

      try {
        const a = await fetchActiveRoomPoll(groupId, currentUserId);
        if (cancelled) return;
        setActive(a);
        if (a) {
          // Clear any stale closed-state from a prior poll so we render active.
          setClosed(null);
          fetchPollCount(a.poll.id).then((c) => {
            if (cancelled || !c) return;
            setCount({ responseCount: c.responseCount, eligibleCount: c.eligibleCount });
          }).catch(() => {});
        } else {
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
  }, [groupId, currentUserId, refreshKey]);

  // After active poll loads, restore asker's dismissal flag from localStorage
  // so the hide persists across refreshes/navigation.
  useEffect(() => {
    if (active && active.poll.askerId === currentUserId && isAskerDismissed(active.poll.id)) {
      setAskerDismissedPollId(active.poll.id);
    } else {
      setAskerDismissedPollId(null);
    }
  }, [active, currentUserId]);

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
    const isAsker = poll.askerId === currentUserId;
    const closesAt = poll.createdAt + durationMs(poll.duration);

    // Hide gates:
    //   - Non-asker voter who already voted: hide; closed sticky takes
    //     over via fetchMostRecentClosedRoomPoll once the poll closes.
    //   - Asker who clicked ×: hide; same re-surface path.
    //   - Asker who has not yet voted: keep the form visible (× only
    //     appears after they submit their own response).
    if (hasVoted && !isAsker) return null;
    if (isAsker && askerDismissedPollId === poll.id) return null;

    function handleAskerDismiss() {
      if (!active) return;
      markAskerDismissed(active.poll.id);
      setAskerDismissedPollId(active.poll.id);
    }

    const canSubmit =
      !submitting &&
      !hasVoted &&
      (selectedOptionId !== null ||
        (poll.allowWriteIn && customSelected && writeInText.trim().length > 0));

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
        {isAsker && hasVoted && (
          <button
            onClick={handleAskerDismiss}
            aria-label="Dismiss"
            style={{
              position: "absolute",
              top: 2,
              right: 4,
              background: "transparent",
              border: "none",
              padding: 6,
              color: FADED_TEXT,
              opacity: 0.6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={13} />
          </button>
        )}
        <div style={askerLineStyle()}>
          {isAsker ? "you asked:" : `@${askerUsername || "a friend"} asks:`}
        </div>
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
                <CanonRadio checked={highlighted} color={CANON.cream} bgColor={STICKY_BG} />
                <input
                  type="radio"
                  name={`poll-${poll.id}`}
                  disabled={hasVoted}
                  checked={highlighted}
                  onChange={() => {
                    setSelectedOptionId(opt.id);
                    setCustomSelected(false);
                  }}
                  style={{ display: "none" }}
                />
                {opt.optionText}
              </label>
            );
          })}

          {poll.allowWriteIn && !hasVoted && (
            <div style={{ padding: "8px 11px", borderRadius: 12, background: CANON.cream }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: CANON_NAVY, marginBottom: customSelected ? 6 : 0, cursor: "pointer" }}>
                <CanonRadio
                  checked={customSelected}
                  color={CANON.cream}
                  bgColor={STICKY_BG}
                />
                <input
                  type="radio"
                  name={`poll-${poll.id}`}
                  checked={customSelected}
                  onChange={() => {
                    setSelectedOptionId(null);
                    setCustomSelected(true);
                  }}
                  style={{ display: "none" }}
                />
                (write your own)
              </label>
              {customSelected && (
                <input
                  type="text"
                  value={writeInText}
                  onChange={(e) => setWriteInText(e.target.value)}
                  maxLength={80}
                  placeholder="80 char · spoiler-free"
                  autoFocus
                  style={{
                    width: "100%",
                    fontSize: 11,
                    padding: "5px 9px",
                    borderRadius: 9999,
                    border: "none",
                    height: 26,
                    boxSizing: "border-box",
                    color: CANON_NAVY,
                    background: "rgba(253,248,236,0.6)",
                    outline: "none",
                  }}
                />
              )}
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
            {!canSubmit ? null : submitting ? <>Sending<LoadingDots /></> : "Submit"}
          </button>
        )}

        {error && <div style={{ fontSize: 11, color: CANON.alert, marginBottom: 6 }}>{error}</div>}

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
    const isAsker = poll.askerId === currentUserId;

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
            top: 2,
            right: 4,
            background: "transparent",
            border: "none",
            padding: 6,
            color: FADED_TEXT,
            opacity: 0.6,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={13} />
        </button>

        <div style={askerLineStyle()}>
          {isAsker ? "you asked:" : `@${askerUsername || "a friend"} asked:`}
        </div>
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
                  background: "rgba(253,248,236,0.25)",
                  height: 2,
                  marginBottom: 10,
                  borderRadius: 1,
                }}
              >
                <div
                  style={{
                    background: CANON.cream,
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
    top: 260,
    zIndex: 50,
    width: STICKY_WIDTH,
    transform: `rotate(${TILT_DEG}deg)`,
    transformOrigin: "center",
    background: STICKY_BG,
    color: TEXT_COLOR,
    padding: "14px 16px",
    borderRadius: 0,
    boxShadow: "0 8px 20px rgba(0,0,0,0.20)",
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

function optionRowStyle(_highlighted: boolean, locked: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 11px",
    borderRadius: 12,
    background: CANON.cream,
    border: "none",
    fontSize: 12,
    color: CANON_NAVY,
    fontWeight: 500,
    cursor: locked ? "default" : "pointer",
  };
}

function writeInLockedStyle(): React.CSSProperties {
  return {
    padding: "8px 11px",
    borderRadius: 12,
    background: CANON.cream,
    border: "none",
    fontSize: 12,
    fontStyle: "italic",
    color: CANON_NAVY,
    fontWeight: 500,
  };
}

function submitButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    background: enabled ? SUBMIT_BG : "rgba(122,189,142,0.45)",
    color: CANON.cream,
    border: "none",
    padding: "6px 12px",
    borderRadius: 9999,
    fontSize: 11,
    fontWeight: 500,
    width: "100%",
    cursor: enabled ? "pointer" : "not-allowed",
    marginBottom: 8,
    minHeight: 26,
  };
}

function footerStyle(): React.CSSProperties {
  return {
    borderTop: `1px dotted ${DIVIDER_COLOR}`,
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
