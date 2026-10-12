/**
 * MapNotes.tsx — the editorial season map's legend and the notes' papers
 * (checkpoint 5, 2026-10-12; the E3Map / E3MapEdit / E3Notes / E3NotesPick
 * boards and the bible's MapCell and NotesPaper). The map itself stays
 * `V2RoomMap` with an `editorial` prop for its colours and states.
 */
import React from "react";
import { E } from "../../styles/editorial";

function LegendCell({ kind }: { kind: "yours" | "friends" | "sealed" | "stars" }) {
  const base: React.CSSProperties = { width: 16, height: 16, borderRadius: "50%", boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
  if (kind === "yours") return <span aria-hidden="true" style={{ ...base, border: `2px solid ${E.color.identity}` }} />;
  if (kind === "friends") return <span aria-hidden="true" style={{ ...base, border: `2px solid ${E.color.friend}` }} />;
  if (kind === "sealed") return <span aria-hidden="true" style={{ ...base, background: E.color.alert, color: E.color.cream, fontFamily: E.font.interface, fontWeight: 800, fontSize: 10, lineHeight: 1 }}>?</span>;
  return (
    <span aria-hidden="true" style={{ ...base, background: E.color.identity }}>
      <svg viewBox="0 0 100 100" width={11} height={11} style={{ display: "block" }}><path d="M50 8 L61 36 L92 38 L68 57 L76 88 L50 71 L24 88 L32 57 L8 38 L39 36 Z" fill={E.color.cream} /></svg>
    </span>
  );
}

/** The legend at the map's foot: yours, friends, sealed, episode ratings.
 *  `pinned` = the desktop rail's foot, on a cream fill the map scrolls behind. */
export function MapLegend({ pinned = false, style }: { pinned?: boolean; style?: React.CSSProperties }) {
  const items: { kind: "yours" | "friends" | "sealed" | "stars"; label: string }[] = [
    { kind: "yours", label: "Yours" }, { kind: "friends", label: "Friends" }, { kind: "sealed", label: "Sealed" }, { kind: "stars", label: "Episode ratings" },
  ];
  return (
    <div aria-label="Legend" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", ...E.type.label9, color: E.color.inkMuted, ...(pinned ? { position: "sticky", bottom: 0, background: E.color.cream, padding: "14px 0 18px", borderTop: `1px solid ${E.color.hairline}`, zIndex: 2 } : { padding: "14px 0 0" }), ...style }}>
      {items.map((it) => (
        <span key={it.kind} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><LegendCell kind={it.kind} />{it.label}</span>
      ))}
    </div>
  );
}

/** A note's paper: cream, a 1px ink frame, the thinnest shadow, a slight tilt. */
export function paperStyle(tilt = 0, extra?: React.CSSProperties): React.CSSProperties {
  return { boxSizing: "border-box", padding: "14px 16px", background: E.color.cream, color: E.color.ink, border: `1px solid ${E.color.ink}`, boxShadow: "0 1px 0 rgba(26,58,74,0.35)", borderRadius: 0, transform: tilt ? `rotate(${tilt}deg)` : undefined, fontFamily: E.font.interface, ...extra };
}
/** "Sam · S1 E4 · 20 min ago" */
export const NOTE_BYLINE: React.CSSProperties = { ...E.type.label10, color: "rgba(26,58,74,0.7)" };
export const NOTE_TEXT: React.CSSProperties = { ...E.type.letterBody15, lineHeight: 1.55, marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" };
export const NOTE_FIELD: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: `1px solid ${E.color.ink}`, borderRadius: 0, padding: "10px 12px", fontFamily: E.font.interface, fontSize: 14, lineHeight: 1.5, color: E.color.ink, background: E.color.cream, resize: "vertical", outline: "none" };
export const MONO_WORD: React.CSSProperties = { ...E.type.label10, background: "transparent", border: 0, padding: "6px 0", cursor: "pointer", color: E.color.ink, display: "inline-flex", alignItems: "center", gap: 4 };
export const INK_SMALL: React.CSSProperties = { ...E.type.label11, height: 34, padding: "0 14px", background: E.color.ink, color: E.color.cream, border: 0, display: "inline-flex", alignItems: "center", cursor: "pointer" };
export const FRAME_SMALL: React.CSSProperties = { ...E.type.label11, height: 34, padding: "0 14px", background: "transparent", color: E.color.ink, border: `1px solid ${E.color.ink}`, display: "inline-flex", alignItems: "center", cursor: "pointer", boxSizing: "border-box" };

/** A sealed note's body: the dashed friend frame, the lock, when it unseals. */
export function SealedNoteBody({ s, e, size = 36 }: { s: number; e: number; size?: number }) {
  return (
    <div aria-label={`This note will unseal when you watch S${s} E${e}.`} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, padding: "14px 12px", border: `1px dashed ${E.color.friend}` }}>
      <span style={{ display: "inline-flex", width: size, height: size, borderRadius: "50%", background: E.color.alert, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width={size * 0.44} height={size * 0.44} viewBox="0 0 24 24" fill="none" stroke={E.color.cream} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      </span>
      <span style={{ ...E.type.note13, color: E.color.inkMuted }}>This note will unseal when you watch S{s} E{e}.</span>
    </div>
  );
}
