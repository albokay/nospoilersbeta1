import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  fetchActiveRoomAsk,
  fetchMostRecentClosedRoomAsk,
  replyToAsk,
  sendSikwEmail,
  lazyCloseRoomAsks,
  dismissClosedAsk,
  type ActiveAskData,
  type ClosedAskData,
  type SikwReplyType,
} from "../lib/db";
import LoadingDots from "./LoadingDots";

// ── Visual constants ─────────────────────────────────────────────────────
// SIKW shares the left-rail amber sticky surface with polls. Same palette,
// same tilt — visually distinct from the green presence post-it on the
// right. Polls and asks share the slot per spec; in v1 the two stickies
// (PollSticky + SIKWSticky) mount independently and only one type
// surfaces at a time given the per-asker enforcement.

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
  /** Show's seasons[] for episode-target dropdown options. */
  seasons: number[];
}

const ASK_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 1 week, fixed for SIKW

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

function formatSE(season: number, episode: number): string {
  return `Season ${season} Episode ${episode}`;
}

type EpisodeOption = { season: number; episode: number; label: string };

function generateEpisodeOptions(seasons: number[]): EpisodeOption[] {
  const opts: EpisodeOption[] = [];
  for (let s = 1; s <= seasons.length; s++) {
    const epCount = seasons[s - 1] ?? 0;
    for (let e = 1; e <= epCount; e++) {
      opts.push({ season: s, episode: e, label: formatSE(s, e) });
    }
  }
  return opts;
}

export default function SIKWSticky({ groupId, currentUserId, seasons }: Props) {
  const [wide, setWide] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= MIN_VIEWPORT_PX,
  );
  useEffect(() => {
    const fn = () => setWide(window.innerWidth >= MIN_VIEWPORT_PX);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const [data, setData]       = useState<ActiveAskData | null>(null);
  const [closed, setClosed]   = useState<ClosedAskData | null>(null);
  const [loaded, setLoaded]   = useState(false);
  const [dismissedLocal, setDismissedLocal] = useState(false);

  // Replier form state
  const [selectedType, setSelectedType] = useState<SikwReplyType | null>(null);
  const [stickEpisode, setStickEpisode] = useState<EpisodeOption | null>(null);
  const [giveEpisode, setGiveEpisode]   = useState<EpisodeOption | null>(null);
  const [customText, setCustomText]     = useState<string>("");
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // Initial load: lazy-close expired asks then fetch active or closed.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setData(null);
    setClosed(null);
    setDismissedLocal(false);
    setSelectedType(null);
    setStickEpisode(null);
    setGiveEpisode(null);
    setCustomText("");
    setError(null);

    (async () => {
      try {
        await lazyCloseRoomAsks(groupId);
      } catch {
        // best-effort
      }
      try {
        const a = await fetchActiveRoomAsk(groupId, currentUserId);
        if (cancelled) return;
        setData(a);
        if (!a) {
          const c = await fetchMostRecentClosedRoomAsk(groupId, currentUserId);
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
  if (!data && (!closed || dismissedLocal)) return null;
  if (closed && !data && !dismissedLocal) return renderClosedSticky();
  if (!data) return null;

  const { ask, askerUsername, myReply, allReplies, eligibleCount } = data;
  const isAsker = ask.askerId === currentUserId;
  const closesAt = ask.createdAt + ASK_DURATION_MS;

  const episodeOptions = generateEpisodeOptions(seasons);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={stickyShellStyle()}>
      {/* Asker line — first-person for asker, third-person for everyone else */}
      {isAsker ? (
        <div style={askerLineStyle()}>you asked:</div>
      ) : (
        <div style={askerLineStyle()}>
          @{askerUsername || "a friend"} is at <strong style={{ fontStyle: "normal", fontWeight: 500 }}>
            {formatSE(ask.askerProgressSeason, ask.askerProgressEpisode)}
          </strong> and asks:
        </div>
      )}

      {/* Question */}
      <div style={{ ...questionStyle(), marginBottom: isAsker ? 8 : 4 }}>{ask.message}</div>

      {/* Privacy line — only for repliers; asker's privacy reminder
          lives inline in the empty state ("waiting for replies… (only
          you see them)") */}
      {!isAsker && (
        <div style={{ fontStyle: "italic", fontSize: 10, color: FADED_TEXT, opacity: 0.7, marginBottom: 12 }}>
          only @{askerUsername || "the asker"} sees your reply
        </div>
      )}

      {/* Body branches by viewer */}
      {isAsker
        ? renderAskerView()
        : myReply
          ? renderRepliedView()
          : renderReplierForm()}

      {error && <div style={{ fontSize: 11, color: "#f45028", marginBottom: 6 }}>{error}</div>}

      {/* Footer */}
      <div style={footerStyle()}>
        {isAsker ? (
          <>
            <span>{allReplies.length} of {eligibleCount} friends replied</span>
            <span style={{ opacity: 0.75 }}>closes in {closesInLabel(closesAt)}</span>
          </>
        ) : (
          <span style={{ marginLeft: "auto", opacity: 0.85 }}>closes in {closesInLabel(closesAt)}</span>
        )}
      </div>
    </div>
  );

  // ── Asker view: live replies ───────────────────────────────────────────
  function renderAskerView() {
    if (!data) return null;
    if (allReplies.length === 0) {
      return (
        <div style={{ fontSize: 12, fontStyle: "italic", color: FADED_TEXT, opacity: 0.75, marginBottom: 10 }}>
          waiting for replies… <span style={{ opacity: 0.85 }}>(only you see them)</span>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {allReplies.map((r) => (
          <div
            key={r.id}
            style={{
              padding: "6px 9px",
              borderRadius: 5,
              background: "rgba(255,255,255,0.65)",
              fontSize: 12,
              color: TEXT_COLOR,
            }}
          >
            <div style={{ fontStyle: "italic", color: FADED_TEXT, marginBottom: 2 }}>
              @{r.replierUsername || "(someone)"}
            </div>
            <div>{renderReplyContent(r)}</div>
          </div>
        ))}
      </div>
    );
  }

  function renderReplyContent(r: { replyType: SikwReplyType; episodeTargetSeason: number | null; episodeTargetEpisode: number | null; message: string | null }): string {
    if (r.replyType === "stick_with_it" && r.episodeTargetSeason && r.episodeTargetEpisode) {
      return `Stick with it — gets better after ${formatSE(r.episodeTargetSeason, r.episodeTargetEpisode)}`;
    }
    if (r.replyType === "give_until" && r.episodeTargetSeason && r.episodeTargetEpisode) {
      return `Give it at least until ${formatSE(r.episodeTargetSeason, r.episodeTargetEpisode)}`;
    }
    if (r.replyType === "dropping_is_fair") {
      return "Honestly, dropping is fair";
    }
    if (r.replyType === "custom" && r.message) {
      return `"${r.message}"`;
    }
    return "(unknown)";
  }

  // ── Replier view: own reply locked ─────────────────────────────────────
  function renderRepliedView() {
    if (!myReply) return null;
    return (
      <div
        style={{
          padding: "8px 11px",
          borderRadius: 5,
          background: "rgba(255,255,255,0.85)",
          border: `0.5px solid ${ACCENT}`,
          fontSize: 12,
          color: TEXT_COLOR,
          marginBottom: 10,
          fontWeight: 500,
        }}
      >
        {renderReplyContent(myReply)}
        <div style={{ fontSize: 10, fontStyle: "italic", color: FADED_TEXT, marginTop: 4, fontWeight: 400 }}>
          your reply has been sent to @{askerUsername || "the asker"}
        </div>
      </div>
    );
  }

  // ── Replier form: pick option + episode target / write-in ──────────────
  function renderReplierForm() {
    const canSubmit = (() => {
      if (submitting) return false;
      if (selectedType === null) return false;
      if (selectedType === "stick_with_it") return !!stickEpisode;
      if (selectedType === "give_until")    return !!giveEpisode;
      if (selectedType === "custom")        return customText.trim().length > 0;
      if (selectedType === "dropping_is_fair") return true;
      return false;
    })();

    async function handleSubmit() {
      if (!canSubmit || !data) return;
      setSubmitting(true);
      setError(null);
      try {
        const args: Parameters<typeof replyToAsk>[0] = {
          askId: data.ask.id,
          replyType: selectedType!,
        };
        if (selectedType === "stick_with_it" && stickEpisode) {
          args.episodeTargetSeason = stickEpisode.season;
          args.episodeTargetEpisode = stickEpisode.episode;
        } else if (selectedType === "give_until" && giveEpisode) {
          args.episodeTargetSeason = giveEpisode.season;
          args.episodeTargetEpisode = giveEpisode.episode;
        } else if (selectedType === "custom") {
          args.message = customText.trim();
        }
        const result = await replyToAsk(args);
        if (!result.ok) {
          setError(humanReplyError(result.error));
          setSubmitting(false);
          return;
        }
        // Reply notification email always (no batching for SIKW per spec).
        sendSikwEmail({ templateType: "sikw_reply", askId: data.ask.id }).catch(() => {});
        // Note: we don't fire a close email on did_close here — that's
        // the SIKW-version of the poll close path. Per spec the close
        // email isn't part of the SIKW spec amendment (no email type
        // for SIKW close). Asker sees the closed state in-room.
        // Refresh to show the locked reply.
        const fresh = await fetchActiveRoomAsk(groupId, currentUserId);
        setData(fresh);
        setSubmitting(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't submit. Try again?");
        setSubmitting(false);
      }
    }

    return (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
          {/* Stick with it */}
          <label style={replyOptionStyle(selectedType === "stick_with_it")}>
            <input
              type="radio"
              name={`sikw-${ask.id}`}
              checked={selectedType === "stick_with_it"}
              onChange={() => setSelectedType("stick_with_it")}
              style={{ margin: 0 }}
            />
            <span>Stick with it — gets better after</span>
            <select
              value={stickEpisode ? `${stickEpisode.season}-${stickEpisode.episode}` : ""}
              onChange={(e) => {
                const [s, ep] = e.target.value.split("-").map(Number);
                const opt = episodeOptions.find((o) => o.season === s && o.episode === ep);
                setStickEpisode(opt ?? null);
                setSelectedType("stick_with_it");
              }}
              style={selectStyle()}
              onClick={() => setSelectedType("stick_with_it")}
            >
              <option value="">Sxx Exx</option>
              {episodeOptions.map((o) => (
                <option key={`${o.season}-${o.episode}`} value={`${o.season}-${o.episode}`}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {/* Give until */}
          <label style={replyOptionStyle(selectedType === "give_until")}>
            <input
              type="radio"
              name={`sikw-${ask.id}`}
              checked={selectedType === "give_until"}
              onChange={() => setSelectedType("give_until")}
              style={{ margin: 0 }}
            />
            <span>Give it at least until</span>
            <select
              value={giveEpisode ? `${giveEpisode.season}-${giveEpisode.episode}` : ""}
              onChange={(e) => {
                const [s, ep] = e.target.value.split("-").map(Number);
                const opt = episodeOptions.find((o) => o.season === s && o.episode === ep);
                setGiveEpisode(opt ?? null);
                setSelectedType("give_until");
              }}
              style={selectStyle()}
              onClick={() => setSelectedType("give_until")}
            >
              <option value="">Sxx Exx</option>
              {episodeOptions.map((o) => (
                <option key={`${o.season}-${o.episode}`} value={`${o.season}-${o.episode}`}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {/* Dropping is fair */}
          <label style={replyOptionStyle(selectedType === "dropping_is_fair")}>
            <input
              type="radio"
              name={`sikw-${ask.id}`}
              checked={selectedType === "dropping_is_fair"}
              onChange={() => setSelectedType("dropping_is_fair")}
              style={{ margin: 0 }}
            />
            Honestly, dropping is fair
          </label>

          {/* Write your own */}
          <div style={{ padding: "7px 9px", borderRadius: 5, background: selectedType === "custom" ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.5)", border: selectedType === "custom" ? `0.5px solid ${ACCENT}` : "0.5px solid transparent" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: TEXT_COLOR, marginBottom: 5 }}>
              <input
                type="radio"
                name={`sikw-${ask.id}`}
                checked={selectedType === "custom"}
                onChange={() => setSelectedType("custom")}
                style={{ margin: 0 }}
              />
              Write your own
            </label>
            <input
              type="text"
              value={customText}
              onChange={(e) => {
                setCustomText(e.target.value);
                setSelectedType("custom");
              }}
              maxLength={80}
              placeholder="80 char · spoiler-free"
              style={{
                width: "100%",
                fontSize: 11,
                padding: "4px 7px",
                borderRadius: 4,
                border: "0.5px solid rgba(99,56,6,0.3)",
                height: 24,
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

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
          {submitting ? <>Sending<LoadingDots /></> : `Send to @${askerUsername || "the asker"} →`}
        </button>
      </>
    );
  }

  // ── Closed sticky ──────────────────────────────────────────────────────
  function renderClosedSticky() {
    if (!closed) return null;
    const { ask: cAsk, askerUsername: cAsker, myReply: cMyReply, allReplies: cAllReplies, eligibleCount: cEligible } = closed;
    const cIsAsker = cAsk.askerId === currentUserId;

    async function handleDismiss() {
      setDismissedLocal(true);
      try {
        await dismissClosedAsk(cAsk.id);
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

        {/* Eyebrow */}
        {cIsAsker ? (
          <div style={askerLineStyle()}>you asked:</div>
        ) : (
          <div style={askerLineStyle()}>@{cAsker || "a friend"} asked:</div>
        )}

        {/* Question */}
        <div style={{ ...questionStyle(), marginBottom: 10 }}>{cAsk.message}</div>

        {/* Body branches */}
        {cIsAsker ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            <div style={{ fontStyle: "italic", fontSize: 10, color: FADED_TEXT, opacity: 0.7 }}>
              only you see these replies
            </div>
            {cAllReplies.length === 0 ? (
              <div style={{ fontSize: 12, fontStyle: "italic", color: FADED_TEXT, opacity: 0.75 }}>
                no replies came in.
              </div>
            ) : (
              cAllReplies.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: "6px 9px",
                    borderRadius: 5,
                    background: "rgba(255,255,255,0.65)",
                    fontSize: 12,
                    color: TEXT_COLOR,
                  }}
                >
                  <div style={{ fontStyle: "italic", color: FADED_TEXT, marginBottom: 2 }}>
                    @{r.replierUsername || "(someone)"}
                  </div>
                  <div>{renderReplyContent(r)}</div>
                </div>
              ))
            )}
          </div>
        ) : cMyReply ? (
          <div
            style={{
              padding: "8px 11px",
              borderRadius: 5,
              background: "rgba(255,255,255,0.85)",
              border: `0.5px solid ${ACCENT}`,
              fontSize: 12,
              color: TEXT_COLOR,
              marginBottom: 10,
              fontWeight: 500,
            }}
          >
            {renderReplyContent(cMyReply)}
          </div>
        ) : (
          <div style={{ fontSize: 12, fontStyle: "italic", color: FADED_TEXT, opacity: 0.75, marginBottom: 10 }}>
            you didn't reply
          </div>
        )}

        {/* Footer */}
        <div style={{ ...footerStyle(), justifyContent: cIsAsker ? "flex-start" : "center" }}>
          {cIsAsker ? (
            <span>closed · {cAllReplies.length} of {cEligible} friends replied</span>
          ) : (
            <span style={{ marginLeft: "auto" }}>closed</span>
          )}
        </div>
      </div>
    );
  }
}

// ── style helpers (mirror PollSticky's amber styling) ────────────────────

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
    marginBottom: 4,
  };
}

function replyOptionStyle(selected: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "7px 9px",
    borderRadius: 5,
    background: selected ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.5)",
    border: selected ? `0.5px solid ${ACCENT}` : "0.5px solid transparent",
    fontSize: 12,
    color: TEXT_COLOR,
    fontWeight: selected ? 500 : 400,
    cursor: "pointer",
    flexWrap: "wrap",
  };
}

function selectStyle(): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "1px 5px",
    borderRadius: 3,
    border: `0.5px solid ${ACCENT}`,
    background: "white",
    color: TEXT_COLOR,
    height: 22,
    marginLeft: 2,
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

function humanReplyError(code: string): string {
  switch (code) {
    case "already_replied":           return "You already replied.";
    case "closed":                    return "This ask just closed.";
    case "asker_cannot_reply":        return "You can't reply to your own ask.";
    case "not_member":                return "You aren't a member of this room.";
    case "episode_target_required":   return "Pick an episode for that option.";
    case "episode_target_not_allowed":return "That option doesn't take an episode.";
    case "message_empty":             return "Write something to send.";
    case "message_too_long":          return "Keep it under 80 characters.";
    case "message_not_allowed":       return "That option doesn't take a message.";
    case "invalid_reply_type":        return "Pick a reply option.";
    default:                          return "Couldn't submit. Try again?";
  }
}
