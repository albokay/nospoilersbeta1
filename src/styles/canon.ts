// ============================================================================
// canon.ts — Sidebar's single source of truth for color.
// ----------------------------------------------------------------------------
// This file replaces ~20 duplicated "// Canon palette" const blocks scattered
// across components, and is intended to become the source that theme.ts reads
// from too (see canonCssVars() + the migration note at the bottom).
//
// TWO SWAP AXES — this is the whole point of the file:
//
//   AXIS 1 · Change a HEX  →  every use of that color changes everywhere.
//            Edit CANON below. e.g. make "green" mintier: green:'#6FB585'.
//
//   AXIS 2 · Re-ROLE a color  →  only that usage changes, everywhere it's used.
//            Edit ROLE below. e.g. make friend-room accents blue instead of
//            midnight: roomAccentFriend: CANON.blue.
//
// Because inline styles (TSX) and CSS (theme.ts) both ultimately read these
// same values — TSX via imports, CSS via the generated custom properties —
// there is exactly one place to change any color, on either axis.
// ============================================================================

// ── AXIS 1: the eight canonical colors ──────────────────────────────────────
// The only hex codes allowed to exist in the app. Everything else references
// these. Casing normalized to uppercase (drift like #fef8ea vs #FEF8EA ends
// here). To retune a color while honing the design, change it ONCE, here.
export const CANON = {
  green:    '#7ABD8E', // private journal frame; "post" action; on-white emphasis
  sky:      '#ADC8D7', // friend-room frame; info surfaces; dice face
  blue:     '#355EB8', // identity (you), usernames, sticky text on cream
  yellow:   '#DEA838', // public-room frame; poll sticky
  red:      '#F45028', // danger / destructive / errors
  cream:    '#FEF8EA', // sticky paper; search field; entry-ticket outlines
  midnight: '#1A3A4A', // text in friend room; text on light surfaces
  greyblue: '#8DAABA', // friend-room map lines; dividers; hairlines ONLY
} as const;

export type CanonName = keyof typeof CANON;
export type CanonHex = (typeof CANON)[CanonName];

// Fixed non-canon values. Pure black is allowed as a literal for true-black
// needs; WHITE is kept ONLY as an escape hatch (e.g. ErrorBoundary before
// theme injection). RULE: product UI uses CANON.cream for light, never WHITE.
export const WHITE = '#FEF8EA';
export const BLACK = '#000000';

// ── AXIS 2: semantic roles → canon color ────────────────────────────────────
// What each color MEANS in context. Components should reference ROLE, not CANON
// directly, wherever a semantic exists — that way you can re-map a role to a
// different canon color in one edit and watch the whole app follow.
//
// The three room "contexts" each get a FRAME (page/header/bg) and an ACCENT
// (color used for text/outlines on white cards inside that room). Splitting
// these two was the core recommendation of the April token map — it's what
// lets the public room be yellow-framed but green-accented WITHOUT the pile of
// !important overrides currently in theme.ts.
export const ROLE = {
  // Room frames (page background, header, sticky bars)
  roomFramePrivate: CANON.green,
  roomFrameFriend:  CANON.sky,
  roomFramePublic:  CANON.yellow,

  // Room content accents (text/outlines/emphasis on WHITE cards in that room)
  //   NOTE: green & yellow both FAIL contrast as body text on white (~2.2:1).
  //   These roles are safe for OUTLINES / ICONS / LARGE emphasis only.
  //   For body copy on white, use textOnLight (midnight). See CONTRAST_AUDIT.md.
  roomAccentPrivate: CANON.green,
  roomAccentFriend:  CANON.midnight, // friend rooms already use midnight — passes
  roomAccentPublic:  CANON.green,

  // Identity & status (stable across all rooms — never re-framed)
  identityUser: CANON.blue,   // profile chip, @usernames
  danger:       CANON.red,    // destructive actions, errors
  postAction:   CANON.green,  // legacy alias for the "write/post" tint; no longer a single canonical button color — preserve each publish button's real color instead

  // Text colors
  //   RULE: no pure white anywhere. On-frame light text is CREAM.
  textOnDarkFrame:  CANON.cream,    // cream text on green/yellow/blue/red frames
  textOnLight:      CANON.midnight, // text on cream/sky/white surfaces
  stickyText:       CANON.blue,     // primary text on cream sticky paper

  // Surfaces & structure
  stickyPaper:  CANON.cream,
  searchField:  CANON.cream,
  infoSurface:  CANON.sky,      // explanation cards
  mapLines:     CANON.greyblue, // hairlines, dividers, map grid — NON-TEXT only
  ticketOutline: CANON.cream,   // entry-ticket borders in friend/show rooms
} as const;

export type RoleName = keyof typeof ROLE;

// ── Frame gradient tints (a deliberate exception to the 8) ───────────────────
// Each room's page background fades from a lighter tint at the very top into
// its solid frame color over ~180px. These three tints are intentionally kept
// outside CANON but governed here so they aren't stray literals in theme.ts.
export const FRAME_GRADIENT_TOP = {
  private: '#C8E4B0', // lighter green
  friend:  '#C8DDE8', // lighter sky
  public:  '#F0CC60', // lighter yellow
} as const;

/** CSS for a room's page background: tint at top → solid frame below. */
export function frameGradient(room: keyof typeof FRAME_GRADIENT_TOP, frame: string): string {
  return `linear-gradient(to bottom, ${FRAME_GRADIENT_TOP[room]} 0px, ${frame} 180px), ${frame}`;
}

// ── Alpha helper ─────────────────────────────────────────────────────────────
// The app uses lots of rgba(...) tints (hover overlays, faded text, shadows).
// Derive them from canon colors instead of hand-writing rgba literals, so an
// AXIS-1 swap flows through to the tints too.
//   withAlpha(CANON.midnight, 0.65)  →  'rgba(26,58,74,0.65)'
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── CSS-variable bridge ──────────────────────────────────────────────────────
// Emits :root custom properties for BOTH axes so CSS-land (theme.ts's injected
// stylesheet, or a real .css file) reads the exact same values as TSX-land.
// Call once at app start (see migration note). After this runs you can write
// `background: var(--canon-green)` or `color: var(--role-identity-user)` in any
// CSS, and an AXIS-1/AXIS-2 edit here updates that CSS with no other changes.
export function canonCssVars(): string {
  const lines: string[] = [':root{'];
  for (const [name, hex] of Object.entries(CANON)) {
    lines.push(`  --canon-${kebab(name)}: ${hex};`);
  }
  for (const [name, hex] of Object.entries(ROLE)) {
    lines.push(`  --role-${kebab(name)}: ${hex};`);
  }
  for (const [name, hex] of Object.entries(FRAME_GRADIENT_TOP)) {
    lines.push(`  --frame-top-${kebab(name)}: ${hex};`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** Inject the canon custom properties into <head>. Idempotent. */
export function injectCanonVars(): void {
  const id = 'canon-vars';
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = canonCssVars();
  // Insert FIRST so theme.ts (injected later) can consume these vars.
  document.head.insertBefore(el, document.head.firstChild);
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

// ============================================================================
// MIGRATION NOTE (for Claude Code, in the repo)
// ----------------------------------------------------------------------------
// 1. New components: replace local `const CREAM = '#fef8ea'` blocks with
//        import { CANON, ROLE, withAlpha } from '../styles/canon';
//    then use CANON.cream / ROLE.stickyText / withAlpha(CANON.midnight,0.5).
//
// 2. Bridge theme.ts: call injectCanonVars() BEFORE injectDOSStyles() in
//    App's mount effect. Then, inside theme.ts, migrate the --dos-* values to
//    reference the canon vars, e.g.:
//        :root{ --dos-bg: var(--role-room-frame-private); --dos-fg: #FEF8EA; }
//        body.group-context{ --dos-bg: var(--role-room-frame-friend); ... }
//        body.public-context{ --dos-bg: var(--role-room-frame-public); ... }
//    At that point BOTH systems read from canon.ts and can't drift.
//
// 3. The big win — split frame vs. accent. Once --room-accent exists as a var
//    (var(--role-room-accent-*) set per body-context), the ~11 public-context
//    "override yellow back to green !important" rules collapse to a single
//    token assignment. See the April Token Map, §04 "Before & after".
//
// This file changes NOTHING visually on its own. It's the container the rest
// of the standardization pours into.
// ============================================================================
