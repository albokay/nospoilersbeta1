import React, { useEffect, useRef, useState } from "react";
import { Lock, ThumbsUp, X } from "lucide-react";
import type { Highlight } from "../../lib/db";
import { timeAgo } from "../../lib/utils";
import useSheetSwipeDown from "../../lib/useSheetSwipeDown";
import useKeyboardInset from "../../lib/useKeyboardInset";
import { CANON } from "../../styles/canon";
import SidebarAvatar from "../SidebarAvatar";
import { describeStretch, nameOf } from "./HighlightNotePaper";
import { useEditorialScope } from "../../lib/skin";
import { E } from "../../styles/editorial";
import { paperStyle, NOTE_BYLINE, NOTE_TEXT, NOTE_FIELD, MONO_WORD, INK_SMALL, FRAME_SMALL, SealedNoteBody } from "../editorial/MapNotes";

// The phone's two highlight sheets (notes arc, 2026-10-07 — "mobile equally
// well"). Both follow the /m sheet rules: Accent paper, cream text,
// left-justified, swipe-down or tap-outside to dismiss.
//
//   HighlightNoteSheet — tapping a highlighted stretch: the explanations at
//     the top (the stretch, who left what, anything sealed), the notes
//     scrolling below as cream papers, "Add note" at the bottom of the
//     scroll.
//
//   HighlightCreateSheet — after picking sentences: the stretch, "Yup." or
//     a note.

const INTER = '"Inter", system-ui, sans-serif';
const LORA = '"Lora", Georgia, serif';
const NOTE_MAX = 1000;

const backdrop: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(26,58,74,0.35)", zIndex: 1200 };
const sheet: React.CSSProperties = {
  position: "fixed", left: 0, right: 0, bottom: 0,
  background: CANON.accent, color: CANON.cream,
  borderTopLeftRadius: 24, borderTopRightRadius: 24,
  padding: "20px 20px 0",
  textAlign: "left", maxHeight: "84vh", display: "flex", flexDirection: "column",
  boxSizing: "border-box", fontFamily: INTER,
};
const title: React.CSSProperties = { fontFamily: LORA, fontWeight: 700, fontSize: 20, marginBottom: 8 };
// One plain line about what a note is (his 10-07 note: the quoted stretch
// read as a message, so it's gone from both sheets).
const aboutStyle: React.CSSProperties = { fontSize: 14, lineHeight: 1.5, opacity: 0.92, margin: "0 0 12px" };
const creamPill: React.CSSProperties = {
  background: CANON.cream, color: CANON.dark, border: "none", borderRadius: 9999,
  padding: "10px 18px", fontFamily: INTER, fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44,
};
const outlinePill: React.CSSProperties = {
  background: "transparent", color: CANON.cream, border: `2px solid ${CANON.cream}`, borderRadius: 9999,
  padding: "8px 16px", fontFamily: INTER, fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44,
};
const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "none", borderRadius: 12, padding: "12px 14px",
  fontFamily: INTER, fontSize: 15, lineHeight: 1.5, color: CANON.dark, background: CANON.cream,
  resize: "vertical", outline: "none",
};
const bottomPad = "calc(env(safe-area-inset-bottom, 0px) + 24px)";


export function HighlightNoteSheet({ readable, sealed, currentUserId, displayNames, onClose, onDelete, onAddNote }: {
  readable: Highlight[];
  sealed: Highlight[];
  currentUserId: string | null;
  displayNames?: Record<string, string>;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onAddNote?: (note: string) => Promise<void>;
}) {
  // His 10-07 note: no shelf. The page dims and the notes FLOAT as cream
  // papers, nothing else — no heading. Tap the dim (or a gap between the
  // papers) or swipe down to close.
  const editorialScope = useEditorialScope();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swipe = useSheetSwipeDown(onClose, { scrollRef, enabled: !saving });
  // Every note, sealed ones included (the desktop paper's rule): a sealed
  // note is its own paper with the dashed frame where the writing would be.
  const notes = [...readable, ...sealed].filter((h) => h.kind === "note").sort((x, y) => x.createdAt - y.createdAt);
  const lines = describeStretch(readable, sealed, displayNames);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (writing) setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.scrollIntoView({ block: "nearest" }); }, 0); }, [writing]);

  async function save() {
    const text = draft.trim();
    if (!text || !onAddNote || saving) return;
    setSaving(true); setError(null);
    try {
      await onAddNote(text);
      setWriting(false); setDraft("");
      setTimeout(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, 0);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Couldn't save your note.");
    } finally {
      setSaving(false);
    }
  }

  const paper = (i: number): React.CSSProperties => editorialScope
    ? paperStyle(i % 2 === 0 ? -1.5 : 1.2, { margin: "0 4px 14px" })
    : ({
    background: CANON.cream, color: CANON.dark, borderRadius: 16, padding: "14px 16px",
    boxShadow: "0 12px 32px rgba(0,0,0,0.28)", transform: `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`,
    margin: "0 4px 18px",
  });

  // The scroller covers the whole screen (his 10-07 note: the papers were
  // cropped at the float's top edge) — the papers start a way down and
  // scroll clean off the top of the phone; the dim stays put beneath.
  return (
    <div style={{ ...backdrop, background: "rgba(26,58,74,0.55)" }} onClick={onClose}>
      <div
        ref={scrollRef}
        role="dialog"
        aria-label="Notes"
        style={{ position: "fixed", inset: 0, overflowY: "auto", fontFamily: INTER, ...swipe.style }}
        {...swipe.handlers}
        onClick={(e) => { e.stopPropagation(); const t = e.target as HTMLElement; if (t === e.currentTarget || t.dataset.floatGap === "1") onClose(); }}
      >
      {/* The papers fill from the BOTTOM up until they overflow (his 10-07
          note: one short note sat high on the page); past that the stack
          starts at the top and scrolls as before. */}
      <div data-float-gap="1" style={{ minHeight: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: `12vh 16px ${bottomPad}` }}>
        {lines.yups && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: CANON.cream, color: CANON.dark, borderRadius: 9999, padding: "6px 12px", fontSize: 13, margin: "0 4px 14px", boxShadow: "0 6px 18px rgba(0,0,0,0.22)" }}>{lines.yups}: <ThumbsUp size={13} color={CANON.dark} strokeWidth={2} /></div>
        )}
        {notes.map((h, i) => {
          const own = !!currentUserId && h.authorId === currentUserId;
          return (
            <div key={h.id} style={paper(i)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {editorialScope ? (
                  <span style={NOTE_BYLINE}>{nameOf(h, displayNames)} · S{h.authorSeason} E{h.authorEpisode} · {timeAgo(h.createdAt)}</span>
                ) : (
                <>
                <span style={{ display: "inline-flex", width: 24, height: 24, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}><SidebarAvatar userId={h.authorId} username={h.authorUsername} size={24} /></span>
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{nameOf(h, displayNames)}</span>
                  <span style={{ fontSize: 11, opacity: 0.65 }}>s{h.authorSeason} e{h.authorEpisode} · {timeAgo(h.createdAt)}</span>
                </span>
                </>
                )}
                {own && onDelete && !h.sealed && (
                  <button type="button" onClick={() => onDelete(h.id)} style={editorialScope ? { ...MONO_WORD, marginLeft: "auto", color: CANON.alert, textDecoration: "underline" } : { marginLeft: "auto", background: "transparent", border: "none", padding: "6px 4px", color: CANON.alert, fontFamily: INTER, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                )}
              </div>
              {h.sealed && editorialScope ? (
                <SealedNoteBody s={h.authorSeason} e={h.authorEpisode} />
              ) : h.sealed ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "18px 12px 16px", marginTop: 10, border: `2px dashed ${CANON.friend}`, borderRadius: 12 }}>
                  <span style={{ display: "inline-flex", width: 44, height: 44, borderRadius: "50%", background: CANON.alert, alignItems: "center", justifyContent: "center" }}><Lock size={20} color={CANON.cream} strokeWidth={2.4} /></span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, textAlign: "center", opacity: 0.8 }}>This note will unseal when you watch S{h.authorSeason} E{h.authorEpisode}.</span>
                </div>
              ) : (
                <div style={editorialScope ? NOTE_TEXT : { marginTop: 8, fontSize: 14.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{h.note}</div>
              )}
            </div>
          );
        })}

        {onAddNote && !writing && (
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 4px" }}>
            <button type="button" onClick={() => { setWriting(true); setError(null); }} style={editorialScope ? { ...FRAME_SMALL, height: 40, padding: "0 16px", background: CANON.cream, boxShadow: "0 1px 0 rgba(26,58,74,0.35)" } : { ...creamPill, boxShadow: "0 8px 22px rgba(0,0,0,0.25)" }}>{editorialScope ? "Add a note" : "Add note"}</button>
          </div>
        )}
        {writing && (
          <div style={{ ...paper(notes.length), transform: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))} maxLength={NOTE_MAX} rows={4} placeholder="Add your note…" style={editorialScope ? NOTE_FIELD : { ...field, boxShadow: "inset 0 0 0 2px rgba(26,58,74,0.15)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>{draft.length}/{NOTE_MAX}</span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => { setWriting(false); setDraft(""); setError(null); }} style={editorialScope ? { ...MONO_WORD, padding: "0 10px", height: 44 } : { background: "transparent", border: `2px solid ${CANON.dark}`, color: CANON.dark, borderRadius: 9999, padding: "8px 16px", fontFamily: INTER, fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>Cancel</button>
              <button type="button" onClick={save} disabled={!draft.trim() || saving} style={editorialScope ? { ...INK_SMALL, height: 44, padding: "0 20px", opacity: !draft.trim() || saving ? 0.6 : 1 } : { background: CANON.accent, color: CANON.cream, border: "none", borderRadius: 9999, padding: "10px 18px", fontFamily: INTER, fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44, opacity: !draft.trim() || saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save"}</button>
            </div>
            {error && <div style={{ fontSize: 13, fontStyle: "italic", color: CANON.alert }}>{error}</div>}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/** The editorial drawer (Alborz's notes, round 5): a cream panel fixed at
 *  the foot of the screen that rises with the keyboard; the page keeps
 *  scrolling and answering taps behind it. With `dim`, a veil over the page
 *  that lets every touch through. Swipe down, or the panel's own act,
 *  closes it — never a tap outside. */
function NoteDrawer({ label, dim = false, onClose, enabled = true, children }: { label: string; dim?: boolean; onClose: () => void; enabled?: boolean; children: React.ReactNode }) {
  const kb = useKeyboardInset();
  const swipe = useSheetSwipeDown(onClose, { enabled });
  return (
    <>
      {dim && <div aria-hidden="true" style={{ position: "fixed", inset: 0, background: "rgba(26,58,74,0.35)", zIndex: 1200, pointerEvents: "none", animation: "mDimIn 180ms ease-out" }} />}
      <div role="dialog" aria-label={label} {...swipe.handlers} style={{ position: "fixed", left: 0, right: 0, bottom: kb, zIndex: 1201, background: E.color.cream, color: E.color.ink, borderTop: `1px solid ${E.color.ink}`, boxShadow: "0 -6px 20px rgba(26,58,74,0.14)", padding: "10px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)", boxSizing: "border-box", fontFamily: INTER, animation: "mSheetRise 180ms ease-out", ...swipe.style }}>
        <div aria-hidden="true" style={{ width: 36, height: 4, background: E.color.ink, margin: "0 auto 14px" }} />
        {children}
      </div>
    </>
  );
}

/** The first step on the phone (round 5): what a note is and how to pick,
 *  Next once sentences are lit, × to leave. No veil — the letter above is
 *  the thing to read and tap. */
export function HighlightPickDrawer({ hasPick, onNext, onClose }: { hasPick: boolean; onNext: () => void; onClose: () => void }) {
  return (
    <NoteDrawer label="Add a note" onClose={onClose}>
      <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 8, right: 8, width: 40, height: 40, border: "none", background: "transparent", color: E.color.ink, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
        <X size={18} />
      </button>
      <div style={{ ...E.type.letterTitle22, paddingRight: 36 }}>Add a note</div>
      <div style={{ ...E.type.note13, lineHeight: 1.5, color: "rgba(26,58,74,0.8)", marginTop: 8 }}>
        {hasPick
          ? "Tap more sentences to add them, or tap the first or last one to let it go. Then tap Next to write your note."
          : "A note is a thought you leave on part of a letter. Tap the sentences above that you want to write about — they'll light up. Then tap Next."}
      </div>
      <button type="button" onClick={onNext} disabled={!hasPick} style={{ ...E.type.button16, width: "100%", height: 48, marginTop: 14, background: E.color.ink, color: E.color.cream, border: 0, cursor: hasPick ? "pointer" : "default", opacity: hasPick ? 1 : 0.5 }}>Next</button>
    </NoteDrawer>
  );
}

export function HighlightCreateSheet({ onClose, onConfirm, canSave = true }: {
  onClose: () => void;
  onConfirm: (payload: { kind: "yup" } | { kind: "note"; note: string }) => Promise<void>;
  /** The editorial drawer keeps the pick live (round 5): Save waits for lit sentences. */
  canSave?: boolean;
}) {
  const editorialScope = useEditorialScope();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swipe = useSheetSwipeDown(onClose, { enabled: !saving });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Focus after the page has scrolled the picked sentences into view
  // (V2InlineThread does that on open), so the keyboard doesn't fight it.
  // The editorial drawer doesn't scroll the page, so it focuses at once.
  useEffect(() => { const t = setTimeout(() => textareaRef.current?.focus(), editorialScope ? 60 : 380); return () => clearTimeout(t); }, [editorialScope]);

  async function go(payload: { kind: "yup" } | { kind: "note"; note: string }) {
    if (saving) return;
    setSaving(true); setError(null);
    try { await onConfirm(payload); }
    catch (e) { setError((e as { message?: string })?.message ?? "Couldn't save your highlight."); }
    finally { setSaving(false); }
  }

  const body = (
    <>
      <div style={editorialScope ? E.type.letterTitle22 : title}>Add a note</div>
      <div style={editorialScope ? { ...E.type.note13, color: "rgba(26,58,74,0.8)", margin: "8px 0 14px" } : aboutStyle}>
        {canSave ? "Your note will sit on the sentences you picked — spoiler-gated just like everything else." : "Tap the sentences above that you want to write about — they'll light up."}
      </div>
      <textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))} maxLength={NOTE_MAX} rows={4} placeholder="Write a note…" style={editorialScope ? NOTE_FIELD : field} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={() => go({ kind: "note", note: draft.trim() })} disabled={!draft.trim() || saving || !canSave} style={editorialScope ? { ...INK_SMALL, height: 48, padding: "0 20px", opacity: !draft.trim() || saving || !canSave ? 0.6 : 1 } : { ...creamPill, opacity: !draft.trim() || saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save note"}</button>
        <button type="button" onClick={onClose} disabled={saving} style={editorialScope ? { ...FRAME_SMALL, height: 48, padding: "0 20px" } : outlinePill}>Cancel</button>
        <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8, ...(editorialScope ? E.type.label10 : {}) }}>{draft.length}/{NOTE_MAX}</span>
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 13, fontStyle: "italic" }}>{error}</div>}
    </>
  );

  // The editorial skin: the drawer, veiled, the page live behind it.
  if (editorialScope) {
    return <NoteDrawer label="Add a note" dim onClose={onClose} enabled={!saving}>{body}</NoteDrawer>;
  }
  return (
    <div style={backdrop} onClick={onClose}>
      <div role="dialog" aria-label="Add a note" style={{ ...sheet, paddingBottom: bottomPad, ...swipe.style }} {...swipe.handlers} onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  );
}
