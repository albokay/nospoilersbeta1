/**
 * AddFriendsDialog — add friends to an EXISTING group from a show room (his
 * ask, 11-03): the group room's own invite dialog, lifted out so the room's
 * "+" at the end of the With line can open it. The same form pieces, the
 * same mint-a-link-then-email per row (each row awaits its own email leg so
 * a silent refusal surfaces as a copy-the-link row), the same sent card.
 * The dashboard's group room still runs its own copy of this flow inside
 * DashboardPage (`sendInvites`); keep the two in step.
 */
import React, { useState } from "react";
import { E } from "../../styles/editorial";
import { createPeopleGroupInvite, sendGroupInviteEmail } from "../../lib/db";
import { FORM_CSS, FriendRows, Block } from "./Onboarding";
import { InviteDialog, InvitesSentBody, type SentRow } from "./Invite";
import LoadingDots from "../LoadingDots";

export default function AddFriendsDialog({ groupId, onClose, onSent }: { groupId: string; onClose: () => void; onSent?: () => void }) {
  const [rows, setRows] = useState<{ name: string; email: string }[]>([{ name: "", email: "" }]);
  const [sending, setSending] = useState(false);
  const [links, setLinks] = useState<SentRow[] | null>(null);
  const filled = rows.filter((r) => r.email.trim() || r.name.trim());
  const complete = filled.filter((r) => r.email.includes("@"));
  const ready = complete.length >= 1 && complete.length === filled.length;

  async function send() {
    if (sending || !ready) return;
    const list = rows.map((r) => ({ name: r.name.trim(), email: r.email.trim() })).filter((r) => r.email);
    setSending(true);
    try {
      const out = await Promise.all(list.map(async (row): Promise<SentRow> => {
        try {
          const token = await createPeopleGroupInvite(groupId, row.email, row.name || undefined);
          const sent = await sendGroupInviteEmail(token);
          return { email: row.email, name: row.name || undefined, link: `${window.location.origin}/group-invite/${token}`, emailFailed: !sent.ok };
        } catch (e: any) {
          return { email: row.email, error: e?.message === "group_full" ? "This group is full (8 max)." : "Something went wrong. Please try again." };
        }
      }));
      setLinks(out);
      onSent?.();
    } catch (e) {
      console.error("[room] invites failed", e);
      setLinks([{ email: "", error: "Could not send invites." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <InviteDialog onClose={onClose} label={links ? "Invites sent" : "Invite friends"}>
      {links ? (
        <InvitesSentBody links={links} onDone={onClose} inset={28} />
      ) : (
        <div style={{ padding: "30px 32px 4px" }}>
          <style>{FORM_CSS}</style>
          {/* The heading wraps balanced (his rule): no hand-placed break. */}
          <div style={{ fontFamily: E.font.display, fontWeight: 700, fontSize: 28, lineHeight: 1.15, letterSpacing: "-0.01em", paddingRight: 8, textWrap: "balance" as const }}>
            Connect more friends to this group
          </div>
          <div style={{ marginTop: 28 }}>
            <FriendRows desktop rows={rows} onChange={(i, f, v) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [f]: v } : r)))} onAdd={() => setRows((prev) => [...prev, { name: "", email: "" }])} />
          </div>
          <Block onClick={send} disabled={sending || !ready} style={{ marginTop: 32 }}>
            {sending ? <>sending invite<LoadingDots /></> : "Send invite"}
          </Block>
        </div>
      )}
    </InviteDialog>
  );
}
