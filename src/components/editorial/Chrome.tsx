/**
 * Chrome.tsx — the editorial skin's page chrome (the bible's CornerTab and
 * "Top right"; checkpoint 1, 2026-10-10). Rendered only under the editorial
 * skin (src/lib/skin.tsx); the classic chrome is untouched.
 *
 *   CornerTab   the folded corner: an 88px 45° triangle at the page's top-left
 *               (112px, fixed in the window's corner, on desktop) holding one
 *               control — `identity` with a back arrow inside rooms, on the
 *               map, in onboarding and while writing; `alert` with the
 *               feedback mark on the dashboard. The triangle is the whole
 *               target (clip-path), no hairline, no shadow.
 *   TopRight    the row of mono words and small ink glyphs at the top right:
 *               `? ⚙`, `Chat 2 ? ⚙`, `? [account]`. Positioned by its text
 *               line as the boards measure it; each word carries a taller hit.
 *   EditorialTitle / EditorialSub   a page's title (Lora 46 / 64 on desktop)
 *               and the mono "With …" line under it.
 *   EditorialColumn   the desktop page column (1040 centred, 64 inside; 1080
 *               for the show room's two columns).
 */
import React from "react";
import { E } from "../../styles/editorial";

const WORD_PAD = 6; // horizontal padding inside a word's hit box

const ARROW = (<><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>);
const FEEDBACK = (<><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>);

export function CornerTab({ kind, onClick, desktop = false, label, title, zIndex = 45 }: {
  kind: "back" | "feedback";
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** 112px, fixed in the window's corner (the phone's is 88px at the page's top-left). */
  desktop?: boolean;
  label?: string;
  title?: string;
  zIndex?: number;
}) {
  const size = desktop ? E.measure.desktop.corner : E.measure.phone.corner;
  const fill = kind === "back" ? E.color.identity : E.color.alert;
  const transform = desktop ? "translate(20 20) scale(1.25)" : kind === "back" ? "translate(16 16)" : "translate(15 15)";
  const aria = label ?? (kind === "back" ? "Back" : "Feedback");
  return (
    <button
      type="button"
      aria-label={aria}
      title={title ?? aria}
      onClick={onClick}
      style={{
        position: desktop ? "fixed" : "absolute", left: 0, top: 0, width: size, height: size,
        padding: 0, border: 0, background: "transparent", cursor: "pointer", display: "block", zIndex,
        clipPath: "polygon(0 0, 100% 0, 0 100%)", WebkitTapHighlightColor: "transparent",
      }}
    >
      <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
        <polygon points={`0,0 ${size},0 0,${size}`} fill={fill} />
        <g transform={transform} fill="none" stroke={E.color.cream} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          {kind === "back" ? ARROW : FEEDBACK}
        </g>
      </svg>
    </button>
  );
}

/** A mono word's style — exported so a component that draws its own trigger
 *  (MobileTipsSheet's "?") can take the same shape. */
export function wordStyle(hit: number): React.CSSProperties {
  return {
    ...E.type.label11, color: E.color.ink, background: "transparent", border: 0, borderRadius: 0,
    width: "auto", height: "auto", minHeight: hit, padding: `0 ${WORD_PAD}px`, margin: 0,
    display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", whiteSpace: "nowrap",
    WebkitTapHighlightColor: "transparent", textAlign: "left", flexShrink: 0,
  };
}

export function Word({ children, onClick, label, title, hit, style, anchor }: {
  children: React.ReactNode; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; label?: string; title?: string; hit: number; style?: React.CSSProperties;
  /** data-tip-anchor, so a pointer tip can find the word where it found the circle. */
  anchor?: string;
}) {
  return (
    <button type="button" aria-label={label} title={title ?? label} onClick={onClick} data-tip-anchor={anchor} style={{ ...wordStyle(hit), ...style }}>
      {children}
    </button>
  );
}

/** `?` — opens tips, or toggles the letter from Sidebar inside a room; while
 *  that letter shows, the ? sits in a `draft` circle. */
export function HelpWord({ open = false, onClick, hit, label = "tips" }: { open?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; hit: number; label?: string }) {
  return (
    <Word onClick={onClick} label={label} hit={hit}>
      {open ? (
        <span style={{ width: 28, height: 28, borderRadius: "50%", background: E.color.draft, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>?</span>
      ) : "?"}
    </Word>
  );
}

const GEAR_PATH = "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z";

/** The gear — group settings, room settings. `dot` = the identity dot for a
 *  stale invite. */
export function GearWord({ onClick, hit, label, title, dot = false }: { onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; hit: number; label: string; title?: string; dot?: boolean }) {
  return (
    <Word onClick={onClick} label={label} title={title} hit={hit} style={{ position: "relative" }}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={E.color.ink} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" /><path d={GEAR_PATH} />
      </svg>
      {dot && <span aria-hidden="true" style={{ position: "absolute", top: (hit - 16) / 2 - 3, right: WORD_PAD - 3, width: 8, height: 8, borderRadius: "50%", background: E.color.identity }} />}
    </Word>
  );
}

/** The user-pen ("Me") — opens the account card. */
export function AccountWord({ onClick, hit }: { onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; hit: number }) {
  return (
    <Word onClick={onClick} label="Account" hit={hit}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={E.color.ink} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11.5 15H7a4 4 0 0 0-4 4v2" />
        <path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
        <circle cx="10" cy="7" r="4" />
      </svg>
    </Word>
  );
}

/** "Chat" with the red count pill (the only red count) — or a bare red dot
 *  when something is new without a count. */
export function ChatWord({ onClick, hit, countLabel, isNew = false, anchor }: { onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; hit: number; countLabel?: string | null; isNew?: boolean; anchor?: string }) {
  return (
    <Word onClick={onClick} label="Open chat" hit={hit} anchor={anchor}>
      Chat
      {countLabel ? (
        <span style={{ minWidth: 16, height: 16, padding: "0 4px", borderRadius: E.radius.badge, background: E.color.alert, color: E.color.cream, fontSize: 10, letterSpacing: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
          {countLabel}
        </span>
      ) : isNew ? (
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: E.color.alert, display: "inline-block" }} />
      ) : null}
    </Word>
  );
}

/** The row at the top right. `right` and `textTop` are the boards' measures
 *  of the TEXT (the words' hit boxes reach past them). */
export function TopRight({ items, right, textTop, gap, hit, zIndex = 4, style }: {
  items: React.ReactNode[]; right: number; textTop: number; gap: number; hit: number; zIndex?: number; style?: React.CSSProperties;
}) {
  const lineHeight = 13; // label-11 at 1.2
  return (
    <div style={{ position: "absolute", right: right - WORD_PAD, top: textTop - (hit - lineHeight) / 2, display: "flex", alignItems: "center", gap: Math.max(0, gap - 2 * WORD_PAD), zIndex, ...style }}>
      {items}
    </div>
  );
}

/** A section head: mono caps on a 1px ink rule, with an optional count or
 *  underlined link at the right end. */
export function SectionHead({ children, right, style }: { children: React.ReactNode; right?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingBottom: 9, borderBottom: `1px solid ${E.color.ink}`, ...E.type.label11, color: E.color.ink, ...style }}>
      <span>{children}</span>
      {right}
    </div>
  );
}

/** An underlined mono word — the quiet act at the end of a head or a row. */
export function UnderlineWord({ children, onClick, label, title, style }: { children: React.ReactNode; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; label?: string; title?: string; style?: React.CSSProperties }) {
  return (
    <button type="button" aria-label={label} title={title ?? label} onClick={onClick} style={{ ...E.type.label11, color: E.color.ink, background: "transparent", border: 0, padding: 0, textDecoration: "underline", textUnderlineOffset: 2, cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent", textAlign: "left", ...style }}>
      {children}
    </button>
  );
}

export function EditorialTitle({ children, desktop = false, style }: { children: React.ReactNode; desktop?: boolean; style?: React.CSSProperties }) {
  return <h1 style={{ ...(desktop ? E.type.title64 : E.type.title46), color: E.color.ink, margin: 0, ...style }}>{children}</h1>;
}

export function EditorialSub({ children, desktop = false, style }: { children: React.ReactNode; desktop?: boolean; style?: React.CSSProperties }) {
  return <div style={{ ...E.type.label11, color: E.color.inkSub, marginTop: desktop ? 16 : 14, ...style }}>{children}</div>;
}

/** The desktop page column. */
export function EditorialColumn({ children, wide = false, style }: { children?: React.ReactNode; wide?: boolean; style?: React.CSSProperties }) {
  const m = E.measure.desktop;
  return (
    <div style={{ position: "relative", maxWidth: wide ? m.wide : m.column, margin: "0 auto", padding: wide ? 0 : `0 ${m.inside}px`, boxSizing: "border-box", ...style }}>
      {children}
    </div>
  );
}
