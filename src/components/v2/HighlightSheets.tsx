import React, { useEffect, useRef, useState } from "react";
import { Lock, ThumbsUp } from "lucide-react";
import type { Highlight } from "../../lib/db";
import { timeAgo } from "../../lib/utils";
import useSheetSwipeDown from "../../lib/useSheetSwipeDown";
import { CANON } from "../../styles/canon";
import SidebarAvatar from "../SidebarAvatar";
import { describeStretch, nameOf } from "./HighlightNotePaper";

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

  const paper = (i: number): React.CSSProperties => ({
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
                <span style={{ display: "inline-flex", width: 24, height: 24, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}><SidebarAvatar userId={h.authorId} username={h.authorUsername} size={24} /></span>
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{nameOf(h, displayNames)}</span>
                  <span style={{ fontSize: 11, opacity: 0.65 }}>s{h.authorSeason} e{h.authorEpisode} · {timeAgo(h.createdAt)}</span>
                </span>
                {own && onDelete && !h.sealed && (
                  <button type="button" onClick={() => onDelete(h.id)} style={{ marginLeft: "auto", background: "transparent", border: "none", padding: "6px 4px", color: CANON.alert, fontFamily: INTER, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                )}
              </div>
              {h.sealed ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "18px 12px 16px", marginTop: 10, border: `2px dashed ${CANON.friend}`, borderRadius: 12 }}>
                  <span style={{ display: "inline-flex", width: 44, height: 44, borderRadius: "50%", background: CANON.alert, alignItems: "center", justifyContent: "center" }}><Lock size={20} color={CANON.cream} strokeWidth={2.4} /></span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, textAlign: "center", opacity: 0.8 }}>This note will unseal when you watch S{h.authorSeason} E{h.authorEpisode}.</span>
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 14.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{h.note}</div>
              )}
            </div>
          );
        })}

        {onAddNote && !writing && (
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 4px" }}>
            <button type="button" onClick={() => { setWriting(true); setError(null); }} style={{ ...creamPill, boxShadow: "0 8px 22px rgba(0,0,0,0.25)" }}>Add note</button>
          </div>
        )}
        {writing && (
          <div style={{ ...paper(notes.length), transform: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))} maxLength={NOTE_MAX} rows={4} placeholder="Add your note…" style={{ ...field, boxShadow: "inset 0 0 0 2px rgba(26,58,74,0.15)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, opacity: 0.6 }}>{draft.length}/{NOTE_MAX}</span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => { setWriting(false); setDraft(""); setError(null); }} style={{ background: "transparent", border: `2px solid ${CANON.dark}`, color: CANON.dark, borderRadius: 9999, padding: "8px 16px", fontFamily: INTER, fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>Cancel</button>
              <button type="button" onClick={save} disabled={!draft.trim() || saving} style={{ background: CANON.accent, color: CANON.cream, border: "none", borderRadius: 9999, padding: "10px 18px", fontFamily: INTER, fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44, opacity: !draft.trim() || saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save"}</button>
            </div>
            {error && <div style={{ fontSize: 13, fontStyle: "italic", color: CANON.alert }}>{error}</div>}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export function HighlightCreateSheet({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (payload: { kind: "yup" } | { kind: "note"; note: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swipe = useSheetSwipeDown(onClose, { enabled: !saving });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Focus after the page has scrolled the picked sentences into view
  // (V2InlineThread does that on open), so the keyboard doesn't fight it.
  useEffect(() => { const t = setTimeout(() => textareaRef.current?.focus(), 380); return () => clearTimeout(t); }, []);

  async function go(payload: { kind: "yup" } | { kind: "note"; note: string }) {
    if (saving) return;
    setSaving(true); setError(null);
    try { await onConfirm(payload); }
    catch (e) { setError((e as { message?: string })?.message ?? "Couldn't save your highlight."); }
    finally { setSaving(false); }
  }

  return (
    <div style={backdrop} onClick={onClose}>
      <div role="dialog" aria-label="Add a note" style={{ ...sheet, paddingBottom: bottomPad, ...swipe.style }} {...swipe.handlers} onClick={(e) => e.stopPropagation()}>
        <div style={title}>Add a note</div>
        <div style={aboutStyle}>Your note will sit on the sentences you picked — spoiler-gated just like everything else.</div>
        <textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))} maxLength={NOTE_MAX} rows={4} placeholder="Write a note…" style={field} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={() => go({ kind: "note", note: draft.trim() })} disabled={!draft.trim() || saving} style={{ ...creamPill, opacity: !draft.trim() || saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save note"}</button>
          <button type="button" onClick={onClose} disabled={saving} style={outlinePill}>Cancel</button>
          <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>{draft.length}/{NOTE_MAX}</span>
        </div>
        {error && <div style={{ marginTop: 8, fontSize: 13, fontStyle: "italic" }}>{error}</div>}
      </div>
    </div>
  );
}
