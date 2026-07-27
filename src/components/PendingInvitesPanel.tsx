/**
 * PendingInvitesPanel — the group-room gear's "Pending invites" section
 * (pending-invites changeset CP2). Shared by both platforms; the parent
 * gear (desktop yellowCard / mobile sheet) provides the shell + the invite
 * list and re-fetches via onRefresh after an action.
 *
 * Per invite: who (typed name, email beneath) · age ("invited 3 days ago")
 * · NUDGE (reveals an editable prefilled textarea — hidden by default so a
 * multi-invite room isn't a wall of boxes; sending emails the inviter's
 * text and resets the invite's silence clock + renews the link) · RESCIND
 * (one inline confirm — it kills the invitee's link).
 *
 * Actions are ALWAYS available; the 3-day staleness threshold drives only
 * the signal layer (the gear dot + the encouragement line at the top of
 * this panel + the desktop tooltip).
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

/** "today" / "yesterday" / "N days ago" — shared with the cluster-avatar
 *  tooltips (help-system arc CP2). */
export function inviteAgePhrase(createdAt: number): string {
  const days = Math.floor((Date.now() - createdAt) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function ageLine(createdAt: number): string {
  return `invited ${inviteAgePhrase(createdAt)}`;
}

/** A co-member's pending invite, display-only (no token → no actions; who
 *  invited them is deliberately not shown — QA round 1). */
export type OtherPendingInvite = { name: string; createdAt: number | null };

function inviteeLabel(inv: MyPendingInvite): string {
  return inv.name || inv.email.split("@")[0];
}

export default function PendingInvitesPanel({ invites, others = [], onRefresh }: {
  invites: MyPendingInvite[];
  /** Co-members' pending invites (help-system arc CP2) — status only, no
   *  nudge/rescind (those need the creator's own token-bearing read). */
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
        <div style={{ color: CANON.cream, fontSize: 12, fontWeight: 700, lineHeight: 1.5, marginBottom: 12 }}>
          {preventLastWordOrphan(`${staleInviteLine(staleCount)} A nudge might be all they need.`)}
        </div>
      )}
      {/* Grid of info (QA round 1): aligned columns — who · when · actions
          (own invites) or status (co-members' invites). Nudge/rescind
          expansions span the full row beneath. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", columnGap: 12, rowGap: 12, alignItems: "baseline" }}>
        {invites.map((inv) => (
          <React.Fragment key={inv.token}>
            <div style={{ minWidth: 0 }}>
              <span style={{ color: CANON.cream, fontSize: 13, fontWeight: 700 }}>{inviteeLabel(inv)}</span>
              {inv.name && (
                <div style={{ color: CANON.cream, fontSize: 11, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.email}</div>
              )}
            </div>
            <span style={ageCell}>{ageLine(inv.createdAt)}</span>
            {sentFor === inv.token ? (
              <span style={{ color: CANON.cream, fontSize: 12, fontWeight: 700 }}>nudge sent!</span>
            ) : (
              <span style={{ display: "flex", gap: 8 }}>
                <button style={rowBtn} onClick={() => (nudgeFor === inv.token ? setNudgeFor(null) : openNudge(inv))}>nudge</button>
                <button style={rowBtn} onClick={() => { setNudgeFor(null); setActionError(null); setRescindFor(rescindFor === inv.token ? null : inv.token); }}>rescind</button>
              </span>
            )}

            {nudgeFor === inv.token && (
              <div style={{ gridColumn: "1 / -1" }}>
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
              <div style={{ gridColumn: "1 / -1" }}>
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
          </React.Fragment>
        ))}
        {others.map((inv, i) => (
          <React.Fragment key={`o${i}`}>
            <span style={{ color: CANON.cream, fontSize: 13, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.name || "A friend"}</span>
            <span style={ageCell}>{inv.createdAt != null ? ageLine(inv.createdAt) : ""}</span>
            <span style={{ color: CANON.cream, fontSize: 11, opacity: 0.75 }}>hasn&rsquo;t joined yet</span>
          </React.Fragment>
        ))}
      </div>
      {actionError && (
        <div style={{ color: CANON.cream, fontSize: 12, fontWeight: 700, lineHeight: 1.4 }}>{actionError}</div>
      )}
    </div>
  );
}

// Sits on the accent-yellow gear card/sheet: cream text + cream outlines.
const ageCell: React.CSSProperties = {
  color: CANON.cream, fontSize: 11, opacity: 0.8, whiteSpace: "nowrap",
};
const rowBtn: React.CSSProperties = {
  border: `2px solid ${CANON.cream}`, background: "transparent", color: CANON.cream,
  fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 12,
  padding: "5px 14px", borderRadius: 65, cursor: "pointer", flexShrink: 0,
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
