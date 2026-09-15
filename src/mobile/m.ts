// ============================================================================
// m.ts — the /m surface's shared design constants (2026-09 mobile polish).
// ----------------------------------------------------------------------------
// One place for the numbers that used to drift screen-to-screen: type scale,
// pill sizes, top-bar geometry, sheet padding, radii. Inline styles stay (the
// codebase's convention) — screens import these and spread them, adding
// background/color/border per use.
//
//   Type:   one `display` (Lora 28) per screen; `title` (Lora 22) for
//           sections/sheets/cards; body 15 / label 14 / caption 13. Nothing
//           below 13. Letter-spacing exists only on the display (−0.5).
//   Pills:  L = the screen's one act · M = sheet/secondary · S = inline in
//           cards. Radius 9999 wherever 65/999 used to appear.
//   Hits:   icon buttons 44×44 with a 20px glyph (M.glyph); inline glyphs 16.
//
// Plate offset (`.sb-press` in theme.ts): translate(-2px, 6px) — mirrored by
// the [data-m] press-exception rule in MobileApp's injectMobileStyles.
// ============================================================================
import type { CSSProperties } from "react";
import { CANON, withAlpha } from "../styles/canon";

export const LORA = '"Lora", Georgia, "Palatino Linotype", Palatino, serif';
export const INTER = '"Inter", system-ui, sans-serif';

export const M = {
  gutter: 16,                                   // page side padding
  sheetGutter: 20,                              // inside full-screen / bottom sheets
  topBar: {                                     // every screen's header row
    display: "flex", alignItems: "center", gap: 4,
    padding: "calc(env(safe-area-inset-top, 0px) + 12px) 12px 8px",
  } as CSSProperties,
  iconBtn: {                                    // back / × / gear / circles
    width: 44, height: 44, flexShrink: 0, border: "none", background: "transparent",
    cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
  } as CSSProperties,
  glyph: 20,                                    // lucide size inside iconBtn; 16 inline with text
  type: {
    display: { fontFamily: LORA, fontWeight: 700, fontSize: 28, lineHeight: 1.2, letterSpacing: -0.5 } as CSSProperties,
    title:   { fontFamily: LORA, fontWeight: 700, fontSize: 22, lineHeight: 1.25, letterSpacing: 0 } as CSSProperties,
    body:    { fontFamily: INTER, fontWeight: 400, fontSize: 15, lineHeight: 1.5 } as CSSProperties,
    label:   { fontFamily: INTER, fontWeight: 700, fontSize: 14, letterSpacing: 0 } as CSSProperties,
    caption: { fontFamily: INTER, fontWeight: 400, fontSize: 13, lineHeight: 1.45 } as CSSProperties,
  },
  pill: {                                       // add background/color/border per use
    L: { padding: "16px 40px", minHeight: 52, borderRadius: 9999, fontFamily: INTER, fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer", boxSizing: "border-box" } as CSSProperties,
    M: { padding: "12px 28px", minHeight: 44, borderRadius: 9999, fontFamily: INTER, fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer", boxSizing: "border-box" } as CSSProperties,
    S: { padding: "8px 16px",  minHeight: 36, borderRadius: 9999, fontFamily: INTER, fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer", boxSizing: "border-box" } as CSSProperties,
  },
  input: {                                      // every text field on /m
    width: "100%", boxSizing: "border-box", border: "none", borderRadius: 9999,
    padding: "14px 24px", minHeight: 48, fontFamily: INTER, fontSize: 16,
    color: CANON.dark, background: CANON.cream, outline: "none",
  } as CSSProperties,
  radius: { pill: 9999, card: 12, soft: 16, sheet: 24 },
  sheet: {                                      // bottom sheets
    width: "100%", boxSizing: "border-box", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: "24px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)",
  } as CSSProperties,
  dim: { position: "fixed", inset: 0, background: withAlpha(CANON.dark, 0.35), display: "flex", alignItems: "flex-end", justifyContent: "center" } as CSSProperties,
  disabledOpacity: 0.6,
};
