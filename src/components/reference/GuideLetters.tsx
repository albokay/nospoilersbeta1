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

/** The writing box's explanation (his copy, 11-01). */
export function writeContext(showName: string): string {
  return `This is a way to have conversations about shows you’ve already watched without having to start a room for it. Friends who’ve watched this far can open it from their own show guide and write back. Friends who haven’t will only hear that you wrote about ${showName}.`;
}
/** Join the conversation's explanation (his copy, 11-01). */
export function joinContext(writers: string, showName: string): string {
  return `${writers} wrote about ${showName}. What’s your take? (Writing here is a way to have conversations about things you’ve already watched without having to start a room for it.)`;
}

/** The room's Write a letter block (ShowRoom's WriteBlock, as a style). */
const JOIN_BLOCK: React.CSSProperties = { ...E.type.button16, height: 56, background: E.color.ink, color: E.color.cream, border: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" };

/** Follow an anchor on scroll (any scroller — the room pages scroll inside a
 *  fixed container) and resize, as the note writer does. */
function useAnchorRect(anchorEl: HTMLElement | null | undefined): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(anchorEl ? anchorEl.getBoundingClientRect() : null);
  useEffect(() => {
    if (!anchorEl) { setRect(null); return; }
    setRect(anchorEl.getBoundingClientRect());
    let raf = 0;
    const follow = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setRect(anchorEl.getBoundingClientRect())); };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow); };
  }, [anchorEl]);
  return rect;
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
export function GuideWriter({ mobile, title, epLine, context, anchorEl, onClose, onSave }: {
  mobile: boolean;
  title: string;
  epLine: string;
  context: string;
  anchorEl?: HTMLElement | null;
  onClose: () => void;
  onSave: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const rect = useAnchorRect(mobile ? null : anchorEl);
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

  // Desktop: under the link, right-aligned to it; above it when the screen
  // runs out below; scrolls inside as a last resort — never off screen.
  if (!rect) return null;
  const vh = window.innerHeight;
  const spaceBelow = vh - rect.bottom - 8 - 12;
  const flipUp = spaceBelow < 420 && rect.top - 8 - 12 > spaceBelow;
  const place: React.CSSProperties = {
    position: "fixed",
    right: Math.max(14, window.innerWidth - rect.right),
    width: Math.min(WRITER_W, window.innerWidth - 28),
    ...(flipUp ? { bottom: vh - rect.top + 8, maxHeight: rect.top - 8 - 12 } : { top: rect.bottom + 8, maxHeight: spaceBelow }),
    overflowY: "auto",
  };
  return createPortal(
    <div ref={boxRef} role="dialog" aria-label={title} style={{ ...place, background: E.color.cream, boxSizing: "border-box", padding: "16px 18px 18px", boxShadow: "0 1px 0 rgba(26,58,74,0.35)", border: `1px solid ${E.color.ink}`, zIndex: 70, fontFamily: E.font.interface, color: E.color.ink }}>
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
    document.body,
  );
}

// ── The reader ────────────────────────────────────────────────────────────
/** The letter-blue dot (the group row's new-letters blue), a little bigger
 *  here (his call): before the read link, and on an unread letter's byline. */
export const UNREAD_DOT: React.CSSProperties = { display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: E.color.identity, flexShrink: 0 };

export function GuideReader({ mobile, letters, nameOf, currentUserId, anchorEl, startAtLast = false, unreadSince, onClose, onDelete, onJoin }: {
  mobile: boolean;
  letters: GuideLetter[];
  nameOf: (userId: string) => string;
  currentUserId: string | null;
  anchorEl?: HTMLElement | null;
  /** The seen stamp from BEFORE this open (undefined = never): a friend's
   *  letter newer than it carries the dot while the reader is open. */
  unreadSince?: string | null;
  /** Open on the newest letter (after you've just written one). */
  startAtLast?: boolean;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onJoin: () => void;
}) {
  const [page, setPage] = useState(startAtLast ? Math.max(0, letters.length - 1) : 0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const rect = useAnchorRect(mobile ? null : anchorEl);
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
          <button type="button" onClick={onJoin} style={{ ...JOIN_BLOCK, width: "100%" }}>Join the conversation</button>
        </div>
      </div>,
      document.body,
    );
  }

  // Desktop: the note paper, centred under the link, below it when there's
  // room (above it otherwise), the act below right of the cards.
  if (!rect) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const width = Math.min(PAPER_W, vw - 24);
  const cx = rect.left + rect.width / 2;
  const left = Math.max(12, Math.min(cx - width / 2, vw - width - 12));
  const ACT_H = 56 + 41;
  const spaceBelow = vh - rect.bottom - 10 - ACT_H;
  const spaceAbove = rect.top - 10 - ACT_H;
  const want = Math.min(520, vh - 24 - ACT_H);
  const below = spaceBelow >= Math.min(want, 320) || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(180, Math.min(want, (below ? spaceBelow : spaceAbove) - 8));
  const place: React.CSSProperties = below ? { top: rect.bottom + 10 } : { bottom: vh - rect.top + 10 };
  const i = Math.min(page, letters.length - 1);
  const l = letters[i];
  const prev = i > 0 ? letters[i - 1] : null;
  const next = i < letters.length - 1 ? letters[i + 1] : null;

  return createPortal(
    <div ref={paperRef} style={{ position: "fixed", left, width, ...place, zIndex: 9999, display: "flex", flexDirection: "column", fontFamily: E.font.interface, color: E.color.ink }}>
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
        <button type="button" onClick={onJoin} style={{ ...JOIN_BLOCK, width: 240 }}>Join the conversation</button>
      </div>
    </div>,
    document.body,
  );
}
