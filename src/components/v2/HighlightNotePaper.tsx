import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, ThumbsUp, X } from "lucide-react";
import type { Highlight } from "../../lib/db";
import { timeAgo } from "../../lib/utils";
import { CANON } from "../../styles/canon";
import SidebarAvatar from "../SidebarAvatar";

// Highlight notes (Alborz 2026-10-07, the letters-only rooms arc, CP1).
//
// Two surfaces hang off a highlighted stretch:
//
//   HighlightHoverPopup — the rollover (a tap on touch): the noters' chips
//     and a line about what's here ("Sam and Adam left notes", "Adam: 👍",
//     "A note from s1 e5. It opens when you catch up."), plus "click to
//     read" when there is something to read. Your own yup keeps its ×.
//
//   HighlightNotePaper — the paper that opens on click: ONE NOTE PER PAGE,
//     sealed ones included (a sealed note is its own card: the writer's
//     name and avatar as usual, the red lock where the writing would be).
//     "← Name" bottom-left from the second page on, "Name →" bottom-right
//     while there is a next note, "1 of 2" bottom-centre, × top-right,
//     Delete under that on your own note, and "Add note" on the LAST page
//     (so a second person adds to the same stretch instead of highlighting
//     it again). With more than one note a second card peeks out behind
//     the first (his 10-07 notes).
//
// Both are anchored to the stretch itself (not the cursor), re-measured on
// every scroll and resize so they travel with the page, and clamped to the
// viewport so they never open off screen. The paper flips above the
// stretch when there is no room below, and scrolls inside when a note is
// taller than the space.

const NOTE_MAX = 1000;
const PAPER_W = 340;
const PAPER_RADIUS = 14;
const PAPER_TILT = 2.5;
const POPUP_TILT = 6;
const INTER = '"Inter", system-ui, sans-serif';

type Names = Record<string, string> | undefined;

export function nameOf(h: Highlight, displayNames: Names): string {
  return displayNames?.[h.authorUsername] ?? h.authorUsername;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const progressTag = (h: Highlight) => `s${h.authorSeason} e${h.authorEpisode}`;
const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);

/** The stretch's boxes, re-measured on scroll (any scroller) and resize.
 *  `first` is the first line's box (the hover popup rides the first line);
 *  `rect` is the whole stretch (the paper hangs under its last line). */
function useAnchorRects(el: HTMLElement | null) {
  const measure = () => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const first = el.getClientRects()[0] ?? rect;
    return { rect, first };
  };
  const [boxes, setBoxes] = useState<{ rect: DOMRect; first: DOMRect } | null>(measure);
  useLayoutEffect(() => {
    if (!el) return;
    let raf = 0;
    const follow = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setBoxes(measure()));
    };
    follow();
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el]);
  return boxes;
}

const chipStack: React.CSSProperties = { display: "inline-flex", alignItems: "center", flexShrink: 0 };
const chip = (i: number): React.CSSProperties => ({
  display: "inline-flex", width: 22, height: 22, borderRadius: "50%", overflow: "hidden",
  boxShadow: `0 0 0 2px ${CANON.cream}`, marginLeft: i === 0 ? 0 : -6, background: CANON.cream,
});
const sealedChip = (i: number): React.CSSProperties => ({
  ...chip(i), background: CANON.alert, alignItems: "center", justifyContent: "center",
});

function Chips({ readable, sealed }: { readable: Highlight[]; sealed: Highlight[] }) {
  // One chip per person who left something readable; one red lock per sealed note.
  const people: Highlight[] = [];
  const seen = new Set<string>();
  for (const h of readable) {
    if (seen.has(h.authorId)) continue;
    seen.add(h.authorId);
    people.push(h);
  }
  const shown = people.slice(0, 3);
  const more = people.length - shown.length;
  return (
    <span style={chipStack} aria-hidden>
      {shown.map((h, i) => (
        <span key={h.authorId} style={chip(i)}><SidebarAvatar userId={h.authorId} username={h.authorUsername} size={22} /></span>
      ))}
      {more > 0 && (
        <span style={{ ...chip(shown.length), alignItems: "center", justifyContent: "center", fontFamily: INTER, fontSize: 10, fontWeight: 700, color: CANON.dark }}>+{more}</span>
      )}
      {sealed.map((h, i) => (
        <span key={h.id} style={sealedChip(shown.length + (more > 0 ? 1 : 0) + i)}><Lock size={11} color={CANON.cream} strokeWidth={2.6} /></span>
      ))}
    </span>
  );
}

/** The lines the popup (and the paper's header) say about a stretch. */
export function describeStretch(readable: Highlight[], sealed: Highlight[], displayNames: Names): { notes: string | null; yups: string | null; sealed: string | null } {
  const notes = readable.filter((h) => h.kind === "note");
  const yups = readable.filter((h) => h.kind === "yup");
  // His copy (10-07): "One visible note from Alborz." / "One sealed note
  // waiting for you." — no episode numbers on the rollover.
  let notesLine: string | null = null;
  if (notes.length) {
    const names = Array.from(new Set(notes.map((h) => nameOf(h, displayNames))));
    notesLine = `${countWord(notes.length)} visible note${notes.length === 1 ? "" : "s"} from ${joinNames(names)}.`;
  }
  const yupsLine = yups.length ? joinNames(Array.from(new Set(yups.map((h) => nameOf(h, displayNames))))) : null;
  const sealedNotes = sealed.filter((h) => h.kind === "note");
  const sealedLine = sealedNotes.length ? `${countWord(sealedNotes.length)} sealed note${sealedNotes.length === 1 ? "" : "s"} waiting for you.` : null;
  return { notes: notesLine, yups: yupsLine, sealed: sealedLine };
}

export function HighlightHoverPopup({ anchorEl, readable, sealed, currentUserId, displayNames, onDelete, onEnter, onLeave }: {
  anchorEl: HTMLElement;
  readable: Highlight[];
  sealed: Highlight[];
  currentUserId: string | null;
  displayNames?: Record<string, string>;
  onDelete?: (id: string) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const boxes = useAnchorRects(anchorEl);
  if (!boxes) return null;
  const vw = window.innerWidth;
  const maxW = Math.min(280, vw - 24);
  const cx = Math.max(12 + maxW / 2, Math.min(boxes.first.left + boxes.first.width / 2, vw - 12 - maxW / 2));
  const lines = describeStretch(readable, sealed, displayNames);
  const hasNotes = readable.some((h) => h.kind === "note") || sealed.some((h) => h.kind === "note");
  const ownYup = readable.find((h) => h.kind === "yup" && !!currentUserId && h.authorId === currentUserId);
  return (
    <span
      data-hl-popup
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "fixed", top: boxes.first.top - 10, left: cx,
        transform: `translate(-50%, -100%) rotate(${POPUP_TILT}deg)`, transformOrigin: "bottom center",
        maxWidth: maxW, boxSizing: "border-box",
        background: CANON.cream, color: CANON.dark, borderRadius: 12, padding: "8px 12px",
        fontFamily: INTER, fontSize: 12, fontWeight: 500, lineHeight: 1.4,
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)", zIndex: 9999,
        display: "flex", flexDirection: "column", gap: 4, pointerEvents: "auto",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Chips readable={readable} sealed={sealed} />
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          {lines.notes && <span>{lines.notes}</span>}
          {lines.yups && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              {lines.yups}: <ThumbsUp size={12} color={CANON.dark} strokeWidth={2} />
              {ownYup && onDelete && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(ownYup.id); }} aria-label="Remove your yup" style={{ background: "transparent", border: "none", padding: 0, marginLeft: 2, color: CANON.dark, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                  <X size={12} />
                </button>
              )}
            </span>
          )}
          {lines.sealed && <span>{lines.sealed}</span>}
        </span>
      </span>
      {hasNotes && <span style={{ opacity: 0.6, fontSize: 11 }}>Click to open</span>}
    </span>
  );
}

const footBtn: React.CSSProperties = {
  background: "transparent", border: "none", padding: "6px 8px", borderRadius: 9999,
  fontFamily: INTER, fontSize: 13, fontWeight: 600, color: CANON.dark, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 4, minHeight: 32,
};

export function HighlightNotePaper({ anchorEl, notes, currentUserId, displayNames, onClose, onDelete, onAddNote }: {
  anchorEl: HTMLElement;
  /** Every note on this stretch, oldest first, sealed ones included — one
   *  page each. */
  notes: Highlight[];
  currentUserId: string | null;
  displayNames?: Record<string, string>;
  onClose: () => void;
  onDelete?: (id: string) => void;
  /** Writes another note onto this same stretch; rejects with a message. */
  onAddNote?: (note: string) => Promise<void>;
}) {
  const boxes = useAnchorRects(anchorEl);
  const paperRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jumpToLast = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep the page inside the notes, and land on the newest after Add note.
  useEffect(() => {
    if (jumpToLast.current && notes.length) { jumpToLast.current = false; setPage(notes.length - 1); return; }
    if (page > notes.length - 1) setPage(Math.max(0, notes.length - 1));
  }, [notes.length, page]);

  // Click or tap anywhere else closes the paper; Escape too.
  useEffect(() => {
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (paperRef.current?.contains(t) || anchorEl.contains(t)) return;
      onClose();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [anchorEl, onClose]);

  useEffect(() => { if (writing) setTimeout(() => textareaRef.current?.focus(), 0); }, [writing]);

  if (!boxes || notes.length === 0) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const width = Math.min(PAPER_W, vw - 24);
  const { rect } = boxes;
  const cx = rect.left + rect.width / 2;
  const left = Math.max(12, Math.min(cx - width / 2, vw - width - 12));
  const spaceBelow = vh - rect.bottom - 10;
  const spaceAbove = rect.top - 10;
  const want = Math.min(520, vh - 24);
  const below = spaceBelow >= Math.min(want, 320) || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(180, Math.min(want, (below ? spaceBelow : spaceAbove) - 8));
  const place: React.CSSProperties = below
    ? { top: rect.bottom + 10, transformOrigin: "top center" }
    : { bottom: vh - rect.top + 10, transformOrigin: "bottom center" };

  const i = Math.min(page, notes.length - 1);
  const note = notes[i];
  const isOwn = !!currentUserId && note.authorId === currentUserId;
  const prev = i > 0 ? notes[i - 1] : null;
  const next = i < notes.length - 1 ? notes[i + 1] : null;
  const isLast = i === notes.length - 1;

  async function save() {
    const text = draft.trim();
    if (!text || !onAddNote || saving) return;
    setSaving(true); setError(null);
    try {
      jumpToLast.current = true;
      await onAddNote(text);
      setWriting(false); setDraft("");
    } catch (e) {
      jumpToLast.current = false;
      setError((e as { message?: string })?.message ?? "Couldn't save your note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={paperRef}
      data-hl-popup
      style={{
        position: "fixed", left, width, maxHeight, boxSizing: "border-box", ...place,
        transform: `rotate(${PAPER_TILT}deg)`, zIndex: 9999,
        display: "flex", flexDirection: "column",
      }}
    >
    {notes.length > 1 && (
      // The card behind: one is enough to say "there's more here".
      <div aria-hidden style={{ position: "absolute", left: 7, top: 9, right: -7, bottom: -9, background: CANON.cream, borderRadius: PAPER_RADIUS, boxShadow: "0 8px 24px rgba(0,0,0,0.16)", transform: "rotate(1.6deg)", transformOrigin: "bottom center" }} />
    )}
    <div
      role="dialog"
      aria-label={note.sealed ? `Sealed note from ${nameOf(note, displayNames)}` : `Note from ${nameOf(note, displayNames)}`}
      style={{
        position: "relative", zIndex: 1, minHeight: 0, maxHeight: "inherit", boxSizing: "border-box",
        background: CANON.cream, color: CANON.dark, borderRadius: PAPER_RADIUS,
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        padding: "12px 14px 10px", display: "flex", flexDirection: "column", gap: 8,
        fontFamily: INTER,
      }}
    >
      {/* Header: who, from where, when — and × */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 32, position: "relative" }}>
        <span style={{ display: "inline-flex", width: 26, height: 26, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
          <SidebarAvatar userId={note.authorId} username={note.authorUsername} size={26} />
        </span>
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
          <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(note, displayNames)}</span>
          <span style={{ fontSize: 11, opacity: 0.65 }}>{progressTag(note)} · {timeAgo(note.createdAt)}</span>
        </span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", right: -8, top: -6, width: 32, height: 32, border: "none", background: "transparent", color: CANON.dark, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%" }}>
          <X size={16} />
        </button>
      </div>

      {/* The note — scrolls inside when it is taller than the room it has.
          A sealed note shows the lock where its writing would be. */}
      {note.sealed ? (
        // His 10-07 note: the sealed letter's dashed frame, in Friend blue,
        // where the writing would be, a bigger lock, and when it unseals.
        <div aria-label={`This note will unseal when you watch S${note.authorSeason} E${note.authorEpisode}.`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "22px 14px 20px", margin: "2px 0 4px", border: `2px dashed ${CANON.friend}`, borderRadius: 12 }}>
          <span style={{ display: "inline-flex", width: 48, height: 48, borderRadius: "50%", background: CANON.alert, alignItems: "center", justifyContent: "center" }}><Lock size={22} color={CANON.cream} strokeWidth={2.4} /></span>
          <span style={{ fontSize: 13, lineHeight: 1.45, textAlign: "center", opacity: 0.8 }}>This note will unseal when you watch S{note.authorSeason} E{note.authorEpisode}.</span>
        </div>
      ) : (
        <div style={{ overflowY: "auto", minHeight: 0, flex: "1 1 auto", fontSize: 14.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word", paddingRight: 2 }}>
          {note.note}
        </div>
      )}

      {/* Add note — on the last page only; the writing field replaces it */}
      {isLast && onAddNote && !writing && (
        <button type="button" onClick={() => { setWriting(true); setError(null); }} style={{ ...footBtn, alignSelf: "flex-start", background: CANON.accent, color: CANON.cream, padding: "6px 14px" }}>
          Add note
        </button>
      )}
      {writing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
            maxLength={NOTE_MAX}
            rows={4}
            placeholder="Add your note…"
            style={{ width: "100%", boxSizing: "border-box", border: "none", borderRadius: 10, padding: "10px 12px", fontFamily: INTER, fontSize: 14, lineHeight: 1.5, color: CANON.dark, background: CANON.cream, boxShadow: "inset 0 0 0 2px rgba(26,58,74,0.15)", resize: "vertical", outline: "none" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={save} disabled={!draft.trim() || saving} style={{ ...footBtn, background: CANON.accent, color: CANON.cream, padding: "6px 14px", opacity: !draft.trim() || saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => { setWriting(false); setDraft(""); setError(null); }} style={{ ...footBtn, opacity: 0.7 }}>Cancel</button>
            <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.55 }}>{draft.length}/{NOTE_MAX}</span>
          </div>
          {error && <div style={{ fontSize: 12, color: CANON.alert, fontStyle: "italic" }}>{error}</div>}
        </div>
      )}

      {/* Footer: ← Name | 1 of 2 | Name →, then Delete under it on your own note */}
      {(prev || next) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", marginTop: 2 }}>
          <span style={{ justifySelf: "start" }}>
            {prev && <button type="button" onClick={() => { setPage(i - 1); setWriting(false); }} style={footBtn}><ChevronLeft size={14} />{nameOf(prev, displayNames)}</button>}
          </span>
          <span style={{ justifySelf: "center", fontSize: 11, opacity: 0.6 }}>{i + 1} of {notes.length}</span>
          <span style={{ justifySelf: "end" }}>
            {next && <button type="button" onClick={() => { setPage(i + 1); setWriting(false); }} style={footBtn}>{nameOf(next, displayNames)}<ChevronRight size={14} /></button>}
          </span>
        </div>
      )}
      {isOwn && onDelete && !note.sealed && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button type="button" onClick={() => onDelete(note.id)} style={{ ...footBtn, color: CANON.alert }}>Delete</button>
        </div>
      )}
    </div>
    </div>
  );
}
