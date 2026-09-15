/**
 * Shared modal/overlay chrome for the live dashboard world (2026-07-06,
 * onboarding look-and-feel pass). These style objects used to live inline in
 * DashboardPage / ShowRoomPage; they moved here UNCHANGED so the social
 * onboarding can render the site's REAL surfaces (search card, picker card,
 * invite card, compose shell, accent confirm card) instead of approximations
 * — one source, no drift. Values are byte-identical to the originals
 * (C.green ⇒ CANON.personal, etc.).
 */
import type React from "react";
import { CANON, withAlpha } from "../styles/canon";

export const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
export const INTER = '"Inter", system-ui, sans-serif';

// ============================================================================
// D — the desktop polish pass's shared scales (2026-09-15; the desktop twin
// of src/mobile/m.ts). One type scale, three pill sizes, one 96px header
// grid, four card sizes on one dim, one gated-writing idiom. Inline styles
// stay; screens migrate their literals onto these screen by screen.
//   Type: Display 40 · Title 28 · Subtitle 22 · Body 15 · Label 14/700 ·
//         Caption 13. Letter-spacing only on Display (−0.5).
//   Pills: L = the page's one act (shadow allowed there only) · M = cards
//         and toolbars · S = inline chips and thread actions. Fill roles:
//         identity = act, accent = write/propose, alert = destructive,
//         cream = on-frame secondary. Outline = 2px in the surface's ink.
//   Cards: dialog 360 (irreversible confirms — Cancel exits, no ×, no
//         tap-out) · form 560 · picker 640 · showModal 460. One dim.
//   Gated writing: D.gatedStub everywhere (dashed cream 80%, no fill) —
//         solid identity outline stays reserved for NEW visible entries,
//         solid cream for read ones. DeckGridCard's covered cells are a
//         game board, not gated writing — leave them.
// ============================================================================
export const D = {
  type: {
    display:  { fontFamily: LORA,  fontWeight: 700, fontSize: 40, lineHeight: 1.15, letterSpacing: -0.5 } as React.CSSProperties,
    title:    { fontFamily: LORA,  fontWeight: 700, fontSize: 28, lineHeight: 1.2,  letterSpacing: 0 } as React.CSSProperties,
    subtitle: { fontFamily: LORA,  fontWeight: 700, fontSize: 22, lineHeight: 1.3,  letterSpacing: 0 } as React.CSSProperties,
    body:     { fontFamily: INTER, fontWeight: 400, fontSize: 15, lineHeight: 1.6 } as React.CSSProperties,
    bodyStrong: { fontFamily: INTER, fontWeight: 600, fontSize: 15, lineHeight: 1.5 } as React.CSSProperties,
    label:    { fontFamily: INTER, fontWeight: 700, fontSize: 14, letterSpacing: 0 } as React.CSSProperties,
    caption:  { fontFamily: INTER, fontWeight: 400, fontSize: 13, lineHeight: 1.45 } as React.CSSProperties,
  },
  pill: {
    L: { padding: "16px 40px", minHeight: 52, borderRadius: 9999, fontFamily: INTER, fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer", boxSizing: "border-box" } as React.CSSProperties,
    M: { padding: "12px 28px", minHeight: 44, borderRadius: 9999, fontFamily: INTER, fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer", boxSizing: "border-box" } as React.CSSProperties,
    S: { padding: "8px 16px",  minHeight: 36, borderRadius: 9999, fontFamily: INTER, fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer", boxSizing: "border-box" } as React.CSSProperties,
  },
  iconBtn: { width: 44, height: 44, flexShrink: 0, border: "none", background: "transparent", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" } as React.CSSProperties,
  glyph: 20,          // lucide size inside iconBtn; 16 inline with text
  circleBtn: (ink: string): React.CSSProperties => ({ width: 44, height: 44, borderRadius: "50%", background: "transparent", border: `2px solid ${ink}`, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }),
  header: {           // one bar for dashboard, group room, show room
    bar:    { display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", height: 96, padding: "0 24px", boxSizing: "border-box" } as React.CSSProperties,
    center: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 } as React.CSSProperties,
    right:  { display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-end" } as React.CSSProperties,
  },
  input: {            // on-yellow / on-page field (cream pill, dark ink)
    width: "100%", boxSizing: "border-box", border: "none", borderRadius: 9999, padding: "14px 24px", minHeight: 48,
    fontFamily: INTER, fontSize: 16, color: CANON.dark, background: CANON.cream, outline: "none",
  } as React.CSSProperties,
  inputOnCream: { boxShadow: `inset 0 0 0 2px ${CANON.friend}` } as React.CSSProperties,   // spread onto D.input when the field sits on cream
  textarea: { width: "100%", boxSizing: "border-box", border: "none", borderRadius: 12, padding: "14px 16px", fontFamily: INTER, fontSize: 15, lineHeight: 1.6, color: CANON.dark, background: CANON.cream, resize: "vertical", outline: "none" } as React.CSSProperties,
  dim: { position: "fixed", inset: 0, background: "rgba(26,58,74,0.25)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box", overflowY: "auto", animation: "dDimIn 180ms ease-out" } as React.CSSProperties,
  card: {             // add background + color per use
    dialog: { width: "min(360px, 92vw)", borderRadius: 24, padding: 32, boxSizing: "border-box", position: "relative", animation: "dCardRise 180ms ease-out" } as React.CSSProperties,
    form:   { width: "min(560px, 92vw)", borderRadius: 24, padding: 32, boxSizing: "border-box", position: "relative", animation: "dCardRise 180ms ease-out" } as React.CSSProperties,
    picker: { width: "min(640px, 92vw)", borderRadius: 24, padding: "40px 48px", boxSizing: "border-box", position: "relative", animation: "dCardRise 180ms ease-out" } as React.CSSProperties,
    showModal: { width: "min(460px, 92vw)", borderRadius: 24, padding: 32, boxSizing: "border-box", position: "relative", textAlign: "center" } as React.CSSProperties,
  },
  closeX: { position: "absolute", top: 12, right: 12, width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" } as React.CSSProperties,
  divider: (ink: string): React.CSSProperties => ({ height: 1, background: withAlpha(ink, ink === CANON.cream ? 0.4 : 0.12), margin: "24px 0" }),
  popover: { background: CANON.cream, color: CANON.dark, borderRadius: 24, padding: 16, width: 320, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" } as React.CSSProperties,   // React-to-this, nudge — colors as today
  hoverPop: { borderRadius: 18, padding: "9px 14px", fontFamily: INTER, fontSize: 13, lineHeight: 1.45, boxShadow: "0 4px 14px rgba(0,0,0,0.2)" } as React.CSSProperties, // "you've watched…", "open group" — keep each one's fill
  // Tip stickies (TipsNote) stay sharp-cornered (radius 0). Do not round them.
  gatedStub: (radius = 24): React.CSSProperties => ({ border: "2px dashed rgba(254,248,234,0.8)", borderRadius: radius, background: "transparent", color: CANON.cream, display: "flex", alignItems: "center", gap: 12 }),
  disabledOpacity: 0.6,
};

export const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(26,58,74,0.25)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 50,
};

// Edge-tab top (2026-08-20 rule, re-derived 2026-09-15 for the 96px header):
// the room edge tabs (back left · chat right) sit at ONE shared height, the
// tab's center on the group room's first open-show pill row at rest (Alborz's
// August call — the anchor is the pill row, not the header). Layout sum:
// header bar 96 + content paddingTop 24 + shelf header (Title 28 × 1.2 ≈ 34
// + 24 margin) + half a pill (48/2 = 24) ≈ 202 → the 88px-tall tab tops out
// at 202 − 44 = 158. Fixed px (not %) — the content above is px-anchored, so
// the alignment holds at any window height. The show room's back tab and the
// friend drawer share this value so the tab doesn't jump between pages; the
// poll sticky derives from it too.
export const EDGE_TAB_TOP = 158;

export const searchCard: React.CSSProperties = { background: CANON.cream, borderRadius: 24, padding: 32, width: "min(560px, 86vw)" };

export const pickerCard: React.CSSProperties = {
  background: CANON.cream, borderRadius: 24, padding: "40px 48px", width: "min(640px, 88vw)",
  display: "flex", flexDirection: "column", alignItems: "center",
};

export const searchInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `2px solid ${CANON.personal}`, borderRadius: 65,
  padding: "14px 24px", fontFamily: '"Inter", sans-serif', fontSize: 14, color: CANON.personal,
  background: "transparent", outline: "none",
};

export const modalClose: React.CSSProperties = {
  position: "absolute", top: 16, right: 16, border: "none", background: "transparent", cursor: "pointer",
};

export const yellowCard: React.CSSProperties = {
  background: CANON.accent, borderRadius: 15, padding: "28px 32px", width: "min(360px, 88vw)",
  position: "relative", textAlign: "center",
};

export const yellowTitle: React.CSSProperties = {
  color: CANON.cream, fontSize: 15, fontWeight: 600, letterSpacing: -0.5,
};

export const startBtn: React.CSSProperties = {
  border: "none", background: CANON.identity, color: CANON.cream, fontWeight: 700, fontSize: 14,
  padding: "11px 38px", borderRadius: 65, cursor: "pointer",
};

// L pill + identity + shadow (polish pass 2026-09-15; was 18×64 radius 65).
export const invitePill: React.CSSProperties = {
  ...D.pill.L, background: CANON.identity, color: CANON.cream,
  boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
};

export const searchPill: React.CSSProperties = {
  ...D.pill.L, background: CANON.accent, color: CANON.cream,
};

// The group heading's "with …" members line (naming arc 2026-07-07): shared
// by the group room AND the show room header so the two never drift. Caption
// under the Display title since the 2026-09-15 polish (was inline bold 14).
export const groupHeadingMembers: React.CSSProperties = {
  fontFamily: '"Inter", sans-serif', fontWeight: 400, fontSize: 13, lineHeight: 1.45, letterSpacing: 0, color: CANON.cream,
};

// The show room's compose shell (ShowRoomPage) — the "regular compose modal".
export const composeBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 1000,
};

export const composeCardOuter: React.CSSProperties = {
  position: "relative", width: "85vw", height: "90vh", background: CANON.cream,
  borderRadius: 24, boxShadow: "0 12px 36px rgba(0,0,0,0.25)", overflow: "auto",
};
