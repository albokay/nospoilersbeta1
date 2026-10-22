/**
 * NudgeSheet — the nudge an AHEAD friend sends to friends 3+ episodes
 * behind (Alborz's "friend who pulls ahead" pass, 2026-10-22, CP1).
 *
 * One sheet for both platforms: a BottomSheet on the phone, an
 * EditorialDialog on desktop. "In your own words" leads; three starters
 * fill the field (the friend can rewrite them); one Send. Several
 * recipients (a shared "Sam and Priya are here" marker) get the same
 * words, each as their own nudge — the email and the room note treat
 * them as if nudged alone. Every nudge is `nudge_ahead` (the one
 * direction that remains: the behind friend's way back is the answer
 * sheet, CP2). Opened from the feed's marker and the desktop map column;
 * the daily email's link opens it directly (CP3).
 */
import React, { useEffect, useRef, useState } from "react";
import { sendMessage } from "../lib/db";
import LoadingDots from "./LoadingDots";
import { E } from "../styles/editorial";
import { BottomSheet } from "./editorial/Overlays";
import { EditorialDialog } from "./editorial/GroupRoom";
import { Block } from "./editorial/Onboarding";

export const NUDGE_MAX_LENGTH = 200;

export type NudgeRecipient = {
  userId: string;
  /** The viewer's name for them (contact name → first name → handle). */
  name: string;
  /** Episodes behind the viewer; 0 = hasn't started. */
  behind: number;
  /** false = hasn't started watching. */
  started: boolean;
};

export function joinNudgeNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The sheet's subhead (his copy): the pull in episodes, counting up as
 *  the viewer watches on; a friend who hasn't started is named as such. */
export function nudgeSubhead(recipients: NudgeRecipient[], viewerEpisodes: number): string {
  const names = joinNudgeNames(recipients.map((r) => r.name));
  const started = recipients.filter((r) => r.started);
  if (!started.length) {
    const eps = `${viewerEpisodes} episode${viewerEpisodes === 1 ? "" : "s"}`;
    return recipients.length === 1
      ? `${names} hasn’t started yet. You’re ${eps} in.`
      : `${names} haven’t started yet. You’re ${eps} in.`;
  }
  const n = Math.min(...started.map((r) => r.behind));
  return `You’ve pulled ${n} episode${n === 1 ? "" : "s"} ahead of ${names}.`;
}

function startersFor(recipients: NudgeRecipient[]): string[] {
  const noneStarted = recipients.every((r) => !r.started);
  return [
    "miss you in here 👋",
    "It’s getting good. Come find my letters.",
    noneStarted ? "Still planning to watch?" : "Do you want to stop?",
  ];
}

export default function NudgeSheet({ recipients, groupId, viewerEpisodes, mobile = false, onClose, onSent }: {
  recipients: NudgeRecipient[];
  groupId: string;
  viewerEpisodes: number;
  mobile?: boolean;
  onClose: () => void;
  /** After every recipient's nudge landed. */
  onSent?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!mobile) fieldRef.current?.focus(); }, [mobile]);

  const names = joinNudgeNames(recipients.map((r) => r.name));
  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= NUDGE_MAX_LENGTH && !busy && !sent;

  async function send() {
    if (!canSend) return;
    setBusy(true); setError(null);
    const results = await Promise.all(recipients.map((r) => sendMessage({ templateType: "nudge_ahead", recipientId: r.userId, groupId, message: trimmed }).catch(() => ({ ok: false as const, error: "network" }))));
    setBusy(false);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      const m = (failed[0] as { message?: string }).message;
      setError(m || "Couldn’t send. Try again?");
      return;
    }
    setSent(true);
    onSent?.();
    window.setTimeout(onClose, 900);
  }

  const label: React.CSSProperties = { ...E.type.label11, color: E.color.ink };
  const starter: React.CSSProperties = { padding: "10px 14px", border: `1px solid rgba(26,58,74,0.4)`, background: "transparent", color: E.color.ink, fontFamily: E.font.interface, fontSize: 15, textAlign: "left", cursor: "pointer" };

  const body = sent ? (
    <div style={{ padding: "28px 0", textAlign: "center", fontFamily: E.font.display, fontWeight: 700, fontSize: 22, color: E.color.ink }}>Sent to {names}.</div>
  ) : (
    <>
      <div style={{ ...E.type.body15, color: E.color.inkSub, marginTop: mobile ? 8 : 10 }}>{nudgeSubhead(recipients, viewerEpisodes)}</div>
      <label htmlFor="nudge-text" style={{ ...label, display: "block", marginTop: 24 }}>In your own words</label>
      <textarea
        id="nudge-text"
        ref={fieldRef}
        value={text}
        onChange={(e) => { setText(e.target.value.slice(0, NUDGE_MAX_LENGTH)); if (error) setError(null); }}
        placeholder={`Write to ${names}…`}
        rows={4}
        style={{ display: "block", width: "100%", marginTop: 8, height: 104, boxSizing: "border-box", padding: 12, border: `1px solid ${E.color.ink}`, background: E.color.cream, color: E.color.ink, fontFamily: E.font.display, fontSize: 16, lineHeight: 1.5, resize: "none", outline: "none", borderRadius: 0 }}
      />
      <div style={{ ...E.type.label10, textTransform: "none", color: E.color.inkMuted, marginTop: 6, textAlign: "right" }}>{trimmed.length} / {NUDGE_MAX_LENGTH}</div>
      <div style={{ ...label, color: E.color.inkMuted, marginTop: 14 }}>Or start from</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, marginTop: 10 }}>
        {startersFor(recipients).map((s) => (
          <button key={s} type="button" onClick={() => { setText(s); setError(null); fieldRef.current?.focus(); }} style={starter}>{s}</button>
        ))}
      </div>
      {error && <div style={{ ...E.type.note13, color: E.color.alert, marginTop: 14 }}>{error}</div>}
      <div style={{ ...E.type.note13, color: E.color.inkMuted, marginTop: 24, marginBottom: 12 }}>{recipients.length > 1 ? "They each get it" : `${names} gets it`} by email and in the room.</div>
      <Block onClick={send} disabled={!canSend} style={{ height: 54 }}>{busy ? <>Sending<LoadingDots /></> : `Send to ${recipients.length > 1 ? "both" : names} →`}</Block>
    </>
  );

  const title = `Nudge ${names}`;
  if (mobile) {
    return <BottomSheet onClose={onClose} title={title} maxHeight="88dvh">{body}</BottomSheet>;
  }
  return (
    <EditorialDialog onClose={onClose} width={440} label={title} align="left">
      <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: 28, lineHeight: 1.1, color: E.color.ink, paddingRight: 28 }}>{title}</div>
      {body}
    </EditorialDialog>
  );
}
