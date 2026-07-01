import React, { useEffect, useState } from "react";
import { CirclePlus, Crown, Users, X } from "lucide-react";
import Modal from "../Modal";
import {
  fetchDepartedMembers,
  fetchFriendGroupMembers,
  fetchRoomDigestOptOut,
  fetchSentInvitations,
  recordDepartedMember,
  removeGroupMember,
  renameFriendGroup,
  sendInvite,
  setRoomDigestOptOut,
  softDeleteFriendGroup,
  transferGroupOwnership,
} from "../../lib/db";
import type { FriendGroup, FriendGroupMember, Invitation } from "../../types";
import { useAuth } from "../../lib/auth";
import { maskEmail } from "../../lib/utils";

// V2 friend room settings modal — port of the live ShowSection modal.
//
// Sections:
//   - Members list (current + departed)
//   - Rename (creator only)
//   - Invite by email — up to 5 rows per batch, per-row send/success/error,
//     pending-invites list
//   - Footer: Leave room (left) + OK (right, after any successful invite)
//
// Leave flow has two confirmation modals:
//   - Last member → soft-deletes the room
//   - Other → records departed + transfers ownership if caller is creator
//
// Behavior mirrors the live ShowSection settings modal 1:1; on a successful
// leave the parent's `onLeft` callback fires so the page navigates to
// /v3/journal. On rename, `onRenamed` fires so the page's banner updates.

const MAX_INVITE_ROWS = 5;

type InviteRow = { email: string; status: "idle" | "success" | "error"; errorMsg?: string };

const ERROR_MESSAGES: Record<string, string> = {
  rate_limit:      "You've reached the 10 invitations/day limit. Try again tomorrow.",
  already_invited: "Already invited.",
  not_creator:     "Only the room creator can send invitations.",
  invalid_email:   "Not a valid email address.",
  self_invite:     "You can't invite yourself.",
};

export type V2GroupSettingsModalProps = {
  room: FriendGroup;
  onClose: () => void;
  onLeft: () => void;
  onRenamed: (newName: string) => void;
};

export default function V2GroupSettingsModal({
  room,
  onClose,
  onLeft,
  onRenamed,
}: V2GroupSettingsModalProps) {
  const { user, profile } = useAuth();
  const isCreator = !!user && room.createdBy === user.id;

  const [members, setMembers] = useState<FriendGroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [departed, setDeparted] = useState<{ userId: string; username: string; departedAt: number }[]>([]);

  // Daily digest opt-out for THIS viewer in THIS room (null until loaded).
  // false = digests on (default). Private — only the viewer's own pref is read.
  const [digestOptOut, setDigestOptOut] = useState<boolean | null>(null);
  const [digestSaving, setDigestSaving] = useState(false);

  const [renameValue, setRenameValue] = useState(room.name);
  const [renameSubmitting, setRenameSubmitting] = useState(false);

  const [inviteRows, setInviteRows] = useState<InviteRow[]>([{ email: "", status: "idle" }]);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteBatchError, setInviteBatchError] = useState<string | null>(null);

  const [pendingInvites, setPendingInvites] = useState<Invitation[]>([]);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);

  const [showLeaveModal, setShowLeaveModal] = useState<null | "confirm" | "last-member">(null);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);

  // Boot — load members + departed + (if creator) pending invites in parallel.
  useEffect(() => {
    let cancelled = false;
    setMembersLoading(true);
    fetchFriendGroupMembers(room.id)
      .then((ms) => { if (!cancelled) setMembers(ms); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMembersLoading(false); });
    fetchDepartedMembers(room.id)
      .then((d) => { if (!cancelled) setDeparted(d); })
      .catch(() => { if (!cancelled) setDeparted([]); });
    fetchRoomDigestOptOut(room.id)
      .then((v) => { if (!cancelled) setDigestOptOut(v); })
      .catch(() => { if (!cancelled) setDigestOptOut(null); });
    if (user?.id) {
      setPendingInvitesLoading(true);
      fetchSentInvitations(user.id)
        .then((all) => { if (!cancelled) setPendingInvites(all.filter((i) => i.groupId === room.id)); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setPendingInvitesLoading(false); });
    }
    return () => { cancelled = true; };
  }, [room.id, user?.id]);

  // Optimistic flip of the viewer's own digest preference; revert on failure.
  const toggleDigest = async () => {
    if (digestOptOut === null || digestSaving) return;
    const next = !digestOptOut;
    setDigestOptOut(next);
    setDigestSaving(true);
    try {
      await setRoomDigestOptOut(room.id, next);
    } catch {
      setDigestOptOut(!next);
      alert("Couldn't update your digest setting. Please try again.");
    } finally {
      setDigestSaving(false);
    }
  };

  const handleRename = async () => {
    if (!renameValue.trim() || renameValue.trim() === room.name) return;
    setRenameSubmitting(true);
    try {
      await renameFriendGroup(room.id, renameValue.trim());
      onRenamed(renameValue.trim());
      onClose();
    } catch {
      alert("Failed to rename. Please try again.");
    } finally {
      setRenameSubmitting(false);
    }
  };

  const handleSendInvites = async () => {
    if (!user) return;
    setInviteBatchError(null);

    const callerEmail = user.email?.toLowerCase().trim();
    const seen = new Set<string>();
    const nextRows: InviteRow[] = inviteRows.map((r) => ({ ...r }));
    const indicesToSend: number[] = [];

    for (let i = 0; i < nextRows.length; i++) {
      const row = nextRows[i];
      if (row.status === "success") continue;
      const trimmed = row.email.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (callerEmail && lower === callerEmail) {
        nextRows[i] = { ...row, status: "error", errorMsg: ERROR_MESSAGES.self_invite };
        continue;
      }
      if (seen.has(lower)) {
        nextRows[i] = { ...row, status: "error", errorMsg: "Duplicate email in this batch." };
        continue;
      }
      seen.add(lower);
      nextRows[i] = { ...row, status: "idle", errorMsg: undefined };
      indicesToSend.push(i);
    }

    setInviteRows(nextRows);
    if (indicesToSend.length === 0) return;

    setInviteSubmitting(true);
    try {
      const results = await Promise.allSettled(
        indicesToSend.map((i) =>
          sendInvite({
            groupId: room.id,
            groupName: room.name,
            inviteeEmail: nextRows[i].email.trim(),
            inviterName: profile?.username ?? "Someone",
          }),
        ),
      );

      const finalRows = nextRows.map((r) => ({ ...r }));
      let anySuccess = false;
      let rateLimitedBatch = false;

      results.forEach((res, k) => {
        const idx = indicesToSend[k];
        if (res.status === "fulfilled") {
          if (res.value.ok) {
            finalRows[idx] = { ...finalRows[idx], status: "success", errorMsg: undefined };
            anySuccess = true;
          } else {
            const msg = ERROR_MESSAGES[res.value.error] ?? res.value.message ?? "Failed to send.";
            finalRows[idx] = { ...finalRows[idx], status: "error", errorMsg: msg };
            if (res.value.error === "rate_limit") rateLimitedBatch = true;
          }
        } else {
          finalRows[idx] = { ...finalRows[idx], status: "error", errorMsg: "Failed to send." };
        }
      });

      setInviteRows(finalRows);
      if (rateLimitedBatch) setInviteBatchError(ERROR_MESSAGES.rate_limit);

      if (anySuccess) {
        fetchSentInvitations(user.id)
          .then((all) => setPendingInvites(all.filter((i) => i.groupId === room.id)))
          .catch(() => {});
      }
    } catch {
      setInviteBatchError("Something went wrong. Please try again.");
    } finally {
      setInviteSubmitting(false);
    }
  };

  const addInviteRow = () => {
    setInviteRows((rows) =>
      rows.length >= MAX_INVITE_ROWS ? rows : [...rows, { email: "", status: "idle" }],
    );
  };

  const updateInviteRowEmail = (index: number, email: string) => {
    setInviteRows((rows) =>
      rows.map((r, i) => (i === index ? { email, status: "idle", errorMsg: undefined } : r)),
    );
  };

  const initiateLeaveGroup = () => {
    if (!members.length) return;
    setShowLeaveModal(members.length === 1 ? "last-member" : "confirm");
  };

  const executeLeaveGroup = async () => {
    if (!user || !profile) return;
    setLeaveSubmitting(true);
    try {
      // Creator leaving with others remaining → transfer to oldest other member.
      if (isCreator && members.length > 1) {
        const others = members
          .filter((m) => m.userId !== user.id)
          .sort((a, b) => a.joinedAt - b.joinedAt);
        if (others.length > 0) {
          await transferGroupOwnership(room.id, others[0].userId);
        }
      }
      await recordDepartedMember(room.id, user.id, profile.username);
      await removeGroupMember(room.id, user.id);
      setShowLeaveModal(null);
      onLeft();
    } catch {
      alert("Failed to leave room. Please try again.");
      setLeaveSubmitting(false);
    }
  };

  const executeLastMemberLeave = async () => {
    if (!user) return;
    setLeaveSubmitting(true);
    try {
      await softDeleteFriendGroup(room.id);
      setShowLeaveModal(null);
      onLeft();
    } catch {
      alert("Failed to leave room. Please try again.");
      setLeaveSubmitting(false);
    }
  };

  const totalRows = inviteRows.length;
  const isPlural = totalRows > 1;
  const anyNonEmpty = inviteRows.some((r) => r.email.trim() && r.status !== "success");
  const sendLabel = inviteSubmitting ? "Sending…" : isPlural ? "Send invites" : "Send invite";
  const anyInviteSuccess = inviteRows.some((r) => r.status === "success");

  return (
    <>
      <Modal onClose={onClose} width="min(460px,92vw)">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <h3 className="title" style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Users size={14} color="var(--icon-color)" /> {room.name}
          </h3>
          <button className="close-x" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Members */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.5, marginBottom: 8 }}>
            Members
          </div>
          {membersLoading ? (
            <div className="muted" style={{ fontSize: 13 }}>Loading…</div>
          ) : members.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>No members yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {members.map((m) => (
                <div
                  key={m.userId}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, minHeight: 26 }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    @{m.username}
                    {m.userId === room.createdBy && <Crown size={14} color="var(--icon-color)" />}
                  </span>
                  {m.userId === user?.id && digestOptOut !== null && (
                    <button
                      type="button"
                      onClick={toggleDigest}
                      disabled={digestSaving}
                      title="A daily email listing new entries in this room. Turn off to stop these emails for this room."
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: "transparent",
                        border: "1.5px solid currentColor",
                        borderRadius: 999,
                        color: "inherit",
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 9px",
                        cursor: digestSaving ? "default" : "pointer",
                        opacity: digestSaving ? 0.5 : 0.85,
                        fontFamily: "inherit",
                        whiteSpace: "nowrap",
                      }}
                    >
                      email digest: {digestOptOut ? "off" : "on"}
                    </button>
                  )}
                </div>
              ))}
              {departed.map((d) => (
                <div
                  key={d.userId}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, opacity: 0.5 }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    @{d.username} <em style={{ fontSize: 12 }}>has left the room</em>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rename (creator only) */}
        {isCreator && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.5, marginBottom: 8 }}>
              Rename
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="badge"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
                style={{ flex: 1, height: 36 }}
              />
              <button
                className="btn"
                onClick={handleRename}
                disabled={renameSubmitting || !renameValue.trim()}
                style={{ background: "var(--green)", border: "none", color: "#FEF8EA", whiteSpace: "nowrap" }}
              >
                {renameSubmitting ? "Saving…" : "Rename"}
              </button>
            </div>
          </div>
        )}

        {/* Invite by email (creator only) */}
        {isCreator && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.5, marginBottom: 8 }}>
              Invite by email
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {inviteRows.map((row, i) => {
                const isLast = i === totalRows - 1;
                return (
                  <div key={i}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        className="badge"
                        type="email"
                        placeholder="friend@example.com"
                        value={row.email}
                        onChange={(e) => updateInviteRowEmail(i, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSendInvites(); }}
                        style={{ flex: 1, height: 36 }}
                        disabled={inviteSubmitting || row.status === "success"}
                      />
                      {isLast && (
                        <button
                          className="btn"
                          onClick={handleSendInvites}
                          disabled={inviteSubmitting || !anyNonEmpty}
                          style={{
                            background: "var(--dos-user)",
                            border: "none",
                            color: "#FEF8EA",
                            whiteSpace: "nowrap",
                            minWidth: 120,
                          }}
                        >
                          {sendLabel}
                        </button>
                      )}
                    </div>
                    {row.status === "success" && (
                      <div style={{ fontSize: 12, color: "#FEF8EA", marginTop: 4 }}>
                        ✓ Invite sent.
                      </div>
                    )}
                    {row.status === "error" && row.errorMsg && (
                      <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>
                        {row.errorMsg}
                      </div>
                    )}
                  </div>
                );
              })}
              {totalRows < MAX_INVITE_ROWS && (
                <button
                  type="button"
                  onClick={addInviteRow}
                  disabled={inviteSubmitting}
                  aria-label="Add another email"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#FEF8EA",
                    opacity: 0.85,
                    cursor: "pointer",
                    padding: 4,
                    alignSelf: "flex-start",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontFamily: "inherit",
                  }}
                >
                  <CirclePlus size={18} strokeWidth={2} />
                  <span>Add another</span>
                </button>
              )}
            </div>
            {inviteSubmitting && (
              <div style={{ fontSize: 12, color: "#FEF8EA", marginTop: 6 }} aria-live="polite">
                <span className="invite-dot">.</span>
                <span className="invite-dot">.</span>
                <span className="invite-dot">.</span>
              </div>
            )}
            {inviteBatchError && (
              <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 6 }}>{inviteBatchError}</div>
            )}

            {(pendingInvitesLoading || pendingInvites.length > 0) && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.4, marginBottom: 6 }}>
                  Pending invites
                </div>
                {pendingInvitesLoading ? (
                  <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {pendingInvites.map((inv) => (
                      <div
                        key={inv.id}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, opacity: 0.7 }}
                      >
                        <span>{maskEmail(inv.inviteeEmail)}</span>
                        <span style={{ opacity: 0.5, fontSize: 11 }}>
                          expires {new Date(inv.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <button
            className="btn"
            onClick={initiateLeaveGroup}
            style={{ background: "var(--danger)", border: "none", color: "#FEF8EA", minWidth: 120 }}
          >
            Leave room
          </button>
          {anyInviteSuccess && (
            <button
              className="btn"
              onClick={onClose}
              style={{ background: "transparent", border: "2px solid #FEF8EA", color: "#FEF8EA", minWidth: 120 }}
            >
              OK
            </button>
          )}
        </div>
      </Modal>

      {/* Leave confirm — N-member */}
      {showLeaveModal === "confirm" && (
        <Modal onClose={() => setShowLeaveModal(null)} width="min(420px,90vw)">
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <h3 className="title" style={{ margin: "0 0 16px", fontSize: 18 }}>Are you sure?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, margin: "0 0 24px" }}>
              You will no longer be able to see your own writing in this room. (Everything will remain intact in case you rejoin later.)
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
              <button
                className="btn"
                onClick={executeLeaveGroup}
                disabled={leaveSubmitting}
                style={{ background: "var(--danger)", border: "none", color: "#FEF8EA" }}
              >
                {leaveSubmitting ? "Leaving…" : "Leave the room"}
              </button>
              <button
                className="btn"
                onClick={() => setShowLeaveModal(null)}
                style={{ background: "var(--green)", border: "none", color: "#FEF8EA" }}
              >
                I'll stay
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Leave confirm — last member */}
      {showLeaveModal === "last-member" && (
        <Modal onClose={() => setShowLeaveModal(null)} width="min(420px,90vw)">
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <h3 className="title" style={{ margin: "0 0 16px", fontSize: 18 }}>Are you sure?</h3>
            <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, margin: "0 0 24px" }}>
              You're the last one in here. Leaving now means deleting the room.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
              <button
                className="btn"
                onClick={executeLastMemberLeave}
                disabled={leaveSubmitting}
                style={{ background: "var(--danger)", border: "none", color: "#FEF8EA" }}
              >
                {leaveSubmitting ? "Leaving…" : "Delete and leave"}
              </button>
              <button
                className="btn"
                onClick={() => setShowLeaveModal(null)}
                style={{ background: "var(--green)", border: "none", color: "#FEF8EA" }}
              >
                I'll stay
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
