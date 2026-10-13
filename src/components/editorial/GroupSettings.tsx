/**
 * GroupSettings.tsx — the phone's group settings sheet (Alborz's notes,
 * round 5): one sheet for the group room's gear AND the dashboard row's
 * swipe. Group name with Save beside it, your names for your friends, the
 * pending invites (nudge / rescind), Leave this group. The host owns the
 * state and every save; this is the drawing.
 */
import React from "react";
import { E } from "../../styles/editorial";
import { SectionHead } from "./Chrome";
import { Field, Block, Frame, FORM_CSS } from "./Onboarding";
import { BottomSheet } from "./Overlays";
import PendingInvitesPanel, { type OtherPendingInvite } from "../PendingInvitesPanel";
import type { MyPendingInvite } from "../../lib/db";

export function GroupSettingsSheet({ groupName, renameValue, onRenameChange, onRename, others, contactEdits, onContactEdit, onSaveNames, contactsSaving, myInvites, othersPending, onRefreshInvites, onLeave, onClose }: {
  groupName: string;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRename: () => void;
  others: { userId: string; username: string; displayName: string | null }[];
  contactEdits: Record<string, string>;
  onContactEdit: (userId: string, v: string) => void;
  onSaveNames: () => void;
  contactsSaving: boolean;
  myInvites: MyPendingInvite[];
  othersPending: OtherPendingInvite[];
  onRefreshInvites: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet onClose={onClose} title="Group settings" caption={groupName}>
      <style>{FORM_CSS}</style>
      <SectionHead>Group name</SectionHead>
      <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
        <Field label="Name" value={renameValue} onChange={onRenameChange} placeholder="" style={{ flex: 1, minWidth: 0 }} />
        <Block onClick={onRename} style={{ width: "auto", height: 44, padding: "0 18px", ...E.type.label11, flexShrink: 0 }}>Save</Block>
      </div>
      {(others.length > 0 || myInvites.length > 0 || othersPending.length > 0) && (
        <>
          <SectionHead style={{ marginTop: 28 }}>Your names for your friends</SectionHead>
          {others.length > 0 && <div style={{ ...E.type.note13, color: E.color.inkSub, marginTop: 10 }}>Names default to your friends&rsquo; log-in info. Enter your own names for them, like your phone&rsquo;s contacts.</div>}
          {others.map((m) => (
            <Field key={m.userId} label={m.displayName ?? m.username} value={contactEdits[m.userId] ?? ""} onChange={(v) => onContactEdit(m.userId, v)} placeholder="" maxLength={40} style={{ marginTop: 14 }} />
          ))}
          <div style={{ marginTop: 14 }}><PendingInvitesPanel invites={myInvites} others={othersPending} onRefresh={onRefreshInvites} /></div>
          {others.length > 0 && <Block onClick={onSaveNames} disabled={contactsSaving} style={{ marginTop: 14, height: 48, ...E.type.label11 }}>{contactsSaving ? "saving…" : "Save names"}</Block>}
        </>
      )}
      <SectionHead style={{ marginTop: 28, color: E.color.alert, borderBottomColor: E.color.alert }}>Leave this group</SectionHead>
      <div style={{ ...E.type.note13, color: E.color.inkSub, marginTop: 10 }}>You can join again if someone sends you another invite.</div>
      <Frame onClick={onLeave} style={{ marginTop: 14, height: 48, ...E.type.label11, color: E.color.alert, borderColor: E.color.alert }}>Leave group</Frame>
    </BottomSheet>
  );
}
