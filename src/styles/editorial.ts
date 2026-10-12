/**
 * editorial.ts — the editorial skin's tokens (the bible, round 3, complete
 * 2026-10-10: https://claude.ai/artifact/Nz2pSU69xKPqMZCZqiZEkq). The
 * classic skin keeps canon.ts / theme.ts / m.ts / dashboardChrome.ts; this
 * module is read only by screens rendering under the editorial skin
 * (src/lib/skin.tsx decides which). Values are the bible's tokens.json,
 * copied — change them there first, then here.
 */
import type { CSSProperties } from "react";

export const E_FONT = {
  display: '"Lora", Georgia, serif',
  interface: '"Inter", system-ui, sans-serif',
  label: '"IBM Plex Mono", ui-monospace, monospace',
} as const;

export const E_COLOR = {
  cream: "#FEF8EA",      // the ground, the paper, the text on ink/red/blue/green
  ink: "#1A3A4A",        // text, rules, blocks
  identity: "#355EB8",   // you and what's new for you: the folded corner that leads back
  personal: "#7ABD8E",   // your own things and a yes
  friend: "#ADC8D7",     // friends' space: the group masthead, the compose band
  alert: "#F45028",      // waiting and warning: the feedback corner, a sealed envelope
  accent: "#DEA838",     // one warm hit: the look-up and sign-up bands
  draft: "#ECE7DA",      // unfinished and not-yet: drafts, posters before they land, the ? while a letter shows
  creamBlock: "#E5DFD3", // the logo's cream block when the logo sits on cream
  inkMuted: "rgba(26,58,74,0.6)",   // second lines, captions, inactive tabs, counts
  inkSub: "rgba(26,58,74,0.78)",    // the "With …" line under a title (the boards)
  inkFaint: "rgba(26,58,74,0.38)",  // episodes you haven't reached
  hairline: "rgba(26,58,74,0.22)",  // row dividers and quiet rules
  inkLines: "rgba(26,58,74,0.14)",  // the ruled lines of the writing paper
  veil: "rgba(26,58,74,0.55)",      // the dim under a sheet
  cellDim: "#DDE6EB",               // friends' cells while you rate yours
  highlightPick: "rgba(222,168,56,0.45)",
} as const;

const label = (fontSize: number, letterSpacing = "0.08em"): CSSProperties => ({
  fontFamily: E_FONT.label, fontWeight: 400, fontSize, lineHeight: 1.2, letterSpacing, textTransform: "uppercase",
});

export const E_TYPE = {
  // Display (Lora)
  title46:  { fontFamily: E_FONT.display, fontWeight: 700, fontSize: 46, lineHeight: 1.02, letterSpacing: "-0.01em" } as CSSProperties,  // every main title on the phone
  title64:  { fontFamily: E_FONT.display, fontWeight: 700, fontSize: 64, lineHeight: 1, letterSpacing: "-0.015em" } as CSSProperties,    // every main title on desktop (the boards' .h1)
  hero36:   { fontFamily: E_FONT.display, fontWeight: 700, fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.01em" } as CSSProperties,
  youreIn40:{ fontFamily: E_FONT.display, fontWeight: 700, fontSize: 40, lineHeight: 1, letterSpacing: "-0.01em" } as CSSProperties,
  question30:{ fontFamily: E_FONT.display, fontWeight: 700, fontSize: 30, lineHeight: 1.25, letterSpacing: "-0.01em" } as CSSProperties,
  scroll30: { fontFamily: E_FONT.display, fontWeight: 700, fontSize: 30, lineHeight: 1.2 } as CSSProperties,
  sticker28:{ fontFamily: E_FONT.display, fontWeight: 700, fontStyle: "italic", fontSize: 28, lineHeight: 1, letterSpacing: "-0.01em" } as CSSProperties,
  letterTitle22: { fontFamily: E_FONT.display, fontWeight: 700, fontSize: 22, lineHeight: 1.2 } as CSSProperties,
  disc30:   { fontFamily: E_FONT.display, fontWeight: 700, fontSize: 30, lineHeight: 1 } as CSSProperties,
  // Letters (Lora)
  letterBody16: { fontFamily: E_FONT.display, fontWeight: 400, fontSize: 16, lineHeight: 1.55 } as CSSProperties,
  letterBody15: { fontFamily: E_FONT.display, fontWeight: 400, fontSize: 15, lineHeight: 1.5 } as CSSProperties,
  quote14:  { fontFamily: E_FONT.display, fontWeight: 400, fontStyle: "italic", fontSize: 14, lineHeight: 1.45 } as CSSProperties,
  // Interface (Inter)
  row17:    { fontFamily: E_FONT.interface, fontWeight: 600, fontSize: 17, lineHeight: 1.2, letterSpacing: "-0.01em" } as CSSProperties,
  row16:    { fontFamily: E_FONT.interface, fontWeight: 600, fontSize: 16, lineHeight: 1.2, letterSpacing: "-0.01em" } as CSSProperties,
  button16: { fontFamily: E_FONT.interface, fontWeight: 700, fontSize: 16, lineHeight: 1, letterSpacing: "0.02em", textTransform: "uppercase" } as CSSProperties,
  tab14:    { fontFamily: E_FONT.interface, fontWeight: 700, fontSize: 14, lineHeight: 1, letterSpacing: "0.04em", textTransform: "uppercase" } as CSSProperties,
  body15:   { fontFamily: E_FONT.interface, fontWeight: 400, fontSize: 15, lineHeight: 1.5 } as CSSProperties,
  body14:   { fontFamily: E_FONT.interface, fontWeight: 400, fontSize: 14, lineHeight: 1.5 } as CSSProperties,
  note13:   { fontFamily: E_FONT.interface, fontWeight: 400, fontSize: 13, lineHeight: 1.4 } as CSSProperties,
  numbers22:{ fontFamily: E_FONT.interface, fontWeight: 600, fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em" } as CSSProperties,
  // Labels (IBM Plex Mono, caps)
  label11: label(11),
  label10: label(10),
  label9: label(9, "0.1em"),
} as const;

export const E_SPACE = {
  gutter: 28,        // page side insets on the phone, and a band's inner inset
  titleTop: 96,      // from the top edge to a page title, clearing the folded corner
  section: 60,
  sectionTight: 44,
  row: 16,
  gap: 16,
  gapTight: 12,
  bandPad: 18,
  tabGap: 6,
  stampClear: 74,
  cardBleed: 14,
  pinnedBand: 48,
  paperRule: 28,
} as const;

export const E_RADIUS = { square: 0, disc: "50%", logoBlock: 15, badge: 8 } as const;
export const E_SHADOW = { cardStack: "6px 6px 0 #ADC8D7", sidebarLetter: "3px 3px 0 #ADC8D7" } as const;
export const E_BORDER = { rule: 1, ruleActive: 2, swipeEdge: 4, noteBar: 5 } as const;

/** The measures of the chrome, read off the round-3 boards. */
export const E_MEASURE = {
  phone: {
    width: 390,
    corner: 88,                 // the folded corner's side
    titleTop: 96,               // the title block's top (padding under the corner)
    wordsTop: { dashboard: 22, room: 26 },  // the top-right words' text line
    wordsGap: 18,
    wordHit: 44,                // the touch height of a word
    logoTop: 62,                // the dashboard's centred logo
    tabsGap: 26,                // from a title block to the folder tabs under it
  },
  desktop: {
    column: 1040,               // the page column, centred
    inside: 64,                 // its inner inset (content 912)
    wide: 1080,                 // the show room's two-column measure
    letters: 672,
    rail: 344,
    railGap: 64,
    corner: 112,                // the folded corner in the window's corner
    titleTop: 96,               // a room's title block
    dashboardTitleTop: 168,     // the dashboard's title, under the centred logo
    logoTop: 44,                // the dashboard's centred logo
    logoLift: -5,               // a room's logo, beside the headline
    wordsTop: 34,
    wordsGap: 20,
    wordHit: 32,
    tabsGap: 26,                // from a title block to the folder tabs under it
  },
} as const;

export const E = {
  font: E_FONT, color: E_COLOR, type: E_TYPE, space: E_SPACE, radius: E_RADIUS, shadow: E_SHADOW, border: E_BORDER, measure: E_MEASURE,
} as const;
