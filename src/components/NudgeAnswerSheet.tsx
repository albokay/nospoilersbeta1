/**
 * NudgeAnswerSheet — the nudged friend answers (the friend who pulls
 * ahead, CP2, 2026-10-22; his design, mockups on the nudges canvas).
 *
 * One room's nudges stack on one sheet (several friends, one answer):
 * the notes first, then "I'm still in" / "I'll sit out the rest",
 * then a required "Say something back", then the one act — "Send to
 * Yalborz →" (nothing changes in the room) or "Sit out and tell Yalborz →"
 * (what the stance sheet's Sit this out does: the stance, the vote, the
 * room left; letters stay). Every nudger gets the answer by email and as
 * their room note. Closing without answering = "Later": the nudges stop
 * opening by themselves and wait as the room's paper note.
 *
 * `reply` mode shows the NUDGER an answer that came back ("Sam is still
 * in." + the words) with one act that clears it.
 */
import React, { useState } from "react";
import { sendMessage, dismissPing, markNudgesSeen, setGroupShowPass, setShowVote, leaveShowRoom, type PendingNudge } from "../lib/db";
import LoadingDots from "./LoadingDots";
import { E } from "../styles/editorial";
import { BottomSheet } from "./editorial/Overlays";
import { EditorialDialog } from "./editorial/GroupRoom";
import { Block } from "./editorial/Onboarding";
import { joinNudgeNames, NUDGE_MAX_LENGTH } from "./NudgeSheet";

type Kind = "in" | "out";

function Paper({ words, from, tilt }: { words: string; from: string; tilt: number }) {
  return (
    <div style={{ padding: "12px 16px 12px 18px", border: `1px solid ${E.color.hairline}`, borderLeft: `5px solid ${E.color.accent}`, transform: `rotate(${tilt}deg)`, fontFamily: E.font.display, fontStyle: "italic", fontSize: 16, lineHeight: 1.4, color: E.color.ink }}>
      {words}
      <div style={{ ...E.type.label10, fontStyle: "normal", color: E.color.inkMuted, marginTop: 6 }}>— {from}</div>
    </div>
  );
}

export default function NudgeAnswerSheet({ nudges, userId, mobile = false, onClose, onAnswered, onLeftRoom }: {
  /** One room's unanswered nudges to the viewer (oldest first). */
  nudges: PendingNudge[];
  userId: string;
  mobile?: boolean;
  /** Closed without answering ("Later"). */
  onClose: () => void;
  /** After the answer landed (either kind). */
  onAnswered?: (kind: Kind) => void;
  /** After "I'll sit out the rest" left the room — the page decides where to go. */
  onLeftRoom?: () => void;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Kind | null>(null);

  const first = nudges[0];
  const nudgers = [...new Map(nudges.map((n) => [n.senderId, n.senderName])).entries()];
  const names = joinNudgeNames(nudgers.map(([, name]) => name));
  const several = nudgers.length > 1;
  const trimmed = text.trim();
  const canSend = !!kind && trimmed.length > 0 && trimmed.length <= NUDGE_MAX_LENGTH && !busy && !done;

  function later() {
    if (!done) markNudgesSeen(first.groupId);
    onClose();
  }

  async function send() {
    if (!canSend || !kind) return;
    setBusy(true); setError(null);
    // One answer to every nudger in the room, each with the nudges of theirs it answers.
    const results = await Promise.all(nudgers.map(([senderId]) => sendMessage({
      templateType: "nudge_reply", recipientId: senderId, groupId: first.groupId, message: trimmed, replyKind: kind,
      replyTo: nudges.filter((n) => n.senderId === senderId).map((n) => n.id),
    }).catch(() => ({ ok: false as const, error: "network" }))));
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      setBusy(false);
      setError((failed[0] as { message?: string }).message || "Couldn’t send. Try again?");
      return;
    }
    if (kind === "out") {
      try {
        if (first.parentGroupId) {
          await setGroupShowPass(first.parentGroupId, first.showId, userId, "out");
          await setShowVote(first.parentGroupId, first.showId, false);
        }
        await leaveShowRoom(first.groupId);
      } catch (e) {
        console.error("[nudge-answer] sit out failed", e);
        setBusy(false);
        setError("Your answer went out, but leaving the room didn’t work. Try again from the room’s settings.");
        return;
      }
    }
    setBusy(false);
    setDone(kind);
    onAnswered?.(kind);
    window.setTimeout(() => { onClose(); if (kind === "out") onLeftRoom?.(); }, 900);
  }

  const seg = (k: Kind, label: string, side: "left" | "right") => {
    const on = kind === k;
    return (
      <button type="button" aria-pressed={on} onClick={() => { setKind(k); setError(null); }} style={{ flex: 1, height: 48, border: `1px solid ${on ? E.color.accent : E.color.ink}`, ...(side === "right" && !on ? { borderLeft: 0 } : {}), background: on ? E.color.accent : "transparent", color: E.color.ink, ...E.type.tab14, fontSize: 13, cursor: "pointer" }}>{label}</button>
    );
  };

  const body = done ? (
    <div style={{ padding: "28px 0", textAlign: "center", fontFamily: E.font.display, fontWeight: 700, fontSize: 22, color: E.color.ink }}>
      {done === "in" ? `Sent to ${names}.` : `You’re out of this room. ${names} ${several ? "get" : "gets"} your words.`}
    </div>
  ) : (
    <>
      <div style={{ ...E.type.label11, color: E.color.inkMuted, marginTop: mobile ? 8 : 10 }}>{first.showName}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
        {nudges.map((n, i) => <Paper key={n.id} words={n.message ?? ""} from={n.senderName.toUpperCase()} tilt={i % 2 === 0 ? -1.5 : 1} />)}
      </div>
      <div style={{ ...E.type.label11, color: E.color.ink, marginTop: 22 }}>Your answer</div>
      <div style={{ display: "flex", marginTop: 10 }}>
        {seg("in", "I’m still in", "left")}
        {seg("out", "I’ll sit out the rest", "right")}
      </div>
      {kind && (
        <>
          <label htmlFor="nudge-answer" style={{ ...E.type.label11, color: E.color.ink, display: "block", marginTop: 22 }}>Say something back</label>
          <textarea
            id="nudge-answer"
            autoFocus
            value={text}
            onChange={(e) => { setText(e.target.value.slice(0, NUDGE_MAX_LENGTH)); if (error) setError(null); }}
            rows={3}
            style={{ display: "block", width: "100%", marginTop: 8, height: 96, boxSizing: "border-box", padding: 12, border: `1px solid ${E.color.ink}`, background: E.color.cream, color: E.color.ink, fontFamily: E.font.display, fontSize: 16, lineHeight: 1.5, resize: "none", outline: "none", borderRadius: 0 }}
          />
          <div style={{ ...E.type.note13, color: E.color.inkMuted, marginTop: 10 }}>
            {kind === "in"
              ? `Nothing changes in the room.${several ? " Both of them get your answer." : ""}`
              : `You’ll leave the ${first.showName} room. Your letters stay, and everyone else keeps going.`}
          </div>
        </>
      )}
      {error && <div style={{ ...E.type.note13, color: E.color.alert, marginTop: 14 }}>{error}</div>}
      <Block onClick={send} disabled={!canSend} style={{ height: 54, marginTop: 24 }}>
        {busy ? <>Sending<LoadingDots /></> : kind === "out" ? `Sit out and tell ${several ? "both" : names} →` : `Send to ${several ? "both" : names} →`}
      </Block>
    </>
  );

  const title = `${names} nudged you`;
  if (mobile) return <BottomSheet onClose={later} title={title} maxHeight="90dvh">{body}</BottomSheet>;
  return (
    <EditorialDialog onClose={later} width={460} label={title} align="left">
      <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: 28, lineHeight: 1.1, color: E.color.ink, paddingRight: 28 }}>{title}</div>
      {body}
    </EditorialDialog>
  );
}

/** The nudger's side: an answer came back. One act clears it. */
export function NudgeReplySheet({ replies, mobile = false, onClose }: { replies: PendingNudge[]; mobile?: boolean; onClose: () => void }) {
  const first = replies[0];
  async function gotIt() {
    await Promise.all(replies.map((r) => dismissPing(r.id).catch(() => false)));
    onClose();
  }
  const line = (r: PendingNudge) => (r.replyKind === "out" ? `${r.senderName} is sitting out the rest.` : `${r.senderName} is still in.`);
  const title = replies.length === 1 ? line(first) : `${joinNudgeNames(replies.map((r) => r.senderName))} answered your nudge`;
  const body = (
    <>
      <div style={{ ...E.type.label11, color: E.color.inkMuted, marginTop: mobile ? 8 : 10 }}>{first.showName}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
        {replies.map((r, i) => (
          <div key={r.id}>
            {replies.length > 1 && <div style={{ ...E.type.body15, color: E.color.ink, marginBottom: 8 }}>{line(r)}</div>}
            <Paper words={r.message ?? ""} from={r.senderName.toUpperCase()} tilt={i % 2 === 0 ? -1.5 : 1} />
          </div>
        ))}
      </div>
      <Block onClick={gotIt} style={{ height: 54, marginTop: 28 }}>Got it</Block>
    </>
  );
  if (mobile) return <BottomSheet onClose={onClose} title={title}>{body}</BottomSheet>;
  return (
    <EditorialDialog onClose={onClose} width={460} label={title} align="left">
      <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: 26, lineHeight: 1.15, color: E.color.ink, paddingRight: 28 }}>{title}</div>
      {body}
    </EditorialDialog>
  );
}
