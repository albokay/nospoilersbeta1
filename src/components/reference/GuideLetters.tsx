// GuideLetters — open letters in the show guide (2026-11-01, CP2 of 5; his
// canvas Xr3VouchYG1suwyrNDzca1, boards OL-*). A letter on an episode written
// FROM the guide, outside any room: the writer's box and the reader float over
// the page the way the room's note writer and note card do.
//
//   GuideWriter — desktop: the note writer's card made bigger (420 wide, a
//     nine-line field), fixed under the link it opened from, right-aligned to
//     it, no veil, click-outside / Escape to leave. Phone: the note drawer,
//     veiled, the page live behind it.
//   GuideReader — desktop: the note paper, fixed and centred under the read
//     link, tilted, a second card peeking when there's more than one, the
//     pager "← Name · 1 of 2 · Name →"; below right, on every page, the one
//     act: "Join the conversation" (the room's Write a letter block). Phone:
//     the notes overlay — every letter stacked over the dimmed page, the act
//     floating by itself at the bottom.
//
// Every letter is its own card (his 11-01 call: no replies — you answer a
// letter by writing a letter). Who can read what is the database's rule.

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { E } from "../../styles/editorial";
import { timeAgo } from "../../lib/utils";
import { paperStyle, NOTE_BYLINE, NOTE_TEXT, NOTE_FIELD, MONO_WORD, INK_SMALL, FRAME_SMALL } from "../editorial/MapNotes";
import { NoteDrawer } from "../v2/HighlightSheets";
import type { GuideLetter } from "../../lib/db";

export const LETTER_MAX = 1000;
const TEXT_MUTED = "#5f5e5a";
const WRITER_W = 420;
const PAPER_W = 400;
const PAPER_TILT = 2.5;

/** The writing box's explanation (his copy, 11-02: the audience is every
 *  friend across every watch group — the thing a writer inside a room must
 *  not mistake). */
const HOW_IT_WORKS = "Writing from the show guide pings your friends across all your watch groups. This is a way to write about shows you’ve already watched without opening a new room — any friend, in all your groups who has also watched this show can read and write back.";
export function writeContext(_showName: string): string {
  return HOW_IT_WORKS;
}
/** Join the conversation's explanation (his copy, 11-02). */
export function joinContext(writers: string, showName: string): string {
  return `${writers} wrote about ${showName}. What’s your take? ${HOW_IT_WORKS}`;
}

/** The room's Write a letter block (ShowRoom's WriteBlock, as a style). */
const JOIN_BLOCK: React.CSSProperties = { ...E.type.button16, height: 56, background: E.color.ink, color: E.color.cream, border: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" };

/** Where a card sits, decided ONCE when it opens (his note, 11-02): inside
 *  the episode's block, so it scrolls with the page and never flips. Below
 *  the link when the screen has room there, above it otherwise; its
 *  height capped to that room, scrolling inside as a last resort. */
type Placement = { left: number; top?: number; bottom?: number; maxHeight: number; width: number; below: boolean };
function placeOnce(anchorEl: HTMLElement | null | undefined, host: HTMLElement | null | undefined, width: number, align: "center" | "right", reserve: number): Placement | null {
  if (!anchorEl || !host) return null;
  const a = anchorEl.getBoundingClientRect(), h = host.getBoundingClientRect();
  const w = Math.min(width, Math.max(240, h.width));
  const rawLeft = align === "center" ? a.left + a.width / 2 - w / 2 : a.right - w;
  const left = Math.max(0, Math.min(rawLeft - h.left, h.width - w));
  const vh = window.innerHeight;
  const spaceBelow = vh - a.bottom - 10 - reserve, spaceAbove = a.top - 10 - reserve;
  const want = Math.min(520, vh - 24 - reserve);
  const below = spaceBelow >= Math.min(want, 320) || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(180, Math.min(want, (below ? spaceBelow : spaceAbove) - 8));
  return below
    ? { left, top: a.bottom - h.top + 10, maxHeight, width: w, below }
    : { left, bottom: h.bottom - a.top + 10, maxHeight, width: w, below };
}

/** Click outside the box (deferred a tick so the opening click doesn't close
 *  it) and Escape both leave. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [ref, onClose, enabled]);
}

// ── The writer ────────────────────────────────────────────────────────────
export function GuideWriter({ mobile, title, epLine, context, anchorEl, host, onClose, onSave }: {
  mobile: boolean;
  title: string;
  epLine: string;
  context: string;
  anchorEl?: HTMLElement | null;
  /** The episode's block the card sits in (desktop). */
  host?: HTMLElement | null;
  onClose: () => void;
  onSave: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [place] = useState<Placement | null>(() => (mobile ? null : placeOnce(anchorEl, host, WRITER_W, "right", 0)));
  useDismiss(boxRef, onClose, !mobile && !saving);
  useEffect(() => { const t = setTimeout(() => fieldRef.current?.focus(), mobile ? 60 : 0); return () => clearTimeout(t); }, [mobile]);

  const canSave = !saving && draft.trim().length > 0;
  async function save() {
    if (!canSave) return;
    setSaving(true); setError(null);
    try { await onSave(draft.trim()); }
    catch (e) { setError((e as { message?: string })?.message ?? "Couldn’t save your letter."); }
    finally { setSaving(false); }
  }

  const head = (
    <>
      <div style={{ ...E.type.letterTitle22, color: E.color.ink, paddingRight: mobile ? 0 : 36 }}>{title}</div>
      <div style={{ ...E.type.label10, color: "rgba(26,58,74,0.7)", marginTop: 8 }}>{epLine}</div>
      <div style={{ ...E.type.note13, lineHeight: 1.5, color: "rgba(26,58,74,0.8)", margin: "8px 0 14px" }}>{context}</div>
    </>
  );

  if (mobile) {
    return (
      <NoteDrawer label={title} dim onClose={onClose} enabled={!saving}>
        {head}
        <textarea ref={fieldRef} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, LETTER_MAX))} maxLength={LETTER_MAX} rows={8} placeholder="Write…" style={NOTE_FIELD} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={save} disabled={!canSave} style={{ ...INK_SMALL, height: 48, padding: "0 20px", opacity: canSave ? 1 : 0.6 }}>{saving ? "Sending…" : "Send"}</button>
          <button type="button" onClick={onClose} disabled={saving} style={{ ...FRAME_SMALL, height: 48, padding: "0 20px" }}>Cancel</button>
          <span style={{ ...E.type.label10, marginLeft: "auto", opacity: 0.8 }}>{draft.length}/{LETTER_MAX}</span>
        </div>
        {error && <div style={{ ...E.type.note13, color: E.color.alert, fontStyle: "italic", marginTop: 8 }}>{error}</div>}
      </NoteDrawer>
    );
  }

  // Desktop: in the episode's block, under the link and right-aligned to
  // it (above it when the screen had no room below), placed once.
  if (!place || !host) return null;
  return createPortal(
    <div ref={boxRef} role="dialog" aria-label={title} style={{ position: "absolute", left: place.left, top: place.top, bottom: place.bottom, width: place.width, maxHeight: place.maxHeight, overflowY: "auto", background: E.color.cream, boxSizing: "border-box", padding: "16px 18px 18px", boxShadow: "0 1px 0 rgba(26,58,74,0.35)", border: `1px solid ${E.color.ink}`, zIndex: 70, fontFamily: E.font.interface, color: E.color.ink }}>
      <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 6, right: 8, background: "transparent", border: "none", width: 36, height: 36, padding: 0, color: TEXT_MUTED, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={16} /></button>
      {head}
      <textarea ref={fieldRef} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, LETTER_MAX))} maxLength={LETTER_MAX} rows={9} placeholder="Write…" style={NOTE_FIELD} />
      <div style={{ textAlign: "right", marginTop: 4, fontSize: 11, color: TEXT_MUTED, marginBottom: 12 }}>{draft.length}/{LETTER_MAX}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexDirection: "row-reverse", justifyContent: "flex-start" }}>
        <button type="button" onClick={save} disabled={!canSave} style={{ ...INK_SMALL, opacity: canSave ? 1 : 0.6, cursor: canSave ? "pointer" : "not-allowed" }}>{saving ? "Sending…" : "Send"}</button>
        <button type="button" onClick={onClose} disabled={saving} style={{ ...MONO_WORD, padding: "0 10px", height: 34 }}>Cancel</button>
        {error && <span style={{ ...E.type.note13, color: E.color.alert, fontStyle: "italic", marginRight: "auto" }}>{error}</span>}
      </div>
    </div>,
    host,
  );
}

// ── The reader ────────────────────────────────────────────────────────────
/** The letter-blue dot (the group row's new-letters blue), a little bigger
 *  here (his call): before the read link, and on an unread letter's byline. */
export const UNREAD_DOT: React.CSSProperties = { display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: E.color.identity, flexShrink: 0 };

export function GuideReader({ mobile, letters, nameOf, currentUserId, anchorEl, host, startAtLast = false, unreadSince, joinLabel = "Join the conversation", onClose, onDelete, onJoin }: {
  mobile: boolean;
  letters: GuideLetter[];
  nameOf: (userId: string) => string;
  currentUserId: string | null;
  anchorEl?: HTMLElement | null;
  /** The episode's block the card sits in (desktop). */
  host?: HTMLElement | null;
  /** The seen stamp from BEFORE this open (undefined = never): a friend's
   *  letter newer than it carries the dot while the reader is open. */
  unreadSince?: string | null;
  /** Open on the newest letter (after you've just written one). */
  startAtLast?: boolean;
  /** "Join the conversation" once a friend has written; "Write another
   *  letter" while every letter here is yours (his note, 11-02). */
  joinLabel?: string;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onJoin: () => void;
}) {
  const [page, setPage] = useState(startAtLast ? Math.max(0, letters.length - 1) : 0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const [place] = useState<Placement | null>(() => (mobile ? null : placeOnce(anchorEl, host, PAPER_W, "center", 56 + 41)));
  useDismiss(paperRef, onClose, !mobile);
  useEffect(() => { if (letters.length === 0) onClose(); }, [letters.length, onClose]);

  const isUnread = (l: GuideLetter) => !!currentUserId && l.userId !== currentUserId && (unreadSince == null || Date.parse(l.createdAt) > Date.parse(unreadSince));
  const byline = (l: GuideLetter) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {isUnread(l) && <span aria-label="New" style={UNREAD_DOT} />}
      <span style={NOTE_BYLINE}>{nameOf(l.userId)} · S{l.season} E{l.episode} · {timeAgo(new Date(l.createdAt).getTime())}</span>
    </div>
  );
  async function del(id: string) {
    if (busy) return;
    setBusy(true);
    try { await onDelete(id); setConfirmId(null); setPage((p) => Math.max(0, Math.min(p, letters.length - 2))); }
    finally { setBusy(false); }
  }
  const deleteRow = (l: GuideLetter) => {
    if (!currentUserId || l.userId !== currentUserId) return null;
    return (
      <div style={{ display: "flex", justifyContent: "center", gap: 12, alignItems: "center", marginTop: 4 }}>
        {confirmId === l.id
          ? <>
              <span style={{ ...E.type.label10, color: E.color.inkMuted }}>Delete this letter?</span>
              <button type="button" onClick={() => del(l.id)} disabled={busy} style={{ ...MONO_WORD, color: E.color.alert, textDecoration: "underline" }}>{busy ? "Deleting…" : "Yes"}</button>
              <button type="button" onClick={() => setConfirmId(null)} disabled={busy} style={MONO_WORD}>No</button>
            </>
          : <button type="button" onClick={() => setConfirmId(l.id)} style={{ ...MONO_WORD, color: E.color.alert, textDecoration: "underline" }}>Delete</button>}
      </div>
    );
  };

  if (letters.length === 0) return null;

  if (mobile) {
    // The notes overlay: the papers fill from the bottom up until they
    // overflow, then scroll; a tap on the gap closes; the act floats alone
    // at the bottom, so it answers the whole thread, not one letter.
    return createPortal(
      <div style={{ position: "fixed", inset: 0, background: E.color.veil, zIndex: 1200 }} onClick={onClose}>
        <div role="dialog" aria-label="Letters on this episode" style={{ position: "fixed", inset: 0, overflowY: "auto", fontFamily: E.font.interface }}
          onClick={(e) => { e.stopPropagation(); const t = e.target as HTMLElement; if (t === e.currentTarget || t.dataset.floatGap === "1") onClose(); }}>
          <div data-float-gap="1" style={{ minHeight: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "12vh 16px calc(env(safe-area-inset-bottom, 0px) + 112px)" }}>
            {letters.map((l, i) => (
              <div key={l.id} style={paperStyle(i % 2 === 0 ? -1.5 : 1.2, { margin: "0 4px 14px" })}>
                {byline(l)}
                <div style={NOTE_TEXT}>{l.body}</div>
                {deleteRow(l)}
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: "fixed", left: E.space.gutter, right: E.space.gutter, bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)", zIndex: 1201 }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={onJoin} style={{ ...JOIN_BLOCK, width: "100%" }}>{joinLabel}</button>
        </div>
      </div>,
      document.body,
    );
  }

  // Desktop: the note paper in the episode's block, centred under the link
  // (above it when the screen had no room below), placed once; the act
  // below right of the cards.
  if (!place || !host) return null;
  const { width, maxHeight, below } = place;
  const i = Math.min(page, letters.length - 1);
  const l = letters[i];
  const prev = i > 0 ? letters[i - 1] : null;
  const next = i < letters.length - 1 ? letters[i + 1] : null;

  return createPortal(
    <div ref={paperRef} style={{ position: "absolute", left: place.left, top: place.top, bottom: place.bottom, width, zIndex: 70, display: "flex", flexDirection: "column", fontFamily: E.font.interface, color: E.color.ink }}>
      <div style={{ position: "relative", transform: `rotate(${PAPER_TILT}deg)`, transformOrigin: below ? "top center" : "bottom center", maxHeight, display: "flex", flexDirection: "column" }}>
        {letters.length > 1 && (
          <div aria-hidden style={{ position: "absolute", left: 7, top: 9, right: -7, bottom: -9, background: E.color.cream, boxShadow: "0 1px 0 rgba(26,58,74,0.35)", border: `1px solid ${E.color.ink}`, transform: "rotate(1.6deg)", transformOrigin: "bottom center" }} />
        )}
        <div role="dialog" aria-label={`Letter from ${nameOf(l.userId)}`} style={{ position: "relative", zIndex: 1, minHeight: 0, maxHeight: "inherit", boxSizing: "border-box", background: E.color.cream, boxShadow: "0 1px 0 rgba(26,58,74,0.35)", border: `1px solid ${E.color.ink}`, padding: "14px 16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {byline(l)}
          <div style={{ ...NOTE_TEXT, marginTop: 0, overflowY: "auto", minHeight: 0 }}>{l.body}</div>
          {deleteRow(l)}
          {(prev || next) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", marginTop: 2 }}>
              <span style={{ justifySelf: "start" }}>{prev && <button type="button" onClick={() => { setPage(i - 1); setConfirmId(null); }} style={MONO_WORD}>← {nameOf(prev.userId)}</button>}</span>
              <span style={{ ...E.type.label10, justifySelf: "center", opacity: 0.6 }}>{i + 1} of {letters.length}</span>
              <span style={{ justifySelf: "end" }}>{next && <button type="button" onClick={() => { setPage(i + 1); setConfirmId(null); }} style={MONO_WORD}>{nameOf(next.userId)} →</button>}</span>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 41 }}>
        <button type="button" onClick={onJoin} style={{ ...JOIN_BLOCK, width: 240 }}>{joinLabel}</button>
      </div>
    </div>,
    host,
  );
}
