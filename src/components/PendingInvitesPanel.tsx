/**
 * PendingInvitesPanel — pending-invite rows, rendered INSIDE the contact-
 * list card (help-system QA round 3 — the separate "Pending invites:" box
 * is gone; pending friends appear as cream field rows in the contacts
 * list, matching the rename inputs).
 *
 * Per pending friend: a field row with their name. Right side: the
 * viewer's OWN invites get in-field NUDGE / RESCIND buttons (accent
 * outline, cream fill, accent text; clicking expands below the field);
 * co-members' invites get an italic "(invite pending)". No invite-age
 * shown (QA round 3 dropped it; `inviteAgePhrase` stays exported for the
 * cluster-avatar tooltips). Pending names are display-only for now —
 * per-viewer renaming of a not-yet-joined friend needs new storage
 * (flagged to Alborz).
 *
 * Nudge = same-channel email with editable prefilled text (resets the
 * invite's silence clock + renews the link). Rescind = one inline confirm,
 * kills the link. The 3-day staleness threshold drives only the signal
 * layer (gear dot + tooltip + the encouragement line at the top).
 */
import React, { useState } from "react";
import {
  sendGroupInviteNudge, rescindPeopleGroupInvite, type MyPendingInvite,
} from "../lib/db";
import { CANON } from "../styles/canon";
import { preventLastWordOrphan } from "../lib/utils";

export const INVITE_STALE_MS = 3 * 86400 * 1000;

/** Silent for 3+ days (no nudge, not accepted) → stale. */
export function isInviteStale(inv: MyPendingInvite): boolean {
  return Date.now() - Math.max(inv.createdAt, inv.lastNudgedAt ?? 0) > INVITE_STALE_MS;
}

/** The generalized stale line (tooltip + panel), singular-safe. */
export function staleInviteLine(n: number): string {
  return n === 1 ? "1 friend hasn't joined yet." : `${n} friends haven't joined yet.`;
}

/** "today" / "yesterday" / "N days ago" — used by the cluster-avatar
 *  tooltips (the panel itself no longer shows invite age). */
export function inviteAgePhrase(createdAt: number): string {
  const days = Math.floor((Date.now() - createdAt) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** A co-member's pending invite, display-only (no token → no actions; who
 *  invited them is deliberately not shown). */
export type OtherPendingInvite = { name: string; createdAt: number | null };

function inviteeLabel(inv: MyPendingInvite): string {
  return inv.name || inv.email.split("@")[0];
}

export default function PendingInvitesPanel({ invites, others = [], onRefresh }: {
  invites: MyPendingInvite[];
  others?: OtherPendingInvite[];
  onRefresh: () => void;
}) {
  const [nudgeFor, setNudgeFor] = useState<string | null>(null); // token
  const [nudgeText, setNudgeText] = useState("");
  const [sending, setSending] = useState(false);
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rescindFor, setRescindFor] = useState<string | null>(null); // token
  const [rescinding, setRescinding] = useState(false);

  const staleCount = invites.filter(isInviteStale).length;

  function openNudge(inv: MyPendingInvite) {
    setActionError(null);
    setRescindFor(null);
    setNudgeFor(inv.token);
    // Prefilled, editable; the invitee's name, no em-dash (spec §3). The
    // join link is NOT part of the text — the email appends it as a button.
    setNudgeText(`Hey ${inviteeLabel(inv)}, I invited you to watch shows on Sidebar, still hoping you'll join.`);
  }

  async function sendNudge(inv: MyPendingInvite) {
    if (sending || !nudgeText.trim()) return;
    setSending(true);
    setActionError(null);
    const res = await sendGroupInviteNudge(inv.token, nudgeText.trim());
    setSending(false);
    if (!res.ok) {
      setActionError(res.reason === "email_send_failed" || !res.reason
        ? "Sidebar couldn't send that just now. Try again in a minute."
        : res.reason);
      return;
    }
    setNudgeFor(null);
    setSentFor(inv.token);
    window.setTimeout(() => setSentFor((prev) => (prev === inv.token ? null : prev)), 2500);
    onRefresh(); // the silence clock reset → the dot clears
  }

  async function doRescind(inv: MyPendingInvite) {
    if (rescinding) return;
    setRescinding(true);
    setActionError(null);
    const res = await rescindPeopleGroupInvite(inv.token);
    setRescinding(false);
    if (!res.ok) {
      setActionError("Couldn't rescind that invite just now. Try again in a minute.");
      return;
    }
    setRescindFor(null);
    onRefresh();
  }

  return (
    <div>
      {staleCount > 0 && (
        <div style={{ color: CANON.cream, fontSize: 12, fontWeight: 700, lineHeight: 1.5, margin: "4px 0 10px" }}>
          {preventLastWordOrphan(`${staleInviteLine(staleCount)} A nudge might be all they need.`)}
        </div>
      )}
      {invites.map((inv) => (
        <div key={inv.token} style={{ marginBottom: 8 }}>
          <div style={fieldRow}>
            <span style={fieldName}>{inviteeLabel(inv)}</span>
            {sentFor === inv.token ? (
              <span style={{ ...pendingNote, opacity: 0.8 }}>nudge sent!</span>
            ) : (
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button style={inFieldBtn} onClick={() => (nudgeFor === inv.token ? setNudgeFor(null) : openNudge(inv))}>nudge</button>
                <button style={inFieldBtn} onClick={() => { setNudgeFor(null); setActionError(null); setRescindFor(rescindFor === inv.token ? null : inv.token); }}>rescind</button>
              </span>
            )}
          </div>

          {nudgeFor === inv.token && (
            <div style={{ margin: "8px 0 4px" }}>
              <textarea
                value={nudgeText}
                onChange={(e) => setNudgeText(e.target.value)}
                rows={3}
                maxLength={500}
                style={nudgeBox}
              />
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6 }}>
                <button style={{ ...rowBtnSolid, opacity: sending || !nudgeText.trim() ? 0.6 : 1 }} disabled={sending || !nudgeText.trim()} onClick={() => sendNudge(inv)}>
                  {sending ? "sending…" : "send nudge"}
                </button>
                <button style={quietBtn} disabled={sending} onClick={() => setNudgeFor(null)}>cancel</button>
              </div>
            </div>
          )}

          {rescindFor === inv.token && (
            <div style={{ margin: "8px 0 4px" }}>
              <div style={{ color: CANON.cream, fontSize: 12, lineHeight: 1.5, marginBottom: 6 }}>
                {preventLastWordOrphan("Rescind this invite? Their link will stop working.")}
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button style={{ ...dangerRowBtn, opacity: rescinding ? 0.6 : 1 }} disabled={rescinding} onClick={() => doRescind(inv)}>
                  {rescinding ? "rescinding…" : "yes, rescind"}
                </button>
                <button style={quietBtn} disabled={rescinding} onClick={() => setRescindFor(null)}>cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {others.map((inv, i) => (
        <div key={`o${i}`} style={{ ...fieldRow, marginBottom: 8 }}>
          <span style={fieldName}>{inv.name || "A friend"}</span>
          <span style={pendingNote}>(invite pending)</span>
        </div>
      ))}
      {actionError && (
        <div style={{ color: CANON.cream, fontSize: 12, fontWeight: 700, lineHeight: 1.4, marginTop: 6 }}>{actionError}</div>
      )}
    </div>
  );
}

// Field rows match the contact-rename inputs they sit among (cream pills).
const fieldRow: React.CSSProperties = {
  background: CANON.cream, borderRadius: 65, boxSizing: "border-box",
  padding: "9px 10px 9px 18px", minHeight: 44,
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
};
// Pending names are uneditable and slightly greyed (Alborz, QA round 3) —
// they read as placeholders until the friend joins and becomes renameable.
const fieldName: React.CSSProperties = {
  color: CANON.dark, opacity: 0.55, fontFamily: '"Inter", sans-serif', fontSize: 14,
  minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const pendingNote: React.CSSProperties = {
  fontStyle: "italic", fontFamily: '"Inter", sans-serif', fontSize: 12,
  color: CANON.dark, opacity: 0.55, whiteSpace: "nowrap", flexShrink: 0, paddingRight: 8,
};
const inFieldBtn: React.CSSProperties = {
  border: `2px solid ${CANON.accent}`, background: CANON.cream, color: CANON.accent,
  fontFamily: '"Inter", sans-serif', fontWeight: 700, fontSize: 12,
  padding: "4px 12px", borderRadius: 65, cursor: "pointer", flexShrink: 0,
};
const rowBtnSolid: React.CSSProperties = {
  border: "none", background: CANON.identity, color: CANON.cream,
  fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 12,
  padding: "7px 16px", borderRadius: 65, cursor: "pointer",
};
const dangerRowBtn: React.CSSProperties = {
  border: `2px solid ${CANON.alert}`, background: "transparent", color: CANON.alert,
  fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 12,
  padding: "6px 16px", borderRadius: 65, cursor: "pointer",
};
const quietBtn: React.CSSProperties = {
  border: "none", background: "transparent", color: CANON.cream,
  fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 12,
  cursor: "pointer", padding: 4,
};
const nudgeBox: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "none", borderRadius: 12,
  padding: "10px 12px", fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.45,
  color: CANON.dark, background: CANON.cream, outline: "none", resize: "vertical",
};
